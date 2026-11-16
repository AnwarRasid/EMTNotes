// Loads the content JSON under public/data: fetch, check against its schema, memoise per key. Every screen reads
// content through useContent, so one load serves them all and a retry on one screen updates the others.
import * as v from 'valibot';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  CaseIndexSchema, CaseSchema, NotesDocSchema, OverridesDocSchema, RawQuestionsDocSchema, StepsDocSchema,
  type Case, type NotesDoc, type StepsDoc,
} from './schema';
import { mergeQuestions, type Question } from './questions';

export type ContentKey = 'questions' | 'notes' | 'steps' | 'cases';
export type ContentData = { questions: Question[]; notes: NotesDoc; steps: StepsDoc; cases: Case[] };

/** `network`: the file couldn't be fetched (offline, or not 2xx). `invalid`: it came, but isn't JSON or fails its schema. */
export class ContentError extends Error {
  constructor(public kind: 'network' | 'invalid', message: string) {
    super(message);
    this.name = 'ContentError';
  }
}

// With Vite `base: './'` and hash routing this resolves next to index.html, the precached copy. `dataFile` takes a
// path with its extension, as cases/index.json names each case file ('cases/copd-amk-01.json').
const dataFile = (file: string) => `${import.meta.env.BASE_URL}data/${file}`;
const dataPath = (file: string) => dataFile(`${file}.json`);

const describeError = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Fetches `path` and parses it with `schema`. Rejects with a ContentError. Uses the global fetch unless given one. */
export async function loadJson<T>(path: string, schema: v.GenericSchema<unknown, T>, fetchImpl?: typeof fetch): Promise<T> {
  // The body is read as text inside the network step, so a connection dropped mid-download counts as network.
  let text: string;
  try {
    const res = await (fetchImpl ? fetchImpl(path) : fetch(path));
    if (!res.ok) throw new ContentError('network', `${path}: HTTP ${res.status}`);
    text = await res.text();
  } catch (e) {
    throw e instanceof ContentError ? e : new ContentError('network', `${path}: ${describeError(e)}`);
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new ContentError('invalid', `${path}: not JSON (${describeError(e)})`);
  }
  const result = v.safeParse(schema, json);
  if (!result.success) throw new ContentError('invalid', `${path}: ${v.summarize(result.issues)}`);
  return result.output;
}

const FETCHERS: { [K in ContentKey]: (fetchImpl?: typeof fetch) => Promise<ContentData[K]> } = {
  questions: async fetchImpl => {
    const [raw, overrides] = await Promise.all([
      loadJson(dataPath('questions'), RawQuestionsDocSchema, fetchImpl),
      loadJson(dataPath('overrides'), OverridesDocSchema, fetchImpl),
    ]);
    return mergeQuestions(raw, overrides);
  },
  notes: fetchImpl => loadJson(dataPath('notes'), NotesDocSchema, fetchImpl),
  steps: fetchImpl => loadJson(dataPath('steps'), StepsDocSchema, fetchImpl),
  cases: fetchImpl => loadCases(fetchImpl),
};

/** cases/index.json, then every case file it lists, in its order. A file whose id isn't its entry's is invalid: the
 *  index would offer one case and the run would play another. */
async function loadCases(fetchImpl?: typeof fetch): Promise<Case[]> {
  const index = await loadJson(dataPath('cases/index'), CaseIndexSchema, fetchImpl);
  return Promise.all(index.cases.map(async entry => {
    const path = dataFile(entry.file);
    const c = await loadJson(path, CaseSchema, fetchImpl);
    if (c.id !== entry.id) throw new ContentError('invalid', `${path}: its id "${c.id}" isn't "${entry.id}", as the index lists it`);
    return c;
  }));
}

// ---- Memo -----------------------------------------------------------------------------------------------

type Settled<K extends ContentKey> =
  | { status: 'loading' }
  | { status: 'ready'; data: ContentData[K] }
  | { status: 'error'; kind: 'network' | 'invalid' };

