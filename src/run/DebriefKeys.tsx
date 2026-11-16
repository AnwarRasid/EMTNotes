// The debrief's key bar (mockup .as-keys2): what to do after the run. Split from Debrief.tsx, which lays the debrief out.
import type { JSX } from 'preact';
import { useId, useMemo } from 'preact/hooks';
import type { Case, Step } from '../data/schema';
import { useStore } from '../progress/hooks';
import type { RunRecord } from '../progress/types';
import { ReplacesNote } from '../quiz/QuizTab';
import { chainOf } from '../sim/debrief';
import { drillTargets } from '../sim/drill';
import { envFor } from '../sim/run';
import { Primary, Secondary } from '../ui/Keys';
import { beginDrill } from './start';
import { useOpenRun } from './useRun';

const NBSP = '\u00a0';

/**
 * - Faults left to drill: New case, and Drill the fixes, which drills the first step at fault and chains the rest, from
 *   this run.
 * - Nothing to drill (clean, or its steps or its case gone from this phone): a lone New case.
 * - A drill: Back to Today, and the chain's next drill (else New case), which keeps naming the run the chain came from.
 * With a run open, a key that starts a drill notes that it replaces it.
 */
export function DebriefKeys({ r, steps, c }: { r: RunRecord; steps: Step[]; c: Case | null }): JSX.Element {
  const store = useStore();
  const noteId = `${useId()}-replace`;
  const replaces = useOpenRun().status === 'open';
  const env = useMemo(() => (c === null ? null : envFor(steps, c)), [steps, c]);

  let other: JSX.Element | null = null;
  let drill: { label: string; start(): void } | null = null;
  if (r.drill) {
    other = <Secondary href="#/">Back to Today</Secondary>;
    const chain = chainOf(r, steps);
    const next = steps.find((s) => s.id === chain[0]);
    if (env !== null && next !== undefined) {
      // "step 6" stays together where the label wraps in its key
      drill = { label: `Next drill: step${NBSP}${next.order}, ${next.name}`,
        start: () => beginDrill(store, env, next.id, chain.slice(1), r.sourceRunId ?? r.id) };
    }
  } else {
    const targets = drillTargets(r, steps);
    const first = targets[0];
    if (env !== null && first !== undefined) {
      other = <Secondary href="#/pam/start">New case</Secondary>;
      drill = { label: 'Drill the fixes', start: () => beginDrill(store, env, first, targets.slice(1), r.id) };
    }
  }
  return (
    <div class={other === null ? 'qkeys qkeys-one' : 'qkeys'}>
      {other}
      {drill === null ? <Primary href="#/pam/start">New case</Primary>
        : <Primary onClick={drill.start} describedBy={replaces ? noteId : undefined}>{drill.label}</Primary>}
      {drill !== null && replaces && <ReplacesNote id={noteId} what="run" class="setup-note" />}
    </div>
  );
}
