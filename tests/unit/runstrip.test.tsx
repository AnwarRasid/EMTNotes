// Task 20: the run strip's geometry (Plan 2 draws runs on it through timeToX) and the empty strip Plan 1 shows.
// Plan 2 Task 16 (appended below): Today's trace, and the debrief's replay with its numbered markers.
// Plan 3 Task 6 (appended last): traceGeometry, moved out of RunStrip, and the run history's MiniStrip.
import { render, screen } from '@testing-library/preact';
import type { Replay, StripTrace } from '../../src/sim/debrief';
import {
  MiniStrip, REPLAY, ReplayStrip, RunStrip, STRIP, placeMarkers, replayTimeToX, spikePath, timeToX, traceGeometry,
} from '../../src/ui/RunStrip';

const LABEL = 'Run strip, 0 to 20 minutes. No runs yet. Limits: RBS by 3:00, whole run by 20:00.';

describe('timeToX', () => {
  it('puts 0, the 3:00 RBS limit, 10:00 and the 20:00 limit where the mockup does', () => {
    expect(timeToX(0)).toBe(8);
    expect(timeToX(180)).toBe(51.5);
    expect(timeToX(600)).toBe(153);
    expect(timeToX(1200)).toBe(298);
  });

  it('agrees with the strip constants', () => {
    expect(STRIP).toEqual({ width: 315, height: 80, rbsLimitS: 180, limitS: 1200 });
    expect(timeToX(STRIP.rbsLimitS)).toBe(51.5);
    expect(timeToX(STRIP.limitS)).toBe(298);
  });
});

describe('RunStrip', () => {
  it('is one image named by its label, at the mockup size', () => {
    render(<RunStrip label={LABEL} />);
    const strip = screen.getByRole('img', { name: LABEL });
    expect(strip.tagName.toLowerCase()).toBe('svg');
    expect(strip.getAttribute('viewBox')).toBe('0 0 315 80');
    expect([strip.getAttribute('width'), strip.getAttribute('height')]).toEqual(['315', '80']);
  });

  it('labels the axis 0, RBS 3:00, 10 and 20 min, where the mockup does', () => {
    render(<RunStrip label={LABEL} />);
    const at = (text: string) => {
      const t = screen.getByText(text);
      return [t.getAttribute('x'), t.getAttribute('y'), t.getAttribute('text-anchor')];
    };
    expect(at('0')).toEqual(['8', '76', 'middle']);
    expect(at('RBS 3:00')).toEqual(['51.5', '76', 'middle']);
    expect(at('10')).toEqual(['153', '76', 'middle']);
    expect(at('20 min')).toEqual(['313', '76', 'end']);
  });

  it('draws the baseline, the dashed RBS limit at 3:00 and no trace', () => {
    const { container } = render(<RunStrip label={LABEL} />);
    expect(container.querySelector('.sv-base')?.getAttribute('d')).toBe('M8 52H296');
    const limit = container.querySelector('line.sv-limit')!;
    expect([limit.getAttribute('x1'), limit.getAttribute('y1'), limit.getAttribute('x2'), limit.getAttribute('y2')])
      .toEqual(['51.5', '24', '51.5', '61']);
    expect(container.querySelector('.sv-trace')).toBeNull();
  });

  it('ends in the band chevrons, clipped to x 299 to 311', () => {
    const { container } = render(<RunStrip label={LABEL} />);
    const clip = container.querySelector('clipPath')!;
    const rect = clip.querySelector('rect')!;
    expect([rect.getAttribute('x'), rect.getAttribute('y'), rect.getAttribute('width'), rect.getAttribute('height'), rect.getAttribute('rx')])
      .toEqual(['299', '30', '12', '26', '1.5']);
    const cap = container.querySelector('g[clip-path]')!;
    expect(cap.getAttribute('clip-path')).toBe(`url(#${clip.id})`);
    expect(cap.querySelector('rect.sv-silver')?.getAttribute('x')).toBe('299');
    expect(cap.querySelector('path.sv-chev')?.getAttribute('d'))
      .toBe('M299 34l6-6 6 6M299 41l6-6 6 6M299 48l6-6 6 6M299 55l6-6 6 6M299 62l6-6 6 6');
  });

  it('gives each strip on a screen its own clip path', () => {
    const { container } = render(<><RunStrip label="One" /><RunStrip label="Two" /></>);
    const ids = [...container.querySelectorAll('clipPath')].map((c) => c.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z][\w-]*$/);   // safe inside url(#…)
  });
});

