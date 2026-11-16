// The app shell: the cabin scene, the screen for the route, the tab bar (hidden on focus screens) and the toasts,
// in a 100dvh grid. It also reports how the save loaded and when saving fails or is held back, applies the text size,
// and mounts the PWA prompts (offline ready, a new version, offline).
import type { ComponentType, JSX, Ref, RefObject } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { ProgressContext, useProgress, useStore } from '../progress/hooks';
import { ANOTHER_WINDOW_ERROR, NEWER_VERSION_ERROR, SAVE_ERROR, type ProgressStore, type WriteBlock } from '../progress/store';
import { SESSION_UNSAVABLE_ERROR, SLOT_KEYS, UNSAVABLE_ERROR, type LoadResult } from '../progress/slots';
import { formatSavedAt } from '../lib/format';
import { focusScreen } from '../lib/focus';
import { reloadPage } from '../lib/offline';
import { Secondary } from '../ui/Keys';
import { ToastHost, toast } from '../ui/toast';
import { PwaPrompts } from './PwaPrompts';
import { Scene } from './Scene';
import { TabBar } from './TabBar';
import { useRoute, type RouteMatch, type RouteName } from './routes';
import { Today } from '../today/Today';
import { PamTab } from '../pam/PamTab';
import { QuizTab } from '../quiz/QuizTab';
import { QuizSetup } from '../quiz/QuizSetup';
import { QuizSession } from '../quiz/QuizSession';
import { QuizResult } from '../quiz/QuizResult';
import { NotesTab } from '../notes/NotesTab';
import { SectionReader } from '../notes/SectionReader';
import { Settings } from '../settings/Settings';
import { RunStart } from '../run/RunStart';
import { Run } from '../run/Run';
import { Debrief } from '../run/Debrief';

/** The screen for each route. */
export const SCREENS: Record<RouteName, ComponentType<{ match: RouteMatch }>> = {
  today: Today,
  settings: Settings,
  pam: PamTab,
  quiz: QuizTab,
  quizSetup: QuizSetup,
  quizSession: QuizSession,
  quizResult: QuizResult,
  notes: NotesTab,
  notesSection: SectionReader,
  runStart: RunStart,
  run: Run,
  debrief: Debrief,
  notFound: Today,
};

/** What the trainee is told of a save error: a refusal of what is in memory (it wouldn't load back) as it is, being
 *  said in their words already; any other failure (storage full or blocked, a torn write) in the generic copy. */
const saveErrorCopy = (err: string): string =>
  err === UNSAVABLE_ERROR || err === SESSION_UNSAVABLE_ERROR ? err : SAVE_ERROR;

function announceLoad(r: LoadResult): void {
  if (r.status === 'restored') {
    toast(`Some progress couldn't be read. Your last good save, from ${formatSavedAt(r.savedAt)}, is back.`);
  }
}

export function App({ store }: { store: ProgressStore }): JSX.Element {
  return (
    <ProgressContext.Provider value={store}>
      <Shell />
    </ProgressContext.Provider>
  );
}

