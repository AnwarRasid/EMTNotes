import type { RunClock } from '../../src/progress/types';
import { NEW_CLOCK, clockView, crossings, elapsedMs, etaMinutes, formatClock, formatMmSs, formatShort, pauseClock,
  rbsShown, recoverClock, resumeClock, startClock } from '../../src/sim/clock';

const C = (o: Partial<RunClock>): RunClock => ({ ...NEW_CLOCK, ...o });
test('elapsed counts only running time', () => {
  let c = startClock(NEW_CLOCK, 1_000);
  expect(elapsedMs(c, 61_000)).toBe(60_000);
  c = pauseClock(c, 61_000);
  expect(elapsedMs(c, 500_000)).toBe(60_000);
  c = resumeClock(c, 500_000);
  expect(elapsedMs(c, 510_000)).toBe(70_000);
  expect(resumeClock(c, 600_000)).toBe(c);
  expect(resumeClock(NEW_CLOCK, 5)).toBe(NEW_CLOCK);
  expect(elapsedMs(NEW_CLOCK, 9_999)).toBe(0);
});
test('a clock left running by a page that died banks time only up to its last saved change', () => {
  expect(recoverClock(C({ started: true, bankedMs: 30_000, runningSince: 100_000 }), 160_000))
    .toEqual({ started: true, bankedMs: 90_000, runningSince: null });
  expect(recoverClock(C({ started: true, bankedMs: 5, runningSince: 200 }), 100)).toEqual({ started: true, bankedMs: 5, runningSince: null });
  expect(recoverClock(NEW_CLOCK, 50)).toBe(NEW_CLOCK);
});
test('times format as the run shows them', () => {
  expect([formatMmSs(372_000), formatMmSs(1_290_000), formatShort(161_000)]).toEqual(['06:12', '21:30', '2:41']);
  expect([formatClock(1_062_000), formatClock(1_200_000), formatClock(1_242_000)]).toEqual(['17:42', '+0:00', '+0:42']);
});
test('the clock view follows spec §6.2', () => {
  const at = (ms: number, rbs: number | null = null) => clockView(C({ started: true, bankedMs: ms }), rbs, 0, false);
  expect(clockView(NEW_CLOCK, null, 0, false)).toEqual({ time: '--:--', line: 'Starts at Approach', tone: 'plain', warnDigits: false });
  expect(at(100_000)).toEqual({ time: '01:40', line: 'RBS by 3:00', tone: 'plain', warnDigits: false });
  expect(at(372_000, 161_000)).toEqual({ time: '06:12', line: 'RBS 2:41 ✓', tone: 'done', warnDigits: false });
  expect(at(200_000)).toEqual({ time: '03:20', line: 'RBS limit passed', tone: 'warn', warnDigits: false });
  expect(at(400_000, 200_000)).toEqual({ time: '06:40', line: 'RBS 3:20', tone: 'warn', warnDigits: false });
  expect(at(900_000, 161_000)).toEqual({ time: '15:00', line: '5 min left', tone: 'plain', warnDigits: false });
  expect(at(1_080_000, 161_000)).toEqual({ time: '18:00', line: '2 min left', tone: 'warn', warnDigits: true });
  expect(at(1_242_000, 161_000)).toEqual({ time: '+0:42', line: 'Past 20:00', tone: 'warn', warnDigits: true });
  expect(clockView(NEW_CLOCK, null, 0, true)).toEqual({ time: 'Drill', line: 'Untimed', tone: 'plain', warnDigits: false });
});
test('ETA is the time left of the 20 minutes, never under 1', () => {
  expect([0, 840_000, 870_000, 1_170_000, 1_300_000].map(etaMinutes)).toEqual([20, 6, 6, 1, 1]);
});
test('each limit is announced once, when it is crossed', () => {
  expect(crossings(170_000, 181_000, null)).toEqual(['RBS limit passed.']);
  expect(crossings(170_000, 181_000, 150_000)).toEqual([]);
  expect(crossings(899_000, 901_000, 1)).toEqual(['5 minutes left.']);
  expect(crossings(1_079_000, 1_081_000, 1)).toEqual(['2 minutes left.']);
  expect(crossings(1_199_000, 1_201_000, 1)).toEqual(['20 minutes up. The run continues.']);
  expect(crossings(0, 1_300_000, null)).toEqual(['RBS limit passed.', '5 minutes left.', '2 minutes left.', '20 minutes up. The run continues.']);
});

