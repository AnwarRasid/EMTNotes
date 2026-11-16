import { CASES, STEPS, caseById } from './sim-helpers';
import { conditionHolds, type Case, type Reply, type Step } from '../../src/data/schema';
import type { OxygenGiven, Speaker } from '../../src/progress/types';
import {
  ROLE_LABEL, activationText, fillCanonical, findingSpeech, joinSigns, oneDecimal, readingsSpeech, replyText, speakerLabel,
  vitalsPhase, type ReplyEnv,
} from '../../src/sim/replies';
import { splitSentences } from '../../src/sim/match';

const copd = caseById('copd-amk-01');
const env = (o: Partial<ReplyEnv> = {}): ReplyEnv => ({ case: copd, oxygen: null, eta: 6, ...o });
const NC = { device: 'nasal-cannula', flow: 3, atMs: 0, right: true } as const;
const SFM = { device: 'simple-face-mask', flow: 6, atMs: 0, right: false } as const;
/** The step's canonical line filled for the case, its {say:…} placeholders from the step's own points (Task 11b). */
const filled = (stepId: string, c: Case, eta = 6) => {
  const s = STEPS.find(x => x.id === stepId)!;
  return fillCanonical(s.canonicalLine, c, eta, s.mustHit);
};
test('speakers are named as the chat shows them', () => {
  expect(['you', 'system', 'patient', 'caller', 'armBuddy', 'opsCtr'].map(w => speakerLabel(w as Speaker, copd)))
    .toEqual(['You', 'Dispatch', 'Mdm Tan, patient', 'Caller, son', 'Arm buddy', 'Ops Ctr']);
});
test('findings are spoken plainly', () => {
  expect(findingSpeech(copd, 'findings.breathing.ntucp')).toBe('Use of accessory muscles, pursed lips.');
  expect(findingSpeech(caseById('hypo-hougang-01'), 'findings.breathing.ntucp'))
    .toBe('No nasal flaring, tracheal tugging, accessory muscle use, cyanosis or pursed lips.');
  expect(findingSpeech(copd, 'findings.rbs.pockets')).toBe('In the pockets: inhaler, IC.');
  expect(findingSpeech(copd, 'findings.rbs.jvd')).toBe('No JVD.');
  expect(findingSpeech(caseById('ccf-jurong-01'), 'findings.rbs.pedalEdema')).toBe('Pedal oedema present.');
  expect(findingSpeech(copd, 'findings.investigation.ecg')).toBe('12-lead: Sinus tachycardia about 112, no ST changes.');
  expect(findingSpeech(copd, 'findings.investigation.hypocount')).toBe('Hypocount 6.8 mmol/L.');
  expect(findingSpeech(copd, 'caller.answers.vehicles')).toBeNull();
});
test('readings follow the oxygen: room air, the right mask, or no improvement on the wrong one', () => {
  expect(readingsSpeech(['spo2'], env())).toEqual({ text: 'SpO2 86% on room air.', readings: [{ key: 'spo2', value: '86', o2: 'RA' }] });
  expect(readingsSpeech(['spo2'], env({ oxygen: NC })).text).toBe('SpO2 90% on nasal cannula.');
  expect(readingsSpeech(['spo2'], env({ oxygen: SFM })).text).toBe('SpO2 86% on simple face mask.');
  expect(readingsSpeech(['spo2', 'pr', 'bp', 'crt'], env({ oxygen: NC })).text).toBe('SpO2 90% on nasal cannula. PR 112. BP 146/86. CRT under 2 s.');
  expect(readingsSpeech(['temp', 'rr', 'skin'], env()).text).toBe('Temp 37.2°C. RR 28. Skin pale, warm, sweaty.');
});
test('computed replies', () => {
  expect(replyText({ role: 'tester', computed: 'eta', on: ['standby-opener'] }, env())!.text).toBe('ETA 6 mins.');
  expect(replyText({ role: 'tester', computed: 'eta', on: ['standby-opener'] }, env({ eta: 1 }))!.text).toBe('ETA 1 min.');
  expect(replyText({ role: 'tester', computed: 'ic', on: ['get-ic'] }, env())!.text).toBe('IC card: Tan Ah Mui, S54xxxxxA.');
  expect(replyText({ role: 'headBuddy', computed: 'oxygen', on: ['mask-flow'] }, env({ oxygen: NC }))!.text).toBe('Nasal cannula on, 3 L/min.');
  expect(replyText({ role: 'headBuddy', computed: 'oxygen', on: ['mask-flow'] }, env())).toBeNull();
});
test('canonical lines fill from the case', () => {
  expect(filled('notification', copd)).toContain(
    'requesting for Alpha for unstable case of female / Chinese / 72 / case of COPD due to low SpO2 and high RR / IC no. S54xxxxxA / ETA 6 mins.');
  expect(filled('investigation', caseById('ccf-jurong-01'))).toContain('Taking the BP on the right arm.');
  expect(joinSigns(['low blood sugar', 'high HR', 'low GCS'])).toBe('low blood sugar, high HR and low GCS');
  expect(activationText(copd)).toBe('Activation: Elderly female, breathlessness. Blk 2xx Ang Mo Kio Ave 3, #07-xx.');
});

