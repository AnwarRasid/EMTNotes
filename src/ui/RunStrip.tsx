// The run strip: a run's 20 minutes on one line, from the approved mockup's Today strip (scdf.fragment.html lines
// 315–333), with its geometry unchanged. Plan 1 draws it empty: the baseline, the dashed 3:00 RBS limit, the band
// chevrons at the 20:00 limit and the axis. Plan 2 draws Today's last run on it through the optional trace prop
// (placed with timeToX), and adds ReplayStrip, the debrief's replay (mockup lines 439–467): a Call box with the
// untimed steps 1 to 4, then the timed run with numbered fault markers. Plan 3 adds MiniStrip, the run history's
// half-size strip with no text (ruling D11), drawn from the same traceGeometry. The band here is the strip's end, never
// a status; the markers carry the status hues (magenta for missed or wrong, lavender for order or phrase).
import { Fragment, type JSX } from 'preact';
import { useId } from 'preact/hooks';
import type { FaultKind } from '../progress/types';
import { REPLAY_MARKERS, type Replay, type StripTrace } from '../sim/debrief';

export const STRIP = { width: 315, height: 80, rbsLimitS: 180, limitS: 1200 } as const;

/** The x of a time into the run, in seconds: 0 at x 8, 145 units a 10 minutes (3:00 at 51.5, 10:00 at 153, 20:00 at 298). */
export function timeToX(seconds: number): number {
  return 8 + (seconds * 145) / 600;
}

/** The debrief replay's geometry (mockup lines 439–467): the timed run starts at x0, 109 units a 10 minutes. */
export const REPLAY = {
  width: 315, height: 94, baseY: 62, peakY: 40, untimedPeakY: 48, axisY: 88, x0: 76, perTenMin: 109,
  callX: [14, 26, 38, 50], endX: 294,
} as const;

/** The replay's x of a time into the run, in seconds: 0 at 76, 3:00 at 108.7, 10:00 at 185, 20:00 and past at 294. */
export function replayTimeToX(seconds: number): number {
  return Math.min(REPLAY.endX, REPLAY.x0 + (seconds * REPLAY.perTenMin) / 600);
}

/** Every coordinate either strip prints: rounded to 1 decimal place, with no trailing ".0" (8, 12.8). */
function n1(v: number): string {
  return String(Math.round(v * 10) / 10);
}

/** A trace along baseY from fromX to toX, with a spike up to peakY at each x (3 units wide), in ascending order. */
export function spikePath(xs: number[], baseY: number, peakY: number, fromX: number, toX: number): string {
  const b = n1(baseY);
  const p = n1(peakY);
  const spikes = [...xs].sort((a, c) => a - c).map((x) => `L${n1(x - 1.5)} ${b}L${n1(x)} ${p}L${n1(x + 1.5)} ${b}`);
  return `M${n1(fromX)} ${b}${spikes.join('')}L${n1(toX)} ${b}`;
}

// StripTrace and Replay are declared in the pure src/sim/debrief.ts, which builds them (ruling D3), so the sim never
// imports a preact module.

/** Missed and wrong are the magenta kinds (the !!! chip); order and phrase the lavender ones (!!). */
const isHi = (kind: FaultKind): boolean => kind === 'missed' || kind === 'wrong';

/** Half a strip label's width, a character (the labels are 14-unit Barlow Semi Condensed bold). Measured from rendered
 *  strips, over every step's short label and the end labels: at the normal text size the median is 3.04 units and the
 *  90th percentile 3.36; at the larger setting (1.25x) the median is 3.80. So 3.5 covers about nine labels in ten at
 *  the normal size, and with LABEL_PAD it still keeps two typical labels apart at the larger one. */
const CHAR_HALF = 3.5;
/** The clear space a label needs from what it yields to. */
const LABEL_PAD = 8;

type Span = readonly [number, number];

/** A label's centre: over x, unless that would run it off the strip; then it is held in by its estimated half width. */
function labelCentre(x: number, text: string, width: number): number {
  const half = text.length * CHAR_HALF;
  return Math.min(Math.max(x, half), width - half);
}

