import * as v from 'valibot';
import questions from '../../public/data/questions.json';
import notes from '../../public/data/notes.json';
import stepsDoc from '../../public/data/steps.json';
import caseIndex from '../../public/data/cases/index.json';
import {
  RawQuestionsDocSchema, NotesDocSchema, StepsDocSchema, CONDITIONS, CANONICAL_SLOTS, CaseSchema, CaseIndexSchema, conditionHolds, getFinding,
  type Block, type Case, type Step,
} from '../../src/data/schema';
import { resolveNotesRef } from '../../src/data/notesRef';
import { RUN_LIMITS } from '../../src/progress/types';
import { caseSlots, matchAt, normalizeLine } from '../../src/sim/match';
import { fillCanonical } from '../../src/sim/replies';

test('questions.json matches its schema', () => { expect(() => v.parse(RawQuestionsDocSchema, questions)).not.toThrow(); });
test('notes.json matches its schema', () => { expect(() => v.parse(NotesDocSchema, notes)).not.toThrow(); });
test("the importer's review reasons make sense in the app, which re-letters every question's options A-D", () => {
  const reasons = questions.questions.flatMap(q => q.review.map(r => `${q.id}: ${r.reason}`));
  expect(reasons).toContain('mt-b-q168: The bank printed the letter A on two options.');
  for (const r of reasons) expect(r).not.toMatch(/label/i);
});
test('there are 407 questions and 20 sections', () => {
  expect(questions.questions).toHaveLength(407);
  expect(notes.sections).toHaveLength(20);
});

const STEP_IDS = ['respond-call', 'call-caller', 'preparation', 'scene-evaluation', 'approach-patient', 'introduction',
  'loc-avpu', 'delicate-spine', 'airway', 'breathing', 'circulation', 'rapid-body-survey', 'investigation',
  'vital-signs', 'oxygen', 'airway-recheck', 'position', 'decision-point', 'notification'];
const steps = () => v.parse(StepsDocSchema, stepsDoc).steps;
const point = (stepId: string, id: string) => steps().find(s => s.id === stepId)!.mustHit.find(m => m.id === id)!;
const partIds = (stepId: string, id: string) => point(stepId, id).parts!.map(p => p.id);