// ---------- Plan 2, Task 16: Today's trace and the debrief replay ----------

test('replay geometry', () => {
  expect([replayTimeToX(0), replayTimeToX(180), replayTimeToX(600), replayTimeToX(1200), replayTimeToX(1500)]).toEqual([76, 108.7, 185, 294, 294]);
  expect(spikePath([8, 12.8], 52, 30, 4, 20)).toBe('M4 52L6.5 52L8 30L9.5 52L11.3 52L12.8 30L14.3 52L20 52');
  expect(placeMarkers([{ n: 1, kind: 'missed', x: 111 }, { n: 2, kind: 'order', x: 120 }, { n: 3, kind: 'phrase', x: 50 }]))
    .toEqual([{ n: 1, kind: 'missed', x: 111 }, { n: 2, kind: 'order', x: 134 }, { n: 3, kind: 'phrase', x: 50 }]);
  expect(placeMarkers(Array.from({ length: 10 }, (_, i) => ({ n: i + 1, kind: 'missed' as const, x: 80 + i * 30 })))).toHaveLength(8);
});

/** Attribute values of one element, in the order asked. */
const attrs = (el: Element | null, ...names: string[]) => names.map((n) => el?.getAttribute(n) ?? null);
/** Every x in a path's d: the number after each M or L. */
const pathXs = (d: string) => [...d.matchAll(/[ML](-?[\d.]+) /g)].map((m) => Number(m[1]));

describe('spikePath and placeMarkers, beyond the brief', () => {
  it('sorts the spikes into time order', () => {
    expect(spikePath([12.8, 8], 52, 30, 4, 20)).toBe(spikePath([8, 12.8], 52, 30, 4, 20));
  });

  it('keeps pushed dots on the strip: past x 304 they step back left, still a gap apart', () => {
    const three = [1, 2, 3].map((n) => ({ n, kind: 'phrase' as const, x: 270 }));
    expect(placeMarkers(three).map((m) => m.x)).toEqual([258, 281, 304]);
    expect(three.map((m) => m.x)).toEqual([270, 270, 270]);   // the input is left alone
  });

  it('gives a marker past the eighth no room: it never pushes a drawn one', () => {
    expect(placeMarkers([{ n: 9, kind: 'missed', x: 100 }, { n: 1, kind: 'order', x: 110 }])).toEqual([{ n: 1, kind: 'order', x: 110 }]);
  });
});

const TODAY: StripTrace = {
  stepsS: [0, 30, 171], endS: 1062, endLabel: 'Standby 17:42', marker: { s: 171, label: 'Pocket check', kind: 'missed' },
};

