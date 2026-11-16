// The PWA's three prompts (spec §7), as toasts. It renders nothing itself.
// - "Ready to use offline." once the service worker has cached the app: the usual time, then gone.
// - "A new version is ready." with Reload once a new service worker is waiting. It waits for the trainee (no time
//   limit; any newer toast goes ahead of it) and can be dismissed. It never shows during a run: one found then, or
//   showing as a run starts, shows as soon as the route leaves the run.
// - "You're offline. Everything still works." the first time the phone goes offline while a service worker controls
//   the page, ever (flags.offlineToastShown). Before that it would be untrue, so it waits and keeps its once.
// Where service workers are blocked or unsupported, registration fails quietly and none of the three shows.
// Every reload the trainee didn't press for (another window's update taking control; the new worker taking over after
// Reload, or its fallback) goes through requestReload, which holds it during a run (spec §10) until the route leaves.
import { useEffect } from 'preact/hooks';
import { useRegisterSW } from 'virtual:pwa-register/preact';
import { offlineReady, releaseHeldReload, reloadPage, requestReload } from '../lib/offline';
import { useStore } from '../progress/hooks';
import { dismissToast, toast } from '../ui/toast';
import { isRunRoute, useRoute } from './routes';

const READY = 'Ready to use offline.';
const UPDATE = 'A new version is ready.';
const OFFLINE = "You're offline. Everything still works.";

/** How long Reload waits for the new worker to take over (the page then reloads itself) before reloading anyway. */
const RELOAD_FALLBACK_MS = 3_000;

/** Tells the waiting worker to take over, and reloads once it controls the page. The register hook reloads too, but
 *  only for a page that was controlled when it registered (`isUpdate`); a first session, claimed after it
 *  registered, gets no reload from it, so this one is what lands it on the new version. Both in one task make one
 *  navigation. Should no worker take over (none was waiting after all, or the message went astray), reload after
 *  RELOAD_FALLBACK_MS anyway, so the key never does nothing. Both come after the tap, so a run started in between
 *  holds them. */
function reloadIntoUpdate(update: (reloadPage?: boolean) => Promise<void>): void {
  const fallback = setTimeout(() => requestReload(reloadPage), RELOAD_FALLBACK_MS);
  try {
    navigator.serviceWorker?.addEventListener('controllerchange', () => {
      clearTimeout(fallback);
      requestReload(reloadPage);
    }, { once: true });
  } catch {
    // no reachable service worker API: the fallback reloads
  }
  update(true).catch(() => {});   // the fallback covers a failure too
}

export function PwaPrompts(): null {
  const store = useStore();
  const onRun = isRunRoute(useRoute().path);
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [cached],
    updateServiceWorker,
  } = useRegisterSW({
    // Another window's update has taken control of this page too (the hook would reload at once).
    onNeedReload: () => requestReload(reloadPage),
    // Blocked, unsupported or failing: the app still works online, and Settings says it isn't saved for offline use.
    onRegisterError() {},
  });

  // Off a run, a reload held during it goes.
  useEffect(() => {
    if (!onRun) releaseHeldReload(reloadPage);
  }, [onRun]);

  useEffect(() => {
    if (cached) toast(READY);
  }, [cached]);

  useEffect(() => {
    if (!needRefresh || onRun) return;
    let hiding = false;
    const id = toast(UPDATE, { label: 'Reload', run: () => reloadIntoUpdate(updateServiceWorker) }, {
      // Dismissed (or used): done with this update. Taken away for a run: it comes back after.
      onClose: () => { if (!hiding) setNeedRefresh(false); },
    });
    return () => {
      hiding = true;
      dismissToast(id);
    };
  }, [needRefresh, onRun]);

  useEffect(() => {
    const offline = () => {
      if (!offlineReady() || store.get().flags.offlineToastShown) return;
      store.update((p) => ({ ...p, flags: { ...p.flags, offlineToastShown: true } }));
      toast(OFFLINE);
    };
    window.addEventListener('offline', offline);
    return () => window.removeEventListener('offline', offline);
  }, [store]);

  return null;
}
