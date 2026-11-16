import { caseById, ctxAt, STEPS } from './sim-helpers';
import type { MustHit, Reply, Step } from '../../src/data/schema';
import { arrivedIn, detectAddressee, keywordGrader, readSentence, replyRole, stepPriority, type GradeContext } from '../../src/sim/grader';
import { caseSlots } from '../../src/sim/match';

const range = (from: number, to: number) => Array.from({ length: Math.abs(to - from) + 1 }, (_, i) => (from <= to ? from + i : from - i));
/** ctxAt with one more point done. */
const plus = (stepId: string, key: string) => ctxAt(stepId, 'copd-amk-01', 6, [...ctxAt(stepId).done, key]);

describe('stepPriority', () => {
  test('the current step, the next two, back down to step 1, then the rest ahead', () => {
    expect(stepPriority(10, 19)).toEqual([10, 11, 12, 9, 8, 7, 6, 5, 4, 3, 2, 1, 13, 14, 15, 16, 17, 18, 19]);
    expect(stepPriority(1, 19)).toEqual(range(1, 19));
    expect(stepPriority(19, 19)).toEqual(range(19, 1));
  });
});

describe('detectAddressee', () => {
  const d = (line: string) => detectAddressee(line, 'Mdm Tan');
  test('names who a line is for', () => {
    expect(d('arm buddy, spo2 please')).toBe('armBuddy');
    expect(d('buddy, do head grip')).toBe('buddy');
    expect(d('sir, did you fall?')).toBe('patient');
    expect(d('mdm tan, any pain?')).toBe('patient');
    expect(d('fmv 123 to ops ctr, standby message, over')).toBe('opsCtr');
    expect(d('crew, please don latex gloves')).toBe('crew');
    expect(d('checking the radial pulse')).toBeNull();
  });
  test("the last word of the patient's call name is the patient", () => {
    expect(detectAddressee('tan, any pain?', 'Mdm Tan')).toBe('patient');
    expect(detectAddressee('tan, any pain?', 'Mr Lim')).toBeNull();
  });
  test('addressee words match whole words, "Medic Awas" is the tag, and the first addressee wins (D1)', () => {
    expect(d("please prepare patient's id and medication")).toBeNull();
    expect(d('any medic awas tag or medic-alert bracelet?')).toBeNull();
    expect(d('medic, please take the bp')).toBe('buddy');
    expect(d('sir, my buddy will hold your head')).toBe('patient');
    expect(d('head buddy, ask sir to sit up')).toBe('headBuddy');
  });
  test('"medic alerts" and "medic tags" are the tag too, as "medic alert" is', () => {
    for (const line of ['any medic alert?', 'any medic alerts?', 'any medic tags?']) expect(d(line), line).toBeNull();
    const route = (line: string) => readSentence(line, ctxAt('rapid-body-survey')).addressee;
    expect(route('Any medic alerts?')).toBe(route('Any medic alert?'));
  });
  test('a hyphenated or glued buddy name is one addressee', () => {
    const lines = [['head-buddy, temp please', 'headBuddy'], ['headbuddy, temp please', 'headBuddy'],
      ['arm-buddy, spo2 please', 'armBuddy'], ['armbuddy, spo2 please', 'armBuddy']] as const;
    for (const [line, heard] of lines) expect(d(line), line).toBe(heard);
  });
});

test('replyRole is the role of the first reply that names the point or one of its parts', () => {
  const step = (id: string) => STEPS.find(s => s.id === id)!;
  expect(replyRole(step('breathing'), 'chest-rise-fall')).toBe('tester');
  expect(replyRole(step('vital-signs'), 'gcs')).toBe('patient');            // through 'gcs.verbal'
  expect(replyRole(step('vital-signs'), 'head-buddy')).toBe('headBuddy');   // through 'head-buddy.temp'
  expect(replyRole(step('vital-signs'), 'vitals-permission')).toBeNull();
});