/** The x span a label is estimated to take. */
function labelSpan(x: number, text: string, width: number): Span {
  const c = labelCentre(x, text, width);
  const half = text.length * CHAR_HALF;
  return [c - half, c + half];
}

/** Whether two spans keep at least pad between them. */
function clears(a: Span, b: Span, pad = LABEL_PAD): boolean {
  return a[1] + pad <= b[0] || b[1] + pad <= a[0];
}

const BASE_Y = 52;
const PEAK_Y = 30;
const AXIS_Y = 76;
/** Today's trace starts a little before 0:00, and the rest stops short of the chevrons. */
const TRACE_FROM = 4;
const REST_TO = 296;
/** The chevron cap just past the 20:00 limit: x 299 to 311. */
const CAP = { x: 299, y: 30, width: 12, height: 26 } as const;
const MISS_R = 5.5;

/** Today's x of a time: past 20:00 it holds at the 20:00 limit, and never passes the rest's stop at 296 (T16 ruling),
 *  so neither the end nor a late step draws into the chevrons. */
const todayX = (s: number): number => Math.min(REST_TO, timeToX(Math.min(s, STRIP.limitS)));

/** A trace's place on the strip, as RunStrip and MiniStrip both draw it: each step's x, where the trace stops (null:
 *  no trace), where the dotted rest starts, the end line's x (null: no end) and the marker's x (null: no marker). With
 *  no end, the trace stops at the last step's foot; with no steps and no end, there is no trace and the rest runs from
 *  0:00. */
export function traceGeometry(trace: StripTrace | undefined): { xs: number[]; traceTo: number | null; restFrom: number;
  endX: number | null; mx: number | null } {
  const xs = trace?.stepsS.map(todayX) ?? [];
  const endS = trace?.endS ?? null;
  const endX = endS !== null ? todayX(endS) : null;
  const traceTo = endX ?? (xs.length > 0 ? Math.max(...xs) + 1.5 : null);
  const restFrom = traceTo ?? timeToX(0);
  const marker = trace?.marker ?? null;
  const mx = marker !== null ? todayX(marker.s) : null;
  return { xs, traceTo, restFrom, endX, mx };
}

/** The chevron cap's clip, by its id: the band past the 20:00 limit, drawn inside it by StripCap. */
function CapClip({ id }: { id: string }): JSX.Element {
  return <defs><clipPath id={id}><rect x={CAP.x} y={CAP.y} width={CAP.width} height={CAP.height} rx="1.5" /></clipPath></defs>;
}

/** The band chevrons past the 20:00 limit, clipped to x 299 to 311. */
function StripCap({ clip }: { clip: string }): JSX.Element {
  return (
    <g clip-path={`url(#${clip})`}>
      <rect class="sv-silver" x={CAP.x} y={CAP.y} width={CAP.width} height={CAP.height} />
      <path class="sv-chev" d="M299 34l6-6 6 6M299 41l6-6 6 6M299 48l6-6 6 6M299 55l6-6 6 6M299 62l6-6 6 6" />
    </g>
  );
}