describe("RunStrip with a trace (Today's last run)", () => {
  it('draws the trace from x 4, a spike a step, to the end line, then the rest to 296', () => {
    const { container } = render(<RunStrip label="Last run" trace={TODAY} />);
    expect(screen.getByRole('img', { name: 'Last run' })).toBeTruthy();
    const d = container.querySelector('path.sv-trace')?.getAttribute('d') ?? '';
    expect(d.startsWith('M4 52')).toBe(true);
    expect(d).toBe('M4 52L6.5 52L8 30L9.5 52L13.8 52L15.3 30L16.8 52L47.8 52L49.3 30L50.8 52L264.7 52');
    expect(attrs(container.querySelector('line.sv-end'), 'x1', 'y1', 'x2', 'y2')).toEqual(['264.7', '19', '264.7', '61']);
    expect(container.querySelector('path.sv-base')?.getAttribute('d')).toBe('M264.7 52H296');
    const end = screen.getByText('Standby 17:42');
    expect([end.getAttribute('class'), ...attrs(end, 'x', 'y', 'text-anchor')]).toEqual(['t-lab', '264.7', '13', 'middle']);
  });

  it('marks a missed point: magenta label and lead, and the hollow circle on the base', () => {
    const { container } = render(<RunStrip label="Last run" trace={TODAY} />);
    const label = screen.getByText('Pocket check');
    expect([label.getAttribute('class'), ...attrs(label, 'x', 'y')]).toEqual(['t-miss', '49.3', '13']);
    expect(attrs(container.querySelector('line.sv-lead-hi'), 'x1', 'y1', 'x2', 'y2')).toEqual(['49.3', '18', '49.3', '45']);
    const miss = container.querySelector('circle.sv-miss')!;
    expect(Number(miss.getAttribute('cx'))).toBeCloseTo(timeToX(171), 1);
    expect(attrs(miss, 'cy', 'r')).toEqual(['52', '5.5']);
  });

  it('marks an order or phrase point in lavender, with no circle', () => {
    const { container } = render(
      <RunStrip label="Last run" trace={{ stepsS: [0], endS: 300, endLabel: 'End 05:00', marker: { s: 120, label: 'Head grip', kind: 'order' } }} />,
    );
    expect(screen.getByText('Head grip').getAttribute('class')).toBe('t-med');
    expect(container.querySelector('line.sv-lead-med')).not.toBeNull();
    expect(container.querySelector('.sv-lead-hi, .sv-miss, .t-miss')).toBeNull();
  });

  it('past 20:00 ends at x 296 and skips the rest, so nothing draws back into the chevrons (T16 ruling)', () => {
    const { container } = render(
      <RunStrip label="Last run" trace={{ stepsS: [0, 600, 1195], endS: 1290, endLabel: 'End 21:30', marker: null }} />,
    );
    expect(attrs(container.querySelector('line.sv-end'), 'x1', 'x2')).toEqual(['296', '296']);
    expect(container.querySelector('path.sv-base')).toBeNull();
    const d = container.querySelector('path.sv-trace')?.getAttribute('d') ?? '';
    expect(d.endsWith('L296 52')).toBe(true);
    expect(Math.max(...pathXs(d))).toBeLessThanOrEqual(297.5);   // the last spike's foot, short of the cap at 299
    // the end label stays over the strip instead of hanging off its right edge
    expect(Number(screen.getByText('End 21:30').getAttribute('x')) + 'End 21:30'.length * 3.5).toBeLessThanOrEqual(STRIP.width);
  });

  it('gives the end label up when it would run into the fault label; the fault label, its lead and the end line stay (review round 1)', () => {
    const { container } = render(
      <RunStrip label="Last run" trace={{ ...TODAY, marker: { s: 1000, label: 'Standby call', kind: 'phrase' } }} />,
    );
    expect(screen.getByText('Standby call').getAttribute('class')).toBe('t-med');
    expect(screen.queryByText('Standby 17:42')).toBeNull();
    expect(container.querySelector('line.sv-lead-med')).not.toBeNull();
    expect(attrs(container.querySelector('line.sv-end'), 'x1', 'x2')).toEqual(['264.7', '264.7']);
  });

  it('keeps both labels when they clear each other by 8 units (review round 1)', () => {
    // "Head grip" (half 31.5) beside "Standby 17:42" (half 45.5, centred at 264.65, so from 219.15): clear up to x 179.65
    const at = (s: number) => {
      const { container, unmount } = render(
        <RunStrip label="Last run" trace={{ ...TODAY, marker: { s, label: 'Head grip', kind: 'order' } }} />,
      );
      const shown = [...container.querySelectorAll('text')].map((t) => t.textContent);
      unmount();
      return [shown.includes('Head grip'), shown.includes('Standby 17:42')];
    };
    expect(at(600)).toEqual([true, true]);    // x 153: far apart
    expect(at(700)).toEqual([true, true]);    // x 177.7: 8 or more apart
    expect(at(720)).toEqual([true, false]);   // x 182.2: under 8 apart, so the end label gives way
  });

  it("with no end, stops at the last step; with no steps either, draws no trace and keeps Plan 1's baseline", () => {
    const open = render(<RunStrip label="A" trace={{ stepsS: [0, 30], endS: null, endLabel: null, marker: null }} />);
    expect(open.container.querySelector('path.sv-trace')?.getAttribute('d')).toBe('M4 52L6.5 52L8 30L9.5 52L13.8 52L15.3 30L16.8 52L16.8 52');
    expect(open.container.querySelector('line.sv-end')).toBeNull();
    expect(open.container.querySelector('path.sv-base')?.getAttribute('d')).toBe('M16.8 52H296');
    const none = render(<RunStrip label="B" trace={{ stepsS: [], endS: null, endLabel: null, marker: null }} />);
    expect(none.container.querySelector('path.sv-trace')).toBeNull();
    expect(none.container.querySelector('path.sv-base')?.getAttribute('d')).toBe('M8 52H296');
  });
});

