// Task 18: the notes' plain text and the Notes tab's search, against the real notes.json.
import * as v from 'valibot';
import notesDoc from '../../public/data/notes.json';
import { NotesDocSchema, type Block, type NotesDoc } from '../../src/data/schema';
import { blockText, runsText, searchable, searchNotes, type SearchHit } from '../../src/notes/text';

const NOTES: NotesDoc = v.parse(NotesDocSchema, notesDoc);
const section = (id: string) => NOTES.sections.find((s) => s.id === id)!;

const where = (hits: SearchHit[]) => hits.map((h) => `${h.sectionId}:${h.blockIndex}`);

/** The block text a hit came from as the snippets show it: whitespace collapsed, pieces joined by ' · '. */
const plainOf = (h: SearchHit) => blockText(section(h.sectionId).blocks[h.blockIndex]!)
  .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l !== '').join(' · ');

/** A one-section doc of `blocks`, for edge cases the real notes don't have. */
const docOf = (...blocks: Block[]): NotesDoc => ({
  contentVersion: 'test', source: 'EMT_Survey_Notes.docx',
  sections: [{ id: 's01', n: 1, title: 'Test', tags: [], highlights: 0, blocks }],
});
const p = (t: string): Block => ({ k: 'p', runs: [{ t }] });

describe('runsText and blockText', () => {
  it('joins runs as written, keeping literal ** from the docx', () => {
    expect(runsText([{ t: 'Apply ' }, { t: 'C-Collar', b: true, h: true }, { t: ' **now**' }])).toBe('Apply C-Collar **now**');
    expect(runsText([])).toBe('');
  });

  it('takes a heading, a paragraph and each list item, without the list markers', () => {
    expect(blockText({ k: 'h', id: 'x', text: 'Delicate Spine' })).toBe('Delicate Spine');
    expect(blockText(p('Check the airway.'))).toBe('Check the airway.');
    const list: Block = { k: 'list', items: [{ depth: 1, marker: '1.', runs: [{ t: 'Open' }] }, { depth: 2, marker: '–', runs: [{ t: 'Look' }] }] };
    expect(blockText(list).split('\n')).toEqual(['Open', 'Look']);
  });

  it('reaches into table cells and boxes, title included; an image has no text', () => {
    const verbal = section('s03').blocks[3]!;
    expect(verbal.k).toBe('table');
    expect(blockText(verbal)).toContain('Orientated');
    const box: Block = { k: 'box', variant: 'remark', title: 'Remark', blocks: [p('Inside'), { k: 'table', rows: [{ header: false, cells: [[p('Cell')]] }] }] };
    expect(blockText(box).split('\n')).toEqual(['Remark', 'Inside', 'Cell']);
    expect(blockText({ k: 'img', src: 'img/notes/a.png', alt: 'Figure 1: Auscultation (6 points)' })).toBe('');
  });
});

