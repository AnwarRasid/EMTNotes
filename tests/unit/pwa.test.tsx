// Task 21: the PWA prompts. "Ready to use offline." once the app is cached; "A new version is ready." with Reload,
// never during a run and waiting for the trainee; and "You're offline. Everything still works." the first time only.
import { render, screen, fireEvent, act } from '@testing-library/preact';
import { MemoryStorage } from './helpers';
import { resetContentCache } from '../../src/data/load';
import { ProgressContext } from '../../src/progress/hooks';
import { createProgressStore, type ProgressStore } from '../../src/progress/store';
import { App } from '../../src/app/App';
import { navigate } from '../../src/app/routes';
import { PwaPrompts } from '../../src/app/PwaPrompts';
import { releaseHeldReload, reloadHeld, reloadPage } from '../../src/lib/offline';
import { ToastHost, clearToasts, toast } from '../../src/ui/toast';

const READY = 'Ready to use offline.';
const UPDATE = 'A new version is ready.';
const OFFLINE = "You're offline. Everything still works.";
const SAVE_ERROR = "Progress couldn't be saved on this phone. It's kept until you close the app.";

/** What the mocked useRegisterSW starts with, its update, its needRefresh setter (for an update found later), and the
 *  options PwaPrompts gave it (onNeedReload: another window's update has taken control). */
const sw = vi.hoisted(() => ({
  needRefresh: false,
  offlineReady: false,
  updateServiceWorker: vi.fn(async (_reloadPage?: boolean) => {}),
  setNeedRefresh: (_: boolean) => {},
  options: {} as { onNeedReload?(): void },
}));

// Overrides the inert mock in tests/unit/setup.ts. Like the real hook, the flags are state, so a set re-renders.
vi.mock('virtual:pwa-register/preact', async () => {
  const { useState } = await import('preact/hooks');
  return {
    useRegisterSW: (options: { onNeedReload?(): void } = {}) => {
      sw.options = options;
      const needRefresh = useState(sw.needRefresh);
      const offlineReady = useState(sw.offlineReady);
      sw.setNeedRefresh = needRefresh[1];
      return { needRefresh, offlineReady, updateServiceWorker: sw.updateServiceWorker };
    },
  };
});

// jsdom can't reload the page, and location.reload can't be stubbed: the app reloads through this seam. The hold
// (requestReload, releaseHeldReload) stays real, and PwaPrompts hands it this spy.
vi.mock('../../src/lib/offline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/offline')>();
  return { ...actual, reloadPage: vi.fn() };
});

/** Gives jsdom a navigator.serviceWorker: `controller` set means a service worker controls the page. */
function withServiceWorker(controller: object | null): EventTarget & { controller: object | null } {
  const container = Object.assign(new EventTarget(), { controller });
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: container });
  return container;
}

const makeStore = () => createProgressStore(new MemoryStorage());

function renderIn(store: ProgressStore = makeStore()) {
  return render(<ProgressContext.Provider value={store}><PwaPrompts /><ToastHost /></ProgressContext.Provider>);
}

const host = () => screen.getByRole('status');
const goOffline = () => act(() => { window.dispatchEvent(new Event('offline')); });

beforeEach(() => {
  vi.useFakeTimers();
  clearToasts();
  sw.needRefresh = false;
  sw.offlineReady = false;
  sw.updateServiceWorker.mockClear();
  sw.options = {};
  vi.mocked(reloadPage).mockClear();
  withServiceWorker({});   // controlled, unless a test says otherwise
  location.hash = '#/quiz';
});

afterEach(() => {
  clearToasts();
  vi.useRealTimers();
  delete (navigator as { serviceWorker?: unknown }).serviceWorker;
  location.hash = '#/';
  releaseHeldReload(() => {});   // no held reload carries into the next test
});

