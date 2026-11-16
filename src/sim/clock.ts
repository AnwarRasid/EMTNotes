// The run clock (spec §6.2): the time used is what's banked plus the span since the clock last started running, both
// from stored epoch ms, so it survives reloads. Pause, recovery after a dead page, the time-limit line under the clock,
// and the limit announcements.
// The clock is saved after every line, and a save with a non-finite number is refused, so every clock returned here
// keeps bankedMs and runningSince finite and never negative, even when the phone's clock moves back.
// Pure: no window, document or preact.
import type { RunClock } from '../progress/types';

export const LIMITS = { rbsMs: 180_000, fiveLeftMs: 900_000, warnMs: 1_080_000, limitMs: 1_200_000 } as const;
const MINUTE = 60_000;

/** A clock that hasn't started: what a run holds until Approach. Every new run shares it, so it is frozen. */
export const NEW_CLOCK: RunClock = Object.freeze({ started: false, bankedMs: 0, runningSince: null });

/** `x` when it is finite and above 0, else 0: a span or a total never runs negative, NaN or infinite. */
const nonNeg = (x: number): number => (Number.isFinite(x) && x > 0 ? x : 0);
/** `now` as a time to run from, or null when it can't be one (not finite, or before the epoch). */
const stamp = (now: number): number | null => (Number.isFinite(now) && now >= 0 ? now : null);

/** The run time used by `now`: what's banked, plus the span since the clock last ran. That span counts as 0 when `now`
 *  is before it (the phone's clock moved back). 0 for a clock that hasn't started. */
export function elapsedMs(c: RunClock, now: number): number {
  if (!c.started) return 0;
  const running = c.runningSince === null ? 0 : nonNeg(now - c.runningSince);
  return nonNeg(nonNeg(c.bankedMs) + running);
}

/** The clock started at Approach: running from `now`, nothing banked. A clock already started comes back as it is, so
 *  a second call never wipes the time. A `now` that can't be a time leaves it started but paused. */
export function startClock(c: RunClock, now: number): RunClock {
  return c.started ? c : { started: true, bankedMs: 0, runningSince: stamp(now) };
}

/** The clock stopped at `now`, with its time banked. A clock that isn't running comes back as it is. */
export function pauseClock(c: RunClock, now: number): RunClock {
  return c.started && c.runningSince !== null ? { started: true, bankedMs: elapsedMs(c, now), runningSince: null } : c;
}

/** The clock running again from `now`. A no-op unless it has started and is paused (or `now` can't be a time). */
export function resumeClock(c: RunClock, now: number): RunClock {
  const since = stamp(now);
  return c.started && c.runningSince === null && since !== null ? { started: true, bankedMs: nonNeg(c.bankedMs), runningSince: since } : c;
}

/** A clock a dead page left running (it never saved a pause): banked up to `lastAt`, the session's last saved change,
 *  and paused, so the time the page was dead never counts. A `lastAt` before it last ran banks nothing more. A clock
 *  that isn't running comes back as it is. */
export function recoverClock(c: RunClock, lastAt: number): RunClock {
  return pauseClock(c, lastAt);
}

const pad2 = (n: number): string => String(n).padStart(2, '0');
/** Whole minutes and the whole seconds left over (rounded down); negative or non-finite ms read as 0. */
const minSec = (ms: number): [number, number] => {
  const s = Math.floor(nonNeg(ms) / 1000);
  return [Math.floor(s / 60), s % 60];
};

/** '06:12', '21:30'. */
export function formatMmSs(ms: number): string {
  const [m, s] = minSec(ms);
  return `${pad2(m)}:${pad2(s)}`;
}

/** '2:41'. */
export function formatShort(ms: number): string {
  const [m, s] = minSec(ms);
  return `${m}:${pad2(s)}`;
}

/** The clock's digits: formatMmSs below 20:00; from 20:00, '+m:ss' of the overrun ('+0:00' at 20:00 exactly). */
export function formatClock(ms: number): string {
  return ms >= LIMITS.limitMs ? `+${formatShort(ms - LIMITS.limitMs)}` : formatMmSs(ms);
}

