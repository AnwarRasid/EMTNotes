// The step bar (Coached and drills; spec §6.2, mockup screen 2): a segment per step, done green, flagged lavender with
// "!", missed magenta with "!!!", the run's step outlined. Its name says the whole bar in words, and each segment says
// its own step for a screen reader moving through the list. In a drill, the steps outside its range are dimmed and
// never counted as to go: the drill fills in the ones before it and never reaches the ones after.
import type { JSX } from 'preact';
import { rangeText, type StepState } from '../sim/run';

/** A drill's steps, first and last: drill.from and drill.to. */
export type StepRange = readonly [number, number];

const CLASS: Record<StepState, string | undefined> = { done: 's-done', flagged: 's-flagged', missed: 's-missed', now: 's-now', todo: undefined };
/** Status is never colour alone: a flagged or missed segment carries a mark, as the status chips do. */
const MARK: Partial<Record<StepState, string>> = { flagged: '!', missed: '!!!' };
const WORD: Record<StepState, string> = { done: 'done', flagged: 'flagged', missed: 'missed', now: 'current', todo: 'to do' };

const outside = (order: number, range: StepRange | null | undefined): boolean =>
  range !== null && range !== undefined && (order < range[0] || order > range[1]);

/** 'Steps: 1 to 5 and 7 to 9 done, step 6 flagged, step 10 current, 9 to go'; 'Steps: step 1 current, 18 to go'.
 *  Missed steps follow the flagged ones; a group with no steps is left out. With a drill's `range`, only its steps
 *  count as to go: 'Steps: 1 to 10 done, step 11 current, 2 to go' for a drill on 11 to 13. */
export function stepBarLabel(states: { order: number; state: StepState }[], range?: StepRange | null): string {
  const orders = (state: StepState): number[] => states.filter((x) => x.state === state).map((x) => x.order);
  const steps = (xs: number[]): string => `${xs.length === 1 ? 'step' : 'steps'} ${rangeText(xs)}`;
  const done = orders('done');
  const flagged = orders('flagged');
  const missed = orders('missed');
  const now = orders('now');
  const left = orders('todo').filter((order) => !outside(order, range)).length;
  const parts = [
    done.length > 0 ? `${rangeText(done)} done` : null,
    flagged.length > 0 ? `${steps(flagged)} flagged` : null,
    missed.length > 0 ? `${steps(missed)} missed` : null,
    now.length > 0 ? `${steps(now)} current` : null,
    left > 0 ? `${left} to go` : null,
  ];
  return `Steps: ${parts.filter((p) => p !== null).join(', ')}`;
}

export function StepBar({ states, range }: { states: { order: number; name: string; state: StepState }[]; range?: StepRange | null }):
  JSX.Element {
  return (
    <ol class="stepbar" aria-label={stepBarLabel(states, range)}>
      {states.map((s) => {
        const out = outside(s.order, range);
        const cls = [CLASS[s.state], out ? 's-out' : undefined].filter((c) => c !== undefined).join(' ');
        return (
          <li key={s.order} class={cls === '' ? undefined : cls}>
            {MARK[s.state] !== undefined && <span aria-hidden="true">{MARK[s.state]}</span>}
            <span class="vh">{s.order} {s.name}: {out && s.state === 'todo' ? 'not in this drill' : WORD[s.state]}</span>
          </li>
        );
      })}
    </ol>
  );
}
