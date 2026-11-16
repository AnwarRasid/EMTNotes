import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useEffect } from 'preact/hooks';
import { render, screen, within, fireEvent, act, renderHook, waitFor } from '@testing-library/preact';
import { MemoryStorage } from './helpers';
import { SESSION_UNSAVABLE_ERROR, SLOT_KEYS, UNSAVABLE_ERROR, checksum, loadProgress, saveProgress } from '../../src/progress/slots';
import { SCHEMA_VERSION, defaultProgress, type Progress, type QuizSession, type TextSize } from '../../src/progress/types';
import { ANOTHER_WINDOW_ERROR, NEWER_VERSION_ERROR, createProgressStore } from '../../src/progress/store';
import { App, SCREENS } from '../../src/app/App';
import { ROUTES, navigate, type RouteMatch } from '../../src/app/routes';
import { FocusHeader } from '../../src/app/FocusHeader';
import { StatusChip } from '../../src/ui/StatusChip';
import { useDelayedFlag } from '../../src/ui/Skeleton';
import { ToastHost, clearToasts, dismissToast, toast } from '../../src/ui/toast';
import { resetContentCache } from '../../src/data/load';
import { hasVisibleFocus } from '../../src/lib/focus';
import { reloadPage } from '../../src/lib/offline';

// Whether focus shows a ring (a keyboard user) decides if it holds a toast. jsdom's :focus-visible is its own guess
// from the last event, unlike Chromium's, and it carries over between tests, so tests say which they mean with this
// spy: keyboard focus by default, as a test that focuses a key by script means.
vi.mock('../../src/lib/focus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/focus')>();
  return { ...actual, hasVisibleFocus: vi.fn(() => true) };
});
// location.reload can't be stubbed in jsdom; the app reloads through this seam.
vi.mock('../../src/lib/offline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/offline')>();
  return { ...actual, reloadPage: vi.fn() };
});

const SAVE_ERROR = "Progress couldn't be saved on this phone. It's kept until you close the app.";
const CORRUPT = "Some progress couldn't be read.";

const freshStore = () => createProgressStore(new MemoryStorage());
const corruptStorage = () => new MemoryStorage({ [SLOT_KEYS[0]]: 'garbage {', [SLOT_KEYS[1]]: '{"v":1,"seq":3,"sum":' });
const touch = (p: Progress): Progress => ({ ...p, dismissedReview: [...p.dismissedReview, 'q'] });
/** A question stat that JSON turns into null, so the progress wouldn't load back; and the same stat made good. */
const stat = (seen: number) => ({ seen, right: 1, lastAt: '2026-11-13T09:00:00.000Z', lastRight: true, rightSinceWrong: null });
const badStat = (p: Progress): Progress => ({ ...p, questions: { ...p.questions, q1: stat(NaN) } });
const goodStat = (p: Progress): Progress => ({ ...p, questions: { ...p.questions, q1: stat(1) } });
/** An open quiz on a topic that no longer exists: it loads back as null, so the save is refused. */
const badQuiz = (p: Progress): Progress => ({ ...p, quizOpen: { id: 'q', mode: 'practice', filter: { group: 'all', topic: 'dropped-topic' },
  startedAt: '2026-11-13T09:00:00.000Z', total: 1, queue: ['mt-a-q001'], orders: {}, picked: null, checked: null, done: [] } as unknown as QuizSession });
/** A newer app version's save (Plan 2 bumps SCHEMA_VERSION). */
const newerSave = (seq: number) => {
  const data = { ...defaultProgress(), runs: [{ id: 'r1', v2Only: true }] };
  return JSON.stringify({ v: SCHEMA_VERSION + 1, seq, savedAt: '2026-11-13T09:00:00.000Z', sum: checksum(JSON.stringify(data)), data });
};
/** The storage event a browser fires in every other window of the origin when one window saves. */
const otherWindowSaved = (key: string | null = SLOT_KEYS[0]) =>
  act(() => { window.dispatchEvent(new StorageEvent('storage', { key })); });
const banner = () => document.querySelector('.banner');
const textSize = (size: TextSize) => (p: Progress): Progress => ({ ...p, settings: { ...p.settings, textSize: size } });
const currentTabs = () => within(screen.getByRole('navigation', { name: 'Main' }))
  .getAllByRole('link').filter((l) => l.getAttribute('aria-current') === 'page').map((l) => l.textContent);

beforeEach(() => {
  clearToasts();
  vi.mocked(reloadPage).mockClear();
  location.hash = '#/';
  // Screens that load content (the Quiz tab) get an offline fetch, so no test reaches the network.
  resetContentCache();
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetContentCache();
});

