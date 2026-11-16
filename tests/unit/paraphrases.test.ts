import { PARAPHRASES, type Fault, type Paraphrase } from './paraphrases';
import { CASES, STEPS, T0, blankSession, caseById, ctxAt, envOf, hitAll, readOf } from './sim-helpers';
import { conditionHolds, type Case } from '../../src/data/schema';
import { keywordGrader, type SentenceReading } from '../../src/sim/grader';
import { caseSlots, splitSentences } from '../../src/sim/match';
import { oxygenRight } from '../../src/sim/oxygen';
import { fillCanonical } from '../../src/sim/replies';
import { UNCLEAR, sendLine } from '../../src/sim/run';

/** Every 'step/point' and 'step/point.part' the sentences read. */
const keysOf = (sentences: SentenceReading[]) =>
  new Set(sentences.flatMap(s => s.points.flatMap(pt => [`${pt.step}/${pt.point}`, ...pt.parts.map(x => `${pt.step}/${pt.point}.${x}`)])));
const interpret = async (p: Paraphrase) => (await keywordGrader.interpret(p.line, ctxAt(p.at, p.case, p.eta))).sentences;
/** What each fault a fixture rules out would be, in the sentences the grader read (Paraphrase.noFault). */
const FAULTS: Record<Fault, (sentences: SentenceReading[], c: Case) => string[]> = {
  phrase: (sentences) => sentences.flatMap(s => s.points.flatMap(pt => {
    const m = STEPS.find(x => x.id === pt.step)!.mustHit.find(x => x.id === pt.point)!;
    const unnamed = m.check === 'ecg' ? s.ecg === null : m.check === 'oxygen' ? s.oxygen?.device == null && s.oxygen?.flow == null
      : m.check === 'arm' ? s.arm == null : false;
    return [...pt.missing.map(w => `${pt.point} lacks "${w}"`), ...(unnamed ? [`${pt.point} names no choice`] : [])];
  })),
  wrong: (sentences, c) => sentences.flatMap(s => s.points.flatMap(pt => {
    const m = STEPS.find(x => x.id === pt.step)!.mustHit.find(x => x.id === pt.point)!;
    if (m.check === 'ecg' && s.ecg !== null && s.ecg !== c.expected.ecg) return [`${pt.point}: ${s.ecg}`];
    if (m.check === 'oxygen' && s.oxygen?.device != null && !oxygenRight(s.oxygen, c.expected.oxygen)) return [`${pt.point}: ${s.oxygen.device}`];
    if (m.check === 'arm' && s.arm != null && !caseSlots(c, 6).bparm.includes(s.arm)) return [`${pt.point}: ${s.arm} arm`];
    return [];
  })),
  unclear: (sentences) => sentences.filter(s => s.addressee === 'unclear').map(s => s.text),
};
test.each(PARAPHRASES.map((p, i) => [i, p] as const))('fixture %i: %o', async (_i, p) => {
  const sentences = await interpret(p);
  const got = keysOf(sentences);
  for (const h of p.hits ?? []) expect(got, `${p.line} should read ${h}`).toContain(h);
  for (const h of p.not ?? []) expect(got, `${p.line} should not read ${h}`).not.toContain(h);
  for (const f of p.noFault ?? []) expect(FAULTS[f](sentences, caseById(p.case ?? 'copd-amk-01')), `${p.line}: ${f}`).toEqual([]);
});
// Final review I3: a fixture's faults, as the run itself raises them. Each line that names the faults it must not raise is
// sent in a Coached run of its case at its step, with every step before it done and the clock at the fixture's ETA: it
// credits its points, its line carries no flag, and its route never asks who it is for.
test.each(PARAPHRASES.filter(p => p.noFault !== undefined).map(p => [p.line, p] as const))('in a Coached run: %s', async (_line, p) => {
  const caseId = p.case ?? 'copd-amk-01';
  const c = caseById(caseId);
  const step = STEPS.find(s => s.id === p.at)!;
  const done = hitAll(blankSession(caseId), STEPS, c, STEPS.filter(s => s.order < step.order).map(s => s.id));
  const at = { ...done, current: step.order, arrived: step.order > 2,
    clock: { started: true, bankedMs: (20 - (p.eta ?? 6)) * 60_000, runningSince: T0 } };
  const s = (await sendLine(envOf(caseId), at, p.line, T0)).session;
  const line = s.lines.filter(l => l.who === 'you').at(-1)!;
  expect(line.text).toBe(p.line);
  for (const h of p.hits ?? []) {
    const [key, part] = h.split('.');
    expect(part === undefined ? s.hits[key!] : s.parts[`${key}/${part}`], `${p.line} credits ${h}`).toBeDefined();
  }
  expect(line.flags ?? [], p.line).toEqual([]);
  if (p.noFault!.includes('unclear')) expect(line.route, p.line).not.toContain(UNCLEAR);
});
test('every point that applies to some case has 2 positive fixtures, every part 1', () => {
  const count = (k: string) => PARAPHRASES.filter(p => p.hits?.includes(k)).length;
  for (const s of STEPS) for (const m of s.mustHit) {
    const applies = CASES.some(c => !m.when || conditionHolds(c, m.when));
    if (!applies) continue;
    if (!m.parts?.length) expect(count(`${s.id}/${m.id}`), `${s.id}/${m.id}`).toBeGreaterThanOrEqual(2);
    for (const part of m.parts ?? []) expect(count(`${s.id}/${m.id}.${part.id}`), `${m.id}.${part.id}`).toBeGreaterThanOrEqual(1);
  }
});
test('every key phrase names its required words', () => {
  for (const s of STEPS) for (const m of s.mustHit) if (m.keyPhrase) expect(m.requiredWords?.length, m.id).toBeGreaterThan(0);
});

