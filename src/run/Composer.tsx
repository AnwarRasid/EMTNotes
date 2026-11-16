// The run's composer (spec §6.2, mockup screen 2): the Step list key in Coached and drills, the line the trainee types,
// and in the right-hand slot the banded key. Answering by Typing, that is Send, and a send keeps the field focused, so
// the Android keyboard stays up from one line to the next. Answering by Voice (Plan 3 Task 5, ruling D2), Send becomes
// a plain square key and the banded key is Speak (mockup .as-mic): each result heard goes into the field with soft
// sentence breaks, for the trainee to check, and only Send sends it (D4). A row over the keys shows the words being
// heard, then the whole line to be sent (the field, one line wide, shows only its end). The composer's one
// role="status" line says "Listening." and "Added to your line." for voice, and otherwise what `status` says (Task 9's
// "Checking your line."). A result that doesn't fit whole in the line's 600 characters toasts that the line is full
// instead (final review M1).
import type { JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { RUN_LIMITS, type AnswerBy } from '../progress/types';
import { appendHeard } from '../sim/softBreaks';
import { Icon } from '../ui/Icon';
import { toast } from '../ui/toast';
import { useVoice } from './useVoice';

const NOTE_ID = 'composer-note';
/** A line that didn't go through, put back in the empty field; or not, since the trainee has typed since. */
export const LINE_BACK = "That line didn't go through. It's back in the box.";
export const LINE_FAILED = "That line didn't go through.";
/** The composer's status line while listening, and once a result is in the field (until the field changes or Send). */
export const LISTENING = 'Listening.';
export const ADDED = 'Added to your line.';
/** The toast, in place of ADDED, when a result doesn't fit whole in the line's RUN_LIMITS.lineChars (final review M1). */
export const LINE_FULL = `Your line is full: ${RUN_LIMITS.lineChars} characters. Send it, then go on.`;
/** The row over the keys: the words heard so far while listening, then the line to be sent (task 5 fix round 1, I1). */
export const HEARING_LABEL = 'Hearing:';
export const LINE_LABEL = 'Your line:';

// ---- The draft (Plan 3 ruling D27) --------------------------------------------------------------------------------
// What is in the field, kept in sessionStorage per run, so a reload or a killed tab mid-line gives it back. A draft is a
// convenience: storage blocked, full or gone loses only it, never the line in the field.

const DRAFT_PREFIX = 'crewleader.draft.';

/** The sessionStorage key of run `runId`'s draft. */
export const draftKeyOf = (runId: string): string => `${DRAFT_PREFIX}${runId}`;

/** The draft saved under `key`, or '' for none (or no storage to read). */
function readDraft(key: string): string {
  try {
    return sessionStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

/** Saves `text` as the draft under `key`; an empty field leaves none. */
function writeDraft(key: string, text: string): void {
  try {
    if (text === '') sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, text);
  } catch {
    // blocked or full: the field still holds the line
  }
}

/** Drops run `runId`'s draft. */
export function clearDraft(runId: string): void {
  writeDraft(draftKeyOf(runId), '');
}

/** Drops every run's draft, as a run ends (finishRun): its own, and any a run replaced, restarted or discarded left.
 *  None is wanted any more, since no run's Undo can still be pending once a run ends: a Discard's lapses as a run
 *  opens, and a replace's as the run closes (Task 7 review, concern 4). */
export function clearDrafts(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (key !== null && key.startsWith(DRAFT_PREFIX)) keys.push(key);
    }
    for (const key of keys) sessionStorage.removeItem(key);
  } catch {
    // blocked: the drafts stay, each keyed to a run that is gone and never shown in another
  }
}

