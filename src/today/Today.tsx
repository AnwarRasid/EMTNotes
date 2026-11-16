// Today (#/), the home screen (spec §6.1; mockup screen 1), top to bottom: the app bar, the run in progress, the quiz
// in progress, the headline with its drill, the Start here checklist, the last run with its strip (No runs yet before
// the first), quiz progress per bank with the review link, and where to continue reading. One key is primary, the one
// todayPrimary picks; every other key is secondary.
import type { JSX } from 'preact';
import { useId, useMemo } from 'preact/hooks';
import { useContent } from '../data/load';
import type { Question } from '../data/questions';
import { useProgress, useStore } from '../progress/hooks';
import { BankProgress } from '../quiz/BankProgress';
import { bankProgress, reviewPool } from '../quiz/engine';
import { QuestionsError, ReplacesNote } from '../quiz/QuizTab';
import { ALL_QUESTIONS, resumeSummary, startQuiz, useOpenQuiz } from '../quiz/useQuiz';
import { BrandMark } from '../ui/BrandMark';
import { Icon } from '../ui/Icon';
import { Primary, Secondary } from '../ui/Keys';
import { Panel } from '../ui/Panel';
import { Skeleton, useDelayedFlag } from '../ui/Skeleton';
import { discardOpen } from './discard';
import { FirstRun } from './FirstRun';
import { HeadlinePanel, useHeadlineRow } from './HeadlinePanel';
import { LastRunPanel } from './LastRunPanel';
import { NoRunsPanel, hasFullRun } from './NoRunsPanel';
import { RunResume, useRunRow } from './RunResume';

// Plan 1's Discard tests read it from here (ruling T18).
export { UNDO_MS } from './discard';

export type TodayPrimary = 'run' | 'quiz' | 'headline' | 'start';

/** Today's one primary key: Resume on an open run, else Resume on an open quiz, else the headline's drill, else Start
 *  your first run while no full run is on record; else none. */
export function todayPrimary(p: { runOpen: boolean; quizOpen: boolean; headline: boolean; noRuns: boolean }): TodayPrimary | null {
  if (p.runOpen) return 'run';
  if (p.quizOpen) return 'quiz';
  if (p.headline) return 'headline';
  if (p.noRuns) return 'start';
  return null;
}

const NO_QUESTIONS: Question[] = [];

export function Today(): JSX.Element {
  const content = useContent('questions');
  const late = useDelayedFlag(content.status === 'loading');
  const noRuns = useProgress((p) => !hasFullRun(p.runs));
  const questions = content.status === 'ready' ? content.data : null;
  const primary = usePrimary(questions, content.status === 'loading', noRuns);
  return (
    <>
      {/* The screen's name, for the shell's focus and screen readers; the brand stands in for it on screen. */}
      <h1 class="vh">Today</h1>
      <header class="appbar">
        <BrandMark />
        <a class="ibtn" href="#/settings" aria-label="Settings"><Icon name="settings" /></a>
      </header>
      <div class="screen today">
        <RunResume primary={primary === 'run'} />
        {questions && <QuizResume questions={questions} primary={primary === 'quiz'} />}
        <HeadlinePanel primary={primary === 'headline'} />
        <FirstRun />
        {noRuns ? <NoRunsPanel title="Last run" start={primary === 'start' ? 'primary' : 'secondary'} /> : <LastRunPanel title="Last run" />}
        {questions ? <TheoryQuiz questions={questions} />
          // Try again is primary only when nothing else is, so the screen keeps one.
          : content.status === 'error' ? <QuestionsError onRetry={content.retry} primary={primary === null} />
          // Sized like the Theory quiz panel.
          : late && <Skeleton rows={1} rowHeight="9.5rem" />}
        <ContinueReading />
      </div>
    </>
  );
}

/**
 * todayPrimary over the rows as they show. A row still loading ('pending': the run's case, the quiz's questions or the
 * headline's steps not in yet) counts as there, and while the one it picks is pending no key is primary: so no key is
 * primary for a moment and then steps down under the thumb when a row above it arrives.
 */
