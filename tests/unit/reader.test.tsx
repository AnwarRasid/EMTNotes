// Task 19: the notes section reader (#/notes/:section/:anchor?, query b) and the Blocks that draw the notes.
import { readFileSync, readdirSync } from 'node:fs';
import { render, screen, fireEvent, act, within, cleanup } from '@testing-library/preact';
import type { ComponentChildren, JSX } from 'preact';
import * as v from 'valibot';
import notesDoc from '../../public/data/notes.json';
import stepsDoc from '../../public/data/steps.json';
import questionsDoc from '../../public/data/questions.json';
import overridesDoc from '../../public/data/overrides.json';
import { MemoryStorage } from './helpers';
import { primeContent, resetContentCache } from '../../src/data/load';
import { mergeQuestions } from '../../src/data/questions';
import { NotesDocSchema, OverridesDocSchema, RawQuestionsDocSchema, StepsDocSchema, type Block } from '../../src/data/schema';
import { ProgressContext } from '../../src/progress/hooks';
import { createProgressStore, type ProgressStore } from '../../src/progress/store';
import type { Progress, QuizSession } from '../../src/progress/types';
import { back, matchRoute, navigate, useRoute } from '../../src/app/routes';
import { SectionReader } from '../../src/notes/SectionReader';
import { Blocks, IMAGE_SIZES, tableNames, type Table } from '../../src/notes/Blocks';
import { linksForSection } from '../../src/notes/text';

// back() steps through real history, which the tests' earlier navigations leave in any state; a spy says where Close goes.
vi.mock('../../src/app/routes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/app/routes')>();
  return { ...actual, back: vi.fn() };
});

const NOTES = v.parse(NotesDocSchema, notesDoc);
const STEPS = v.parse(StepsDocSchema, stepsDoc);
const QUESTIONS = mergeQuestions(v.parse(RawQuestionsDocSchema, questionsDoc), v.parse(OverridesDocSchema, overridesDoc));
const NOTES_ERROR = "The notes didn't load. They aren't saved on this phone yet. Connect once, then try again.";
const BASE = import.meta.env.BASE_URL;
const section = (id: string) => NOTES.sections.find((s) => s.id === id)!;

const offlineFetch = () => vi.fn(async (_input: RequestInfo | URL): Promise<Response> => { throw new TypeError('Failed to fetch'); });
const pendingFetch = () => vi.fn((_input: RequestInfo | URL) => new Promise<Response>(() => {}));
const notesFetch = () => vi.fn(async (input: RequestInfo | URL) =>
  String(input) === `${BASE}data/notes.json`
    ? new Response(JSON.stringify(notesDoc), { status: 200 })
    : new Response('Not found', { status: 404 }));

function makeStore(patch: Partial<Progress> = {}): ProgressStore {
  const store = createProgressStore(new MemoryStorage());
  if (Object.keys(patch).length > 0) store.update((p) => ({ ...p, ...patch }));
  return store;
}

const inStore = (store: ProgressStore, ui: ComponentChildren) => <ProgressContext.Provider value={store}>{ui}</ProgressContext.Provider>;
const readerAt = (hash: string) => <SectionReader match={matchRoute(hash)} />;
/** The reader following the location, as App mounts it: the view lives in the route (?v=hl), so a switch of view
 *  only shows once the route changes. */
function Routed(): JSX.Element {
  return <SectionReader match={useRoute()} />;
}
/** Opens the reader at `hash`. replaceState sets the location without a hashchange event arriving later. */
const renderAt = (hash: string, store = makeStore()) => {
  history.replaceState(history.state, '', hash);
  return { store, ...render(inStore(store, <Routed />)) };
};

const viewKey = (name: 'Full text' | 'Highlights only') => screen.getByRole('button', { name });
const body = () => document.querySelector<HTMLElement>('.nbody')!;

