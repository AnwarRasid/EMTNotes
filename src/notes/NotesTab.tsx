// The Notes tab (#/notes): the trainee's 20 survey-note sections with their highlight counts and a Last read
// marker, and a search over all their text that links into a section at the matching block (spec §5, §6.5). The
// query lives in the route (#/notes?q=…), so Back from a hit lands on the results.
import type { JSX, RefObject } from 'preact';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { navigate, useRoute } from '../app/routes';
import { contentErrorCopy, useContent } from '../data/load';
import type { NotesDoc } from '../data/schema';
import { useProgress } from '../progress/hooks';
import { Icon } from '../ui/Icon';
import { Primary } from '../ui/Keys';
import { Panel } from '../ui/Panel';
import { Skeleton, useDelayedFlag } from '../ui/Skeleton';
import { searchable, searchNotes, type SearchHit } from './text';

/** The most hits the tab lists. */
const SEARCH_LIMIT = 50;
/** How long typing must pause before the count is announced, so a screen reader isn't read every keystroke. */
const ANNOUNCE_MS = 700;

export function NotesTab(): JSX.Element {
  const content = useContent('notes');
  const late = useDelayedFlag(content.status === 'loading');
  return (
    <div class="screen">
      <header class="screen-head"><h1 class="h1">Notes</h1></header>
      {content.status === 'ready' ? <NotesHome notes={content.data} />
        : content.status === 'error' ? <NotesError onRetry={content.retry} />
        // Sized like the search field and the panel of 20 rows, so nothing jumps when they arrive.
        : late && <Skeleton rows={2} rowHeight={['3rem', '77.5rem']} />}
    </div>
  );
}

/** The notes failed to load. The section reader (Task 19) shows it too. */
export function NotesError({ onRetry }: { onRetry(): void }): JSX.Element {
  return (
    <Panel class="load-error">
      <p class="load-error-msg" role="alert">{contentErrorCopy('notes')}</p>
      <div class="keys"><Primary onClick={onRetry}>Try again</Primary></div>
    </Panel>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The search query: the route's `q`, replaced (never pushed) as the trainee types, so Back from a hit comes back to
 * these results and Back from here still leaves the tab. Clearing it takes `q` out. The field reads a local copy
 * that follows the route (a tap on the Notes tab drops `q`), so typing stays live even when a browser throttles
 * history.replaceState (Safari can throw after 100 calls in 10 s, as when Delete is held down).
 */
function useRouteQuery(): [string, (q: string) => void] {
  const inRoute = useRoute().query.q ?? '';
  const [query, setLocal] = useState(inRoute);
  useEffect(() => { setLocal(inRoute); }, [inRoute]);
  const setQuery = (q: string) => {
    setLocal(q);
    try {
      navigate(q === '' ? '/notes' : `/notes?q=${encodeURIComponent(q)}`, { replace: true });
    } catch {
      // Throttled: the results still follow the field; the route catches up on the next keystroke that gets through.
    }
  };
  return [query, setQuery];
}

function NotesHome({ notes }: { notes: NotesDoc }): JSX.Element {
  const [query, setQuery] = useRouteQuery();
  const lastSection = useProgress((p) => p.notes.lastSection);
  const lastRow = useRef<HTMLAnchorElement>(null);
  const searching = searchable(query);
  // One past the limit, to tell "exactly 50" from "more than 50".
  const hits = useMemo(() => searchNotes(notes, query, SEARCH_LIMIT + 1), [notes, query]);
  const count = !searching ? ''
    : hits.length === 0 ? `No matches for "${query.trim()}".`
    : hits.length > SEARCH_LIMIT ? `More than ${SEARCH_LIMIT} matches. Showing the first ${SEARCH_LIMIT}.`
    : plural(hits.length, 'match', 'matches');

  // The route change put the page at the top before this rendered. Bring the last-read row into view, scrolling
  // as little as it takes, so the search field stays on screen when the row is already in view. Once, on arrival:
  // the list coming back after a search stays where the trainee left it.
  useLayoutEffect(() => {
    lastRow.current?.scrollIntoView({ block: 'nearest' });
  }, []);

  return (
    <>
      <SearchField query={query} onQuery={setQuery} count={count} />
      {/* The count is announced by the search field's live region, once typing settles. */}
      {searching && <p class="ncount" aria-hidden="true">{count}</p>}
      {searching
        ? hits.length > 0 && <HitList notes={notes} hits={hits.slice(0, SEARCH_LIMIT)} />
        : <SectionList notes={notes} lastSection={lastSection} lastRow={lastRow} />}
    </>
  );
}

/** The search field. It stays mounted while the list and the hits swap below it, so focus never leaves it. */
function SearchField({ query, onQuery, count }: { query: string; onQuery(q: string): void; count: string }): JSX.Element {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const announced = useAnnouncement(count, query, ANNOUNCE_MS);
  const clear = () => {
    onQuery('');
    input.current?.focus();
  };
  return (
    // Results show as you type, so the search key has nothing to send: it puts the phone keyboard away and leaves
    // the results in view. Typing itself never moves focus off the field.
    <form class="nsearch" role="search" onSubmit={(e) => { e.preventDefault(); input.current?.blur(); }}>
      <label class="vh" for={id}>Search your notes</label>
      <div class="nsearch-field">
        <Icon name="search" />
        <input ref={input} id={id} class="nsearch-input" type="search" enterkeyhint="search" placeholder="Search your notes"
          autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck={false}
          value={query} onInput={(e) => onQuery(e.currentTarget.value)} />
        {query !== '' && (
          <button type="button" class="ibtn nsearch-clear" aria-label="Clear search" onClick={clear}><Icon name="close" /></button>
        )}
      </div>
      <p class="vh" role="status" aria-live="polite">{announced}</p>
    </form>
  );
}

/**
 * What the live region says: `text`, once `query` and `text` have both held still for `ms`, so each keystroke
 * restarts the wait. A new query that gives the same text ("3 matches" again) must be heard again too, so a repeat
 * toggles a trailing no-break space: the region always changes. (A plain space can be collapsed away in the
 * accessibility tree, and then nothing changes.)
 */
function useAnnouncement(text: string, query: string, ms: number): string {
  const [said, setSaid] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setSaid((prev) => (text !== '' && prev === text ? `${text}\u00a0` : text)), ms);
    return () => clearTimeout(t);
  }, [text, query, ms]);   // `query` only restarts the wait
  return said;
}

