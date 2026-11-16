// The quiz session (#/quiz/session), a focus screen: one question at a time, in practice, test or review (spec §6.4).
// Practice and review grade on Check and show the feedback; a test grades on Next and shows nothing until the result.
// Every key reads the session from the store when it acts, never from the render it was drawn in, so a double tap
// can't apply an answer twice or skip a question.
import type { JSX, RefObject } from 'preact';
import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { FocusHeader } from '../app/FocusHeader';
import { matchRoute, navigate } from '../app/routes';
import { useContent } from '../data/load';
import { questionLabel, type Question } from '../data/questions';
import type { NotesDoc } from '../data/schema';
import { haptic } from '../lib/haptics';
import { mulberry32, randomSeed, type Rng } from '../lib/rng';
import { useProgress, useStore } from '../progress/hooks';
import type { ProgressStore } from '../progress/store';
import type { AnswerRecord, Progress, QuizSession as Session } from '../progress/types';
import { Primary } from '../ui/Keys';
import { Panel } from '../ui/Panel';
import { Skeleton, useDelayedFlag } from '../ui/Skeleton';
import { applyAnswer, check, current, isFinished, next, pick, resumeSession, score, statOf } from './engine';
import { Feedback } from './Feedback';
import { OptionList } from './OptionList';
import { QuestionsError } from './QuizTab';
import { MODE_TITLES, filterLabel, reviewDismissed, reviewKey, reviewLeft, withinHold } from './useQuiz';

type ById = Map<string, Question>;

export function QuizSession(): JSX.Element {
  const store = useStore();
  const session = useProgress((p) => p.quizOpen);
  const content = useContent('questions');
  const notesContent = useContent('notes');   // only for the notes link's label; "Notes 11" without it
  const late = useDelayedFlag(content.status === 'loading');
  const questions = content.status === 'ready' ? content.data : null;
  const byId = useMemo(() => (questions ? new Map(questions.map((q) => [q.id, q])) : null), [questions]);
  const rng = useMemo(() => mulberry32(randomSeed()), []);
  const resumed = useResume(store, byId, rng, session);

  return (
    <div class="qs">
      <FocusHeader exit="close" onExit={() => navigate('/quiz')}
        title={session ? MODE_TITLES[session.mode] : 'Quiz'}
        sub={session ? filterLabel(session.filter) : undefined}
        right={session && resumed ? <Count s={session} /> : undefined} />
      {content.status === 'error' ? <div class="qs-body"><QuestionsError onRetry={content.retry} /></div>
        : resumed && session && byId
          ? <Turn session={session} byId={byId} rng={rng} notes={notesContent.status === 'ready' ? notesContent.data : null} />
          // Sized like the bank line, the stem and four options.
          : late && <div class="qs-body"><Skeleton rows={3} rowHeight={['1.25rem', '5.5rem', '15.5rem']} /></div>}
    </div>
  );
}

/**
 * Resumes the saved quiz against the bank once the bank has loaded, and saves what resumeSession returns when that
 * differs (ids gone from the bank dropped, orders rebuilt). With no quiz open, or nothing of it left to ask, it clears the quiz and goes
 * to the Quiz tab. Resumes once, before paint, so the screen never draws a session the bank no longer matches.
 * A quiz that goes later, while the screen is up (Try again adopting a save without one), sends it to the Quiz tab
 * too, rather than leave a dead screen. A finished quiz has already gone on to its result, and this route with it.
 */
function useResume(store: ProgressStore, byId: ById | null, rng: Rng, session: Session | null): boolean {
  const [resumed, setResumed] = useState(false);
  useLayoutEffect(() => {
    const open = store.get().quizOpen;
    if (open === null) {
      if (matchRoute(location.hash).def.name === 'quizSession') navigate('/quiz', { replace: true });
      return;
    }
    if (resumed || byId === null) return;   // resumed already, or the bank is loading (or failed to)
    const s = resumeSession(open, byId, rng);
    // resumeSession always returns a new object; save it only when the bank changed something (a slot write per visit)
    if (s === null || JSON.stringify(s) !== JSON.stringify(open)) store.update((p) => ({ ...p, quizOpen: s }));
    if (s === null) navigate('/quiz', { replace: true });
    else setResumed(true);
  }, [byId, resumed, session]);
  return resumed;
}