function Shell(): JSX.Element {
  const store = useStore();
  const match = useRoute();
  const { def } = match;
  const Screen = SCREENS[def.name];
  const textSize = useProgress((p) => p.settings.textSize);
  const [corrupt, setCorrupt] = useState(() => store.lastLoad().status === 'corrupt');
  const block = useWriteBlock(store);
  const reload = block === 'conflict' || block === 'newer' ? block : null;
  const shown = reload ?? (corrupt ? 'corrupt' : null);   // the banner on screen, if any
  const appRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const bannerRef = useRef<HTMLDivElement>(null);
  const bannerHadFocus = useRef(false);

  useEffect(() => { document.documentElement.dataset.textSize = textSize; }, [textSize]);
  useEffect(() => { announceLoad(store.lastLoad()); }, [store]);
  useOtherWindowSaves(store);
  useSaveErrorToasts(store);
  useRouteFocus(match.path, mainRef);
  useFocusAfterBanner(corrupt, bannerHadFocus, mainRef);
  useBannerHeight(shown, appRef, bannerRef);

  const closeBanner = () => {
    // Focus on <body> counts as the banner's too: WebKit doesn't focus a tapped <button>, and VoiceOver must
    // still land on the h1 rather than wherever the page left it.
    const active = document.activeElement;
    bannerHadFocus.current = active === null || active === document.body || active.closest('.banner') !== null;
    setCorrupt(false);
  };
  const tryAgain = () => {
    const r = store.tryAgain();
    // Unreachable storage is no answer either: the unread save is still on disk and saves stay blocked.
    if (r.status === 'corrupt' || (r.status === 'fresh' && !r.available)) {
      toast("It still couldn't be read.");
      return;
    }
    closeBanner();   // a newer version's save: the Reload banner takes its place and says so
    if (r.status === 'fresh') toast("There's no saved progress on this phone now.");
    else if (r.status === 'ok') toast('Your progress is back.');
    else if (r.status === 'restored') announceLoad(r);
  };
  // The Reload banner takes the corrupt banner's place for good (another window saved): close that one as its own
  // keys would, so focus on them goes to the screen rather than <body>.
  useEffect(() => { if (reload && corrupt) closeBanner(); }, [reload]);
  const startFresh = () => {
    store.startFresh();
    const block = store.writeBlock();
    if (block === 'unavailable') {   // nothing could be cleared, so the unread save is still there
      toast("Storage isn't available on this phone, so nothing was cleared.");
      return;
    }
    // Its own check refused what is in memory, so nothing was cleared and the banner stays. Say why each time (the
    // save-error toast says it once, and the same message showing isn't queued twice).
    if (block === 'corrupt') {
      const err = store.lastSaveError();
      if (err !== null) toast(saveErrorCopy(err));
      return;
    }
    closeBanner();
    // Another window saved since the load: nothing was cleared, and the Reload banner says why.
    if (block === null) toast('Started fresh.');
  };

  return (
    <div class={`app ${def.focus ? 'app-focus' : 'app-tabs'}${shown ? ' has-banner' : ''}`} ref={appRef}>
      <Scene variant={def.scene} />
      <main class="app-main" ref={mainRef}>
        {reload ? <ReloadBanner block={reload} bannerRef={bannerRef} />
          : corrupt && <CorruptBanner onTryAgain={tryAgain} onStartFresh={startFresh} bannerRef={bannerRef} />}
        {/* Keyed by path, so /notes/s01 to /notes/s02 mounts a fresh screen; a query-only change keeps it. */}
        <Screen key={match.path} match={match} />
      </main>
      {!def.focus && <TabBar active={def.tab} />}
      <ToastHost />
      <PwaPrompts />
    </div>
  );
}

/** No good save to fall back on (spec §7). Start fresh lives only here: it wipes both slots, so offering it
 *  for any other state could destroy a save that another window or a newer version can still read. */
function CorruptBanner({ onTryAgain, onStartFresh, bannerRef }:
  { onTryAgain(): void; onStartFresh(): void; bannerRef: Ref<HTMLDivElement> }): JSX.Element {
  return (
    <div class="banner panel" ref={bannerRef}>
      <p class="banner-msg" role="alert">Some progress couldn't be read.</p>
      <p class="banner-sub">Start fresh clears it from this phone.</p>
      <div class="banner-keys">
        <Secondary onClick={onTryAgain}>Try again</Secondary>
        <Secondary onClick={onStartFresh}>Start fresh</Secondary>
      </div>
    </div>
  );
}

/**
 * Saves are held back until a reload: another window saved newer progress, or a newer version of the app saved.
 * Nothing done in this window is kept from then on, so it says so for as long as that holds: no Dismiss, and it
 * outlives every route. Reload is the only way on. (One toast was too easy to wave away: a stray tap on its ✕,
 * and a whole session after it was lost without a word.)
 */
function ReloadBanner({ block, bannerRef }: { block: 'conflict' | 'newer'; bannerRef: Ref<HTMLDivElement> }): JSX.Element {
  return (
    <div class="banner panel" ref={bannerRef}>
      <p class="banner-msg" role="alert">{block === 'newer' ? NEWER_VERSION_ERROR : ANOTHER_WINDOW_ERROR}</p>
      <p class="banner-sub">Changes made here aren't saved.</p>
      <div class="banner-keys">
        <Secondary onClick={reloadPage}>Reload</Secondary>
      </div>
    </div>
  );
}

/** The store's write block, kept current: it changes on a save, a recheck, Try again and Start fresh. */
function useWriteBlock(store: ProgressStore): WriteBlock {
  const [block, setBlock] = useState(() => store.writeBlock());
  useEffect(() => {
    const sync = () => setBlock(store.writeBlock());
    sync();
    return store.subscribe(sync);
  }, [store]);
  return block;
}

