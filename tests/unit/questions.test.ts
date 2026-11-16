// Task 13: merging questions.json with the overrides.json overlay into the Question objects the quiz uses.
import { GROUPS, groupOf, mergeQuestions, questionLabel } from '../../src/data/questions';
import type { OverrideEntry, OverridesDoc, RawQuestion, RawQuestionsDoc } from '../../src/data/schema';

const STALE = 'The source question changed since this explanation was written.';
const NO_EXPLANATION = 'No explanation yet.';

const HASH_1 = 'aaaaaaaaaaaa';
const HASH_2 = 'bbbbbbbbbbbb';

/** Two questions: mt-b 115 with two auto review reasons and no raw topic, and hmls 12 with a raw topic. */
function rawDoc(extra: RawQuestion[] = []): RawQuestionsDoc {
  return {
    contentVersion: 'test',
    banks: [
      { id: 'mt-b', label: 'Medical and trauma, part B', source: 'mt.pdf' },
      { id: 'hmls', label: 'HMLS', source: 'hmls.pdf' },
    ],
    questions: [
      {
        id: 'mt-b-q115', bank: 'mt-b', number: 115, passage: null,
        stem: 'Which sign comes late in shock?',
        options: [
          { id: 'a', label: 'A', text: 'Falling blood pressure' },
          { id: 'b', label: 'A', text: 'Anxiety' },
        ],
        answer: 'a', image: null, topic: null,
        review: [
          { code: 'duplicate-label', reason: 'The bank printed the letter A on two options.' },
          { code: 'image', reason: 'The question depends on an image.' },
        ],
        srcHash: HASH_1,
      },
      {
        id: 'hmls-q012', bank: 'hmls', number: 12, passage: 'A tanker has overturned on the expressway.',
        stem: 'Where do you park?',
        options: [
          { id: 'a', label: 'a', text: 'Upwind and uphill' },
          { id: 'b', label: 'b', text: 'Downwind' },
          { id: 'c', label: 'c', text: 'Beside the tanker' },
        ],
        answer: 'a', image: 'img/hmls-q012.png', topic: 'hmls', review: [], srcHash: HASH_2,
      },
      ...extra,
    ],
  };
}

const OVERRIDE_1: OverrideEntry = {
  srcHash: HASH_1, topic: 'shock', explanation: 'Blood pressure falls late, once compensation fails.',
  notesRef: 's07#signs-of-shock', generated: true,
};

function overrides(questions: Record<string, OverrideEntry>): OverridesDoc {
  return { version: 1, questions };
}

const byId = (qs: ReturnType<typeof mergeQuestions>, id: string) => {
  const q = qs.find(x => x.id === id);
  if (!q) throw new Error(`no merged question ${id}`);
  return q;
};

describe('override merge', () => {
  test("an override's topic, explanation and notesRef are merged in", () => {
    const q = byId(mergeQuestions(rawDoc(), overrides({ 'mt-b-q115': OVERRIDE_1 })), 'mt-b-q115');
    expect(q).toEqual({
      id: 'mt-b-q115', bank: 'mt-b', number: 115, passage: null,
      stem: 'Which sign comes late in shock?',
      options: [{ id: 'a', text: 'Falling blood pressure' }, { id: 'b', text: 'Anxiety' }],
      answer: 'a', image: null, topic: 'shock',
      explanation: 'Blood pressure falls late, once compensation fails.',
      notesRef: 's07#signs-of-shock', generated: true,
      review: ['The bank printed the letter A on two options.', 'The question depends on an image.'],
    });
  });

  test('the override topic wins over the raw topic, and the raw topic wins over the default', () => {
    const withOverride = mergeQuestions(rawDoc(), overrides({ 'hmls-q012': { ...OVERRIDE_1, srcHash: HASH_2, topic: 'ops' } }));
    expect(byId(withOverride, 'hmls-q012').topic).toBe('ops');
    expect(byId(mergeQuestions(rawDoc(), overrides({})), 'hmls-q012').topic).toBe('hmls');
  });

  test('passage and image come through, and a clean question has no review reasons', () => {
    const q = byId(mergeQuestions(rawDoc(), overrides({ 'hmls-q012': { ...OVERRIDE_1, srcHash: HASH_2, topic: 'hmls' } })), 'hmls-q012');
    expect(q.passage).toBe('A tanker has overturned on the expressway.');
    expect(q.image).toBe('img/hmls-q012.png');
    expect(q.review).toEqual([]);
  });

  test('the output keeps the raw order and ignores overrides for questions that are not there', () => {
    const qs = mergeQuestions(rawDoc(), overrides({ 'mt-a-q999': OVERRIDE_1 }));
    expect(qs.map(q => q.id)).toEqual(['mt-b-q115', 'hmls-q012']);
  });

  test('a question whose answer is null is dropped, because it cannot be graded', () => {
    const ungradable: RawQuestion = {
      id: 'mt-b-q116', bank: 'mt-b', number: 116, passage: null, stem: 'Which is right?',
      options: [{ id: 'a', label: 'a', text: 'This' }, { id: 'b', label: 'b', text: 'That' }],
      answer: null, image: null, topic: null,
      review: [{ code: 'no-answer', reason: 'No option is marked as the answer.' }], srcHash: 'cccccccccccc',
    };
    const qs = mergeQuestions(rawDoc([ungradable]), overrides({}));
    expect(qs.map(q => q.id)).toEqual(['mt-b-q115', 'hmls-q012']);
  });
});

