import * as v from 'valibot';
import { expectTypeOf } from 'vitest';
import {
  NotesRefSchema, RawQuestionsDocSchema, OverridesDocSchema, NotesDocSchema, StepsDocSchema, CaseSchema,
  CASE_FLAGS, CONDITIONS, MATCH_SLOTS, OXYGEN_DEVICES, PATIENT_LINES, conditionHolds, getFinding,
  type Case, type CaseFlag, type Condition, type NotesDoc, type PatientLine,
} from '../../src/data/schema';
import { resolveNotesRef, notesRefHref, notesRefLabel } from '../../src/data/notesRef';
import stepsDoc from '../../public/data/steps.json';

const ok = (schema: v.GenericSchema, data: unknown) => v.safeParse(schema, data).success;

function validCase(): Case {
  const vitals = { spo2: 95, pr: 80, rr: 16, bp: '120/80', temp: 36.8, skin: 'pink, warm, dry', crt: 'under 2 s' };
  return {
    id: 'case-01', type: 'medical', complaint: 'Complaint', area: 'Area', callText: 'Call text', location: 'Location',
    flags: [], reviewed: false, notesRef: 's05',
    caller: { who: 'son', voice: 'Voice', answers: { location: 'Location', whatHappened: 'What happened', casualties: 'One',
      conscious: 'Yes', icAndMeds: 'Ready' } },
    patient: { name: 'Name', callName: 'Mdm Name', sex: 'female', race: 'Race', age: 70, ic: 'S54xxxxxA', voice: 'Voice',
      chiefComplaint: 'Chief complaint', lines: { feelingNow: 'Better', fall: 'No', hitHead: 'No', neckPain: 'No pain',
        lungHistory: 'No asthma', verbal: 'Name, at home', motor: 'Like this', severity: '3', position: 'Sitting',
        bpScreen: 'No shunt, no operation', ic: 'Here is my IC' } },
    findings: {
      scene: { description: 'Scene', items: ['Item'], hazards: [], witnesses: 'Witness' },
      approach: { catastrophicBleeding: false, bleeding: 'No catastrophic bleeding.' },
      loc: { avpu: 'A', response: 'Response' },
      spine: { fall: 'No', hitHead: 'No', dtbl: 'None', neckPain: false },
      airway: { mouth: 'Clear', smell: 'None' },
      breathing: { riseFall: 'Equal', rateQuality: 'fast and shallow', ntucp: [] },
      history: { asthmaCopd: 'None', other: 'None' },
      circulation: { pulse: 'Radial' },
      rbs: { findings: 'None', jvd: false, pedalEdema: false, gloves: 'Dry', pockets: [] },
      investigation: { auscultation: 'Clear', bp: '120/80 mmHg', bpArm: 'left', ecg: { type: '4-lead', reading: 'Sinus' }, hypocount: 5.5 },
      vitals: { gcs: { e: 4, v: 5, m: 6 }, severity: '3 to 4' },
      position: { choice: 'Sitting', ideal: true },
    },
    vitals: { roomAir: { ...vitals }, afterO2: { ...vitals } },
    expected: {
      oxygen: { device: 'none', flowMin: null, flowMax: null },
      ecg: '4-lead',
      decision: { stable: false, signs: ['Sign one', 'Sign two'], suspected: 'Suspected', plan: 'stay-and-treat' },
    },
  };
}

describe('notes refs', () => {
  test.each(['s01', 's01#delicate-spine'])('accepts %s', ref => { expect(ok(NotesRefSchema, ref)).toBe(true); });
  test.each(['Section 16', 's1', 's01#Delicate'])('rejects %s', ref => { expect(ok(NotesRefSchema, ref)).toBe(false); });
});

describe('raw questions', () => {
  const question = (over: Record<string, unknown> = {}) => ({
    id: 'mt-a-q001', bank: 'mt-a', number: 1, passage: null, stem: 'Stem?',
    options: [{ id: 'a', label: 'a', text: 'One' }, { id: 'b', label: 'b', text: 'Two' }],
    answer: 'b', image: null, topic: null, review: [], srcHash: '0123456789ab', ...over,
  });
  const doc = (q: unknown) => ({
    contentVersion: 'test', banks: [{ id: 'mt-a', label: 'Medical and trauma, part A', source: 'bank.pdf' }], questions: [q],
  });
  const flagged = [{ code: 'no-answer', reason: 'No option is marked as the answer in the PDF.' }];

  test('accepts a valid question', () => { expect(ok(RawQuestionsDocSchema, doc(question()))).toBe(true); });
  test('rejects an answer that is not one of the option ids', () => {
    expect(ok(RawQuestionsDocSchema, doc(question({ answer: 'e' })))).toBe(false);
  });
  test('rejects a null answer when the question is not flagged for review', () => {
    expect(ok(RawQuestionsDocSchema, doc(question({ answer: null })))).toBe(false);
  });
  test('accepts a null answer when the question is flagged for review', () => {
    expect(ok(RawQuestionsDocSchema, doc(question({ answer: null, review: flagged })))).toBe(true);
  });
  test('needs 2 to 6 options', () => {
    const opts = (n: number) => Array.from({ length: n }, (_, i) => ({ id: 'abcdefg'[i], label: 'abcdefg'[i], text: `Option ${i}` }));
    expect(ok(RawQuestionsDocSchema, doc(question({ options: opts(1), answer: 'a' })))).toBe(false);
    expect(ok(RawQuestionsDocSchema, doc(question({ options: opts(6), answer: 'a' })))).toBe(true);
    expect(ok(RawQuestionsDocSchema, doc(question({ options: opts(7), answer: 'a' })))).toBe(false);
  });
});