test('ctxAt sets the step and, by default, marks every applicable point before it done', () => {
  const ctx = ctxAt('breathing');
  expect(ctx.current).toBe(10);
  expect(ctx.done.has('airway/head-tilt-chin-lift')).toBe(true);   // COPD has no spinal injury
  expect(ctx.done.has('airway/jaw-thrust')).toBe(false);
  expect(ctx.done.has('breathing/spo2')).toBe(false);
  expect(ctxAt('breathing', 'copd-amk-01', 6, ['x/y']).done).toEqual(new Set(['x/y']));
});

describe('real data', () => {
  test('a line to the arm buddy reads the SpO2 point', () => {
    expect(readSentence('Arm buddy, please measure the SpO2 reading on room air.', ctxAt('breathing'))).toMatchObject({
      step: 'breathing', addressee: 'armBuddy', points: [expect.objectContaining({ point: 'spo2' })],
    });
  });
  test('a message across two steps', async () => {
    // Ruling P16: the third sentence is the pulse alone; the rate-and-quality version is a Task 6 fixture.
    const { sentences } = await keywordGrader.interpret('Is there chest rise and fall? Arm buddy, SpO2 please. Checking the radial pulse.', ctxAt('breathing'));
    expect(sentences.map(s => s.step)).toEqual(['breathing', 'breathing', 'circulation']);
    expect(sentences.map(s => s.points.map(p => p.point))).toEqual([['chest-rise-fall'], ['spo2'], ['pulse']]);
    expect(sentences[0]!.addressee).toBe('tester');
    expect(sentences.map(s => s.text)).toEqual(['Is there chest rise and fall?', 'Arm buddy, SpO2 please.', 'Checking the radial pulse.']);
  });
  test('a key phrase lists the required words it lacks', () => {
    const moi = (line: string) => readSentence(line, ctxAt('scene-evaluation'));
    expect(moi('MOI is case of breathlessness.')).toMatchObject({ step: 'scene-evaluation', points: [expect.objectContaining({ point: 'moi', missing: ['suspected'] })] });
    expect(moi('MOI is suspected case of breathlessness.').points).toEqual([expect.objectContaining({ point: 'moi', missing: [] })]);
  });
  test('an accepted alternative counts every part', () => {
    const r = readSentence('Bring the 4 in 1 and LSU.', ctxAt('preparation'));
    expect(r.step).toBe('preparation');
    expect(r.points).toEqual([expect.objectContaining({
      point: 'equipment', whole: true, parts: ['burn-kit', 'blanket-canvas', 'o2-bag', 'lsu', 'trauma-bag', 'zoll'],
    })]);
  });
  test('a re-ask still counts', () => {
    expect(readSentence('Arm buddy, SpO2 again please.', ctxAt('vital-signs'))).toMatchObject({
      step: 'vital-signs', points: [expect.objectContaining({ point: 'arm-buddy', parts: ['spo2'] })],
    });
  });
  test('an unhit point ahead beats a re-ask', () => {
    expect(readSentence('Arm buddy, please recheck the SpO2.', plus('vital-signs', 'vital-signs/arm-buddy'))).toMatchObject({
      step: 'oxygen', points: [expect.objectContaining({ point: 'recheck-spo2' })],
    });
    expect(readSentence('Arm buddy, SpO2 again please.', plus('breathing', 'breathing/spo2'))).toMatchObject({
      step: 'breathing', points: [expect.objectContaining({ point: 'spo2' })],
    });
  });
  test('an addressee is never a finding: "head buddy" is not the head (ruling T05b)', () => {
    // Read as a finding, "head" would give step 12's head region; stripped, the line is step 14's temperature.
    expect(readSentence('Head buddy, please check the temperature.', ctxAt('rapid-body-survey'))).toMatchObject({
      step: 'vital-signs', addressee: 'headBuddy', points: [expect.objectContaining({ point: 'head-buddy', parts: ['temp'] })],
    });
  });
  test('"Head-buddy" and "Headbuddy" are stripped whole, so they never credit the head region', () => {
    for (const at of ['rapid-body-survey', 'vital-signs'])
      for (const line of ['Head-buddy, please check the temperature.', 'Headbuddy, please check the temperature.'])
        expect(readSentence(line, ctxAt(at)), `${at}: ${line}`).toMatchObject({
          step: 'vital-signs', addressee: 'headBuddy', points: [expect.objectContaining({ point: 'head-buddy', parts: ['temp'] })],
        });
    for (const line of ['Arm-buddy, SpO2 again please.', 'Armbuddy, SpO2 again please.'])
      expect(readSentence(line, plus('breathing', 'breathing/spo2')), line).toMatchObject({ step: 'breathing', points: [expect.objectContaining({ point: 'spo2' })] });
  });
  test('a smart quote from the phone keyboard still names the patient', () => {
    expect(readSentence('Ma’am, did you fall?', ctxAt('delicate-spine')).addressee).toBe('patient');
  });
  test('reads the oxygen and the ECG from every sentence', () => {
    expect(readSentence('Head buddy, nasal cannula 2 L/min please.', ctxAt('breathing'))).toMatchObject({
      step: 'breathing', addressee: 'headBuddy', oxygen: { device: 'nasal-cannula', flow: 2, flowMax: null }, ecg: null,
    });
    expect(readSentence('12-lead ECG please.', ctxAt('investigation'))).toMatchObject({ step: 'investigation', ecg: '12-lead', oxygen: null });
  });
  test('a named device or flow reads the oxygen check points, through the same terms as readOxygen', () => {
    expect(readSentence('Nebuliser 6 to 8 litres please.', ctxAt('breathing', 'asthma-tampines-01'))).toMatchObject({
      step: 'breathing', points: [expect.objectContaining({ point: 'mask-flow', whole: true, pos: 0 })],
      oxygen: { device: 'nebuliser-mask', flow: 6, flowMax: 8 },
    });
    expect(readSentence('Head buddy, NRM 15 litres per minute please.', ctxAt('breathing', 'chestpain-bedok-01'))).toMatchObject({
      step: 'breathing', addressee: 'headBuddy', points: [expect.objectContaining({ point: 'mask-flow', pos: 12 })],
      oxygen: { device: 'non-rebreather', flow: 15, flowMax: null },
    });
    expect(readSentence('Continue NRM at 15 lpm.', ctxAt('oxygen', 'chestpain-bedok-01'))).toMatchObject({
      step: 'oxygen', points: [expect.objectContaining({ point: 'maintain-titrate' })],
    });
  });
  test('"none" reads the oxygen check point only in a sentence that says oxygen or O2', () => {
    for (const line of ['Oxygen not required.', 'No oxygen needed.', 'O2 not needed.'])
      expect(readSentence(line, ctxAt('breathing', 'hypo-hougang-01')), line).toMatchObject({
        step: 'breathing', points: [expect.objectContaining({ point: 'mask-flow' })], oxygen: { device: 'none' },
      });
    for (const line of ['Suction not required.', 'C-collar not needed.'])
      expect(readSentence(line, ctxAt('airway')).points.map(p => p.point), line).not.toContain('mask-flow');
    // "spo2" is not "o2": an SpO2 on room air is a reading, not an oxygen choice.
    expect(readSentence('Arm buddy, recheck the SpO2 on room air.', ctxAt('oxygen')).points.map(p => p.point)).toEqual(['recheck-spo2']);
  });
  test('a named ECG type reads the ECG check point, glued forms included', () => {
    for (const line of ['Four-lead, please.', 'Hook up the 4lead.'])
      expect(readSentence(line, ctxAt('investigation', 'hypo-hougang-01')), line).toMatchObject({
        step: 'investigation', points: [expect.objectContaining({ point: 'ecg' })], ecg: '4-lead',
      });
  });
  test("the vital-signs line's GCS, split inside its parenthesis, still reads all four parts (Task 4 carry)", async () => {
    const line = STEPS.find(s => s.id === 'vital-signs')!.canonicalLine;
    const { sentences } = await keywordGrader.interpret(line, ctxAt('vital-signs'));
    const gcs = sentences.flatMap(s => (s.step === 'vital-signs' ? s.points.filter(p => p.point === 'gcs') : []));
    expect(gcs.map(p => p.parts)).toEqual([['eyes', 'verbal'], ['motor', 'score']]);
  });
});