test('19 steps in order', () => {
  expect(steps().map(s => s.id)).toEqual(STEP_IDS);
  expect(steps().map(s => s.order)).toEqual(STEP_IDS.map((_, i) => i + 1));
  expect(steps().map(s => s.timed)).toEqual(STEP_IDS.map((_, i) => i >= 4));
  expect(steps().filter(s => s.startsClock).map(s => s.id)).toEqual(['approach-patient']);
});
test('every step links to a real notes anchor and has a canonical line', () => {
  // the case's slots, and Task 11b's {say:<pointId>} for a conditional point of the step
  const slots = new RegExp(`\\{(${CANONICAL_SLOTS.join('|')}|say:[a-z0-9-]+)\\}`, 'g');
  for (const s of steps()) {
    expect(resolveNotesRef(notes as any, s.notesRef), s.id).not.toBeNull();
    expect(s.canonicalLine.length).toBeGreaterThan(10);
    expect(s.canonicalLine.replace(slots, ''), s.id).not.toMatch(/[{}]/);
  }
});
test('every part the spec names is graded', () => {
  expect(partIds('rapid-body-survey', 'rbs-regions')).toEqual(['head', 'neck', 'chest', 'abdomen', 'pelvis', 'lower-extremities', 'upper-extremities', 'back']);
  expect(point('rapid-body-survey', 'rbs-regions').ordered).toBe(true);
  expect(point('rapid-body-survey', 'c-collar-after-rbs').ordered).toBe(true);
  expect(partIds('investigation', 'auscultation')).toEqual(['point-1', 'point-2', 'point-3', 'point-4', 'point-5', 'point-6', 'air-entry', 'equal-entry', 'abnormal-sounds']);
  expect(partIds('delicate-spine', 'palpate-dtbl')).toEqual(['deformities', 'tenderness', 'bruises', 'lacerations']);
  expect(partIds('breathing', 'ntucp')).toEqual(['nasal-flaring', 'tracheal-tugging', 'accessory-muscles', 'cyanosis', 'pursed-lips']);
  expect(partIds('preparation', 'equipment')).toEqual(['burn-kit', 'blanket-canvas', 'o2-bag', 'lsu', 'trauma-bag', 'zoll']);
  expect(point('preparation', 'equipment').accept).toHaveLength(1);
  expect(partIds('notification', 'sracie')).toEqual(['sex', 'race', 'age', 'case', 'two-signs', 'ic-no', 'eta']);
  expect(point('scene-evaluation', 'moi').requiredWords).toContain('suspected');
  for (const [s, m] of [['approach-patient', 'sound-out'], ['delicate-spine', 'release-grip'], ['breathing', 'monitor-closely'], ['notification', 'standby-opener']] as const)
    expect(point(s, m).keyPhrase, m).toBe(true);
  expect(steps().find(s => s.id === 'approach-patient')!.inOrder).toBe(true);
  expect(point('introduction', 'head-grip')).toBeDefined();
});
const pointIds = (stepId: string) => steps().find(s => s.id === stepId)!.mustHit.map(m => m.id);
test("Approach and Delicate Spine follow the notes' order", () => {
  // notes s01 Approach: "Is there any Catastrophic Bleeding? ... Arrest the bleeding first", before the hazards (ruling P07)
  expect(pointIds('approach-patient')).toEqual(['sound-out', 'catastrophic-bleeding', 'bleeding-control', 'hazards-remove', 'head-still']);
  expect(pointIds('delicate-spine')).toEqual(['ask-fall', 'neck-permission', 'ask-neck-pain', 'palpate-dtbl', 'release-grip', 'c-collar']);
  expect(point('delicate-spine', 'ask-neck-pain')).toMatchObject({ label: 'Do you feel any pain at your neck?', short: 'neck pain?', match: [['pain', 'neck']] });
});
test('the oxygen, BP arm and ECG points are marked as choices', () => {
  const checked = steps().flatMap(s => s.mustHit.filter(m => m.check).map(m => [m.id, m.check]));
  expect(checked).toEqual([['mask-flow', 'oxygen'], ['bp-arm', 'arm'], ['ecg', 'ecg'], ['maintain-titrate', 'oxygen']]);
});
test('short labels read as the routes and flags show them', () => {
  const SHORTS = { 'call-sign': 'call sign', 'responding-to': 'responding to', 'case-of': 'case of', 'head-grip': 'head grip',
    'sound-out': 'sound out', moi: 'MOI', 'whats-bothering': "what's bothering", 'chest-rise-fall': 'chest rise & fall', spo2: 'SpO2',
    'mask-flow': 'oxygen', 'maintain-titrate': 'oxygen', 'rbs-regions': 'RBS', 'pocket-check': 'pocket check', ecg: 'ECG',
    'unstable-signs': 'unstable due to', sracie: 'SRACIE',
    // Task 1 review carry: each says which point it is when shown without its step
    'reassess-5': 'reassess every 5 mins', gloves: 'glove check' };
  const shorts = Object.fromEntries(steps().flatMap(s => s.mustHit).map(m => [m.id, m.short]));
  expect(Object.fromEntries(Object.keys(SHORTS).map(id => [id, shorts[id]]))).toEqual(SHORTS);
});
// The vital-signs guidance: severity is of the chief complaint (e.g. giddiness), not always "pain".
test('severity is asked of the chief complaint, not only pain', () => {
  expect(point('vital-signs', 'severity').short).toBe('severity 1–10');
  const h = cases[1];
  expect(h.patient.lines.severity).toBe('Giddy ah? 6... maybe 7.');
  expect(h.findings.vitals.severity).toBe('6 to 7');
});
// Order flags and the Today strip show a short without its step, so each must name one point. The plan gives both oxygen
// choices (steps 10 and 15) the same "oxygen" on purpose.
test('each short names one point, except the two oxygen choices', () => {
  const all = steps().flatMap(s => s.mustHit.map(m => m.short));
  expect(all.filter((x, i) => all.indexOf(x) !== i)).toEqual(['oxygen']);
  expect(steps().flatMap(s => s.mustHit.filter(m => m.short === 'oxygen').map(m => m.id))).toEqual(['mask-flow', 'maintain-titrate']);
});
test('the BP arm, age, IC and ETA come from the case', () => {
  expect(steps().find(s => s.id === 'investigation')!.canonicalLine).toContain('Taking the BP on the {bpArm} arm.');
  // final review I2: the BP said on the arm, with or without "arm" ("BP on her left"); Plan 3 T2 (D23): "on …" right
  // after "BP", an arm word beside "BP" anywhere, or alone only on step 13 itself (local), and the arm is a check. The
  // keyword grader reads the point through its check alone (grader.ts checkAt, fix round 1's ruling); these terms serve
  // its place in the sentence, a tapped hit's sentence (run.ts saidIn) and any grader that reads terms.
  const on = ['on the {bparm}', 'on her {bparm}', 'on his {bparm}', 'on {bparm}'];
  expect(point('investigation', 'bp-arm')).toMatchObject({
    match: [...['bp', 'blood pressure'].flatMap(bp => on.map(o => [`${bp} ${o}`])), ['bp', '{bparm} arm'], ['blood pressure', '{bparm} arm']],
    local: [['{bparm} arm']],
    check: 'arm',
  });
  // final review I3: the glued forms of a phone keyboard ("72yo", "72y/o", "72yrs"; "ETA 9mins", "ETA 9m")
  expect(partMatch('notification', 'sracie', 'age')).toEqual([['{age}'], ['{age}yo'], ['{age}y'], ['{age}yr'], ['{decade}']]);
  expect(partMatch('notification', 'sracie', 'ic-no')).toEqual([['{ic}']]);
  expect(partMatch('notification', 'sracie', 'eta')).toEqual([['eta', '{eta}'], ['eta', '{eta}min'], ['eta', '{eta}m'],
    ['estimated time', '{eta}'], ['estimated time', '{eta}min'], ['estimated time', '{eta}m']]);
  expect(stepsDoc.contentVersion).toBe('2026-11-15.4');
});
// Final review I3 and residual N2: "F" and "M" are a sex only right before a race word, as the SRACIE runs them
// ("F/Chinese/72", "F / Chinese", "F, Chinese", "F Chinese"), so a lone letter ("6 m,", "2 m/", "f/u") never is; every
// other sex term is a whole word. {raceword} holds the four race words the race part reads. Plan 3 Task 1: or right
// after one, race first ("Chinese/F/72", "Malay, M, 58"), in the same five forms, where the letter must end a word
// (termAt, review round 1), so "Malay, mid-50s" is no sex.
test('the sex part takes F and M only right before or right after a race word', () => {
  const letter = (x: string) => [`${x}/{raceword}`, `${x} / {raceword}`, `${x}, {raceword}`, `${x},{raceword}`, `${x} {raceword}`].map(t => [t]);
  const after = (x: string) => [`{raceword}/${x}`, `{raceword} / ${x}`, `{raceword}, ${x}`, `{raceword},${x}`, `{raceword} ${x}`].map(t => [t]);
  expect(partMatch('notification', 'sracie', 'sex')).toEqual([['male'], ['female'], ['sex'], ['man'], ['woman'], ...letter('f'), ...letter('m'),
    ...after('f'), ...after('m')]);
  expect(caseSlots(cases[0], 6).raceword).toEqual(['chinese', 'malay', 'indian', 'eurasian']);
  expect(partMatch('notification', 'sracie', 'race').slice(1)).toEqual(caseSlots(cases[0], 6).raceword.map(w => [w]));
});
// Final review I1 and residual N1: the score is a total beside "GCS" (the {gcstotal} slot, 3 to 15; "GCS 15", "GCS15",
// "GCS:15"), "{n}/15", "out of 15", "total", "=" in a GCS sentence, or "score" beside "GCS" or an E, V or M figure ("GCS
// E4 V5 M6, score 15", "E4 V5 M6, score 15"); a bare "score" is no GCS ("Pain score?"). Plan 3 Task 1 (D24): "score"
// right before a total of 11 to 15 ({gcsscore}) is, as no 1-to-10 pain score reaches it ("GCS done. Score 15."). Residual
// N3: an E, V or M figure ({gcse} e1–e4, {gcsv} v1–v5, {gcsm} m1–m6) credits its own part only beside "GCS" or a sibling.
test('the GCS score needs a total, or "score" beside "GCS" or a figure; each figure needs "GCS" or a sibling', () => {
  expect(partMatch('vital-signs', 'gcs', 'score')).toEqual([['gcs', 'score'], ['{gcse}', 'score'], ['{gcsv}', 'score'], ['{gcsm}', 'score'],
    ['total'], ['gcs is'], ['/15'], ['out of 15'],
    ['gcs {gcstotal}'], ['gcs{gcstotal}'], ['gcs of {gcstotal}'], ['gcs: {gcstotal}'], ['gcs:{gcstotal}'], ['gcs', '='], ['score {gcsscore}']]);
  expect(partMatch('vital-signs', 'gcs', 'eyes').slice(-3)).toEqual([['gcs', '{gcse}'], ['{gcse}', '{gcsv}'], ['{gcse}', '{gcsm}']]);
  expect(partMatch('vital-signs', 'gcs', 'verbal').slice(-3)).toEqual([['gcs', '{gcsv}'], ['{gcse}', '{gcsv}'], ['{gcsv}', '{gcsm}']]);
  expect(partMatch('vital-signs', 'gcs', 'motor').slice(-3)).toEqual([['gcs', '{gcsm}'], ['{gcse}', '{gcsm}'], ['{gcsv}', '{gcsm}']]);
  // no figure stands alone in any part
  for (const id of ['eyes', 'verbal', 'motor', 'score']) for (const alt of partMatch('vital-signs', 'gcs', id))
    expect(alt.length === 1 && /^\{gcs[evm]\}$|^[evm][1-6]$/.test(alt[0]!), `${id}: ${alt}`).toBe(false);
  const figures = (letter: string, most: number) => Array.from({ length: most }, (_, i) => `${letter}${i + 1}`);
  const slots = caseSlots(cases[0], 6);
  expect([slots.gcse, slots.gcsv, slots.gcsm]).toEqual([figures('e', 4), figures('v', 5), figures('m', 6)]);
  expect(slots.gcstotal).toEqual(['3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15']);
});
// Final review I3: normalizeLine turns the SMS words ur, u, pt and w/ (w/o) into your, you, patient and with (without),
// so a term holding one as a word would never match.
test('no match term holds a word normalizeLine expands: u, ur, pt, w/ or w/o', () => {
  const SMS = /(?<![a-z0-9])(?:u|ur|pt|w\/o?)(?![a-z0-9])/;
  for (const s of steps()) for (const m of s.mustHit) {
    const terms = [...m.match, ...(m.local ?? []), ...(m.accept ?? []).flatMap(a => a.match), ...(m.parts ?? []).flatMap(p => p.match)].flat();
    for (const t of [...terms, ...(m.negatives ?? []), ...(m.requiredWords ?? [])]) expect(t, `${s.id}/${m.id}`).not.toMatch(SMS);
  }
});
// Final review I2: the BP goes on either arm unless the patient rules one out, which only bleed (his right forearm is cut)
// and CCF (her left arm has the fistula) do; each says which arm in her or his own screening answer.
test('exactly bleed and CCF restrict the BP arm, each to the arm its patient offers', () => {
  expect(cases.filter(c => c.findings.investigation.bpArmRestricted === true).map(c => c.id)).toEqual(['ccf-jurong-01', 'bleed-woodlands-01']);
  for (const c of cases) {
    const { bpArm, bpArmRestricted } = c.findings.investigation;
    expect(/\barm\b/i.test(c.patient.lines.bpScreen), c.id).toBe(bpArmRestricted === true);
    if (bpArmRestricted === true) expect(c.patient.lines.bpScreen.toLowerCase(), c.id).toContain(`${bpArm} arm`);
    expect(caseSlots(c, 6).bparm, c.id).toEqual(bpArmRestricted === true ? [bpArm] : [bpArm, bpArm === 'left' ? 'right' : 'left']);
  }
});
test('ids are unique, conditions valid and match terms lowercase', () => {
  for (const s of steps()) {
    const ids = s.mustHit.map(m => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of s.mustHit) {
      if (m.when) expect(CONDITIONS).toContain(m.when);
      for (const alt of [...m.match, ...(m.parts ?? []).flatMap(p => p.match)]) for (const t of alt) expect(t).toBe(t.toLowerCase());
    }
  }
});
const partMatch = (stepId: string, id: string, partId: string) => point(stepId, id).parts!.find(p => p.id === partId)!.match;

