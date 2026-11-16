// The debrief's model (spec §6.2 Debrief, mockup screen 3): the verdict, the figures, steps clean, what went well, the
// replay and its text summary, Today's trace of a run and its label (Task 18), the case and verdict lines, and what the
// screen reads its rows through: a dispute, a fault's step and detail (its oxygen note folded out), the tapped steps,
// the drill chain, the vitals table and the transcript's speakers. It reads the saved RunRecord, with the shipped steps
// for names and the case while it is still on this phone.
// The strips' Replay and StripTrace are declared here, and src/ui/RunStrip.tsx imports them (ruling D3), so the
// simulator never imports a preact module. Pure: no window, document or preact.
import { VITAL_KEYS, type Case, type Step, type VitalKey } from '../data/schema';
import { activeFaults, type Fault, type FaultKind, type Reading, type RunRecord, type TranscriptLine } from '../progress/types';
import { formatMmSs, formatShort, rbsInTime, rbsShown } from './clock';
import { DRILL_SPEAKER, isDrillOpening } from './drill';
import type { Headline } from './headline';
import { describeOxygen } from './oxygen';
import { DISPATCH, capitalise } from './replies';
import { stepsPhrase } from './run';

/** Today's last run on its strip: its timed steps and end, in seconds, and the one point to mark. */
export interface StripTrace {
  stepsS: number[];
  endS: number | null;
  endLabel: string | null;
  marker: { s: number; label: string; kind: FaultKind } | null;
}

/** The debrief's replay of a run: the call steps reached (1 to 4, untimed), the timed steps and end in seconds, and the
 *  active faults, numbered in fault order. A fault with no time sits on its call step, or at 0:00 for a timed step. */
export interface Replay {
  callSteps: number[];
  stepsS: number[];
  endS: number | null;
  endLabel: string | null;
  markers: { n: number; kind: FaultKind; atS: number | null; step: number }[];
}

/** The replay draws markers 1 to 8 only; the fix list holds the rest. */
export const REPLAY_MARKERS = 8;

/** Each kind's word, as its chip and the strips' text read it. */
export const FAULT_WORD: Record<FaultKind, string> = { missed: 'Missed', wrong: 'Wrong', order: 'Order', phrase: 'Phrase' };

/** The standby call's six letters, as the case record's slots show them. C lights for the case and its two signs. */
export const SRACIE: readonly { letter: string; name: string }[] = [
  { letter: 'S', name: 'sex' }, { letter: 'R', name: 'race' }, { letter: 'A', name: 'age' },
  { letter: 'C', name: 'case and signs' }, { letter: 'I', name: 'IC no.' }, { letter: 'E', name: 'ETA' },
];

const RBS_STEP = 'rapid-body-survey';
const RBS_POINT = `${RBS_STEP}/rbs-regions`;
const NOTIFICATION = 'notification';
/** The untimed steps the replay's Call segment holds. */
const CALL_STEPS = 4;
const REPLAY_INTRO = 'Run replay: a Call segment with untimed steps 1 to 4, then 0 to 20 minutes.';

/** Whether the run's clock ever started: one ended before it did has no time, no end and "—" for its figures. */
const clockRan = (r: RunRecord): boolean => r.usedMs > 0 || Object.keys(r.stepTimes).length > 0;
/** Whether step `order` counts in the run: any step in a full run, the range's in a drill. */
const inRange = (r: RunRecord, order: number): boolean =>
  r.drillRange === null || (order >= r.drillRange[0] && order <= r.drillRange[1]);
const stepById = (steps: Step[], id: string): Step | undefined => steps.find(s => s.id === id);
/** Whether the step was graded in the run: still in the steps, within a drill's range, and not tapped. What went well
 *  credits only what was graded: a tapped step plays the case's own answer. */
const graded = (r: RunRecord, steps: Step[], id: string): boolean => {
  const st = stepById(steps, id);
  return st !== undefined && inRange(r, st.order) && !r.tapped.includes(id);
};

