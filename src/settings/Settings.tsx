// Settings (#/settings), opened from Today's app bar (spec §6.1): text size, haptics, whether the app is saved for
// offline use, installing it (Android Chrome), whether the browser keeps its storage, the optional smart tester (Plan 3
// Task 9), and reset progress behind a typed confirmation. No key here is the screen's primary one.
import type { JSX } from 'preact';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { back } from '../app/routes';
import { haptic } from '../lib/haptics';
import { promptInstall, useInstallState, type InstallState } from '../lib/install';
import { offlineReady } from '../lib/offline';
import { useProgress, useStore } from '../progress/hooks';
import { persistOnce } from '../progress/store';
import type { TextSize } from '../progress/types';
import { testKey, type KeyCheck } from '../smart/claude';
import { SMART_MODELS, useSmartSettings, type SmartModelId, type SmartSettings } from '../smart/settings';
import { Icon } from '../ui/Icon';
import { Secondary } from '../ui/Keys';
import { Panel } from '../ui/Panel';
import { toast } from '../ui/toast';

export function Settings(): JSX.Element {
  return (
    <div class="screen">
      <header class="screen-head">
        <button type="button" class="ibtn" aria-label="Back" onClick={() => back('/')}><Icon name="back" /></button>
        <h1 class="h1">Settings</h1>
      </header>
      <TextSizeGroup />
      <HapticsGroup />
      <OfflineGroup />
      <InstallGroup />
      <StorageGroup />
      <SmartGroup />
      <ResetGroup />
    </div>
  );
}

// ---- Text size -------------------------------------------------------------------------------------------------

const SIZES: readonly { id: TextSize; label: string }[] = [
  { id: 'standard', label: 'Standard' },
  { id: 'large', label: 'Large' },
  { id: 'larger', label: 'Larger' },
];