/**
 * The composer form. A submit (Send, or the keyboard's send key) trims the line, ignores an empty one, passes the rest
 * to `onSend`, then clears the field. Typing keeps focus on the field; Voice leaves it where it was (on Speak, so the
 * keyboard stays down). When `onSend` returns a promise that resolves false (the line didn't go through), the line
 * comes back into the field if nothing has been typed there since. `disabled` turns the field, Send, Speak and the Step
 * list key off (a step tapped is a line too); `note` says why, above them.
 *
 * Voice (`answerBy` 'voice', where the browser has a recogniser): Speak taps listening on and off. A result goes into
 * the field through appendHeard, with `callName` as a break cue, and the field scrolls to its newest words; focus stays
 * where it is, and nothing is sent. While listening the row over the keys says "Hearing: {the words so far}"; after a
 * result it says "Your line: {the field}" until Send or an edit, so the whole line can be checked with the keyboard
 * down. Send, `hold` (the Pause sheet), a hidden page and unmounting all drop the listening.
 *
 * The draft (`draftKey`, ruling D27): the field is saved in sessionStorage on every edit, after each result heard and
 * when a line comes back. A line sent stays the draft until it is done with (Task 7 review M2): a slow grader reads it
 * for seconds before it reaches the save, and a tab killed meanwhile gives it back. Once `onSend`'s promise settles
 * true (or at once, for an onSend with no promise), the draft goes, unless something typed since has taken its place.
 * Mounting with an empty field puts the saved draft back, so a reload mid-line keeps it, in Typing and in Voice; but
 * not a line still being read (`sending`, the run's queue), which the step list's close would otherwise give back.
 */
export function Composer({ onSend, disabled, showStepList, onStepList, note, answerBy, callName, hold, status, draftKey,
  sending = [] }: {
  onSend(text: string): void | Promise<boolean>; disabled: boolean; showStepList: boolean; onStepList(): void; note?: string;
  answerBy: AnswerBy; callName: string; hold: boolean; status?: string; draftKey: string; sending?: readonly string[] }): JSX.Element {
  const field = useRef<HTMLInputElement>(null);
  const [added, setAdded] = useState(false);   // "Added to your line.": a result went in, and nothing since
  const [line, setLine] = useState<string | null>(null);   // the field after the last result, shown until Send or an edit
  const voice = useVoice({
    hold,
    onFinal: (text) => {
      const el = field.current;
      if (el === null) return;
      const whole = appendHeard(el.value, text, callName, Infinity);
      const kept = whole.slice(0, RUN_LIMITS.lineChars);
      el.value = kept;
      el.scrollLeft = el.scrollWidth;   // an unfocused field shows its start: show the newest words instead
      writeDraft(draftKey, el.value);   // set by script, so no input event saves it
      // cut at the line's limit (its newest words, or all of them, left out): never "Added", but the line is full (M1)
      const cut = whole.length > kept.length;
      setAdded(!cut);
      if (cut) toast(LINE_FULL);
      setLine(el.value);
    },
  });
  const speaking = answerBy === 'voice' && voice.supported;
  const describedBy = note !== undefined ? NOTE_ID : undefined;
  // The saved draft, into the field as it mounts empty, before the paint. It is the step list's draft too: when the
  // list closes, the run screen's layout effect, which runs after ours, finds the field filled and leaves it.
  useLayoutEffect(() => {
    const el = field.current;
    if (el === null || el.value !== '') return;
    const saved = readDraft(draftKey);
    if (saved === '' || sending.includes(saved.trim())) return;   // a line still being read is on its way, not a draft
    el.value = saved;
    el.scrollLeft = el.scrollWidth;   // the newest words, as after a result
  }, []);
  // A line already in the field as the composer mounts (the draft, or the step list's draft the run screen gives back
  // with no saved one) is in Voice still the line to check. The run screen's layout effect runs after ours, so this
  // waits for the paint.
  useEffect(() => {
    const el = field.current;
    if (speaking && el !== null && el.value.trim() !== '') setLine(el.value);
  }, []);

  const submit = (e: Event) => {
    e.preventDefault();
    const el = field.current;
    if (el === null || disabled) return;
    voice.stop();
    setAdded(false);
    setLine(null);
    const text = el.value.trim();
    if (!speaking) el.focus();
    if (text === '') return;
    const raw = el.value;   // as the draft holds it, spaces and all
    const sent = onSend(text);
    el.value = '';
    // the draft keeps the line until it is done with (M2); something typed meanwhile replaces it, as any edit does
    if (sent instanceof Promise) void sent.then((ok) => { if (ok) dropSent(raw); else giveBack(text); });
    else dropSent(raw);
  };
  /** The line is in the run now: its draft goes, unless the draft is something else by now (typed since), or the
   *  field holds the same words again. */
  const dropSent = (raw: string) => {
    if (readDraft(draftKey) === raw && field.current?.value !== raw) writeDraft(draftKey, '');
  };
  const giveBack = (text: string) => {
    const el = field.current;
    if (el !== null && el.value === '') {
      el.value = text;
      writeDraft(draftKey, text);
      toast(LINE_BACK);
    } else {
      toast(LINE_FAILED);
    }
  };
  const speak = () => {
    if (!voice.listening) setAdded(false);   // the line stays shown: after a listening with no result it is still to send
    voice.toggle();
  };
  const edited = () => {
    writeDraft(draftKey, field.current?.value ?? '');
    setAdded(false);
    setLine(null);
  };
  const said = speaking && voice.listening ? LISTENING : added ? ADDED : status ?? '';

  return (
    <form class="composer" onSubmit={submit}>
      {note !== undefined && <p class="composer-note" id={NOTE_ID}>{note}</p>}
      {/* Shown, not read out: the status line says "Listening.", and TalkBack reads the field itself. */}
      {speaking && voice.listening && <HearRow label={HEARING_LABEL} text={voice.hearing || '…'} lines={2} />}
      {speaking && !voice.listening && line !== null && <HearRow label={LINE_LABEL} text={line} lines={3} />}
      {showStepList && (
        <button type="button" class="sq" aria-label="Step list" disabled={disabled} aria-describedby={describedBy}
          onClick={() => onStepList()}><Icon name="list" /></button>
      )}
      <input ref={field} class="cinput" type="text" enterkeyhint="send" autocomplete="off" autocapitalize="sentences"
        maxlength={RUN_LIMITS.lineChars} aria-label="Speak to the scene" placeholder="Speak to the scene" disabled={disabled}
        aria-describedby={describedBy} onInput={edited} />
      {/* A press on Send keeps focus where it is: in the field, so the keyboard doesn't drop between lines; on Speak. */}
      <button class={speaking ? 'sq' : 'send'} type="submit" aria-label="Send" disabled={disabled} onMouseDown={(e) => e.preventDefault()}>
        <Icon name="send" />
      </button>
      {speaking && (
        <button type="button" class="mic" aria-label="Speak" aria-pressed={voice.listening} disabled={disabled}
          aria-describedby={describedBy} onClick={speak}><Icon name="mic" /></button>
      )}
      <p class="vh" role="status">{said}</p>
    </form>
  );
}