// What a fixture can't say: the required words a key phrase lacks (R7). Controller ruling: "stand by" is the standby.
test('"standby" and "stand by" both give the standby opener with no missing words', async () => {
  for (const line of ['FMV 123 to Ops Centre, standby message, over.', 'FMV 123 to Ops Centre, stand by message, over.']) {
    const { sentences } = await keywordGrader.interpret(line, ctxAt('notification'));
    expect(sentences.flatMap(s => s.points.map(p => [p.point, p.missing])), line).toEqual([['standby-opener', []]]);
  }
});
// Controller ruling (pre-review): tap mode plays step 17's canonical line, so it reads convince in both directions.
// Carry to Task 8: filled per case, the line names only the case's own direction ({positionAdvice}), and none where the
// position is ideal; it reads convince exactly where the position isn't ideal, and only step 17, in every case.
test("the Position canonical line, filled per case, reads convince exactly where the position isn't ideal, and only step 17", async () => {
  for (const c of CASES) {
    const position = STEPS.find(s => s.id === 'position')!;
    const line = fillCanonical(position.canonicalLine, c, 6, position.mustHit);
    const toward = c.findings.position.toward;
    expect(/sitting up/i.test(line), c.id).toBe(toward === 'sit-up');
    expect(/lying flat/i.test(line), c.id).toBe(toward === 'supine');
    const { sentences } = await keywordGrader.interpret(line, ctxAt('position', c.id));
    const points = sentences.flatMap(s => s.points.map(p => `${p.step}/${p.point}`));
    expect(points, c.id).toContain('position/ask-position');
    expect(points.includes('position/convince'), c.id).toBe(!c.findings.position.ideal);
    expect(points.filter(k => !k.startsWith('position/')), c.id).toEqual([]);
  }
});
test("each step's opening, said while the run is still on the step before, reads that step", async () => {
  const c = caseById('copd-amk-01');
  for (const s of STEPS.slice(1)) {
    const first = splitSentences(fillCanonical(s.canonicalLine, c, 6, s.mustHit))[0]!;
    const prev = STEPS[s.order - 2]!;
    const done = STEPS.filter(x => x.order <= prev.order)
      .flatMap(x => x.mustHit.filter(m => !m.when || conditionHolds(c, m.when)).map(m => `${x.id}/${m.id}`));
    const { sentences } = await keywordGrader.interpret(first, ctxAt(prev.id, c.id, 6, done));
    expect(sentences[0]!.step, `${s.id}: ${first}`).toBe(s.id);
  }
});
// Controller ruling for Task 8: every canonical line, filled per case and said on its own step, reads no other step.
test('each canonical line, filled per case and said on its own step, reads only that step', async () => {
  for (const c of CASES) for (const s of STEPS) {
    const { sentences } = await keywordGrader.interpret(fillCanonical(s.canonicalLine, c, 6, s.mustHit), ctxAt(s.id, c.id));
    const outside = sentences.flatMap(x => x.points.filter(p => p.step !== s.id).map(p => `${p.step}/${p.point} in "${x.text}"`));
    expect(outside, `${c.id} ${s.id}`).toEqual([]);
  }
});