/** A fault's point in the steps, or null once its step or the point itself has left them. */
function pointOf(steps: Step[], key: string): { step: Step; short: string } | null {
  const [stepId = '', pointId] = key.split('/');
  const step = stepById(steps, stepId);
  const m = step?.mustHit.find(x => x.id === pointId);
  return step === undefined || m === undefined ? null : { step, short: m.short };
}

/** A fault's point as the strips name it: its short label ('pocket check', 'MOI'), else its saved label. */
const shortOf = (f: Fault, steps: Step[]): string => pointOf(steps, f.point)?.short ?? f.label;

/** '3 to fix'; 'Nothing to fix this run.' for none (spec §7). */
export function verdict(nToFix: number): string {
  return nToFix === 0 ? 'Nothing to fix this run.' : `${nToFix} to fix`;
}

/** The steps counted (19, or a drill's 3) less each step that has an active fault or was tapped, each once. */
export function stepsCleanOf(r: RunRecord, steps: Step[]): number {
  const tapped = r.tapped.flatMap(id => { const st = stepById(steps, id); return st === undefined ? [] : [st.order]; });
  const dirty = new Set([...activeFaults(r).map(f => f.step), ...tapped].filter(o => inRange(r, o)));
  return Math.max(0, r.stepsTotal - dirty.size);
}

export interface Figures { time: string; rbs: string; rbsOk: boolean; steps: string; total: string }

/** The figures row: time used '17:42' ("—" when the clock never started), RBS done '2:41' ("—" with none; a late one
 *  rounds up, as the clock line shows it, so 3:00.4 reads '3:01'), `rbsOk` by 3:00 exactly as the clock's ✓, and steps
 *  clean of the total. */
export function figuresOf(r: RunRecord, steps: Step[]): Figures {
  return {
    time: clockRan(r) ? formatMmSs(r.usedMs) : '—',
    rbs: r.rbsMs === null ? '—' : rbsShown(r.rbsMs),
    rbsOk: rbsInTime(r.rbsMs),
    steps: String(stepsCleanOf(r, steps)),
    total: String(r.stepsTotal),
  };
}

/**
 * What went well, at most 4 lines, in this order, each only when it holds (and only for a step that was graded):
 * 1. "RBS done in 2:41." for an RBS by 3:00;
 * 2. "Every RBS region, in order." for an RBS with no active fault and never missed (a disputed miss still wasn't said);
 * 3. "Right oxygen: nasal cannula 2 L/min." for a right oxygen, with no Wrong oxygen fault counted;
 * 4. "Standby call with all of SRACIE." for all six letters lit;
 * 5. "Every step clean.".
 */
export function wentWell(r: RunRecord, steps: Step[]): string[] {
  const active = activeFaults(r);
  const out: string[] = [];
  const rbsGraded = graded(r, steps, RBS_STEP);
  if (rbsGraded && r.rbsMs !== null && rbsInTime(r.rbsMs)) out.push(`RBS done in ${rbsShown(r.rbsMs)}.`);
  if (rbsGraded && !active.some(f => f.point === RBS_POINT) && !r.faults.some(f => f.point === RBS_POINT && f.kind === 'missed')) {
    out.push('Every RBS region, in order.');
  }
  const oxygenSteps = [...steps].sort((a, b) => a.order - b.order).filter(st => st.mustHit.some(m => m.check === 'oxygen'));
  const oxygenPoints = oxygenSteps.flatMap(st => st.mustHit.filter(m => m.check === 'oxygen').map(m => `${st.id}/${m.id}`));
  const o = r.oxygen;
  const first = oxygenSteps[0];
  if (o !== null && o.right && first !== undefined && graded(r, steps, first.id)
    && !active.some(f => f.kind === 'wrong' && oxygenPoints.includes(f.point))) {
    out.push(`Right oxygen: ${describeOxygen({ device: o.device, flow: o.flow, flowMax: null })}.`);
  }
  const lit = r.record?.sracie ?? [];
  if (graded(r, steps, NOTIFICATION) && SRACIE.every(x => lit.includes(x.letter))) out.push('Standby call with all of SRACIE.');
  if (r.stepsTotal > 0 && stepsCleanOf(r, steps) === r.stepsTotal) out.push('Every step clean.');
  return out.slice(0, 4);
}

