import { CASES, IDS, STEPS, T0, blankSession, caseById, ctxAt, envOf, hitAll, playRun, recordOf, type PlayInput } from './sim-helpers';
import { conditionHolds, type Case } from '../../src/data/schema';
import { RUN_LIMITS, type ChatLine, type RunSession } from '../../src/progress/types';
import { applicablePoints, classify } from '../../src/sim/classify';
import { NEW_CLOCK, elapsedMs, etaMinutes } from '../../src/sim/clock';
import { startDrill } from '../../src/sim/drill';
import { keywordGrader, readSentence, type Grader } from '../../src/sim/grader';
import { caseSlots, splitSentences } from '../../src/sim/match';
import { capitalise, fillCanonical } from '../../src/sim/replies';
import {
  ADDRESSEE_LABEL, NOT_UNDERSTOOD, UNCLEAR, disputePoint, endConfirmCopy, endRun, gradeContext, pauseRun, rangeText,
  resumeRun, routeOf, runElapsed, sendLine, shownStep, startRun, stepCovered, stepStates, stepsPhrase, tapStep, tickRun, unfinishedSteps,
} from '../../src/sim/run';

const copd = caseById('copd-amk-01');
const env = envOf('copd-amk-01');
const STEP_IDS = STEPS.map(s => s.id);
const upTo = (order: number) => STEPS.filter(s => s.order <= order).map(s => s.id);
const step = (id: string) => STEPS.find(s => s.id === id)!;
/** The step's canonical line filled for the case at `eta`, as tap mode plays it. */
const fill = (stepId: string, c: Case, eta: number) => fillCanonical(step(stepId).canonicalLine, c, eta, step(stepId).mustHit);
const send = async (s: RunSession, text: string, now = T0, e = env) => (await sendLine(e, s, text, now)).session;
const last = (s: RunSession): ChatLine => s.lines.at(-1)!;
/** The trainee's lines, newest last. */
const mine = (s: RunSession) => s.lines.filter(l => l.who === 'you');
/** The timeout for the four sweeps that play a case end to end many times over: 1 to 2 s each alone, but past the
 *  default 5 s on a loaded machine (Task 19 review). Their assertions are unchanged. */
const SLOW_MS = 20_000;
/** A session whose clock has run `ms` by `now`, and keeps running. */
const running = (s: RunSession, ms: number, now: number): RunSession => ({ ...s, clock: { started: true, bankedMs: ms, runningSince: now } });
/** COPD with steps 1 to `order` done (hitAll), its clock at `ms` by `now`. */
const doneTo = (order: number, ms = 0, now = T0, caseId = 'copd-amk-01'): RunSession =>
  running(hitAll(blankSession(caseId), STEPS, caseById(caseId), upTo(order)), ms, now);

const STEP1 = 'FMV 123 to Ops Ctr, responding to Blk 2xx Ang Mo Kio Ave 3 for case of elderly female, breathlessness.';
const SOUND_OUT = 'Approaching casualty from the front. If you can hear me, please do not move your head.';
const RBS_LINE = 'Head, neck, chest, abdomen, pelvis, lower extremities, upper extremities and back, with eye contact.';

// ---- Start and step 1 ---------------------------------------------------------------------------------------

test('startRun: the activation line, a clock not yet started, step 1', () => {
  const s = startRun(env, 'coached', IDS, T0);
  expect(s.lines).toEqual([{ who: 'system', text: 'Activation: Elderly female, breathlessness. Blk 2xx Ang Mo Kio Ave 3, #07-xx.', atMs: null }]);
  expect(s.clock).toBe(NEW_CLOCK);
  expect(s.current).toBe(1);
  expect(s).toMatchObject({ id: 'run-1', caseId: 'copd-amk-01', mode: 'coached', startedAt: IDS.startedAt, drill: null, lastAt: T0 });
});

test('the step 1 line: its route, "Ops Ctr, roger.", no clock yet; sent again, no second roger (R16)', async () => {
  let s = await send(startRun(env, 'coached', IDS, T0), STEP1, T0 + 5_000);
  expect(s.lines.slice(1)).toEqual([
    { who: 'you', text: STEP1, atMs: null, route: 'To Ops Ctr: call sign, responding to, case of' },
    { who: 'opsCtr', text: 'Ops Ctr, roger.', atMs: null },
  ]);
  expect(s.clock.started).toBe(false);
  expect(s.lastAt).toBe(T0 + 5_000);
  s = await send(s, STEP1, T0 + 10_000);
  expect(s.lines).toHaveLength(4);
  expect(s.lines.filter(l => l.text === 'Ops Ctr, roger.')).toHaveLength(1);
});

// ---- Routes -----------------------------------------------------------------------------------------------------

// Task 14 review: the route is what the run understood, so a point read by two sentences of one line shows once.
test('a point read by two sentences of one line shows once in its route', async () => {
  const s4 = hitAll(blankSession('copd-amk-01'), STEPS, copd, upTo(4));
  const routeAfter = async (text: string) => mine(await send(s4, text)).at(-1)!.route;
  expect(await routeAfter(SOUND_OUT)).toBe('Sound out');   // was "Sound out · Sound out"
  expect(await routeAfter(fill('approach-patient', copd, 6)))
    .toBe('Sound out · To tester: catastrophic bleeding · To tester: remove hazards · Head still');
  // a piece naming two points: a later sentence reading one of them again adds nothing
  expect(await routeAfter('Is there any catastrophic bleeding and any hazards around the patient? Any hazards around the patient?'))
    .toBe('To tester: catastrophic bleeding, remove hazards');
  expect(await routeAfter('Any hazards around the patient? Is there any catastrophic bleeding? Any hazards around the patient?'))
    .toBe('To tester: remove hazards · To tester: catastrophic bleeding');
  expect(await routeAfter('Buddy, SpO2 please. Arm buddy, SpO2 please.')).toBe('To arm buddy: SpO2');
});

// Task 1 review round 1 (I1, Minor 1): the call is said without two questions, so "Keep the patient comfortable." is
// held; the next line ends the call at its scene sentence (two points of one scene step), so it is read in parts: the
// sentences before the arrival as the phone's, the held line again on scene, then the rest, the two routes joined. An
// unread statement before the arrival adds no piece, an unread question keeps its mark on either side (Plan 3 D25).
test('a line read in parts across the arrival joins its routes; unread statements add no piece, unread questions keep it', async () => {
  const all = linesOf('copd-amk-01', 1, 2);
  const call = splitSentences(all[1]!);
  const prep = call.find(x => x.startsWith('Please prepare'))!;
  const casualties = call.find(x => x.startsWith('How many casualties'))!;
  const head = [all[0]!, call.filter(x => x !== prep && x !== casualties).join(' '), 'Keep the patient comfortable.'];
  const s0 = await playRun('copd-amk-01', 'coached', head);
  expect(s0.held).toBe(s0.lines.findIndex(l => l.text === 'Keep the patient comfortable.'));
  const scene = 'The environment is safe, no hazards noted. Patient is alert.';
  const routeAfter = async (line: string) => {
    const s = await playRun('copd-amk-01', 'coached', [...head, line]);
    // read in parts: the held line was read again on scene (its route is no longer "Not sure what this is.")
    expect([s.held, mine(s).at(-2)!.route], line).toEqual([null, 'To patient: position']);
    return mine(s).at(-1)!.route;
  };
  expect(await routeAfter(`Thank you. ${scene}`)).toBe('To tester: environment, hazards · AVPU level');
  expect(await routeAfter(`Thank you. We are here. ${scene}`)).toBe('To tester: environment, hazards · AVPU level');
  expect(await routeAfter(`Is the sky blue? ${scene}`)).toBe('Not sure what this is. · To tester: environment, hazards · AVPU level');
  expect(await routeAfter(`${casualties} Thank you. ${scene} Banana?`))
    .toBe('To caller: casualties · To tester: environment, hazards · AVPU level · Not sure what this is.');
});

test('routeOf: a piece of points once, in order; a sentence not understood or unclear keeps its own mark', () => {
  expect(routeOf(['Sound out', 'Sound out', '', 'To tester: remove hazards'])).toBe('Sound out · To tester: remove hazards');
  expect(routeOf(['To caller: casualties', NOT_UNDERSTOOD, 'To caller: casualties', NOT_UNDERSTOOD]))
    .toBe('To caller: casualties · Not sure what this is. · Not sure what this is.');
  expect(routeOf([UNCLEAR, 'To patient: position', UNCLEAR])).toBe(`${UNCLEAR} · To patient: position · ${UNCLEAR}`);
  expect(routeOf([])).toBe(NOT_UNDERSTOOD);
  expect(routeOf(['', ''])).toBe(NOT_UNDERSTOOD);
});

// ---- The clock ----------------------------------------------------------------------------------------------

// from step 4, so Approach is within the 2-step window (from step 1 it is 4 ahead, and starts nothing: I1)
test('the first reading in a timed step starts the clock; pause and resume bank the time', async () => {
  let s = await send(hitAll(blankSession('copd-amk-01'), STEPS, copd, upTo(4)), SOUND_OUT, T0 + 60_000);
  expect(s.clock).toEqual({ started: true, bankedMs: 0, runningSince: T0 + 60_000 });
  expect(s.hits['approach-patient/sound-out']!.atMs).toBe(0);
  expect(s.stepTimes['approach-patient']).toBe(0);
  s = pauseRun(s, T0 + 100_000);
  expect(s.lastAt).toBe(T0 + 100_000);
  s = resumeRun(s, T0 + 400_000);
  expect(s.lastAt).toBe(T0 + 400_000);
  expect(runElapsed(s, T0 + 410_000)).toBe(50_000);
});

// ---- Oxygen and readings ------------------------------------------------------------------------------------

test('a wrong mask: graded on its first hit, put on by the head buddy, and the SpO2 read on it', async () => {
  let s = await send({ ...blankSession('copd-amk-01'), current: 10 }, 'Buddy, simple face mask 6 litres.');
  expect(s.hits['breathing/mask-flow']).toMatchObject({ check: 'wrong', chose: 'simple face mask 6 L/min' });
  expect(s.lines.at(-2)).toMatchObject({ who: 'you', route: 'To head buddy: oxygen, simple face mask 6 L/min' });
  expect(last(s)).toMatchObject({ who: 'headBuddy', text: 'Simple face mask on, 6 L/min.' });
  expect(s.oxygen).toEqual({ device: 'simple-face-mask', flow: 6, atMs: 0, right: false });
  s = await send(s, 'Arm buddy, SpO2 please.', T0 + 10_000);
  expect(last(s)).toEqual({ who: 'armBuddy', text: 'SpO2 86% on simple face mask.', atMs: 10_000 });
  // titrated at step 15: the new choice is graded on its own point, the first hit is never regraded
  s = await send({ ...s, current: 15 }, 'Titrate to nasal cannula 3 litres.', T0 + 20_000);
  expect(s.hits['oxygen/maintain-titrate']).toMatchObject({ check: 'right', chose: 'nasal cannula 3 L/min' });
  expect(s.hits['breathing/mask-flow']!.check).toBe('wrong');
  s = await send(s, 'Arm buddy, recheck the SpO2.', T0 + 30_000);
  expect(last(s).text).toBe('SpO2 90% on nasal cannula.');
});

test('asking for SpO2 twice gives two reading lines and two readings', async () => {
  let s = await send({ ...blankSession('copd-amk-01'), current: 10 }, 'Arm buddy, SpO2 please.', T0);
  s = await send(s, 'Arm buddy, SpO2 again please.', T0 + 10_000);
  expect(s.lines.filter(l => l.who === 'armBuddy').map(l => l.text)).toEqual(['SpO2 86% on room air.', 'SpO2 86% on room air.']);
  expect(s.readings).toEqual([
    { key: 'spo2', value: '86', atMs: 0, o2: 'RA' },
    { key: 'spo2', value: '86', atMs: 10_000, o2: 'RA' },
  ]);
});

// ---- Coached flags ------------------------------------------------------------------------------------------

const HEAD_GRIP_LINES = [SOUND_OUT, 'Buddy, do a head grip.', 'Is there any catastrophic bleeding?', 'Any hazards around the patient?'];
async function headGrip(mode: 'coached' | 'exam'): Promise<RunSession> {
  let s = hitAll(blankSession('copd-amk-01', mode), STEPS, copd, upTo(4));
  for (const [i, line] of HEAD_GRIP_LINES.entries()) s = await send(s, line, T0 + i * 10_000);
  return s;
}
const lineOf = (s: RunSession, text: string) => s.lines.find(l => l.who === 'you' && l.text === text)!;

// The brief's scenario, with "Any hazards around the patient?" added: after the head grip and one Approach point alone,
// the two are tied and the amended R6 tie rule (Task 9 ruling) blames the line just said; a second Approach point
// makes the head grip the one point out of place.
test('Order: the head grip said during Approach is flagged on its own line', async () => {
  const s = await headGrip('coached');
  expect(lineOf(s, 'Buddy, do a head grip.').flags).toEqual([
    { kind: 'order', point: 'introduction/head-grip', text: 'Head grip belongs to step 6, Introduction.' },
  ]);
  expect(s.flaggedOrder).toContain('introduction/head-grip');
});

test('Order: a tie blames the line just said, and a flag is never taken back (Task 9 ruling on R6 ties)', async () => {
  const s = await headGrip('coached');
  expect(lineOf(s, 'Is there any catastrophic bleeding?').flags).toEqual([
    { kind: 'order', point: 'approach-patient/catastrophic-bleeding', text: 'Catastrophic bleeding belongs to step 5, Approach patient.' },
  ]);
  expect(lineOf(s, 'Any hazards around the patient?').flags).toBeUndefined();
});

test('Exam sets no flags', async () => {
  const s = await headGrip('exam');
  expect(s.lines.every(l => l.flags === undefined)).toBe(true);
  expect([s.nudged, s.flaggedOrder]).toEqual([[], []]);
});

test('Phrase: a recognised point missing its key words', async () => {
  const s = await send({ ...hitAll(blankSession('copd-amk-01'), STEPS, copd, upTo(3)), current: 4 }, 'MOI is case of breathlessness.');
  expect(last(s).flags).toEqual([{ kind: 'phrase', point: 'scene-evaluation/moi', text: 'Key words missing: “suspected”.' }]);
  expect(s.hits['scene-evaluation/moi']!.missing).toEqual(['suspected']);
});

test('Nudge: points not done two steps back, once each', async () => {
  const breathing = step('breathing').mustHit.filter(m => m.when === undefined || conditionHolds(copd, m.when));
  // a line moves the run at most 2 steps ahead (Task 5 carry), so from step 9 the first step 12 line reaches step 11
  let s = await send(hitAll(blankSession('copd-amk-01'), STEPS, copd, upTo(9)), 'Any abnormalities?', T0);
  expect(s.current).toBe(11);
  expect(mine(s).at(-1)!.flags).toBeUndefined();
  s = await send(s, 'Checking for JVD and pedal edema.', T0 + 10_000);
  expect(s.current).toBe(12);
  const nudges = mine(s).at(-1)!.flags!;
  expect(nudges).toEqual(breathing.map(m => ({ kind: 'nudge', point: `breathing/${m.id}`, text: expect.stringMatching(/^Not done yet: /) })));
  expect(nudges.map(f => f.text)).toContain('Not done yet: Arm buddy: measure SpO2 on room air.');
  expect(nudges.some(f => f.point.startsWith('circulation/'))).toBe(false);
  s = await send(s, 'Checking my gloves for sweat or blood.', T0 + 20_000);
  expect(mine(s).at(-1)!.flags).toBeUndefined();
});

// ---- The grader seam ----------------------------------------------------------------------------------------

test('a stub grader: an unclear sentence still counts, routes UNCLEAR and replies nothing (R8)', async () => {
  const stub: Grader = {
    id: 'stub',
    interpret: async line => ({ sentences: [{ text: line, step: 'breathing', addressee: 'unclear', oxygen: null, ecg: null,
      points: [{ step: 'breathing', point: 'spo2', parts: [], whole: true, missing: [], pos: 0 }] }] }),
  };
  const s0 = { ...blankSession('copd-amk-01'), current: 10 };
  const s = await send(s0, 'Measure it.', T0, envOf('copd-amk-01', stub));
  expect(s.hits['breathing/spo2']).toBeDefined();
  expect(last(s)).toMatchObject({ who: 'you', route: UNCLEAR });
  expect(s.lines).toHaveLength(s0.lines.length + 1);
  expect(s.readings).toEqual([]);
});

test('a line read as nothing: "Not sure what this is.", no hit, no reply', async () => {
  const s0 = blankSession('copd-amk-01');
  const s = await send(s0, 'The weather is nice today.');
  expect(s.lines).toHaveLength(2);
  expect(last(s)).toMatchObject({ who: 'you', route: NOT_UNDERSTOOD });
  expect(s.hits).toEqual({});
});

test('ADDRESSEE_LABEL', () => {
  expect(ADDRESSEE_LABEL).toEqual({ opsCtr: 'Ops Ctr', caller: 'caller', patient: 'patient', headBuddy: 'head buddy',
    armBuddy: 'arm buddy', tester: 'tester', crew: 'crew', buddy: 'buddy' });
});

// ---- Reassessment -------------------------------------------------------------------------------------------

test('tickRun: the buddies read the vitals at each 5-minute mark after the reassess call', () => {
  const s: RunSession = { ...running(blankSession('copd-amk-01'), 0, T0), reassessFromMs: 600_000 };
  expect(tickRun(env, s, T0 + 899_000)).toBeNull();
  const r = tickRun(env, s, T0 + 900_000)!;
  expect(r.session.lines.slice(-2)).toEqual([
    { who: 'headBuddy', text: 'Temp 37.2°C. RR 28. Skin pale, warm, sweaty.', atMs: 900_000 },
    { who: 'armBuddy', text: 'SpO2 86% on room air. PR 112. BP 146/86. CRT under 2 s.', atMs: 900_000 },
  ]);
  expect(r.session.reassessSets).toBe(1);
  expect(r.session.readings.map(x => x.key)).toEqual(['temp', 'rr', 'skin', 'spo2', 'pr', 'bp', 'crt']);
  expect(r.session.lastAt).toBe(T0 + 900_000);
  expect(tickRun(env, r.session, T0 + 950_000)).toBeNull();
  expect(tickRun(env, blankSession('copd-amk-01'), T0 + 900_000)).toBeNull();   // no clock, no reassess call
});

// ---- Tap mode -----------------------------------------------------------------------------------------------