// What a fixture can't say: the oxygen and ECG a sentence reports. Glued units, two devices and speech-to-text words
// (Task 5 carries; controller ruling on speech) must report the choice the trainee made, not only read the point.
test('glued units, two devices and spoken numbers report the choice named', async () => {
  const first = async (line: string, at: string, caseId?: string) => (await keywordGrader.interpret(line, ctxAt(at, caseId))).sentences[0]!;
  expect((await first('NRM 15L/min.', 'breathing', 'chestpain-bedok-01')).oxygen).toEqual({ device: 'non-rebreather', flow: 15, flowMax: null });
  // two devices in one sentence: the first named wins
  expect((await first('Change NRM to a nasal cannula 3 litres.', 'oxygen')).oxygen).toEqual({ device: 'non-rebreather', flow: 3, flowMax: null });
  expect((await first('Head buddy, NRM fifteen litres please.', 'breathing', 'chestpain-bedok-01')).oxygen)
    .toEqual({ device: 'non-rebreather', flow: 15, flowMax: null });
  expect((await first('Head buddy, fifteen litres per minute please.', 'breathing', 'chestpain-bedok-01')).oxygen)
    .toEqual({ device: null, flow: 15, flowMax: null });
  expect((await first('Nebuliser mask, six to eight litres.', 'breathing', 'asthma-tampines-01')).oxygen)
    .toEqual({ device: 'nebuliser-mask', flow: 6, flowMax: 8 });
  expect((await first('Connect the for lead ECG.', 'investigation', 'hypo-hougang-01')).ecg).toBe('4-lead');
  expect((await first('Twelve lead ECG please.', 'investigation', 'chestpain-bedok-01')).ecg).toBe('12-lead');
  // Fix round 1 (Minor 5): "for lead" only beside "ECG", and a written type beats it
  expect((await first('Get ready for lead placement, 12-lead ECG.', 'investigation', 'chestpain-bedok-01')).ecg).toBe('12-lead');
  expect((await first('Prepare for lead placement.', 'investigation', 'chestpain-bedok-01')).ecg).toBeNull();
});
// Fix round 1 (Important 3, carry (b)): the right device with a unit-less flow is the right choice, not Wrong.
test('a unit-less flow right after the device reads as the right choice', async () => {
  const lines = [['Head buddy, nasal cannula 2 to 4.', 'copd-amk-01'], ['Nebuliser mask at 6 to 8.', 'asthma-tampines-01'],
    ['NRM at 15.', 'chestpain-bedok-01'], ['Head buddy, NRM 15 please.', 'chestpain-bedok-01'],
    ['Head buddy, NRM, 15 please.', 'chestpain-bedok-01']] as const;   // fix round 2: a comma, as Gboard voice may insert
  for (const [line, caseId] of lines) {
    const s = (await keywordGrader.interpret(line, ctxAt('breathing', caseId))).sentences[0]!;
    expect(s.points.map(p => p.point), line).toContain('mask-flow');
    expect(s.oxygen?.flow, line).not.toBeNull();
    expect(oxygenRight(s.oxygen!, caseById(caseId).expected.oxygen), line).toBe(true);
  }
});
// Fix round 2 (re-review N1): a SRACIE with a mistyped, other or missing IC is a radio message, never "Who's this for?"
// (R8), and asking for the IC number is still asking for the IC.
test('a SRACIE with any IC form never reads the IC request, so it is never unclear', async () => {
  const sracie = (ic: string, sex = 'female / Chinese / 72', of = 'COPD due to low SpO2 and high RR') =>
    `FMV 123, requesting for Alpha for unstable case of ${sex} / case of ${of} / ${ic} / ETA 6 mins.`;
  const lines = [[sracie('IC no. S54xxxxA'), 'copd-amk-01'], [sracie('IC no. S12xxxxxB'), 'copd-amk-01'],
    [sracie('IC no. not available'), 'copd-amk-01'], [sracie('IC number S54xxxxA'), 'copd-amk-01'],
    [sracie('IC no. S68xxxxD', 'male / Malay / 58', 'AMI due to low SpO2 and high HR'), 'chestpain-bedok-01']] as const;
  for (const [line, caseId] of lines) {
    const { sentences } = await keywordGrader.interpret(line, ctxAt('notification', caseId));
    expect(sentences.map(s => s.addressee), line).not.toContain('unclear');
    expect(sentences.flatMap(s => s.points.map(p => p.point)), line).not.toContain('get-ic');
  }
  const ask = (await keywordGrader.interpret("Ma'am, may I have your IC number please?", ctxAt('notification'))).sentences;
  expect(ask.flatMap(s => s.points.map(p => p.point))).toEqual(['get-ic']);
});
// Fix round 1 (Important 4): the notes' BP announcement is the BP screening in every case, and step 14's own line still
// reads the arm buddy's BP.
test('the BP announcement reads the BP screening in every case, never the arm buddy BP', async () => {
  const announce = "Sir/Ma'am, I am going to take your blood pressure. May I know which arm I can take the BP from?";
  const armBuddy = STEPS.find(s => s.id === 'vital-signs')!.canonicalLine;
  const keys = async (line: string, at: string, id: string) => (await keywordGrader.interpret(line, ctxAt(at, id))).sentences
    .flatMap(s => s.points.flatMap(p => [`${p.step}/${p.point}`, ...p.parts.map(x => `${p.step}/${p.point}.${x}`)]));
  for (const c of CASES) {
    const got = await keys(announce, 'investigation', c.id);
    expect(got, c.id).toContain('investigation/bp-screen');
    expect(got.filter(k => !k.startsWith('investigation/')), c.id).toEqual([]);
    expect(await keys(armBuddy, 'vital-signs', c.id), c.id).toContain('vital-signs/arm-buddy.bp');
  }
});