describe('synthetic steps', () => {
  const COPD = caseById('copd-amk-01');
  const pt = (id: string, extra: Partial<MustHit> = {}): MustHit => ({ id, label: id, short: id, match: [], ...extra });
  const step = (order: number, mustHit: MustHit[], replies: Reply[] = []): Step =>
    ({ id: `s${order}`, order, name: `Step ${order}`, timed: false, notesRef: 's01', canonicalLine: '', mustHit, replies, guidance: [] });
  const at = (steps: Step[], current: number): GradeContext => ({ case: COPD, steps, current, slots: caseSlots(COPD, 6), done: new Set(), pending: new Set() });

  test('local alternatives count only while their step is the current one', () => {
    const steps = [step(1, [pt('X', { match: [['xword']] })]), step(2, [pt('A', { match: [['survey']], local: [['allow']] })])];
    expect(readSentence('please allow me', at(steps, 2))).toMatchObject({ step: 's2', points: [expect.objectContaining({ point: 'A', whole: true })] });
    expect(readSentence('please allow me', at(steps, 1))).toMatchObject({ step: null, points: [] });
  });
  // at a scene step: before the crew arrives (steps 1 and 2) "sir" is said to the caller (the post-breaker ruling)
  test('points for two kinds of listener, with no addressee, are unclear (R8)', () => {
    const steps = [...[1, 2, 3, 4].map(n => step(n, [])), step(5, [pt('P', { match: [['pword']] }), pt('Q', { match: [['qword']] })],
      [{ role: 'tester', text: 'P.', on: ['P'] }, { role: 'patient', text: 'Q.', on: ['Q'] }])];
    expect(readSentence('pword and qword', at(steps, 5)).addressee).toBe('unclear');
    expect(readSentence('sir, pword and qword', at(steps, 5)).addressee).toBe('patient');
  });
  test('a negative term vetoes the point', () => {
    const steps = [step(1, [pt('N', { match: [['spinal']], negatives: ['no suspected'] })])];
    expect(readSentence('suspected spinal injury', at(steps, 1)).step).toBe('s1');
    expect(readSentence('no suspected spinal injury', at(steps, 1))).toMatchObject({ step: null, points: [] });
  });
  test('a required word found by any sentence of the line that reads the same point clears it (ruling P17)', async () => {
    const steps = [step(1, [pt('S', { match: [['approach'], ['move your head']], keyPhrase: true, requiredWords: ['front', 'move your head'] })])];
    const missing = async (line: string) => (await keywordGrader.interpret(line, at(steps, 1))).sentences.map(s => s.points.map(p => p.missing));
    expect(readSentence('Approaching casualty from the front.', at(steps, 1)).points[0]!.missing).toEqual(['move your head']);
    expect(await missing('Approaching casualty from the front. If you can hear me, please do not move your head.')).toEqual([[[]], [[]]]);
    // A sentence that doesn't read the point clears nothing.
    expect(await missing('Approaching casualty. The front door is open.')).toEqual([[['front', 'move your head']], []]);
  });
});