test('tapStep: the canonical line, its replies, the step covered; a second tap does nothing', () => {
  const s0 = { ...blankSession('copd-amk-01'), current: 5 };
  const r = tapStep(env, s0, 'introduction', T0 + 1_000);
  const you = r.session.lines[1]!;
  expect(you).toMatchObject({ who: 'you', text: fill('introduction', copd, 20), tapped: true,
    route: 'Tapped: step 6, Introduction' });
  expect(r.session.lines.slice(2)).toEqual([
    { who: 'headBuddy', text: 'Head grip on.', atMs: 0 },
    { who: 'patient', text: 'So breathless... since morning... getting worse.', atMs: 0 },
  ]);
  expect(r.session.tapped).toEqual(['introduction']);
  expect(r.session.hits['introduction/head-grip']).toMatchObject({ tapped: true, missing: [], check: null });
  expect(stepCovered(env, r.session, 'introduction')).toBe(true);
  expect(tapStep(env, r.session, 'introduction', T0 + 2_000).session).toBe(r.session);
});

// ---- Limits -------------------------------------------------------------------------------------------------

test('a long line is cut to 600 characters; a run at 400 lines takes no more', async () => {
  const s = await send(blankSession('copd-amk-01'), `  ${'x'.repeat(700)}  `);
  expect(mine(s)[0]!.text).toHaveLength(RUN_LIMITS.lineChars);
  const full: RunSession = { ...blankSession('copd-amk-01'), lines: Array.from({ length: 400 }, () => ({ who: 'you' as const, text: 'x', atMs: null })) };
  expect((await sendLine(env, full, STEP1, T0)).session).toBe(full);
  expect(tapStep(env, full, 'respond-call', T0).session).toBe(full);
  expect((await sendLine(env, blankSession('copd-amk-01'), '   ', T0))).toEqual({ session: blankSession('copd-amk-01'), announce: [] });
});

// ---- RBS and the standby call -------------------------------------------------------------------------------

test('finishing the RBS announces its time', async () => {
  const r = await sendLine(env, doneTo(11, 161_000), RBS_LINE, T0);
  expect(r.announce).toEqual(['RBS done at 2:41.']);
  expect(r.session.rbsMs).toBe(161_000);
});

test('the standby call: send over, the ETA, and its time', async () => {
  const s = await send(doneTo(18, 840_000), 'FMV 123 to Ops Centre, standby message, over.');
  expect(s.lines.slice(-2)).toEqual([
    { who: 'opsCtr', text: 'Ops Centre, send over.', atMs: 840_000 },
    { who: 'tester', text: 'ETA 6 mins.', atMs: 840_000 },
  ]);
  expect(s.standbyMs).toBe(840_000);
  // R16, on a real re-ask (at step 19 nothing comes after it): the radio reply once per run, the ETA every time; the
  // standby time stays the first call's
  const again = await send(s, 'FMV 123 to Ops Centre, standby message, over.', T0 + 60_000);
  expect(mine(again).at(-1)!.route).toBe('To Ops Ctr: standby message');
  expect(again.lines.slice(s.lines.length + 1)).toEqual([{ who: 'tester', text: 'ETA 5 mins.', atMs: 900_000 }]);
  expect(again.standbyMs).toBe(840_000);
  expect(again.played.filter(k => k === 'notification#3')).toEqual(['notification#3']);
});

// ---- Phrases and copy ---------------------------------------------------------------------------------------

test('stepsPhrase and rangeText', () => {
  expect(stepsPhrase([15, 16, 17, 18, 19])).toBe('Steps 15 to 19');
  expect(stepsPhrase([19])).toBe('Step 19');
  expect(stepsPhrase([9, 12, 15, 16, 17, 18, 19])).toBe('Steps 9, 12 and 15 to 19');
  expect(stepsPhrase([3, 4])).toBe('Steps 3 and 4');
  expect(stepsPhrase([])).toBe('');
  expect(rangeText([15, 16, 17, 18, 19])).toBe('15 to 19');
  expect(rangeText([9, 12, 15, 16, 17, 18, 19])).toBe('9, 12 and 15 to 19');
  expect(rangeText([3, 4])).toBe('3 and 4');
  expect(rangeText([1, 2, 3, 4, 5, 7, 8, 9])).toBe('1 to 5 and 7 to 9');
  expect(rangeText([4, 3, 4, 9])).toBe('3, 4 and 9');
});

test('endConfirmCopy', () => {
  expect(endConfirmCopy(env, doneTo(14, 580_000), T0)).toBe('End run at 09:40? Steps 15 to 19 count as missed.');
  expect(endConfirmCopy(env, blankSession('copd-amk-01'), T0)).toBe('End run now? Steps 1 to 19 count as missed.');
  expect(endConfirmCopy(env, doneTo(19, 580_000), T0)).toBe('End run at 09:40?');
  const drill: RunSession = { ...blankSession('copd-amk-01'), drill: { target: 'rapid-body-survey', from: 11, to: 13, chain: [], sourceRunId: null } };
  expect(endConfirmCopy(env, drill, T0)).toBe('End drill? Steps 11 to 13 count as missed.');
  expect(unfinishedSteps(env, doneTo(14))).toEqual([15, 16, 17, 18, 19]);
});

// ---- The end of a run ---------------------------------------------------------------------------------------

test('endRun: the record of a short COPD run', async () => {
  const inputs = [STEP1, 'Hi, I am calling from 995 FMV. May I know what happened to the patient?', 'Crew, please don gloves and mask.',
    'Are there any witnesses?', SOUND_OUT, 'Hi Mdm Tan, I am EMT Lee from SCDF. My buddy will do a head grip on you, please allow him.',
    'What is bothering you?'];
  const s = await playRun('copd-amk-01', 'coached', inputs);
  const end = T0 + 160_000;
  const r = endRun(env, s, end);
  expect(r).toMatchObject({ id: 'run-1', caseId: 'copd-amk-01', mode: 'coached', drill: false, stepsTotal: 19, startedAt: IDS.startedAt,
    usedMs: 60_000, drillRange: null, drillChain: [] });
  expect(r.transcript[0]).toEqual({ who: 'Dispatch', text: 'Activation: Elderly female, breathlessness. Blk 2xx Ang Mo Kio Ave 3, #07-xx.', atMs: null });
  expect(r.transcript[1]).toEqual({ who: 'You', text: STEP1, atMs: null });
  const paused = pauseRun(s, end);
  expect(r.faults).toEqual(classify(STEPS, copd, paused, elapsedMs(paused.clock, end)).faults);
  expect(r.missed).toEqual([...new Set(r.faults.filter(f => f.kind === 'missed').map(f => f.point))]);
  expect(r.record!.complaint).toBe('So breathless... since morning... getting worse.');
  expect(r.reached).toEqual([1, 2, 3, 4, 5, 6]);
  expect(r.stepTimes).toEqual({ 'approach-patient': 0, introduction: 20_000 });
});

test('endRun: disputed faults stay in faults but out of the kind lists; a run ended before Approach is untimed', async () => {
  const s = disputePoint(await playRun('copd-amk-01', 'coached', [STEP1]), 'call-caller/casualties', T0 + 30_000);
  expect(s.lastAt).toBe(T0 + 30_000);
  const r = endRun(env, s, T0 + 40_000);
  expect(r.faults.some(f => f.point === 'call-caller/casualties')).toBe(true);
  expect(r.missed).not.toContain('call-caller/casualties');
  expect(r.disputes).toEqual(['call-caller/casualties']);
  expect([r.usedMs, r.stepTimes, r.rbsMs, r.standbyMs]).toEqual([0, {}, null, null]);
  expect(r.faults.filter(f => f.step >= 5).every(f => f.kind === 'missed' && f.atMs === null)).toBe(true);
});

test('the case record of a tapped COPD run, and of a wrong mask and a convinced patient', async () => {
  const taps = STEPS.map(st => ({ tap: st.id }));
  const copdRecord = (await recordOf('copd-amk-01', 'coached', taps)).record!;
  expect(copdRecord).toMatchObject({
    complaint: 'So breathless... since morning... getting worse.',
    moi: 'MOI is suspected case of elderly female, breathlessness.',
    oxygen: 'nasal cannula 2 L/min',
    ecg: '12-lead: Sinus tachycardia about 112, no ST changes',
    hypocount: '6.8 mmol/L',
    position: 'Sitting, leaning forward',
    decision: 'Patient is unstable due to low SpO2 and high RR, suspected COPD.',
    sracie: ['S', 'R', 'A', 'C', 'I', 'E'],
  });
  expect(copdRecord.standby.map(l => l.who)).toEqual(['You', 'Tester', 'Ops Ctr', 'Tester', 'Ops Ctr']);
  expect((await recordOf('chestpain-bedok-01', 'coached', taps)).record!.position).toBe('Lying flat on the sofa, convinced to change');
  const wrong = endRun(env, await send({ ...blankSession('copd-amk-01'), current: 10 }, 'Buddy, simple face mask 6 litres.'), T0);
  expect(wrong.record!.oxygen).toBe('simple face mask 6 L/min, no improvement');
  expect(wrong.oxygen).toEqual({ device: 'simple-face-mask', flow: 6, atMs: 0, right: false });
});

// ---- More of the brief's rules ------------------------------------------------------------------------------

test('Coached flags for check points: Wrong for a wrong choice, Phrase for none named', async () => {
  const at10 = { ...hitAll(blankSession('copd-amk-01'), STEPS, copd, upTo(9)), current: 10 };
  const sfm = await send(at10, 'Buddy, simple face mask 6 litres.');
  expect(mine(sfm).at(-1)!.flags).toEqual([{ kind: 'wrong', point: 'breathing/mask-flow', text: 'Wrong mask or flow for this patient. Check your oxygen guidelines.' }]);
  const unnamed = await send(at10, 'Putting on the appropriate mask and flow rate based on Guidelines.');
  expect(unnamed.hits['breathing/mask-flow']).toMatchObject({ check: 'unnamed', chose: null });
  // no reply: nothing went on; the point's own target names the listener
  expect(last(unnamed)).toMatchObject({ who: 'you', route: 'To head buddy: oxygen',
    flags: [{ kind: 'phrase', point: 'breathing/mask-flow', text: 'Say which mask and flow rate.' }] });
  expect(unnamed.oxygen).toBeNull();
  const fall = envOf('fall-yishun-01');
  const ecg = await send(doneTo(12, 300_000, T0, 'fall-yishun-01'), 'Tester, prepare a 12-lead ECG.', T0, fall);
  expect(ecg.hits['investigation/ecg']).toMatchObject({ check: 'wrong', chose: '12-lead' });
  expect(ecg.ecg).toBe('12-lead');
  expect(mine(ecg).at(-1)!.flags).toEqual([{ kind: 'wrong', point: 'investigation/ecg', text: 'Wrong ECG for this patient.' }]);
  expect(mine(ecg).at(-1)!.route).toBe('To tester: ECG, 12-lead');
});

test('replies in a row from one role are one line', async () => {
  const s = await send({ ...hitAll(blankSession('copd-amk-01'), STEPS, copd, upTo(3)), current: 4 }, 'Are there any witnesses? What is the environment like?');
  expect(s.lines.slice(-1)).toEqual([{ who: 'tester', text: 'Son (the caller). Cramped living room, fan on. Two inhalers, tissues.', atMs: null }]);
  expect(mine(s).at(-1)!.route).toBe('To tester: witnesses · To tester: environment');
});

test('the reassess call sets the time the 5-minute readings count from', async () => {
  const s = await send(doneTo(13, 500_000), 'Buddy, please reassess vital signs every 5 mins and inform me.');
  expect(s.reassessFromMs).toBe(500_000);
  expect(last(s)).toEqual({ who: 'headBuddy', text: 'OK, every 5 mins.', atMs: 500_000 });
  const again = await send(s, 'Reassess every 5 mins.', T0 + 60_000);
  expect(again.reassessFromMs).toBe(500_000);
  const two = tickRun(env, again, T0 + 600_000)!;   // elapsed 1 100 000: both marks, 800 000 and 1 100 000
  expect(two.session.lines.filter(l => l.who === 'armBuddy').map(l => l.atMs).slice(-2)).toEqual([800_000, 1_100_000]);
  expect(two.session.reassessSets).toBe(2);
});

test('a drill: no clock, ETA 10, points outside its range reply but are not graded, taps outside it do nothing', async () => {
  const drill: RunSession = { ...hitAll(blankSession('copd-amk-01'), STEPS, copd, upTo(10)), current: 11, prefilled: upTo(10),
    drill: { target: 'rapid-body-survey', from: 11, to: 13, chain: [], sourceRunId: null } };
  expect(gradeContext(env, drill, T0 + 900_000).slots.eta).toEqual(['9', '10', '11']);
  const s = await send(drill, 'Checking the radial pulse. Head buddy, please check the temperature.', T0 + 5_000);
  expect(s.clock.started).toBe(false);
  expect(s.hits['circulation/pulse']).toMatchObject({ atMs: null, during: 11 });
  expect(s.parts['vital-signs/head-buddy/temp']).toBeUndefined();
  expect(mine(s).at(-1)!.route).toBe('To tester: pulse · To head buddy: head buddy vitals (temperature) (not in this drill)');
  expect(s.lines.slice(-2).map(l => l.text)).toEqual(['Radial pulse present, fast and strong.', 'Temp 37.2°C.']);
  expect(s.stepTimes).toEqual({});
  expect(tapStep(env, s, 'vital-signs', T0).session).toBe(s);
  expect(tapStep(env, s, 'respond-call', T0).session).toBe(s);   // prefilled
  expect(stepStates(env, s).map(x => x.state).slice(9, 15)).toEqual(['done', 'now', 'todo', 'todo', 'todo', 'todo']);
});

// ---- Step states --------------------------------------------------------------------------------------------

test('stepStates and shownStep: done, flagged, now, missed and to do', () => {
  let s = hitAll(blankSession('copd-amk-01'), STEPS, copd, upTo(9));
  const at = s.hits['introduction/head-grip']!.line;
  s = { ...s, lines: s.lines.map((l, i) => (i === at ? { ...l, flags: [{ kind: 'order' as const, point: 'introduction/head-grip', text: 'x' }] } : l)) };
  expect(shownStep(env, s)).toBe(10);   // step 9's points are all done
  expect(stepStates(env, s).map(x => x.state)).toEqual([
    'done', 'done', 'done', 'done', 'done', 'flagged', 'done', 'done', 'done', 'now', ...Array(9).fill('todo')]);
  expect(stepStates(env, disputePoint(s, 'introduction/head-grip', T0))[5]!.state).toBe('done');
  const behind = { ...hitAll(blankSession('copd-amk-01'), STEPS, copd, upTo(4)), current: 8 };
  expect(stepStates(env, behind).slice(4, 9).map(x => x.state)).toEqual(['missed', 'missed', 'todo', 'now', 'todo']);
  expect(stepStates(env, blankSession('copd-amk-01'))[0]).toEqual({ order: 1, name: 'Respond call', state: 'now' });
  expect(shownStep(env, blankSession('copd-amk-01'))).toBe(1);
  expect(shownStep(env, hitAll(blankSession('copd-amk-01'), STEPS, copd, STEP_IDS))).toBe(19);
});

test('stepStates: a call step still to do is missed once the run is past it, before or after arrival (Task 13 carry)', async () => {
  const states = (s: RunSession) => stepStates(env, s).slice(0, 5).map(x => x.state);
  const atPrep = { ...hitAll(blankSession('copd-amk-01'), STEPS, copd, ['respond-call']), current: 3 };
  expect(states(atPrep)).toEqual(['done', 'missed', 'now', 'todo', 'todo']);
  expect(states({ ...atPrep, arrived: true })).toEqual(['done', 'missed', 'now', 'todo', 'todo']);
  expect(states({ ...blankSession('copd-amk-01'), current: 2 })).toEqual(['missed', 'now', 'todo', 'todo', 'todo']);
  // the bar and the chat agree: the line that takes the run to the caller with the radio call unsaid nudges its points,
  // and the bar shows step 1 missed from the same line
  const s = await send(blankSession('copd-amk-01'), fill('call-caller', copd, 20));
  expect([s.current, s.arrived]).toEqual([2, false]);
  expect(new Set(mine(s).at(-1)!.flags!.filter(f => f.kind === 'nudge').map(f => f.point.split('/')[0]))).toEqual(new Set(['respond-call']));
  expect(states(s)).toEqual(['missed', 'done', 'now', 'todo', 'todo']);   // the whole call said, step 3 shows next
  // a scene step is still missed only two steps back
  const scene = { ...hitAll(blankSession('copd-amk-01'), STEPS, copd, upTo(4)), current: 6 };
  expect(stepStates(env, scene).slice(4, 7).map(x => x.state)).toEqual(['todo', 'now', 'todo']);
  expect(stepStates(env, { ...scene, current: 7 })[4]!.state).toBe('missed');
});

test('a drill: shownStep never passes its last step, and no step outside it is now (Task 13 carry)', () => {
  const drill = startDrill(env, 'oxygen', [], null, IDS, T0);   // steps 14 to 16
  expect(drill.drill).toMatchObject({ from: 14, to: 16 });
  const s = hitAll(drill, STEPS, copd, ['oxygen', 'airway-recheck']);   // 14 skipped, 15 and 16 done
  expect(s.current).toBe(16);
  expect(shownStep(env, s)).toBe(16);
  expect(stepStates(env, s).slice(12, 17).map(x => x.state)).toEqual(['done', 'missed', 'done', 'now', 'todo']);
  expect(stepStates(env, s).filter(x => x.state === 'now').map(x => x.order)).toEqual([16]);
  expect(shownStep(env, { ...s, current: 19 })).toBe(16);   // a current past the range, however it came
  expect(shownStep(env, { ...s, current: 2 })).toBe(14);
});

test('gradeContext: done holds every point done, tapped ones included; slots take the ETA', () => {
  const s = tapStep(env, hitAll(blankSession('copd-amk-01'), STEPS, copd, ['respond-call']), 'call-caller', T0).session;
  const ctx = gradeContext(env, s, T0);
  expect(ctx.current).toBe(2);
  expect([...ctx.done].sort()).toEqual(applicablePoints(STEPS, copd).filter(a => a.step.order <= 2).map(a => a.key).sort());
  expect(ctx.slots.eta).toEqual(['19', '20', '21']);
  expect(gradeContext(env, running(s, 840_000, T0), T0).slots.eta).toEqual(['5', '6', '7']);
  expect(ctx.pending).toEqual(new Set());
  // pending: the points of the steps before the run's that are still to do (fix round 1, I7)
  const behind = { ...hitAll(blankSession('copd-amk-01'), STEPS, copd, ['respond-call']), current: 3 };
  expect([...gradeContext(env, behind, T0).pending].sort())
    .toEqual(applicablePoints(STEPS, copd).filter(a => a.step.order === 2).map(a => a.key).sort());
  // fix round 3: on scene (past step 3) the call's points are never pending
  expect([...gradeContext(env, { ...behind, current: 5 }, T0).pending].sort())
    .toEqual(applicablePoints(STEPS, copd).filter(a => a.step.order === 3 || a.step.order === 4).map(a => a.key).sort());
});

// ---- Carries ------------------------------------------------------------------------------------------------