/** The timed steps' first times, in seconds. Only timed steps get one (ruling T10); a step since gone still counts. */
function timedStepsS(r: RunRecord, steps: Step[]): number[] {
  return Object.entries(r.stepTimes).filter(([id]) => stepById(steps, id)?.timed !== false).map(([, ms]) => ms / 1000);
}

/** The run's end on the strips: the standby call, else the time used, else none (the clock never started). */
function endOf(r: RunRecord): { s: number; label: string } | null {
  if (r.standbyMs !== null) return { s: r.standbyMs / 1000, label: `Standby ${formatMmSs(r.standbyMs)}` };
  return clockRan(r) ? { s: r.usedMs / 1000, label: `End ${formatMmSs(r.usedMs)}` } : null;
}

/** The debrief's replay: the call steps reached, the timed steps, the end, and a marker per active fault, numbered from
 *  1 as the fix list is. */
export function replayOf(r: RunRecord, steps: Step[]): Replay {
  const end = endOf(r);
  return {
    callSteps: r.reached.filter(o => o >= 1 && o <= CALL_STEPS),
    stepsS: timedStepsS(r, steps),
    endS: end?.s ?? null,
    endLabel: end?.label ?? null,
    markers: activeFaults(r).map((f, i) => ({ n: i + 1, kind: f.kind, atS: f.atMs === null ? null : f.atMs / 1000, step: f.step })),
  };
}

/** Where a marker sits, in words: 'at 3:20', 'in the Call segment', or 'before the clock started'. */
const whereOf = (f: Fault): string =>
  f.atMs !== null ? `at ${formatShort(f.atMs)}` : f.step <= CALL_STEPS ? 'in the Call segment' : 'before the clock started';

/** The replay's text, for its role="img": the segments, each marker drawn (1 to 8, and how many more the fix list
 *  holds), then the standby call, the end, or "The clock never started.". */
export function replaySummary(r: RunRecord, steps: Step[]): string {
  const faults = activeFaults(r);
  const drawn = faults.slice(0, REPLAY_MARKERS)
    .map((f, i) => `Marker ${i + 1}, ${shortOf(f, steps)}, ${FAULT_WORD[f.kind].toLowerCase()}, ${whereOf(f)}.`);
  const rest = faults.length - drawn.length;
  const more = rest > 0 ? [`${rest} more ${rest === 1 ? 'fault is' : 'faults are'} in the fix list.`] : [];
  const end = r.standbyMs !== null ? `Standby call at ${formatMmSs(r.standbyMs)}.`
    : clockRan(r) ? `Ended at ${formatMmSs(r.usedMs)}.` : 'The clock never started.';
  return [REPLAY_INTRO, ...drawn, ...more, end].join(' ');
}

/** The fault Today marks: the headline's point if this run has it with a time, else the run's first timed active one. */
function todayFault(r: RunRecord, h: Headline | null): (Fault & { atMs: number }) | null {
  const timed = activeFaults(r).filter((f): f is Fault & { atMs: number } => f.atMs !== null);
  return (h === null ? undefined : timed.find(f => f.point === h.point)) ?? timed[0] ?? null;
}

/** Today's strip of the run (Task 18): the replay's timed steps and end, and one marker, labelled 'Pocket check'. */
export function todayTraceOf(r: RunRecord, steps: Step[], h: Headline | null): StripTrace {
  const end = endOf(r);
  const f = todayFault(r, h);
  return {
    stepsS: timedStepsS(r, steps),
    endS: end?.s ?? null,
    endLabel: end?.label ?? null,
    marker: f === null ? null : { s: f.atMs / 1000, label: capitalise(shortOf(f, steps)), kind: f.kind },
  };
}

/** "Run strip, 0 to 20 minutes: 15 steps; pocket check missed at about 3:20; standby call at 17:42." (or "no standby
 *  call"), for Today's strip. */
