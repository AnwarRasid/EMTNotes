// Task 13: the content loader (fetch, validate, memoise) and the useContent hook every screen reads through.
import { renderHook, act, waitFor } from '@testing-library/preact';
import * as v from 'valibot';
import questionsDoc from '../../public/data/questions.json';
import overridesDoc from '../../public/data/overrides.json';
import notesDoc from '../../public/data/notes.json';
import stepsDoc from '../../public/data/steps.json';
import caseIndex from '../../public/data/cases/index.json';
import {
  ContentError, contentErrorCopy, loadContent, loadJson, primeContent, resetContentCache, useContent,
} from '../../src/data/load';
import { mergeQuestions, questionLabel } from '../../src/data/questions';
import { OverridesDocSchema, RawQuestionsDocSchema, StepsDocSchema } from '../../src/data/schema';

const BASE = import.meta.env.BASE_URL;
const path = (file: string) => `${BASE}data/${file}.json`;
/** cases/index.json and the 11 case files, by their app paths (Task 12; Plan 3 Task 3 adds three). */
const CASE_FILES: Record<string, unknown> = Object.fromEntries(
  Object.entries(import.meta.glob<unknown>('../../public/data/cases/*.json', { eager: true, import: 'default' }))
    .map(([file, json]) => [`${BASE}data/cases/${file.split('/').pop()}`, json]),
);
const FILES: Record<string, unknown> = {
  [path('questions')]: questionsDoc,
  [path('overrides')]: overridesDoc,
  [path('notes')]: notesDoc,
  [path('steps')]: stepsDoc,
  ...CASE_FILES,
};

/** A fetch that serves the real content files at their app paths and 404s anything else. */
const fileFetch = () => vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  return url in FILES ? new Response(JSON.stringify(FILES[url]), { status: 200 }) : new Response('Not found', { status: 404 });
});
/** A fetch that fails the way a phone with no signal does. */
const offlineFetch = () => vi.fn(async (_input: RequestInfo | URL): Promise<Response> => { throw new TypeError('Failed to fetch'); });
const respond = (body: string, status = 200) => vi.fn(async (_input: RequestInfo | URL) => new Response(body, { status }));

async function failure(p: Promise<unknown>): Promise<ContentError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ContentError);
    return e as ContentError;
  }
  throw new Error('expected the load to fail');
}

const realQuestions = () => mergeQuestions(v.parse(RawQuestionsDocSchema, questionsDoc), v.parse(OverridesDocSchema, overridesDoc));

afterEach(() => {
  resetContentCache();
  vi.unstubAllGlobals();
});

describe('loadJson', () => {
  test('returns the parsed file', async () => {
    const steps = await loadJson(path('steps'), StepsDocSchema, fileFetch());
    expect(steps.steps).toHaveLength(19);
  });

  test('a rejected fetch is a network error', async () => {
    const err = await failure(loadJson(path('steps'), StepsDocSchema, offlineFetch()));
    expect(err.kind).toBe('network');
    expect(err).toBeInstanceOf(Error);
  });

  test('a 404 is a network error', async () => {
    const err = await failure(loadJson(path('steps'), StepsDocSchema, respond('Not found', 404)));
    expect(err.kind).toBe('network');
    expect(err.message).toContain('404');
  });

  test('JSON that fails the schema is invalid', async () => {
    const err = await failure(loadJson(path('steps'), StepsDocSchema, respond(JSON.stringify({ contentVersion: 'x', steps: 'none' }))));
    expect(err.kind).toBe('invalid');
    expect(err.message).toContain(path('steps'));
  });

  test('a body that is not JSON is invalid', async () => {
    const err = await failure(loadJson(path('steps'), StepsDocSchema, respond('{"contentVersion": "x", "steps": [')));
    expect(err.kind).toBe('invalid');
  });
});

