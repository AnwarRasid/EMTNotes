// Plan 3 Task 8: the smart tester's pure core (src/sim/smart.ts), behind the Grader seam, with a fake transport (D20).
// It reads only the sentences the keyword rules read nothing for (D12), sends only what D17 allows, falls back to the
// keyword reading on any failure (D14), and its verdicts are applied once and saved (D15).
import { readFileSync } from 'node:fs';
import { vi } from 'vitest';
import { CASES, STEPS, T0, blankSession, caseById, ctxAt, envOf, hitAll } from './sim-helpers';
import type { Case } from '../../src/data/schema';
import { normalizeProgress, type RunSession } from '../../src/progress/types';
import { keywordGrader, lineBudget, type GradeContext, type LineBudget } from '../../src/sim/grader';
import { endRun, gradeContext, sendLine } from '../../src/sim/run';
import {
  SMART_MAX_CHECKS, SMART_TIMEOUT_MS, maskCase, mergeVerdict, smartCandidates, smartFacts, smartGrader, smartRequest,
  type SmartOptions, type SmartRequest, type SmartTransport, type SmartVerdict,
} from '../../src/sim/smart';

const fake = (verdict: SmartVerdict | null) => {
  const calls: SmartRequest[] = [];
  const transport: SmartTransport = async (req) => { calls.push(req); return { verdict, usage: { inputTokens: 900, outputTokens: 40 } }; };
  return { calls, transport };
};
const FALL = 'fall-yishun-01';
const neckLine = 'Sir, did you fall? Any ouch at your nape?';
// "Any ouch at the neck area?" would not do: the keyword grader reads it as the RBS neck region (pre-flight scan)
const NECK = 'delicate-spine/ask-neck-pain';
const neckVerdict: SmartVerdict = { sentences: [{ index: 1, points: [{ key: NECK, parts: [] }] }] };
const hypo = caseById('hypo-hougang-01');
const copd = caseById('copd-amk-01');

const orderOf = (key: string): number => STEPS.find(s => s.id === key.split('/')[0])?.order ?? -1;
const pointOf = (key: string) => {
  const [stepId, pointId] = key.split('/');
  return STEPS.find(s => s.id === stepId)?.mustHit.find(m => m.id === pointId);
};
const keys = (ctx: GradeContext): string[] => smartCandidates(ctx).map(p => p.key);
const grader = (o: Partial<SmartOptions> & Pick<SmartOptions, 'transport'>) => smartGrader({ online: () => true, ...o });
/** The call before arrival, at step 2 of COPD with step 1 done. */
const onCall = (): GradeContext => ({ ...ctxAt('call-caller', 'copd-amk-01'), arrived: false });

test('the budget and the cap are 6 s and 40 checks (D14), and the grader is "smart"', () => {
  expect(SMART_TIMEOUT_MS).toBe(6000);
  expect(SMART_MAX_CHECKS).toBe(40);
  expect(grader(fake(null)).id).toBe('smart');
});

describe('smartCandidates (D12)', () => {
  test('at the delicate spine: its own points not done and the next two steps, never a check point, never the call', () => {
    const ks = keys(ctxAt('delicate-spine', FALL));
    expect(ks).toContain(NECK);
    expect(ks).toContain('delicate-spine/c-collar');            // when neckPain, which FALL has
    expect(ks).not.toContain('delicate-spine/release-grip');    // when noSpinal, which FALL is not
    expect(ks).toContain('breathing/chest-rise-fall');          // order 10, in the window
    expect(ks).not.toContain('breathing/mask-flow');            // order 10 too, but a check point (oxygen)
    expect(ks.every(k => pointOf(k)?.check === undefined)).toBe(true);
    expect(ks.some(k => orderOf(k) === 1 || orderOf(k) === 2)).toBe(false);
    expect(ks.every(k => orderOf(k) >= 1 && orderOf(k) <= 10)).toBe(true);
    expect(ks.every(k => orderOf(k) >= 8)).toBe(true);          // ctxAt: everything before step 8 done, nothing pending
  });

  test('each candidate carries its key, label and parts, and nothing else', () => {
    const dtbl = smartCandidates(ctxAt('delicate-spine', FALL)).find(p => p.key === 'delicate-spine/palpate-dtbl');
    expect(dtbl).toEqual({ key: 'delicate-spine/palpate-dtbl', label: 'Palpate the back of the neck for D.T.B.L.', parts: [
      { id: 'deformities', label: pointOf('delicate-spine/palpate-dtbl')?.parts?.[0]?.label },
      { id: 'tenderness', label: pointOf('delicate-spine/palpate-dtbl')?.parts?.[1]?.label },
      { id: 'bruises', label: pointOf('delicate-spine/palpate-dtbl')?.parts?.[2]?.label },
      { id: 'lacerations', label: pointOf('delicate-spine/palpate-dtbl')?.parts?.[3]?.label },
    ] });
    expect(smartCandidates(ctxAt('delicate-spine', FALL)).find(p => p.key === NECK)).toEqual(
      { key: NECK, label: 'Do you feel any pain at your neck?', parts: [] });
  });

  test('a pending point of an earlier step is a candidate; a done one is not', () => {
    const at8 = ctxAt('delicate-spine', FALL);
    const done = [...at8.done].filter(k => k !== 'introduction/head-grip');
    expect(keys(ctxAt('delicate-spine', FALL, 6, done, ['introduction/head-grip']))).toContain('introduction/head-grip');
    expect(keys(at8)).not.toContain('introduction/head-grip');
    expect(keys({ ...at8, done: new Set([...at8.done, NECK]) })).not.toContain(NECK);
  });

  test('check points in the window are never candidates: the ECG and the BP arm at the circulation (window 11 to 13)', () => {
    const ks = keys(ctxAt('circulation', FALL));
    expect(ks).toContain('investigation/hypocount');   // order 13, in the window, no check
    expect(ks).not.toContain('investigation/ecg');
    expect(ks).not.toContain('investigation/bp-arm');
  });

  test('before arrival only the call steps (orders 1 and 2); after arrival never those', () => {
    const before = keys(onCall());
    expect(before).toContain('call-caller/what-happened');
    expect(before.every(k => orderOf(k) === 1 || orderOf(k) === 2)).toBe(true);
    expect(before).not.toContain('call-caller/vehicles');   // when rta: not COPD
    const after = keys({ ...onCall(), arrived: true });
    expect(after.length).toBeGreaterThan(0);
    expect(after.some(k => orderOf(k) <= 2)).toBe(false);
  });
});