// Task 10 fix round 4: the re-ask flag, and the guards the round-3 re-review found unpinned (N-a, N-c).
describe('the re-ask flag', () => {
  const COPD = 'copd-amk-01';
  /** Every point of steps 1 to `order` that applies to COPD, done. */
  const doneTo = (order: number) => [...ctxAt(STEPS.find(s => s.order === order + 1)!.id).done];
  const SOUND = 'If you can hear me, please do not move your head.';   // the sound-out (done) and LOC's response (to do)
  test('on scene, a spill from a step still to finish is a re-ask; from a finished step it is not', () => {
    const unfinished = ctxAt('approach-patient', COPD, 6, doneTo(5).filter(k => k !== 'approach-patient/head-still'));
    expect(readSentence(SOUND, unfinished)).toMatchObject({ step: 'loc-avpu', reask: true });
    // N-a: COPD has no catastrophic bleeding, so bleeding control, not done, leaves Approach finished
    expect(doneTo(5)).not.toContain('approach-patient/bleeding-control');
    const finished = readSentence(SOUND, ctxAt('approach-patient', COPD, 6, doneTo(5)));
    expect(finished.step).toBe('loc-avpu');
    expect(finished.reask).toBeUndefined();
  });
  test('N-c: on scene a done call point read again is no re-ask, so a sentence moving on to the next step is not one', () => {
    // "EMT" reads the caller intro (done, the call's) and the patient intro (step 6, to do), with Approach unfinished
    const r = readSentence('My name is EMT Lee.', ctxAt('approach-patient', COPD, 6, doneTo(5).filter(k => k !== 'approach-patient/head-still')));
    expect(r).toMatchObject({ step: 'introduction', points: [expect.objectContaining({ point: 'intro-emt-scdf' })] });
    expect(r.reask).toBeUndefined();
  });
  test('NB2: never on the phone, where the radio call left unfinished moves on to the caller', () => {
    const r = readSentence('Hi, I am calling from 995 FMV.', ctxAt('respond-call', COPD, 6, ['respond-call/call-sign', 'respond-call/responding-to']));
    expect(r).toMatchObject({ step: 'call-caller', points: [expect.objectContaining({ point: 'intro-fmv-emt' })] });
    expect(r.reask).toBeUndefined();
  });
});