const scrollIntoView = vi.fn();
const original = Element.prototype.scrollIntoView;
/** The elements scrollIntoView was called on, in order. */
const scrolledTo = () => scrollIntoView.mock.contexts as Element[];

beforeEach(() => {
  resetContentCache();
  primeContent('notes', NOTES);
  primeContent('steps', STEPS);
  primeContent('questions', QUESTIONS);
  location.hash = '#/notes/s01';
  scrollIntoView.mockClear();
  vi.mocked(back).mockClear();
  Element.prototype.scrollIntoView = scrollIntoView;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetContentCache();
  Element.prototype.scrollIntoView = original;
});

describe('Section reader: header and toolbar', () => {
  it('heads the section "{n}. {title}" over "Section {n} of 20"', () => {
    renderAt('#/notes/s07');
    expect(screen.getByRole('heading', { level: 1, name: '7. Auscultation (6 points)' })).toBeTruthy();
    expect(screen.getByText('Section 7 of 20')).toBeTruthy();
  });

  it('closes back to the Notes tab', () => {
    renderAt('#/notes/s07');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(back).toHaveBeenCalledWith('/notes');
  });

  it('opens on Full text, the two view keys a pressed pair', () => {
    renderAt('#/notes/s01');
    expect(screen.getByRole('group', { name: 'View' })).toBeTruthy();
    expect(viewKey('Full text').getAttribute('aria-pressed')).toBe('true');
    expect(viewKey('Highlights only').getAttribute('aria-pressed')).toBe('false');
  });

  it('cycles the text size standard, large, larger and back, saving the setting Settings uses', () => {
    const { store } = renderAt('#/notes/s01');
    for (const [label, next] of [['Standard', 'large'], ['Large', 'larger'], ['Larger', 'standard']] as const) {
      fireEvent.click(screen.getByRole('button', { name: `Text size: ${label}` }));
      expect(store.get().settings.textSize).toBe(next);
    }
    expect(screen.getByRole('button', { name: 'Text size: Standard' })).toBeTruthy();
  });

  it('starts on the size already saved', () => {
    renderAt('#/notes/s01', makeStore({ settings: { textSize: 'larger', haptics: true, answerBy: 'typing' } }));
    expect(screen.getByRole('button', { name: 'Text size: Larger' })).toBeTruthy();
  });
});