describe('overrides', () => {
  const entry = (over: Record<string, unknown> = {}) => ({
    srcHash: '0123456789ab', topic: 'respiratory', explanation: 'Nasal cannula runs at 2 to 4 L/min.',
    notesRef: 's11#oxygen-masks', generated: true, ...over,
  });
  const doc = (e: unknown) => ({ version: 1, questions: { 'mt-b-q115': e } });

  test('accepts a valid entry', () => { expect(ok(OverridesDocSchema, doc(entry()))).toBe(true); });
  test('rejects an unknown topic', () => { expect(ok(OverridesDocSchema, doc(entry({ topic: 'cardio' })))).toBe(false); });
  test('rejects an empty explanation', () => { expect(ok(OverridesDocSchema, doc(entry({ explanation: '' })))).toBe(false); });
});

describe('notes doc', () => {
  test('keeps the runs on a highlighted heading', () => {
    const runs = [{ t: 'Asthma', b: true }, { t: ' (tested)', b: true, h: true }];
    const doc = { contentVersion: 'test', source: 'EMT_Survey_Notes.docx', sections: [{ id: 's16', n: 16,
      title: 'Respiratory Emergencies', tags: [], highlights: 1,
      blocks: [{ k: 'h', id: 'asthma-tested', text: 'Asthma (tested)', runs }] }] };
    const block = v.parse(NotesDocSchema, doc).sections[0]!.blocks[0]!;
    expect(block).toEqual({ k: 'h', id: 'asthma-tested', text: 'Asthma (tested)', runs });
  });
});

