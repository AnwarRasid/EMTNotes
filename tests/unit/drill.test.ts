import { CASES, IDS, STEPS, T0, caseById, envOf, hitAll } from './sim-helpers';
import { MemoryStorage } from './helpers';
import { defaultProgress, type Fault, type RunRecord, type RunSession } from '../../src/progress/types';
import { loadProgress, saveProgress } from '../../src/progress/slots';
import { applicablePoints, pointDone } from '../../src/sim/classify';
import { fillCanonical } from '../../src/sim/replies';
import { NOT_UNDERSTOOD, disputePoint, endRun, sendLine, startRun, tapStep, unfinishedSteps } from '../../src/sim/run';
import { drillDone, drillRange, drillTargets, startDrill } from '../../src/sim/drill';

const copd = caseById('copd-amk-01');
const env = envOf('copd-amk-01');
const upTo = (order: number) => STEPS.filter(s => s.order <= order).map(s => s.id);
const stepId = (order: number) => STEPS.find(s => s.order === order)!.id;
const inRange = (s: RunSession) => STEPS.filter(st => st.order >= s.drill!.from && st.order <= s.drill!.to);
/** A drill on the step, for the case, with no chain and no source run. */
const drillOf = (target: string, caseId = 'copd-amk-01', now = T0) => startDrill(envOf(caseId), target, [], null, IDS, now);
/** The step's canonical line filled for the case, at a drill's ETA of 10 (R11). */
const canonical = (caseId: string, id: string) => {
  const st = STEPS.find(s => s.id === id)!;
  return fillCanonical(st.canonicalLine, caseById(caseId), 10, st.mustHit);
};
const send = async (s: RunSession, text: string, now = T0, caseId = 'copd-amk-01') => (await sendLine(envOf(caseId), s, text, now)).session;
const mine = (s: RunSession) => s.lines.filter(l => l.who === 'you');
const numbers = (x: unknown): number[] =>
  typeof x === 'number' ? [x] : x !== null && typeof x === 'object' ? Object.values(x).flatMap(numbers) : [];
/** Every point of the step that applies to the case is done in the session. */
const stepDone = (s: RunSession, id: string, caseId = 'copd-amk-01') =>
  applicablePoints(STEPS.filter(st => st.id === id), caseById(caseId)).every(a => pointDone(a, s));
/** Whether the session saves (a save refuses a number that isn't finite), and loads back as it was. */
function savesAndLoads(s: RunSession): boolean {
  const storage = new MemoryStorage();
  const saved = saveProgress(storage, { ...defaultProgress(), runOpen: s }, 1, new Date('2026-11-14T10:00:00.000Z'));
  expect(saved.ok).toBe(true);
  expect(loadProgress(storage).data.runOpen).toEqual(s);
  return saved.ok;
}

// ---- The brief's tests (COPD) -------------------------------------------------------------------------------

test('drillRange: one step either side of the target, clipped to the steps', () => {
  expect(drillRange(12, 19)).toEqual([11, 13]);
  expect(drillRange(1, 19)).toEqual([1, 2]);
  expect(drillRange(19, 19)).toEqual([18, 19]);
  expect(drillRange(2, 19)).toEqual([1, 3]);
});

test('startDrill on the RBS: Coached, steps 11 to 13, steps 1 to 10 filled in from the case, no clock', () => {
  const s = startDrill(env, 'rapid-body-survey', ['investigation'], 'run-0', IDS, T0);
  expect(s.mode).toBe('coached');
  expect(s.drill).toEqual({ target: 'rapid-body-survey', from: 11, to: 13, chain: ['investigation'], sourceRunId: 'run-0' });
  expect(s.lines).toEqual([
    { who: 'system', text: 'Activation: Elderly female, breathlessness. Blk 2xx Ang Mo Kio Ave 3, #07-xx.', atMs: null },
    { who: 'system', text: 'Drill on step 12, Rapid body survey. Steps 1 to 10 are filled in from the case. Start at step 11, Circulation.', atMs: null },
  ]);
  expect(s.prefilled).toEqual(upTo(10));
  expect(s.oxygen).toMatchObject({ device: 'nasal-cannula', flow: 2, right: true });
  expect(s.readings).toEqual([{ key: 'spo2', value: '90', atMs: null, o2: 'NC' }]);
  expect(s.clock.started).toBe(false);
  expect(drillDone(env, s)).toBe(false);
  expect(s).toMatchObject({ id: IDS.id, caseId: 'copd-amk-01', startedAt: IDS.startedAt, current: 11, lastAt: T0, stepTimes: {} });
});

