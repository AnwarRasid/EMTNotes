// Installing the app (user ruling, 2026-11-13: the trainee uses Android Chrome). Chrome fires beforeinstallprompt
// once the app can be installed; watchInstall keeps that event instead of letting Chrome show its own mini-infobar,
// so Settings' Install app key can show the prompt when the trainee asks. main.tsx starts watching before the first
// render, since Chrome may offer before Settings is ever opened. Chrome's appinstalled, or running as the installed
// app (display-mode: standalone), makes it 'installed'.
import { useEffect, useState } from 'preact/hooks';

export type InstallState = 'available' | 'installed' | 'unavailable';

/** Chrome's BeforeInstallPromptEvent, which lib.dom doesn't type. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

/** Chrome's offer, until it is used (a prompt shows once) or the app is installed. */
let offer: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();

const emit = () => { for (const fn of [...listeners]) fn(); };

const isOffer = (e: Event): e is InstallPromptEvent => typeof (e as Partial<InstallPromptEvent>).prompt === 'function';

/** Starts keeping Chrome's install offer and noting the install, on `win` (the window, unless given one). Returns a
 *  stop that removes both listeners and forgets what they kept. */
export function watchInstall(win: Window = window): () => void {
  offer = null;
  installed = false;
  const onOffer = (e: Event) => {
    e.preventDefault();   // no mini-infobar: Settings offers it
    if (!isOffer(e)) return;
    offer = e;
    emit();
  };
  const onInstalled = () => {
    installed = true;
    offer = null;
    emit();
  };
  win.addEventListener('beforeinstallprompt', onOffer);
  win.addEventListener('appinstalled', onInstalled);
  return () => {
    win.removeEventListener('beforeinstallprompt', onOffer);
    win.removeEventListener('appinstalled', onInstalled);
    offer = null;
    installed = false;
    emit();
  };
}

/** Whether this page runs as the installed app. False where there is no matchMedia or it throws. */
function standalone(win: Window): boolean {
  try {
    return typeof win.matchMedia === 'function' && win.matchMedia('(display-mode: standalone)').matches;
  } catch {
    return false;
  }
}

/** 'installed' once Chrome said so or when running as the installed app; 'available' while Chrome's offer is kept;
 *  otherwise 'unavailable'. */
export function installState(win: Window = window): InstallState {
  if (installed || standalone(win)) return 'installed';
  return offer === null ? 'unavailable' : 'available';
}

/** Shows Chrome's install prompt and resolves with the trainee's answer; 'unavailable' when Chrome hasn't offered,
 *  or the prompt fails. The offer is used up either way. An accepted install counts as installed at once: Chrome is
 *  adding it to the home screen, and its appinstalled follows. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const e = offer;
  if (e === null) return 'unavailable';
  offer = null;
  try {
    await e.prompt();
    const { outcome } = await e.userChoice;
    if (outcome === 'accepted') installed = true;
    return outcome;
  } catch {
    return 'unavailable';
  } finally {
    emit();
  }
}

/** installState(), kept current. */
export function useInstallState(): InstallState {
  const [state, setState] = useState(() => installState());
  useEffect(() => {
    const sync = () => setState(installState());
    listeners.add(sync);
    sync();   // catch a change between render and subscribe
    return () => { listeners.delete(sync); };
  }, []);
  return state;
}