// ---- Beyond the brief's tests: the rest of the Interfaces block, and the rulings that bind Task 8 ----------------

test('every role has its chat label, and the buddies and tester speak under it', () => {
  expect(ROLE_LABEL).toEqual({ opsCtr: 'Ops Ctr', caller: 'Caller', patient: 'Patient', headBuddy: 'Head buddy', armBuddy: 'Arm buddy', tester: 'Tester' });
  expect((['headBuddy', 'tester'] as const).map(w => speakerLabel(w, copd))).toEqual(['Head buddy', 'Tester']);
  expect(speakerLabel('patient', caseById('chestpain-bedok-01'))).toBe('Encik Ahmad, patient');
  expect(speakerLabel('caller', caseById('rta-toapayoh-01'))).toBe('Caller, passer-by');
});
test('readings move to after-O2 only for a right oxygen that is not none', () => {
  expect(vitalsPhase(null)).toBe('roomAir');
  expect(vitalsPhase(NC)).toBe('afterO2');
  expect(vitalsPhase(SFM)).toBe('roomAir');
  expect(vitalsPhase({ device: 'none', flow: null, atMs: 0, right: true })).toBe('roomAir');   // the hypo case: oxygen optional
  expect(vitalsPhase({ device: 'nasal-cannula', flow: null, atMs: null, right: true })).toBe('afterO2');
});
test('each reading is recorded with its key and value; only SpO2 names the oxygen', () => {
  expect(readingsSpeech(['spo2', 'pr', 'temp'], env({ oxygen: NC })).readings).toEqual([
    { key: 'spo2', value: '90', o2: 'NC' }, { key: 'pr', value: '112', o2: null }, { key: 'temp', value: '37.2', o2: null }]);
  expect(readingsSpeech(['spo2'], env({ oxygen: SFM })).readings).toEqual([{ key: 'spo2', value: '86', o2: 'SFM' }]);
  const none = { device: 'none', flow: null, atMs: 0, right: true } as const;
  expect(readingsSpeech(['spo2'], { case: caseById('hypo-hougang-01'), oxygen: none, eta: 6 }))
    .toEqual({ text: 'SpO2 97% on room air.', readings: [{ key: 'spo2', value: '97', o2: 'RA' }] });
  const nrm = { device: 'non-rebreather', flow: 15, atMs: 0, right: true } as const;
  expect(readingsSpeech(['spo2'], { case: caseById('chestpain-bedok-01'), oxygen: nrm, eta: 6 }).text).toBe('SpO2 98% on non-rebreather mask.');
});
// Ruling P21: the hypocount reply carries its reading, so the vitals rail shows it in a live run.
test('the hypocount reply adds a hypocount reading; other findings and text replies add none', () => {
  const hypo: Reply = { role: 'tester', finding: 'findings.investigation.hypocount', on: ['hypocount'] };
  expect(replyText(hypo, env())).toEqual({ text: 'Hypocount 6.8 mmol/L.', readings: [{ key: 'hypocount', value: '6.8', o2: null }] });
  expect(replyText(hypo, { case: caseById('hypo-hougang-01'), oxygen: null, eta: 6 })!.readings)
    .toEqual([{ key: 'hypocount', value: '2.6', o2: null }]);
  // Fix round 1 (Important 1): a glucometer shows one decimal, so the RTA case's 6.0 is never "6"
  expect(replyText(hypo, { case: caseById('rta-toapayoh-01'), oxygen: null, eta: 6 }))
    .toEqual({ text: 'Hypocount 6.0 mmol/L.', readings: [{ key: 'hypocount', value: '6.0', o2: null }] });
  expect(replyText({ role: 'tester', finding: 'findings.investigation.bp', on: ['bp-arm'] }, env())).toEqual({ text: 'BP 148/88 mmHg.', readings: [] });
  expect(replyText({ role: 'opsCtr', text: 'Ops Ctr, roger.', on: ['call-sign'] }, env())).toEqual({ text: 'Ops Ctr, roger.', readings: [] });
  expect(replyText({ role: 'armBuddy', vitals: ['spo2'], on: ['spo2'] }, env())!.readings).toEqual([{ key: 'spo2', value: '86', o2: 'RA' }]);
  expect(replyText({ role: 'caller', finding: 'caller.answers.vehicles', on: ['vehicles'] }, env())).toBeNull();
});
test('the oxygen reply names the device, with its flow when there is one', () => {
  const oxygen: Reply = { role: 'headBuddy', computed: 'oxygen', on: ['mask-flow'] };
  expect(replyText(oxygen, env({ oxygen: SFM }))!.text).toBe('Simple face mask on, 6 L/min.');
  expect(replyText(oxygen, env({ oxygen: { device: 'non-rebreather', flow: null, atMs: 0, right: false } }))!.text).toBe('Non-rebreather mask on.');
  expect(replyText(oxygen, env({ oxygen: { device: 'none', flow: null, atMs: 0, right: false } }))!.text).toBe('No oxygen for now.');
  expect(replyText(oxygen, env({ oxygen: { device: 'bvm', flow: 15, atMs: 0, right: false } }))!.text).toBe('BVM on, 15 L/min.');
  expect(replyText(oxygen, env({ oxygen: NC }))!.readings).toEqual([]);
});
test('a string finding is spoken as written, finished as a sentence when the case writes a bare phrase', () => {
  expect(findingSpeech(copd, 'patient.lines.fall')).toBe('No... never fall.');
  expect(findingSpeech(caseById('hypo-hougang-01'), 'findings.loc.response')).toBe('Yes... can hear. Sorry... who are you ah?');
  expect(findingSpeech(copd, 'findings.breathing.rateQuality')).toBe('Fast and shallow.');
  expect(findingSpeech(copd, 'findings.scene.description')).toBe('Cramped living room, fan on.');
  expect(findingSpeech(caseById('chestpain-bedok-01'), 'findings.airway.smell')).toBe('Minty smell (GTN).');
  expect(findingSpeech(caseById('ccf-jurong-01'), 'findings.rbs.jvd')).toBe('JVD present.');
  expect(findingSpeech(copd, 'findings.rbs.pedalEdema')).toBe('No pedal oedema.');
  expect(findingSpeech(copd, 'findings.investigation.bp')).toBe('BP 148/88 mmHg.');
  expect(findingSpeech(copd, 'findings.scene.items')).toBe('Two inhalers, tissues.');
  expect(findingSpeech(copd, 'findings.no.such.path')).toBeNull();
});
// Fix round 1 (Minor 1): the limb and bleed-control findings exist only in their own cases, and are null everywhere else.
test('a finding a case does not have is null: limb findings outside a limb injury, bleed control outside a bleed', () => {
  const limb = ['findings.rbs.limb.injury', 'findings.rbs.limb.where', 'findings.rbs.limb.distalPulse', 'findings.rbs.limb.immobilise'];
  const control = ['findings.approach.control.pressure', 'findings.approach.control.dressing', 'findings.approach.control.cat'];
  for (const c of CASES) {
    for (const p of limb) expect(findingSpeech(c, p) === null, `${c.id} ${p}`).toBe(!c.flags.includes('limbInjury'));
    for (const p of control) expect(findingSpeech(c, p) === null, `${c.id} ${p}`).toBe(!c.findings.approach.catastrophicBleeding);
  }
  // Plan 3 T3: the leg bleed has both, a limb injury and catastrophic bleeding
  expect(CASES.filter(c => findingSpeech(c, limb[2]!) !== null).map(c => c.id)).toEqual(['rta-toapayoh-01', 'legbleed-punggol-01']);
  expect(CASES.filter(c => findingSpeech(c, control[2]!) !== null).map(c => c.id)).toEqual(['bleed-woodlands-01', 'legbleed-punggol-01']);
});
// Fix round 1 (Important 1, Minor 2): hypocounts and temperatures always show one decimal, through one formatter.
test('hypocounts and temperatures show one decimal', () => {
  expect([6, 6.8, 2.6, 37, 36.2].map(oneDecimal)).toEqual(['6.0', '6.8', '2.6', '37.0', '36.2']);
  expect(findingSpeech(caseById('rta-toapayoh-01'), 'findings.investigation.hypocount')).toBe('Hypocount 6.0 mmol/L.');
  const temp37 = (v: Case['vitals']['roomAir']) => ({ ...v, temp: 37 });
  const t37: Case = { ...copd, vitals: { roomAir: temp37(copd.vitals.roomAir), afterO2: temp37(copd.vitals.afterO2) } };
  for (const oxygen of [null, NC])
    expect(readingsSpeech(['temp', 'rr'], { case: t37, oxygen, eta: 6 }))
      .toEqual({ text: 'Temp 37.0°C. RR 28.', readings: [{ key: 'temp', value: '37.0', o2: null }, { key: 'rr', value: '28', o2: null }] });
});
test('an empty list is spoken as what was not found', () => {
  const bare: Case = { ...copd, findings: { ...copd.findings,
    scene: { ...copd.findings.scene, items: [], hazards: [] }, rbs: { ...copd.findings.rbs, pockets: [] } } };
  expect(['findings.scene.hazards', 'findings.rbs.pockets', 'findings.scene.items'].map(p => findingSpeech(bare, p)))
    .toEqual(['No hazards.', 'Nothing in the pockets.', 'Nothing of note.']);
});
test('signs join as a spoken list', () => {
  expect(joinSigns([])).toBe('');
  expect(joinSigns(['low BP'])).toBe('low BP');
  expect(joinSigns(['low SpO2', 'high RR'])).toBe('low SpO2 and high RR');
});
test('every canonical slot fills from the case, so no filled line keeps a brace or an undefined', () => {
  for (const c of CASES) for (const s of STEPS) {
    const line = fillCanonical(s.canonicalLine, c, 6, s.mustHit);
    expect(line, `${c.id} ${s.id}`).not.toMatch(/[{}]|undefined|null|NaN/);
  }
  const respond = filled('respond-call', copd);
  expect(respond).toBe('FMV 123 to Ops Ctr, responding to Blk 2xx Ang Mo Kio Ave 3, #07-xx for case of elderly female, breathlessness.');
  expect(fillCanonical('{chiefComplaint}, {sex}, {race}, {age}, {ic}, ETA {eta}, {bpArm} arm, suspected {suspected}', copd, 4, []))
    .toBe('breathlessness, female, Chinese, 72, S54xxxxxA, ETA 4, left arm, suspected COPD');
});
// Task 10 canonical call slot ruling: step 2 asks the case's extra questions (notes s01 Call), right after "conscious or
// unconscious?", in this order; with none the line reads as before, with no stray space.
test('{callExtras}: the call asks the breathing when unconscious, the critical injuries in trauma, the vehicles in an RTA', () => {
  const call = STEPS.find(s => s.id === 'call-caller')!.canonicalLine;
  const extras = (c: Case) => filled('call-caller', c).replace(/^.*unconscious\? /, '').replace(/ ?Please prepare.*$/, '');
  const rta = caseById('rta-toapayoh-01');
  expect(extras(copd)).toBe('');
  expect(extras({ ...copd, flags: [...copd.flags, 'unconscious'] })).toBe('Is the patient breathing?');
  expect(extras(caseById('bleed-woodlands-01'))).toBe('Any critical injuries present?');
  expect(extras(rta)).toBe('Any critical injuries present? What vehicles are involved in the accident?');
  expect(extras({ ...rta, flags: [...rta.flags, 'unconscious'] }))
    .toBe('Is the patient breathing? Any critical injuries present? What vehicles are involved in the accident?');
  // empty, the slot goes with its space; a slot inside a sentence still drops that sentence
  expect(filled('call-caller', copd)).toBe(call.replace(' {callExtras}', ''));
  expect(fillCanonical('{callExtras} Next.', copd, 6, [])).toBe('Next.');
  expect(fillCanonical('One. Ask {callExtras} now. Two.', copd, 6, [])).toBe('One. Two.');
});
// Fix round 1 (Important 2): the call text reads as part of the sentence it is filled into, but an acronym keeps its
// capitals, and the call text keeps its capital where it starts a sentence (and in the activation line).
test('the call text takes a lowercase first letter mid-sentence, never at a sentence start or in an acronym', () => {
  expect(filled('scene-evaluation', caseById('rta-toapayoh-01'))).toContain('MOI is suspected case of motorcyclist down after a collision with a car.');
  for (const c of CASES) for (const s of STEPS) {
    const at = s.canonicalLine.indexOf('{callText}');
    if (at > 0) expect(fillCanonical(s.canonicalLine, c, 6, s.mustHit), `${c.id} ${s.id}`).toContain(` ${c.callText.charAt(0).toLowerCase()}${c.callText.slice(1)}`);
  }
  const rtaCall: Case = { ...copd, callText: 'RTA, motorcyclist down' };
  expect(filled('respond-call', rtaCall)).toContain('for case of RTA, motorcyclist down.');
  expect(fillCanonical('{callText}. Copy. {callText}? Yes! {callText}; then {callText}.', copd, 6, [])).toBe(
    'Elderly female, breathlessness. Copy. Elderly female, breathlessness? Yes! Elderly female, breathlessness; then elderly female, breathlessness.');
  expect(activationText(caseById('rta-toapayoh-01'))).toBe('Activation: Motorcyclist down after a collision with a car. Lorong 6 Toa Payoh, bus stop near Toa Payoh Central.');
});
// Fix round 1 (Minor 3): tap mode's SRACIE says "ETA 1 min." at one minute, as the computed reply does.
test('the canonical ETA says "1 min" at one minute and "mins" otherwise', () => {
  expect(filled('notification', copd, 1)).toMatch(/ \/ ETA 1 min\.$/);
  expect(filled('notification', copd, 2)).toMatch(/ \/ ETA 2 mins\.$/);
  expect(filled('notification', copd, 10)).toMatch(/ \/ ETA 10 mins\.$/);
  expect(fillCanonical('Reassess every 5 mins. ETA {eta} mins.', copd, 1, [])).toBe('Reassess every 5 mins. ETA 1 min.');   // only the ETA's unit
});
// Carry to Task 8: tap mode tells each patient only their own direction, and says nothing of it where the position is ideal.
test('the Position canonical line gives each patient only their own direction', () => {
  const ask = "Sir/Ma'am, which position is the most comfortable for you?";
  expect(filled('position', caseById('chestpain-bedok-01')))
    .toBe(`${ask} If that position is not ideal: sitting up will make it easier for you to breathe.`);
  expect(filled('position', caseById('bleed-woodlands-01')))
    .toBe(`${ask} If that position is not ideal: lying flat is better for your low blood pressure.`);
  for (const c of CASES.filter(x => x.findings.position.ideal)) expect(filled('position', c), c.id).toBe(ask);
});