function SectionList({ notes, lastSection, lastRow }:
  { notes: NotesDoc; lastSection: string | null; lastRow: RefObject<HTMLAnchorElement> }): JSX.Element {
  return (
    <Panel as="div">
      {/* role="list": Safari drops list semantics from a list with list-style none. */}
      <ol class="nlist" role="list" aria-label="Sections">
        {notes.sections.map((s) => {
          const last = s.id === lastSection;
          const untested = s.tags.includes('not tested');
          // The line under the title only when it has something to say: a section with no highlights says nothing.
          const meta = s.highlights > 0 || untested || last;
          return (
            <li key={s.id}>
              <a class={last ? 'nrow nrow-last' : 'nrow'} href={`#/notes/${s.id}`} ref={last ? lastRow : undefined}>
                <span class="nrow-n tn">{s.n}<span class="vh">.</span></span>{' '}
                <span class="nrow-text">
                  <span class="nrow-title">{s.title}</span>
                  {meta && (
                    <>{' '}<span class="nrow-meta">
                      {s.highlights > 0 && <span>{plural(s.highlights, 'highlight', 'highlights')}</span>}
                      {untested && <>{' '}<span class="ntag">not tested</span></>}
                      {last && <>{' '}<span class="nlast">Last read</span></>}
                    </span></>
                  )}
                </span>
                <Icon name="forward" />
              </a>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

function HitList({ notes, hits }: { notes: NotesDoc; hits: SearchHit[] }): JSX.Element {
  const numbers = useMemo(() => new Map(notes.sections.map((s) => [s.id, s.n])), [notes]);
  return (
    <Panel as="div">
      <ol class="nlist" role="list" aria-label="Matches">
        {hits.map((h) => (
          <li key={`${h.sectionId}:${h.blockIndex}`}>
            <a class="nhit" href={`#/notes/${h.sectionId}?b=${h.blockIndex}`}>
              <span class="nhit-title">{numbers.get(h.sectionId)}. {h.sectionTitle}</span>{' '}
              <span class="nhit-snip">{h.before}<mark>{h.match}</mark>{h.after}</span>
            </a>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