describe('review reasons (Review Focus 4)', () => {
  test('a stale srcHash adds the "source question changed" reason and keeps the explanation', () => {
    const q = byId(mergeQuestions(rawDoc(), overrides({ 'hmls-q012': { ...OVERRIDE_1, srcHash: 'ffffffffffff' } })), 'hmls-q012');
    expect(q.review).toEqual([STALE]);
    expect(q.explanation).toBe(OVERRIDE_1.explanation);
    expect(q.notesRef).toBe(OVERRIDE_1.notesRef);
  });

  test('a missing override gives a null explanation and notesRef, topic assessment and "No explanation yet."', () => {
    const q = byId(mergeQuestions(rawDoc(), overrides({})), 'mt-b-q115');
    expect(q.explanation).toBeNull();
    expect(q.notesRef).toBeNull();
    expect(q.generated).toBe(false);
    expect(q.topic).toBe('assessment');
    expect(q.review).toEqual(['The bank printed the letter A on two options.', 'The question depends on an image.', NO_EXPLANATION]);
  });

  test('auto reasons come first, then the manual reason, then the stale reason', () => {
    const raw = rawDoc();
    const q = byId(mergeQuestions(raw, overrides({
      'mt-b-q115': { ...OVERRIDE_1, srcHash: 'ffffffffffff', review: 'Q115 and Q116 give different answers.' },
    })), 'mt-b-q115');
    expect(q.review).toEqual([
      'The bank printed the letter A on two options.',
      'The question depends on an image.',
      'Q115 and Q116 give different answers.',
      STALE,
    ]);
    expect(raw.questions[0]!.review).toHaveLength(2);   // the raw doc is not changed
  });
});

describe('labels and groups', () => {
  test('questionLabel names the bank and the number', () => {
    const qs = mergeQuestions(rawDoc(), overrides({}));
    expect(questionLabel(byId(qs, 'mt-b-q115'))).toBe('Medical and trauma, part B, question 115');
    expect(questionLabel(byId(qs, 'hmls-q012'))).toBe('HMLS, question 12');
    expect(questionLabel({ ...byId(qs, 'mt-b-q115'), bank: 'mt-a', number: 3 })).toBe('Medical and trauma, part A, question 3');
  });

  test('groupOf puts both medical and trauma parts in mt', () => {
    expect(groupOf('mt-a')).toBe('mt');
    expect(groupOf('mt-b')).toBe('mt');
    expect(groupOf('hmls')).toBe('hmls');
  });

  test('GROUPS lists the two groups and their banks', () => {
    expect(GROUPS).toEqual([
      { id: 'mt', label: 'Medical and trauma', banks: ['mt-a', 'mt-b'] },
      { id: 'hmls', label: 'HMLS', banks: ['hmls'] },
    ]);
  });
});