describe('searchNotes', () => {
  it("finds 'ensapa' in s01, case-insensitively, with the notes' own case in the match", () => {
    const hits = searchNotes(NOTES, 'ensapa');
    const s01 = hits.filter((h) => h.sectionId === 's01');
    expect(s01.length).toBeGreaterThan(0);
    expect(s01[0]!.sectionTitle).toBe('Primary Survey');
    for (const h of hits) expect(h.match).toBe('ENSAPA');
  });

  it("treats '(ENSAPA' as plain text: no throw, and the same hits as 'ensapa'", () => {
    expect(() => searchNotes(NOTES, '(ENSAPA')).not.toThrow();
    const hits = searchNotes(NOTES, '(ENSAPA');
    expect(where(hits)).toEqual(where(searchNotes(NOTES, 'ensapa')));
    for (const h of hits) expect(h.match).toBe('(ENSAPA');
  });

  it('never reads the query as a pattern', () => {
    const doc = docOf(p('Give O2 at 15 L/min (NRB). Then reassess.'));
    expect(searchNotes(doc, '.*')).toEqual([]);
    expect(searchNotes(doc, '[a-z]+')).toEqual([]);
    expect(searchNotes(doc, '(nrb).')).toHaveLength(1);
    expect(searchNotes(doc, 'L/MIN')[0]?.match).toBe('L/min');
  });

  it('returns [] for a trimmed query under 2 characters', () => {
    expect(searchNotes(NOTES, 'e')).toEqual([]);
    expect(searchNotes(NOTES, '  ')).toEqual([]);
    expect(searchNotes(NOTES, ' e ')).toEqual([]);
    expect(searchNotes(NOTES, '')).toEqual([]);
    expect(searchable('e ')).toBe(false);
    expect(searchable('ab')).toBe(true);
  });

  it('trims the query and reads any run of spaces in it as one', () => {
    expect(where(searchNotes(NOTES, '  1   every 5s '))).toEqual(where(searchNotes(NOTES, '1 every 5s')));
  });

  it("finds '1 every 5s' once, at the top-level index of s01's rescue-breathing remark box", () => {
    const s01 = section('s01');
    // Found from the raw JSON, not through blockText, so the expectation doesn't lean on the code under test.
    const box = s01.blocks.findIndex((b) => b.k === 'box' && JSON.stringify(b).includes('1 every 5s'));
    expect(box).toBe(27);
    const hits = searchNotes(NOTES, '1 every 5s');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ sectionId: 's01', blockIndex: box, match: '1 every 5s' });
  });

  it("finds 'Orientated' in s03's verbal-response table", () => {
    const s03 = section('s03');
    const hit = searchNotes(NOTES, 'Orientated').find((h) => h.sectionId === 's03');
    expect(hit).toBeDefined();
    expect(s03.blocks[hit!.blockIndex]!.k).toBe('table');
    expect(s03.blocks[hit!.blockIndex - 1]).toMatchObject({ k: 'h', id: 'best-verbal-response' });
  });

  it('covers heading text, keeping literal ** as typed', () => {
    const heading = section('s01').blocks.findIndex((b) => b.k === 'h' && b.id === 'c-collar-application-ensapa');
    expect(where(searchNotes(NOTES, 'C-Collar Application (ENSAPA)'))).toContain(`s01:${heading}`);
    const stars = searchNotes(NOTES, '**');
    expect(stars.length).toBeGreaterThan(0);
    for (const h of stars) expect(h.match).toBe('**');
  });

  it("matches a phone's punctuation to the notes': a hyphen for an en dash, curly quotes for straight ones", () => {
    const dash = searchNotes(NOTES, '60 - 80');
    expect(dash.length).toBeGreaterThan(0);
    for (const h of dash) expect(h.match).toBe('60 – 80');
    expect(where(searchNotes(NOTES, 'patient’s'))).toEqual(where(searchNotes(NOTES, "patient's")));
    expect(searchNotes(NOTES, 'patient’s').length).toBeGreaterThan(0);
    const quote = searchNotes(NOTES, '“on a scale');
    expect(quote.length).toBeGreaterThan(0);
    expect(quote[0]!.match.toLowerCase()).toBe('"on a scale');
    // The other way round as well, and an em dash or minus sign reads as a hyphen.
    const doc = docOf(p('Say “Hello” – it’s fine — really − ok'));
    expect(searchNotes(doc, '"hello" - it\'s fine - really - ok')[0]?.match).toBe('“Hello” – it’s fine — really − ok');
  });

  it('never matches across two pieces of a block: a box title and its body, or two table cells', () => {
    expect(where(searchNotes(NOTES, 'Remark Rescue'))).not.toContain('s01:27');
    expect(where(searchNotes(NOTES, 'Remark'))).toContain('s01:27');
    expect(where(searchNotes(NOTES, 'technique Orientated'))).not.toContain('s03:3');
    const doc = docOf({ k: 'table', rows: [{ header: false, cells: [[p('Left')], [p('Right')]] }] });
    expect(searchNotes(doc, 'left right')).toEqual([]);
    expect(searchNotes(doc, 'right')[0]).toMatchObject({ before: 'Left · ', match: 'Right', after: '' });
  });

  it("shows a break between pieces as ' · ' in a snippet", () => {
    const hit = searchNotes(NOTES, 'The whole PAM').find((h) => h.sectionId === 's01');
    expect(hit?.before).toBe('Time limit & testing · ');
    // A cut never opens or closes on the separator.
    const long = 'alpha beta gamma delta epsilon zeta eta theta';
    const box: Block = { k: 'box', variant: 'remark', title: long, blocks: [p('NEEDLE'), p(long)] };
    const h = searchNotes(docOf(box), 'needle')[0]!;
    expect(h.before).toBe('…gamma delta epsilon zeta eta theta · ');
    expect(h.after).toBe(' · alpha beta gamma delta epsilon zeta…');
    const b34 = 'abcdefghij abcdefghij abcdefghij a';   // puts the 40-character cut right on a separator
    const after: Block = { k: 'box', variant: 'remark', title: 'x', blocks: [p('NEEDLE'), p(b34), p('next')] };
    expect(searchNotes(docOf(after), 'needle')[0]?.after).toBe(` · ${b34}…`);
    const before: Block = { k: 'box', variant: 'remark', title: 'first piece', blocks: [p(b34), p('NEEDLE')] };
    expect(searchNotes(docOf(before), 'needle')[0]?.before).toBe(`…${b34} · `);
  });

  it('gives one hit per top-level block, in document order', () => {
    const doc = docOf(p('pain, more pain and pain'), p('no match'), p('PAIN'));
    expect(where(searchNotes(doc, 'pain'))).toEqual(['s01:0', 's01:2']);
    const hits = where(searchNotes(NOTES, 'pain', 1000));
    expect(new Set(hits).size).toBe(hits.length);
    const order = (k: string) => { const [s, b] = k.split(':'); return Number(s!.slice(1)) * 10_000 + Number(b); };
    expect(hits.map(order)).toEqual([...hits.map(order)].sort((a, b) => a - b));
  });

  it('caps the hits at limit, 50 by default', () => {
    expect(searchNotes(NOTES, 'the', 1000).length).toBeGreaterThan(50);
    expect(searchNotes(NOTES, 'the')).toHaveLength(50);
    expect(searchNotes(NOTES, 'the', 5)).toHaveLength(5);
    expect(where(searchNotes(NOTES, 'the', 5))).toEqual(where(searchNotes(NOTES, 'the')).slice(0, 5));
    expect(searchNotes(NOTES, 'the', 0)).toEqual([]);
  });

  it('keeps before and after to 40 characters each, cut at word boundaries with an ellipsis', () => {
    for (const q of ['the', 'pain', 'ensapa', '1 every 5s', 'Orientated', 'mask', 'oxygen']) {
      for (const h of searchNotes(NOTES, q, 1000)) {
        expect(h.before.length).toBeLessThanOrEqual(40);
        expect(h.after.length).toBeLessThanOrEqual(40);
        const plain = plainOf(h);
        const lead = h.before.replace(/^…/, '');
        const tail = h.after.replace(/…$/, '');
        const at = plain.indexOf(lead + h.match + tail);
        expect(at, `${q} in ${h.sectionId}:${h.blockIndex}`).toBeGreaterThanOrEqual(0);
        // Not cut: the snippet reaches the block's start or end. Cut: the kept text starts or ends a word.
        if (h.before.startsWith('…')) expect(plain[at - 1]).toBe(' ');
        else expect(at).toBe(0);
        const end = at + lead.length + h.match.length + tail.length;
        if (h.after.endsWith('…')) expect(plain[end]).toBe(' ');
        else expect(end).toBe(plain.length);
      }
    }
  });

  it('shows the whole context when it fits, and cuts a long one at a word', () => {
    const doc = docOf(p('Rescue breathing: < 1 yr old: 30 bpm (1 every 2s) · 1 to 12 yr old: 20 bpm (1 every 3s) · > 12 yr old: 12 bpm (1 every 5s)'));
    expect(searchNotes(doc, 'rescue')[0]).toMatchObject({ before: '', match: 'Rescue', after: ' breathing: < 1 yr old: 30 bpm (1 every…' });
    expect(searchNotes(doc, '(1 every 5s)')[0]).toMatchObject({ before: '…bpm (1 every 3s) · > 12 yr old: 12 bpm ', after: '' });
    expect(searchNotes(doc, '30 bpm')[0]?.before).toBe('Rescue breathing: < 1 yr old: ');
    expect(searchNotes(doc, '20 bpm')[0]?.before).toBe('…30 bpm (1 every 2s) · 1 to 12 yr old: ');
    // A cut that lands inside a word drops the part-word ('elta', 'et').
    const words = 'alpha beta gamma delta epsilon zeta eta theta iota kappa';
    expect(searchNotes(docOf(p(`${words} NEEDLE`)), 'needle')[0]?.before).toBe('…epsilon zeta eta theta iota kappa ');
    expect(searchNotes(docOf(p(`NEEDLE ${words}`)), 'needle')[0]?.after).toBe(' alpha beta gamma delta epsilon zeta…');
    expect(searchNotes(docOf(p('Short one here.')), 'one')[0]).toMatchObject({ before: 'Short ', match: 'one', after: ' here.' });
  });
});