/** The same setting as the reader's text size key. App applies it to the whole page as it changes. */
function TextSizeGroup(): JSX.Element {
  const store = useStore();
  const size = useProgress((p) => p.settings.textSize);
  const name = useId();
  const choose = (s: TextSize) =>
    store.update((p) => (p.settings.textSize === s ? p : { ...p, settings: { ...p.settings, textSize: s } }));
  return (
    <Panel class="setup-group">
      <fieldset>
        <legend class="plabel">Text size</legend>
        <div class="choices">
          {SIZES.map((s) => (
            <label key={s.id} class="choice">
              <input type="radio" name={name} value={s.id} checked={size === s.id} onChange={() => choose(s.id)} />
              <span>{s.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </Panel>
  );
}

// ---- Haptics ---------------------------------------------------------------------------------------------------

/** A switch named by its label, with "Android only" as its description. Turning it on gives one tap to feel. */
function HapticsGroup(): JSX.Element {
  const store = useStore();
  const on = useProgress((p) => p.settings.haptics);
  const ids = useId();
  const toggle = () => {
    const next = !store.get().settings.haptics;
    store.update((p) => ({ ...p, settings: { ...p.settings, haptics: next } }));
    if (next) haptic('tap', true);
  };
  return (
    <Panel class="set-group">
      <h2 class="plabel">Haptics</h2>
      <button type="button" class="switch-row" role="switch" aria-checked={on}
        aria-labelledby={`${ids}-label`} aria-describedby={`${ids}-sub`} onClick={toggle}>
        <span class="switch-text">
          <span id={`${ids}-label`} class="switch-label">Vibrate on answers</span>
          <span id={`${ids}-sub`} class="switch-sub">Android only</span>
        </span>
        {/* The state shows by the word and the knob's side as well as the fill; aria-checked says it for a screen reader. */}
        <span class="switch-state" aria-hidden="true">{on ? 'On' : 'Off'}</span>
        <span class="switch" aria-hidden="true"><i /></span>
      </button>
    </Panel>
  );
}

// ---- Offline ---------------------------------------------------------------------------------------------------

/** offlineReady(), kept current: the service worker can take control after the page has loaded. */
function useOfflineReady(): boolean {
  const [ready, setReady] = useState(() => offlineReady());
  useEffect(() => {
    let sw: ServiceWorkerContainer | undefined;
    try {
      sw = typeof navigator === 'undefined' ? undefined : navigator.serviceWorker;
    } catch {
      sw = undefined;
    }
    if (!sw) return;
    const sync = () => setReady(offlineReady());
    sw.addEventListener('controllerchange', sync);
    sync();
    return () => sw.removeEventListener('controllerchange', sync);
  }, []);
  return ready;
}

function OfflineGroup(): JSX.Element {
  const ready = useOfflineReady();
  return (
    <Panel class="set-group">
      <h2 class="plabel">Offline</h2>
      <p class="set-line tn">Version {__APP_VERSION__}, built {__BUILD_DATE__}.</p>
      <p class="set-sub">{ready ? 'Saved for offline use.' : 'Not saved for offline use yet. Open the app once with a connection.'}</p>
    </Panel>
  );
}

// ---- Install ---------------------------------------------------------------------------------------------------

/** The Install group's line for each state. 'unavailable' also covers the installed app's site opened in a Chrome tab
 *  (Chrome then offers nothing, and its menu says Open in app) and a prompt just turned down, so it says both. */
const INSTALL_LINE: Record<InstallState, string> = {
  available: 'Install EMTNotes to open it full screen from your home screen.',
  installed: 'Installed on this phone.',
  unavailable: "Chrome hasn't offered to install yet. Use its menu: Install app. If it says Open in app, EMTNotes is already installed.",
};

/** Installing the app from Chrome's own offer (user ruling, 2026-11-13: Android Chrome), which watchInstall() keeps
 *  from start-up. The key shows only while Chrome's offer is kept; once used, Chrome may offer again later. When the
 *  prompt closes, the key goes; focus that was on it moves to the group's line, which says what happened, rather than
 *  falling to <body>. */
function InstallGroup(): JSX.Element {
  const state = useInstallState();
  const line = useRef<HTMLParagraphElement>(null);
  const keys = useRef<HTMLDivElement>(null);
  const refocus = useRef(false);
  const install = () => {
    // Focus on <body> counts as the key's too: a tapped button isn't always focused (App's banner does the same).
    const active = document.activeElement;
    refocus.current = active === null || active === document.body || !!keys.current?.contains(active);
    void promptInstall().then((outcome) => {
      if (outcome === 'accepted') toast('Installing EMTNotes.');
    });
  };
  useLayoutEffect(() => {
    if (state === 'available' || !refocus.current) return;
    refocus.current = false;
    const active = document.activeElement;
    if (active === null || active === document.body) line.current?.focus({ preventScroll: true });
  }, [state]);
  return (
    <Panel class="set-group">
      <h2 class="plabel">Install</h2>
      <p class="set-sub" ref={line} tabIndex={-1}>{INSTALL_LINE[state]}</p>
      {state === 'available' && <div class="keys" ref={keys}><Secondary onClick={install}>Install app</Secondary></div>}
    </Panel>
  );
}

// ---- Storage ---------------------------------------------------------------------------------------------------

/** The browser's answer when the app asked to keep its storage (navigator.storage.persist() at start-up), or null
 *  until it comes. */
function useStorageKept(): boolean | null {
  const [kept, setKept] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void persistOnce().then((k) => { if (live) setKept(k); });
    return () => { live = false; };
  }, []);
  return kept;
}

/** Whether the browser keeps progress when space runs low (spec §6.6). Without it, Chrome may clear the site's
 *  storage under pressure; it grants it to an installed app. */
function StorageGroup(): JSX.Element {
  const kept = useStorageKept();
  return (
    <Panel class="set-group">
      <h2 class="plabel">Storage</h2>
      {kept !== null && (
        <p class="set-sub">
          {kept ? 'Your progress is kept, even when the phone runs low on space.'
            : 'The phone may clear your progress when it runs low on space. Installing the app usually stops that.'}
        </p>
      )}
    </Panel>
  );
}

// ---- Smart tester ----------------------------------------------------------------------------------------------

/** Test key's result line for each answer (D18: a browser-blocked organisation has its own). */
const KEY_CHECK: Record<KeyCheck, string> = {
  ok: 'The key works.',
  'bad-key': "That key didn't work. Check it in the Claude Console.",
  'browser-blocked': "This key's organisation doesn't allow calls from a browser, so the smart tester can't use it.",
  'rate-limited': 'Too many requests right now. Try again in a minute.',
  offline: "Couldn't reach Anthropic. Check your connection.",
  // online, but the call never got out (final review M4): most likely the browser refused it (CORS), so it never says
  // you're offline
  unreachable: "Couldn't reach Anthropic from this browser. If other sites load, the browser may be refusing the call.",
  error: 'Something went wrong. Try again later.',
};
const CHECKING_KEY = 'Checking the key.';
/** The toast when storage refuses a change to the smart tester's settings (full or blocked): nothing changed. */
export const SMART_NOT_SAVED = "The smart tester's settings couldn't be saved on this phone, so nothing changed.";

/**
 * The optional smart tester (Plan 3 Task 9; D13, D16, D18): the trainee's own Claude API key, kept only in this
 * browser (crewleader.smart, never in progress, so Reset progress keeps it); the switch, which needs a saved key; the
 * model; Test key; what it has cost; and what it sends. The key field is a password field that is emptied once the
 * key is saved, and the saved key shows only by its last 4 characters. A key that goes, or a key disabled after its
 * press, hands focus to the group's own text, never to <body>.
 */
function SmartGroup(): JSX.Element {
  const [s, saveSmart] = useSmartSettings();
  const ids = useId();
  const [typed, setTyped] = useState('');
  const [check, setCheck] = useState<KeyCheck | 'checking' | null>(null);
  const [, redraw] = useState(0);
  /** A change, saved; when storage refuses it, nothing changes and the trainee is told (review M3). The redraw puts a
   *  radio the tap checked back to the saved model. */
  const update = (fn: (x: SmartSettings) => SmartSettings): boolean => {
    if (saveSmart(fn)) return true;
    toast(SMART_NOT_SAVED);
    redraw((n) => n + 1);
    return false;
  };
  const asked = useRef(0);   // the newest Test key: an answer to an older one, or to a key since changed, is dropped
  const refocus = useRef<'saved' | 'heading' | 'usage' | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const savedLine = useRef<HTMLParagraphElement>(null);
  const usage = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const want = refocus.current;
    refocus.current = null;
    const el = want === 'saved' ? savedLine.current : want === 'heading' ? heading.current : want === 'usage' ? usage.current : null;
    el?.focus({ preventScroll: true });
  });
  const forget = () => {
    asked.current += 1;
    setCheck(null);
  };
  // Saving a key never turns the tester on by itself (review M2): the switch says Off until a key is saved, so `on`
  // starts false with the key, whatever an older save held, and only the switch turns it on.
  const save = () => {
    const key = typed.trim();
    if (key === '' || !update((x) => ({ ...x, key, on: false }))) return;   // refused: the key stays in the field
    setTyped('');
    forget();
    refocus.current = 'saved';
  };
  const remove = () => {
    if (!update((x) => ({ ...x, key: null, on: false }))) return;
    forget();
    refocus.current = 'heading';
  };
  const toggle = () => { update((x) => (x.key === null ? x : { ...x, on: !x.on })); };
  const choose = (model: SmartModelId) => {
    if (update((x) => (x.model === model ? x : { ...x, model }))) forget();
  };
  const test = () => {
    if (s.key === null || check === 'checking') return;
    const n = (asked.current += 1);
    setCheck('checking');
    void testKey(s.key, s.model).then((result) => { if (asked.current === n) setCheck(result); });
  };
  const resetCount = () => {
    if (update((x) => ({ ...x, checks: 0, spentUsd: 0 }))) refocus.current = 'usage';
  };
  const hasKey = s.key !== null;
  return (
    <Panel class="set-group smart-group">
      <h2 class="plabel" ref={heading} tabindex={-1}>Smart tester</h2>
      <p class="set-sub">
        Optional. Uses your own Claude API key to check lines the keyword rules couldn't place. Off until you add a key and
        turn it on.
      </p>
      {s.key !== null ? (
        <>
          <p class="smart-line" ref={savedLine} tabindex={-1}>Key saved on this phone, ending {s.key.slice(-4)}.</p>
          <div class="keys"><Secondary onClick={remove}>Remove key</Secondary></div>
        </>
      ) : (
        <>
          <label class="set-label" for={`${ids}-key`}>Claude API key</label>
          <input id={`${ids}-key`} class="set-input smart-key" type="password" value={typed}
            onInput={(e) => setTyped(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
            autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck={false} enterkeyhint="done" />
          <div class="keys"><Secondary disabled={typed.trim() === ''} onClick={save}>Save key</Secondary></div>
        </>
      )}
      <button type="button" class="switch-row" role="switch" aria-checked={s.on && hasKey} disabled={!hasKey}
        aria-labelledby={`${ids}-on`} aria-describedby={`${ids}-on-sub`} onClick={toggle}>
        <span class="switch-text">
          <span id={`${ids}-on`} class="switch-label">Use the smart tester</span>
          <span id={`${ids}-on-sub`} class="switch-sub">Needs a connection. Each check is billed to your Anthropic account.</span>
        </span>
        <span class="switch-state" aria-hidden="true">{s.on && hasKey ? 'On' : 'Off'}</span>
        <span class="switch" aria-hidden="true"><i /></span>
      </button>
      <fieldset class="smart-models">
        <legend class="set-label">Model</legend>
        <div class="choices">
          {SMART_MODELS.map((m) => (
            <label key={m.id} class="choice">
              <input type="radio" name={`${ids}-model`} value={m.id} checked={s.model === m.id} onChange={() => choose(m.id)}
                aria-labelledby={`${ids}-${m.id}`} aria-describedby={`${ids}-${m.id}-sub`} />
              <span class="choice-text">
                <span id={`${ids}-${m.id}`}>{m.label}</span>
                <span class="choice-sub" id={`${ids}-${m.id}-sub`}>{m.sub}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div class="keys"><Secondary disabled={!hasKey} onClick={test}>Test key</Secondary></div>
      <p class="set-sub smart-check" role="status">{check === null ? '' : check === 'checking' ? CHECKING_KEY : KEY_CHECK[check]}</p>
      <p class="smart-line tn" ref={usage} tabindex={-1}>
        {s.checks} {s.checks === 1 ? 'check' : 'checks'} so far on this phone, about US${s.spentUsd.toFixed(2)}.
      </p>
      <div class="keys">
        <Secondary disabled={s.checks === 0 && s.spentUsd === 0} onClick={resetCount}>Reset count</Secondary>
      </div>
      <p class="set-sub smart-about">
        When a line has a sentence the keyword rules couldn't place, EMTNotes sends Anthropic that sentence, the steps it
        could belong to, and the made-up case's complaint, type and ETA, and the patient's age, sex and race. It first
        replaces the made-up patient's name, IC number and address. Anything else in that sentence, such as your own name,
        goes as you said it. It never sends your other runs, quiz or notes. Anthropic also sees what any web request shows,
        such as your IP address.
      </p>
      <p class="set-sub">
        Your key stays in this browser on this phone and goes only to Anthropic. Anyone who can open EMTNotes on this phone
        can use it.
      </p>
      <p class="set-sub">Offline, or when a check takes longer than 6 seconds, the keyword rules grade the line on their own.</p>
    </Panel>
  );
}

// ---- Reset progress --------------------------------------------------------------------------------------------

const CONFIRM_WORD = 'RESET';

/**
 * Clears quiz history, reading place and runs, keeping settings and flags (store.resetProgress). The key stays
 * disabled until RESET is typed, in any case and with spaces around it, as a phone keyboard may leave them.
 */
function ResetGroup(): JSX.Element {
  const store = useStore();
  const [typed, setTyped] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const ids = useId();
  const ready = typed.trim().toUpperCase() === CONFIRM_WORD;
  const reset = () => {
    if (!ready) return;
    store.resetProgress();
    setTyped('');
    // While saves are held back (another window, an unreadable save, no storage) or failing, only memory was reset.
    const saved = store.writeBlock() === null && store.lastSaveError() === null;
    toast(saved ? 'Progress reset.' : 'Progress reset in this window, but not saved.');
    // The key is about to be disabled, which would drop focus to <body>; keep the place in this section.
    heading.current?.focus({ preventScroll: true });
  };
  return (
    <Panel class="set-group">
      <h2 class="plabel" ref={heading} tabindex={-1}>Reset progress</h2>
      <p class="set-sub" id={`${ids}-what`}>Clears quiz history, reading place and runs on this phone. Your settings stay.</p>
      <label class="set-label" for={`${ids}-confirm`}>Type RESET to confirm</label>
      <input id={`${ids}-confirm`} class="set-input" type="text" value={typed} aria-describedby={`${ids}-what`}
        onInput={(e) => setTyped(e.currentTarget.value)}
        autocapitalize="characters" autocomplete="off" autocorrect="off" spellcheck={false} enterkeyhint="done" />
      <div class="keys">
        <Secondary disabled={!ready} onClick={reset} describedBy={`${ids}-what`}>Reset progress</Secondary>
      </div>
    </Panel>
  );
}