/** An RBS time as the run shows it, 'm:ss'. Its seconds round down, except for a late RBS (after 3:00), whose seconds
 *  round up, so a late RBS never reads '3:00' without its ✓ (3:00.4 → '3:01'). The clock line, Task 10's "RBS done at
 *  {m:ss}." and the debrief all show RBS times through this, so they always agree. */
export function rbsShown(rbsMs: number): string {
  return formatShort(rbsMs > LIMITS.rbsMs ? Math.ceil(rbsMs / 1000) * 1000 : rbsMs);
}

export interface ClockView { time: string; line: string; tone: 'plain' | 'done' | 'warn'; warnDigits: boolean }

const view = (time: string, line: string, tone: ClockView['tone'] = 'plain', warnDigits = false): ClockView =>
  ({ time, line, tone, warnDigits });
/** RBS done by 3:00, 3:00 itself included: the clock line's ✓, and the debrief's (Task 17). */
export const rbsInTime = (rbsMs: number | null): boolean => rbsMs !== null && rbsMs <= LIMITS.rbsMs;

/** The clock's digits and the time-limit line under them. Every limit holds from its exact time, as `crossings` counts it:
 *  - a drill: 'Drill', 'Untimed';
 *  - before Approach: '--:--', 'Starts at Approach';
 *  - under 15:00: 'RBS by 3:00'; 'RBS 2:41 ✓' (done) for RBS by 3:00; 'RBS limit passed' (warn) from 3:00 with no
 *    RBS; 'RBS 3:20' (warn) for RBS after 3:00;
 *  - from 15:00: '{n} min left', n the minutes left rounded up, in warn with warn digits from 18:00;
 *  - from 20:00: '+m:ss' of the overrun, 'Past 20:00', warn with warn digits. */
export function clockView(c: RunClock, rbsMs: number | null, now: number, drill: boolean): ClockView {
  if (drill) return view('Drill', 'Untimed');
  if (!c.started) return view('--:--', 'Starts at Approach');
  const ms = elapsedMs(c, now);
  const time = formatClock(ms);
  if (ms >= LIMITS.limitMs) return view(time, 'Past 20:00', 'warn', true);
  if (ms >= LIMITS.fiveLeftMs) {
    const warn = ms >= LIMITS.warnMs;
    return view(time, `${Math.ceil((LIMITS.limitMs - ms) / MINUTE)} min left`, warn ? 'warn' : 'plain', warn);
  }
  if (rbsMs !== null) return rbsInTime(rbsMs) ? view(time, `RBS ${rbsShown(rbsMs)} ✓`, 'done') : view(time, `RBS ${rbsShown(rbsMs)}`, 'warn');
  return ms >= LIMITS.rbsMs ? view(time, 'RBS limit passed', 'warn') : view(time, 'RBS by 3:00');
}

/** The ETA in whole minutes: what's left of the 20, never under 1. */
export function etaMinutes(elapsed: number): number {
  return Math.max(1, LIMITS.limitMs / MINUTE - Math.floor(nonNeg(elapsed) / MINUTE));
}

/** The limits passed between two clock readings (prev < T ≤ now), in order, as the live region announces them. The RBS
 *  limit is skipped when RBS was done by 3:00. A clock that went back crosses nothing. */
export function crossings(prevMs: number, nowMs: number, rbsMs: number | null): string[] {
  const passed = (t: number): boolean => prevMs < t && t <= nowMs;
  const out: string[] = [];
  if (passed(LIMITS.rbsMs) && !rbsInTime(rbsMs)) out.push('RBS limit passed.');
  if (passed(LIMITS.fiveLeftMs)) out.push('5 minutes left.');
  if (passed(LIMITS.warnMs)) out.push('2 minutes left.');
  if (passed(LIMITS.limitMs)) out.push('20 minutes up. The run continues.');
  return out;
}