export function RunStrip({ label, trace }: { label: string; trace?: StripTrace }): JSX.Element {
  // Two strips on a screen each need their own clip. Preact's ids are plain letters, digits and dashes.
  const clip = `strip-cap-${useId()}`;
  const rbs = timeToX(STRIP.rbsLimitS);
  const { xs, traceTo, restFrom, endX, mx } = traceGeometry(trace);
  const endLabel = trace?.endLabel ?? null;
  // traceGeometry gives the marker's x exactly when there is a marker.
  const marker = trace?.marker != null && mx !== null ? { ...trace.marker, x: mx } : null;
  const hi = marker !== null && isHi(marker.kind);
  // The fault label always shows: it names the one point to fix. The end label gives way when the two would meet, as
  // the panel's large figure already shows the time; the end line itself always stays.
  const endText = endX !== null && endLabel !== null
    && (marker === null || clears(labelSpan(endX, endLabel, STRIP.width), labelSpan(marker.x, marker.label, STRIP.width)))
    ? endLabel : null;
  return (
    <svg class="strip" viewBox={`0 0 ${STRIP.width} ${STRIP.height}`} width={STRIP.width} height={STRIP.height} role="img" aria-label={label}>
      <CapClip id={clip} />
      {marker !== null && <>
        <text class={hi ? 't-miss' : 't-med'} x={n1(labelCentre(marker.x, marker.label, STRIP.width))} y="13" text-anchor="middle">{marker.label}</text>
        <line class={hi ? 'sv-lead-hi' : 'sv-lead-med'} x1={n1(marker.x)} y1="18" x2={n1(marker.x)} y2="45" />
      </>}
      {endX !== null && endText !== null &&
        <text class="t-lab" x={n1(labelCentre(endX, endText, STRIP.width))} y="13" text-anchor="middle">{endText}</text>}
      <line class="sv-limit" x1={rbs} y1="24" x2={rbs} y2="61" />
      {restFrom < REST_TO && <path class="sv-base" d={`M${n1(restFrom)} ${BASE_Y}H${REST_TO}`} />}
      {traceTo !== null && <path class="sv-trace" d={spikePath(xs, BASE_Y, PEAK_Y, TRACE_FROM, traceTo)} />}
      {hi && <circle class="sv-miss" cx={n1(marker.x)} cy={BASE_Y} r={MISS_R} />}
      {endX !== null && <line class="sv-end" x1={n1(endX)} y1="19" x2={n1(endX)} y2="61" />}
      <StripCap clip={clip} />
      <text class="t-axis" x={timeToX(0)} y={AXIS_Y} text-anchor="middle">0</text>
      <text class="t-axis" x={rbs} y={AXIS_Y} text-anchor="middle">RBS 3:00</text>
      <text class="t-axis" x={timeToX(600)} y={AXIS_Y} text-anchor="middle">10</text>
      <text class="t-axis" x="313" y={AXIS_Y} text-anchor="end">20 min</text>
    </svg>
  );
}

/** The mini strip's fault dot: on the base, a little wider than the full strip's missed circle, since it is drawn at
 *  half size. */
const MINI_DOT_R = 6.5;

/**
 * A run on the strip at half size, for the run history's rows (Plan 3 Task 6, ruling D11): RunStrip's geometry, with
 * its trace, rest, 3:00 limit, end line and chevrons, and the marked fault as one dot in its chips' hue (magenta for
 * missed or wrong, lavender for order or phrase). Every text label is dropped, as half size can't carry them, and with
 * them the fault label's lead. Hidden from screen readers: the row's own link text says the case, when and the verdict.
 */
export function MiniStrip({ trace }: { trace: StripTrace }): JSX.Element {
  const clip = `strip-mini-cap-${useId()}`;
  const rbs = timeToX(STRIP.rbsLimitS);
  const { xs, traceTo, restFrom, endX, mx } = traceGeometry(trace);
  const kind = trace.marker?.kind ?? null;
  return (
    <svg class="strip strip-mini" viewBox={`0 0 ${STRIP.width} ${STRIP.height}`} width="158" height="40" aria-hidden="true">
      <CapClip id={clip} />
      <line class="sv-limit" x1={rbs} y1="24" x2={rbs} y2="61" />
      {restFrom < REST_TO && <path class="sv-base" d={`M${n1(restFrom)} ${BASE_Y}H${REST_TO}`} />}
      {traceTo !== null && <path class="sv-trace" d={spikePath(xs, BASE_Y, PEAK_Y, TRACE_FROM, traceTo)} />}
      {endX !== null && <line class="sv-end" x1={n1(endX)} y1="19" x2={n1(endX)} y2="61" />}
      {mx !== null && kind !== null && <circle class={isHi(kind) ? 'sv-dot-hi' : 'sv-dot-med'} cx={n1(mx)} cy={BASE_Y} r={MINI_DOT_R} />}
      <StripCap clip={clip} />
    </svg>
  );
}

/** A fault marker on the replay: its number, kind and x (before placeMarkers spreads the dots). */
export interface ReplayMarker { n: number; kind: FaultKind; x: number }