test('every applicable point and part of a prefilled step is done, at line 0 with no time; nothing past it is', () => {
  const s = startDrill(env, 'rapid-body-survey', ['investigation'], 'run-0', IDS, T0);
  const points = applicablePoints(STEPS, copd);
  for (const a of points.filter(x => x.step.order <= 10)) {
    expect(pointDone(a, s)).toBe(true);
    expect(s.hits[a.key]).toMatchObject({ line: 0, atMs: null, missing: [] });
    for (const p of a.point.parts ?? []) expect(s.parts[`${a.key}/${p.id}`]).toMatchObject({ line: 0 });
  }
  expect(points.filter(x => x.step.order > 10).some(a => pointDone(a, s))).toBe(false);
  expect(Object.keys(s.hits).every(k => upTo(10).includes(k.split('/')[0]!))).toBe(true);
  // a prefilled oxygen point is the case's own choice, right; a prefilled MOI reads as the canonical line says it
  expect(s.hits['breathing/mask-flow']).toMatchObject({ check: 'right', chose: 'nasal cannula 2 L/min' });
  expect(s.hits['scene-evaluation/moi']!.said).toBe('MOI is suspected case of elderly female, breathlessness.');
});

test('the drill is done once every point in its range is', () => {
  const s = startDrill(env, 'rapid-body-survey', ['investigation'], 'run-0', IDS, T0);
  expect(drillDone(env, hitAll(s, STEPS, copd, ['circulation', 'rapid-body-survey']))).toBe(false);
  expect(drillDone(env, hitAll(s, STEPS, copd, ['circulation', 'rapid-body-survey', 'investigation']))).toBe(true);
});

test('endRun on a drill: a drill record of its range and chain, 3 steps, no time used', () => {
  const s = hitAll(startDrill(env, 'rapid-body-survey', ['investigation'], 'run-0', IDS, T0), STEPS, copd,
    ['circulation', 'rapid-body-survey', 'investigation']);
  const r = endRun(env, s, T0 + 300_000);
  expect(r).toMatchObject({ drill: true, drillRange: [11, 13], drillChain: ['investigation'], stepsTotal: 3, usedMs: 0 });
  expect(r.faults).toEqual([]);
  expect(r.reached).toEqual([11, 12, 13]);   // prefilled steps are left out
});

const fault = (point: string, step: number, kind: Fault['kind'] = 'missed'): Fault =>
  ({ kind, point, step, label: point, detail: null, atMs: null });
const recordWith = (faults: Fault[], disputes: string[] = []): RunRecord =>
  ({ ...endRun(env, startRun(env, 'coached', IDS, T0), T0), faults, disputes });

test('drillTargets: the steps of the active faults, each once, in step order', () => {
  const r = recordWith([fault('rapid-body-survey/pocket-check', 12), fault('scene-evaluation/moi', 4, 'phrase'),
    fault('rapid-body-survey/jvd', 12), fault('notification/sracie', 19)], ['notification/sracie']);
  expect(drillTargets(r, STEPS)).toEqual(['scene-evaluation', 'rapid-body-survey']);
});

test('drillTargets: none for a clean record; a step no longer in the steps is left out', () => {
  expect(drillTargets(recordWith([]), STEPS)).toEqual([]);
  const r = recordWith([fault('gone-step/x', 7), fault('introduction/head-grip', 6, 'order'), fault('airway/smell', 9)]);
  expect(drillTargets(r, STEPS)).toEqual(['introduction', 'airway']);
});

// ---- The drill line -------------------------------------------------------------------------------------------