// Tap mode plays the canonical line, filled for the case, on its own step, where `local` terms apply (ruling T06a), so
// it must hit every point the step grades in the case, and every part of it, through the real matcher (ruling P15). The
// phrase tests that stood here are paraphrase fixtures now (Task 6). Task 11b: the case's conditional points too, which
// each case's line now says ({say:<pointId>}); tele-CPR stays out, as the caller's answer decides it (no case is
// unconscious, so it never applies).
test('each canonical line, filled for each case, hits every point that applies to the case and all its parts', () => {
  for (const c of cases) for (const s of steps()) {
    const line = normalizeLine(fillCanonical(s.canonicalLine, c, 6, s.mustHit));
    for (const m of s.mustHit) {
      if (m.when && !conditionHolds(c, m.when)) continue;
      const alts = [...m.match, ...(m.local ?? []), ...(m.accept ?? []).flatMap(a => a.match)];
      if (m.match.length > 0) expect(matchAt(line, alts, caseSlots(c, 6)), `${c.id} ${s.id} ${m.id}`).toBeGreaterThanOrEqual(0);
      for (const p of m.parts ?? []) expect(matchAt(line, p.match, caseSlots(c, 6)), `${c.id} ${m.id}.${p.id}`).toBeGreaterThanOrEqual(0);
    }
  }
});
// Task 8 fix round 1 (Minor 3): at one minute the SRACIE says "ETA 1 min.", and every line still reads all its points.
test('at an ETA of 1 min, each filled canonical line still hits every point that applies and all its parts', () => {
  for (const c of cases) for (const s of steps()) {
    const line = normalizeLine(fillCanonical(s.canonicalLine, c, 1, s.mustHit));
    for (const m of s.mustHit.filter(x => !x.when || conditionHolds(c, x.when))) {
      const alts = [...m.match, ...(m.local ?? []), ...(m.accept ?? []).flatMap(a => a.match)];
      if (m.match.length > 0) expect(matchAt(line, alts, caseSlots(c, 1)), `${c.id} ${s.id} ${m.id}`).toBeGreaterThanOrEqual(0);
      for (const p of m.parts ?? []) expect(matchAt(line, p.match, caseSlots(c, 1)), `${c.id} ${m.id}.${p.id}`).toBeGreaterThanOrEqual(0);
    }
  }
});

// ---- Task 11b: the conditional points' own words ----------------------------------------------------------------------

