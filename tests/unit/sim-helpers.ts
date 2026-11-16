// Shared fixtures for the simulator tests: the shipped steps and cases, a grading context at any step, and run sessions
// with points hit.
// Playwright's seed helper re-exports from this file (Tasks 10, 17 and 20), so it runs in plain Node too: it imports
// nothing from vitest and reads its JSON with fs, not JSON imports (ruling P32). Paths resolve from this file, so the
// working directory doesn't matter.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as v from 'valibot';
import { CaseIndexSchema, CaseSchema, StepsDocSchema, conditionHolds, type Case, type MustHit, type Step } from '../../src/data/schema';
import type { PointHit, Reading, RunMode, RunRecord, RunSession } from '../../src/progress/types';
import type { GradeContext, Grader } from '../../src/sim/grader';
import { caseSlots } from '../../src/sim/match';
import { describeOxygen } from '../../src/sim/oxygen';
import { endRun, envFor, sendLine, startRun, tapStep, type RunEnv } from '../../src/sim/run';

// A plain path, not `new URL('…', import.meta.url)`: Vite rewrites that pattern into a dev-server asset URL.
const DATA = resolve(dirname(fileURLToPath(import.meta.url)), '../../public/data');
const data = (path: string): unknown => JSON.parse(readFileSync(resolve(DATA, path), 'utf8'));

export const STEPS: Step[] = v.parse(StepsDocSchema, data('steps.json')).steps;
/** Every case, in index order. */
export const CASES: Case[] = v.parse(CaseIndexSchema, data('cases/index.json')).cases.map(e => v.parse(CaseSchema, data(e.file)));

export function caseById(id: string): Case {
  const c = CASES.find(x => x.id === id);
  if (c === undefined) throw new Error(`No case "${id}".`);
  return c;
}

/**
 * The grading context with the run on `stepId`. By default `done` holds every point of the steps before it that applies
 * to the case, as a run that reached the step would have them; pass `done` to set it outright. `pending` (points of
 * earlier steps still to do) is empty unless given, so a fixture reads as a run with nothing left behind.
 */
export function ctxAt(stepId: string, caseId = 'copd-amk-01', eta = 6, done?: string[], pending: string[] = []): GradeContext {
  const step = STEPS.find(s => s.id === stepId);
  if (step === undefined) throw new Error(`No step "${stepId}".`);
  const c = caseById(caseId);
  const before = STEPS.filter(s => s.order < step.order)
    .flatMap(s => s.mustHit.filter(m => m.when === undefined || conditionHolds(c, m.when)).map(m => `${s.id}/${m.id}`));
  return { case: c, steps: STEPS, current: step.order, slots: caseSlots(c, eta), done: new Set(done ?? before), pending: new Set(pending), eta };
}

/** Every 'step/point' and 'step/point.part' the sentences read, and the required words each point still lacks. Shared by
 *  the canonical sweeps in paraphrases.test.ts and soft-breaks.test.ts (Plan 3 Task 4). */
export const readOf = (sentences: { points: { step: string; point: string; parts: string[]; whole: boolean; missing: string[] }[] }[]) => ({
  whole: new Set(sentences.flatMap(x => x.points.filter(p => p.whole).map(p => `${p.step}/${p.point}`))),
  parts: new Set(sentences.flatMap(x => x.points.flatMap(p => p.parts.map(id => `${p.step}/${p.point}.${id}`)))),
  missing: sentences.flatMap(x => x.points.filter(p => p.missing.length > 0).map(p => `${p.step}/${p.point}: ${p.missing.join(', ')}`)),
});

// ---- Runs (Tasks 9 and 10) ------------------------------------------------------------------------------------

/** The run engine's start time in the tests, and the ids every test run takes. */
export const T0 = 1_000_000;
export const IDS = { id: 'run-1', startedAt: '2026-11-13T14:00:00.000Z' };

/** The run environment for a case: the shipped steps, the case and (by default) the keyword grader. */
export function envOf(caseId: string, grader?: Grader): RunEnv {
  return envFor(STEPS, caseById(caseId), grader);
}