test('the drill line: one filled-in step reads "Step 1", two "Steps 1 and 2", none no filled-in sentence', () => {
  expect(drillOf('scene-evaluation').lines[1]!.text)   // fix round 1, Minor 4
    .toBe('Drill on step 4, Rescue scene evaluation. Steps 1 and 2 are filled in from the case. Start at step 3, Preparation.');
  expect(drillOf('approach-patient').lines[1]!.text)
    .toBe('Drill on step 5, Approach patient. Steps 1 to 3 are filled in from the case. Start at step 4, Rescue scene evaluation.');
  expect(drillOf('preparation').lines[1]!.text)
    .toBe('Drill on step 3, Preparation. Step 1 is filled in from the case. Start at step 2, Call caller.');
  expect(drillOf('call-caller').lines[1]!.text).toBe('Drill on step 2, Call caller. Start at step 1, Respond call.');
  expect(drillOf('respond-call').lines[1]!.text).toBe('Drill on step 1, Respond call. Start at step 1, Respond call.');
  expect(drillOf('notification').lines[1]!.text)
    .toBe('Drill on step 19, Notification. Steps 1 to 17 are filled in from the case. Start at step 18, Decision point.');
  expect(drillOf('delicate-spine').lines[1]!.text)
    .toBe('Drill on step 8, Delicate spine. Steps 1 to 6 are filled in from the case. Start at step 7, LOC (AVPU).');
});

test('a drill from step 1 fills nothing in, and holds the case\'s activation line', () => {
  const s = drillOf('respond-call');
  expect(s).toMatchObject({ current: 1, prefilled: [], hits: {}, parts: {}, readings: [], oxygen: null, ecg: null,
    drill: { target: 'respond-call', from: 1, to: 2 } });
  expect(s.lines[0]).toEqual(startRun(env, 'coached', IDS, T0).lines[0]);
});

test('an unknown step cannot be drilled', () => {
  expect(() => drillOf('no-such-step')).toThrow('No step "no-such-step" to drill.');
});

// ---- Fix round 1: prefilled replies and the shared hit builder ------------------------------------------------

test('Minor 1: a prefilled step\'s text replies count as said, so re-saying preparation in an RBS drill never replays "Crew ready"', async () => {
  const s0 = drillOf('rapid-body-survey');
  // the text replies of the points that apply: COPD has no spinal injury, so the release reply, not the C-collar's
  expect(s0.played).toEqual(['respond-call#0', 'preparation#0', 'introduction#0', 'delicate-spine#4']);
  expect(drillOf('rapid-body-survey', 'fall-yishun-01').played).toEqual(['respond-call#0', 'preparation#0', 'introduction#0', 'delicate-spine#5']);
  let s = await send(s0, canonical('copd-amk-01', 'circulation'), T0 + 20_000);
  const n = s.lines.length;
  s = await send(s, canonical('copd-amk-01', 'preparation'), T0 + 30_000);
  expect(s.lines.slice(n).some(l => l.text.includes('Crew ready') || l.text.includes("You've arrived on scene"))).toBe(false);
  // as in a run whose steps 1 to 10 were tapped
  let run = startRun(env, 'coached', IDS, T0);
  for (const st of STEPS.filter(x => x.order <= 10)) run = tapStep(env, run, st.id, T0 + st.order * 1000).session;
  expect([...s0.played].sort()).toEqual([...run.played].sort());
});

test('Minor 3: a prefilled hit is the hit tap mode makes, on line 0 with no time', () => {
  for (const c of CASES) {
    const e = envOf(c.id);
    const drill = drillOf('notification', c.id);   // steps 1 to 17 prefilled
    let run = startRun(e, 'coached', IDS, T0);
    for (const st of STEPS.filter(x => x.order <= 17)) run = tapStep(e, run, st.id, T0).session;
    for (const [key, hit] of Object.entries(drill.hits)) {
      const { tapped: _, ...tappedHit } = run.hits[key]!;
      expect(hit).toEqual({ ...tappedHit, line: 0, atMs: null, during: STEPS.find(x => key.startsWith(`${x.id}/`))!.order });
    }
    expect(Object.keys(drill.hits).sort()).toEqual(Object.keys(run.hits).sort());
    for (const [key, part] of Object.entries(drill.parts)) expect(part).toEqual({ line: 0, pos: run.parts[key]!.pos });
    expect(Object.keys(drill.parts).sort()).toEqual(Object.keys(run.parts).sort());
    expect(drill.oxygen).toEqual({ ...run.oxygen!, atMs: null });
    expect(drill.ecg).toBe(run.ecg);
  }
});

