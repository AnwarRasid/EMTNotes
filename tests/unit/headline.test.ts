import { STEPS } from './sim-helpers';
import type { Fault, RunRecord } from '../../src/progress/types';
import { HEADLINE_VERB, headline, headlineCopy, lastRunTimes, latestFullRun, type Headline } from '../../src/sim/headline';

const POCKET = 'rapid-body-survey/pocket-check';
const MOI = 'scene-evaluation/moi';
const LABEL: Record<string, string> = {
  [POCKET]: 'Pocket check, after seeking permission',
  [MOI]: 'MOI: "Suspected case of XXX"',
  'scene-evaluation/witnesses': 'Are there any witnesses?',
  'introduction/head-grip': 'My buddy will do a head grip on you, please allow him',
  'breathing/mask-flow': 'Put on the appropriate mask and flow rate',
  'airway/smell': 'Smell for unusual breath smells',
  'loc-avpu/state-level': 'State the level aloud: Alert, Verbal, Pain or Unresponsive',
};
const STEP_OF: Record<string, number> = { 'rapid-body-survey': 12, 'scene-evaluation': 4, introduction: 6, breathing: 10, airway: 9, 'loc-avpu': 7 };

const f = (point: string, kind: Fault['kind'] = 'missed', label = LABEL[point] ?? point): Fault =>
  ({ kind, point, step: STEP_OF[point.split('/')[0]!] ?? 1, label, detail: null, atMs: null });
/** A finished COPD run with these faults, its clock run to `usedMs`. */
const run = (id: string, faults: Fault[], extra: Partial<RunRecord> = {}): RunRecord => ({
  id, caseId: 'copd-amk-01', mode: 'coached', drill: false, startedAt: '2026-11-13T14:00:00.000Z', usedMs: 1_062_000,
  stepTimes: { 'approach-patient': 0 }, missed: [], order: [], phrase: [], disputes: [], tapped: [], transcript: [],
  wrong: [], faults, rbsMs: null, standbyMs: null, readings: [], oxygen: null, record: null, drillRange: null,
  drillChain: [], stepsTotal: 19, reached: [], sourceRunId: null, smartLines: 0, ...extra,
});
const drill = (id: string, faults: Fault[]): RunRecord =>
  run(id, faults, { drill: true, usedMs: 0, stepTimes: {}, drillRange: [3, 5], stepsTotal: 3 });

// Progress.runs is oldest first: r1, r2, r3, then a newer drill.
const r1 = run('r1', [f(MOI, 'phrase')], { disputes: [MOI] });
const r2 = run('r2', [f(POCKET)]);
const r3 = run('r3', [f(POCKET), f(MOI, 'phrase')]);
const RUNS = [r1, r2, r3, drill('d1', [f('scene-evaluation/witnesses')])];

// ---- The brief's tests ------------------------------------------------------------------------------------------

test('headline: the point missed in 2 of the last 3 runs; the disputed MOI and the drill don\'t count', () => {
  expect(headline(RUNS)).toEqual({ kind: 'missed', point: POCKET, step: 12, count: 2, of: 3, label: LABEL[POCKET] });
});

test('headlineCopy: its title, sub, drill key and notes link', () => {
  expect(headlineCopy(headline(RUNS)!, STEPS)).toEqual({
    title: 'Pocket check missed in 2 of your last 3 runs',
    sub: 'Pocket check, after seeking permission. Step 12, Rapid body survey.',
    drillLabel: 'Drill steps 11 to 13',
    drillHref: '#/pam/start?drill=rapid-body-survey',
    notesRef: 's01#rapid-body-survey',
  });
});

test('with one run the title ends "in your last run"', () => {
  const h = headline([r2])!;
  expect(h).toMatchObject({ count: 1, of: 1 });
  expect(headlineCopy(h, STEPS).title).toBe('Pocket check missed in your last run');
});

test('no active faults, no headline', () => {
  expect(headline([])).toBeNull();
  expect(headline([run('a', []), run('b', [])])).toBeNull();
  expect(headline([r1])).toBeNull();   // its only fault is disputed
  expect(headline([drill('d', [f(POCKET)])])).toBeNull();   // drills never count
});

test('lastRunTimes: the newest full runs\' times, newest first, up to 3', () => {
  const runs = [run('a', [], { usedMs: 960_000 }), run('b', [], { usedMs: 1_270_000 }), run('c', [], { usedMs: 1_145_000 }),
    run('d', [], { usedMs: 1_062_000 }), drill('e', [])];
  expect(lastRunTimes(runs)).toEqual(['17:42', '19:05', '21:10']);
  expect(lastRunTimes(runs, 1)).toEqual(['17:42']);
  expect(lastRunTimes([drill('x', [])])).toEqual([]);
  expect(lastRunTimes([])).toEqual([]);
});

