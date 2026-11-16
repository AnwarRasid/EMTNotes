// Task 18: the Notes tab (#/notes): the section list, the Last read marker, search, and the loading and error states.
import { render, screen, fireEvent, act, within } from '@testing-library/preact';
import type { ComponentChildren } from 'preact';
import * as v from 'valibot';
import notesDoc from '../../public/data/notes.json';
import { MemoryStorage } from './helpers';
import { contentErrorCopy, primeContent, resetContentCache } from '../../src/data/load';
import { NotesDocSchema, type NotesDoc } from '../../src/data/schema';
import { ProgressContext } from '../../src/progress/hooks';
import { createProgressStore, type ProgressStore } from '../../src/progress/store';
import { NotesTab } from '../../src/notes/NotesTab';
import { matchRoute, navigate } from '../../src/app/routes';

const NOTES: NotesDoc = v.parse(NotesDocSchema, notesDoc);
const NOTES_ERROR = "The notes didn't load. They aren't saved on this phone yet. Connect once, then try again.";

const BASE = import.meta.env.BASE_URL;
const fileFetch = () => vi.fn(async (input: RequestInfo | URL) =>
  String(input) === `${BASE}data/notes.json`
    ? new Response(JSON.stringify(notesDoc), { status: 200 })
    : new Response('Not found', { status: 404 }));
const offlineFetch = () => vi.fn(async (_input: RequestInfo | URL): Promise<Response> => { throw new TypeError('Failed to fetch'); });
const pendingFetch = () => vi.fn((_input: RequestInfo | URL) => new Promise<Response>(() => {}));

function makeStore(lastSection: string | null = null): ProgressStore {
  const store = createProgressStore(new MemoryStorage());
  if (lastSection) store.update((p) => ({ ...p, notes: { ...p.notes, lastSection } }));
  return store;
}

function renderIn(store: ProgressStore, ui: ComponentChildren = <NotesTab />) {
  return render(<ProgressContext.Provider value={store}>{ui}</ProgressContext.Provider>);
}

const sectionLink = (id: string) => screen.getAllByRole('link').find((a) => a.getAttribute('href') === `#/notes/${id}`)!;
const searchBox = () => screen.getByRole('searchbox', { name: 'Search your notes' }) as HTMLInputElement;
const type = (value: string) => fireEvent.input(searchBox(), { target: { value } });

const scrollIntoView = vi.fn();
const original = Element.prototype.scrollIntoView;

beforeEach(() => {
  resetContentCache();
  primeContent('notes', NOTES);
  location.hash = '#/notes';
  scrollIntoView.mockClear();
  Element.prototype.scrollIntoView = scrollIntoView;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetContentCache();
  Element.prototype.scrollIntoView = original;
});