/** The header's counter: "18 of 20", counting the question showing until Next; in review, "3 left". */
function Count({ s }: { s: Session }): JSX.Element {
  return s.mode === 'review'
    ? <span class="count tn"><b>{reviewLeft(s)}</b> left</span>
    : <span class="count tn"><b>{s.done.length + (s.checked ? 0 : 1)}</b> of {s.total}</span>;
}

// ---- Acting on the store -------------------------------------------------------------------------------------

/** The open quiz in `p` and the question it is showing. */
function showing(p: Progress, byId: ById): { s: Session; q: Question } | null {
  const s = p.quizOpen;
  const id = s ? current(s) : null;
  const q = id === null ? undefined : byId.get(id);
  return s && q ? { s, q } : null;
}

/** Grades the pick and applies it to the stats, in one save. Null when there is nothing to grade: no pick yet, or an
 *  earlier tap already checked it. */
function checkPick(store: ProgressStore, byId: ById): AnswerRecord | null {
  const out: { record: AnswerRecord | null } = { record: null };
  store.update((p) => {
    const h = showing(p, byId);
    if (!h) return p;
    const { session, record } = check(h.s, h.q, statOf(p.questions, h.q.id), new Date());
    if (!record) return p;
    out.record = record;
    return { ...p, quizOpen: session, questions: applyAnswer(p.questions, record) };
  });
  return out.record;
}

/** Moves on from a checked question, or in a test grades the pick first (a test's Next does both), then shows the
 *  next question. A finished session becomes quizLast and opens the result. Returns false when there was nothing
 *  to move on from. Practice and review never move on unchecked: their feedback comes first. */
function moveOn(store: ProgressStore, byId: ById, rng: Rng): boolean {
  const out = { moved: false, finished: false };
  store.update((p) => {
    const h = showing(p, byId);
    if (!h) return p;
    let s = h.s;
    let questions = p.questions;
    if (s.checked === null) {
      if (s.mode !== 'test') return p;
      const r = check(s, h.q, statOf(questions, h.q.id), new Date());
      if (!r.record) return p;   // nothing picked yet
      s = r.session;
      questions = applyAnswer(questions, r.record);
    }
    const n = next(s, byId, rng);
    out.moved = true;
    if (!isFinished(n)) return { ...p, questions, quizOpen: n };
    out.finished = true;
    return { ...p, questions, quizOpen: null, quizLast: n };
  });
  if (out.finished) navigate('/quiz/result', { replace: true });   // Back then skips the spent session
  return out.moved;
}

/** Focuses the question's first option, or the action key once the options are locked. */
function focusQuestion(root: HTMLElement | null): void {
  const target = root?.querySelector<HTMLElement>('.opts input:not(:disabled)') ?? document.querySelector<HTMLElement>('.qkeys .primary');
  target?.focus({ preventScroll: true });
}

/** When Next shows another question, start it at the top with focus on its first option, so a screen reader reads
 *  the new stem. Before paint, so it never shows scrolled down. Not on the first render: the shell focuses the
 *  screen's heading then. */
function useNewQuestion(turn: number, body: RefObject<HTMLElement>): void {
  const shown = useRef(turn);
  useLayoutEffect(() => {
    if (shown.current === turn) return;
    shown.current = turn;
    (document.scrollingElement ?? document.documentElement).scrollTop = 0;
    focusQuestion(body.current);
  }, [turn]);
}

// ---- The question showing ------------------------------------------------------------------------------------