/** The keyword grader without its own whole-line rule: each sentence keeps the words only it found. */
const perSentence: Grader = { id: 'per-sentence', interpret: async (line, ctx) => ({ sentences: splitSentences(line).map(x => readSentence(x, ctx)) }) };

test('carry P17: a new hit\'s missing words are counted over the whole line, so the notes\' sound-out has no Phrase flag', async () => {
  const at4 = hitAll(blankSession('copd-amk-01'), STEPS, copd, upTo(4));
  // the stub really does leave each sentence missing the other's word
  const raw = await perSentence.interpret(SOUND_OUT, gradeContext(env, at4, T0));
  expect(raw.sentences.map(x => x.points[0]!.missing)).toEqual([['move your head'], ['front']]);
  for (const grader of [perSentence, undefined]) {
    const s = await send(at4, SOUND_OUT, T0, envOf('copd-amk-01', grader));
    expect(s.hits['approach-patient/sound-out']!.missing).toEqual([]);
    expect(last(s).flags).toBeUndefined();
  }
  const half = await send(at4, 'Approaching casualty.', T0, envOf('copd-amk-01', perSentence));
  expect(last(half).flags).toEqual([{ kind: 'phrase', point: 'approach-patient/sound-out', text: 'Key words missing: “front”, “move your head”.' }]);
});

test('carry P21: every reply\'s readings are kept; a hypocount has one decimal; GCS is the trainee\'s own figure', async () => {
  const rta = envOf('rta-toapayoh-01');
  let s = await send(doneTo(12, 400_000, T0, 'rta-toapayoh-01'), 'Checking the hypocount.', T0, rta);
  expect(last(s)).toMatchObject({ who: 'tester', text: 'Hypocount 6.0 mmol/L.' });
  expect(s.readings).toEqual([{ key: 'hypocount', value: '6.0', atMs: 400_000, o2: null }]);
  expect(endRun(rta, s, T0).record!.hypocount).toBe('6.0 mmol/L');   // carry 10: through oneDecimal
  const copdHypo = await send(doneTo(12, 400_000), 'Checking the hypocount.');
  expect(copdHypo.readings.at(-1)!.value).toBe('6.8');
  // GCS: only what the trainee states, from "GCS {n}" or "{n}/15"
  const at14 = doneTo(13, 500_000);
  const gcs = async (line: string) => (await send(at14, line)).readings.filter(r => r.key === 'gcs');
  expect(await gcs('GCS score is 14.')).toEqual([{ key: 'gcs', value: '14', atMs: 500_000, o2: null }]);
  expect(await gcs('Total 15/15.')).toEqual([{ key: 'gcs', value: '15', atMs: 500_000, o2: null }]);
  expect(await gcs(fill('vital-signs', copd, 12))).toEqual([]);   // "then the GCS score": no figure
  expect(await gcs('Eye opening and verbal, please.')).toEqual([]);
});

// Final review I1: the commonest ways a trainee states the GCS read its score, so the tile shows the trainee's own
// figure, through gcsSaid's "GCS {n}" branch where no total or E/V/M is given; never the case's (rulings P21, R15).
test('final review I1: "GCS 15", "GCS of 13" and E/V/M with a total put the stated figure on the GCS tile', async () => {
  const at14 = doneTo(13, 500_000);
  const gcs = async (line: string) => (await send(at14, line)).readings.filter(r => r.key === 'gcs').map(r => r.value);
  expect(await gcs('GCS 15.')).toEqual(['15']);
  expect(await gcs('GCS 14.')).toEqual(['14']);   // COPD's own GCS is 15: the tile shows what was said
  expect(await gcs('GCS of 13.')).toEqual(['13']);
  expect(await gcs('GCS: 12.')).toEqual(['12']);
  expect(await gcs('GCS11')).toEqual(['11']);
  expect(await gcs('GCS:13')).toEqual(['13']);   // residual ride-along: no space after the colon
  // residual N1: "score" apart from "GCS", or beside E/V/M figures with no "GCS": the score, and the E/V/M sum on the tile
  for (const line of ['GCS E4 V5 M6, score 15.', 'GCS eyes 4, verbal 5, motor 6, score 15.', 'GCS E4V5M6, score of 15.', 'E4 V5 M6, score 15.']) {
    const s = await send(at14, line);
    expect(s.hits['vital-signs/gcs'], line).toBeDefined();
    expect(mine(s).at(-1)!.flags, line).toBeUndefined();
    expect(s.readings.filter(r => r.key === 'gcs').map(r => r.value), line).toEqual(['15']);
  }
  expect(await gcs('E4 V5 M6, GCS 15.')).toEqual(['15']);
  expect(await gcs('GCS E4V4M6 = 14.')).toEqual(['14']);
  // E/V/M with no total states no score, so no tile; a pain score is no GCS
  expect(await gcs('E4V5M6.')).toEqual([]);
  expect(await gcs('Pain score 7.')).toEqual([]);
  // the review's full-run probe: the GCS is done, with no flag
  const s = await send(at14, 'GCS eyes verbal motor, GCS 15.');
  expect(s.hits['vital-signs/gcs']).toBeDefined();
  expect(mine(s).at(-1)!.flags).toBeUndefined();
  expect(s.readings.filter(r => r.key === 'gcs').map(r => r.value)).toEqual(['15']);
});

// Final review I2: COPD's patient rules no arm out, so "Taking BP on the right arm." after the step-13 BP question is the
// BP arm: the tester gives the investigation's BP, the arm buddy's step-14 BP doesn't play early, and the run ends with
// no fault on it.
test('final review I2: "Taking BP on the right arm." after the BP question in COPD is the BP arm, with no fault', async () => {
  let s = await send(doneTo(12, 400_000), "Sir/Ma'am, I am going to take your blood pressure. May I know which arm I can take the BP from?");
  expect(s.lines.slice(-1)).toEqual([{ who: 'patient', text: 'No... no shunt. No operation.', atMs: 400_000 }]);
  s = await send(s, 'Taking BP on the right arm.');
  expect(s.lines.slice(-2)).toEqual([
    { who: 'you', text: 'Taking BP on the right arm.', route: 'To tester: BP arm, right arm', atMs: 400_000 },
    { who: 'tester', text: 'BP 148/88 mmHg.', atMs: 400_000 },
  ]);
  expect(s.hits['investigation/bp-arm']).toMatchObject({ said: 'Taking BP on the right arm.', missing: [], during: 13,
    check: 'right', chose: 'right arm' });
  expect(s.current).toBe(13);
  expect(Object.keys(s.parts).filter(k => k.startsWith('vital-signs/'))).toEqual([]);
  expect(s.lines.some(l => l.who === 'armBuddy')).toBe(false);
  expect(s.readings.filter(r => r.key === 'bp')).toEqual([]);
  const r = endRun(env, s, T0);
  expect(r.faults.filter(f => f.point === 'investigation/bp-arm')).toEqual([]);
  // in CCF the left arm has her fistula: the BP arm, graded Wrong (Plan 3 T2, D23); the arm she offers is right
  const ccf = envOf('ccf-jurong-01');
  const atCcf = doneTo(12, 400_000, T0, 'ccf-jurong-01');
  expect((await send(atCcf, 'Taking BP on the left arm.', T0, ccf)).hits['investigation/bp-arm']).toMatchObject({ check: 'wrong', chose: 'left arm' });
  expect((await send(atCcf, 'Taking BP on the right arm.', T0, ccf)).hits['investigation/bp-arm']).toMatchObject({ check: 'right', chose: 'right arm' });
});

// ---- Plan 3 Task 2 (D23): the BP arm is a check ------------------------------------------------------------------
// The arm a patient rules out (CCF's fistula arm, bleed's cut arm) is Wrong, with its flag and detail; it is the
// investigation's BP arm, so the arm buddy's step-14 BP never plays early. Elsewhere either arm is right.

/** The case on step 13, every step before it done, the clock at 6:40. */
const at13 = (caseId: string): RunSession => ({ ...doneTo(12, 400_000, T0, caseId), current: 13 });

test.each([
  ['ccf-jurong-01', 'Taking the BP on the left arm.', 'left', 'right'],
  ['bleed-woodlands-01', 'BP on his right.', 'right', 'left'],
] as const)('D23: in %s, "%s" names the arm the patient ruled out: Wrong, flagged, with its detail', async (id, line, said, offered) => {
  const e = envOf(id);
  const s = await send(at13(id), line, T0, e);
  expect(s.hits['investigation/bp-arm']).toMatchObject({ check: 'wrong', chose: `${said} arm`, said: line });
  expect(mine(s).at(-1)).toMatchObject({ text: line, route: `To tester: BP arm, ${said} arm`,
    flags: [{ kind: 'wrong', point: 'investigation/bp-arm', text: 'Not on that arm. The patient ruled it out.' }] });
  // the investigation's BP arm, never the arm buddy's step-14 BP said early
  expect(Object.keys(s.parts).filter(k => k.startsWith('vital-signs/'))).toEqual([]);
  expect(s.lines.some(l => l.who === 'armBuddy')).toBe(false);
  const r = endRun(e, s, T0);
  expect(r.faults.filter(f => f.point === 'investigation/bp-arm')).toEqual([expect.objectContaining({ kind: 'wrong',
    detail: `Chose the ${said} arm. The patient ruled that arm out, so the BP goes on the ${offered} arm.` })]);
  expect(r.wrong).toEqual(['investigation/bp-arm']);
});

test('D23: in COPD, "Taking BP on the right arm." is right, with no flag and no fault', async () => {
  const s = await send(at13('copd-amk-01'), 'Taking BP on the right arm.');
  expect(s.hits['investigation/bp-arm']).toMatchObject({ check: 'right', chose: 'right arm' });
  expect(mine(s).at(-1)!.flags).toBeUndefined();
  expect(endRun(env, s, T0).faults.filter(f => f.point === 'investigation/bp-arm')).toEqual([]);
});

// The final fix review's lenient paths: an arm named with no BP off step 13, and one sentence with "BP" that names no
// arm, credit nothing; nor does an arm in a question, so no Wrong.
test('D23: "Right arm no injuries." at step 12 with the RBS done is no BP arm, and plays no BP', async () => {
  for (const id of ['copd-amk-01', 'bleed-woodlands-01']) {
    const s = await send(doneTo(12, 300_000, T0, id), 'Right arm no injuries.', T0, envOf(id));
    expect(s.hits['investigation/bp-arm'], id).toBeUndefined();
    expect(s.lines.some(l => (l.who === 'tester' || l.who === 'armBuddy') && l.text.startsWith('BP ')), id).toBe(false);
    expect(s.current, id).toBe(12);
  }
});
test('D23: an arm said on step 13 without "BP" counts there; in a question, an arm is no choice', async () => {
  const left = await send(at13('copd-amk-01'), 'OK, left arm then.');
  expect(left.hits['investigation/bp-arm']).toMatchObject({ check: 'right', chose: 'left arm' });
  const ccf = envOf('ccf-jurong-01');
  const asked = await send(at13('ccf-jurong-01'), 'Any shunt or fistula on your left arm?', T0, ccf);
  expect(asked.hits['investigation/bp-arm']).toBeUndefined();
  expect(mine(asked).at(-1)!.flags).toBeUndefined();
  const apex = await send(at13('copd-amk-01'), 'Auscultating on the right apex and left apex, then BP.');
  expect(apex.hits['investigation/bp-arm']).toBeUndefined();
  expect(apex.lines.some(l => l.who === 'tester' && l.text.startsWith('BP '))).toBe(false);
});

// ---- Task 2 fix round 1: a BP arm is credited leniently and graded Wrong only when chosen outright ----------------
// CREDIT: a sentence of the line names an allowed arm with BP, whatever else it says (questions too), or names one on
// step 13 without BP. WRONG: a statement names the ruled-out arm with BP, with no negation in the 3 words before it, and
// no sentence of the line credits an allowed arm. An arm without BP never gives Wrong, and credits only on step 13.
// CCF rules out the left arm (her fistula), bleed the right (his cut).
const RESTRICTED = [['ccf-jurong-01', 'left', 'right'], ['bleed-woodlands-01', 'right', 'left']] as const;
const cueOf = (id: string) => (id === 'bleed-woodlands-01' ? 'cut' : 'fistula');
/** The line sent on step 13 of the case (every step before it done, by default), and the run ended right after it. */
const armLine = async (id: string, line: string, s0: RunSession = at13(id)) => {
  const s = await send(s0, line, T0, envOf(id));
  return { s, line: mine(s).at(-1)!, faults: endRun(envOf(id), s, T0).faults.filter(f => f.point === 'investigation/bp-arm') };
};
/** The line's flags on the BP arm. */
const armFlags = (l: ChatLine) => (l.flags ?? []).filter(f => f.point === 'investigation/bp-arm');
/** The review's I1 lines: the ruled-out arm `o` said as ruled out, never as the BP arm. */
const RULED_OUT = (o: string, id: string) => [`Can't use the ${o} arm.`, `Cannot take BP on the ${o} arm.`, `${capitalise(o)} arm cannot.`,
  `Never the ${o} arm.`, `Won't use the ${o} arm.`, `${capitalise(o)} arm not suitable.`, `${capitalise(o)} arm is not allowed.`,
  `${capitalise(o)} arm no.`, `Except the ${o} arm.`, `Okay, ${o} arm is out.`,
  id === 'bleed-woodlands-01' ? `Noted, ${o} arm is bleeding.` : `Noted, ${o} arm is the dialysis arm.`, `${capitalise(o)} arm has a laceration.`,
  `Noted, ${o} arm has a ${cueOf(id)}.`, `Don't use the ${o} arm.`, `Avoid the ${o} arm.`];

test.each(RESTRICTED)('fix round 1 (I1): in %s, the %s arm said as ruled out gives no fault, and a later BP on the %s arm credits',
  async (id, out, offered) => {
    for (const text of RULED_OUT(out, id)) {
      const first = await armLine(id, text);
      expect(first.s.hits['investigation/bp-arm'], text).toBeUndefined();
      expect(armFlags(first.line), text).toEqual([]);
      expect(first.faults.map(f => f.kind), text).toEqual(['missed']);
      const then = await armLine(id, `Taking the BP on the ${offered} arm.`, first.s);
      expect(then.s.hits['investigation/bp-arm'], text).toMatchObject({ check: 'right', chose: `${offered} arm` });
      expect(then.faults, text).toEqual([]);
    }
  });
/** The case's canonical typed run with `extra` said just before step 13's line, each step's line filled at the ETA its
 *  own place in the run gives it (playRun's 20 s gaps; Approach is the 5th line). */
const canonicalWith13 = (id: string, extra: string[]): PlayInput[] => {
  const ids = STEPS.map(st => st.id);
  const at = STEPS.findIndex(st => st.order === 13);
  const order: (string | { step: string })[] = [...ids.slice(0, at).map(step => ({ step })), ...extra, ...ids.slice(at).map(step => ({ step }))];
  return order.map((x, i) => (typeof x === 'string' ? x : fill(x.step, caseById(id), etaMinutes(Math.max(0, i - 4) * 20_000))));
};
const faultKinds = (r: { faults: { kind: string; point: string }[] }) => r.faults.map(f => `${f.kind} ${f.point}`).sort();
test.each(RESTRICTED)('fix round 1 (I1): in a whole %s run, every %s-arm echo said before step 13 leaves the run\'s faults as they were',
  async (id, out) => {
    const plain = canonicalWith13(id, []);
    const echoed = canonicalWith13(id, RULED_OUT(out, id));
    const base = endRun(envOf(id), await playRun(id, 'coached', plain), T0 + (plain.length + 2) * 20_000);
    const s = await playRun(id, 'coached', echoed);
    expect(s.hits['investigation/bp-arm']).toMatchObject({ check: 'right' });
    expect(faultKinds(endRun(envOf(id), s, T0 + (echoed.length + 2) * 20_000))).toEqual(faultKinds(base));
    expect(s.lines.flatMap(armFlags)).toEqual([]);
  }, SLOW_MS);

/** The review's I2 lines (a negation or restriction elsewhere in a comma-less sentence) and I3 lines (tag questions,
 *  auxiliary-led statements, permission questions), naming the allowed arm `a` with BP. */
const CREDITED = (a: string, o: string, cue: string) => [`No shunt no fistula I'll take BP on your ${a} arm`,
  `OK no problem I'll take the BP on your ${a} arm`, `There's no shunt so I'll take BP on the ${a} arm.`, `BP on the ${a} arm since there is no shunt`,
  `BP on the ${a} arm because the ${o} has a ${cue}`, `${capitalise(a)} arm has no fistula so BP there`, `No fistula so BP on the ${a} arm`,
  `I'm not sure but I'll take BP on the ${a} arm`, `Do not worry I'll take BP on the ${a} arm.`,
  `I'll take your BP on the ${a} arm, OK?`, `Taking BP on the ${a} arm, okay?`, `Will take BP on the ${a} arm.`, `Can take BP on your ${a} arm.`,
  `Will be taking your BP on the ${a} arm.`, `May I take your BP on your ${a} arm?`, `Can I take the BP on your ${a} arm?`];
test.each(CASES.map(c => c.id))('fix round 1 (I2, I3): in %s, each arm the case allows, said with BP, credits with no fault', async id => {
  const c = caseById(id);
  for (const a of caseSlots(c, 6).bparm) {
    const o = a === 'left' ? 'right' : 'left';
    for (const text of CREDITED(a, o, cueOf(id))) {
      const { s, line, faults } = await armLine(id, text);
      expect(s.hits['investigation/bp-arm'], text).toMatchObject({ check: 'right', chose: `${a} arm` });
      expect(armFlags(line), text).toEqual([]);
      expect(faults, text).toEqual([]);
    }
  }
});
test.each(CASES.map(c => c.id))('fix round 1 (M1): in %s, the other and the good arm, R and L, and either arm where none is ruled out credit',
  async id => {
    const c = caseById(id);
    const a = c.findings.investigation.bpArm;
    const restricted = c.findings.investigation.bpArmRestricted === true;
    const letter = a === 'left' ? 'L' : 'R';
    for (const text of ['BP on the other arm.', 'Taking BP on her good arm.', `BP ${letter} arm`, `${letter} arm for BP`,
      ...(restricted ? [] : ['BP on either arm.'])]) {
      const { s, line, faults } = await armLine(id, text);
      expect(s.hits['investigation/bp-arm'], text).toMatchObject({ check: 'right', chose: `${a} arm` });
      expect(armFlags(line), text).toEqual([]);
      expect(faults, text).toEqual([]);
    }
    if (restricted) {   // either arm is no choice where one is ruled out: nothing, never Wrong
      const { s, line } = await armLine(id, 'BP on either arm.');
      expect(s.hits['investigation/bp-arm']).toBeUndefined();
      expect(armFlags(line)).toEqual([]);
    }
  });