/** The browser fires `storage` in every other window of the origin when one saves (never in the one saving). A save
 *  slot changing, or the whole store cleared (key null), means another window saved: the store checks at once, so
 *  the Reload banner shows before any work here is lost, not at this window's next save.
 *  A page coming back gets no storage event for saves made while it was away: an Android tab restored from the
 *  back-forward cache (pageshow), or one brought back from the background (visibilitychange to visible). The store
 *  checks then too, so the Reload banner shows before the first change. The run's own lifecycle also listens to
 *  visibilitychange, to resume its clock; its save checks the disk first, so either order finds a conflict. */
function useOtherWindowSaves(store: ProgressStore): void {
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || (SLOT_KEYS as readonly string[]).includes(e.key)) store.recheck();
    };
    const onShow = () => store.recheck();
    const onVisibility = () => { if (document.visibilityState === 'visible') store.recheck(); };
    window.addEventListener('storage', onStorage);
    window.addEventListener('pageshow', onShow);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('pageshow', onShow);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [store]);
}

/** Toasts a save failure once, not on every update that fails again the same way (saveErrorCopy). Once a save works
 *  again (the error clears), the next failure toasts afresh. Saves held back for a reload get the Reload banner
 *  instead. */
function useSaveErrorToasts(store: ProgressStore): void {
  useEffect(() => {
    let shown: string | null = null;   // the copy toasted for the failure going on now
    const check = () => {
      const err = store.lastSaveError();
      if (err === null) {
        shown = null;
        return;
      }
      if (err === ANOTHER_WINDOW_ERROR || err === NEWER_VERSION_ERROR) return;
      const copy = saveErrorCopy(err);
      if (copy === shown) return;
      shown = copy;
      toast(copy);
    };
    check();
    return store.subscribe(check);
  }, [store]);
}

/**
 * While a banner shows, `.app` carries its height as --banner-h (it has has-banner from the render): the toasts on a
 * focus screen sit that much lower, under the banner, and the run screen gives that much of its fixed height up, so
 * the composer stays on screen (ruling S14). Followed through ResizeObserver where there is one (a text size change,
 * a rotation, a wrapped message); measured once otherwise. `shown` names the banner, as each is its own element.
 */
function useBannerHeight(shown: string | null, app: RefObject<HTMLDivElement>, banner: RefObject<HTMLDivElement>): void {
  useLayoutEffect(() => {
    const appEl = app.current;
    const el = banner.current;
    if (shown === null || !appEl || !el) return;
    const measure = () => appEl.style.setProperty('--banner-h', `${el.getBoundingClientRect().height}px`);
    measure();
    const watch = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    watch?.observe(el);
    return () => {
      watch?.disconnect();
      appEl.style.removeProperty('--banner-h');
    };
  }, [shown]);
}

/** On a new path, focus the new screen's h1 so a screen reader announces it. Focus never scrolls: the router
 *  already put a new path at the top, before render, and a screen may have scrolled itself since. */
function useRouteFocus(path: string, main: RefObject<HTMLElement>): void {
  const last = useRef(path);
  useEffect(() => {
    if (last.current === path) return;
    last.current = path;
    // The new screen's own mount effects ran first. If one focused a control (a search box), keep it. <main>
    // itself (an earlier fallback) and the banner (it outlives routes) are not the new screen's own focus.
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && active !== main.current
      && !active.closest('.banner') && main.current?.contains(active)) return;
    // Focus in a toast stays there: the Undo of "Run replaced.", raised by the key that opened this screen (Plan 3
    // Task 7 review, I1). The toasts outlive routes, and one closing with focus inside hands it to the screen's h1.
    if (active instanceof HTMLElement && active.closest('.toasts')) return;
    focusScreen(main.current);
  }, [path]);
}

/** When the banner closes with focus inside it, its button is gone: hand focus to the screen, not <body>.
 *  Focus that was elsewhere, or has moved on since, stays where it is. */
function useFocusAfterBanner(corrupt: boolean, hadFocus: RefObject<boolean>, main: RefObject<HTMLElement>): void {
  const was = useRef(corrupt);
  useEffect(() => {
    if (was.current && !corrupt && hadFocus.current) {
      hadFocus.current = false;
      const active = document.activeElement;
      if (active === null || active === document.body) focusScreen(main.current);
    }
    was.current = corrupt;
  }, [corrupt]);
}