// ---- Task 11b: the canonical lines say each case's conditional points -------------------------------------------

/** What a point needs read to be done: every part, or the point itself when it has none (classify's pointDone). */
const needs = (stepId: string, m: (typeof STEPS)[number]['mustHit'][number]) =>
  (m.parts ?? []).length > 0 ? (m.parts ?? []).map(p => ['parts', `${stepId}/${m.id}.${p.id}`] as const) : [['whole', `${stepId}/${m.id}`] as const];

// The brief's sweep: every canonical line, filled per case and typed through the real grader at its own step, reads every
// point and part that applies there, conditional ones included, with no key word missing (and, by the test above,
// nothing outside its step).
test('each canonical line, filled per case and said on its own step, reads every point and part that applies to the case', async () => {
  for (const c of CASES) for (const s of STEPS) {
    const read = readOf((await keywordGrader.interpret(fillCanonical(s.canonicalLine, c, 6, s.mustHit), ctxAt(s.id, c.id))).sentences);
    for (const m of s.mustHit.filter(x => !x.when || conditionHolds(c, x.when)))
      for (const [kind, key] of needs(s.id, m)) expect(read[kind].has(key), `${c.id}: ${key}`).toBe(true);
    expect(read.missing, `${c.id} ${s.id}`).toEqual([]);
  }
});
test('each say, said alone on its own step in every case where it applies, reads its own point and nothing new', async () => {
  for (const s of STEPS) for (const m of s.mustHit.filter(x => x.say !== undefined)) for (const c of CASES.filter(x => conditionHolds(x, m.when!))) {
    // the say as the case's line says it: Plan 3 T3 (D22) fills a slot it holds ("Buddy, immobilise the {limbWhere}.")
    const say = fillCanonical(m.say!, c, 6, s.mustHit);
    const { sentences } = await keywordGrader.interpret(say, ctxAt(s.id, c.id));
    const read = readOf(sentences);
    for (const [kind, key] of needs(s.id, m)) expect(read[kind].has(key), `${c.id}: ${say} → ${key}`).toBe(true);
    expect(read.missing, `${c.id} ${m.id}`).toEqual([]);
    expect(sentences.every(x => x.points.some(p => p.point === m.id)), `${c.id} ${m.id}: each sentence of the say reads it`).toBe(true);
    // anything else it reads is of its own step and already said by the line before the placeholder, so it moves no
    // point: "Arrest the bleeding first" re-reads the catastrophic-bleeding question, "Hypocount is below 4" the hypocount
    const others = sentences.flatMap(x => x.points.map(p => `${p.step}/${p.point}`)).filter(k => k !== `${s.id}/${m.id}`);
    const before = s.canonicalLine.slice(0, s.canonicalLine.indexOf(`{say:${m.id}}`));
    const said = (await keywordGrader.interpret(fillCanonical(before, c, 6, s.mustHit), ctxAt(s.id, c.id))).sentences
      .flatMap(x => x.points.map(p => `${p.step}/${p.point}`));
    expect(others.filter(k => !k.startsWith(`${s.id}/`) || !said.includes(k)), `${c.id} ${m.id}`).toEqual([]);
  }
});
test("the says change nothing the rest of the line reads, sentence by sentence", async () => {
  // each point a sentence reads: whole (!) or not, its parts, and the key words it lacks
  const keys = (x: { points: { step: string; point: string; parts: string[]; whole: boolean; missing: string[] }[] }) =>
    x.points.map(p => `${p.step}/${p.point}${p.whole ? '!' : ''} [${p.parts.join(',')}] -${p.missing.join(',')}`);
  for (const c of CASES) for (const s of STEPS.filter(x => x.canonicalLine.includes('{say:'))) {
    const says = new Set(s.mustHit.filter(m => m.say !== undefined && conditionHolds(c, m.when!))
      .flatMap(m => splitSentences(fillCanonical(m.say!, c, 6, s.mustHit))));
    const withSays = (await keywordGrader.interpret(fillCanonical(s.canonicalLine, c, 6, s.mustHit), ctxAt(s.id, c.id))).sentences;
    const bare = s.canonicalLine.replace(/\s*\{say:[^{}]*\}/g, '');
    const without = (await keywordGrader.interpret(fillCanonical(bare, c, 6, s.mustHit), ctxAt(s.id, c.id))).sentences;
    const rest = withSays.filter(x => !says.has(x.text));
    expect(rest.map(x => x.text), `${c.id} ${s.id}`).toEqual(without.map(x => x.text));
    expect(rest.map(keys), `${c.id} ${s.id}`).toEqual(without.map(keys));
  }
});