describe('what is sent (D17)', () => {
  test('the facts: complaint, type, sex, race, age, ETA and the conditions that hold, and nothing else', () => {
    const facts = smartFacts(hypo, 6);
    expect(facts).toEqual({ complaint: 'Giddiness', type: 'medical', sex: 'male', race: 'Chinese', age: 68, eta: 6,
      conditions: ['hypoglycaemia', 'medical', 'noSpinal', 'stayAndTreat'] });
    const json = JSON.stringify(facts);
    for (const never of ['S58xxxxxB', 'Lim Boon Huat', 'Mr Lim', 'Hougang Ave']) expect(json).not.toContain(never);
    expect(smartFacts(caseById(FALL), null)).toMatchObject({ type: 'trauma', eta: null });
    expect(smartFacts(caseById(FALL), null).conditions).toEqual(expect.arrayContaining(['trauma', 'neckPain', 'spinal', 'loadAndGo']));
  });

  test('maskCase: the call name becomes "the patient"', () => {
    expect(maskCase('Mr Lim, any ouch at your nape?', hypo)).toBe('the patient, any ouch at your nape?');
  });

  test('maskCase: the name, the IC and the address go, whole phrases and any case', () => {
    const masked = maskCase('Lim Boon Huat, IC S58xxxxxB, at Blk 4xx Hougang Ave 8, #11-xx?', hypo);
    for (const said of ['the patient', 'the IC', 'the address']) expect(masked).toContain(said);
    for (const gone of ['Lim', 'Boon', 'Huat', 'S58', 'Hougang', 'Blk 4xx']) expect(masked.toLowerCase()).not.toContain(gone.toLowerCase());
    expect(maskCase('Boon is in pain.', hypo)).toBe('Boon is in pain.');   // a name word alone is left (review round 1, I1)
    expect(maskCase('LIM BOON HUAT, ic s58xxxxxb?', hypo)).toBe('the patient, ic the IC?');
    expect(maskCase('Your IC starts S58?', hypo)).toBe('Your IC starts the IC?');
    expect(maskCase('Unit #11-xx, is it?', hypo)).toBe('Unit the address, is it?');
    expect(maskCase('Blk 4xx  Hougang Ave 8 is here.', hypo)).toBe('the address is here.');   // any space between words
  });

  test('maskCase leaves single words, honorifics alone and ordinary words, even where a name holds them (I1)', () => {
    expect(maskCase('Any limb injury? Limping?', hypo)).toBe('Any limb injury? Limping?');
    expect(maskCase('Mr, can you hear me?', hypo)).toBe('Mr, can you hear me?');
    expect(maskCase('Ah, is Mui OK? Mdm Tan?', copd)).toBe('Ah, is Mui OK? the patient?');
    const named = (name: string, callName: string): Case => ({ ...hypo, patient: { ...hypo.patient, name, callName } });
    expect(maskCase('Is Kumar the s/o of Ravi?', named('Ravi s/o Kumar', 'Mr Ravi'))).toBe('Is Kumar the s/o of Ravi?');
    expect(maskCase('Siti binte Ahmad, Siti?', named('Siti binte Ahmad', 'Cik Siti'))).toBe('the patient, Siti?');
    expect(maskCase('Binte who? Ahmad.', named('Siti binte Ahmad', 'Cik Siti'))).toBe('Binte who? Ahmad.');
    expect(maskCase('Nothing of the case here.', hypo)).toBe('Nothing of the case here.');
    const asthma = caseById('asthma-tampines-01');   // Goh Hui Min
    const legbleed = caseById('legbleed-punggol-01');   // Lee Wei Jie, at a void deck
    expect(maskCase('Monitor closely every 5 min?', asthma)).toBe('Monitor closely every 5 min?');
    expect(maskCase('Any wei?', legbleed)).toBe('Any wei?');
    expect(maskCase('Tan, are you OK? Any skin tan?', copd)).toBe('Tan, are you OK? Any skin tan?');
    expect(maskCase('Lee, can you hear me?', legbleed)).toBe('Lee, can you hear me?');
    expect(maskCase('Is the void deck safe?', legbleed)).toBe('Is the void deck safe?');   // a landmark piece is left (M3)
  });

  test('maskCase: the case\'s area or town is part of the address, as a whole phrase in any case (D17)', () => {
    expect(maskCase('Is this Hougang?', hypo)).toBe('Is this the address?');
    expect(maskCase('Are you in Ang Mo Kio? ANG  MO  KIO, right?', copd)).toBe('Are you in the address? the address, right?');
    expect(maskCase('Is this Punggol? Is the void deck safe?', caseById('legbleed-punggol-01'))).toBe('Is this the address? Is the void deck safe?');
    expect(maskCase('Hougangers? Angmo?', hypo)).toBe('Hougangers? Angmo?');   // whole words only
  });

  test('no area name reaches a request body through interpret, in all 11 cases (D17)', async () => {
    let sent = 0;
    for (const c of CASES) {
      for (const step of ['call-caller', 'introduction', 'vital-signs', 'notification']) {
        const ctx = step === 'call-caller' ? { ...ctxAt(step, c.id), arrived: false } : ctxAt(step, c.id);
        for (const line of [`Is this ${c.area}?`, `Are you near ${c.area.toUpperCase()} now?`, `We live in ${c.area}.`]) {
          const calls: SmartRequest[] = [];
          await grader({ transport: async (req) => { calls.push(req); return { verdict: { sentences: [] }, usage: null }; } }).interpret(line, ctx);
          sent += calls.length;
          expect(JSON.stringify(calls).toLowerCase(), `${c.id} @${step}: ${line}`).not.toContain(c.area.toLowerCase());
        }
      }
    }
    expect(sent).toBeGreaterThan(66);   // most of the 132 lines read nothing by the keyword rules, so they really went out
  });

  test('maskCase: a title and the call name\'s last word, the call name, and the full name with or without a title', () => {
    for (const said of ['Mdm Tan', 'Uncle Tan', 'Madam Tan', 'Ma’am Tan', "Ma'am Tan", 'Mdm. Tan', 'MDM TAN', 'Mrs Tan', 'Miss Tan',
      'Tan Ah Mui', 'Mdm Tan Ah Mui', 'tan  ah  mui']) {
      expect(maskCase(`${said}, are you OK?`, copd), said).toBe('the patient, are you OK?');
    }
    expect(maskCase('Mr Lim Boon Huat, are you OK?', hypo)).toBe('the patient, are you OK?');
    expect(maskCase('Mr. Lim, are you OK?', hypo)).toBe('the patient, are you OK?');
    expect(maskCase('Encik Ahmad, are you OK?', caseById('chestpain-bedok-01'))).toBe('the patient, are you OK?');
    expect(maskCase('Encik Faizal, are you OK? Faizal bin Rahim?', caseById('rta-toapayoh-01'))).toBe('the patient, are you OK? the patient?');
    expect(maskCase('Cik Siti, are you OK?', caseById('ams-sengkang-01'))).toBe('the patient, are you OK?');
    expect(maskCase('Blk 6xx Punggol Field, void deck. Blk 6xx Punggol Field?', caseById('legbleed-punggol-01'))).toBe('the address. the address?');
  });

  test('maskCase: the IC never leaves, in any form, in any case; nor anyone\'s NRIC (C1)', () => {
    for (const c of CASES) {
      const ic = c.patient.ic;
      const forms = [ic, ic.toLowerCase(), `${ic.slice(0, 3)}xxxx${ic.slice(-1)}`, `${ic.slice(0, 3)} ${ic.slice(3)}`,
        `${ic.slice(0, 3)}xxxxxx${ic.slice(-1)}`, ic.slice(0, 3), ic.slice(-6), `${ic.slice(0, 3)}xx xxx${ic.slice(-1)}`];
      for (const form of forms) {
        const masked = maskCase(`IC ${form}, is that correct?`, c);
        expect(masked, `${c.id}: ${form}`).toBe('IC the IC, is that correct?');
      }
    }
    expect(maskCase('IC number S12xxxxxA?', hypo)).toBe('IC number the IC?');
    expect(maskCase('Is it T0212345Z or F98 76543 K?', hypo)).toBe('Is it the IC or the IC?');
    expect(maskCase('E4 V5 M6, GCS 15. SpO2 98%. T2 diabetes.', hypo)).toBe('E4 V5 M6, GCS 15. SpO2 98%. T2 diabetes.');
  });

  // Final review, parked item 1: the nine forms the Task 8 re-review found reaching a request, each with what it masks to.
  const NINE_FORMS = (c: Case): [string, string, string][] => {
    const { ic, name, callName } = c.patient;
    const words = name.split(' ');
    const joined = words.length >= 3 && !['bin', 'binte', 's/o', 'd/o'].includes(words[1]!.toLowerCase())
      ? `${words[0]} ${words.slice(1).join('-')}` : words.join('-');   // "Tan Ah-Mui"; "Siti-binte-Hassan"
    const piece = c.location.split(',')[0]!.trim();
    const block = /^Blk\s+\S+/i.exec(piece)?.[0] ?? piece;              // "Blk 2xx" (RTA's piece has no block)
    const street = piece.replace(/^Blk\s+\S+\s+/i, '');                // "Compassvale St"
    return [
      ['IC tail split', `${ic.slice(3, -1)} ${ic.slice(-1)}`, 'the IC'], ['NRIC no letter', 'S9012345', 'the IC'],
      ['NRIC hyphenated', 'S90-12345-A', 'the IC'], ['NRIC three spaces', 'S90 12 34 5A', 'the IC'], ['NRIC digits only', '9012345', 'the IC'],
      ['name hyphenated', joined, 'the patient'], ['Mister', `Mister ${callName.split(' ').at(-1)}`, 'the patient'],
      ['block alone', block, 'the address'], ['street alone', street, 'the address'],
    ];
  };
  const templated = (form: string): [string, string][] => [[`${form}, is that correct?`, ', is that correct?'], [`Is it ${form}?`, '?']];

  test('maskCase (final review, item 1): the nine forms mask whole, in all 11 cases', () => {
    for (const c of CASES) {
      for (const [label, form, as] of NINE_FORMS(c)) {
        expect(maskCase(`${form}, is that correct?`, c), `${c.id}: ${label}`).toBe(`${as}, is that correct?`);
        expect(maskCase(`Is it ${form}?`, c), `${c.id}: ${label}`).toBe(`Is it ${as}?`);
      }
      // the hyphenated case IC whole, never "the IC-xxxxx-A"; and "Block", "Blk." and no space before the number
      const ic = c.patient.ic;
      expect(maskCase(`IC ${ic.slice(0, 3)}-${ic.slice(3, -1)}-${ic.slice(-1)}?`, c), c.id).toBe('IC the IC?');
      const num = /^Blk\s+(\S+)/i.exec(c.location)?.[1];
      if (num !== undefined) {
        for (const said of [`Block ${num}`, `Blk. ${num}`, `blk${num}`]) expect(maskCase(`At ${said}?`, c), `${c.id}: ${said}`).toBe('At the address?');
      }
    }
    expect(maskCase('Tan Ah Mui, Tan Ah-Mui, Tan-Ah-Mui?', copd)).toBe('the patient, the patient, the patient?');
    expect(maskCase('Mister Tan? MISTER TAN?', copd)).toBe('the patient? the patient?');
    expect(maskCase('Unit #11 xx, is it?', hypo)).toBe('Unit the address, is it?');   // the unit's pieces, any space or hyphen between
  });

  test('maskCase (final review, item 1): ordinary words and clinical text still survive, in all 11 cases', () => {
    const asthma = caseById('asthma-tampines-01');   // Goh Hui Min
    const legbleed = caseById('legbleed-punggol-01');   // Lee Wei Jie
    for (const [c, text] of [[asthma, 'Reassess every 5 min.'], [asthma, 'Hui, Min, Goh?'], [legbleed, 'Any wei?'], [legbleed, 'lee'],
      [legbleed, 'Stand in the lee of the wall.'], [copd, 'Any skin tan?'], [copd, 'tan'], [copd, 'Mister, can you hear me?'],
      [hypo, 'Any limb injury? Limping?']] as const) {
      expect(maskCase(text, c), `${c.id}: ${text}`).toBe(text);
    }
    const clinical = ['BP 120/80, HR 88, RR 20.', 'GCS 15, E4V5M6.', 'GCS 15, E4 V5 M6.', 'T2DM on metformin.', 'G6PD deficient?', 'S1 S2 heard.',
      'CBG 2.8 mmol.', 'Give 15 L/min via NRM.', 'SpO2 95% on RA.', 'T 37.5 degrees.', 'Paracetamol 500 mg.', 'Call 91234567 for the caller.',
      'Every 5 min, reassess.', 'Pain 7 of 10 since 0730.'];
    for (const c of CASES) for (const text of clinical) expect(maskCase(text, c), `${c.id}: ${text}`).toBe(text);
  });

  test('none of the nine forms reaches a request through interpret, in all 11 cases (final review, item 1)', async () => {
    const sentBy: Record<string, number> = {};
    for (const c of CASES) {
      for (const [label, form, as] of NINE_FORMS(c)) {
        for (const step of ['introduction', 'vital-signs', 'notification']) {
          const ctx = ctxAt(step, c.id);
          for (const [line, tail] of templated(form)) {
            const sent: SmartRequest[] = [];   // a grader of its own, so no cached verdict hides a send
            await grader({ transport: async (req) => { sent.push(req); return { verdict: { sentences: [] }, usage: null }; } }).interpret(line, ctx);
            if (sent.length > 0) sentBy[label] = (sentBy[label] ?? 0) + 1;
            expect(JSON.stringify(sent).toLowerCase(), `${c.id} @${step}: ${line}`).not.toContain(form.toLowerCase());
            for (const s of sent.flatMap(r => r.sentences)) {
              expect(s.text, `${c.id} @${step}: ${line}`).toBe(line.startsWith('Is it') ? `Is it ${as}${tail}` : `${as}${tail}`);
            }
          }
        }
      }
    }
    // every form really went out, masked, for most of its 66 tries
    for (const [label] of NINE_FORMS(copd)) expect(sentBy[label] ?? 0, label).toBeGreaterThan(33);
  });

  test('the IC never reaches a request through interpret, in all 11 cases (C1)', async () => {
    const sentBy: Record<string, number> = {};
    for (const c of CASES) {
      const ic = c.patient.ic;
      // the full, lower-case and split forms (and any opening with the bare prefix) are read by the SRACIE's IC part, so
      // they never go out; a mangled IC, its tail alone or someone else's IC reads nothing, so it does, masked
      const forms: Record<string, string> = { full: ic, lower: ic.toLowerCase(), split: `${ic.slice(0, 3)} ${ic.slice(3)}`,
        twoSpaces: `${ic.slice(0, 3)} xx xxx${ic.slice(-1)}`, short: `${ic.slice(0, 3)}xxxx${ic.slice(-1)}`,
        long: `${ic.slice(0, 3)}xxxxxx${ic.slice(-1)}`, innerSpace: `${ic.slice(0, 3)}xx xxx${ic.slice(-1)}`, tail: ic.slice(-6),
        other: 'S12xxxxxA', otherDigits: 'T0212345Z' };
      for (const step of ['introduction', 'vital-signs', 'decision-point', 'notification']) {
        const ctx = ctxAt(step, c.id);
        for (const [name, form] of Object.entries(forms)) {
          for (const line of [`${form}, is that correct?`, `Is it ${form}?`, `Your card says ${form}.`]) {
            const sent: SmartRequest[] = [];   // a grader of its own, so no cached verdict hides a send
            await grader({ transport: async (req) => { sent.push(req); return { verdict: { sentences: [] }, usage: null }; } }).interpret(line, ctx);
            if (sent.length > 0) sentBy[name] = (sentBy[name] ?? 0) + 1;
            const body = JSON.stringify(sent).toLowerCase();
            for (const fragment of [ic.slice(0, 3), ic.slice(-6), 'xxxx', 's12', 't02']) {
              expect(body, `${c.id} @${step}: ${line}`).not.toContain(fragment.toLowerCase());
            }
          }
        }
      }
    }
    // each form the keyword rules leave unread really went out, masked, in most of the 132 tries
    for (const name of ['short', 'long', 'innerSpace', 'tail', 'other', 'otherDigits']) expect(sentBy[name] ?? 0, name).toBeGreaterThan(60);
  });

  test('smartRequest masks each sentence: the body holds none of the case\'s own values', async () => {
    const ctx = ctxAt('delicate-spine', 'hypo-hougang-01');
    const text = 'Mr Lim, Lim Boon Huat, IC S58xxxxxB, Blk 4xx Hougang Ave 8, any ouch at your nape?';
    const { sentences } = await keywordGrader.interpret(text, ctx);
    expect(sentences.map(s => s.text)).toEqual([text]);
    const json = JSON.stringify(smartRequest(ctx, sentences, [0])).toLowerCase();
    const p = hypo.patient;
    for (const never of [p.name, p.callName, p.ic, hypo.location, hypo.area, 'S58', ...p.name.split(' ')]) {
      expect(json).not.toContain(never.toLowerCase());
    }
  });

  test('a title cut off by the sentence split keeps its name masked (M5)', async () => {
    const ctx = ctxAt('delicate-spine', 'copd-amk-01');
    const { sentences } = await keywordGrader.interpret('Mdm. Tan, any ouch at your nape? Tan, any ouch at your nape?!', ctx);
    expect(sentences.map(s => s.text)).toEqual(['Mdm.', 'Tan, any ouch at your nape?', 'Tan, any ouch at your nape?!']);
    expect(smartRequest(ctx, sentences, [0, 1, 2]).sentences).toEqual([{ index: 0, text: 'Mdm.' },
      { index: 1, text: 'the patient, any ouch at your nape?' }, { index: 2, text: 'Tan, any ouch at your nape?!' }]);
    const { sentences: named } = await keywordGrader.interpret('Uncle. Tan Ah Mui, any ouch at your nape?', ctx);
    expect(smartRequest(ctx, named, [1]).sentences).toEqual([{ index: 1, text: 'the patient, any ouch at your nape?' }]);
  });

  test('the ETA sent is the context\'s own, never worked back from the slots (M1)', async () => {
    const at6 = ctxAt('delicate-spine', FALL);
    const { sentences } = await keywordGrader.interpret(neckLine, at6);
    expect(smartRequest(at6, sentences, [1]).facts.eta).toBe(6);
    expect(smartRequest({ ...at6, eta: 9 }, sentences, [1]).facts.eta).toBe(9);   // the slots are still filled at 6
    const { eta: _e, ...unknown } = at6;
    expect(smartRequest(unknown, sentences, [1]).facts.eta).toBeNull();
  });

  test('the request is exactly the step, the arrival, the unread sentences by index, the candidates and the facts', async () => {
    const ctx = ctxAt('delicate-spine', 'hypo-hougang-01');
    const { sentences } = await keywordGrader.interpret('Mr Lim, did you fall? Mr Lim, any ouch at your nape?', ctx);
    const req = smartRequest(ctx, sentences, [1]);
    expect(Object.keys(req)).toEqual(['step', 'arrived', 'sentences', 'candidates', 'facts']);
    expect(req).toEqual({ step: { order: 8, name: 'Delicate spine' }, arrived: true,
      sentences: [{ index: 1, text: 'the patient, any ouch at your nape?' }],
      candidates: smartCandidates(ctx), facts: smartFacts(hypo, 6) });
    for (const c of req.candidates) {
      expect(Object.keys(c)).toEqual(['key', 'label', 'parts']);
      for (const part of c.parts) expect(Object.keys(part)).toEqual(['id', 'label']);
    }
  });
});

