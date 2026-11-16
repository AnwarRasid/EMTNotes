import { CASES, STEPS, blankSession, caseById, hitAll, hitAt } from './sim-helpers';
import type { Step } from '../../src/data/schema';
import type { RunSession } from '../../src/progress/types';
import { FAULT_RANK, applicablePoints, classify, outOfOrder, pointDone, pointKey, rankOf } from '../../src/sim/classify';

const copd = caseById('copd-amk-01');
const STEPS_1_TO_4 = ['respond-call', 'call-caller', 'preparation', 'scene-evaluation'];
const step = (id: string): Step => {
  const s = STEPS.find(x => x.id === id);
  if (s === undefined) throw new Error(`No step "${id}".`);
  return s;
};
/** Keys a, b, c… with these ranks. */
const seq = (...r: number[]) => r.map((rank, i) => ({ key: String.fromCharCode(97 + i), rank }));
const withParts = (s: RunSession, key: string, parts: string[], line: number): RunSession => ({
  ...s, parts: { ...s.parts, ...Object.fromEntries(parts.map((p, i) => [`${key}/${p}`, { line, pos: i }])) },
});

// ---- The brief's tests (Task 9 Step 1) ----------------------------------------------------------------------

test('nothing done: every applicable point is Missed, in step order', () => {
  const r = classify(STEPS, copd, blankSession('copd-amk-01'), null);
  expect(r.faults.every(f => f.kind === 'missed')).toBe(true);
  expect(r.faults[0]).toMatchObject({ point: 'respond-call/call-sign', step: 1, atMs: null, detail: null });
  expect(r.faults).toHaveLength(applicablePoints(STEPS, copd).length);
  expect([r.stepsClean, r.stepsTotal]).toEqual([0, 19]);
});
test('head grip during Approach is the Order fault, not the Approach points after it (the mockup)', () => {
  let s = hitAll(blankSession('copd-amk-01'), STEPS, copd, ['respond-call', 'call-caller', 'preparation', 'scene-evaluation']);
  s = hitAt(s, 'approach-patient/sound-out', 100, { during: 5 });
  s = hitAt(s, 'introduction/head-grip', 101, { during: 5 });
  for (const [i, p] of ['catastrophic-bleeding', 'hazards-remove', 'head-still'].entries()) s = hitAt(s, `approach-patient/${p}`, 102 + i, { during: 6 });
  s = hitAt(s, 'introduction/intro-emt-scdf', 105, { during: 6 });
  s = hitAt(s, 'introduction/whats-bothering', 106, { during: 6 });
  const order = classify(STEPS, copd, s, null).faults.filter(f => f.kind === 'order');
  expect(order).toEqual([expect.objectContaining({ point: 'introduction/head-grip',
    detail: 'Done during step 5, Approach patient. It belongs to step 6, Introduction.' })]);
});
// Ruling P37: an oxygen Wrong ends with the case's expected.oxygen.note, and the COPD case carries one.
test('phrase, wrong, missing parts and parts out of order', () => {
  let s = hitAt(blankSession('copd-amk-01'), 'scene-evaluation/moi', 1, { missing: ['suspected'] });
  s = hitAt(s, 'breathing/mask-flow', 2, { check: 'wrong', chose: 'simple face mask 6 L/min' });
  for (const [i, part] of ['head', 'neck', 'chest', 'pelvis', 'abdomen', 'lower-extremities', 'upper-extremities'].entries())
    s = { ...s, parts: { ...s.parts, [`rapid-body-survey/rbs-regions/${part}`]: { line: 3, pos: i } } };
  const f = classify(STEPS, copd, s, null).faults;
  const of = (key: string) => f.filter(x => x.point === key).map(x => [x.kind, x.detail]);
  expect(of('scene-evaluation/moi')).toEqual([['phrase', 'Key words missing: “suspected”.']]);
  expect(of('breathing/mask-flow')).toEqual([['wrong',
    `Gave simple face mask 6 L/min. This patient needs nasal cannula 2–4 L/min. Readings didn't improve. ${copd.expected.oxygen.note}`]]);
  expect(of('rapid-body-survey/rbs-regions')).toEqual([['missed', 'Missing: Back.'], ['order', 'Out of order: Pelvis before Abdomen.']]);
});
test('a missed point is placed when the trainee moved past its step', () => {
  const s = { ...blankSession('copd-amk-01'), stepTimes: { investigation: 200_000, 'vital-signs': 260_000 } };
  expect(classify(STEPS, copd, s, 900_000).faults.find(x => x.point === 'rapid-body-survey/pocket-check')!.atMs).toBe(200_000);
  expect(classify(STEPS, copd, s, 900_000).faults.find(x => x.point === 'notification/get-ic')!.atMs).toBe(900_000);
});
test('disputed, tapped and drill-range points stay out of the score', () => {
  const s = { ...blankSession('copd-amk-01'), disputes: ['rapid-body-survey/pocket-check'], tapped: ['introduction'] };
  const r = classify(STEPS, copd, s, null);
  expect(r.disputed.map(x => x.point)).toEqual(['rapid-body-survey/pocket-check']);
  expect(r.faults.some(x => x.point.startsWith('introduction/'))).toBe(false);
  const d = classify(STEPS, copd, { ...blankSession('copd-amk-01'), drill: { target: 'rapid-body-survey', from: 11, to: 13, chain: [], sourceRunId: null } }, null);
  expect([...new Set(d.faults.map(x => x.step))]).toEqual([11, 12, 13]);
  expect(d.stepsTotal).toBe(3);
});
// Controller ruling (Task 9 fix round 1, amending R6's tie rule): on a dp tie the earlier item is kept, so the latest
// line out of place takes the blame. The brief's first, third and fourth examples changed from b, b and a.
test('outOfOrder blames the fewest points, and the latest one on a tie', () => {
  expect([...outOfOrder(seq(500, 600, 500))]).toEqual(['c']);
  expect([...outOfOrder(seq(500, 600, 700, 500))]).toEqual(['d']);
  expect([...outOfOrder(seq(500, 600, 500, 600))]).toEqual(['c']);
  expect([...outOfOrder(seq(900, 100))]).toEqual(['b']);
  expect([...outOfOrder([])]).toEqual([]);
});
// The rule as written, read literally: the candidates, their best dp, then the tie-break as a filter.
function literalOutOfOrder(s: { key: string; rank: number }[]): string[] {
  const r = s.map(x => x.rank);
  const dp: number[] = [];
  const prev: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const candidates = [...Array(i).keys()].filter(j => r[j]! <= r[i]!);
    if (candidates.length === 0) { dp.push(1); prev.push(-1); continue; }
    const best = Math.max(...candidates.map(j => dp[j]!));
    prev.push(Math.min(...candidates.filter(j => dp[j] === best)));   // on a tie, the smaller j
    dp.push(best + 1);
  }
  if (s.length === 0) return [];
  const longest = Math.max(...dp);
  const kept = new Set<number>();
  for (let i = Math.min(...[...dp.keys()].filter(k => dp[k] === longest)); i >= 0; i = prev[i]!) kept.add(i);   // the smaller i
  return s.filter((_, i) => !kept.has(i)).map(x => x.key);
}
/** The longest non-decreasing run's length, by trying every subset (small n only). */
function bruteLongest(r: number[]): number {
  let longest = 0;
  for (let mask = 0; mask < 1 << r.length; mask++) {
    let last = -Infinity;
    let size = 0;
    let ok = true;
    for (let i = 0; i < r.length && ok; i++) {
      if ((mask & (1 << i)) === 0) continue;
      ok = r[i]! >= last;
      last = r[i]!;
      size++;
    }
    if (ok) longest = Math.max(longest, size);
  }
  return longest;
}
test('outOfOrder matches the rule read literally, and blames as few as possible, over 20 000 tie-heavy sequences', () => {
  let state = 12345;   // a fixed-seed LCG, so the sweep is the same on every run
  const rnd = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
  const ranks = [500, 501, 503, 504, 600, 700, 800];
  let mismatches = 0;
  let notMinimal = 0;
  for (let t = 0; t < 20_000; t++) {
    const r = Array.from({ length: Math.floor(rnd() * 11) }, () => ranks[Math.floor(rnd() * ranks.length)]!);
    const got = [...outOfOrder(seq(...r))];
    if (JSON.stringify(got) !== JSON.stringify(literalOutOfOrder(seq(...r)))) mismatches++;
    if (got.length !== r.length - bruteLongest(r)) notMinimal++;
  }
  expect([mismatches, notMinimal]).toEqual([0, 0]);
  // a few shapes by hand: all equal, strictly falling, interleaved ties, a late one, two late
  expect([...outOfOrder(seq(5, 5, 5, 5))]).toEqual([]);
  expect([...outOfOrder(seq(4, 3, 2, 1))]).toEqual(['b', 'c', 'd']);
  expect([...outOfOrder(seq(5, 6, 5, 6, 5))]).toEqual(['c', 'e']);
  expect([...outOfOrder(seq(100, 200, 300, 400, 150))]).toEqual(['e']);
  expect([...outOfOrder(seq(100, 200, 300, 120, 130))]).toEqual(['d', 'e']);   // the two said late, not the 300 before them
});

