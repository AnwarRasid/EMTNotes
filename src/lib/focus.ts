// Where focus goes when the shell moves it: on a route change, or when the control holding focus goes away
// (a toast closing, the corrupt banner closing). Without this, focus falls to <body> and a screen reader or
// keyboard user loses their place.

/** Whether `el` has focus its user can see: it matches :focus-visible. Chromium and WebKit match it after a key, and
 *  not for focus a script moves after a tap or a click, so it tells a keyboard user from a touch or mouse one.
 *  Where the selector isn't supported, any focus counts. */
export function hasVisibleFocus(el: EventTarget | null): boolean {
  if (!(el instanceof Element)) return false;
  try {
    return el.matches(':focus-visible');
  } catch {
    return true;
  }
}

/** Focuses the current screen's h1 (else its <main>) without scrolling. An element the shell had to make
 *  focusable gets tabindex="-1" and data-route-focus, so CSS hides the ring on it and nowhere else. */
export function focusScreen(main?: HTMLElement | null): void {
  const root = main ?? document.querySelector<HTMLElement>('main');
  const target = root?.querySelector<HTMLElement>('h1') ?? root;
  if (!target) return;
  if (!target.hasAttribute('tabindex')) {
    target.setAttribute('tabindex', '-1');
    target.setAttribute('data-route-focus', '');
  }
  target.focus({ preventScroll: true });
}
