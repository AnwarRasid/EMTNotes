// Run start (#/pam/start), a focus screen (spec §6.1): the case (random and hidden, or picked by complaint), the mode,
// how to answer, the clock's two limits with the last run times, and Take the call. At ?drill={stepId} it starts a drill
// on that step instead (R4: always Coached and untimed, so no Mode and no clock). An unknown step id gets a new case.
import type { JSX } from 'preact';
import { useId, useMemo, useState } from 'preact/hooks';
import { FocusHeader } from '../app/FocusHeader';
import { back, type RouteMatch } from '../app/routes';
import { contentErrorCopy } from '../data/load';
import type { Case, Step } from '../data/schema';
import { mulberry32, randomSeed } from '../lib/rng';
import { useProgress, useStore } from '../progress/hooks';
import type { AnswerBy, RunMode } from '../progress/types';
import { ReplacesNote } from '../quiz/QuizTab';
import { drillRange, lastOrder } from '../sim/drill';
import { lastRunTimes } from '../sim/headline';
import { envFor } from '../sim/run';
import { Icon } from '../ui/Icon';
import { Primary } from '../ui/Keys';
import { Panel } from '../ui/Panel';
import { Skeleton, useDelayedFlag } from '../ui/Skeleton';
import { voiceSupported } from '../voice/speech';
import { beginDrill, beginRun, complaintsOf, pickCase } from './start';
import { useOpenRun, useRunContent, type RunContent } from './useRun';

const NEW_CASE = { title: 'New case', sub: 'Primary survey, about 20 minutes' };
/** Answer by's two radios (Plan 3 Task 5, ruling D1): each one's name and sub-line. Voice's says, once, where the audio
 *  goes (final review M2): Android Chrome's speech service sends it to Google to turn it into text. */
const ANSWER_BY = {
  typing: { label: 'Typing', sub: 'Type each line, then Send.' },
  voice: { label: 'Voice', sub: "Tap the mic and speak. Check the words, then Send. Voice uses your phone's speech service, which may "
    + 'send what you say to Google to turn it into text.' },
} as const;
/** Voice's sub-line where the browser has no speech recogniser, and Voice is off. */
const NO_VOICE = "This browser can't take speech. Type instead.";
/** The loading skeleton's rows, at the panels' heights at phone width: Case, Mode, Answer by and the clock; a drill's
 *  Case and Answer by (two lines taller since Voice says where its audio goes, final review M2). */
const NEW_CASE_ROWS = ['11.125rem', '13.5rem', '17.375rem', '7rem'];
const DRILL_ROWS = ['11.125rem', '17.375rem'];

/** The header: "Drill" over "Steps 11 to 13, Rapid body survey" for a drill on a known step, else New case. Until the
 *  steps are in (`steps` null) a drill link can't be checked, so it says Drill, with its steps to come. */
function headerFor(steps: Step[] | null, drillId: string | undefined, target: Step | null): { title: string; sub?: string } {
  if (steps !== null && target !== null) {
    const [a, b] = drillRange(target.order, lastOrder(steps));
    return { title: 'Drill', sub: `Steps ${a} to ${b}, ${target.name}` };
  }
  return steps === null && drillId !== undefined ? { title: 'Drill' } : NEW_CASE;
}

/** "Your last 3: 17:42, 19:05, 21:10.", "Your last 2: …", "Your last run: 17:42." or "No runs yet.". */
function LastRuns({ times }: { times: string[] }): JSX.Element {
  if (times.length === 0) return <p class="sub">No runs yet.</p>;
  const lead = times.length === 1 ? 'Your last run' : `Your last ${times.length}`;
  return <p class="sub">{lead}: <span class="rs-times tn">{times.join(', ')}</span>.</p>;
}

export function RunStart({ match }: { match: RouteMatch }): JSX.Element {
  const content = useRunContent();
  const late = useDelayedFlag(content.status === 'loading');
  const drillId = match.query.drill;
  const steps = content.status === 'ready' ? content.steps : null;
  const target = steps !== null && drillId !== undefined ? steps.find((s) => s.id === drillId) ?? null : null;
  const head = headerFor(steps, drillId, target);

  return (
    <div class="qs">
      <FocusHeader exit="close" onExit={() => back('/pam')} title={head.title} sub={head.sub} />
      {content.status === 'ready' ? <StartForm steps={content.steps} cases={content.cases} target={target} />
        : content.status === 'error' ? <div class="qs-body"><RunContentError error={content} /></div>
        // Sized like the panels to come (a drill has no Mode or clock), so nothing jumps when they arrive.
        : late && <div class="qs-body"><Skeleton rows={drillId !== undefined ? 2 : 4} rowHeight={drillId !== undefined ? DRILL_ROWS : NEW_CASE_ROWS} /></div>}
    </div>
  );
}

/** The content's error copy with Try again: Run start's, and the run screen's while its content can't load. */
export function RunContentError({ error }: { error: Extract<RunContent, { status: 'error' }> }): JSX.Element {
  return (
    <Panel class="load-error">
      <p class="load-error-msg" role="alert">{contentErrorCopy(error.key)}</p>
      <div class="keys"><Primary onClick={error.retry}>Try again</Primary></div>
    </Panel>
  );
}