// ---- Rulings and carries -------------------------------------------------------------------------------------

// Ruling P07: notes s01 arrest a catastrophic bleed straight after asking about it, before hazards and the head, and
// step 5 now holds bleeding-control at index 2, so a trainee who follows the notes is never flagged.
test('the notes order for a catastrophic bleed gives no Order fault (bleed-woodlands-01)', () => {
  const bleed = caseById('bleed-woodlands-01');
  expect(step('approach-patient').mustHit.map(m => m.id))
    .toEqual(['sound-out', 'catastrophic-bleeding', 'bleeding-control', 'hazards-remove', 'head-still']);
  let s = hitAll(blankSession('bleed-woodlands-01'), STEPS, bleed, STEPS_1_TO_4);
  s = hitAt(s, 'approach-patient/sound-out', 100);
  s = hitAt(s, 'approach-patient/catastrophic-bleeding', 101);
  // expose & examine, direct pressure, the pressure dressing, then the C.A.T., each on its own line; the last completes it
  for (const [i, part] of ['expose-examine', 'direct-pressure', 'pressure-dressing', 'cat'].entries())
    s = withParts(s, 'approach-patient/bleeding-control', [part], 102 + i);
  s = hitAt(s, 'approach-patient/bleeding-control', 105);
  s = hitAt(s, 'approach-patient/hazards-remove', 106);
  s = hitAt(s, 'approach-patient/head-still', 107);
  for (const [i, p] of ['intro-emt-scdf', 'head-grip', 'whats-bothering'].entries()) s = hitAt(s, `introduction/${p}`, 108 + i);
  const r = classify(STEPS, bleed, s, null);
  expect(r.faults.filter(f => f.kind === 'order')).toEqual([]);
  expect(r.faults.filter(f => f.step <= 6)).toEqual([]);
});