/** A new run's session: the activation line and nothing hit (ruling D2: startRun itself, never built by hand). */
export function blankSession(caseId: string, mode: RunMode = 'coached'): RunSession {
  return startRun(envOf(caseId), mode, IDS, T0);
}

/** One input to a scripted run: a typed line, or a tap on a step in the step list. */
export type PlayInput = string | { tap: string };

/**
 * A run of the case played from its start at `at` (T0 by default), each input `gapMs` (20 000 by default) after the
 * one before, the first `gapMs` after the start. Returns the open session.
 */
export async function playRun(caseId: string, mode: RunMode, inputs: PlayInput[],
  opts: { at?: number; gapMs?: number } = {}): Promise<RunSession> {
  const env = envOf(caseId);
  const at = opts.at ?? T0;
  const gap = opts.gapMs ?? 20_000;
  let s = startRun(env, mode, IDS, at);
  for (const [i, input] of inputs.entries()) {
    const now = at + (i + 1) * gap;
    s = typeof input === 'string' ? (await sendLine(env, s, input, now)).session : tapStep(env, s, input.tap, now).session;
  }
  return s;
}

/** The record of a scripted run (playRun), ended one `gapMs` after its last input. */
export async function recordOf(caseId: string, mode: RunMode, inputs: PlayInput[],
  opts: { at?: number; gapMs?: number } = {}): Promise<RunRecord> {
  const s = await playRun(caseId, mode, inputs, opts);
  return endRun(envOf(caseId), s, (opts.at ?? T0) + (inputs.length + 1) * (opts.gapMs ?? 20_000));
}

/** A check point's right choice for the case, as a run records it in `chose`; null for a point with no check. */
function rightChoice(m: MustHit, c: Case): string | null {
  if (m.check === 'ecg') return c.expected.ecg;
  if (m.check === 'arm') return `${c.findings.investigation.bpArm} arm`;   // Plan 3 T2: the case's own BP arm
  if (m.check !== 'oxygen') return null;
  const o = c.expected.oxygen;
  return describeOxygen({ device: o.device, flow: o.flowMin, flowMax: o.flowMax === o.flowMin ? null : o.flowMax });
}

/** A hit said right: in its own step, nothing missing, a check point's choice right. */
const rightHit = (step: Step, m: MustHit, c: Case, line: number): PointHit => ({
  line, pos: 0, atMs: null, during: step.order, said: m.label, missing: [],
  check: m.check === undefined ? null : 'right', chose: rightChoice(m, c),
});

/**
 * The session with every point of the listed steps that applies to the case done, with all its parts, in step and
 * point order: one `you` line per point (its label as the text), each hit on its own line. `current` rises to the
 * highest listed step.
 */
export function hitAll(s: RunSession, steps: Step[], c: Case, stepIds: string[]): RunSession {
  const listed = steps.filter(st => stepIds.includes(st.id)).sort((a, b) => a.order - b.order);
  const lines = [...s.lines];
  const hits = { ...s.hits };
  const parts = { ...s.parts };
  for (const st of listed) {
    for (const m of st.mustHit.filter(x => x.when === undefined || conditionHolds(c, x.when))) {
      const key = `${st.id}/${m.id}`;
      const line = lines.length;
      lines.push({ who: 'you', text: m.label, atMs: null });
      hits[key] = rightHit(st, m, c, line);
      (m.parts ?? []).forEach((p, pos) => { parts[`${key}/${p.id}`] = { line, pos }; });
    }
  }
  return { ...s, lines, hits, parts, current: Math.max(s.current, ...listed.map(st => st.order)) };
}

/**
 * The session with one hit on `key` ('stepId/pointId') at `line`: pos 0, atMs null, during the point's own step, said
 * right, unless `extra` says otherwise. It adds no line.
 */
export function hitAt(s: RunSession, key: string, line: number, extra: Partial<PointHit> = {}): RunSession {
  const [stepId, pointId] = key.split('/');
  const step = STEPS.find(x => x.id === stepId);
  const m = step?.mustHit.find(x => x.id === pointId);
  if (step === undefined || m === undefined) throw new Error(`No point "${key}".`);
  return { ...s, hits: { ...s.hits, [key]: { ...rightHit(step, m, caseById(s.caseId), line), ...extra } } };
}