function StartForm({ steps, cases, target }: { steps: Step[]; cases: Case[]; target: Step | null }): JSX.Element {
  const store = useStore();
  const ids = useId();
  const complaints = useMemo(() => complaintsOf(cases), [cases]);
  const [byComplaint, setByComplaint] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [mode, setMode] = useState<RunMode>('coached');
  const runs = useProgress((p) => p.runs);
  const times = useMemo(() => lastRunTimes(runs), [runs]);
  const hasOpen = useOpenRun().status === 'open';
  // A setting, not a run's: the run and drills read it. Voice saved on a browser that can't take speech answers by
  // Typing here, and stays saved.
  const [canSpeak] = useState(() => voiceSupported());
  const saved = useProgress((p) => p.settings.answerBy);
  const answerBy: AnswerBy = saved === 'voice' && canSpeak ? 'voice' : 'typing';
  const pickAnswerBy = (a: AnswerBy) =>
    store.update((p) => (p.settings.answerBy === a ? p : { ...p, settings: { ...p.settings, answerBy: a } }));

  // The first complaint is pressed until another is.
  const complaint = picked !== null && complaints.includes(picked) ? picked : complaints[0] ?? null;
  const replaceId = `${ids}-replace`;

  const start = () => {
    const c = pickCase(cases, byComplaint ? complaint : null, mulberry32(randomSeed()));
    if (c === null) return;
    const env = envFor(steps, c);
    if (target !== null) beginDrill(store, env, target.id, [], null);
    else beginRun(store, env, mode);
  };

  return (
    <>
      <div class="qs-body rstart">
        <Panel class="setup-group">
          <fieldset>
            <legend class="plabel">Case</legend>
            <div class="choices">
              <Choice name={`${ids}-case`} label="Random" sub="Hidden until the call comes in" checked={!byComplaint}
                onPick={() => setByComplaint(false)} />
              <Choice name={`${ids}-case`} label="Pick by complaint" checked={byComplaint} onPick={() => setByComplaint(true)} />
            </div>
            {byComplaint && (
              <div class="chips" role="group" aria-label="Complaint">
                {complaints.map((c) => <Chip key={c} label={c} pressed={c === complaint} onClick={() => setPicked(c)} />)}
              </div>
            )}
          </fieldset>
        </Panel>

        {target === null && (
          <Panel class="setup-group">
            <fieldset>
              <legend class="plabel">Mode</legend>
              <div class="choices">
                <Choice name={`${ids}-mode`} label="Coached" sub="Flags as you go, with the step bar and step list"
                  checked={mode === 'coached'} onPick={() => setMode('coached')} />
                <Choice name={`${ids}-mode`} label="Exam" sub="No flags until the debrief"
                  checked={mode === 'exam'} onPick={() => setMode('exam')} />
              </div>
            </fieldset>
          </Panel>
        )}

        <Panel class="setup-group">
          <fieldset>
            <legend class="plabel">Answer by</legend>
            <div class="choices">
              <Choice name={`${ids}-answer`} label={ANSWER_BY.typing.label} sub={ANSWER_BY.typing.sub}
                checked={answerBy === 'typing'} onPick={() => pickAnswerBy('typing')} />
              <Choice name={`${ids}-answer`} label={ANSWER_BY.voice.label} sub={canSpeak ? ANSWER_BY.voice.sub : NO_VOICE}
                checked={answerBy === 'voice'} disabled={!canSpeak} onPick={() => pickAnswerBy('voice')} />
            </div>
          </fieldset>
        </Panel>

        {target === null && (
          <Panel class="setup-group">
            <h2 class="plabel">The clock</h2>
            <p class="sub">RBS by 3:00 from Approach. Whole run by 20:00.</p>
            <LastRuns times={times} />
          </Panel>
        )}
      </div>

      <div class="qkeys qkeys-one">
        <Primary onClick={start} describedBy={hasOpen ? replaceId : undefined}>{target !== null ? 'Start drill' : 'Take the call'}</Primary>
        {hasOpen && <ReplacesNote id={replaceId} what="run" class="setup-note" />}
      </div>
    </>
  );
}

/** A radio row: the label names it, and the sub-line under it is its description (which says why, when it is off). */
function Choice({ name, label, sub, checked, disabled, onPick }:
  { name: string; label: string; sub?: string; checked: boolean; disabled?: boolean; onPick(): void }): JSX.Element {
  const id = useId();
  return (
    <label class="choice">
      <input type="radio" name={name} checked={checked} disabled={disabled} onChange={onPick}
        aria-labelledby={`${id}-label`} aria-describedby={sub ? `${id}-sub` : undefined} />
      <span class="choice-text">
        <span id={`${id}-label`}>{label}</span>
        {sub && <span class="choice-sub" id={`${id}-sub`}>{sub}</span>}
      </span>
    </label>
  );
}

function Chip({ label, pressed, onClick }: { label: string; pressed: boolean; onClick(): void }): JSX.Element {
  return (
    <button type="button" class="chip" aria-pressed={pressed} onClick={onClick}>
      {pressed && <Icon name="check" />}<span>{label}</span>
    </button>
  );
}