const RUN: Replay = {
  callSteps: [1, 2, 3, 4], stepsS: [0, 15, 200, 600], endS: 1062, endLabel: 'Standby 17:42',
  markers: [{ n: 1, kind: 'missed', atS: 192, step: 6 }, { n: 2, kind: 'order', atS: 0, step: 5 }],
};
const RUN_LABEL = 'Run replay: a Call segment with untimed steps 1 to 4, then 0 to 20 minutes.';

describe('ReplayStrip', () => {
  it('is one image named by its label, 315 by 94', () => {
    render(<ReplayStrip label={RUN_LABEL} replay={RUN} />);
    const svg = screen.getByRole('img', { name: RUN_LABEL });
    expect(svg.tagName.toLowerCase()).toBe('svg');
    expect(attrs(svg, 'viewBox', 'width', 'height')).toEqual(['0 0 315 94', '315', '94']);
    expect(REPLAY.height).toBe(94);
  });

  it('draws the Call box with its rest, an untimed spike a call step, and the break marks', () => {
    const { container } = render(<ReplayStrip label={RUN_LABEL} replay={RUN} />);
    expect(attrs(container.querySelector('rect.sv-call'), 'x', 'y', 'width', 'height', 'rx')).toEqual(['4', '34', '54', '38', '4']);
    const untimed = container.querySelector('path.sv-untimed')?.getAttribute('d') ?? '';
    expect(untimed).toBe('M12.5 62L14 48L15.5 62M24.5 62L26 48L27.5 62M36.5 62L38 48L39.5 62M48.5 62L50 48L51.5 62');
    expect(untimed.match(/ 48/g)).toHaveLength(4);
    expect(container.querySelector('path.sv-break')?.getAttribute('d')).toBe('M61 67l4-10M66 67l4-10');
  });

  it('draws the 3:00 limit, the trace from x 72, the end line and label, and the rest to 292', () => {
    const { container } = render(<ReplayStrip label={RUN_LABEL} replay={RUN} />);
    expect(attrs(container.querySelector('line.sv-limit'), 'x1', 'y1', 'x2', 'y2')).toEqual(['108.7', '32', '108.7', '71']);
    const d = container.querySelector('path.sv-trace')?.getAttribute('d') ?? '';
    expect(d.startsWith('M72 62L74.5 62L76 40L77.5 62')).toBe(true);
    expect(d.endsWith('L268.9 62')).toBe(true);
    expect(attrs(container.querySelector('line.sv-end'), 'x1', 'y1', 'x2', 'y2')).toEqual(['268.9', '25', '268.9', '71']);
    const end = screen.getByText('Standby 17:42');
    expect([end.getAttribute('class'), ...attrs(end, 'x', 'y')]).toEqual(['t-lab', '268.9', '17']);
    expect([...container.querySelectorAll('path.sv-base')].map((p) => p.getAttribute('d'))).toEqual(['M8 62H55', 'M268.9 62H292']);
  });

  it('ends in the chevrons clipped at x 295, and labels the axis', () => {
    const { container } = render(<ReplayStrip label={RUN_LABEL} replay={RUN} />);
    const clip = container.querySelector('clipPath')!;
    expect(attrs(clip.querySelector('rect'), 'x', 'y', 'width', 'height', 'rx')).toEqual(['295', '40', '12', '26', '1.5']);
    expect(container.querySelector('g[clip-path]')?.getAttribute('clip-path')).toBe(`url(#${clip.id})`);
    expect(container.querySelector('path.sv-chev')?.getAttribute('d'))
      .toBe('M295 44l6-6 6 6M295 51l6-6 6 6M295 58l6-6 6 6M295 65l6-6 6 6M295 72l6-6 6 6');
    const at = (text: string) => attrs(screen.getByText(text), 'x', 'y', 'text-anchor');
    expect(at('Call')).toEqual(['31', '88', 'middle']);
    expect(at('0')).toEqual(['76', '88', 'middle']);
    expect(at('RBS 3:00')).toEqual(['103', '88', 'start']);
    expect(at('10')).toEqual(['185', '88', 'middle']);
    expect(at('20 min')).toEqual(['313', '88', 'end']);
  });

  it('numbers each marker on a dot, with a lead down to the trace, and circles a missed one on the base', () => {
    const { container } = render(<ReplayStrip label={RUN_LABEL} replay={RUN} />);
    expect(attrs(container.querySelector('circle.sv-dot-hi'), 'cx', 'cy', 'r')).toEqual(['110.9', '13', '11']);
    expect(attrs(container.querySelector('circle.sv-dot-med'), 'cx', 'cy', 'r')).toEqual(['76', '13', '11']);
    expect([...container.querySelectorAll('text.sv-n')].map((t) => t.textContent)).toEqual(['1', '2']);
    expect(attrs(container.querySelector('text.sv-n'), 'x', 'y', 'text-anchor', 'dominant-baseline')).toEqual(['110.9', '13.5', 'middle', 'central']);
    expect(attrs(container.querySelector('line.sv-lead-hi'), 'x1', 'y1', 'x2', 'y2')).toEqual(['110.9', '24', '110.9', '56']);
    expect(attrs(container.querySelector('line.sv-lead-med'), 'x1', 'y1', 'x2', 'y2')).toEqual(['76', '24', '76', '38']);   // onto the 0:00 spike
    expect(attrs(container.querySelector('circle.sv-miss'), 'cx', 'cy', 'r')).toEqual(['110.9', '62', '5.5']);
  });

  it("pushes close markers apart; a pushed dot's lead runs back to its own point", () => {
    const replay: Replay = {
      ...RUN,
      markers: [{ n: 1, kind: 'missed', atS: 192, step: 6 }, { n: 2, kind: 'order', atS: 200, step: 7 }, { n: 3, kind: 'phrase', atS: null, step: 4 }],
    };
    const { container } = render(<ReplayStrip label={RUN_LABEL} replay={replay} />);
    const dots = [...container.querySelectorAll('circle[class^="sv-dot"]')].map((c) => c.getAttribute('cx'));
    expect(dots).toEqual(['110.9', '133.9', '50']);
    const leads = [...container.querySelectorAll('line.sv-lead-med')].map((l) => attrs(l, 'x1', 'y1', 'x2', 'y2'));
    expect(leads).toEqual([['133.9', '24', '112.3', '38'], ['50', '24', '50', '46']]);   // onto the 3:20 spike; onto call step 4
  });

  it('gives the end label up when a dot would sit on it; the end line and the dot stay (review round 1)', () => {
    const late: Replay = { ...RUN, markers: [...RUN.markers, { n: 3, kind: 'phrase', atS: 1062, step: 19 }] };
    const { container } = render(<ReplayStrip label={RUN_LABEL} replay={late} />);
    expect(screen.queryByText('Standby 17:42')).toBeNull();
    expect(attrs(container.querySelector('line.sv-end'), 'x1', 'x2')).toEqual(['268.9', '268.9']);
    expect([...container.querySelectorAll('text.sv-n')].map((t) => t.textContent)).toEqual(['1', '2', '3']);
    expect([...container.querySelectorAll('circle.sv-dot-med')].map((c) => c.getAttribute('cx'))).toEqual(['76', '268.9']);
  });

  it('keeps the end label when every dot clears it by 8 units (review round 1)', () => {
    // "Standby 17:42" (half 45.5, centred at 268.93, so from 223.43): a dot (r 11) clears it up to x 204.43
    const at = (atS: number) => {
      const replay: Replay = { ...RUN, markers: [...RUN.markers, { n: 3, kind: 'order', atS, step: 12 }] };
      const { container, unmount } = render(<ReplayStrip label={RUN_LABEL} replay={replay} />);
      const shown = [...container.querySelectorAll('text.t-lab')].map((t) => t.textContent);
      unmount();
      return shown.includes('Standby 17:42');
    };
    expect(at(600)).toBe(true);    // dot at 185
    expect(at(700)).toBe(true);    // dot at 204.1: 8 or more clear
    expect(at(720)).toBe(false);   // dot at 207.4: under 8 clear, so the label gives way
  });

  it('past 20:00 ends at x 294 and skips the rest after it (T16 ruling)', () => {
    const { container } = render(
      <ReplayStrip label={RUN_LABEL} replay={{ callSteps: [1, 2, 3, 4], stepsS: [0, 600], endS: 1290, endLabel: 'End 21:30', markers: [] }} />,
    );
    expect(attrs(container.querySelector('line.sv-end'), 'x1', 'x2')).toEqual(['294', '294']);
    expect([...container.querySelectorAll('path.sv-base')].map((p) => p.getAttribute('d'))).toEqual(['M8 62H55']);
    expect(container.querySelector('path.sv-trace')?.getAttribute('d')?.endsWith('L294 62')).toBe(true);
  });

  it('a replay that never started draws no trace and no end: the rest runs from 72, and the markers sit in the call box or at 0', () => {
    const replay: Replay = {
      callSteps: [1, 2], stepsS: [], endS: null, endLabel: null,
      markers: [{ n: 1, kind: 'missed', atS: null, step: 3 }, { n: 2, kind: 'phrase', atS: null, step: 7 }],
    };
    const { container } = render(<ReplayStrip label="Never started" replay={replay} />);
    expect(container.querySelector('path.sv-trace')).toBeNull();
    expect(container.querySelector('line.sv-end')).toBeNull();
    expect([...container.querySelectorAll('path.sv-base')].map((p) => p.getAttribute('d'))).toEqual(['M8 62H55', 'M72 62H292']);
    expect(container.querySelector('path.sv-untimed')?.getAttribute('d')).toBe('M12.5 62L14 48L15.5 62M24.5 62L26 48L27.5 62');
    expect(container.querySelector('circle.sv-dot-hi')?.getAttribute('cx')).toBe('38');   // call step 3
    expect(attrs(container.querySelector('line.sv-lead-med'), 'x1', 'x2', 'y2')).toEqual(['76', '76', '60']);   // x0, onto the base
  });
});