describe('Notes tab: section list', () => {
  it('has the Notes heading and 20 section links in order, the first to #/notes/s01', () => {
    renderIn(makeStore());
    expect(screen.getByRole('heading', { level: 1, name: 'Notes' })).toBeTruthy();
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(20);
    expect(links[0]!.getAttribute('href')).toBe('#/notes/s01');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(NOTES.sections.map((s) => `#/notes/${s.id}`));
  });

  it('shows each section number, title and highlight count', () => {
    renderIn(makeStore());
    const s01 = sectionLink('s01');
    expect(s01.textContent).toContain('Primary Survey');
    expect(s01.textContent).toContain('43 highlights');
    expect(s01.textContent).toMatch(/^1\./);
    expect(sectionLink('s09').textContent).toContain('1 highlight');
    expect(sectionLink('s09').textContent).not.toContain('1 highlights');
    expect(sectionLink('s20').textContent).toMatch(/^20\. Injection of Drugs/);
  });

  it('says nothing about highlights for a section with none, and leaves out the empty line under its title', () => {
    renderIn(makeStore());
    for (const id of ['s03', 's04', 's05', 's06', 's07', 's08']) {
      expect(sectionLink(id).textContent).not.toMatch(/highlight/);
      expect(sectionLink(id).querySelector('.nrow-meta')).toBeNull();
    }
    expect(sectionLink('s03').textContent).toBe('3. Glasgow Coma Scale');
    expect(sectionLink('s01').querySelector('.nrow-meta')?.textContent).toBe('43 highlights');
  });

  it('tags the two untested sections "not tested" with a neutral outline tag, never a status chip', () => {
    renderIn(makeStore());
    for (const id of ['s19', 's20']) {
      const tag = within(sectionLink(id)).getByText('not tested');
      expect(tag.className).toBe('ntag');
    }
    expect(sectionLink('s01').textContent).not.toContain('not tested');
    expect(document.querySelectorAll('.tag, .tag-hi, .tag-med, .tag-ok, .bb')).toHaveLength(0);
  });

  it('marks the last-read section, and only that one', () => {
    renderIn(makeStore('s07'));
    expect(sectionLink('s07').textContent).toContain('Last read');
    expect(screen.getAllByText('Last read')).toHaveLength(1);
    // s07 has no highlights: the line under its title holds only the marker.
    expect(sectionLink('s07').querySelector('.nrow-meta')?.textContent?.trim()).toBe('Last read');
  });

  it('with nothing read yet shows no Last read marker and scrolls nothing', () => {
    renderIn(makeStore());
    expect(screen.queryByText('Last read')).toBeNull();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("brings the last-read row into view on mount with block 'nearest', once", () => {
    renderIn(makeStore('s15'));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    expect(scrollIntoView.mock.contexts[0]).toBe(sectionLink('s15'));
    // Back from a search, the list comes back where the trainee left it: no second jump.
    type('ensapa');
    type('');
    expect(sectionLink('s15')).toBeTruthy();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('ignores a last-read id that is no longer a section', () => {
    renderIn(makeStore('s99'));
    expect(screen.queryByText('Last read')).toBeNull();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

describe('Notes tab: search', () => {
  it('is a search input labelled "Search your notes", with the search enter key', () => {
    renderIn(makeStore());
    const input = searchBox();
    expect(input.type).toBe('search');
    expect(input.getAttribute('enterkeyhint')).toBe('search');
    expect(input.closest('[role="search"]')).not.toBeNull();
  });

  it('typing "ensapa" shows the match count and hit rows linking into s01 at the block', () => {
    renderIn(makeStore());
    type('ensapa');
    expect(screen.getByText(/^\d+ matches$/)).toBeTruthy();
    const links = screen.getAllByRole('link');
    const s01 = links.filter((a) => /^#\/notes\/s01\?b=\d+$/.test(a.getAttribute('href') ?? ''));
    expect(s01.length).toBeGreaterThan(0);
    expect(s01[0]!.textContent).toMatch(/^1\. Primary Survey/);
    expect(s01[0]!.querySelector('mark')?.textContent).toBe('ENSAPA');
    // The section list gives way to the hits.
    expect(links.some((a) => a.getAttribute('href') === '#/notes/s07')).toBe(false);
  });

  it('counts one match in the singular', () => {
    renderIn(makeStore());
    type('1 every 5s');
    expect(screen.getByText('1 match')).toBeTruthy();
    const hit = screen.getByRole('link');
    expect(hit.getAttribute('href')).toMatch(/^#\/notes\/s01\?b=\d+$/);
    expect(hit.querySelector('mark')?.textContent).toBe('1 every 5s');
  });

  it('says when there are more than 50 matches and shows the first 50', () => {
    renderIn(makeStore());
    type('the');
    expect(screen.getByText('More than 50 matches. Showing the first 50.')).toBeTruthy();
    expect(screen.getAllByRole('link')).toHaveLength(50);
  });

  it('typing "zzqx" shows No matches for "zzqx".', () => {
    renderIn(makeStore());
    type('zzqx');
    expect(screen.getByText('No matches for "zzqx".')).toBeTruthy();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('keeps the section list for one character, and brings it back when the query is cleared', () => {
    renderIn(makeStore());
    type('e');
    expect(screen.getAllByRole('link')).toHaveLength(20);
    expect(screen.queryByText(/match/)).toBeNull();
    type('ensapa');
    type(' ');
    expect(screen.getAllByRole('link')).toHaveLength(20);
  });

  it('never moves focus off the input while typing, or when the results swap with the list', () => {
    renderIn(makeStore('s07'));
    const input = searchBox();
    input.focus();
    for (const value of ['e', 'en', 'ens', 'ensapa', 'zzqx', '', 'oxygen']) {
      type(value);
      expect(document.activeElement).toBe(input);
      expect(searchBox()).toBe(input);
    }
  });

  it('announces the count politely once typing settles', () => {
    vi.useFakeTimers();
    renderIn(makeStore());
    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toBe('');
    type('ens');
    type('ensapa');
    expect(status.textContent).toBe('');
    act(() => { vi.advanceTimersByTime(700); });
    expect(status.textContent).toMatch(/^\d+ matches$/);
    type('zzqx');
    act(() => { vi.advanceTimersByTime(700); });
    expect(status.textContent).toBe('No matches for "zzqx".');
    type('');
    act(() => { vi.advanceTimersByTime(700); });
    expect(status.textContent).toBe('');
  });

  it('restarts the wait on every keystroke, and says a repeated count again for a new query', () => {
    vi.useFakeTimers();
    renderIn(makeStore());
    const status = screen.getByRole('status');
    type('ensapa');
    act(() => { vi.advanceTimersByTime(500); });
    type('ENSAPA');   // the same 3 matches, but a keystroke: the wait starts over
    act(() => { vi.advanceTimersByTime(500); });
    expect(status.textContent).toBe('');
    act(() => { vi.advanceTimersByTime(200); });
    expect(status.textContent).toBe('3 matches');
    // A new query with the same count changes the region (a trailing no-break space), so it is read again.
    type('Ensapa');
    act(() => { vi.advanceTimersByTime(700); });
    expect(status.textContent).toBe('3 matches\u00a0');
    type('ensapa');
    act(() => { vi.advanceTimersByTime(700); });
    expect(status.textContent).toBe('3 matches');
  });

  it('has a Clear search key that empties the query and keeps focus in the input', () => {
    renderIn(makeStore());
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
    type('ensapa');
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(searchBox().value).toBe('');
    expect(document.activeElement).toBe(searchBox());
    expect(screen.getAllByRole('link')).toHaveLength(20);
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
  });

  it('on the search key, puts the keyboard away (blurs the field) and keeps the results', () => {
    renderIn(makeStore());
    const input = searchBox();
    input.focus();
    type('ensapa');
    expect(document.activeElement).toBe(input);
    const submit = new Event('submit', { bubbles: true, cancelable: true });
    input.closest('form')!.dispatchEvent(submit);
    expect(submit.defaultPrevented).toBe(true);
    expect(document.activeElement).not.toBe(input);
    expect(location.hash).toBe('#/notes?q=ensapa');
    expect(searchBox().value).toBe('ensapa');
    expect(screen.getByText('3 matches')).toBeTruthy();
    expect(screen.getAllByRole('link').every((a) => /^#\/notes\/s\d{2}\?b=\d+$/.test(a.getAttribute('href') ?? ''))).toBe(true);
  });
});

describe('Notes tab: the query in the route (M3)', () => {
  it('keeps the query in the route as you type, replacing the entry, and Clear takes it out', () => {
    renderIn(makeStore());
    const entries = history.length;
    type('ensap');
    expect(location.hash).toBe('#/notes?q=ensap');
    type('ensapa');
    expect(location.hash).toBe('#/notes?q=ensapa');
    expect(history.length).toBe(entries);   // replaced, never pushed: Back still leaves the tab
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(location.hash).toBe('#/notes');
    type('oxygen');
    type('');
    expect(location.hash).toBe('#/notes');
    expect(history.length).toBe(entries);
  });

  it('opens on the results of the query in the route, as Back from a hit lands', () => {
    location.hash = '#/notes?q=ensapa';
    renderIn(makeStore());
    expect(searchBox().value).toBe('ensapa');
    expect(screen.getByText('3 matches')).toBeTruthy();
    expect(screen.getAllByRole('link').every((a) => /^#\/notes\/s\d{2}\?b=\d+$/.test(a.getAttribute('href') ?? ''))).toBe(true);
  });

  it('spells any query so the route reads it back the same', () => {
    renderIn(makeStore());
    for (const q of ['a+b & c', '100%', 'O2 #1?', '  two  spaces ']) {
      type(q);
      expect(matchRoute(location.hash).query.q, q).toBe(q);
      expect(matchRoute(location.hash).path).toBe('/notes');
    }
  });

  it('keeps the results live when the browser refuses a replaceState (Safari throttles them)', () => {
    renderIn(makeStore());
    const refuse = vi.spyOn(history, 'replaceState').mockImplementation(() => {
      throw new DOMException('Attempt to use history.replaceState() more than 100 times per 10 seconds', 'SecurityError');
    });
    try {
      expect(() => type('ensapa')).not.toThrow();
      expect(searchBox().value).toBe('ensapa');
      expect(screen.getByText('3 matches')).toBeTruthy();
    } finally {
      refuse.mockRestore();
    }
  });

  it('follows the route when it drops the query (the Notes tab tapped)', () => {
    location.hash = '#/notes?q=ensapa';
    renderIn(makeStore());
    act(() => navigate('/notes'));
    expect(searchBox().value).toBe('');
    expect(screen.getAllByRole('link')).toHaveLength(20);
  });
});

describe('Notes tab: loading and errors', () => {
  it('shows nothing for 300 ms, then a skeleton', () => {
    vi.useFakeTimers();
    resetContentCache();
    vi.stubGlobal('fetch', pendingFetch());
    renderIn(makeStore());
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByRole('searchbox')).toBeNull();
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.getByRole('progressbar', { name: 'Loading' })).toBeTruthy();
  });

  it('shows the notes error copy with Try again, which loads the notes', async () => {
    resetContentCache();
    vi.stubGlobal('fetch', offlineFetch());
    renderIn(makeStore());
    expect(await screen.findByText(NOTES_ERROR)).toBeTruthy();
    expect(contentErrorCopy('notes')).toBe(NOTES_ERROR);
    expect(screen.getByRole('alert').textContent).toBe(NOTES_ERROR);
    vi.stubGlobal('fetch', fileFetch());
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('searchbox', { name: 'Search your notes' })).toBeTruthy();
    expect(screen.getAllByRole('link')).toHaveLength(20);
  });
});
