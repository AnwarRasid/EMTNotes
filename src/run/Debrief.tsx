// A run's debrief (#/debrief/:id, spec §6.2 Debrief, mockup screen 3). Under the header (Debrief, or Drill debrief, over
// the case line): the band over the verdict; for a full run the replay and the figures (a drill shows Steps only); the
// fix list, each fault with its number, chip, step and notes link and "Not what I meant"; the disputed ones with "Count
// it again"; the steps tapped; what went well; the case record (CaseRecord.tsx) and the transcript; then the key bar
// (DebriefKeys.tsx). It reads the saved record, with the steps and cases for the names, the drills and the case line. A
// record whose case has left this phone still shows, with no drill. Fresh from a run (?fresh=1) it reveals (R10) and
// holds presses for READ_HOLD_MS (S5). Close and Android's back both reach Today: back from a fresh debrief lands on
// the run's old #/run entry, which the run screen replaces with Today before it paints.
import type { JSX } from 'preact';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { FocusHeader } from '../app/FocusHeader';
import { back, type RouteMatch } from '../app/routes';
import { notesRefHref, notesRefLabel } from '../data/notesRef';
import type { Case, Step } from '../data/schema';
import { useProgress, useStore } from '../progress/hooks';
import { activeFaults, type Fault, type RunRecord } from '../progress/types';
import { withinHold } from '../quiz/useQuiz';
import { formatMmSs } from '../sim/clock';
import {
  caseLine, figuresOf, fixDetail, fixStep, replayOf, replaySummary, tappedLine, transcriptOf, verdict, verdictSub, wentWell,
  withDispute,
} from '../sim/debrief';
import { Secondary, TextLink } from '../ui/Keys';
import { Panel } from '../ui/Panel';
import { ReplayStrip } from '../ui/RunStrip';
import { Skeleton, useDelayedFlag } from '../ui/Skeleton';
import { StatusChip, chipFor } from '../ui/StatusChip';
import { CaseRecord } from './CaseRecord';
import { DebriefKeys } from './DebriefKeys';
import { RunContentError } from './RunStart';
import { useRunContent } from './useRun';

export const GONE_RUN = "This run isn't on this phone any more.";
/** Under the case line, when the smart tester credited any of the run's lines (Plan 3 D15): read from the record, never
 *  regraded. */
export const smartNote = (n: number): string =>
  `The smart tester credited ${n} ${n === 1 ? 'line' : 'lines'} the keyword rules couldn't place.`;

/** The reveal's timing (spec §9: 1.1 s or less, a tap skips it): the trace draws over --t-reveal (700 ms), the figures
 *  fade in after it, then fix row i from 760 ms, 60 ms apart, the last at 940 ms; each fade takes --t-fast (160 ms). */
const REVEAL = { rowMs: 760, stepMs: 60, lastMs: 940, endMs: 1100 } as const;
const rowDelay = (i: number): number => Math.min(REVEAL.rowMs + REVEAL.stepMs * i, REVEAL.lastMs);

/** The loading skeleton's rows, at the debrief's heights at phone width: the verdict, the replay, the figures, two
 *  fixes. */
const LOADING_ROWS = ['6rem', '7.25rem', '4.5rem', '5.5rem', '5.5rem'];

type Phase = 'off' | 'set' | 'go' | 'skip' | 'done';
const REVEAL_CLASS: Record<Phase, string> = {
  off: '', set: ' reveal', go: ' reveal reveal-go', skip: ' reveal reveal-go reveal-skip', done: '',
};

/** The next frame's callback, or a timer where there are no frames. */
function nextFrame(fn: () => void): () => void {
  if (typeof requestAnimationFrame === 'function') {
    const id = requestAnimationFrame(fn);
    return () => cancelAnimationFrame(id);
  }
  const id = setTimeout(fn, 16);
  return () => clearTimeout(id);
}

/**
 * The reveal, for a debrief fresh from its run: the root takes `reveal` (everything to come held back), then on the
 * next frame `reveal-go`, which starts the CSS animations; a pointerdown anywhere adds `reveal-skip`, which zeroes every
 * delay and duration. Once the reveal is over the classes go, so a row that comes back later (Count it again) just
 * shows. Waits for the content, so the skeleton never takes the reveal.
 */
function useReveal(fresh: boolean, ready: boolean): Phase {
  const [phase, setPhase] = useState<Phase>(fresh ? 'set' : 'off');
  useEffect(() => (phase === 'set' && ready ? nextFrame(() => setPhase('go')) : undefined), [phase, ready]);
  useEffect(() => {
    if (phase !== 'set' && phase !== 'go') return;
    const skip = () => setPhase('skip');
    document.addEventListener('pointerdown', skip);
    return () => document.removeEventListener('pointerdown', skip);
  }, [phase]);
  useEffect(() => {
    if (phase !== 'go' && phase !== 'skip') return;
    const t = setTimeout(() => setPhase('done'), REVEAL.endMs);
    return () => clearTimeout(t);
  }, [phase]);
  return phase;
}