describe('loadContent', () => {
  test("'questions' fetches questions.json and overrides.json once, then serves the memo", async () => {
    const f = fileFetch();
    const first = await loadContent('questions', f);
    const second = await loadContent('questions', f);
    expect(f).toHaveBeenCalledTimes(2);
    expect(f.mock.calls.map(c => String(c[0])).sort()).toEqual([path('overrides'), path('questions')]);
    expect(second).toBe(first);
    expect(first).toHaveLength(407);
  });

  test('calls made while a load is in flight share it', async () => {
    const f = fileFetch();
    const [a, b] = await Promise.all([loadContent('steps', f), loadContent('steps', f)]);
    expect(f).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  test('after resetContentCache() it fetches again', async () => {
    const f = fileFetch();
    await loadContent('questions', f);
    resetContentCache();
    await loadContent('questions', f);
    expect(f).toHaveBeenCalledTimes(4);
  });

  test('notes and steps load from their own files', async () => {
    const f = fileFetch();
    expect((await loadContent('notes', f)).sections).toHaveLength(20);
    expect((await loadContent('steps', f)).steps).toHaveLength(19);
    expect(f.mock.calls.map(c => String(c[0]))).toEqual([path('notes'), path('steps')]);
  });

  test('a failed overrides.json fails the question bank', async () => {
    const real = fileFetch();
    const f = vi.fn(async (input: RequestInfo | URL) =>
      String(input) === path('overrides') ? new Response('Not found', { status: 404 }) : real(input));
    expect((await failure(loadContent('questions', f))).kind).toBe('network');
  });

  test("'cases' fetches the index first, then every case file, and gives the 11 cases in index order", async () => {
    const f = fileFetch();
    const cases = await loadContent('cases', f);
    expect(cases).toHaveLength(11);
    expect(cases.map(c => c.id)).toEqual(caseIndex.cases.map(e => e.id));
    expect(cases[1]).toMatchObject({ id: 'hypo-hougang-01', complaint: 'Giddiness', area: 'Hougang' });
    expect(f.mock.calls.map(c => String(c[0])))
      .toEqual([path('cases/index'), ...caseIndex.cases.map(e => `${BASE}data/${e.file}`)]);
  });

  test("a case file whose id differs from its index entry fails 'cases' as invalid", async () => {
    const real = fileFetch();
    const hypo = path('cases/hypo-hougang-01');
    const f = vi.fn(async (input: RequestInfo | URL) => String(input) === hypo
      ? new Response(JSON.stringify({ ...(CASE_FILES[hypo] as object), id: 'hypo-hougang-02' }), { status: 200 })
      : real(input));
    const err = await failure(loadContent('cases', f));
    expect(err.kind).toBe('invalid');
    expect(err.message).toContain(hypo);
    expect(err.message).toContain('hypo-hougang-02');
  });

  test("a case file that won't fetch fails 'cases' as a network error", async () => {
    const real = fileFetch();
    const f = vi.fn(async (input: RequestInfo | URL) =>
      String(input) === path('cases/fall-yishun-01') ? new Response('Not found', { status: 404 }) : real(input));
    expect((await failure(loadContent('cases', f))).kind).toBe('network');
  });
});

describe('useContent', () => {
  test('loading, then error, then retry(), then ready', async () => {
    const real = fileFetch();
    const f = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      if (f.mock.calls.length === 1) throw new TypeError('Failed to fetch');
      return real(input);
    });
    vi.stubGlobal('fetch', f);

    const { result } = renderHook(() => useContent('steps'));
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current).toMatchObject({ status: 'error', kind: 'network' });

    act(() => result.current.retry());
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const state = result.current;
    expect(state.status === 'ready' && state.data.steps).toHaveLength(19);
    expect(f).toHaveBeenCalledTimes(2);
  });

  test('a bad file shows as an invalid error', async () => {
    vi.stubGlobal('fetch', respond('<!doctype html><title>Not the notes</title>'));
    const { result } = renderHook(() => useContent('notes'));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current).toMatchObject({ status: 'error', kind: 'invalid' });
  });

  test('primed content is ready on the first render, without a fetch', () => {
    const f = offlineFetch();
    vi.stubGlobal('fetch', f);
    const questions = realQuestions();
    primeContent('questions', questions);
    const { result } = renderHook(() => useContent('questions'));
    expect(result.current).toMatchObject({ status: 'ready', data: questions });
    expect(f).not.toHaveBeenCalled();
  });

  test('two screens on the same content share one load, and a retry on one updates both', async () => {
    const real = fileFetch();
    const f = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      if (f.mock.calls.length === 1) throw new TypeError('Failed to fetch');
      return real(input);
    });
    vi.stubGlobal('fetch', f);

    const one = renderHook(() => useContent('steps'));
    const two = renderHook(() => useContent('steps'));
    await waitFor(() => expect(two.result.current.status).toBe('error'));
    expect(one.result.current.status).toBe('error');
    expect(f).toHaveBeenCalledTimes(1);

    act(() => one.result.current.retry());
    await waitFor(() => expect(two.result.current.status).toBe('ready'));
    expect(one.result.current.status).toBe('ready');
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe('contentErrorCopy', () => {
  test('uses the §7 copy for the question bank, and the same voice for notes and steps', () => {
    expect(contentErrorCopy('questions')).toBe("The question bank didn't load. It isn't saved on this phone yet. Connect once, then try again.");
    expect(contentErrorCopy('notes')).toBe("The notes didn't load. They aren't saved on this phone yet. Connect once, then try again.");
    expect(contentErrorCopy('steps')).toBe("The PAM steps didn't load. They aren't saved on this phone yet. Connect once, then try again.");
    expect(contentErrorCopy('cases')).toBe("The cases didn't load. They aren't saved on this phone yet. Connect once, then try again.");
  });
});

describe('real data', () => {
  test('mergeQuestions over questions.json and overrides.json gives 407 questions, all with an explanation', () => {
    const qs = realQuestions();
    expect(qs).toHaveLength(407);
    expect(qs.filter(q => q.review.includes('No explanation yet.')).map(q => q.id)).toEqual([]);
    expect(qs.filter(q => q.explanation === null).map(q => q.id)).toEqual([]);
  });

  test("questionLabel matches each bank's label in questions.json", () => {
    const qs = realQuestions();
    for (const bank of questionsDoc.banks) {
      const q = qs.find(x => x.bank === bank.id);
      expect(q && questionLabel(q), bank.id).toBe(`${bank.label}, question ${q?.number}`);
    }
  });
});
