// The run screen's send queue (spec §6.2, Review Focus 3): the trainee's typed lines and step-list taps (Task 15) are
// applied to the open run one at a time, in the order they were sent, however fast they come. Each applied input is one
// store update, and so one save. Haptics follow the Settings toggle, on Android only (src/lib/haptics.ts).
import { useMemo, useRef } from 'preact/hooks';
import { haptic } from '../lib/haptics';
import type { ProgressStore } from '../progress/store';
import type { RunSession } from '../progress/types';
import { keywordGrader } from '../sim/grader';
import { sendLine, tapStep, type RunEnv } from '../sim/run';

/** One input to the run: a line the trainee typed, or a step tapped in the step list (by its id). */
export type RunInput = { text: string } | { tap: string };
/** The run's send function, and `settle()` for the run's End (final review M3). */
export type SendQueue = ((input: RunInput) => Promise<boolean>) & {
  /** Whether any input is still waiting or being read. */
  busy(): boolean;
  /** Applies every input still waiting or being read, in order, with the keyword grader, to the open run now, so End
   *  never drops one: the queue's own reads of them are then dropped as they finish. */
  settle(): Promise<void>;
};
/** An input in the queue: `done` once it is applied (or given up), by its own turn or by settle. */
interface Entry { input: RunInput; sentAt: number; done: boolean }

/** How many times one input is read against a run that keeps changing under it before it is given up (Task 14 review:
 *  every read calls the grader, and Plan 3's is slow and on the network). */
const MAX_TRIES = 3;

interface QueueDeps { store: ProgressStore; env: RunEnv; sessionId: string; announce(s: string[]): void;
  onPending?(texts: string[]): void }

/**
 * The run's send function. Every call buzzes 'tap' at once, then waits its turn: it reads the open run, applies the
 * input to it (sendLine or tapStep), and writes the result only if the run is still the one it read. If the run changed
 * meanwhile (a pause, a dispute, a tick), the same input is applied again to the run as it is now, so neither change is
 * lost. An input for a run that has ended, or been replaced by another, is dropped. A line that adds an inline flag
 * buzzes 'wrong', in Coached and drills only: in Exam that would give a fault away before the debrief. What the run
 * announces ("RBS done at 2:41.") goes to `announce`.
 *
 * The promise each call returns settles once its input is done with, and never rejects. It is false when the input
 * failed: the grader or the engine threw, or the run changed under it MAX_TRIES times. That is logged, the inputs after
 * it still run, and the caller tells the trainee (the composer gives a typed line back). It is true otherwise: applied,
 * nothing to add, or dropped with its run. A save the store refuses doesn't throw (the app's save-error toast says so),
 * and the run carries on in memory.
 *
 * `onPending` hears the typed lines still in the queue, in order, each time that changes: a line joins as it is sent
 * and leaves once it is done with, after its write (Plan 3 Task 9: the run screen shows them while a slow grader reads).
 *
 * Each input is timed when it is sent, not when its turn comes (Task 9 review M1): a line or tap waiting behind a slow
 * check (up to 6 s, D14) still has the run time it was said at, so an RBS finished at 2:57 is never recorded past 3:00.
 * A run changed after the input was sent (a pause, a tick's lines) times it at that change instead (the run's
 * `lastAt`), so no input is ever timed before the run's last change. The clock itself never waits on the queue.
 *
 * `settle()` is for the run's End (final review M3): every input still waiting or being read is applied at once, in
 * order, with the keyword grader (a smart check still out is not waited for), so the run ends with all of them. Each is
 * then done: its own turn, or its slow read as it finishes, leaves it. `busy()` says whether there is any to settle (or
 * a settle is under way).
 */
export function useSendQueue(store: ProgressStore, env: RunEnv, sessionId: string, announce: (s: string[]) => void,
  onPending?: (texts: string[]) => void): SendQueue {
  const deps = useRef<QueueDeps>({ store, env, sessionId, announce, onPending });
  deps.current = { store, env, sessionId, announce, onPending };
  const tail = useRef<Promise<unknown>>(Promise.resolve());
  const queued = useRef<Entry[]>([]);   // the inputs not yet done with, in order, each its own entry
  const settling = useRef<Promise<void> | null>(null);
  return useMemo(() => {
    const tell = () => deps.current.onPending?.(queued.current.flatMap((e) => ('text' in e.input ? [e.input.text] : [])));
    const send = (input: RunInput): Promise<boolean> => {
      const entry: Entry = { input, sentAt: Date.now(), done: false };
      haptic('tap', deps.current.store.get().settings.haptics);
      queued.current = [...queued.current, entry];
      if ('text' in input) tell();
      const job = tail.current.then(() => applyInput(deps.current, entry)).then((ok) => {
        queued.current = queued.current.filter((e) => e !== entry);
        if ('text' in input) tell();
        return ok;
      });
      tail.current = job;
      return job;
    };
    const busy = () => settling.current !== null || queued.current.some((e) => !e.done);
    const settle = (): Promise<void> => {
      settling.current ??= (async () => {
        const q: QueueDeps = { ...deps.current, env: { ...deps.current.env, grader: keywordGrader } };
        for (const entry of [...queued.current]) {
          if (entry.done) continue;
          entry.done = true;   // the queue's own read of it, when its turn comes or as it finishes, now leaves it
          await applyInput(q, { ...entry, done: false });
        }
      })().finally(() => { settling.current = null; });
      return settling.current;
    };
    return Object.assign(send, { busy, settle });
  }, []);
}

async function applyInput(q: QueueDeps, entry: Entry): Promise<boolean> {
  const { input, sentAt } = entry;
  try {
    for (let tries = 1; ; tries += 1) {
      if (entry.done) return true;   // settled already, for the run's End
      const s = q.store.get().runOpen;
      if (s === null || s.id !== q.sessionId) return true;   // its run has ended or been replaced: nothing to tell
      const now = Math.max(sentAt, s.lastAt);   // when it was sent, or the run's last change if that came after
      const applied = 'tap' in input ? tapStep(q.env, s, input.tap, now) : await sendLine(q.env, s, input.text, now);
      if (entry.done) return true;   // settled while it was read (End): this reading is dropped
      if (q.store.get().runOpen !== s) {   // the run changed while the line was read: read it again on the new one
        if (tries < MAX_TRIES) continue;
        console.warn(`A run input was given up: the run changed under it ${MAX_TRIES} times.`);
        entry.done = true;
        return false;
      }
      entry.done = true;
      if (applied.session === s) return true;   // nothing to add: a covered step, or the run at its line limit
      q.store.update((p) => ({ ...p, runOpen: applied.session }));
      if (s.mode === 'coached' && flagCount(applied.session) > flagCount(s)) haptic('wrong', q.store.get().settings.haptics);
      if (applied.announce.length > 0) q.announce(applied.announce);
      return true;
    }
  } catch (e) {
    entry.done = true;
    console.error('A run input failed:', e);
    return false;
  }
}

/** The inline flags on the run's lines. An Order flag can land on an earlier line, so the whole run is counted. */
function flagCount(s: RunSession): number {
  return s.lines.reduce((n, l) => n + (l.flags?.length ?? 0), 0);
}
