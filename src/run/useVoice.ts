// The composer's voice (Plan 3 Task 5; rulings D3 to D6): the Speak key taps listening on and off, the words heard so
// far show over the keys, each settled result goes to `onFinal` (the composer adds it to its field), and a failure
// toasts what to do. Voice never sends. Listening is dropped when `hold` turns true (the Pause sheet), when the page is
// hidden or left, and when the composer goes (Send calls `stop`; the step list unmounts it).
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { haptic } from '../lib/haptics';
import { useStore } from '../progress/hooks';
import { toast } from '../ui/toast';
import { VOICE_COPY, listen, voiceSupported, type Listening } from '../voice/speech';

/** One listening: its handle once listen has returned it. Events from any listening but the current one are ignored. */
interface Session { handle: Listening | null }

/**
 * - `supported`: the browser has a recogniser (else the composer is the typing one).
 * - `listening`: from a press on Speak until the recogniser ends, or the listening is dropped.
 * - `hearing`: the interim words, while listening.
 * - `toggle()`: Speak. Not listening: listen, with a tap buzz (not while `hold`). Listening: stop, keeping what was
 *   heard, which comes as a final before the end.
 * - `stop()`: drop the listening now (abort), with nothing more heard.
 */
export function useVoice(o: { onFinal(text: string): void; hold: boolean }):
  { supported: boolean; listening: boolean; hearing: string; toggle(): void; stop(): void } {
  const store = useStore();
  const [supported] = useState(() => voiceSupported());
  const [listening, setListening] = useState(false);
  const [hearing, setHearing] = useState('');
  const latest = useRef(o);
  latest.current = o;
  const current = useRef<Session | null>(null);

  /** `s` is over (it ended, or was dropped): the key lets go and its words leave, if it is still the current one. */
  const release = useCallback((s: Session) => {
    if (current.current !== s) return;
    current.current = null;
    setListening(false);
    setHearing('');
  }, []);

  const stop = useCallback(() => {
    const s = current.current;
    if (s === null) return;
    release(s);
    s.handle?.abort();
  }, [release]);

  const toggle = useCallback(() => {
    const now = current.current;
    if (now !== null) {
      now.handle?.stop();
      return;
    }
    if (latest.current.hold) return;
    const mine: Session = { handle: null };
    current.current = mine;
    const mineNow = () => current.current === mine;
    const handle = listen({
      start: () => { if (mineNow()) setListening(true); },
      interim: (text) => { if (mineNow()) setHearing(text); },
      final: (text) => {
        if (!mineNow()) return;
        setHearing('');
        latest.current.onFinal(text);
      },
      error: (e) => { if (mineNow()) toast(VOICE_COPY[e]); },
      end: () => release(mine),
    });
    if (handle === null) {   // the recogniser went since the composer mounted
      release(mine);
      return;
    }
    if (!mineNow()) return;   // it failed as it started, and has ended
    mine.handle = handle;
    setListening(true);
    haptic('tap', store.get().settings.haptics);
  }, [store, release]);

  useEffect(() => {
    if (o.hold) stop();
  }, [o.hold, stop]);

  useEffect(() => {
    const onVisibility = () => { if (document.visibilityState === 'hidden') stop(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', stop);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', stop);
      const s = current.current;   // unmounted: drop it, with no state left to set
      current.current = null;
      s?.handle?.abort();
    };
  }, [stop]);

  return { supported, listening, hearing, toggle, stop };
}