// ---- The final review's fix wave ---------------------------------------------------------------------------------

/** The Coached run of a case at step `at`, every step before it done, the clock running at 14:00, after `line`. */
const sendAt = async (caseId: string, at: string, line: string) => {
  const c = caseById(caseId);
  const step = STEPS.find(s => s.id === at)!;
  const done = hitAll(blankSession(caseId), STEPS, c, STEPS.filter(s => s.order < step.order).map(s => s.id));
  const s = { ...done, current: step.order, arrived: step.order > 2, clock: { started: true, bankedMs: 840_000, runningSince: T0 } };
  return (await sendLine(envOf(caseId), s, line, T0)).session;
};
/** The 'step/point.part' keys a line reads at `at` in a case. */
const keysAt = async (line: string, at: string, caseId = 'copd-amk-01', eta = 6) =>
  keysOf((await keywordGrader.interpret(line, ctxAt(at, caseId, eta))).sentences);

// I1: any total from 3 to 15 is a GCS score beside "GCS", and none outside it; each E, V or M figure in its range
// credits its own part (spaced or glued), and never the score.
test('"GCS {n}" credits the GCS score for every total from 3 to 15, and no other', async () => {
  for (let n = 3; n <= 15; n++) for (const line of [`GCS ${n}.`, `GCS of ${n}.`, `GCS: ${n}.`, `GCS:${n}`, `GCS${n}`])
    expect(await keysAt(line, 'vital-signs'), line).toContain('vital-signs/gcs.score');
  for (const line of ['GCS 1.', 'GCS 2.', 'GCS 16.', 'GCS 20.', 'GCS2', 'GCS16', 'GCS:2', 'GCS:16'])
    expect(await keysAt(line, 'vital-signs'), line).not.toContain('vital-signs/gcs.score');
});
// Residual N3: a figure counts only beside "GCS" or a sibling figure, so a lone one ("V1" of the ECG's chest leads) is none.
test('each E, V and M figure in its range credits its own GCS part beside "GCS" or a sibling figure, never alone or as the score', async () => {
  const SIBLING = { e: 'V5', v: 'M6', m: 'E4' } as const;
  for (const [letter, part, most] of [['e', 'eyes', 4], ['v', 'verbal', 5], ['m', 'motor', 6]] as const) {
    for (let n = 1; n <= most; n++) {
      for (const line of [`GCS ${letter}${n}.`, `${letter.toUpperCase()}${n} ${SIBLING[letter]}`]) {
        const got = await keysAt(line, 'vital-signs');
        expect(got, line).toContain(`vital-signs/gcs.${part}`);
        expect(got, line).not.toContain('vital-signs/gcs.score');
      }
      const alone = `${letter.toUpperCase()}${n}`;
      expect([...await keysAt(alone, 'vital-signs')], alone).toEqual([]);
    }
  }
  for (const line of ['E5', 'V6', 'M7', 'GCS E5.', 'E5 V6 M7']) expect([...await keysAt(line, 'vital-signs')], line).toEqual([]);
});
// Residual N3: the notes' chest-lead placement, said at step 13 in each 12-lead case, credits no GCS part and gets no
// patient reply.
test('"Chest leads V1 to V6 placed." at step 13 in the 12-lead cases reads no GCS, and the patient says nothing', async () => {
  const twelveLead = CASES.filter(c => c.expected.ecg === '12-lead');
  expect(twelveLead.map(c => c.id)).toEqual(['copd-amk-01', 'chestpain-bedok-01', 'ccf-jurong-01', 'asthma-tampines-01', 'toothache-clementi-01']);
  for (const c of twelveLead) {
    const s = await sendAt(c.id, 'investigation', 'Chest leads V1 to V6 placed.');
    expect(Object.keys(s.parts).filter(k => k.startsWith('vital-signs/')), c.id).toEqual([]);
    expect(s.hits['vital-signs/gcs'], c.id).toBeUndefined();
    expect(s.lines.filter(l => l.who === 'patient'), c.id).toEqual([]);   // the run's only lines before it are the trainee's
  }
});