describe('cases', () => {
  test('accepts a valid case', () => { expect(ok(CaseSchema, validCase())).toBe(true); });
  test('rejects a stable case', () => {
    const c = validCase();
    expect(ok(CaseSchema, { ...c, expected: { ...c.expected, decision: { ...c.expected.decision, stable: true } } })).toBe(false);
  });
  test('rejects an unmasked IC', () => {
    const c = validCase();
    expect(ok(CaseSchema, { ...c, patient: { ...c.patient, ic: 'S5412345A' } })).toBe(false);
  });
  test('rejects a misspelt key', () => { expect(ok(CaseSchema, { ...validCase(), reviewd: false })).toBe(false); });

  // every reply the patient gives is voiced in the case, so each line is required and a misspelt one fails
  const withLines = (lines: Record<string, unknown>) => { const c = validCase(); return { ...c, patient: { ...c.patient, lines } }; };
  test('needs every patient line', () => {
    for (const key of PATIENT_LINES) {
      const { [key]: _gone, ...rest } = validCase().patient.lines;
      expect(ok(CaseSchema, withLines(rest)), key).toBe(false);
    }
  });
  test('rejects an unknown patient line, and takes an optional convinced line', () => {
    expect(ok(CaseSchema, withLines({ ...validCase().patient.lines, feelingNoww: 'Better' }))).toBe(false);
    expect(ok(CaseSchema, withLines({ ...validCase().patient.lines, convinced: 'OK, I sit up.' }))).toBe(true);
  });
  test('needs a call name', () => {
    const { callName: _gone, ...patient } = validCase().patient;
    expect(ok(CaseSchema, { ...validCase(), patient })).toBe(false);
  });
  test('takes bleeding control and a limb injury, each with its own keys', () => {
    const c = validCase();
    const control = { pressure: 'Still bleeding.', dressing: 'Still soaking through.', cat: 'Bleeding stops.' };
    const limb = { injury: 'Swollen left ankle', where: 'left ankle', distalPulse: 'Distal pulse present', immobilise: 'Buddy splints the ankle.' };
    const withLimb = (l: unknown) => ({ ...c, findings: { ...c.findings, rbs: { ...c.findings.rbs, limb: l } } });
    expect(ok(CaseSchema, { ...c, findings: { ...c.findings, approach: { catastrophicBleeding: true, bleeding: 'Bleeding.', control } } })).toBe(true);
    expect(ok(CaseSchema, withLimb(limb))).toBe(true);
    expect(ok(CaseSchema, { ...c, findings: { ...c.findings, approach: { ...c.findings.approach, control: { ...control, tourniquet: 'x' } } } })).toBe(false);
    expect(ok(CaseSchema, withLimb({ injury: 'Ankle' }))).toBe(false);
    // Plan 3 T3 (D22): the limb names where it is, as step 12's immobilise say says it ({limbWhere})
    const { where: _where, ...nowhere } = limb;
    expect(ok(CaseSchema, withLimb(nowhere))).toBe(false);
    expect(ok(CaseSchema, withLimb({ ...limb, where: '' }))).toBe(false);
  });
  test('names the BP arm as left or right', () => {
    const c = validCase();
    const at = (bpArm: string) => ({ ...c, findings: { ...c.findings, investigation: { ...c.findings.investigation, bpArm } } });
    expect(ok(CaseSchema, at('right'))).toBe(true);
    expect(ok(CaseSchema, at('Left'))).toBe(false);
  });
  // Final review I2: a case whose patient rules an arm out says so; left out, either arm is the BP arm.
  test('may restrict the BP arm, as true or not at all', () => {
    const c = validCase();
    const restricted = (r: unknown) => ({ ...c, findings: { ...c.findings, investigation: { ...c.findings.investigation, bpArmRestricted: r } } });
    expect(ok(CaseSchema, restricted(true))).toBe(true);
    expect(ok(CaseSchema, restricted(false))).toBe(false);
    expect(ok(CaseSchema, restricted('left'))).toBe(false);
  });
  test('the expected oxygen uses a known device and may carry a teaching note', () => {
    const c = validCase();
    const oxygen = (o: Record<string, unknown>) => ({ ...c, expected: { ...c.expected, oxygen: { ...c.expected.oxygen, ...o } } });
    expect(OXYGEN_DEVICES).toContain(c.expected.oxygen.device);
    expect(ok(CaseSchema, oxygen({ note: 'COPD gets a nasal cannula.' }))).toBe(true);
    expect(ok(CaseSchema, oxygen({ note: '' }))).toBe(false);
    expect(ok(CaseSchema, oxygen({ device: 'venturi' }))).toBe(false);
    expect(ok(CaseSchema, oxygen({ notes: 'Misspelt.' }))).toBe(false);
  });
  // Controller ruling (Task 6 pre-review): the convince point reads the direction the case needs, so a position that is
  // not ideal names it, and an ideal one doesn't.
  const position = (p: Record<string, unknown>) => { const c = validCase(); return { ...c, findings: { ...c.findings, position: p } }; };
  test('a position that is not ideal names where to move the patient', () => {
    expect(ok(CaseSchema, position({ choice: 'Lying flat', ideal: false, toward: 'sit-up' }))).toBe(true);
    expect(ok(CaseSchema, position({ choice: 'Sitting up', ideal: false, toward: 'supine' }))).toBe(true);
    expect(ok(CaseSchema, position({ choice: 'Lying flat', ideal: false }))).toBe(false);
    expect(ok(CaseSchema, position({ choice: 'Lying flat', ideal: false, toward: 'standing' }))).toBe(false);
  });
  test('an ideal position names no direction', () => {
    expect(ok(CaseSchema, position({ choice: 'Sitting', ideal: true }))).toBe(true);
    expect(ok(CaseSchema, position({ choice: 'Sitting', ideal: true, toward: 'sit-up' }))).toBe(false);
    expect(ok(CaseSchema, position({ choice: 'Sitting', ideal: true, toward: 'supine' }))).toBe(false);
  });
});

