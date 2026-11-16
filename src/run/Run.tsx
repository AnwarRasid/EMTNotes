// The run screen (#/run, spec §6.2, mockup screen 2): a 100dvh grid of the band, the header with the run clock, the
// mode row, the step bar (Coached and drills), the vitals rail, the chat (the only scroller) and the composer, whose
// lines and taps go through one ordered send queue; in Coached and drills the step list can take the composer's place.
// Pause and Android's back open the Pause sheet over it. The lifecycle (useRunLifecycle) keeps the clock, the wake
// lock and the back guard.
import type { JSX } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { FocusHeader } from '../app/FocusHeader';
import { back, navigate, type RouteMatch } from '../app/routes';
import { focusScreen } from '../lib/focus';
import { useProgress, useStore } from '../progress/hooks';
import { RUN_LIMITS, type RunSession } from '../progress/types';
import { drillDone } from '../sim/drill';
import { disputePoint, endConfirmCopy, rangeText, shownStep, stepCovered, stepStates, type RunEnv } from '../sim/run';
import { forgetReplace } from '../today/discard';
import { Skeleton, useDelayedFlag } from '../ui/Skeleton';
import { toast } from '../ui/toast';
import { Chat } from './Chat';
import { Composer, draftKeyOf } from './Composer';
import { PauseSheet, type PauseConfirm } from './PauseSheet';
import { RunContentError } from './RunStart';
import { RunHeader } from './RunHeader';
import { StepBar } from './StepBar';
import { StepSheet, type StepRow } from './StepSheet';
import { VitalsRail } from './VitalsRail';
import { beginDrill, beginRun } from './start';
import { useOpenRun } from './useRun';
import { finishRun, pauseOpenRun, resumeOpenRun, useRunLifecycle } from './useRunLifecycle';
import { useSendQueue, type RunInput } from './useSendQueue';

/** The composer's note once the run holds RUN_LIMITS.transcriptLines lines and takes no more, over the disabled field. */
export const LINE_LIMIT_NOTE = 'This run has reached its line limit. End it from Pause to see the debrief.';
/** The composer's status line while a line waits on the grader (Plan 3 D14), from 300 ms on, as its bubble shows. */
export const CHECKING_LINE = 'Checking your line.';
/** A toast, not the run's live region: the debrief replaces the run in the same tick, so a live line would go unheard
 *  (ruling D7). */
export const DRILL_DONE = 'Drill done.';
/** How near its end the chat counts as at its newest line (Chat.tsx's NEAR_END_PX, spec §8). */
const NEAR_END_PX = 80;

/** The loading skeleton's rows, at the frame's heights at phone width: the header, the mode row, the step bar and the
 *  vitals rail. */
const LOADING_ROWS = ['3.5rem', '1.75rem', '1.125rem', '4rem'];

export function Run(_: { match: RouteMatch }): JSX.Element {
  const run = useOpenRun();
  const late = useDelayedFlag(run.status === 'loading');
  // With no run open there is nothing to show: Today offers the next one. Replace, so Back never returns here. Before
  // the paint: Back from a fresh debrief lands on its run's old #/run entry, and a painted frame of it would flash the
  // run's beacon scene over an empty screen on the way to Today (Task 17).
  useLayoutEffect(() => { if (run.status === 'none') navigate('/', { replace: true }); }, [run.status]);

  // A new run (Restart, a drill) mounts a fresh screen, so nothing of the last one's clock or tiles carries over.
  if (run.status === 'open') return <RunScreen key={run.session.id} session={run.session} env={run.env} />;
  if (run.status === 'none' || (run.status === 'loading' && !late)) return <></>;
  // The run is kept while its content loads or fails (useOpenRun), so Close leaves it to resume later.
  return (
    <div class="qs">
      <FocusHeader exit="close" onExit={() => back('/pam')} title="Run in progress" />
      <div class="qs-body">
        {run.status === 'error' ? <RunContentError error={run} /> : <Skeleton rows={LOADING_ROWS.length} rowHeight={LOADING_ROWS} />}
      </div>
    </div>
  );
}

