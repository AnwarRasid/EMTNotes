// The PAM tab's run history (spec §6.1 "Run history as strip thumbnails; each opens its debrief", Plan 3 rulings D10
// and D11): every record on this phone, drills too, newest first, 10 at a time. Each row is one link to its debrief,
// whose own text says the case and mode, when and the time used, and the verdict; a full run's row adds its half-size
// strip, hidden from screen readers since the text already says it. No runs yet before the first record.
import type { JSX } from 'preact';
import { useId, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Case, Step } from '../data/schema';
import { contentErrorCopy } from '../data/load';
import { useProgress } from '../progress/hooks';
import { RUN_LIMITS, activeFaults, type RunRecord } from '../progress/types';
import { useRunContent } from '../run/useRun';
import { LIMITS, formatMmSs } from '../sim/clock';
import { caseLine, figuresOf, todayTraceOf, verdict } from '../sim/debrief';
import { formatRunAt } from '../today/LastRunPanel';
import { NoRunsPanel } from '../today/NoRunsPanel';
import { Secondary } from '../ui/Keys';
import { Panel } from '../ui/Panel';
import { MiniStrip } from '../ui/RunStrip';
import { Skeleton, useDelayedFlag } from '../ui/Skeleton';

/** The rows shown at first, and how many more each Show 10 more adds. */
export const HISTORY_PAGE = 10;

const TITLE = 'Run history';
const FOOT = `EMTNotes keeps your last ${RUN_LIMITS.runsKept} runs on this phone.`;

/** A start time to sort by; one that can't be read sorts as the oldest. */
const startOf = (r: RunRecord): number => {
  const t = Date.parse(r.startedAt);
  return Number.isNaN(t) ? -Infinity : t;
};

/** Every record, drills too, the newest started first (up to the runsKept the save holds). Of two started at once, the
 *  later saved comes first, as the runs are saved oldest first. */
export function historyRows(runs: RunRecord[]): RunRecord[] {
  return runs.map((r, i) => ({ r, i, t: startOf(r) }))
    .sort((a, b) => (a.t > b.t ? -1 : a.t < b.t ? 1 : b.i - a.i))
    .slice(0, RUN_LIMITS.runsKept)
    .map(({ r }) => r);
}

/** historyMeta's two halves: when the run started, and its time against the limit, or untimed. */
function metaParts(r: RunRecord, steps: Step[], now: Date): [string, string] {
  const at = formatRunAt(r.startedAt, now);
  return [at, r.drill ? 'untimed' : `${figuresOf(r, steps).time} of ${formatMmSs(LIMITS.limitMs)}`];
}

/** 'Today, 22:10 · 17:42 of 20:00', its time being the debrief's own Time figure, so '— of 20:00' for a run whose clock
 *  never started; a drill, which has no clock, 'Today, 22:10 · untimed'. */
export function historyMeta(r: RunRecord, steps: Step[], now: Date): string {
  return metaParts(r, steps, now).join(' · ');
}

/** The loading skeleton's height, as the panel measured at phone width (390px): its head and foot 6.5rem, a row 7.75rem
 *  (a full run's row is 7.9rem, a drill's 5.4 to 6.75), and 3.375rem more for Show 10 more. */
function skeletonHeight(n: number, more: boolean): string {
  return `${6.5 + n * 7.75 + (more ? 3.375 : 0)}rem`;
}