/**
 * The row over the keys: `label`, then `text`, in at most `lines` lines (its max-height). A longer text loses its start
 * to "…", whole words at a time, so the label and the newest words stay in view; the fewest words go that fit. The
 * words are measured in the layout, so they are written here and never by the render (jsdom has no layout: there they
 * stay whole). aria-hidden: the status line and the field say it to TalkBack.
 */
function HearRow({ label, text, lines }: { label: string; text: string; lines: 2 | 3 }): JSX.Element {
  const row = useRef<HTMLParagraphElement>(null);
  const words = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const p = row.current;
    const w = words.current;
    if (p === null || w === null) return;
    const fit = () => {
      w.textContent = text;
      const over = () => p.scrollHeight > p.clientHeight + 1;
      const parts = text.split(' ');
      if (!over() || parts.length < 2) return;
      const from = (n: number) => { w.textContent = `…${parts.slice(n).join(' ')}`; };
      let lo = 1;   // the fewest words dropped that fit, by bisection: more dropped never fits worse
      let hi = parts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        from(mid);
        if (over()) lo = mid + 1;
        else hi = mid;
      }
      from(lo);
    };
    fit();
    window.addEventListener('resize', fit);   // a turn of the phone changes the width, so what fits
    return () => window.removeEventListener('resize', fit);
  }, [text, lines]);
  return (
    <p class="composer-hear" data-lines={lines} ref={row} aria-hidden="true">
      <span class="hear-k">{label}</span> <span class="hear-w" ref={words} />
    </p>
  );
}