describe('must-hit points', () => {
  // by default the step's one reply is triggered by its one point, whatever that point is called
  const doc = (point: unknown, replies: unknown[] = [{ role: 'armBuddy', vitals: ['spo2'], on: [(point as { id: string }).id] }]) => ({
    contentVersion: 'test', steps: [{
      id: 'oxygen', order: 15, name: 'Oxygen', timed: true, notesRef: 's01#oxygen', canonicalLine: 'Recheck the SpO2.',
      mustHit: [point], replies, guidance: [] }] });
  const recheck = { id: 'recheck-spo2', label: 'Recheck SpO2', short: 'recheck SpO2', match: [['spo2']] };

  test('accepts a point with match terms', () => {
    expect(ok(StepsDocSchema, doc(recheck))).toBe(true);
  });
  test('accepts a point with only parts', () => {
    const parts = [{ id: 'part', label: 'Part', match: [['part']] }];
    expect(ok(StepsDocSchema, doc({ id: 'point', label: 'Point', short: 'point', match: [], parts }))).toBe(true);
  });
  test('accepts a point with only local terms', () => {
    expect(ok(StepsDocSchema, doc({ id: 'point', label: 'Point', short: 'point', match: [], local: [['rate']] }))).toBe(true);
  });
  test('rejects a point with no match terms, no local terms and no parts', () => {
    expect(ok(StepsDocSchema, doc({ id: 'point', label: 'Point', short: 'point', match: [] }))).toBe(false);
  });

  // the short label names the point in routes and flags, so every point has one that fits
  test('needs a short label of 1 to 28 characters', () => {
    const { short: _gone, ...noShort } = recheck;
    expect(ok(StepsDocSchema, doc(noShort))).toBe(false);
    expect(ok(StepsDocSchema, doc({ ...recheck, short: '' }))).toBe(false);
    expect(ok(StepsDocSchema, doc({ ...recheck, short: 'x'.repeat(28) }))).toBe(true);
    expect(ok(StepsDocSchema, doc({ ...recheck, short: 'x'.repeat(29) }))).toBe(false);
  });
  test('a check names oxygen, ecg or arm', () => {
    expect(ok(StepsDocSchema, doc({ ...recheck, check: 'oxygen' }))).toBe(true);
    expect(ok(StepsDocSchema, doc({ ...recheck, check: 'ecg' }))).toBe(true);
    expect(ok(StepsDocSchema, doc({ ...recheck, check: 'arm' }))).toBe(true);   // Plan 3 T2 (D23): the BP arm
    expect(ok(StepsDocSchema, doc({ ...recheck, check: 'spo2' }))).toBe(false);
  });

  // the same Match rules hold in the point's own match, its local terms, its parts and its accepted alternatives
  const at = {
    'match': (match: unknown) => ({ id: 'point', label: 'Point', short: 'point', match }),
    'local': (match: unknown) => ({ id: 'point', label: 'Point', short: 'point', match: [['spo2']], local: match }),
    'parts[].match': (match: unknown) => ({ id: 'point', label: 'Point', short: 'point', match: [], parts: [{ id: 'part', label: 'Part', match }] }),
    'accept[].match': (match: unknown) => ({ id: 'point', label: 'Point', short: 'point', match: [['spo2']], accept: [{ label: 'Alt', match }] }),
  };
  const where = Object.keys(at) as (keyof typeof at)[];
  test.each(where)('%s accepts lowercase stems', key => {
    expect(ok(StepsDocSchema, doc(at[key]([['deformit'], ['hit', 'head']])))).toBe(true);
  });
  test.each(where.flatMap(key => [[key, 'an empty alternative', [[]]], [key, 'an empty term', [['']]],
    [key, 'an uppercase term', [['Deformit']]], [key, 'a whitespace-only term', [[' ']]],
    [key, 'a term with a leading space', [[' fall']]], [key, 'a term with a trailing space', [['fall ']]]] as const))(
    '%s rejects %s', (key, _what, match) => {
      expect(ok(StepsDocSchema, doc(at[key](match)))).toBe(false);
    });
  test('accepts a term with an inner space', () => {
    expect(ok(StepsDocSchema, doc(at.match([['4 in 1', 'lsu']])))).toBe(true);
  });

  // a '{slot}' in a term is filled from the case by the matcher, so only the match slots may appear in braces
  test.each(where.flatMap(key => MATCH_SLOTS.map(slot => [key, slot] as const)))('%s accepts the slot {%s}', (key, slot) => {
    expect(ok(StepsDocSchema, doc(at[key]([[`{${slot}}`], ['eta', `{${slot}}`], [`{${slot}} arm`]])))).toBe(true);
  });
  test.each(where.flatMap(key => [[key, '{name}'], [key, '{bpArm}'], [key, '{}'], [key, '{age'], [key, 'age}'], [key, '{{age}}'],
    [key, '{ age}']] as const))('%s rejects %s', (key, term) => {
    expect(ok(StepsDocSchema, doc(at[key]([[term]])))).toBe(false);
  });

  // requiredWords and negatives follow the same term rules
  const words = (key: 'requiredWords' | 'negatives', list: unknown) => ({ id: 'moi', label: 'MOI', short: 'MOI', match: [['moi']], [key]: list });
  test.each(['requiredWords', 'negatives'] as const)('%s accepts lowercase words', key => {
    expect(ok(StepsDocSchema, doc(words(key, ['suspected', 'not sure'])))).toBe(true);
  });
  test.each((['requiredWords', 'negatives'] as const).flatMap(key => [[key, 'an empty word', ''], [key, 'an uppercase word', 'Suspected'],
    [key, 'a whitespace-only word', ' '], [key, 'a word with a leading space', ' suspected'],
    [key, 'a word with a trailing space', 'suspected ']] as const))('%s rejects %s', (key, _what, word) => {
    expect(ok(StepsDocSchema, doc(words(key, [word])))).toBe(false);
  });

  // every reply names the must-hit points (or 'point.part') of its own step that trigger it
  const named = (id: string) => ({ id, label: 'Point', short: id, match: [['term']] });
  const reply = (r: unknown, point: unknown = recheck) => ok(StepsDocSchema, doc(point, [r]));
  test('a reply needs at least one trigger', () => {
    expect(reply({ role: 'armBuddy', vitals: ['spo2'], on: [] })).toBe(false);
    expect(reply({ role: 'armBuddy', vitals: ['spo2'] })).toBe(false);
    expect(reply({ role: 'tester', text: 'Accepted.' })).toBe(false);
    expect(reply({ role: 'tester', finding: 'findings.airway.mouth' })).toBe(false);
  });
  test('every reply kind takes its triggers', () => {
    expect(reply({ role: 'tester', text: 'Accepted.', on: ['recheck-spo2'] })).toBe(true);
    expect(reply({ role: 'tester', finding: 'findings.airway.mouth', on: ['recheck-spo2'] })).toBe(true);
    expect(reply({ role: 'armBuddy', vitals: ['spo2'], on: ['recheck-spo2'] })).toBe(true);
  });
  test('computed replies give the ETA, the IC or the oxygen, from any role', () => {
    expect(reply({ role: 'headBuddy', computed: 'oxygen', on: ['mask-flow'] }, named('mask-flow'))).toBe(true);
    expect(reply({ role: 'tester', computed: 'ic', on: ['get-ic'] }, named('get-ic'))).toBe(true);
    expect(reply({ role: 'tester', computed: 'eta', on: ['standby-opener'] }, named('standby-opener'))).toBe(true);
    expect(reply({ role: 'tester', computed: 'eta' }, named('standby-opener'))).toBe(false);
    expect(reply({ role: 'tester', computed: 'gcs', on: ['gcs'] }, named('gcs'))).toBe(false);
  });
  // a misspelt trigger would load and then never play, so it fails at load
  test("a trigger must name a point of the step, or 'point.part' for one of its parts", () => {
    const parted = { id: 'arm-buddy', label: 'Arm buddy', short: 'arm buddy vitals', match: [],
      parts: [{ id: 'spo2', label: 'SpO2', match: [['spo2']] }, { id: 'pr', label: 'Pulse rate', match: [['pulse']] }] };
    const vitals = (...on: string[]) => reply({ role: 'armBuddy', vitals: ['spo2'], on }, parted);
    expect(vitals('arm-buddy')).toBe(true);
    expect(vitals('arm-buddy.spo2', 'arm-buddy.pr')).toBe(true);
    expect(vitals('arm-budy')).toBe(false);
    expect(vitals('arm-buddy', 'mask-flow')).toBe(false);   // one bad trigger is enough
    expect(vitals('arm-buddy.crt')).toBe(false);
    expect(vitals('arm-buddy.')).toBe(false);
    expect(vitals('arm-buddy.spo2.extra')).toBe(false);
    expect(reply({ role: 'tester', text: 'Accepted.', on: ['recheck-spo2.part'] })).toBe(false);   // a point with no parts
  });
  test('the load error names the trigger that does not resolve', () => {
    const r = v.safeParse(StepsDocSchema, doc(recheck, [{ role: 'tester', text: 'Accepted.', on: ['recheck-spo2', 'mask-flow'] }]));
    expect(r.success).toBe(false);
    expect(r.issues?.map(i => i.message)).toEqual([expect.stringContaining('mask-flow')]);
    expect(r.issues?.[0]?.message).not.toContain('recheck-spo2');   // only the trigger that is wrong
  });
});

