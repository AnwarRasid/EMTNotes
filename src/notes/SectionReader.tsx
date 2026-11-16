// The notes section reader (#/notes/:section/:anchor?, query b and v), a focus screen (spec §6.5): one section in
// Full text or Highlights only (?v=hl), the text size, a scroll to a heading (the anchor) or to a search hit's block
// (?b=), the PAM steps and quiz questions that use the section, and the sections either side.
import type { ComponentChildren, JSX, RefObject } from 'preact';
import { useEffect, useId, useLayoutEffect, useMemo, useRef } from 'preact/hooks';
import { FocusHeader } from '../app/FocusHeader';
import { back, navigate, type RouteMatch } from '../app/routes';
import { useContent } from '../data/load';
import type { Question } from '../data/questions';
import type { Section, Step } from '../data/schema';
import { useProgress, useStore } from '../progress/hooks';
import type { ProgressStore } from '../progress/store';
import type { TextSize } from '../progress/types';
import { ReplacesNote } from '../quiz/QuizTab';
import { startQuiz, useOpenQuiz } from '../quiz/useQuiz';
import { Icon } from '../ui/Icon';
import { Primary } from '../ui/Keys';
import { Panel } from '../ui/Panel';
import { Skeleton, useDelayedFlag } from '../ui/Skeleton';
import { Blocks, Runs } from './Blocks';
import { NotesError } from './NotesTab';
import { highlightPassages, linksForSection, type Passage } from './text';

type View = 'full' | 'highlights';

const SIZES: readonly TextSize[] = ['standard', 'large', 'larger'];
const SIZE_NAMES: Record<TextSize, string> = { standard: 'Standard', large: 'Large', larger: 'Larger' };
const nextSize = (s: TextSize): TextSize => SIZES[(SIZES.indexOf(s) + 1) % SIZES.length] ?? 'standard';

export function SectionReader({ match }: { match: RouteMatch }): JSX.Element {
  const content = useContent('notes');
  const late = useDelayedFlag(content.status === 'loading');
  const notes = content.status === 'ready' ? content.data : null;
  const at = notes ? notes.sections.findIndex((s) => s.id === match.params.section) : -1;
  const section = notes?.sections[at];
  return (
    <div class="reader">
      <FocusHeader exit="close" onExit={() => back('/notes')}
        title={section ? `${section.n}. ${section.title}` : 'Notes'}
        sub={section && notes ? `Section ${section.n} of ${notes.sections.length}` : undefined} />
      <div class="reader-body">
        {content.status === 'error' ? <NotesError onRetry={content.retry} />
          : notes && section
            ? <Reader key={section.id} section={section} prev={notes.sections[at - 1]} next={notes.sections[at + 1]}
                path={match.path} view={match.query.v === HIGHLIGHTS ? 'highlights' : 'full'}
                anchor={match.params.anchor} b={match.query.b} />
          : notes ? <NoSuchSection />
          // Sized like the toolbar and a screenful of notes.
          : late && <Skeleton rows={2} rowHeight={['2.75rem', '30rem']} />}
      </div>
    </div>
  );
}

/** The `v` query value for Highlights only. Full text has no `v`. */
const HIGHLIGHTS = 'hl';

/** A reader route: `path` (with any anchor), then `?b=` for a block still to scroll to and `?v=hl` for Highlights
 *  only. The view lives in the route, so turning the page and reloading both keep it. */
function readerRoute(path: string, view: View, b?: string): string {
  const q = new URLSearchParams();
  if (b !== undefined) q.set('b', b);
  if (view === 'highlights') q.set('v', HIGHLIGHTS);
  const query = q.toString();
  return query ? `${path}?${query}` : path;
}

function Reader({ section, prev, next, path, view, anchor, b }:
  { section: Section; prev?: Section; next?: Section; path: string; view: View; anchor?: string; b?: string }): JSX.Element {
  const store = useStore();
  const body = useRef<HTMLElement>(null);
  // Switching the view replaces this history entry rather than adding one. It drops ?b=: that block was scrolled to
  // on arrival, and ?b= opens Full text, so a reload in Highlights only would leave the view to jump back to it. The
  // anchor stays in the path: on arrival it never changes the view, so a reload keeps Highlights only.
  const show = (v: View) => { if (v !== view) navigate(readerRoute(path, v), { replace: true }); };
  // A search hit's block still to scroll to opens Full text, keeping ?b= so the scroll follows.
  const openFull = () => navigate(readerRoute(path, 'full', b), { replace: true });
  useMarkRead(store, section.id);
  useScrollToPlace(body, anchor, b, view, openFull);
  return (
    <>
      <Toolbar view={view} onView={show} />
      {/* An article, so the boxed asides inside it aren't each a landmark of their own. */}
      <article class="nbody" ref={body}>
        {view === 'full' ? <Blocks blocks={section.blocks} /> : <Highlights section={section} />}
      </article>
      <CrossLinks sectionId={section.id} />
      <SectionNav prev={prev} next={next} view={view} />
    </>
  );
}