describe('PwaPrompts: offline ready', () => {
  it('says "Ready to use offline." and leaves by itself after the usual time', () => {
    sw.offlineReady = true;
    renderIn();
    expect(host().textContent).toBe(READY);
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull();
    act(() => { vi.advanceTimersByTime(5_200); });
    expect(host().textContent).toBe('');
  });

  it('says nothing while the app is not yet cached', () => {
    renderIn();
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(host().textContent).toBe('');
  });

  it('is mounted by the app shell', () => {
    sw.offlineReady = true;
    resetContentCache();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    try {
      render(<App store={makeStore()} />);
      expect(screen.getByRole('status').textContent).toBe(READY);
    } finally {
      vi.unstubAllGlobals();
      resetContentCache();
    }
  });
});

describe('PwaPrompts: a new version', () => {
  it('offers Reload, which updates the service worker, and waits for the trainee', () => {
    sw.needRefresh = true;
    renderIn();
    expect(host().textContent).toContain(UPDATE);
    act(() => { vi.advanceTimersByTime(10 * 60_000); });   // no time limit
    expect(host().textContent).toContain(UPDATE);
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(sw.updateServiceWorker).toHaveBeenCalledWith(true);
  });

  it('can be dismissed, and stays dismissed through route changes', () => {
    sw.needRefresh = true;
    renderIn();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    act(() => { vi.advanceTimersByTime(200); });
    expect(host().textContent).toBe('');
    act(() => navigate('/notes'));
    act(() => navigate('/'));
    expect(host().textContent).toBe('');
    expect(sw.updateServiceWorker).not.toHaveBeenCalled();
  });

  it('shows nothing during a run, and shows as soon as the route leaves it', () => {
    location.hash = '#/run';
    sw.needRefresh = true;
    renderIn();
    expect(host().textContent).toBe('');
    act(() => navigate('/run/step'));
    expect(host().textContent).toBe('');
    act(() => navigate('/'));
    expect(host().textContent).toContain(UPDATE);
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
  });

  it('found during a run, waits for the run to end', () => {
    location.hash = '#/run';
    renderIn();
    act(() => sw.setNeedRefresh(true));
    expect(host().textContent).toBe('');
    act(() => navigate('/debrief/x'));
    expect(host().textContent).toContain(UPDATE);
  });

  it('goes when a run starts, and comes back when it ends', () => {
    sw.needRefresh = true;
    renderIn();
    expect(host().textContent).toContain(UPDATE);
    act(() => navigate('/run'));
    act(() => { vi.advanceTimersByTime(200); });
    expect(host().textContent).toBe('');
    act(() => navigate('/quiz'));
    act(() => { vi.advanceTimersByTime(200); });
    expect(host().textContent).toContain(UPDATE);
    act(() => { vi.advanceTimersByTime(10 * 60_000); });
    expect(host().textContent).toContain(UPDATE);
  });

  it('gives way at once to a newer toast (an Undo, a save failure) and comes back once it has gone', () => {
    sw.needRefresh = true;
    renderIn();
    expect(host().textContent).toContain(UPDATE);
    const undo = vi.fn();
    act(() => { toast('Quiz discarded.', { label: 'Undo', run: undo }, { ms: 8_000 }); });
    expect(host().textContent).toContain('Quiz discarded.');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(undo).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(200); });
    expect(host().textContent).toContain(UPDATE);

    act(() => { toast(SAVE_ERROR); });
    expect(host().textContent).toBe(SAVE_ERROR);
    act(() => { vi.advanceTimersByTime(10_200); });
    expect(host().textContent).toContain(UPDATE);
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
    expect(sw.updateServiceWorker).not.toHaveBeenCalled();
  });

  it('reloads anyway when no new worker has taken over 3 s after Reload', () => {
    sw.needRefresh = true;
    renderIn();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(sw.updateServiceWorker).toHaveBeenCalledWith(true);
    act(() => { vi.advanceTimersByTime(2_900); });
    expect(reloadPage).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(200); });
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });

  it('reloads once as the new worker takes over, also in a first session the register hook leaves alone', () => {
    sw.needRefresh = true;
    const container = withServiceWorker({});
    renderIn();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    act(() => { vi.advanceTimersByTime(500); });
    expect(reloadPage).not.toHaveBeenCalled();
    act(() => { container.dispatchEvent(new Event('controllerchange')); });
    expect(reloadPage).toHaveBeenCalledTimes(1);
    act(() => { container.dispatchEvent(new Event('controllerchange')); });   // a later change: the listener is gone
    act(() => { vi.advanceTimersByTime(10_000); });                            // and the fallback was cancelled
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });
});