// Task 11b: a conditional point may carry the words a trainee says for it (say), and the step's canonical line names it
// with {say:<pointId>}, which fillCanonical fills where the point applies to the case and drops elsewhere.
describe('canonical say placeholders', () => {
  const fall = { id: 'ask-fall', label: 'Did you fall?', short: 'fall?', match: [['fall']] };
  const grip = { id: 'release-grip', label: 'Release grip', short: 'release grip', match: [['remove', 'grip']], when: 'noSpinal',
    say: 'No suspected spinal injuries, buddy remove head grip.' };
  const collar = { id: 'c-collar', label: 'C-collar', short: 'C-collar', match: [['collar']], when: 'neckPain',
    say: 'Establish neutral position, measure & apply C-collar.' };
  const { say: _none, ...silentCollar } = collar;
  const doc = (canonicalLine: string, mustHit: unknown[] = [fall, grip, collar]) => ({
    contentVersion: 'test', steps: [{
      id: 'delicate-spine', order: 8, name: 'Delicate spine', timed: true, notesRef: 's01#delicate-spine', canonicalLine,
      mustHit, replies: [], guidance: [] }] });
  const LINE = 'Did you fall? {say:c-collar} {say:release-grip}';
  const messages = (line: string, mustHit?: unknown[]) => v.safeParse(StepsDocSchema, doc(line, mustHit)).issues?.map(i => i.message) ?? [];

  test('accepts one placeholder for each conditional point with a say, each a sentence of its own', () => {
    expect(ok(StepsDocSchema, doc(LINE))).toBe(true);
    expect(ok(StepsDocSchema, doc('{say:release-grip} Did you fall? {say:c-collar}'))).toBe(true);
    expect(ok(StepsDocSchema, doc('Did you fall? {say:c-collar} {say:release-grip} Next.'))).toBe(true);
    // a conditional point with no say needs no placeholder (step 2's tele-CPR)
    expect(ok(StepsDocSchema, doc('Did you fall? {say:release-grip}', [fall, grip, silentCollar]))).toBe(true);
  });
  test('a say is only for a point with a when', () => {
    expect(ok(StepsDocSchema, doc('Did you fall?', [{ ...fall, say: 'Did you fall?' }]))).toBe(false);
    expect(ok(StepsDocSchema, doc('{say:ask-fall}', [{ ...fall, say: 'Did you fall?' }]))).toBe(false);
  });
  // Plan 3 T3 (D22): a say may hold a canonical slot, which fillCanonical fills as it does the line's own
  // ("Buddy, immobilise the {limbWhere}."); any other brace fails
  test('a say is a finished sentence or two, with no brace but a canonical slot', () => {
    for (const say of ['', ' No suspected spinal injuries.', 'No suspected spinal injuries', 'Remove the grip, {name}.',
      'Remove the grip, {say:c-collar}.', 'Remove the grip {limbWhere.', 'Remove the grip, {}.', 'Remove the {limbwhere}.'])
      expect(ok(StepsDocSchema, doc(LINE, [fall, { ...grip, say }, collar])), JSON.stringify(say)).toBe(false);
    expect(ok(StepsDocSchema, doc(LINE, [fall, { ...grip, say: 'No suspected spinal injuries. Buddy, remove head grip!' }, collar]))).toBe(true);
    expect(ok(StepsDocSchema, doc(LINE, [fall, { ...grip, say: 'Buddy, immobilise the {limbWhere}.' }, collar]))).toBe(true);
    expect(messages(LINE, [fall, { ...grip, say: 'Remove the grip, {name}.' }, collar])).toEqual([expect.stringContaining('{limbWhere}')]);
  });
  test('a placeholder must name a point of its step that has a when and a say', () => {
    expect(ok(StepsDocSchema, doc(`${LINE} {say:jaw-thrust}`))).toBe(false);                       // no such point
    expect(ok(StepsDocSchema, doc(`${LINE} {say:ask-fall}`))).toBe(false);                         // no when
    expect(ok(StepsDocSchema, doc(LINE, [fall, grip, silentCollar]))).toBe(false);                 // no say
    expect(ok(StepsDocSchema, doc(`${LINE} {say:}`))).toBe(false);
  });
  test('every conditional point with a say has a placeholder, and only one', () => {
    expect(ok(StepsDocSchema, doc('Did you fall? {say:release-grip}'))).toBe(false);               // c-collar's is missing
    expect(ok(StepsDocSchema, doc(`${LINE} {say:c-collar}`))).toBe(false);                         // c-collar's twice
  });
  test('a placeholder stands as its own sentence, never inside another', () => {
    for (const line of ['Did you fall {say:c-collar}? {say:release-grip}', 'Did you fall? Then {say:c-collar} now. {say:release-grip}',
      'Did you fall?{say:c-collar} {say:release-grip}', 'Did you fall? {say:c-collar}{say:release-grip}', 'Did you fall? {say:c-collar}, {say:release-grip}'])
      expect(ok(StepsDocSchema, doc(line)), line).toBe(false);
  });
  // Task 11b review round 1 (Minor 1): what follows a placeholder starts a sentence, and what comes before one ends one
  test('a lowercase continuation after a placeholder fails: it would finish the placeholder\'s sentence', () => {
    for (const line of ['Did you fall? {say:c-collar} now. {say:release-grip}', '{say:c-collar} and then palpate. {say:release-grip}',
      'Did you fall? {say:c-collar} {say:release-grip} then next.', 'Did you fall? {say:c-collar} {say:release-grip} (if needed).'])
      expect(messages(line), line).toEqual([expect.stringContaining('must stand as its own sentence')]);
  });
  test('a placeholder after a word, mid-sentence, fails', () => {
    for (const line of ['Did you fall and {say:c-collar} {say:release-grip}', 'Did you fall, {say:c-collar} {say:release-grip}',
      'Did you fall? Now {say:c-collar} {say:release-grip}'])
      expect(messages(line), line).toEqual([expect.stringContaining('{say:c-collar} must stand as its own sentence')]);
  });
  test('after a placeholder may come the end, a capital, a digit, another placeholder or a slot that opens a sentence', () => {
    for (const line of [LINE, 'Did you fall? {say:c-collar} {say:release-grip} Next.', 'Did you fall? {say:c-collar} {say:release-grip} 12-lead ECG.',
      'Did you fall? {say:c-collar} {say:release-grip} {decisionLine} As I am an FMV EMT.', 'Did you fall? {say:c-collar} {say:release-grip} {callExtras}'])
      expect(messages(line), line).toEqual([]);
    // a brace that is no slot opens nothing
    expect(messages('Did you fall? {say:c-collar} {say:release-grip} {nope} Next.')).toEqual([expect.stringContaining('{say:release-grip} must stand as its own sentence')]);
  });
  test('the shipped steps.json still loads', () => {
    expect(v.safeParse(StepsDocSchema, stepsDoc).issues ?? []).toEqual([]);
  });
  test('the load error names each placeholder that is wrong, and why', () => {
    expect(messages(`Did you fall? {say:release-grip} {say:jaw-thrust} {say:release-grip}`)).toEqual([expect.stringMatching(
      /\{say:jaw-thrust\} names no must-hit point of its step.*\{say:release-grip\} is used 2 times.*c-collar has a say but no \{say:c-collar\}/)]);
    expect(messages('Did you fall {say:c-collar}? {say:release-grip}')).toEqual([expect.stringContaining('{say:c-collar} must stand as its own sentence')]);
    expect(messages(`${LINE} {say:ask-fall}`)).toEqual([expect.stringContaining('{say:ask-fall} names a point with no when')]);
    expect(messages(LINE, [fall, grip, silentCollar])).toEqual([expect.stringContaining('{say:c-collar} names a point with no say')]);
    expect(messages(LINE)).toEqual([]);
  });
});

