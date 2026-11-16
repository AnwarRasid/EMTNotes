// Whether the app is saved for offline use: a service worker controls this page, so its precache serves the app
// and its content with no connection. Settings shows it, and the offline toast waits for it. And the page reloads an
// update makes: the trainee's own Reload goes at once, but any reload they didn't press for waits for the run.
import { isRunRoute, matchRoute } from '../app/routes';

/** True when a service worker controls the page. False with none, where there is no service worker API (an
 *  insecure origin, some private modes) or where reaching it throws. Uses the global navigator unless given one. */
export function offlineReady(nav?: Navigator): boolean {
  try {
    const n = nav ?? (typeof navigator === 'undefined' ? undefined : navigator);
    return !!n?.serviceWorker?.controller;
  } catch {
    return false;
  }
}

/** Reloads the page. A seam: tests can't stub location.reload, which jsdom makes unforgeable. */
export function reloadPage(): void {
  location.reload();
}

/** A reload asked for while a run was on screen, waiting for the route to leave it. One flag for the page: however
 *  many ask, the page reloads once. */
let held = false;

const onRun = () => isRunRoute(matchRoute(location.hash).path);

/**
 * A reload the trainee didn't press for: another window's update taking control, or the new worker taking over
 * after Reload. Spec §10 holds an update "until no run is active", so during a run this only holds it, and
 * releaseHeldReload reloads once the route has left the run. Anywhere else it reloads now.
 * Callers pass the reload (reloadPage), so a test's mock of this module's seam is the one called.
 */
export function requestReload(reload: () => void = reloadPage): void {
  if (onRun()) {
    held = true;
    return;
  }
  reload();
}

/** Reloads if a reload is held and no run is on screen. PwaPrompts calls it whenever the route is off a run. */
export function releaseHeldReload(reload: () => void = reloadPage): void {
  if (!held || onRun()) return;
  held = false;
  reload();
}

/** Whether a reload is waiting for the run to end. */
export function reloadHeld(): boolean {
  return held;
}
