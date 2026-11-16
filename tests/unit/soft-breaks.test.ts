// Plan 3 Task 4 (D7): soft sentence breaks for a dictated line. A Web Speech transcript has no punctuation, and the grader
// splits on punctuation, so a whole spoken line would land on one step (Plan 2 ruling carry (c)). softBreaks puts a
// break before an addressee, the patient's call name or a step opener. The cue table and the held-word tables below pin
// each cue and each hold; the canonical sweep guards that a dictated canonical line grades as the typed one.
import { CASES, STEPS, ctxAt, playRun, readOf } from './sim-helpers';
import type { Case } from '../../src/data/schema';
import { PATIENT_WORDS, keywordGrader } from '../../src/sim/grader';
import { fillCanonical } from '../../src/sim/replies';
import { BREAK_ADDRESSEES, STEP_OPENERS, appendHeard, softBreaks } from '../../src/sim/softBreaks';

/** A canonical line as dictated: no punctuation, lowercase; an initialism ("C.A.T.") is said as one word, so its dots go
 *  first. */
const strip = (s: string) => s.replace(/\b(?:[a-z]\.){2,}/gi, m => m.replace(/\./g, ''))
  .replace(/[.?!;,:]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

describe('softBreaks', () => {
  test('a break goes before an addressee, never right after one', () => {
    expect(softBreaks('buddy do a head grip sir what is bothering you', 'Mdm Tan')).toBe('Buddy do a head grip. Sir what is bothering you.');
    expect(softBreaks('sir can you hear me', 'Mdm Tan')).toBe('Sir can you hear me.');
  });
  // the possessive itself is pinned by the held-word table below ("my buddy" here is held back by the spacing too)
  test("a break goes before a step opener (the brief's row)", () => {
    expect(softBreaks('my buddy will do a head grip on you please allow him', 'Mdm Tan'))
      .toBe('My buddy will do a head grip on you. Please allow him.');
  });
  test("the call name's last word is an addressee word: no break right after it", () => {
    expect(softBreaks('mdm tan can you hear me', 'Mdm Tan')).toBe('Mdm tan can you hear me.');
    // and it is a cue: a break goes before it
    expect(softBreaks('the pulse is fast tan can you hear me', 'Mdm Tan')).toBe('The pulse is fast. Tan can you hear me.');
    // only the last word, and only the patient's own: no call name, no name cue
    expect(softBreaks('the pulse is fast tan can you hear me', 'Mr Lim')).toBe('The pulse is fast tan. Can you hear me.');
    expect(softBreaks('the pulse is fast tan can you hear me', '')).toBe('The pulse is fast tan. Can you hear me.');
  });
  test('a transcript that already holds . ? or ! is returned as it is, trimmed', () => {
    expect(softBreaks('Is there any bleeding? any hazards', 'Mdm Tan')).toBe('Is there any bleeding? any hazards');
    expect(softBreaks('  buddy head grip. sir can you hear me  ', 'Mdm Tan')).toBe('buddy head grip. sir can you hear me');
    expect(softBreaks('stop now! buddy', 'Mdm Tan')).toBe('stop now! buddy');
  });
  test('a blank transcript gives an empty line', () => {
    expect(softBreaks('  ', 'Mdm Tan')).toBe('');
    expect(softBreaks('', 'Mdm Tan')).toBe('');
  });
  test('never right after a filler or a small word', () => {
    expect(softBreaks('head grip now and buddy check the pulse', 'Mdm Tan')).toBe('Head grip now and buddy check the pulse.');
    expect(softBreaks('please check with the crew on scene', 'Mdm Tan')).toBe('Please check with the crew on scene.');
    expect(softBreaks('we are here so sir what happened', 'Mdm Tan')).toBe('We are here so sir what happened.');
  });
  // Pre-review ruling 1: an opener's verb inside a question ("how are you", "where are you now") keeps the question whole.
  test('never right after a question word, so a question stays whole', () => {
    expect(softBreaks('sir how are you feeling', 'Mdm Tan')).toBe('Sir how are you feeling.');
    expect(softBreaks('what is your name', 'Mdm Tan')).toBe('What is your name.');
    expect(softBreaks('where does it hurt', 'Mdm Tan')).toBe('Where does it hurt.');
    // the question word right before an opener, where only it holds the break back (GCS verbal's "where are you now")
    expect(softBreaks('sir what is your name where are you now', 'Mdm Tan')).toBe('Sir what is your name where are you now.');
    expect(softBreaks('sir where does the pain go', 'Mdm Tan')).toBe('Sir where does the pain go.');
    for (const q of ['how', 'what', 'where', 'when', 'who', 'why', 'which'])
      expect(softBreaks(`the pulse is fast ${q} are you going`, ''), q).toBe(`The pulse is fast ${q} are you going.`);
    // any other word before the opener: the break
    expect(softBreaks('the pulse is fast then are you going', '')).toBe('The pulse is fast then. Are you going.');
  });
  // Pre-review ruling 2: a decimal is said as a number, not as a full stop.
  test('a "." between two digits is not punctuation, and never a break', () => {
    expect(softBreaks('temperature 37.5 sir can you hear me', 'Mdm Tan')).toBe('Temperature 37.5. Sir can you hear me.');
    expect(softBreaks('head buddy temperature is 37.5 arm buddy check the spo2', 'Mdm Tan'))
      .toBe('Head buddy temperature is 37.5. Arm buddy check the spo2.');
    expect(softBreaks('nasal cannula 2.5 litres', 'Mdm Tan')).toBe('Nasal cannula 2.5 litres.');
    // a full stop that isn't inside a number still marks the transcript punctuated: after a number, or before one
    expect(softBreaks('temperature 37.5. sir can you hear me', 'Mdm Tan')).toBe('temperature 37.5. sir can you hear me');
    expect(softBreaks('temperature 37. sir can you hear me', 'Mdm Tan')).toBe('temperature 37. sir can you hear me');
    expect(softBreaks('bed no.5 sir can you hear me', 'Mdm Tan')).toBe('bed no.5 sir can you hear me');
  });
  // Fix round 1 (I1): a one-word opener right after a subject, copula or auxiliary is that clause's verb.
  test('never before a one-word opener right after a subject, copula or auxiliary', () => {
    expect(softBreaks('is she taking any medication', 'Mdm Tan')).toBe('Is she taking any medication.');
    expect(softBreaks('is she checking her sugar at home', 'Mdm Tan')).toBe('Is she checking her sugar at home.');
    expect(softBreaks('sir are you checking your sugar at home', 'Mdm Tan')).toBe('Sir are you checking your sugar at home.');
    expect(softBreaks('i am checking the radial pulse', 'Mdm Tan')).toBe('I am checking the radial pulse.');
    expect(softBreaks('arm buddy is taking the bp', 'Mdm Tan')).toBe('Arm buddy is taking the bp.');
    // the question word isn't next to "are you", so that break stays (review Minor 5, carried); "taking" stays with "you"
    expect(softBreaks('what medication are you taking', 'Mdm Tan')).toBe('What medication. Are you taking.');
    // the canonical openers still break
    expect(softBreaks('checking the radial pulse is there pulse', 'Mdm Tan')).toBe('Checking the radial pulse. Is there pulse.');
    expect(softBreaks('may i know which arm i can take the bp from taking the bp on the left arm', 'Mdm Tan'))
      .toBe('May i know which arm i can take the bp from. Taking the bp on the left arm.');
  });
  // Fix round 1 (M4): "the left arm buddy" is the left arm, then the buddy.
  test('after left, right, your, his or her, "buddy" alone is the cue, not "arm buddy" or "head buddy"', () => {
    expect(softBreaks('taking the bp on the left arm buddy please check the spo2', 'Mdm Tan'))
      .toBe('Taking the bp on the left arm. Buddy please check the spo2.');
    expect(softBreaks('buddy please immobilise the right arm buddy check the distal pulse', 'Mdm Tan'))
      .toBe('Buddy please immobilise the right arm. Buddy check the distal pulse.');
    expect(softBreaks('please do not move your head buddy please hold the head', 'Mdm Tan'))
      .toBe('Please do not move your head. Buddy please hold the head.');
    for (const owner of ['left', 'right', 'your', 'his', 'her']) for (const limb of ['arm', 'head'])
      expect(softBreaks(`the pain is in ${owner} ${limb} buddy check the pulse`, ''), `${owner} ${limb}`)
        .toBe(`The pain is in ${owner} ${limb}. Buddy check the pulse.`);
  });
  // Fix round 1 (M2): the radio call opens with "fmv", whatever Web Speech writes for the call sign.
  test('"fmv" opens the radio call, so a dictated notification grades as the typed one whatever the call sign', async () => {
    const c = CASES.find(x => x.id === 'copd-amk-01')!;
    const step = STEPS.find(s => s.id === 'notification')!;
    const typed = fillCanonical(step.canonicalLine, c, 6, step.mustHit);
    const a = readOf((await keywordGrader.interpret(typed, ctxAt(step.id, c.id))).sentences);
    for (const sign of ['123', '1 2 3', 'one two three']) {
      const said = softBreaks(strip(typed).replace(/fmv 123/g, `fmv ${sign}`), c.patient.callName);
      expect(said, sign).toContain(`match. Fmv ${sign} to ops centre standby message over. Fmv ${sign} requesting`);
      const b = readOf((await keywordGrader.interpret(said, ctxAt(step.id, c.id))).sentences);
      expect([...b.whole].sort(), said).toEqual([...a.whole].sort());
      expect([...b.parts].sort(), said).toEqual([...a.parts].sort());
      expect(b.missing, said).toEqual([]);
    }
  });
  test('at least 2 words follow the previous break', () => {
    expect(softBreaks('yes checking the pulse', 'Mdm Tan')).toBe('Yes checking the pulse.');
    expect(softBreaks('ok yes checking the pulse', 'Mdm Tan')).toBe('Ok yes. Checking the pulse.');
    expect(softBreaks('hello sir can you hear me', 'Mdm Tan')).toBe('Hello sir can you hear me.');
  });
  test('the words inside a matched cue are not tried again', () => {
    // "patient is" is matched (and held back, after "the"), so "is there" inside it never breaks
    expect(softBreaks('check that the patient is there with the caller', 'Mdm Tan')).toBe('Check that the patient is there with the caller.');
    // "arm buddy" is one cue (held back, after "the"), so "buddy" inside it never breaks after "arm"
    expect(softBreaks('please tell the arm buddy to check spo2', 'Mdm Tan')).toBe('Please tell the arm buddy to check spo2.');
    // and where it breaks, it breaks before "arm"
    expect(softBreaks('check the radial pulse arm buddy please measure spo2', 'Mdm Tan'))
      .toBe('Check the radial pulse. Arm buddy please measure spo2.');
  });
  test('cues match whatever the case, and a trailing comma gives way to the full stop', () => {
    expect(softBreaks('Buddy, do a head grip, Sir what is bothering you', 'Mdm Tan')).toBe('Buddy, do a head grip. Sir what is bothering you.');
  });
  // Fix round 1 (M1): a curly apostrophe, as a keyboard or recogniser may write it, is the same word; the field keeps it
  test('"ma’am" with a curly apostrophe is a cue and an addressee word', () => {
    expect(softBreaks('the pulse is fast ma’am can you hear me', '')).toBe('The pulse is fast. Ma’am can you hear me.');
  });
  test("the addressees hold the grader's patient words", () => {
    for (const w of PATIENT_WORDS) expect(BREAK_ADDRESSEES).toContain(w);
    expect(STEP_OPENERS).toContain('does the');
    expect(STEP_OPENERS).toContain('fmv');
  });
});

// Fix round 1 (M1): every held word, each in the same neutral carrier, holds back the break before the "buddy" after it.
// The carrier's "and" holds back any break before the word itself, where the word is a cue too ("sir", "tan").
const HELD_WORDS = [
  // each addressee's last word, and the call name's ("Mdm Tan")
  'buddy', 'ctr', 'centre', 'center', 'crew', 'tester', 'caller',
  'sir', "ma'am", 'madam', 'mdm', 'mr', 'ms', 'encik', 'cik', 'uncle', 'auntie', 'aunty', 'tan',
  // the fillers, the possessives and small words, and the question words (pre-review ruling 1)
  'ok', 'okay', 'and', 'also', 'so',
  'my', 'your', 'our', 'his', 'her', 'the', 'a', 'an', 'to', 'with', 'for', 'of', 'on', 'at', 'by',
  'how', 'what', 'where', 'when', 'who', 'why', 'which',
];
// Fix round 1 (I1): the subjects, copulas and auxiliaries a one-word opener is the verb after.
const SUBJECT_WORDS = ['i', "i'm", 'am', 'is', 'are', 'was', 'were', 'you', 'he', 'she', 'we', 'they', 'it', 'patient',
  'does', 'do', 'did', 'has', 'have', 'will', 'can'];
describe('every held word holds the break back', () => {
  test.each(HELD_WORDS)('after "%s"', w => {
    expect(softBreaks(`check the pulse now and ${w} buddy please carry on`, 'Mdm Tan')).toBe(`Check the pulse now and ${w} buddy please carry on.`);
  });
  test('a word that is not held: the break', () => {
    expect(softBreaks('check the pulse now and then buddy please carry on', 'Mdm Tan')).toBe('Check the pulse now and then. Buddy please carry on.');
  });
  test.each(SUBJECT_WORDS)('a one-word opener after "%s"', w => {
    expect(softBreaks(`check the pulse now ${w} taking the bp`, '')).toBe(`Check the pulse now ${w} taking the bp.`);
  });
  test('every one-word opener is held after a subject, and only the openers are', () => {
    for (const o of ['checking', 'taking', 'fmv']) {
      expect(softBreaks(`check the pulse now she ${o} the bp`, ''), o).toBe(`Check the pulse now she ${o} the bp.`);
      expect(softBreaks(`check the pulse now then ${o} the bp`, ''), o).toBe(`Check the pulse now then. ${o.charAt(0).toUpperCase()}${o.slice(1)} the bp.`);
    }
    // an addressee after a subject still breaks: the hold is the openers' (fix round 1 ruling)
    expect(softBreaks('check the pulse now she buddy please carry on', '')).toBe('Check the pulse now she. Buddy please carry on.');
  });
});

// Pre-review ruling 3: every cue, each in the same neutral carrier, gives its own break. The cues are written out here,
// not read from the lists, so a cue dropped from a list fails its row, and the lists may hold no cue without a row.
// Fix round 1 (M2): 'fmv' replaces 'fmv 123', so "fmv 1 2 3" and "fmv one two three" open the radio call too.
const OPENER_CUES = ['may i', 'can you', 'could you', 'do you', 'did you', 'are you', 'is there', 'are there',
  'does the', 'fmv', 'please allow', "i'm going", 'i am going', 'checking', 'taking', 'patient is'];
const ADDRESSEE_CUES = ['arm buddy', 'head buddy', 'buddy', 'ops ctr', 'ops centre', 'ops center', 'crew', 'tester', 'caller',
  'sir', "ma'am", 'madam', 'mdm', 'mr', 'ms', 'encik', 'cik', 'uncle', 'auntie', 'aunty'];
describe('every cue gives its break', () => {
  test.each([...OPENER_CUES, ...ADDRESSEE_CUES])('"%s"', cue => {
    const opening = `${cue.charAt(0).toUpperCase()}${cue.slice(1)}`;
    expect(softBreaks(`check the pulse now ${cue} please carry on`, '')).toBe(`Check the pulse now. ${opening} please carry on.`);
  });
  test('the lists hold no cue without a row', () => {
    expect([...STEP_OPENERS].sort()).toEqual([...OPENER_CUES].sort());
    expect([...BREAK_ADDRESSEES].sort()).toEqual([...ADDRESSEE_CUES].sort());
  });
});

describe('appendHeard', () => {
  test('an empty field takes the soft-broken words', () => {
    expect(appendHeard('', 'sir can you hear me', 'Mdm Tan')).toBe('Sir can you hear me.');
  });
  test('a field without an end stop takes ". " before the words', () => {
    expect(appendHeard('Ops Ctr, roger', 'responding to blk 2xx', 'Mdm Tan')).toBe('Ops Ctr, roger. Responding to blk 2xx.');
  });
  test('a field ending in . ? or ! takes a space before the words', () => {
    expect(appendHeard('Ops Ctr, roger.', 'responding to blk 2xx', 'Mdm Tan')).toBe('Ops Ctr, roger. Responding to blk 2xx.');
    expect(appendHeard('Can you hear me?', 'patient is alert', 'Mdm Tan')).toBe('Can you hear me? Patient is alert.');
  });
  test('the line is cut to the line limit', () => {
    expect(appendHeard('x'.repeat(598), 'hello there', 'Mdm Tan')).toHaveLength(600);
    expect(appendHeard('hello', 'sir can you hear me', 'Mdm Tan', 10)).toBe('hello. Sir');
  });
  // Fix round 1 (M1): appendHeard's own choices, each pinned
  test('a result with no words leaves the field as it is', () => {
    expect(appendHeard('Sir can you', '', 'Mdm Tan')).toBe('Sir can you');
    expect(appendHeard('Sir can you', '   ', 'Mdm Tan')).toBe('Sir can you');
  });
  test("a field's trailing spaces go before the words are added", () => {
    expect(appendHeard('Ops Ctr, roger   ', 'responding to blk 2xx', 'Mdm Tan')).toBe('Ops Ctr, roger. Responding to blk 2xx.');
    expect(appendHeard('Ops Ctr, roger.  ', 'responding to blk 2xx', 'Mdm Tan')).toBe('Ops Ctr, roger. Responding to blk 2xx.');
    expect(appendHeard('   ', 'sir can you hear me', 'Mdm Tan')).toBe('Sir can you hear me.');
  });
  // Fix round 1 (M3): never "Sir,. Can you hear me."
  test('a field ending in a comma, semicolon or colon drops it before ". "', () => {
    expect(appendHeard('Sir,', 'can you hear me', 'Mdm Tan')).toBe('Sir. Can you hear me.');
    expect(appendHeard('GCS:', 'eye opening four', 'Mdm Tan')).toBe('GCS. Eye opening four.');
    expect(appendHeard('Arm buddy; ', 'check spo2', 'Mdm Tan')).toBe('Arm buddy. Check spo2.');
    expect(appendHeard(', ', 'sir can you hear me', 'Mdm Tan')).toBe('Sir can you hear me.');
  });
});

// Fix round 1 (I1): a question dictated on the phone once the call is done stays one question, so it reads no scene step.
// Broken before "taking", it read as a statement: it ended the call, credited the pocket check's medication part and
// showed the pockets on the phone; broken before "checking", it credited the hypocount during step 2.
describe('a dictated question on the phone after the call reads no scene step', () => {
  const callLines = (c: Case) => STEPS.filter(s => s.order <= 2).map(s => fillCanonical(s.canonicalLine, c, 6, s.mustHit));
  const ask = async (c: Case, dictated: string) => {
    const said = softBreaks(dictated, c.patient.callName);
    const s = await playRun(c.id, 'coached', [...callLines(c), said]);
    expect(s.lines.filter(l => l.who === 'you').at(-1)?.text, c.id).toBe(said);
    const keys = (step: string) => [...Object.keys(s.hits), ...Object.keys(s.parts)].filter(k => k.startsWith(`${step}/`));
    return { said, s, keys };
  };
  test.each(CASES.map(c => [c.id, c] as const))('%s', async (_id, c) => {
    const meds = await ask(c, 'is she taking any medication');
    const sugar = await ask(c, 'is she checking her sugar at home');
    expect(meds.keys('rapid-body-survey'), `${c.id}: ${meds.said}`).toEqual([]);
    expect(meds.s.arrived, `${c.id}: ${meds.said} (the call goes on)`).toBe(false);
    expect(sugar.keys('investigation'), `${c.id}: ${sugar.said}`).toEqual([]);
    expect([meds.said, sugar.said]).toEqual(['Is she taking any medication.', 'Is she checking her sugar at home.']);
  });
});

// The canonical dictation sweep: each canonical line, filled per case, stripped of its punctuation and soft-broken, grades
// at its own step exactly as the typed line does (the same whole points, the same parts, no key word missing), in all 11
// cases. It guards against under-breaking (with no breaks it fails RBS and the notification) and against breaking that
// loses a point; it doesn't pin each cue or hold (the tables above do), and its "sir/ma'am" stays one word, no cue.
test('every canonical line, dictated (no punctuation), then soft-broken, reads what the typed line reads', async () => {
  for (const c of CASES) for (const s of STEPS) {
    const typed = fillCanonical(s.canonicalLine, c, 6, s.mustHit);
    const said = softBreaks(strip(typed), c.patient.callName);
    const a = readOf((await keywordGrader.interpret(typed, ctxAt(s.id, c.id))).sentences);
    const b = readOf((await keywordGrader.interpret(said, ctxAt(s.id, c.id))).sentences);
    expect([...b.whole].sort(), `${c.id} ${s.id}: ${said}`).toEqual([...a.whole].sort());
    expect([...b.parts].sort(), `${c.id} ${s.id}`).toEqual([...a.parts].sort());
    expect(b.missing, `${c.id} ${s.id}`).toEqual([]);
  }
});

// Cross-step dictation: one spoken line that runs on past its step or its addressee reads each point, said to the one it
// is for, once soft-broken. Unbroken, the first reads no ask-fall, and the second asks the arm buddy about lung problems.
test.each([
  ['loc-avpu', 'sir can you hear me patient is alert loc is a on the avpu scale sir did you fall',
    [...STEPS.find(s => s.id === 'loc-avpu')!.mustHit.map(m => `loc-avpu/${m.id}`), 'delicate-spine/ask-fall'],
    { 'delicate-spine/ask-fall': 'patient' }],
  ['breathing', 'arm buddy please measure the spo2 reading on room air sir do you have any lung problems',
    ['breathing/spo2', 'breathing/asthma-copd-history'],
    { 'breathing/spo2': 'armBuddy', 'breathing/asthma-copd-history': 'patient' }],
] as const)('dictated at %s: "%s" reads %o', async (at, line, keys, to) => {
  const { sentences } = await keywordGrader.interpret(softBreaks(line, 'Mdm Tan'), ctxAt(at));
  const read = readOf(sentences);
  for (const k of keys) expect(read.whole, `${line} → ${k}`).toContain(k);
  expect(read.missing, line).toEqual([]);
  for (const [k, who] of Object.entries(to))
    expect(sentences.find(x => x.points.some(p => `${p.step}/${p.point}` === k))?.addressee, `${line} → ${k}`).toBe(who);
});