// ---- The debrief's sample runs (Task 17) ------------------------------------------------------------------------

export const POCKET = 'rapid-body-survey/pocket-check';
export const HEAD_GRIP = 'introduction/head-grip';
export const MOI = 'scene-evaluation/moi';

/** When the sample run first reached each timed step, in clock ms: Approach at 0:00, RBS at 2:00, the investigation at
 *  3:20 (where the pocket check counts as missed) and the notification at 16:40. */
export const DEBRIEF_STEP_TIMES: Readonly<Record<string, number>> = {
  'approach-patient': 0, introduction: 10_000, 'loc-avpu': 20_000, 'delicate-spine': 35_000, airway: 60_000,
  breathing: 75_000, circulation: 100_000, 'rapid-body-survey': 120_000, investigation: 200_000, 'vital-signs': 300_000,
  oxygen: 420_000, 'airway-recheck': 540_000, position: 600_000, 'decision-point': 700_000, notification: 1_000_000,
};

/** The buddies' readings in the sample run: SpO2 on room air at 1:20, the vital signs at 5:00, SpO2 on the cannula at
 *  7:00. */
const DEBRIEF_READINGS: Reading[] = [
  { key: 'spo2', value: '86', atMs: 80_000, o2: 'RA' },
  { key: 'temp', value: '37.2', atMs: 300_000, o2: null }, { key: 'rr', value: '28', atMs: 300_000, o2: null },
  { key: 'skin', value: 'pale, warm, sweaty', atMs: 300_000, o2: null }, { key: 'spo2', value: '90', atMs: 300_000, o2: 'NC' },
  { key: 'pr', value: '112', atMs: 300_000, o2: null }, { key: 'bp', value: '146/86', atMs: 300_000, o2: null },
  { key: 'crt', value: 'under 2 s', atMs: 300_000, o2: null },
  { key: 'spo2', value: '90', atMs: 420_000, o2: 'NC' },
];

/**
 * The debrief's sample COPD run, as Task 17's tests and screenshots seed it (pure, so Playwright's Node can build it):
 * every point that applies done in step and point order (hitAll), the clock at 17:42 and paused, the timed steps
 * reached at DEBRIEF_STEP_TIMES, RBS done at 2:41, the standby call at 17:42, the cannula at 2 L/min (right) and the
 * readings above. With `faults` (the default) three faults, as the mockup's debrief: the pocket check never said
 * (Missed, at 3:20), the head grip said in the sound-out's line during Approach (Order, at 0:00), and MOI said without
 * "suspected" before the clock started (Phrase).
 */
export function debriefSession(opts: { faults?: boolean } = {}): RunSession {
  const c = caseById('copd-amk-01');
  const done = hitAll(blankSession(c.id), STEPS, c, STEPS.map(s => s.id));
  const hits = { ...done.hits };
  const parts = { ...done.parts };
  if (opts.faults ?? true) {
    delete hits[POCKET];
    for (const k of Object.keys(parts)) if (k.startsWith(`${POCKET}/`)) delete parts[k];
    const sound = hits['approach-patient/sound-out'];
    const grip = hits[HEAD_GRIP];
    const moi = hits[MOI];
    if (sound === undefined || grip === undefined || moi === undefined) throw new Error('The sample run lost a point.');
    hits[HEAD_GRIP] = { ...grip, line: sound.line, pos: 1, during: 5, atMs: 0 };
    hits[MOI] = { ...moi, missing: ['suspected'] };
  }
  return {
    ...done, hits, parts, current: 19, arrived: true,
    clock: { started: true, bankedMs: 1_062_000, runningSince: null },
    stepTimes: { ...DEBRIEF_STEP_TIMES }, rbsMs: 161_000, standbyMs: 1_062_000,
    readings: DEBRIEF_READINGS.map(r => ({ ...r })),
    oxygen: { device: 'nasal-cannula', flow: 2, atMs: 75_000, right: true }, ecg: c.expected.ecg,
  };
}

/** The sample run's record (debriefSession, ended at 17:42). */
export function debriefRecord(opts: { faults?: boolean } = {}): RunRecord {
  return endRun(envOf('copd-amk-01'), debriefSession(opts), T0 + 1_062_000);
}
