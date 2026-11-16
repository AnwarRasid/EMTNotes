import * as v from 'valibot';
import questionsDoc from '../../public/data/questions.json';
import overridesDoc from '../../public/data/overrides.json';
import notesDoc from '../../public/data/notes.json';
import { OverrideEntrySchema } from '../../src/data/schema';
import { resolveNotesRef } from '../../src/data/notesRef';

const REQUIRED = () => true;   // widened in Tasks 10 and 11
const overrides = overridesDoc.questions as Record<string, any>;   // parsed per entry below, so one stub fails alone
const raw = new Map(questionsDoc.questions.map(q => [q.id, q]));

test('the file header is right', () => { expect(overridesDoc.version).toBe(1); });
test('every entry belongs to a real question and carries its current source hash', () => {
  for (const [id, o] of Object.entries(overrides)) expect(o.srcHash, id).toBe(raw.get(id)?.srcHash);
});
test('every required question has an entry', () => {
  const missing = questionsDoc.questions.filter(REQUIRED).filter(q => !overrides[q.id]).map(q => q.id);
  expect(missing).toEqual([]);
});
test.each(Object.entries(overrides))('%s: one plain line, right topic, real notes link', (id, o) => {
  expect(v.safeParse(OverrideEntrySchema, o).success).toBe(true);
  expect(o.explanation).not.toMatch(/\n/);
  expect(o.explanation.length).toBeGreaterThanOrEqual(20);
  expect(o.explanation.length).toBeLessThanOrEqual(220);
  expect(o.explanation).not.toMatch(/\b(?:option|answer|choice) [A-D]\b|\([A-D]\)/);   // options are shuffled
  expect(o.generated).toBe(true);
  expect(o.topic === 'hmls').toBe(raw.get(id)!.bank === 'hmls');
  if (o.notesRef) expect(resolveNotesRef(notesDoc as any, o.notesRef)).not.toBeNull();
});
test('the Q207/Q208 contradiction is flagged on both', () => {
  expect(overrides['mt-b-q207'].review).toMatch(/Q208/);
  expect(overrides['mt-b-q208'].review).toMatch(/Q207/);
});
test('pyrexia keeps the official answer and says what the notes say', () => {
  expect(raw.get('mt-b-q232')!.answer).toBe('c');
  expect(overrides['mt-b-q232'].explanation).toMatch(/37\.5/);
});
test('all 407 questions have an explanation', () => { expect(Object.keys(overrides)).toHaveLength(407); });
// User ruling: suction follows notes s13 (switch the LSU on, insert to the measured depth, then apply suction). The unit
// being on is not suctioning, so the line says suction never runs while inserting (the bank's wrong option reads that way).
test('suctioning keeps the official answer and follows the notes on the LSU', () => {
  expect(raw.get('mt-a-q009')!.answer).toBe('a');
  expect(overrides['mt-a-q009'].notesRef).toBe('s13#lsu-portable-suction-unit');
  const e: string = overrides['mt-a-q009'].explanation;
  expect(e).toMatch(/switch the LSU on first/i);   // s13 step 4, before inserting (step 7) and suctioning (step 8)
  expect(e).toMatch(/suction only once the catheter is in place/i);
  expect(e).toMatch(/never while inserting/i);
  expect(e).toMatch(/measured depth/i);
  expect(e).not.toMatch(/power on/i);
  expect(overrides['mt-a-q009'].review).toBeUndefined();
});