/** The conditional points that carry a say, by step (the 11b ruling); tele-CPR stays out, as the caller's answer decides it. */
const SAYING = { preparation: ['extra-ppe'], 'approach-patient': ['bleeding-control'], 'delicate-spine': ['release-grip', 'c-collar'],
  airway: ['head-tilt-chin-lift', 'jaw-thrust'], breathing: ['monitor-closely'],
  'rapid-body-survey': ['distal-pulse', 'immobilise', 'c-collar-after-rbs'], investigation: ['suspected-hypo'] };
test('the 11 conditional points of the ruling, and only they, carry a say, each with its placeholder in its own step', () => {
  const saying = Object.fromEntries(steps().map(s => [s.id, s.mustHit.filter(m => m.say !== undefined).map(m => m.id)] as const)
    .filter(([, ids]) => ids.length > 0));
  expect(saying).toEqual(SAYING);
  expect(point('call-caller', 'tele-cpr').say).toBeUndefined();
  for (const s of steps()) for (const m of s.mustHit.filter(x => x.say !== undefined))
    expect(s.canonicalLine.split(`{say:${m.id}}`), `${s.id}/${m.id}`).toHaveLength(2);
});
const textOf = (blocks: Block[]): string => blocks.map(b => {
  switch (b.k) {
    case 'h': return b.text;
    case 'p': return b.runs.map(r => r.t).join('');
    case 'list': return b.items.map(i => i.runs.map(r => r.t).join('')).join('\n');
    case 'table': return b.rows.flatMap(r => r.cells.map(textOf)).join('\n');
    case 'box': return textOf(b.blocks);
    case 'img': return '';
  }
}).join('\n');
// Ruling: notes s01 is the wording authority. Each say keeps the notes' words for its action, verbatim where the notes
// give the sentence to say ("No suspected spinal injuries, buddy remove head grip.", "I will monitor the patient closely
// after giving oxygen.").
test("each say keeps notes s01's words for its action", () => {
  const s01 = textOf(v.parse(NotesDocSchema, notes).sections.find(s => s.id === 's01')!.blocks).toLowerCase();
  const WORDS: Record<string, string[]> = {
    'extra-ppe': ['rta vests, helmets, raincoat', 'ppe gowns', 'for precautions'],
    'bleeding-control': ['expose and examine', 'arrest the bleeding first', 'direct pressure followed by secondary pressure dressing',
      'if still bleeding', 'apply c.a.t.'],
    'release-grip': ['no suspected spinal injuries, buddy remove head grip.'],
    'c-collar': ['establish neutral position, measure & apply c-collar'],
    'head-tilt-chin-lift': ['head tilt, chin lift'],
    'jaw-thrust': ['modified jaw thrust'],
    'monitor-closely': ['i will monitor the patient closely after giving oxygen.'],
    'distal-pulse': ['distal pulses of injured limbs'],
    immobilise: ['immobili'],
    'c-collar-after-rbs': ['establish neutral position, measure & apply c-collar'],
    'suspected-hypo': ['below 4', 'hypoglyc'],
  };
  for (const s of steps()) for (const m of s.mustHit.filter(x => x.say !== undefined)) {
    expect(WORDS[m.id], m.id).toBeDefined();
    for (const w of WORDS[m.id]!) {
      expect(s01, `notes s01: ${w}`).toContain(w);
      expect(m.say!.toLowerCase(), `${m.id}: ${w}`).toContain(w);
    }
  }
});
// Tap mode cuts its line, and sendLine a typed one, at RUN_LIMITS.lineChars, so a canonical line longer than that would
// lose its last sentences (step 12's pocket check, for one) in the case with the most to say.
test('every canonical line, filled for each case at any ETA, fits in one line', () => {
  for (const c of cases) for (const s of steps()) for (const eta of [1, 6, 20]) {
    expect(fillCanonical(s.canonicalLine, c, eta, s.mustHit).length, `${c.id} ${s.id}`).toBeLessThanOrEqual(RUN_LIMITS.lineChars);
  }
});

// Every case file, keyed as the index names it ('cases/copd-amk-01.json'). The glob would also match index.json, which
// is not a case, so it is left out (ruling T03).
const CASE_FILES: Record<string, unknown> = Object.fromEntries(
  Object.entries(import.meta.glob(['../../public/data/cases/*.json', '!../../public/data/cases/index.json'], { eager: true, import: 'default' }))
    .map(([path, data]) => [`cases/${path.split('/').pop()}`, data]),
);
// The cases in index order: COPD and hypo first, so `const [c, h] = cases` names them (a tuple type, not `| undefined`).
const cases = v.parse(CaseIndexSchema, caseIndex).cases.map(e => v.parse(CaseSchema, CASE_FILES[e.file])) as [Case, Case, ...Case[]];
const byId = Object.fromEntries(cases.map(c => [c.id, c]));

const ALL = ['copd-amk-01', 'hypo-hougang-01', 'chestpain-bedok-01', 'ccf-jurong-01', 'asthma-tampines-01',
  'bleed-woodlands-01', 'fall-yishun-01', 'rta-toapayoh-01', 'ams-sengkang-01', 'toothache-clementi-01', 'legbleed-punggol-01'];
