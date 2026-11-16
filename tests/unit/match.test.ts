import * as v from 'valibot';
import copd from '../../public/data/cases/copd-amk-01.json';
import { CaseSchema } from '../../src/data/schema';
import { caseSlots, expandTerm, matchAt, normalizeLine, splitSentences, termAt } from '../../src/sim/match';
import { caseById } from './sim-helpers';

const GCS_TOTALS = ['3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'];
const SLOTS = { age: ['72'], decade: ['70s'], ic: ['s54xxxxxa', 's54'], eta: ['5', '6', '7'], bparm: ['left'], posture: [], gcstotal: GCS_TOTALS,
  gcse: ['e1', 'e2', 'e3', 'e4'], gcsv: ['v1', 'v2', 'v3', 'v4', 'v5'], gcsm: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'],
  raceword: ['chinese', 'malay', 'indian', 'eurasian'], gcsscore: ['11', '12', '13', '14', '15'] };

test('normalizeLine folds case, quotes, dashes, ampersands, spaces and number ranges', () => {
  expect(normalizeLine('  Ma’am,  “Suspected”  –  points 1-6  ')).toBe(`ma'am, "suspected" - points 1 to 6`);
  expect(normalizeLine('SpO2 & PR')).toBe('spo2 and pr');
  expect(normalizeLine('NRM 10-15 L/min, 4-in-1')).toBe('nrm 10 to 15 l/min, 4-in-1');
});
// Final review I3: the SMS words a phone keyboard gives, as whole words only, never inside a token.
test('normalizeLine expands ur, u, pt, w/ and w/o as whole words, and nowhere else', () => {
  expect(normalizeLine("Pls don't move ur head")).toBe("pls don't move your head");
  expect(normalizeLine('Can U hear me? u ok?')).toBe('can you hear me? you ok?');
  expect(normalizeLine("Pt is alert, pt's IC")).toBe("patient is alert, patient's ic");
  expect(normalizeLine('Uncle, u still w/ me? w/me, W/O pain, w/O2')).toBe('uncle, you still with me? with me, without pain, with o2');
  expect(normalizeLine('u/ur/pt.')).toBe('you/your/patient.');
  // inside a token, never: these keep their letters
  for (const word of ['you', 'your', 'uncle', 'menu', 'urine', 'hurt', 'pts', 'apt', 'opt', 'ptosis', 'spo2', 'avpu', 'kw/h'])
    expect(normalizeLine(word), word).toBe(word);
});
// Final review I1: glued E/V/M notation, spaced out so each figure is a word ("E4V5M6" → "e4 v5 m6").
// Residual ride-along: "GCS:15" is read by a match term, so a colon is never touched ("3:00" stays a time).
test('normalizeLine leaves colons alone', () => {
  expect(normalizeLine('RBS at 3:00, GCS:15, GCS: 14')).toBe('rbs at 3:00, gcs:15, gcs: 14');
});
test('normalizeLine spaces out glued E/V/M notation, and only that', () => {
  expect(normalizeLine('GCS E4V5M6 = 15')).toBe('gcs e4 v5 m6 = 15');
  expect(normalizeLine('e4v4m6, E3 V4M5')).toBe('e4 v4 m6, e3 v4 m5');
  for (const text of ['e4 v5 m6', 'e5v5m6', 'e4v5m7', 'ae4v5m6', 'e4v5m66', 'v5m6e4']) expect(normalizeLine(text), text).toBe(text);
});
test('terms match at word starts, so stems work and inner letters never do', () => {
  expect(termAt('any deformities?', 'deformit')).toBe(4);
  expect(termAt('medication', 'ic')).toBe(-1);
  expect(termAt('ic no. s54xxxxxa', 'ic')).toBe(0);
  expect(termAt('every 15 mins', '5 min')).toBe(-1);
  expect(termAt('every 5 mins', '5 min')).toBe(6);
});
test('terms of 3 characters or fewer match whole words only', () => {
  expect(termAt('blood pressure', 'pr')).toBe(-1);
  expect(termAt('pr 112, bp 146/86', 'pr')).toBe(0);
  expect(termAt('raise both arms', 'arm')).toBe(-1);
  expect(termAt('gcs is 15/15', '/15')).toBe(9);
});
test('an alternative needs all its terms; negatives veto the match', () => {
  expect(matchAt('remove the head grip', [['remove', 'grip']], null)).toBe(0);
  expect(matchAt('grip the head', [['remove', 'grip']], null)).toBe(-1);
  expect(matchAt('no suspected spinal injuries', [['suspect']], null, ['no suspected'])).toBe(-1);
  expect(matchAt('hello there', [['bye'], ['hell']], null)).toBe(0);
});
test('slot terms expand from the case', () => {
  expect(expandTerm('{age}', SLOTS)).toEqual(['72']);
  expect(expandTerm('{bparm} arm', SLOTS)).toEqual(['left arm']);
  expect(expandTerm('{age}', null)).toEqual([]);
  expect(matchAt('chinese female, 70s', [['{age}'], ['{decade}']], SLOTS)).toBe(16);
  expect(matchAt('ic no. s54xxxxxa', [['{ic}']], SLOTS)).toBe(7);
  // final review I2: COPD's patient rules no arm out, so either arm is the BP arm, hers first
  expect(caseSlots(v.parse(CaseSchema, copd), 6)).toEqual({ ...SLOTS, bparm: ['left', 'right'] });
  expect(caseSlots(caseById('ccf-jurong-01'), 6).bparm).toEqual(['right']);
  expect(caseSlots(caseById('bleed-woodlands-01'), 6).bparm).toEqual(['left']);
  expect(caseSlots(v.parse(CaseSchema, copd), 1).eta).toEqual(['1', '2']);
});
// Controller ruling (Task 6 pre-review): {posture} holds the words for the way the case needs the patient to move.
test('the posture slot names the direction the case needs, and is empty where the position is ideal', () => {
  // Fix round 1 (Important 5): the notes also name Fowler / semi-Fowler for sitting up, and "upright"
  // Fix round 2: and the apostrophe-free "fowlers" / "semi fowlers" a phone keyboard gives
  expect(caseSlots(caseById('chestpain-bedok-01'), 6).posture)
    .toEqual(['sit', 'sitting', 'upright', 'fowler', "fowler's", 'fowlers', 'semi-fowler', 'semi fowlers']);
  expect(caseSlots(caseById('bleed-woodlands-01'), 6).posture).toEqual(['lie', 'lying', 'lay', 'flat', 'supine']);
  for (const id of ['copd-amk-01', 'hypo-hougang-01', 'ccf-jurong-01', 'asthma-tampines-01', 'fall-yishun-01', 'rta-toapayoh-01'])
    expect(caseSlots(caseById(id), 6).posture, id).toEqual([]);
  expect(matchAt('sitting up is easier', [['easier', '{posture}']], caseSlots(caseById('chestpain-bedok-01'), 6))).toBe(0);
  expect(matchAt('lying flat is easier', [['easier', '{posture}']], caseSlots(caseById('chestpain-bedok-01'), 6))).toBe(-1);
});
test('sentences split at ? ! ; and newlines, and at full stops after real words', () => {
  expect(splitSentences('Is there air entry? Is air entry equal. Any abnormal sounds!'))
    .toEqual(['Is there air entry?', 'Is air entry equal.', 'Any abnormal sounds!']);
  expect(splitSentences('IC no. S54xxxxxA, ETA 6 mins.')).toEqual(['IC no. S54xxxxxA, ETA 6 mins.']);
  expect(splitSentences('If still bleeding, apply C.A.T. Then check')).toEqual(['If still bleeding, apply C.A.T. Then check']);
  expect(splitSentences('Hi\n\nBye')).toEqual(['Hi', 'Bye']);
});
// Inputs the schema rejects in content still behave safely when they reach the matcher another way.
test('empty terms and alternatives never match; unknown slots stay literal; slotted negatives need the slots', () => {
  expect(termAt('any text', '')).toBe(-1);
  expect(termAt('', 'pr')).toBe(-1);
  expect(termAt('check the pr', 'pr')).toBe(10);   // a short term may end the text
  expect(matchAt('any text', [[]], null)).toBe(-1);
  expect(matchAt('any text', [], null)).toBe(-1);
  expect(expandTerm('{foo}', SLOTS)).toEqual(['{foo}']);
  expect(matchAt('age 72', [['age']], SLOTS, ['{age}'])).toBe(-1);
  expect(matchAt('age 72', [['age']], null, ['{age}'])).toBe(0);
  expect(normalizeLine('')).toBe('');
  expect(splitSentences('')).toEqual([]);
  // a run of stops ends one sentence, so "?!" and "..." leave no piece of bare punctuation
  expect(splitSentences('Really?! Wait... next')).toEqual(['Really?!', 'Wait...', 'next']);
});
// Review fix round 1: behaviours the code claims, pinned.
test('a term with two slots expands to every pair of values', () => {
  expect(expandTerm('{eta} {bparm}', SLOTS)).toEqual(['5 left', '6 left', '7 left']);
  expect(expandTerm('{ic} {eta}', SLOTS)).toEqual(['s54xxxxxa 5', 's54xxxxxa 6', 's54xxxxxa 7', 's54 5', 's54 6', 's54 7']);
});
test('normalizeLine folds en-dash ranges, chained ranges, the left single quote and the em dash', () => {
  expect(normalizeLine('1–6 ‘a’ — 1-2-3')).toBe("1 to 6 'a' - 1 to 2 to 3");
});
test('a full stop right before a digit is a decimal point, not a sentence end', () => {
  expect(splitSentences('Temp 100.5 degrees.')).toEqual(['Temp 100.5 degrees.']);
  expect(splitSentences('Temp 100.5 degrees. Any pain?')).toEqual(['Temp 100.5 degrees.', 'Any pain?']);
});
// Plan 3 Task 1 (D24): a lone "score {n}" is the GCS score only for 11 to 15, which no 1-to-10 pain score reaches.
test('the gcsscore slot is the GCS totals 11 to 15, the same for every case', () => {
  expect(caseSlots(caseById('copd-amk-01'), 6).gcsscore).toEqual(['11', '12', '13', '14', '15']);
});
// Task 1 review round 1 (I2): a term whose last word is a single letter must end at a word end, as a short term must,
// so the SRACIE's race-first "chinese f" is never "Chinese for…" and "may i" never "may it"; a last word of digits, or a
// letter glued to digits, stays a prefix ("every 5" reads "every 5mins", "eta 10m" reads "eta 10mins").
test('a term whose last word is one letter ends at a word end; one ending in digits stays a prefix', () => {
  expect(termAt('chinese for 30 years', 'chinese f')).toBe(-1);
  expect(termAt('chinese f 72', 'chinese f')).toBe(0);
  expect(termAt('malay, mid-50s', 'malay, m')).toBe(-1);
  expect(termAt('malay, m, 58', 'malay, m')).toBe(0);
  expect(termAt('case of chinese/f/72', 'chinese/f')).toBe(8);
  expect(termAt('malay m', 'malay m')).toBe(0);   // a letter that ends the text ends a word
  expect(termAt('may it hurt', 'may i')).toBe(-1);
  expect(termAt('may i check', 'may i')).toBe(0);
  expect(termAt('monitor every 5mins', 'every 5')).toBe(8);
  expect(termAt('eta 10mins', 'eta 10m')).toBe(0);
});
