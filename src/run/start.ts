// Starting a run or a drill: the complaints Run start offers, the case it picks, a new run's ids, and opening the
// session. Run start (Task 12), Pause's Restart (Task 15) and the debrief's drills (Task 17) start runs through these.
import type { Case } from '../data/schema';
import { navigate } from '../app/routes';
import { randomSeed, type Rng } from '../lib/rng';
import type { ProgressStore } from '../progress/store';
import type { RunMode, RunSession } from '../progress/types';
import { startDrill } from '../sim/drill';
import { startRun, type RunEnv } from '../sim/run';
import { replaceOpenRun } from '../today/discard';

/** Each complaint the cases have, once, in index order: Run start's chips. */
export function complaintsOf(cases: Case[]): string[] {
  return [...new Set(cases.map((c) => c.complaint))];
}

/** A case drawn by `rng`: from every case with no complaint, else from that complaint's. Null only when none match. */
export function pickCase(cases: Case[], complaint: string | null, rng: Rng): Case | null {
  const pool = complaint === null ? cases : cases.filter((c) => c.complaint === complaint);
  return pool[Math.floor(rng() * pool.length)] ?? null;
}

/** A new run's id, 'run-' + its start in base-36 ms + '-' + 4 random base-36 characters (two runs started in the same
 *  millisecond still differ), and its start time. */
export function newRunIds(now: Date = new Date()): { id: string; startedAt: string } {
  const tail = (randomSeed() % 36 ** 4).toString(36).padStart(4, '0');
  return { id: `run-${now.getTime().toString(36)}-${tail}`, startedAt: now.toISOString() };
}

/** What starting a run does to one already open: `undo` false (Pause's Restart, confirmed already) offers no Undo. */
export interface BeginOptions { undo?: boolean }

/** Saves `session` as the open run, replacing any (with an Undo unless `opts.undo` is false: replaceOpenRun), and
 *  opens it in place of the screen that started it, so Back from the run skips that screen. */
function open(store: ProgressStore, session: RunSession, opts?: BeginOptions): void {
  replaceOpenRun(store, session, opts);
  navigate('/run', { replace: true });
}

/** Opens a new run on env's case in `mode`. */
export function beginRun(store: ProgressStore, env: RunEnv, mode: RunMode, opts?: BeginOptions): void {
  const now = new Date();
  open(store, startRun(env, mode, newRunIds(now), now.getTime()), opts);
}

/** Opens a drill on step `target` (a step id of env.steps: startDrill throws on any other), with the targets still to
 *  drill after it and the run it came from (none from Run start). */
export function beginDrill(store: ProgressStore, env: RunEnv, target: string, chain: string[], sourceRunId: string | null,
  opts?: BeginOptions): void {
  const now = new Date();
  open(store, startDrill(env, target, chain, sourceRunId, newRunIds(now), now.getTime()), opts);
}