describe('tab bar', () => {
  it('shows the Main nav with four tabs on a tab route, only Quiz current, each linking into the hash', () => {
    location.hash = '#/quiz';
    render(<App store={freshStore()} />);
    const links = within(screen.getByRole('navigation', { name: 'Main' })).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['Today', 'PAM', 'Quiz', 'Notes']);
    expect(currentTabs()).toEqual(['Quiz']);
    for (const link of links) expect(link.getAttribute('href')).toMatch(/^#\//);
  });

  it('is gone on a focus route', () => {
    location.hash = '#/quiz/session';
    // An open quiz keeps the session up (with none it goes to the Quiz tab); the offline bank leaves it waiting.
    const store = freshStore();
    store.update((p) => ({ ...p, quizOpen: { id: 'q', mode: 'practice', filter: { group: 'all', topic: 'all' }, startedAt: '2026-11-11T09:00:00.000Z',
      total: 1, queue: ['mt-a-q001'], orders: {}, picked: null, checked: null, done: [] } }));
    render(<App store={store} />);
    expect(location.hash).toBe('#/quiz/session');
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('keeps Today current on Settings, and an unknown path renders Today', () => {
    location.hash = '#/settings';
    const { unmount } = render(<App store={freshStore()} />);
    expect(currentTabs()).toEqual(['Today']);
    unmount();

    location.hash = '#/nope';
    render(<App store={freshStore()} />);
    expect(currentTabs()).toEqual(['Today']);
    expect(screen.getByRole('heading', { level: 1, name: 'Today' })).toBeTruthy();
  });

  it('follows hash changes', async () => {
    render(<App store={freshStore()} />);
    expect(currentTabs()).toEqual(['Today']);
    location.hash = '#/notes';
    await waitFor(() => expect(currentTabs()).toEqual(['Notes']));
    expect(screen.getByRole('heading', { level: 1, name: 'Notes' })).toBeTruthy();
  });
});

describe('route changes', () => {
  const original = { ...SCREENS };
  afterEach(() => {
    Object.assign(SCREENS, original);
    document.documentElement.scrollTop = 0;
  });

  it('starts a new path at the top, but keeps the scroll a new screen sets on mount', () => {
    SCREENS.notesSection = function Anchored() {
      useEffect(() => { document.documentElement.scrollTop = 480; }, []);   // say the reader scrolls to an anchor
      return <h1>Section</h1>;
    };
    navigate('/');
    render(<App store={freshStore()} />);
    document.documentElement.scrollTop = 900;
    act(() => navigate('/quiz'));
    expect(document.documentElement.scrollTop).toBe(0);

    document.documentElement.scrollTop = 900;
    act(() => navigate('/notes/s01/delicate-spine'));
    expect(screen.getByRole('heading', { level: 1, name: 'Section' })).toBeTruthy();
    expect(document.documentElement.scrollTop).toBe(480);
  });

  it('keeps the scroll and the mounted screen on a query-only change, and remounts on a new path', () => {
    let mounts = 0;
    SCREENS.notesSection = function Counted({ match }: { match: RouteMatch }) {
      useEffect(() => { mounts += 1; }, []);
      return <h1>{match.params.section}</h1>;
    };
    navigate('/notes/s01?b=1');
    render(<App store={freshStore()} />);
    document.documentElement.scrollTop = 300;
    act(() => navigate('/notes/s01?b=2'));
    expect(document.documentElement.scrollTop).toBe(300);
    expect(mounts).toBe(1);

    act(() => navigate('/notes/s02'));
    expect(screen.getByRole('heading', { level: 1, name: 's02' })).toBeTruthy();
    expect(mounts).toBe(2);
  });

  it('leaves focus alone when the new screen focused a control of its own on mount', () => {
    SCREENS.notes = function Search() {
      useEffect(() => { document.getElementById('q')?.focus(); }, []);
      return <><h1>Notes</h1><input id="q" aria-label="Search notes" /></>;
    };
    navigate('/');
    render(<App store={freshStore()} />);
    act(() => navigate('/notes'));
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Search notes' }));
  });

  it("still moves focus to the new h1 when <main> itself held focus (a screen with no h1 before it)", () => {
    SCREENS.notes = function NoHeading() { return <p>Nothing here</p>; };
    SCREENS.pam = function Headed() { return <h1>Next screen</h1>; };
    navigate('/');
    const { container } = render(<App store={freshStore()} />);
    act(() => navigate('/notes'));
    const main = container.querySelector('main');
    expect(document.activeElement).toBe(main);   // the fallback: no h1 to focus
    act(() => navigate('/pam'));
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Next screen' }));
  });

  it('still moves focus to the new h1 when focus was on the corrupt banner, which outlives the route', () => {
    SCREENS.pam = function Headed() { return <h1>Next screen</h1>; };
    navigate('/');
    render(<App store={createProgressStore(corruptStorage())} />);
    screen.getByRole('button', { name: 'Try again' }).focus();
    act(() => navigate('/pam'));
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Next screen' }));
  });

  it("moves focus to the new screen's h1, marked as shell focus", () => {
    navigate('/');
    render(<App store={freshStore()} />);
    act(() => navigate('/quiz'));
    const h1 = screen.getByRole('heading', { level: 1, name: 'Theory quiz' });
    expect(document.activeElement).toBe(h1);
    expect(h1.getAttribute('tabindex')).toBe('-1');
    expect(h1.hasAttribute('data-route-focus')).toBe(true);
  });
});

describe('screens', () => {
  it('has a screen for every route, and notFound is Today', () => {
    for (const r of ROUTES) expect(SCREENS[r.name]).toBeTypeOf('function');
    expect(SCREENS.notFound).toBe(SCREENS.today);
  });
});

describe('FocusHeader', () => {
  it('renders a Close button that exits, the title as an h1, the sub-line and the right slot', () => {
    const onExit = vi.fn();
    render(<FocusHeader exit="close" onExit={onExit} title="Practice" sub="Respiratory, both banks" right={<span>18 of 20</span>} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Practice' })).toBeTruthy();
    expect(screen.getByText('Respiratory, both banks')).toBeTruthy();
    expect(screen.getByText('18 of 20')).toBeTruthy();
  });

  it('renders a Pause button for a run', () => {
    render(<FocusHeader exit="pause" onExit={() => {}} title="Breathlessness" />);
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Breathlessness' })).toBeTruthy();
  });
});

describe('load results', () => {
  it('shows the corrupt banner with Try again and Start fresh, and Start fresh removes it', () => {
    const storage = corruptStorage();
    render(<App store={createProgressStore(storage)} />);
    expect(screen.getByText(CORRUPT)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start fresh' }));
    expect(screen.queryByText(CORRUPT)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start fresh' })).toBeNull();
    expect(loadProgress(storage).status).toBe('ok');
  });

  it('keeps the banner while Try again still cannot read the save, and drops it once it can', () => {
    const storage = corruptStorage();
    render(<App store={createProgressStore(storage)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText(CORRUPT)).toBeTruthy();
    expect(screen.getByText("It still couldn't be read.")).toBeTruthy();

    storage.map.clear();   // say another window repaired the save
    saveProgress(storage, defaultProgress(), 1, new Date());
    const tryAgain = screen.getByRole('button', { name: 'Try again' });
    tryAgain.focus();
    fireEvent.click(tryAgain);
    expect(screen.queryByText(CORRUPT)).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Today' }));
  });

  it('leaves focus where it is when the banner closes without holding focus', () => {
    render(<App store={createProgressStore(corruptStorage())} />);
    const quizTab = screen.getByRole('link', { name: 'Quiz' });
    quizTab.focus();
    fireEvent.click(screen.getByRole('button', { name: 'Start fresh' }));
    expect(screen.queryByText(CORRUPT)).toBeNull();
    expect(document.activeElement).toBe(quizTab);
  });

  it('hands focus to the heading when the banner closes with focus on <body> (WebKit leaves a tapped button unfocused)', () => {
    render(<App store={createProgressStore(corruptStorage())} />);
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);
    fireEvent.click(screen.getByRole('button', { name: 'Start fresh' }));   // a click that never focuses the button
    expect(screen.queryByText(CORRUPT)).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Today' }));
  });

  it('keeps the banner when Try again finds storage unreachable: the unread save stays on disk and saves stay blocked', () => {
    const storage = corruptStorage();
    const store = createProgressStore(storage);
    render(<App store={store} />);
    storage.failReads = true;   // say the browser now blocks storage
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText(CORRUPT)).toBeTruthy();
    expect(screen.getByText("It still couldn't be read.")).toBeTruthy();
    expect(screen.queryByText("Progress can't be read on this phone right now.")).toBeNull();

    storage.failReads = false;
    act(() => store.update(touch));
    expect(storage.raw(SLOT_KEYS[0])).toBe('garbage {');   // nothing written over the unread save
    expect(storage.raw(SLOT_KEYS[1])).toBe('{"v":1,"seq":3,"sum":');
  });

  it('keeps the banner when Start fresh finds storage unreachable, and says nothing was cleared', () => {
    const storage = corruptStorage();
    render(<App store={createProgressStore(storage)} />);
    storage.failReads = true;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));   // storage now out of reach
    act(() => clearToasts());   // its "It still couldn't be read." would queue the one under test
    fireEvent.click(screen.getByRole('button', { name: 'Start fresh' }));
    expect(screen.getByText(CORRUPT)).toBeTruthy();
    expect(screen.queryByText('Started fresh.')).toBeNull();
    expect(screen.getByText("Storage isn't available on this phone, so nothing was cleared.")).toBeTruthy();
    expect([storage.raw(SLOT_KEYS[0]), storage.raw(SLOT_KEYS[1])]).toEqual(['garbage {', '{"v":1,"seq":3,"sum":']);
  });

  it('says so when Try again finds no saved progress at all', () => {
    const storage = corruptStorage();
    render(<App store={createProgressStore(storage)} />);
    storage.map.clear();   // say another window cleared both slots
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.queryByText(CORRUPT)).toBeNull();
    expect(screen.getByText("There's no saved progress on this phone now.")).toBeTruthy();
  });

  it('Start fresh keeps what was done while the banner was up, and saves it', () => {
    const storage = corruptStorage();
    const store = createProgressStore(storage);
    render(<App store={store} />);
    act(() => store.update(touch));
    fireEvent.click(screen.getByRole('button', { name: 'Start fresh' }));
    expect(store.get().dismissedReview).toEqual(['q']);
    expect(loadProgress(storage).data.dismissedReview).toEqual(['q']);
  });

  it('confirms Start fresh and moves focus from the gone banner to the screen heading', () => {
    render(<App store={createProgressStore(corruptStorage())} />);
    const startFresh = screen.getByRole('button', { name: 'Start fresh' });
    startFresh.focus();
    fireEvent.click(startFresh);
    expect(screen.getByText('Started fresh.')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Today' }));
  });

  it('toasts a restored load with the time of the last good save, and offers no Start fresh', () => {
    const storage = new MemoryStorage();
    saveProgress(storage, defaultProgress(), 1, new Date(2026, 10, 9, 22, 10));
    storage.setItem(SLOT_KEYS[0], 'garbage {');
    const store = createProgressStore(storage);
    expect(store.lastLoad().status).toBe('restored');
    render(<App store={store} />);
    expect(screen.getByText("Some progress couldn't be read. Your last good save, from 9 Nov, 22:10, is back.")).toBeTruthy();
    expect(screen.queryByText(CORRUPT)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start fresh' })).toBeNull();
  });

  it('shows neither banner nor toast on a fresh load', () => {
    render(<App store={freshStore()} />);
    expect(screen.queryByText(CORRUPT)).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('');
    expect(screen.queryByRole('button', { name: 'Start fresh' })).toBeNull();
  });
});

describe('save errors', () => {
  it('toasts a failed save once, in the generic copy', async () => {
    const storage = new MemoryStorage();
    const store = createProgressStore(storage);
    render(<App store={store} />);
    storage.failWrites = true;
    act(() => store.update(touch));
    act(() => store.update(touch));
    expect(store.lastSaveError()).not.toBeNull();
    expect(screen.getAllByText(SAVE_ERROR)).toHaveLength(1);
    expect(screen.queryByText(ANOTHER_WINDOW_ERROR)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start fresh' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.queryByText(SAVE_ERROR)).toBeNull());
    act(() => store.update(touch));
    expect(screen.queryByText(SAVE_ERROR)).toBeNull();
  });

  it('toasts again when saving fails after it has worked in between', async () => {
    const storage = new MemoryStorage();
    const store = createProgressStore(storage);
    render(<App store={store} />);
    storage.failWrites = true;
    act(() => store.update(touch));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.queryByText(SAVE_ERROR)).toBeNull());

    storage.failWrites = false;
    act(() => store.update(touch));
    expect(store.lastSaveError()).toBeNull();
    storage.failWrites = true;
    act(() => store.update(touch));
    expect(screen.getAllByText(SAVE_ERROR)).toHaveLength(1);
  });

  it("says why when the progress or an open quiz wouldn't load back, rather than blaming the phone", async () => {
    const store = freshStore();
    render(<App store={store} />);
    act(() => store.update(badStat));
    expect(screen.getByText(UNSAVABLE_ERROR)).toBeTruthy();
    expect(screen.queryByText(SAVE_ERROR)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.queryByText(UNSAVABLE_ERROR)).toBeNull());

    act(() => store.update(goodStat));   // saved again
    act(() => store.update(badQuiz));
    expect(screen.getByText(SESSION_UNSAVABLE_ERROR)).toBeTruthy();
  });

  it("keeps the corrupt banner and clears nothing when Start fresh's own check refuses what is in memory", () => {
    const storage = corruptStorage();
    const store = createProgressStore(storage);
    render(<App store={store} />);
    act(() => store.update(badStat));   // done while the banner was up: held in memory, nothing written
    const disk = [storage.raw(SLOT_KEYS[0]), storage.raw(SLOT_KEYS[1])];
    fireEvent.click(screen.getByRole('button', { name: 'Start fresh' }));
    expect([storage.raw(SLOT_KEYS[0]), storage.raw(SLOT_KEYS[1])]).toEqual(disk);
    expect(screen.getByText(CORRUPT)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start fresh' })).toBeTruthy();
    expect(screen.queryByText('Started fresh.')).toBeNull();
    expect(screen.getAllByText(UNSAVABLE_ERROR)).toHaveLength(1);
  });
});

// Task 19: an Android tab restored from the back-forward cache (or brought back from the background) gets no storage
// event for saves made while it was away, so the store rechecks the slots then, before the trainee's first change.
describe('rechecks when the page comes back', () => {
  let visibility: DocumentVisibilityState = 'visible';
  const setVisibility = (state: DocumentVisibilityState) => act(() => {
    visibility = state;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const pageshow = () => act(() => { window.dispatchEvent(new Event('pageshow')); });

  beforeEach(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  });
  afterEach(() => {
    delete (document as { visibilityState?: unknown }).visibilityState;
    visibility = 'visible';
  });

  it('rechecks on pageshow', () => {
    const store = freshStore();
    const recheck = vi.spyOn(store, 'recheck');
    render(<App store={store} />);
    recheck.mockClear();
    pageshow();
    expect(recheck).toHaveBeenCalledTimes(1);
  });

  it('rechecks when the page becomes visible, not when it is hidden', () => {
    const store = freshStore();
    const recheck = vi.spyOn(store, 'recheck');
    render(<App store={store} />);
    recheck.mockClear();
    setVisibility('hidden');
    expect(recheck).not.toHaveBeenCalled();
    setVisibility('visible');
    expect(recheck).toHaveBeenCalledTimes(1);
  });

  it('shows the Reload banner on pageshow when another window saved while this tab was away', () => {
    const storage = new MemoryStorage();
    const mine = createProgressStore(storage);
    mine.update(touch);
    render(<App store={mine} />);
    createProgressStore(storage).update(touch);   // the installed app saved; no storage event reached this tab
    expect(banner()).toBeNull();
    pageshow();
    expect(within(banner() as HTMLElement).getByText(ANOTHER_WINDOW_ERROR)).toBeTruthy();
  });

  it('stops listening once unmounted', () => {
    const store = freshStore();
    const recheck = vi.spyOn(store, 'recheck');
    const { unmount } = render(<App store={store} />);
    unmount();
    recheck.mockClear();
    pageshow();
    setVisibility('visible');
    expect(recheck).not.toHaveBeenCalled();
  });
});

// Task 19: while a banner shows, .app says so (has-banner) and carries its height (--banner-h), so the toasts on a
// focus screen sit under it and the run screen gives up that height (ruling S14).
describe('the banner height', () => {
  const app = () => document.querySelector('.app') as HTMLElement;
  const bannerH = () => app().style.getPropertyValue('--banner-h');
  /** jsdom lays nothing out: banners measure `height` px tall, everything else 0. */
  const measureBanners = (height: number) => vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: HTMLElement) {
      const h = this.classList.contains('banner') ? height : 0;
      return { x: 0, y: 0, top: 0, left: 0, right: 0, width: 0, bottom: h, height: h, toJSON: () => ({}) } as DOMRect;
    });
  /** A ResizeObserver the test fires by hand. */
  class FakeResizeObserver {
    static last: FakeResizeObserver | null = null;
    observed: Element[] = [];
    constructor(private readonly cb: ResizeObserverCallback) { FakeResizeObserver.last = this; }
    observe(el: Element) { this.observed.push(el); }
    unobserve() {}
    disconnect() { this.observed = []; }
    fire() { this.cb([], this as unknown as ResizeObserver); }
  }
  const conflicted = () => {
    const storage = new MemoryStorage();
    const mine = createProgressStore(storage);
    createProgressStore(storage).update(touch);   // another window saved first
    mine.recheck();
    expect(mine.writeBlock()).toBe('conflict');
    return mine;
  };

  afterEach(() => { FakeResizeObserver.last = null; });

  it('marks .app has-banner while the Reload banner shows', () => {
    const storage = new MemoryStorage();
    const mine = createProgressStore(storage);
    render(<App store={mine} />);
    expect(app().classList.contains('has-banner')).toBe(false);
    createProgressStore(storage).update(touch);
    act(() => mine.update(touch));
    expect(mine.writeBlock()).toBe('conflict');
    expect(app().classList.contains('has-banner')).toBe(true);
    act(() => navigate('/notes/s01'));   // a focus screen keeps it
    expect(app().classList.contains('app-focus')).toBe(true);
    expect(app().classList.contains('has-banner')).toBe(true);
  });

  it("sets --banner-h from the banner's height, measured once where there is no ResizeObserver", () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const spy = measureBanners(132);
    try {
      render(<App store={conflicted()} />);
      expect(bannerH()).toBe('132px');
    } finally {
      spy.mockRestore();
    }
  });

  it("follows the banner's height through ResizeObserver", () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    let spy = measureBanners(120);
    try {
      render(<App store={conflicted()} />);
      expect(bannerH()).toBe('120px');
      expect(FakeResizeObserver.last?.observed).toEqual([banner()]);
      spy.mockRestore();
      spy = measureBanners(168);   // say a larger text size wrapped its message
      act(() => FakeResizeObserver.last?.fire());
      expect(bannerH()).toBe('168px');
    } finally {
      spy.mockRestore();
    }
  });

  it('marks the corrupt banner too, and drops both the mark and the height once it closes', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    const spy = measureBanners(140);
    try {
      render(<App store={createProgressStore(corruptStorage())} />);
      expect(app().classList.contains('has-banner')).toBe(true);
      expect(bannerH()).toBe('140px');
      fireEvent.click(screen.getByRole('button', { name: 'Start fresh' }));
      expect(banner()).toBeNull();
      expect(app().classList.contains('has-banner')).toBe(false);
      expect(bannerH()).toBe('');
      expect(FakeResizeObserver.last?.observed).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('writes held back until a reload (I2)', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('shows a banner with Reload, never a toast, once another window has saved newer progress, and keeps it', () => {
    vi.useFakeTimers();
    const storage = new MemoryStorage();
    const mine = createProgressStore(storage);
    render(<App store={mine} />);
    createProgressStore(storage).update(touch);   // the other window saves first
    act(() => mine.update(touch));
    expect(mine.lastSaveError()).toBe(ANOTHER_WINDOW_ERROR);

    expect(within(banner() as HTMLElement).getByText(ANOTHER_WINDOW_ERROR)).toBeTruthy();
    expect(within(banner() as HTMLElement).getByText("Changes made here aren't saved.")).toBeTruthy();
    expect(within(screen.getByRole('status')).queryByText(ANOTHER_WINDOW_ERROR)).toBeNull();   // no toast
    expect(within(banner() as HTMLElement).queryByRole('button', { name: 'Dismiss' })).toBeNull();
    expect(screen.queryByText(SAVE_ERROR)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start fresh' })).toBeNull();

    // It outlasts any toast's time, more saves, a new screen and a focus screen: nothing closes it but a reload.
    act(() => { vi.advanceTimersByTime(60_000); });
    act(() => mine.update(touch));
    act(() => navigate('/quiz'));
    act(() => navigate('/notes/s01'));
    expect(screen.getAllByText(ANOTHER_WINDOW_ERROR)).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reloadPage).toHaveBeenCalledTimes(1);
    expect(banner()).not.toBeNull();
  });

  it("raises the banner as soon as another window's save fires a storage event, before this window saves", () => {
    const storage = new MemoryStorage();
    const mine = createProgressStore(storage);
    mine.update(touch);
    render(<App store={mine} />);
    otherWindowSaved('crewleader.e2e.seeded');   // not a save slot
    otherWindowSaved();                          // a slot, but nothing new in it yet
    expect(banner()).toBeNull();

    createProgressStore(storage).update(touch);
    otherWindowSaved(SLOT_KEYS[0]);
    expect(within(banner() as HTMLElement).getByText(ANOTHER_WINDOW_ERROR)).toBeTruthy();
    expect(within(banner() as HTMLElement).getByRole('button', { name: 'Reload' })).toBeTruthy();
  });

  it('also follows a storage event that cleared the whole store (key null)', () => {
    const storage = new MemoryStorage();
    const mine = createProgressStore(storage);
    render(<App store={mine} />);
    createProgressStore(storage).update(touch);
    otherWindowSaved(null);
    expect(screen.getByText(ANOTHER_WINDOW_ERROR)).toBeTruthy();
  });

  it("says this copy is out of date when a newer version's save is on disk at load, with no Start fresh or restored toast", () => {
    const storage = new MemoryStorage();
    saveProgress(storage, defaultProgress(), 1, new Date());
    storage.setItem(SLOT_KEYS[0], newerSave(2));
    const disk = [storage.raw(SLOT_KEYS[0]), storage.raw(SLOT_KEYS[1])];
    const store = createProgressStore(storage);
    render(<App store={store} />);
    expect(within(banner() as HTMLElement).getByText(NEWER_VERSION_ERROR)).toBeTruthy();
    expect(screen.queryByText(/Your last good save/)).toBeNull();
    expect(screen.queryByText(CORRUPT)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start fresh' })).toBeNull();
    act(() => store.update(touch));
    expect([storage.raw(SLOT_KEYS[0]), storage.raw(SLOT_KEYS[1])]).toEqual(disk);
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });

  it("names a newer version's save over another window's when a storage event brings one", () => {
    const storage = new MemoryStorage();
    const mine = createProgressStore(storage);
    mine.update(touch);   // seq 1, slot 1
    render(<App store={mine} />);
    storage.setItem(SLOT_KEYS[0], newerSave(2));
    otherWindowSaved(SLOT_KEYS[0]);
    expect(screen.getByText(NEWER_VERSION_ERROR)).toBeTruthy();
    expect(screen.queryByText(ANOTHER_WINDOW_ERROR)).toBeNull();
  });

  it('replaces the corrupt banner when another window saves first, so Start fresh is no longer offered', () => {
    const storage = corruptStorage();
    render(<App store={createProgressStore(storage)} />);
    screen.getByRole('button', { name: 'Try again' }).focus();
    createProgressStore(storage).startFresh();   // the other window clears the garbage and saves
    otherWindowSaved(SLOT_KEYS[1]);
    expect(screen.queryByText(CORRUPT)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start fresh' })).toBeNull();
    expect(screen.getByText(ANOTHER_WINDOW_ERROR)).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Today' }));   // not <body>
  });

  it('turns Start fresh into the Reload banner when another window saved since, with no Started fresh', () => {
    const storage = corruptStorage();
    render(<App store={createProgressStore(storage)} />);
    createProgressStore(storage).startFresh();   // no storage event reaches this window in time
    const disk = [storage.raw(SLOT_KEYS[0]), storage.raw(SLOT_KEYS[1])];
    fireEvent.click(screen.getByRole('button', { name: 'Start fresh' }));
    expect([storage.raw(SLOT_KEYS[0]), storage.raw(SLOT_KEYS[1])]).toEqual(disk);
    expect(screen.queryByText('Started fresh.')).toBeNull();
    expect(screen.getByText(ANOTHER_WINDOW_ERROR)).toBeTruthy();
  });

  it("swaps the corrupt banner for the out-of-date one when Try again finds a newer version's save", () => {
    const storage = corruptStorage();
    render(<App store={createProgressStore(storage)} />);
    storage.setItem(SLOT_KEYS[1], newerSave(1));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.queryByText(CORRUPT)).toBeNull();
    expect(screen.queryByText("It still couldn't be read.")).toBeNull();
    expect(screen.getByText(NEWER_VERSION_ERROR)).toBeTruthy();
  });
});

describe('text size', () => {
  it('sets the document text size from settings and follows changes', () => {
    const store = freshStore();
    store.update(textSize('larger'));
    render(<App store={store} />);
    expect(document.documentElement.dataset.textSize).toBe('larger');
    act(() => store.update(textSize('standard')));
    expect(document.documentElement.dataset.textSize).toBe('standard');
  });
});

describe('useDelayedFlag', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('is false at 299 ms and true at 300 ms', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useDelayedFlag(true));
    expect(result.current).toBe(false);
    act(() => { vi.advanceTimersByTime(299); });
    expect(result.current).toBe(false);
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toBe(true);
  });

  it('takes a custom delay, and drops to false at once when the work ends', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ active }: { active: boolean }) => useDelayedFlag(active, 100),
      { initialProps: { active: true } });
    act(() => { vi.advanceTimersByTime(100); });
    expect(result.current).toBe(true);
    rerender({ active: false });
    expect(result.current).toBe(false);
  });
});

