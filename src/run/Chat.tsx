// The run's chat (spec §6.2 and §8, mockup screen 2): the log of the run's lines, each with a visually hidden speaker
// prefix; under each of the trainee's lines what the run understood (its route); and, in Coached and drills, the
// tester's inline flags under the line holding them, each with "Not what I meant" (R9). The log is the run screen's
// only scroller. It keeps to the newest line while the trainee is within 80px of the end; otherwise new lines add up
// in a "↓ n new" pill that takes them there. A line the smart tester credited carries a "Smart tester" tag before its
// route (Plan 3 D15); lines still being read by a slow grader show under the log, outside it (D14).
import type { ComponentChildren, JSX, RefObject } from 'preact';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Case } from '../data/schema';
import type { ChatLine, InlineFlag, RunMode } from '../progress/types';
import { DRILL_SPEAKER, isDrillOpening } from '../sim/drill';
import { speakerLabel } from '../sim/replies';
import { Secondary } from '../ui/Keys';
import { StatusChip, chipFor } from '../ui/StatusChip';

/** How near the end the trainee must be for new lines to scroll into view (spec §8). */
const NEAR_END_PX = 80;
const DISPUTED = 'Disputed. Not counted.';
/** A pending line's route, while the run reads it. */
export const CHECKING = 'Checking…';

/**
 * The log, then `pending`: the trainee's lines still in the send queue, in order, as bubbles with the route "Checking…"
 * (Plan 3 D14; the run screen passes them once a line has waited 300 ms). They sit after the log, never in it, and are
 * hidden from screen readers: the composer's status line says "Checking your line.", and the line joins the log as it
 * is applied, so the log only ever gains its lines (§8).
 */
export function Chat({ lines, case: c, mode, disputes, onDispute, pending = [] }: { lines: ChatLine[]; case: Case; mode: RunMode;
  disputes: string[]; onDispute(key: string): void; pending?: string[] }): JSX.Element {
  const log = useRef<HTMLDivElement>(null);
  const { fresh, onScroll, toNewest } = useNewestInView(log, lines.length);
  const flagged = mode === 'coached';   // Exam keeps every fault for the debrief (spec §6.2); a drill is Coached
  return (
    <>
      {/* Focusable, so the log scrolls from a keyboard as well (a scroller with no control in it otherwise has none). */}
      <div class="chat" role="log" aria-label="Run chat" tabIndex={0} ref={log} onScroll={onScroll}>
        {lines.map((l, i) => (
          <Line key={i} line={l} case={c}>
            {flagged && l.flags?.map((f, j) => (
              <Flag key={j} flag={f} disputed={disputes.includes(f.point)} onDispute={onDispute} />
            ))}
          </Line>
        ))}
      </div>
      {pending.length > 0 && (
        <div class="chat-pending">
          {pending.map((text, i) => (
            <div key={i} class="msg me pending" aria-hidden="true">
              <span class="bub">{text}</span>
              <p class="route">{CHECKING}</p>
            </div>
          ))}
        </div>
      )}
      {fresh > 0 && (
        // over the foot of the chat, in its grid area
        <button type="button" class="newpill" onMouseDown={keepTyping} onClick={() => toNewest()}>
          <span aria-hidden="true">↓ </span>{fresh} new
        </button>
      )}
    </>
  );
}

/** A press (a tap or a click) on a chat key while a text field, the composer's, has focus: focus stays in the field,
 *  so the Android keyboard stays up and the trainee goes on typing. The key still acts on the click. Keyboard and
 *  screen-reader activation fire no mousedown, so they focus and act as usual. */
function keepTyping(e: MouseEvent): void {
  if (document.activeElement instanceof HTMLInputElement) e.preventDefault();
}

/** One line: the activation and other system lines as a centred card; the trainee's on the right with the route
 *  under the bubble; everyone else's on the left under their name. The line's flags follow it. */
function Line({ line, case: c, children }: { line: ChatLine; case: Case; children?: ComponentChildren }): JSX.Element {
  // a drill's opening line is the drill's, not Dispatch's, as the debrief's transcript reads it
  const who = line.who === 'system' && isDrillOpening(line.text) ? DRILL_SPEAKER : speakerLabel(line.who, c);
  const prefix = <span class="vh">{who}: </span>;
  if (line.who === 'system') return <><p class="syscard">{prefix}{line.text}</p>{children}</>;
  if (line.who === 'you') {
    // a step played from the step list says so, with its route ("Tapped: step 6, Introduction") or alone
    const route = line.route ?? (line.tapped ? 'Tapped' : undefined);
    const smart = line.smart === true;
    return (
      <>
        <div class={line.tapped ? 'msg me tapped' : 'msg me'}>
          <span class="bub">{prefix}{line.text}</span>
          {(route !== undefined || smart) && (
            <p class="route">
              {smart && <><SmartTag />{route !== undefined && ' '}</>}
              {route}
            </p>
          )}
        </div>
        {children}
      </>
    );
  }
  return (
    <>
      <div class="msg them">
        <p class="who" aria-hidden="true">{who}</p>
        <span class="bub">{prefix}{line.text}</span>
      </div>
      {children}
    </>
  );
}