export function RunHistory(): JSX.Element | null {
  const content = useRunContent();
  const late = useDelayedFlag(content.status === 'loading');
  const runs = useProgress((p) => p.runs);
  const runOpen = useProgress((p) => p.runOpen !== null);
  const rows = useMemo(() => historyRows(runs), [runs]);
  if (rows.length === 0) return <NoRunsPanel title={TITLE} />;
  if (content.status === 'loading') {
    return late ? <Skeleton rows={1} rowHeight={skeletonHeight(Math.min(rows.length, HISTORY_PAGE), rows.length > HISTORY_PAGE)} /> : null;
  }
  // Without the cases every row would read "A removed case.", so none shows. An open run's row says why with its own
  // Try again, so the panel doesn't say it twice.
  if (content.status === 'error') {
    return (
      <Panel class="hist-panel">
        <h2 class="plabel">{TITLE}</h2>
        {!runOpen && <>
          <p class="load-error-msg" role="alert">{contentErrorCopy(content.key)}</p>
          <div class="keys"><Secondary onClick={content.retry}>Try again</Secondary></div>
        </>}
      </Panel>
    );
  }
  return <HistoryList rows={rows} steps={content.steps} cases={content.cases} />;
}

function HistoryList({ rows, steps, cases }: { rows: RunRecord[]; steps: Step[]; cases: Case[] }): JSX.Element {
  const [shown, setShown] = useState(HISTORY_PAGE);
  const headId = `hist-${useId()}`;
  const list = useRef<HTMLOListElement>(null);
  // Show 10 more moves focus to the first row it shows, so the next press of Tab or swipe goes on from there.
  const focusRow = useRef<number | null>(null);
  useLayoutEffect(() => {
    const i = focusRow.current;
    focusRow.current = null;
    if (i !== null) list.current?.children[i]?.querySelector<HTMLElement>('a')?.focus();
  });
  const byId = useMemo(() => new Map(cases.map((c) => [c.id, c])), [cases]);
  const now = new Date();
  const more = rows.length > shown;
  const showMore = () => {
    focusRow.current = shown;
    setShown((n) => n + HISTORY_PAGE);
  };
  return (
    <Panel class="hist-panel">
      <h2 class="plabel" id={headId}>{TITLE}</h2>
      {/* role="list": Safari drops list semantics from a list with list-style none. */}
      <ol class="hist" role="list" aria-labelledby={headId} ref={list}>
        {rows.slice(0, shown).map((r) => (
          <li key={r.id}><HistoryRow r={r} c={byId.get(r.caseId) ?? null} steps={steps} now={now} /></li>
        ))}
      </ol>
      {more && <div class="keys"><Secondary onClick={showMore}>{`Show ${HISTORY_PAGE} more`}</Secondary></div>}
      <p class="hist-foot">{FOOT}</p>
    </Panel>
  );
}

/** A row's name, as one link says it: "Breathlessness, Ang Mo Kio. Coached. Today, 22:10 · 17:42 of 20:00. 3 to fix".
 *  Every word the row shows, in order, with a full stop between the time and the verdict. */
export function historyRowName(r: RunRecord, c: Case | null, steps: Step[], now: Date): string {
  return `${caseLine(r, c)} ${historyMeta(r, steps, now)}. ${verdict(activeFaults(r).length)}`;
}

/** A row: one link named by historyRowName, built once as its aria-label (Task 12 review M1: a visually hidden stop in
 *  the text is out of flow, so Chromium named it with a space before it, "20:00 . 3 to fix"), then a full run's strip.
 *  The meta's halves each stay whole, so a narrow row breaks it at the dot. */
function HistoryRow({ r, c, steps, now }: { r: RunRecord; c: Case | null; steps: Step[]; now: Date }): JSX.Element {
  const [when, time] = metaParts(r, steps, now);
  return (
    <a class="hist-row" href={`#/debrief/${encodeURIComponent(r.id)}`} aria-label={historyRowName(r, c, steps, now)}>
      <span class="hist-text">
        <span class="hist-case">{caseLine(r, c)}</span>{' '}
        <span class="hist-meta tn"><span>{`${when} ·`}</span> <span>{time}</span></span>{' '}
        <span class="hist-verdict">{verdict(activeFaults(r).length)}</span>
      </span>
      {!r.drill && <MiniStrip trace={todayTraceOf(r, steps, null)} />}
    </a>
  );
}