// Spec §10: an update is held "until no run is active". Every reload the trainee didn't press for waits for the run.
describe('PwaPrompts: automatic reloads wait for the run', () => {
  it("holds the reload another window's update asks for during a run, and reloads once the route leaves it", () => {
    location.hash = '#/run';
    renderIn();
    act(() => sw.options.onNeedReload?.());
    expect(reloadPage).not.toHaveBeenCalled();
    expect(reloadHeld()).toBe(true);
    act(() => navigate('/'));
    expect(reloadPage).toHaveBeenCalledTimes(1);
    expect(reloadHeld()).toBe(false);
    act(() => navigate('/quiz'));
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });

  it("reloads at once for another window's update off a run", () => {
    renderIn();
    act(() => sw.options.onNeedReload?.());
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });

  it('holds the reload as the new worker takes over, should a run have started since Reload', () => {
    sw.needRefresh = true;
    const container = withServiceWorker({});
    renderIn();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    act(() => navigate('/run'));
    act(() => { container.dispatchEvent(new Event('controllerchange')); });
    act(() => { vi.advanceTimersByTime(10_000); });   // the fallback was cancelled, and holds nothing more
    expect(reloadPage).not.toHaveBeenCalled();
    act(() => navigate('/debrief/r1'));
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });

  it("holds Reload's 3 s fallback during a run", () => {
    sw.needRefresh = true;
    renderIn();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    act(() => navigate('/run'));
    act(() => { vi.advanceTimersByTime(3_100); });
    expect(reloadPage).not.toHaveBeenCalled();
    act(() => navigate('/'));
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });
});

describe('PwaPrompts: offline', () => {
  it('says so the first time the phone goes offline, once only, and remembers it', () => {
    const store = makeStore();
    renderIn(store);
    goOffline();
    expect(host().textContent).toBe(OFFLINE);
    expect(store.get().flags.offlineToastShown).toBe(true);
    act(() => { vi.advanceTimersByTime(5_200); });   // the usual time, then gone
    expect(host().textContent).toBe('');
    goOffline();
    expect(host().textContent).toBe('');
  });

  it('says nothing while no service worker controls the page, and keeps the once for when one does', () => {
    const container = withServiceWorker(null);
    const store = makeStore();
    renderIn(store);
    goOffline();
    expect(host().textContent).toBe('');
    expect(store.get().flags.offlineToastShown).toBe(false);
    container.controller = {};   // the worker has claimed the page
    goOffline();
    expect(host().textContent).toBe(OFFLINE);
    expect(store.get().flags.offlineToastShown).toBe(true);
  });

  it('says nothing where there is no service worker at all (blocked or unsupported)', () => {
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;
    const store = makeStore();
    renderIn(store);
    goOffline();
    expect(host().textContent).toBe('');
    expect(store.get().flags.offlineToastShown).toBe(false);
  });

  it('says nothing on a later visit once it has been shown', () => {
    const store = makeStore();
    store.update((p) => ({ ...p, flags: { offlineToastShown: true } }));
    renderIn(store);
    goOffline();
    expect(host().textContent).toBe('');
  });

  it('stops listening once unmounted', () => {
    const store = makeStore();
    const { unmount } = renderIn(store);
    unmount();
    goOffline();
    expect(store.get().flags.offlineToastShown).toBe(false);
  });
});