// ---- Task 11b: each case's conditional sentences, {say:<pointId>} ------------------------------------------------

/** The 11 conditional points that carry their words (MustHit.say): step, point, a case where it applies, one where not. */
const SAYS = [
  ['preparation', 'extra-ppe', 'rta-toapayoh-01', 'copd-amk-01'],
  ['approach-patient', 'bleeding-control', 'bleed-woodlands-01', 'copd-amk-01'],
  ['delicate-spine', 'release-grip', 'copd-amk-01', 'fall-yishun-01'],
  ['delicate-spine', 'c-collar', 'fall-yishun-01', 'rta-toapayoh-01'],
  ['airway', 'head-tilt-chin-lift', 'rta-toapayoh-01', 'fall-yishun-01'],
  ['airway', 'jaw-thrust', 'fall-yishun-01', 'copd-amk-01'],
  ['breathing', 'monitor-closely', 'asthma-tampines-01', 'ccf-jurong-01'],
  ['rapid-body-survey', 'distal-pulse', 'rta-toapayoh-01', 'bleed-woodlands-01'],
  ['rapid-body-survey', 'immobilise', 'rta-toapayoh-01', 'fall-yishun-01'],
  ['rapid-body-survey', 'c-collar-after-rbs', 'rta-toapayoh-01', 'fall-yishun-01'],
  ['investigation', 'suspected-hypo', 'hypo-hougang-01', 'copd-amk-01'],
] as const;
const stepOf = (id: string) => STEPS.find(s => s.id === id)!;
const pointOf = (stepId: string, id: string) => stepOf(stepId).mustHit.find(m => m.id === id)!;
/** What a filled line must never show: a brace, a doubled or stray space, an empty sentence, a stop after a space. */
const CLEAN = /[{}]|\s{2}|^\s|\s$|[.?!:]\s*[.?!]|\s[.,?!]/;