/** Opening a section makes it the last read (the Notes tab marks it) and adds it to the sections read. */
function useMarkRead(store: ProgressStore, id: string): void {
  useEffect(() => {
    store.update((p) => {
      const read = p.notes.read.includes(id) ? p.notes.read : [...p.notes.read, id];
      if (p.notes.lastSection === id && read === p.notes.read) return p;   // nothing new: no save
      return { ...p, notes: { ...p.notes, lastSection: id, read } };
    });
  }, [store, id]);
}

/**
 * Scrolls the anchor's heading, or the top-level block a search hit names (?b=), to the top, clear of the sticky
 * header. A layout effect: the router has already put a new path at the top, and this lands before paint. It is
 * keyed by the place, so a query-only change (the same path, so no remount) scrolls again while a switch of view
 * doesn't. Only ?b= changes the view: a search hit's block is only in Full text, so a new one in Highlights only
 * opens Full text first. An anchor in Highlights only (a reload after switching at #/notes/s01/airway) keeps the
 * view and scrolls nowhere, then or when the view later switches. A place the section lacks leaves the page at the top.
 */
function useScrollToPlace(body: RefObject<HTMLElement>, anchor: string | undefined, b: string | undefined,
  view: View, openFull: () => void): void {
  const done = useRef<string | null>(null);
  useLayoutEffect(() => {
    const place = `${anchor ?? ''}?${b ?? ''}`;
    if (done.current === place) return;
    if (anchor === undefined && b === undefined) {
      done.current = place;
      return;
    }
    if (view !== 'full') {
      if (b !== undefined) {
        openFull();   // this runs again once the route says Full text
        return;
      }
      done.current = place;   // an anchor: its heading isn't in Highlights only
      return;
    }
    done.current = place;
    const root = body.current;
    if (!root) return;
    // Looked up among this section's own headings and blocks: an id elsewhere on the page never takes the scroll.
    const target = anchor !== undefined ? [...root.querySelectorAll('h2[id]')].find((h) => h.id === anchor)
      : b !== undefined && /^\d+$/.test(b) ? root.querySelector(`[data-b="${Number(b)}"]`)
      : null;
    if (!target) return;
    measureHeader(root);
    target.scrollIntoView({ block: 'start' });
  }, [anchor, b, view]);
}

/** Puts the sticky header's height in --rhead, which the scroll margin of every place adds to. Its height changes
 *  with the title's line count and the text size, so it is measured each time. */
function measureHeader(body: HTMLElement): void {
  const reader = body.closest<HTMLElement>('.reader');
  const head = reader?.querySelector<HTMLElement>('.mhead');
  if (reader && head) reader.style.setProperty('--rhead', `${head.offsetHeight}px`);
}

// ---- Toolbar ------------------------------------------------------------------------------------------------

function Toolbar({ view, onView }: { view: View; onView(v: View): void }): JSX.Element {
  const store = useStore();
  const size = useProgress((p) => p.settings.textSize);
  // The same setting as Settings' text size; App applies it to the whole page.
  const cycle = () => store.update((p) => ({ ...p, settings: { ...p.settings, textSize: nextSize(p.settings.textSize) } }));
  return (
    <div class="rtools">
      <div class="seg" role="group" aria-label="View">
        <ViewKey pressed={view === 'full'} onClick={() => onView('full')}>Full text</ViewKey>
        <ViewKey pressed={view === 'highlights'} onClick={() => onView('highlights')}>Highlights only</ViewKey>
      </div>
      <button type="button" class="chip tsize" onClick={cycle}>
        <span class="tsize-aa" aria-hidden="true">Aa</span><span>Text size: {SIZE_NAMES[size]}</span>
      </button>
    </div>
  );
}

/** One half of the view switch. Pressed shows by the tick, the weight and the brighter rim, as the topic chips do. */
function ViewKey({ pressed, onClick, children }: { pressed: boolean; onClick(): void; children: string }): JSX.Element {
  return (
    <button type="button" class="chip" aria-pressed={pressed} onClick={onClick}>
      {pressed && <Icon name="check" />}<span>{children}</span>
    </button>
  );
}

// ---- Highlights only ------------------------------------------------------------------------------------------

interface PassageGroup { headingId: string | null; heading: string; passages: Passage[] }

/** Passages in document order, each run of them under the same heading gathered under it once. */
function groupByHeading(passages: Passage[]): PassageGroup[] {
  const groups: PassageGroup[] = [];
  for (const p of passages) {
    const last = groups[groups.length - 1];
    if (last && last.headingId === p.headingId) last.passages.push(p);
    else groups.push({ headingId: p.headingId, heading: p.heading, passages: [p] });
  }
  return groups;
}