// ---- Counting and tie-breaks ------------------------------------------------------------------------------------

test('only the three newest full runs count', () => {
  const old = [run('o1', [f(MOI, 'phrase')]), run('o2', [f(MOI, 'phrase')]), run('o3', [f(MOI, 'phrase')])];
  expect(headline([...old, run('n1', [f(POCKET)]), run('n2', []), run('n3', [])]))
    .toMatchObject({ point: POCKET, count: 1, of: 3 });
  expect(headline([run('a', []), run('b', [f(POCKET)])])).toMatchObject({ count: 1, of: 2 });
});

test('a point counts once per run, at the run\'s lowest-ranked kind', () => {
  // r: the oxygen wrong and unnamed-phrased in one run; s: a pocket check missed in each of two runs
  const h = headline([run('a', [f(POCKET)]), run('b', [f('breathing/mask-flow', 'phrase'), f('breathing/mask-flow', 'wrong'),
    f('breathing/mask-flow', 'phrase')])])!;
  expect(h).toMatchObject({ point: 'breathing/mask-flow', count: 1, kind: 'wrong', of: 2 });   // newest wins the 1–1 tie
  expect(headline([run('a', [f('breathing/mask-flow', 'order'), f('breathing/mask-flow', 'phrase')])])!.kind).toBe('order');
});

test('ties on count: the point in the newest run, then the lower step, then the key', () => {
  // newest run first: the MOI (step 4) is only in the older run, the pocket check (step 12) in the newest
  expect(headline([run('a', [f(MOI, 'phrase')]), run('b', [f(POCKET)])])!.point).toBe(POCKET);
  // both in the newest run: the lower step
  expect(headline([run('a', [f(POCKET), f(MOI, 'phrase')])])!.point).toBe(MOI);
  // the same step: the key
  expect(headline([run('a', [f('scene-evaluation/witnesses'), f(MOI)])])!.point).toBe(MOI);
});

test('the kind is the point\'s most frequent across the runs, a tie going to the higher rank', () => {
  // the kinds oldest run first, so the last is the newest run's
  const h = (kinds: Fault['kind'][]) => headline(kinds.map((k, i) => run(`r${i}`, [f('introduction/head-grip', k)])))!.kind;
  expect(h(['phrase', 'order', 'phrase'])).toBe('phrase');
  expect(h(['phrase', 'order'])).toBe('order');
  expect(h(['order', 'phrase'])).toBe('order');   // the rank, never the newest run's kind
  expect(h(['order', 'missed'])).toBe('missed');
  expect(h(['missed', 'order'])).toBe('missed');
  expect(h(['wrong', 'missed'])).toBe('missed');   // the same rank: Missed before Wrong
  expect(h(['missed', 'wrong'])).toBe('missed');
});

test('the label and step are the newest run\'s saved ones', () => {
  const h = headline([run('a', [f(POCKET, 'missed', 'Older label')]), run('b', [f(POCKET, 'missed', 'Newer label')])])!;
  expect(h).toMatchObject({ label: 'Newer label', step: 12, count: 2 });
});

// ---- The copy ---------------------------------------------------------------------------------------------------

test('HEADLINE_VERB: one verb per fault kind', () => {
  expect(HEADLINE_VERB).toEqual({ missed: 'missed', wrong: 'wrong', order: 'out of order', phrase: 'missing its key words' });
});

const H = (over: Partial<Headline>): Headline =>
  ({ kind: 'missed', point: POCKET, step: 12, count: 2, of: 3, label: LABEL[POCKET]!, ...over });

test('headlineCopy: each kind\'s verb, the short label capitalised', () => {
  expect(headlineCopy(H({ kind: 'order', point: 'introduction/head-grip', step: 6, label: LABEL['introduction/head-grip']! }), STEPS).title)
    .toBe('Head grip out of order in 2 of your last 3 runs');
  expect(headlineCopy(H({ kind: 'phrase', point: MOI, step: 4, label: LABEL[MOI]! }), STEPS).title)
    .toBe('MOI missing its key words in 2 of your last 3 runs');
  expect(headlineCopy(H({ kind: 'wrong', point: 'breathing/mask-flow', step: 10, count: 1, of: 1, label: LABEL['breathing/mask-flow']! }), STEPS).title)
    .toBe('Oxygen wrong in your last run');
});