describe('before arrival (Task 10 post-breaker ruling)', () => {
  test('a sentence reading only a scene step reads nothing, marked as a statement or a question; kept, it reads the step', () => {
    const at2 = ctxAt('call-caller');   // the call under way: Approach is a scene step
    expect(readSentence('Is there any catastrophic bleeding?', at2)).toMatchObject({ step: null, points: [], dropped: 'question' });
    expect(readSentence('Please do not move his head.', at2)).toMatchObject({ step: null, points: [], dropped: 'statement' });
    expect(readSentence('Is there any catastrophic bleeding?', at2, { keep: true }).points.map(p => p.point)).toEqual(['catastrophic-bleeding']);
    expect(readSentence('Is there any catastrophic bleeding?', at2, { arrived: true }).points.map(p => p.point)).toEqual(['catastrophic-bleeding']);
  });
  test('a question ends with "?" or opens with a question word, past the addressee words and the fillers', () => {
    const dropped = (line: string) => readSentence(line, ctxAt('call-caller')).dropped;
    for (const q of ['Is there any bleeding', 'OK, is there any bleeding', 'And is there any bleeding', 'Also, any catastrophic bleeding',
      'So, which side is bleeding', 'Ops Ctr, does he have any bleeding', 'Do you see any bleeding', 'Any hazards there?']) expect(dropped(q), q).toBe('question');
    for (const x of ['Do not move his head.', 'Does not need moving, keep his head still.', "Don't move his head.", 'Anyway, keep his head still.',
      'Keep him in a comfortable position.']) expect(dropped(x), x).toBe('statement');
  });
  test('patient words before arrival are said to the caller', () => {
    expect(readSentence('Sir, may I know what happened to the patient?', ctxAt('call-caller')).addressee).toBe('caller');
    expect(readSentence('Sir, what is bothering you?', ctxAt('introduction')).addressee).toBe('patient');
  });
  // the adjudication ruling (P5): a context built by hand counts arrival as the engine counts an older save
  test('a context with no arrival of its own has arrived past preparation, or with preparation done', () => {
    const at3 = ctxAt('preparation');   // step 3, steps 1 and 2 done, nothing of preparation
    expect([arrivedIn(at3), arrivedIn(ctxAt('scene-evaluation')), arrivedIn({ ...at3, done: new Set([...at3.done, 'preparation/gloves-mask']) }),
      arrivedIn({ ...ctxAt('introduction'), arrived: false })]).toEqual([false, true, true, false]);
    expect(readSentence('Sir, may I know what happened to the patient?', at3).addressee).toBe('caller');
  });
});