// ---- Boundaries: every limit holds from its exact time, as the crossings count it (prev < T ≤ now) ------------

test('each limit in the view holds from its exact time', () => {
  const at = (ms: number, rbs: number | null = null) => clockView(C({ started: true, bankedMs: ms }), rbs, 0, false);
  expect(at(179_999)).toEqual({ time: '02:59', line: 'RBS by 3:00', tone: 'plain', warnDigits: false });
  expect(at(180_000)).toEqual({ time: '03:00', line: 'RBS limit passed', tone: 'warn', warnDigits: false });
  expect(at(400_000, 180_000)).toEqual({ time: '06:40', line: 'RBS 3:00 ✓', tone: 'done', warnDigits: false });   // by 3:00 includes 3:00
  expect(at(400_000, 181_000)).toEqual({ time: '06:40', line: 'RBS 3:01', tone: 'warn', warnDigits: false });
  expect(at(400_000, 180_001)).toEqual({ time: '06:40', line: 'RBS 3:01', tone: 'warn', warnDigits: false });   // a late RBS
  expect(at(400_000, 180_400)).toEqual({ time: '06:40', line: 'RBS 3:01', tone: 'warn', warnDigits: false });   // never reads 3:00
  expect(at(899_999, 161_000)).toEqual({ time: '14:59', line: 'RBS 2:41 ✓', tone: 'done', warnDigits: false });
  expect(at(899_999)).toEqual({ time: '14:59', line: 'RBS limit passed', tone: 'warn', warnDigits: false });
  expect(at(900_000)).toEqual({ time: '15:00', line: '5 min left', tone: 'plain', warnDigits: false });   // with no RBS too
  expect(at(959_999).line).toBe('5 min left');
  expect(at(960_000).line).toBe('4 min left');
  expect(at(1_079_999)).toEqual({ time: '17:59', line: '3 min left', tone: 'plain', warnDigits: false });
  expect(at(1_199_999)).toEqual({ time: '19:59', line: '1 min left', tone: 'warn', warnDigits: true });
  expect(at(1_200_000)).toEqual({ time: '+0:00', line: 'Past 20:00', tone: 'warn', warnDigits: true });
  expect(clockView(C({ started: true, bankedMs: 500_000 }), 100_000, 0, true))
    .toEqual({ time: 'Drill', line: 'Untimed', tone: 'plain', warnDigits: false });
  expect([formatClock(1_199_999), formatMmSs(59_999), formatShort(600_000), formatShort(0)]).toEqual(['19:59', '00:59', '10:00', '0:00']);
  expect([59_999, 60_000, 1_140_000, 1_199_999, 1_200_000].map(etaMinutes)).toEqual([20, 19, 1, 1, 1]);
});
test('an RBS time rounds down when in time and up when late, so a late RBS never reads 3:00', () => {
  expect([161_000, 179_999, 180_000, 180_001, 180_400, 180_999, 181_000, 200_000, 200_001].map(rbsShown))
    .toEqual(['2:41', '2:59', '3:00', '3:01', '3:01', '3:01', '3:01', '3:20', '3:21']);
  expect([rbsShown(-1), rbsShown(NaN)]).toEqual(['0:00', '0:00']);
});
test('a crossing counts at its exact time, and never twice', () => {
  expect(crossings(179_999, 180_000, null)).toEqual(['RBS limit passed.']);
  expect(crossings(180_000, 181_000, null)).toEqual([]);
  expect(crossings(170_000, 181_000, 180_000)).toEqual([]);                     // RBS at 3:00 is in time
  expect(crossings(170_000, 190_000, 185_000)).toEqual(['RBS limit passed.']);  // a late RBS still passed the limit
  expect(crossings(899_999, 900_000, 1)).toEqual(['5 minutes left.']);
  expect(crossings(900_000, 1_079_999, 1)).toEqual([]);
  expect(crossings(1_079_999, 1_080_000, 1)).toEqual(['2 minutes left.']);
  expect(crossings(1_199_999, 1_200_000, 1)).toEqual(['20 minutes up. The run continues.']);
  expect(crossings(1_200_000, 1_300_000, 1)).toEqual([]);
  expect(crossings(500_000, 500_000, null)).toEqual([]);
});