function usePrimary(questions: Question[] | null, questionsLoading: boolean, noRuns: boolean): TodayPrimary | null {
  const run = useRunRow();
  const savedQuiz = useProgress((p) => p.quizOpen !== null);
  const openQuiz = useOpenQuiz(questions ?? NO_QUESTIONS);
  const quiz = questions !== null ? (openQuiz !== null ? 'shown' : 'none') : savedQuiz && questionsLoading ? 'pending' : 'none';
  const headline = useHeadlineRow();
  const rows = { run, quiz, headline, start: 'shown' } as const;
  const choice = todayPrimary({ runOpen: run !== 'none', quizOpen: quiz !== 'none', headline: headline !== 'none', noRuns });
  return choice !== null && rows[choice] === 'pending' ? null : choice;
}

// ---- Resume ----------------------------------------------------------------------------------------------------

/** The quiz in progress. `primary`: Resume is the screen's one primary key. Each key names the row's line as its
 *  description, since a run's Resume and Discard can show beside it. */
function QuizResume({ questions, primary }: { questions: Question[]; primary: boolean }): JSX.Element | null {
  const store = useStore();
  const open = useOpenQuiz(questions);
  const lineId = useId();
  if (!open) return null;
  const Resume = primary ? Primary : Secondary;
  return (
    <Panel class="resume">
      <p class="resume-line" id={lineId}>{resumeSummary(open)}</p>
      <div class="keys">
        <Resume href="#/quiz/session" describedBy={lineId}>Resume</Resume>
        <Secondary onClick={() => discardOpen(store, 'quiz')} describedBy={lineId}>Discard</Secondary>
      </div>
    </Panel>
  );
}

// ---- Theory quiz -----------------------------------------------------------------------------------------------

/** Progress per bank, with "Review {N} you got wrong" as a text link (mockup line 337) while there is any to review. */
function TheoryQuiz({ questions }: { questions: Question[] }): JSX.Element {
  const store = useStore();
  const stats = useProgress((p) => p.questions);
  const banks = useMemo(() => bankProgress(questions, stats), [questions, stats]);
  const pool = useMemo(() => reviewPool(questions, stats).length, [questions, stats]);
  // Starting a review replaces an open quiz, and the link says so, as the Quiz tab's keys do.
  const replaces = useOpenQuiz(questions) !== null;
  const noteId = useId();
  const review = (e: MouseEvent) => {
    e.preventDefault();
    startQuiz(store, questions, 'review', ALL_QUESTIONS);
  };
  return (
    <BankProgress title="Theory quiz" rows={banks}
      aside={pool > 0 && (
        <a class="link" href="#/quiz/session" onClick={review} aria-describedby={replaces ? noteId : undefined}>
          Review {pool} you got wrong
        </a>
      )}
      asideNote={pool > 0 && replaces && <ReplacesNote id={noteId} />} />
  );
}

// ---- Continue reading ------------------------------------------------------------------------------------------

/** The section read last, or section 1 before any (or when the last one has gone from the notes). Shows once the
 *  notes have loaded; the Notes tab has its own word on a failed load. */
function ContinueReading(): JSX.Element | null {
  const content = useContent('notes');
  const last = useProgress((p) => p.notes.lastSection);
  if (content.status !== 'ready') return null;
  const sections = content.data.sections;
  const lastRead = sections.find((s) => s.id === last);
  const section = lastRead ?? sections[0];
  if (!section) return null;
  return (
    <Panel class="cont">
      <a class="cont-a" href={`#/notes/${section.id}`}>
        <span class="cont-t">{lastRead ? 'Continue reading:' : 'Start with'} {section.n}. {section.title}</span>
        <span class="cont-go" aria-hidden="true"><Icon name="forward" /></span>
      </a>
    </Panel>
  );
}