describe('patient lines type', () => {
  // the schema builds the keys from PATIENT_LINES through a cast, so pin the inferred type: every line, required, plus an
  // optional `convinced`, and nothing else
  type Lines = Case['patient']['lines'];
  test('has exactly the PATIENT_LINES keys, each required, plus an optional convinced', () => {
    expectTypeOf<keyof Lines>().toEqualTypeOf<PatientLine | 'convinced'>();
    expectTypeOf<Pick<Lines, PatientLine>>().toEqualTypeOf<Record<PatientLine, string>>();
    expectTypeOf<Pick<Lines, 'convinced'>>().toEqualTypeOf<{ convinced?: string | undefined }>();
    // @ts-expect-error a case without every line is not a Case
    const missing: Lines = { feelingNow: 'Better' };
    expect(missing).toBeDefined();
  });
});

describe('conditionHolds', () => {
  test('noSpinal holds with no spinal flag and no neck pain', () => {
    expect(conditionHolds(validCase(), 'noSpinal')).toBe(true);
  });
  test('noSpinal turns false with neck pain', () => {
    const c = validCase();
    c.findings.spine.neckPain = true;
    expect(conditionHolds(c, 'noSpinal')).toBe(false);
    expect(conditionHolds(c, 'spinal')).toBe(true);
  });
  test('trauma follows the case type', () => {
    expect(conditionHolds(validCase(), 'trauma')).toBe(false);
    expect(conditionHolds({ ...validCase(), type: 'trauma' }, 'trauma')).toBe(true);
  });
  // Plan 3 T3 (D21): step 18's Stay & Treat and Load & Go follow the case's own plan, so a medical case can Load & Go
  test('stayAndTreat and loadAndGo follow the case plan, not its type', () => {
    expect(CONDITIONS.slice(-2)).toEqual(['stayAndTreat', 'loadAndGo']);
    const medicalLoadAndGo = validCase();
    medicalLoadAndGo.expected.decision.plan = 'load-and-go';
    expect(['medical', 'trauma', 'stayAndTreat', 'loadAndGo'].map(k => conditionHolds(medicalLoadAndGo, k as Condition)))
      .toEqual([true, false, false, true]);
    expect(['stayAndTreat', 'loadAndGo'].map(k => conditionHolds(validCase(), k as Condition))).toEqual([true, false]);
  });

  // For each condition, one edit to the valid case that makes it hold and one that makes it fail.
  // A flag's false case carries every other flag, so the check must read the right one.
  type Edit = (c: Case) => void;
  const onlyFlag = (f: CaseFlag): Edit => c => { c.flags = [f]; };
  const allFlagsBut = (f: CaseFlag): Edit => c => { c.flags = CASE_FLAGS.filter(x => x !== f); };
  const flag = (f: CaseFlag): [Edit, Edit] => [onlyFlag(f), allFlagsBut(f)];
  const edits: Record<Condition, [makeTrue: Edit, makeFalse: Edit]> = {
    rta: flag('rta'),
    unconscious: flag('unconscious'),
    spinal: flag('spinal'),   // the neck-pain route to spinal is tested above
    spinalAfterRbs: flag('spinalAfterRbs'),
    limbInjury: flag('limbInjury'),
    asthmaCopd: flag('asthmaCopd'),
    hypoglycaemia: flag('hypoglycaemia'),
    extraPpe: flag('extraPpe'),
    medical: [c => { c.type = 'medical'; }, c => { c.type = 'trauma'; }],
    trauma: [c => { c.type = 'trauma'; }, c => { c.type = 'medical'; }],
    noSpinal: [allFlagsBut('spinal'), onlyFlag('spinal')],
    neckPain: [c => { c.findings.spine.neckPain = true; c.flags = []; }, c => { c.findings.spine.neckPain = false; c.flags = ['spinal']; }],
    catastrophicBleeding: [c => { c.findings.approach.catastrophicBleeding = true; },
      c => { c.findings.approach.catastrophicBleeding = false; c.type = 'trauma'; }],
    positionNotIdeal: [c => { c.findings.position.ideal = false; }, c => { c.findings.position.ideal = true; }],
    // Plan 3 T3 (D21): the case's own plan, whatever its type: each holds with the other type, and fails with its own
    stayAndTreat: [c => { c.expected.decision.plan = 'stay-and-treat'; c.type = 'trauma'; },
      c => { c.expected.decision.plan = 'load-and-go'; c.type = 'medical'; }],
    loadAndGo: [c => { c.expected.decision.plan = 'load-and-go'; c.type = 'medical'; },
      c => { c.expected.decision.plan = 'stay-and-treat'; c.type = 'trauma'; }],
  };
  const edited = (edit: Edit) => { const c = validCase(); edit(c); return c; };
  test.each(CONDITIONS)('%s holds and fails as the case says', cond => {
    const [makeTrue, makeFalse] = edits[cond];
    expect(conditionHolds(edited(makeTrue), cond)).toBe(true);
    expect(conditionHolds(edited(makeFalse), cond)).toBe(false);
  });
});