function RunScreen({ session, env }: { session: RunSession; env: RunEnv }): JSX.Element {
  const store = useStore();
  const answerBy = useProgress((p) => p.settings.answerBy);   // Typing or Voice, as chosen at Run start
  // The engine's latest announcement ("RBS done at 2:41."), said in the header's live region; the send queue sets it.
  const [announce, setAnnounce] = useState<string | null>(null);
  // The typed lines still in the send queue. Once one has waited 300 ms (a slow grader: the smart tester, D14), they
  // show after the chat as pending bubbles, and the composer's status line says so.
  const [pending, setPending] = useState<string[]>([]);
  const waiting = useDelayedFlag(pending.length > 0);
  const queue = useSendQueue(store, env, session.id, (said) => setAnnounce(said.join(' ')), setPending);
  /** An input sent is the trainee saying or tapping something in the new run, so a "Run replaced." Undo lapses now,
   *  not when the input is saved: a slow grader holds it for seconds, and Undo then would drop it (Task 7 review M1). */
  const send = (input: RunInput) => {
    forgetReplace();
    return queue(input);
  };
  const [paused, setPaused] = useState(false);   // the Pause sheet is open
  const [confirm, setConfirm] = useState<PauseConfirm | null>(null);
  const [listing, setListing] = useState(false);   // the step list is in the composer's place
  const open = useRef(false);   // `paused` as of now, for a back press before the next render
  const root = useRef<HTMLDivElement>(null);
  const refocus = useRef<string | null>(null);   // where focus goes once the next render is in: Pause, the field or Speak
  const draft = useRef('');   // what was in the field when the step list took its place, given back after
  const restore = useRef(false);   // the step list has just closed: the draft goes back, wherever focus goes
  const chatAtEnd = useRef(false);   // the chat was at its newest line as the step list opened
  const drill = session.drill !== null;
  const coached = session.mode === 'coached';   // a drill is always Coached (R4)
  const states = useMemo(() => stepStates(env, session), [env, session]);
  const flagged = states.filter((x) => x.state === 'flagged').map((x) => x.order);
  const step = coached ? { n: shownStep(env, session), of: env.steps.length, flagged } : null;
  const full = session.lines.length >= RUN_LIMITS.transcriptLines;   // at its line limit: no more lines or taps
  const rows = useMemo((): StepRow[] => (listing ? env.steps.map((st) => ({ id: st.id, order: st.order, name: st.name,
    covered: stepCovered(env, session, st.id),
    inRange: session.drill === null || (st.order >= session.drill.from && st.order <= session.drill.to) })) : []),
  [listing, env, session]);

  /** Pause and Android's back: the sheet opens with the clock stopped. The field lets go of focus first, so the
   *  keyboard drops. Back with the sheet already open does nothing. */
  const openSheet = () => {
    if (open.current) return;
    open.current = true;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    pauseOpenRun(store, session.id);
    setPaused(true);
  };
  const resume = () => {
    open.current = false;
    setConfirm(null);
    setPaused(false);
    resumeOpenRun(store, session.id);
    refocus.current = '.runhead .ibtn';
  };
  /** A fresh run of the same case and mode, or the same drill again; `runs` stay as they were. The screen remounts
   *  for the new run (Run keys it by id), with the sheet closed. Its confirm has asked already, so no Undo. */
  const restart = () => {
    const s = store.get().runOpen;
    if (s === null || s.id !== session.id) return;
    if (s.drill === null) beginRun(store, env, s.mode, { undo: false });
    else beginDrill(store, env, s.drill.target, s.drill.chain, s.drill.sourceRunId, { undo: false });
  };
  /** End, confirmed: the run ends now, with its debrief. A line or tap still in the queue (a smart check still out) is
   *  first graded by the keyword rules (the queue's settle), so End never drops it (final review M3). */
  const end = () => {
    const at = Date.now();
    if (!queue.busy()) finishRun(store, env, at);
    else void queue.settle().then(() => { finishRun(store, env, at); });
  };
  useRunLifecycle({ store, env, sessionId: session.id, sheetOpen: paused, onBack: openSheet });

  // A drill ends by itself once nothing in its range is left to do, after whichever input did it.
  useEffect(() => {
    if (store.get().runOpen?.id !== session.id || !drillDone(env, session)) return;
    finishRun(store, env, Date.now());
    toast(DRILL_DONE);
  }, [session]);
  // A screen that opens with focus on nothing (a restart, whose keys have gone) puts it on its heading.
  useLayoutEffect(() => {
    if (document.activeElement === null || document.activeElement === document.body) focusScreen();
  }, []);
  useLayoutEffect(() => {
    const target = refocus.current;
    refocus.current = null;
    const find = (selector: string) => root.current?.querySelector<HTMLElement>(selector) ?? null;
    if (restore.current) {
      restore.current = false;
      const input = find('.cinput');
      if (input instanceof HTMLInputElement && input.value === '') {
        input.value = draft.current;
        if (target === '.mic') input.scrollLeft = input.scrollWidth;   // unfocused, it would show its start
      }
    }
    // Speak where it renders; with no recogniser the composer is the typing one, and focus goes to its field
    const el = target === null ? null : find(target) ?? (target === '.mic' ? find('.cinput') : null);
    el?.focus();
  });
  const chatEl = (): HTMLElement | null => root.current?.querySelector<HTMLElement>('.chat') ?? null;
  const showList = () => {
    draft.current = root.current?.querySelector<HTMLInputElement>('.cinput')?.value ?? '';
    const chat = chatEl();
    chatAtEnd.current = chat !== null && chat.scrollHeight - chat.scrollTop - chat.clientHeight <= NEAR_END_PX;
    setListing(true);
  };
  // A run that reaches its line limit takes no more taps either: an open list gives way to the composer, whose note says
  // to end the run from Pause, and focus goes to Pause.
  useLayoutEffect(() => {
    if (!full || !listing) return;
    setListing(false);
    refocus.current = '.runhead .ibtn';
  }, [full]);
  // The list takes room from the chat, and Chrome's scroll anchoring then moves the chat off its end, which the chat
  // reads as the trainee scrolling up: a chat that was at its newest line is put back there at once, before that scroll
  // is seen, so the lines a tap adds come into view.
  useLayoutEffect(() => {
    const chat = chatEl();
    if (!listing || !chatAtEnd.current || chat === null) return;
    chatAtEnd.current = false;
    chat.style.scrollBehavior = 'auto';
    chat.scrollTop = chat.scrollHeight;
    chat.style.scrollBehavior = '';
  }, [listing]);

  /** The open run changed by `fn`, if it is still this one; saved. */
  const change = (fn: (s: RunSession) => RunSession) => {
    const id = session.id;
    store.update((p) => (p.runOpen !== null && p.runOpen.id === id ? { ...p, runOpen: fn(p.runOpen) } : p));
  };
  // "Not what I meant": the point leaves the score (R9). A line still being read is read again on top of it.
  const dispute = (key: string) => change((s) => disputePoint(s, key, Date.now()));

  return (
    <>
      <div class="run" inert={paused} ref={root}>
        <i class="bb flank" aria-hidden="true" />
        <RunHeader title={env.case.complaint} sub={env.case.location} clock={session.clock} rbsMs={session.rbsMs} drill={drill}
          announce={announce} onPause={openSheet} />
        <ModeRow label={drill ? 'Drill' : coached ? 'Coached' : 'Exam'} step={step} />
        {coached && <StepBar states={states} range={session.drill === null ? null : [session.drill.from, session.drill.to]} />}
        <VitalsRail readings={session.readings} mode={session.mode} />
        <Chat lines={session.lines} case={env.case} mode={session.mode} disputes={session.disputes} onDispute={dispute}
          pending={waiting ? pending : undefined} />
        {coached && listing && !full
          ? <StepSheet rows={rows} onPick={(id) => send({ tap: id })}
              onClose={() => {
                setListing(false);
                restore.current = true;
                // In Voice, focus goes back to Speak, so the keyboard stays down (task 5 fix round 1, M3)
                refocus.current = answerBy === 'voice' ? '.mic' : '.cinput';
              }} />
          : <Composer onSend={(text) => send({ text })} disabled={full} showStepList={coached} onStepList={showList}
              note={full ? LINE_LIMIT_NOTE : undefined} answerBy={answerBy} callName={env.case.patient.callName} hold={paused}
              draftKey={draftKeyOf(session.id)} status={waiting ? CHECKING_LINE : undefined} sending={pending} />}
      </div>
      {paused && (
        <PauseSheet mode={session.mode} drill={drill} confirm={confirm}
          endCopy={confirm === 'end' ? endConfirmCopy(env, session, Date.now()) : ''}
          onResume={resume} onEnd={() => setConfirm('end')} onRestart={() => setConfirm('restart')} onCancel={() => setConfirm(null)}
          onConfirm={() => { if (confirm === 'end') end(); else restart(); }} />
      )}
    </>
  );
}

/** The mode chip, and in Coached and drills "Step 10 of 19", with ", step 6 flagged" while steps are flagged. */
function ModeRow({ label, step }: { label: string; step: { n: number; of: number; flagged: number[] } | null }): JSX.Element {
  return (
    <div class="moderow">
      <span class="runmode">{label}</span>
      {step !== null && (
        <span class="stepinfo tn">
          Step <b>{step.n}</b> of {step.of}
          {step.flagged.length > 0 && <>, <em>{step.flagged.length === 1 ? 'step' : 'steps'} {rangeText(step.flagged)} flagged</em></>}
        </span>
      )}
    </div>
  );
}
