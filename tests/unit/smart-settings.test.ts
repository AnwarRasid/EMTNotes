// Plan 3 Task 9: the smart tester's settings, kept in localStorage `crewleader.smart` apart from progress (D16): read
// whole or as DEFAULT_SMART, written back, ready only when on with a key, and its spend priced by the model's rates.
import { act, renderHook } from '@testing-library/preact';
import { MemoryStorage } from './helpers';
import {
  DEFAULT_SMART, SMART_MODELS, SMART_STORAGE_KEY, readSmart, smartReady, useSmartSettings, withSpend, writeSmart,
  type SmartSettings,
} from '../../src/smart/settings';

const stored = (value: string) => new MemoryStorage({ [SMART_STORAGE_KEY]: value });

describe('readSmart', () => {
  it('is DEFAULT_SMART on an empty storage, bad JSON, a field of the wrong type, a throwing getItem and no storage', () => {
    expect(SMART_STORAGE_KEY).toBe('crewleader.smart');
    expect(DEFAULT_SMART).toEqual({ on: false, key: null, model: 'claude-opus-5-5', checks: 0, spentUsd: 0 });
    expect(readSmart(new MemoryStorage())).toEqual(DEFAULT_SMART);
    expect(readSmart(stored('{bad'))).toEqual(DEFAULT_SMART);
    expect(readSmart(stored('{"on":"yes"}'))).toEqual(DEFAULT_SMART);
    expect(readSmart(stored('{"on":true,"key":"sk-ant-x","model":"claude-opus-4-1"}'))).toEqual(DEFAULT_SMART);   // no such choice
    expect(readSmart(stored('{"checks":-1}'))).toEqual(DEFAULT_SMART);
    expect(readSmart(stored('[]'))).toEqual(DEFAULT_SMART);
    expect(readSmart(stored('null'))).toEqual(DEFAULT_SMART);
    const blocked = stored('{"on":true,"key":"sk-ant-x"}');
    blocked.failReads = true;
    expect(readSmart(blocked)).toEqual(DEFAULT_SMART);
    expect(readSmart(null)).toEqual(DEFAULT_SMART);
  });

  it('fills each missing field from DEFAULT_SMART, so a partial save reads whole', () => {
    expect(readSmart(stored('{"on":true,"key":"sk-ant-x"}'))).toEqual({ ...DEFAULT_SMART, on: true, key: 'sk-ant-x' });
    expect(readSmart(stored('{"model":"claude-haiku-5-5","checks":3,"spentUsd":0.02}')))
      .toEqual({ ...DEFAULT_SMART, model: 'claude-haiku-5-5', checks: 3, spentUsd: 0.02 });
  });

  it('reads the real localStorage by default', () => {
    localStorage.setItem(SMART_STORAGE_KEY, JSON.stringify({ on: true, key: 'sk-ant-x' }));
    try {
      expect(readSmart()).toEqual({ ...DEFAULT_SMART, on: true, key: 'sk-ant-x' });
    } finally {
      localStorage.removeItem(SMART_STORAGE_KEY);
    }
  });
});

describe('writeSmart', () => {
  it('round-trips through readSmart', () => {
    const storage = new MemoryStorage();
    const s: SmartSettings = { on: true, key: 'sk-ant-x', model: 'claude-sonnet-5-5', checks: 7, spentUsd: 0.31 };
    expect(writeSmart(s, storage)).toBe(true);
    expect(readSmart(storage)).toEqual(s);
  });

  it('returns false when setItem throws, or with no storage', () => {
    const storage = new MemoryStorage();
    storage.failWrites = true;
    expect(writeSmart({ ...DEFAULT_SMART, key: 'sk-ant-x' }, storage)).toBe(false);
    expect(writeSmart(DEFAULT_SMART, null)).toBe(false);
  });
});

describe('smartReady', () => {
  it('is true only when on with a key', () => {
    expect(smartReady({ ...DEFAULT_SMART, on: true, key: null })).toBe(false);
    expect(smartReady({ ...DEFAULT_SMART, on: false, key: 'sk-ant-x' })).toBe(false);
    expect(smartReady({ ...DEFAULT_SMART, on: true, key: 'sk-ant-x' })).toBe(true);
  });
});

describe('SMART_MODELS and withSpend', () => {
  it('offers Opus (the default), Sonnet and Haiku 5.5 with their rates', () => {
    expect(SMART_MODELS.map((m) => [m.id, m.label, m.inPerM, m.outPerM])).toEqual([
      ['claude-opus-5-5', 'Claude Opus 5.5', 4, 20],
      ['claude-sonnet-5-5', 'Claude Sonnet 5.5', 2, 10],
      ['claude-haiku-5-5', 'Claude Haiku 5.5', 0.1, 0.5],
    ]);
  });

  it('adds one check and the usage priced by the model: a million Opus input tokens is US$4', () => {
    const s = { ...DEFAULT_SMART, checks: 2, spentUsd: 1 };
    expect(withSpend(s, { inputTokens: 1_000_000, outputTokens: 0 })).toEqual({ ...s, checks: 3, spentUsd: 5 });
    expect(withSpend({ ...DEFAULT_SMART, model: 'claude-sonnet-5-5' }, { inputTokens: 0, outputTokens: 1_000_000 }).spentUsd).toBe(10);
    expect(withSpend({ ...DEFAULT_SMART, model: 'claude-haiku-5-5' }, { inputTokens: 900, outputTokens: 40 }).spentUsd)
      .toBeCloseTo((900 * 0.1 + 40 * 0.5) / 1_000_000, 12);
    expect(s.checks).toBe(2);   // never in place
  });

  it('prices at the model that answered when it is given, not the model chosen now (review M6)', () => {
    const now = { ...DEFAULT_SMART, model: 'claude-haiku-5-5' as const };
    expect(withSpend(now, { inputTokens: 1_000_000, outputTokens: 0 }, 'claude-opus-5-5')).toEqual({ ...now, checks: 1, spentUsd: 4 });
  });
});

describe('useSmartSettings (review M3)', () => {
  const store = (s: Partial<SmartSettings>) => localStorage.setItem(SMART_STORAGE_KEY, JSON.stringify({ ...DEFAULT_SMART, ...s }));

  it("starts each change from what is saved, so another window's Remove key is never written back", () => {
    store({ on: true, key: 'sk-ant-x' });
    const hook = renderHook(() => useSmartSettings());
    expect(hook.result.current[0].key).toBe('sk-ant-x');
    store({});   // another window removed the key; its storage event hasn't arrived here yet
    let saved = false;
    act(() => { saved = hook.result.current[1]((s) => withSpend(s, { inputTokens: 1_000_000, outputTokens: 0 })); });
    expect(saved).toBe(true);
    expect(readSmart()).toEqual({ ...DEFAULT_SMART, checks: 1, spentUsd: 4 });
    expect(hook.result.current[0]).toEqual({ ...DEFAULT_SMART, checks: 1, spentUsd: 4 });
  });

  it('a change storage refuses returns false and changes nothing, here or in storage', () => {
    store({ key: 'sk-ant-x' });
    const hook = renderHook(() => useSmartSettings());
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    try {
      let saved = true;
      act(() => { saved = hook.result.current[1]((s) => ({ ...s, on: true })); });
      expect(saved).toBe(false);
      expect(hook.result.current[0].on).toBe(false);
      expect(readSmart().on).toBe(false);
    } finally {
      setItem.mockRestore();
    }
  });
});