test.each(SAYS)('{say:…} of %s/%s is said where it applies (%s), and leaves no trace where it does not (%s)', (stepId, id, yes, no) => {
  const m = pointOf(stepId, id);
  expect(m.say, id).toBeDefined();
  // Plan 3 T3 (D22): a say may hold a canonical slot ("Buddy, immobilise the {limbWhere}."), filled from the case
  const say = fillCanonical(m.say!, caseById(yes), 6, stepOf(stepId).mustHit);
  expect(say).not.toMatch(CLEAN);
  expect([conditionHolds(caseById(yes), m.when!), conditionHolds(caseById(no), m.when!)]).toEqual([true, false]);
  const said = filled(stepId, caseById(yes));
  expect(said).toContain(` ${say}`);
  expect(said).not.toMatch(CLEAN);
  for (const sentence of splitSentences(say)) expect(splitSentences(said), sentence).toContain(sentence);   // sentences of its own
  const left = filled(stepId, caseById(no));
  expect(left).not.toContain(say);
  expect(left).not.toContain(m.say!.split('{')[0]!);   // nor the say's words before any slot ("Buddy, immobilise the ")
  expect(left).not.toMatch(CLEAN);
  // just as if the line had no placeholder there
  const without = stepOf(stepId).canonicalLine.replace(new RegExp(`\\s*\\{say:${id}\\}`), '');
  expect(left).toBe(fillCanonical(without, caseById(no), 6, stepOf(stepId).mustHit));
});
test('the conditional sentences sit where the notes order them, and each case says exactly one of each pair', () => {
  const bleed = caseById('bleed-woodlands-01');
  const fall = caseById('fall-yishun-01');
  const rta = caseById('rta-toapayoh-01');
  // step 5 (ruling P07): the bleeding control right after the catastrophic-bleeding question, before the hazards
  expect(filled('approach-patient', bleed)).toBe('Approaching casualty from the front. If you can hear me, please do not move your head. '
    + 'Is there any catastrophic bleeding? Buddy, expose and examine. Arrest the bleeding first: direct pressure followed by secondary '
    + "pressure dressing, and apply C.A.T. if still bleeding. Any hazards around the patient? Remove any hazards. Never move the patient's head.");
  // step 8 after the palpation, step 9 after checking the mouth: the C-collar or the release, the jaw thrust or the head tilt
  const palpate = 'Palpating the back of the neck for deformities, tenderness, bruises and lacerations.';
  expect(filled('delicate-spine', fall)).toMatch(new RegExp(`${palpate} Establish neutral position, measure & apply C-collar\\.$`));
  expect(filled('delicate-spine', rta)).toMatch(new RegExp(`${palpate} No suspected spinal injuries, buddy remove head grip\\.$`));
  const mouth = 'Checking the mouth for any obstacles.';
  const smell = 'Smelling for unusual breath smells: GTN, alcohol or fruity smell.';
  expect(filled('airway', fall)).toContain(`${mouth} Using modified jaw thrust. ${smell}`);
  expect(filled('airway', rta)).toContain(`${mouth} Using head tilt, chin lift. ${smell}`);
  for (const c of CASES) {
    const spine = filled('delicate-spine', c);
    const airway = filled('airway', c);
    expect([spine.includes('C-collar'), spine.includes('head grip.')], c.id).toEqual(conditionHolds(c, 'neckPain') ? [true, false] : [false, true]);
    expect([airway.includes('jaw thrust'), airway.includes('head tilt')], c.id).toEqual(conditionHolds(c, 'spinal') ? [true, false] : [false, true]);
  }
  // step 3 between the gloves and the equipment; step 10 right after the lung history; step 13 after the hypocount
  expect(filled('preparation', rta)).toBe('Crew, please don latex gloves & face mask. Wear RTA vests, helmets, raincoats & PPE gowns for precautions. '
    + 'Bring the B.B.O.L.T.Z.: burn kit, blanket & canvas, O2 bag, LSU, trauma bag and Zoll.');
  expect(filled('breathing', copd)).toContain('emphysema? I will monitor the patient closely after giving oxygen. Is there any cyanosis');
  expect(filled('investigation', caseById('hypo-hougang-01'))).toMatch(/Checking the hypocount\. Hypocount is below 4, suspected hypoglycaemia\.$/);
  // step 12: the distal pulse and the immobilisation after the abnormalities, the C-collar after the RBS is done
  expect(filled('rapid-body-survey', rta)).toBe("Sir/Ma'am, I'm going to conduct a Rapid Body Survey to check for any life or limb threatening "
    + 'injuries. Please allow me. If you feel any pain or discomfort, please sound out. Head, neck, chest, abdomen, pelvis, lower extremities, '
    + 'upper extremities and back, with eye contact. Checking my gloves for sweat or blood. Are there any abnormalities noted? Checking '
    + "distal pulses of injured limbs. Buddy, immobilise the right leg. Checking for JVD at 45° and pedal edema. Sir/Ma'am, may I check your "
    + 'pockets for any medications, IC and Medic Awas tag? Establish neutral position, measure & apply C-collar.');
});
test('{say:…}: a placeholder at the start, beside another or at the end goes with its space; one with no say to give throws', () => {
  const points = [pointOf('delicate-spine', 'release-grip'), pointOf('delicate-spine', 'c-collar')];
  const [grip, collar] = points.map(p => p.say!);
  const fall = caseById('fall-yishun-01');
  expect(fillCanonical('{say:c-collar} One.', copd, 6, points)).toBe('One.');
  expect(fillCanonical('{say:release-grip} One.', copd, 6, points)).toBe(`${grip} One.`);
  expect(fillCanonical('One. {say:c-collar}', copd, 6, points)).toBe('One.');
  expect(fillCanonical('One. {say:c-collar} {say:release-grip} Two.', copd, 6, points)).toBe(`One. ${grip} Two.`);
  expect(fillCanonical('One. {say:release-grip} {say:c-collar} Two.', copd, 6, points)).toBe(`One. ${grip} Two.`);
  expect(fillCanonical('One. {say:c-collar} {say:release-grip} Two.', fall, 6, points)).toBe(`One. ${collar} Two.`);
  // the other slots fill as before around it
  expect(fillCanonical('Taking the BP on the {bpArm} arm. {say:c-collar} ETA {eta} mins.', copd, 1, points)).toBe('Taking the BP on the left arm. ETA 1 min.');
  expect(() => fillCanonical('One. {say:c-collar}', copd, 6, [])).toThrow('{say:c-collar}');
  expect(() => fillCanonical('One. {say:ask-fall}', copd, 6, stepOf('delicate-spine').mustHit)).toThrow('{say:ask-fall}');
});

