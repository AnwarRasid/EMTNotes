// Task 19: the highlight passages the reader's Highlights only view lists, and a section's cross-links to PAM steps
// and quiz questions, against the real notes, steps and questions.
import * as v from 'valibot';
import notesDoc from '../../public/data/notes.json';
import stepsDoc from '../../public/data/steps.json';
import questionsDoc from '../../public/data/questions.json';
import overridesDoc from '../../public/data/overrides.json';
import { mergeQuestions, type Question } from '../../src/data/questions';
import {
  NotesDocSchema, OverridesDocSchema, RawQuestionsDocSchema, StepsDocSchema, type Block, type Section, type Step,
} from '../../src/data/schema';
import { highlightPassages, linksForSection, runsText } from '../../src/notes/text';

const NOTES = v.parse(NotesDocSchema, notesDoc);
const STEPS = v.parse(StepsDocSchema, stepsDoc).steps;
const QUESTIONS = mergeQuestions(v.parse(RawQuestionsDocSchema, questionsDoc), v.parse(OverridesDocSchema, overridesDoc));
const section = (id: string) => NOTES.sections.find((s) => s.id === id)!;

/** A one-off section of `blocks`, for shapes the real notes don't have. */
const sectionOf = (...blocks: Block[]): Section => ({ id: 's01', n: 1, title: 'Test section', tags: [], highlights: 0, blocks });
const hl = (t: string): Block => ({ k: 'p', runs: [{ t: 'plain ' }, { t, h: true }] });
const plain = (t: string): Block => ({ k: 'p', runs: [{ t }] });

describe('highlightPassages', () => {
  it.each(NOTES.sections.map((s) => [s.id, s] as const))('%s: as many passages as the importer counted', (_id, s) => {
    expect(highlightPassages(s)).toHaveLength(s.highlights);
  });

  it('gives every passage at least one highlighted run', () => {
    const all = NOTES.sections.flatMap(highlightPassages);
    expect(all.length).toBeGreaterThan(100);
    for (const p of all) expect(p.runs.some((r) => r.h)).toBe(true);
  });

  it('names each passage by the nearest heading before it', () => {
    const never = highlightPassages(section('s01')).find((p) => runsText(p.runs).includes('NEVER move the patient'));
    expect(never).toMatchObject({ headingId: 'approach-patient', heading: 'Approach Patient' });
  });

  it('names a passage before any heading by the section title, with no heading id', () => {
    const [first] = highlightPassages(sectionOf(hl('early'), { k: 'h', id: 'later', text: 'Later' }, hl('late')));
    expect(first).toMatchObject({ headingId: null, heading: 'Test section' });
  });

  it('takes paragraphs and list items at any depth, inside boxes and table cells, in document order', () => {
    const s = sectionOf(
      hl('one'),
      plain('not highlighted'),
      { k: 'h', id: 'h-a', text: 'A', runs: [{ t: 'A ' }, { t: '(tested)', h: true }] },   // a heading is never a passage
      { k: 'list', items: [
        { depth: 1, marker: '•', runs: [{ t: 'two', h: true }] },
        { depth: 2, marker: '–', runs: [{ t: 'no' }] },
        { depth: 2, marker: '–', runs: [{ t: 'three', h: true }] },
      ] },
      { k: 'box', variant: 'remark', title: 'Remark', blocks: [hl('four')] },
      { k: 'h', id: 'h-b', text: 'B' },
      { k: 'table', rows: [
        { header: true, cells: [[hl('five')], [plain('no')]] },
        { header: false, cells: [[{ k: 'list', items: [{ depth: 1, marker: '1.', runs: [{ t: 'six', h: true }] }] }], []] },
      ] },
      { k: 'img', src: 'img/notes/x.png', alt: 'Figure' },
    );
    const passages = highlightPassages(s);
    expect(passages.map((p) => runsText(p.runs).replace('plain ', ''))).toEqual(['one', 'two', 'three', 'four', 'five', 'six']);
    expect(passages.map((p) => p.headingId)).toEqual([null, 'h-a', 'h-a', 'h-a', 'h-b', 'h-b']);
    expect(passages.map((p) => p.heading)).toEqual(['Test section', 'A', 'A', 'A', 'B', 'B']);
  });

  it('keeps a numbered list item’s marker, and no bullet’s or dash’s', () => {
    const passages = highlightPassages(sectionOf({ k: 'list', items: [
      { depth: 1, marker: '2.', runs: [{ t: 'numbered', h: true }] },
      { depth: 1, marker: 'b)', runs: [{ t: 'lettered', h: true }] },
      { depth: 1, marker: '•', runs: [{ t: 'bullet', h: true }] },
      { depth: 2, marker: '–', runs: [{ t: 'dash', h: true }] },
    ] }, hl('paragraph')));
    expect(passages.map((p) => p.marker)).toEqual(['2.', 'b)', undefined, undefined, undefined]);
    expect(passages.filter((p) => 'marker' in p)).toHaveLength(2);
    const bleeding = highlightPassages(section('s01')).find((p) => runsText(p.runs).includes('Is there any Catastrophic Bleeding?'));
    expect(bleeding?.marker).toBe('2.');
  });

  it('gives nothing for a section with no highlights', () => {
    expect(highlightPassages(section('s07'))).toEqual([]);
  });
});

describe('linksForSection', () => {
  it('links s01 to all 19 PAM steps, in step order', () => {
    const { steps } = linksForSection('s01', STEPS, QUESTIONS);
    expect(steps).toHaveLength(19);
    expect(steps.map((s) => s.order)).toEqual(Array.from({ length: 19 }, (_, i) => i + 1));
    expect(steps.find((s) => s.order === 8)?.name).toBe('Delicate spine');
  });

  it('links exactly the questions whose notesRef is in the section, in bank order', () => {
    const { questionIds } = linksForSection('s01', STEPS, QUESTIONS);
    const expected = QUESTIONS.filter((q) => q.notesRef?.startsWith('s01')).map((q) => q.id);
    expect(expected.length).toBeGreaterThan(20);
    expect(questionIds).toEqual(expected);
  });

  it('matches the section id whole, with or without an anchor', () => {
    const step = (order: number, notesRef: string) => ({ ...STEPS[0]!, id: `x${order}`, order, notesRef }) as Step;
    const question = (id: string, notesRef: string | null) => ({ ...QUESTIONS[0]!, id, notesRef }) as Question;
    const links = linksForSection('s01',
      [step(3, 's01#later'), step(1, 's01'), step(2, 's02#airway')],
      [question('a', 's01'), question('b', 's11#oxygen'), question('c', null), question('d', 's01#x'), question('e', 's10')]);
    expect(links.steps.map((s) => s.order)).toEqual([1, 3]);
    expect(links.questionIds).toEqual(['a', 'd']);
  });

  it('gives nothing for a section no step or question uses', () => {
    expect(linksForSection('s19', STEPS, QUESTIONS)).toEqual({ steps: [], questionIds: [] });
  });
});
