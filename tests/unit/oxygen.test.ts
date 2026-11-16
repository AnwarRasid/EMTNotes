import { caseById } from './sim-helpers';
import { normalizeLine } from '../../src/sim/match';
import { capitalise } from '../../src/sim/replies';
import { DEVICE_LABEL, DEVICE_SHORT, armAt, describeOxygen, oxygenRight, readArm, readEcg, readOxygen } from '../../src/sim/oxygen';

const n = normalizeLine;
const COPD = caseById('copd-amk-01').expected.oxygen;     // NC 2–4
const HYPO = caseById('hypo-hougang-01').expected.oxygen;  // NC 2–4, optional
test('reads the device and the flow', () => {
  expect(readOxygen(n('Buddy, nasal cannula 3 litres please'))).toEqual({ device: 'nasal-cannula', flow: 3, flowMax: null });
  expect(readOxygen(n('NRM 15 lpm'))).toEqual({ device: 'non-rebreather', flow: 15, flowMax: null });
  expect(readOxygen(n('Non-rebreather mask at 10-15 L/min'))).toEqual({ device: 'non-rebreather', flow: 10, flowMax: 15 });
  expect(readOxygen(n('Oxygen not required, SpO2 above 95%'))).toEqual({ device: 'none', flow: null, flowMax: null });
  expect(readOxygen(n('Checking the radial pulse'))).toBeNull();
});
test('judges the choice against the case', () => {
  expect(oxygenRight({ device: 'nasal-cannula', flow: 3, flowMax: null }, COPD)).toBe(true);
  expect(oxygenRight({ device: 'nasal-cannula', flow: 2, flowMax: 4 }, COPD)).toBe(true);
  expect(oxygenRight({ device: 'simple-face-mask', flow: 6, flowMax: null }, COPD)).toBe(false);
  expect(oxygenRight({ device: 'nasal-cannula', flow: 6, flowMax: null }, COPD)).toBe(false);
  expect(oxygenRight({ device: 'nasal-cannula', flow: null, flowMax: null }, COPD)).toBe(false);
  expect(oxygenRight({ device: 'none', flow: null, flowMax: null }, HYPO)).toBe(true);
  expect(oxygenRight({ device: 'nasal-cannula', flow: 3, flowMax: null }, HYPO)).toBe(true);
  expect(oxygenRight({ device: 'non-rebreather', flow: 15, flowMax: null }, HYPO)).toBe(false);
});
test('reads the ECG type and describes a choice', () => {
  expect(readEcg(n('12-lead ECG please'))).toBe('12-lead');
  expect(readEcg(n('Four lead ECG'))).toBe('4-lead');
  expect(readEcg(n('ECG please'))).toBeNull();
  expect(describeOxygen({ device: 'nasal-cannula', flow: 3, flowMax: null })).toBe('nasal cannula 3 L/min');
  expect(describeOxygen({ device: 'non-rebreather', flow: 10, flowMax: 15 })).toBe('non-rebreather mask 10–15 L/min');
});