test('Minor 2: drillDone is the End confirm\'s "nothing left" in a drill (unfinishedSteps)', () => {
  const s = drillOf('rapid-body-survey');
  for (const ids of [[], ['circulation'], ['circulation', 'rapid-body-survey'], ['circulation', 'rapid-body-survey', 'investigation']]) {
    const t = hitAll(s, STEPS, copd, ids);
    expect(drillDone(env, t)).toBe(unfinishedSteps(env, t).length === 0);
    expect(drillDone(env, t)).toBe(ids.length === 3);
  }
});

// ---- Prefilled findings ---------------------------------------------------------------------------------------

test('prefilled oxygen: the case\'s device at its lowest flow, and the SpO2 read on it (COPD and asthma)', () => {
  const c = drillOf('circulation');   // steps 1 to 9 prefilled: no breathing yet
  expect(c.oxygen).toBeNull();
  expect(c.readings).toEqual([]);
  const s = drillOf('rapid-body-survey', 'copd-amk-01');
  expect(s.oxygen).toEqual({ device: 'nasal-cannula', flow: 2, atMs: null, right: true });
  expect(s.readings).toEqual([{ key: 'spo2', value: '90', atMs: null, o2: 'NC' }]);
  const a = drillOf('rapid-body-survey', 'asthma-tampines-01');
  expect(a.oxygen).toEqual({ device: 'nebuliser-mask', flow: 6, atMs: null, right: true });
  expect(a.readings).toEqual([{ key: 'spo2', value: '96', atMs: null, o2: 'Neb' }]);
  expect(a.hits['breathing/mask-flow']).toMatchObject({ check: 'right', chose: 'nebuliser mask 6 L/min' });
});

test('prefilled investigation: the case\'s ECG, and a hypocount reading to one decimal (ruling P21)', () => {
  const s = drillOf('oxygen');   // from 14: steps 1 to 13 prefilled
  expect(s.ecg).toBe('12-lead');
  expect(s.readings.filter(r => r.key === 'hypocount')).toEqual([{ key: 'hypocount', value: '6.8', atMs: null, o2: null }]);
  const rta = drillOf('oxygen', 'rta-toapayoh-01');
  expect(rta.ecg).toBe('4-lead');
  expect(rta.hits['investigation/ecg']).toMatchObject({ check: 'right', chose: '4-lead' });
  expect(rta.readings.find(r => r.key === 'hypocount')!.value).toBe('6.0');
  expect(endRun(envOf('rta-toapayoh-01'), rta, T0).record!.hypocount).toBe('6.0 mmol/L');
  expect(drillOf('vital-signs').ecg).toBeNull();   // from 13: the investigation is the drill's own
});

test('prefilled vital signs: the seven buddy readings on the oxygen given, and the GCS of e + v + m (P21\'s drill exception)', () => {
  const s = drillOf('airway-recheck');   // from 15: steps 1 to 14 prefilled
  expect(s.readings).toEqual([
    { key: 'spo2', value: '90', atMs: null, o2: 'NC' },
    { key: 'hypocount', value: '6.8', atMs: null, o2: null },
    { key: 'gcs', value: '15', atMs: null, o2: null },
    { key: 'temp', value: '37.2', atMs: null, o2: null },
    { key: 'rr', value: '28', atMs: null, o2: null },
    { key: 'skin', value: 'pale, warm, sweaty', atMs: null, o2: null },
    { key: 'spo2', value: '90', atMs: null, o2: 'NC' },
    { key: 'pr', value: '112', atMs: null, o2: null },
    { key: 'bp', value: '146/86', atMs: null, o2: null },
    { key: 'crt', value: 'under 2 s', atMs: null, o2: null },
  ]);
  expect(drillOf('airway-recheck', 'hypo-hougang-01').readings.find(r => r.key === 'gcs')!.value).toBe('14');   // 4 + 4 + 6
  expect(drillOf('oxygen').readings.some(r => r.key === 'gcs')).toBe(false);   // from 14: vital signs are the drill's own
});

