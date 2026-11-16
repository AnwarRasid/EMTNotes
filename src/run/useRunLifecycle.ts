// The run screen's lifecycle (spec §6.2, Review Focus 1): the clock recovered and resumed when the screen opens, paused
// while the app is hidden and resumed when it comes back, a guard history entry so Android's back opens the Pause sheet
// instead of leaving the run, the screen wake lock, and the 1 s tick that writes the buddies' 5-minute reassessments.
// Also the run's two ways out of the screen's own state: ending it into the debrief, and the clock's pause and resume.
import { useEffect, useRef } from 'preact/hooks';
import { matchRoute, navigate } from '../app/routes';
import { useProgress } from '../progress/hooks';
import type { ProgressStore } from '../progress/store';
import { addRunRecord, type RunClock, type RunSession } from '../progress/types';
import { recoverClock } from '../sim/clock';
import { endRun, pauseRun, resumeRun, tickRun, type RunEnv } from '../sim/run';
import { clearDrafts } from './Composer';
import { forgetSmartFailure } from './useRun';

/** The history.state key of the guard entry the run pushes on #/run. Its value is history.length as the guard made it,
 *  so a copy of it that routes.ts carries into a later entry (its stateWith keeps the rest of the state) no longer
 *  matches once that entry is pushed further along. */
export const RUN_GUARD_KEY = 'crewLeaderRunGuard';
const TICK_MS = 1000;

type Lock = { release(): void };

/** A screen wake lock (navigator.wakeLock.request('screen')), or null on any failure: no API (jsdom, older browsers),
 *  a refused request (a hidden page, a battery saver), or headless Chromium. Its release() never throws. */
export async function wakeLock(nav: Navigator | undefined = typeof navigator === 'undefined' ? undefined : navigator):
  Promise<Lock | null> {
  try {
    const api: WakeLock | undefined = nav?.wakeLock;
    if (api === undefined || typeof api.request !== 'function') return null;
    const sentinel = await api.request('screen');
    return {
      release: () => {
        try {
          void Promise.resolve(sentinel.release()).catch(() => {});   // released already, or the page went
        } catch {
          // as above, thrown rather than rejected
        }
      },
    };
  } catch {
    return null;
  }
}

// ---- The open run's clock and its end ---------------------------------------------------------------------------

/** The open run changed by `fn` and saved, if it is still `sessionId`'s and `fn` changed it (the same object back means
 *  nothing to save). */
function changeRun(store: ProgressStore, sessionId: string, fn: (s: RunSession) => RunSession): void {
  store.update((p) => {
    const s = p.runOpen;
    if (s === null || s.id !== sessionId) return p;
    const next = fn(s);
    return next === s ? p : { ...p, runOpen: next };
  });
}

const isRunning = (c: RunClock): boolean => c.started && c.runningSince !== null;
const sameClock = (a: RunClock, b: RunClock): boolean =>
  a.started === b.started && a.bankedMs === b.bankedMs && a.runningSince === b.runningSince;

/** The run with its clock stopped at `now`; the same session when it isn't running, so there is nothing to save. */
const paused = (s: RunSession, now: number): RunSession => (isRunning(s.clock) ? pauseRun(s, now) : s);
/** The run with its clock running again from `now`; the same session when it hasn't started or already runs. */
const resumed = (s: RunSession, now: number): RunSession => (s.clock.started && !isRunning(s.clock) ? resumeRun(s, now) : s);

/** Stops the open run's clock and saves it, if it is `sessionId`'s and running. */
export function pauseOpenRun(store: ProgressStore, sessionId: string, now = Date.now()): void {
  changeRun(store, sessionId, (s) => paused(s, now));
}

/** Runs the open run's clock again and saves it, if it is `sessionId`'s and paused. */
export function resumeOpenRun(store: ProgressStore, sessionId: string, now = Date.now()): void {
  changeRun(store, sessionId, (s) => resumed(s, now));
}

/** Ends the open run at `now`: its record joins `runs` (addRunRecord keeps one per id), the run closes with its
 *  composer's draft (and any other run's left behind), and its debrief opens in the run's place, so Back never returns
 *  to a run that has ended. The debrief takes the guard's entry without its mark, so it, and whatever later replaces it
 *  (a drill, the PAM tab), is never taken for a run's guard. */
export function finishRun(store: ProgressStore, env: RunEnv, now: number): void {
  const s = store.get().runOpen;
  if (s === null) return;
  const record = endRun(env, s, now);
  store.update((p) => (p.runOpen !== null && p.runOpen.id === s.id ? { ...addRunRecord(p, record), runOpen: null } : p));
  clearDrafts();
  forgetSmartFailure(store, s.id);   // the run is over: its smart tester toast record goes with it
  if (RUN_GUARD_KEY in stateObject()) {
    const unmarked = { ...stateObject() };
    delete unmarked[RUN_GUARD_KEY];
    history.replaceState(unmarked, '');
  }
  navigate(`/debrief/${encodeURIComponent(record.id)}?fresh=1`, { replace: true });
}