describe('the merge', () => {
  test('precondition: the keyword grader reads nothing for "Any ouch at your nape?" at the delicate spine in FALL', async () => {
    const { sentences } = await keywordGrader.interpret(neckLine, ctxAt('delicate-spine', FALL));
    expect(sentences.map(s => s.text)).toEqual(['Sir, did you fall?', 'Any ouch at your nape?']);
    expect(sentences[0]?.points.map(p => `${p.step}/${p.point}`)).toEqual(['delicate-spine/ask-fall']);
    expect(sentences[1]?.points).toEqual([]);
    expect(sentences[1]?.dropped).toBeUndefined();
  });

  test('an unread sentence takes the verdict\'s point, marked smart; the read one stays as the keyword grader read it', async () => {
    const ctx = ctxAt('delicate-spine', FALL);
    const want = (await keywordGrader.interpret(neckLine, ctx)).sentences;
    const f = fake(neckVerdict);
    const got = (await grader({ transport: f.transport }).interpret(neckLine, ctx)).sentences;
    expect(got[0]).toEqual(want[0]);
    expect(got[1]).toEqual({ ...want[1], step: 'delicate-spine', smart: true, addressee: 'patient',
      points: [{ step: 'delicate-spine', point: 'ask-neck-pain', parts: [], whole: true, missing: [], pos: 0 }] });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]?.sentences).toEqual([{ index: 1, text: 'Any ouch at your nape?' }]);
  });

  test('unknown keys and parts are dropped: a point outside the window, a check point, a done point, a part it lacks', async () => {
    const ctx = ctxAt('delicate-spine', FALL);
    const want = await keywordGrader.interpret(neckLine, ctx);
    const only = async (points: { key: string; parts: string[] }[]) =>
      (await grader({ transport: fake({ sentences: [{ index: 1, points }] }).transport }).interpret(neckLine, ctx));
    expect(await only([{ key: 'circulation/pulse', parts: [] }])).toEqual(want);   // order 11: outside step 8's window
    expect(await only([{ key: 'breathing/mask-flow', parts: [] }])).toEqual(want);   // a check point
    expect(await only([{ key: 'loc-avpu/get-response', parts: [] }, { key: 'nonsense', parts: [] }])).toEqual(want);
    expect(await only([{ key: 'delicate-spine/palpate-dtbl', parts: ['swelling'] }])).toEqual(want);   // no part it has
    const dtbl = (await only([{ key: 'delicate-spine/palpate-dtbl', parts: ['tenderness', 'swelling', 'tenderness'] },
      { key: 'circulation/pulse', parts: [] }])).sentences[1];
    expect(dtbl?.points).toEqual([{ step: 'delicate-spine', point: 'palpate-dtbl', parts: ['tenderness'], whole: false, missing: [], pos: 0 }]);
    expect(dtbl?.addressee).toBe('tester');
  });

  test('a verdict for a sentence the keyword grader read, or for no sentence, changes nothing', async () => {
    const ctx = ctxAt('delicate-spine', FALL);
    const want = await keywordGrader.interpret(neckLine, ctx);
    const v: SmartVerdict = { sentences: [{ index: 0, points: [{ key: NECK, parts: [] }] }, { index: 7, points: [{ key: NECK, parts: [] }] }] };
    expect(await grader({ transport: fake(v).transport }).interpret(neckLine, ctx)).toEqual(want);
    expect(mergeVerdict(want.sentences, v, ctx)).toEqual(want.sentences);
  });

  test('a sentence takes its first entry that credits anything; a later one for it is ignored', async () => {
    const ctx = ctxAt('delicate-spine', FALL);
    const { sentences } = await keywordGrader.interpret(neckLine, ctx);
    const v: SmartVerdict = { sentences: [
      { index: 1, points: [{ key: 'circulation/pulse', parts: [] }] },
      { index: 1, points: [{ key: NECK, parts: [] }, { key: NECK, parts: [] }] },
      { index: 1, points: [{ key: 'delicate-spine/neck-permission', parts: [] }] },
    ] };
    expect(mergeVerdict(sentences, v, ctx)[1]?.points.map(p => p.point)).toEqual(['ask-neck-pain']);
  });

  test('what the line already read is never credited again, so a line is never marked smart for nothing', async () => {
    const ctx = ctxAt('delicate-spine', FALL);
    const fallAgain: SmartVerdict = { sentences: [{ index: 1, points: [{ key: 'delicate-spine/ask-fall', parts: [] }] }] };
    expect(await grader({ transport: fake(fallAgain).transport }).interpret(neckLine, ctx)).toEqual(await keywordGrader.interpret(neckLine, ctx));
    // a part the line read stays the keyword grader's; one it didn't is the smart tester's
    const { sentences } = await keywordGrader.interpret('Any deformities at the back of your neck? Any ouch at your nape?', ctx);
    expect(sentences.map(s => s.points.map(p => [p.point, p.parts]))).toEqual([[['palpate-dtbl', ['deformities']]], []]);
    const dtbl = (parts: string[]): SmartVerdict => ({ sentences: [{ index: 1, points: [{ key: 'delicate-spine/palpate-dtbl', parts }] }] });
    expect(mergeVerdict(sentences, dtbl(['deformities', 'tenderness']), ctx)[1]?.points)
      .toEqual([{ step: 'delicate-spine', point: 'palpate-dtbl', parts: ['tenderness'], whole: false, missing: [], pos: 0 }]);
    expect(mergeVerdict(sentences, dtbl(['deformities']), ctx)).toEqual(sentences);
    // two unread sentences given one point: the first takes it
    const { sentences: two } = await keywordGrader.interpret('Any ouch at your nape? Any ouch at your nape?!', ctx);
    expect(two.map(s => s.points)).toEqual([[], []]);
    const both: SmartVerdict = { sentences: [0, 1].map(index => ({ index, points: [{ key: NECK, parts: [] }] })) };
    expect(mergeVerdict(two, both, ctx).map(s => s.smart)).toEqual([true, undefined]);
  });

  test('the missing words and the addressee follow the keyword rules for the point credited', async () => {
    const ctx = ctxAt('delicate-spine', 'hypo-hougang-01');
    const { sentences } = await keywordGrader.interpret('Buddy, you can let go now.', ctx);
    expect(sentences[0]?.points).toEqual([]);
    const [grip] = mergeVerdict(sentences, { sentences: [{ index: 0, points: [{ key: 'delicate-spine/release-grip', parts: [] }] }] }, ctx);
    expect(grip).toMatchObject({ step: 'delicate-spine', smart: true, addressee: 'headBuddy',
      points: [{ point: 'release-grip', whole: true, missing: ['no suspected spinal'] }] });
  });

  test('missing words are read on the sentence with its addressee words blanked, as readPoint reads them (M2)', async () => {
    // a required word that is also an addressee word ("buddy") is never found, by the keyword rules or the smart tester
    const base = ctxAt('delicate-spine', 'hypo-hougang-01');
    const steps = base.steps.map(s => (s.id !== 'delicate-spine' ? s : { ...s, mustHit: s.mustHit.map(m =>
      (m.id === 'release-grip' ? { ...m, requiredWords: [...(m.requiredWords ?? []), 'buddy'] } : m)) }));
    const ctx = { ...base, steps };
    const said = 'Buddy, no suspected spinal injuries, remove head grip.';
    const keyword = (await keywordGrader.interpret(said, ctx)).sentences[0]?.points.find(p => p.point === 'release-grip');
    expect(keyword?.missing).toEqual(['buddy']);
    const { sentences } = await keywordGrader.interpret('Buddy, you can let go now.', ctx);
    const [grip] = mergeVerdict(sentences, { sentences: [{ index: 0, points: [{ key: 'delicate-spine/release-grip', parts: [] }] }] }, ctx);
    expect(grip?.points[0]?.missing).toEqual(['no suspected spinal', 'buddy']);
  });

  test('before arrival the patient\'s words are the caller\'s, as the keyword grader hears them on the phone', async () => {
    const ctx = onCall();
    const { sentences } = await keywordGrader.interpret('Mdm Tan, tell me the story.', ctx);
    expect(sentences[0]).toMatchObject({ points: [], addressee: 'caller' });
    const f = fake({ sentences: [{ index: 0, points: [{ key: 'call-caller/what-happened', parts: [] }] }] });
    const [story] = (await grader({ transport: f.transport }).interpret('Mdm Tan, tell me the story.', ctx)).sentences;
    expect(story).toMatchObject({ step: 'call-caller', smart: true, addressee: 'caller', points: [{ point: 'what-happened', whole: true }] });
    expect(f.calls[0]).toMatchObject({ arrived: false, step: { order: 2, name: 'Call caller' },
      sentences: [{ index: 0, text: 'the patient, tell me the story.' }] });
  });

  test('oxygen, ECG, arm and question stay as the keyword grader read them', async () => {
    const ctx = ctxAt('delicate-spine', FALL);
    const { sentences } = await keywordGrader.interpret(neckLine, ctx);
    const [, merged] = mergeVerdict(sentences, neckVerdict, ctx);
    const pick = (s: typeof merged) => ({ oxygen: s?.oxygen, ecg: s?.ecg, arm: s?.arm, question: s?.question, text: s?.text });
    expect(pick(merged)).toEqual(pick(sentences[1]));
    expect(merged?.question).toBe(true);
  });
});

