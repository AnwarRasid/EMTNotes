// Task 19: the install prompt (user ruling, 2026-11-13: Android Chrome). Chrome's beforeinstallprompt is kept for
// Settings' Install app key; appinstalled, or running as the installed app, makes it 'installed'.
import { renderHook, act } from '@testing-library/preact';
import { installState, promptInstall, useInstallState, watchInstall } from '../../src/lib/install';

/** A window with events and matchMedia, where `(display-mode: standalone)` matches only when `standalone`. */
function fakeWindow(standalone = false): Window {
  return Object.assign(new EventTarget(), {
    matchMedia: (q: string) => ({ matches: standalone && q === '(display-mode: standalone)', media: q }),
  }) as unknown as Window;
}

/** Chrome's beforeinstallprompt: cancelable, with prompt() and the user's choice. */
function installPrompt(outcome: 'accepted' | 'dismissed') {
  return Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt: vi.fn(async () => {}),
    userChoice: Promise.resolve({ outcome, platform: 'web' }),
  });
}

let stop: (() => void) | null = null;
const watch = (win: Window) => { stop = watchInstall(win); };

afterEach(() => {
  stop?.();
  stop = null;
});

describe('watchInstall', () => {
  it("keeps Chrome's offer instead of letting Chrome show its own, and is then 'available'", () => {
    const win = fakeWindow();
    watch(win);
    expect(installState(win)).toBe('unavailable');
    const e = installPrompt('accepted');
    const preventDefault = vi.spyOn(e, 'preventDefault');
    win.dispatchEvent(e);
    expect(preventDefault).toHaveBeenCalled();
    expect(installState(win)).toBe('available');
  });

  it("is 'installed' once Chrome says the app was installed", () => {
    const win = fakeWindow();
    watch(win);
    win.dispatchEvent(installPrompt('accepted'));
    win.dispatchEvent(new Event('appinstalled'));
    expect(installState(win)).toBe('installed');
  });

  it("is 'installed' when running as the installed app, (display-mode: standalone)", () => {
    const win = fakeWindow(true);
    watch(win);
    expect(installState(win)).toBe('installed');
    win.dispatchEvent(installPrompt('accepted'));
    expect(installState(win)).toBe('installed');
  });

  it('stops listening once stopped, and forgets what it kept', () => {
    const win = fakeWindow();
    watch(win);
    win.dispatchEvent(installPrompt('accepted'));
    stop?.();
    stop = null;
    expect(installState(win)).toBe('unavailable');
    win.dispatchEvent(installPrompt('accepted'));
    expect(installState(win)).toBe('unavailable');
  });

  it("is 'unavailable' where there is no matchMedia", () => {
    const win = new EventTarget() as unknown as Window;
    watch(win);
    expect(installState(win)).toBe('unavailable');
  });
});

describe('promptInstall', () => {
  it("shows Chrome's install prompt and resolves 'accepted' when the trainee installs", async () => {
    const win = fakeWindow();
    watch(win);
    const e = installPrompt('accepted');
    win.dispatchEvent(e);
    await expect(promptInstall()).resolves.toBe('accepted');
    expect(e.prompt).toHaveBeenCalledTimes(1);
    expect(installState(win)).toBe('installed');   // Chrome is installing it; appinstalled follows
  });

  it("resolves 'dismissed' when the trainee says no, and the used offer is gone", async () => {
    const win = fakeWindow();
    watch(win);
    const e = installPrompt('dismissed');
    win.dispatchEvent(e);
    await expect(promptInstall()).resolves.toBe('dismissed');
    expect(installState(win)).toBe('unavailable');   // a prompt shows once; Chrome may offer again later
    await expect(promptInstall()).resolves.toBe('unavailable');
    expect(e.prompt).toHaveBeenCalledTimes(1);
  });

  it("resolves 'unavailable' when Chrome hasn't offered", async () => {
    watch(fakeWindow());
    await expect(promptInstall()).resolves.toBe('unavailable');
  });

  it("resolves 'unavailable' when the prompt throws", async () => {
    const win = fakeWindow();
    watch(win);
    const e = installPrompt('accepted');
    e.prompt.mockRejectedValueOnce(new DOMException('already shown', 'InvalidStateError'));
    win.dispatchEvent(e);
    await expect(promptInstall()).resolves.toBe('unavailable');
  });
});

describe('useInstallState', () => {
  it('follows the offer and the install', () => {
    watch(window);
    const { result } = renderHook(() => useInstallState());
    expect(result.current).toBe('unavailable');
    act(() => { window.dispatchEvent(installPrompt('accepted')); });
    expect(result.current).toBe('available');
    act(() => { window.dispatchEvent(new Event('appinstalled')); });
    expect(result.current).toBe('installed');
  });
});