// Ruling P37, for both cases that carry a note since Task 3.
test('an oxygen Wrong ends with the case note, in COPD and in asthma', () => {
  const cases = [['copd-amk-01', 'nasal cannula 2–4 L/min', 'exception 3'], ['asthma-tampines-01', 'nebuliser mask 6–8 L/min', 'salbutamol']] as const;
  for (const [id, needs, inNote] of cases) {
    const c = caseById(id);
    expect(c.expected.oxygen.note).toContain(inNote);
    const s = hitAt(blankSession(id), 'breathing/mask-flow', 1, { check: 'wrong', chose: 'non-rebreather mask 15 L/min', atMs: 400_000 });
    expect(classify(STEPS, c, s, null).faults.filter(f => f.kind === 'wrong')).toEqual([{
      kind: 'wrong', point: 'breathing/mask-flow', step: 10, label: 'Put on the appropriate mask and flow rate', atMs: 400_000,
      detail: `Gave non-rebreather mask 15 L/min. This patient needs ${needs}. Readings didn't improve. ${c.expected.oxygen.note}`,
    }]);
  }
  // titrating to the wrong oxygen at step 15 is the same Wrong, with the same note
  const t = hitAt(blankSession('copd-amk-01'), 'oxygen/maintain-titrate', 1, { check: 'wrong', chose: 'simple face mask 8 L/min' });
  expect(classify(STEPS, copd, t, null).faults.find(f => f.kind === 'wrong')!.detail)
    .toBe(`Gave simple face mask 8 L/min. This patient needs nasal cannula 2–4 L/min. Readings didn't improve. ${copd.expected.oxygen.note}`);
});
test('an oxygen Wrong with no case note ends at the readings; an optional device allows no oxygen', () => {
  const ccf = caseById('ccf-jurong-01');
  expect(ccf.expected.oxygen.note).toBeUndefined();
  const s = hitAt(blankSession('ccf-jurong-01'), 'breathing/mask-flow', 1, { check: 'wrong', chose: 'nasal cannula 4 L/min' });
  expect(classify(STEPS, ccf, s, null).faults.find(f => f.kind === 'wrong')!.detail)
    .toBe("Gave nasal cannula 4 L/min. This patient needs non-rebreather mask 10–15 L/min. Readings didn't improve.");
  const hypo = caseById('hypo-hougang-01');
  const h = hitAt(blankSession('hypo-hougang-01'), 'breathing/mask-flow', 1, { check: 'wrong', chose: 'non-rebreather mask 15 L/min' });
  expect(classify(STEPS, hypo, h, null).faults.find(f => f.kind === 'wrong')!.detail)
    .toBe("Gave non-rebreather mask 15 L/min. This patient needs nasal cannula 2–4 L/min, or no oxygen. Readings didn't improve.");
});