describe('what is asked', () => {
  test('a line the keyword grader reads whole is never asked', async () => {
    const f = fake(neckVerdict);
    await grader({ transport: f.transport }).interpret('Sir, did you fall?', ctxAt('delicate-spine', FALL));
    expect(f.calls).toHaveLength(0);
  });

  test('a sentence dropped before arrival is never sent; the unread one beside it is', async () => {
    const f = fake(null);
    const ctx = onCall();
    const { sentences } = await keywordGrader.interpret('Any ouch at your nape? Let me feel the back of your neck.', ctx);
    expect(sentences.map(s => s.dropped)).toEqual([undefined, 'statement']);
    await grader({ transport: f.transport }).interpret('Any ouch at your nape? Let me feel the back of your neck.', ctx);
    expect(f.calls.map(c => c.sentences)).toEqual([[{ index: 0, text: 'Any ouch at your nape?' }]]);
  });

  test('a line that arrives part way sends only its sentences before the arrival, with the call\'s candidates', async () => {
    const ctx = onCall();
    const f = fake(null);
    const g = grader({ transport: f.transport });
    const after = await keywordGrader.interpret('Buddy, don gloves and mask. Any ouch at your nape?', ctx);
    expect(after.sentences.map(s => s.arrives)).toEqual(['preparation', undefined]);
    expect(after.sentences[1]?.points).toEqual([]);
    expect(await g.interpret('Buddy, don gloves and mask. Any ouch at your nape?', ctx)).toEqual(after);   // after: never sent
    expect(f.calls).toHaveLength(0);
    await g.interpret('Any ouch at your nape? Buddy, don gloves and mask.', ctx);
    expect(f.calls.map(c => c.sentences)).toEqual([[{ index: 0, text: 'Any ouch at your nape?' }]]);
    expect(f.calls[0]?.candidates.every(c => orderOf(c.key) <= 2)).toBe(true);
    // and a verdict for the sentence past the arrival is never applied there
    const v: SmartVerdict = { sentences: [{ index: 1, points: [{ key: 'call-caller/what-happened', parts: [] }] }] };
    expect(mergeVerdict(after.sentences, v, ctx)).toEqual(after.sentences);
  });

  test('no candidates, no request', async () => {
    const f = fake(neckVerdict);
    const ctx = ctxAt('preparation', 'copd-amk-01');   // not arrived, past the call: nothing the smart tester may credit
    expect(smartCandidates({ ...ctx, arrived: false })).toEqual([]);
    await grader({ transport: f.transport }).interpret('Any ouch at your nape?', { ...ctx, arrived: false });
    expect(f.calls).toHaveLength(0);
  });
});