function Turn({ session, byId, rng, notes }: { session: Session; byId: ById; rng: Rng; notes: NotesDoc | null }): JSX.Element | null {
  const store = useStore();
  const dismissed = useProgress((p) => p.dismissedReview);
  const body = useRef<HTMLDivElement>(null);
  // Which question this is: one more each time Next moves on, the same across Check (and when review re-shows one).
  const turn = session.done.length - (session.checked ? 1 : 0);
  const [shake, setShake] = useState<number | null>(null);
  const checkedAt = useRef<number | null>(null);   // performance.now() of the Check that revealed the feedback
  useNewQuestion(turn, body);

  const id = current(session);
  const q = id === null ? undefined : byId.get(id);
  if (!q) return null;   // resumeSession keeps the head in the bank

  const order = Object.hasOwn(session.orders, q.id) ? session.orders[q.id]! : q.options.map((o) => o.id);
  const reveal = session.mode !== 'test';
  const { right, answered } = score(session);
  const last = session.queue.length <= 1;   // after a wrong review answer, its copy waits on the queue
  const haptics = () => store.get().settings.haptics;

  const onPick = (optionId: string) => store.update((p) => {
    const n = p.quizOpen ? pick(p.quizOpen, optionId) : null;
    return n && n !== p.quizOpen ? { ...p, quizOpen: n } : p;
  });
  const onCheck = () => {
    const record = checkPick(store, byId);
    if (!record) return;
    checkedAt.current = performance.now();
    haptic(record.right ? 'right' : 'wrong', haptics());
    if (!record.right) setShake(turn);
  };
  // Check's key becomes Next question in place, so it ignores presses for READ_HOLD_MS after Check, however they
  // come (tap, click, Enter or Space). A question resumed already checked has no Check to time from.
  const onNext = () => {
    if (!withinHold(checkedAt.current)) moveOn(store, byId, rng);
  };
  const onTestNext = () => {
    if (moveOn(store, byId, rng)) haptic('tap', haptics());   // a test never says right or wrong, even by touch
  };
  const dismiss = () => {
    const k = reviewKey(q);
    store.update((p) => (p.dismissedReview.includes(k) ? p : { ...p, dismissedReview: [...p.dismissedReview, k] }));
    focusQuestion(body.current);   // Dismiss is about to go
  };

  return (
    <>
      <div class="qs-body" ref={body}>
        <p class="qbank">{questionLabel(q)}</p>
        {q.passage && <Panel as="div" class="passage"><p>{q.passage}</p></Panel>}
        {q.image && <img class="qimg" src={import.meta.env.BASE_URL + q.image} alt="ECG strip for this question" />}
        {q.review.length > 0 && !reviewDismissed(dismissed, q) && (
          <div class="qreview">
            <p class="qreview-msg">Under review: {q.review.join(' ')}</p>
            <button type="button" class="link" onClick={dismiss}>Dismiss</button>
          </div>
        )}
        {/* Keyed by turn, so each question gets fresh radios. */}
        <div key={turn} class={shake === turn ? 'qopts shake' : 'qopts'}
          onAnimationEnd={(e) => { if (e.animationName === 'opt-shake') setShake(null); }}>
          <OptionList q={q} order={order} picked={session.picked} checked={session.checked} reveal={reveal} onPick={onPick} />
        </div>
        <div aria-live="polite">
          {reveal && session.checked && <Feedback q={q} order={order} record={session.checked} notes={notes} />}
        </div>
      </div>
      <div class={reveal ? 'qkeys' : 'qkeys qkeys-one'}>
        {reveal && answered > 0 && <p class="score tn"><b>{right}</b> of {answered} right</p>}
        {!reveal
          ? <Primary disabled={session.picked === null} onClick={onTestNext}>{last ? 'Finish test' : 'Next'}</Primary>
          : session.checked === null
            ? <Primary disabled={session.picked === null} onClick={onCheck}>Check</Primary>
            : <Primary onClick={onNext}>{last ? 'See results' : 'Next question'}</Primary>}
      </div>
    </>
  );
}