// ---- Odd inputs: the clock is saved after every line, and a save with a non-finite number is refused ---------

test('a phone clock moved back never shows or banks negative time', () => {
  const running = C({ started: true, bankedMs: 30_000, runningSince: 100_000 });
  expect(elapsedMs(running, 40_000)).toBe(30_000);
  expect(pauseClock(running, 40_000)).toEqual({ started: true, bankedMs: 30_000, runningSince: null });
  expect(clockView(running, null, 40_000, false).time).toBe('00:30');
  expect(elapsedMs(startClock(NEW_CLOCK, 100_000), 99_000)).toBe(0);
  expect(crossings(181_000, 170_000, null)).toEqual([]);
});
test('recovery whose last change came before the clock last ran banks nothing more', () => {
  const running = C({ started: true, bankedMs: 30_000, runningSince: 100_000 });
  expect(recoverClock(running, 99_000)).toEqual({ started: true, bankedMs: 30_000, runningSince: null });
  const paused = C({ started: true, bankedMs: 30_000 });
  expect(recoverClock(paused, 500_000)).toBe(paused);
});
test('pausing a paused clock, resuming a running one or starting a started one changes nothing', () => {
  const paused = C({ started: true, bankedMs: 60_000 });
  const running = C({ started: true, bankedMs: 60_000, runningSince: 1_000 });
  expect(pauseClock(paused, 9_000)).toBe(paused);
  expect(pauseClock(NEW_CLOCK, 9_000)).toBe(NEW_CLOCK);
  expect(resumeClock(running, 9_000)).toBe(running);
  expect(startClock(running, 9_000)).toBe(running);
  expect(startClock(paused, 9_000)).toBe(paused);
  const once = pauseClock(running, 31_000);
  expect(once).toEqual({ started: true, bankedMs: 90_000, runningSince: null });
  expect(pauseClock(once, 95_000)).toBe(once);
});
test('every clock it returns stays finite and never negative, whatever time it is given', () => {
  const sane = (c: RunClock) => Number.isFinite(c.bankedMs) && c.bankedMs >= 0
    && (c.runningSince === null || (Number.isFinite(c.runningSince) && c.runningSince >= 0));
  const clocks = [NEW_CLOCK, C({ started: true, bankedMs: 30_000 }), C({ started: true, bankedMs: 30_000, runningSince: 100_000 })];
  const times = [0, 50, 100_000, 2e12, -5, NaN, Infinity, -Infinity];
  const bad: string[] = [];
  for (const c of clocks) {
    for (const t of times) {
      const out = { start: startClock(c, t), pause: pauseClock(c, t), resume: resumeClock(c, t), recover: recoverClock(c, t) };
      for (const [fn, next] of Object.entries(out)) if (!sane(next)) bad.push(`${fn}(${JSON.stringify(c)}, ${t}) = ${JSON.stringify(next)}`);
      const e = elapsedMs(c, t);
      if (!(Number.isFinite(e) && e >= 0)) bad.push(`elapsedMs(${JSON.stringify(c)}, ${t}) = ${e}`);
      const time = clockView(c, null, t, false).time;
      if (!/^(--:--|\d{2}:\d{2}|\+\d+:\d{2})$/.test(time)) bad.push(`clockView(${JSON.stringify(c)}, ${t}).time = ${time}`);
    }
  }
  expect(bad).toEqual([]);
  expect([formatMmSs(-1), formatMmSs(NaN), formatShort(-1), formatClock(-1), etaMinutes(-60_000), etaMinutes(NaN)])
    .toEqual(['00:00', '00:00', '0:00', '00:00', 20, 20]);
  expect(crossings(NaN, 1_300_000, null)).toEqual([]);
});
test('every new run shares NEW_CLOCK, so it is frozen and never changed', () => {
  expect(Object.isFrozen(NEW_CLOCK)).toBe(true);
  startClock(NEW_CLOCK, 1_000);
  expect(NEW_CLOCK).toEqual({ started: false, bankedMs: 0, runningSince: null });
});
