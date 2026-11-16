import { describe, it, expect, vi } from 'vitest';
import { haptic } from '../../src/lib/haptics';

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';

const nav = (userAgent: string, vibrate?: (p: VibratePattern) => boolean) => ({ userAgent, vibrate }) as unknown as Navigator;

describe('haptic', () => {
  it('vibrates once on Android when enabled', () => {
    const vibrate = vi.fn(() => true);
    haptic('right', true, nav(ANDROID, vibrate));
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it('never vibrates on an iPhone, even where vibrate exists', () => {
    const vibrate = vi.fn(() => true);
    haptic('wrong', true, nav(IPHONE, vibrate));
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('never vibrates when the setting is off', () => {
    const vibrate = vi.fn(() => true);
    haptic('tap', false, nav(ANDROID, vibrate));
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('gives each kind its own pattern', () => {
    const vibrate = vi.fn((_: VibratePattern) => true);
    const android = nav(ANDROID, vibrate);
    haptic('tap', true, android);
    haptic('right', true, android);
    haptic('wrong', true, android);
    const patterns = vibrate.mock.calls.map((c) => JSON.stringify(c[0]));
    expect(new Set(patterns).size).toBe(3);
  });

  it('does nothing without vibrate, and never throws when vibrate throws', () => {
    expect(() => haptic('tap', true, nav(ANDROID))).not.toThrow();
    const throwing = vi.fn(() => { throw new Error('blocked'); });
    expect(() => haptic('tap', true, nav(ANDROID, throwing))).not.toThrow();
  });
});