/** A dot's radius, and the furthest right its centre may sit and stay on the strip. */
const DOT_R = 11;
const DOT_MAX_X = REPLAY.width - DOT_R;
/** The debrief's summary describes the same markers (src/sim/debrief.ts). */
const MAX_MARKERS = REPLAY_MARKERS;

/** Spreads the numbered dots so they never overlap: in x order, a dot less than gap after the one before moves to that
 *  dot's x plus gap. Only markers 1 to 8 are drawn, so only they take room; and a dot pushed past the strip's right
 *  edge steps back left, with the ones before it, keeping the gap. Returned in n order. */
export function placeMarkers(ms: ReplayMarker[], gap = 23): ReplayMarker[] {
  const byX = ms.filter((m) => m.n <= MAX_MARKERS).map((m) => ({ ...m })).sort((a, b) => a.x - b.x || a.n - b.n);
  for (let i = 1; i < byX.length; i++) {
    const prev = byX[i - 1]!;
    const m = byX[i]!;
    if (m.x < prev.x + gap) m.x = prev.x + gap;
  }
  for (let i = byX.length - 1; i >= 0; i--) {
    const m = byX[i]!;
    const next = byX[i + 1];
    m.x = Math.min(m.x, next === undefined ? DOT_MAX_X : next.x - gap);
  }
  return byX.sort((a, b) => a.n - b.n);
}

/** The replay's trace starts at x 72, just after the break marks, and its rest stops short of the chevrons. */
const R_TRACE_FROM = 72;
const R_REST_TO = 292;
const R_CAP = { x: 295, y: 40, width: 12, height: 26 } as const;
const DOT_Y = 13;
/** Leads start at a dot's foot and stop 2 short of the trace, or above a missed point's circle. */
const LEAD_FROM = DOT_Y + DOT_R;
const MISS_LEAD_TO = REPLAY.baseY - MISS_R - 0.5;

/** A marker's point on the replay: its time, else its call step (1 to 4), else 0:00 for a timed step never reached. */
function markerX(m: Replay['markers'][number]): number {
  if (m.atS !== null) return replayTimeToX(m.atS);
  return REPLAY.callX[m.step - 1] ?? REPLAY.x0;
}

/** The trace's height at x: on a spike's slope or peak, else the base. */
function traceYAt(x: number, spikes: { x: number; peak: number }[]): number {
  let y: number = REPLAY.baseY;
  for (const s of spikes) {
    const t = 1 - Math.abs(x - s.x) / 1.5;
    if (t > 0) y = Math.min(y, REPLAY.baseY - (REPLAY.baseY - s.peak) * t);
  }
  return y;
}

