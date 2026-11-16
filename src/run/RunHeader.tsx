// The run screen's header (spec §6.2, mockup screen 2): Pause, the case's complaint over its location, and the run clock
// with its time-limit line. The limits the clock crosses while the screen is up, and the engine's announcements ("RBS
// done at 2:41."), are said in one polite live region. Only this header re-renders on the clock's 1 s tick.
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { RunClock } from '../progress/types';
import { clockView, crossings, elapsedMs } from '../sim/clock';
import { Icon } from '../ui/Icon';
import { useNow } from './useNow';

const TICK_MS = 1000;

export function RunHeader({ title, sub, clock, rbsMs, drill, announce, onPause }: { title: string; sub: string; clock: RunClock;
  rbsMs: number | null; drill: boolean; announce: string | null; onPause(): void }): JSX.Element {
  const running = !drill && clock.started && clock.runningSince !== null;
  // The epoch time the clock would read 00:00 at had it never paused, so each tick lands on the clock's whole second.
  const anchor = clock.runningSince === null ? undefined : clock.runningSince - clock.bankedMs;
  const now = useNow(TICK_MS, running, anchor);
  const view = clockView(clock, rbsMs, now, drill);
  const live = useLiveRegion(clock, rbsMs, now, drill, announce);
  return (
    <header class="runhead">
      <button type="button" class="ibtn" aria-label="Pause" onClick={() => onPause()}>
        <Icon name="pause" />
      </button>
      <div class="runhead-text">
        {/* lang="en": Chrome hyphenates with its English dictionary where the larger text size breaks the title
            (components.css); the page's en-SG may have none. */}
        <h1 class="title" lang="en">{title}</h1>
        <p class="addr">{sub}</p>
      </div>
      {/* The digits never animate (spec §9). */}
      <div class="clock tn" role="timer" aria-label="Run clock">
        <b class={view.warnDigits ? 'warn' : undefined}>{view.time}</b>
        <span class={`rbs ${view.tone}`}>{view.line}</span>
      </div>
      <p class="vh" aria-live="polite">{live}</p>
    </header>
  );
}

/**
 * What the live region says: the latest of the limits the clock has crossed ("RBS limit passed.") and the engine's
 * announcement. Each tick reads the limits crossed since the furthest time the clock has shown, so a phone clock set
 * back never says a limit twice (Task 7 carry); the time the screen opened at counts as shown, so a reload past a limit
 * says nothing. A drill is untimed and crosses nothing.
 */
function useLiveRegion(clock: RunClock, rbsMs: number | null, now: number, drill: boolean, announce: string | null): string {
  const [live, setLive] = useState('');
  const furthest = useRef<number | null>(null);
  useEffect(() => {
    const ms = elapsedMs(clock, now);
    const prev = furthest.current;
    furthest.current = prev === null ? ms : Math.max(prev, ms);
    if (prev === null || drill) return;
    const passed = crossings(prev, ms, rbsMs);
    if (passed.length > 0) setLive(passed.join(' '));
  }, [clock, rbsMs, now, drill]);
  useEffect(() => {
    if (announce !== null) setLive(announce);
  }, [announce]);
  return live;
}