/** Where a line's credit came from, when the smart tester gave it (D15): a quiet outlined tag, not a status chip, that
 *  a screen reader hears as a sentence of its own before the route. */
function SmartTag(): JSX.Element {
  return (
    <span class="stag">
      <span aria-hidden="true">Smart tester</span>
      <span class="vh">Checked by the smart tester.</span>
    </span>
  );
}

/** A tester flag: its chip and "Tester flag", "Not what I meant" (or, once disputed, the note that replaces it), then
 *  what the tester says, which describes the key, so each of several keys says which flag it disputes (final review M3). */
function Flag({ flag, disputed, onDispute }: { flag: InlineFlag; disputed: boolean; onDispute(key: string): void }): JSX.Element {
  const textId = `${useId()}-text`;
  const box = useRef<HTMLDivElement>(null);
  const note = useRef<HTMLParagraphElement>(null);
  const hadFocus = useRef(false);
  // The key goes once the point is disputed: focus that was on it moves to the note, not to the page.
  useLayoutEffect(() => {
    if (disputed && hadFocus.current) note.current?.focus();
    hadFocus.current = false;
  }, [disputed]);
  const dispute = () => {
    hadFocus.current = box.current !== null && box.current.contains(document.activeElement);
    onDispute(flag.point);
  };
  const chip = chipFor(flag.kind);
  return (
    <div class="flag" role="status" ref={box} data-tone={chip.kind === 'missed' ? 'hi' : 'med'}>
      <div class="flag-h" onMouseDownCapture={keepTyping}>
        <span class="flag-who"><StatusChip kind={chip.kind} label={chip.label} />Tester flag</span>
        {disputed
          ? <p class="flag-done" tabIndex={-1} ref={note}>{DISPUTED}</p>
          : <Secondary onClick={dispute} describedBy={textId}>Not what I meant</Secondary>}
      </div>
      <p id={textId}>{flag.text}</p>
    </div>
  );
}

/**
 * Keeps the log at its newest line while the trainee is at the end (within NEAR_END_PX), as a scroll listener tracks.
 * New lines then scroll into view; otherwise they add to `fresh`, which `toNewest()` or scrolling back to the end
 * clears. A run opens at its newest line, at once. The code sets scrollTop; the glide comes from CSS scroll-behavior,
 * so reduced motion makes it instant. While that glide runs its own scroll events still count as at the end.
 */
function useNewestInView(log: RefObject<HTMLDivElement>, count: number): { fresh: number; onScroll(): void; toNewest(): void } {
  const [fresh, setFresh] = useState(0);
  const atEnd = useRef(true);
  const glide = useRef<number | null>(null);   // where a glide to the end has got to, while it runs
  const seen = useRef(count);

  const toEnd = (instant: boolean) => {
    const el = log.current;
    if (el === null) return;
    atEnd.current = true;
    if (instant) {
      glide.current = null;
      el.style.scrollBehavior = 'auto';
      el.scrollTop = el.scrollHeight;
      el.style.scrollBehavior = '';
    } else {
      glide.current = el.scrollTop;
      el.scrollTop = el.scrollHeight;
    }
  };

  useLayoutEffect(() => { toEnd(true); }, []);

  useLayoutEffect(() => {
    const added = count - seen.current;
    seen.current = count;
    if (added <= 0) return;
    if (atEnd.current) toEnd(false);
    else setFresh((n) => n + added);
  }, [count]);

  // The Android keyboard shrinks the chat (interactive-widget=resizes-content): at the end, it stays at the end.
  useEffect(() => {
    const el = log.current;
    if (el === null || typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(() => { if (atEnd.current) toEnd(true); });
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  const onScroll = () => {
    const el = log.current;
    if (el === null) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_END_PX) {
      atEnd.current = true;
      glide.current = null;
      setFresh(0);
    } else if (glide.current !== null && el.scrollTop >= glide.current) {
      glide.current = el.scrollTop;   // the glide on its way down
    } else {
      glide.current = null;
      atEnd.current = false;
    }
  };

  const toNewest = () => {
    // a pill that had focus (a keyboard press) leaves it on the log, not the page, as it goes
    if (document.activeElement instanceof HTMLElement && document.activeElement.classList.contains('newpill')) {
      log.current?.focus({ preventScroll: true });
    }
    toEnd(false);
    setFresh(0);
  };

  return { fresh, onScroll, toNewest };
}