export function Debrief({ match }: { match: RouteMatch }): JSX.Element {
  const id = match.params.id ?? '';
  const fresh = match.query.fresh === '1';
  const record = useProgress((p) => p.runs.find((r) => r.id === id) ?? null);
  const content = useRunContent();
  const late = useDelayedFlag(content.status === 'loading');
  const ready = content.status === 'ready' ? content : null;
  const c = useMemo(() => (ready !== null && record !== null ? ready.cases.find((x) => x.id === record.caseId) ?? null : null),
    [ready?.cases, record?.caseId]);
  const phase = useReveal(fresh, ready !== null);
  // Fresh from the run, the debrief takes the place of the confirming End key: the second tap of a double tap lands
  // here, so for READ_HOLD_MS every key on it ignores presses, the key bar's Drill the fixes above all (ruling S5).
  const shownAt = useRef(fresh ? performance.now() : null);
  const hold = (e: MouseEvent) => {
    if (!withinHold(shownAt.current)) return;
    e.preventDefault();
    e.stopPropagation();
  };

  const title = record?.drill === true ? 'Drill debrief' : 'Debrief';
  return (
    <div class={`qs debrief${REVEAL_CLASS[phase]}`} onClickCapture={hold}>
      <FocusHeader exit="close" onExit={() => back('/')} title={title}
        sub={record !== null && ready !== null ? caseLine(record, c) : undefined} />
      {record === null ? (
        <div class="qs-body">
          <Panel class="dgone">
            <p class="dgone-msg">{GONE_RUN}</p>
            <TextLink href="#/">Back to Today</TextLink>
          </Panel>
        </div>
      ) : ready !== null ? <Body r={record} steps={ready.steps} c={c} revealing={phase !== 'off' && phase !== 'done'} />
        : content.status === 'error' ? <div class="qs-body"><RunContentError error={content} /></div>
        : late && <div class="qs-body"><Skeleton rows={LOADING_ROWS.length} rowHeight={LOADING_ROWS} /></div>}
    </div>
  );
}

function Body({ r, steps, c, revealing }: { r: RunRecord; steps: Step[]; c: Case | null; revealing: boolean }): JSX.Element {
  const store = useStore();
  const ids = useId();
  const body = useRef<HTMLDivElement>(null);
  const active = activeFaults(r);
  const disputed = r.faults.filter((f) => r.disputes.includes(f.point));
  const well = wentWell(r, steps);
  const tapped = tappedLine(r, steps);
  // A row's key goes with it when it moves between the lists: focus follows to its key in the other list, so a slip
  // is undone with one more press.
  const refocus = useRef<{ point: string; list: 'fixes' | 'disputed' } | null>(null);

  const setDisputed = (f: Fault, on: boolean) => {
    refocus.current = { point: f.point, list: on ? 'disputed' : 'fixes' };
    store.update((p) => ({ ...p, runs: p.runs.map((x) => (x.id === r.id ? withDispute(x, f.point, on) : x)) }));
  };
  useLayoutEffect(() => {
    const want = refocus.current;
    refocus.current = null;
    if (want === null) return;
    const rows = body.current?.querySelectorAll<HTMLElement>(`[data-list="${want.list}"] > [data-point]`) ?? [];
    [...rows].find((row) => row.dataset.point === want.point)?.querySelector<HTMLElement>('.btn2')?.focus();
  });

  /** Fault f's row, numbered as its marker when it is still counted. */
  const row = (f: Fault, n: number | null, i: number) => (
    <FixRow key={r.faults.indexOf(f)} f={f} n={n} steps={steps} c={c} delay={revealing && n !== null ? rowDelay(i) : null}
      action={n === null ? 'Count it again' : 'Not what I meant'} onAction={() => setDisputed(f, n !== null)} />
  );
  return (
    <>
      <div class="qs-body dbody" ref={body}>
        <i class="bb vband" aria-hidden="true" />
        <h2 class="h1 fixh" id={`${ids}-v`}>{verdict(active.length)}</h2>
        <p class="sub dsub">{verdictSub(c)}</p>
        {r.smartLines > 0 && <p class="dnote">{smartNote(r.smartLines)}</p>}
        {!r.drill && (
          <Panel as="div" class="replay">
            <ReplayStrip label={replaySummary(r, steps)} replay={replayOf(r, steps)} />
          </Panel>
        )}
        <Figures r={r} steps={steps} />
        {active.length > 0 && (
          <ol class="fixes" aria-labelledby={`${ids}-v`} data-list="fixes">{active.map((f, i) => row(f, i + 1, i))}</ol>
        )}
        {/* what follows the fix rows fades in after the last of them */}
        <div class="drest" style={revealing ? { '--fix-d': `${rowDelay(active.length)}ms` } : undefined}>
          {tapped !== null && <p class="dnote">{tapped}</p>}
          {disputed.length > 0 && (
            <section class="dsec">
              <h3 class="dh3" id={`${ids}-d`}>Disputed, not counted</h3>
              <ul class="fixes fixes-off" aria-labelledby={`${ids}-d`} data-list="disputed">{disputed.map((f, i) => row(f, null, i))}</ul>
            </section>
          )}
          {well.length > 0 && (
            <section class="dsec">
              <h3 class="dh3" id={`${ids}-w`}>Went well</h3>
              <ul class="well" aria-labelledby={`${ids}-w`}>{well.map((w) => <li key={w}>{w}</li>)}</ul>
            </section>
          )}
          <CaseRecord r={r} />
          <Transcript r={r} />
        </div>
      </div>
      <DebriefKeys r={r} steps={steps} c={c} />
    </>
  );
}