// ---------- Plan 3, Task 6: the run history's half-size strip (ruling D11) ----------

describe('traceGeometry', () => {
  /** Every x to 2 decimal places. */
  const r2 = (v: number | null) => (v === null ? null : Math.round(v * 100) / 100);
  const close = (g: ReturnType<typeof traceGeometry>) =>
    ({ xs: g.xs.map(r2), traceTo: r2(g.traceTo), restFrom: r2(g.restFrom), endX: r2(g.endX), mx: r2(g.mx) });

  it("is RunStrip's: a step's x, the trace to the end line, the rest from it, and the marker's x", () => {
    expect(close(traceGeometry(TODAY))).toEqual({ xs: [8, 15.25, 49.33], traceTo: 264.65, restFrom: 264.65, endX: 264.65, mx: 49.33 });
  });

  it('with no end, stops the trace at the last step\'s foot; with no trace at all, the rest runs from 0:00', () => {
    expect(close(traceGeometry({ stepsS: [0, 30], endS: null, endLabel: null, marker: null })))
      .toEqual({ xs: [8, 15.25], traceTo: 16.75, restFrom: 16.75, endX: null, mx: null });
    expect(traceGeometry(undefined)).toEqual({ xs: [], traceTo: null, restFrom: 8, endX: null, mx: null });
  });

  it('holds a late end and a late step at x 296, short of the chevrons (T16 ruling)', () => {
    const g = traceGeometry({ stepsS: [0, 1195, 1250], endS: 1290, endLabel: 'End 21:30', marker: { s: 1300, label: 'X', kind: 'missed' } });
    expect([g.endX, g.traceTo, g.mx, Math.max(...g.xs)]).toEqual([296, 296, 296, 296]);
  });
});