// ---- The hook ---------------------------------------------------------------------------------------------------

function stateObject(): Record<string, unknown> {
  const s: unknown = history.state;
  return typeof s === 'object' && s !== null ? (s as Record<string, unknown>) : {};
}
/** Whether this history entry is the run's guard, at the top of history where the guard put it. */
const onGuard = (): boolean => stateObject()[RUN_GUARD_KEY] === history.length;
/** Pushes the guard entry: #/run again, on top of the run's own entry, so back pops to the run and not away. It is
 *  stamped after the push, from the length the push made: a push drops the entries ahead of it (the guard a Back has
 *  just popped is still counted until then), so a length read before it can be one too many (Task 15 review). */
function pushGuard(): void {
  if (onGuard()) return;
  history.pushState({ ...stateObject() }, '');
  history.replaceState({ ...stateObject(), [RUN_GUARD_KEY]: history.length }, '');
}

/**
 * The run screen's lifecycle, for the run `sessionId`, while the screen is mounted:
 * - On mount: the clock a dead page left running is recovered (recoverClock: banked up to the run's last save), then
 *   resumed from now unless the sheet is open or the page is hidden; one guard entry is pushed on #/run (none when
 *   this entry is already the guard, as after Restart or a reload); and the wake lock is requested.
 * - A popstate back onto #/run (Android's back, which popped the guard) calls `onBack()` and pushes the guard again.
 * - Hidden (visibilitychange, or pagehide): the clock pauses, saved, and the wake lock goes. Visible: the wake lock is
 *   requested again, and the clock resumes unless the sheet is open.
 * - While the clock runs: every 1 s, a tickRun result that adds lines is written, only over the run it was read from.
 * - On unmount: the clock pauses, then the wake lock goes.
 * Each change to the clock is saved only when it changes the clock, so two hide events save one pause.
 */
export function useRunLifecycle(p: { store: ProgressStore; env: RunEnv; sessionId: string; sheetOpen: boolean; onBack(): void }): void {
  const latest = useRef(p);
  latest.current = p;
  const { store, sessionId } = p;
  const running = useProgress((x) => x.runOpen !== null && x.runOpen.id === sessionId && isRunning(x.runOpen.clock));

  useEffect(() => {
    const visible = () => document.visibilityState !== 'hidden';
    changeRun(store, sessionId, (s) => {
      const clock = recoverClock(s.clock, s.lastAt);
      const recovered = clock === s.clock ? s : { ...s, clock };
      const next = latest.current.sheetOpen || !visible() ? recovered : resumed(recovered, Date.now());
      return sameClock(next.clock, s.clock) ? s : next;
    });

    // The wake lock: wanted while the screen is up and visible. A request that resolves once it is no longer wanted
    // (hidden or unmounted since) is let go at once.
    let lock: Lock | null = null;
    let asked = 0;
    const takeLock = () => {
      const mine = ++asked;
      void wakeLock().then((l) => {
        if (l === null) return;
        if (mine !== asked) { l.release(); return; }
        lock?.release();
        lock = l;
      });
    };
    const dropLock = () => {
      asked += 1;
      lock?.release();
      lock = null;
    };

    const onHidden = () => {
      pauseOpenRun(store, sessionId);
      dropLock();
    };
    const onVisibility = () => {
      if (!visible()) { onHidden(); return; }
      takeLock();
      if (!latest.current.sheetOpen) resumeOpenRun(store, sessionId);
    };
    const onPop = () => {
      if (matchRoute(location.hash).path !== '/run') return;   // the route itself changed: the router has it
      latest.current.onBack();
      pushGuard();
    };

    pushGuard();
    takeLock();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onHidden);
    window.addEventListener('popstate', onPop);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onHidden);
      window.removeEventListener('popstate', onPop);
      pauseOpenRun(store, sessionId);
      dropLock();
    };
  }, [store, sessionId]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const { env } = latest.current;
      const s = store.get().runOpen;
      if (s === null || s.id !== sessionId) return;
      let applied: ReturnType<typeof tickRun>;
      try {
        applied = tickRun(env, s, Date.now());
      } catch (e) {
        clearInterval(id);   // a run the engine can't tick won't tick next second either; say so once
        console.error('The run clock tick failed:', e);
        return;
      }
      if (applied === null) return;
      const next = applied.session;
      // The send queue's rule: write only over the run it was read from, never a stale one over a newer.
      store.update((x) => (x.runOpen === s ? { ...x, runOpen: next } : x));
    }, TICK_MS);
    return () => clearInterval(id);
  }, [running, store, sessionId]);
}