// Carry to Task 9/10 (Task 6): palpate-dtbl and bp-screen are parted points with whole-match terms.
test('a parted point is judged by its parts: a whole read alone leaves D.T.B.L. and the BP screening not done', () => {
  const s = hitAt(hitAt(blankSession('copd-amk-01'), 'delicate-spine/palpate-dtbl', 1), 'investigation/bp-screen', 2);
  const a = (key: string) => applicablePoints(STEPS, copd).find(x => x.key === key)!;
  const of = (r: RunSession, key: string) => classify(STEPS, copd, r, null).faults.filter(x => x.point === key).map(x => [x.kind, x.detail]);
  for (const key of ['delicate-spine/palpate-dtbl', 'investigation/bp-screen']) {
    expect(pointDone(a(key), s)).toBe(false);
    expect(of(s, key)).toEqual([['missed', null]]);
  }
  const some = withParts(withParts(s, 'delicate-spine/palpate-dtbl', ['deformities'], 1), 'investigation/bp-screen', ['shunt', 'fistula'], 2);
  expect(of(some, 'delicate-spine/palpate-dtbl')).toEqual([['missed', 'Missing: Tenderness, Bruises, Lacerations.']]);
  expect(of(some, 'investigation/bp-screen')).toEqual([['missed', 'Missing: Chest operations (specifically breast cancer removal).']]);
  const every = withParts(withParts(s, 'delicate-spine/palpate-dtbl', ['deformities', 'tenderness', 'bruises', 'lacerations'], 1),
    'investigation/bp-screen', ['shunt', 'fistula', 'chest-op'], 2);
  for (const key of ['delicate-spine/palpate-dtbl', 'investigation/bp-screen']) {
    expect(pointDone(a(key), every)).toBe(true);
    expect(of(every, key)).toEqual([]);
  }
});