export function todayStripLabel(r: RunRecord, steps: Step[], h: Headline | null): string {
  const k = timedStepsS(r, steps).length;
  const f = todayFault(r, h);
  const parts = [`${k} ${k === 1 ? 'step' : 'steps'}`];
  if (f !== null) parts.push(`${shortOf(f, steps)} ${FAULT_WORD[f.kind].toLowerCase()} at about ${formatShort(f.atMs)}`);
  parts.push(r.standbyMs !== null ? `standby call at ${formatMmSs(r.standbyMs)}` : 'no standby call');
  return `Run strip, 0 to 20 minutes: ${parts.join('; ')}.`;
}

/** The run's mode as the case line ends: 'Coached', 'Exam'; a drill's range in the app's step-range words, 'Drill on
 *  steps 11 to 13', 'Drill on steps 18 and 19' (stepsPhrase, as the End confirm and the tapped line say it). */
function modeOf(r: RunRecord): string {
  if (r.drill) {
    if (r.drillRange === null) return 'Drill';
    const [from, to] = r.drillRange;
    const phrase = stepsPhrase(Array.from({ length: Math.max(1, to - from + 1) }, (_, i) => from + i));
    return `Drill on ${phrase.charAt(0).toLowerCase()}${phrase.slice(1)}`;
  }
  return r.mode === 'exam' ? 'Exam' : 'Coached';
}

/** 'Breathlessness, Ang Mo Kio. Coached.'; 'A removed case. Coached.' once its case has left this phone. */
export function caseLine(r: RunRecord, c: Case | null): string {
  return `${c === null ? 'A removed case' : `${c.complaint}, ${c.area}`}. ${modeOf(r)}.`;
}

/** 'Suspected COPD. Mdm Tan, 72.'; for a case gone from this phone, why it has no drill. */
export function verdictSub(c: Case | null): string {
  return c === null ? "This case isn't on this phone any more, so it can't be drilled."
    : `Suspected ${c.expected.decision.suspected}. ${c.patient.callName}, ${c.patient.age}.`;
}

/** The record with `point` set aside ("Not what I meant") or counted again ("Count it again"). Its counted points
 *  (`missed`, `wrong`, `order`, `phrase`) follow, as endRun keeps them: the points of the faults still counted. */
export function withDispute(r: RunRecord, point: string, disputed: boolean): RunRecord {
  const disputes = disputed ? (r.disputes.includes(point) ? r.disputes : [...r.disputes, point]) : r.disputes.filter(d => d !== point);
  const next = { ...r, disputes };
  const keys = (kind: FaultKind) => [...new Set(activeFaults(next).filter(f => f.kind === kind).map(f => f.point))];
  return { ...next, missed: keys('missed'), wrong: keys('wrong'), order: keys('order'), phrase: keys('phrase') };
}

/** A fix row's step: 'Step 12, Rapid body survey.' with the step's notes link; 'Step 12.' and none once the point has
 *  left the steps. The text is null where the fault's detail already names the step as a whole phrase ('step 6', never
 *  'step 12' for step 1): an Order detail does, in both its forms ("…It belongs to step 6, Introduction.", "Done out of
 *  order within step 6, Introduction."), so its row names the step once, as mockup screen 3's does. The link stays. */
export function fixStep(f: Fault, steps: Step[]): { text: string | null; notesRef: string | null } {
  const p = pointOf(steps, f.point);
  const order = p?.step.order ?? f.step;
  const named = f.detail !== null && new RegExp(`\\bstep ${order}\\b`, 'i').test(f.detail);
  const text = named ? null : p === null ? `Step ${order}.` : `Step ${order}, ${p.step.name}.`;
  return { text, notesRef: p?.step.notesRef ?? null };
}

/** A fix row's detail, with the case's oxygen teaching note (ruling P37: up to 567 characters) folded out of a Wrong
 *  fault's, so the row stays short and the note is a tap away. A case gone from the phone leaves the detail whole. */
