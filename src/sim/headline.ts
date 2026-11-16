// Today's headline (spec §6.1): the trainee's most frequent recent mistake, with a drill on its step, and the times of
// their last runs for Run start. Read from the saved run records only. Today (Task 18) and Run start (Task 12) show it.
// Pure: no window, document or preact.
import type { Step } from '../data/schema';
import { activeFaults, type Fault, type FaultKind, type RunRecord } from '../progress/types';
import { FAULT_RANK } from './classify';
import { formatMmSs } from './clock';
import { drillRange } from './drill';
import { capitalise, stop } from './replies';

/** The headline's point ('stepId/pointId'), its saved step order and label, its kind, and the `count` of the last
 *  `of` full runs (3 at most) that had it. */
export interface Headline { kind: FaultKind; point: string; step: number; count: number; of: number; label: string }

/** How each kind reads in the title: "Pocket check missed …", "… out of order …", "… missing its key words …". */
export const HEADLINE_VERB: Record<FaultKind, string> = {
  missed: 'missed', wrong: 'wrong', order: 'out of order', phrase: 'missing its key words',
};

const RECENT = 3;
// Within one FAULT_RANK, Missed before Wrong, as classify sorts them.
const KINDS: readonly FaultKind[] = ['missed', 'wrong', 'order', 'phrase'];
/** Negative when kind `a` goes first: the lower FAULT_RANK, then KINDS order. */
const byRank = (a: FaultKind, b: FaultKind): number => FAULT_RANK[a] - FAULT_RANK[b] || KINDS.indexOf(a) - KINDS.indexOf(b);

/** The runs that aren't drills, newest first. Progress.runs is oldest first (addRunRecord appends). */
const fullRuns = (runs: RunRecord[]): RunRecord[] => runs.filter(r => !r.drill).reverse();
/** Whether the run's clock ever started: the debrief's figures show "—" for one that didn't (usedMs 0, no step times).
 *  Today's first-run checklist ticks a run item only for one that did (final review M6). */
export const timed = (r: RunRecord): boolean => r.usedMs > 0 || Object.keys(r.stepTimes).length > 0;
/** The full runs whose clock started, newest first: what the headline and the last times read (ruling D9; Task 11 fix
 *  round 1 for the headline, so a run ended at once, all of it Missed, never turns "2 of 2" into "3 of 3"). */
const timedRuns = (runs: RunRecord[]): RunRecord[] => fullRuns(runs).filter(timed);

/** The kind seen most often, a tie going to the kind that ranks first. */
function mostFrequent(kinds: FaultKind[]): FaultKind {
  const count = (k: FaultKind) => kinds.filter(x => x === k).length;
  return [...new Set(kinds)].sort((a, b) => count(b) - count(a) || byRank(a, b))[0] ?? 'missed';
}

/** One point's tally over the recent runs: `newest` is the index (0 = newest) of the newest run that had it, whose
 *  fault gives the saved step and label; `kinds` holds each run's kind for it. */
interface Tally { point: string; newest: number; fault: Fault; kinds: FaultKind[] }

/**
 * The headline over the three newest full runs whose clock started (drills and runs ended before it started never
 * count):
 * 1. each point counts once per run, over the run's active faults (disputed ones never count), at that run's
 *    lowest-ranked kind for it (FAULT_RANK, then Missed before Wrong);
 * 2. the point counted most wins; on a tie, the one in the newest run, then the lower step, then the key;
 * 3. its kind is the one it had most often, a tie going to the higher rank; its step and label are the newest run's.
 * Null when those runs have no active fault.
 */
export function headline(runs: RunRecord[]): Headline | null {
  const recent = timedRuns(runs).slice(0, RECENT);
  const tallies = new Map<string, Tally>();
  recent.forEach((r, i) => {
    const own = new Map<string, Fault>();   // the run's fault for each point, at its lowest rank
    for (const f of activeFaults(r)) {
      const was = own.get(f.point);
      if (was === undefined || byRank(f.kind, was.kind) < 0) own.set(f.point, f);
    }
    for (const [point, f] of own) {
      const t = tallies.get(point);
      if (t === undefined) tallies.set(point, { point, newest: i, fault: f, kinds: [f.kind] });
      else t.kinds.push(f.kind);
    }
  });
  const best = [...tallies.values()].sort((a, b) => b.kinds.length - a.kinds.length || a.newest - b.newest
    || a.fault.step - b.fault.step || (a.point < b.point ? -1 : a.point > b.point ? 1 : 0))[0];
  if (best === undefined) return null;
  return { kind: mostFrequent(best.kinds), point: best.point, step: best.fault.step, count: best.kinds.length,
    of: recent.length, label: best.fault.label };
}

/**
 * The headline as Today shows it:
 * - title: "Pocket check missed in 2 of your last 3 runs"; "… in your last run" when `of` is 1; when every one of
 *   them had it, "… in both of your last 2 runs" and "… in all of your last 3 runs" (Task 11 fix round 1). The point's
 *   short label from `steps` (its saved label when the point has gone), with a capital first letter;
 * - sub: "{label}. Step {n}, {name}.", with no second stop after a label that ends one ("Step {n}." for a step that
 *   has gone);
 * - the drill key on the point's step ("Drill steps 11 to 13", drillRange), and the step's notes link (null once the
 *   step has gone).
 */
export function headlineCopy(h: Headline, steps: Step[]):
  { title: string; sub: string; drillLabel: string; drillHref: string; notesRef: string | null } {
  const [stepId = '', pointId] = h.point.split('/');
  const step = steps.find(s => s.id === stepId);
  const short = capitalise(step?.mustHit.find(m => m.id === pointId)?.short ?? h.label);
  const verb = HEADLINE_VERB[h.kind];
  const order = step?.order ?? h.step;
  const [a, b] = drillRange(order, Math.max(order, ...steps.map(s => s.order)));
  const runs = h.of === 1 ? 'your last run'
    : h.count === h.of ? `${h.of === 2 ? 'both' : 'all'} of your last ${h.of} runs`
    : `${h.count} of your last ${h.of} runs`;
  return {
    title: `${short} ${verb} in ${runs}`,
    sub: `${stop(h.label)} Step ${order}${step === undefined ? '' : `, ${step.name}`}.`,
    drillLabel: `Drill steps ${a} to ${b}`,
    drillHref: `#/pam/start?drill=${stepId}`,
    notesRef: step?.notesRef ?? null,
  };
}

/** The newest run that isn't a drill (Today's Last run), or null. */
export function latestFullRun(runs: RunRecord[]): RunRecord | null {
  return fullRuns(runs)[0] ?? null;
}

/** The time used by each of the newest `n` full runs, newest first, as mm:ss: Run start's "Your last 3: 17:42, …". A
 *  run whose clock never started has no time to show, so it is left out (ruling D9). */
export function lastRunTimes(runs: RunRecord[], n = RECENT): string[] {
  return timedRuns(runs).slice(0, n).map(r => formatMmSs(r.usedMs));
}
