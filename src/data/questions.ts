// The quiz's view of a question: questions.json (generated) merged with the overrides.json overlay (hand-written).
import type { BankId, OverridesDoc, RawQuestionsDoc, Topic } from './schema';

export interface Question {
  id: string;
  bank: BankId;
  number: number;
  passage: string | null;
  stem: string;
  options: { id: string; text: string }[];
  answer: string;
  image: string | null;
  topic: Topic;
  explanation: string | null;
  notesRef: string | null;
  generated: boolean;
  /** The course decks or files the explanation was checked against. Empty when none covers it. */
  slides: string[];
  /** Why the question is under review, in display order. Empty when it isn't. */
  review: string[];
}

export const GROUPS: { id: 'mt' | 'hmls'; label: string; banks: BankId[] }[] = [
  { id: 'mt', label: 'Medical and trauma', banks: ['mt-a', 'mt-b'] },
  { id: 'hmls', label: 'HMLS', banks: ['hmls'] },
];

const GROUP_OF: Record<BankId, 'mt' | 'hmls'> = { 'mt-a': 'mt', 'mt-b': 'mt', hmls: 'hmls' };

// The bank labels in questions.json; the Question doesn't carry them, so they are repeated here (a test checks they match).
const BANK_LABELS: Record<BankId, string> = {
  'mt-a': 'Medical and trauma, part A',
  'mt-b': 'Medical and trauma, part B',
  hmls: 'HMLS',
};

const STALE_REASON = 'The source question changed since this explanation was written.';
const NO_EXPLANATION_REASON = 'No explanation yet.';

export function groupOf(bank: BankId): 'mt' | 'hmls' {
  return GROUP_OF[bank];
}

/** "Medical and trauma, part B, question 115" or "HMLS, question 12". */
export function questionLabel(q: Question): string {
  return `${BANK_LABELS[q.bank]}, question ${q.number}`;
}

/**
 * One Question per raw question, in the raw order. The overlay supplies the topic (else the raw topic, else
 * 'assessment'), the explanation and the notes link. Review reasons run: the importer's, the overlay's, then
 * "source changed" when the overlay's hash is stale, or "no explanation" when there is no overlay entry.
 * A raw question with a null answer can't be graded, so it is left out (its flag stays in the import log).
 */
export function mergeQuestions(raw: RawQuestionsDoc, overrides: OverridesDoc): Question[] {
  const out: Question[] = [];
  for (const q of raw.questions) {
    if (q.answer === null) continue;
    const o = Object.hasOwn(overrides.questions, q.id) ? overrides.questions[q.id] : undefined;

    const review = q.review.map(r => r.reason);
    if (o?.review) review.push(o.review);
    if (o && o.srcHash !== q.srcHash) review.push(STALE_REASON);
    if (!o) review.push(NO_EXPLANATION_REASON);

    out.push({
      id: q.id,
      bank: q.bank,
      number: q.number,
      passage: q.passage,
      stem: q.stem,
      options: q.options.map(({ id, text }) => ({ id, text })),
      answer: q.answer,
      image: q.image,
      topic: o?.topic ?? q.topic ?? 'assessment',
      explanation: o?.explanation ?? null,
      notesRef: o?.notesRef ?? null,
      generated: o?.generated ?? false,
      slides: o?.slides ?? [],
      review,
    });
  }
  return out;
}