test('headlineCopy: no second stop after a label ending in a stop, "?" or "!"', () => {
  expect(headlineCopy(H({ point: 'scene-evaluation/witnesses', step: 4, label: 'Are there any witnesses?' }), STEPS).sub)
    .toBe('Are there any witnesses? Step 4, Rescue scene evaluation.');
  expect(headlineCopy(H({ label: 'Pocket check.' }), STEPS).sub).toBe('Pocket check. Step 12, Rapid body survey.');
  expect(headlineCopy(H({ label: 'Check now!' }), STEPS).sub).toBe('Check now! Step 12, Rapid body survey.');
});

test('headlineCopy: the drill range is clipped at either end', () => {
  expect(headlineCopy(H({ point: 'respond-call/call-sign', step: 1 }), STEPS).drillLabel).toBe('Drill steps 1 to 2');
  expect(headlineCopy(H({ point: 'notification/sracie', step: 19 }), STEPS).drillLabel).toBe('Drill steps 18 to 19');
});

test('headlineCopy: a point no longer in the steps takes its short from the saved label; a gone step has no notes link', () => {
  // the short is capitalised; the sub keeps the saved label as it is
  const gonePoint = headlineCopy(H({ point: 'rapid-body-survey/old-point', label: 'old point check' }), STEPS);
  expect(gonePoint).toMatchObject({ title: 'Old point check missed in 2 of your last 3 runs', notesRef: 's01#rapid-body-survey',
    sub: 'old point check. Step 12, Rapid body survey.' });
  const goneStep = headlineCopy(H({ point: 'old-step/old-point', step: 12, label: 'Old point check' }), STEPS);
  expect(goneStep).toEqual({ title: 'Old point check missed in 2 of your last 3 runs', sub: 'Old point check. Step 12.',
    drillLabel: 'Drill steps 11 to 13', drillHref: '#/pam/start?drill=old-step', notesRef: null });
});

test('fix round 1, Minor 4: when every one of the runs had it, "both of your last 2" and "all of your last 3"', () => {
  expect(headlineCopy(H({ count: 2, of: 2 }), STEPS).title).toBe('Pocket check missed in both of your last 2 runs');
  expect(headlineCopy(H({ count: 3, of: 3 }), STEPS).title).toBe('Pocket check missed in all of your last 3 runs');
  expect(headlineCopy(H({ count: 1, of: 2 }), STEPS).title).toBe('Pocket check missed in 1 of your last 2 runs');
  expect(headlineCopy(H({ count: 2, of: 3 }), STEPS).title).toBe('Pocket check missed in 2 of your last 3 runs');
  expect(headlineCopy(H({ count: 1, of: 1 }), STEPS).title).toBe('Pocket check missed in your last run');
  expect(headlineCopy(headline([r2, r3])!, STEPS).title).toBe('Pocket check missed in both of your last 2 runs');
});

test('fix round 1, Minor 5: a run ended before its clock started never counts, so "2 of your last 2" stays', () => {
  // the newest run ended at once: every step Missed, the breath smell among them, and no time
  const atOnce = run('now', [f('airway/smell'), f('loc-avpu/state-level'), f(POCKET)], { usedMs: 0, stepTimes: {} });
  const runs = [run('a', [f(POCKET), f('airway/smell')]), run('b', [f(POCKET)]), atOnce];
  expect(headline(runs)).toMatchObject({ point: POCKET, count: 2, of: 2 });
  expect(headlineCopy(headline(runs)!, STEPS).title).toBe('Pocket check missed in both of your last 2 runs');
  // without the pocket check in it, the run ended at once would otherwise win the tie for the breath smell
  const other = [run('a', [f(POCKET), f('airway/smell')]), run('b', [f(POCKET)]), run('now', [f('airway/smell')], { usedMs: 0, stepTimes: {} })];
  expect(headline(other)).toMatchObject({ point: POCKET, count: 2, of: 2 });
  expect(headline([atOnce])).toBeNull();
  expect(latestFullRun(runs)).toBe(atOnce);   // Today's Last run still shows it, with "—"
});

// ---- latestFullRun and the D9 ruling ----------------------------------------------------------------------------

test('latestFullRun: the newest run that isn\'t a drill', () => {
  expect(latestFullRun(RUNS)).toBe(r3);
  expect(latestFullRun([drill('d', [])])).toBeNull();
  expect(latestFullRun([])).toBeNull();
});

test('D9: a run whose clock never started is left out of the last times', () => {
  const runs = [run('a', [], { usedMs: 960_000 }), run('b', [], { usedMs: 0, stepTimes: {} }), run('c', [], { usedMs: 1_062_000 })];
  expect(lastRunTimes(runs)).toEqual(['17:42', '16:00']);
  // a clock that started at the very end still counts, at 00:00
  expect(lastRunTimes([run('z', [], { usedMs: 0, stepTimes: { 'approach-patient': 0 } })])).toEqual(['00:00']);
});
