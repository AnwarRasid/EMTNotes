// The Quiz tab (#/quiz): an open quiz to resume, the three modes, and progress per bank (spec §6.1, §6.4).
// The screen's one primary key is Resume while a quiz is open, else the Review wrong card's key.
import type { JSX } from 'preact';
import { useId, useMemo } from 'preact/hooks';
import { contentErrorCopy, useContent } from '../data/load';
import type { Question } from '../data/questions';
import { useProgress, useStore } from '../progress/hooks';
import { Icon } from '../ui/Icon';
import { Primary, Secondary, type KeyProps } from '../ui/Keys';
import { Panel } from '../ui/Panel';
import { Skeleton, useDelayedFlag } from '../ui/Skeleton';
import { BankProgress } from './BankProgress';
import { bankProgress, clearedCount, reviewPool } from './engine';
import { ALL_QUESTIONS, resumeLine, startQuiz, useOpenQuiz } from './useQuiz';

export function QuizTab(): JSX.Element {
  const content = useContent('questions');
  const late = useDelayedFlag(content.status === 'loading');
  return (
    <div class="screen">
      <header class="screen-head"><h1 class="h1">Theory quiz</h1></header>
      {content.status === 'ready' ? <QuizHome questions={content.data} />
        : content.status === 'error' ? <QuestionsError onRetry={content.retry} />
        // Sized like the three mode cards and the bank panel, so nothing jumps when they arrive.
        : late && <Skeleton rows={4} rowHeight={['6rem', '4.625rem', '9.75rem', '9.5rem']} />}
    </div>
  );
}

/** The line under a key that starts a quiz while one is open, which the key names as its description. The Quiz tab,
 *  its setup, the notes reader and Today all say it; Run start and the debrief say it of an open run (`what="run"`). */
export function ReplacesNote({ id, class: cls = 'mode-replace', what = 'quiz' }:
  { id: string; class?: string; what?: 'quiz' | 'run' }): JSX.Element {
  return <p class={cls} id={id}>{`This replaces your open ${what}.`}</p>;
}

/** The question bank failed to load (spec §7). `primary`: Try again is the screen's one primary key (the default);
 *  Today steps it down while it has another. */
export function QuestionsError({ onRetry, primary = true }: { onRetry(): void; primary?: boolean }): JSX.Element {
  const Key = primary ? Primary : Secondary;
  return (
    <Panel class="load-error">
      <p class="load-error-msg" role="alert">{contentErrorCopy('questions')}</p>
      <div class="keys"><Key onClick={onRetry}>Try again</Key></div>
    </Panel>
  );
}

function QuizHome({ questions }: { questions: Question[] }): JSX.Element {
  const store = useStore();
  const stats = useProgress((p) => p.questions);
  const open = useOpenQuiz(questions);
  const pool = useMemo(() => reviewPool(questions, stats).length, [questions, stats]);
  const cleared = useMemo(() => clearedCount(questions, stats), [questions, stats]);
  const banks = useMemo(() => bankProgress(questions, stats), [questions, stats]);
  // Resume takes the one primary key; everything else steps down to secondary, and says it replaces the open quiz.
  const Key = open ? Secondary : Primary;
  const replaces = open !== null;
  const practise = () => { startQuiz(store, questions, 'practice', ALL_QUESTIONS); };

  return (
    <>
      {open && (
        <Panel class="resume">
          <p class="resume-line">{resumeLine(open)}</p>
          <div class="keys"><Primary href="#/quiz/session">Resume</Primary></div>
        </Panel>
      )}
      <ModeLink title="Practice" href="#/quiz/setup?mode=practice">Pick a bank and topic. See the answer straight away.</ModeLink>
      <ModeLink title="Test" href="#/quiz/setup?mode=test">20 or 50 questions. Score at the end.</ModeLink>
      <Panel class="mode mode-review">
        <h2 class="plabel">Review wrong</h2>
        <p class="sub">Questions you got wrong, until you get each right twice.</p>
        {pool > 0
          ? <ReviewKey Key={Key} replaces={replaces} onClick={() => { startQuiz(store, questions, 'review', ALL_QUESTIONS); }}>Review {pool} you got wrong</ReviewKey>
          : cleared > 0
            ? <ReviewKey Key={Key} replaces={replaces} note={`All ${cleared} cleared. New mistakes will show up here.`} onClick={practise}>Practise 20 more</ReviewKey>
            : <ReviewKey Key={Key} replaces={replaces} note="Nothing to review yet. Questions you get wrong will collect here." onClick={practise}>Start practice</ReviewKey>}
      </Panel>
      <BankProgress title="Bank progress" rows={banks} />
    </>
  );
}

/** A mode card that opens its setup. The heading's link covers the whole card, so the card is one target. */
function ModeLink({ title, href, children }: { title: string; href: string; children: string }): JSX.Element {
  const desc = useId();
  return (
    <Panel class="mode mode-link">
      <h2 class="plabel"><a class="mode-a" href={href} aria-describedby={desc}>{title}</a></h2>
      <p class="sub" id={desc}>{children}</p>
      <span class="mode-go" aria-hidden="true"><Icon name="forward" /></span>
    </Panel>
  );
}

/** The review card's key. `replaces`: a quiz is open, and starting this one replaces it, so the key says so. */
function ReviewKey({ Key, note, replaces, onClick, children }:
  { Key: (p: KeyProps) => JSX.Element; note?: string; replaces: boolean; onClick(): void; children: KeyProps['children'] }): JSX.Element {
  const replaceId = useId();
  return (
    <>
      {note && <p class="mode-note">{note}</p>}
      <div class="keys"><Key onClick={onClick} describedBy={replaces ? replaceId : undefined}>{children}</Key></div>
      {replaces && <ReplacesNote id={replaceId} />}
    </>
  );
}
