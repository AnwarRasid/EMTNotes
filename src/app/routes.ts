// The hash router: the route table, matching, navigation, and a hook that follows the hash.
// Hash routes (#/quiz) work under any GitHub Pages subpath and offline, with no server rewrites.
import { useEffect, useMemo, useState } from 'preact/hooks';

export type TabId = 'today' | 'pam' | 'quiz' | 'notes';
export type SceneVariant = 'today' | 'run' | 'quiet';
export type RouteName = 'today' | 'settings' | 'pam' | 'quiz' | 'quizSetup' | 'quizSession' | 'quizResult'
  | 'notes' | 'notesSection' | 'runStart' | 'run' | 'debrief' | 'notFound';
export interface RouteDef { pattern: string; name: RouteName; tab: TabId | null; focus: boolean; scene: SceneVariant }
/** `path` is the normalised path without the query, say '/notes/s01/delicate-spine'. */
export interface RouteMatch { def: RouteDef; path: string; params: Record<string, string>; query: Record<string, string> }

/** Matched in order. A pattern segment ':x' is a param, and ':x?' an optional one (last segment only). notFound is not
 *  in this list, so appended routes still match. Plan 2 appended Run start ('/pam/start', and '?drill={stepId}' for a
 *  drill), the run and a run's debrief. */
export const ROUTES: RouteDef[] = [
  { pattern: '/', name: 'today', tab: 'today', focus: false, scene: 'today' },
  { pattern: '/settings', name: 'settings', tab: 'today', focus: false, scene: 'quiet' },
  { pattern: '/pam', name: 'pam', tab: 'pam', focus: false, scene: 'today' },
  { pattern: '/quiz', name: 'quiz', tab: 'quiz', focus: false, scene: 'quiet' },
  { pattern: '/quiz/setup', name: 'quizSetup', tab: 'quiz', focus: false, scene: 'quiet' },
  { pattern: '/quiz/session', name: 'quizSession', tab: null, focus: true, scene: 'quiet' },
  { pattern: '/quiz/result', name: 'quizResult', tab: null, focus: true, scene: 'quiet' },
  { pattern: '/notes', name: 'notes', tab: 'notes', focus: false, scene: 'quiet' },
  { pattern: '/notes/:section/:anchor?', name: 'notesSection', tab: null, focus: true, scene: 'quiet' },
  { pattern: '/pam/start', name: 'runStart', tab: null, focus: true, scene: 'run' },
  { pattern: '/run', name: 'run', tab: null, focus: true, scene: 'run' },
  { pattern: '/debrief/:id', name: 'debrief', tab: null, focus: true, scene: 'quiet' },
];

const NOT_FOUND: RouteDef = { pattern: '*', name: 'notFound', tab: 'today', focus: false, scene: 'today' };

const segments = (path: string) => path.split('/').filter((s) => s !== '');

function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;   // a malformed escape stays as typed rather than breaking the route
  }
}

function matchPattern(pattern: string, segs: string[]): Record<string, string> | null {
  const parts = segments(pattern);
  const required = parts.filter((p) => !p.endsWith('?')).length;
  if (segs.length < required || segs.length > parts.length) return null;
  const params: Record<string, string> = {};
  for (const [i, part] of parts.entries()) {
    const seg = segs[i];
    if (part.startsWith(':')) {
      if (seg !== undefined) params[part.slice(1).replace(/\?$/, '')] = decode(seg);
    } else if (seg !== part) {
      return null;
    }
  }
  return params;
}

/** Matches a location hash such as '#/notes/s01/delicate-spine?b=12'. An empty hash is '/'. */
export function matchRoute(hash: string): RouteMatch {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const q = raw.indexOf('?');
  const segs = segments(q < 0 ? raw : raw.slice(0, q));
  const path = `/${segs.join('/')}`;
  const query = Object.fromEntries(new URLSearchParams(q < 0 ? '' : raw.slice(q + 1)));
  for (const def of ROUTES) {
    const params = matchPattern(def.pattern, segs);
    if (params) return { def, path, params, query };
  }
  return { def: NOT_FOUND, path, params: {}, query };
}

export function isRunRoute(path: string): boolean {
  return path.startsWith('/run');
}

/** One spelling per route: decoded path segments plus the query, so '' and '#/', or 'two words' and
 *  'two%20words', compare equal. */
function routeKey(hash: string): string {
  const m = matchRoute(hash);
  const query = new URLSearchParams(m.query).toString();
  return segments(m.path).map(decode).join('/') + (query ? `?${query}` : '');
}

// ---- History and scroll ------------------------------------------------------------------------------------
// Each history entry this app reaches carries its depth in history.state, so back() knows whether a step back
// stays inside the app (a deep link or a reload starts at depth 0). Entries made by plain <a href="#/…"> links
// arrive with no state and get stamped on their hashchange.
//
// A new path starts at the top. The reset runs here, on hashchange, before any screen re-renders: a screen
// that scrolls itself on mount (the notes reader to an anchor) runs its effect after this, so it keeps its scroll.
// A query-only change (say ?b=12) keeps the scroll.

const DEPTH_KEY = 'crewLeaderDepth';
let depth = 0;
let shownPath = typeof window === 'undefined' ? '/' : matchRoute(location.hash).path;

function stateDepth(): number | null {
  const s: unknown = history.state;
  const d = typeof s === 'object' && s !== null ? (s as Record<string, unknown>)[DEPTH_KEY] : undefined;
  return typeof d === 'number' ? d : null;
}

function stateWith(d: number): Record<string, unknown> {
  const s: unknown = history.state;
  return { ...(typeof s === 'object' && s !== null ? s : {}), [DEPTH_KEY]: d };
}

function scrollToTop(): void {
  (document.scrollingElement ?? document.documentElement).scrollTop = 0;
}

function onHashChange(): void {
  const path = matchRoute(location.hash).path;
  if (path !== shownPath) {
    shownPath = path;
    scrollToTop();
  }
  const d = stateDepth();
  if (d === null) {
    depth += 1;
    history.replaceState(stateWith(depth), '');
  } else {
    depth = d;
  }
}

if (typeof window !== 'undefined') {
  const d = stateDepth();
  if (d === null) history.replaceState(stateWith(0), '');
  else depth = d;
  window.addEventListener('hashchange', onHashChange);
}

/** Goes to `to`, say '/quiz/session'. pushState and replaceState don't fire hashchange, so this fires it. */
export function navigate(to: string, opts?: { replace?: boolean }): void {
  const url = `#${to}`;
  if (opts?.replace) {
    history.replaceState(stateWith(depth), '', url);
  } else {
    if (routeKey(url) === routeKey(location.hash)) return;
    depth += 1;
    history.pushState(stateWith(depth), '', url);
  }
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

/** history.back() while that stays in the app; otherwise replaces this entry with `fallback`. */
export function back(fallback: string): void {
  if (depth > 0) history.back();
  else navigate(fallback, { replace: true });
}

/** The current route, following hashchange. */
export function useRoute(): RouteMatch {
  const [hash, setHash] = useState(() => location.hash);
  useEffect(() => {
    const sync = () => setHash(location.hash);
    window.addEventListener('hashchange', sync);
    sync();   // catch a change between render and subscribe
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  return useMemo(() => matchRoute(hash), [hash]);
}