// ---- Arrival (controller addition 1) --------------------------------------------------------------------------

test('arrival: a drill from step 4 on has arrived, with nothing held; from step 3 or before it hasn\'t', () => {
  for (const c of CASES) {
    for (const st of STEPS) {
      const s = drillOf(st.id, c.id);
      expect(s.arrived).toBe(s.drill!.from >= 4);
      expect(s.held).toBeNull();
    }
  }
});

test('a drill from step 2: the call, then preparation (the arrival), then the first scene line read in full', async () => {
  let s = drillOf('preparation');
  expect(s).toMatchObject({ current: 2, arrived: false, prefilled: ['respond-call'] });
  s = await send(s, canonical('copd-amk-01', 'call-caller'), T0 + 20_000);
  expect(stepDone(s, 'call-caller')).toBe(true);
  expect(s.arrived).toBe(false);
  s = await send(s, canonical('copd-amk-01', 'preparation'), T0 + 40_000);
  expect(stepDone(s, 'preparation')).toBe(true);
  expect(s.arrived).toBe(true);
  s = await send(s, canonical('copd-amk-01', 'scene-evaluation'), T0 + 60_000);
  expect(stepDone(s, 'scene-evaluation')).toBe(true);
  expect(mine(s).at(-1)!.route).not.toContain(NOT_UNDERSTOOD);
  expect(s.held).toBeNull();
  expect(drillDone(env, s)).toBe(true);
});

test('a drill from step 3 reads its preparation line, then the first scene line in full', async () => {
  let s = drillOf('scene-evaluation');
  expect(s).toMatchObject({ current: 3, arrived: false, prefilled: ['respond-call', 'call-caller'] });
  s = await send(s, canonical('copd-amk-01', 'preparation'), T0 + 20_000);
  expect(stepDone(s, 'preparation')).toBe(true);
  expect(mine(s).at(-1)!.route).not.toContain(NOT_UNDERSTOOD);
  expect(s.arrived).toBe(true);
  s = await send(s, canonical('copd-amk-01', 'scene-evaluation'), T0 + 40_000);
  expect(stepDone(s, 'scene-evaluation')).toBe(true);
  expect(mine(s).at(-1)!.route).not.toContain(NOT_UNDERSTOOD);
});

test('a drill from step 3 that skips preparation: its first scene line is still read, never dropped as the phone\'s', async () => {
  const s = await send(drillOf('scene-evaluation'), canonical('copd-amk-01', 'scene-evaluation'), T0 + 20_000);
  expect(stepDone(s, 'scene-evaluation')).toBe(true);
  expect(s).toMatchObject({ arrived: true, held: null });
});

test('a drill from step 4: on scene from the start, its first line read in full', async () => {
  const s0 = drillOf('approach-patient');
  expect(s0).toMatchObject({ current: 4, arrived: true, held: null });
  const s = await send(s0, canonical('copd-amk-01', 'scene-evaluation'), T0 + 20_000);
  expect(stepDone(s, 'scene-evaluation')).toBe(true);
  expect(mine(s).at(-1)!.route).not.toContain(NOT_UNDERSTOOD);
  expect(s.held).toBeNull();
});

test('a drill from step 12: on scene from the start, its first line read in full', async () => {
  const s0 = drillOf('investigation');
  expect(s0).toMatchObject({ current: 12, arrived: true, held: null });
  const s = await send(s0, canonical('copd-amk-01', 'rapid-body-survey'), T0 + 20_000);
  expect(stepDone(s, 'rapid-body-survey')).toBe(true);
  expect(mine(s).at(-1)!.route).not.toContain(NOT_UNDERSTOOD);
});