test.each(RESTRICTED)('fix rounds 1 and 2: in %s, the BP tied to the %s arm is still Wrong', async (id, out, offered) => {
  // fix round 2 (m1): a negation in an opening clause, or after the tie, blocks no Wrong
  for (const text of [`BP on the ${out} arm.`, `Taking BP on your ${out} arm.`, `No problem, BP on the ${out} arm.`,
    `Don't move, BP on the ${out} arm.`, `BP on the ${out} arm, no problem.`, `${capitalise(out)} arm for the BP.`]) {
    const { s, line, faults } = await armLine(id, text);
    expect(s.hits['investigation/bp-arm'], text).toMatchObject({ check: 'wrong', chose: `${out} arm` });
    expect(armFlags(line), text).toEqual([{ kind: 'wrong', point: 'investigation/bp-arm', text: 'Not on that arm. The patient ruled it out.' }]);
    expect(faults.map(f => [f.kind, f.detail]), text)
      .toEqual([['wrong', `Chose the ${out} arm. The patient ruled that arm out, so the BP goes on the ${offered} arm.`]]);
  }
});
test.each(RESTRICTED)('fix round 1: in %s, a line naming both arms with BP is right, and a question on the %s arm gives nothing',
  async (id, out, offered) => {
    for (const text of [`${capitalise(out)} arm has a ${cueOf(id)}, so BP on the ${offered} arm.`,
      `Since your ${out} arm has a ${cueOf(id)}, I'll take the BP on your ${offered} arm.`, `Don't use the ${out} arm, BP on the ${offered}.`,
      `Taking BP on the ${offered} arm. OK, ${out} arm then.`, `BP on the ${out} arm. No wait, BP on the ${offered} arm.`,
      `${capitalise(out)} arm or ${offered} arm for the BP?`, `Can I take the BP on your ${offered} arm?`]) {
      const { s, line, faults } = await armLine(id, text);
      expect(s.hits['investigation/bp-arm'], text).toMatchObject({ check: 'right', chose: `${offered} arm` });
      expect(armFlags(line), text).toEqual([]);
      expect(faults, text).toEqual([]);
    }
    for (const text of [`Can I take the BP on your ${out} arm?`, `Any shunt or fistula on your ${out} arm?`]) {
      const { s, line, faults } = await armLine(id, text);
      expect(s.hits['investigation/bp-arm'], text).toBeUndefined();
      expect(armFlags(line), text).toEqual([]);
      expect(faults.map(f => f.kind), text).toEqual(['missed']);
    }
  });
// I4: the D23 context rule. Without BP an arm counts only on step 13: at step 12 (the RBS done) nothing, in a restricted
// case or not; on step 13 an allowed arm credits, and a ruled-out one gives nothing.
test('fix round 1 (I4): without BP an arm is no BP arm off step 13; on step 13 an allowed one credits, a ruled-out one gives nothing',
  async () => {
    for (const [id, text] of [['bleed-woodlands-01', 'Right arm, no injuries.'], ['bleed-woodlands-01', 'Right arm ok.'],
      ['bleed-woodlands-01', 'Left arm, no injuries.'], ['ccf-jurong-01', 'Left arm ok.'], ['ccf-jurong-01', 'Right arm ok.'],
      ['copd-amk-01', 'Left arm normal, right arm normal.'], ['copd-amk-01', 'Right arm, no injuries.']] as const) {
      const s = await send(doneTo(12, 300_000, T0, id), text, T0, envOf(id));
      expect(s.hits['investigation/bp-arm'], `${id}: ${text}`).toBeUndefined();
      expect(armFlags(mine(s).at(-1)!), `${id}: ${text}`).toEqual([]);
      expect(s.lines.some(l => (l.who === 'tester' || l.who === 'armBuddy') && l.text.startsWith('BP ')), `${id}: ${text}`).toBe(false);
      expect(s.current, `${id}: ${text}`).toBe(12);
    }
    for (const c of CASES) {
      const a = c.findings.investigation.bpArm;
      const { s, faults } = await armLine(c.id, `OK, ${a} arm then.`);
      expect(s.hits['investigation/bp-arm'], c.id).toMatchObject({ check: 'right', chose: `${a} arm` });
      expect(faults, c.id).toEqual([]);
    }
    for (const [id, out] of RESTRICTED) {
      const { s, line } = await armLine(id, `OK, ${out} arm then.`);
      expect(s.hits['investigation/bp-arm'], id).toBeUndefined();
      expect(armFlags(line), id).toEqual([]);
    }
  });

// ---- Task 2 fix round 2 (N1): Wrong needs the arm tied to the BP ---------------------------------------------------
// Wrong only for "BP (on|from|at|in)? (the|your|her|his|this)? {arm}( arm)?" or "{arm} arm for (the|your)? BP", with no
// negation before the tie in its comma or semicolon clause and no restriction within 3 words of the arm. Both words in
// one sentence are no tie. The re-review's N1 lines, with the ruled-out arm `o` and its restriction `cue`:
const N1_LINES = (o: string, cue: string) => {
  const O = capitalise(o);
  return [`${O} arm has a ${cue}, BP on the other one.`, `${O} arm has a ${cue}, so BP on the opposite arm.`,
    `${O} arm got ${cue}, use the other side for BP.`, `Use the other one for BP, ${o} arm has a ${cue}.`, `${O} arm has a ${cue} so no BP there.`,
    `${O} arm has a ${cue}, so no BP on that arm.`, `${O} arm got ${cue}, cannot take BP.`, `Noted, ${o} arm has a ${cue}, no BP on that side.`,
    `Okay, ${o} arm has ${cue}, so no BP on ${o} arm.`, `${O} arm has a ${cue}, I won't take the BP there.`, `${O} arm ${cue}, no BP.`,
    `${O} arm ${cue}, BP later.`, `${capitalise(cue)} on the ${o} arm, checking BP now.`, `Not going to take BP on the ${o} arm.`,
    `BP should not be taken on the ${o} arm.`, `${o.charAt(0).toUpperCase()} arm no BP.`,
    // (b), and the ruling's own lines
    `${O} arm no BP.`, `${O} arm not for BP.`, `${O} arm not suitable for BP.`, `${O} arm cannot take BP.`, `${O} arm cannot be used for BP.`,
    `${O} arm is a no-go for BP.`, `Shouldn't take BP on the ${o} arm.`, `I won't be taking your BP on the ${o} arm.`, `no BP on the ${o} arm`];
};
test.each(RESTRICTED)('fix round 2 (N1): in %s, the %s arm said as ruled out beside BP is never Wrong', async (id, out, offered) => {
  for (const text of N1_LINES(out, cueOf(id))) {
    const { s, line, faults } = await armLine(id, text);
    const hit = s.hits['investigation/bp-arm'];
    if (hit !== undefined) expect(hit, text).toMatchObject({ check: 'right', chose: `${offered} arm` });
    expect(armFlags(line), text).toEqual([]);
    expect(faults.filter(f => f.kind !== 'missed'), text).toEqual([]);
  }
  // the other one is the allowed arm, so this one credits
  const other = await armLine(id, `${capitalise(out)} arm has a ${cueOf(id)}, BP on the other one.`);
  expect(other.s.hits['investigation/bp-arm']).toMatchObject({ check: 'right', chose: `${offered} arm` });
  // at step 14 with the BP arm still to do, and at step 12 with the RBS done
  const at14 = { ...doneTo(13, 400_000, T0, id), current: 14 };
  const pending = { ...at14, hits: Object.fromEntries(Object.entries(at14.hits).filter(([k]) => k !== 'investigation/bp-arm')) };
  for (const [s0, text] of [[pending, `Arm buddy, ${out} arm has a ${cueOf(id)}, no BP there.`],
    [doneTo(12, 300_000, T0, id), `${capitalise(out)} arm no injuries, BP later.`]] as const) {
    const { s, line, faults } = await armLine(id, text, s0);
    expect(s.hits['investigation/bp-arm'], text).toBeUndefined();
    expect(armFlags(line), text).toEqual([]);
    expect(faults.filter(f => f.kind !== 'missed'), text).toEqual([]);
  }
});
test.each(RESTRICTED)('fix round 2 (N1): in a whole %s run, each %s-arm line said beside BP before step 13 leaves the run\'s faults as they were',
  async (id, out) => {
    const plain = canonicalWith13(id, []);
    const base = endRun(envOf(id), await playRun(id, 'coached', plain), T0 + (plain.length + 2) * 20_000);
    const said = canonicalWith13(id, N1_LINES(out, cueOf(id)));
    const s = await playRun(id, 'coached', said);
    expect(s.hits['investigation/bp-arm']).toMatchObject({ check: 'right' });
    expect(faultKinds(endRun(envOf(id), s, T0 + (said.length + 2) * 20_000))).toEqual(faultKinds(base));
    expect(s.lines.flatMap(armFlags)).toEqual([]);
  }, SLOW_MS);
// ---- Final review I1: the negation after the tie ------------------------------------------------------------------
// The clause guard looks before and after the tied phrase in its comma or semicolon clause, and a restriction word
// anywhere in that clause blocks the Wrong too. So the ruled-out arm `o` said as ruled out, with the negation after it,
// gives no fault; a negation in another clause still gives Wrong.
const AFTER_TIE = (o: string, cue: string) => [`BP on the ${o} arm cannot.`, `BP on the ${o} arm not possible because of the ${cue}.`,
  `BP on the ${o} arm is not allowed.`, `Taking BP on the ${o} arm is not advisable due to her ${cue}.`, `Noted, BP on the ${o} arm cannot.`,
  `BP on the ${o} arm not possible, it is injured.`, `BP on the ${o} arm cannot, got a ${cue}.`];
const STILL_WRONG = (o: string) => [`BP on the ${o} arm.`, `BP on the ${o} arm, no problem.`, `No problem, BP on the ${o} arm.`, `Taking BP on your ${o} arm.`];
/** Step 13's canonical line for the case, at the ETA its place in a canonical run gives it. */
const canonical13 = (id: string) => fill('investigation', caseById(id), etaMinutes(8 * 20_000));
test.each(RESTRICTED)('final review (I1): in %s, the %s arm tied to the BP with a negation after it gives no fault, and the canonical line then credits',
  async (id, out, offered) => {
    for (const text of AFTER_TIE(out, cueOf(id))) {
      const first = await armLine(id, text);
      expect(first.s.hits['investigation/bp-arm'], text).toBeUndefined();
      expect(armFlags(first.line), text).toEqual([]);
      expect(first.faults.map(f => f.kind), text).toEqual(['missed']);
      const then = await armLine(id, canonical13(id), first.s);
      expect(then.s.hits['investigation/bp-arm'], text).toMatchObject({ check: 'right', chose: `${offered} arm` });
      expect(then.faults, text).toEqual([]);
    }
    for (const text of STILL_WRONG(out)) {
      const { s, line, faults } = await armLine(id, text);
      expect(s.hits['investigation/bp-arm'], text).toMatchObject({ check: 'wrong', chose: `${out} arm` });
      expect(armFlags(line), text).toEqual([{ kind: 'wrong', point: 'investigation/bp-arm', text: 'Not on that arm. The patient ruled it out.' }]);
      expect(faults.map(f => f.kind), text).toEqual(['wrong']);
    }
  });
test.each(RESTRICTED)('final review (I1): in a whole %s run, the %s arm said with a negation after the tie leaves the faults as they were; a tie with none is Wrong',
  async (id, out) => {
    const plain = canonicalWith13(id, []);
    const base = endRun(envOf(id), await playRun(id, 'coached', plain), T0 + (plain.length + 2) * 20_000);
    const said = canonicalWith13(id, AFTER_TIE(out, cueOf(id)));
    const s = await playRun(id, 'coached', said);
    expect(s.hits['investigation/bp-arm']).toMatchObject({ check: 'right' });
    expect(faultKinds(endRun(envOf(id), s, T0 + (said.length + 2) * 20_000))).toEqual(faultKinds(base));
    expect(s.lines.flatMap(armFlags)).toEqual([]);
    for (const text of STILL_WRONG(out)) {
      const wrong = canonicalWith13(id, [text]);
      const w = await playRun(id, 'coached', wrong);
      expect(w.hits['investigation/bp-arm'], text).toMatchObject({ check: 'wrong', chose: `${out} arm` });
      expect(faultKinds(endRun(envOf(id), w, T0 + (wrong.length + 2) * 20_000)), text)
        .toEqual([...faultKinds(base), 'wrong investigation/bp-arm'].sort());
    }
  }, SLOW_MS);
// ---- Final review residual: unable, contraindicated, ", cannot."; assents stay assents ------------------------------
const RESIDUAL = (o: string) => [`Unable to take BP on the ${o} arm.`, `BP on the ${o} arm is contraindicated.`, `BP on the ${o} arm unable.`,
  `BP on the ${o} arm, cannot.`, `BP on the ${o} arm, not possible.`];
const MUST_STAY_WRONG = (o: string) => [`BP on the ${o} arm.`, `BP on the ${o} arm, no problem.`, `No problem, BP on the ${o} arm.`,
  `Taking BP on your ${o} arm.`, `${capitalise(o)} arm for the BP.`];
test.each(RESTRICTED)('final review residual: in %s, the %s arm said as unable, contraindicated or ", cannot." gives no fault; the must-stay lines are Wrong',
  async (id, out, offered) => {
    for (const text of RESIDUAL(out)) {
      const first = await armLine(id, text);
      expect(first.s.hits['investigation/bp-arm'], text).toBeUndefined();
      expect(armFlags(first.line), text).toEqual([]);
      expect(first.faults.map(f => f.kind), text).toEqual(['missed']);
      const then = await armLine(id, canonical13(id), first.s);
      expect(then.s.hits['investigation/bp-arm'], text).toMatchObject({ check: 'right', chose: `${offered} arm` });
      expect(then.faults, text).toEqual([]);
    }
    for (const text of [...MUST_STAY_WRONG(out), `OK no problem I'll take the BP on your ${out} arm`]) {
      const { s, line, faults } = await armLine(id, text);
      expect(s.hits['investigation/bp-arm'], text).toMatchObject({ check: 'wrong', chose: `${out} arm` });
      expect(armFlags(line), text).toEqual([{ kind: 'wrong', point: 'investigation/bp-arm', text: 'Not on that arm. The patient ruled it out.' }]);
      expect(faults.map(f => f.kind), text).toEqual(['wrong']);
    }
  });
test.each(RESTRICTED)('final review residual: in a whole %s run, the %s arm said as unable or ", cannot." leaves the faults as they were; each must-stay line adds a Wrong',
  async (id, out) => {
    const plain = canonicalWith13(id, []);
    const base = endRun(envOf(id), await playRun(id, 'coached', plain), T0 + (plain.length + 2) * 20_000);
    const said = canonicalWith13(id, RESIDUAL(out));
    const s = await playRun(id, 'coached', said);
    expect(s.hits['investigation/bp-arm']).toMatchObject({ check: 'right' });
    expect(faultKinds(endRun(envOf(id), s, T0 + (said.length + 2) * 20_000))).toEqual(faultKinds(base));
    expect(s.lines.flatMap(armFlags)).toEqual([]);
    for (const text of MUST_STAY_WRONG(out)) {
      const wrong = canonicalWith13(id, [text]);
      const w = await playRun(id, 'coached', wrong);
      expect(w.hits['investigation/bp-arm'], text).toMatchObject({ check: 'wrong', chose: `${out} arm` });
      expect(faultKinds(endRun(envOf(id), w, T0 + (wrong.length + 2) * 20_000)), text)
        .toEqual([...faultKinds(base), 'wrong investigation/bp-arm'].sort());
    }
  }, SLOW_MS);
test.each(CASES.map(c => c.id))('fix round 2 (m2, m4): in %s, either or any arm in a question, and L/R or R/L, credit nothing', async id => {
  for (const text of ['Any shunt or fistula on either arm?', 'Any arm pain?', 'BP L/R arm.', 'BP R/L arm.']) {
    const { s, line } = await armLine(id, text);
    expect(s.hits['investigation/bp-arm'], text).toBeUndefined();
    expect(armFlags(line), text).toEqual([]);
  }
});

test('carry D2: blankSession is startRun itself', () => {
  expect(blankSession('bleed-woodlands-01', 'exam')).toEqual(startRun(envOf('bleed-woodlands-01'), 'exam', IDS, T0));
});

test('carry: a tapped step 13 records the case\'s ECG; tapped steps 10 and 15 the case\'s oxygen, the SpO2 read before it goes on', () => {
  for (const id of ['fall-yishun-01', 'copd-amk-01']) {   // a 4-lead case (the canonical line also names 12-lead) and a 12-lead one
    const c = caseById(id);
    const e = envOf(id);
    let s = doneTo(9, 300_000, T0, id);
    s = tapStep(e, s, 'breathing', T0).session;
    const exp = c.expected.oxygen;
    expect(s.oxygen).toEqual({ device: exp.device, flow: exp.flowMin, atMs: 300_000, right: true });
    expect(s.hits['breathing/mask-flow']).toMatchObject({ check: 'right', tapped: true });
    expect(s.lines.find(l => l.who === 'armBuddy')!.text).toBe(`SpO2 ${c.vitals.roomAir.spo2}% on room air.`);
    s = tapStep(e, { ...s, current: 12 }, 'investigation', T0).session;
    expect(s.ecg).toBe(c.expected.ecg);
    expect(s.hits['investigation/ecg']).toMatchObject({ check: 'right', chose: c.expected.ecg, tapped: true });
    s = tapStep(e, { ...s, current: 14 }, 'oxygen', T0).session;
    expect(s.hits['oxygen/maintain-titrate']).toMatchObject({ check: 'right', tapped: true });
    expect(s.oxygen).toMatchObject({ device: exp.device, right: true });
    expect(s.lines.filter(l => l.who === 'armBuddy').at(-1)!.text).toMatch(new RegExp(`^SpO2 ${c.vitals.afterO2.spo2}% on `));
  }
});

test('carry: a re-ask never jumps the run ahead or credits an RBS region early (Task 9 review, carry A)', async () => {
  let s = doneTo(10, 200_000);
  s = await send(s, 'Is there chest rise and fall?', T0);
  expect(s.current).toBe(10);
  expect(Object.keys(s.parts).filter(k => k.startsWith('rapid-body-survey/'))).toEqual([]);
  expect(s.stepTimes['rapid-body-survey']).toBeUndefined();
  s = await send(s, 'Checking the radial pulse.', T0 + 10_000);
  expect(s.hits['circulation/pulse']).toBeDefined();
  expect(Object.keys(s.parts).filter(k => k.startsWith('vital-signs/'))).toEqual([]);
  expect(s.current).toBe(11);
  // the RBS itself, said in order once the step is reached, is clean
  s = await send(s, 'What is the rate and quality of the pulse?', T0 + 20_000);
  s = await send(s, 'Sir, I am going to conduct a rapid body survey, please allow me.', T0 + 30_000);
  s = await send(s, RBS_LINE, T0 + 40_000);
  const rbs = classify(STEPS, copd, s, 260_000).faults.filter(f => f.point === 'rapid-body-survey/rbs-regions');
  expect(rbs).toEqual([]);
});

