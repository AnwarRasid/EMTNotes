// The Web Speech wrapper (Plan 3 Task 5; rulings D1, D5, D6, D9): one listening, from a press on Speak to the
// recogniser's end of it, in Singapore English with British English as the one fallback. It uses SpeechRecognition,
// else Chrome's webkitSpeechRecognition (Safari's goes the same way, untested). Android Chrome usually sends the audio
// to its speech service, so a listening can fail offline; the mic is never blocked for that, since some phones
// recognise on the device, and each failure comes back as a VoiceError the composer toasts. Nothing here sends a line:
// the words heard go to `final`, and the composer puts them in its field. Only src/run/useVoice.ts listens; Run start
// asks voiceSupported.

export type VoiceError = 'not-allowed' | 'network' | 'no-speech' | 'audio-capture' | 'language' | 'other';
/** What a listening reports: the mic opened (`start`), words so far (`interim`), words settled (`final`, once each), a
 *  failure (`error`, at most once), and the end, once, last. */
export interface VoiceHandlers { start(): void; interim(text: string): void; final(text: string): void; error(e: VoiceError): void; end(): void }
/** `stop` ends the listening, keeping what was heard (the recogniser gives its last final, then ends); `abort` drops it,
 *  and nothing more is heard. */
export interface Listening { stop(): void; abort(): void }

/** The recogniser's language: Singapore English, then British English where Chrome can't take en-SG. */
export const VOICE_LANGS = ['en-SG', 'en-GB'] as const;

/** Each failure's toast: what happened, and what to do. */
export const VOICE_COPY: Record<VoiceError, string> = {
  'not-allowed': "EMTNotes can't use the mic. Allow it in Chrome's site settings, or type instead.",
  network: 'Voice needs a connection right now. Type instead.',
  'no-speech': "Didn't catch that. Tap the mic and try again.",
  'audio-capture': 'No mic found on this phone. Type instead.',
  language: "Chrome can't take speech in English here. Type instead.",
  other: 'Voice stopped. Tap the mic to try again.',
};

/** The recogniser's error codes, as VoiceError. 'aborted' gives none, and 'language-not-supported' retries first. */
const ERRORS: ReadonlyMap<string, VoiceError> = new Map([
  ['not-allowed', 'not-allowed'], ['service-not-allowed', 'not-allowed'],
  ['network', 'network'], ['no-speech', 'no-speech'], ['audio-capture', 'audio-capture'],
]);

// The part of a recogniser the wrapper uses. TypeScript's DOM lib types its events, but not the recogniser itself.
interface Alternative { readonly transcript: string }
interface RecognitionResult { readonly isFinal: boolean; readonly [index: number]: Alternative | undefined }
interface ResultEvent { readonly resultIndex: number; readonly results: ArrayLike<RecognitionResult> }
interface Recogniser {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((e: ResultEvent) => void) | null;
  onerror: ((e: { readonly error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
type RecogniserClass = new () => Recogniser;

const here = (): Window | undefined => (typeof window === 'undefined' ? undefined : window);

function recogniserIn(win: Window | undefined): RecogniserClass | null {
  const w = win as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown } | undefined;
  const Rec = w?.SpeechRecognition ?? w?.webkitSpeechRecognition;
  return typeof Rec === 'function' ? (Rec as RecogniserClass) : null;
}

/** Whether `win` (the page's window by default) has a speech recogniser. */
export function voiceSupported(win: Window | undefined = here()): boolean {
  return recogniserIn(win) !== null;
}

/**
 * Starts one listening on `win`'s recogniser, or null where there is none. It is one short utterance (D5: continuous
 * off, since Android Chrome's continuous mode repeats its finals), with interim results and one alternative, in
 * en-SG. A 'language-not-supported' error starts a second recogniser in en-GB once that one ends, as the same
 * listening; a second one is the 'language' error. After `abort`, nothing more is reported but the end.
 */
export function listen(h: VoiceHandlers, win: Window | undefined = here()): Listening | null {
  const Rec = recogniserIn(win);
  if (Rec === null) return null;
  let rec: Recogniser | null = null;   // the recogniser listening now
  let lang = 0;                        // its language, in VOICE_LANGS
  let retry = false;                   // its language wasn't supported: its end starts the next one
  let opened = false;                  // start reported
  let quit: 'stop' | 'abort' | null = null;
  let ended = false;

  const end = () => {
    if (ended) return;
    ended = true;
    rec = null;
    h.end();
  };
  const begin = () => {
    const r = new Rec();
    r.lang = VOICE_LANGS[lang] ?? 'en-GB';
    r.continuous = false;
    r.interimResults = true;
    r.maxAlternatives = 1;
    let given = 0;   // the results already given as finals: an event lists the session's earlier ones again
    retry = false;
    const live = () => rec === r && quit !== 'abort';
    r.onstart = () => {
      if (!live() || opened) return;
      opened = true;
      h.start();
    };
    r.onresult = (e) => {
      if (!live()) return;
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (result === undefined) continue;
        const text = (result[0]?.transcript ?? '').trim();
        if (!result.isFinal) interim = `${interim} ${text}`.trim();
        else if (i >= given) {
          given = i + 1;
          if (text !== '') h.final(text);
        }
      }
      if (interim !== '') h.interim(interim);
    };
    r.onerror = (e) => {
      if (!live() || e.error === 'aborted') return;
      if (e.error === 'language-not-supported') {
        if (lang + 1 < VOICE_LANGS.length && quit === null) retry = true;
        else h.error('language');
        return;
      }
      h.error(ERRORS.get(e.error) ?? 'other');
    };
    r.onend = () => {
      if (rec !== r) return;
      if (retry && quit === null) {
        lang += 1;
        begin();
      } else {
        end();
      }
    };
    rec = r;
    try {
      r.start();
    } catch {
      // Already listening elsewhere, or refused outright: no events will come from this one.
      rec = null;
      h.error('other');
      end();
    }
  };

  begin();
  return {
    stop: () => {
      if (quit === null) quit = 'stop';
      rec?.stop();
    },
    abort: () => {
      quit = 'abort';
      rec?.abort();
    },
  };
}