describe('failures fall back to the keyword reading (D14)', () => {
  afterEach(() => { vi.useRealTimers(); });

  test('a transport that never settles: the keyword reading at 6 s, onFailure once', async () => {
    vi.useFakeTimers();
    const ctx = ctxAt('delicate-spine', FALL);
    const want = await keywordGrader.interpret(neckLine, ctx);
    const onFailure = vi.fn();
    const g = grader({ transport: () => new Promise(() => {}), onFailure });
    let settled = false;
    const got = g.interpret(neckLine, ctx).then(r => { settled = true; return r; });
    await vi.advanceTimersByTimeAsync(SMART_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
    expect(await got).toEqual(want);
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledWith('timeout');
  });

  test('timeoutMs sets the budget', async () => {
    vi.useFakeTimers();
    const onFailure = vi.fn();
    const got = grader({ transport: () => new Promise(() => {}), onFailure, timeoutMs: 100 }).interpret(neckLine, ctxAt('delicate-spine', FALL));
    await vi.advanceTimersByTimeAsync(100);
    expect((await got).sentences[1]?.points).toEqual([]);
    expect(onFailure).toHaveBeenCalledWith('timeout');
  });

  test('an answer in time leaves no timer behind', async () => {
    vi.useFakeTimers();
    await grader({ transport: fake(neckVerdict).transport }).interpret(neckLine, ctxAt('delicate-spine', FALL));
    expect(vi.getTimerCount()).toBe(0);
  });

  test('a late answer is ignored: never applied, never cached as a verdict, its usage never reported', async () => {
    vi.useFakeTimers();
    const ctx = ctxAt('delicate-spine', FALL);
    const want = await keywordGrader.interpret(neckLine, ctx);
    let answer: (x: Awaited<ReturnType<SmartTransport>>) => void = () => {};
    let calls = 0;
    const onUsage = vi.fn();
    const onFailure = vi.fn();
    const g = grader({ onUsage, onFailure, transport: () => {
      calls++;
      return new Promise(resolve => { answer = resolve; });
    } });
    const got = g.interpret(neckLine, ctx);
    await vi.advanceTimersByTimeAsync(SMART_TIMEOUT_MS);
    expect(await got).toEqual(want);
    answer({ verdict: neckVerdict, usage: { inputTokens: 900, outputTokens: 40 } });
    await vi.advanceTimersByTimeAsync(0);
    expect(onUsage).not.toHaveBeenCalled();
    // read again: the failed check is never sent again, and the late verdict never answers it (I2's negative cache)
    expect(await g.interpret(neckLine, ctx)).toEqual(want);
    expect(calls).toBe(1);
    expect(onFailure.mock.calls).toEqual([['timeout']]);
  });

  test('a transport that throws, or rejects: the keyword reading, onFailure once', async () => {
    const ctx = ctxAt('delicate-spine', FALL);
    const want = await keywordGrader.interpret(neckLine, ctx);
    for (const transport of [
      (): never => { throw new Error('network'); },
      async (): Promise<never> => { throw new Error('500'); },
    ] as SmartTransport[]) {
      const onFailure = vi.fn();
      expect(await grader({ transport, onFailure }).interpret(neckLine, ctx)).toEqual(want);
      expect(onFailure.mock.calls).toEqual([['error']]);
    }
  });

  test('a null verdict (a refusal or an answer that did not parse, D19) or a malformed one: the keyword reading', async () => {
    const ctx = ctxAt('delicate-spine', FALL);
    const want = await keywordGrader.interpret(neckLine, ctx);
    const bad: unknown[] = [null, { sentences: 'all' }, { sentences: [{ index: '1', points: [] }] },
      { sentences: [{ index: 1, points: [{ key: NECK, parts: 'x' }] }] }, { sentences: [{ index: 1 }] }];
    for (const verdict of bad) {
      const onFailure = vi.fn();
      const f = fake(verdict as SmartVerdict | null);
      const g = grader({ transport: f.transport, onFailure });
      expect(await g.interpret(neckLine, ctx)).toEqual(want);
      expect(onFailure.mock.calls).toEqual([['invalid']]);
      expect(await g.interpret(neckLine, ctx)).toEqual(want);
      expect(f.calls).toHaveLength(1);   // a failed check is cached as failed: never sent again, no second word (I2)
      expect(onFailure).toHaveBeenCalledTimes(1);
    }
    const onFailure = vi.fn();
    const g = grader({ transport: async () => (undefined as unknown as Awaited<ReturnType<SmartTransport>>), onFailure });
    expect(await g.interpret(neckLine, ctx)).toEqual(want);
    expect(onFailure.mock.calls).toEqual([['invalid']]);
  });

  test('offline: the transport is never called, and onFailure isn\'t either', async () => {
    const ctx = ctxAt('delicate-spine', FALL);
    const f = fake(neckVerdict);
    const onFailure = vi.fn();
    const got = await smartGrader({ transport: f.transport, online: () => false, onFailure }).interpret(neckLine, ctx);
    expect(got).toEqual(await keywordGrader.interpret(neckLine, ctx));
    expect(f.calls).toHaveLength(0);
    expect(onFailure).not.toHaveBeenCalled();
  });

  test('a callback that throws never costs the line its reading', async () => {
    const ctx = ctxAt('delicate-spine', FALL);
    const g = grader({ transport: fake(neckVerdict).transport, onUsage: () => { throw new Error('quota'); } });
    expect((await g.interpret(neckLine, ctx)).sentences[1]?.smart).toBe(true);
    const h = grader({ transport: fake(null).transport, onFailure: () => { throw new Error('toast'); } });
    expect((await h.interpret(neckLine, ctx)).sentences[1]?.points).toEqual([]);
  });
});

describe('the cache, the cap and the usage (D14, D15)', () => {
  test('the same line and context twice call the transport once, and read the same', async () => {
    const ctx = ctxAt('delicate-spine', FALL);
    const f = fake(neckVerdict);
    const g = grader({ transport: f.transport });
    const one = await g.interpret(neckLine, ctx);
    const two = await g.interpret(neckLine, ctx);
    expect(f.calls).toHaveLength(1);
    expect(two).toEqual(one);
    expect(two.sentences[1]?.smart).toBe(true);
  });

  test('the cache key holds no time: a retry after the clock passes a minute reads from the cache (M4)', async () => {
    const f = fake(neckVerdict);
    const g = grader({ transport: f.transport });
    const one = await g.interpret(neckLine, ctxAt('delicate-spine', FALL, 6));
    const two = await g.interpret(neckLine, ctxAt('delicate-spine', FALL, 5));
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]?.facts.eta).toBe(6);   // the ETA is still sent (D17)
    expect(two).toEqual(one);
  });

  test('a cached verdict still answers offline and past the cap, so a re-read reads the same', async () => {
    const ctx = ctxAt('delicate-spine', FALL);
    const f = fake(neckVerdict);
    let online = true;
    const g = smartGrader({ transport: f.transport, online: () => online, maxChecks: 1 });
    const one = await g.interpret(neckLine, ctx);
    online = false;
    expect(await g.interpret(neckLine, ctx)).toEqual(one);
    online = true;
    expect(await g.interpret(neckLine, ctx)).toEqual(one);
    expect(f.calls).toHaveLength(1);
  });

  describe('one budget a line (I2)', () => {
    afterEach(() => { vi.useRealTimers(); });
    const lineCtx = (budget: LineBudget): GradeContext => ({ ...ctxAt('delicate-spine', FALL), budget });

    test('after a line\'s first failure, its other reads send nothing and say nothing more', async () => {
      vi.useFakeTimers();
      const onFailure = vi.fn();
      let calls = 0;
      const g = grader({ onFailure, transport: () => { calls++; return new Promise(() => {}); } });
      const budget = lineBudget();
      const ctx = lineCtx(budget);
      const one = g.interpret(neckLine, ctx);
      await vi.advanceTimersByTimeAsync(SMART_TIMEOUT_MS);
      expect((await one).sentences[1]?.points).toEqual([]);
      const two = await g.interpret('Any ouch at your nape?!', ctx);   // another question, same line
      expect(two).toEqual(await keywordGrader.interpret('Any ouch at your nape?!', ctx));
      expect(calls).toBe(1);
      expect(onFailure.mock.calls).toEqual([['timeout']]);
      budget.close();
      expect(vi.getTimerCount()).toBe(0);
    });

    test('the deadline is the line\'s: a second check gets only what the first left of it', async () => {
      vi.useFakeTimers();
      const onFailure = vi.fn();
      let calls = 0;
      const g = grader({ onFailure, transport: () => {
        calls++;
        return calls === 1 ? new Promise(resolve => { setTimeout(() => resolve({ verdict: neckVerdict, usage: null }), 4000); })
          : new Promise(() => {});
      } });
      const budget = lineBudget();
      const ctx = lineCtx(budget);
      const one = g.interpret(neckLine, ctx);
      await vi.advanceTimersByTimeAsync(4000);
      expect((await one).sentences[1]?.smart).toBe(true);
      let settled = false;
      const two = g.interpret('Any ouch at your nape?!', ctx).then(r => { settled = true; return r; });
      await vi.advanceTimersByTimeAsync(SMART_TIMEOUT_MS - 4000 - 1);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);   // 6 s from the line's first check, not from this one
      expect(settled).toBe(true);
      expect((await two).sentences[0]?.points).toEqual([]);
      expect(onFailure.mock.calls).toEqual([['timeout']]);
      budget.close();
    });

    test('a line whose time ran out between checks sends nothing more, and says so once', async () => {
      vi.useFakeTimers();
      const onFailure = vi.fn();
      const f = fake(neckVerdict);
      const g = grader({ onFailure, transport: f.transport });
      const budget = lineBudget();
      const ctx = lineCtx(budget);
      expect((await g.interpret(neckLine, ctx)).sentences[1]?.smart).toBe(true);
      await vi.advanceTimersByTimeAsync(SMART_TIMEOUT_MS);
      expect(budget.expired).toBe(true);
      await g.interpret('Any ouch at your nape?!', ctx);
      await g.interpret('Any ouch at your nape?!!', ctx);
      expect(f.calls).toHaveLength(1);
      expect(onFailure.mock.calls).toEqual([['timeout']]);
      expect((await g.interpret(neckLine, ctx)).sentences[1]?.smart).toBe(true);   // a cached verdict still answers
      budget.close();
    });

    test('a read with no line budget is a line of its own, and leaves no timer behind', async () => {
      vi.useFakeTimers();
      const onFailure = vi.fn();
      const g = grader({ onFailure, transport: fake(null).transport });
      await g.interpret('Any ouch at your nape?!', ctxAt('delicate-spine', FALL));
      await g.interpret('Any ouch at your nape?!!', ctxAt('delicate-spine', FALL));
      expect(onFailure).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  test('the cap: with maxChecks 2, the third distinct line doesn\'t call the transport', async () => {
    const ctx = ctxAt('delicate-spine', FALL);
    const f = fake(null);
    const onFailure = vi.fn();
    const g = grader({ transport: f.transport, maxChecks: 2, onFailure });
    await g.interpret('Any ouch at your nape?!', ctx);
    await g.interpret('Any ouch at your nape?!!', ctx);
    expect(f.calls).toHaveLength(2);
    const third = await g.interpret('Any ouch at your nape?!!!', ctx);
    expect(f.calls).toHaveLength(2);
    expect(third).toEqual(await keywordGrader.interpret('Any ouch at your nape?!!!', ctx));
    expect(onFailure).toHaveBeenCalledTimes(2);   // the two null verdicts; the cap itself is silent
  });

  test('the default cap is SMART_MAX_CHECKS checks a grader', async () => {
    const ctx = ctxAt('delicate-spine', FALL);
    const f = fake({ sentences: [] });
    const g = grader({ transport: f.transport });
    for (let n = 1; n <= SMART_MAX_CHECKS + 3; n++) await g.interpret(`Any ouch at your nape?${'!'.repeat(n)}`, ctx);
    expect(f.calls).toHaveLength(SMART_MAX_CHECKS);
  });

  test('onUsage gets the transport\'s usage for each check, never for a cache hit', async () => {
    const ctx = ctxAt('delicate-spine', FALL);
    const onUsage = vi.fn();
    const g = grader({ transport: fake(neckVerdict).transport, onUsage });
    await g.interpret(neckLine, ctx);
    await g.interpret(neckLine, ctx);
    expect(onUsage.mock.calls).toEqual([[{ inputTokens: 900, outputTokens: 40 }]]);
    const none = vi.fn();
    await grader({ transport: async () => ({ verdict: neckVerdict, usage: null }), onUsage: none }).interpret(neckLine, ctx);
    expect(none).not.toHaveBeenCalled();
  });
});

describe('the engine', () => {
  const fall = caseById(FALL);
  const upTo = (order: number) => STEPS.filter(s => s.order <= order).map(s => s.id);
  /** A FALL run at the delicate spine, steps 1 to 7 done. */
  const at8 = (): RunSession => ({ ...hitAll(blankSession(FALL), STEPS, fall, upTo(7)), current: 8, arrived: true });
  const NOW = T0 + 60_000;

  test('sendLine applies the smart credit: the hit is saved, the trainee\'s line is marked, endRun counts it', async () => {
    const f = fake(neckVerdict);
    const env = envOf(FALL, grader({ transport: f.transport }));
    const s = (await sendLine(env, at8(), neckLine, NOW)).session;
    expect(s.hits[NECK]).toMatchObject({ said: 'Any ouch at your nape?', missing: [], during: 8, check: null });
    expect(s.hits['delicate-spine/ask-fall']).toBeDefined();
    const mine = s.lines.filter(l => l.who === 'you');
    expect(mine.at(-1)).toMatchObject({ text: neckLine, smart: true });
    expect(mine.slice(0, -1).some(l => l.smart !== undefined)).toBe(false);
    expect(mine.at(-1)?.route).toContain(pointOf(NECK)?.short);
    expect(endRun(env, s, NOW + 1000).smartLines).toBe(1);
    expect(f.calls).toHaveLength(1);
  });

  test('a queue retry of the same line reads the same from the cache; the debrief never regrades', async () => {
    const f = fake(neckVerdict);
    const env = envOf(FALL, grader({ transport: f.transport }));
    const start = at8();
    const one = (await sendLine(env, start, neckLine, NOW)).session;
    const two = (await sendLine(env, start, neckLine, NOW)).session;
    expect(two).toEqual(one);
    expect(f.calls).toHaveLength(1);
    // a reloaded run keeps the hit and the mark, and ends with them under a grader that would fail every check
    const reloaded = normalizeProgress({ runOpen: JSON.parse(JSON.stringify(one)) })?.runOpen;
    expect(reloaded).toEqual(one);
    const broken = envOf(FALL, grader({ transport: () => { throw new Error('never asked'); } }));
    expect(endRun(broken, reloaded!, NOW + 1000)).toEqual(endRun(env, one, NOW + 1000));
  });

  test('a held line read again on arrival is marked where the smart tester credits it there', async () => {
    const WITNESSES = 'scene-evaluation/witnesses';
    const calls: SmartRequest[] = [];
    // answers only on scene, where the scene evaluation's witnesses are a candidate
    const transport: SmartTransport = async (req) => {
      calls.push(req);
      const on = req.arrived && req.candidates.some(c => c.key === WITNESSES);
      return { verdict: { sentences: on ? req.sentences.map(x => ({ index: x.index, points: [{ key: WITNESSES, parts: [] }] })) : [] }, usage: null };
    };
    const env = envOf('copd-amk-01', grader({ transport }));
    const start: RunSession = { ...hitAll(blankSession('copd-amk-01'), STEPS, copd, ['respond-call']), current: 2 };
    const at = start.lines.length;
    const one = (await sendLine(env, start, 'Let me feel the back of your neck. Any ouch at your nape?', NOW)).session;
    expect(one.held).toBe(at);   // a scene statement before arrival, and nothing credited on the call
    expect(one.lines[at]?.smart).toBeUndefined();
    const two = (await sendLine(env, one, 'Let me feel the back of your neck.', NOW + 20_000)).session;   // (e): arrives
    expect(two.arrived).toBe(true);
    expect(two.hits[WITNESSES]).toMatchObject({ line: at, said: 'Any ouch at your nape?' });
    expect(two.lines[at]).toMatchObject({ who: 'you', smart: true });
    expect(two.lines.filter(l => l.smart === true)).toHaveLength(1);
    expect(calls.map(c => [c.arrived, c.sentences])).toEqual([
      [false, [{ index: 1, text: 'Any ouch at your nape?' }]],   // the call's candidates: nothing credited
      [true, [{ index: 1, text: 'Any ouch at your nape?' }]],    // read again on scene
    ]);
    expect(endRun(env, two, NOW + 40_000).smartLines).toBe(1);
  });

  describe('one budget a line in sendLine (I2)', () => {
    afterEach(() => { vi.useRealTimers(); });
    const HELD = 'Let me feel the back of your neck. Any ouch at your nape?';
    const ARRIVES = 'Is that so? Let me feel the back of your neck. Is that right?';   // (e): read in parts

    test('a held line, then an arrival line read in parts, with a transport that never answers: about 6 s, one word', async () => {
      vi.useFakeTimers();
      const calls: SmartRequest[] = [];
      const onFailure = vi.fn();
      const env = envOf('copd-amk-01', grader({ onFailure, transport: (req) => { calls.push(req); return new Promise(() => {}); } }));
      const start: RunSession = { ...hitAll(blankSession('copd-amk-01'), STEPS, copd, ['respond-call']), current: 2 };
      const heldP = sendLine(env, start, HELD, NOW);
      await vi.advanceTimersByTimeAsync(SMART_TIMEOUT_MS);
      const one = (await heldP).session;
      expect(one.held).toBe(start.lines.length);
      expect([calls.length, onFailure.mock.calls.length]).toEqual([1, 1]);
      // the arrival line is read in four parts (the line, its call part, the held line again, its rest): one deadline
      let settled = false;
      const twoP = sendLine(env, one, ARRIVES, NOW + 20_000).then(r => { settled = true; return r; });
      await vi.advanceTimersByTimeAsync(SMART_TIMEOUT_MS - 1);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(settled).toBe(true);
      const two = (await twoP).session;
      expect(two.arrived).toBe(true);
      expect([calls.length, onFailure.mock.calls.length]).toEqual([2, 2]);   // one check and one word for this line
      expect(vi.getTimerCount()).toBe(0);   // the line's budget is closed
      // it reads as the keyword rules read it
      const kw = envOf('copd-amk-01');
      const kwOne = (await sendLine(kw, start, HELD, NOW)).session;
      expect(two).toEqual((await sendLine(kw, kwOne, ARRIVES, NOW + 20_000)).session);
      // a queue retry of the failed line asks nothing: its failed check is never sent again
      let again = false;
      const retry = sendLine(env, one, ARRIVES, NOW + 20_000).then(r => { again = true; return r; });
      await vi.advanceTimersByTimeAsync(0);
      expect(again).toBe(true);
      expect((await retry).session).toEqual(two);
      expect([calls.length, onFailure.mock.calls.length]).toEqual([2, 2]);
    });

    test('a transport that throws: one check and one word for the whole line', async () => {
      const calls: SmartRequest[] = [];
      const onFailure = vi.fn();
      const env = envOf('copd-amk-01', grader({ onFailure, transport: async (req) => { calls.push(req); throw new Error('500'); } }));
      const start: RunSession = { ...hitAll(blankSession('copd-amk-01'), STEPS, copd, ['respond-call']), current: 2 };
      const one = (await sendLine(env, start, HELD, NOW)).session;
      await sendLine(env, one, ARRIVES, NOW + 20_000);
      expect([calls.length, onFailure.mock.calls]).toEqual([2, [['error'], ['error']]]);
    });

    test('the engine sends the run\'s own ETA (M1)', async () => {
      const f = fake({ sentences: [] });
      const env = envOf(FALL, grader({ transport: f.transport }));
      const s = at8();
      await sendLine(env, s, neckLine, NOW);
      expect(f.calls[0]?.facts.eta).toBe(gradeContext(env, s, NOW).eta);
      expect(typeof f.calls[0]?.facts.eta).toBe('number');
    });
  });

  test('the keyword grader alone marks nothing, and endRun counts 0', async () => {
    const env = envOf(FALL);
    const s = (await sendLine(env, at8(), neckLine, NOW)).session;
    expect(s.hits[NECK]).toBeUndefined();
    expect(s.lines.some(l => 'smart' in l)).toBe(false);
    expect(endRun(env, s, NOW + 1000).smartLines).toBe(0);
  });
});

test('smart.ts stays pure: no window, document, navigator or preact, nothing from src/smart or src/voice (Global)', () => {
  const src = readFileSync('src/sim/smart.ts', 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');   // its comments may name them
  const from = [...code.matchAll(/from '([^']+)'/g)].map(m => m[1]);
  expect(from.sort()).toEqual(['../data/schema', './grader', './match']);
  expect(code).not.toMatch(/\b(?:window|document|navigator|localStorage|fetch|globalThis|self|Date)\b/);
  expect(code).not.toMatch(/import\(/);
  // the line's deadline (lineBudget, grader.ts) is a setTimeout, which Node has too; grader.ts stays as pure
  const seam = readFileSync('src/sim/grader.ts', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  expect(seam).toMatch(/\bsetTimeout\(/);
  expect(seam).not.toMatch(/\b(?:window|document|navigator|localStorage|fetch|globalThis|self|Date)\b/);
});