function Highlights({ section }: { section: Section }): JSX.Element {
  const groups = useMemo(() => groupByHeading(highlightPassages(section)), [section]);
  if (groups.length === 0) return <p class="nempty">No highlights in this section.</p>;
  return (
    <>
      {groups.map((g, i) => (
        <div key={i} class="hlgroup">
          <h2 class="nh">{g.heading}</h2>
          <ul class="hl-list" role="list">
            {/* A number is read out, as in Full text; the space sits between the spans, so a trimmed name keeps it. */}
            {g.passages.map((p, j) => (
              <li key={j} class="hl-item">
                {p.marker !== undefined && <><span class="hl-num tn">{p.marker}</span>{' '}</>}<Runs runs={p.runs} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

// ---- Cross-links ---------------------------------------------------------------------------------------------

/** The PAM steps and quiz questions that use this section. Each part shows once its content has loaded and it
 *  has something to list; with neither, there is no panel. */
function CrossLinks({ sectionId }: { sectionId: string }): JSX.Element | null {
  const stepsContent = useContent('steps');
  const questionsContent = useContent('questions');
  const steps = stepsContent.status === 'ready' ? stepsContent.data.steps : null;
  const questions = questionsContent.status === 'ready' ? questionsContent.data : null;
  const links = useMemo(() => linksForSection(sectionId, steps ?? [], questions ?? []), [sectionId, steps, questions]);
  if (links.steps.length === 0 && links.questionIds.length === 0) return null;
  return (
    <Panel class="xlinks">
      {links.steps.length > 0 && (
        <div class="xpart">
          <h2 class="plabel">Used in PAM steps</h2>
          <ul class="xsteps" role="list">
            {links.steps.map((s) => <li key={s.id}><StepChip step={s} /></li>)}
          </ul>
        </div>
      )}
      {questions && links.questionIds.length > 0 && <Practise questions={questions} ids={links.questionIds} />}
    </Panel>
  );
}

/** A PAM step that uses this section, "{order} {name}": a link to Run start's drill on the step, named for what it
 *  does. Run start says if the drill replaces an open run. */
function StepChip({ step }: { step: Step }): JSX.Element {
  return (
    <a class="xstep" href={`#/pam/start?drill=${step.id}`} aria-label={`Drill step ${step.order}, ${step.name}`}>
      <span class="xstep-n tn">{step.order}</span> {step.name}
    </a>
  );
}

/** Practice over every question that links to the section. Starting it replaces an open quiz, and says so, as the
 *  Quiz tab and setup do. */
function Practise({ questions, ids }: { questions: Question[]; ids: string[] }): JSX.Element {
  const store = useStore();
  const replaces = useOpenQuiz(questions) !== null;
  const noteId = useId();
  const label = `Practise the ${ids.length} ${ids.length === 1 ? 'question' : 'questions'} on this section`;
  const start = () => { startQuiz(store, questions, 'practice', { group: 'all', topic: 'all', ids }); };
  return (
    <div class="xpart">
      <h2 class="plabel">Quiz questions</h2>
      <div class="keys"><Primary onClick={start} describedBy={replaces ? noteId : undefined}>{label}</Primary></div>
      {replaces && <ReplacesNote id={noteId} />}
    </div>
  );
}

// ---- Previous and next ------------------------------------------------------------------------------------------

function SectionNav({ prev, next, view }: { prev?: Section; next?: Section; view: View }): JSX.Element | null {
  if (!prev && !next) return null;
  return (
    <nav class="rnav" aria-label="Sections">
      {prev && <PageLink section={prev} dir="prev" view={view} />}
      {next && <PageLink section={next} dir="next" view={view} />}
    </nav>
  );
}

/**
 * A link to the section before or after, in the same view. It turns the page in place (replacing this history
 * entry), so Close, the phone's back and the browser's back all leave the reader for where it was opened from,
 * rather than stepping back through every section read on the way. A modified click (a new tab) is left to the
 * browser.
 */
function PageLink({ section, dir, view }: { section: Section; dir: 'prev' | 'next'; view: View }): JSX.Element {
  const to = readerRoute(`/notes/${section.id}`, view);
  const go = (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to, { replace: true });
  };
  const label: ComponentChildren = <span class="rnav-t">{section.n}. {section.title}</span>;
  // The spaces sit between the spans, not inside one, so a name computed by trimming each element keeps them.
  return (
    <a class={`rnav-a rnav-${dir}`} href={`#${to}`} onClick={go}>
      {dir === 'prev'
        ? <><span class="vh">Previous section:</span> <span aria-hidden="true">←</span> {label}</>
        : <><span class="vh">Next section:</span> {label} <span aria-hidden="true">→</span></>}
    </a>
  );
}

/** A link to a section the notes don't have (an old bookmark, a typo). */
function NoSuchSection(): JSX.Element {
  return (
    <Panel class="load-error">
      <p class="load-error-msg">That section isn't in your notes.</p>
      <div class="keys"><Primary href="#/notes">All sections</Primary></div>
    </Panel>
  );
}