describe('MiniStrip', () => {
  /** The trace RunStrip draws for `trace`. */
  const bigTrace = (trace: StripTrace) => {
    const { container, unmount } = render(<RunStrip label="Last run" trace={trace} />);
    const d = container.querySelector('path.sv-trace')?.getAttribute('d') ?? null;
    unmount();
    return d;
  };

  it("draws RunStrip's trace, hidden from screen readers, with no text, at half size", () => {
    const { container } = render(<MiniStrip trace={TODAY} />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('class')).toBe('strip strip-mini');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('role')).toBeNull();
    expect(svg.getAttribute('aria-label')).toBeNull();
    expect(attrs(svg, 'viewBox', 'width')).toEqual(['0 0 315 80', '158']);
    expect(container.querySelectorAll('text')).toHaveLength(0);
    expect(container.querySelector('path.sv-trace')?.getAttribute('d')).toBe(bigTrace(TODAY));
    expect(screen.queryByRole('img')).toBeNull();
  });

  it("keeps RunStrip's limit line, end line, rest and chevrons, and marks a missed point with a magenta dot", () => {
    const { container } = render(<MiniStrip trace={TODAY} />);
    expect(attrs(container.querySelector('line.sv-limit'), 'x1', 'y1', 'x2', 'y2')).toEqual(['51.5', '24', '51.5', '61']);
    expect(attrs(container.querySelector('line.sv-end'), 'x1', 'y1', 'x2', 'y2')).toEqual(['264.7', '19', '264.7', '61']);
    expect(container.querySelector('path.sv-base')?.getAttribute('d')).toBe('M264.7 52H296');
    const clip = container.querySelector('clipPath')!;
    expect(attrs(clip.querySelector('rect'), 'x', 'y', 'width', 'height')).toEqual(['299', '30', '12', '26']);
    expect(container.querySelector('g[clip-path]')?.getAttribute('clip-path')).toBe(`url(#${clip.id})`);
    expect(container.querySelector('path.sv-chev')?.getAttribute('d'))
      .toBe('M299 34l6-6 6 6M299 41l6-6 6 6M299 48l6-6 6 6M299 55l6-6 6 6M299 62l6-6 6 6');
    const dots = container.querySelectorAll('circle');
    expect(dots).toHaveLength(1);
    expect(dots[0]?.getAttribute('class')).toBe('sv-dot-hi');
    expect(attrs(dots[0]!, 'cx', 'cy')).toEqual(['49.3', '52']);
    // a label's lead has nothing to lead to
    expect(container.querySelector('.sv-lead-hi, .sv-lead-med')).toBeNull();
  });

  it('marks an order or phrase point with a lavender dot, and a run with no fault with none', () => {
    const order = render(<MiniStrip trace={{ ...TODAY, marker: { s: 120, label: 'Head grip', kind: 'order' } }} />);
    expect([...order.container.querySelectorAll('circle')].map((c) => c.getAttribute('class'))).toEqual(['sv-dot-med']);
    const clean = render(<MiniStrip trace={{ ...TODAY, marker: null }} />);
    expect(clean.container.querySelector('circle')).toBeNull();
  });

  it('draws no trace for a run whose clock never started, and the rest from 0:00', () => {
    const trace: StripTrace = { stepsS: [], endS: null, endLabel: null, marker: null };
    const { container } = render(<MiniStrip trace={trace} />);
    expect(container.querySelector('path.sv-trace')).toBeNull();
    expect(container.querySelector('line.sv-end')).toBeNull();
    expect(container.querySelector('path.sv-base')?.getAttribute('d')).toBe('M8 52H296');
  });

  it('gives each mini strip on a screen its own clip path, apart from a full strip', () => {
    const { container } = render(<><RunStrip label="One" trace={TODAY} /><MiniStrip trace={TODAY} /><MiniStrip trace={TODAY} /></>);
    const ids = [...container.querySelectorAll('clipPath')].map((c) => c.id);
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z][\w-]*$/);
  });
});