// I2: which arm. Only bleed and CCF rule an arm out (data-integrity pins which); elsewhere either arm, said with or
// without "arm", is the BP arm. Plan 3 T2 (D23): the arm a patient rules out is read too, as the arm said, so the run
// grades it Wrong (run-engine.test.ts) instead of playing the arm buddy's step-14 BP early.
test('the BP arm reads either arm in every case, as the arm said; only the arm offered is right where one is ruled out', async () => {
  for (const c of CASES) for (const arm of ['left', 'right'] as const) {
    const allowed = c.findings.investigation.bpArmRestricted !== true || c.findings.investigation.bpArm === arm;
    expect(caseSlots(c, 6).bparm.includes(arm), `${c.id}: ${arm}`).toBe(allowed);
    for (const line of [`Taking the BP on the ${arm} arm.`, `BP on the ${arm}.`, `Blood pressure on the ${arm}.`]) {
      const { sentences } = await keywordGrader.interpret(line, ctxAt('investigation', c.id));
      const got = keysOf(sentences);
      expect(got.has('investigation/bp-arm'), `${c.id}: ${line}`).toBe(true);
      expect(sentences.map(s => s.arm), `${c.id}: ${line}`).toEqual([arm]);
      // read as the BP arm, it is the investigation's, not the arm buddy's step-14 BP
      expect(got.has('vital-signs/arm-buddy.bp'), `${c.id}: ${line}`).toBe(false);
    }
  }
});