export type ContentState<K extends ContentKey> = Settled<K> & { retry(): void };

interface Entry<K extends ContentKey> {
  promise: Promise<ContentData[K]>;
  state: Settled<K>;
}

// One shared object, so a new load that replaces "nothing yet" doesn't count as a change and re-render.
const LOADING = { status: 'loading' } as const;

let cache: { [K in ContentKey]?: Entry<K> } = {};
const listeners = new Set<() => void>();

/** A write through a generic key, which TS can't check against the mapped type; each key keeps its own data type. */
function setEntry<K extends ContentKey>(key: K, entry: Entry<K>): void {
  (cache as Record<K, Entry<K>>)[key] = entry;
}

function notify(): void {
  for (const listener of [...listeners]) listener();
}

/** Starts a fresh load of `key`, replacing whatever the memo held. */
function start<K extends ContentKey>(key: K, fetchImpl?: typeof fetch): Entry<K> {
  const entry: Entry<K> = { promise: FETCHERS[key](fetchImpl), state: LOADING };
  const settle = (state: Settled<K>) => {
    entry.state = state;
    if (cache[key] === entry) notify();   // a superseded or reset load changes nothing on screen
  };
  entry.promise.then(
    data => settle({ status: 'ready', data }),
    (e: unknown) => {
      if (!(e instanceof ContentError)) console.error(`Loading ${key} failed unexpectedly:`, e);
      settle({ status: 'error', kind: e instanceof ContentError ? e.kind : 'invalid' });
    },
  );
  setEntry(key, entry);
  notify();
  return entry;
}

/**
 * The content for `key`, fetched once and memoised (a failure too, until retry). 'questions' merges questions.json
 * with overrides.json; 'cases' reads cases/index.json, then each case file. `fetchImpl` applies only to the call that
 * starts the load.
 */
export function loadContent<K extends ContentKey>(key: K, fetchImpl?: typeof fetch): Promise<ContentData[K]> {
  return (cache[key] ?? start(key, fetchImpl)).promise;
}

/** Puts ready content in the memo, so useContent returns it on the first render (tests and stories). */
export function primeContent<K extends ContentKey>(key: K, data: ContentData[K]): void {
  setEntry(key, { promise: Promise.resolve(data), state: { status: 'ready', data } });
  notify();
}

/** Forgets every load (tests). Mounted hooks aren't told, so call it with nothing mounted or before rendering. */
export function resetContentCache(): void {
  cache = {};
}

// ---- Hook -----------------------------------------------------------------------------------------------

/** Loading, ready or error for `key`; starts the load on mount. `retry()` drops the memo and fetches again. */
export function useContent<K extends ContentKey>(key: K): ContentState<K> {
  const state: Settled<K> = cache[key]?.state ?? LOADING;
  const [, rerender] = useState(0);
  const shown = useRef(state);
  shown.current = state;

  useEffect(() => {
    const check = () => {
      if ((cache[key]?.state ?? LOADING) !== shown.current) rerender(n => n + 1);
    };
    listeners.add(check);
    if (!cache[key]) start(key);
    check();   // catch a load that settled between render and subscribe
    return () => {
      listeners.delete(check);
    };
  }, [key]);

  const retry = useCallback(() => {
    start(key);
  }, [key]);
  return useMemo(() => ({ ...state, retry }), [state, retry]);
}

// ---- Copy -----------------------------------------------------------------------------------------------

const ERROR_COPY: Record<ContentKey, string> = {
  questions: "The question bank didn't load. It isn't saved on this phone yet. Connect once, then try again.",
  notes: "The notes didn't load. They aren't saved on this phone yet. Connect once, then try again.",
  steps: "The PAM steps didn't load. They aren't saved on this phone yet. Connect once, then try again.",
  cases: "The cases didn't load. They aren't saved on this phone yet. Connect once, then try again.",
};

/** What a screen says when its content failed to load (spec §7 for the question bank). */
export function contentErrorCopy(key: ContentKey): string {
  return ERROR_COPY[key];
}
