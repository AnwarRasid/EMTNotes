// The result of the last finished quiz (#/quiz/result), a focus screen (spec §6.4): the score, then each question
// with Right or Wrong, a wrong one opening out to its pick, its answer, the explanation and its notes link. Picks and
// answers show as option text, not letters: a question review showed twice was shuffled again, so its letters changed.
import type { JSX } from 'preact';
import { useLayoutEffect, useMemo, useRef } from 'preact/hooks';
import { FocusHeader } from '../app/FocusHeader';
import { matchRoute, navigate } from '../app/routes';
import { useContent } from '../data/load';
import { questionLabel, type Question } from '../data/questions';
import type { NotesDoc } from '../data/schema';
import { useProgress, useStore } from '../progress/hooks';
import type { AnswerRecord, QuizFilter, QuizMode, QuizSession as Session } from '../progress/types';
import { Primary, Secondary } from '../ui/Keys';
import { Skeleton, useDelayedFlag } from '../ui/Skeleton';
import { StatusChip } from '../ui/StatusChip';
import { clearedCount, score } from './engine';
import { NotesLink, SourceLine } from './Feedback';
import { QuestionsError } from './QuizTab';
import { ALL_QUESTIONS, filterLabel, startQuiz, withinHold } from './useQuiz';

const TITLES: Record<QuizMode, string> = { practice: 'Practice results', test: 'Test results', review: 'Review results' };

export function QuizResult(): JSX.Element {
  const store = useStore();
  const last = useProgress((p) => p.quizLast);
  const content = useContent('questions');
  const late = useDelayedFlag(content.status === 'loading');

  // Nothing finished yet, or the result went while it was up (Try again adopting a save without one).
  useLayoutEffect(() => {
    if (store.get().quizLast === null && matchRoute(location.hash).def.name === 'quizResult') navigate('/quiz', { replace: true });
  }, [last]);

  return (
    <div class="qs">
      <FocusHeader exit="close" onExit={() => navigate('/quiz')}
        title={last ? TITLES[last.mode] : 'Results'} sub={last ? filterLabel(last.filter) : undefined} />
      {last && (content.status === 'ready' ? <Result s={last} questions={content.data} />
        : content.status === 'error' ? <div class="qs-body"><QuestionsError onRetry={content.retry} /></div>
        // Sized like the score and the first rows.
        : late && <div class="qs-body"><Skeleton rows={3} rowHeight={['3rem', '6rem']} /></div>)}
    </div>
  );
}

/** One row per question, in the order first asked, with its last answer: review can ask one several times. */
function lastAnswers(s: Session, byId: Map<string, Question>): { q: Question; record: AnswerRecord }[] {
  const lastOf = new Map<string, AnswerRecord>();
  for (const r of s.done) lastOf.set(r.qid, r);   // a Map keeps a key where it was first set
  return [...lastOf.values()].flatMap((record) => {
    const q = byId.get(record.qid);
    return q ? [{ q, record }] : [];   // gone from the bank since
  });
}

function Result({ s, questions }: { s: Session; questions: Question[] }): JSX.Element {
  const store = useStore();
  const stats = useProgress((p) => p.questions);
  const notesContent = useContent('notes');   // only for the notes links' labels; "Notes 11" without it
  const notes = notesContent.status === 'ready' ? notesContent.data : null;
  const byId = useMemo(() => new Map(questions.map((q) => [q.id, q])), [questions]);
  const rows = useMemo(() => lastAnswers(s, byId), [s, byId]);
  // Review asks until each is right twice, so its right answers can outnumber its questions; it counts what cleared.
  const cleared = useMemo(() => clearedCount(rows.map((r) => r.q), stats), [rows, stats]);
  // The result replaces the session in the same render: See results sits where Practise 20 more lands, and Finish test
  // spans New test and Done. So both keys ignore presses for READ_HOLD_MS after they appear, as Next question does
  // after Check: the second tap of a double tap must not skip the result. A held press does nothing, focus included.
  const shownAt = useRef(performance.now());

  /** Another round like this one: the same bank and topic, falling back to both banks if those have gone. */
  const again = () => {
    if (withinHold(shownAt.current)) return;
    const done = store.get().quizLast;
    if (!done) return;
    const f: QuizFilter = { group: done.filter.group, topic: done.filter.topic };
    if (done.mode === 'test') {
      const n = done.total > 20 ? 50 : 20;
      if (!startQuiz(store, questions, 'test', f, n)) startQuiz(store, questions, 'test', ALL_QUESTIONS, n);
    } else if (!startQuiz(store, questions, 'practice', f)) {
      startQuiz(store, questions, 'practice', ALL_QUESTIONS);
    }
  };

  return (
    <>
      <div class="qs-body">
        <p class="rscore tn">
          {s.mode === 'review' ? <>Cleared <b>{cleared}</b> of {s.total}</> : <><b>{score(s).right}</b> of {s.total} right</>}
        </p>
        <ul class="rlist">
          {rows.map(({ q, record }) => <ResultRow key={q.id} q={q} record={record} notes={notes} />)}
        </ul>
      </div>
      <div class="qkeys">
        <Secondary onClick={() => { if (!withinHold(shownAt.current)) navigate('/quiz'); }}>Done</Secondary>
        <Primary onClick={again}>{s.mode === 'test' ? 'New test' : 'Practise 20 more'}</Primary>
      </div>
    </>
  );
}

const textOf = (q: Question, id: string) => q.options.find((o) => o.id === id)?.text ?? 'An answer that has since changed';

function ResultRow({ q, record, notes }: { q: Question; record: AnswerRecord; notes: NotesDoc | null }): JSX.Element {
  return (
    <li class="panel rrow">
      <div class="rrow-head">
        <p class="rrow-bank">{questionLabel(q)}</p>
        <StatusChip kind={record.right ? 'done' : 'missed'} label={record.right ? 'Right' : 'Wrong'} />
      </div>
      <p class="rrow-stem">{q.stem}</p>
      {!record.right && (
        <>
          <dl class="rrow-ans">
            <div class="rr-yours"><dt>Yours</dt><dd>{textOf(q, record.picked)}</dd></div>
            <div class="rr-answer"><dt>Answer</dt><dd>{textOf(q, q.answer)}</dd></div>
          </dl>
          {q.explanation && <p class="rrow-why">{q.explanation}</p>}
          <SourceLine q={q} />
          <NotesLink q={q} notes={notes} />
        </>
      )}
    </li>
  );
}
