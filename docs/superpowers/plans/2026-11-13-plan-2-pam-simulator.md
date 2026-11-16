# Crew Leader Plan 2 of 3: the PAM Simulator. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the PAM primary-survey simulator to Crew Leader. It is a one-handed chat run against a simulated tester, patient, buddies, caller and Ops Ctr, graded by keyword rules against `steps.json`, in Coached or Exam mode. The run ends in a debrief that names every Missed, Wrong, Order and Phrase fault, and the trainee can drill the fixes. The plan also adds tap mode, the Today headline and the six cases the spec still lacks.

**Architecture:**
- **The simulator** is pure TypeScript under `src/sim/`, with no DOM. It holds:
  - a word-start keyword matcher;
  - a grader behind a `Grader` interface, which the later Claude API tester can replace;
  - the run clock;
  - the reply voices and readings;
  - the end-of-run classification;
  - drills and the Today headline.
- **State:** a live run is a typed `RunSession`, saved as `Progress.runOpen` after every line. An ended run becomes a `RunRecord` in `Progress.runs`, under `SCHEMA_VERSION` 2.
- **Screens:** Preact screens under `src/run/` (Run start, Run and Debrief) render that state. Today, the PAM tab and the notes reader link into it.

**Tech Stack:**
- Plan 1's stack, unchanged: Node 24, Vite 8, TypeScript 6, Preact 10, valibot and vite-plugin-pwa.
- Tests: Vitest with jsdom and @testing-library/preact; Playwright with @axe-core/playwright.
- Plan 2 adds no dependency.

**Spec:** `docs/superpowers/specs/2026-11-09-crew-leader-design.md`.
- **Read it with:**
  - the brief, `EMT PAM Practice Site – Build Brief.pdf` in Downloads (step table on pages 4–7, example cases on pages 8–9);
  - Plan 1, `docs/superpowers/plans/2026-11-09-plan-1-foundation-quiz-notes.md`, which this plan builds on.
- **Precedence:** the spec wins over everything, then this plan's rulings, then Plan 1's.
- **Binding rulings:** the ledger's "Ruling:" lines in `.superpowers/sdd/2026-11-09-plan-1-foundation-quiz-notes/progress.md` stay binding.

**Scope:**
- **In:**
  - spec §6.2, all of it;
  - the run parts of §6.1: Run start, Run, Debrief, the Today resume row, headline and last-run card, the PAM tab's New case, and drill links from the notes;
  - §6.3, the six remaining cases;
  - §6.6, runs;
  - the run copy in §7;
  - the chat and run layout in §8;
  - the run and debrief visuals and motion in §9;
  - §10's update hold and its simulator tests;
  - §11's late steps, every part named, trauma extras, readings by phase, drills and tap mode;
  - every carry from Plan 1 (see "Carries from Plan 1").
- **Out, Plan 3:**
  - voice input, through the Web Speech API;
  - run history as strip thumbnails on the PAM tab;
  - the optional Claude API tester;
  - cases beyond the eight;
  - the notes alt-number pass.

## Global Constraints

**Product and platform**
- **Android first** (user ruling, 2026-11-13). The trainee uses an Android phone with Chrome.
  - The design is mobile-first and one-handed, with 375px as the baseline. Pages never scroll sideways at 375px.
  - Playwright has two projects:
    - `phone`: 390×844, holding every screenshot baseline;
    - `pixel`: Playwright's `devices['Pixel 7']`, for the run flows and the save profile.
  - No iPhone-only code. That rules out a Home Screen hint and the iOS visualViewport keyboard fix. With `interactive-widget=resizes-content` already in the viewport meta, Android Chrome shrinks the `100dvh` run grid itself.
- **Theme:** dim theme only. `body` keeps its `var(--c-bay)` background.
- **Hosting:**
  - static site;
  - `base: './'` plus hash routing;
  - content in JSON under `public/data/`;
  - the new case files are precached by the existing `**/*.json` glob.
- **Privacy:**
  - noindex;
  - `robots.txt` disallows all;
  - no public links.