// ---- The reply sweep: every reply in steps.json, for every case ------------------------------------------------

/** Whether a reply plays in a case: some trigger names a point whose condition holds there. */
const applies = (c: Case, s: Step, r: Reply) => r.on.some(on => {
  const m = s.mustHit.find(p => p.id === on.split('.')[0]);
  return m !== undefined && (m.when === undefined || conditionHolds(c, m.when));
});
/** What reads as a spoken sentence: a capital or digit first, a stop last, no stray value, no doubled stop. */
const expectSentence = (text: string, why: string) => {
  expect(text, why).toMatch(/^[A-Z0-9]/);
  expect(text, why).toMatch(/[.!?]$/);
  expect(text, why).not.toMatch(/undefined|null|NaN|\[object|\{|\}/);
  expect(text, why).not.toMatch(/(^|[^.])\.\.(?!\.)|[!?,;:]\.|\s[.,]|\s{2}/);
};
const rightOxygen = (c: Case): OxygenGiven => ({ device: c.expected.oxygen.device, flow: c.expected.oxygen.flowMin, atMs: 0, right: true });
test('every reply speaks a sentence in every case where it plays, and every finding it reads exists there', () => {
  for (const c of CASES) for (const s of STEPS) for (const r of s.replies) {
    for (const oxygen of [null, rightOxygen(c)]) {
      const spoken = replyText(r, { case: c, oxygen, eta: 6 });
      const why = `${c.id} ${s.id} ${JSON.stringify(r)} ${oxygen?.device ?? 'no oxygen'}`;
      if ('computed' in r && r.computed === 'oxygen' && oxygen === null) { expect(spoken, why).toBeNull(); continue; }
      if (applies(c, s, r)) expect(spoken, why).not.toBeNull();
      if (spoken !== null) expectSentence(spoken.text, why);
    }
  }
});
// Task 10 merges a run of lines from one role into one, joined with a space; every merged run must still read cleanly.
test("a point's replies, merged by role as the chat merges them, still read as sentences", () => {
  for (const c of CASES) for (const s of STEPS) for (const m of s.mustHit) {
    if (m.when !== undefined && !conditionHolds(c, m.when)) continue;
    const triggers = [m.id, ...(m.parts ?? []).map(p => `${m.id}.${p.id}`)];
    const spoken = s.replies.filter(r => r.on.some(on => triggers.includes(on)))
      .map(r => ({ role: r.role, text: replyText(r, { case: c, oxygen: rightOxygen(c), eta: 6 })?.text }))
      .filter((x): x is { role: Reply['role']; text: string } => x.text !== undefined);
    const merged = spoken.reduce<{ role: string; text: string }[]>((out, x) => {
      const last = out.at(-1);
      if (last?.role === x.role) last.text += ` ${x.text}`;
      else out.push({ ...x });
      return out;
    }, []);
    for (const x of merged) expectSentence(x.text, `${c.id} ${s.id}/${m.id} ${x.role}`);
  }
});

// ---- Plan 3 Task 3 (D22): {limbWhere}, the injured limb in step 12's immobilise say --------------------------------

test('step 12 names the injured limb to immobilise: the right leg for the RTA, the left leg for the leg bleed, none elsewhere', () => {
  const said = (id: string) => filled('rapid-body-survey', caseById(id));
  expect(pointOf('rapid-body-survey', 'immobilise').say).toBe('Buddy, immobilise the {limbWhere}.');
  expect(said('rta-toapayoh-01')).toContain('Checking distal pulses of injured limbs. Buddy, immobilise the right leg. Checking for JVD');
  expect(said('legbleed-punggol-01')).toContain('Checking distal pulses of injured limbs. Buddy, immobilise the left leg. Checking for JVD');
  for (const id of ['rta-toapayoh-01', 'legbleed-punggol-01']) expect(said(id), id).not.toMatch(CLEAN);
  const copdLine = said('copd-amk-01');
  for (const sentence of ['Buddy, immobilise the right leg.', 'Buddy, immobilise the left leg.']) expect(copdLine).not.toContain(sentence);
  expect(copdLine).not.toMatch(/immobili|\{limbWhere\}/);
  // only a limb injury names a limb; a case without one fills the slot with nothing, and a sentence holding it is left out
  for (const c of CASES) expect(said(c.id).includes('Buddy, immobilise the '), c.id).toBe(c.flags.includes('limbInjury'));
  expect(fillCanonical('One. Buddy, immobilise the {limbWhere}. Two.', copd, 6, [])).toBe('One. Two.');
  expect(fillCanonical('One. Buddy, immobilise the {limbWhere}. Two.', caseById('legbleed-punggol-01'), 6, []))
    .toBe('One. Buddy, immobilise the left leg. Two.');
});
