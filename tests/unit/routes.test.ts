import { describe, it, expect } from 'vitest';
import { ROUTES, back, isRunRoute, matchRoute, navigate } from '../../src/app/routes';

/** Resolves on the next hashchange (history.back() traverses asynchronously). */
const nextHashChange = () => new Promise<void>((resolve) => window.addEventListener('hashchange', () => resolve(), { once: true }));

describe('matchRoute', () => {
  it('reads an empty hash and #/ as today', () => {
    expect(matchRoute('').def.name).toBe('today');
    expect(matchRoute('#/').def.name).toBe('today');
    expect(matchRoute('#/').path).toBe('/');
  });

  it('matches a notes section with its section param', () => {
    const m = matchRoute('#/notes/s07');
    expect(m.def.name).toBe('notesSection');
    expect(m.params.section).toBe('s07');
    expect(m.params.anchor).toBeUndefined();
  });

  it('splits the anchor param and the query from the path', () => {
    const m = matchRoute('#/notes/s01/delicate-spine?b=3');
    expect(m.def.name).toBe('notesSection');
    expect(m.params).toEqual({ section: 's01', anchor: 'delicate-spine' });
    expect(m.query).toEqual({ b: '3' });
    expect(m.path).toBe('/notes/s01/delicate-spine');
  });

  it('marks the quiz session as a focus route', () => {
    expect(matchRoute('#/quiz/session').def.focus).toBe(true);
  });

  it('gives notFound for an unknown path, on the Today tab and scene', () => {
    const m = matchRoute('#/nope');
    expect(m.def.name).toBe('notFound');
    expect(m.def.tab).toBe('today');
    expect(m.def.focus).toBe(false);
    expect(m.def.scene).toBe('today');
  });

  it('follows the route table for every row', () => {
    const table: [string, string, string | null, boolean, string][] = [
      ['#/', 'today', 'today', false, 'today'],
      ['#/settings', 'settings', 'today', false, 'quiet'],
      ['#/pam', 'pam', 'pam', false, 'today'],
      ['#/quiz', 'quiz', 'quiz', false, 'quiet'],
      ['#/quiz/setup', 'quizSetup', 'quiz', false, 'quiet'],
      ['#/quiz/session', 'quizSession', null, true, 'quiet'],
      ['#/quiz/result', 'quizResult', null, true, 'quiet'],
      ['#/notes', 'notes', 'notes', false, 'quiet'],
      ['#/notes/s01/a', 'notesSection', null, true, 'quiet'],
      ['#/pam/start', 'runStart', null, true, 'run'],
      ['#/run', 'run', null, true, 'run'],
      ['#/debrief/run-1', 'debrief', null, true, 'quiet'],
    ];
    for (const [hash, name, tab, focus, scene] of table) {
      const { def } = matchRoute(hash);
      expect({ hash, name: def.name, tab: def.tab, focus: def.focus, scene: def.scene }).toEqual({ hash, name, tab, focus, scene });
    }
  });

  it('keeps notFound out of ROUTES, so routes appended later still match', () => {
    expect(ROUTES.some((r) => r.name === 'notFound')).toBe(false);
  });

  it('ignores a trailing slash, accepts a hash without its leading slash, and decodes params', () => {
    expect(matchRoute('#/quiz/').def.name).toBe('quiz');
    expect(matchRoute('#quiz').def.name).toBe('quiz');
    expect(matchRoute('#/notes/s01/two%20words').params.anchor).toBe('two words');
    expect(matchRoute('#/notes/s01/bad%E0').params.anchor).toBe('bad%E0');
  });

  it('matches Run start with its drill query, the run, and a debrief with its run id (Task 12)', () => {
    const start = matchRoute('#/pam/start?drill=rapid-body-survey');
    expect(start.def.name).toBe('runStart');
    expect(start.def.focus).toBe(true);
    expect(start.query.drill).toBe('rapid-body-survey');
    expect(matchRoute('#/pam/start').query).toEqual({});

    const run = matchRoute('#/run');
    expect(run.def.name).toBe('run');
    expect(run.def.scene).toBe('run');

    const debrief = matchRoute('#/debrief/run-1');
    expect(debrief.def.name).toBe('debrief');
    expect(debrief.params.id).toBe('run-1');
    expect(matchRoute('#/debrief').def.name).toBe('notFound');   // a debrief always names its run
  });

  it('gives notFound when a path has extra segments', () => {
    expect(matchRoute('#/notes/s01/a/b').def.name).toBe('notFound');
    expect(matchRoute('#/quiz/session/x').def.name).toBe('notFound');
  });
});

describe('isRunRoute', () => {
  it('is true for /run and false for /quiz', () => {
    expect(isRunRoute('/run')).toBe(true);
    expect(isRunRoute('/quiz')).toBe(false);
  });
});

// These run in order: the first needs a history this app has not navigated yet.
describe('navigate and back', () => {
  it('back() with no in-app history replaces the entry with the fallback, without leaving the app', () => {
    const length = history.length;
    back('/notes');
    expect(location.hash).toBe('#/notes');
    expect(history.length).toBe(length);
  });

  it('navigate() pushes an entry and fires hashchange', () => {
    const length = history.length;
    let fired = 0;
    const on = () => { fired += 1; };
    window.addEventListener('hashchange', on);
    navigate('/quiz');
    window.removeEventListener('hashchange', on);
    expect(location.hash).toBe('#/quiz');
    expect(history.length).toBe(length + 1);
    expect(fired).toBe(1);
  });

  it('navigate() with replace keeps the history length', () => {
    const length = history.length;
    navigate('/quiz/setup', { replace: true });
    expect(location.hash).toBe('#/quiz/setup');
    expect(history.length).toBe(length);
  });

  it('back() after an in-app navigation goes back in history', async () => {
    navigate('/quiz/session');
    const changed = nextHashChange();
    back('/quiz');
    await changed;
    expect(location.hash).toBe('#/quiz/setup');
  });

  it('navigate() to the route already showing adds no entry, comparing normalised paths', () => {
    navigate('/settings');   // a push drops the forward entry the back() test left behind
    history.replaceState(history.state, '', location.pathname);   // an empty hash is '/'
    expect(location.hash).toBe('');
    const length = history.length;
    navigate('/');
    expect(history.length).toBe(length);

    navigate('/notes/s01/two words');
    const after = history.length;
    expect(after).toBe(length + 1);
    navigate('/notes/s01/two words');
    navigate('/notes/s01/two%20words');
    navigate('/notes/s01/two words/');
    expect(history.length).toBe(after);
  });
});