// ---- The other rules of the brief ---------------------------------------------------------------------------

test('point keys, ranks and fault ranks', () => {
  expect(pointKey('introduction', 'head-grip')).toBe('introduction/head-grip');
  expect(rankOf(step('approach-patient'), 2)).toBe(502);   // inOrder
  expect(rankOf(step('introduction'), 2)).toBe(600);
  expect(FAULT_RANK).toEqual({ missed: 0, wrong: 0, order: 1, phrase: 2 });
});
test('a point that does not apply to the case is never graded', () => {
  const missed = (id: string) => classify(STEPS, caseById(id), blankSession(id), null).faults.map(f => f.point);
  expect(missed('copd-amk-01')).not.toContain('approach-patient/bleeding-control');
  expect(missed('bleed-woodlands-01')).toContain('approach-patient/bleeding-control');
  expect(missed('copd-amk-01')).toContain('breathing/monitor-closely');      // asthmaCopd
  expect(missed('ccf-jurong-01')).not.toContain('breathing/monitor-closely');
  expect(missed('copd-amk-01')).toContain('decision-point/stay-and-treat');   // medical
  expect(missed('copd-amk-01')).not.toContain('decision-point/load-and-go');
  expect(applicablePoints(STEPS, copd, [11, 13]).map(a => a.step.order).every(n => n >= 11 && n <= 13)).toBe(true);
  expect(applicablePoints(STEPS, copd, [11, 13])[0]).toMatchObject({ key: 'circulation/pulse', index: 0 });
});
test('every applicable point done in order is a clean run, in every case', () => {
  for (const c of CASES) {
    const r = classify(STEPS, c, hitAll(blankSession(c.id), STEPS, c, STEPS.map(x => x.id)), 1_200_000);
    expect(r.faults, c.id).toEqual([]);
    expect(r.disputed, c.id).toEqual([]);
    expect([r.stepsClean, r.stepsTotal], c.id).toEqual([19, 19]);
  }
});
test('order within an inOrder step, a point said late, and any order in a step without inOrder', () => {
  let s = hitAll(blankSession('copd-amk-01'), STEPS, copd, STEPS_1_TO_4);
  s = hitAt(s, 'approach-patient/sound-out', 100);
  s = hitAt(s, 'approach-patient/head-still', 101);
  s = hitAt(s, 'approach-patient/catastrophic-bleeding', 102);
  s = hitAt(s, 'approach-patient/hazards-remove', 103);
  s = hitAt(s, 'introduction/whats-bothering', 104);   // introduction has no inOrder, so its points go in any order
  s = hitAt(s, 'introduction/intro-emt-scdf', 105);
  s = hitAt(s, 'delicate-spine/ask-fall', 106);
  s = hitAt(s, 'breathing/chest-rise-fall', 107);
  s = hitAt(s, 'breathing/rate-quality', 108);
  s = hitAt(s, 'delicate-spine/ask-neck-pain', 109, { during: 10, atMs: 300_000 });
  expect(classify(STEPS, copd, s, null).faults.filter(f => f.kind === 'order')).toEqual([
    { kind: 'order', point: 'approach-patient/head-still', step: 5, label: "Never move the patient's head", atMs: null,
      detail: 'Done out of order within step 5, Approach patient.' },
    { kind: 'order', point: 'delicate-spine/ask-neck-pain', step: 8, label: 'Do you feel any pain at your neck?', atMs: 300_000,
      detail: 'Done during step 10, Breathing. It belongs to step 8, Delicate spine.' },
  ]);
});
// Controller ruling (fix round 1): the point recalled late is blamed, not the next step's point said in its place.
test('SpO2 recalled after the pulse is the Order fault, not the pulse', () => {
  const upTo10 = hitAll(blankSession('copd-amk-01'), STEPS, copd, STEPS.filter(x => x.order <= 10).map(x => x.id));
  let s = hitAt(upTo10, 'circulation/pulse', 200, { during: 10 });   // step 10 done but SpO2, then the pulse
  s = hitAt(s, 'breathing/spo2', 201, { during: 11 });                // then SpO2, the step 10 hit moved after it
  const order = (r: RunSession) => classify(STEPS, copd, r, null).faults.filter(f => f.kind === 'order');
  expect(order(s)).toEqual([{ kind: 'order', point: 'breathing/spo2', step: 10, label: 'Arm buddy: measure SpO2 on room air', atMs: null,
    detail: 'Done during step 11, Circulation. It belongs to step 10, Breathing.' }]);
  // the pulse rate and quality after it don't move the blame
  expect(order(hitAt(s, 'circulation/pulse-rate-quality', 202, { during: 11 })).map(f => f.point)).toEqual(['breathing/spo2']);
});
// Review Minor 1: a part-order fault on a hit takes the hit's atMs, even a null one; with no hit, the Missed time.
test('a part-order fault takes its hit\'s time, null included, and the moved-past time with no hit', () => {
  const regions = ['head', 'neck', 'chest', 'pelvis', 'abdomen', 'lower-extremities', 'upper-extremities', 'back'];
  const base = withParts({ ...blankSession('copd-amk-01'), stepTimes: { investigation: 300_000 } }, 'rapid-body-survey/rbs-regions', regions, 3);
  const partOrder = (r: RunSession) => classify(STEPS, copd, r, null).faults.filter(f => f.point === 'rapid-body-survey/rbs-regions');
  expect(partOrder(hitAt(base, 'rapid-body-survey/rbs-regions', 3)).map(f => [f.kind, f.atMs, f.detail]))
    .toEqual([['order', null, 'Out of order: Pelvis before Abdomen.']]);
  expect(partOrder(hitAt(base, 'rapid-body-survey/rbs-regions', 3, { atMs: 150_000 })).map(f => f.atMs)).toEqual([150_000]);
  const noBack = { ...base, parts: Object.fromEntries(Object.entries(base.parts).filter(([k]) => !k.endsWith('/back'))) };
  expect(partOrder(noBack).map(f => [f.kind, f.atMs])).toEqual([['missed', 300_000], ['order', 300_000]]);
});
test('the oxygen and ECG checks: a wrong ECG, and a choice never named', () => {
  let s = hitAt(blankSession('copd-amk-01'), 'breathing/mask-flow', 1, { check: 'unnamed' });
  s = hitAt(s, 'investigation/ecg', 2, { check: 'wrong', chose: '4-lead' });
  const of = (r: RunSession, key: string) => classify(STEPS, copd, r, null).faults.filter(x => x.point === key).map(x => [x.kind, x.detail]);
  expect(of(s, 'breathing/mask-flow')).toEqual([['phrase', 'Say which mask and flow rate.']]);
  expect(of(s, 'investigation/ecg')).toEqual([['wrong', 'Chose 4-lead. This patient needs 12-lead.']]);
  const e = hitAt(blankSession('copd-amk-01'), 'investigation/ecg', 1, { check: 'unnamed' });
  expect(of(e, 'investigation/ecg')).toEqual([['phrase', 'Say which ECG: 12-lead or 4-lead.']]);
  const right = hitAt(hitAt(blankSession('copd-amk-01'), 'breathing/mask-flow', 1), 'investigation/ecg', 2);   // check 'right'
  expect(of(right, 'breathing/mask-flow')).toEqual([]);
  expect(of(right, 'investigation/ecg')).toEqual([]);
});
test('several missing key words are each quoted', () => {
  const s = hitAt(blankSession('copd-amk-01'), 'approach-patient/sound-out', 1, { missing: ['front', 'move your head'], atMs: 0 });
  expect(classify(STEPS, copd, s, null).faults.find(f => f.point === 'approach-patient/sound-out'))
    .toMatchObject({ kind: 'phrase', atMs: 0, detail: 'Key words missing: “front”, “move your head”.' });
});
test('faults sort by rank, then step, then point; a point\'s Missed comes before its Wrong', () => {
  let s = hitAll(blankSession('copd-amk-01'), STEPS, copd, STEPS_1_TO_4);
  s = hitAt(s, 'scene-evaluation/moi', 99, { missing: ['suspected'] });
  s = hitAt(s, 'approach-patient/sound-out', 100);
  s = hitAt(s, 'introduction/head-grip', 101, { during: 5 });
  s = hitAt(s, 'approach-patient/catastrophic-bleeding', 102);
  s = hitAt(s, 'approach-patient/hazards-remove', 103);
  s = hitAt(s, 'approach-patient/head-still', 104);
  s = hitAt(s, 'breathing/mask-flow', 105, { check: 'wrong', chose: 'simple face mask 6 L/min' });
  const f = classify(STEPS, copd, s, null).faults;
  const key = (x: (typeof f)[number]) => [FAULT_RANK[x.kind], x.step];
  expect(f.map(key)).toEqual([...f.map(key)].sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!));
  // a Wrong sorts with the Missed, by step: after step 6's missed intro, before step 11's missed pulse
  const at = (p: (x: (typeof f)[number]) => boolean) => f.findIndex(p);
  expect(at(x => x.point === 'introduction/intro-emt-scdf')).toBeLessThan(at(x => x.kind === 'wrong'));
  expect(at(x => x.kind === 'wrong')).toBeLessThan(at(x => x.point === 'circulation/pulse'));
  expect(f.filter(x => x.kind !== 'missed' && x.kind !== 'wrong').map(x => [x.kind, x.point]))
    .toEqual([['order', 'introduction/head-grip'], ['phrase', 'scene-evaluation/moi']]);
  // no shipped point both misses and is wrong, so a parted copy of mask-flow shows the tie
  const parted = STEPS.map(x => (x.id !== 'breathing' ? x : { ...x, mustHit: x.mustHit.map(m => (m.id !== 'mask-flow' ? m
    : { ...m, parts: [{ id: 'mask', label: 'Mask', match: [['mask']] }, { id: 'flow', label: 'Flow', match: [['flow']] }] })) }));
  const p = withParts(hitAt(blankSession('copd-amk-01'), 'breathing/mask-flow', 1, { check: 'wrong', chose: 'simple face mask' }),
    'breathing/mask-flow', ['mask'], 1);
  const both = classify(parted, copd, p, null).faults.filter(x => x.point === 'breathing/mask-flow');
  expect(both.map(x => x.kind)).toEqual(['missed', 'wrong']);
  expect(both[0]!.detail).toBe('Missing: Flow.');
});
test('steps clean: graded steps with no counted fault; a tapped step never counts, a disputed fault does not hold one back', () => {
  const six = hitAll(blankSession('copd-amk-01'), STEPS, copd, [...STEPS_1_TO_4, 'approach-patient', 'introduction']);
  expect(classify(STEPS, copd, six, null).stepsClean).toBe(6);
  const noGrip = { ...six, hits: Object.fromEntries(Object.entries(six.hits).filter(([k]) => k !== 'introduction/head-grip')) };
  expect(classify(STEPS, copd, noGrip, null).stepsClean).toBe(5);
  const disputed = classify(STEPS, copd, { ...noGrip, disputes: ['introduction/head-grip'] }, null);
  expect(disputed).toMatchObject({ stepsClean: 6, disputed: [expect.objectContaining({ kind: 'missed', point: 'introduction/head-grip' })] });
  expect(disputed.faults.some(f => f.point === 'introduction/head-grip')).toBe(false);
  const tapped = { ...six, tapped: ['loc-avpu'] };   // tapped: no faults, and not clean
  const r = classify(STEPS, copd, tapped, null);
  expect(r.faults.some(f => f.step === 7)).toBe(false);
  expect(r.stepsClean).toBe(6);
});
test('prefilled steps are not graded, and a drill counts its own range', () => {
  const s: RunSession = { ...hitAll(blankSession('copd-amk-01'), STEPS, copd, ['circulation', 'rapid-body-survey', 'investigation']),
    prefilled: STEPS.filter(x => x.order < 11).map(x => x.id),
    drill: { target: 'rapid-body-survey', from: 11, to: 13, chain: [], sourceRunId: null } };
  expect(classify(STEPS, copd, s, null)).toEqual({ faults: [], disputed: [], stepsClean: 3, stepsTotal: 3 });
  const unfilled = { ...s, prefilled: [] };   // steps before the range are outside it, prefilled or not
  expect(classify(STEPS, copd, unfilled, null).faults).toEqual([]);
  // a prefilled step inside the graded range is still never graded
  const inRange = { ...blankSession('copd-amk-01'), prefilled: ['circulation'] };
  expect(classify(STEPS, copd, inRange, null).faults.some(f => f.step === 11)).toBe(false);
});
test('a missed point with no later step reached and no end time has no time', () => {
  const s = { ...blankSession('copd-amk-01'), stepTimes: { 'approach-patient': 0, introduction: 20_000 } };
  const r = classify(STEPS, copd, s, null);
  expect(r.faults.find(f => f.point === 'scene-evaluation/moi')!.atMs).toBe(0);        // step 4, moved past at Approach
  expect(r.faults.find(f => f.point === 'approach-patient/sound-out')!.atMs).toBe(20_000);
  expect(r.faults.find(f => f.point === 'introduction/head-grip')!.atMs).toBeNull();
});