describe('getFinding', () => {
  test('a missing path is undefined', () => {
    expect(getFinding(validCase(), 'findings.breathing.spo2RA')).toBeUndefined();
  });
  test('a present path gives its value', () => {
    const c = validCase();
    expect(getFinding(c, 'vitals.roomAir.spo2')).toBe(c.vitals.roomAir.spo2);
  });
  test('inherited keys are not findings', () => {
    expect(getFinding(validCase(), 'findings.constructor')).toBeUndefined();
  });
});

describe('resolveNotesRef', () => {
  const notes: NotesDoc = { contentVersion: 'test', source: 'EMT_Survey_Notes.docx', sections: [{
    id: 's01', n: 1, title: 'Primary Survey', tags: [], highlights: 0,
    blocks: [{ k: 'h', id: 'airway', text: 'Airway' }, { k: 'p', runs: [{ t: 'Text' }] }, { k: 'h', id: 'delicate-spine', text: 'Delicate Spine' }],
  }] };

  test('a section ref points at the top of the section', () => {
    expect(resolveNotesRef(notes, 's01')).toEqual({ section: notes.sections[0], blockIndex: 0, heading: null });
  });
  test('an anchor ref points at its heading', () => {
    expect(resolveNotesRef(notes, 's01#delicate-spine')).toEqual({ section: notes.sections[0], blockIndex: 2, heading: 'Delicate Spine' });
  });
  test.each(['s01#nope', 's21'])('%s does not resolve', ref => { expect(resolveNotesRef(notes, ref)).toBeNull(); });
});

