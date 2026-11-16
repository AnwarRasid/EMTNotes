// The time now, for a screen that shows a running clock: the run header (Task 13) re-renders on each tick while the
// run clock runs, and the rest of the run screen doesn't.
import { useEffect, useState } from 'preact/hooks';

/**
 * Date.now(), taken again every `intervalMs` while `active`, re-rendering each time. It is taken at once when `active`
 * turns on, so a clock that has just started or resumed never shows a time from before. While inactive it holds the
 * last time taken.
 *
 * With an `anchor` (epoch ms), the ticks fall on anchor + k × intervalMs: a clock whose elapsed time is now − anchor
 * then changes its digits on the tick itself, every second, never stalling on one second and skipping the next as a
 * tick that drifts across the boundary would (Task 13 review, Minor 5). Without one, they keep the phase `active`
 * turned on at. Each tick is its own timeout, aimed afresh at the next whole interval, so a late tick never pushes the
 * rest late, and a phone clock set back simply re-aims.
 */
export function useNow(intervalMs: number, active: boolean, anchor?: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const phase = anchor !== undefined && Number.isFinite(anchor) ? anchor : Date.now();
    let id: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      const into = (((t - phase) % intervalMs) + intervalMs) % intervalMs;
      id = setTimeout(tick, intervalMs - into);
    };
    tick();
    return () => clearTimeout(id);
  }, [intervalMs, active, anchor]);
  return now;
}