describe('StatusChip', () => {
  it('renders missed as !!! with its word', () => {
    const { container } = render(<StatusChip kind="missed" label="Missed" />);
    expect(container.textContent).toBe('!!!Missed');
  });

  it('renders order and phrase as !!, and done as a green ✓ with no alarm mark', () => {
    const order = render(<StatusChip kind="order" label="Order" />).container;
    const phrase = render(<StatusChip kind="phrase" label="Phrase" />).container;
    const done = render(<StatusChip kind="done" label="Right" />).container;
    expect(order.textContent).toBe('!!Order');
    expect(phrase.textContent).toBe('!!Phrase');
    expect(done.textContent).toBe('✓Right');
    expect(done.querySelector('.tag-ok')).not.toBeNull();
  });
});

describe('toast', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(hasVisibleFocus).mockReset();   // back to keyboard focus
  });

  it('pauses for keyboard focus only: focus without a ring (a script moved it after a tap or click) lets it go', () => {
    vi.useFakeTimers();
    render(<ToastHost />);
    const host = screen.getByRole('status');
    vi.mocked(hasVisibleFocus).mockReturnValue(false);
    act(() => { toast('Quiz discarded.', { label: 'Undo', run: () => {} }, { ms: 8_000 }); });
    act(() => screen.getByRole('button', { name: 'Undo' }).focus());
    act(() => { vi.advanceTimersByTime(8_200); });
    expect(host.textContent).toBe('');

    vi.mocked(hasVisibleFocus).mockReturnValue(true);
    act(() => { toast('Quiz discarded.', { label: 'Undo', run: () => {} }, { ms: 8_000 }); });
    act(() => screen.getByRole('button', { name: 'Undo' }).focus());
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(host.textContent).toContain('Quiz discarded.');
    expect(vi.mocked(hasVisibleFocus)).toHaveBeenLastCalledWith(screen.getByRole('button', { name: 'Undo' }));
  });

  it('speaks through a polite status region and runs its action', async () => {
    const run = vi.fn();
    render(<ToastHost />);
    const host = screen.getByRole('status');
    expect(host.getAttribute('aria-live')).toBe('polite');
    act(() => { toast('A new version is ready.', { label: 'Reload', run }); });
    expect(host.textContent).toContain('A new version is ready.');
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(run).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(host.textContent).toBe(''));
  });

  it('shows one toast at a time in order, skips a duplicate, and dismisses one without an action by itself', () => {
    vi.useFakeTimers();
    render(<ToastHost />);
    const host = screen.getByRole('status');
    act(() => { toast('First.'); toast('Second.'); toast('First.'); });
    expect(host.textContent).toBe('First.');
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(host.textContent).toBe('Second.');
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(host.textContent).toBe('');
  });

  it('keeps a toast with an action until it is used or dismissed', () => {
    vi.useFakeTimers();
    render(<ToastHost />);
    act(() => { toast('A new version is ready.', { label: 'Reload', run: () => {} }); });
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(screen.getByRole('status').textContent).toContain('A new version is ready.');
  });

  it('lets a newer toast go ahead of one that waits for its user, which comes back once the newer has gone', () => {
    vi.useFakeTimers();
    render(<ToastHost />);
    const host = screen.getByRole('status');
    const closed: string[] = [];
    act(() => { toast('A new version is ready.', { label: 'Reload', run: () => {} }, { onClose: () => closed.push('update') }); });
    const undo = vi.fn();
    act(() => { toast('Quiz discarded.', { label: 'Undo', run: undo }, { ms: 8_000 }); });
    expect(host.textContent).toContain('Quiz discarded.');   // at once, not after the update
    expect(closed).toEqual([]);   // set aside, not closed
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(undo).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(200); });
    expect(host.textContent).toContain('A new version is ready.');
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
    expect(closed).toEqual([]);
  });

  it('puts every toast queued meanwhile ahead of the one that waits for its user, in order', () => {
    vi.useFakeTimers();
    render(<ToastHost />);
    const host = screen.getByRole('status');
    act(() => {
      toast('A new version is ready.', { label: 'Reload', run: () => {} });
      toast('First.');    // pre-empts the update
      toast('Second.');   // queued while First shows: still ahead of the update
    });
    expect(host.textContent).toBe('First.');
    act(() => { vi.advanceTimersByTime(5_200); });
    expect(host.textContent).toBe('Second.');
    act(() => { vi.advanceTimersByTime(5_200); });
    expect(host.textContent).toContain('A new version is ready.');
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(host.textContent).toContain('A new version is ready.');
  });

  it('never pre-empts a toast with a time of its own, nor cuts short one already fading', () => {
    vi.useFakeTimers();
    render(<ToastHost />);
    const host = screen.getByRole('status');
    act(() => { toast('Quiz discarded.', { label: 'Undo', run: () => {} }, { ms: 8_000 }); toast('Saved.'); });
    expect(host.textContent).toContain('Quiz discarded.');
    act(() => { vi.advanceTimersByTime(8_200); });
    expect(host.textContent).toBe('Saved.');
    act(() => { vi.advanceTimersByTime(5_200); });

    let update = 0;
    act(() => { update = toast('A new version is ready.', { label: 'Reload', run: () => {} }); });
    act(() => dismissToast(update));   // fading
    act(() => { toast('Later.'); });
    expect(host.querySelector('.toast')?.className).toBe('toast toast-out');
    expect(host.textContent).toContain('A new version is ready.');
    act(() => { vi.advanceTimersByTime(200); });
    expect(host.textContent).toBe('Later.');
  });

  it('times out a toast with an action given a time of its own, holding it while it has focus', () => {
    vi.useFakeTimers();
    render(<ToastHost />);
    const host = screen.getByRole('status');
    act(() => { toast('Quiz discarded.', { label: 'Undo', run: () => {} }, { ms: 8_000 }); });
    act(() => { vi.advanceTimersByTime(7_900); });
    expect(host.textContent).toContain('Quiz discarded.');
    act(() => screen.getByRole('button', { name: 'Undo' }).focus());
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(host.textContent).toContain('Quiz discarded.');
    act(() => screen.getByRole('button', { name: 'Undo' }).blur());
    act(() => { vi.advanceTimersByTime(2_200); });
    expect(host.textContent).toBe('');
  });

  it('dismisses by id: the one showing fades, one waiting drops, and each says it has gone once', () => {
    vi.useFakeTimers();
    render(<ToastHost />);
    const host = screen.getByRole('status');
    const closed: string[] = [];
    let one = 0;
    let two = 0;
    act(() => {
      one = toast('One.', undefined, { onClose: () => closed.push('one') });
      two = toast('Two.', undefined, { onClose: () => closed.push('two') });
      toast('Three.');
    });
    act(() => dismissToast(two));
    expect(closed).toEqual(['two']);
    act(() => dismissToast(one));
    act(() => dismissToast(one));
    expect(closed).toEqual(['two']);   // not until it has faded
    act(() => { vi.advanceTimersByTime(200); });
    expect(closed).toEqual(['two', 'one']);
    expect(host.textContent).toBe('Three.');
    act(() => dismissToast(9_999));   // no such toast
    expect(host.textContent).toBe('Three.');
  });

  it('gives back the id of the same message waiting, and queues it anew once the earlier one is fading', () => {
    vi.useFakeTimers();
    render(<ToastHost />);
    const host = screen.getByRole('status');
    let first = 0;
    let again = 0;
    act(() => { first = toast('Saved.'); again = toast('Saved.'); });
    expect(again).toBe(first);
    act(() => dismissToast(first));
    let fresh = 0;
    act(() => { fresh = toast('Saved.'); });
    expect(fresh).not.toBe(first);
    act(() => { vi.advanceTimersByTime(200); });
    expect(host.textContent).toBe('Saved.');
  });

  it('merges a repeated message into the one queued: the longer time wins and each onClose runs once', () => {
    vi.useFakeTimers();
    render(<ToastHost />);
    const host = screen.getByRole('status');
    const closed: string[] = [];
    act(() => {
      toast('Saved.', undefined, { ms: 2_000, onClose: () => closed.push('first') });
      toast('Saved.', undefined, { ms: 9_000, onClose: () => closed.push('second') });
      toast('Saved.', undefined, { ms: 1_000 });   // shorter: keeps 9 s
    });
    act(() => { vi.advanceTimersByTime(8_800); });
    expect(host.textContent).toBe('Saved.');
    act(() => { vi.advanceTimersByTime(400); });
    expect(closed).toEqual(['first', 'second']);
    expect(host.textContent).toBe('');

    // Waiting behind another, a repeat stretches its time too, counted from when it shows.
    act(() => { toast('First.'); toast('Later.', undefined, { ms: 1_000 }); toast('Later.', undefined, { ms: 7_000 }); });
    act(() => { vi.advanceTimersByTime(5_200); });
    expect(host.textContent).toBe('Later.');
    act(() => { vi.advanceTimersByTime(6_800); });
    expect(host.textContent).toBe('Later.');
    act(() => { vi.advanceTimersByTime(400); });
    expect(host.textContent).toBe('');
  });

  it('gives a repeat of the toast showing its time from now when the toast had less left', () => {
    vi.useFakeTimers();
    render(<ToastHost />);
    const host = screen.getByRole('status');
    act(() => { toast('Saved.', undefined, { ms: 9_000 }); });
    act(() => { vi.advanceTimersByTime(8_000); });   // 1 s left
    act(() => { toast('Saved.', undefined, { ms: 3_000 }); });
    act(() => { vi.advanceTimersByTime(2_800); });
    expect(host.textContent).toBe('Saved.');
    act(() => { vi.advanceTimersByTime(400); });
    expect(host.textContent).toBe('');
  });

  it('keeps an action toast with no time of its own waiting for its user when a timed repeat merges in', () => {
    vi.useFakeTimers();
    render(<ToastHost />);
    act(() => {
      toast('A new version is ready.', { label: 'Reload', run: () => {} });
      toast('A new version is ready.', { label: 'Reload', run: () => {} }, { ms: 3_000 });
    });
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(screen.getByRole('status').textContent).toContain('A new version is ready.');
  });

  it('pauses its clock while it has focus or a mouse over it, but not for a touch', () => {
    vi.useFakeTimers();
    render(<ToastHost />);
    const host = screen.getByRole('status');
    act(() => { toast('First.'); });
    const dismiss = screen.getByRole('button', { name: 'Dismiss' });
    act(() => dismiss.focus());
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(host.textContent).toBe('First.');
    act(() => dismiss.blur());
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(host.textContent).toBe('');

    act(() => { toast('Second.'); });
    const box = host.querySelector('.toast') as HTMLElement;
    fireEvent.pointerEnter(box, { pointerType: 'mouse' });
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(host.textContent).toBe('Second.');
    fireEvent.pointerLeave(box, { pointerType: 'mouse' });
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(host.textContent).toBe('');

    act(() => { toast('Third.'); });
    fireEvent.pointerEnter(host.querySelector('.toast') as HTMLElement, { pointerType: 'touch' });
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(host.textContent).toBe('');
  });

  it('never wedges the queue when a mouse or focus arrives during the exit fade', () => {
    vi.useFakeTimers();
    render(<ToastHost />);
    const host = screen.getByRole('status');
    const dismiss = () => host.querySelector<HTMLButtonElement>('[aria-label="Dismiss"]') as HTMLButtonElement;
    act(() => { toast('One.'); toast('Two.'); toast('Three.'); });

    fireEvent.click(dismiss());   // starts the 140 ms fade
    act(() => { vi.advanceTimersByTime(30); });
    const fading = host.querySelector('.toast') as HTMLElement;
    expect(fading.className).toBe('toast toast-out');
    expect(fading.hasAttribute('inert')).toBe(true);   // out of the tab order and the accessibility tree
    fireEvent.pointerEnter(fading, { pointerType: 'mouse' });
    act(() => { vi.advanceTimersByTime(200); });
    expect(host.textContent).toBe('Two.');
    expect((host.querySelector('.toast') as HTMLElement).hasAttribute('inert')).toBe(false);

    fireEvent.click(dismiss());
    act(() => { vi.advanceTimersByTime(30); });
    act(() => dismiss().focus());
    act(() => { vi.advanceTimersByTime(200); });
    expect(host.textContent).toBe('Three.');

    // and the clock still runs for the toast now showing
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(host.textContent).toBe('');
  });

  it('moves focus to the screen heading when a focused toast is dismissed or its action runs', () => {
    render(<App store={freshStore()} />);
    const heading = screen.getByRole('heading', { level: 1, name: 'Today' });
    act(() => { toast('Saved.'); });
    const dismiss = screen.getByRole('button', { name: 'Dismiss' });
    dismiss.focus();
    fireEvent.click(dismiss);
    expect(document.activeElement).toBe(heading);

    clearToasts();
    const run = vi.fn();
    act(() => { toast('A new version is ready.', { label: 'Reload', run }); });
    const reload = screen.getByRole('button', { name: 'Reload' });
    reload.focus();
    fireEvent.click(reload);
    expect(run).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(heading);
  });
});