describe('Section reader: full text', () => {
  it('draws every top-level block once, numbered by data-b', () => {
    renderAt('#/notes/s01');
    const top = [...body().querySelectorAll('[data-b]')];
    expect(top).toHaveLength(section('s01').blocks.length);
    expect(top.map((el) => el.getAttribute('data-b'))).toEqual(section('s01').blocks.map((_, i) => String(i)));
    expect(top.every((el) => el.parentElement === body())).toBe(true);
  });

  it('gives each heading its anchor id, and marks a heading’s own highlight', () => {
    renderAt('#/notes/s16');
    const asthma = screen.getByRole('heading', { level: 2, name: 'Asthma (tested)' });
    expect(asthma.id).toBe('asthma-tested');
    expect(asthma.querySelector('mark.hl')?.textContent).toBe('(tested)');
  });

  it('keeps a run’s edge spaces outside its formatting, and never drops them', () => {
    render(<Blocks blocks={[{ k: 'p', runs: [{ t: 'Apply' }, { t: ' C-Collar ', b: true, h: true }, { t: 'now' }, { t: '  ', u: true }] }]} />);
    const p = document.querySelector('p')!;
    expect(p.textContent).toBe('Apply C-Collar now  ');
    expect(p.querySelector('mark.hl')?.textContent).toBe('C-Collar');
    expect(p.querySelector('mark.hl > strong')).not.toBeNull();
    expect(p.querySelector('u')).toBeNull();   // a run of spaces alone isn't underlined
  });

  it('puts a stretch of highlighted runs under one mark, so the highlight never breaks at a space', () => {
    render(<Blocks blocks={[{ k: 'p', runs: [
      { t: 'tell buddy ', i: true }, { t: 'to ', i: true, h: true }, { t: 'Expose and Examine', b: true, i: true, h: true },
      { t: '. Arrest', i: true, h: true }, { t: ' then ' }, { t: 'NEVER', h: true },
    ] }]} />);
    const p = document.querySelector('p')!;
    expect(p.textContent).toBe('tell buddy to Expose and Examine. Arrest then NEVER');
    const marks = [...p.querySelectorAll('mark.hl')];
    expect(marks.map((m) => m.textContent)).toEqual(['to Expose and Examine. Arrest', 'NEVER']);
    expect(marks[0]!.querySelector('strong > em')?.textContent).toBe('Expose and Examine');
    expect(marks[0]!.querySelector('em')?.textContent).toBe('to');
  });

  it('reads a highlighted heading’s words apart', () => {
    renderAt('#/notes/s12');
    expect(screen.getByRole('heading', { level: 2, name: "EpiPen (contains Epinephrine) – Patient's Own Only" })).toBeTruthy();
  });

  it('styles a group heading as a group label', () => {
    renderAt('#/notes/s12');
    expect(screen.getByRole('heading', { level: 2, name: 'EMT Drugs (Must Know)' }).classList.contains('nh-group')).toBe(true);
    expect(screen.getByRole('heading', { level: 2, name: /^GTN/ }).classList.contains('nh-group')).toBe(false);
  });

  it('keeps bold, italics, underline and highlights, and literal ** as typed', () => {
    renderAt('#/notes/s01');
    const marks = [...body().querySelectorAll('mark.hl')].map((m) => m.textContent);
    expect(marks).toContain('"How many casualties are there?"');
    expect(body().querySelector('strong')).not.toBeNull();
    expect(body().querySelector('em')).not.toBeNull();
    expect(body().querySelector('u')?.textContent).toBe('(Location)');
    expect(body().textContent).toContain('**Attempt 2nd try of OPA if rejected (gag) earlier.');
  });

  it('shows list markers: bullets hidden from screen readers, numbers read out', () => {
    renderAt('#/notes/s01');
    const lists = [...body().querySelectorAll('ul.notes-list')];
    expect(lists.length).toBeGreaterThan(10);
    const items = lists.flatMap((l) => [...l.querySelectorAll('li')]);
    const marker = (li: Element) => li.querySelector('.nli-mark')!;
    const bullet = items.find((li) => marker(li).textContent === '•')!;
    const dash = items.find((li) => marker(li).textContent === '–')!;
    const one = items.find((li) => marker(li).textContent === '1.')!;
    expect(bullet.getAttribute('data-depth')).toBe('1');
    expect(dash.getAttribute('data-depth')).toBe('2');
    expect(marker(bullet).getAttribute('aria-hidden')).toBe('true');
    expect(marker(dash).getAttribute('aria-hidden')).toBe('true');
    expect(marker(one).hasAttribute('aria-hidden')).toBe(false);
  });

  it('draws boxes as asides with their title', () => {
    renderAt('#/notes/s01');
    const remark = body().querySelector('aside.box.box-remark')!;
    expect(remark.querySelector('.box-title')?.textContent).toBe('Remark');
    const added = [...body().querySelectorAll('aside.box.box-added')].map((a) => a.querySelector('.box-title')?.textContent);
    expect(added).toContain('5 things to ask the caller');
  });

  it('puts every table in a focusable, labelled scroll region with column headers', () => {
    for (const id of ['s01', 's02', 's03', 's07']) {
      const { unmount } = renderAt(`#/notes/${id}`);
      const tables = [...document.querySelectorAll('table')];
      expect(tables.length).toBeGreaterThan(0);
      for (const t of tables) {
        const region = t.parentElement!;
        expect(region.classList.contains('table-scroll')).toBe(true);
        expect(region.getAttribute('tabindex')).toBe('0');
        expect(region.getAttribute('role')).toBe('region');
        expect(region.getAttribute('aria-label')).toMatch(/^Table( \d+ of \d+)?: \S/);
        expect(t.querySelectorAll('th').length).toBeGreaterThan(0);
        for (const th of t.querySelectorAll('th')) expect(th.getAttribute('scope')).toBe('col');
      }
      unmount();
    }
  });

  it('names a table by its header row', () => {
    renderAt('#/notes/s02');
    const region = screen.getByRole('region', { name: 'Table: Code, Hospital, Code, Hospital' });
    expect(within(region).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Code', 'Hospital', 'Code', 'Hospital']);
    expect(within(region).getByRole('cell', { name: 'KKH (Children)' })).toBeTruthy();
  });

  it('numbers tables that would share a name, and leaves a unique name alone', () => {
    renderAt('#/notes/s03');
    const gcs = 'Response, Score, Description / technique';
    expect(screen.getAllByRole('region').map((r) => r.getAttribute('aria-label')))
      .toEqual([1, 2, 3, 4].map((i) => `Table ${i} of 4: ${gcs}`));
  });

  it('counts tables inside boxes, and numbers headerless tables too', () => {
    const cell = (t: string): Block[] => [{ k: 'p', runs: [{ t }] }];
    const bare: Table = { k: 'table', rows: [{ header: false, cells: [cell('x')] }] };
    const bare2: Table = { k: 'table', rows: [{ header: false, cells: [cell('y')] }] };
    const named: Table = { k: 'table', rows: [{ header: true, cells: [cell('Drug'), cell('Dose')] }] };
    const boxed: Block = { k: 'box', variant: 'remark', title: 'Remark', blocks: [bare2] };
    const names = tableNames([bare, named, boxed]);
    expect([names.get(bare), names.get(named), names.get(bare2)])
      .toEqual(['Table 1 of 2', 'Table: Drug, Dose', 'Table 2 of 2']);
  });

  it('names a table with no header row "Table"', () => {
    const table: Block = { k: 'table', rows: [{ header: false, cells: [[{ k: 'p', runs: [{ t: 'x' }] }]] }] };
    render(<Blocks blocks={[table]} />);
    expect(screen.getByRole('region', { name: 'Table' })).toBeTruthy();
    expect(document.querySelector('th')).toBeNull();
  });

  it('loads a figure lazily from the app base, sized before it arrives', () => {
    renderAt('#/notes/s07');
    const img = screen.getByRole('img', { name: 'Figure 1: Auscultation (6 points)' }) as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(`${BASE}img/notes/s07-1.png`);
    expect(img.getAttribute('loading')).toBe('lazy');
    expect([img.getAttribute('width'), img.getAttribute('height')]).toEqual(['324', '393']);
    expect(img.getAttribute('data-b')).toBe('0');
  });

  it('knows the size of every figure in the notes, matching the image files', () => {
    const png = (file: string) => {
      const bytes = readFileSync(`public/${file}`);
      return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
    };
    const srcs: string[] = [];
    const walk = (blocks: Block[]) => {
      for (const b of blocks) {
        if (b.k === 'img') srcs.push(b.src);
        else if (b.k === 'box') walk(b.blocks);
        else if (b.k === 'table') for (const r of b.rows) for (const c of r.cells) walk(c);
      }
    };
    for (const s of NOTES.sections) walk(s.blocks);
    expect(Object.keys(IMAGE_SIZES).sort()).toEqual([...srcs].sort());
    expect(readdirSync('public/img/notes').map((f) => `img/notes/${f}`).sort()).toEqual([...srcs].sort());
    for (const src of srcs) expect([...IMAGE_SIZES[src]!], src).toEqual(png(src));
  });
});

describe('Section reader: highlights only', () => {
  it('lists the highlighted passages under their headings', () => {
    renderAt('#/notes/s01');
    fireEvent.click(viewKey('Highlights only'));
    expect(viewKey('Highlights only').getAttribute('aria-pressed')).toBe('true');
    expect(viewKey('Full text').getAttribute('aria-pressed')).toBe('false');
    const never = [...body().querySelectorAll('mark')].find((m) => m.textContent?.includes('NEVER move the patient'));
    expect(never).toBeTruthy();
    const heading = screen.getByRole('heading', { level: 2, name: 'Approach Patient' });
    expect(heading.closest('.hlgroup')?.contains(never!)).toBe(true);
    expect(body().querySelectorAll('.hl-item')).toHaveLength(43);
    expect(body().querySelector('[data-b]')).toBeNull();
  });

  it('heads each run of passages once, in document order', () => {
    renderAt('#/notes/s01');
    fireEvent.click(viewKey('Highlights only'));
    const headings = [...body().querySelectorAll('h2')].map((h) => h.textContent);
    expect(new Set(headings).size).toBe(headings.length);
    expect(headings.indexOf('Approach Patient')).toBeLessThan(headings.indexOf('Delicate Spine'));
  });

  it('keeps a numbered item’s number, read out, and leaves bullets and dashes off', () => {
    renderAt('#/notes/s01?v=hl');
    const items = [...body().querySelectorAll('.hl-item')];
    const bleeding = items.find((li) => li.textContent?.includes('Is there any Catastrophic Bleeding?'));
    expect(bleeding?.textContent).toBe('2. Ask: "Is there any Catastrophic Bleeding?"');
    const num = bleeding?.querySelector('.hl-num');
    expect(num?.textContent).toBe('2.');
    expect(num?.hasAttribute('aria-hidden')).toBe(false);
    expect(items.find((li) => li.textContent?.includes('NEVER move the patient'))?.textContent?.startsWith('4. ')).toBe(true);
    const bullet = items.find((li) => li.textContent?.includes('Are there any hazards'));
    expect(bullet?.textContent?.startsWith('"Are there any hazards')).toBe(true);
    expect(bullet?.querySelector('.hl-num')).toBeNull();
  });

  it('says so when a section has none', () => {
    renderAt('#/notes/s07');
    fireEvent.click(viewKey('Highlights only'));
    expect(screen.getByText('No highlights in this section.')).toBeTruthy();
    fireEvent.click(viewKey('Full text'));
    expect(screen.queryByText('No highlights in this section.')).toBeNull();
    expect(screen.getByRole('img', { name: 'Figure 1: Auscultation (6 points)' })).toBeTruthy();
  });
});

describe('Section reader: the view in the route', () => {
  const nextLink = () => within(screen.getByRole('navigation', { name: 'Sections' })).getByRole('link', { name: /^Next section/ });

  it('switches with ?v=hl, replacing the history entry, and back to no query for Full text', () => {
    renderAt('#/notes/s01');
    const length = history.length;
    fireEvent.click(viewKey('Highlights only'));
    expect(location.hash).toBe('#/notes/s01?v=hl');
    expect(viewKey('Highlights only').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(viewKey('Full text'));
    expect(location.hash).toBe('#/notes/s01');
    expect(viewKey('Full text').getAttribute('aria-pressed')).toBe('true');
    expect(history.length).toBe(length);
  });

  it('keeps Highlights only on the next section', () => {
    renderAt('#/notes/s01');
    expect(nextLink().getAttribute('href')).toBe('#/notes/s02');
    fireEvent.click(viewKey('Highlights only'));
    expect(nextLink().getAttribute('href')).toBe('#/notes/s02?v=hl');
    fireEvent.click(nextLink());
    expect(location.hash).toBe('#/notes/s02?v=hl');
    expect(screen.getByRole('heading', { level: 1, name: '2. Secondary Survey' })).toBeTruthy();
    expect(viewKey('Highlights only').getAttribute('aria-pressed')).toBe('true');
    expect(body().querySelector('[data-b]')).toBeNull();
  });

  it('opens straight into Highlights only from the route', () => {
    renderAt('#/notes/s11?v=hl');
    expect(viewKey('Highlights only').getAttribute('aria-pressed')).toBe('true');
    expect(body().querySelectorAll('.hl-item')).toHaveLength(section('s11').highlights);
  });

  it('keeps the anchor and drops a block already scrolled to when the view switches', () => {
    renderAt('#/notes/s01/delicate-spine');
    fireEvent.click(viewKey('Highlights only'));
    expect(location.hash).toBe('#/notes/s01/delicate-spine?v=hl');
    cleanup();
    renderAt('#/notes/s01?b=12');
    fireEvent.click(viewKey('Highlights only'));
    expect(location.hash).toBe('#/notes/s01?v=hl');
    expect(scrollIntoView).toHaveBeenCalledTimes(2);   // once per arrival, never for a switch
  });
});

describe('Section reader: reading progress', () => {
  it('records the section as last read and read', () => {
    const { store } = renderAt('#/notes/s07');
    expect(store.get().notes.lastSection).toBe('s07');
    expect(store.get().notes.read).toContain('s07');
  });

  it('changes nothing, and saves nothing, when the section is already last read', () => {
    const store = makeStore({ notes: { lastSection: 's07', read: ['s02', 's07'] } });
    const before = store.get();
    renderAt('#/notes/s07', store);
    expect(store.get()).toBe(before);
  });

  it('adds a section to read once, after the others', () => {
    const store = makeStore({ notes: { lastSection: 's07', read: ['s02', 's07'] } });
    renderAt('#/notes/s02', store);
    expect(store.get().notes).toEqual({ lastSection: 's02', read: ['s02', 's07'] });
    renderAt('#/notes/s03', store);
    expect(store.get().notes).toEqual({ lastSection: 's03', read: ['s02', 's07', 's03'] });
  });
});

describe('Section reader: scrolling to a place', () => {
  it('scrolls an anchor’s heading to the top', () => {
    renderAt('#/notes/s01/delicate-spine');
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrolledTo()[0]).toBe(document.getElementById('delicate-spine'));
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
  });

  it('finds the anchor among the section’s own headings, never an element elsewhere with that id', () => {
    const decoy = document.body.insertBefore(document.createElement('p'), document.body.firstChild);
    decoy.id = 'delicate-spine';
    try {
      renderAt('#/notes/s01/delicate-spine');
      expect(scrolledTo()).toEqual([body().querySelector('h2#delicate-spine')]);
    } finally {
      decoy.remove();
    }
  });

  it('scrolls a search hit’s block to the top, and again when only the query changes', () => {
    renderAt('#/notes/s01?b=12');
    const article = body();
    expect(scrolledTo()).toEqual([article.querySelector('[data-b="12"]')]);
    act(() => navigate('/notes/s01?b=30'));
    expect(body()).toBe(article);   // the same screen, not a remount
    expect(scrolledTo()).toEqual([article.querySelector('[data-b="12"]'), article.querySelector('[data-b="30"]')]);
  });

  it('scrolls again for a new block passed to the same screen', () => {
    const store = makeStore();
    const { rerender } = render(inStore(store, readerAt('#/notes/s01?b=12')));
    rerender(inStore(store, readerAt('#/notes/s01?b=30')));
    expect(scrolledTo()).toEqual([body().querySelector('[data-b="12"]'), body().querySelector('[data-b="30"]')]);
  });

  it('switching the view never scrolls', () => {
    renderAt('#/notes/s01?b=12');
    fireEvent.click(viewKey('Highlights only'));
    fireEvent.click(viewKey('Full text'));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('opens Full text to scroll to a new block from Highlights only, keeping the block in the route', () => {
    renderAt('#/notes/s01');
    fireEvent.click(viewKey('Highlights only'));
    act(() => navigate('/notes/s01?b=30&v=hl'));
    expect(location.hash).toBe('#/notes/s01?b=30');
    expect(viewKey('Full text').getAttribute('aria-pressed')).toBe('true');
    expect(scrolledTo()).toEqual([body().querySelector('[data-b="30"]')]);
  });

  it('keeps Highlights only for an anchor that arrives with it, and scrolls nowhere, then or on a switch', () => {
    renderAt('#/notes/s01/delicate-spine?v=hl');
    expect(location.hash).toBe('#/notes/s01/delicate-spine?v=hl');
    expect(viewKey('Highlights only').getAttribute('aria-pressed')).toBe('true');
    expect(scrollIntoView).not.toHaveBeenCalled();
    fireEvent.click(viewKey('Full text'));
    expect(location.hash).toBe('#/notes/s01/delicate-spine');
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('keeps Highlights only through a reload after switching at an anchor', () => {
    renderAt('#/notes/s01/delicate-spine');
    fireEvent.click(viewKey('Highlights only'));
    cleanup();
    renderAt(location.hash);   // the reload
    expect(location.hash).toBe('#/notes/s01/delicate-spine?v=hl');
    expect(viewKey('Highlights only').getAttribute('aria-pressed')).toBe('true');
    expect(scrollIntoView).toHaveBeenCalledTimes(1);   // the first arrival only
  });

  it('opens Full text for a search hit that arrives with Highlights only', () => {
    renderAt('#/notes/s01?b=30&v=hl');
    expect(location.hash).toBe('#/notes/s01?b=30');
    expect(viewKey('Full text').getAttribute('aria-pressed')).toBe('true');
    expect(scrolledTo()).toEqual([body().querySelector('[data-b="30"]')]);
  });

  it('stays at the top with no place, or one the section lacks', () => {
    for (const hash of ['#/notes/s01', '#/notes/s01/no-such-heading', '#/notes/s01?b=999', '#/notes/s01?b=x']) {
      const { unmount } = renderAt(hash);
      unmount();
    }
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

describe('Section reader: cross-links', () => {
  const s01Questions = linksForSection('s01', STEPS.steps, QUESTIONS).questionIds;

  it('lists the PAM steps that use the section, as "{order} {name}"', () => {
    renderAt('#/notes/s01');
    const panel = screen.getByRole('heading', { level: 2, name: 'Used in PAM steps' }).closest('section')!;
    const chips = [...panel.querySelectorAll('.xstep')].map((c) => c.textContent);
    expect(chips).toHaveLength(19);
    expect(chips).toContain('8 Delicate spine');
    expect(chips[0]).toBe('1 Respond call');
    expect([...panel.querySelectorAll('.xstep')].every((c) => c.tagName === 'A')).toBe(true);
  });

  it('makes each step a link that starts a drill on it', () => {
    renderAt('#/notes/s01');
    const link = screen.getByRole('link', { name: 'Drill step 8, Delicate spine' });
    expect(link.getAttribute('href')).toBe('#/pam/start?drill=delicate-spine');
    expect(link.classList.contains('xstep')).toBe(true);
  });

  it('practises every question on the section', () => {
    const { store } = renderAt('#/notes/s01');
    const key = screen.getByRole('button', { name: `Practise the ${s01Questions.length} questions on this section` });
    expect(key.hasAttribute('aria-describedby')).toBe(false);
    expect(screen.queryByText('This replaces your open quiz.')).toBeNull();
    fireEvent.click(key);
    const open = store.get().quizOpen!;
    expect(open.mode).toBe('practice');
    expect(open.filter).toEqual({ group: 'all', topic: 'all', ids: s01Questions });
    expect([...open.queue].sort()).toEqual([...s01Questions].sort());
    expect(location.hash).toBe('#/quiz/session');
  });

  it('says the practice replaces an open quiz', () => {
    const open: QuizSession = {
      id: 'open', mode: 'practice', filter: { group: 'all', topic: 'all' }, startedAt: '2026-11-10T09:00:00.000Z',
      total: 1, queue: ['mt-a-q001'], orders: {}, picked: null, checked: null, done: [],
    };
    renderAt('#/notes/s01', makeStore({ quizOpen: open }));
    const note = screen.getByText('This replaces your open quiz.');
    const key = screen.getByRole('button', { name: /^Practise the \d+ questions on this section$/ });
    expect(key.getAttribute('aria-describedby')).toBe(note.id);
  });

  it('says "question" for one, and shows only the parts that have links', () => {
    renderAt('#/notes/s10');   // one question, no steps
    expect(screen.getByRole('button', { name: 'Practise the 1 question on this section' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Used in PAM steps' })).toBeNull();
  });

  it('leaves the panel out for a section nothing links to', () => {
    renderAt('#/notes/s19');
    expect(screen.queryByRole('heading', { name: 'Used in PAM steps' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Quiz questions' })).toBeNull();
  });
});

describe('Section reader: previous and next', () => {
  const nav = () => screen.getByRole('navigation', { name: 'Sections' });

  it('s01 has only a next link, to s02', () => {
    renderAt('#/notes/s01');
    const links = within(nav()).getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute('href')).toBe('#/notes/s02');
    expect(links[0]!.textContent).toMatch(/2\. Secondary Survey\s*→$/);
  });

  it('s20 has only a previous link, to s19', () => {
    renderAt('#/notes/s20');
    const links = within(nav()).getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute('href')).toBe('#/notes/s19');
    expect(links[0]!.textContent).toMatch(/←\s*19\. IO Infusion \(Intraosseous\)$/);
  });

  it('names each link by its direction too', () => {
    renderAt('#/notes/s07');
    expect(screen.getByRole('link', { name: /^Previous section: 6\. Guide for Head-to-Toe Examination/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /^Next section: 8\. 4-Lead ECG Placement/ })).toBeTruthy();
  });

  it('turns the page in place, so Close still leaves the reader', () => {
    renderAt('#/notes/s01');
    const length = history.length;
    fireEvent.click(within(nav()).getByRole('link'));
    expect(location.hash).toBe('#/notes/s02');
    expect(history.length).toBe(length);
  });
});

describe('Section reader: loading and errors', () => {
  it('shows nothing for 300 ms, then a skeleton', () => {
    vi.useFakeTimers();
    resetContentCache();
    vi.stubGlobal('fetch', pendingFetch());
    renderAt('#/notes/s01');
    expect(screen.getByRole('heading', { level: 1, name: 'Notes' })).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.getByRole('progressbar', { name: 'Loading' })).toBeTruthy();
  });

  it('shows the notes error copy with Try again, which loads the section', async () => {
    resetContentCache();
    vi.stubGlobal('fetch', offlineFetch());
    renderAt('#/notes/s07');
    expect(await screen.findByText(NOTES_ERROR)).toBeTruthy();
    vi.stubGlobal('fetch', notesFetch());
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 1, name: '7. Auscultation (6 points)' })).toBeTruthy();
  });

  it('scrolls to the anchor once the notes arrive', async () => {
    resetContentCache();
    vi.stubGlobal('fetch', notesFetch());
    renderAt('#/notes/s01/delicate-spine');
    expect(await screen.findByRole('heading', { level: 2, name: 'Delicate Spine' })).toBeTruthy();
    expect(scrolledTo()).toEqual([document.getElementById('delicate-spine')]);
  });

  it('says so for a section the notes don’t have, with a way back', () => {
    const { store } = renderAt('#/notes/s99');
    expect(screen.getByRole('heading', { level: 1, name: 'Notes' })).toBeTruthy();
    expect(screen.getByText("That section isn't in your notes.")).toBeTruthy();
    expect(screen.getByRole('link', { name: 'All sections' }).getAttribute('href')).toBe('#/notes');
    expect(store.get().notes.lastSection).toBeNull();
  });
});