test('carry: a part-only read of a step ahead never moves the run; a far-ahead hit moves it at most 2 steps', async () => {
  // with circulation done, each of these is read as one RBS region (the Task 9 review's re-asks)
  for (const line of ['Is the pulse at the neck strong?', 'Sir, any pain in your back?']) {
    const s = await send(doneTo(11, 150_000), line);
    expect(s.current).toBe(11);
    expect(Object.keys(s.parts).filter(k => k.startsWith('rapid-body-survey/'))).toEqual([]);
    expect(s.stepTimes['rapid-body-survey']).toBeUndefined();
  }
  // on scene, from step 5: Circulation is 6 ahead (fix round 3 moved this example off the phone, which has its own rule)
  const s = await send({ ...hitAll(blankSession('copd-amk-01'), STEPS, copd, upTo(4)), current: 5 }, 'Checking the radial pulse.', T0);
  expect(s.current).toBe(7);
  expect(s.hits['circulation/pulse']).toMatchObject({ during: 5, atMs: null });
  // fix round 1, I1: nor does it reach Circulation, so the clock waits and the step has no time
  expect(s.clock.started).toBe(false);
  expect(s.stepTimes).toEqual({});
});

// The post-breaker ruling replaces the phone rules of rounds 3–5 (a lone question past the next two steps dropped): the
// call ends at an explicit arrival, stored on the session.
test('before arrival a sentence reading only a scene step reads nothing; the call ends only at an arrival (a) to (d)', async () => {
  const s0 = blankSession('copd-amk-01');
  // dropped: no credit, no move, no reply, the call goes on; a statement is held, a question never is (it ends with "?"
  // or opens with a question word, past the addressee words and fillers)
  for (const [line, held] of [['Is there any bleeding?', false], ['Ops Ctr, is there any bleeding?', false], ['Is there any bleeding', false],
    ['Any bleeding', false], ['OK, is there any bleeding', false], ['Which side is bleeding', false], ['Sir, can you hear me?', false],
    ['Please do not move your head.', true], ['Do not move your head.', true], ['Approaching the patient from the front.', true],
    ['Keep him warm with a blanket.', false]] as const) {   // one preparation item is no preparation
    const s = await send(s0, line, T0);   // from step 1: Approach is a scene step
    expect(s.lines.slice(s0.lines.length), line).toEqual([{ who: 'you', text: line, atMs: null, route: NOT_UNDERSTOOD }]);
    expect([s.current, s.hits, s.parts, s.arrived, s.held], line).toEqual([1, {}, {}, false, held ? s0.lines.length : null]);
  }
  // arrival, read on scene within the line's 2-step cap: (a) preparation, two items of it or a point whole; (b) said to a
  // buddy, the crew or the tester; (c) two points of one scene step, in one sentence or a line of questions
  // (parts alone never move the run, Task 9 carry A)
  const arrive: [string, number, string[]][] = [
    ['Bring the O2 bag and the Zoll.', 1, ['preparation/equipment/o2-bag', 'preparation/equipment/zoll']],
    ['Buddy, please hold the head.', 3, ['introduction/head-grip']],
    ['Tester, are there any hazards?', 3, ['scene-evaluation/hazards']],
    ['Crew, any hazards?', 3, ['scene-evaluation/hazards']],
    ['Do not move your head, is there any catastrophic bleeding?', 3, ['approach-patient/catastrophic-bleeding', 'approach-patient/sound-out']],
    ['Any witnesses or hazards?', 3, ['scene-evaluation/hazards', 'scene-evaluation/witnesses']],
    ['Any witnesses? Any hazards?', 3, ['scene-evaluation/hazards', 'scene-evaluation/witnesses']],
  ];
  for (const [line, current, keys] of arrive) {
    const s = await send(s0, line, T0);
    expect([s.arrived, s.held, s.current, [...Object.keys(s.hits), ...Object.keys(s.parts)].sort()], line).toEqual([true, null, current, keys]);
    expect([s.clock.started, s.stepTimes], line).toEqual([false, {}]);   // nothing past the cap is reached (I1)
  }
  // (d): after the whole call, the notes' sound-out arrives; its first sentence is still the caller's "casualties"
  const called = await playRun('copd-amk-01', 'coached', [canon('copd-amk-01', 'respond-call'), canon('copd-amk-01', 'call-caller')]);
  const out = await send(called, SOUND_OUT, T0 + 60_000);
  expect([called.arrived, out.arrived, called.current, out.current, out.hits['approach-patient/sound-out']?.missing]).toEqual([false, true, 2, 4, ['front']]);
  // (d) by a question only about the step next: "Are there any witnesses?" after the whole call is the scene's, while
  // "Is there any bleeding?" (Approach, further on) is still asked of the caller
  const asked = await send(called, 'Are there any witnesses?', T0 + 60_000);
  expect([asked.arrived, asked.hits['scene-evaluation/witnesses'] !== undefined]).toEqual([true, true]);
  expect((await send(called, 'Is there any bleeding?', T0 + 60_000)).arrived).toBe(false);
});

test('carry: a sweep naming every RBS region counts before the step is reached, and never moves the run', async () => {
  const s0 = doneTo(11, 150_000);
  const r = await sendLine(env, s0, 'Head, neck, chest, abdomen, pelvis, lower extremities, upper extremities and back.', T0);
  expect(r.session.current).toBe(11);
  expect(r.session.hits['rapid-body-survey/rbs-regions']).toMatchObject({ line: s0.lines.length, during: 11 });
  expect(r.announce).toEqual(['RBS done at 2:30.']);
  expect(classify(STEPS, copd, r.session, 200_000).faults.filter(f => f.point === 'rapid-body-survey/rbs-regions')).toEqual([]);
});

test('carry: parts read in one sentence keep their own places, so a slip inside it is seen', async () => {
  const at11 = doneTo(11, 150_000);
  const slip = await send(at11, 'Head, neck, chest, pelvis, abdomen, lower extremities, upper extremities and back, with eye contact.');
  expect(classify(STEPS, copd, slip, 200_000).faults.filter(f => f.point === 'rapid-body-survey/rbs-regions'))
    .toEqual([expect.objectContaining({ kind: 'order', detail: 'Out of order: Pelvis before Abdomen.' })]);
  const pos = ['head', 'neck', 'chest'].map(p => slip.parts[`rapid-body-survey/rbs-regions/${p}`]!.pos);
  expect(new Set(pos).size).toBe(3);
  // "arm" in "arm buddy" is an addressee, not the arms, so it takes no place first
  const buddy = await send(at11, 'Arm buddy, with eye contact: head, neck, chest, abdomen, pelvis, legs, arms and back.');
  expect(classify(STEPS, copd, buddy, 200_000).faults.filter(f => f.point === 'rapid-body-survey/rbs-regions')).toEqual([]);
});

test('carry: NEW_CLOCK is never written into', async () => {
  const s0 = blankSession('copd-amk-01');
  const s = await send(hitAll(s0, STEPS, copd, upTo(4)), SOUND_OUT, T0 + 5_000);
  expect(s.clock.started).toBe(true);
  expect(s.clock).not.toBe(NEW_CLOCK);
  expect(NEW_CLOCK).toEqual({ started: false, bankedMs: 0, runningSince: null });
  expect(Object.isFrozen(NEW_CLOCK)).toBe(true);
  expect(s0.clock).toBe(NEW_CLOCK);
  expect(pauseRun(s0, T0).clock).toEqual(NEW_CLOCK);
});

test('carry: each sentence\'s replies take the oxygen as it stood at that sentence', async () => {
  const s = await send(doneTo(9, 200_000), 'Arm buddy, please measure the SpO2 reading on room air. Head buddy, nasal cannula 2 litres.');
  expect(s.lines.slice(-2)).toEqual([
    { who: 'armBuddy', text: 'SpO2 86% on room air.', atMs: 200_000 },
    { who: 'headBuddy', text: 'Nasal cannula on, 2 L/min.', atMs: 200_000 },
  ]);
  expect(s.readings).toEqual([{ key: 'spo2', value: '86', atMs: 200_000, o2: 'RA' }]);
  const typed = await send(doneTo(9, 200_000), `${fill('breathing', copd, 16)} Nasal cannula 2 litres.`);
  expect(typed.lines.find(l => l.who === 'armBuddy')!.text).toBe('SpO2 86% on room air.');
  expect(typed.oxygen).toMatchObject({ device: 'nasal-cannula', right: true });
  // fix round 1, I3: the choice the line completes is graded whole (no Phrase), and the head buddy confirms it
  expect(mine(typed).at(-1)!.flags).toBeUndefined();
  expect(typed.hits['breathing/mask-flow']).toMatchObject({ check: 'right', chose: 'nasal cannula 2 L/min' });
  expect(typed.lines.filter(l => l.who === 'headBuddy').map(l => l.text)).toEqual(['Nasal cannula on, 2 L/min.']);
});

test('fix round 1, I2: within one sentence, a point asked before the mask goes on is answered on room air', async () => {
  for (const line of ['Arm buddy please measure SpO2 on room air, head buddy nasal cannula 2 litres.',
    'SpO2 on room air then put on nasal cannula 2 litres.']) {
    const s = await send(doneTo(9, 200_000), line);
    expect(s.lines.slice(-2), line).toEqual([
      { who: 'armBuddy', text: 'SpO2 86% on room air.', atMs: 200_000 },
      { who: 'headBuddy', text: 'Nasal cannula on, 2 L/min.', atMs: 200_000 },
    ]);
    expect(s.readings, line).toEqual([{ key: 'spo2', value: '86', atMs: 200_000, o2: 'RA' }]);
  }
  // asked after the mask goes on, it is read on the mask
  const after = await send(doneTo(9, 200_000), 'Head buddy nasal cannula 2 litres, then arm buddy measure the SpO2.');
  expect(after.readings).toEqual([{ key: 'spo2', value: '90', atMs: 200_000, o2: 'NC' }]);
});

test('fix round 1, I3: an oxygen choice finished later in the line is graded on the whole choice', async () => {
  const flow = await send(doneTo(9, 200_000), 'Head buddy, nasal cannula please. 2 litres.');
  expect(flow.hits['breathing/mask-flow']).toMatchObject({ check: 'right', chose: 'nasal cannula 2 L/min' });
  expect(mine(flow).at(-1)!.flags).toBeUndefined();
  expect(flow.oxygen).toMatchObject({ device: 'nasal-cannula', flow: 2, right: true });
  const notes = await send(doneTo(9, 200_000), 'Putting on the appropriate mask and flow rate based on Guidelines. Nasal cannula 2 litres.');
  expect(notes.hits['breathing/mask-flow']).toMatchObject({ check: 'right', chose: 'nasal cannula 2 L/min' });
  expect(mine(notes).at(-1)!.flags).toBeUndefined();
  // the first sentence's reply had nothing to say (no oxygen on yet), so it still speaks once the cannula goes on
  expect(notes.lines.slice(-1)).toEqual([{ who: 'headBuddy', text: 'Nasal cannula on, 2 L/min.', atMs: 200_000 }]);
  // a changed device takes its own flow: the NRM's 15 is not the cannula's
  const swap = await send(doneTo(9, 200_000), 'NRM 15 litres. No, nasal cannula.');
  expect(swap.hits['breathing/mask-flow']).toMatchObject({ check: 'wrong', chose: 'nasal cannula' });
  // the ECG too: the line's last type named is the one graded
  const fall = envOf('fall-yishun-01');
  const ecg = await send(doneTo(12, 300_000, T0, 'fall-yishun-01'), 'Prepare the 12-lead ECG. Sorry, 4-lead.', T0, fall);
  expect(ecg.hits['investigation/ecg']).toMatchObject({ check: 'right', chose: '4-lead' });
});

test('carry: stepTimes holds timed steps only, from the clock\'s start', async () => {
  const s = await playRun('copd-amk-01', 'coached', [STEP1, 'Hi, I am calling from 995 FMV. May I know what happened to the patient?',
    'Crew, please don gloves and mask.', 'Are there any witnesses?']);
  expect(s.stepTimes).toEqual({});
  expect(s.clock.started).toBe(false);
  const t = await send(s, SOUND_OUT, T0 + 200_000);
  expect(t.stepTimes).toEqual({ 'approach-patient': 0 });
});

test('carry: every RBS time shown goes through rbsShown (a late one rounds up)', async () => {
  const r = await sendLine(env, doneTo(11, 180_400), RBS_LINE, T0);
  expect(r.announce).toEqual(['RBS done at 3:01.']);
});

test('carry: every number in the session stays finite, even for a time that is not one', async () => {
  const s = await send(doneTo(4), SOUND_OUT, Number.NaN);
  expect(Number.isFinite(s.lastAt)).toBe(true);
  expect(pauseRun(s, Number.POSITIVE_INFINITY).lastAt).toBe(s.lastAt);
  expect(tapStep(env, s, 'introduction', Number.NaN).session.lastAt).toBe(s.lastAt);
  expect(numbers(s).every(Number.isFinite)).toBe(true);
});

test('the dev check throws on a session holding a number that isn\'t finite (dev builds and Vitest only)', () => {
  expect(import.meta.env.DEV).toBe(true);
  const bad = { ...blankSession('copd-amk-01'), stepTimes: { 'approach-patient': Number.NaN } };
  expect(() => pauseRun(bad, T0)).toThrow("The run session holds a number that isn't finite at session.stepTimes.approach-patient.");
});

test('a tapped point records the sentence of the canonical line that says it', () => {
  const s = tapStep(env, { ...blankSession('copd-amk-01'), current: 3 }, 'scene-evaluation', T0).session;
  expect(s.hits['scene-evaluation/moi']!.said).toBe('MOI is suspected case of elderly female, breathlessness.');
  expect(s.hits['scene-evaluation/witnesses']!.said).toBe('Are there any witnesses?');
});

// ---- Fix round 1 --------------------------------------------------------------------------------------------

/** The case's canonical line for a step, at ETA 15. */
const canon = (id: string, stepId: string) => fill(stepId, caseById(id), 15);

test('I1: a phone question read as a step far ahead never starts the clock; the RBS is timed from Approach', async () => {
  // the reviewer's p11 runs: the call with one natural question added, then every step's canonical line 20 s apart
  for (const [id, question] of [['fall-yishun-01', 'Did he fall from a height?'], ['copd-amk-01', 'Is there any bleeding?']] as const) {
    const call = canon(id, 'call-caller').replace('May I know what happened to the patient?', `May I know what happened to the patient? ${question}`);
    const inputs = [canon(id, 'respond-call'), call, ...STEPS.filter(x => x.order >= 3).map(x => canon(id, x.id))];
    const e = envOf(id);
    let s = startRun(e, 'coached', IDS, T0);
    const announced: string[] = [];
    for (const [i, input] of inputs.entries()) {
      const r = await sendLine(e, s, input, T0 + (i + 1) * 20_000);
      s = r.session;
      announced.push(...r.announce);
      if (i < 4) expect(s.clock.started, `${id} line ${i + 1}`).toBe(false);   // the call, preparation and scene: untimed
    }
    expect(announced, id).toEqual(['RBS done at 2:20.']);   // Approach at 1:40 on the wall, RBS at 4:00
    expect(s.stepTimes['delicate-spine'], id).toBe(60_000);
    expect(endRun(e, s, T0 + 21 * 20_000).usedMs, id).toBe(320_000);
    // fix round 2: the fall question in the call is the caller's, read at step 2 as the line reached it
    if (id === 'fall-yishun-01') {
      expect(s.hits['delicate-spine/ask-fall']!.line, id).toBeGreaterThan(5);
      expect(s.lines.slice(0, 6).filter(l => l.who === 'patient'), id).toEqual([]);
    }
  }
});

test('I4: a stray early hit of the RBS step never lets a later re-ask credit a region', async () => {
  // the reviewer's p16: "abnormalities" said at Airway is read as the RBS point; the neck re-ask at Circulation then
  // must not credit the neck, so the correct RBS that follows has no "Neck before Head."
  const steps = (a: number, b: number) => STEPS.filter(x => x.order >= a && x.order <= b).map(x => canon('copd-amk-01', x.id));
  const airway = 'Sir, are you still with me? Patient is conscious and airway is clear. Checking the mouth for any abnormalities. Smelling for GTN, alcohol or fruity smell.';
  const s = await playRun('copd-amk-01', 'coached', [...steps(1, 8), airway, ...steps(10, 10), 'Checking the radial pulse.',
    'Is the pulse at the neck strong?', 'What is the rate and quality of the pulse?', ...steps(12, 13)]);
  expect(s.hits['rapid-body-survey/abnormalities']).toBeDefined();   // the stray hit the scenario needs
  expect(s.parts['rapid-body-survey/rbs-regions/neck']!.line).toBe(s.hits['rapid-body-survey/rbs-regions']!.line);
  expect(endRun(env, s, T0 + 20 * 20_000).faults.filter(f => f.point === 'rapid-body-survey/rbs-regions')).toEqual([]);
});

test('m1: a whole hit of the step in the same line opens it for its ordered parts (the entered clause)', async () => {
  const s = await send(doneTo(9, 100_000),
    'Sir, I am going to conduct a Rapid Body Survey to check for any life or limb threatening injuries. Head and neck.');
  expect(s.hits['rapid-body-survey/rbs-permission']).toBeDefined();
  expect(s.current).toBe(11);   // the 2-step window
  expect(Object.keys(s.parts).filter(k => k.startsWith('rapid-body-survey/rbs-regions/')).sort())
    .toEqual(['rapid-body-survey/rbs-regions/head', 'rapid-body-survey/rbs-regions/neck']);
});

test('I5: the GCS a trainee states: an explicit total first, then E, V and M summed, then a lone figure', async () => {
  const at14 = doneTo(13, 500_000);
  const gcs = async (line: string) => (await send(at14, line)).readings.filter(r => r.key === 'gcs').map(r => r.value);
  for (const line of ['GCS score: 4 + 5 + 6 = 15.', 'GCS score is 4 + 5 + 6, total 15.', 'GCS score 4, 5, 6, total 15.',
    'GCS score E4 V5 M6, total 15.', 'GCS score: eyes 4, verbal 5, motor 6, total 15.']) expect(await gcs(line), line).toEqual(['15']);
  expect(await gcs('GCS score E4 V5 M6.')).toEqual(['15']);
  expect(await gcs('GCS score E4V4M6.')).toEqual(['14']);
  expect(await gcs('GCS score is 13.')).toEqual(['13']);
  // fix round 3 (R2): a lone figure only when it is alone; several with no total or E/V/M read nothing, never the first
  expect(await gcs('GCS score: 4 + 5 + 6.')).toEqual([]);
  // m1: only 3 to 15; a lone figure only where the GCS is named
  expect(await gcs('GCS score is 2.')).toEqual([]);
  expect(await gcs('Total 20/15.')).toEqual([]);
  expect(await gcs('Pain score 7.')).toEqual([]);
});

