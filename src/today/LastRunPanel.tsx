// The newest full run, on Today (mockup screen 1, .as-last): when it was, its case and mode, the time it used against
// the 20:00 limit with Open debrief, and its strip with the headline's point marked. The PAM tab shows the run history
// in its place (Plan 3 ruling D10), and its rows say when through formatRunAt.
import type { JSX } from 'preact';
import { useMemo } from 'preact/hooks';
import { formatSavedAt, formatTimeOfDay } from '../lib/format';
import { useProgress } from '../progress/hooks';
import { useRunContent } from '../run/useRun';
import { LIMITS, formatMmSs } from '../sim/clock';
import { caseLine, figuresOf, todayStripLabel, todayTraceOf } from '../sim/debrief';
import { headline, latestFullRun } from '../sim/headline';
import { TextLink } from '../ui/Keys';
import { Panel } from '../ui/Panel';
import { RunStrip } from '../ui/RunStrip';
import { Skeleton, useDelayedFlag } from '../ui/Skeleton';

/** Midnight at the start of `d`'s day, on the phone's clock. */
const dayStart = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const DAY_MS = 86_400_000;

/** "Today, 22:10", "Yesterday, 22:10", else formatSavedAt's "9 Nov, 22:10" (ruling D4): by the phone's calendar days,
 *  so 00:05 is today and 23:59 the night before is yesterday. Rounded, so a day of 23 or 25 hours still counts as one. */
export function formatRunAt(iso: string, now: Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return formatSavedAt(iso);
  const days = Math.round((dayStart(now) - dayStart(d)) / DAY_MS);
  if (days === 0) return `Today, ${formatTimeOfDay(d)}`;
  if (days === 1) return `Yesterday, ${formatTimeOfDay(d)}`;
  return formatSavedAt(iso);
}

/** The panel, once the steps and cases are in (sized skeleton while a slow load runs), or nothing with no full run on
 *  record. Its time is the debrief's own Time figure, so it reads "—" for a run whose clock never started. */
export function LastRunPanel({ title }: { title: string }): JSX.Element | null {
  const content = useRunContent();
  const late = useDelayedFlag(content.status === 'loading');
  const runs = useProgress((p) => p.runs);
  const r = useMemo(() => latestFullRun(runs), [runs]);
  const h = useMemo(() => headline(runs), [runs]);
  if (r === null) return null;
  if (content.status !== 'ready') return content.status === 'loading' && late ? <Skeleton rows={1} rowHeight="12.5rem" /> : null;
  const { steps, cases } = content;
  const c = cases.find((x) => x.id === r.caseId) ?? null;
  return (
    <Panel class="last">
      <div class="ph">
        <h2 class="plabel">{title}</h2>
        <span class="meta tn">{formatRunAt(r.startedAt, new Date())}</span>
      </div>
      <p class="last-line">{caseLine(r, c)}</p>
      <div class="big tn">
        <b>{figuresOf(r, steps).time}</b>
        <span>of {formatMmSs(LIMITS.limitMs)}</span>
        <TextLink href={`#/debrief/${encodeURIComponent(r.id)}`}>Open debrief</TextLink>
      </div>
      <RunStrip label={todayStripLabel(r, steps, h)} trace={todayTraceOf(r, steps, h)} />
    </Panel>
  );
}
