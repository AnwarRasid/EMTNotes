// Practice and test setup (#/quiz/setup?mode=practice|test): a bank, a topic and, for a test, its length.
// Start opens the session; it is disabled, with the reason, when nothing matches (an empty session has no question).
import type { JSX } from 'preact';
import { useId, useMemo, useState } from 'preact/hooks';
import { back, type RouteMatch } from '../app/routes';
import { useContent } from '../data/load';
import { GROUPS, type Question } from '../data/questions';
import { TOPICS, type Topic } from '../data/schema';
import { useStore } from '../progress/hooks';
import type { QuizFilter } from '../progress/types';
import { Icon } from '../ui/Icon';
import { Primary } from '../ui/Keys';
import { Panel } from '../ui/Panel';
import { Skeleton, useDelayedFlag } from '../ui/Skeleton';
import { filterQuestions } from './engine';
import { QuestionsError, ReplacesNote } from './QuizTab';
import { startQuiz, useOpenQuiz } from './useQuiz';

type SetupMode = 'practice' | 'test';
type Group = QuizFilter['group'];

const BANKS: { id: Group; label: string }[] = [{ id: 'all', label: 'All banks' }, ...GROUPS.map((g) => ({ id: g.id, label: g.label }))];
const LENGTHS = [20, 50] as const;
const TOPIC_IDS = Object.keys(TOPICS) as Topic[];

const COPY: Record<SetupMode, { title: string; intro: string; start: string }> = {
  practice: { title: 'Practice', intro: 'Pick a bank and topic. See the answer straight away.', start: 'Start practice' },
  test: { title: 'Test', intro: '20 or 50 questions. Score at the end.', start: 'Start test' },
};

/** Each topic the questions have, in TOPICS order, with its count. */
function topicCounts(qs: Question[]): [Topic, number][] {
  const n = new Map<Topic, number>();
  for (const q of qs) n.set(q.topic, (n.get(q.topic) ?? 0) + 1);
  return TOPIC_IDS.filter((t) => n.has(t)).map((t) => [t, n.get(t)!]);
}

export function QuizSetup({ match }: { match: RouteMatch }): JSX.Element {
  const mode: SetupMode = match.query.mode === 'test' ? 'test' : 'practice';
  const content = useContent('questions');
  const late = useDelayedFlag(content.status === 'loading');
  return (
    <div class="screen">
      <header class="screen-head">
        <button type="button" class="ibtn" aria-label="Back" onClick={() => back('/quiz')}><Icon name="back" /></button>
        <h1 class="h1">{COPY[mode].title}</h1>
      </header>
      <p class="sub">{COPY[mode].intro}</p>
      {content.status === 'ready' ? <SetupForm mode={mode} questions={content.data} />
        : content.status === 'error' ? <QuestionsError onRetry={content.retry} />
        // Sized like the bank group, the topic chips and the start key.
        : late && <Skeleton rows={mode === 'test' ? 4 : 3} rowHeight={['13.375rem', '19.375rem', mode === 'test' ? '6.625rem' : '3rem', '3rem']} />}
    </div>
  );
}

function SetupForm({ mode, questions }: { mode: SetupMode; questions: Question[] }): JSX.Element {
  const store = useStore();
  const ids = useId();
  const [group, setGroup] = useState<Group>('all');
  const [topic, setTopic] = useState<Topic | 'all'>('all');
  const [length, setLength] = useState<20 | 50>(20);
  const hasOpen = useOpenQuiz(questions) !== null;

  const countsFor = (g: Group) => topicCounts(filterQuestions(questions, { group: g, topic: 'all' }));
  const inBank = useMemo(() => filterQuestions(questions, { group, topic: 'all' }).length, [questions, group]);
  const counts = useMemo(() => countsFor(group), [questions, group]);
  const matching = topic === 'all' ? inBank : counts.find(([t]) => t === topic)?.[1] ?? 0;

  const chooseGroup = (g: Group) => {
    setGroup(g);
    if (topic !== 'all' && !countsFor(g).some(([t]) => t === topic)) setTopic('all');   // the bank has none of it
  };
  const start = () => { startQuiz(store, questions, mode, { group, topic }, mode === 'test' ? length : undefined); };

  // A test of `length` over fewer matching questions has them all; say so, rather than start a shorter test silently.
  const short = mode === 'test' && matching > 0 && matching < length;

  const reasonId = `${ids}-none`;
  const shortId = `${ids}-short`;
  const replaceId = `${ids}-replace`;
  const describedBy = [matching === 0 && reasonId, short && shortId, hasOpen && replaceId].filter(Boolean).join(' ') || undefined;

  return (
    <>
      <Panel class="setup-group">
        <fieldset>
          <legend class="plabel">Bank</legend>
          <div class="choices">
            {BANKS.map((b) => (
              <label key={b.id} class="choice">
                <input type="radio" name={`${ids}-bank`} value={b.id} checked={group === b.id} onChange={() => chooseGroup(b.id)} />
                <span>{b.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </Panel>

      <Panel class="setup-group">
        <fieldset>
          <legend class="plabel">Topic</legend>
          <div class="chips">
            <Chip label="All topics" count={inBank} pressed={topic === 'all'} onClick={() => setTopic('all')} />
            {counts.map(([t, n]) => <Chip key={t} label={TOPICS[t]} count={n} pressed={topic === t} onClick={() => setTopic(t)} />)}
          </div>
        </fieldset>
      </Panel>

      {mode === 'test' && (
        <Panel class="setup-group">
          <fieldset>
            <legend class="plabel">Length</legend>
            <div class="choices choices-row">
              {LENGTHS.map((n) => (
                <label key={n} class="choice">
                  <input type="radio" name={`${ids}-length`} value={n} checked={length === n} onChange={() => setLength(n)} />
                  <span>{n} questions</span>
                </label>
              ))}
            </div>
          </fieldset>
        </Panel>
      )}

      <div class="setup-start">
        <Primary onClick={start} disabled={matching === 0} describedBy={describedBy}>{COPY[mode].start}</Primary>
        {matching === 0 && <p class="setup-note" id={reasonId}>No questions match. Pick another bank or topic.</p>}
        {short && <p class="setup-note" id={shortId}>{shortCopy(matching)}</p>}
        {hasOpen && <ReplacesNote id={replaceId} class="setup-note" />}
      </div>
    </>
  );
}

/** "Only 14 questions match, so the test has 14." */
function shortCopy(n: number): string {
  return n === 1 ? 'Only 1 question matches, so the test has 1.' : `Only ${n} questions match, so the test has ${n}.`;
}

function Chip({ label, count, pressed, onClick }: { label: string; count: number; pressed: boolean; onClick(): void }): JSX.Element {
  return (
    <button type="button" class="chip" aria-pressed={pressed} onClick={onClick}>
      {pressed && <Icon name="check" />}<span>{label}</span>{' '}<span class="chip-n tn">{count}</span>
    </button>
  );
}