export function fixDetail(f: Fault, c: Case | null): { text: string | null; note: string | null } {
  const note = c?.expected.oxygen.note;
  const d = f.detail;
  if (d === null || note === undefined || f.kind !== 'wrong' || !d.endsWith(note)) return { text: d, note: null };
  const text = d.slice(0, d.length - note.length).trim();
  return { text: text === '' ? null : text, note };
}

/** "Tapped from the step list: Step 6. Not counted." for the tapped steps still in the steps; null for none. */
export function tappedLine(r: RunRecord, steps: Step[]): string | null {
  const orders = r.tapped.flatMap(id => { const st = stepById(steps, id); return st === undefined ? [] : [st.order]; });
  return orders.length === 0 ? null : `Tapped from the step list: ${stepsPhrase(orders)}. Not counted.`;
}

/** The drill's chain still to drill: its step ids still in the steps, in order. */
export function chainOf(r: RunRecord, steps: Step[]): string[] {
  return r.drillChain.filter(id => stepById(steps, id) !== undefined);
}

/** The vitals table's columns, in the case record's order. */
export const VITAL_COLUMNS: readonly { key: VitalKey; label: string }[] = [
  { key: 'spo2', label: 'SpO2' }, { key: 'pr', label: 'PR' }, { key: 'rr', label: 'RR' }, { key: 'bp', label: 'BP' },
  { key: 'temp', label: 'Temp' }, { key: 'crt', label: 'CRT' }, { key: 'skin', label: 'Skin' },
];

/** A vitals table row: its time ('05:00', 'Call' before the clock, 'Drill' in a drill) and its readings, as shown. */
export interface VitalsRow { time: string; cells: Partial<Record<VitalKey, string>> }

const isVital = (x: Reading): x is Reading & { key: VitalKey } => (VITAL_KEYS as readonly string[]).includes(x.key);
/** '90% NC', '37.2 °C', '146/86'. Readings are shown as given, never judged. */
const cellText = (x: Reading): string =>
  x.key === 'spo2' ? `${x.value}%${x.o2 === null ? '' : ` ${x.o2}`}` : x.key === 'temp' ? `${x.value} °C` : x.value;

/** The vitals table (GCS and the hypocount are in the record's list): one row per reading time, the latest of a key at
 *  a time kept. A drill's clock never starts, so its readings have no time: they fill a "Drill" row in the order they
 *  came, and a key taken again starts the next, so a re-taken SpO2 is never folded away (ruling D8, as amended in Task
 *  17's review). */
export function vitalsRows(r: RunRecord): VitalsRow[] {
  const vitals = r.readings.filter(isVital);
  const one = (x: Reading & { key: VitalKey }, time: string): VitalsRow => {
    const cells: Partial<Record<VitalKey, string>> = {};
    cells[x.key] = cellText(x);
    return { time, cells };
  };
  if (r.drill) {
    const sets: VitalsRow[] = [];
    for (const x of vitals) {
      const row = sets.at(-1);
      if (row === undefined || row.cells[x.key] !== undefined) sets.push(one(x, 'Drill'));
      else row.cells[x.key] = cellText(x);
    }
    return sets;
  }
  const rows = new Map<number | null, VitalsRow>();
  for (const x of vitals) {
    const row = rows.get(x.atMs);
    if (row === undefined) rows.set(x.atMs, one(x, x.atMs === null ? 'Call' : formatMmSs(x.atMs)));
    else row.cells[x.key] = cellText(x);
  }
  return [...rows.entries()].sort(([a], [b]) => (a ?? -1) - (b ?? -1)).map(([, row]) => row);
}

/** The transcript as the debrief shows it: a drill's opening line under the drill, as the run chat names it. Like the
 *  chat (Chat.tsx), only a system line saved under Dispatch is read for it; anyone else's line stays theirs. */
export function transcriptOf(r: RunRecord): TranscriptLine[] {
  return r.transcript.map(l => (l.who === DISPATCH && isDrillOpening(l.text) ? { ...l, who: DRILL_SPEAKER } : l));
}