export function ReplayStrip({ label, replay }: { label: string; replay: Replay }): JSX.Element {
  const clip = `replay-cap-${useId()}`;
  const { baseY, peakY, untimedPeakY, axisY } = REPLAY;
  const callXs = [...new Set(replay.callSteps)].sort((a, b) => a - b)
    .flatMap((o) => { const x = REPLAY.callX[o - 1]; return x === undefined ? [] : [x]; });
  const xs = replay.stepsS.map(replayTimeToX);
  const endX = replay.endS !== null ? replayTimeToX(replay.endS) : null;
  const traceTo = endX ?? (xs.length > 0 ? Math.max(...xs) + 1.5 : null);
  const restFrom = traceTo ?? R_TRACE_FROM;
  const spikes = [...callXs.map((x) => ({ x, peak: untimedPeakY })), ...xs.map((x) => ({ x, peak: peakY }))];
  // each marker's own point, worked out once and kept by number: placeMarkers moves only the dots
  const points = replay.markers.map((m) => ({ n: m.n, kind: m.kind, x: markerX(m) }));
  const at = new Map(points.map((p) => [p.n, p.x]));
  const placed = placeMarkers(points);
  const pointOf = (m: ReplayMarker): number => at.get(m.n) ?? m.x;
  // The end label shares the dots' row; it gives way to any dot it would meet (it cannot move: right of a late end
  // there is no room, and left of it is where the late dots sit). The end line always stays, and the debrief's figures
  // and this strip's label carry the time.
  const endSpan = endX !== null && replay.endLabel !== null ? labelSpan(endX, replay.endLabel, REPLAY.width) : null;
  const endText = endSpan !== null && placed.every((m) => clears(endSpan, [m.x - DOT_R, m.x + DOT_R])) ? replay.endLabel : null;
  return (
    <svg class="strip" viewBox={`0 0 ${REPLAY.width} ${REPLAY.height}`} width={REPLAY.width} height={REPLAY.height} role="img" aria-label={label}>
      <defs><clipPath id={clip}><rect x={R_CAP.x} y={R_CAP.y} width={R_CAP.width} height={R_CAP.height} rx="1.5" /></clipPath></defs>
      <rect class="sv-call" x="4" y="34" width="54" height="38" rx="4" />
      <path class="sv-base" d={`M8 ${baseY}H55`} />
      {callXs.length > 0 && <path class="sv-untimed"
        d={callXs.map((x) => `M${n1(x - 1.5)} ${baseY}L${n1(x)} ${untimedPeakY}L${n1(x + 1.5)} ${baseY}`).join('')} />}
      <path class="sv-break" d="M61 67l4-10M66 67l4-10" />
      <line class="sv-limit" x1={n1(replayTimeToX(STRIP.rbsLimitS))} y1="32" x2={n1(replayTimeToX(STRIP.rbsLimitS))} y2="71" />
      {restFrom < R_REST_TO && <path class="sv-base" d={`M${n1(restFrom)} ${baseY}H${R_REST_TO}`} />}
      {/* pathLength 1: the debrief's reveal draws the trace with one dash of length 1 (components.css .reveal) */}
      {traceTo !== null && <path class="sv-trace" pathLength={1} d={spikePath(xs, baseY, peakY, R_TRACE_FROM, traceTo)} />}
      {endX !== null && <line class="sv-end" x1={n1(endX)} y1="25" x2={n1(endX)} y2="71" />}
      <g clip-path={`url(#${clip})`}>
        <rect class="sv-silver" x={R_CAP.x} y={R_CAP.y} width={R_CAP.width} height={R_CAP.height} />
        <path class="sv-chev" d="M295 44l6-6 6 6M295 51l6-6 6 6M295 58l6-6 6 6M295 65l6-6 6 6M295 72l6-6 6 6" />
      </g>
      {/* markers: each lead runs from its dot down to its own point, so a dot pushed aside still points home */}
      {placed.map((m) => {
        const px = pointOf(m);
        const hi = isHi(m.kind);
        return <line key={`l${m.n}`} class={hi ? 'sv-lead-hi' : 'sv-lead-med'} x1={n1(m.x)} y1={LEAD_FROM}
          x2={n1(px)} y2={n1(hi ? MISS_LEAD_TO : traceYAt(px, spikes) - 2)} />;
      })}
      {placed.filter((m) => isHi(m.kind)).map((m) =>
        <circle key={`c${m.n}`} class="sv-miss" cx={n1(pointOf(m))} cy={baseY} r={MISS_R} />)}
      {placed.map((m) => <Fragment key={`d${m.n}`}>
        <circle class={isHi(m.kind) ? 'sv-dot-hi' : 'sv-dot-med'} cx={n1(m.x)} cy={DOT_Y} r={DOT_R} />
        <text class="sv-n" x={n1(m.x)} y={DOT_Y + 0.5} text-anchor="middle" dominant-baseline="central">{m.n}</text>
      </Fragment>)}
      {endX !== null && endText !== null &&
        <text class="t-lab" x={n1(labelCentre(endX, endText, REPLAY.width))} y="17" text-anchor="middle">{endText}</text>}
      <text class="t-axis" x="31" y={axisY} text-anchor="middle">Call</text>
      <text class="t-axis" x={REPLAY.x0} y={axisY} text-anchor="middle">0</text>
      <text class="t-axis" x="103" y={axisY} text-anchor="start">RBS 3:00</text>
      <text class="t-axis" x={n1(replayTimeToX(600))} y={axisY} text-anchor="middle">10</text>
      <text class="t-axis" x="313" y={axisY} text-anchor="end">20 min</text>
    </svg>
  );
}