**Visual identity**
- **No SCDF marks:** no SCDF logo, crest or wordmark.
- **Band:** the band (#E2711F / #E3BC2B) is always a two-colour pattern and never means status. In Plan 2 it appears:
  - along the top edge of the run screen;
  - over the debrief verdict;
  - on the lower edge of the primary key;
  - as the chevrons at 20:00.
- **Status chips** (Plan 1 ruling S3 stands). Every chip is a solid chip with a mark and a word:
  - magenta `!!!` "Missed" and "Wrong" (spec §9: "missed or wrong");
  - lavender `!!` "Order" and "Phrase";
  - green ✓ for done or right.
- **Readings:**
  - always cabin white `--c-text`;
  - never a status colour;
  - never an alarm.
  - Only the clock's warning (at 18:00, past 20:00 and "RBS limit passed") uses magenta `--c-missed`, because it is a status. "RBS 2:41 ✓" uses green `--c-done`.
- **Motion:**
  - Plan 1's tokens.
  - Readings arrive as "– –" and settle to a value after `--t-base` (220 ms). No count-ups.
  - Never animate the timer.
  - The debrief reveal takes 1.1 s or less, and a tap skips it.
  - `prefers-reduced-motion: reduce` drops movement, keeps only fades of 150 ms or less, and sets every `transition-delay` and `animation-delay` to 0.
- **Type:** Barlow, Barlow Semi Condensed and Barlow Condensed (bundled); every size in `rem`.

**Accessibility (§8)**
- **Plan 1's rules stand:**
  - real buttons and links;
  - `aria-label` on icon buttons;
  - contrast of 4.5:1 for text and 3:1 for non-text;
  - focus rings;
  - targets of 44px or more;
  - 16px body text and inputs;
  - `lang="en-SG"`;
  - hover only under `(hover: hover)`;
  - safe-area padding.
- **Chat:**
  - `role="log"`, named "Run chat";
  - each line starts with a visually hidden speaker prefix, such as "Arm buddy: ";
  - inline flags are `role="status"`.
- **Clock:**
  - `role="timer"`, named "Run clock";
  - limit crossings are announced through one `aria-live="polite"` region.
- **Strips:** every run strip is `role="img"` with a text summary.
- **Run layout:**
  - a `100dvh` grid, with `height` (the one fixed height in the app, as §8's run layout requires);
  - the chat is the only scroller, with `overscroll-behavior: contain`;
  - it sticks to the bottom within 80px, otherwise it shows a "↓ {n} new" pill;
  - the step-list sheet scrolls inside itself.

**Content and copy**
- **Copy:** use these §7 and §6.2 strings verbatim:
  - "No runs yet. A run takes about 20 minutes. The clock starts when you say Approach." [Start your first run]
  - "Nothing to fix this run."
  - "Run in progress: {case}, step {n}, {mm:ss} used. The clock paused when you left." [Resume] [Discard]
  - "End run at {mm:ss}? Steps {range} count as missed."
  - "Who's this for? Tester, patient or buddy"
  - "Starts at Approach", "RBS by 3:00", "RBS {m:ss} ✓", "RBS limit passed", "5 min left"
  - "A new version is ready." is never shown during a run.
- **Other copy:** write any other state in the same plain voice.
- **Cases:**
  - every case is conscious and unstable (two or more signs);
  - every case follows the trainee's notes;
  - names, addresses and IC numbers are invented and masked (`S54xxxxxA`);
  - every case carries `"reviewed": false`.

**Code rules**
- **Pure simulator:** `src/sim/*` imports no `window`, `document` or `preact`. The Playwright seed helper runs it in Node.
- **Progress:**
  - `SCHEMA_VERSION` is 2 from Task 2, and no later build ever lowers it;
  - `SLOT_KEYS` and the integer `v` stay as they are;
  - the run is saved after every line.
- **Toasts:** never pass `ms: Infinity` to `toast()` (Plan 1 carry: it misbehaves).
- **Ids:** step and must-hit ids, `ROUTES`, `SCREENS`, `Progress.runs`, `Progress.runOpen`, `RunStrip`, `timeToX` and `STRIP` keep their names. New must-hit ids are allowed; renames are not.

**Stack pins:** as Plan 1; `package.json` and the lockfile do not change.

**Git, tools and hook**
- **Git:**
  - work continues on branch `plan-2-simulator`, which is stacked on `plan-1-foundation` at `5b16bc2`;
  - each task ends with a commit whose message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`;
  - no remote and no push;
  - the deploy workflow is never triggered.
- **Commands:**
  - run every command through Git Bash, never PowerShell, and create files with the Write tool (Plan 1 ruling W3);
  - before any Playwright run, stop a stale `vite preview` on :4173 (look for it by process command line);
  - keep comparison screenshots in the scratchpad, because `test-results/` is wiped by each run.
- **Guard hook:** a local hook may block the first creation of each new file. It asks:
  - what calls the file: answer from this plan's Interfaces blocks;
  - whether anything else serves the same purpose: nothing does;
  - what data schema the file has: from the Interfaces block;
  - the user's words: "Once this is done, just continue with plan 2 and 3, No need to wait for my signal".

  Answer those, then retry.
- **Plan 3 seams.** Keep these names:
  - the `Grader` interface (`src/sim/grader.ts`);
  - the Composer's right-hand key slot, where the mic goes;
  - `RunStrip` and `ReplayStrip`;
  - Run start's "Answer by" group;
  - every `RunRecord` field.

## Review Focus

1. **The phone interrupts a run:**
   - **Cases:**
     - a call comes in;
     - the trainee switches apps;
     - the screen locks;
     - Android discards the tab and restores `#/run`.
   - **Expected:**
     - the clock stops while the app is hidden and resumes where it stopped;
     - the run comes back at its last line;
     - a tab killed while visible counts time only up to its last saved change;
     - the wake lock is taken again on return.
   - **Tests:**
     - Task 7: `recoverClock`;
     - Task 15: visibility, pagehide and wake lock;
     - Task 20: reload mid-run on the Pixel project.
2. **A correct answer in the trainee's own words:**
   - **Cases:**
     - curly quotes from the Android keyboard;
     - autocorrect capitals;
     - "&" for "and", and "1-6" for "1 to 6";
     - Singlish particles such as "lah" and "ah";
     - several steps in one message.
   - **Expected:**
     - the answer is credited;
     - only a missing required word is a Phrase fault;
     - "Not what I meant" takes any flag out of the score.
   - **Tests:**
     - Task 4: `normalizeLine`;
     - Task 6: the paraphrase fixtures, including a multi-step message;
     - Tasks 14 and 17: disputes.
3. **Fast or repeated input:**
   - **Cases:**
     - Send tapped twice;
     - Enter held down;
     - a step-list row tapped twice;
     - typing while replies are still being added.
   - **Expected:**
     - every send becomes one line, applied in order and saved once;
     - a covered step can't be tapped again;
     - nothing is lost or doubled.
   - **Tests:**
     - Task 14: the send queue;
     - Task 15: a step-list row disables after a tap.
4. **A run at the edges of time:**
   - **Cases:**
     - the trainee never reaches Approach;
     - the run ends at step 1;
     - the run goes past 20:00;
     - RBS finishes after 3:00.
   - **Expected:**
     - the clock shows `--:--` until Approach;
     - past 20:00 it shows `+m:ss`, and the run continues with ETA 1 min;
     - a run whose clock never started gets a debrief with Time "—" and RBS "—", every timed step Missed, and no trace past the Call segment.
   - **Tests:** Tasks 7, 9, 16 and 17.
5. **Content changes under a saved run:**
   - **Cases:**
     - a later build tunes `steps.json`;
     - a later build drops a case while a run is open, or after runs are on record.
   - **Expected:**
     - an open run whose case has gone closes with a toast, instead of crashing;
     - an old debrief still shows its faults by their saved labels;
     - unknown point ids never throw.
   - **Tests:**
     - Task 12: `useOpenRun`;
     - Task 17: a record whose point id isn't in `steps.json`.

## Rulings made in this plan

Each ruling settles a question the spec leaves open. Each gives its reason and what it costs if it is wrong.

| # | Ruling | Why | Cost if wrong |
|---|---|---|---|
| R1 | Plan 2 writes all six remaining cases: chest pain, CCF, asthma, arresting haemorrhage, a fall with neck pain, and an RTA. | Plan 1's scope line puts "the other 6 cases" in Plan 2, and the ledger carries them. §11's trauma extras can't be graded without trauma cases. The brief says "Start with at least 8 cases". So §10's "more cases" in polish means cases beyond the eight. | none; Plan 3 keeps its "more cases" |
| R2 | Run history as strip thumbnails on the PAM tab moves to Plan 3. Plan 2's PAM tab has New case, the resume row and the Last run card. | §10 lists "run history" under polish. The debrief is still reachable from Today and the PAM tab. | one list component in Plan 3 |
| R3 | Tap mode is in Plan 2. | §6.2 and §11 specify it, and the spec outranks the brief's polish list. | none |
| R4 | A drill always runs in Coached mode. It covers steps target−1 to target+1, clipped to 1–19 (the mockup's "Drill steps 11 to 13"), and ends by itself once every point in that range is done. | A drill is for fixing a step, so it needs the inline flags. §11 sets only the start, and the mockup shows the span. | a mode picker on drills |
| R5 | A wrong mask, flow or ECG choice is a **Wrong** fault: a magenta chip, sorted with Missed. A choice the trainee never names is a Phrase fault. | §9: magenta is "missed or wrong". §11: the wrong mask "gives no improvement, and the debrief notes it". | a chip word |
| R6 | **Order** marks the fewest points out of place, by the longest non-decreasing run of step ranks (Task 9). That catches early points (head grip during Approach, from the mockup) and late ones (§11). Ties blame the point that jumped ahead. Inline Order flags in Coached are never taken back; the debrief uses the final reckoning. | One rule for early and late; it matches the debrief mockup. | different blame in rare ties |
| R7 | **Phrase** means a point was recognised but is missing its `requiredWords`. Every `keyPhrase` point carries `requiredWords`. | The spec's examples: "suspected", the sound-out wording. | authors add `requiredWords` |
| R8 | "Who's this for? Tester, patient or buddy" shows when a sentence names no one and its points need answers from more than one of patient, tester and buddy. Its points still count, and its replies are held. | Lines to Sir or Ma'am that instruct a buddy are normal in the PAM, so a named patient never triggers it. | rare prompts |
| R9 | A disputed flag takes every fault of that point out of the score. "Not what I meant" sits on inline flags (Coached) and on every debrief fix row (both modes, so Exam can dispute too). | §6.2: "Every flag has 'Not what I meant'". | none |
| R10 | The debrief's reveal plays only on arrival from a run (`?fresh=1`). Opening the same debrief later shows it at once. | §9 says the strip "draws once". | none |
| R11 | The tester gives the ETA right after "Ops Centre, send over.", as ETA = max(1, 20 − whole minutes used). In a drill, the ETA is 10 mins. | §6.2 and the notes: "used 14 mins → ETA 6 mins". Drills are untimed. | one number |
| R12 | Realigning a pulseless limb is not graded. No Plan 2 case has a pulseless limb, and §11 grades extras "only when the case calls for them". | none needed | a point when a case needs it |
| R13 | Voice input waits for Plan 3. Run start shows "Answer by: Typing. Voice comes in a later update.", and the composer's right-hand key is Send. | §2 and §10 put voice in polish. | none |
| R14 | The interpretation line shows in both modes, because it says what was understood, never what comes next. | §6.2 describes it for every trainee bubble; the anti-goal is only about leaking the next step. | none |
| R15 | The GCS tile shows the GCS the trainee states (for example "GCS 15"), never the case's own figure. | §6.2: "Judging them is the trainee's job." | none |
| R16 | Plain text replies (such as "Crew ready…", "Accepted." and "Ops Centre, roger.") play once per run. Findings, readings and computed replies play every time they are asked for. | The tester repeats a finding when asked; a radio acknowledgement is said once. | none |

## Carries from Plan 1

Each line of `.superpowers/plan2/carries.md`, and where it lands.

| Carry | Lands in |
|---|---|
| Match alternatives non-empty, terms lowercase | Kept. The new slot terms (`{age}`) obey it (Task 1). |
| `(to X)` ruling: lenient addressee | Kept. `to` routes replies and never fails a point (Task 5). |
| Grader matches terms at word starts | Task 4. Terms of 3 characters or fewer match whole words, so "pr" never hits "pressure". |
| SRACIE age, IC no. and ETA from the case | Slots `{age}`, `{decade}`, `{ic}` and `{eta}`: schema in Task 1, expansion in Task 4, terms in Task 6. |
| Step 13 `{bpArm}` placeholder | Task 1, with the CCF case's left-arm fistula in Task 3. |
| Generic terms to tune (gloves hand/blood, maintain-titrate mask/flow, rate-quality rate+breath, state-level pain, "5 min" hit by "15 min") | Task 6, each as a fixture; also the `local` alternatives in Task 1. |
| Restore "oedema" beside "edema" | Task 6. |
| Re-review minors (prepare "ready", convince "better"+"breath", neck "may i", bare "Please allow me.", "what"+"happen", bare "allow", SRACIE line crediting unstable-signs, "unstable because of", "all 6 points", "points 1-6", "apply a CAT", "4in1") | Task 6, each line a named fixture. |
| BP screening answers in separate fields | Task 1: `findings.investigation.bpArm` and `patient.lines.bpScreen`. |
| Index↔case agreement and roomAir rules guard new cases | Task 3 runs both tests over all eight cases. |
| Patient-role replies need voicing | Task 1: `patient.lines`. |
| Older build and a v2 save | Covered by Plan 1's `newer` kind. Task 2 adds the v1-loads-under-v2 test. |
| Route focus opt-out | Closed in Plan 1 (`70bdcaf`). The Run screen never focuses a control on mount, so the Android keyboard stays down, and the chat scroller isn't the document scroll. |
| `onNeedReload`; defer cross-window reloads on run routes | Task 19. |
| Reload fallback and the plugin's own reload ignore run routes | Task 19: `requestReload`. |
| Never use `ms: Infinity` | A Global Constraint. |
| Save budget: cache last slot text, cap transcripts, profile a mid-range Android | Task 2 (slot memo, run caps); Task 20 (profile at 4× CPU throttle on Pixel 7). |
| Bump `SCHEMA_VERSION` with a v1-loads-under-v2 test | Task 2. |
| Reduced motion zeroes the debrief stagger | Task 17 (`base.css`). |
| Install button via `beforeinstallprompt` | Task 19. |
| Pixel-class Playwright profile | Task 20. |
| Web Speech voice input | Plan 3 (R13). |
| iOS hint dropped | Honoured, and the iOS keyboard fix too (Global Constraints). |
| Toast stack overlaps the Reload banner | Task 19. |
| Orphaned doc comment in `QuizTab.tsx:30` | Task 19. |
| Read-back false conflict | Ruled out: unreachable and lossless (Plan 1 final ruling). |
| `settings.png` depends on headless `persist()` | Task 20 stubs `persist()` in `screens.spec.ts`. |
| Never roll back below a shipped `SCHEMA_VERSION`; keep `SLOT_KEYS` and an integer `v` | Global Constraints, plus a Task 2 test. |
| `pageshow`/`visibilitychange` → `recheck()` | Task 19. |
| Remaining notes alt-number fix | Plan 3: Plan 2 has no notes pass. |
| Six more cases | Task 3 (R1). |
| Continue Plans 2 and 3 without waiting; keep the workspace; stacked branch | Process. Already in effect. |

---

## File structure

```
src/
  data/   schema.ts                 MATCH_SLOTS, CANONICAL_SLOTS, OXYGEN_DEVICES, PATIENT_LINES; Reply.on;
                                    MustHit.short/local/check; patient.lines and callName; bpArm; limb   [T1]
          load.ts                   'cases' content key                                                [T12]
  progress/ types.ts                SCHEMA_VERSION 2, RunSession, RunRecord v2, RUN_LIMITS, addRunRecord [T2]
          slots.ts store.ts         slot memo (save budget), save timing mark                          [T2]
  sim/    match.ts                  normalize, word-start terms, slots, sentences                      [T4]
          oxygen.ts grader.ts       mask/flow and ECG reading; Grader + keywordGrader                  [T5]
          clock.ts                  the run clock, its view and its limits                             [T7]
          replies.ts                voices, findings as speech, readings by phase, canonical fill      [T8]
          classify.ts               Missed / Wrong / Order / Phrase, steps clean                       [T9]
          run.ts                    the run engine                                                     [T10]
          drill.ts headline.ts      drills; Today's headline                                           [T11]
          debrief.ts                debrief view model: verdict, figures, went well, case record, replay [T17]
  run/    start.ts useRun.ts RunStart.tsx                                                              [T12]
          Run.tsx RunHeader.tsx StepBar.tsx VitalsRail.tsx                                             [T13]
          Chat.tsx Composer.tsx                                                                        [T14]
          PauseSheet.tsx StepSheet.tsx useRunLifecycle.ts                                              [T15]
          Debrief.tsx CaseRecord.tsx                                                                   [T17]
  ui/     RunStrip.tsx              trace on Today's strip; ReplayStrip                                [T16]
  today/  Today.tsx NoRunsPanel.tsx FirstRun.tsx LastRunPanel.tsx RunResume.tsx discard.ts             [T18]
  pam/    PamTab.tsx                                                                                   [T18]
  notes/  SectionReader.tsx         step chips become drill links                                      [T18]
  lib/    offline.ts install.ts     held reloads; beforeinstallprompt                                  [T19]
  app/    routes.ts App.tsx PwaPrompts.tsx                                                             [T12, T19]
  settings/ Settings.tsx            Install group                                                      [T19]
public/data/ steps.json cases/*.json (8) cases/index.json                                              [T1, T3, T6]
tests/unit/ sim-helpers.ts paraphrases.ts and the test files named in each task
tests/e2e/  run.spec.ts perf.spec.ts screens.spec.ts seed.ts; playwright.config.ts projects            [T20]
```

---

### Task 1: Steps and case schema for the simulator

**Files:**
- Modify:
  - `src/data/schema.ts`;
  - `public/data/steps.json`;
  - `public/data/cases/copd-amk-01.json` and `public/data/cases/hypo-hougang-01.json`.
- Test:
  - `tests/unit/schema.test.ts` (extend its `validCase()` factory and add tests);
  - `tests/unit/data-integrity.test.ts` (modify).

**Interfaces:**
- Consumes: Plan 1's `schema.ts` (`StepsDocSchema`, `CaseSchema`, `conditionHolds`, `getFinding`), `steps.json` and the two cases.
- Produces (`src/data/schema.ts`):
```ts
export const MATCH_SLOTS = ['age', 'decade', 'ic', 'eta', 'bparm'] as const;   export type MatchSlot = (typeof MATCH_SLOTS)[number];
export const CANONICAL_SLOTS = ['location', 'callText', 'chiefComplaint', 'suspected', 'signs', 'sex', 'race', 'age', 'ic', 'eta', 'bpArm'] as const;
export const OXYGEN_DEVICES = ['nasal-cannula', 'simple-face-mask', 'non-rebreather', 'nebuliser-mask', 'bvm', 'none'] as const;
export type OxygenDevice = (typeof OXYGEN_DEVICES)[number];
export const PATIENT_LINES = ['feelingNow', 'fall', 'hitHead', 'neckPain', 'lungHistory', 'verbal', 'motor', 'severity', 'position', 'bpScreen', 'ic'] as const;
// MatchTermSchema also rejects any '{…}' that is not '{' + a MATCH_SLOTS name + '}' (so '{age}' passes, '{name}' fails)
// MustHit gains:  short: string (1–28 chars)   local?: Match   check?: 'oxygen' | 'ecg'
// Reply: every variant gains  on: string[] (min 1)  — must-hit ids of its step, or 'pointId.partId' for one part;
//        the computed variant becomes { role: Role; computed: 'eta' | 'ic' | 'oxygen'; on: string[] }
// Case.patient gains callName: string ('Mdm Tan'); lines becomes a strictObject with every PATIENT_LINES key (string)
//        plus convinced?: string
// Case.findings.approach:      { catastrophicBleeding: boolean; bleeding: string; control?: { pressure: string; dressing: string; cat: string } }
// Case.findings.investigation: { auscultation: string; bp: string /* the reading only: '148/88 mmHg' */; bpArm: 'left' | 'right';
//                                ecg: {…}; hypocount: number }
// Case.findings.rbs gains      limb?: { injury: string; distalPulse: string; immobilise: string }
// Case.expected.oxygen.device uses OXYGEN_DEVICES
```
- **`local`:** alternatives that count only while the point's step is the run's current step. Task 5 applies them; Task 6 moves generic-only alternatives into them.
- **`check`:** marks the points whose correctness depends on a choice (Task 10):
  - `mask-flow` and `maintain-titrate` (oxygen);
  - `ecg`.

**`steps.json` changes:**
- **Version:** `contentVersion` "2026-11-13.1".
- **New point:** add `ask-neck-pain` to step 8, between `neck-permission` and `palpate-dtbl`:
  - label "Do you feel any pain at your neck?";
  - short "neck pain?";
  - match `[["pain","neck"]]`.
- **`short` on every point:** ≤ 28 characters, lowercase except names and abbreviations. Tasks 10 and 14 assert these:

| Point | Short | Point | Short |
|---|---|---|---|
| call-sign | call sign | responding-to | responding to |
| case-of | case of | head-grip | head grip |
| sound-out | sound out | moi | MOI |
| whats-bothering | what's bothering | chest-rise-fall | chest rise & fall |
| spo2 | SpO2 | mask-flow | oxygen |
| maintain-titrate | oxygen | rbs-regions | RBS |
| pocket-check | pocket check | ecg | ECG |
| unstable-signs | unstable due to | sracie | SRACIE |

- **Checks:** `check: "oxygen"` on `mask-flow` and `maintain-titrate`; `check: "ecg"` on `ecg`.
- **Step 13:**
  - the canonical line's "Taking the BP on the left arm." becomes "Taking the BP on the {bpArm} arm.";
  - `bp-arm` becomes `[["{bparm} arm"]]`.
- **Step 19 SRACIE parts:**
  - `age` → `[["{age}"],["{decade}"]]`;
  - `ic-no` → `[["{ic}"]]`;
  - `eta` → `[["eta","{eta}"],["estimated time","{eta}"]]`.
- **Replies.** Every step's `replies` become the list below, as role · source · `on`. "text" is a fixed line; vitals are a `{ vitals: [...] }` reply; computed is a `{ computed }` reply.

| # | Replies |
|---|---|
| 1 | opsCtr · text "Ops Ctr, roger." · call-sign, responding-to, case-of |
| 2 | caller · `caller.answers.location` · confirm-location; `.whatHappened` · what-happened; `.casualties` · casualties; `.conscious` · conscious; `.icAndMeds` · prepare-ic-meds; `.breathing` · ask-breathing; `.criticalInjuries` · critical-injuries; `.vehicles` · vehicles. opsCtr · text "Ops Ctr, roger. Starting tele-CPR." · tele-cpr |
| 3 | tester · text "Crew ready. You've arrived on scene." · equipment |
| 4 | tester · `findings.scene.description` · environment; `findings.scene.items` · environment; `findings.scene.hazards` · hazards; `findings.scene.witnesses` · witnesses |
| 5 | tester · `findings.approach.bleeding` · catastrophic-bleeding; `findings.scene.hazards` · hazards-remove; `findings.approach.control.pressure` · bleeding-control.direct-pressure; `.dressing` · bleeding-control.pressure-dressing; `.cat` · bleeding-control.cat |
| 6 | headBuddy · text "Head grip on." · head-grip; patient · `patient.chiefComplaint` · whats-bothering |
| 7 | patient · `findings.loc.response` · get-response |
| 8 | patient · `patient.lines.fall` and `patient.lines.hitHead` · ask-fall; `patient.lines.neckPain` · ask-neck-pain. tester · `findings.spine.dtbl` · palpate-dtbl. headBuddy · text "Head grip released." · release-grip. tester · text "C-collar on." · c-collar.apply |
| 9 | patient · `findings.loc.response` · check-response; tester · `findings.airway.mouth` · head-tilt-chin-lift, jaw-thrust; `findings.airway.smell` · smell |
| 10 | tester · `findings.breathing.riseFall` · chest-rise-fall; `.rateQuality` · rate-quality; `.ntucp` · ntucp. armBuddy · vitals [spo2] · spo2. patient · `patient.lines.lungHistory` · asthma-copd-history. headBuddy · computed oxygen · mask-flow |
| 11 | tester · `findings.circulation.pulse` · pulse, pulse-rate-quality |
| 12 | tester · `findings.rbs.findings` · abnormalities; `.jvd` · jvd; `.pedalEdema` · pedal-edema; `.gloves` · gloves; `.pockets` · pocket-check; `.limb.distalPulse` · distal-pulse; `.limb.immobilise` · immobilise; text "C-collar on." · c-collar-after-rbs.apply |
| 13 | tester · `findings.investigation.auscultation` · auscultation. patient · `patient.lines.bpScreen` · bp-screen. tester · `findings.investigation.bp` · bp-arm; `.ecg` · ecg; `.hypocount` · hypocount |
| 14 | patient · `patient.lines.verbal` · gcs.verbal; `patient.lines.motor` · gcs.motor; `patient.lines.severity` · severity. headBuddy · vitals [temp] · head-buddy.temp; [rr] · head-buddy.rr; [skin] · head-buddy.skin. armBuddy · [spo2] · arm-buddy.spo2; [pr] · arm-buddy.pr; [bp] · arm-buddy.bp; [crt] · arm-buddy.crt. headBuddy · text "OK, every 5 mins." · reassess-5 |
| 15 | armBuddy · vitals [spo2] · recheck-spo2; headBuddy · computed oxygen · maintain-titrate |
| 16 | patient · `patient.lines.feelingNow` · how-feeling |
| 17 | patient · `patient.lines.position` · ask-position; `patient.lines.convinced` · convince |
| 18 | tester · text "Accepted." · unstable-signs |
| 19 | patient · `patient.lines.ic` · get-ic; tester · computed ic · get-ic; tester · text "Name, IC number and photo match." · id-check; opsCtr · text "Ops Centre, send over." · standby-opener; tester · computed eta · standby-opener; opsCtr · text "Ops Centre, roger." · sracie |

**The two existing cases:**
- **`callName`:** COPD "Mdm Tan"; hypo "Mr Lim".
- **`findings.approach.bleeding`:** "No catastrophic bleeding." (no `control`).
- **`findings.investigation`:**
  - `bp`: "148/88 mmHg" and "138/84 mmHg";
  - `bpArm`: "left" in both.
- **`patient.lines`:** all 11 keys, in each patient's voice, using only the case's facts. The COPD patient speaks in short, broken lines; the hypo patient slow and confused. For example:
  - COPD `bpScreen`: "No... no shunt. No operation.";
  - hypo `lungHistory`: "No... no asthma.";
  - `verbal`: name and place, as the patient answers them;
  - `ic`: the patient handing over the IC.
- **Unchanged:** `findings.history`, `findings.spine` and `findings.position` keep their structured values for grading and the case record.

- [ ] **Step 1: Write the failing tests**

`tests/unit/schema.test.ts`:
- **Factory:** update `validCase()` to the new Case shape.
- **Match terms:**
  - `v.safeParse(StepsDocSchema, …)` of a one-step doc with match term `'{age}'` succeeds;
  - one with `'{name}'` fails.
- **Must-hit points:** a must-hit without `short` fails, and one with a 29-character `short` fails.
- **Replies:**
  - a reply with `on: []` fails;
  - `{ role: 'headBuddy', computed: 'oxygen', on: ['mask-flow'] }` passes.

`tests/unit/data-integrity.test.ts`:
- **Canonical placeholders:** replace the regex in "every step links to a real notes anchor and has a canonical line" with one built from `CANONICAL_SLOTS`.
- **Replace the `OPTIONAL` list** with a condition-aware rule. It asserts every finding of a reply whose triggers all apply to the case:
```ts
const appliesTo = (c: Case, s: Step, on: string) => {
  const m = s.mustHit.find(p => p.id === on.split('.')[0]);
  return m !== undefined && (!m.when || conditionHolds(c, m.when));
};
test('every reply names its triggers, and each finding it reads exists where it applies', () => {
  for (const s of steps()) for (const r of s.replies) for (const on of r.on) {
    const [pid, part] = on.split('.');
    const m = s.mustHit.find(p => p.id === pid);
    expect(m, `${s.id} ${on}`).toBeDefined();
    if (part) expect(m!.parts?.map(p => p.id), `${s.id} ${on}`).toContain(part);
  }
  for (const c of cases) for (const s of steps()) for (const r of s.replies)
    if ('finding' in r && r.on.every(on => appliesTo(c, s, on)))
      expect(getFinding(c, r.finding), `${c.id} ${r.finding}`).not.toBeUndefined();
});
test('every point has a short label of 28 characters or fewer', () => {
  for (const s of steps()) for (const m of s.mustHit) expect(m.short.length, m.id).toBeLessThanOrEqual(28);
});
test('conditional case content is there exactly when its condition holds', () => {
  for (const c of cases) {
    expect(c.findings.approach.control !== undefined, c.id).toBe(c.findings.approach.catastrophicBleeding);
    expect(c.findings.rbs.limb !== undefined, c.id).toBe(c.flags.includes('limbInjury'));
    expect(c.patient.lines.convinced !== undefined, c.id).toBe(!c.findings.position.ideal);
    expect(c.caller.answers.criticalInjuries !== undefined, c.id).toBe(c.type === 'trauma');
    expect(c.caller.answers.vehicles !== undefined, c.id).toBe(c.flags.includes('rta'));
  }
});
```
- **The naive substring tests** stay as they are: Task 4 moves them to the real matcher.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/unit/schema.test.ts tests/unit/data-integrity.test.ts`
Expected: FAIL. The new schema rules are missing, and the cases lack `callName`.

- [ ] **Step 3: Implement the schema, then edit `steps.json` and the two cases** to the Interfaces above. Use `v.strictObject` for every new hand-written object.

- [ ] **Step 4: Run them and see them pass**

Run: `npx vitest run && npm run typecheck`
Expected: all PASS, and `tsc` exits 0.

Nothing in `src/` reads `replies` yet, so only data and tests change. If a Plan 1 test builds a Case without the new fields, update its fixture.

- [ ] **Step 5: Commit**

```bash
git add src/data/schema.ts public/data tests/unit
git commit -m "feat(data): replies name their triggers; voiced patient lines, BP arm and match slots" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Progress v2: typed runs, schema version 2, save budget

**Files:**
- Modify: `src/progress/types.ts`, `src/progress/slots.ts`, `src/progress/store.ts`
- Test:
  - `tests/unit/progress-v2.test.ts` (new);
  - `tests/unit/slots.test.ts` and `tests/unit/store.test.ts` (append).

**Interfaces:**
- Consumes: `OxygenDevice`, `VitalKey` (Task 1); Plan 1's slots and store.
- Produces (`src/progress/types.ts`). It replaces Plan 1's `RunRecord` and the `runOpen: unknown`:
```ts
export const SCHEMA_VERSION = 2;   // 1 = Plan 1 (runOpen untyped, runs never written). Never lower it.
export const RUN_LIMITS = { lineChars: 600, transcriptLines: 400, runsKept: 50, transcriptsKept: 10 } as const;
export type RunMode = 'coached' | 'exam';
export type FaultKind = 'missed' | 'wrong' | 'order' | 'phrase';
export type Speaker = 'you' | 'system' | 'opsCtr' | 'caller' | 'patient' | 'headBuddy' | 'armBuddy' | 'tester';
export type ReadingKey = 'spo2' | 'pr' | 'rr' | 'bp' | 'temp' | 'skin' | 'crt' | 'hypocount' | 'gcs';
export interface RunClock { started: boolean; bankedMs: number; runningSince: number | null }   // epoch ms
export interface DrillInfo { target: string; from: number; to: number; chain: string[]; sourceRunId: string | null }
export interface InlineFlag { kind: FaultKind | 'nudge'; point: string /* 'stepId/pointId' */; text: string }
export interface ChatLine { who: Speaker; text: string; atMs: number | null; route?: string; flags?: InlineFlag[]; tapped?: true }
export interface PointHit { line: number; pos: number; atMs: number | null; during: number; said: string; missing: string[];
  check: 'right' | 'wrong' | 'unnamed' | null; chose: string | null; tapped?: true }
export interface PartHit { line: number; pos: number }
export interface Reading { key: ReadingKey; value: string; atMs: number | null; o2: string | null }   // o2: 'RA', 'NC'… for spo2 only
export interface OxygenGiven { device: OxygenDevice; flow: number | null; atMs: number | null; right: boolean }
export interface RunSession {
  id: string; caseId: string; mode: RunMode; startedAt: string; drill: DrillInfo | null;
  clock: RunClock; lastAt: number; current: number;
  hits: Record<string, PointHit>;          // 'stepId/pointId'
  parts: Record<string, PartHit>;          // 'stepId/pointId/partId'
  prefilled: string[]; tapped: string[];   // step ids
  nudged: string[]; flaggedOrder: string[]; disputes: string[];   // point keys
  played: string[];                        // reply keys 'stepId#index' of text replies already said
  lines: ChatLine[]; readings: Reading[]; oxygen: OxygenGiven | null; ecg: '12-lead' | '4-lead' | null;
  reassessFromMs: number | null; reassessSets: number; rbsMs: number | null; standbyMs: number | null;
  stepTimes: Record<string, number>;       // step id → clock ms when first reached (timed steps)
}
export interface TranscriptLine { who: string; text: string; atMs: number | null }   // Plan 1's transcript entry
export interface Fault { kind: FaultKind; point: string; step: number; label: string; detail: string | null; atMs: number | null }
export interface CaseRecordFacts { complaint: string | null; moi: string | null; oxygen: string | null; ecg: string | null;
  hypocount: string | null; position: string | null; decision: string | null; sracie: string[]; standby: TranscriptLine[] }
export interface RunRecord {
  // Plan 1 fields, unchanged
  id: string; caseId: string; mode: RunMode; drill: boolean; startedAt: string; usedMs: number;
  stepTimes: Record<string, number>; missed: string[]; order: string[]; phrase: string[]; disputes: string[]; tapped: string[];
  transcript: TranscriptLine[];
  // v2; a v1 record loads with these defaults
  wrong: string[];                      // []
  faults: Fault[];                      // []
  rbsMs: number | null;                 // null
  standbyMs: number | null;             // null
  readings: Reading[];                  // []
  oxygen: OxygenGiven | null;           // null
  record: CaseRecordFacts | null;       // null
  drillRange: [number, number] | null;  // null
  drillChain: string[];                 // []
  stepsTotal: number;                   // 19
  reached: number[];                    // [] — step orders with any hit (the debrief's Call segment spikes)
}
// Progress.runOpen: RunSession | null   (an invalid one falls back to null, as quizOpen does)
export function addRunRecord(p: Progress, r: RunRecord): Progress   // appends; keeps the newest runsKept; empties transcripts past the newest transcriptsKept
export function activeFaults(r: RunRecord): Fault[]                  // faults whose point is not in r.disputes
```
- Produces (`src/progress/slots.ts`):
```ts
/** Remembers what each slot last held and what it read as, so an unchanged slot costs a getItem and a string compare. */
export interface SlotMemo { readonly kind: 'memo' }      // opaque
export function createSlotMemo(): SlotMemo
export function savedOnDisk(storage: SlotStorage, memo?: SlotMemo): { seq: number; newer: boolean }
export function saveProgress(storage: SlotStorage, data: Progress, seq: number, now: Date, memo?: SlotMemo): { ok: true; savedAt: string } | { ok: false; error: string }
```
- **`createProgressStore`:**
  - it keeps one memo and passes it to `checkDisk` and `persist`;
  - each save is wrapped in `performance.mark('crewleader:save:start')` and `performance.measure('crewleader:save', 'crewleader:save:start')`, when `performance.measure` exists. Task 20 reads it.

- [ ] **Step 1: Write the failing tests**

`tests/unit/progress-v2.test.ts`:
```ts
import { vi } from 'vitest';
import { SCHEMA_VERSION, RUN_LIMITS, addRunRecord, activeFaults, defaultProgress, normalizeProgress, type RunRecord } from '../../src/progress/types';
import { SLOT_KEYS, checksum, loadProgress } from '../../src/progress/slots';
import { createProgressStore } from '../../src/progress/store';
import { MemoryStorage } from './helpers';

const AT = '2026-11-12T10:00:00.000Z';
const V1_RUN = { id: 'r1', caseId: 'copd-amk-01', mode: 'coached', drill: false, startedAt: AT, usedMs: 600_000,
  stepTimes: {}, missed: [], order: [], phrase: [], disputes: [], tapped: [], transcript: [{ who: 'You', text: 'Hi', atMs: null }] };
const v1Slot = (data: unknown) => {
  const json = JSON.stringify(data);
  return `{"v":1,"seq":1,"savedAt":"${AT}","sum":"${checksum(json)}","data":${json}}`;
};
const record = (n: number): RunRecord => ({ ...(normalizeProgress({ runs: [V1_RUN] })!.runs[0]!), id: `r${n}`, startedAt: new Date(Date.UTC(2026, 10, 1, 0, n)).toISOString() });

test('the schema version is 2, in the same two slots', () => {
  expect(SCHEMA_VERSION).toBe(2);
  expect(SLOT_KEYS).toEqual(['crewleader.save.0', 'crewleader.save.1']);
});
test('a v1 save loads under v2, its runs given the v2 defaults', () => {
  const storage = new MemoryStorage({ [SLOT_KEYS[1]]: v1Slot({ ...defaultProgress(), runs: [V1_RUN], runOpen: null }) });
  const r = loadProgress(storage);
  expect(r.status).toBe('ok');
  expect(r.data.runs[0]).toMatchObject({ id: 'r1', wrong: [], faults: [], rbsMs: null, standbyMs: null, readings: [],
    oxygen: null, record: null, drillRange: null, drillChain: [], stepsTotal: 19, reached: [] });
});
test('the first save after a v1 load is a v2 save in the other slot', () => {
  const storage = new MemoryStorage({ [SLOT_KEYS[1]]: v1Slot(defaultProgress()) });
  const store = createProgressStore(storage);
  store.update((p) => ({ ...p, notes: { ...p.notes, read: ['s01'] } }));
  expect(JSON.parse(storage.raw(SLOT_KEYS[0])!)).toMatchObject({ v: 2, seq: 2 });
  expect(storage.raw(SLOT_KEYS[1])).toBe(v1Slot(defaultProgress()));   // the v1 save is kept as the fallback
});
test('a run in progress that fails its schema becomes null; the rest loads', () => {
  const p = normalizeProgress({ runOpen: { id: 7 }, notes: { lastSection: 's03', read: [] } });
  expect(p).not.toBeNull();
  expect(p!.runOpen).toBeNull();
  expect(p!.notes.lastSection).toBe('s03');
});
test('addRunRecord keeps the newest 50 runs and transcripts on the newest 10 only', () => {
  let p = defaultProgress();
  for (let n = 1; n <= RUN_LIMITS.runsKept + 2; n++) p = addRunRecord(p, record(n));
  expect(p.runs).toHaveLength(50);
  expect(p.runs[0]!.id).toBe('r3');
  expect(p.runs.filter((r) => r.transcript.length > 0).map((r) => r.id)).toEqual(['r43', 'r44', 'r45', 'r46', 'r47', 'r48', 'r49', 'r50', 'r51', 'r52']);
});
test('a disputed point leaves every fault of that point out', () => {
  const r = { ...record(1), disputes: ['rapid-body-survey/pocket-check'], faults: [
    { kind: 'missed', point: 'rapid-body-survey/pocket-check', step: 12, label: 'Pocket check', detail: null, atMs: 170_000 },
    { kind: 'phrase', point: 'scene-evaluation/moi', step: 4, label: 'MOI', detail: null, atMs: null },
  ] } as RunRecord;
  expect(activeFaults(r).map((f) => f.point)).toEqual(['scene-evaluation/moi']);
});
```
`tests/unit/store.test.ts`, appended:
```ts
test('a save re-reads unchanged slots from the memo, so it parses JSON once', () => {
  const storage = new MemoryStorage();
  const store = createProgressStore(storage);
  store.update((p) => ({ ...p, notes: { ...p.notes, read: ['s01'] } }));
  const parse = vi.spyOn(JSON, 'parse');
  store.update((p) => ({ ...p, notes: { ...p.notes, read: ['s01', 's02'] } }));
  expect(parse).toHaveBeenCalledTimes(1);   // saveProgress checking what it is about to write
  parse.mockRestore();
});
test('a slot another window changed is still read, and holds the save back', () => {
  const storage = new MemoryStorage();
  const store = createProgressStore(storage);
  store.update((p) => ({ ...p, notes: { ...p.notes, read: ['s01'] } }));
  const other = createProgressStore(storage);
  other.update((p) => ({ ...p, notes: { ...p.notes, read: ['s09'] } }));
  store.update((p) => ({ ...p, notes: { ...p.notes, read: ['s01', 's02'] } }));
  expect(store.writeBlock()).toBe('conflict');
});
```
A typed run round-trip goes in `tests/unit/progress-v2.test.ts`. It saves a progress whose `runOpen` is a full `RunSession` literal (every field set), loads it back and asserts `toEqual` on it.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/unit/progress-v2.test.ts tests/unit/store.test.ts`
Expected: FAIL. `SCHEMA_VERSION` is 1, `addRunRecord` is undefined, and `JSON.parse` is called 3 times.

- [ ] **Step 3: Implement it.**
- **Schemas:** `RunSessionSchema` and `RunRecordSchema` mirror the interfaces, through Plan 1's `obj` and `dict` helpers.
- **Defaults:** the v2 record fields use `v.optional(…, default)`, so a v1 record loads.
- **`runOpen`:** uses the same `v.optional(v.fallback(v.nullable(RunSessionSchema), null), null)` pattern as `quizOpen`.
- **The memo:** keyed by slot key. It holds the last raw string with its parsed `Slot`. `readSlot` is skipped when `getItem` returns that string, and `saveProgress` records the text it wrote.

- [ ] **Step 4: Run the whole suite**

Run: `npx vitest run && npm run typecheck`
Expected: all PASS. `tests/e2e/seed.ts` still type-checks, and now seeds v2.

- [ ] **Step 5: Commit**

```bash
git add src/progress tests/unit
git commit -m "feat(progress): v2 saves with typed runs, capped transcripts and a slot memo" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Six more cases

**Files:**
- Create:
  - `public/data/cases/chestpain-bedok-01.json`
  - `public/data/cases/ccf-jurong-01.json`
  - `public/data/cases/asthma-tampines-01.json`
  - `public/data/cases/bleed-woodlands-01.json`
  - `public/data/cases/fall-yishun-01.json`
  - `public/data/cases/rta-toapayoh-01.json`
- Modify:
  - `public/data/cases/index.json` (eight entries, in this order: copd, hypo, then the six above);
  - `tests/unit/data-integrity.test.ts`.

**Interfaces:**
- Consumes: the Task 1 Case shape; `conditionHolds`; the notes' protocols (s05, s01, s11, s16 and s17).
- Produces: the eight-case library. The complaints in index order are Breathlessness, Giddiness, Chest pain, Bleeding, Fall and Road accident; Run start groups by them.

**Sources:** the trainee's notes:
- s05: protocols 2, 4, 5 and 6;
- s01: Approach, Delicate Spine, RBS, Immobilization and Decision Point;
- s11: Oxygen Guidelines ("All trauma and unconscious patients → high-flow O2");
- s16: Asthma;
- s17: Managing Chest Pain.

**Shared rules:**
- **Vitals:** room air equals after-O2, except SpO2.
- **Masked ICs** use the birth-year digits.
- **Caller voices:** casual Singapore English, using only the case's facts.
- **Patient lines:** all 11 keys, in voice, plus `convinced` where the position isn't ideal.
- **No impending-failure signs.** No case shows signs of impending respiratory failure (s05 and s11), so BVM is never the expected device. Every patient speaks in complete, if breathless, sentences.
- **Fields a block doesn't name** take the plain normal finding, worded as in the two Plan 1 cases:
  - `findings.approach.bleeding` "No catastrophic bleeding." (every case but the haemorrhage);
  - airway "Clear, no obstacles" and "No unusual breath smell" (the chest pain case's smell is given);
  - "Chest rise and fall present";
  - `rateQuality` "fast and shallow" in all six;
  - spine "No", "No" and "No deformities, tenderness, bruises or lacerations", with `neckPain` false;
  - history "No asthma or COPD" and "No other illness";
  - pulse "Radial pulse present, fast and strong";
  - RBS "No abnormalities found", `jvd` false and `pedalEdema` false;
  - auscultation "Air entry equal, breath sounds clear";
  - `witnesses` names the caller.

**The six cases:**
1. **`chestpain-bedok-01`** (medical; complaint "Chest pain"; Bedok):
   - **Call:** callText "Middle-aged male, chest pain"; location "Blk 1xx Bedok North Rd, #05-xx"; the caller is his wife.
   - **Patient:** Ahmad bin Salleh, Malay male, 58, ic `S68xxxxxD`, callName "Encik Ahmad".
   - **Story:** heavy, squeezing chest pain for 30 minutes while watching TV, spreading to his left arm and jaw, with sweating. He has a heart problem and is on a GTN spray, and took one spray before the crew came.
   - **Scene:** a living room. Items: GTN spray, glass of water. Hazards: "GTN spray on the side table beside the patient".
   - **Findings:**
     - smell "Minty smell (GTN)";
     - NTUCP none;
     - history "No asthma or COPD" and "Angina, high BP, high cholesterol";
     - pulse "Radial pulse present, fast and strong";
     - gloves "A lot of sweat"; pockets ["GTN spray", "IC"];
     - auscultation "Air entry equal, breath sounds clear";
     - BP "150/94 mmHg", left arm;
     - ECG 12-lead "Sinus tachycardia about 104, ST elevation in II, III and aVF";
     - hypocount 6.2; GCS 4/5/6; severity "8".
   - **Vitals:** room air SpO2 93, PR 104, RR 24, BP 148/92, temp 36.8, skin "pale, cold, clammy", CRT "under 2 s". After O2, SpO2 98.
   - **Position:** choice "Lying flat on the sofa", ideal false, with a `convinced` line.
   - **Expected:**
     - oxygen non-rebreather 10–15 (s17: high-flow O2; never withhold O2);
     - ECG 12-lead;
     - signs ["low SpO2", "high HR", "ST elevation"], suspected "AMI", stay-and-treat.
   - **Flags:** []. **notesRef:** `s05#6-chest-pain-stay-treat`.
2. **`ccf-jurong-01`** (medical; complaint "Breathlessness"; Jurong West):
   - **Call:** callText "Elderly female, breathlessness"; location "Blk 6xx Jurong West St 61, #09-xx"; the caller is her daughter.
   - **Patient:** Kamala d/o Raman, Indian female, 76, ic `S50xxxxxC`, callName "Mdm Kamala".
   - **Story:** breathless for two days and worse lying down; sleeps on three pillows; swollen legs. She has heart failure and kidney failure, has dialysis three times a week through a fistula in her **left arm**, and is on GTN.
   - **Scene:** a bedroom. Items: medication box, GTN spray, three pillows. Hazards: "medication box on the bed beside the patient".
   - **Findings:**
     - NTUCP ["use of accessory muscles"];
     - history "No asthma or COPD" and "Heart failure, kidney failure on dialysis, high BP";
     - RBS "No injuries; both lower legs swollen"; jvd true; pedalEdema true;
     - auscultation "Air entry equal, crackles at both bases";
     - BP "178/96 mmHg"; **bpArm "right"**; `lines.bpScreen` says the left arm has her dialysis fistula;
     - ECG 12-lead "Sinus tachycardia about 116, ST elevation in V1 to V3";
     - hypocount 7.4; GCS 4/5/6; severity "7".
   - **Vitals:** room air SpO2 88, PR 116, RR 28, BP 176/94, temp 36.9, skin "pale, sweaty", CRT "under 2 s". After O2, SpO2 94.
   - **Position:** "Sitting at the edge of the bed", ideal true.
   - **Expected:**
     - non-rebreather 10–15 (s16: high-flow, as she has no COPD);
     - ECG 12-lead;
     - signs ["low SpO2", "high RR", "high BP"], suspected "CCF", stay-and-treat.
   - **Flags:** []. **notesRef:** `s05#5-congestive-cardiac-failure-ccf-stay-treat`.
3. **`asthma-tampines-01`** (medical; complaint "Breathlessness"; Tampines):
   - **Call:** callText "Young female, breathlessness"; location "Blk 8xx Tampines St 81, #03-xx"; the caller is her flatmate.
   - **Patient:** Goh Hui Min, Chinese female, 24, ic `T02xxxxxH`, callName "Ms Goh".
   - **Story:** sudden breathlessness while clearing a dusty storeroom in a flat under renovation (s16's dust trigger). She has had asthma since young, and her inhaler is empty.
   - **Scene:** renovation dust. Items: empty inhaler, broom. Hazards: "renovation tools on the floor beside the patient".
   - **Findings:**
     - she speaks in full but breathless sentences, with a wheeze;
     - NTUCP ["use of accessory muscles", "nasal flaring"];
     - history "Asthma since young" and "No other illness";
     - auscultation "Air entry equal, expiratory wheeze both sides";
     - BP "128/80 mmHg", left arm;
     - ECG 12-lead "Sinus tachycardia about 118";
     - hypocount 5.6; GCS 4/5/6; severity "7".
   - **Vitals:** room air SpO2 91, PR 118, RR 28, BP 126/78, temp 36.7, skin "pink, warm, sweaty", CRT "under 2 s". After O2, SpO2 96.
   - **Position:** "Sitting, leaning forward on a chair", ideal true.
   - **Expected:**
     - non-rebreather 10–15;
     - ECG 12-lead;
     - signs ["low SpO2", "high RR", "high HR"], suspected "asthma", stay-and-treat.
   - **Flags:** ["asthmaCopd"]. **notesRef:** `s05#4-asthma-copd-in-respiratory-distress-stay-treat`.
4. **`bleed-woodlands-01`** (trauma; complaint "Bleeding"; Woodlands):
   - **Call:** callText "Adult male, deep cut, heavy bleeding"; location "Blk 7xx Woodlands Dr 50, #02-xx"; the caller is his wife. criticalInjuries: "Got a lot of blood from his arm, the towel all soaked already."
   - **Patient:** Suresh s/o Muthu, Indian male, 45, ic `S81xxxxxF`, callName "Mr Suresh".
   - **Story:** cut his right forearm on a broken glass jug in the kitchen.
   - **Scene:** a kitchen, with blood on the floor. Items: broken glass, a soaked towel. Hazards: "broken glass on the floor beside the patient".
   - **Findings:**
     - `catastrophicBleeding` true;
     - `bleeding` "Yes: heavy bleeding from a deep cut on the right forearm, soaking through the towel.";
     - `control`: pressure "Still bleeding.", dressing "Blood soaking through the dressing.", cat "Bleeding has stopped.";
     - no fall;
     - NTUCP none;
     - pulse "Radial pulse present, fast and weak";
     - RBS "Deep cut on the right forearm, bleeding controlled; no other injuries";
     - gloves "A lot of blood"; pockets ["IC"];
     - BP "96/60 mmHg", left arm (the right forearm is injured);
     - ECG 4-lead "Sinus tachycardia about 124";
     - hypocount 5.8; GCS 4/5/6; severity "8".
   - **Vitals:** room air SpO2 95, PR 124, RR 24, BP 94/58, temp 36.2, skin "pale, cold, clammy", CRT "over 2 s". After O2, SpO2 99.
   - **Position:** "Sitting up against the cabinet", ideal false; the `convinced` line agrees to lie down (s01 Position: "Supine (esp. low BP patient)").
   - **Expected:**
     - non-rebreather 10–15;
     - ECG 4-lead;
     - signs ["low BP", "high HR"], suspected "arresting haemorrhage", load-and-go.
   - **Flags:** []. **notesRef:** `s05#2-arresting-haemorrhage-load-go`.
5. **`fall-yishun-01`** (trauma; complaint "Fall"; Yishun):
   - **Call:** callText "Elderly male, fall from ladder"; location "Blk 3xx Yishun Ring Rd, #10-xx"; the caller is his son. criticalInjuries: "No blood, but he say his neck very pain."
   - **Patient:** Ong Kok Leong, Chinese male, 67, ic `S59xxxxxJ`, callName "Mr Ong".
   - **Story:** fell about 2 m from a ladder while changing a light, landing on his back and hitting his head.
   - **Scene:** a kitchen. Items: a ladder lying on its side. Hazards: "fallen ladder beside the patient".
   - **Findings:**
     - spine: fall "Yes, from the ladder"; hitHead "Yes, the back of my head"; dtbl "Tenderness at the back of the neck; no deformities, bruises or lacerations"; **neckPain true**;
     - airway: the modified jaw thrust applies;
     - NTUCP none;
     - RBS "Bruise at the back of the head; tenderness at the neck; no other injuries";
     - gloves "Slight sweat"; pockets ["IC"];
     - BP "142/86 mmHg", left arm;
     - ECG 4-lead "Sinus tachycardia about 104";
     - hypocount 6.4; GCS 4/5/6; severity "7".
   - **Vitals:** room air SpO2 96, PR 104, RR 22, BP 140/84, temp 36.6, skin "warm, dry", CRT "under 2 s". After O2, SpO2 99.
   - **Position:** "Lying on his back on the floor", ideal true (a spinal patient stays supine).
   - **Expected:**
     - non-rebreather 10–15;
     - ECG 4-lead;
     - signs ["neck tenderness", "high HR"], suspected "spinal injury", load-and-go.
   - **Flags:** []: `neckPain` makes `spinal` hold. **notesRef:** `s01#delicate-spine`.
6. **`rta-toapayoh-01`** (trauma; complaint "Road accident"; Toa Payoh):
   - **Call:** callText "Motorcyclist down after a collision with a car"; location "Lorong 6 Toa Payoh, bus stop near Toa Payoh Central"; the caller is a passer-by.
     - vehicles: "One motorbike, one car."
     - criticalInjuries: "His leg look broken, a bit of blood only."
     - icAndMeds: "I don't know him leh, his wallet maybe in his bag."
   - **Patient:** Faizal bin Rahim, Malay male, 31, ic `S95xxxxxK`, callName "Encik Faizal".
   - **Scene:** roadside, with traffic still passing. Items: helmet, bag. Hazards: "traffic on the road beside the patient" and "petrol leaking from the motorbike".
   - **Findings:**
     - he took his helmet off before the crew came;
     - spine: fall "Yes, fell off the bike"; hitHead "No, I had my helmet on"; dtbl "No deformities, tenderness, bruises or lacerations"; neckPain false;
     - NTUCP none;
     - RBS "Deformity and swelling of the right lower leg; pain at the upper back when pressed" (the cue for `c-collar-after-rbs`);
     - `limb`: injury "Right lower leg, deformed and swollen"; distalPulse "Distal pulse present in the right foot."; immobilise "Buddy splints the right leg as instructed.";
     - gloves "Slight blood"; pockets ["wallet", "IC"];
     - BP "130/84 mmHg", left arm;
     - ECG 4-lead "Sinus tachycardia about 112";
     - hypocount 6.0; GCS 4/5/6; severity "9".
   - **Vitals:** room air SpO2 95, PR 112, RR 24, BP 128/82, temp 36.9, skin "pale, sweaty", CRT "under 2 s". After O2, SpO2 99.
   - **Position:** "Lying on the road", ideal true.
   - **Expected:**
     - non-rebreather 10–15;
     - ECG 4-lead;
     - signs ["leg deformity", "high HR"], suspected "fracture of the right leg", load-and-go.
   - **Flags:** ["rta", "extraPpe", "limbInjury", "spinalAfterRbs"]. **notesRef:** `s01#immobilization`.

- [ ] **Step 1: Write the failing tests.** In `tests/unit/data-integrity.test.ts`:
- Import `conditionHolds` with the other schema names.
- Load every case through `import.meta.glob('../../public/data/cases/*.json', { eager: true, import: 'default' })`, replacing the two named imports.
- Build `CASE_FILES` from the glob.
- Make `cases` the eight, parsed in index order.
- Change "the index lists both cases" to:
```ts
const ALL = ['copd-amk-01', 'hypo-hougang-01', 'chestpain-bedok-01', 'ccf-jurong-01', 'asthma-tampines-01',
  'bleed-woodlands-01', 'fall-yishun-01', 'rta-toapayoh-01'];
test('the index lists all eight cases, and every case file is in it', () => {
  expect(v.parse(CaseIndexSchema, caseIndex).cases.map(c => c.id)).toEqual(ALL);
  expect(Object.keys(CASE_FILES).length).toBe(8);
});
test('the protocols the spec names each have a case', () => {
  const byId = Object.fromEntries(cases.map(c => [c.id, c]));
  expect(byId['chestpain-bedok-01']!.expected.ecg).toBe('12-lead');
  expect(byId['chestpain-bedok-01']!.findings.position.ideal).toBe(false);
  expect(byId['ccf-jurong-01']!.findings.investigation.bpArm).toBe('right');
  expect([byId['ccf-jurong-01']!.findings.rbs.jvd, byId['ccf-jurong-01']!.findings.rbs.pedalEdema]).toEqual([true, true]);
  expect(byId['ccf-jurong-01']!.patient.lines.bpScreen.toLowerCase()).toContain('fistula');
  expect(byId['asthma-tampines-01']!.flags).toContain('asthmaCopd');
  expect(byId['bleed-woodlands-01']!.findings.approach.catastrophicBleeding).toBe(true);
  expect(conditionHolds(byId['fall-yishun-01']!, 'spinal')).toBe(true);
  expect(byId['rta-toapayoh-01']!.flags).toEqual(['rta', 'extraPpe', 'limbInjury', 'spinalAfterRbs']);
  for (const id of ['bleed-woodlands-01', 'fall-yishun-01', 'rta-toapayoh-01']) {
    expect(byId[id]!.type, id).toBe('trauma');
    expect(byId[id]!.expected.decision.plan, id).toBe('load-and-go');
    expect(byId[id]!.expected.oxygen, id).toEqual({ device: 'non-rebreather', flowMin: 10, flowMax: 15 });
  }
  for (const c of cases) {
    expect(c.findings.loc.avpu, c.id).toBe('A');                         // all conscious (spec §11)
    expect(c.vitals.afterO2.spo2, c.id).toBeGreaterThan(c.vitals.roomAir.spo2);
    expect(c.expected.oxygen.device, c.id).not.toBe('bvm');
  }
});
```
The existing tests now cover all eight: "every case is unstable, masked, unreviewed…", the Task 1 reply and conditional-content tests, the index↔file agreement, and room air = after O2 except SpO2.

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run tests/unit/data-integrity.test.ts`
Expected: FAIL. The index lists 2 cases.

- [ ] **Step 3: Write the six case files and the index** from the blocks above.

- [ ] **Step 4: Run it and see it pass**

Run: `npx vitest run tests/unit/data-integrity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/data/cases tests/unit/data-integrity.test.ts
git commit -m "feat(data): six more cases: chest pain, CCF, asthma, haemorrhage, fall with neck pain, RTA" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Word-start matcher

**Files:**
- Create: `src/sim/match.ts`
- Modify: `tests/unit/data-integrity.test.ts`. The two phrase tests ("a line for another point…" and "other correct phrasings…") use `matchAt` in place of the naive `hits`.
- Test: `tests/unit/match.test.ts`

**Interfaces:**
- Consumes: `Match`, `MatchSlot`, `Case` (Task 1).
- Produces:
```ts
export type MatchSlots = Record<MatchSlot, string[]>;
export function normalizeLine(line: string): string
export function termAt(text: string, term: string): number
export function expandTerm(term: string, slots: MatchSlots | null): string[]
export function matchAt(text: string, match: Match, slots: MatchSlots | null, negatives?: string[]): number
export function caseSlots(c: Case, eta: number | null): MatchSlots
export function splitSentences(line: string): string[]
```
**Rules:**
- **`normalizeLine`:**
  - lowercase;
  - ’ ‘ → ', and “ ” → ";
  - – — → `-`;
  - `&` → ` and `;
  - digit-hyphen-digit (`1-6`, `10-15`) → `1 to 6`;
  - whitespace runs → one space;
  - trim.
- **`termAt`:**
  - The term must start at a word start: index 0, or a non-`[a-z0-9]` character before it. This applies only when the term's first character is `[a-z0-9]`.
  - A term of 3 characters or fewer must also end at a word end, when its last character is `[a-z0-9]`.
  - Longer terms are prefixes, so stems work.
- **Slots:** a term holding `{slot}` expands to one term per slot value. With `slots` null, a slotted term never matches.
- **`matchAt`:**
  - an alternative matches when every one of its terms is found;
  - its position is the smallest of its terms' positions;
  - the result is the smallest position over the matching alternatives, or −1;
  - any negative term found vetoes the whole match.
- **`caseSlots(c, eta)`:**
  - age `[String(age)]`;
  - decade `[`${Math.floor(age / 10) * 10}s`]`;
  - ic `[ic.toLowerCase(), ic.slice(0, 3).toLowerCase()]`;
  - eta: `eta === null ? [] : [eta - 1, eta, eta + 1]` filtered to ≥ 1, as strings;
  - bparm `[bpArm]`.
- **`splitSentences`:**
  - splits after `?`, `!` or `;`, and at newlines;
  - splits after `.` only when the word before it has 3 or more characters and no inner `.` (so "IC no.", "e.g." and "C.A.T." never split);
  - trims, and drops empty pieces.

- [ ] **Step 1: Write the failing test** `tests/unit/match.test.ts`

```ts
import * as v from 'valibot';
import copd from '../../public/data/cases/copd-amk-01.json';
import { CaseSchema } from '../../src/data/schema';
import { caseSlots, expandTerm, matchAt, normalizeLine, splitSentences, termAt } from '../../src/sim/match';

const SLOTS = { age: ['72'], decade: ['70s'], ic: ['s54xxxxxa', 's54'], eta: ['5', '6', '7'], bparm: ['left'] };

test('normalizeLine folds case, quotes, dashes, ampersands, spaces and number ranges', () => {
  expect(normalizeLine('  Ma’am,  “Suspected”  –  points 1-6  ')).toBe(`ma'am, "suspected" - points 1 to 6`);
  expect(normalizeLine('SpO2 & PR')).toBe('spo2 and pr');
  expect(normalizeLine('NRM 10-15 L/min, 4-in-1')).toBe('nrm 10 to 15 l/min, 4-in-1');
});
test('terms match at word starts, so stems work and inner letters never do', () => {
  expect(termAt('any deformities?', 'deformit')).toBe(4);
  expect(termAt('medication', 'ic')).toBe(-1);
  expect(termAt('ic no. s54xxxxxa', 'ic')).toBe(0);
  expect(termAt('every 15 mins', '5 min')).toBe(-1);
  expect(termAt('every 5 mins', '5 min')).toBe(6);
});
test('terms of 3 characters or fewer match whole words only', () => {
  expect(termAt('blood pressure', 'pr')).toBe(-1);
  expect(termAt('pr 112, bp 146/86', 'pr')).toBe(0);
  expect(termAt('raise both arms', 'arm')).toBe(-1);
  expect(termAt('gcs is 15/15', '/15')).toBe(9);
});
test('an alternative needs all its terms; negatives veto the match', () => {
  expect(matchAt('remove the head grip', [['remove', 'grip']], null)).toBe(0);
  expect(matchAt('grip the head', [['remove', 'grip']], null)).toBe(-1);
  expect(matchAt('no suspected spinal injuries', [['suspect']], null, ['no suspected'])).toBe(-1);
  expect(matchAt('hello there', [['bye'], ['hell']], null)).toBe(0);
});
test('slot terms expand from the case', () => {
  expect(expandTerm('{age}', SLOTS)).toEqual(['72']);
  expect(expandTerm('{bparm} arm', SLOTS)).toEqual(['left arm']);
  expect(expandTerm('{age}', null)).toEqual([]);
  expect(matchAt('chinese female, 70s', [['{age}'], ['{decade}']], SLOTS)).toBe(16);
  expect(matchAt('ic no. s54xxxxxa', [['{ic}']], SLOTS)).toBe(7);
  expect(caseSlots(v.parse(CaseSchema, copd), 6)).toEqual(SLOTS);
  expect(caseSlots(v.parse(CaseSchema, copd), 1).eta).toEqual(['1', '2']);
});
test('sentences split at ? ! ; and newlines, and at full stops after real words', () => {
  expect(splitSentences('Is there air entry? Is air entry equal. Any abnormal sounds!'))
    .toEqual(['Is there air entry?', 'Is air entry equal.', 'Any abnormal sounds!']);
  expect(splitSentences('IC no. S54xxxxxA, ETA 6 mins.')).toEqual(['IC no. S54xxxxxA, ETA 6 mins.']);
  expect(splitSentences('If still bleeding, apply C.A.T. Then check')).toEqual(['If still bleeding, apply C.A.T. Then check']);
  expect(splitSentences('Hi\n\nBye')).toEqual(['Hi', 'Bye']);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run tests/unit/match.test.ts`
Expected: FAIL resolving `src/sim/match`.

- [ ] **Step 3: Implement `src/sim/match.ts`, then switch the two phrase tests** in `data-integrity.test.ts` to `matchAt(normalizeLine(line), m.match, caseSlots(copdCase, 6)) >= 0`. The canonical-line test stays naive until Task 8 brings `fillCanonical`.

- [ ] **Step 4: Run them and see them pass**

Run: `npx vitest run tests/unit/match.test.ts tests/unit/data-integrity.test.ts`
Expected: PASS. Every Plan 1 phrase assertion still holds under word starts.

- [ ] **Step 5: Commit**

```bash
git add src/sim/match.ts tests/unit/match.test.ts tests/unit/data-integrity.test.ts
git commit -m "feat(sim): word-start matcher with case slots and sentence splitting" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Keyword grader, and reading the oxygen and ECG

**Files:**
- Create: `src/sim/oxygen.ts`, `src/sim/grader.ts`, `tests/unit/sim-helpers.ts`
- Test: `tests/unit/oxygen.test.ts`, `tests/unit/grader.test.ts`

**Interfaces:**
- Consumes:
  - `match.ts` (Task 4);
  - `Step`, `Case`, `MustHit`, `Addressee`, `Role`, `OxygenDevice` and `conditionHolds` (Task 1).
- Produces (`src/sim/oxygen.ts`):
```ts
export interface OxygenChoice { device: OxygenDevice | null; flow: number | null; flowMax: number | null }
export function readOxygen(normalized: string): OxygenChoice | null    // null when neither a device nor a flow is named
export function oxygenRight(choice: OxygenChoice, expected: Case['expected']['oxygen']): boolean
export function readEcg(normalized: string): '12-lead' | '4-lead' | null
export const DEVICE_SHORT: Record<OxygenDevice, string>   // NC, SFM, NRM, Neb, BVM, RA
export const DEVICE_LABEL: Record<OxygenDevice, string>   // 'nasal cannula', 'simple face mask', 'non-rebreather mask', 'nebuliser mask', 'BVM', 'no oxygen'
export function describeOxygen(choice: OxygenChoice): string   // 'nasal cannula 3 L/min'; 'non-rebreather mask 10–15 L/min'; 'no oxygen'
```
- **Device terms** (through `termAt`):
  - nasal-cannula: "nasal cannula", "cannula", "nasal prong", "nc";
  - simple-face-mask: "simple face mask", "simple mask", "sfm", "face mask";
  - non-rebreather: "non-rebreather", "non rebreather", "nonrebreather", "nrm", "nrb";
  - nebuliser-mask: "nebuliser", "nebulizer", "neb";
  - bvm: "bvm", "bag valve", "bag-valve";
  - none: "no oxygen", "oxygen not required", "not required", "not needed", "optional", "room air".
- **Flow:** the first `(\d+(\.\d+)?)( to (\d+(\.\d+)?))? ?(l|lpm|l/min|litres?|liters?)` match gives `flow` and `flowMax`.
- **`oxygenRight`:**
  - with `optional`: right when the device is null or `none`, or when it matches exactly as below;
  - otherwise: the device equals the expected one, and the flow, and `flowMax` when given, lie within `[flowMin, flowMax]`.
- **`readEcg`:** `12`/`twelve`, then an optional space or hyphen, then `lead` → `'12-lead'`; the same with 4 or four → `'4-lead'`.
- Produces (`src/sim/grader.ts`):
```ts
export type Heard = Addressee | 'buddy';
export interface GradeContext { case: Case; steps: Step[]; current: number; slots: MatchSlots; done: ReadonlySet<string> }
// done: 'stepId/pointId' keys of points already done (hit, tapped or prefilled)
export interface PointReading { step: string; point: string; parts: string[]; whole: boolean; missing: string[]; pos: number }
export interface SentenceReading { text: string; step: string | null; addressee: Heard | 'unclear' | null; points: PointReading[];
  oxygen: OxygenChoice | null; ecg: '12-lead' | '4-lead' | null }
export interface Interpretation { sentences: SentenceReading[] }
/** The seam for Plan 3's Claude API tester: anything that turns a line into readings. */
export interface Grader { readonly id: string; interpret(line: string, ctx: GradeContext): Promise<Interpretation> }
export const keywordGrader: Grader                              // id 'keywords'; splitSentences, then readSentence for each
export function readSentence(text: string, ctx: GradeContext): SentenceReading
export function stepPriority(current: number, total: number): number[]
export function detectAddressee(normalized: string, callName: string): Heard | null
export function replyRole(step: Step, pointId: string): Role | null   // the role of the first reply whose `on` names the point or one of its parts
```
**`readSentence` algorithm:**
1. Normalize the text.
2. The priority order is `stepPriority(ctx.current, steps.length)`: current, current+1, current+2, then current−1 down to 1, then current+3 up to the last.
3. In every step, test each point whose `when` holds for the case:
   1. A negative found skips the point.
   2. `whole` = `matchAt` over `match`, plus `local` when `step.order === ctx.current`, plus every `accept` alternative.
   3. `parts` = the ids of the parts that match; a matched `accept` counts all of them.
   4. A point counts when `whole` or `parts` is non-empty.
   5. `missing` = the point's `requiredWords` not found.
   6. `pos` = the earliest position.
4. The step is chosen in two passes:
   1. The first of [current, current+1, current+2] with a counting point that is **not in `ctx.done`** takes the sentence. This stops a finished step from swallowing the next step's opening, such as "Arm buddy, please recheck the SpO2." after step 14.
   2. Otherwise, the first step in priority order with any counting point takes it, as a re-ask that replays the replies.
5. The step that takes the sentence takes all its counting points there. `oxygen` and `ecg` are read from every sentence.

**Addressee:**
1. `heard` = `detectAddressee`:
   - "arm buddy" → armBuddy; "head buddy" → headBuddy; "buddy", "buddies" or "medic" → buddy;
   - "ops ctr", "ops centre", "ops center" or a bare "ops" → opsCtr;
   - "crew" or "guys" → crew;
   - "tester" or "examiner" → tester;
   - "caller" → caller;
   - "sir", "ma'am", "madam", "mdm", "mr", "ms", "encik", "cik", "uncle", "auntie", "aunty", or the last word of `callName` → patient.
2. Each point's target = `point.to ?? replyRole(step, point.id)`.
3. With `heard` null, if the targets reach two or more of patient, tester and buddy (where armBuddy and headBuddy count as buddy) → `'unclear'` (R8).
4. With `heard` = buddy → the first target that is armBuddy or headBuddy, else buddy.
5. Any other `heard` → `heard`.
6. Otherwise → the first non-null target, else null.

`tests/unit/sim-helpers.ts` exports:
- `STEPS: Step[]` and `CASES: Case[]`, read with `readFileSync` and parsed by the valibot schemas. It uses no JSON imports, so the Playwright seed helper can import this file too (Task 20);
- `caseById(id)`;
- `ctxAt(stepId, caseId = 'copd-amk-01', eta = 6, done?: string[]): GradeContext`, with `current` set to that step's order. By default `done` holds every applicable point of the steps before it, as a run would have them.

- [ ] **Step 1: Write the failing tests**

`tests/unit/oxygen.test.ts`:
```ts
const n = normalizeLine;
const COPD = caseById('copd-amk-01').expected.oxygen;     // NC 2–4
const HYPO = caseById('hypo-hougang-01').expected.oxygen;  // NC 2–4, optional
test('reads the device and the flow', () => {
  expect(readOxygen(n('Buddy, nasal cannula 3 litres please'))).toEqual({ device: 'nasal-cannula', flow: 3, flowMax: null });
  expect(readOxygen(n('NRM 15 lpm'))).toEqual({ device: 'non-rebreather', flow: 15, flowMax: null });
  expect(readOxygen(n('Non-rebreather mask at 10-15 L/min'))).toEqual({ device: 'non-rebreather', flow: 10, flowMax: 15 });
  expect(readOxygen(n('Oxygen not required, SpO2 above 95%'))).toEqual({ device: 'none', flow: null, flowMax: null });
  expect(readOxygen(n('Checking the radial pulse'))).toBeNull();
});
test('judges the choice against the case', () => {
  expect(oxygenRight({ device: 'nasal-cannula', flow: 3, flowMax: null }, COPD)).toBe(true);
  expect(oxygenRight({ device: 'nasal-cannula', flow: 2, flowMax: 4 }, COPD)).toBe(true);
  expect(oxygenRight({ device: 'simple-face-mask', flow: 6, flowMax: null }, COPD)).toBe(false);
  expect(oxygenRight({ device: 'nasal-cannula', flow: 6, flowMax: null }, COPD)).toBe(false);
  expect(oxygenRight({ device: 'nasal-cannula', flow: null, flowMax: null }, COPD)).toBe(false);
  expect(oxygenRight({ device: 'none', flow: null, flowMax: null }, HYPO)).toBe(true);
  expect(oxygenRight({ device: 'nasal-cannula', flow: 3, flowMax: null }, HYPO)).toBe(true);
  expect(oxygenRight({ device: 'non-rebreather', flow: 15, flowMax: null }, HYPO)).toBe(false);
});
test('reads the ECG type and describes a choice', () => {
  expect(readEcg(n('12-lead ECG please'))).toBe('12-lead');
  expect(readEcg(n('Four lead ECG'))).toBe('4-lead');
  expect(readEcg(n('ECG please'))).toBeNull();
  expect(describeOxygen({ device: 'nasal-cannula', flow: 3, flowMax: null })).toBe('nasal cannula 3 L/min');
  expect(describeOxygen({ device: 'non-rebreather', flow: 10, flowMax: 15 })).toBe('non-rebreather mask 10–15 L/min');
});
```
`tests/unit/grader.test.ts`:
- **`stepPriority`:**
  - `stepPriority(10, 19)` is `[10, 11, 12, 9, 8, 7, 6, 5, 4, 3, 2, 1, 13, 14, 15, 16, 17, 18, 19]`;
  - `stepPriority(1, 19)` is `[1, …, 19]`;
  - `stepPriority(19, 19)` is `[19, 18, …, 1]`.
- **`detectAddressee`:**
  - `'arm buddy, spo2 please'` → `'armBuddy'`;
  - `'buddy, do head grip'` → `'buddy'`;
  - `"sir, did you fall?"` → `'patient'`;
  - `'mdm tan, any pain?'` with callName "Mdm Tan" → `'patient'`;
  - `'fmv 123 to ops ctr, standby message, over'` → `'opsCtr'`;
  - `'crew, please don latex gloves'` → `'crew'`;
  - `'checking the radial pulse'` → `null`.
- **Real data:**
  - with `ctxAt('breathing')`, `readSentence('Arm buddy, please measure the SpO2 reading on room air.')` → step `'breathing'`, addressee `'armBuddy'`, and points `[expect.objectContaining({ point: 'spo2' })]`.
  - **A message across two steps:** `keywordGrader.interpret('Is there chest rise and fall? Arm buddy, SpO2 please. Checking the radial pulse, what is the rate and quality?', ctxAt('breathing'))` resolves to three sentences:
    - steps `breathing`, `breathing`, `circulation`;
    - points `chest-rise-fall`, `spo2`, then `pulse` and `pulse-rate-quality`;
    - sentence 0's addressee is `'tester'`, through `replyRole`.
  - **Phrase:** with `ctxAt('scene-evaluation')`, `'MOI is case of breathlessness.'` gives `moi` with `missing: ['suspected']`; `'MOI is suspected case of breathlessness.'` gives `missing: []`.
  - **Accept:** with `ctxAt('preparation')`, `'Bring the 4 in 1 and LSU.'` gives `equipment` with all 6 parts and `whole: true`.
  - **A re-ask still counts:** with `ctxAt('vital-signs')`, `'Arm buddy, SpO2 again please.'` goes to step `vital-signs`, part `spo2`.
  - **An unhit point ahead beats a re-ask:**
    - with `ctxAt('vital-signs')` plus `vital-signs/arm-buddy` in `done`, `'Arm buddy, please recheck the SpO2.'` goes to step `oxygen`, point `recheck-spo2`;
    - with `ctxAt('breathing')` plus `breathing/spo2` in `done`, `'Arm buddy, SpO2 again please.'` stays in `breathing`.
- **Synthetic steps** (a local `step()` builder):
  - **Local alternatives:** step 2 point A has `match [['survey']]` and `local [['allow']]`. `'please allow me'` reads A at current 2, and step `null` at current 1.
  - **Unclear:** step 1 has point P (reply tester) and Q (reply patient), neither with `to`. `'pword and qword'` → `'unclear'`; `"sir, pword and qword"` → `'patient'`.
  - **Negatives:** a negative term vetoes the point.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/unit/oxygen.test.ts tests/unit/grader.test.ts`
Expected: FAIL resolving `src/sim/oxygen`.

- [ ] **Step 3: Implement `oxygen.ts`, `grader.ts` and `tests/unit/sim-helpers.ts`** to the rules above.

- [ ] **Step 4: Run them and see them pass**

Run: `npx vitest run tests/unit/oxygen.test.ts tests/unit/grader.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sim tests/unit/sim-helpers.ts tests/unit/oxygen.test.ts tests/unit/grader.test.ts
git commit -m "feat(sim): keyword grader behind the Grader interface; oxygen and ECG reading" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Paraphrase fixtures and term tuning

**Files:**
- Create: `tests/unit/paraphrases.ts` (the fixture data), `tests/unit/paraphrases.test.ts`
- Modify:
  - `public/data/steps.json`: terms, `local`, `requiredWords`, `negatives`, `accept`; `contentVersion` "2026-11-13.2";
  - `tests/unit/data-integrity.test.ts`: delete the two phrase tests, because the fixtures replace them.

**Interfaces:**
- Consumes: `keywordGrader`, `ctxAt` and `caseById` (Task 5).
- Produces: tuned `steps.json` and the fixture file. Every later grading change is tested against it.
```ts
// tests/unit/paraphrases.ts
export interface Paraphrase {
  at: string;          // the step id the run is on (ctx.current)
  line: string;        // a whole trainee message, as typed on a phone
  hits?: string[];     // 'step/point' or 'step/point.part' that must be read
  not?: string[];      // ones that must not be
  case?: string;       // default 'copd-amk-01'; trauma and conditional points use their case
  why?: string;        // the carry or rule the line pins
}
export const PARAPHRASES: Paraphrase[]
```

**What the fixtures must hold:**
- **Coverage:** for every point in `steps.json` whose condition holds in some case:
  - at least 2 positive lines;
  - every part at least once;
  - at least one line in the notes' own wording;
  - at least one in a trainee's shorter wording.
- **Review Focus 2:** positives with curly quotes, ALL CAPS, "&", "1-6", Singlish particles ("ok lah", "ah"), and one message covering steps 10 and 11.
- **Every carried false credit** is a negative, named in `why`:
  - `call-caller/prepare-ic-meds`: not by "Someone ready at the lift lobby to bring us up?", "Crew get ready." or "Already on the way.";
  - `position/convince`: not by "Is your breathing better now?" at `airway-recheck`;
  - `delicate-spine/neck-permission`: not by "May I know if you feel any pain at your neck?". That line reads `ask-neck-pain` instead;
  - `rapid-body-survey/rbs-permission`: read by a bare "Please allow me." at `rapid-body-survey` (through `local`);
  - **bare "allow" and "permission":** at `investigation`, "Please allow me." must not read `vital-signs/vitals-permission`; at `rapid-body-survey`, it must not read `delicate-spine/neck-permission`;
  - **"what" + "happen":** at `airway`, "What happened to you?" reads `airway/check-response` and not `call-caller/what-happened`; at `introduction`, it reads `introduction/whats-bothering` and not `airway/check-response`;
  - `decision-point/unstable-signs`: not by the SRACIE line "FMV 123, requesting for Alpha for unstable case of female / Chinese / 72 / case of COPD due to low SpO2 and high RR / IC no. S54xxxxxA / ETA 6 mins." at `notification`;
  - "Patient is unstable because of low SpO2 and high RR." reads `unstable-signs`;
  - **near misses that must read:**
    - "Auscultating all 6 points." gives `point-1`…`point-6`;
    - "Auscultating points 1-6." gives the same;
    - "Still bleeding, apply a CAT." gives `bleeding-control.cat` (bleed case);
    - "Bring the 4in1 and the LSU." gives `equipment`;
  - **generic terms:**
    - "Checking the blood pressure." at `rapid-body-survey` must not read `gloves`;
    - "Nasal cannula 3 litres." at `breathing` reads `mask-flow` and not `oxygen/maintain-titrate`;
    - "Let me check the rate of the breathing." at `circulation` must not read `breathing/rate-quality`;
    - "Do you feel any pain at your neck?" at `delicate-spine` must not read `loc-avpu/state-level`;
    - "Buddy, please reassess vital signs every 15 mins." must not read `reassess-5`;
  - **oedema:** "Checking for pedal oedema." reads `pedal-edema`.
- **SRACIE from the case:**
  - at `notification`, the SRACIE line above reads every `sracie` part;
  - "… female / Chinese / 70s / …" reads `age`;
  - "… ETA 10 mins" with eta 6 does not read `eta`;
  - "… IC no. S54" reads `ic-no`.
- **BP arm:** for the CCF case, "Taking the BP on the right arm." reads `bp-arm` and "… on the left arm." does not.

**Tuning rules for `steps.json`:**
- **`local`:** move generic-only alternatives there, so they count only in their own step:
  - `allow` and `permission` in every permission point;
  - check-response's `[["what","happen"]]`;
  - pulse-rate-quality's `[["rate"]]` and `[["quality"]]`;
  - how-feeling's `[["feel"]]`;
  - gloves' `[["sweat"]]` and `[["blood"]]`;
  - maintain-titrate's `[["mask"]]` and `[["flow"]]`.
- **Plurals:** with whole-word short terms, add the plural forms the fixtures need ("arms", "legs", "hips", "eyes").
- **`requiredWords`:** every `keyPhrase` point carries them (R7). For example:
  - sound-out `["front", "move your head"]`;
  - release-grip `["no suspected spinal"]`;
  - monitor-closely `["monitor", "closely"]`;
  - standby-opener `["standby"]`.
- **Never** loosen a term so far that a negative fixture reads.

- [ ] **Step 1: Write the failing test** `tests/unit/paraphrases.test.ts`

```ts
import { PARAPHRASES } from './paraphrases';
import { STEPS, caseById, ctxAt } from './sim-helpers';
import { conditionHolds } from '../../src/data/schema';
import { keywordGrader } from '../../src/sim/grader';

const read = async (p: (typeof PARAPHRASES)[number]) => {
  const { sentences } = await keywordGrader.interpret(p.line, ctxAt(p.at, p.case));
  return new Set(sentences.flatMap(s => s.points.flatMap(pt => [`${pt.step}/${pt.point}`, ...pt.parts.map(x => `${pt.step}/${pt.point}.${x}`)])));
};
test.each(PARAPHRASES.map((p, i) => [i, p] as const))('fixture %i: %o', async (_i, p) => {
  const got = await read(p);
  for (const h of p.hits ?? []) expect(got, `${p.line} should read ${h}`).toContain(h);
  for (const h of p.not ?? []) expect(got, `${p.line} should not read ${h}`).not.toContain(h);
});
test('every point that applies to some case has 2 positive fixtures, every part 1', () => {
  const count = (k: string) => PARAPHRASES.filter(p => p.hits?.includes(k)).length;
  for (const s of STEPS) for (const m of s.mustHit) {
    const applies = ['copd-amk-01', 'hypo-hougang-01', 'chestpain-bedok-01', 'ccf-jurong-01', 'asthma-tampines-01',
      'bleed-woodlands-01', 'fall-yishun-01', 'rta-toapayoh-01'].some(id => !m.when || conditionHolds(caseById(id), m.when));
    if (!applies) continue;
    if (!m.parts?.length) expect(count(`${s.id}/${m.id}`), `${s.id}/${m.id}`).toBeGreaterThanOrEqual(2);
    for (const part of m.parts ?? []) expect(count(`${s.id}/${m.id}.${part.id}`), `${m.id}.${part.id}`).toBeGreaterThanOrEqual(1);
  }
});
test('every key phrase names its required words', () => {
  for (const s of STEPS) for (const m of s.mustHit) if (m.keyPhrase) expect(m.requiredWords?.length, m.id).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Write `tests/unit/paraphrases.ts`, then run it and see it fail**

Run: `npx vitest run tests/unit/paraphrases.test.ts`
Expected: FAIL on the carried false credits and missing reads that the current terms produce.

- [ ] **Step 3: Tune `steps.json`** until every fixture passes, following the tuning rules above.

- [ ] **Step 4: Run the whole suite**

Run: `npx vitest run`
Expected: all PASS, including the naive canonical-line test in `data-integrity.test.ts`. Tuning must keep every canonical line hitting its points.

- [ ] **Step 5: Commit**

```bash
git add public/data/steps.json tests/unit/paraphrases.ts tests/unit/paraphrases.test.ts tests/unit/data-integrity.test.ts
git commit -m "test(sim): paraphrase fixtures for every point; terms tuned to word starts" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The run clock

**Files:**
- Create: `src/sim/clock.ts`
- Test: `tests/unit/clock.test.ts`

**Interfaces:**
- Consumes: `RunClock` (Task 2).
- Produces:
```ts
export const LIMITS = { rbsMs: 180_000, fiveLeftMs: 900_000, warnMs: 1_080_000, limitMs: 1_200_000 } as const;
export const NEW_CLOCK: RunClock;                                  // { started: false, bankedMs: 0, runningSince: null }
export function elapsedMs(c: RunClock, now: number): number
export function startClock(c: RunClock, now: number): RunClock    // started, running from now, nothing banked
export function pauseClock(c: RunClock, now: number): RunClock
export function resumeClock(c: RunClock, now: number): RunClock   // no-op unless started and paused
export function recoverClock(c: RunClock, lastAt: number): RunClock   // a clock a dead page left running: bank up to lastAt, paused
export function formatMmSs(ms: number): string    // '06:12', '21:30'
export function formatShort(ms: number): string   // '2:41'
export function formatClock(ms: number): string   // formatMmSs below 20:00; from 20:00 '+m:ss' of the overrun
export interface ClockView { time: string; line: string; tone: 'plain' | 'done' | 'warn'; warnDigits: boolean }
export function clockView(c: RunClock, rbsMs: number | null, now: number, drill: boolean): ClockView
export function etaMinutes(elapsed: number): number   // max(1, 20 − floor(elapsed / 60 000))
export function crossings(prevMs: number, nowMs: number, rbsMs: number | null): string[]   // limits passed with prev < T ≤ now
```
**The limit line, in order:**
1. Before Approach: "Starts at Approach".
2. Under 15:00:
   - "RBS by 3:00";
   - "RBS {m:ss} ✓" (tone done) once RBS is done by 3:00;
   - "RBS limit passed" (warn) after 3:00 with no RBS;
   - "RBS {m:ss}" (warn) for RBS done after 3:00.
3. From 15:00: "{n} min left", where n = ceil((20:00 − elapsed) / 1 min). It turns warn at 18:00, together with the digits.
4. From 20:00: time `+m:ss`, line "Past 20:00", warn.
5. In a drill: time "Drill", line "Untimed".

- [ ] **Step 1: Write the failing test** `tests/unit/clock.test.ts`

```ts
import type { RunClock } from '../../src/progress/types';
import { NEW_CLOCK, clockView, crossings, elapsedMs, etaMinutes, formatClock, formatMmSs, formatShort, pauseClock,
  recoverClock, resumeClock, startClock } from '../../src/sim/clock';

const C = (o: Partial<RunClock>): RunClock => ({ ...NEW_CLOCK, ...o });
test('elapsed counts only running time', () => {
  let c = startClock(NEW_CLOCK, 1_000);
  expect(elapsedMs(c, 61_000)).toBe(60_000);
  c = pauseClock(c, 61_000);
  expect(elapsedMs(c, 500_000)).toBe(60_000);
  c = resumeClock(c, 500_000);
  expect(elapsedMs(c, 510_000)).toBe(70_000);
  expect(resumeClock(c, 600_000)).toBe(c);
  expect(resumeClock(NEW_CLOCK, 5)).toBe(NEW_CLOCK);
  expect(elapsedMs(NEW_CLOCK, 9_999)).toBe(0);
});
test('a clock left running by a page that died banks time only up to its last saved change', () => {
  expect(recoverClock(C({ started: true, bankedMs: 30_000, runningSince: 100_000 }), 160_000))
    .toEqual({ started: true, bankedMs: 90_000, runningSince: null });
  expect(recoverClock(C({ started: true, bankedMs: 5, runningSince: 200 }), 100)).toEqual({ started: true, bankedMs: 5, runningSince: null });
  expect(recoverClock(NEW_CLOCK, 50)).toBe(NEW_CLOCK);
});
test('times format as the run shows them', () => {
  expect([formatMmSs(372_000), formatMmSs(1_290_000), formatShort(161_000)]).toEqual(['06:12', '21:30', '2:41']);
  expect([formatClock(1_062_000), formatClock(1_200_000), formatClock(1_242_000)]).toEqual(['17:42', '+0:00', '+0:42']);
});
test('the clock view follows spec §6.2', () => {
  const at = (ms: number, rbs: number | null = null) => clockView(C({ started: true, bankedMs: ms }), rbs, 0, false);
  expect(clockView(NEW_CLOCK, null, 0, false)).toEqual({ time: '--:--', line: 'Starts at Approach', tone: 'plain', warnDigits: false });
  expect(at(100_000)).toEqual({ time: '01:40', line: 'RBS by 3:00', tone: 'plain', warnDigits: false });
  expect(at(372_000, 161_000)).toEqual({ time: '06:12', line: 'RBS 2:41 ✓', tone: 'done', warnDigits: false });
  expect(at(200_000)).toEqual({ time: '03:20', line: 'RBS limit passed', tone: 'warn', warnDigits: false });
  expect(at(400_000, 200_000)).toEqual({ time: '06:40', line: 'RBS 3:20', tone: 'warn', warnDigits: false });
  expect(at(900_000, 161_000)).toEqual({ time: '15:00', line: '5 min left', tone: 'plain', warnDigits: false });
  expect(at(1_080_000, 161_000)).toEqual({ time: '18:00', line: '2 min left', tone: 'warn', warnDigits: true });
  expect(at(1_242_000, 161_000)).toEqual({ time: '+0:42', line: 'Past 20:00', tone: 'warn', warnDigits: true });
  expect(clockView(NEW_CLOCK, null, 0, true)).toEqual({ time: 'Drill', line: 'Untimed', tone: 'plain', warnDigits: false });
});
test('ETA is the time left of the 20 minutes, never under 1', () => {
  expect([0, 840_000, 870_000, 1_170_000, 1_300_000].map(etaMinutes)).toEqual([20, 6, 6, 1, 1]);
});
test('each limit is announced once, when it is crossed', () => {
  expect(crossings(170_000, 181_000, null)).toEqual(['RBS limit passed.']);
  expect(crossings(170_000, 181_000, 150_000)).toEqual([]);
  expect(crossings(899_000, 901_000, 1)).toEqual(['5 minutes left.']);
  expect(crossings(1_079_000, 1_081_000, 1)).toEqual(['2 minutes left.']);
  expect(crossings(1_199_000, 1_201_000, 1)).toEqual(['20 minutes up. The run continues.']);
  expect(crossings(0, 1_300_000, null)).toEqual(['RBS limit passed.', '5 minutes left.', '2 minutes left.', '20 minutes up. The run continues.']);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run tests/unit/clock.test.ts`
Expected: FAIL resolving `src/sim/clock`.

- [ ] **Step 3: Implement `src/sim/clock.ts`.** Clamp negative spans to 0. A phone whose clock moves back must never show negative time.

- [ ] **Step 4: Run it and see it pass**

Run: `npx vitest run tests/unit/clock.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sim/clock.ts tests/unit/clock.test.ts
git commit -m "feat(sim): run clock from a stored start, with pause, recovery and the time-limit line" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Replies, voices and readings

**Files:**
- Create: `src/sim/replies.ts`
- Modify:
  - `tests/unit/data-integrity.test.ts`: the canonical-line test moves to the real matcher;
  - `tests/unit/paraphrases.test.ts`: the opening-line test;
  - `public/data/steps.json`: terms, where those two tests need them.
- Test: `tests/unit/replies.test.ts`

**Interfaces:**
- Consumes:
  - `Reply`, `Case`, `Role`, `VitalKey` and `getFinding` (Task 1);
  - `Speaker`, `OxygenGiven` and `ReadingKey` (Task 2);
  - `DEVICE_LABEL`, `DEVICE_SHORT` and `describeOxygen` (Task 5).
- Produces:
```ts
export const ROLE_LABEL: Record<Role, string>   // Ops Ctr, Caller, Patient, Head buddy, Arm buddy, Tester
export function speakerLabel(who: Speaker, c: Case): string
  // 'you' → 'You'; 'system' → 'Dispatch'; patient → `${callName}, patient`; caller → `Caller, ${caller.who}`; else ROLE_LABEL
export function vitalsPhase(oxygen: OxygenGiven | null): 'roomAir' | 'afterO2'   // afterO2 only for a right oxygen that isn't 'none'
export interface ReplyEnv { case: Case; oxygen: OxygenGiven | null; eta: number }
export interface Spoken { text: string; readings: { key: ReadingKey; value: string; o2: string | null }[] }
export function findingSpeech(c: Case, path: string): string | null
export function readingsSpeech(keys: VitalKey[], env: ReplyEnv): Spoken
export function replyText(r: Reply, env: ReplyEnv): Spoken | null    // null when the finding is absent
export function joinSigns(signs: string[]): string                    // 'low SpO2 and high RR'; 'a, b and c'
export function fillCanonical(line: string, c: Case, eta: number): string
export function activationText(c: Case): string                       // 'Activation: {callText}. {location}.'
```
**`findingSpeech`:**
- A string is spoken as written.
- `findings.rbs.jvd` → "JVD present." or "No JVD.".
- `findings.rbs.pedalEdema` → "Pedal oedema present." or "No pedal oedema.".
- `findings.investigation.ecg` → "{type}: {reading}.".
- `findings.investigation.hypocount` → "Hypocount {n} mmol/L.".
- `findings.investigation.bp` → "BP {bp}.".
- **Arrays:**
  - a non-empty array is joined with ", ", its first letter capitalised, with a full stop;
  - `findings.rbs.pockets` reads "In the pockets: {items}.";
  - **when empty:**
    - ntucp: "No nasal flaring, tracheal tugging, accessory muscle use, cyanosis or pursed lips.";
    - hazards: "No hazards.";
    - pockets: "Nothing in the pockets.";
    - items: "Nothing of note.".

**`readingsSpeech`:**
- Readings come from `case.vitals[vitalsPhase(oxygen)]`, in key order, joined with " ".
- Formats:
  - "SpO2 {v}% on {room air | DEVICE_LABEL}." (`o2` 'RA' or `DEVICE_SHORT`);
  - "PR {v}.", "RR {v}.", "BP {v}.";
  - "Temp {v}°C.";
  - "CRT {v}.";
  - "Skin {v}.".

**Computed replies:**
- eta → "ETA {n} mins." ("ETA 1 min.");
- ic → "IC card: {name}, {ic}.";
- oxygen → "{Device label} on, {flow} L/min.", or "{Device label} on." without a flow, or "No oxygen for now." for `none`, or null with no oxygen given.

**`fillCanonical`** fills:
- `{location}`, `{callText}` and `{chiefComplaint}` (the complaint, lowercase);
- `{suspected}`;
- `{signs}` (through `joinSigns`);
- `{sex}`, `{race}`, `{age}`, `{ic}`, `{eta}` and `{bpArm}`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/replies.test.ts`, using `caseById` and `STEPS`:
```ts
const copd = caseById('copd-amk-01');
const env = (o: Partial<ReplyEnv> = {}): ReplyEnv => ({ case: copd, oxygen: null, eta: 6, ...o });
const NC = { device: 'nasal-cannula', flow: 3, atMs: 0, right: true } as const;
const SFM = { device: 'simple-face-mask', flow: 6, atMs: 0, right: false } as const;
test('speakers are named as the chat shows them', () => {
  expect(['you', 'system', 'patient', 'caller', 'armBuddy', 'opsCtr'].map(w => speakerLabel(w as Speaker, copd)))
    .toEqual(['You', 'Dispatch', 'Mdm Tan, patient', 'Caller, son', 'Arm buddy', 'Ops Ctr']);
});
test('findings are spoken plainly', () => {
  expect(findingSpeech(copd, 'findings.breathing.ntucp')).toBe('Use of accessory muscles, pursed lips.');
  expect(findingSpeech(caseById('hypo-hougang-01'), 'findings.breathing.ntucp'))
    .toBe('No nasal flaring, tracheal tugging, accessory muscle use, cyanosis or pursed lips.');
  expect(findingSpeech(copd, 'findings.rbs.pockets')).toBe('In the pockets: inhaler, IC.');
  expect(findingSpeech(copd, 'findings.rbs.jvd')).toBe('No JVD.');
  expect(findingSpeech(caseById('ccf-jurong-01'), 'findings.rbs.pedalEdema')).toBe('Pedal oedema present.');
  expect(findingSpeech(copd, 'findings.investigation.ecg')).toBe('12-lead: Sinus tachycardia about 112, no ST changes.');
  expect(findingSpeech(copd, 'findings.investigation.hypocount')).toBe('Hypocount 6.8 mmol/L.');
  expect(findingSpeech(copd, 'caller.answers.vehicles')).toBeNull();
});
test('readings follow the oxygen: room air, the right mask, or no improvement on the wrong one', () => {
  expect(readingsSpeech(['spo2'], env())).toEqual({ text: 'SpO2 86% on room air.', readings: [{ key: 'spo2', value: '86', o2: 'RA' }] });
  expect(readingsSpeech(['spo2'], env({ oxygen: NC })).text).toBe('SpO2 90% on nasal cannula.');
  expect(readingsSpeech(['spo2'], env({ oxygen: SFM })).text).toBe('SpO2 86% on simple face mask.');
  expect(readingsSpeech(['spo2', 'pr', 'bp', 'crt'], env({ oxygen: NC })).text).toBe('SpO2 90% on nasal cannula. PR 112. BP 146/86. CRT under 2 s.');
  expect(readingsSpeech(['temp', 'rr', 'skin'], env()).text).toBe('Temp 37.2°C. RR 28. Skin pale, warm, sweaty.');
});
test('computed replies', () => {
  expect(replyText({ role: 'tester', computed: 'eta', on: ['standby-opener'] }, env())!.text).toBe('ETA 6 mins.');
  expect(replyText({ role: 'tester', computed: 'eta', on: ['standby-opener'] }, env({ eta: 1 }))!.text).toBe('ETA 1 min.');
  expect(replyText({ role: 'tester', computed: 'ic', on: ['get-ic'] }, env())!.text).toBe('IC card: Tan Ah Mui, S54xxxxxA.');
  expect(replyText({ role: 'headBuddy', computed: 'oxygen', on: ['mask-flow'] }, env({ oxygen: NC }))!.text).toBe('Nasal cannula on, 3 L/min.');
  expect(replyText({ role: 'headBuddy', computed: 'oxygen', on: ['mask-flow'] }, env())).toBeNull();
});
test('canonical lines fill from the case', () => {
  const sracie = STEPS.find(s => s.id === 'notification')!.canonicalLine;
  expect(fillCanonical(sracie, copd, 6)).toContain(
    'requesting for Alpha for unstable case of female / Chinese / 72 / case of COPD due to low SpO2 and high RR / IC no. S54xxxxxA / ETA 6 mins.');
  expect(fillCanonical(STEPS.find(s => s.id === 'investigation')!.canonicalLine, caseById('ccf-jurong-01'), 6)).toContain('Taking the BP on the right arm.');
  expect(joinSigns(['low blood sugar', 'high HR', 'low GCS'])).toBe('low blood sugar, high HR and low GCS');
  expect(activationText(copd)).toBe('Activation: Elderly female, breathlessness. Blk 2xx Ang Mo Kio Ave 3, #07-xx.');
});
```
`tests/unit/data-integrity.test.ts`: replace the naive canonical-line test with this one:
```ts
test('each canonical line, filled for each case, hits every unconditional point and all its parts', () => {
  for (const c of cases) for (const s of steps()) {
    const line = normalizeLine(fillCanonical(s.canonicalLine, c, 6));
    for (const m of s.mustHit) {
      if (m.when) continue;
      const alts = [...m.match, ...(m.local ?? []), ...(m.accept ?? []).flatMap(a => a.match)];
      if (m.match.length > 0) expect(matchAt(line, alts, caseSlots(c, 6)), `${c.id} ${s.id} ${m.id}`).toBeGreaterThanOrEqual(0);
      for (const p of m.parts ?? []) expect(matchAt(line, p.match, caseSlots(c, 6)), `${c.id} ${m.id}.${p.id}`).toBeGreaterThanOrEqual(0);
    }
  }
});
```
Delete the naive `hits` helper.

`tests/unit/paraphrases.test.ts` gains the opening-line rule, the one a trainee meets at every step boundary:
```ts
test("each step's opening, said while the run is still on the step before, reads that step", async () => {
  const c = caseById('copd-amk-01');
  for (const s of STEPS.slice(1)) {
    const first = splitSentences(fillCanonical(s.canonicalLine, c, 6))[0]!;
    const prev = STEPS[s.order - 2]!;
    const done = STEPS.filter(x => x.order <= prev.order)
      .flatMap(x => x.mustHit.filter(m => !m.when || conditionHolds(c, m.when)).map(m => `${x.id}/${m.id}`));
    const { sentences } = await keywordGrader.interpret(first, ctxAt(prev.id, c.id, 6, done));
    expect(sentences[0]!.step, `${s.id}: ${first}`).toBe(s.id);
  }
});
```
Tune `steps.json` until this passes:
- rbs-permission must read the "I'm going to conduct a Rapid Body Survey…" announcement;
- vitals-permission must read "I am going to take your vital signs now.".

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/unit/replies.test.ts tests/unit/data-integrity.test.ts tests/unit/paraphrases.test.ts`
Expected: FAIL resolving `src/sim/replies`.

- [ ] **Step 3: Implement `src/sim/replies.ts`.** If the canonical-line test then fails, fix the step's terms or its canonical line in `steps.json`, keeping the paraphrase fixtures green.

- [ ] **Step 4: Run the whole suite**

Run: `npx vitest run`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sim/replies.ts tests/unit/replies.test.ts tests/unit/data-integrity.test.ts tests/unit/paraphrases.test.ts public/data/steps.json
git commit -m "feat(sim): voices, findings as speech, readings by oxygen phase, canonical lines filled per case" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Classification: Missed, Wrong, Order and Phrase

**Files:**
- Create: `src/sim/classify.ts`
- Test: `tests/unit/classify.test.ts`

**Interfaces:**
- Consumes:
  - `Step`, `MustHit`, `Case` and `conditionHolds` (Task 1);
  - `RunSession`, `Fault` and `FaultKind` (Task 2);
  - `DEVICE_LABEL` (Task 5).
- Produces:
```ts
export const pointKey: (stepId: string, pointId: string) => string;   // 'stepId/pointId'
export interface Applicable { step: Step; point: MustHit; index: number; key: string }
export function applicablePoints(steps: Step[], c: Case, range?: [number, number] | null): Applicable[]
export function pointDone(a: Applicable, s: RunSession): boolean   // unparted: in s.hits; parted: every part in s.parts
export function rankOf(step: Step, index: number): number           // step.order * 100 + (step.inOrder ? index : 0)
export function outOfOrder(seq: { key: string; rank: number }[]): Set<string>
export const FAULT_RANK: Record<FaultKind, number>;                  // missed 0, wrong 0, order 1, phrase 2
export interface Classified { faults: Fault[]; disputed: Fault[]; stepsClean: number; stepsTotal: number }
export function classify(steps: Step[], c: Case, s: RunSession, endMs: number | null): Classified
```
**`outOfOrder`: the longest non-decreasing run (R6)**

```
dp[i]   = 1 + max(dp[j]) over j < i with rank[j] <= rank[i]   (1 when there is no such j)
prev[i] = the j that gives it; on a tie, the smaller rank[j], then the larger j
end     = argmax dp; on a tie, the smaller rank, then the larger i
kept    = end, prev[end], prev[prev[end]], …   →   the result is every key not kept
```
**Graded points:** those that apply to the case, lie within the drill range when there is one, and sit in a step that is neither tapped nor prefilled.

**A graded point gets these faults:**
- **Missed, when it is not done.**
  - Detail: "Missing: {part labels}." when some of its parts were said; null otherwise.
  - `atMs`: the smallest `stepTimes` entry of a later step, else `endMs`.
- **Wrong, for `check` 'wrong'.**
  - Oxygen detail: "Gave {chose}. This patient needs {DEVICE_LABEL} {min}–{max} L/min. Readings didn't improve." For an optional device, the needs part ends ", or no oxygen".
  - ECG detail: "Chose {chose}. This patient needs {expected}."
- **Phrase, for `check` 'unnamed'.** Detail: "Say which mask and flow rate." or "Say which ECG: 12-lead or 4-lead."
- **Phrase, for a non-empty `missing`.** Detail: `Key words missing: “suspected”.` (several words are joined with `”, “`).
- **Order, when `outOfOrder` holds the key.**
  - The sequence is the graded hits sorted by (line, pos), using `rankOf`.
  - Detail: "Done during step {during}, {name}. It belongs to step {n}, {name}." When `during` equals the step's own order: "Done out of order within step {n}, {name}."
- **Order, for an `ordered` point whose said parts break the part order.** Detail: "Out of order: {Part} before {Part}." It names the first break.

**Every fault:**
- `label` is `point.label`, and `step` is `step.order`;
- for faults on a hit, `atMs` is the hit's `atMs`.

**Sorting and the score:**
- Faults sort by `FAULT_RANK`, then step order, then point index; a point's Missed comes before its Wrong.
- A fault whose key is in `s.disputes` goes to `disputed`, not `faults`.
- `stepsTotal` is the drill range's length, else `steps.length`.
- `stepsClean` counts the graded range's steps that are not tapped and have no fault in `faults`.

- [ ] **Step 1: Write the failing test** `tests/unit/classify.test.ts`

Add these to `tests/unit/sim-helpers.ts`:
- `blankSession(caseId, mode = 'coached')`: `startRun`'s session, with only the activation line and nothing hit (Task 10 brings `startRun`; until then, build the same object by hand);
- `hitAll(s, steps, c, stepIds)`: marks each listed step's applicable points and parts done, in step and point order. It appends one `you` line per point (its label as the text) and puts each hit on its own line, so every hit's `line` exists. `during` is the point's own step, and `current` rises to the highest listed step;
- `hitAt(s, key, line, extra?)`: one `PointHit` (pos 0, `atMs` null, `during` the point's step, unless `extra` says otherwise).

```ts
const copd = caseById('copd-amk-01');
test('nothing done: every applicable point is Missed, in step order', () => {
  const r = classify(STEPS, copd, blankSession('copd-amk-01'), null);
  expect(r.faults.every(f => f.kind === 'missed')).toBe(true);
  expect(r.faults[0]).toMatchObject({ point: 'respond-call/call-sign', step: 1, atMs: null, detail: null });
  expect(r.faults).toHaveLength(applicablePoints(STEPS, copd).length);
  expect([r.stepsClean, r.stepsTotal]).toEqual([0, 19]);
});
test('head grip during Approach is the Order fault, not the Approach points after it (the mockup)', () => {
  let s = hitAll(blankSession('copd-amk-01'), STEPS, copd, ['respond-call', 'call-caller', 'preparation', 'scene-evaluation']);
  s = hitAt(s, 'approach-patient/sound-out', 100, { during: 5 });
  s = hitAt(s, 'introduction/head-grip', 101, { during: 5 });
  for (const [i, p] of ['catastrophic-bleeding', 'hazards-remove', 'head-still'].entries()) s = hitAt(s, `approach-patient/${p}`, 102 + i, { during: 6 });
  s = hitAt(s, 'introduction/intro-emt-scdf', 105, { during: 6 });
  s = hitAt(s, 'introduction/whats-bothering', 106, { during: 6 });
  const order = classify(STEPS, copd, s, null).faults.filter(f => f.kind === 'order');
  expect(order).toEqual([expect.objectContaining({ point: 'introduction/head-grip',
    detail: 'Done during step 5, Approach patient. It belongs to step 6, Introduction.' })]);
});
test('phrase, wrong, missing parts and parts out of order', () => {
  let s = hitAt(blankSession('copd-amk-01'), 'scene-evaluation/moi', 1, { missing: ['suspected'] });
  s = hitAt(s, 'breathing/mask-flow', 2, { check: 'wrong', chose: 'simple face mask 6 L/min' });
  for (const [i, part] of ['head', 'neck', 'chest', 'pelvis', 'abdomen', 'lower-extremities', 'upper-extremities'].entries())
    s = { ...s, parts: { ...s.parts, [`rapid-body-survey/rbs-regions/${part}`]: { line: 3, pos: i } } };
  const f = classify(STEPS, copd, s, null).faults;
  const of = (key: string) => f.filter(x => x.point === key).map(x => [x.kind, x.detail]);
  expect(of('scene-evaluation/moi')).toEqual([['phrase', 'Key words missing: “suspected”.']]);
  expect(of('breathing/mask-flow')).toEqual([['wrong', "Gave simple face mask 6 L/min. This patient needs nasal cannula 2–4 L/min. Readings didn't improve."]]);
  expect(of('rapid-body-survey/rbs-regions')).toEqual([['missed', 'Missing: Back.'], ['order', 'Out of order: Pelvis before Abdomen.']]);
});
test('a missed point is placed when the trainee moved past its step', () => {
  const s = { ...blankSession('copd-amk-01'), stepTimes: { investigation: 200_000, 'vital-signs': 260_000 } };
  expect(classify(STEPS, copd, s, 900_000).faults.find(x => x.point === 'rapid-body-survey/pocket-check')!.atMs).toBe(200_000);
  expect(classify(STEPS, copd, s, 900_000).faults.find(x => x.point === 'notification/get-ic')!.atMs).toBe(900_000);
});
test('disputed, tapped and drill-range points stay out of the score', () => {
  const s = { ...blankSession('copd-amk-01'), disputes: ['rapid-body-survey/pocket-check'], tapped: ['introduction'] };
  const r = classify(STEPS, copd, s, null);
  expect(r.disputed.map(x => x.point)).toEqual(['rapid-body-survey/pocket-check']);
  expect(r.faults.some(x => x.point.startsWith('introduction/'))).toBe(false);
  const d = classify(STEPS, copd, { ...blankSession('copd-amk-01'), drill: { target: 'rapid-body-survey', from: 11, to: 13, chain: [], sourceRunId: null } }, null);
  expect([...new Set(d.faults.map(x => x.step))]).toEqual([11, 12, 13]);
  expect(d.stepsTotal).toBe(3);
});
test('outOfOrder blames the fewest points, and the jump ahead on a tie', () => {
  const seq = (...r: number[]) => r.map((rank, i) => ({ key: String.fromCharCode(97 + i), rank }));
  expect([...outOfOrder(seq(500, 600, 500))]).toEqual(['b']);
  expect([...outOfOrder(seq(500, 600, 700, 500))]).toEqual(['d']);
  expect([...outOfOrder(seq(500, 600, 500, 600))]).toEqual(['b']);
  expect([...outOfOrder(seq(900, 100))]).toEqual(['a']);
  expect([...outOfOrder([])]).toEqual([]);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run tests/unit/classify.test.ts`
Expected: FAIL resolving `src/sim/classify`.

- [ ] **Step 3: Implement `src/sim/classify.ts`** and the `sim-helpers` builders.

- [ ] **Step 4: Run it and see it pass**

Run: `npx vitest run tests/unit/classify.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sim/classify.ts tests/unit/classify.test.ts tests/unit/sim-helpers.ts
git commit -m "feat(sim): end-of-run classification: missed, wrong, order by fewest out of place, phrase" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The run engine

**Files:**
- Create: `src/sim/run.ts`
- Test: `tests/unit/run-engine.test.ts`

**Interfaces:**
- Consumes:
  - `Grader`, `keywordGrader`, `GradeContext` and the `done` set (Task 5);
  - `caseSlots` (Task 4);
  - the clock (Task 7);
  - the replies (Task 8);
  - `classify`, `pointDone`, `outOfOrder` and `applicablePoints` (Task 9);
  - `addRunRecord` and the types (Task 2).
- Produces:
```ts
export interface RunEnv { steps: Step[]; case: Case; grader: Grader }
export interface Applied { session: RunSession; announce: string[] }
export function envFor(steps: Step[], c: Case, grader?: Grader): RunEnv          // keywordGrader by default
export function startRun(env: RunEnv, mode: RunMode, ids: { id: string; startedAt: string }, now: number): RunSession
export function sendLine(env: RunEnv, s: RunSession, text: string, now: number): Promise<Applied>
export function tapStep(env: RunEnv, s: RunSession, stepId: string, now: number): Applied
export function tickRun(env: RunEnv, s: RunSession, now: number): Applied | null
export function pauseRun(s: RunSession, now: number): RunSession
export function resumeRun(s: RunSession, now: number): RunSession
export function disputePoint(s: RunSession, key: string): RunSession
export function endRun(env: RunEnv, s: RunSession, now: number): RunRecord
export function runElapsed(s: RunSession, now: number): number
export function gradeContext(env: RunEnv, s: RunSession, now: number): GradeContext
export type StepState = 'done' | 'missed' | 'flagged' | 'now' | 'todo';
export function stepStates(env: RunEnv, s: RunSession): { order: number; name: string; state: StepState }[]
export function shownStep(env: RunEnv, s: RunSession): number   // current, or the next step once current's points are all done (max 19)
export function stepCovered(env: RunEnv, s: RunSession, stepId: string): boolean
export function unfinishedSteps(env: RunEnv, s: RunSession): number[]   // graded steps with a point not done
export function rangeText(orders: number[]): string                    // '15 to 19'; '9, 12 and 15 to 19'; '3 and 4'
export function stepsPhrase(orders: number[]): string                  // 'Step 19'; 'Steps 15 to 19'; '' for none
export function endConfirmCopy(env: RunEnv, s: RunSession, now: number): string
export const NOT_UNDERSTOOD = 'Not sure what this is.';
export const UNCLEAR = "Who's this for? Tester, patient or buddy";
export const ADDRESSEE_LABEL: Record<Heard, string>;   // opsCtr 'Ops Ctr', caller 'caller', patient 'patient', headBuddy 'head buddy', armBuddy 'arm buddy', tester 'tester', crew 'crew', buddy 'buddy'
```
- `gradeContext` sets `done` to the keys where `pointDone` holds (tapped and prefilled points included), and `slots` to `caseSlots(case, eta)`.
- `pauseRun`, `resumeRun`, `tickRun`, `disputePoint` and every applied line or tap set `lastAt = now`. `recoverClock` relies on it.

**`sendLine`, in order:**
1. **Guard:**
   - trim the text and cut it to `RUN_LIMITS.lineChars`;
   - an empty line, or a session at `RUN_LIMITS.transcriptLines` lines, returns `{ session: s, announce: [] }` unchanged.
2. **Read:** `eta` = 10 in a drill, else `etaMinutes(elapsed)`. Then `interp = await env.grader.interpret(text, gradeContext(...))`.
3. **Build the trainee's line:** `you = { who: 'you', text, atMs }`, at index `L = s.lines.length`.
4. **For each sentence i, and each point reading in it:**
   - Points outside a drill's range are not graded, but still reply.
   - **The clock:** outside a drill, the first reading in a timed step starts the clock (`startClock(now)`). From then on, `atMs` is the elapsed clock time.
   - **An unparted point** reading `whole` and not yet in `hits` becomes a hit `{ line: L, pos: i*1000 + pos, atMs, during: current, said: sentence, missing, check, chose }`.
     - With `check: 'oxygen'`: no device named gives `'unnamed'`; otherwise `oxygenRight` decides `'right'` or `'wrong'`, `chose` is `describeOxygen`, and `s.oxygen` takes the choice.
     - Later oxygen readings at either oxygen point update `s.oxygen` (titration), but never regrade the first hit.
     - With `check: 'ecg'`, the same rules apply against `expected.ecg`, and they set `s.ecg`.
   - **New parts** go into `s.parts`. The sentence that completes a parted point records its hit.
   - Set `stepTimes[step] ??= elapsed`, and `current = max(current, order)`.
5. **Times:**
   - `rbsMs`: when `rapid-body-survey/rbs-regions` is first done, outside a drill. Announce "RBS done at {m:ss}.".
   - `standbyMs`: on the first `standby-opener`.
   - `reassessFromMs`: on the first `reassess-5` after the clock started.
6. **The route, one piece per sentence, joined with " · ":**
   - an unread sentence → `NOT_UNDERSTOOD`;
   - an unclear one → `UNCLEAR`;
   - otherwise "To {ADDRESSEE_LABEL}: {shorts}" (capitalised shorts alone when there is no addressee). The shorts read:
     - "oxygen, {chose}" for a named oxygen choice;
     - "ECG, {chose}";
     - "{short} ({part labels, lowercase})" for some parts of a point;
     - "{short} (not in this drill)" for a point outside the drill.
7. **Replies.** Unclear sentences reply nothing.
   - For each point reading, in sentence order, each reply of its step (in file order) whose `on` names the point, or one of the parts read, plays once in this line.
   - A `text` reply plays only if its key `${stepId}#${index}` isn't in `s.played`, and is then added (R16).
   - Vitals replies append to `s.readings`, with `atMs` and `o2`.
   - Lines in a row from the same role merge into one, their texts joined with " ".
8. **Coached flags** (mode coached, which includes every drill). On `you`:
   - **Phrase:** for new hits with `missing`, text `Key words missing: “…”.`; for `'unnamed'`, Task 9's detail text.
   - **Wrong:** "Wrong mask or flow for this patient. Check your oxygen guidelines." or "Wrong ECG for this patient.".
   - **Nudge:** for each graded point not done, in a step whose order ≤ current − 2, and not yet nudged: "Not done yet: {label}.". Then add it to `nudged`.
   - **Order:** `outOfOrder` over the graded hits. Each newly out key not in `flaggedOrder` gets a flag "{Short} belongs to step {n}, {name}." on the line that holds its hit (`lines[hit.line]`, which may be an earlier line). Then add it to `flaggedOrder`.
   - Exam mode sets no flags.
9. **Finish:** append `you` and the replies, set `lastAt = now`, and return the announcements.

**`tapStep`:**
- **Guard:** a covered step, or a step outside the drill, returns `s` unchanged.
- **The line:** `you` carries `text: fillCanonical(...)`, `tapped: true` and `route: 'Tapped: step {n}, {name}'`.
- **Points:** every applicable point is hit with `tapped: true`, `missing: []`, check `'right'` where it has a check, and every part. Oxygen and ECG take the expected values, so the readings improve.
- **Times:** the clock, `stepTimes`, `current` and `rbsMs` update as for a typed line.
- **Replies:** the replies of every applicable point play (R16 still applies).
- **Bookkeeping:** `s.tapped` gains the step, and Coached nudges run.

**`tickRun`:**
- It returns null unless the clock has started and `reassessFromMs` is set.
- For each 5-minute mark k that has passed since `reassessFromMs` and is above `reassessSets`, it adds two lines, both at `atMs = reassessFromMs + k × 300 000`:
  - headBuddy `readingsSpeech(['temp', 'rr', 'skin'])`;
  - armBuddy `readingsSpeech(['spo2', 'pr', 'bp', 'crt'])`.

**`endRun`** pauses the run, then calls `classify(..., endMs)`. `endMs` is the elapsed time if the clock started, else null. It builds the `RunRecord`:
- **Times:** `usedMs` is 0 in a drill.
- **Faults:** `faults = [...faults, ...disputed]`, sorted. `missed`, `wrong`, `order` and `phrase` hold the point keys of the active faults.
- **Transcript:** lines mapped through `speakerLabel`, capped at 400.
- **Case record:**
  - `complaint`: the chief complaint, if `whats-bothering` was asked;
  - `moi` and `decision`: the `said` text of the `moi` and `unstable-signs` hits;
  - `oxygen`: `describeOxygen`, plus ", no improvement" when wrong;
  - `ecg`: "{chose}: {reading}";
  - `hypocount`: "{n} mmol/L";
  - `position`: the choice, plus ", convinced to change" when `convince` was hit;
  - `sracie`: the letters S R A C I E lit from the sracie parts, where C needs both `case` and `two-signs`;
  - `standby`: the you, opsCtr and tester lines from the standby-opener's line on.
- **Reached:** `reached` is every step order with a hit, prefilled steps left out.
- **Drills:** `drillRange` and `drillChain`.

**`endConfirmCopy`:**
- "End run at {mm:ss}? {stepsPhrase} count as missed.";
- "End run now? …" before Approach;
- "End run at {mm:ss}?" with nothing unfinished;
- "End drill? {stepsPhrase} count as missed." in a drill.

- [ ] **Step 1: Write the failing tests** `tests/unit/run-engine.test.ts`

Add these to `sim-helpers`:
- `envOf(caseId)`;
- `IDS = { id: 'run-1', startedAt: '2026-11-13T14:00:00.000Z' }`;
- `playRun(caseId, mode, lines, opts?: { at?: number; gapMs?: number })`, which starts a run and sends each line `gapMs` (default 20 000) apart, returning the session.

Use `T0 = 1_000_000`.

**Start and step 1:**
- `startRun(envOf('copd-amk-01'), 'coached', IDS, T0)`:
  - its lines are `[{ who: 'system', text: 'Activation: Elderly female, breathlessness. Blk 2xx Ang Mo Kio Ave 3, #07-xx.', atMs: null }]`;
  - the clock is `NEW_CLOCK`, and `current` is 1.
- Sending "FMV 123 to Ops Ctr, responding to Blk 2xx Ang Mo Kio Ave 3 for case of elderly female, breathlessness." gives:
  - a `you` line with `atMs: null` and route "To Ops Ctr: call sign, responding to, case of";
  - then `{ who: 'opsCtr', text: 'Ops Ctr, roger.', atMs: null }`;
  - the clock still not started.
- Sending it again adds no second "Ops Ctr, roger." (R16).

**The clock:**
- "Approaching casualty from the front. If you can hear me, please do not move your head.", sent at `T0 + 60_000`, gives `clock.started` true, `runningSince` T0 + 60 000, `hits['approach-patient/sound-out'].atMs` 0 and `stepTimes['approach-patient']` 0.
- After `pauseRun` at +100 s and `resumeRun` at +400 s, `runElapsed` at +410 s is 50 000.

**Oxygen and readings** (`current` set to 10):
- "Buddy, simple face mask 6 litres." gives:
  - `hits['breathing/mask-flow']` with `check: 'wrong'` and `chose: 'simple face mask 6 L/min'`;
  - a headBuddy line "Simple face mask on, 6 L/min.";
  - route "To head buddy: oxygen, simple face mask 6 L/min".
- "Arm buddy, SpO2 please." then gives "SpO2 86% on simple face mask.".
- With `current` 15, "Titrate to nasal cannula 3 litres." gives `maintain-titrate` `'right'`, and "Arm buddy, recheck the SpO2." gives "SpO2 90% on nasal cannula.".
- Asking for SpO2 twice gives two reading lines and two `readings` entries.

**Coached flags:**
- **Order:** after sound-out, send "Buddy, do a head grip." then "Is there any catastrophic bleeding?". The head-grip line gets `flags: [{ kind: 'order', point: 'introduction/head-grip', text: 'Head grip belongs to step 6, Introduction.' }]`. In Exam mode, the same lines leave every `flags` undefined.
- **Phrase:** with `current` 4, "MOI is case of breathlessness." flags `{ kind: 'phrase', point: 'scene-evaluation/moi', text: 'Key words missing: “suspected”.' }`.
- **Nudge:** with steps 1–9 done (`hitAll`), a step 12 line nudges every breathing point once, for example "Not done yet: Arm buddy: measure SpO2 on room air.". The next line adds no repeat.

**The grader seam:** a stub `Grader` whose sentence has addressee `'unclear'` and reads `breathing/spo2`:
- credits the hit;
- gives route `UNCLEAR`;
- adds no reply.

"The weather is nice today." gives route "Not sure what this is.", with no hit and no reply.

**Reassess:**
- With `reassessFromMs` 600 000, `tickRun` at elapsed 899 000 returns null.
- At 900 000 it adds a headBuddy line "Temp 37.2°C. RR 28. Skin pale, warm, sweaty." and an armBuddy line "SpO2 86% on room air. PR 112. BP 146/86. CRT under 2 s.", both with `atMs` 900 000, and sets `reassessSets` 1.

**Tap mode:** with `current` 5, `tapStep(env, s, 'introduction', now)`:
- adds a `you` line with the canonical text, `tapped: true` and route "Tapped: step 6, Introduction";
- plays "Head grip on." and the chief complaint;
- marks `stepCovered` true;
- does nothing on a second tap.

**Limits:**
- A 700-character line is stored as 600 characters.
- A session already holding 400 lines is returned unchanged.

**RBS and the standby call:**
- Completing RBS at elapsed 161 000 announces `['RBS done at 2:41.']`.
- "FMV 123 to Ops Centre, standby message, over." at elapsed 840 000 gives "Ops Centre, send over." then "ETA 6 mins.", and `standbyMs` 840 000.

**Phrases and copy:**
- `stepsPhrase` gives:
  - `[15,16,17,18,19]` → "Steps 15 to 19";
  - `[19]` → "Step 19";
  - `[9,12,15,16,17,18,19]` → "Steps 9, 12 and 15 to 19";
  - `[3,4]` → "Steps 3 and 4";
  - `[]` → "".
- `endConfirmCopy`, with steps 1–14 done and 580 000 elapsed: "End run at 09:40? Steps 15 to 19 count as missed.".
- `endConfirmCopy` on a new run: "End run now? Steps 1 to 19 count as missed.".

**`endRun`** on a short scripted COPD run gives a record with:
- `id` 'run-1', `drill` false, `stepsTotal` 19;
- `transcript[0]` `{ who: 'Dispatch', text: 'Activation: …', atMs: null }`;
- `faults` equal to `classify` re-run on the paused session;
- `record.complaint` "So breathless... since morning... getting worse.", when "What is bothering you?" was asked.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/unit/run-engine.test.ts`
Expected: FAIL resolving `src/sim/run`.

- [ ] **Step 3: Implement `src/sim/run.ts`**

- [ ] **Step 4: Run the whole suite**

Run: `npx vitest run && npm run typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sim/run.ts tests/unit/run-engine.test.ts tests/unit/sim-helpers.ts
git commit -m "feat(sim): the run engine: lines, replies, flags, nudges, readings, tap mode and the end of a run" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Drills and the Today headline

**Files:**
- Create: `src/sim/drill.ts`, `src/sim/headline.ts`
- Test: `tests/unit/drill.test.ts`, `tests/unit/headline.test.ts`

**Interfaces:**
- Consumes: `RunEnv`, `startRun` and `pointDone` (Tasks 9 and 10); `activeFaults` (Task 2); `formatMmSs` (Task 7).
- Produces (`src/sim/drill.ts`):
```ts
export function drillRange(targetOrder: number, total: number): [number, number]   // [max(1, t − 1), min(total, t + 1)]
export function startDrill(env: RunEnv, target: string, chain: string[], sourceRunId: string | null,
  ids: { id: string; startedAt: string }, now: number): RunSession
export function drillDone(env: RunEnv, s: RunSession): boolean      // every applicable point in the range is done
export function drillTargets(r: RunRecord, steps: Step[]): string[] // step ids of r's active faults, distinct, in step order
```
**`startDrill`:**
- **Mode:** always `'coached'` (R4).
- **Lines:**
  - the activation line;
  - then a system line: "Drill on step {t}, {name}. Steps 1 to {from − 1} are filled in from the case. Start at step {from}, {from name}." With `from` = 2 it reads "Step 1 is filled in from the case."; with `from` = 1 it reads "Drill on step {t}, {name}. Start at step 1, Respond call.".
- **Prefilled steps:** every step before `from`. All their applicable points and parts are done, at `line: 0` and `atMs: null`. Their findings are known:
  - if breathing (10) is prefilled, `oxygen` is the expected device at `flowMin`, right, and there is a SpO2 reading on that oxygen;
  - if investigation (13) is prefilled, `ecg` is expected, and there is a hypocount reading;
  - if vital-signs (14) is prefilled, there are the seven buddy readings and a GCS reading of e+v+m.
- **The rest:** `current` = `from`; the clock never starts; `drill` = `{ target, from, to, chain, sourceRunId }`.
- Produces (`src/sim/headline.ts`):
```ts
export interface Headline { kind: FaultKind; point: string; step: number; count: number; of: number; label: string }
export function headline(runs: RunRecord[]): Headline | null
export const HEADLINE_VERB: Record<FaultKind, string>;   // missed 'missed', wrong 'wrong', order 'out of order', phrase 'missing its key words'
export function headlineCopy(h: Headline, steps: Step[]): { title: string; sub: string; drillLabel: string; drillHref: string; notesRef: string | null }
export function latestFullRun(runs: RunRecord[]): RunRecord | null
export function lastRunTimes(runs: RunRecord[], n?: number): string[]   // newest non-drill runs' usedMs as mm:ss, up to n (3)
```
**`headline`:**
1. Take the three newest non-drill runs.
2. Count each point once per run, over its active faults. That run's kind for the point is its lowest `FAULT_RANK`.
3. Pick the point with the highest count. On a tie, prefer the point in the newest run, then the lower step, then the key.
4. `kind` = the point's most frequent kind, ties broken by rank.
5. `label` = the newest run's saved label.
6. Return null when there are no active faults.

**`headlineCopy`:**
- `title`:
  - "{Short} {verb} in {count} of your last {of} runs";
  - "{Short} {verb} in your last run" when `of` is 1.
  - Short comes from the point in `steps`, else the saved label, with its first letter capitalised.
- `sub`: "{label}. Step {n}, {name}." Add no second stop when the label already ends in `.`, `?` or `!`.
- `drillLabel`: "Drill steps {a} to {b}", through `drillRange`.
- `drillHref`: `#/pam/start?drill={stepId}`.
- `notesRef`: the step's `notesRef`, or null when the step has gone.

- [ ] **Step 1: Write the failing tests**

`tests/unit/drill.test.ts` (COPD):
- `drillRange` gives 12 → `[11, 13]`, 1 → `[1, 2]` and 19 → `[18, 19]`.
- `startDrill(env, 'rapid-body-survey', ['investigation'], 'run-0', IDS, T0)`:
  - is `mode` `'coached'`, with `drill` `{ target: 'rapid-body-survey', from: 11, to: 13, chain: ['investigation'], sourceRunId: 'run-0' }`;
  - has `lines[1].text` "Drill on step 12, Rapid body survey. Steps 1 to 10 are filled in from the case. Start at step 11, Circulation.";
  - has `prefilled` steps 1–10, `oxygen` `{ device: 'nasal-cannula', flow: 2, right: true }` and a SpO2 reading of "90", on "NC";
  - has `clock.started` false, and `drillDone` false.
- After `hitAll` over steps 11–13, `drillDone` is true.
- `endRun` on it gives `drill: true`, `drillRange: [11, 13]`, `drillChain: ['investigation']`, `stepsTotal: 3` and `usedMs: 0`.
- `drillTargets` on a record with active faults in steps 12, 4, 12 and 19 (one of them disputed in step 19) gives `['scene-evaluation', 'rapid-body-survey']`.

`tests/unit/headline.test.ts`:
- Three runs (newest first):
  - r3: pocket-check missed and moi phrase;
  - r2: pocket-check missed;
  - r1: moi phrase, disputed.
  - Plus a newer drill with a different fault.
  - `headline` gives `{ kind: 'missed', point: 'rapid-body-survey/pocket-check', step: 12, count: 2, of: 3 }`.
- Its copy:
  - title "Pocket check missed in 2 of your last 3 runs";
  - sub "Pocket check, after seeking permission. Step 12, Rapid body survey.";
  - drillLabel "Drill steps 11 to 13";
  - drillHref "#/pam/start?drill=rapid-body-survey".
- With one run, the title ends "in your last run".
- With no faults, `headline` is null.
- `lastRunTimes` over runs of 17:42, 19:05, 21:10 and an older 16:00 (plus a drill) gives `['17:42', '19:05', '21:10']`.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/unit/drill.test.ts tests/unit/headline.test.ts`
Expected: FAIL resolving `src/sim/drill`.

- [ ] **Step 3: Implement both files**

- [ ] **Step 4: Run them and see them pass**

Run: `npx vitest run tests/unit/drill.test.ts tests/unit/headline.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sim/drill.ts src/sim/headline.ts tests/unit/drill.test.ts tests/unit/headline.test.ts
git commit -m "feat(sim): drills one step either side of the target, and Today's most common recent mistake" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Cases content, run routes and Run start

**Files:**
- Create:
  - `src/run/start.ts`, `src/run/useRun.ts` and `src/run/RunStart.tsx`;
  - `src/run/Run.tsx` and `src/run/Debrief.tsx`, as placeholders that render only their `<h1>`.
- Modify:
  - `src/data/load.ts`, `src/app/routes.ts` and `src/app/App.tsx` (`SCREENS`);
  - `src/quiz/QuizTab.tsx`: `ReplacesNote` gains `what: 'quiz' | 'run' = 'quiz'`, giving "This replaces your open {what}.";
  - `src/styles/components.css`.
- Test:
  - `tests/unit/routes.test.ts` and `tests/unit/load.test.ts` (append);
  - `tests/unit/run-start.test.tsx` (new).

**Interfaces:**
- Consumes:
  - `useContent`, `loadJson`, `ContentError` and `contentErrorCopy` (Plan 1);
  - `CaseSchema` and `CaseIndexSchema`;
  - `envFor`, `startRun` and `startDrill` (Tasks 10 and 11);
  - `lastRunTimes` and `drillRange` (Task 11);
  - `mulberry32` and `randomSeed`;
  - `FocusHeader`, `Panel`, `Primary`, `Skeleton`, `useDelayedFlag`, `toast`, `navigate` and `back`.
- Produces:
```ts
// src/data/load.ts
export type ContentKey = 'questions' | 'notes' | 'steps' | 'cases';
//   ContentData['cases'] = Case[]: index first, then every file in index order; a file whose id differs from its entry → ContentError('invalid')
//   contentErrorCopy('cases') = "The cases didn't load. They aren't saved on this phone yet. Connect once, then try again."
// src/app/routes.ts: RouteName gains 'runStart' | 'run' | 'debrief'; ROUTES appends
//   { pattern: '/pam/start', name: 'runStart', tab: null, focus: true, scene: 'run' }
//   { pattern: '/run', name: 'run', tab: null, focus: true, scene: 'run' }
//   { pattern: '/debrief/:id', name: 'debrief', tab: null, focus: true, scene: 'quiet' }
// src/run/start.ts
export function complaintsOf(cases: Case[]): string[]              // distinct, in index order
export function pickCase(cases: Case[], complaint: string | null, rng: Rng): Case | null
export function newRunIds(now?: Date): { id: string; startedAt: string }   // id 'run-' + base-36 ms + '-' + 4 base-36 random
export function beginRun(store: ProgressStore, env: RunEnv, mode: RunMode): void          // sets runOpen; navigate('/run', { replace: true })
export function beginDrill(store: ProgressStore, env: RunEnv, target: string, chain: string[], sourceRunId: string | null): void
// src/run/useRun.ts
export const GONE_CASE = "A run in progress was closed: its case isn't on this phone any more.";
export type RunContent = { status: 'loading' } | { status: 'error'; key: 'steps' | 'cases'; retry(): void } | { status: 'ready'; steps: Step[]; cases: Case[] };
export function useRunContent(): RunContent
export type OpenRunState = RunContent | { status: 'none' } | { status: 'open'; session: RunSession; env: RunEnv };
export function useOpenRun(): OpenRunState   // a runOpen whose case is gone: cleared once, with toast(GONE_CASE)
// src/run/RunStart.tsx
export function RunStart({ match }: { match: RouteMatch }): JSX.Element
```
**Run start (`#/pam/start`, and `?drill={stepId}`)** follows the Quiz setup's look (`setup-group`, `choice`, `chip`):
- **Header:** `FocusHeader` with `exit="close"`, calling `back('/pam')`.
  - Title "New case", sub "Primary survey, about 20 minutes".
  - With a valid `drill`: title "Drill", sub "Steps {a} to {b}, {target name}". An unknown drill id shows the plain New case screen.
- **Case:**
  - radios "Random" (checked, sub "Hidden until the call comes in") and "Pick by complaint";
  - picking shows the complaints as single-choice chips (`aria-pressed`), with the first pressed.
- **Mode** (not in a drill): radios "Coached" (checked, sub "Flags as you go, with the step bar and step list") and "Exam" (sub "No flags until the debrief").
- **Answer by:** "Typing. Voice comes in a later update." (R13).
- **The clock** (not in a drill):
  - "RBS by 3:00 from Approach. Whole run by 20:00.";
  - then "Your last 3: 17:42, 19:05, 21:10.", "Your last 2: …", "Your last run: 17:42." or "No runs yet.".
- **Start:**
  - Primary "Take the call" ("Start drill" in a drill);
  - with a run open, `<ReplacesNote what="run">` sits under it, named in its `aria-describedby`;
  - it calls `beginRun` or `beginDrill`, with the case from `pickCase`.
- **Loading:** the 300 ms skeleton; a content error shows its copy and [Try again].

- [ ] **Step 1: Write the failing tests**
- **Routes:** `'#/pam/start?drill=rapid-body-survey'` gives `runStart` with `focus` true and `query.drill`; `'#/run'` gives `run` with scene `'run'`; `'#/debrief/run-1'` gives `debrief` with `params.id` 'run-1'.
- **Load:**
  - `loadContent('cases', stub)` with the real index and files gives 8 cases, in index order;
  - a file whose `id` differs from its entry rejects with `kind: 'invalid'`.
- **Run start**, rendered with `primeContent('steps' | 'cases')` and a memory store:
  - title "New case"; "Random" checked; choosing "Pick by complaint" shows 6 chips, in the order Breathlessness, Giddiness, Chest pain, Bleeding, Fall, Road accident;
  - "Coached" checked; "Typing. Voice comes in a later update." shows; "No runs yet." shows;
  - with "Giddiness" pressed and Exam chosen, clicking "Take the call" gives `runOpen.caseId` 'hypo-hougang-01' and `runOpen.mode` 'exam', and `location.hash` '#/run';
  - with three seeded runs it shows "Your last 3: 17:42, 19:05, 21:10.";
  - with `runOpen` set it shows "This replaces your open run.", and the key's `aria-describedby` names it;
  - at `?drill=rapid-body-survey`: title "Drill", sub "Steps 11 to 13, Rapid body survey", no Mode group, and "Start drill" giving a `runOpen.drill` from 11 to 13;
  - an error stub on cases shows `contentErrorCopy('cases')`.
- **`useOpenRun`:** with `runOpen.caseId` 'gone-01', `runOpen` becomes null and the toast `GONE_CASE` shows.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/unit/routes.test.ts tests/unit/load.test.ts tests/unit/run-start.test.tsx`
Expected: FAIL resolving `src/run/RunStart`.

- [ ] **Step 3: Implement it.** Add the two placeholders, so every route has its screen.

- [ ] **Step 4: Run the whole suite**

Run: `npx vitest run && npm run typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src tests/unit
git commit -m "feat(run): cases content, run routes and the Run start screen" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Run screen: header, clock, step bar and vitals rail

**Files:**
- Create: `src/run/RunHeader.tsx`, `src/run/StepBar.tsx`, `src/run/VitalsRail.tsx`, `src/run/useNow.ts`
- Modify:
  - `src/run/Run.tsx`, replacing the placeholder;
  - `src/styles/components.css`.
- Test: `tests/unit/run-screen.test.tsx`

**Interfaces:**
- Consumes:
  - `useOpenRun` (Task 12);
  - `clockView`, `crossings` and `elapsedMs` (Task 7);
  - `stepStates`, `shownStep` and `rangeText` (Task 10);
  - `DEVICE_SHORT` (Task 5);
  - `Icon`, `Skeleton` and `navigate`.
- Produces:
```ts
export function Run({ match }: { match: RouteMatch }): JSX.Element
export function RunHeader(p: { title: string; sub: string; clock: RunClock; rbsMs: number | null; drill: boolean;
  announce: string | null; onPause(): void }): JSX.Element
export function StepBar(p: { states: { order: number; name: string; state: StepState }[] }): JSX.Element
export function stepBarLabel(states: { order: number; state: StepState }[]): string
  // 'Steps: 1 to 5 and 7 to 9 done, step 6 flagged, step 10 current, 9 to go'
export function VitalsRail(p: { readings: Reading[]; mode: RunMode }): JSX.Element
export function latestReadings(readings: Reading[]): Partial<Record<ReadingKey, Reading>>
export function useNow(intervalMs: number, active: boolean): number   // Date.now(), re-rendering each interval while active
```
**Layout, from mockup screen 2** (`.superpowers/alts/scdf.fragment.html`; `ems-cabin.html` is the same, one line later). Markup is at lines 357–416 and CSS at 179–223. Port it into `components.css`, renaming:

| Mockup class | Class here |
|---|---|
| `.as-flank` | `.flank` |
| `.as-runhead` | `.runhead` |
| `.as-clock` | `.clock` |
| `.as-rbs` | `.rbs` (`.rbs.done` green, `.rbs.warn` magenta) |
| `.as-moderow` | `.moderow` |
| `.as-mode` | `.runmode` (`.mode` is taken by the quiz cards) |
| `.as-stepinfo` | `.stepinfo` |
| `.as-steps` | `.stepbar`, with `.s-done`, `.s-flagged`, `.s-missed` (magenta) and `.s-now` |
| `.as-vitals` | `.vitals` |
| `.as-vt` | `.vt` |
| `.as-vl` | `.vl` |
| `.as-vv` | `.vv` |
| `.as-vt-empty` | `.vt-empty` |

- **The run root:** `.run`, a grid with `height: 100dvh` minus the top safe area, and rows `auto auto auto auto auto 1fr auto`.
- **The rows:**
  1. the band flank;
  2. the header: Pause, h1 title (the case's complaint) over the location, and the clock;
  3. the mode row: chip "Coached", "Exam" or "Drill", and in Coached and drills "Step {n} of 19", with ", step {k} flagged" when steps are flagged;
  4. the step bar (Coached and drills);
  5. the vitals rail;
  6. the chat;
  7. the composer.

  Until Task 14 the chat row is a plain `role="log"` list, and the composer row is empty.
- **The clock:**
  - `<div class="clock tn" role="timer" aria-label="Run clock">` holds `<b>` (class `warn` when `warnDigits`) and `<span class="rbs {tone}">`;
  - its announcements go in one `<p class="vh" aria-live="polite">`: each `crossings(prev, now, rbsMs)` from the 1 s tick, and the engine's `announce`;
  - the digits never animate.
- **Vitals:**
  - tiles in this order: SpO2 (with the `o2` short at the right of its label, such as "RA" or "NC"), PR, RR and BP;
  - then Temp (°C), Hypo (mmol/L) and GCS, once each is reported;
  - in Coached and drills the first four always show, as `vt-empty` with "– –" (`aria-label="not yet reported"`) until reported;
  - in Exam a tile shows only once reported;
  - a tile whose reading changes shows "– –" for 220 ms, then fades its value in (`--t-fast`);
  - readings are always `--c-text`;
  - the rail is `role="group"` with `aria-label="Vitals"`.
- **No run:**
  - with no run open, Run calls `navigate('/', { replace: true })` and renders nothing;
  - while loading it shows the skeleton after 300 ms;
  - on a content error it shows the error copy with [Try again].

- [ ] **Step 1: Write the failing tests** `tests/unit/run-screen.test.tsx`

Render `<App store>` at `#/run`. Prime steps and cases, and seed `runOpen` through the engine (`startRun`, `sendLine`). Use fake timers.
- **Before Approach:** the timer named "Run clock" shows "--:--" and "Starts at Approach"; the h1 is "Breathlessness", with "Blk 2xx Ang Mo Kio Ave 3, #07-xx" under it.
- **Running:** with the clock started and 372 000 ms banked (running since now), after 1 s the timer reads "06:13" and "RBS by 3:00".
- **A crossing:** at elapsed 179 500, after 1 s the live region holds "RBS limit passed.".
- **Warning digits:** at elapsed 1 080 000 the clock's `<b>` has class `warn`; at 1 242 000 it shows "+0:42" and "Past 20:00".
- **Coached:**
  - "Coached" and "Step 1 of 19" show;
  - a list named like `/^Steps: /` has 19 items;
  - four vitals tiles are named "not yet reported".
- **Exam:** "Exam" shows, with no Steps list and no vitals tiles.
- **A reading arrives:** after an arm buddy SpO2 reading, the SpO2 tile shows "– –", then "86" with "RA" 220 ms later.
- **An extra tile:** after the hypocount reply, a "Hypo" tile shows "6.8".
- **`stepBarLabel`:**
  - for states done 1–5, flagged 6, done 7–9, now 10 and todo 11–19 it gives "Steps: 1 to 5 and 7 to 9 done, step 6 flagged, step 10 current, 9 to go";
  - for a new run it gives "Steps: step 1 current, 18 to go".
- **No run:** with `runOpen` null, the hash becomes "#/".

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run tests/unit/run-screen.test.tsx`
Expected: FAIL. The placeholder renders no timer.

- [ ] **Step 3: Implement it**, porting the mockup CSS.

- [ ] **Step 4: Run it and see it pass**

Run: `npx vitest run && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/run src/styles/components.css tests/unit/run-screen.test.tsx
git commit -m "feat(run): run screen header, clock with its time-limit line, step bar and vitals rail" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Run screen: chat, composer and inline flags

**Files:**
- Create: `src/run/Chat.tsx`, `src/run/Composer.tsx`, `src/run/useSendQueue.ts`
- Modify:
  - `src/run/Run.tsx`;
  - `src/ui/Icon.tsx`: add `'send'`, path `M22 2 11 13M22 2l-7 20-4-9-9-4z`;
  - `src/styles/components.css`.
- Test: `tests/unit/run-chat.test.tsx`

**Interfaces:**
- Consumes:
  - `sendLine`, `tapStep` and `disputePoint` (Task 10);
  - `speakerLabel` (Task 8);
  - `StatusChip`, `Secondary` and Plan 1's `haptic`.
- Produces:
```ts
export function Chat(p: { lines: ChatLine[]; case: Case; mode: RunMode; disputes: string[]; onDispute(key: string): void }): JSX.Element
export function Composer(p: { onSend(text: string): void; disabled: boolean; showStepList: boolean; onStepList(): void; note?: string }): JSX.Element
export type RunInput = { text: string } | { tap: string };
export function useSendQueue(store: ProgressStore, env: RunEnv, sessionId: string, announce: (s: string[]) => void): (input: RunInput) => Promise<void>
```
**Layout and look**, from mockup lines 393–411 (CSS 205–223):

| Mockup class | Class here |
|---|---|
| `.as-chat` | `.chat` |
| `.as-msg` | `.msg` |
| `.as-me` | `.me` |
| `.as-them` | `.them` |
| `.as-bub` | `.bub` |
| `.as-route` | `.route` |
| `.as-who` | `.who` |
| `.as-flag`, `.as-flag-h`, `.as-flag-who` | `.flag`, `.flag-h`, `.flag-who` |
| `.as-composer` | `.composer` |
| `.as-sq` | `.sq` |
| `.as-input` | `.cinput` |
| `.as-mic` | `.send`: the banded ambulance-white key, with the send icon in Plan 2 |

A system line is `.syscard`: centred, `--c-text-2`.

**The chat:**
- **The log:** `<div class="chat" role="log" aria-label="Run chat">`. It is the only scroller, with `overflow-y: auto` and `overscroll-behavior: contain`.
- **Lines:**
  - every line starts with a visually hidden "{speaker}: ";
  - a "them" line also shows the speaker visibly, `aria-hidden`.
- **Your lines:** each shows its `route` under the bubble. A tapped line also shows "Tapped".
- **Flags** (Coached and drills; never in Exam):
  - each sits under the line holding it, as `<div class="flag" role="status">`;
  - its header is `<StatusChip>` and "Tester flag". The chip is Missed for nudge, Wrong for wrong, Order for order and Phrase for phrase;
  - then a Secondary "Not what I meant", then the flag's text;
  - for a disputed point, the button gives way to "Disputed. Not counted.".
- **Stick to the bottom:**
  - a scroll listener keeps "at bottom" (80px or less from the end);
  - new lines scroll to the end when at bottom;
  - otherwise they add to a count, shown as `<button class="newpill">↓ {n} new</button>`, which scrolls down and clears;
  - scrolling back within 80px also clears it;
  - with reduced motion the scroll is instant.

**The composer:**
- **Form:** `<form class="composer">`, holding:
  - in Coached and drills, `<button class="sq" aria-label="Step list">`;
  - `<input class="cinput" type="text" enterkeyhint="send" autocomplete="off" autocapitalize="sentences" maxlength="600" aria-label="Speak to the scene" placeholder="Speak to the scene">`;
  - `<button class="send" type="submit" aria-label="Send">`.
- **Submit:** it trims the text, ignores an empty line, calls `onSend`, clears the input and keeps focus on it, so the Android keyboard stays up.
- **The line limit:** at 400 lines the input is disabled, with the note "This run has reached its line limit. End it from Pause to see the debrief.".

**`useSendQueue`:**
- **Order:** inputs run one at a time, in order.
- **Applying a result:** each reads `store.get().runOpen`, applies `sendLine` or `tapStep`, then writes the result only if `runOpen` is still the object it read. If it has changed, it applies the same input again to the new one.
- **Saving:** every applied input is one `store.update`, and so one save (Review Focus 3).
- **Haptics** (§9, Android only, behind the Settings toggle): a send gives `haptic('tap', settings.haptics)`, and a line that adds an inline flag gives `haptic('wrong', settings.haptics)`.

- [ ] **Step 1: Write the failing tests** `tests/unit/run-chat.test.tsx`
- **The log:** the log named "Run chat" holds the activation, with the hidden prefix "Dispatch: ".
- **A first line:** typing the step 1 line and pressing Enter gives:
  - a bubble whose text starts "You: ";
  - a route "To Ops Ctr: call sign, responding to, case of";
  - a reply with the hidden prefix "Ops Ctr: ";
  - `store.get().runOpen.lines` of length 3, and the raw save in `MemoryStorage` holding the line's text.
- **Two submits in a row,** without awaiting, give lines in order: A, A's reply, B, B's reply. The run is saved twice.
- **A Coached flag:** the head-grip scenario shows a status with "!!Order" and "Head grip belongs to step 6, Introduction.". Clicking "Not what I meant":
  - adds `'introduction/head-grip'` to `runOpen.disputes`;
  - shows "Disputed. Not counted.".
- **Exam:** the same lines give no element with `role="status"` in the chat.
- **The pill:** make the scroller 1 500px from the end (define `scrollHeight` 2000, `clientHeight` 500 and `scrollTop` 0), fire `scroll`, then send a line. The pill reads "↓ 2 new" (your line and its reply). Clicking it sets `scrollTop` to `scrollHeight` and removes the pill.
- **The composer:**
  - an empty submit adds nothing;
  - after a send the input is empty and focused;
  - it has `maxlength="600"` and `enterkeyhint="send"`;
  - Exam has no "Step list" button.
- **The line limit:** a session with 400 lines disables the input and shows the note.
- **Haptics:** with an Android user agent, a `vibrate` mock and haptics on, the head-grip scenario's flagged line calls `vibrate` with `[24, 60, 24]`. With haptics off it isn't called.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/unit/run-chat.test.tsx`
Expected: FAIL resolving `src/run/Chat`.

- [ ] **Step 3: Implement it**

- [ ] **Step 4: Run them and see them pass**

Run: `npx vitest run && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/run src/ui/Icon.tsx src/styles/components.css tests/unit/run-chat.test.tsx
git commit -m "feat(run): chat log with interpretation lines and disputable flags; composer and an ordered send queue" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Run screen: pause, back, wake lock, step list and ending

**Files:**
- Create: `src/run/PauseSheet.tsx`, `src/run/StepSheet.tsx`, `src/run/useRunLifecycle.ts`
- Modify: `src/run/Run.tsx`, `src/styles/components.css`
- Test: `tests/unit/run-lifecycle.test.tsx`

**Interfaces:**
- Consumes:
  - `pauseRun`, `resumeRun`, `tickRun`, `endRun`, `startRun`, `endConfirmCopy` and `stepCovered` (Task 10);
  - `recoverClock` (Task 7);
  - `startDrill` and `drillDone` (Task 11);
  - `addRunRecord` (Task 2);
  - `newRunIds` (Task 12);
  - the Task 14 send queue.
- Produces:
```ts
export function useRunLifecycle(p: { store: ProgressStore; env: RunEnv; sessionId: string; sheetOpen: boolean; onBack(): void }): void
export function wakeLock(nav?: Navigator): Promise<{ release(): void } | null>   // navigator.wakeLock.request('screen'), null on any failure
export function PauseSheet(p: { mode: RunMode; drill: boolean; confirm: 'end' | 'restart' | null; endCopy: string;
  onResume(): void; onRestart(): void; onEnd(): void; onConfirm(): void; onCancel(): void }): JSX.Element
export function StepSheet(p: { rows: { id: string; order: number; name: string; covered: boolean; inRange: boolean }[];
  onPick(stepId: string): void; onClose(): void }): JSX.Element
export function finishRun(store: ProgressStore, env: RunEnv, now: number): void
  // endRun, then runs = addRunRecord, runOpen = null; navigate(`/debrief/${id}?fresh=1`, { replace: true })
```
**`useRunLifecycle`:**
- **On mount:**
  - the session's clock goes through `recoverClock(clock, lastAt)`, then `resumeRun` unless the sheet is open;
  - it pushes one guard history entry on `#/run`; a `popstate` back onto the run calls `onBack()` and pushes the guard again;
  - it requests the wake lock.
- **Hidden** (`visibilitychange` hidden, or `pagehide`): `pauseRun` (saved), and the wake lock is released.
- **Visible:** the wake lock is requested again, and `resumeRun` runs unless the sheet is open.
- **While running:** every 1 s, a non-null `tickRun` result is written.
- **On unmount:** `pauseRun`, then release.

**The Pause sheet** (`.sheet`, a bottom sheet):
- **Dialog:** `role="dialog"`, `aria-modal="true"`, named by its h2 "Paused", with the sub "The clock is stopped.".
- **Rows, top to bottom, so Resume sits nearest the thumb:**
  - "Mode: {Coached | Exam}", read-only, with the sub "Set when the run starts.";
  - Secondary "Restart case";
  - Secondary "End run" ("End drill" in a drill);
  - Primary "Resume".
- **Confirming:**
  - **End:** the `endCopy`, then Primary "End run" and Secondary "Keep going";
  - **Restart:** "Restart this case? This run won't be kept.", then Primary "Restart" and Secondary "Keep going".
- **Opening:** the run body below gets `inert`, the clock pauses, focus moves to Resume, and Escape resumes.
- **The Pause button and system back** both open it. Back while it is open does nothing.
- **End:** `finishRun`.
- **Restart:** `runOpen` becomes a fresh `startRun` (or `startDrill` with the same target and chain), for the same case and mode, and the sheet closes.

**The Step list** (Coached and drills):
- **Opening:** the "Step list" key replaces the composer with `<section class="stepsheet" aria-label="Step list">`.
- **Contents:**
  - a header with Secondary "Back to typing";
  - an `<ol>` of 19 buttons, "{order} {name}", each disabled (with "Done") when covered or outside the drill;
  - it scrolls inside itself, with `max-height: 50dvh` and `overscroll-behavior: contain`.
- **Picking** sends `{ tap: id }` through the send queue. The sheet stays open, and the row disables as soon as the tap applies.

**Ending a drill:** after any applied input in a drill, `drillDone` calls `finishRun`, and the live region says "Drill done.".

- [ ] **Step 1: Write the failing tests** `tests/unit/run-lifecycle.test.tsx`

Use fake timers. Mock `navigator.wakeLock` with `request: vi.fn().mockResolvedValue({ release: vi.fn() })`.
- **Pause:** "Pause" opens the dialog "Paused".
  - `runOpen.clock.runningSince` is null.
  - It shows "Mode: Coached" and the buttons "Restart case", "End run" and "Resume", with Resume last in the DOM.
  - Resume closes it, and `runningSince` is set again.
- **Back:** dispatching `popstate` opens the dialog.
- **Visibility:**
  - `visibilitychange` with `visibilityState` "hidden" pauses, and the pause is saved;
  - `pagehide` pauses too;
  - "visible" resumes;
  - with the sheet open, "visible" keeps the clock paused.
- **Wake lock:** requested with "screen" on mount, released on unmount, and requested again on visible. With no `navigator.wakeLock`, mounting throws nothing.
- **End:** with steps 1–14 done and 580 000 ms banked, End shows "End run at 09:40? Steps 15 to 19 count as missed.". Confirming gives:
  - `runs` of length 1, with `runs[0].faults` holding the step 15–19 points as missed;
  - `runOpen` null;
  - the hash `#/debrief/{id}?fresh=1`.
- **Restart:** confirming gives a new session id, one line, the same case and mode, and `runs` unchanged.
- **Step list:**
  - "Step list" shows the region "Step list", and the composer's input is gone;
  - clicking "6 Introduction" adds a tapped line, and the button "6 Introduction" becomes disabled;
  - two clicks in a row add one tapped line;
  - "Back to typing" brings the composer back.
- **A drill:** with every range point done but one, sending that one gives a `drill: true` record and the hash `#/debrief/{id}?fresh=1`.
- **The tick:** with `reassessFromMs` 0 and 299 s elapsed, advancing 1 s adds the two buddy lines.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/unit/run-lifecycle.test.tsx`
Expected: FAIL resolving `src/run/PauseSheet`.

- [ ] **Step 3: Implement it**

- [ ] **Step 4: Run them and see them pass**

Run: `npx vitest run && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/run src/styles/components.css tests/unit/run-lifecycle.test.tsx
git commit -m "feat(run): pause sheet on Pause and system back, wake lock, background pause, step list and ending" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Run strip trace and replay

**Files:**
- Modify: `src/ui/RunStrip.tsx`, `src/styles/components.css`
- Test: `tests/unit/runstrip.test.tsx` (append)

**Interfaces:**
- Consumes: Plan 1's `STRIP`, `timeToX` and `RunStrip({ label })`; `FaultKind`; `formatMmSs`.
- Produces (additions only; Plan 1's names stay):
```ts
export const REPLAY = { width: 315, height: 94, baseY: 62, peakY: 40, untimedPeakY: 48, axisY: 88, x0: 76, perTenMin: 109,
  callX: [14, 26, 38, 50], endX: 294 } as const;
export function replayTimeToX(seconds: number): number   // min(294, 76 + seconds * 109 / 600): 0 → 76, 3:00 → 108.7, 10:00 → 185
export function spikePath(xs: number[], baseY: number, peakY: number, fromX: number, toX: number): string
export interface StripTrace { stepsS: number[]; endS: number | null; endLabel: string | null;
  marker: { s: number; label: string; kind: FaultKind } | null }
export function RunStrip(p: { label: string; trace?: StripTrace }): JSX.Element
export interface ReplayMarker { n: number; kind: FaultKind; x: number }
export function placeMarkers(ms: ReplayMarker[], gap?: number): ReplayMarker[]   // gap 23; the first 8 by n
export interface Replay { callSteps: number[]; stepsS: number[]; endS: number | null; endLabel: string | null;
  markers: { n: number; kind: FaultKind; atS: number | null; step: number }[] }
export function ReplayStrip(p: { label: string; replay: Replay }): JSX.Element
```
**`spikePath`:**
- `M{from} {base}`, then for each x in ascending order `L{x−1.5} {base}L{x} {peak}L{x+1.5} {base}`, then `L{to} {base}`;
- numbers are rounded to 1 decimal place and printed without a trailing ".0".

**Today's strip with a trace** follows mockup lines 315–333 (strip CSS 122–140):
- the trace `.sv-trace` runs from x 4 to the end x, with spikes at `timeToX(min(s, 1200))`;
- the end line `.sv-end` at the end x (y 19–61), with `.t-lab` `endLabel` above at y 13;
- the rest `.sv-base`, from the end x to 296;
- the marker:
  - a lead line from y 18 to 45 (`.sv-lead-hi` for missed or wrong, `.sv-lead-med` otherwise);
  - its label at y 13 (`.t-miss` or `.t-med`);
  - a `.sv-miss` circle (r 5.5) on the base for missed or wrong.

**The replay** follows mockup lines 439–467:
- the Call box `.sv-call` (x 4, y 34, 54 × 38), with the rest inside it (`M8 62H55`);
- untimed spikes at `callX[order − 1]` for each of `callSteps` (peak 48);
- the break marks `M61 67l4-10M66 67l4-10`;
- the 3:00 limit at x 108.7 (y 32–71);
- the trace from x 72;
- the end line and label (y 25–71 and y 17);
- the rest from the end to 292;
- chevrons clipped at x 295 (y 40, 12 × 26);
- markers: a numbered dot (`.sv-dot-hi` or `.sv-dot-med`, r 11 at y 13, its number in `.sv-n`) and a lead line down to the trace. Missed and wrong also get the `.sv-miss` circle on the base;
- a marker's x is `replayTimeToX(atS)`, or `callX[step − 1]` for steps 1–4 with no time, or `x0` for a timed step that never got a time;
- axis labels "Call" (31), "0" (76), "RBS 3:00" (103, start-anchored), "10" (185) and "20 min" (313, end-anchored).

**`placeMarkers`:**
1. Sort by x.
2. Move any marker less than `gap` after the one before it to that marker's x plus `gap`.
3. Return them in n order, keeping only n ≤ 8.

- [ ] **Step 1: Write the failing tests**, appended to `tests/unit/runstrip.test.tsx`:
```ts
test('replay geometry', () => {
  expect([replayTimeToX(0), replayTimeToX(180), replayTimeToX(600), replayTimeToX(1200), replayTimeToX(1500)]).toEqual([76, 108.7, 185, 294, 294]);
  expect(spikePath([8, 12.8], 52, 30, 4, 20)).toBe('M4 52L6.5 52L8 30L9.5 52L11.3 52L12.8 30L14.3 52L20 52');
  expect(placeMarkers([{ n: 1, kind: 'missed', x: 111 }, { n: 2, kind: 'order', x: 120 }, { n: 3, kind: 'phrase', x: 50 }]))
    .toEqual([{ n: 1, kind: 'missed', x: 111 }, { n: 2, kind: 'order', x: 134 }, { n: 3, kind: 'phrase', x: 50 }]);
  expect(placeMarkers(Array.from({ length: 10 }, (_, i) => ({ n: i + 1, kind: 'missed' as const, x: 80 + i * 30 })))).toHaveLength(8);
});
```
- **Today's trace:** `RunStrip` given `{ stepsS: [0, 30, 171], endS: 1062, endLabel: 'Standby 17:42', marker: { s: 171, label: 'Pocket check', kind: 'missed' } }` renders:
  - `path.sv-trace` with `d` starting "M4 52";
  - the texts "Standby 17:42" and "Pocket check";
  - a `circle.sv-miss` with `cx` = `timeToX(171)`.
- **The replay:** `ReplayStrip` with `callSteps [1, 2, 3, 4]`, two markers and an end renders `rect.sv-call`, a `path.sv-untimed` with 4 spikes, `circle.sv-dot-hi`, `text.sv-n` "1", and `role="img"` with the given label.
- **A replay that never started** (`stepsS []`, `endS` null) renders no `path.sv-trace`.

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run tests/unit/runstrip.test.tsx`
Expected: FAIL. `replayTimeToX` isn't exported.

- [ ] **Step 3: Implement it**, porting the strip classes (mockup CSS lines 122–140) beside Plan 1's.

- [ ] **Step 4: Run it and see it pass**

Run: `npx vitest run tests/unit/runstrip.test.tsx`
Expected: PASS, including Plan 1's strip tests.

- [ ] **Step 5: Commit**

```bash
git add src/ui/RunStrip.tsx src/styles/components.css tests/unit/runstrip.test.tsx
git commit -m "feat(ui): run strip trace for Today and the debrief replay with numbered markers" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: Debrief

**Files:**
- Create: `src/sim/debrief.ts`, `src/run/CaseRecord.tsx`
- Modify:
  - `src/run/Debrief.tsx`, replacing the placeholder;
  - `src/styles/components.css` and `src/styles/base.css`.
- Test: `tests/unit/debrief-model.test.ts`, `tests/unit/debrief.test.tsx`

**Interfaces:**
- Consumes:
  - `activeFaults` (Task 2);
  - `describeOxygen` (Task 5);
  - `formatMmSs` and `formatShort` (Task 7);
  - `Replay`, `StripTrace` and `ReplayStrip` (Task 16);
  - `Headline` and `drillTargets` (Task 11);
  - `beginDrill` (Task 12);
  - `notesRefHref` and `notesRefLabel`;
  - `StatusChip`, `ReplacesNote` and the keys.
- Produces (`src/sim/debrief.ts`, pure):
```ts
export const FAULT_WORD: Record<FaultKind, string>;   // Missed, Wrong, Order, Phrase
export const SRACIE: readonly { letter: string; name: string }[];   // S sex, R race, A age, C case and signs, I IC no., E ETA
export function verdict(nToFix: number): string        // 0 → 'Nothing to fix this run.'; n → `${n} to fix`
export function stepsCleanOf(r: RunRecord, steps: Step[]): number
export interface Figures { time: string; rbs: string; rbsOk: boolean; steps: string; total: string }
export function figuresOf(r: RunRecord, steps: Step[]): Figures   // '17:42' | '—'; '2:41' | '—'; rbsOk when ≤ 3:00
export function wentWell(r: RunRecord, steps: Step[]): string[]
export function replayOf(r: RunRecord, steps: Step[]): Replay
export function replaySummary(r: RunRecord, steps: Step[]): string
export function todayTraceOf(r: RunRecord, steps: Step[], h: Headline | null): StripTrace
export function todayStripLabel(r: RunRecord, steps: Step[], h: Headline | null): string
export function caseLine(r: RunRecord, c: Case | null): string   // 'Breathlessness, Ang Mo Kio. Coached.'
export function verdictSub(c: Case | null): string               // 'Suspected COPD. Mdm Tan, 72.'
```
**Rules:**
- **`stepsCleanOf`:** `stepsTotal` minus the number of distinct steps that have an active fault or are tapped.
- **`figuresOf`:**
  - `time` is "—" when `usedMs` is 0 and `stepTimes` is empty;
  - `rbs` is "—" when `rbsMs` is null.
- **`wentWell`:** at most 4 lines, in this order, each only when it holds:
  1. "RBS done in {m:ss}." (RBS by 3:00);
  2. "Every RBS region, in order." (`rbs-regions` with no active fault);
  3. "Right oxygen: {describeOxygen}.";
  4. "Standby call with all of SRACIE." (6 letters);
  5. "Every step clean.".
- **`replayOf`:**
  - `callSteps` = `reached` filtered to 1–4;
  - `stepsS` = the timed steps' `stepTimes`, in seconds;
  - `endS` = `standbyMs`, else `usedMs`, else null;
  - `endLabel` = "Standby {mm:ss}", "End {mm:ss}" or null;
  - markers = the active faults, numbered from 1 in fault order.
- **`replaySummary`:**
  - "Run replay: a Call segment with untimed steps 1 to 4, then 0 to 20 minutes.";
  - then "Marker {n}, {short or label}, {word in lowercase}, {at m:ss | in the Call segment | before the clock started}.";
  - then "Standby call at {mm:ss}.", "Ended at {mm:ss}." or "The clock never started.".
- **`todayTraceOf`:**
  - the marker is the headline's point, if this run has it, else the run's first timed active fault;
  - `todayStripLabel` is "Run strip, 0 to 20 minutes: {k} steps; {short} {word, lowercase} at about {m:ss}; standby call at {mm:ss}." (or "no standby call").

**Debrief screen (`#/debrief/:id`, mockup screen 3, lines 418–512, CSS 225–247):**
- **Header:** `FocusHeader` with `exit="close"`, calling `back('/')`. Title "Debrief" ("Drill debrief" for a drill), sub `caseLine`.
- **Verdict:**
  - `<i class="bb vband" aria-hidden>`;
  - `<h2 class="h1 fixh">{verdict}</h2>`;
  - `<p class="sub dsub">{verdictSub}</p>`.
- **Replay and figures** (full runs only):
  - the replay panel holds `ReplayStrip`, labelled by `replaySummary`;
  - the figures row (`.figs`, `.fl`, `.fv`, `<small>`) shows "Time {t}/20:00", "RBS done {✓} {r}/3:00" and "Steps {n}/{total}". The ✓ is in `--c-done`, with `aria-label="within 3:00"`.
  - A drill shows only "Steps {n}/{total}".
- **Fix list:** `<ol class="fixes">` with `.fix` rows. Each row has:
  - `.num` (`num-hi` for missed or wrong, `num-med` otherwise);
  - `StatusChip`, with the kind's word;
  - `.fix-t`: the saved label;
  - `.fix-s`: the detail, " Step {n}, {step name}. ", and `<a class="ilink" href={notesRefHref}>{notesRefLabel(null, ref)}</a>`. A step id missing from `steps.json` shows "Step {n}." with no link;
  - a small Secondary "Not what I meant", which adds the point to `runs[i].disputes`.
- **Disputed rows:** under the h3 "Disputed, not counted", with "Count it again", which removes the point from `disputes`.
- **Tapped steps** (§11: "marked 'tapped' in the debrief"): when `r.tapped` isn't empty, a line under the fix list reads "Tapped from the step list: {stepsPhrase}. Not counted.".
- **Went well:** an h3 "Went well" with its list, hidden when empty.
- **`CaseRecord`:** `<section>`, with the h2 "Case record".
  - A `dl` of Complaint, MOI, Oxygen, ECG, Hypocount, Position and Decision, each "—" when unrecorded.
  - A vitals table in a `.table-scroll` region named "Vitals":
    - columns Time, SpO2, PR, RR, BP, Temp, CRT and Skin;
    - one row per `atMs`, and "Call" for null.
  - The standby call's lines.
  - `<ul class="sracie" aria-label="SRACIE">` with 6 slots. A covered slot is lit with the done fill and ink letter; an uncovered one is dashed, like an empty tile. Each slot's `aria-label` reads "{letter}, {name}: covered" or "{letter}, {name}: not covered".
- **Transcript:** `<details class="transcript"><summary>Transcript, {n} lines</summary>`, then each line with its time.
- **Key bar** (`.qkeys`):
  - **faults left:** Secondary "New case" (`#/pam/start`) and Primary "Drill the fixes", which calls `beginDrill(store, env, targets[0], targets.slice(1), r.id)` with `targets = drillTargets(r, steps)`;
  - **clean:** a lone Primary "New case";
  - **a drill:** Secondary "Back to Today", plus Primary "Next drill: step {n}, {name}" while `drillChain` is non-empty, else Primary "New case";
  - with a run open, `<ReplacesNote what="run">` sits under the primary key.
- **No record:** a record not found shows "This run isn't on this phone any more." and a TextLink "Back to Today".
- **The reveal** (R10), only when `query.fresh === '1'`:
  - the root gets `reveal`, then `reveal-go` on the next frame;
  - the strip trace draws with a `stroke-dashoffset` animation over `--t-reveal` (700 ms);
  - the figures fade in, delayed 700 ms, over `--t-fast` (160 ms);
  - fix row i fades in, delayed min(760 + 60·i, 940) ms, over 160 ms. Everything ends by 1.1 s;
  - a `pointerdown` anywhere adds `reveal-skip`, which zeroes every delay and duration.
- **`base.css`:** the reduced-motion block gains `transition-delay: 0s !important; animation-delay: 0s !important;` (the carry).

- [ ] **Step 1: Write the failing tests**

`tests/unit/debrief-model.test.ts`. Build records with `recordOf(caseId, mode, lines, opts?)`, added to `sim-helpers`: `playRun`, then `endRun`.
- **`verdict`:** 0 → "Nothing to fix this run."; 1 → "1 to fix"; 3 → "3 to fix".
- **`figuresOf`:**
  - for a run with `usedMs` 1 062 000, `rbsMs` 161 000 and 16 clean steps: `{ time: '17:42', rbs: '2:41', rbsOk: true, steps: '16', total: '19' }`;
  - for a run that ended before Approach: time and rbs are "—".
- **Steps clean:** disputing a step's only fault raises `stepsCleanOf` by 1, and a tapped step never counts.
- **`wentWell`:** "RBS done in 2:41." comes first; a run with every SRACIE letter includes "Standby call with all of SRACIE.".
- **`replayOf`:**
  - its markers are numbered 1..n, in the order of the fix list;
  - a missed pocket check sits at its moved-past `atMs`;
  - an untimed MOI phrase has `atS` null and `step` 4.
- **`replaySummary`** includes "Marker 2, MOI, phrase, in the Call segment." and ends "Standby call at 17:42.".
- **`caseLine` and `verdictSub`** for COPD: "Breathlessness, Ang Mo Kio. Coached." and "Suspected COPD. Mdm Tan, 72.".

`tests/unit/debrief.test.tsx`, with a seeded record holding 3 faults: a missed pocket check, the head-grip order and the MOI phrase.
- **The top:** the h2 reads "3 to fix", and the img is named by `replaySummary`.
- **Figures:** "17:42", "/20:00" and "Steps".
- **Fix rows, in order:**
  - "!!!Missed" with the pocket check, and a link "Notes 1" whose `href` is `#/notes/s01/rapid-body-survey`;
  - then "!!Order" for head grip;
  - then "!!Phrase" for MOI.
- **A dispute:** "Not what I meant" on row 1 changes the verdict to "2 to fix", lists it under "Disputed, not counted" and saves `disputes`. "Count it again" restores it.
- **Drill the fixes:** clicking it gives a `runOpen.drill` with target `scene-evaluation` (step 4 first) and chain `['introduction', 'rapid-body-survey']`, and the hash `#/run`.
- **A clean record:** "Nothing to fix this run." and a lone "New case" link.
- **An unknown point:** a record holding `rapid-body-survey/gone-point` still shows its saved label, with no notes link.
- **Tapped steps:** a record with `tapped: ['introduction']` shows "Tapped from the step list: Step 6. Not counted.".
- **The case record:** "Mdm Tan" isn't required. Complaint shows the chief complaint, and the SRACIE list has 6 items with "S, sex: covered".
- **The reveal:**
  - at `?fresh=1`, the root has class `reveal`, and after a `pointerdown` also `reveal-skip`;
  - without it, no `reveal` class.
- **`base.css`:** its text matches `/prefers-reduced-motion: reduce[^}]*\{[^}]*transition-delay: 0s !important/s`.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/unit/debrief-model.test.ts tests/unit/debrief.test.tsx`
Expected: FAIL resolving `src/sim/debrief`.

- [ ] **Step 3: Implement it**, porting the debrief CSS.

- [ ] **Step 4: Run them and see them pass**

Run: `npx vitest run && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sim/debrief.ts src/run src/styles tests/unit
git commit -m "feat(run): debrief with replay, figures, disputable fix list, case record, transcript and drill chain" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: Today, PAM tab and notes drill links

**Files:**
- Create:
  - `src/today/RunResume.tsx`, `src/today/LastRunPanel.tsx` and `src/today/HeadlinePanel.tsx`;
  - `src/today/discard.ts`: Today's Plan 1 quiz Discard and Undo, generalised.
- Modify:
  - `src/today/Today.tsx`, `src/today/NoRunsPanel.tsx`, `src/today/FirstRun.tsx`;
  - `src/pam/PamTab.tsx`;
  - `src/notes/SectionReader.tsx`;
  - `src/styles/components.css`.
- Test:
  - `tests/unit/today.test.tsx` (modify: its "The simulator arrives in the next update." and "Arrives with the simulator" assertions go);
  - `tests/unit/reader.test.tsx` (modify: its `.xstep` chips at line 491 keep the text "8 Delicate spine", and are now links);
  - `tests/e2e/today.spec.ts` (modify: its line 126 checks the same sentence; it now checks the "Start your first run" link instead);
  - `tests/unit/pam-tab.test.tsx` (new).

**Interfaces:**
- Consumes:
  - `useOpenRun` (Task 12);
  - `runElapsed` and `shownStep` (Task 10);
  - `headline`, `headlineCopy` and `latestFullRun` (Task 11);
  - `todayTraceOf`, `todayStripLabel`, `caseLine` and `FAULT_WORD` (Task 17);
  - `RunStrip` (Task 16);
  - Plan 1's `UNDO_MS`, `toast` and `ReplacesNote`.
- Produces:
```ts
// src/today/discard.ts
export type OpenKind = 'quiz' | 'run';
export function discardOpen(store: ProgressStore, kind: OpenKind): void
  // clears quizOpen or runOpen; toast 'Quiz discarded.' / 'Run discarded.' with [Undo] for UNDO_MS, focusAction;
  // the Undo lapses on the same rules as Plan 1's (a new quiz or run opening, a generation change)
// src/today/RunResume.tsx
export function runResumeLine(s: RunSession, env: RunEnv, now: number): string
export function RunResume(p: { primary: boolean }): JSX.Element | null
// src/today/LastRunPanel.tsx
export function formatRunAt(iso: string, now: Date): string   // 'Today, 22:10' | 'Yesterday, 22:10' | '9 Nov, 22:10'
export function LastRunPanel(p: { title: string }): JSX.Element | null
// src/today/HeadlinePanel.tsx
export function HeadlinePanel(p: { primary: boolean }): JSX.Element | null
// src/today/Today.tsx
export function todayPrimary(p: { runOpen: boolean; quizOpen: boolean; headline: boolean; noRuns: boolean }): 'run' | 'quiz' | 'headline' | 'start' | null
// src/today/NoRunsPanel.tsx: SIMULATOR_READY and its note go; NoRunsPanel gains start?: 'primary' | 'secondary'
```
**Today**, top to bottom (mockup screen 1, lines 291–355; CSS 142–172):
1. **App bar.**
2. **`RunResume`:**
   - "Run in progress: {complaint}, step {shownStep}, {mm:ss} used. The clock paused when you left." (§7, verbatim);
   - for a drill: "Drill in progress: {complaint}, step {n}.";
   - [Resume] goes to `#/run`; [Discard] calls `discardOpen(store, 'run')`.
3. **The quiz resume row** (Plan 1).
4. **`HeadlinePanel`** (`.alert`), when `headline(runs)` isn't null:
   - `StatusChip`, then `<h2 class="h1">{title}</h2>` and `<p class="sub">{sub}</p>`;
   - `.act`: the drill key ({drillLabel}, `href` drillHref) and a TextLink `notesRefLabel(null, notesRef)`.
5. **`FirstRun`.** Its run items become links to `#/pam/start`, like the read item, and "Arrives with the simulator" goes.
6. **`LastRunPanel`** (`.last`), for the newest full run:
   - a header row with the h2 "Last run" and the meta `formatRunAt`;
   - `caseLine`;
   - `.big`: `<b>{mm:ss or —}</b><span>of 20:00</span>`, then "Open debrief" (`#/debrief/{id}`);
   - `RunStrip`, with `todayTraceOf` and `todayStripLabel`.

   With no full run yet, `NoRunsPanel` shows instead, with [Start your first run] (`#/pam/start`).
7. **The Theory quiz and Continue reading** (Plan 1).

**The one Primary key** is chosen by `todayPrimary`:
- run open → Resume run;
- else a quiz open → Resume quiz;
- else a headline → the drill key;
- else no runs → Start your first run.

Every other key on the screen is Secondary.

**The PAM tab:**
- the h1 "PAM";
- `RunResume`;
- the "New case" key (`#/pam/start`): Primary unless a run is open;
- `LastRunPanel` with the title "Last run", or `NoRunsPanel` with the title "Last run" and no start key.

**Notes reader:** `StepChip` becomes `<a class="xstep" href={`#/pam/start?drill=${step.id}`} aria-label={`Drill step ${order}, ${name}`}>`, keeping its two spans.
- `.xstep` gets `min-height: 44px` and the `.ilink` underline.
- The `.xstep` rule from Plan 1's flatter, non-tappable treatment is replaced.

- [ ] **Step 1: Write the failing tests**
- **`todayPrimary`:**
  - `{ runOpen: true, quizOpen: true, headline: true, noRuns: false }` → 'run';
  - with only `quizOpen` and `headline` set → 'quiz';
  - with only `headline` set → 'headline';
  - with only `noRuns` set → 'start';
  - with nothing set → null.
- **Today, fresh:**
  - the No runs copy and the link "Start your first run" (`href` `#/pam/start`);
  - "Do a Coached run" is a link to `#/pam/start`;
  - no "Arrives with the simulator" text.
- **Today, with a run open** (COPD, step 6, 125 000 ms banked):
  - "Run in progress: Breathlessness, step 6, 02:05 used. The clock paused when you left.";
  - Resume is the primary (class `primary`), linking to `#/run`;
  - Discard clears `runOpen` and toasts "Run discarded.", with Undo;
  - Undo restores the same session.
  - With a quiz open as well, the quiz's Resume is Secondary.
- **Today, with three seeded records** (pocket check missed in two of them):
  - the chip "!!!Missed";
  - the h2 "Pocket check missed in 2 of your last 3 runs";
  - the link "Drill steps 11 to 13" (`href` `#/pam/start?drill=rapid-body-survey`) and the link "Notes 1".
- **The Last run panel:** "Breathlessness, Ang Mo Kio. Coached.", "17:42", "of 20:00", and "Open debrief" (`href` `#/debrief/{id}`). Its strip `img` is named by `todayStripLabel`.
- **`formatRunAt`**, with `now` = `new Date(2026, 10, 13, 23, 0)`. Build every date from local parts, so the test holds in any time zone:
  - `new Date(2026, 10, 13, 22, 10)` → "Today, 22:10";
  - `new Date(2026, 10, 12, 22, 10)` → "Yesterday, 22:10";
  - `new Date(2026, 10, 9, 22, 10)` → "9 Nov, 22:10".
- **The PAM tab:** the link "New case" (`href` `#/pam/start`, class `primary`). With a record, "Last run" and "Open debrief" show.
- **The reader:** in section s01, a link named "Drill step 8, Delicate spine", with `href` `#/pam/start?drill=delicate-spine`.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/unit/today.test.tsx tests/unit/pam-tab.test.tsx tests/unit/reader.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement it.** Move Plan 1's quiz Discard machinery (`pending`, `forgetDiscard`, `undoDiscard`) into `discard.ts`, keyed by `OpenKind`. Its existing tests must still pass.

- [ ] **Step 4: Run the whole suite**

Run: `npx vitest run && npm run typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src tests/unit
git commit -m "feat(today): run resume row, headline with its drill, last-run strip; PAM tab New case; notes step chips drill" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 19: PWA holds, shell carries and the Install key

**Files:**
- Create: `src/lib/install.ts`
- Modify:
  - `src/lib/offline.ts`, `src/app/PwaPrompts.tsx` and `src/app/App.tsx`;
  - `src/settings/Settings.tsx` and `src/main.tsx`;
  - `src/quiz/QuizTab.tsx` (the orphaned doc comment at line 30);
  - `src/styles/components.css`.
- Test:
  - `tests/unit/offline.test.ts` and `tests/unit/install.test.ts` (new);
  - `tests/unit/pwa.test.tsx`, `tests/unit/shell.test.tsx` and `tests/unit/settings.test.tsx` (append).

**Interfaces:**
- Consumes: `isRunRoute` and `matchRoute`; `useRegisterSW`'s `onNeedReload` option (vite-plugin-pwa 1.3: called when another window's update takes control); the store's `recheck()`.
- Produces:
```ts
// src/lib/offline.ts
export function requestReload(reload?: () => void): void       // reloads now, unless the route is a run route: then holds it
export function releaseHeldReload(reload?: () => void): void   // reloads if one is held
export function reloadHeld(): boolean
// src/lib/install.ts
export type InstallState = 'available' | 'installed' | 'unavailable';
export function watchInstall(win?: Window): () => void   // beforeinstallprompt → preventDefault, keep the event; appinstalled → installed
export function installState(win?: Window): InstallState  // 'installed' also when (display-mode: standalone) matches
export function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'>
export function useInstallState(): InstallState
```
**PWA holds (§10 "held until no run is active"; carries):**
- `PwaPrompts` passes `onNeedReload: () => requestReload()` to `useRegisterSW`.
- `reloadIntoUpdate` uses `requestReload` for its 3 s fallback and its `controllerchange` reload.
- An effect calls `releaseHeldReload()` whenever the route is not a run route.
- The Reload keys on the Reload banner stay immediate, because the trainee chose them.

**Shell carries:**
- **Rechecks:** `useOtherWindowSaves` also listens to `pageshow` and to `visibilitychange` (when visible), and calls `store.recheck()`. A bfcache-restored Android tab then shows the Reload banner before its first change.
- **Toasts under the banner:**
  - while a banner shows, `.app` gets `has-banner`, and `--banner-h` is set from the banner's height (through `ResizeObserver` when present);
  - the CSS is `.app-focus.has-banner .toasts{top:calc(env(safe-area-inset-top) + 76px + var(--banner-h,0px))}`.
- **`QuizTab.tsx`:** drop the stray `/** The question bank failed to load (spec §7). */` line above `ReplacesNote`'s doc comment, and put it on `QuestionsError`.

**Install (user ruling, 2026-11-13):**
- `main.tsx` calls `watchInstall()` before rendering.
- Settings gains an "Install" group between Offline and Storage:
  - **available:** "Install Crew Leader to open it full screen from your home screen." and Secondary "Install app". It calls `promptInstall`; an accepted install toasts "Installing Crew Leader.";
  - **installed:** "Installed on this phone.";
  - **unavailable:** "Chrome hasn't offered to install yet. Use its menu: Install app.".

- [ ] **Step 1: Write the failing tests**
- **`offline.test.ts`**, with `reload = vi.fn()`:
  - at `#/run`, `requestReload(reload)` doesn't call it, and `reloadHeld()` is true;
  - after `location.hash = '#/'`, `releaseHeldReload(reload)` calls it once;
  - at `#/quiz`, `requestReload(reload)` calls it at once.
- **`pwa.test.tsx`:** the mocked `useRegisterSW` captures its options. At `#/run`, calling `options.onNeedReload()` reloads nothing. Navigating to `#/` then reloads once; mock `reloadPage` through `vi.mock('../../src/lib/offline', …)` with the real hold logic.
- **`shell.test.tsx`:**
  - dispatching `pageshow` calls `store.recheck` (spied);
  - `visibilitychange` with `visibilityState` "visible" calls it too;
  - with the store's write block at `'conflict'`, `.app` has class `has-banner`.
- **`install.test.ts`:**
  - `watchInstall(fakeWin)`, then a dispatched `beforeinstallprompt` event: `preventDefault` is called, and `installState(fakeWin)` is 'available';
  - `promptInstall()` calls `prompt()`, and with `userChoice` `{ outcome: 'accepted' }` resolves 'accepted';
  - a dispatched `appinstalled` makes it 'installed';
  - `matchMedia('(display-mode: standalone)')` matching also gives 'installed'.
- **`settings.test.tsx`:** each of the three states shows its copy, and "Install app" shows only when available.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/unit/offline.test.ts tests/unit/install.test.ts tests/unit/pwa.test.tsx tests/unit/shell.test.tsx tests/unit/settings.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement it**

- [ ] **Step 4: Run the whole suite**

Run: `npx vitest run && npm run typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src tests/unit
git commit -m "feat(pwa): hold every automatic reload during a run; recheck saves on pageshow; toasts clear the banner; Install key" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 20: Android profile, run e2e, save profile and screen baselines

**Files:**
- Modify: `playwright.config.ts`, `tests/e2e/seed.ts`, `tests/e2e/screens.spec.ts`
- Create:
  - `tests/e2e/run.spec.ts` and `tests/e2e/perf.spec.ts`;
  - the new baselines in `tests/e2e/__screens__/`.

**Interfaces:**
- Consumes:
  - every screen;
  - `src/sim/*`, which is pure and so runs in Node;
  - Plan 1's `seed`, `progressWith` and `checkScreen` helpers.
- Produces:
```ts
// playwright.config.ts: use keeps baseURL only; webServer unchanged
projects: [
  { name: 'phone', use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true }, testIgnore: /perf\.spec\.ts/ },
  { name: 'pixel', use: { ...devices['Pixel 7'] }, testMatch: /(run|perf)\.spec\.ts/ },
]
// tests/e2e/seed.ts re-exports these from ../unit/sim-helpers (Tasks 10 and 17), which reads its JSON with fs
export { playRun, recordOf } from '../unit/sim-helpers';
```
**`run.spec.ts`** (both projects; service workers blocked):
1. **A Coached run, start to debrief:**
   1. Today → PAM → "New case" → "Pick by complaint" → "Giddiness" → "Take the call".
   2. The activation shows, and the clock shows "--:--" and "Starts at Approach".
   3. The step 1 line gets "Ops Ctr, roger.".
   4. The approach line starts the clock ("00:00", "RBS by 3:00").
   5. "Buddy, do a head grip." then "Is there any catastrophic bleeding?" give a status containing "Order".
   6. Pause → End run shows text matching `/^End run at \d\d:\d\d\? Steps .+ count as missed\.$/`.
   7. End run → the h1 "Debrief" and an h2 matching `/ to fix$/`.
2. **Reload mid-run:** after three lines, reload. The hash is still `#/run`, the three lines are there, and the clock text is unchanged under `page.clock.pauseAt`.
3. **System back:** `page.goBack()` opens the "Paused" dialog, and the URL still ends `#/run`. Resume closes it.
4. **Reopening the app:** `page.goto('/#/')` mid-run shows text matching `/^Run in progress: Giddiness, step \d+, \d\d:\d\d used\. The clock paused when you left\.$/`, and Resume returns to `#/run`.
5. **Exam:** no list named `/^Steps: /`, no "Step list" button, and no flag after "MOI is case of giddiness.".
6. **Tap mode:** "Step list" → "1 Respond call" adds the filled canonical line, and that row becomes disabled.
7. **The clock's limits** (`page.clock.install`): after Approach, `fastForward('03:01')` shows "RBS limit passed"; at 15:00, "5 min left"; at 20:42, "+0:42".
8. **Layout fit** (pixel): `document.documentElement.scrollHeight <= innerHeight + 1`, and the chat's computed `overflow-y` is "auto" and `overscroll-behavior-y` "contain".

**`perf.spec.ts`** (pixel only): the save budget profile.
1. Seed a heavy progress through `addRunRecord`:
   - 407 question stats;
   - 50 records of 150 lines each, of which only the newest 10 keep their transcripts;
   - an open COPD run at step 10.
2. Throttle the CPU 4×: `(await page.context().newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: 4 })`.
3. Send 12 lines on `#/run`.
4. Read `performance.getEntriesByName('crewleader:save')` and log its durations.
5. **Expected:** the median is 30 ms or less, and the max 80 ms or less. If the budget fails, cut work in the save path; never raise the budget.

**`screens.spec.ts` additions** (phone project):
- **Fixed inputs:**
  - every test runs `page.clock.setFixedTime(new Date(AT))`;
  - `page.addInitScript` stubs `navigator.storage.persist` and `persisted` to resolve false (the carry), so `settings.png` no longer depends on headless Chromium.
- **New baselines**, each through `checkScreen`:
  - `run-start` (`#/pam/start`);
  - `run-coached`: `playRun('copd-amk-01', 'coached', …)` up to step 10, with the head-grip order flag and the simple-face-mask flag;
  - `run-exam`: the same lines, in Exam;
  - `run-step-list`: Coached, with the sheet open;
  - `run-paused`;
  - `debrief`: a `recordOf` COPD record with 3 faults, at `#/debrief/{id}` without `fresh`;
  - `today-last-run`: three records with the pocket check missed in two, so the headline shows;
  - `pam-tab`.
- **Run screens** use `fullPage: false`, because they are the viewport by design.
- **`TARGETS`** gains `.sq`, `.send`, `.newpill` and `.xstep`.
- **Re-baselined on purpose:**
  - `today`: [Start your first run], and the run items as links;
  - `settings`: the Install group, and the stubbed storage line.
- **Comparisons:** the others must match unchanged.

- [ ] **Step 1: Write the config, the seed helpers and the specs**

- [ ] **Step 2: Create the baselines**

Stop any stale `vite preview` on :4173 first.

Run: `npx playwright test tests/e2e/screens.spec.ts --project=phone --update-snapshots`
Expected:
- the 8 new PNGs and the 2 re-baselined ones are written;
- every axe, width and target-size check passes.

Fix any axe violation in its component, never by disabling a rule. Open each new PNG beside mockup screens 1–3, and check:
- the beacons scene on the run;
- the band only as a pattern;
- status only as chips;
- vitals in cabin white.

- [ ] **Step 3: Run every Playwright project**

Run: `npx playwright test`
Expected: PASS on both projects. The perf spec logs its numbers within budget.

- [ ] **Step 4: Run the whole suite**

Run: `py -m pytest && npx vitest run && npm run build && npx playwright test`
Expected: everything passes. `dist/sw.js` precaches all 8 `data/cases/*.json`; check with `grep -c "data/cases/" dist/sw.js` ≥ 9, which includes the index.

- [ ] **Step 5: Commit**

```bash
git add playwright.config.ts tests/e2e
git commit -m "test(e2e): Pixel 7 project, run flows, save profile at 4x throttle, run and debrief baselines" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Spec coverage (Plan 2 scope)

| Spec item | Task |
|---|---|
| §6.1 focus screens Run start, Run and Debrief; Pause on runs, ✕ elsewhere | 12, 13, 15, 17 |
| §6.1 Today: resume row, headline with drill, last-run strip opening the debrief; first-run ticks | 18 |
| §6.1 PAM tab: New case (run history as thumbnails → Plan 3, R2) | 18 |
| §6.1 Run start: case random and hidden, or by complaint; Coached or Exam; typing; the clock card with the last 3 times; Take the call | 12 |
| §6.1 shared `notesRef`: debrief fixes, headline and notes cross-links (drill links) | 17, 18 |
| §6.2 step flow from `steps.json`, with the notes' refinements (head grip at Introduction, Approach order, "suspected", fast/shallow, ETA) | 1, 6, 10 |
| §6.2 roles: Ops Ctr, caller, patient in voice, buddies, and a tester giving only what is asked | 1, 3, 8, 10 |
| §6.2 Coached (step bar, inline flags, all tiles, step-list sheet) and Exam (none of these) | 13, 14, 15 |
| §6.2 clock: `--:--` before Approach, the RBS line, 5 min left, the 18:00 warning, `+m:ss`, pausing in the sheet and the background, a stored start | 7, 13, 15 |
| §6.2 interpretation line, "Who's this for?", "Not what I meant" and disputes | 5, 10, 14, 17 |
| §6.2 vitals rail: four tiles plus those reported, cabin white | 13 |
| §6.2 pause and leaving: Pause or back opens the sheet; Resume, Restart, Mode, End with its confirm; saved after every line; wake lock | 2, 14, 15 |
| §6.2 debrief: verdict, replay with Call segment and markers, figures, fix list order, went well, case record with SRACIE, actions | 16, 17 |
| §6.2 grading engine: keywords, synonyms, stems, negatives, accepted variations; intents and nearby steps; paraphrase fixtures; a replaceable interface | 4, 5, 6 |
| §6.3 the 8 cases, unstable, masked, `reviewed: false` | 1, 3 |
| §6.6 per run: case, mode, date, time, step timings, missed, order, phrase, disputes, transcript; schema version | 2, 10 |
| §7 No runs [Start your first run]; Clean debrief; Run left open; Update never during a run | 17, 18, 19 |
| §8 chat `role=log` with hidden prefixes; flags `role=status`; clock `role=timer` with a polite region; strip `role=img` with a summary; 100dvh run grid; one scroller; stick within 80px with the "↓ N new" pill | 13, 14, 16, 20 |
| §9 run beacons scene; band on the run's top edge, over the verdict, chevrons at 20:00; chips; readings settle from "– –"; the timer never animated; debrief reveal ≤ 1.1 s with tap to skip; reduced motion | 13, 16, 17 |
| §10 update prompts held until no run is active; Vitest for the grader fixtures and the clock; Playwright screens at 390px | 7, 6, 19, 20 |
| §11 late steps (Order; Missed at the end; Coached nudge 2 steps past; steps N/19 with no fault) | 9, 10 |
| §11 every part said (RBS regions in order, eye contact, abnormalities; 6 auscultation points with 3 questions; DTBL; NTUCP; B.B.O.L.T.Z. or "4 in 1" plus LSU; SRACIE), with missing parts named | 1, 6, 9 |
| §11 trauma extras (bleeding control, C-collar, jaw thrust, distal pulse and immobilisation, Load & Go) in their normal steps | 1, 3, 6 |
| §11 readings by phase; the wrong mask gives no improvement and the debrief notes it; reassess every 5 minutes; the vitals table with times | 8, 9, 10, 17 |
| §11 drills: one step before, prefilled from the case, untimed, labelled, out of stats, chained in run order | 11, 12, 15, 17, 18 |
| §11 tap mode: canonical lines and replies, marked tapped, out of stats | 10, 15, 17 |
| §11 unconscious branch reserved; all 8 cases conscious | 3 |