test('I6: a flow too long to be a number is no flow, so the run stays saveable', async () => {
  const s = await send(doneTo(9, 200_000), `Nasal cannula 2 litres. ${'9'.repeat(309)} litres.`);
  expect(numbers(s).every(Number.isFinite)).toBe(true);
  expect(s.oxygen).toMatchObject({ device: 'nasal-cannula', flow: 2, right: true });
  expect(s.hits['breathing/mask-flow']).toMatchObject({ check: 'right', chose: 'nasal cannula 2 L/min' });
});

test('m4: places from the grader seam are stored finite', async () => {
  const stub: Grader = {
    id: 'stub',
    interpret: async line => ({ sentences: [{ text: line, step: 'vital-signs', addressee: 'headBuddy', oxygen: null, ecg: null,
      points: [{ step: 'vital-signs', point: 'head-buddy', parts: ['temp', 'rr'], whole: false, missing: [], pos: Number.NaN,
        partPos: [Number.POSITIVE_INFINITY, -5] }, { step: 'vital-signs', point: 'severity', parts: [], whole: true, missing: [], pos: Number.NaN }] }] }),
  };
  const s0 = doneTo(13, 500_000);
  const s = await send(s0, 'Temp and RR, and the pain score.', T0, envOf('copd-amk-01', stub));
  expect(s.parts['vital-signs/head-buddy/temp']).toEqual({ line: s0.lines.length, pos: 0 });
  expect(s.parts['vital-signs/head-buddy/rr']).toEqual({ line: s0.lines.length, pos: 0 });
  expect(s.hits['vital-signs/severity']!.pos).toBe(0);
});

test('I7: a point gone back for is credited where it belongs, late, not read as a step ahead', async () => {
  const without = (s: RunSession, key: string): RunSession => ({ ...s, hits: Object.fromEntries(Object.entries(s.hits).filter(([k]) => k !== key)) });
  // the nudge answered word for word, two steps on
  const at12 = { ...without(doneTo(11, 300_000), 'breathing/spo2'), current: 12 };
  const spo2 = await send(at12, 'Arm buddy: measure SpO2 on room air.');
  expect(spo2.hits['breathing/spo2']).toMatchObject({ during: 12 });
  expect(Object.keys(spo2.parts).filter(k => k.startsWith('vital-signs/'))).toEqual([]);
  expect(mine(spo2).at(-1)!.flags).toContainEqual({ kind: 'order', point: 'breathing/spo2', text: 'SpO2 belongs to step 10, Breathing.' });
  expect(classify(STEPS, copd, spo2, 400_000).faults.filter(f => f.point === 'breathing/spo2'))
    .toEqual([expect.objectContaining({ kind: 'order', detail: 'Done during step 12, Rapid body survey. It belongs to step 10, Breathing.' })]);
  // the radial pulse at step 13
  const at13 = { ...without(doneTo(12, 300_000), 'circulation/pulse'), current: 13 };
  const pulse = await send(at13, 'Checking the radial pulse.');
  expect(pulse.hits['circulation/pulse']).toMatchObject({ during: 13 });
  expect(Object.keys(pulse.parts).filter(k => k.startsWith('vital-signs/'))).toEqual([]);
  // the step ahead keeps a sentence it credits more of: the notes' step 18 line with COPD's monitor-closely still to do
  const at17 = { ...without(doneTo(17, 600_000), 'breathing/monitor-closely'), current: 17 };
  const decision = await send(at17, canon('copd-amk-01', 'decision-point'));
  expect(decision.hits['decision-point/monitor-5']).toBeDefined();
  expect(decision.hits['breathing/monitor-closely']).toBeUndefined();
});

test('{decisionLine}: step 18 says the notes\' decision for the case\'s plan', () => {
  expect(canon('copd-amk-01', 'decision-point')).toContain('suspected COPD. So, I will Stay & Treat to see whether I can initiate any protocols. As I am');
  expect(canon('bleed-woodlands-01', 'decision-point')).toContain('. It is a Load & Go case. As I am');
});

test('phone questions mid-call stay on the phone: the caller answers, never the patient', async () => {
  for (const c of CASES) {
    const questions = ['Did he fall from a height?', 'Is he alert?', 'Is she awake?', ...(c.type === 'trauma' ? ['Is there any bleeding?'] : [])];
    const s = await playRun(c.id, 'coached', [canon(c.id, 'respond-call'), 'Hi, I am calling from 995 FMV. My name is EMT Lee.', ...questions]);
    const call = s.lines.slice(4);
    expect(call.filter(l => l.who !== 'you' && l.who !== 'caller'), c.id).toEqual([]);
    expect(mine(s).slice(2).map(l => l.route), c.id).toEqual(['To caller: what happened', 'To caller: conscious?', 'To caller: conscious?',
      ...(c.type === 'trauma' ? ['To caller: critical injuries'] : [])]);
    expect(s.clock.started, c.id).toBe(false);
  }
});

test('m1: a reply set off twice in one line is said once', async () => {
  const s = await send(doneTo(10, 200_000), 'Checking the radial pulse. Is there pulse?');
  expect(s.lines.slice(-1)).toEqual([{ who: 'tester', text: 'Radial pulse present, fast and strong.', atMs: 200_000 }]);
});

test('m1: SRACIE\'s C needs both the case and its two signs', () => {
  const sracie = (ids: string[]) => endRun(env, { ...blankSession('copd-amk-01'),
    parts: Object.fromEntries(ids.map((p, i) => [`notification/sracie/${p}`, { line: 1, pos: i }])) }, T0).record!.sracie;
  expect(sracie(['sex', 'race', 'age', 'case', 'ic-no', 'eta'])).toEqual(['S', 'R', 'A', 'I', 'E']);
  expect(sracie(['sex', 'race', 'age', 'two-signs', 'ic-no', 'eta'])).toEqual(['S', 'R', 'A', 'I', 'E']);
  expect(sracie(['case', 'two-signs'])).toEqual(['C']);
});

test('m1: tickRun adds no lines past the line limit, but moves on its marks', () => {
  const full: RunSession = { ...running(blankSession('copd-amk-01'), 0, T0), reassessFromMs: 0,
    lines: Array.from({ length: 400 }, () => ({ who: 'you' as const, text: 'x', atMs: null })) };
  const r = tickRun(env, full, T0 + 600_000)!;
  expect(r.session.lines).toHaveLength(400);
  expect(r.session.reassessSets).toBe(2);
  expect(r.session.readings).toEqual([]);
});

test('m1: a flow alone titrates the device already on', async () => {
  let s = await send({ ...doneTo(14, 600_000), oxygen: { device: 'nasal-cannula', flow: 2, atMs: 300_000, right: true } }, 'Increase the flow to 4 litres.');
  expect(s.oxygen).toEqual({ device: 'nasal-cannula', flow: 4, atMs: 600_000, right: true });
  s = await send(s, 'Increase the flow to 6 litres.', T0 + 10_000);
  expect(s.oxygen).toEqual({ device: 'nasal-cannula', flow: 6, atMs: 610_000, right: false });
});

test('m1: the two route constants are the brief\'s words', () => {
  expect(NOT_UNDERSTOOD).toBe('Not sure what this is.');
  expect(UNCLEAR).toBe("Who's this for? Tester, patient or buddy");
});

// ---- Fix round 2: a line moves the run as its sentences do ----------------------------------------------------

/** The case's canonical call with the three phone questions after "what happened". */
const callWithQuestions = (id: string) => canon(id, 'call-caller').replace('May I know what happened to the patient?',
  'May I know what happened to the patient? Did he fall from a height? Is there any bleeding? Is he alert?');
const CALL_POINTS = ['intro-fmv-emt', 'confirm-location', 'what-happened', 'casualties', 'conscious', 'prepare-ic-meds', 'critical-injuries'];