describe('notes links', () => {
  const notes: NotesDoc = { contentVersion: 'test', source: 'EMT_Survey_Notes.docx', sections: [{
    id: 's11', n: 11, title: 'Oxygen & SpO2', tags: [], highlights: 0, blocks: [{ k: 'h', id: 'oxygen-masks', text: 'Oxygen Masks' }],
  }] };

  test('href', () => {
    expect(notesRefHref('s11#oxygen-masks')).toBe('#/notes/s11/oxygen-masks');
    expect(notesRefHref('s07')).toBe('#/notes/s07');
  });
  test('label names the heading when the notes are loaded', () => {
    expect(notesRefLabel(notes, 's11#oxygen-masks')).toBe('Notes 11, Oxygen Masks');
  });
  test('label falls back to the section number', () => {
    expect(notesRefLabel(null, 's07')).toBe('Notes 7');
    expect(notesRefLabel(null, 's11#oxygen-masks')).toBe('Notes 11');
    expect(notesRefLabel(notes, 's11')).toBe('Notes 11');
    expect(notesRefLabel(notes, 's11#nope')).toBe('Notes 11');
  });
  test('a malformed ref links to the notes tab', () => {
    expect(notesRefHref('Section 16')).toBe('#/notes');
    expect(notesRefLabel(null, 'Section 16')).toBe('Notes');
  });
});
