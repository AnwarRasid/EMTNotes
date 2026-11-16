// Test helpers shared by the unit tests. MemoryStorage stands in for localStorage behind the progress store.
import type { SlotStorage } from '../../src/progress/slots';

/** A Map-backed SlotStorage. `failWrites` makes setItem/removeItem throw (full or blocked storage);
 *  `failReads` makes getItem throw. `raw()` and `map` bypass both switches for assertions and setup. */
export class MemoryStorage implements SlotStorage {
  readonly map = new Map<string, string>();
  failWrites = false;
  failReads = false;

  constructor(initial: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(initial)) this.map.set(k, v);
  }

  getItem(k: string): string | null {
    if (this.failReads) throw new Error('SecurityError: storage reads are blocked');
    return this.map.get(k) ?? null;
  }

  setItem(k: string, v: string): void {
    if (this.failWrites) throw new Error('QuotaExceededError: storage is full');
    this.map.set(k, String(v));
  }

  removeItem(k: string): void {
    if (this.failWrites) throw new Error('QuotaExceededError: storage is full');
    this.map.delete(k);
  }

  /** The stored string for `k`, ignoring `failReads`. */
  raw(k: string): string | null {
    return this.map.get(k) ?? null;
  }
}

// ---- A fake Web Speech recogniser (Plan 3 Task 5, ruling D8) --------------------------------------------------------

/** One result of a fake result event: its words, and whether it is final. */
interface FakeResult { readonly isFinal: boolean; readonly length: number; readonly [i: number]: { transcript: string } }
export interface FakeResultEvent { readonly resultIndex: number; readonly results: readonly FakeResult[] }

/**
 * A stand-in for Chrome's webkitSpeechRecognition (Playwright can't drive a real mic, and jsdom has none). Each one the
 * code under test makes is kept in `FakeRecognition.made`, with the settings it was given and the calls it took; the
 * test plays its events with `hear`, `fail` and `finish`, in the order Chrome fires them (an error, then the end).
 */
export class FakeRecognition {
  static made: FakeRecognition[] = [];
  lang = '';
  continuous = true;        // the opposite of what listen must set, so a test sees that it set them
  interimResults = false;
  maxAlternatives = 0;
  onstart: (() => void) | null = null;
  onresult: ((e: FakeResultEvent) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  readonly calls: Array<'start' | 'stop' | 'abort'> = [];
  private finals: FakeResult[] = [];

  constructor() { FakeRecognition.made.push(this); }
  start(): void { this.calls.push('start'); }
  stop(): void { this.calls.push('stop'); }
  abort(): void { this.calls.push('abort'); }

  /** Fires onstart, as Chrome does once the mic is open. */
  open(): void { this.onstart?.(); }
  /** A result event: the session's finals so far, then `transcript` as the result that changed, interim or final. */
  hear(transcript: string, isFinal: boolean): void {
    const result: FakeResult = { isFinal, length: 1, 0: { transcript } };
    const resultIndex = this.finals.length;
    const results = [...this.finals, result];
    if (isFinal) this.finals.push(result);
    this.onresult?.({ resultIndex, results });
  }
  /** An error event with Chrome's code (`'network'`, `'aborted'`…). */
  fail(error: string): void { this.onerror?.({ error }); }
  /** The end event, which Chrome fires after every session, an error's included. */
  finish(): void { this.onend?.(); }
}

/** The newest recogniser made, which the test drives. */
export function lastRecognition(): FakeRecognition {
  const r = FakeRecognition.made.at(-1);
  if (r === undefined) throw new Error('No recogniser was made.');
  return r;
}

/** Puts FakeRecognition on window as webkitSpeechRecognition, with none made yet; vi.unstubAllGlobals takes it off. */
export function stubSpeech(): void {
  FakeRecognition.made = [];
  vi.stubGlobal('webkitSpeechRecognition', FakeRecognition);
}
