// Task 20 review round 1 (ruling D12): saveProgress checks again only the top-level keys whose value is a new object,
// which is exact only while no update edits the progress in place. This pins that rule. The store deep-freezes the
// progress it holds before every update, and a run goes through the update paths the app itself uses, from Run start to
// a dispute on its debrief. An edit in place would throw: ES modules are strict.
import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/preact';
import { MemoryStorage } from './helpers';
import { CASES, STEPS, envOf } from './sim-helpers';
import { matchRoute } from '../../src/app/routes';
import { primeContent, resetContentCache } from '../../src/data/load';
import { ProgressContext } from '../../src/progress/hooks';
import { createProgressStore, type ProgressStore } from '../../src/progress/store';
import { Debrief } from '../../src/run/Debrief';
import { beginRun } from '../../src/run/start';
import { finishRun, pauseOpenRun, resumeOpenRun } from '../../src/run/useRunLifecycle';
import { useSendQueue, type RunInput } from '../../src/run/useSendQueue';

/** `x` with every object and array in it frozen. */
function deepFreeze<T>(x: T, seen = new WeakSet<object>()): T {
  if (typeof x !== 'object' || x === null || seen.has(x)) return x;
  seen.add(x);
  Object.freeze(x);
  for (const v of Object.values(x)) deepFreeze(v, seen);
  return x;
}

/** A store whose progress is deep-frozen before each update, so an update that edits it in place throws. `updates`
 *  counts the updates made through it. */
function frozenStore(): ProgressStore & { updates: number } {
  const store = Object.assign(createProgressStore(new MemoryStorage()), { updates: 0 });
  const update = store.update;
  store.update = (fn) => {
    deepFreeze(store.get());
    store.updates += 1;
    update(fn);
  };
  return store;
}

beforeEach(() => {
  resetContentCache();
  primeContent('steps', { contentVersion: 'test', steps: STEPS });
  primeContent('cases', CASES);
});
afterEach(() => {
  vi.restoreAllMocks();
  resetContentCache();
});

test('the freeze catches an update that edits the progress in place', () => {
  const store = frozenStore();
  store.update((p) => ({ ...p, notes: { ...p.notes, read: ['s01'] } }));
  expect(() => store.update((p) => { p.notes.read.push('s02'); return { ...p }; })).toThrow(TypeError);
});

test('a run from Run start to a dispute on its debrief never edits the progress in place', async () => {
  const errors = vi.spyOn(console, 'error');
  const store = frozenStore();
  const env = envOf('copd-amk-01');

  beginRun(store, env, 'coached');   // Run start's Take the call
  const id = store.get().runOpen!.id;
  const { result } = renderHook(() => useSendQueue(store, env, id, () => {}));   // the run screen's send queue
  const send = async (input: RunInput) => {
    let ok = false;
    await act(async () => { ok = await result.current(input); });
    expect(ok, JSON.stringify(input)).toBe(true);   // the queue reports an input that threw as false
  };
  // Typed lines and step-list taps: the call, a Phrase flag (MOI without "suspected"), the clock starting at Approach,
  // an Order flag landing on an earlier line, a reading, a Wrong oxygen, then a tap past the call.
  await send({ text: 'FMV 123 to Ops Ctr, responding to Blk 2xx Ang Mo Kio Ave 3 for case of elderly female, breathlessness.' });
  await send({ tap: 'call-caller' });
  await send({ tap: 'preparation' });
  await send({ text: 'Are there any witnesses? MOI is case of elderly female, breathlessness.' });
  await send({ text: 'Approaching casualty from the front. If you can hear me, please do not move your head. Buddy, do a head grip.' });
  await send({ text: 'Is there any catastrophic bleeding?' });
  await send({ text: 'Arm buddy, please measure the SpO2 reading on room air.' });
  await send({ text: 'Buddy, simple face mask, 6 litres.' });
  await send({ tap: 'introduction' });
  const run = store.get().runOpen!;
  expect(run.lines.some((l) => l.flags?.some((f) => f.kind === 'order'))).toBe(true);
  expect(run.lines.some((l) => l.flags?.some((f) => f.kind === 'wrong'))).toBe(true);
  expect(run.clock.started).toBe(true);

  // The Pause sheet and the lifecycle's clock, then End run.
  pauseOpenRun(store, id, Date.now() + 1_000);
  resumeOpenRun(store, id, Date.now() + 2_000);
  finishRun(store, env, Date.now() + 3_000);
  expect(store.get().runOpen).toBeNull();
  expect(store.get().runs.map((r) => r.id)).toEqual([id]);

  // "Not what I meant" on the debrief, then "Count it again".
  location.hash = `#/debrief/${id}`;
  render(<ProgressContext.Provider value={store}><Debrief match={matchRoute(location.hash)} /></ProgressContext.Provider>);
  const fixes = () => screen.getByRole('list', { name: /to fix$/ });
  fireEvent.click(within(within(fixes()).getAllByRole('listitem')[0]!).getByRole('button', { name: 'Not what I meant' }));
  expect(store.get().runs[0]!.disputes).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Count it again' }));
  expect(store.get().runs[0]!.disputes).toEqual([]);

  expect(store.updates).toBeGreaterThanOrEqual(14);
  expect(store.lastSaveError()).toBeNull();
  expect(errors).not.toHaveBeenCalled();
});