test('fix round 2: a whole phone call typed as one message, at step 1 or 2, stays with the caller', async () => {
  for (const c of CASES) {
    for (const [from, before] of [[1, [canon(c.id, 'respond-call')]],
      [2, [canon(c.id, 'respond-call'), 'Hi, I am calling from 995 FMV. My name is EMT Lee.']]] as const) {
      const s0 = await playRun(c.id, 'coached', [...before]);
      expect(s0.current, c.id).toBe(from);
      const s = await send(s0, callWithQuestions(c.id), T0 + 100_000, envOf(c.id));
      const at = `${c.id} from step ${from}`;
      const own = applicablePoints(STEPS, c).filter(a => a.step.id === 'call-caller' && CALL_POINTS.includes(a.point.id)).map(a => a.key);
      expect(own.filter(k => s.hits[k] === undefined), at).toEqual([]);
      expect(Object.keys(s.hits).filter(k => /^(delicate-spine|loc-avpu)\//.test(k)), at).toEqual([]);
      // a medical case has no step 2 point that asks about bleeding (critical-injuries is trauma only); on the phone a
      // lone question about a step past the next two is dropped (fix rounds 3 and 4), so there it reads nothing; in a
      // trauma case it is the caller's critical injuries
      expect(Object.keys(s.hits).filter(k => k.startsWith('approach-patient/')), at).toEqual([]);
      expect(s.lines.filter(l => l.who === 'patient'), at).toEqual([]);
      expect(s.clock.started, at).toBe(false);
      // "Did he fall from a height?" reads what happened again, the caller's, so it adds no piece of its own (a point shows
      // once, Task 14 review): nothing comes between what happened and the bleeding question's piece
      expect(mine(s).at(-1)!.route, at).toContain(
        `To caller: what happened · ${c.type === 'trauma' ? 'To caller: critical injuries' : NOT_UNDERSTOOD} · To caller: conscious?`);
    }
  }
});

test('fix round 2: the keyword grader reads each sentence at the context ctx.next gives for the one before', async () => {
  const step1 = applicablePoints(STEPS, caseById('fall-yishun-01')).filter(a => a.step.order === 1).map(a => a.key);
  const atStep1 = ctxAt('respond-call', 'fall-yishun-01', 6, step1);   // step 1 said, the call not yet begun
  const atCall = ctxAt('call-caller', 'fall-yishun-01');
  let calls = 0;
  const start = { ...atStep1, next: () => { calls++; return atCall; } };
  const line = 'Hi, I am calling from 995 FMV. Did he fall from a height?';
  const moved = (await keywordGrader.interpret(line, start)).sentences;
  expect(moved.map(x => x.points.map(p => `${p.step}/${p.point}`))).toEqual([['call-caller/intro-fmv-emt'], ['call-caller/what-happened']]);
  expect(calls).toBe(1);   // once per sentence before the last; the second sentence is read at its result
  // with no next, the line reads from its start: step 2's local "fall" does not hold at step 1, and on the phone a lone
  // question about delicate spine is dropped (fix rounds 3 and 4), so the question reads nothing
  const still = (await keywordGrader.interpret(line, atStep1)).sentences;
  expect(still[1]!.points).toEqual([]);
});

test('fix round 3 (R4): next is carried to every sentence of a line, not just the second', async () => {
  // the line moves only at its second sentence, and that matters at its third
  const fall = envOf('fall-yishun-01');
  const s0 = await playRun('fall-yishun-01', 'coached', [canon('fall-yishun-01', 'respond-call')]);
  const s = await send(s0, 'Thank you. Hi, I am calling from 995 FMV. Did he fall from a height?', T0 + 60_000, fall);
  expect(mine(s).at(-1)!.route).toBe('To caller: caller intro · To caller: what happened');   // "Thank you." adds no piece (D25)
  expect(s.hits['call-caller/what-happened']).toBeDefined();
});

test('fix round 3 (N1): a re-ask that spills ahead never moves the line, so the LOC line still states the level', async () => {
  for (const c of CASES) {
    const steps = (a: number, b: number) => STEPS.filter(x => x.order >= a && x.order <= b).map(x => canon(c.id, x.id));
    const loc = canon(c.id, 'loc-avpu');
    for (const before of [['Approaching casualty from the front.', 'If you can hear me, please do not move your head.'],
      ['Sir/Ma\'am, can you hear me?']]) {
      // the sound-out sent as two messages, or "can you hear me?" asked once, then the notes' LOC line
      const inputs = before.length === 2 ? [...steps(1, 4), ...before, ...steps(6, 6), loc] : [...steps(1, 6), ...before, loc];
      const s = await playRun(c.id, 'coached', inputs);
      const at = `${c.id} ${before.length === 2 ? 'sound-out in two' : 'hear me first'}`;
      expect(s.hits['loc-avpu/state-level'], at).toBeDefined();
      expect((mine(s).at(-1)!.flags ?? []).filter(f => f.kind === 'nudge'), at).toEqual([]);
      expect(endRun(envOf(c.id), s, T0 + 30 * 20_000).missed, at).not.toContain('loc-avpu/state-level');
    }
  }
  // the RTA pulse-rate-quality and bleed MOI shapes of the re-review's sweep
  const shape = async (id: string, k: number, sentence: string, point: string) => {
    const lines = STEPS.map(x => canon(id, x.id));
    const inputs = [...lines.slice(0, k - 1), sentence, ...lines.slice(k - 1)];
    const r = endRun(envOf(id), await playRun(id, 'coached', inputs), T0 + 30 * 20_000);
    expect(r.missed, `${id} ${point}`).not.toContain(point);
  };
  await shape('rta-toapayoh-01', 11, 'Checking the radial pulse.', 'circulation/pulse-rate-quality');
  await shape('bleed-woodlands-01', 4, 'Are there any hazards / potential hazards / danger to the patient and ourselves?', 'scene-evaluation/moi');
}, SLOW_MS);

test('fix round 3: once on scene, the call is over: never pending, never read again, the caller never answers', async () => {
  for (const id of ['fall-yishun-01', 'bleed-woodlands-01', 'rta-toapayoh-01']) {
    const e = envOf(id);
    const at10 = doneTo(9, 200_000, T0, id);
    const spine = await send({ ...at10, current: 10, hits: Object.fromEntries(Object.entries(at10.hits).filter(([k]) => k !== 'call-caller/critical-injuries')) },
      'Sir, please allow me to check if you have sustained any potential spinal injuries.', T0, e);
    expect(spine.hits['call-caller/critical-injuries'], id).toBeUndefined();
    expect(spine.lines.filter(l => l.who === 'caller'), id).toEqual([]);
    for (const q of ['Sir, any other injuries?', 'Where else are you injured?']) {
      const other = await send({ ...doneTo(9, 200_000, T0, id), hits: {} }, q, T0, e);
      expect(Object.keys(other.hits).filter(k => k.startsWith('call-caller/') || k.startsWith('respond-call/')), `${id} ${q}`).toEqual([]);
      expect(other.lines.filter(l => l.who === 'caller'), `${id} ${q}`).toEqual([]);
    }
  }
});

// Fix round 4 (NB1) keeps it: "Is there any bleeding?", "Is he alert?" and "Did he fall?" are all lone questions.
test('fix round 3: a medical call typed line by line stays on the phone', async () => {
  for (const id of ['copd-amk-01', 'hypo-hougang-01', 'chestpain-bedok-01', 'ccf-jurong-01', 'asthma-tampines-01']) {
    // fix round 5: dictated with no "?", they open with a question word, so they are lone questions still
    for (const questions of [['Is there any bleeding?', 'Is he alert?', 'Did he fall?'], ['Is he alert?', 'Did he fall?', 'Is there any bleeding?'],
      ['Is there any bleeding', 'Is he alert', 'Did he fall'], ['Any bleeding', 'Is he alert', 'Did he fall']]) {
      const s = await playRun(id, 'coached', [canon(id, 'respond-call'), canon(id, 'call-caller'), ...questions]);
      const at = `${id} ${questions.join(' ')}`;
      expect(s.current, at).toBe(2);
      expect(s.clock.started, at).toBe(false);
      expect(s.lines.filter(l => l.who === 'patient'), at).toEqual([]);
      expect(mine(s).flatMap(l => l.flags ?? []), at).toEqual([]);
      expect(Object.keys(s.hits).filter(k => !/^(respond-call|call-caller)\//.test(k)), at).toEqual([]);
      expect(mine(s).find(l => l.text === questions.find(q => q.includes('bleeding')))!.route, at).toBe(NOT_UNDERSTOOD);
    }
  }
});

test('fix round 3: monitor-5 never takes the reassess call, so the nudge answered at step 17 starts the reassessments', async () => {
  const s0 = doneTo(16, 700_000);
  const at17 = { ...s0, current: 17, hits: Object.fromEntries(Object.entries(s0.hits).filter(([k]) => k !== 'vital-signs/reassess-5')) };
  const s = await send(at17, 'Buddy, please reassess vital signs every 5 mins and inform me', T0);
  expect(s.hits['vital-signs/reassess-5']).toMatchObject({ during: 17 });
  expect(s.hits['decision-point/monitor-5']).toBeUndefined();
  expect(s.reassessFromMs).toBe(700_000);
  expect(tickRun(env, s, T0 + 300_000)!.session.reassessSets).toBe(1);
  // the notes' step 18 line still reads monitor-5
  const at18 = await send({ ...doneTo(17, 800_000) }, canon('copd-amk-01', 'decision-point'), T0);
  expect(at18.hits['decision-point/monitor-5']).toBeDefined();
});

test('fix round 3 (G3): pending points are tried nearest step first', async () => {
  const s0 = doneTo(16, 700_000);
  const both = { ...s0, current: 17,
    hits: Object.fromEntries(Object.entries(s0.hits).filter(([k]) => k !== 'breathing/spo2' && k !== 'oxygen/recheck-spo2')) };
  const s = await send(both, 'Arm buddy, please recheck the SpO2.', T0);
  expect(s.hits['oxygen/recheck-spo2']).toMatchObject({ during: 17 });   // step 15, not step 10
  expect(s.hits['breathing/spo2']).toBeUndefined();
});

test('fix round 3: the line\'s reached step follows only what a sentence reaches, never a far-ahead read', async () => {
  // "Please allow me." would read a local "allow" were the line taken on by the far-ahead RBS read: delicate spine's at
  // the cap (step 8), the RBS permission's at step 12 itself
  const s = await send({ ...hitAll(blankSession('copd-amk-01'), STEPS, copd, upTo(5)), current: 6 }, 'Any abnormalities? Please allow me.', T0);
  expect(s.hits['rapid-body-survey/abnormalities']).toBeDefined();
  expect(s.hits['delicate-spine/neck-permission']).toBeUndefined();
  expect(s.hits['rapid-body-survey/rbs-permission']).toBeUndefined();
  expect(mine(s).at(-1)!.route).toBe('To tester: abnormalities');   // "Please allow me." reads nothing and adds no piece (D25)
});

test('fix round 2: the notes\' one message covering steps 10 and 11 still reads both steps in the run', async () => {
  const s = await send({ ...doneTo(9, 200_000), current: 10 },
    'Is there chest rise and fall? Arm buddy, SpO2 please. Checking the radial pulse, what is the rate and quality?');
  for (const k of ['breathing/chest-rise-fall', 'breathing/spo2', 'circulation/pulse', 'circulation/pulse-rate-quality']) expect(s.hits[k], k).toBeDefined();
  expect(s.hits['breathing/rate-quality']).toBeUndefined();
  expect(s.current).toBe(11);
});

// ---- Fix round 4: leaving the phone, and the call once on scene -----------------------------------------------

/** The case's canonical lines for steps a to b. */
const linesOf = (id: string, a: number, b: number) => STEPS.filter(x => x.order >= a && x.order <= b).map(x => canon(id, x.id));
const faultKeys = (r: { faults: { kind: string; point: string }[] }) => r.faults.map(f => `${f.kind} ${f.point}`);
const APPROACH_NO_HAZARDS = "Approaching casualty from the front. If you can hear me, please do not move your head. Is there any catastrophic bleeding? Never move the patient's head.";

// the re-review's r4 V3 and V5: the approach said without its hazard sentences, then steps 6 to 19 (a test a case, so
// none nears the time limit while the whole suite runs)
test.each(CASES)('fix round 4 (NB1): the call, then preparation and scene evaluation skipped: the run leaves the phone ($id)', async c => {
  {
    const full = new Set(faultKeys(await recordOf(c.id, 'coached', linesOf(c.id, 1, 19))));
    // the case's own approach line without its two hazard sentences: the bleed case keeps its bleeding control (Task 11b)
    const approach = canon(c.id, 'approach-patient').replace(' Any hazards around the patient? Remove any hazards.', '');
    if (!conditionHolds(c, 'catastrophicBleeding')) expect(approach).toBe(APPROACH_NO_HAZARDS);
    const inputs = [...linesOf(c.id, 1, 2), approach, ...linesOf(c.id, 6, 19)];
    // what was skipped (the RTA's preparation holds its extra PPE too), and the sound-out's "front", which the caller's
    // "casualties" read
    const skipped = ['missed approach-patient/hazards-remove', 'missed preparation/equipment',
      ...(conditionHolds(c, 'extraPpe') ? ['missed preparation/extra-ppe'] : []), 'missed preparation/gloves-mask',
      'missed scene-evaluation/environment', 'missed scene-evaluation/hazards', 'missed scene-evaluation/moi',
      'missed scene-evaluation/witnesses', 'phrase approach-patient/sound-out'];
    for (const mode of ['coached', 'exam'] as const) {
      const s = await playRun(c.id, mode, inputs);
      const r = endRun(envOf(c.id), s, T0 + (inputs.length + 1) * 20_000);
      const at = `${c.id} ${mode}`;
      expect([s.current, s.clock.started], at).toEqual([19, true]);
      expect(s.lines.some(l => l.who === 'patient'), at).toBe(true);
      expect(faultKeys(r).filter(f => !full.has(f)).sort(), at).toEqual(skipped);
      // and nothing else: the full canonical run's own faults, and no more (faf05f6's 12 to 20 counted the conditional
      // points the generic lines never said, before Task 11b gave each case its own)
      expect(r.faults.length, at).toBe(full.size + skipped.length);
    }
  }
});

test('fix round 4 (NB1): after the radio call alone, the scene evaluation line is read', async () => {
  // the milder form (r4 V1): the call to the caller and preparation skipped; the line names three points of step 4, so
  // its questions are no phone questions, and once it has left the call its MOI is the scene's, not the radio call's
  for (const c of CASES) {
    const s = await playRun(c.id, 'coached', [...linesOf(c.id, 1, 1), ...linesOf(c.id, 4, 19)]);
    expect(mine(s)[1]!.route, c.id).toBe('To tester: witnesses · To tester: environment · To tester: hazards · MOI');
    for (const p of ['witnesses', 'environment', 'hazards', 'moi']) expect(s.hits[`scene-evaluation/${p}`], `${c.id} ${p}`).toBeDefined();
    expect([s.current, s.clock.started, s.lines.some(l => l.who === 'patient')], c.id).toEqual([19, true, true]);
    // the post-breaker ruling: no worse than round 4
    expect(endRun(envOf(c.id), s, T0 + 21 * 20_000).faults.length, c.id).toBeLessThanOrEqual(V1_ROUND4[c.id]!);
  }
});
/** The milder form's faults per case in round 4 (the re-review's r4 V1). The three Plan 3 cases came later, so theirs is
 *  their count when they were added (Plan 3 Task 3): the skipped steps' points and the standing Phrase and ECG faults,
 *  the same as hypo's (AMS), chest pain's (toothache) and bleed's (leg bleed) are now. */
const V1_ROUND4: Record<string, number> = { 'copd-amk-01': 14, 'hypo-hougang-01': 15, 'chestpain-bedok-01': 13, 'ccf-jurong-01': 13,
  'asthma-tampines-01': 14, 'bleed-woodlands-01': 16, 'fall-yishun-01': 15, 'rta-toapayoh-01': 20,
  'ams-sengkang-01': 12, 'toothache-clementi-01': 11, 'legbleed-punggol-01': 13 };

test('fix round 4 (NB2): on the phone, a line moving on from an unfinished radio call is no re-ask', async () => {
  // the re-review's r7 b2, b3 and b5: "case of" left out of the radio call, so step 1 still has a point to do when
  // "Hi, I am calling from 995 FMV." reads its done call sign
  for (const [id, question, point, short] of [['bleed-woodlands-01', 'Is there any bleeding?', 'critical-injuries', 'critical injuries'],
    ['fall-yishun-01', 'Did he fall from a height?', 'what-happened', 'what happened'],
    ['hypo-hougang-01', 'Is he alert?', 'conscious', 'conscious?']] as const) {
    const radio = canon(id, 'respond-call').replace(/ for case of .*$/, '.');
    const inputs = [radio, `Hi, I am calling from 995 FMV. ${question}`];
    const s = await playRun(id, 'coached', inputs);
    expect(mine(s).at(-1)!.route, id).toBe(`To caller: caller intro · To caller: ${short}`);
    expect(s.hits[`call-caller/${point}`], id).toBeDefined();
    expect(s.lines.at(-1)!.who, id).toBe('caller');
    if (id === 'bleed-woodlands-01') {   // the trauma canonical call asks nothing else about critical injuries
      const r = await recordOf(id, 'coached', [...inputs, ...linesOf(id, 2, 19)]);
      expect(r.missed, id).not.toContain('call-caller/critical-injuries');
    }
  }
});

test('fix round 4 (NB2): on scene, moving on from a finished step is no re-ask, so the line moves on', async () => {
  // LOC done: "can you hear me" reads its done response, the fall question takes the line to delicate spine, and there
  // "allow" is the neck permission's own word (R4's guard, pinned on scene now the phone has no re-asks)
  const s = await send(doneTo(7, 100_000, T0, 'fall-yishun-01'), 'Sir, can you hear me, did you fall? Please allow me.', T0, envOf('fall-yishun-01'));
  expect(mine(s).at(-1)!.route).toBe('To patient: fall? hit head? · Spine permission');
  expect(s.hits['delicate-spine/neck-permission']).toBeDefined();
});

/** Sentences of the canonical call, each the one way the call asks its point. */
const CALL_ASKS = [['confirm-location', 'Can I confirm your address / location?'], ['what-happened', 'May I know what happened to the patient?'],
  ['casualties', 'How many casualties are there?'], ['conscious', 'Is the patient conscious or unconscious?'],
  ['prepare-ic-meds', "Please prepare patient's ID and medication for us when we arrive."]] as const;

test('fix round 4 (NB3): on scene, a sentence the call would take reads as not understood: no credit, no reply', async () => {
  for (const c of CASES) {
    const e = envOf(c.id);
    const at4 = { ...doneTo(3, 0, T0, c.id), current: 4 };
    const asks: (readonly [string, string])[] = [...CALL_ASKS, ['intro-fmv-emt', 'Hi, I am calling from 995 FMV.'],
      ...(c.type === 'trauma' ? [['critical-injuries', 'Any critical injuries?'] as const] : [])];
    for (const [point, ask] of asks) {
      // the call point still to do (the re-review's r1: a nudge answered on scene), and once done (r9: said again);
      // "what happened" said again after a whole call is the patient's own question at step 6, which is still to do
      const toDo = { ...at4, hits: Object.fromEntries(Object.entries(at4.hits).filter(([k]) => k !== `call-caller/${point}`)) };
      for (const s0 of point === 'what-happened' ? [toDo] : [toDo, at4]) {
        const s = await send(s0, ask, T0, e);
        const at = `${c.id} ${point} ${s0 === at4 ? 'done' : 'to do'}`;
        expect(s.lines.slice(s0.lines.length), at).toEqual([{ who: 'you', text: ask, atMs: 0, route: NOT_UNDERSTOOD }]);
        expect([s.hits, s.parts, s.current], at).toEqual([s0.hits, s0.parts, 4]);
      }
    }
  }
});

// The post-breaker ruling replaces round 4's nudge at preparation: preparation is the crew's arrival, after which a call
// sentence reads as not understood, so the call's points are nudged only while the call can still be made. The
// re-review's r1 shape: one call sentence dropped, said again at preparation, then the run finished.
test.each(CASES)('the call is nudged only before arrival; said after preparation, a call point reads as not understood ($id)', async c => {
  const all = linesOf(c.id, 1, 19);
  const full = new Set(faultKeys(await recordOf(c.id, 'coached', all)));
  for (const [point, ask] of CALL_ASKS) {
    const call = splitSentences(all[1]!);
    expect(call, point).toContain(ask);
    const inputs = [all[0]!, call.filter(x => x !== ask).join(' '), all[2]!, ask, ...all.slice(3)];
    const s = await playRun(c.id, 'coached', inputs);
    const at = `${c.id} ${point}`;
    expect(s.lines.flatMap(l => l.flags ?? []).filter(f => f.point === `call-caller/${point}`), at).toEqual([]);
    const k = s.lines.findIndex(l => l.who === 'you' && l.text === ask);
    expect([s.lines[k]!.route, s.lines[k + 1]!.who], at).toEqual([NOT_UNDERSTOOD, 'you']);   // no caller, patient or tester
    // no false Order fault, no "what's bothering" or pocket check taken early: only the point's own miss
    const r = endRun(envOf(c.id), s, T0 + (inputs.length + 1) * 20_000);
    expect(faultKeys(r).filter(f => !full.has(f)), at).toEqual([`missed call-caller/${point}`]);
  }
  // the radio call's point left out is nudged on the caller's line, and answered there, still on the phone, it is
  // credited late
  const label = step('respond-call').mustHit.find(m => m.id === 'case-of')!.label;
  const s = await playRun(c.id, 'coached', [all[0]!.replace(/ for case of .*$/, '.'), all[1]!, label]);
  expect(mine(s)[1]!.flags, c.id).toContainEqual({ kind: 'nudge', point: 'respond-call/case-of', text: expect.stringContaining(label) });
  expect([s.arrived, s.hits['respond-call/case-of']?.during], c.id).toEqual([false, 2]);
});

test('fix round 4 (NB3): the call is never nudged once the run is on scene', async () => {
  // preparation skipped: the run goes from the call straight to scene evaluation, so the point is never nudged
  for (const c of CASES) {
    const all = linesOf(c.id, 1, 19);
    const s = await playRun(c.id, 'coached', [all[0]!, all[1]!.replace('May I know what happened to the patient? ', ''), ...all.slice(3)]);
    const call = s.lines.flatMap(l => l.flags ?? []).filter(f => f.kind === 'nudge' && /^(respond-call|call-caller)\//.test(f.point));
    expect(call, c.id).toEqual([]);
    expect(s.hits['call-caller/what-happened'], c.id).toBeUndefined();
  }
});

// ---- The post-breaker ruling: the crew's arrival ends the call ------------------------------------------------

/** The re-review's 10 NB-A lines, each of which ended a call typed in parts; and one preparation item said as advice. */
const ADVICE = ['We will be there in 5 mins.', 'Our ambulance is 5 minutes away.', 'We are about 5 min away.',
  'Let him sit in a comfortable position.', 'Put him in the recovery position.', 'Keep monitoring him until we arrive.',
  'Check his pulse for me.', 'Keep the patient comfortable.', 'Please make sure his airway is clear.',
  'Keep pressing on the bleeding until we arrive.', 'Keep him warm with a blanket.'];
/** Scene-evaluation questions asked mid-call (the re-review's out-of-scope 1, r19). */
const SCENE_ASKS = ['Are there any witnesses?', 'Any danger at the scene?', 'What is the environment like?'];

test.each(CASES)('post-breaker: advice or a scene question said mid-call never ends it, and an ETA after it reads nothing ($id)', async c => {
  const all = linesOf(c.id, 1, 19);
  const full = new Set(faultKeys(await recordOf(c.id, 'coached', all)));
  const call = splitSentences(all[1]!);
  // tests 1 and 8: between the intro and the call's questions (r17, r18, r19), no new fault
  for (const x of [...ADVICE, ...SCENE_ASKS]) {
    const inputs = [all[0]!, call.slice(0, 3).join(' '), x, call.slice(3).join(' '), ...all.slice(2)];
    const r = await recordOf(c.id, 'coached', inputs);
    expect(faultKeys(r).filter(f => !full.has(f)), `${c.id} ${x}`).toEqual([]);
  }
  // test 2: after the whole call, an ETA reads nothing: no Order fault, no reply on the phone
  for (const eta of ['OK, we are reaching in 5 minutes.', 'We will be there in 5 mins.', 'ETA 5 mins.']) {
    const inputs = [all[0]!, all[1]!, eta, ...all.slice(2)];
    const s = await playRun(c.id, 'coached', inputs);
    const k = s.lines.findIndex(l => l.who === 'you' && l.text === eta);
    expect([s.lines[k]!.route, s.lines[k + 1]!.who], `${c.id} ${eta}`).toEqual([NOT_UNDERSTOOD, 'you']);
    expect(faultKeys(endRun(envOf(c.id), s, T0 + (inputs.length + 1) * 20_000)).filter(f => !full.has(f)), `${c.id} ${eta}`).toEqual([]);
  }
}, SLOW_MS);

test.each(CASES)('post-breaker: "Sir, did he hit his head?" on the phone, mid-call or after it, gets no patient reply ($id)', async c => {
  // test 3, with "Is {name} bleeding?" in the medical cases (in the trauma ones it is the caller's critical injuries)
  const all = linesOf(c.id, 1, 19);
  const call = splitSentences(all[1]!);
  const asks = ['Sir, did he hit his head?', ...(c.type === 'medical' ? [`Is ${c.patient.callName} bleeding?`] : [])];
  for (const q of asks) {
    for (const inputs of [[all[0]!, call.slice(0, 3).join(' '), q, call.slice(3).join(' ')], [all[0]!, all[1]!, q]]) {
      const s = await playRun(c.id, 'coached', inputs);
      expect([s.arrived, s.lines.filter(l => l.who === 'patient'), mine(s).find(l => l.text === q)!.route], `${c.id} ${q}`)
        .toEqual([false, [], NOT_UNDERSTOOD]);
    }
  }
  // patient words address the caller before arrival
  const s = await playRun(c.id, 'coached', [all[0]!, 'Hi, I am calling from 995 FMV. Sir, may I know what happened to the patient?']);
  expect(mine(s).at(-1)!.route, c.id).toBe('To caller: caller intro · To caller: what happened');
});

test('post-breaker (e): after an unfinished call, the second scene statement in a row arrives and reads the held line first', async () => {
  // test 6: the call without its casualties question, then the sound-out and the head kept still as two messages
  const all = linesOf('copd-amk-01', 1, 19);
  const call = splitSentences(all[1]!).filter(x => x !== 'How many casualties are there?').join(' ');
  const s1 = await playRun('copd-amk-01', 'coached', [all[0]!, call, 'If you can hear me, please do not move your head.']);
  const k = s1.lines.length - 1;
  expect([s1.arrived, s1.held, s1.lines[k]!.route, s1.hits['approach-patient/sound-out']]).toEqual([false, k, NOT_UNDERSTOOD, undefined]);
  const s2 = await send(s1, "Never move the patient's head.", T0 + 100_000);
  expect([s2.arrived, s2.held, s2.lines[k]!.route]).toEqual([true, null, 'Sound out']);
  expect(s2.hits['approach-patient/sound-out']).toMatchObject({ line: k });   // the held line's own
  expect(s2.hits['approach-patient/head-still']).toMatchObject({ line: k + 1 });
  // a call question between, or a question (one opening "do" with no "?"), ends the row: no arrival
  for (const between of ['Can I confirm your address / location?', 'Do you see any catastrophic bleeding']) {
    const s3 = await send(await send(s1, between, T0 + 100_000), "Never move the patient's head.", T0 + 120_000);
    expect([s3.arrived, s3.held], between).toEqual([false, s3.lines.length - 1]);
  }
  // a line naming two scene points right after a held line reads it first too: with a call question in it, so arrival (c)
  // and not (e)
  const s4 = await send(s1, "Can I confirm your address? Is there any catastrophic bleeding? Never move the patient's head.", T0 + 100_000);
  expect([s4.arrived, s4.hits['approach-patient/sound-out']?.line, s4.hits['approach-patient/head-still']?.line]).toEqual([true, k, k + 1]);
});

test('post-breaker: the context next gives a grader for the sentence after the one the call ends at says the crew arrived', async () => {
  // the seam: a grader that reads sentence by sentence learns of the arrival it marked from ctx.next
  const seen: boolean[] = [];
  const stub: Grader = {
    id: 'stub',
    interpret: async (_line, ctx) => {
      const first = { text: 'Crew, please wait.', step: null, addressee: 'crew' as const, points: [], oxygen: null, ecg: null, arrives: 'listener' as const };
      seen.push(ctx.arrived === true, ctx.next?.(first).arrived === true);
      return { sentences: [first, { text: 'OK.', step: null, addressee: null, points: [], oxygen: null, ecg: null }] };
    },
  };
  const s = await send(blankSession('copd-amk-01'), 'Crew, please wait. OK.', T0, envOf('copd-amk-01', stub));
  expect([seen, s.arrived]).toEqual([[false, true], true]);
});

test('post-breaker: arrival is kept on the session; a tap past the call arrives; a session saved before it counts preparation', () => {
  const s = tapStep(env, blankSession('copd-amk-01'), 'preparation', T0).session;
  expect([s.arrived, s.held]).toEqual([true, null]);
  expect(tapStep(env, blankSession('copd-amk-01'), 'call-caller', T0).session.arrived).toBe(false);
  // a session saved before arrival was stored loads as not arrived: then a run past preparation, or with it said, has
  const saved = { ...hitAll(blankSession('copd-amk-01'), STEPS, copd, upTo(3)), arrived: false };
  expect([gradeContext(env, saved, T0).arrived, gradeContext(env, { ...saved, current: 4, hits: {}, parts: {} }, T0).arrived,
    gradeContext(env, { ...saved, current: 3, hits: {}, parts: {} }, T0).arrived]).toEqual([true, true, false]);
  // once arrived the call's points are never pending
  const at3 = gradeContext(env, { ...blankSession('copd-amk-01'), current: 3, arrived: true }, T0);
  expect([...at3.pending].filter(k => k.startsWith('respond-call/') || k.startsWith('call-caller/'))).toEqual([]);
});

// ---- The adjudication ruling ---------------------------------------------------------------------------------

/** Re-review 5's phone lines that speak of the crew, a buddy, a medic or "guys" (LB1). */
const MENTIONS = ['Our crew is on the way.', 'My buddy and I are on the way.', 'Our medic is coming up now.', 'FMV 123 crew is on the way.',
  'I will send my buddy up first.', 'Can you guys open the door for us?', 'Are you guys at home now?', 'Is there anyone else with you guys?',
  'Can you get someone to wait for the crew downstairs?', 'Please ask your family to clear the way for my crew.',
  'Our crew will reach in 5 minutes.', 'The ambulance crew is on the way.'];

test.each(CASES)('adjudication (LB1): the crew, a buddy, a medic or "guys" spoken of on the phone never ends the call ($id)', async c => {
  const all = linesOf(c.id, 1, 19);
  const full = new Set(faultKeys(await recordOf(c.id, 'coached', all)));
  const call = splitSentences(all[1]!);
  for (const x of MENTIONS) {
    const inputs = [all[0]!, call.slice(0, 3).join(' '), x, call.slice(3).join(' '), ...all.slice(2)];
    expect(faultKeys(await recordOf(c.id, 'coached', inputs)).filter(f => !full.has(f)), `${c.id} ${x}`).toEqual([]);
  }
  // (b) still: one addressed first, past a filler, and one spoken of in a sentence that itself reads a step past the call
  for (const x of ['Tester, may I know the caller number?', 'OK crew, please wait downstairs.', 'My buddy will do a head grip on you, please allow him.']) {
    const s = await playRun(c.id, 'coached', [all[0]!, call.slice(0, 3).join(' '), x]);
    expect([s.arrived, mine(s).at(-1)!.text], c.id).toEqual([true, x]);
  }
}, SLOW_MS);

test.each(CASES)('adjudication (LB2): the call ends at the sentence that ends it; the held line is read there, then the rest ($id)', async c => {
  const all = linesOf(c.id, 1, 19);
  const full = new Set(faultKeys(await recordOf(c.id, 'coached', all)));
  const call = splitSentences(all[1]!);
  const extra = async (inputs: string[]) => faultKeys(await recordOf(c.id, 'coached', inputs)).filter(f => !full.has(f));
  // (d): the closer finishes the call, so its call question is the caller's; the held advice adds nothing to what the
  // closer alone costs (its own early position), so no Order fault on the notes' hazards lines
  const prep = call.find(x => x.startsWith('Please prepare'))!;
  const front = [all[0]!, call.filter(x => x !== prep).join(' ')];
  const closer = `${prep} Keep the patient comfortable.`;
  const held = await extra([...front, 'Keep the patient comfortable.', closer, ...all.slice(2)]);
  expect(held, c.id).not.toContain('missed call-caller/prepare-ic-meds');
  expect(held, c.id).toEqual(await extra([...front, closer, ...all.slice(2)]));
  // two call questions before the arrival keep their places ahead of the scene's: no Order fault for the second
  const casualties0 = call.find(x => x.startsWith('How many casualties'))!;
  const front2 = [all[0]!, call.filter(x => x !== prep && x !== casualties0).join(' ')];
  const closer2 = `${casualties0} ${closer}`;
  expect(await extra([...front2, 'Keep the patient comfortable.', closer2, ...all.slice(2)]), c.id)
    .toEqual(await extra([...front2, closer2, ...all.slice(2)]));
  const s = await playRun(c.id, 'coached', [...front, 'Keep the patient comfortable.', closer]);
  expect([s.arrived, mine(s).at(-1)!.text, mine(s).at(-1)!.route?.startsWith('To caller: IC and meds · ')], c.id).toEqual([true, closer, true]);
  // (c): the call question before the two scene points is the caller's too
  const conscious = call.find(x => x.startsWith('Is the patient conscious'))!;
  const c2 = await extra([all[0]!, call.filter(x => x !== conscious).join(' '), 'Let him sit in a comfortable position.',
    `${conscious} Are there any witnesses? What is the environment like?`, ...all.slice(2)]);
  expect(c2, c.id).not.toContain('missed call-caller/conscious');
  // its places on the line keep the line's order: the call question before the scene's
  const c3 = await playRun(c.id, 'coached', [all[0]!, call.filter(x => x !== conscious).join(' '), 'Let him sit in a comfortable position.',
    `${conscious} Are there any witnesses? What is the environment like?`]);
  const [q, w] = [c3.hits['call-caller/conscious']!, c3.hits['scene-evaluation/witnesses']!];
  expect([q.line === w.line, q.pos < w.pos, w.pos >= 1000], c.id).toEqual([true, true, true]);
  // the rest of the line moves within two steps of where the held line truly took the run: a held MOI (step 4) lets the
  // approach go on to step 5, so "Remove any hazards" is the approach's (P2's shape S)
  const casualties = call.find(x => x.startsWith('How many casualties'))!;
  const shapeS = await playRun(c.id, 'coached', [all[0]!, call.filter(x => x !== casualties).join(' '), ...splitSentences(all[3]!), all[4]!]);
  expect([shapeS.arrived, shapeS.hits['approach-patient/hazards-remove'] !== undefined, shapeS.hits['scene-evaluation/moi'] !== undefined], c.id)
    .toEqual([true, true, true]);
  // but never past the line's own window: from step 1, a held line about step 4 is not reached by it, so the approach
  // said with the caller's intro stops at step 3 and starts no clock
  const early = await playRun(c.id, 'coached', [all[0]!, 'The environment is safe.',
    "Hi, I am calling from 995 FMV. Is there any catastrophic bleeding? Never move the patient's head."]);
  expect([early.arrived, early.current, early.clock.started, early.hits['scene-evaluation/environment'] !== undefined], c.id)
    .toEqual([true, 3, false, true]);
});

/** The re-review's r12: the call skipped, or two steps skipped, or lines typed a sentence at a time. */
function skipShapes(id: string): [string, string[]][] {
  const L = (a: number, b: number) => linesOf(id, a, b);
  const name = caseById(id).patient.callName;
  const appr = splitSentences(L(5, 5)[0]!);
  const scene = splitSentences(L(4, 4)[0]!);
  const byLine = ['Is there any catastrophic bleeding?', 'Any hazards around the patient?', 'Remove any hazards.', "Never move the patient's head."];
  return [
    ['a1', [...L(1, 2), 'Sir, is there any bleeding?', ...L(3, 19)]], ['a2', [...L(1, 2), `Is ${name} bleeding?`, ...L(3, 19)]],
    ['a3', [...L(1, 2), 'Sir, did he hit his head?', ...L(3, 19)]], ['a4', [...L(1, 2), 'Uncle, is he alert?', ...L(3, 19)]],
    ['b1', [...L(1, 2), ...appr, ...L(6, 19)]], ['b2', [...L(1, 2), 'Do not move your head.', ...byLine, ...L(6, 19)]],
    ['b3', [...L(1, 2), 'Can you hear me? Do not move your head.', 'Is there any catastrophic bleeding?',
      'Any hazards around the patient? Remove any hazards.', "Never move the patient's head.", ...L(6, 19)]],
    ['b4', [...L(1, 2), 'Do not move your head.', ...byLine, ...L(6, 19)]],
    ['c1', L(3, 19)], ['c2', L(4, 19)], ['c3', L(5, 19)], ['c4', L(6, 19)], ['c5', L(2, 19)],
    ['c6', [...L(1, 1), ...scene, ...L(5, 19)]], ['c7', [...L(1, 2), ...scene, ...L(5, 19)]], ['c8', [...L(1, 2), ...L(6, 19)]],
    ['c9', [...L(1, 1), ...L(6, 19)]], ['c10', [...L(3, 3), ...scene, ...L(5, 19)]], ['c11', [...scene, ...L(5, 19)]],
    ['c12', [...appr, ...L(6, 19)]], ['c13', [...L(1, 3), ...L(6, 19)]],
  ];
}

test.each(CASES)('post-breaker: every skip shape of the re-review reaches step 19 with the clock running ($id)', async c => {
  // test 7: its 21 shapes (b4 is b2 in Exam)
  for (const [label, inputs] of skipShapes(c.id)) {
    const s = await playRun(c.id, label === 'b4' ? 'exam' : 'coached', inputs);
    expect([s.current, s.clock.started, s.arrived], `${c.id} ${label}`).toEqual([19, true, true]);
  }
}, SLOW_MS);

// ---- Whole runs ---------------------------------------------------------------------------------------------

/** Every number anywhere in `x`. */
const numbers = (x: unknown): number[] =>
  typeof x === 'number' ? [x] : x !== null && typeof x === 'object' ? Object.values(x).flatMap(numbers) : [];
/** Every step's canonical line filled for the case, at the ETA playRun's 20 s gaps give it (Approach is the 5th line). */
const canonical = (id: string): PlayInput[] =>
  STEPS.map(st => fill(st.id, caseById(id), etaMinutes(Math.max(0, st.order - 5) * 20_000)));

describe.each(CASES.map(c => c.id))('the canonical run of %s', id => {
  test('typed: reaches step 19, nothing missed, no Order fault, every number finite', async () => {
    const s = await playRun(id, 'coached', canonical(id));
    expect(s.current).toBe(19);
    const r = endRun(envOf(id), s, T0 + 21 * 20_000);
    // Task 11b: each case's line says its conditional points ({say:<pointId>}), so none needs a paraphrase
    expect(r.faults.filter(f => f.kind === 'missed')).toEqual([]);
    expect(r.faults.filter(f => f.kind === 'order')).toEqual([]);
    expect(applicablePoints(STEPS, caseById(id)).filter(a => a.point.when !== undefined && s.hits[a.key] === undefined).map(a => a.key)).toEqual([]);
    expect(s.lines.flatMap(l => l.flags ?? []).filter(f => f.kind === 'nudge' || f.kind === 'order')).toEqual([]);
    expect(numbers(s).every(Number.isFinite)).toBe(true);
    expect(r.rbsMs).not.toBeNull();
    expect(r.standbyMs).not.toBeNull();
    // {decisionLine}: the notes' decision sentence credits the case's plan (stay-and-treat or load-and-go)
    expect(r.missed).not.toContain(`decision-point/${caseById(id).expected.decision.plan}`);
    expect(s.hits[`decision-point/${caseById(id).expected.decision.plan}`]).toBeDefined();
    // {callExtras}: the call is finished in every case, the trauma critical injuries and the RTA vehicles asked
    expect(r.missed.filter(k => k.startsWith('call-caller/') || k.startsWith('respond-call/'))).toEqual([]);
    const c = caseById(id);
    expect([s.hits['call-caller/critical-injuries'] !== undefined, s.hits['call-caller/vehicles'] !== undefined])
      .toEqual([c.type === 'trauma', c.flags.includes('rta')]);
  });
  test('tapped: every step tapped, nothing to fix, no flags', async () => {
    const s = await playRun(id, 'coached', STEPS.map(st => ({ tap: st.id })));
    expect(s.tapped).toEqual(STEP_IDS);
    const r = endRun(envOf(id), s, T0 + 21 * 20_000);
    expect(r.faults).toEqual([]);
    expect(s.lines.every(l => l.flags === undefined)).toBe(true);
    expect(numbers(s).every(Number.isFinite)).toBe(true);
    expect(r.oxygen).toMatchObject({ device: caseById(id).expected.oxygen.device, right: true });
    // Plan 3 T2 (D23): the tapped BP arm is the case's own arm, right
    expect(s.hits['investigation/bp-arm']).toMatchObject({ check: 'right', chose: `${caseById(id).findings.investigation.bpArm} arm`, tapped: true });
    expect(s.hits[`decision-point/${caseById(id).expected.decision.plan}`]?.said).toBe(
      caseById(id).expected.decision.plan === 'stay-and-treat' ? 'So, I will Stay & Treat to see whether I can initiate any protocols.' : 'It is a Load & Go case.');
    // {callExtras}: the tapped call says the case's extra questions
    if (caseById(id).type === 'trauma') expect(s.hits['call-caller/critical-injuries']?.said).toBe('Any critical injuries present?');
    if (caseById(id).flags.includes('rta')) expect(s.hits['call-caller/vehicles']?.said).toBe('What vehicles are involved in the accident?');
  });
  test("tapped: each step's line shows the case's own conditional sentences, and no other case's", async () => {
    const c = caseById(id);
    const s = await playRun(id, 'coached', STEPS.map(st => ({ tap: st.id })));
    const shown = s.lines.filter(l => l.who === 'you');
    expect(shown).toHaveLength(STEPS.length);
    for (const [i, st] of STEPS.entries()) {
      const text = shown[i]!.text;
      for (const m of st.mustHit.filter(x => x.say !== undefined)) {
        // the say as the case's line says it, any slot it holds filled (Plan 3 T3, D22: "Buddy, immobilise the {limbWhere}.")
        const say = fillCanonical(m.say!, c, 6, st.mustHit);
        expect(text.includes(m.say!.split('{')[0]!), `${st.id}/${m.id}`).toBe(conditionHolds(c, m.when!));
        if (conditionHolds(c, m.when!)) expect(text, `${st.id}/${m.id}`).toContain(say);
        // a tapped point records its own sentence as said: one whole sentence of its say, never '' (review round 1, Minor 4)
        if (conditionHolds(c, m.when!)) expect(splitSentences(say), `${st.id}/${m.id}`).toContain(s.hits[`${st.id}/${m.id}`]!.said);
      }
      expect(text, st.id).not.toMatch(/[{}]|\s{2}/);
    }
  });
});

// ---- Plan 3 Task 1 (D25): a sentence that reads nothing leaves the route when it is a statement -----------------------
// An unread question keeps "Not sure what this is.", as it expected an answer; a line that reads nothing still says it.

/** COPD on step `order`, every step before it done. */
const atStep = (order: number): RunSession => ({ ...hitAll(blankSession('copd-amk-01'), STEPS, copd, upTo(order - 1)), current: order });

test('D25: the notes\' call at step 2 routes its points only; "We are on our way…" reads nothing and adds no piece', async () => {
  const s = await send(atStep(2), 'Hi, I am calling from 995 FMV. My name is EMT XXX. We are on our way to your place now. '
    + 'Can I confirm your address / location?');
  expect(mine(s).at(-1)!.route).toBe('To caller: caller intro · To caller: location');
});

test('D25: an unread question keeps its piece', async () => {
  const s = await send(atStep(2), 'Is he conscious? Is the sky blue?');
  expect(s.hits['call-caller/conscious']).toBeDefined();
  expect(mine(s).at(-1)!.route).toBe('To caller: conscious? · Not sure what this is.');
});

test('D25: a line that reads nothing at all still says "Not sure what this is." once', async () => {
  const s = await send(atStep(6), 'The weather is nice today.');
  expect(mine(s).at(-1)!.route).toBe(NOT_UNDERSTOOD);
});

test('D25: an unread statement adds no piece to a line that reads something', async () => {
  const at7 = atStep(7);
  const alone = mine(await send(at7, 'Sir, can you hear me?')).at(-1)!.route;
  expect(mine(await send(at7, 'Sir, can you hear me? Nice weather today.')).at(-1)!.route).toBe(alone);
});

test('D25: readSentence marks a question, and only a question', () => {
  const ctx = ctxAt('loc-avpu');
  expect(readSentence('Is the sky blue?', ctx).question).toBe(true);
  expect(readSentence('Is the sky blue', ctx).question).toBe(true);   // dictated, no "?": it opens with a question word
  expect(readSentence('Nice weather today.', ctx).question).toBeUndefined();
  expect(readSentence('Do not move.', ctx).question).toBeUndefined();
});

// Task 1 review round 1 (Minor 2): a question dictated with no "?" that opens with an auxiliary is still a question, so
// it keeps its mark when it reads nothing (D25). "May", "should", "am" and "shall" open one only before "I": "May be
// COPD." and "Should be fine." are statements.
test('review round 1: a dictated question opening with an auxiliary is a question', async () => {
  const ctx = ctxAt('loc-avpu');
  for (const q of ['May I know your name', 'Should I call him', 'Am I clear', 'Shall I call the ambulance', 'Can you hear me',
    'Could you open your eyes', 'Would you like to sit up', 'Will you be ok', 'Do you have any pain', 'Does it hurt', 'Did you fall',
    'Is it painful', 'Are you ok', 'Have you eaten', 'Has he taken his medicine', 'Uncle, may I know your name', 'OK, should I call him'])
    expect(readSentence(q, ctx).question, q).toBe(true);
  for (const x of ['May be COPD.', 'Should be fine.', 'Shall do.', 'Am here.', 'Mayday.'])
    expect(readSentence(x, ctx).question, x).toBeUndefined();
  const alone = mine(await send(atStep(7), 'Sir, can you hear me?')).at(-1)!.route;
  expect(mine(await send(atStep(7), 'Sir, can you hear me? May I know if you like durians')).at(-1)!.route).toBe(`${alone} · ${NOT_UNDERSTOOD}`);
});

// Task 1 review round 1 (I2): the race-first F and M are letters of their own, so a race word before any word that
// starts with f or m ("Malay, mid-50s", "Chinese from home") credits no sex, and the debrief still says "Missing: Sex".
test('review round 1: at the notification step, a SRACIE that names no sex credits the race and not the sex, in every case', async () => {
  for (const c of CASES) {
    const step = STEPS.find(x => x.id === 'notification')!;
    const done = hitAll(blankSession(c.id), STEPS, c, STEPS.filter(x => x.order < step.order).map(x => x.id));
    const at19 = { ...done, current: step.order, arrived: true, clock: { started: true, bankedMs: 14 * 60_000, runningSince: T0 } };
    for (const line of ['FMV 123 to Ops Centre, requesting for Alpha for unstable case of Malay, mid-50s, case of chest pain.',
      'Requesting Alpha for unstable case of Chinese from home, 72 years old, case of COPD.']) {
      const s = await send(at19, line, T0, envOf(c.id));
      expect([s.parts['notification/sracie/race'] !== undefined, s.parts['notification/sracie/sex'] !== undefined], `${c.id} ${line}`)
        .toEqual([true, false]);
    }
  }
});