/** The figures row (mockup .as-figs): a small label over a standalone number and its limit. A drill is untimed, so it
 *  shows Steps alone. The ✓ is RBS's status, in the done green (spec copy "RBS done ✓", ruling S8), not a chip. */
function Figures({ r, steps }: { r: RunRecord; steps: Step[] }): JSX.Element {
  const f = figuresOf(r, steps);
  return (
    <div class={r.drill ? 'figs figs-one tn' : 'figs tn'}>
      {!r.drill && <>
        <div><p class="fl">Time</p><p class="fv">{f.time}<small>/20:00</small></p></div>
        <div>
          <p class="fl">RBS done{f.rbsOk && <> <span class="ok" role="img" aria-label="within 3:00">✓</span></>}</p>
          <p class="fv">{f.rbs}<small>/3:00</small></p>
        </div>
      </>}
      <div><p class="fl">Steps</p><p class="fv">{f.steps}<small>/{f.total}</small></p></div>
    </div>
  );
}

/**
 * A fault's row (mockup .as-fix): its marker's number while it counts, the chip with its word, the saved label, then
 * its detail, its step (once: not where the detail already names it, fixStep) and the step's notes link; a long oxygen
 * note folds under "Why this oxygen" (ruling P37: up to 567 characters), so the row keeps its step, link and key in
 * view; and the small key that moves it between the lists, described by the row's label so each key is told apart.
 * In a reveal it fades in after `delay` ms.
 */
function FixRow({ f, n, steps, c, delay, action, onAction }: { f: Fault; n: number | null; steps: Step[]; c: Case | null;
  delay: number | null; action: string; onAction(): void }): JSX.Element {
  const labelId = `${useId()}-label`;
  const chip = chipFor(f.kind);
  const step = fixStep(f, steps);
  const detail = fixDetail(f, c);
  const words = [detail.text, step.text].filter((x): x is string => x !== null).join(' ');
  return (
    <li class="fix" data-point={f.point} style={delay === null ? undefined : { '--fix-d': `${delay}ms` }}>
      {n === null ? <span /> : <span class={`num ${chip.kind === 'missed' ? 'num-hi' : 'num-med'}`}>{n}</span>}
      <div class="fix-b">
        <StatusChip kind={chip.kind} label={chip.label} />
        <p class="fix-t" id={labelId}>{f.label}</p>
        <p class="fix-s">
          {words}
          {step.notesRef !== null && <>{words === '' ? '' : ' '}<a class="ilink" href={notesRefHref(step.notesRef)}>{notesRefLabel(null, step.notesRef)}</a>.</>}
        </p>
        {detail.note !== null && (
          <details class="why">
            <summary>Why this oxygen</summary>
            <p>{detail.note}</p>
          </details>
        )}
        <Secondary onClick={onAction} describedBy={labelId}>{action}</Secondary>
      </div>
    </li>
  );
}

/** The transcript, folded away: each line with its time ("Call" before the clock; none in a drill, which is untimed) and
 *  who said it. Only the newest runs keep theirs: RUN_LIMITS.transcriptsKept, or transcriptsOnQuota once the save has
 *  hit the storage quota (ruling D28), so the note names no number. */
function Transcript({ r }: { r: RunRecord }): JSX.Element {
  const lines = transcriptOf(r);
  if (lines.length === 0) {
    return <p class="dnote">Only your newest runs keep their transcripts.</p>;
  }
  return (
    <details class={r.drill ? 'transcript transcript-untimed' : 'transcript'}>
      <summary>Transcript, {lines.length} {lines.length === 1 ? 'line' : 'lines'}</summary>
      <ol class="tlines">
        {lines.map((l, i) => (
          <li key={i}>
            {!r.drill && <span class="tl-time tn">{l.atMs === null ? 'Call' : formatMmSs(l.atMs)}</span>}
            <span class="tl-line"><span class="tl-who">{l.who}</span><span class="vh">: </span><span class="tl-text">{l.text}</span></span>
          </li>
        ))}
      </ol>
    </details>
  );
}