/** The eight cases of Plans 1 and 2, which Plan 3's plan conditions must grade exactly as before. */
const PLAN2 = ALL.slice(0, 8);
test('the index lists all 11 cases, and every case file is in it', () => {
  expect(v.parse(CaseIndexSchema, caseIndex).cases.map(c => c.id)).toEqual(ALL);
  expect(Object.keys(CASE_FILES).length).toBe(11);
});
test('the protocols the spec names each have a case', () => {
  expect(byId['chestpain-bedok-01']!.expected.ecg).toBe('12-lead');
  expect(byId['chestpain-bedok-01']!.findings.position.ideal).toBe(false);
  expect(byId['ccf-jurong-01']!.findings.investigation.bpArm).toBe('right');
  expect([byId['ccf-jurong-01']!.findings.rbs.jvd, byId['ccf-jurong-01']!.findings.rbs.pedalEdema]).toEqual([true, true]);
  expect(byId['ccf-jurong-01']!.patient.lines.bpScreen.toLowerCase()).toContain('fistula');
  expect(byId['asthma-tampines-01']!.flags).toContain('asthmaCopd');
  expect(byId['bleed-woodlands-01']!.findings.approach.catastrophicBleeding).toBe(true);
  expect(conditionHolds(byId['fall-yishun-01']!, 'spinal')).toBe(true);
  expect(byId['rta-toapayoh-01']!.flags).toEqual(['rta', 'extraPpe', 'limbInjury', 'spinalAfterRbs']);
  for (const id of ['bleed-woodlands-01', 'fall-yishun-01', 'rta-toapayoh-01']) {
    expect(byId[id]!.type, id).toBe('trauma');
    expect(byId[id]!.expected.decision.plan, id).toBe('load-and-go');
    expect(byId[id]!.expected.oxygen, id).toEqual({ device: 'non-rebreather', flowMin: 10, flowMax: 15 });
  }
  for (const c of cases) {
    expect(c.findings.loc.avpu, c.id).toBe('A');                         // all conscious (spec §11)
    expect(c.vitals.afterO2.spo2, c.id).toBeGreaterThan(c.vitals.roomAir.spo2);
    expect(c.expected.oxygen.device, c.id).not.toBe('bvm');
  }
});
// The six new cases keep their brief's values (Plan 2 Task 3), and the controller's CCF ECG ruling.
test('the six new cases keep their brief values', () => {
  const pick = (id: string) => {
    const c = byId[id]!;
    return [c.callText, c.patient.ic, c.patient.callName, c.vitals.roomAir.spo2, c.vitals.afterO2.spo2, c.findings.investigation.ecg.type,
      c.findings.investigation.hypocount, c.findings.vitals.severity, c.expected.decision.suspected, c.expected.decision.signs, c.notesRef];
  };
  expect(pick('chestpain-bedok-01')).toEqual(['Middle-aged male, chest pain', 'S68xxxxxD', 'Encik Ahmad', 93, 98, '12-lead', 6.2, '8', 'AMI',
    ['low SpO2', 'high HR', 'ST elevation'], 's05#6-chest-pain-stay-treat']);
  expect(pick('ccf-jurong-01')).toEqual(['Elderly female, breathlessness', 'S50xxxxxC', 'Mdm Kamala', 88, 94, '12-lead', 7.4, '7', 'CCF',
    ['low SpO2', 'high RR', 'high BP'], 's05#5-congestive-cardiac-failure-ccf-stay-treat']);
  expect(pick('asthma-tampines-01')).toEqual(['Young female, breathlessness', 'T02xxxxxH', 'Ms Goh', 91, 96, '12-lead', 5.6, '7', 'asthma',
    ['low SpO2', 'high RR', 'high HR'], 's05#4-asthma-copd-in-respiratory-distress-stay-treat']);
  expect(pick('bleed-woodlands-01')).toEqual(['Adult male, deep cut, heavy bleeding', 'S81xxxxxF', 'Mr Suresh', 94, 99, '4-lead', 5.8, '8',
    'arresting haemorrhage', ['low BP', 'high HR'], 's05#2-arresting-haemorrhage-load-go']);
  expect(pick('fall-yishun-01')).toEqual(['Elderly male, fall from ladder', 'S59xxxxxJ', 'Mr Ong', 96, 99, '4-lead', 6.4, '7', 'spinal injury',
    ['neck tenderness', 'high HR'], 's01#delicate-spine']);
  expect(pick('rta-toapayoh-01')).toEqual(['Motorcyclist down after a collision with a car', 'S95xxxxxK', 'Encik Faizal', 95, 99, '4-lead', 6,
    '9', 'fracture of the right leg', ['leg deformity', 'high HR'], 's01#immobilization']);
  for (const id of ['chestpain-bedok-01', 'ccf-jurong-01'])
    expect(byId[id]!.expected, id).toEqual(expect.objectContaining({ oxygen: { device: 'non-rebreather', flowMin: 10, flowMax: 15 } }));
  for (const id of ['chestpain-bedok-01', 'ccf-jurong-01', 'asthma-tampines-01'])
    expect(byId[id]!.expected.decision.plan, id).toBe('stay-and-treat');
  // Pre-review fixes: no finding contradicts another (one GTN spray, on the side table; dry skin, dry gloves)
  expect(byId['chestpain-bedok-01']!.findings.rbs.pockets).toEqual(['IC']);
  expect(byId['chestpain-bedok-01']!.findings.scene.hazards).toEqual(['GTN spray on the side table beside the patient']);
  expect([byId['fall-yishun-01']!.findings.rbs.gloves, byId['fall-yishun-01']!.vitals.roomAir.skin]).toEqual(['No blood or sweat', 'warm, dry']);
  // Ruling: a CCF case shows no ST elevation (an anterior STEMI is outside its expected signs)
  expect(byId['ccf-jurong-01']!.findings.investigation.ecg.reading).toBe('Sinus tachycardia about 116, no ST elevation');
  expect(byId['chestpain-bedok-01']!.findings.investigation.ecg.reading).toBe('Sinus tachycardia about 104, ST elevation in II, III and aVF');
  expect(byId['bleed-woodlands-01']!.findings.approach).toEqual({ catastrophicBleeding: true,
    bleeding: 'Yes: heavy bleeding from a deep cut on the right forearm, soaking through the towel.',
    control: { pressure: 'Still bleeding.', dressing: 'Blood soaking through the dressing.', cat: 'Bleeding has stopped.' } });
  // Plan 3 T3 (D22): `where` is what step 12's immobilise say names ({limbWhere}); "right lower leg" would take the RTA's
  // step 12 line past RUN_LIMITS.lineChars
  expect(byId['rta-toapayoh-01']!.findings.rbs.limb).toEqual({ injury: 'Right lower leg, deformed and swollen', where: 'right leg',
    distalPulse: 'Distal pulse present in the right foot.', immobilise: 'Buddy splints the right leg as instructed.' });
  expect(byId['fall-yishun-01']!.findings.spine).toEqual({ fall: 'Yes, from the ladder', hitHead: 'Yes, the back of my head',
    dtbl: 'Tenderness at the back of the neck; no deformities, bruises or lacerations', neckPain: true });
  // the BP goes on the arm the patient can spare: the CCF patient's left arm has her fistula, the bleed patient's right forearm is cut
  expect(['ccf-jurong-01', 'bleed-woodlands-01'].map(id => byId[id]!.findings.investigation.bpArm)).toEqual(['right', 'left']);
  // the bleed's "low BP" is a systolic under 90 (notes 15: normal 90 – 120), still over 80 as his radial pulse is present
  // (notes 1, Circulation: radial > 80)
  const bleed = byId['bleed-woodlands-01']!;
  const bps = [bleed.findings.investigation.bp, bleed.vitals.roomAir.bp, bleed.vitals.afterO2.bp];
  expect(bps).toEqual(['88/56 mmHg', '86/54', '86/54']);
  for (const bp of bps) expect(Number(bp.split('/')[0]), bp).toBeGreaterThan(80);
  for (const bp of bps) expect(Number(bp.split('/')[0]), bp).toBeLessThan(90);
  expect(bleed.findings.circulation.pulse).toMatch(/^Radial pulse present/);
  // Run start groups the cases by complaint, in index order (Plan 3 T3: the leg bleed joins Bleeding)
  expect([...new Set(v.parse(CaseIndexSchema, caseIndex).cases.map(e => e.complaint))])
    .toEqual(['Breathlessness', 'Giddiness', 'Chest pain', 'Bleeding', 'Fall', 'Road accident', 'Confusion', 'Toothache']);
});
// Plan 3 Task 3 (D21): the three new cases keep their brief's values. Every clinical fact is from the trainee's notes:
// AMS from s05 #1, s15 (hypocount 4–10 normal) and s11 (SpO2 over 95%: nasal cannula optional); the toothache AMI from
// s17 (the Real case; Managing Chest Pain: high-flow O2, never withhold O2, transport early unless on the chest pain
// protocol), s05 #6 (the protocol needs GTN, which he isn't on) and s01 (12-lead for pain of cardiac origin); the leg
// bleed from s05 #2, s01 (Approach, Immobilization, Position: supine for low BP) and s11 (all trauma gets high-flow O2).
test('the three Plan 3 cases keep their plan values', () => {
  const pick = (id: string) => {
    const c = byId[id]!;
    return [c.type, c.complaint, c.area, c.callText, c.location, c.patient.name, c.patient.ic, c.patient.callName, c.patient.age,
      c.vitals.roomAir.spo2, c.vitals.afterO2.spo2, c.findings.investigation.ecg.type, c.findings.investigation.hypocount,
      c.findings.vitals.severity, c.expected.decision.suspected, c.expected.decision.signs, c.notesRef];
  };
  expect(pick('ams-sengkang-01')).toEqual(['medical', 'Confusion', 'Sengkang', 'Elderly female, confused since this morning',
    'Blk 2xx Compassvale St, #08-xx', 'Siti binte Hassan', 'S47xxxxxE', 'Mdm Siti', 79, 96, 97, '4-lead', 6.1, '3',
    'altered mental state', ['low GCS', 'high HR', 'high RR'], 's05#1-altered-mental-state-load-go']);
  expect(pick('toothache-clementi-01')).toEqual(['medical', 'Toothache', 'Clementi', 'Elderly male, toothache and cold sweat',
    'Blk 3xx Clementi Ave 2, #06-xx', 'Koh Ah Seng', 'S63xxxxxG', 'Mr Koh', 63, 94, 98, '12-lead', 5.9, '7', 'AMI',
    ['low SpO2', 'high HR', 'ST elevation'], 's17#acute-myocardial-infarction-ami']);
  expect(pick('legbleed-punggol-01')).toEqual(['trauma', 'Bleeding', 'Punggol', 'Adult male, fall with a deep leg wound, heavy bleeding',
    'Blk 6xx Punggol Field, void deck', 'Lee Wei Jie', 'S88xxxxxH', 'Mr Lee', 38, 95, 99, '4-lead', 6.2, '9', 'arresting haemorrhage',
    ['low BP', 'high HR'], 's05#2-arresting-haemorrhage-load-go']);
  for (const id of ['ams-sengkang-01', 'toothache-clementi-01', 'legbleed-punggol-01']) expect(byId[id]!.expected.decision.plan, id).toBe('load-and-go');

  // AMS: confused (GCS V4, notes 3), a normal hypocount (notes 15: 4 – 10), SpO2 over 95% (notes 11: cannula optional)
  const ams = byId['ams-sengkang-01']!;
  expect(ams.findings.vitals.gcs).toEqual({ e: 4, v: 4, m: 6 });
  expect(ams.expected.oxygen).toEqual({ device: 'nasal-cannula', flowMin: 2, flowMax: 4, optional: true });
  expect(ams.expected.ecg).toBe('4-lead');
  expect(ams.findings.history).toEqual({ asthmaCopd: 'No asthma or COPD', other: 'High BP' });
  expect([ams.findings.investigation.bp, ams.findings.investigation.bpArm, ams.vitals.roomAir.bp]).toEqual(['176/98 mmHg', 'left', '174/96']);
  expect(ams.findings.loc).toEqual({ avpu: 'A', response: 'Yes, I can hear you... who are you ah?' });
  expect(ams.findings.position).toEqual({ choice: 'Sitting on the bed', ideal: true });
  expect(ams.flags).toEqual([]);

  // the toothache AMI: not on GTN, so not the chest pain protocol (notes 5, protocol 6); high-flow O2 (notes 17)
  const tooth = byId['toothache-clementi-01']!;
  expect(tooth.expected.ecg).toBe('12-lead');
  expect(tooth.findings.history).toEqual({ asthmaCopd: 'No asthma or COPD', other: 'High cholesterol' });
  expect(tooth.findings.investigation.ecg.reading).toBe('Sinus tachycardia about 104, ST elevation in V2 to V4');
  expect(tooth.patient.chiefComplaint).toBe('My tooth very pain, here at the jaw. Now my left arm also pain.');
  expect(tooth.expected.oxygen).toEqual({ device: 'non-rebreather', flowMin: 10, flowMax: 15,
    note: 'A chest pain patient gets high-flow oxygen: a non-rebreather at 10 to 15 L/min. Never withhold oxygen (notes 17).' });
  expect(tooth.findings.scene.hazards).toEqual(['hot tea on the table beside the patient']);
  expect(tooth.findings.airway.smell).toBe('No unusual breath smell');   // no GTN taken
  expect(tooth.flags).toEqual([]);

  // the leg bleed: catastrophic bleeding and a limb injury together, after a 2 m fall with no neck pain (no spinal flag,
  // so the noSpinal points apply); "low BP" a systolic under 90 (notes 15), still over 80 with his radial pulse (notes 1)
  const leg = byId['legbleed-punggol-01']!;
  expect(leg.findings.approach).toEqual({ catastrophicBleeding: true, bleeding: 'Yes: heavy bleeding from a deep cut on the left lower leg.',
    control: { pressure: 'Still bleeding.', dressing: 'Blood soaking through the dressing.', cat: 'Bleeding has stopped.' } });
  expect(leg.flags).toEqual(['limbInjury']);
  expect(leg.findings.rbs.limb).toEqual({ injury: 'Left lower leg, deformed, with a deep cut', where: 'left leg',
    distalPulse: 'Distal pulse present in the left foot.', immobilise: 'Buddy splints the left leg as instructed.' });
  expect(leg.findings.spine).toMatchObject({ fall: 'Yes, from the platform', hitHead: 'No', neckPain: false });
  expect([conditionHolds(leg, 'spinal'), conditionHolds(leg, 'noSpinal')]).toEqual([false, true]);
  const bps = [leg.findings.investigation.bp, leg.vitals.roomAir.bp, leg.vitals.afterO2.bp];
  expect(bps).toEqual(['86/56 mmHg', '84/54', '84/54']);
  for (const bp of bps) expect(Number(bp.split('/')[0]), bp).toBeLessThan(90);
  for (const bp of bps) expect(Number(bp.split('/')[0]), bp).toBeGreaterThan(80);
  expect(leg.findings.circulation.pulse).toBe('Radial pulse present, fast and weak');
  expect(leg.findings.position).toEqual({ choice: 'Sitting on the floor against the pillar', ideal: false, toward: 'supine' });
  expect(leg.patient.lines.convinced).toBe('OK... I lie down flat.');
  expect(leg.expected.oxygen).toEqual({ device: 'non-rebreather', flowMin: 10, flowMax: 15 });
  expect(leg.caller.answers.criticalInjuries).toBe('His leg got a big cut, the blood keep coming out, and the leg look bent.');
});
// Plan 3 Task 3 (D21, pre-flight finding 7): step 18's Stay & Treat and Load & Go read the case's own plan
// (expected.decision.plan), so a medical Load & Go (AMS, the toothache AMI) grades right. In the eight Plan 2 cases the
// plan conditions hold exactly where medical and trauma did, so nothing they grade moves.
test("step 18's plan points read the case's plan: as medical and trauma did in the eight Plan 2 cases, and never both", () => {
  expect(point('decision-point', 'stay-and-treat').when).toBe('stayAndTreat');
  expect(point('decision-point', 'load-and-go').when).toBe('loadAndGo');
  // Task 3 review round 1 (I1): the labels name the plan, not the case type, so a medical Load & Go never reads "Trauma:"
  // in the debrief, the Coached nudge or Today's headline
  expect(point('decision-point', 'stay-and-treat').label).toBe('Stay & Treat: "I will Stay & Treat to see whether I can initiate any protocols"');
  expect(point('decision-point', 'load-and-go').label).toBe('Load & Go: "It is a Load & Go case"');
  expect(cases.filter(c => PLAN2.includes(c.id)).map(c => c.id)).toEqual(PLAN2);
  for (const c of cases.filter(x => PLAN2.includes(x.id))) {
    expect(conditionHolds(c, 'stayAndTreat'), c.id).toBe(conditionHolds(c, 'medical'));
    expect(conditionHolds(c, 'loadAndGo'), c.id).toBe(conditionHolds(c, 'trauma'));
  }
  for (const c of cases) {
    const held = [conditionHolds(c, 'stayAndTreat'), conditionHolds(c, 'loadAndGo')];
    expect(held, c.id).not.toEqual([true, true]);
    expect(held, c.id).toEqual([c.expected.decision.plan === 'stay-and-treat', c.expected.decision.plan === 'load-and-go']);
  }
  expect(cases.filter(c => c.type === 'medical' && conditionHolds(c, 'loadAndGo')).map(c => c.id)).toEqual(['ams-sengkang-01', 'toothache-clementi-01']);
});
// The nine cases after Plan 1's two (COPD and hypo) show none of four signs of impending respiratory failure from notes
// 5 and 11: broken speech, poor air entry, RR under 10 or over 30, or cyanosis. So none needs a BVM. Notes 11's list
// also names "Disorientated / restless", which the AMS patient is (GCS V4), but that is the altered mental state itself,
// with no breathing sign beside it, so the test doesn't check it. Plan 1's COPD case is left out: it does show two
// signs (broken speech, reduced air entry), and its own note test says why exception 1 still isn't met.
test('no new case shows impending respiratory failure: full sentences, equal air entry, RR 10 to 30, no cyanosis', () => {
  const NEW = ALL.slice(2);
  for (const c of cases.filter(x => NEW.includes(x.id))) {
    expect(c.patient.voice, c.id).toMatch(/full sentences/);
    expect(c.findings.investigation.auscultation, c.id).toMatch(/^Air entry equal,/);
    expect(c.vitals.roomAir.rr, c.id).toBeGreaterThanOrEqual(10);
    expect(c.vitals.roomAir.rr, c.id).toBeLessThanOrEqual(30);
    expect(c.findings.breathing.ntucp.some(s => /cyanosis/i.test(s)), c.id).toBe(false);
  }
});
test('brief values are kept', () => {
  const [c, h] = cases;
  expect([c.callText, c.vitals.roomAir.spo2, c.vitals.afterO2.spo2, c.findings.investigation.hypocount, c.findings.investigation.ecg.type])
    .toEqual(['Elderly female, breathlessness', 86, 90, 6.8, '12-lead']);
  expect(c.findings.breathing.ntucp).toEqual(['use of accessory muscles', 'pursed lips']);
  expect(c.expected.decision).toMatchObject({ stable: false, suspected: 'COPD', plan: 'stay-and-treat' });
  expect([h.vitals.roomAir.spo2, h.findings.investigation.hypocount, h.findings.investigation.ecg.type, h.findings.vitals.gcs])
    .toEqual([97, 2.6, '4-lead', { e: 4, v: 4, m: 6 }]);
  expect(h.expected.oxygen).toMatchObject({ device: 'nasal-cannula', optional: true });
  expect([c.patient.name, h.patient.name]).toEqual(['Tan Ah Mui', 'Lim Boon Huat']);
  expect([c.patient.callName, h.patient.callName]).toEqual(['Mdm Tan', 'Mr Lim']);
  expect([c.findings.investigation.bp, h.findings.investigation.bp]).toEqual(['148/88 mmHg', '138/84 mmHg']);
  expect([c.findings.investigation.bpArm, h.findings.investigation.bpArm]).toEqual(['left', 'left']);
  expect(c.patient.lines.bpScreen).toBe('No... no shunt. No operation.');
  expect(h.patient.lines.lungHistory).toBe('No... no asthma.');
  for (const x of cases)
    if (!x.findings.approach.catastrophicBleeding) expect(x.findings.approach.bleeding, x.id).toBe('No catastrophic bleeding.');
});
// User ruling: the COPD case keeps the nasal cannula, and the debrief explains why it is not a BVM (ruling P37).
test('the COPD case says why its oxygen is a nasal cannula, not a BVM', () => {
  const [c, h] = cases;
  expect(c.expected.oxygen).toMatchObject({ device: 'nasal-cannula', flowMin: 2, flowMax: 4 });
  const note = c.expected.oxygen.note ?? '';
  for (const fact of ['BVM', 'RR 28', '30', '90%', 'exception 1', 'exception 3', 'COPD → nasal cannula', '2–4 L/min', '88–92%'])
    expect(note).toContain(fact);
  // the case does show signs from notes 11's list (broken speech, reduced air entry), so the note must not deny them
  for (const sign of ['a few words at a time', 'air entry is reduced']) expect(note).toContain(sign);
  expect(note).not.toMatch(/no signs/i);
  expect(h.expected.oxygen.note).toBeUndefined();
});
// Controller ruling: asthma in respiratory distress takes the salbutamol nebuliser (notes 5, protocol 4), and the
// debrief says why when the trainee picks another device.
test('the asthma case says why its oxygen is the salbutamol nebuliser', () => {
  const a = byId['asthma-tampines-01']!;
  expect(a.expected.oxygen).toMatchObject({ device: 'nebuliser-mask', flowMin: 6, flowMax: 8 });
  const note = a.expected.oxygen.note ?? '';
  for (const fact of ['salbutamol', 'nebuliser mask', '6–8 L/min', '2 ml', 'N/S 0.9%', 'one dose only', 'notes 5, protocol 4',
    "notes 16, Asthma: 'Management: inhaler or nebuliser'", "the 'no history of asthma or COPD' contraindication does not apply",
    'SpO2 is 91%', 'under 95%', 'picked by her condition (notes 11)', 'full sentences', 'air entry is equal', 'RR is 28'])
    expect(note).toContain(fact);
  // notes 11 says only "pick based on condition"; the nebuliser comes from notes 5 and 16, so no sentence citing notes 11
  // names it
  for (const sentence of note.split(/\.\s+/).filter(s => /notes 11/i.test(s))) expect(sentence).not.toMatch(/nebuli/i);
  // the facts the note names are the case's own
  expect(a.vitals.roomAir.spo2).toBe(91);
  expect(a.vitals.roomAir.rr).toBe(28);
  expect(a.findings.investigation.auscultation).toMatch(/^Air entry equal,/);
  expect(a.findings.history.asthmaCopd).toMatch(/asthma/i);
  expect(a.findings.breathing.ntucp.some(s => /cyanosis/i.test(s))).toBe(false);
  // only COPD, asthma and (Plan 3 T3) the toothache AMI carry an oxygen note
  expect(cases.filter(c => c.expected.oxygen.note !== undefined).map(c => c.id)).toEqual(['copd-amk-01', 'asthma-tampines-01', 'toothache-clementi-01']);
});
test('every case is unstable, masked, unreviewed and links to its protocol', () => {
  for (const c of cases) {
    expect(c.expected.decision.signs.length).toBeGreaterThanOrEqual(2);
    expect(c.patient.ic).toMatch(/^[STFG]\d{2}x{5}[A-Z]$/);
    expect(c.reviewed).toBe(false);
    expect(resolveNotesRef(notes as any, c.notesRef)).not.toBeNull();
  }
});
// A reply plays when any of its triggers is read, so its finding must exist in every case where one of them applies.
const appliesTo = (c: Case, s: Step, on: string) => {
  const m = s.mustHit.find(p => p.id === on.split('.')[0]);
  return m !== undefined && (!m.when || conditionHolds(c, m.when));
};
test('every reply names its triggers, and each finding it reads exists where it applies', () => {
  for (const s of steps()) for (const r of s.replies) for (const on of r.on) {
    const [pid, part] = on.split('.');
    const m = s.mustHit.find(p => p.id === pid);
    expect(m, `${s.id} ${on}`).toBeDefined();
    if (part) expect(m!.parts?.map(p => p.id), `${s.id} ${on}`).toContain(part);
  }
  for (const c of cases) for (const s of steps()) for (const r of s.replies)
    if ('finding' in r && r.on.some(on => appliesTo(c, s, on)))
      expect(getFinding(c, r.finding), `${c.id} ${r.finding}`).not.toBeUndefined();
});
test('conditional case content is there exactly when its condition holds', () => {
  for (const c of cases) {
    expect(c.findings.approach.control !== undefined, c.id).toBe(c.findings.approach.catastrophicBleeding);
    expect(c.findings.rbs.limb !== undefined, c.id).toBe(c.flags.includes('limbInjury'));
    expect(c.patient.lines.convinced !== undefined, c.id).toBe(!c.findings.position.ideal);
    expect(c.caller.answers.criticalInjuries !== undefined, c.id).toBe(c.type === 'trauma');
    expect(c.caller.answers.vehicles !== undefined, c.id).toBe(c.flags.includes('rta'));
  }
});
// Plan 2 finds cases through the index, so each entry must name its file and agree with what is in it.
test('each index entry points at its case file and agrees with it', () => {
  const entries = v.parse(CaseIndexSchema, caseIndex).cases;
  expect(entries.map(e => e.file).sort()).toEqual(Object.keys(CASE_FILES).sort());
  for (const e of entries) {
    expect(e.file, e.id).toBe(`cases/${e.id}.json`);
    const c = v.parse(CaseSchema, CASE_FILES[e.file]);
    expect({ id: c.id, type: c.type, complaint: c.complaint, area: c.area }, e.id)
      .toEqual({ id: e.id, type: e.type, complaint: e.complaint, area: e.area });
  }
});
// Plan rule: room air is the after-oxygen reading except SpO2 (the wrong mask or flow falls back to roomAir).
test('room-air vitals equal the after-oxygen vitals except SpO2', () => {
  for (const c of cases) {
    const { spo2: _ra, ...roomAir } = c.vitals.roomAir;
    const { spo2: _o2, ...afterO2 } = c.vitals.afterO2;
    expect(roomAir, c.id).toEqual(afterO2);
  }
});