test('reads phone input: glued units, ranges, a flow with no device, and the asthma nebuliser', () => {
  expect(readOxygen(n('NRM 15L/min'))).toEqual({ device: 'non-rebreather', flow: 15, flowMax: null });
  expect(readOxygen(n('Nasal cannula 2–4 L'))).toEqual({ device: 'nasal-cannula', flow: 2, flowMax: 4 });
  expect(readOxygen(n('Nebuliser mask at 6 to 8 litres per minute'))).toEqual({ device: 'nebuliser-mask', flow: 6, flowMax: 8 });
  expect(readOxygen(n('Up the flow to 6 L/min'))).toEqual({ device: null, flow: 6, flowMax: null });
  expect(readOxygen(n('Bag-valve mask'))).toEqual({ device: 'bvm', flow: null, flowMax: null });
});
test('a flow unit must end its word, and a named device beats room air (D5)', () => {
  // Fix round 2: was 'NRM, 15 left'; a bare number after "NRM," is now its flow, so the D5 line keeps the number away
  // from the device ("left" is still not the unit "l")
  expect(readOxygen(n('NRM on, 15 left'))).toEqual({ device: 'non-rebreather', flow: null, flowMax: null });
  expect(readOxygen(n('Patient is 3 lying on the floor'))).toBeNull();
  expect(readOxygen(n('SpO2 88% on room air, nasal cannula 2 litres'))).toEqual({ device: 'nasal-cannula', flow: 2, flowMax: null });
  expect(readOxygen(n('SpO2 98% on room air'))).toEqual({ device: 'none', flow: null, flowMax: null });
});
test('an optional device takes a flow-free or missing choice; a range-free expectation judges the device alone', () => {
  expect(oxygenRight({ device: null, flow: null, flowMax: null }, HYPO)).toBe(true);
  expect(oxygenRight({ device: null, flow: 3, flowMax: null }, COPD)).toBe(false);
  expect(oxygenRight({ device: 'nasal-cannula', flow: 3, flowMax: 6 }, COPD)).toBe(false);
  expect(oxygenRight({ device: 'bvm', flow: null, flowMax: null }, { device: 'bvm', flowMin: null, flowMax: null })).toBe(true);
});
// Controller ruling (Task 6): Gboard voice usually writes digits, but not always, and a correct spoken choice must not
// read as Missed.
test('reads a spoken number word, one to fifteen, before a flow unit', () => {
  expect(readOxygen(n('NRM fifteen litres'))).toEqual({ device: 'non-rebreather', flow: 15, flowMax: null });
  expect(readOxygen(n('Nasal cannula two to four litres'))).toEqual({ device: 'nasal-cannula', flow: 2, flowMax: 4 });
  expect(readOxygen(n('Ten to fifteen L/min'))).toEqual({ device: null, flow: 10, flowMax: 15 });
  expect(readOxygen(n('Nebuliser at six litres per minute'))).toEqual({ device: 'nebuliser-mask', flow: 6, flowMax: null });
  expect(readOxygen(n('Fourteen litres'))).toEqual({ device: null, flow: 14, flowMax: null });
  expect(readOxygen(n('One litre'))).toEqual({ device: null, flow: 1, flowMax: null });
  expect(readOxygen(n('NRM 10 to fifteen litres'))).toEqual({ device: 'non-rebreather', flow: 10, flowMax: 15 });
});
test('a number word reads only as a whole word before a unit, and only up to fifteen', () => {
  expect(readOxygen(n('Often litres'))).toBeNull();          // "ten" inside "often"
  expect(readOxygen(n('Sixteen litres'))).toBeNull();        // past fifteen; "six" is not "sixteen"
  // Fix round 1: was device-only; a bare number after a device name is now its flow (unit-less flows, below)
  expect(readOxygen(n('NRM at fifteen'))).toEqual({ device: 'non-rebreather', flow: 15, flowMax: null });
  expect(readOxygen(n('Two lying on the floor'))).toBeNull();
});
// Controller ruling (Task 6 fix round 1, carry (b) "NRM at 15"): a bare number or range right after a device name,
// optionally after "at", is its flow, so the right choice said without a unit is not graded Wrong.
test('a bare number or range right after a device name is its flow', () => {
  expect(readOxygen(n('NRM at 15.'))).toEqual({ device: 'non-rebreather', flow: 15, flowMax: null });
  expect(readOxygen(n('Head buddy, NRM 15 please.'))).toEqual({ device: 'non-rebreather', flow: 15, flowMax: null });
  expect(readOxygen(n('Nasal cannula 2 to 4.'))).toEqual({ device: 'nasal-cannula', flow: 2, flowMax: 4 });
  expect(readOxygen(n('Nasal cannula 2-4'))).toEqual({ device: 'nasal-cannula', flow: 2, flowMax: 4 });
  expect(readOxygen(n('Nebuliser mask at 6 to 8.'))).toEqual({ device: 'nebuliser-mask', flow: 6, flowMax: 8 });
  expect(readOxygen(n('Nasal cannula two to four'))).toEqual({ device: 'nasal-cannula', flow: 2, flowMax: 4 });
  expect(readOxygen(n('Non-rebreather mask at 10 to 15'))).toEqual({ device: 'non-rebreather', flow: 10, flowMax: 15 });
  expect(readOxygen(n('NC 3'))).toEqual({ device: 'nasal-cannula', flow: 3, flowMax: null });
  // a unit still wins, wherever it is
  expect(readOxygen(n('NRM at 10, then 15 litres'))).toEqual({ device: 'non-rebreather', flow: 15, flowMax: null });
});
test('a bare number is not a flow when a non-flow unit follows it, or when it is not right after the device', () => {
  for (const line of ['NRM 15 mins', 'NRM 15mins', 'Nasal cannula 2 minutes ago', 'NC 5 min', 'NRM for 30 seconds', 'NRM 10 secs',
    'NRM 95%', 'NRM 95 %', 'On NRM 72 years old', 'Nasal cannula 3 years', 'NRM at fifteen minutes'])
    expect(readOxygen(n(line))?.flow, line).toBeNull();
  expect(readOxygen(n('NRM on the patient, 15 left'))).toEqual({ device: 'non-rebreather', flow: null, flowMax: null });   // not right after
  expect(readOxygen(n('Nasal cannula, SpO2 is 96'))).toEqual({ device: 'nasal-cannula', flow: null, flowMax: null });
  expect(readOxygen(n('Patient is 72, on room air'))).toEqual({ device: 'none', flow: null, flowMax: null });
});
// Controller ruling (Task 6 fix round 2, N3): the other units a stray number after a device carries; one line each.
test.each([
  ['hours', 'On NRM 2 hours ago'], ['hour', 'NRM 1 hour ago'], ['hrs', 'NRM 2 hrs'], ['hr', 'NRM 1 hr'],
  ['days', 'Nasal cannula 2 days ago'], ['day', 'Nasal cannula 1 day ago'], ['days (range)', 'Nasal cannula 2 to 3 days'],
  ['breaths', 'NRM 12 breaths per minute'], ['breath', 'BVM 1 breath every 6 seconds'], ['times', 'Ventilate with BVM 12 times a minute'],
  ['mg', 'Nebuliser 5 mg salbutamol'], ['mg (decimal)', 'Neb 2.5 mg'], ['ml', 'Nebuliser 2 ml salbutamol with 2 ml N/S'],
  ['yrs', 'NRM 58 yrs old'], ['yr', 'NRM 1 yr'], ['yo', 'NRM 58 yo'], ['kg', 'NRM 15 kg'], ['percent', 'NRM 94 percent'],
  ['am', 'NRM at 10 am'], ['pm', 'NRM at 2 pm'],
])('a bare number before %s is not a flow', (_unit, line) => {
  expect(readOxygen(n(line))?.flow, line).toBeNull();
});
test('the stray numbers never read as the right choice', () => {
  const NC = { device: 'nasal-cannula', flowMin: 2, flowMax: 4 } as const;
  const NRM = { device: 'non-rebreather', flowMin: 10, flowMax: 15 } as const;
  for (const [line, expected] of [['Nasal cannula 2 days ago', NC], ['Nasal cannula 2 to 3 days', NC], ['NRM 12 breaths per minute', NRM],
    ['NRM at 10 am', NRM]] as const)
    expect(oxygenRight(readOxygen(n(line))!, expected), line).toBe(false);
});
// Controller ruling (fix round 2, item 5): a comma (as Gboard voice may insert) or "at" between the device and the number.
test('a comma or "at" between the device and a bare number still reads the flow; a non-flow unit still stops it', () => {
  expect(readOxygen(n('Head buddy, NRM, 15 please.'))).toEqual({ device: 'non-rebreather', flow: 15, flowMax: null });
  expect(readOxygen(n('NRM, at 15'))).toEqual({ device: 'non-rebreather', flow: 15, flowMax: null });
  expect(readOxygen(n('Nasal cannula, 2 to 4'))).toEqual({ device: 'nasal-cannula', flow: 2, flowMax: 4 });
  expect(readOxygen(n('NRM, 15 minutes ago'))?.flow).toBeNull();
  expect(readOxygen(n('Nasal cannula, 2 to 3 days'))?.flow).toBeNull();
});
test('reads "for lead", as speech-to-text writes "four lead", only beside "ECG", and never over a written type', () => {
  expect(readEcg(n('Connect the for lead ECG'))).toBe('4-lead');
  expect(readEcg(n('For-lead ECG please'))).toBe('4-lead');
  // Fix round 1 (Minor 5): was 4-lead; with no "ECG" in the sentence, "for lead" is not an ECG
  expect(readEcg(n('For-lead please'))).toBeNull();
  expect(readEcg(n('Prepare for lead placement.'))).toBeNull();
  expect(readEcg(n('Get ready for lead placement, 12-lead ECG.'))).toBe('12-lead');
  expect(readEcg(n('Prepare for leads placement'))).toBeNull();   // "for leads" is not a 4-lead
  expect(readEcg(n('Before lead placement'))).toBeNull();
  expect(readEcg(n('Going for 12-lead'))).toBe('12-lead');
});
test('reads the spoken ECG forms, and names every device', () => {
  expect(readEcg(n('Twelve-lead ECG'))).toBe('12-lead');
  expect(readEcg(n('4 lead ECG'))).toBe('4-lead');
  expect(readEcg(n('14 lead'))).toBeNull();
  expect(describeOxygen({ device: 'none', flow: null, flowMax: null })).toBe('no oxygen');
  expect(DEVICE_SHORT).toEqual({ 'nasal-cannula': 'NC', 'simple-face-mask': 'SFM', 'non-rebreather': 'NRM', 'nebuliser-mask': 'Neb', bvm: 'BVM', none: 'RA' });
  expect(DEVICE_LABEL).toEqual({ 'nasal-cannula': 'nasal cannula', 'simple-face-mask': 'simple face mask',
    'non-rebreather': 'non-rebreather mask', 'nebuliser-mask': 'nebuliser mask', bvm: 'BVM', none: 'no oxygen' });
});

