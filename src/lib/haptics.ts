// Short vibrations on answers and taps. Android only: iOS Safari has no vibrate, and some desktop browsers
// expose one that does nothing useful. Behind the Settings toggle, so callers pass `settings.haptics`.

export type HapticKind = 'tap' | 'right' | 'wrong';

const PATTERNS: Record<HapticKind, VibratePattern> = {
  tap: 8,
  right: 16,
  wrong: [24, 60, 24],
};

export function haptic(kind: HapticKind, enabled: boolean, nav?: Navigator): void {
  if (!enabled) return;
  const n = nav ?? (typeof navigator === 'undefined' ? undefined : navigator);
  if (!n || typeof n.vibrate !== 'function' || !/Android/i.test(n.userAgent)) return;
  try {
    n.vibrate(PATTERNS[kind]);
  } catch {
    // A blocked vibrate (no user gesture yet, or a policy) is never worth an error.
  }
}