// ---- Finished, untimed, finite --------------------------------------------------------------------------------

test('a disputed point counts as settled, so the drill can still finish itself (R9)', () => {
  const s = hitAll(drillOf('rapid-body-survey'), STEPS, copd, ['circulation', 'rapid-body-survey']);
  const left = applicablePoints(STEPS.filter(st => st.id === 'investigation'), copd).map(a => a.key);
  expect(drillDone(env, left.reduce((x, k) => disputePoint(x, k, T0), s))).toBe(true);
  expect(drillDone(env, left.slice(1).reduce((x, k) => disputePoint(x, k, T0), s))).toBe(false);
});

test('drillDone is false for a run that is not a drill', () => {
  const s = hitAll(startRun(env, 'coached', IDS, T0), STEPS, copd, STEPS.map(st => st.id));
  expect(drillDone(env, s)).toBe(false);
});

test('finite numbers: a drill started at a time that is not one still saves, every number in it finite', () => {
  for (const now of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const s = drillOf('rapid-body-survey', 'copd-amk-01', now);
    expect(s.lastAt).toBe(0);
    expect(numbers(s).every(Number.isFinite)).toBe(true);
    expect(savesAndLoads(s)).toBe(true);
  }
});

// ---- The sweep: every step drilled in every case --------------------------------------------------------------

// Each step of the range in order: its canonical line, filled for the case at the drill's ETA. Task 11b: each case's
// line says its conditional points too ({say:<pointId>}: "remove head grip", "head tilt, chin lift", "monitor closely",
// the bleed control, the C-collars, the jaw thrust, the RTA's PPE and limb, "suspected hypoglycaemia"), so the line
// alone finishes its step, with no paraphrase and no Order fault (the bleed control said in the notes' order, P07).
describe.each(CASES.map(c => c.id))('a drill in %s', caseId => {
  const e = envOf(caseId);
  const c = caseById(caseId);
  test.each(STEPS.map(st => [st.order, st.id] as const))('on step %i (%s) finishes by typing its range\'s lines', async (order, id) => {
    let s = drillOf(id, caseId);
    expect(numbers(s).every(Number.isFinite)).toBe(true);
    expect(savesAndLoads(s)).toBe(true);
    let at = T0;
    for (const st of inRange(s)) {
      expect(drillDone(e, s)).toBe(false);
      s = await send(s, canonical(caseId, st.id), at += 20_000, caseId);
      expect(applicablePoints([st], c).filter(a => !pointDone(a, s)).map(a => a.key)).toEqual([]);
      expect(stepDone(s, st.id, caseId)).toBe(true);
      expect(numbers(s).every(Number.isFinite)).toBe(true);
    }
    expect(drillDone(e, s)).toBe(true);
    expect(s.clock.started).toBe(false);
    expect(s.stepTimes).toEqual({});
    expect(savesAndLoads(s)).toBe(true);
    const r = endRun(e, s, T0 + 100_000);
    expect(r).toMatchObject({ drill: true, usedMs: 0, drillRange: drillRange(order, 19) });
    expect(r.faults.filter(f => f.kind === 'missed')).toEqual([]);
    expect(r.faults.filter(f => f.kind === 'order')).toEqual([]);
  });
  test.each(STEPS.map(st => [st.order, st.id] as const))('on step %i (%s) finishes by tapping its range\'s steps', (_order, id) => {
    let s = drillOf(id, caseId);
    for (const st of inRange(s)) {
      expect(drillDone(e, s)).toBe(false);
      s = tapStep(e, s, st.id, T0 + 20_000).session;
    }
    expect(drillDone(e, s)).toBe(true);
    expect(s.clock.started).toBe(false);
    expect(numbers(s).every(Number.isFinite)).toBe(true);
    expect(savesAndLoads(s)).toBe(true);
    // a step outside the range can't be tapped
    const outside = [s.drill!.from - 1, s.drill!.to + 1].filter(o => o >= 1 && o <= 19).map(stepId);
    for (const x of outside) expect(tapStep(e, s, x, T0 + 40_000).session).toBe(s);
  });
});
