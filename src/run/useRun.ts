// The content every run screen needs (the steps and the cases, loaded together) and the open run read against it. Run
// start, the run screen (Task 13), the debrief (Task 17) and Today (Task 18) read runs through these.
import { useEffect, useMemo } from 'preact/hooks';
import { useContent } from '../data/load';
import type { Case, Step } from '../data/schema';
import { useProgress, useStore } from '../progress/hooks';
import type { ProgressStore } from '../progress/store';
import type { RunSession } from '../progress/types';
import { envFor, type RunEnv } from '../sim/run';
import type { SmartUsage } from '../sim/smart';
import { graderFor } from '../smart/claude';
import { useSmartSettings, withSpend, type SmartModelId } from '../smart/settings';
import { toast } from '../ui/toast';

export const GONE_CASE = "A run in progress was closed: its case isn't on this phone any more.";
/** The smart tester's one toast a run, the first time a check fails (D14): an error, no answer in 6 s, a refusal or an
 *  answer that is no verdict. Offline and at the cap it says nothing. */
export const SMART_FAILED = "The smart tester didn't answer, so the keyword rules graded that line.";

/** The open runs whose smart tester failure has been toasted, per run: by the progress store that holds the run, then
 *  its session id. Once a run, however many screens build its grader and however often (a model changed mid-run builds
 *  a new one). A run's record goes as it ends (forgetSmartFailure, from finishRun), so a later run can toast its own,
 *  and a store's records go with the store (review M7). */
const failureTold = new WeakMap<ProgressStore, Set<string>>();
const toldOnce = (store: ProgressStore, sessionId: string) => () => {
  const told = failureTold.get(store) ?? new Set<string>();
  failureTold.set(store, told);
  if (told.has(sessionId)) return;
  told.add(sessionId);
  toast(SMART_FAILED);
};

/** Drops run `sessionId`'s record of a smart tester failure told: its run has ended. */
export function forgetSmartFailure(store: ProgressStore, sessionId: string): void {
  failureTold.get(store)?.delete(sessionId);
}

export type RunContent =
  | { status: 'loading' }
  | { status: 'error'; key: 'steps' | 'cases'; retry(): void }
  | { status: 'ready'; steps: Step[]; cases: Case[] };

export type OpenRunState = RunContent | { status: 'none' } | { status: 'open'; session: RunSession; env: RunEnv };

// Shared objects, so a state that hasn't changed keeps its identity from render to render.
const LOADING = { status: 'loading' } as const;
const NONE = { status: 'none' } as const;

/**
 * The steps and the cases: loading until both are ready. A failure names the first that failed (the steps before the
 * cases) for its copy, and `retry()` loads every one that failed again, so one Try again covers both when offline.
 */
export function useRunContent(): RunContent {
  const steps = useContent('steps');
  const cases = useContent('cases');
  return useMemo((): RunContent => {
    if (steps.status === 'error' || cases.status === 'error') {
      const retry = () => {
        if (steps.status === 'error') steps.retry();
        if (cases.status === 'error') cases.retry();
      };
      return { status: 'error', key: steps.status === 'error' ? 'steps' : 'cases', retry };
    }
    if (steps.status === 'ready' && cases.status === 'ready') return { status: 'ready', steps: steps.data.steps, cases: cases.data };
    return LOADING;
  }, [steps, cases]);
}

/**
 * The open run with its environment once the content is ready, 'none' when there is none, or the content's own
 * loading or error state. A run whose case is no longer in the cases (a later build dropped it) can't be played or
 * resumed: it is cleared with a GONE_CASE toast, through the store's update like any other change, so the save stays
 * whole. It reads as 'none' from the first render, and is cleared once, however many screens read it.
 *
 * The run's grader (Plan 3 Task 9) is graderFor's: the keyword grader, or the smart tester when it is on with a key.
 * A new run, or a change to the switch, the key or the model, builds a fresh one, so each run's cache and cap start
 * fresh. Each billed check's spend is saved to the smart settings (withSpend), never to progress (D16); the run's first
 * failed check toasts SMART_FAILED.
 */
export function useOpenRun(): OpenRunState {
  const store = useStore();
  const content = useRunContent();
  const session = useProgress((p) => p.runOpen);
  const [smart, updateSmart] = useSmartSettings();
  const ready = content.status === 'ready' ? content : null;
  const caseId = session?.caseId ?? null;
  const sessionId = session?.id ?? null;
  const found = useMemo(() => (ready && caseId !== null ? ready.cases.find((c) => c.id === caseId) ?? null : null),
    [ready?.cases, caseId]);
  const env = useMemo(() => {
    if (!ready || !found || sessionId === null) return null;
    // a spend storage refuses goes uncounted: the check has happened, and nothing else depends on the count
    const spend = (u: SmartUsage, model: SmartModelId) => { updateSmart((s) => withSpend(s, u, model)); };
    return envFor(ready.steps, found, graderFor(smart, spend, toldOnce(store, sessionId)));
  }, [ready?.steps, found, sessionId, smart.on, smart.key, smart.model, store]);
  const goneId = ready !== null && session !== null && found === null ? session.id : null;

  useEffect(() => {
    if (goneId === null) return;
    // Another reader of the same run may have cleared it already, in an effect that ran before this one.
    if (store.get().runOpen?.id !== goneId) return;
    store.update((p) => (p.runOpen?.id === goneId ? { ...p, runOpen: null } : p));
    toast(GONE_CASE);
  }, [goneId, store]);

  return useMemo((): OpenRunState => {
    if (content.status !== 'ready') return content;
    return session !== null && env !== null ? { status: 'open', session, env } : NONE;
  }, [content, session, env]);
}