// Plan 3 Task 2 (D23), fix rounds 1 and 2: the BP arm a sentence gives, as the grader reads it. CREDIT is lenient: an
// allowed arm named in a sentence that says BP, whatever else it says, questions too, or on step 13 itself without BP.
// WRONG is strict: a ruled-out arm tied to the BP ("BP (on|from|at|in)? (the|your|her|his|this)? {arm}( arm)?" or "{arm}
// arm for (the|your)? BP") in a statement, with no negation before it in its clause and no restriction within 3 words of
// it, and only when the sentence credits no allowed arm. With no scene, both arms are allowed, on step 13, a statement.
const CCF_SCENE = { allowed: ['right'], question: false, ownStep: true };
const BLEED_SCENE = { allowed: ['left'], question: false, ownStep: true };
const OPEN_SCENE = { allowed: ['left', 'right'], question: false, ownStep: true };
test('reads the arm named for the BP', () => {
  expect(readArm('taking the bp on the left arm')).toBe('left');
  expect(readArm('bp on her right')).toBe('right');
  expect(readArm('auscultating on the right apex and left apex, then bp')).toBeNull();
  expect(readArm('right arm no injuries')).toBe('right');   // the context rule (BP, or step 13) is the scene's
  expect(readArm('right arm no injuries', { ...OPEN_SCENE, ownStep: false })).toBeNull();
  expect(readArm(n('Taking his blood pressure on the right.'))).toBe('right');
  expect(readArm(n('BP on the left.'))).toBe('left');
  expect(readArm(n('Blood pressure on left, please.'))).toBe('left');
  expect(readArm(n('BP on the right, not the left arm.'))).toBe('right');
  expect(readArm(n('Upright arm position.'))).toBeNull();   // a side starts a word
  expect(readArm(n('Left armpit.'))).toBeNull();
  expect(readArm(n('Checking the left leg and the BP.'))).toBeNull();
});
test('armAt finds where readArm reads its arm, or -1', () => {
  expect(armAt('taking the bp on the left arm')).toBe('taking the '.length);
  expect(armAt('ok, left arm then.')).toBe('ok, '.length);
  expect(armAt('auscultating on the right apex and left apex, then bp')).toBe(-1);
  // the allowed arm the sentence credits, wherever it stands
  expect(armAt(n('Left arm has a fistula, so BP on the right arm.'), CCF_SCENE)).toBe('left arm has a fistula, so '.length);
  expect(armAt(n('Noted, left arm has a fistula.'), CCF_SCENE)).toBe(-1);
});
test('credit is lenient: an allowed arm with BP, whatever else the sentence says, questions too', () => {
  const ccf = (line: string, scene: Partial<typeof CCF_SCENE> = {}) => readArm(n(line), { ...CCF_SCENE, ...scene });
  for (const line of ['Left arm has a fistula, so BP on the right arm.', "Since your left arm has a fistula, I'll take the BP on your right arm.",
    "Don't use the left arm, BP on the right.", "No shunt no fistula I'll take BP on your right arm", "OK no problem I'll take the BP on your right arm",
    "I'm not sure but I'll take BP on the right arm", "Do not worry I'll take BP on the right arm.", 'Right arm has no fistula so BP there',
    'BP on the right arm because the left has a fistula', 'Use her right arm for BP.', 'Right arm for the BP.', 'BP right arm.',
    'BP on the left arm. No wait, BP on the right arm.', 'Taking BP on the right arm and the left arm.', 'Will take BP on the right arm.'])
    expect(ccf(line), line).toBe('right');
  for (const line of ["I'll take your BP on the right arm, OK?", 'May I take your BP on your right arm?', 'Left arm or right arm for the BP?'])
    expect(ccf(line, { question: true }), line).toBe('right');
  // the bleed mirrors
  const bleed = (line: string) => readArm(n(line), BLEED_SCENE);
  expect(bleed('Right arm has a cut, so BP on the left arm.')).toBe('left');
  expect(bleed("Since your right arm is injured, I'll take the BP on your left arm.")).toBe('left');
  expect(bleed("Don't use the right arm, BP on the left.")).toBe('left');
});
test('Wrong is strict: a ruled-out arm tied to the BP in a statement, no negation before it in its clause', () => {
  const ccf = (line: string, scene: Partial<typeof CCF_SCENE> = {}) => readArm(n(line), { ...CCF_SCENE, ...scene });
  // given: the run grades these Wrong
  for (const line of ['BP on the left arm.', 'Taking BP on your left arm.', 'BP left arm.', 'BP on the left.', 'BP lt arm.', 'L arm for BP',
    'BP from the left arm.', 'BP at left arm.', 'BP in this left arm.', 'Left arm for the BP.', 'Left arm for your BP.'])
    expect(ccf(line), line).toBe('left');
  // fix round 2: a negation in the same clause before the tie blocks it, so this one is no longer Wrong; nor is an arm
  // beside BP with no tie
  expect(ccf("No shunt no fistula I'll take BP on your left arm")).toBeNull();
  expect(ccf('Left arm BP.')).toBeNull();
  expect(readArm(n('Taking BP on your right arm.'), BLEED_SCENE)).toBe('right');
  // never: no BP, a question, or a negation in the 3 words before the arm
  for (const line of ["Can't use the left arm.", 'Left arm cannot.', 'Never the left arm.', "Won't use the left arm.", 'Left arm not suitable.',
    'Left arm is not allowed.', 'Left arm no.', 'Except the left arm.', 'Okay, left arm is out.', 'Noted, left arm is the dialysis arm.',
    'Left arm has a laceration.', 'Noted, left arm has a fistula.', "Don't use the left arm.", 'Avoid the left arm.', 'OK, left arm then.'])
    expect(ccf(line), line).toBeNull();
  for (const line of ['Cannot take BP on the left arm.', 'No BP on the left arm.', 'Do not take the BP on the left arm.', "Don't use the left arm for BP.",
    'Never take BP on the left arm.', "Won't take BP on the left arm.", "Can't do BP on her left arm.", 'Avoid the left arm for the BP.',
    'Except the left arm for the BP.', 'Not the left arm for BP.', 'Dont take BP on the left arm', 'Cant take the BP on left arm', 'Wont do BP on left arm'])
    expect(ccf(line), line).toBeNull();
  for (const line of ['Can I take the BP on your left arm?', 'Left arm for the BP, OK?']) expect(ccf(line, { question: true }), line).toBeNull();
  // off step 13 the BP still ties it, and an arm alone is nothing
  expect(ccf('Taking the BP on the left arm.', { ownStep: false })).toBe('left');
  expect(ccf('Right arm, no injuries.', { ownStep: false })).toBeNull();
  expect(ccf('Right arm, no injuries.')).toBe('right');   // on step 13 the allowed arm alone credits
});
test('the arm words: R, L, rt and lt; the other, good, unaffected and uninjured arm; either and any arm where none is ruled out', () => {
  for (const line of ['BP R arm', 'R arm for BP', 'BP on R arm.', 'BP rt arm.', 'BP on the R.', 'Taking BP on her rt arm.'])
    expect(readArm(n(line), CCF_SCENE), line).toBe('right');
  for (const line of ['BP L arm', 'L arm for BP', 'BP on L arm.', 'BP lt arm.']) expect(readArm(n(line), BLEED_SCENE), line).toBe('left');
  // where an arm is ruled out, the other / good / unaffected / uninjured arm is the allowed one
  for (const line of ['BP on the other arm.', 'Taking BP on her good arm.', 'BP on the unaffected arm.', 'BP on his uninjured arm.']) {
    expect(readArm(n(line), CCF_SCENE), line).toBe('right');
    expect(readArm(n(line), BLEED_SCENE), line).toBe('left');
  }
  // either / any arm chooses nothing there, and credits where both arms are allowed
  for (const line of ['BP on either arm.', 'BP on any arm.']) {
    expect(readArm(n(line), CCF_SCENE), line).toBeNull();
    expect(readArm(n(line), OPEN_SCENE), line).toBe('left');
  }
  expect(readArm(n('BP on the other arm.'), OPEN_SCENE)).toBe('left');
  // a lone letter is an arm only before "arm" or after "BP on (the)"
  expect(readArm(n('R side looks fine, BP soon.'), CCF_SCENE)).toBeNull();
});
// Task 2 fix round 2 (N1, m1, m2, m4): Wrong needs the arm tied to the BP; a negation before the tie in its comma or
// semicolon clause, or a restriction within 3 words of the arm, blocks it; a negation in another clause, or after the tie,
// does not. Either and any arm credit only in a BP statement, and L/R names both arms.
test('fix round 2: the ruled-out arm said as ruled out beside BP is never Wrong; a tied one still is', () => {
  const ccf = (line: string) => readArm(n(line), CCF_SCENE);
  const bleed = (line: string) => readArm(n(line), BLEED_SCENE);
  const n1 = (o: string, cue: string) => {
    const O = o.charAt(0).toUpperCase() + o.slice(1);
    const l = o.charAt(0);
    return [`${O} arm has a ${cue}, so BP on the opposite arm.`, `${O} arm got ${cue}, use the other side for BP.`,
      `Use the other one for BP, ${o} arm has a ${cue}.`, `${O} arm has a ${cue} so no BP there.`, `${O} arm has a ${cue}, so no BP on that arm.`,
      `${O} arm got ${cue}, cannot take BP.`, `Noted, ${o} arm has a ${cue}, no BP on that side.`, `Okay, ${o} arm has ${cue}, so no BP on ${o} arm.`,
      `${O} arm has a ${cue}, I won't take the BP there.`, `${O} arm ${cue}, no BP.`, `${O} arm ${cue}, BP later.`,
      `${cue.charAt(0).toUpperCase() + cue.slice(1)} on the ${o} arm, checking BP now.`, `Not going to take BP on the ${o} arm.`,
      `BP should not be taken on the ${o} arm.`, `${l.toUpperCase()} arm no BP.`, `${O} arm no BP.`, `${O} arm not for BP.`,
      `${O} arm not suitable for BP.`, `${O} arm cannot take BP.`, `${O} arm cannot be used for BP.`, `${O} arm is a no-go for BP.`,
      `Shouldn't take BP on the ${o} arm.`, `I won't be taking your BP on the ${o} arm.`, `no BP on the ${o} arm`,
      `Taking BP, but not on the ${o} arm.`, `BP not on the ${o} arm.`, `Can't do the ${o} arm for BP.`, `${O} arm no injuries, BP later.`,
      `BP on the ${o} arm, ${cue} there.`, `${cue} ${o} arm for BP.`];
  };
  for (const line of n1('left', 'fistula')) expect(ccf(line), line).not.toBe('left');
  for (const line of n1('right', 'cut')) expect(bleed(line), line).not.toBe('right');
  // the allowed arm named as the other one / opposite arm / other side credits
  for (const line of ['Left arm has a fistula, BP on the other one.', 'Left arm has a fistula, so BP on the opposite arm.',
    'Left arm got fistula, use the other side for BP.', 'Use the other one for BP, left arm has a fistula.'])
    expect(ccf(line), line).toBe('right');
  expect(bleed('Right arm has a cut, BP on the other one.')).toBe('left');
  // still Wrong: the tie with no negation before it in its clause (m1: an opening clause doesn't block it)
  for (const [o, read] of [['left', ccf], ['right', bleed]] as const) {
    const O = o.charAt(0).toUpperCase() + o.slice(1);
    for (const line of [`BP on the ${o} arm.`, `Taking BP on your ${o} arm.`, `No problem, BP on the ${o} arm.`, `Don't move, BP on the ${o} arm.`,
      `BP on the ${o} arm, no problem.`, `${O} arm for the BP.`])
      expect(read(line), line).toBe(o);
  }
});
// Final review I1: the clause guard looks before AND after the tied phrase in its comma or semicolon clause, so the
// ruled-out arm said as ruled out with the negation after it ("…left arm cannot") is never Wrong; a restriction word
// anywhere in that clause blocks it too. A negation in another clause still doesn't.
test('final review (I1): a negation after the tie in its clause, or a restriction anywhere in it, blocks the Wrong', () => {
  const ccf = (line: string) => readArm(n(line), CCF_SCENE);
  const bleed = (line: string) => readArm(n(line), BLEED_SCENE);
  for (const [o, read, cue] of [['left', ccf, 'fistula'], ['right', bleed, 'cut']] as const) {
    for (const line of [`BP on the ${o} arm cannot.`, `BP on the ${o} arm not possible because of the ${cue}.`, `BP on the ${o} arm is not allowed.`,
      `Taking BP on the ${o} arm is not advisable due to her ${cue}.`, `Noted, BP on the ${o} arm cannot.`, `BP on the ${o} arm not possible, it is injured.`,
      `BP on the ${o} arm cannot, got a ${cue}.`, `BP on the ${o} arm won't do.`, `BP on the ${o} arm never.`, `${capitalise(o)} arm for BP cannot.`,
      `BP on the ${o} arm will press on her old ${cue}.`])
      expect(read(line), line).toBeNull();
    // still Wrong: the tie with no negation in its own clause, before or after it
    for (const line of [`BP on the ${o} arm.`, `BP on the ${o} arm, no problem.`, `No problem, BP on the ${o} arm.`, `Taking BP on your ${o} arm.`,
      `Taking BP on the ${o} arm now.`, `Noted, BP on the ${o} arm, not a problem.`])
      expect(read(line), line).toBe(o);
  }
});
// Final review residual: unable, impossible and contraindicat… are negations (and contraindicat… a restriction); a clause
// right after the tie's that opens with a negation and names no arm and no BP ("…, cannot.") blocks the Wrong too; and
// an assent ("no problem", "no worries", "no issue(s)", "not a problem") is never a negation, wherever it stands.
test('final review residual: unable, contraindicated and ", cannot." are never Wrong; assents stay assents', () => {
  const ccf = (line: string) => readArm(n(line), CCF_SCENE);
  const bleed = (line: string) => readArm(n(line), BLEED_SCENE);
  for (const [o, read] of [['left', ccf], ['right', bleed]] as const) {
    const O = capitalise(o);
    for (const line of [`Unable to take BP on the ${o} arm.`, `BP on the ${o} arm is contraindicated.`, `BP on the ${o} arm unable.`,
      `BP on the ${o} arm, cannot.`, `BP on the ${o} arm, not possible.`, `BP on the ${o} arm impossible.`, `Contraindicated: BP on the ${o} arm.`,
      `BP on the ${o} arm, unable.`, `BP on the ${o} arm, can't, got a cut.`, `BP on the ${o} arm, no.`, `${O} arm for the BP, cannot.`])
      expect(read(line), line).toBeNull();
    // still Wrong: the tie with no negation; an assent anywhere; a following clause that names BP or an arm, or comes later
    for (const line of [`BP on the ${o} arm.`, `BP on the ${o} arm, no problem.`, `No problem, BP on the ${o} arm.`, `Taking BP on your ${o} arm.`,
      `${O} arm for the BP.`, `BP on the ${o} arm no problem.`, `No problem BP on the ${o} arm.`, `OK no problem I'll take the BP on your ${o} arm`,
      `BP on the ${o} arm, no worries.`, `BP on the ${o} arm, no issues.`, `BP on the ${o} arm, no issue.`, `BP on the ${o} arm, not a problem.`,
      `No worries BP on the ${o} arm.`, `Taking BP on the ${o} arm, no BP on the legs.`, `BP on the ${o} arm, now, not later.`])
      expect(read(line), line).toBe(o);
  }
  // dictated with no comma, an assent is no negation now: the ruling's old asymmetry is gone for assents
  expect(ccf('bp on the left arm no problem')).toBe('left');
  expect(ccf('no problem bp on the left arm')).toBe('left');
  // a real negation said with no comma still blocks it
  expect(ccf('bp on the left arm cannot')).toBeNull();
});
test('fix round 2: either and any arm credit only in a BP statement; L/R and R/L name both arms', () => {
  const open = (line: string, question = false) => readArm(n(line), { ...OPEN_SCENE, question });
  expect(open('Any shunt or fistula on either arm?', true)).toBeNull();
  expect(open('Any arm pain?', true)).toBeNull();
  expect(open('Any problems with either arm before I take your BP?', true)).toBeNull();
  expect(open('Either arm is fine.')).toBeNull();   // no BP
  expect(open('BP on either arm.')).toBe('left');
  expect(open('BP on any arm.')).toBe('left');
  for (const scene of [OPEN_SCENE, CCF_SCENE, BLEED_SCENE])
    for (const line of ['BP L/R arm.', 'BP R/L arm.', 'BP on L/R arm.', 'BP on left/right arm.']) expect(readArm(n(line), scene), line).toBeNull();
  for (const line of ['BP r/o.', 'NC 2 L/min, BP next.', 'Right, BP next.']) expect(readArm(n(line), BLEED_SCENE), line).toBeNull();
});