// Plan 3 Task 2 (D23): the BP arm is a check point too. The arm a patient rules out is Wrong, with its detail, and sorts
// with the Missed (R5's magenta); an arm never named is Phrase.
test('the arm check: a ruled-out arm is Wrong, sorted with the Missed; an arm never named is Phrase', () => {
  const ccf = caseById('ccf-jurong-01');
  const before = hitAll(blankSession('ccf-jurong-01'), STEPS, ccf, STEPS.filter(x => x.order < 13).map(x => x.id));
  const s = hitAt(before, 'investigation/bp-arm', 200, { check: 'wrong', chose: 'left arm', atMs: 400_000 });
  const f = classify(STEPS, ccf, s, null).faults;
  expect(f.filter(x => x.point === 'investigation/bp-arm')).toEqual([{ kind: 'wrong', point: 'investigation/bp-arm', step: 13,
    label: 'Name the arm for BP', atMs: 400_000,
    detail: 'Chose the left arm. The patient ruled that arm out, so the BP goes on the right arm.' }]);
  // with the Missed: after step 13's missed auscultation, before step 14's missed GCS, ahead of every Order and Phrase
  const at = (p: (x: (typeof f)[number]) => boolean) => f.findIndex(p);
  const wrong = at(x => x.kind === 'wrong');
  expect(at(x => x.point === 'investigation/auscultation')).toBeLessThan(wrong);
  expect(wrong).toBeLessThan(at(x => x.point === 'vital-signs/gcs'));
  expect(f.slice(0, wrong).every(x => x.kind === 'missed')).toBe(true);
  const unnamed = hitAt(before, 'investigation/bp-arm', 200, { check: 'unnamed' });
  expect(classify(STEPS, ccf, unnamed, null).faults.filter(x => x.point === 'investigation/bp-arm').map(x => [x.kind, x.detail]))
    .toEqual([['phrase', 'Say which arm the BP goes on.']]);
});