// I3, and residual N2: "F" and "M" are a sex only right before a race word, so the "m" in E/V/M, "6 m", "6 m," or "2 m/"
// and the "f" of "f/u" never are, at any step of any case; nor does such a line route to Ops Ctr.
const SRACIE_NO_SEX = 'Requesting Alpha for unstable case of Chinese / 72 / case of COPD due to low SpO2 and high RR / IC no. S54xxxxxA / ETA 6 m.';
const NOT_SEX = ['He fell about 6 m, hit his head.', 'Fell from 6 m, landed on his back.', 'Fell 2 m/ off a ladder.', 'Will f/u with Ops.'];
test('the "m" of E4V5M6, "6 m", "6 m," or "2 m/", and the "f" of "f/u", credit no sex, at any step of any case', async () => {
  const lines = ['GCS E4V5M6.', 'E4 V5 M6', 'GCS E4V5M6 = 15.', 'ETA 6 m.', 'ETA 6 m', 'He fell about 6 m.', 'Fell from 6 m height.',
    SRACIE_NO_SEX, ...NOT_SEX, 'ETA 6 m, over.', 'E4 V5 M, 6', 'Head buddy, NRM 15 L/min, m, ok?', SRACIE_NO_SEX.replace('6 m.', '6 m, over.'),
    SRACIE_NO_SEX.replace('6 m.', '6 m/ over.')];
  for (const c of CASES) for (const s of STEPS) for (const line of lines)
    expect(await keysAt(line, s.id, c.id), `${c.id} ${s.id}: ${line}`).not.toContain('notification/sracie.sex');
});
test('a lone "m," "m/" or "f/" outside the SRACIE never routes to Ops Ctr, at any step of any case', async () => {
  for (const c of CASES) for (const st of STEPS) for (const line of NOT_SEX) {
    const s = await sendAt(c.id, st.id, line);
    const mine = s.lines.filter(l => l.who === 'you').at(-1)!;
    expect(mine.route ?? '', `${c.id} ${st.id}: ${line}`).not.toContain('To Ops Ctr');
    expect(s.lines.at(-1)!.who, `${c.id} ${st.id}: ${line}`).not.toBe('opsCtr');
    expect(Object.keys(s.parts).filter(k => k.startsWith('notification/')), `${c.id} ${st.id}: ${line}`).toEqual([]);
  }
});
