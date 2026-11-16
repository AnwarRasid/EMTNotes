# Crew Leader Plan 3 of 3: Polish. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish Crew Leader with spec §10's build phase 4: voice input behind the designed mic key, run history as strip thumbnails on the PAM tab, the optional Claude API "smart tester" behind the existing `Grader` seam, and three more cases. The plan also lands every item Plan 2's ledger and final reviews carried to Plan 3, and a verified, dry-run procedure for publishing a git history without `sources/`.

**Architecture:**
- **The simulator** stays pure TypeScript under `src/sim/`. Plan 3 adds two pure modules there:
  - `softBreaks.ts`, sentence breaks for a dictated line;
  - `smart.ts`, the smart grader. It wraps `keywordGrader` and asks a transport only about sentences the keyword rules read nothing for.
- **The browser edges** are new folders:
  - `src/voice/`: the Web Speech wrapper;
  - `src/smart/`: the smart tester's own storage, and the Claude transport. The transport is the only importer of `@anthropic-ai/sdk`, and it loads the SDK lazily.
- **State:** progress keeps `SCHEMA_VERSION` 2. Every new field (`settings.answerBy`, `ChatLine.smart`, `RunRecord.smartLines`) is optional. A field its interface types as required takes a default (`answerBy` 'typing', `smartLines` 0). `ChatLine.smart` is `v.optional(v.literal(true))` with no default, like `tapped`. The API key never enters `Progress`.
- **Screens:** the composer gains the mic, the PAM tab gains run history, and Settings gains the Smart tester group.

**Tech Stack:**
- Plan 2's stack, unchanged: Node 24, Vite 8, TypeScript 6, Preact 10, valibot and vite-plugin-pwa; Vitest with jsdom; Playwright with @axe-core/playwright; pytest.
- **Plan 3 adds one dependency,** `@anthropic-ai/sdk`, in Task 9. The claude-api skill requires the official SDK, never raw `fetch`.

**Spec:** `docs/superpowers/specs/2026-11-09-crew-leader-design.md`.
- **Read it with:**
  - Plan 2, `docs/superpowers/plans/2026-11-13-plan-2-pam-simulator.md`, which this plan builds on;
  - Plan 2's ledger, `.superpowers/sdd/2026-11-13-plan-2-pam-simulator/progress.md`, and its `final-review.md` and `final-fix-review.md`;
  - the mockup, `.superpowers/alts/scdf.fragment.html`. Its screen 2 has the banded mic key, `.as-mic`, at lines 222 and 410.
- **Precedence:** the spec wins, then this plan's Decisions, then Plan 2's rulings, then Plan 1's. Every "Ruling:" line in both ledgers stays binding unless a Decision below replaces it.

**Scope:**
- **In:**
  - spec §10 phase 4: more cases, voice input, run history, the optional Claude API tester;
  - §6.1: the PAM tab's run history, Run start's "Answer by", and Settings' optional Claude API key;
  - §2: voice input;
  - §4: the smart tester;
  - §6.2: the replaceable matcher;
  - §6.3: more cases;
  - every carried item in "Carries Plan 3 owns".
- **Out:** listed with reasons in "Out of scope".

## Global Constraints

**Product and platform**
- **Android first** (user ruling, 2026-11-13):
  - Android Chrome, in a tab or installed;
  - 375px is the baseline, and no page scrolls sideways at 375px (checked at 360px too for the composer);
  - no iPhone-only code.
- **Playwright projects:**
  - `phone` (390×844) holds every screenshot baseline;
  - `pixel` (`devices['Pixel 7']`) runs the run flows, and Plan 3's voice and smart-tester flows.
- **Theme:** dim theme only. `body` keeps `var(--c-bay)`.
- **Offline:** everything but voice and the smart tester works offline, as before. Both fail soft to typing and to the keyword rules.
- **Privacy:**
  - noindex, and `robots.txt` disallows all;
  - nothing is sent anywhere except the smart tester's request to `api.anthropic.com`, when the trainee has turned it on.
- **Publishing (user, 2026-11-15):**
  - the repo will be the public GitHub repo `crew-leader`, published after Plan 3 by the controller with the user;
  - the site stays unlisted, but the repo is public;
  - no task adds a README;
  - no file in the repo links to, or names, the Pages URL;
  - no personal value (the current personal author email, any author or committer name, `git config user.name`, the OS username) is ever written into any file, test, log or commit message. The publish tool reads them at runtime and masks them.

**Visual identity:** Plan 2's rules stand.
- The band is a pattern, never a status.
- Status is solid chips with `!!!` or `!!` and a word.
- Readings are in cabin white.
- The mic is the banded key (mockup `.as-mic`).
- No SCDF marks.

**Accessibility (§8):** Plan 2's rules stand.
- real buttons and links;
- `aria-label` on icon buttons;
- 4.5:1 text contrast and 3:1 non-text contrast;
- focus rings;
- targets of 44px or more;
- 16px inputs;
- `lang="en-SG"`;
- reduced motion.
- **New live text** goes through one `role="status"` line in the composer. It never adds or removes nodes inside the chat's `role="log"`.

**Content and copy**
- **§7 strings stay verbatim.** Write new copy in the same plain voice. The copy blocks in each task are exact.
- **New cases:**
  - conscious and unstable, with two or more signs;
  - clinical facts drawn only from the trainee's notes (`public/data/notes.json`), with the section named per fact;
  - names, addresses and ICs invented and masked (`S{yy}xxxxx{L}`, birth-year digits);
  - `"reviewed": false`;
  - listed in the ledger for the user's clinical check.
- **`contentVersion`:** a task that edits `steps.json` sets this exact value and updates its pin in `tests/unit/data-integrity.test.ts` (today `'2026-11-15.1'`):
  - Task 1: `'2026-11-15.2'`;
  - Task 2: `'2026-11-15.3'`;
  - Task 3: `'2026-11-15.4'`;
  - Task 4: `'2026-11-15.5'`, only if it edits `steps.json`.

  No other task edits `steps.json`. A task run on a later day uses that day's date: `<day>.1` for the first such task that day, adding 1 for each one after.

**Code rules**
- **Pure simulator:** `src/sim/*` imports no `window`, `document` or `preact`, and nothing from `src/smart/` or `src/voice/`. The Playwright seed helper still runs it in Node.
- **Progress:**
  - `SCHEMA_VERSION` stays 2;
  - `SLOT_KEYS` and the integer `v` stay;
  - every new field is optional. One its interface types as required takes a default, `v.optional(…, default)`. An optional `true` flag (`ChatLine.smart`) is `v.optional(v.literal(true))` with none, like `tapped`.
  - The run schemas still mirror their interfaces (`_RunSchemasMirrorTheirTypes`).
- **The API key:**
  - it lives only under localStorage `crewleader.smart`;
  - it is never in `Progress`, a toast, a log line, a test snapshot or an e2e seed's progress;
  - it is sent only as the SDK's auth header to `api.anthropic.com`.
- **Voice never sends.** Dictated words go into the field. Only Send sends.
- **Toasts:** never `ms: Infinity`.
- **Ids:** these keep their names and signatures:
  - step and must-hit ids;
  - `Grader`, `interpret(line, ctx)`, `envFor(steps, c, grader?)`;
  - `RunStrip`, `ReplayStrip`, `todayTraceOf`, `STRIP`;
  - `ROUTES`, `Progress.runs` and `Progress.runOpen`.

  New must-hit ids and parts are allowed; renames are not.
- **Sweeps:** the canonical typed and tapped sweeps stay at 0 faults in every case, and the reply sweep stays green. If a data edit moves any sweep, the task explains each change in its report.

**Stack pins:** `package.json` and the lockfile change only in Task 9, by `npm install @anthropic-ai/sdk`. Record the installed version in the ledger.

**Git, tools and hook**
- **Git:**
  - work on branch `plan-3-polish`, cut from `main` at `f8fe0cd`;
  - each task ends with a commit whose message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`;
  - no remote and no push; the deploy workflow is never triggered;
  - **Task 11's publish snapshot is built only in a temporary clone.** Nothing rewrites this repo's history, checks out across `c1c3ef5`, or resets this working repo.
- **Commands:**
  - run every command through Git Bash, never PowerShell, and create files with the Write tool (Plan 1 ruling W3);
  - before any Playwright run, stop a stale `vite preview` on :4173;
  - keep comparison screenshots in the scratchpad.
- **`sources/`:** before any git command that could move this repo's checkout, copy `sources/` outside the repo first (Plan 2 merge incident). No Plan 3 task needs such a command.
- **Guard hook:** a local hook may block the first creation of each new file. Answer it from this plan's Interfaces blocks: what calls the file; that nothing else serves that purpose; and the file's data schema. Quote the user's words: "Once this is done, just continue with plan 2 and 3, No need to wait for my signal". Then retry.
- **Execution:** subagent-driven with Opus subagents (user's standing instruction). Build without waiting for a signal.

## Review Focus

1. **Voice on a real Android phone:**
   - **Cases:**
     - mic permission refused;
     - the phone offline;
     - Chrome's recogniser stopping mid-SRACIE on a pause;
     - the app sent to the background, or the Pause sheet opened, while listening;
     - a dictated line with no punctuation.
   - **Expected:**
     - nothing is ever sent by voice;
     - what was heard stays in the field;
     - listening stops on pause, hide and Send;
     - a toast says what to do;
     - an unpunctuated line is broken where the speaker turned to someone new.
   - **Tests:**
     - Task 4: `softBreaks` and the canonical sweep;
     - Task 5: fake recognition errors, `hold`, `visibilitychange`;
     - Task 12: `voice.spec.ts`.
2. **The smart tester failing during a timed run:**
   - **Cases:** a slow network; a bad key; a CORS-blocked organisation; HTTP 429 or 500; garbage JSON; a refusal; going offline.
   - **Expected:**
     - each line is graded by the keyword rules within 6 s;
     - one toast per run on a failure; none offline, where no request is made;
     - no line is lost or applied twice;
     - the clock is never held.
   - **Tests:**
     - Task 8: timeout, invalid verdict, offline, cache;
     - Task 9: the error mapping and the pending bubble;
     - Task 12: `smart.spec.ts` with a delayed route.
3. **What leaves the phone:**
   - **Cases:** the key, the IC, the patient's name or address, other runs, the quiz or notes reaching a request, a log or the save.
   - **Expected:**
     - the request body holds only the Decision D17 fields;
     - the key travels only in the auth header;
     - `Progress` never holds the key.
   - **Tests:**
     - Task 8: `smartFacts`, `maskCase` and `smartRequest`;
     - Task 9: the request body with an injected `fetch`, and the Settings save;
     - Task 12: the request captured by `page.route`.
4. **Storage and stray taps:**
   - **Cases:**
     - `QuotaExceededError` mid-run;
     - "Drill the fixes" pressed from an old debrief while a run is open;
     - a reload, or Android discarding the tab, with a half-typed SRACIE;
     - the cases failing to load while a run is open.
   - **Expected:**
     - the save trims old transcripts and succeeds;
     - Undo brings the open run back;
     - the draft comes back;
     - Today and PAM say why the run can't show, with Try again.
   - **Tests:** Task 7.
5. **Old saves and new content:**
   - **Cases:**
     - records saved before Plan 3 (no `smartLines`);
     - runs on a case a later build drops, in history;
     - drills in history;
     - the three new cases through every sweep;
     - an RTA run under the longer `{limbWhere}` line.
   - **Expected:**
     - old records load with defaults, and history shows "A removed case.";
     - drills open their debriefs;
     - every sweep passes for all 11 cases;
     - every filled canonical line still fits 600 characters.
   - **Tests:** Tasks 3, 6 and 8.

## Decisions

Each settles a question the spec leaves open, with its reason and its cost if wrong. The controller has ruled on the ones flagged below, and the rows here carry those rulings (Plan 3 ledger).

| # | Decision | Why | Cost if wrong |
|---|---|---|---|
| D1 | Voice uses Web Speech (`SpeechRecognition`, else `webkitSpeechRecognition`). Run start's "Answer by" offers Typing (the default) or Voice, saved as `settings.answerBy`. | §6.1 puts "Answer by" on Run start; §6.3 designs the mic in. A saved choice keeps typists' composer unchanged. | one setting |
| D2 | In Voice the composer is: Step list (Coached and drills), the field, Send as a plain square key, then the mic as the banded key on the right. Typing stays as Plan 2 built it. | The mockup's banded mic sits in the right slot, and the trainee still needs Send to check the words first. Both fit 360px (the field keeps at least 160px). | layout only |
| D3 | The mic is tap to start and tap to stop: `aria-label="Speak"` with `aria-pressed`. It is not the mockup's "Hold to speak". | TalkBack can't hold a key reliably, and one-handed tap-toggle is easier. Recognition also ends by itself at a pause. | one label and a gesture |
| D4 | Voice never sends. Each final result goes through `softBreaks`, then is appended to the field. Interim words show in a line above the composer. The trainee edits and taps Send. | Spec §2's anti-goal: a correct answer must not be flagged for a misheard word. The trainee sees what will be graded. | none |
| D5 | Recognition settings: `continuous: false`, `interimResults: true`, `maxAlternatives: 1`, `lang 'en-SG'`. On `language-not-supported`, retry once with `'en-GB'`. | Android Chrome's continuous mode repeats finals. `en-SG` matches the app and Singapore speech. | a lang tag |
| D6 | The mic is never blocked offline: Android Chrome usually needs the network, but some phones recognise on the device. A `network` error toasts "Voice needs a connection right now. Type instead." Listening stops on the Pause sheet, a hidden page, the step list and Send. | Honest, and it never locks out a phone that can do it. | none |
| D7 | Soft breaks apply only to dictated text, in the voice path, and show in the field. A transcript that already has `.`, `?` or `!` is left as it is, and typed lines are never touched. Break cues: an addressee word or the patient's call name; a short list of step openers. There is never a break right after an addressee, a filler or a possessive, nor within 2 words of the last break. Task 4's canonical sweep pins the cue list. | Plan 2 ruling carry (c). Visible and editable, with no grader change. | an unpunctuated line breaks badly; the sweep guards it |
| D8 | Voice tests: Vitest with a fake `SpeechRecognition` on `window`; Playwright with an init-script fake that plays scripted transcripts. The real mic is checked on the user's phone. | Playwright can't drive a real mic. | none |
| D9 | iPhone gets no special code. Safari's `webkitSpeechRecognition` goes through the same path, untested. | Android-first ruling. | an iPhone quirk later |
| D10 | Run history replaces the PAM tab's Last run card. It lists every record, drills included, newest first, 10 at a time with "Show 10 more", up to `RUN_LIMITS.runsKept` (50). Each row opens `#/debrief/{id}`. Today keeps its Last run card. | §6.1: "Run history as strip thumbnails; each opens its debrief". It makes drills' and older runs' debriefs reachable (Plan 2 spec deviation S10/R2). 50 strips at once is wasteful on a phone. | paging |
| D11 | The thumbnails are `MiniStrip`: `RunStrip`'s geometry and `todayTraceOf`'s trace, with the text labels dropped, drawn at half size and `aria-hidden`, inside a link whose own text gives the case, date, time and verdict. A drill (untimed) has no strip. | A strip at half size can't carry readable labels. The link text is the text summary §8 asks for, said once. | one component |
| D12 | The smart tester reads only sentences the keyword grader read nothing for, where nothing was dropped before arrival. It may credit only points the keyword grader could still credit there: not done, in `ctx.pending` or the steps `current` to `current + 2`. Before arrival it may credit only call steps (orders 1–2); after arrival, never those. It never credits a `check` point (oxygen, ECG or arm). Missing required words (Phrase) and the addressee stay the keyword grader's. | It keeps the hardened keyword rules, can only add credit, and stays cheap. It lifts the ruled trade-offs where a correct line read nothing (for example "Don't lie flat, please sit up."). | some misreads stay misreads |
| D13 | The default model is `claude-opus-5-5` (the claude-api skill's default). Settings offers `claude-sonnet-5-5` and `claude-haiku-5-5` as the user's choice. Each request uses `output_config.effort: 'low'`, no `thinking` field (Opus 5.5 thinks adaptively), and `max_tokens: 2048`. The output uses structured outputs: `output_config.format = { type: 'json_schema', schema }`, with the candidate point keys as an `enum`. | The skill forbids downgrading for cost on our own, and a per-request enum keeps answers to real keys. | a slower or costlier default |
| D14 | **Latency:** at most one request per unread line. It has a 6 s budget (`SMART_TIMEOUT_MS`), the SDK's `timeout: 6000` and `maxRetries: 0`, a per-run cache, and a per-run cap of 40 checks (`SMART_MAX_CHECKS`). **Fallback:** an error, timeout, refusal or invalid verdict means the keyword reading, with one toast per run. Offline (`navigator.onLine === false`) means the keyword reading silently: no request, no toast. **While waiting:** the line shows as a pending bubble after 300 ms. | The clock keeps running in a timed run, so a check must never hold the run. | about 6 s on a bad line |
| D15 | Determinism: a verdict is applied once and saved in the run's hits. The debrief never regrades. The per-run cache answers the engine's re-reads (the held line, queue retries) the same way. `ChatLine.smart` and `RunRecord.smartLines` record where smart credit came from. Stats count smart runs like any other run. | A debrief reads the same every time, and a later stat can separate smart runs. | one count |
| D16 | The key is stored in localStorage `crewleader.smart` with the on switch, model and spend. It sits outside the two-slot save: Reset progress keeps it, and Remove key clears it. | §4: "the user's own Claude API key, entered in Settings", stored only on the device. The key never rides in progress. | none |
| D17 | **What is sent:** the unread sentence(s), each with its index; the run's step order and name; whether the crew has arrived; the candidate points (key, label, parts); and the case facts `complaint`, `type`, the patient's `sex`, `race` and `age`, the ETA, and the conditions that hold. **Never sent:** the IC (even masked), the name, the call name, the address, the run id, timestamps, other runs, quiz, notes or settings. A sentence the trainee said may hold the first four, so `smartRequest` replaces them in each sentence before the request is built (`maskCase`, Task 8): <br>- the name and the call name, each as a whole phrase (never one word alone), become "the patient"; <br>- the IC, in any form it may be typed in, and any NRIC-shaped token become "the IC"; <br>- the address, its block and street, its unit and the case's area become "the address". <br>Task 8's `maskCase` gives the exact rules. | The user's rule, and the minimum Claude needs to place a sentence. | none |
| D18 | The SDK is loaded by `await import('@anthropic-ai/sdk')`, only in `src/smart/claude.ts`, with `new Anthropic({ apiKey, dangerouslyAllowBrowser: true, timeout: SMART_TIMEOUT_MS, maxRetries: 0 })`. That sends the required CORS header, `anthropic-dangerous-direct-browser-access: true`. A 401 whose message begins "CORS requests are not allowed for this Organization" gets its own Settings copy. | claude-api skill and the Authentication docs: browser calls need that header, and ZDR or Compliance API organisations are refused. | none |
| D19 | No server-side refusal fallbacks (controller ruling). Every model uses `client.messages.create`, with no `betas` and no `fallbacks`. A `stop_reason: 'refusal'` is a failure like any other: the keyword reading. | A beta header on a browser CORS call is unverified, and the keyword fallback already covers a refused line. | a rare refused line graded by keywords only |
| D20 | **Testing without a network:** <br>- the pure core with a fake transport; <br>- the transport in a `// @vitest-environment node` test, with `fetch` injected through the SDK's `fetch` client option (the SDK doesn't support jsdom); <br>- Playwright's `page.route` on `**/v1/messages*`. | No live call in any test. | none |
| D21 | **More cases: three,** one per gap the notes support. That makes 11. <br>1. **The AMS protocol** (s05 #1, the only s05 protocol without a case): a confused patient with a normal hypocount, Load & Go. <br>2. **The s17 "Real case":** an atypical AMI presenting as toothache. He is not on GTN, so not the chest pain protocol (s05 #6), and Load & Go per s17's decision point. <br>3. **The first trauma case with catastrophic bleeding and a limb injury together.** <br>Step 18's Stay & Treat and Load & Go points are keyed on the case's own plan (`stayAndTreat`, `loadAndGo`, derived from `expected.decision.plan`), not on medical or trauma, so a medical Load & Go grades right. | More cases from elsewhere would depart from the notes, an anti-goal. Each new case teaches something the 8 don't. For the 8 existing cases, medical means Stay & Treat and trauma means Load & Go, so nothing they grade moves. | clinical facts for the user's check |
| D22 | The `{limbWhere}` canonical slot is filled from the new `findings.rbs.limb.where` ("right leg"). A `say` may hold a canonical slot, and the immobilise say becomes "Buddy, immobilise the {limbWhere}.". | Plan 2 final review parked 3. The RTA line becomes 598 of 600 characters. | one field |
| D23 | `bp-arm` gains `check: 'arm'`. Naming the arm the patient ruled out (bleed, CCF) is **Wrong**, with its detail. Its alternatives are tightened, so "Right arm no injuries." at step 12 and "…right apex…, then BP." no longer credit it. An arm named in a question ("Any shunt or fistula on your left arm?") is no choice, so it is never graded. | Plan 2 residual ruling ("check:'arm' for a ruled-out arm, the wider bp-arm lenient paths"). It follows R5's Wrong for a wrong choice. | one check kind |
| D24 | "Score 15." said alone credits the GCS score through a fixed slot `{gcsscore}` (11 to 15) and the term "score {gcsscore}". "Score 9." stays uncredited. | A 1-to-10 pain score can never reach 11 to 15, so "Pain score 7." still doesn't count (Plan 2 residual ruling). | "Score 3"–"Score 10" alone miss |
| D25 | Plan 2 final review M2: a sentence the line reads nothing for drops out of the route when it is a statement. An unread question keeps "Not sure what this is.", because it expected an answer. A line that reads nothing at all still says it once. | It ends "Not sure what this is." under notes-script sentences like "We are on our way.", and keeps the cue where a question went unanswered. | one rule |
| D26 | M1: replacing an open run from Run start, a debrief, a drill key or a notes drill link toasts "Run replaced." (or "Drill replaced."), with Undo for `UNDO_MS`. Undo lapses once the trainee says or taps anything in the new run. It does not lapse on the run screen's own writes, such as the lifecycle's resume. The Pause sheet's Restart (already confirmed) gives none. | §2: "a stray tap loses a run in progress". | one toast |
| D27 | M4: the composer's draft is kept in sessionStorage under `crewleader.draft.{runId}`, in try/catch. It is restored on mount and cleared on Send and at run end. | Android tab discards and reloads restore sessionStorage. | none |
| D28 | Parked 7: on `QuotaExceededError` the store keeps transcripts on only the newest 3 records (`RUN_LIMITS.transcriptsOnQuota`) and retries once, silently. If the retry fails, the existing save-error toast shows. The debrief's transcript note becomes general. | A rare path, so no new toast. The open run is never trimmed. | 7 older transcripts |
| D29 | Parked 5: while a run is open but the steps or cases failed to load, Today's and PAM's run row shows "A run is open, but the cases didn't load. …" with a Secondary "Try again". | The row was silent. Try again stays Secondary, so `todayPrimary` is unchanged. | none |
| D30 | **Publishing** (user, 2026-11-15; controller ruling, amended): to a **public** GitHub repo named `crew-leader`, deployed by the existing `deploy.yml` to GitHub Pages, **after Plan 3 is finished**, as a separate step the controller runs with the user. No task pushes or deploys. <br>**It publishes snapshots,** never a rewritten history. `tools/publish_history.py` works only in a temporary `--no-local --single-branch` clone of the branch `--rev` names (default `main`). There it builds **one commit** from that branch's current tree with `git commit-tree`. `sources/` is untracked there, so it isn't in that tree. <br>**The snapshot commit:** <br>- its author and committer name is the `--github-user` value; its email is the GitHub noreply address built from `--github-user` (and `--github-id` when given); <br>- its parent is `--parent <previously published sha>`, fetched from `--remote`, or none the first time, so later publishes stack as one commit each; <br>- the user's local history is never rewritten. <br>**Before it writes anything,** it copies `sources/` outside the repo, hash-verified. <br>**Before any push,** it scans the snapshot and refuses on any hit: <br>- personal markers read at runtime, never written down and masked in all output: every distinct author and committer email and name in the local history, `git config user.name`, and the OS username; <br>- any `sources/` path; <br>- any blob over 5 MB; <br>- any tracked path under a gitignored directory (`.superpowers/` first); <br>- a signed snapshot commit. <br>It also checks that the snapshot tree equals `--rev`'s tree, and that this repo's refs and working tree are untouched. It prints paths only relative to `--work`, and masks any marker in its output. <br>**The docs scrub:** Task 11 scrubs the hits that tracked docs hold now (the spec's "Owner:" line, Windows profile paths) in a normal commit. <br>**The dry run:** in a temporary clone of `plan-3-polish` (`--rev plan-3-polish`, since Plan 3 isn't merged yet), with a placeholder user. The real publish after the merge uses the default `main`. | User rulings: "publish a history without sources/", and everything in a public repo is public. A snapshot can't leak old commits' names, emails or doc text. The GitHub username is asked for at publish time, so it is a parameter. | GitHub shows one commit per publish, not the full history |
| D31 | The notes pass: each uncaptioned rhythm strip in s10 takes the bold numbered label above it as its alt text. The s01 continuation-line join is left out. | Plan 1 carry ("alt numbering", s10-3 to s10-9). The join is in Out of scope. | 7 alt strings |
| D32 | **Task order:** grader and data first (Tasks 1–3), then voice (4–5), history (6), the guards (7), the smart tester (8–9), the notes (10), publishing (11) and the end-to-end tests (12). Each small carried fix rides with the task that touches its code. | Content and grading settle before the UI that shows them, and each task's tests stand alone. | none |

### Flagged for the controller

- **D3:** the mic is tap-toggle, not the mockup's "Hold to speak". Ruled: accepted (ledger).
- **D19:** refusal fallbacks on the beta endpoint. Ruled: no server-side fallbacks (ledger). Every model uses `client.messages.create`, and a refusal falls back to the keyword reading; the D19 row says so.
- **D21:** the three new cases' clinical calls, notably Load & Go for the not-on-GTN AMI and for AMS. Ruled: accepted (ledger). They ship `reviewed: false` and are listed for the user's clinical check.
- **D24:** a lone "Score 15." credited through the 11–15 slot only. Ruled: accepted (ledger).
- **D25:** M2 drops unread statements from the route but keeps unread questions. Ruled: accepted (ledger).
- **Out of scope, item 2:** "Arm buddy, BP on the right arm please." said at step 14 still credits step 13's `bp-arm`, not the arm buddy's BP part. Ruled: accepted (ledger).
- **D30:** the commits' author names, the spec's "Owner:" line and the Windows profile paths in tracked docs name the user. Ruled: amended (ledger):
  - publish as snapshots, not a rewritten history;
  - every personal marker the tool reads at runtime refuses the publish;
  - Task 11 scrubs the "Owner:" line and the profile paths from tracked files in a normal commit.

  The D30 row and Task 11 say so.

## Carries Plan 3 owns

| Carry (source) | Lands in |
|---|---|
| S10/R2: run history as strip thumbnails (Plan 2 ledger l. 130) | Task 6 (D10, D11) |
| Carry (c): soft sentence breaks for a whole unpunctuated Web Speech line (ledger l. 261, 276) | Task 4 (D7) |
| R13: voice waits for Plan 3 (Run start copy, the composer's right-hand slot) | Task 5 |
| Plan 1 ruling 2026-11-13: Web Speech for voice input | Task 5 |
| M1: Undo on replacing an open run (final review) | Task 7 (D26) |
| M2: unread sentences in the route (final review) | Task 1 (D25) |
| M4: persist the composer draft (final review) | Task 7 (D27) |
| Parked 3: per-case `{limbWhere}` slot | Task 3 (D22) |
| Parked 5: "the cases didn't load, Try again" row | Task 7 (D29) |
| Parked 7: quota trim and retry | Task 7 (D28) |
| "Pain score" credits severity (final-fix-review concern 3; residual ruling) | Task 1 |
| `check: 'arm'`: a ruled-out arm is Wrong, plus the wider bp-arm lenient paths (concern 4; out-of-scope observation) | Task 2 (D23); the step-14 buddy path is Out of scope, item 2 |
| Residuals: "GCS done. Score 15." and race-first "Chinese/F/72" (ledger l. 560) | Task 1 (D24) |
| Tokenise `#151b1d` and `#171e20` (concern 6) | Task 6 |
| Task 10 P5: the `arrived` comments disagree with `arrivedIn` ("current 3 on" against `current > 3`) | Task 1 |
| Task 10 P1–P4, out-of-scope 1–3 | Out of scope, item 1 |
| The grader seam "designed so the later Claude API tester can replace the matcher" (spec §6.2) | Tasks 8–9 |
| Plan 1 carry: the remaining notes alt-number fix (Plan 2's "Carries" table) | Task 10 (D31) |
| User rulings: publish without `sources/`, keeping a copy outside the repo first (merge incident); a public repo `crew-leader` (2026-11-15). Controller ruling: snapshot commits with the GitHub noreply identity, a scan for personal markers before any push, and tracked docs scrubbed of the owner's name and profile paths | Task 11 (D30) |
| Phone-only checks (TalkBack, keyboard-up, real Back, Install group, clock under TalkBack, haptics), plus Plan 3's mic, smart tester and history | Ledger list for the user, written in Task 12 |

## Out of scope

1. **Task 10 P1–P4 and out-of-scope 1–3** (arrival edge cases on the phone). Each compounds an omission the trainee already made, or is a lenient credit (final review parked 2). The arrival rules are pinned by a sweep of 1280 combinations. The smart tester can't change them, because it never re-reads a read or dropped sentence (D12).
2. **"Arm buddy, BP on the right arm please." at step 14,** with `bp-arm` still pending. One sentence goes to one step by design. Either choice leaves one fault: Order on `bp-arm` now, or Missed on `bp-arm` if the buddy step took it. Fixing it means an addressee-aware back pass in the hardened `pick()`. The tester's BP reply is the trainee's cue, Coached nudges, and disputes cover it.
3. **"GCS 30" and "GCS 4 5 6" crediting the score:** rare lenient credits, and the tile already refuses them (final-fix-review concern 2).
4. **Re-reading sentences the keyword grader did read,** for false credits or Phrase. D12 keeps those keyword-only. The medical-case phone question "Is there any bleeding?" (ledger l. 362) stays ruled.
5. **The unconscious branch.** Spec §11 leaves it to "a later phase", and §10's polish list doesn't name it.
6. **The s01 continuation-line join** ("Do you feel any pain at your neck?"). The docx itself starts a new paragraph there, the text is intact, and re-flowing s01 risks the anchors that steps' `notesRef` and the drill chips point at.
7. **Mode chip icons.** The final review found them not needed.
8. **Building the real snapshot (with the user's GitHub username), creating the `crew-leader` repo, pushing and deploying.** The user ruled these a separate step after Plan 3, which the controller runs with the user (spec §10: the first deploy needs the user's go-ahead). Task 11 stops at a verified dry run with a placeholder user.
9. **iPhone-specific voice or keyboard work:** the Android-first ruling.
10. **The ruled spec deviations,** listed for the user and not reopened: Drill the fixes per step, the clock starting at the first timed step, Wrong in the fix list, the drill discard copy, and the Install line.

---

## File structure

```
src/
  sim/    grader.ts      SentenceReading gains question, arm, smart; PATIENT_WORDS exported; the arrived comment (P5)  [T1, T2, T4, T8]
          match.ts       {gcsscore} fixed slot (11–15)                                                                [T1]
          oxygen.ts      readArm, armAt                                                                               [T2]
          classify.ts    'arm' in UNNAMED_DETAIL and wrongDetail                                                      [T2]
          run.ts         an unread statement's route piece; the arm choice; ChatLine.smart; RunRecord.smartLines      [T1, T2, T8]
          replies.ts     canonical slot limbWhere                                                                     [T3]
          softBreaks.ts  sentence breaks for a dictated line; appendHeard                                             [T4]
          smart.ts       the smart grader: candidates, facts, maskCase, request, merge, cache, cap, timeout          [T8]
  data/   schema.ts      MATCH_SLOTS gcsscore; check 'arm'; limb.where; says may hold canonical slots; stayAndTreat, loadAndGo [T1, T2, T3]
  progress/ types.ts     settings.answerBy; ChatLine.smart; RunRecord.smartLines; RUN_LIMITS.transcriptsOnQuota; trimTranscripts  [T5, T7, T8]
          slots.ts store.ts   a quota failure is flagged; trim and retry once                                         [T7]
  voice/  speech.ts      the Web Speech wrapper                                                                       [T5]
  run/    useVoice.ts Composer.tsx RunStart.tsx Run.tsx   the mic, Answer by, hold, the composer status line   [T5]
          Composer.tsx start.ts useRunLifecycle.ts Debrief.tsx   draft; replace with Undo; transcript note           [T7]
          useSendQueue.ts Chat.tsx useRun.ts Debrief.tsx   pending lines; the smart tag; the run's grader; smart note  [T9]
  today/  discard.ts RunResume.tsx   replaceOpenRun; the content-failed row                                            [T7]
  pam/    PamTab.tsx RunHistory.tsx                                                                                    [T6]
  ui/     RunStrip.tsx   MiniStrip                                                                                    [T6]
          Icon.tsx       'mic'                                                                                        [T5]
  smart/  settings.ts    the smart tester's storage (crewleader.smart), models and prices, spend                      [T9]
          claude.ts      the Claude transport, Test key, graderFor (the only importer of @anthropic-ai/sdk)           [T9]
  settings/ Settings.tsx the Smart tester group                                                                       [T9]
  styles/ tokens.css components.css                                                                                   [T5, T6, T7, T9]
public/data/ steps.json  cases/*.json (11)  cases/index.json  notes.json                                              [T1–T3, T10]
tools/  import_notes.py  rhythm strip alts                                                                            [T10]
        publish_history.py                                                                                            [T11]
docs/   publishing.md                                                                                                 [T11]
        superpowers/specs/2026-11-09-crew-leader-design.md and any tracked file the scan finds   no owner name, no profile paths  [T11]
.github/workflows/deploy.yml   the header points at docs/publishing.md                                                [T11]
tests/  unit/ (each task's files)  py/test_import_notes.py py/test_publish_history.py
        e2e/voice.spec.ts smart.spec.ts screens.spec.ts seed.ts; playwright.config.ts                                 [T12]
```

---

### Task 1: Grader carries: pain score, a lone "Score 15.", race-first SRACIE, unread statements in the route

**Files:**
- Modify:
  - `public/data/steps.json`: `vital-signs/severity`, the `vital-signs/gcs` `score` part, the `notification/sracie` `sex` part, and `contentVersion`;
  - `src/data/schema.ts` (`MATCH_SLOTS`) and `src/sim/match.ts` (`FIXED_SLOTS`, `caseSlots`);
  - `src/sim/grader.ts` (`SentenceReading.question`, `readSentence`, and the `arrived` comment at line 14);
  - `src/sim/run.ts` (`applySentence`'s piece for a sentence that reads nothing).
- Test:
  - `tests/unit/paraphrases.ts` (fixtures);
  - `tests/unit/run-engine.test.ts` and `tests/unit/match.test.ts` (append);
  - `tests/unit/data-integrity.test.ts` (the `contentVersion` pin).

**Interfaces:**
- Consumes: `readSentence`, `isQuestion` (private in `grader.ts`), `routeOf`, `NOT_UNDERSTOOD`, `UNCLEAR`, `caseSlots`, `MATCH_SLOTS`, `FIXED_SLOTS`.
- Produces:
```ts
// src/data/schema.ts
export const MATCH_SLOTS = [...existing, 'gcsscore'] as const;   // '11'…'15', the same for every case
// src/sim/grader.ts
export interface SentenceReading { /* existing fields */ question?: true }   // set when isQuestion(text, rest)
// src/sim/run.ts: applySentence returns, for a sentence whose points map to nothing:
//   NOT_UNDERSTOOD when sen.question === true, else '' (routeOf still gives NOT_UNDERSTOOD when every piece is '')
```

**Data edits:**
- **`severity`:** gains the alternative `["pain score"]`.
- **The GCS `score` part:** gains `["score {gcsscore}"]`.
- **The SRACIE `sex` part** gains race-first forms, mirroring the existing sex-first forms. For each letter `f` and `m`: `["{raceword}/f"]`, `["{raceword} / f"]`, `["{raceword}, f"]`, `["{raceword},f"]` and `["{raceword} f"]`.
- **The P5 comment:** `grader.ts`'s `arrived` comment says "(current 3 on)". It becomes "(current 4 on, or a preparation point done)", as `arrivedIn` and `onScene` read.

- [ ] **Step 1: Write the failing tests**

`tests/unit/paraphrases.ts`, a new group "Plan 3 Task 1":
```ts
{ at: 'vital-signs', line: 'Pain score?', hits: ['vital-signs/severity'], not: ['vital-signs/gcs.score'], why: 'Plan 3 T1: "pain score" asks the severity' },
{ at: 'vital-signs', line: 'GCS 15. Pain score?', hits: ['vital-signs/gcs.score', 'vital-signs/severity'], why: 'Plan 3 T1' },
{ at: 'vital-signs', line: 'GCS done. Score 15.', hits: ['vital-signs/gcs.score'], why: 'Plan 3 T1 (D24): a lone score of 11 to 15' },
{ at: 'vital-signs', line: 'Score 14.', hits: ['vital-signs/gcs.score'], why: 'Plan 3 T1 (D24)' },
{ at: 'vital-signs', line: 'Score 9.', not: ['vital-signs/gcs.score'], why: 'Plan 3 T1 (D24): 3 to 10 could be a pain score' },
{ at: 'vital-signs', line: 'Pain score 7.', not: ['vital-signs/gcs.score'], why: 'residual ruling kept' },
{ at: 'notification', line: 'Unstable case of Chinese/F/72, case of COPD.', hits: ['notification/sracie.sex', 'notification/sracie.race'],
  why: 'Plan 3 T1: race first' },
{ at: 'notification', case: CHEST, line: 'Malay, M, 58, chest pain.', hits: ['notification/sracie.sex'], why: 'Plan 3 T1: race first, commas' },
{ at: 'scene-evaluation', line: 'He fell about 6 m, hit his head.', not: ['notification/sracie.sex'], why: 'residual N2 kept' },
```
`tests/unit/run-engine.test.ts`:
- **The canonical call, as the notes give it, at step 2 of COPD.** The line is "Hi, I am calling from 995 FMV. My name is EMT XXX. We are on our way to your place now. Can I confirm your address / location?". Its route is exactly "To caller: caller intro · To caller: location". Today it is "To caller: caller intro · Not sure what this is. · To caller: location" (pre-flight scan).
- **"Is he conscious? Is the sky blue?" at step 2 of COPD:** the route is exactly "To caller: conscious? · Not sure what this is.". Sentence 1 reads `call-caller/conscious`, and the unread question keeps its piece.
- **"The weather is nice today." alone at step 6:** the route is exactly "Not sure what this is.".
- **"Sir, can you hear me? Nice weather today." at step 7:** the route equals the route of "Sir, can you hear me?" sent alone at step 7 of a fresh copy of the same session. The unread statement adds no piece.

`tests/unit/match.test.ts`:
- `caseSlots(caseById('copd-amk-01'), 6).gcsscore` equals `['11', '12', '13', '14', '15']`.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/unit/paraphrases.test.ts tests/unit/run-engine.test.ts tests/unit/match.test.ts`
Expected: FAIL. The slot, the terms and the route rule are missing.

- [ ] **Step 3: Implement the slot, the data edits, `question` and the route rule.** Then set `contentVersion` to `'2026-11-15.2'` and its pin to match.

- [ ] **Step 4: Run the whole suite**

Run: `npx vitest run && npm run typecheck`
Expected: all PASS, with the canonical typed and tapped sweeps still at 0 faults.

Some Plan 2 tests assert a route containing " · Not sure what this is." after an unread statement. Update each to the new rule, and name it in the report.

- [ ] **Step 5: Commit**

```bash
git add public/data/steps.json src/data/schema.ts src/sim tests/unit
git commit -m "fix(grading): pain score asks severity, a lone score of 11-15 is the GCS, race-first SRACIE, unread statements leave the route" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: BP arm: a ruled-out arm is Wrong, and tighter arm terms

**Files:**
- Modify:
  - `src/data/schema.ts` (`MustHit.check`);
  - `src/sim/oxygen.ts` (`readArm`, `armAt`) and `src/sim/grader.ts` (`checkAt`, `SentenceReading.arm`);
  - `src/sim/run.ts` (`LineChoice.arm`, `lineFacts`, `Turn.apply`, `Turn.grade`, `shortOf`, `WRONG_TEXT.arm`);
  - `src/sim/classify.ts` (`UNNAMED_DETAIL.arm`, `wrongDetail` for `'arm'`);
  - `public/data/steps.json` (`investigation/bp-arm`, and `contentVersion`).
- Test:
  - `tests/unit/paraphrases.ts` (fixtures; its two "not" fixtures for CCF left and bleed right become run-engine Wrong tests);
  - `tests/unit/run-engine.test.ts`, `tests/unit/classify.test.ts` and `tests/unit/oxygen.test.ts` (append);
  - `tests/unit/data-integrity.test.ts` (the `contentVersion` pin).

**Interfaces:**
- Consumes: `bpArm` and `bpArmRestricted` (`findings.investigation`), `caseSlots`' `bparm`, `termAt`, `isQuestion` (private in `grader.ts`), `Checked`, `LineChoice`, `wrongDetail`.
- Produces:
```ts
// src/data/schema.ts
check?: 'oxygen' | 'ecg' | 'arm'
// src/sim/oxygen.ts
export function readArm(text: string): 'left' | 'right' | null    // the first arm named, as "{side} arm" or "bp / blood pressure on (the|her|his)? {side}"
export function armAt(text: string): number                        // where readArm's arm is named, or -1
// src/sim/grader.ts
export interface SentenceReading { /* … */ arm?: 'left' | 'right' | null }   // readArm(rest)
// checkAt for check 'arm': -1 in a question (isQuestion: a named arm in a question is no choice, D23); otherwise armAt(text)
//   when the sentence says "bp" or "blood pressure", or the point's step is the run's step; else -1.
//   readSentence passes the sentence's isQuestion result down through readPoint to checkAt.
// src/sim/run.ts
// grade(): arm null → 'unnamed'; the arm in caseSlots(c).bparm → 'right'; else 'wrong'; chose `${arm} arm`
// WRONG_TEXT.arm = 'Not on that arm. The patient ruled it out.'
// src/sim/classify.ts
// wrongDetail('arm', chose, c) = `Chose the ${chose}. The patient ruled that arm out, so the BP goes on the ${bpArm} arm.`
// UNNAMED_DETAIL.arm = 'Say which arm the BP goes on.'
```

**`bp-arm` data:**
- `"check": "arm"`.
- `match`: `[["bp on the {bparm}"],["bp on her {bparm}"],["bp on his {bparm}"],["bp on {bparm}"],["blood pressure on the {bparm}"],["blood pressure on her {bparm}"],["blood pressure on his {bparm}"],["blood pressure on {bparm}"],["bp","{bparm} arm"],["blood pressure","{bparm} arm"]]`.
- `local`: `[["{bparm} arm"]]`, so "OK, left arm then." counts only on step 13.
- The canonical line's "Taking the BP on the {bpArm} arm." still reads.

- [ ] **Step 1: Write the failing tests**

`tests/unit/oxygen.test.ts`:

| Call | Returns |
|---|---|
| `readArm('taking the bp on the left arm')` | `'left'` |
| `readArm('bp on her right')` | `'right'` |
| `readArm('auscultating on the right apex and left apex, then bp')` | `null` |
| `readArm('right arm no injuries')` | `'right'` (the context rule lives in `checkAt`) |

`tests/unit/paraphrases.ts`:
```ts
{ at: 'rapid-body-survey', line: 'Right arm no injuries.', not: ['investigation/bp-arm'], why: 'Plan 3 T2 (D23): no BP, not its step' },
{ at: 'investigation', line: 'Auscultating on the right apex and left apex, then BP.', not: ['investigation/bp-arm'], why: 'Plan 3 T2 (D23)' },
{ at: 'investigation', line: 'OK, left arm then.', hits: ['investigation/bp-arm'], why: 'Plan 3 T2: local on step 13' },
{ at: 'investigation', line: 'Taking BP on the right arm.', hits: ['investigation/bp-arm'], noFault: CLEAN, why: 'I2 kept, COPD' },
{ at: 'investigation', case: CCF, line: 'Any shunt or fistula on your left arm?', not: ['investigation/bp-arm'], noFault: CLEAN,
  why: 'Plan 3 T2 (D23): an arm in a question is no choice, so no Wrong' },
```
`tests/unit/run-engine.test.ts`:
- **CCF, at step 13** with every earlier step done: "Taking the BP on the left arm."
  - reads `investigation/bp-arm` with `check: 'wrong'` and `chose: 'left arm'`;
  - Coached gives an inline flag of kind `'wrong'` with the text "Not on that arm. The patient ruled it out.";
  - `endRun` has a Wrong fault on `investigation/bp-arm`, whose detail is "Chose the left arm. The patient ruled that arm out, so the BP goes on the right arm.".
- **Bleed:** "BP on his right." gives Wrong in the same way.
- **COPD:** "Taking BP on the right arm." gives `check: 'right'` and no fault.
- **The tapped sweep:** a tapped step 13 records `check: 'right'` in all 11 cases (after Task 3), or all 8 now.

`tests/unit/classify.test.ts`:
- A record whose `bp-arm` hit has `check: 'wrong'` classifies as `'wrong'`, sorted with Missed.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/unit/oxygen.test.ts tests/unit/paraphrases.test.ts tests/unit/run-engine.test.ts tests/unit/classify.test.ts`
Expected: FAIL. There is no `'arm'` check yet.

- [ ] **Step 3: Implement it.** Follow the oxygen and ECG pattern at every site that switches on `check`: `checkAt`, `apply` (the arm puts nothing on the patient), `grade`, `lineFacts`, `shortOf` ("BP arm, {side} arm") and classify. Set `contentVersion` to `'2026-11-15.3'` and its pin to match.

- [ ] **Step 4: Run the whole suite**

Run: `npx vitest run && npm run typecheck`
Expected: all PASS, with the sweeps at 0 faults.

- [ ] **Step 5: Commit**

```bash
git add public/data/steps.json src tests/unit
git commit -m "feat(grading): a ruled-out BP arm is Wrong; arm terms need BP or step 13" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `{limbWhere}` and three more cases

**Files:**
- Create:
  - `public/data/cases/ams-sengkang-01.json`;
  - `public/data/cases/toothache-clementi-01.json`;
  - `public/data/cases/legbleed-punggol-01.json`.
- Modify:
  - `src/data/schema.ts`:
    - `findings.rbs.limb.where`;
    - `CANONICAL_SLOTS` gains `'limbWhere'`;
    - the say check allows `{` + a `CANONICAL_SLOTS` name + `}`;
    - `CONDITIONS` gains `'stayAndTreat'` and `'loadAndGo'`, and `conditionHolds` reads them;
  - `src/sim/replies.ts` (`canonicalValues`: `limbWhere` = `c.findings.rbs.limb?.where ?? ''`);
  - `public/data/steps.json`:
    - the `immobilise` say becomes "Buddy, immobilise the {limbWhere}.";
    - `decision-point/stay-and-treat` gets `"when": "stayAndTreat"` (was `"medical"`);
    - `decision-point/load-and-go` gets `"when": "loadAndGo"` (was `"trauma"`);
    - `contentVersion` becomes `'2026-11-15.4'`.

    The point ids are unchanged, so this is no rename.
  - `public/data/cases/rta-toapayoh-01.json` (`limb.where`: "right leg"; keep it, since "right lower leg" would make the RTA step 12 line 604 characters, over the limit);
  - `public/data/cases/index.json`: 11 entries, the three new ones last, in the order above.
- Test:
  - `tests/unit/data-integrity.test.ts` and `tests/unit/schema.test.ts` (modify);
  - `tests/unit/replies.test.ts` (append);
  - `tests/unit/paraphrases.test.ts` (modify: both say tests use the filled say);
  - `tests/unit/paraphrases.ts` (append: the decision fixtures).

**Interfaces:**
- Consumes: Plan 2's Case shape; `conditionHolds`; `CONDITIONS`; `fillCanonical`; `splitSentences`; the notes (s01, s05, s11, s15, s17).
- Produces:
  - **The 11-case library.** Run start's complaint chips, in index order: Breathlessness, Giddiness, Chest pain, Bleeding, Fall, Road accident, Confusion, Toothache.
  - **The schema change:** `findings.rbs.limb` is `{ injury: string; where: string; distalPulse: string; immobilise: string }`, where `where` is "right leg" or "left leg".
  - **The plan conditions:** their source is the existing field `expected.decision.plan`, with no new case field, because the plan is already the case's own decision and `decisionLine` reads it.
```ts
// src/data/schema.ts
export const CONDITIONS = [...CASE_FLAGS, 'medical', 'trauma', 'noSpinal', 'neckPain', 'catastrophicBleeding', 'positionNotIdeal',
  'stayAndTreat', 'loadAndGo'] as const;
// conditionHolds: case 'stayAndTreat': return c.expected.decision.plan === 'stay-and-treat';
//                 case 'loadAndGo':    return c.expected.decision.plan === 'load-and-go';
```
  For the 8 existing cases, `stayAndTreat` holds exactly where `medical` did (COPD, hypo, chest pain, CCF, asthma), and `loadAndGo` exactly where `trauma` did (bleed, fall, RTA). So every one of them grades as now. AMS and the toothache AMI read Load & Go.

**Shared rules:** Plan 2 Task 3's still apply.
- Room-air vitals equal after-O2 vitals, except SpO2.
- Callers speak casual Singapore English and use only the case's facts.
- Patients have all 11 `lines` keys, in their voice, plus `convinced` where the position isn't ideal.
- No case shows impending respiratory failure, and each patient's `voice` says "full sentences".
- Fields a block doesn't name take Plan 2's plain normal findings.
- `bpScreen` is "No shunt, no fistula. Never had operation." in the patient's voice.
- No `bpArmRestricted`.

**The three cases:** each fact is from the notes section named.
1. **`ams-sengkang-01`** (medical; complaint "Confusion"; Sengkang). Notes s05 #1 (Altered Mental State, Load & Go); s15 (hypocount 4–10 is normal, and AMS is a reason to measure it); s11 (SpO2 > 95%: nasal cannula optional).
   - **Call:** callText "Elderly female, confused since this morning"; location "Blk 2xx Compassvale St, #08-xx"; the caller is her son.
   - **Patient:** Siti binte Hassan, Malay female, 79; ic `S47xxxxxE`; callName "Mdm Siti".
     - Her voice: "Speaks in full sentences, slowly, but loses track of where she is and repeats questions."
     - `verbal`: her name right, the place wrong.
   - **Story:** her son found her confused this morning. No fall, no head strike. She has high BP and takes her medicine.
   - **Findings:**
     - `loc` A, "Yes, I can hear you... who are you ah?";
     - history "No asthma or COPD" and "High BP";
     - pulse "Radial pulse present, fast and strong";
     - BP "176/98 mmHg", left arm;
     - ECG 4-lead "Sinus tachycardia about 106" (s01: not lung or heart, so 4-lead);
     - hypocount 6.1; GCS 4/4/6; severity "3".
   - **Vitals:** room air SpO2 96, PR 106, RR 22, BP 174/96, temp 36.8, skin "warm, dry", CRT "under 2 s". After O2, SpO2 97.
   - **Position:** "Sitting on the bed", ideal true.
   - **Expected:**
     - oxygen nasal cannula 2–4, `optional: true`;
     - ECG 4-lead;
     - signs ["low GCS", "high HR", "high RR"];
     - suspected "altered mental state", load-and-go.
   - **Flags:** []. **notesRef:** `s05#1-altered-mental-state-load-go`.
2. **`toothache-clementi-01`** (medical; complaint "Toothache"; Clementi). Notes s17 (AMI; the Real case; Managing Chest Pain: high-flow O2, never withhold O2, "unstable – transport early unless using the chest pain protocol"); s05 #6 (the protocol needs the patient to be on GTN); s01 (12-lead for pain suggestive of cardiac origin).
   - **Call:** callText "Elderly male, toothache and cold sweat"; location "Blk 3xx Clementi Ave 2, #06-xx"; the caller is his wife.
   - **Patient:** Koh Ah Seng, Chinese male, 63; ic `S63xxxxxG`; callName "Mr Koh".
     - Voice: "Pale and sweaty, speaks in full sentences, rubs his jaw."
     - chiefComplaint: "My tooth very pain, here at the jaw. Now my left arm also pain."
   - **Story:** pain for 40 minutes while resting. He has no heart history and isn't prescribed GTN.
   - **Scene:** living room. Items: a cup of tea. Hazards: "hot tea on the table beside the patient".
   - **Findings:**
     - history "No asthma or COPD" and "High cholesterol";
     - gloves "A lot of sweat"; pockets ["IC"];
     - BP "146/90 mmHg", left arm;
     - ECG 12-lead "Sinus tachycardia about 104, ST elevation in V2 to V4";
     - hypocount 5.9; GCS 4/5/6; severity "7".
   - **Vitals:** room air SpO2 94, PR 104, RR 22, BP 144/88, temp 36.6, skin "pale, cold, clammy", CRT "under 2 s". After O2, SpO2 98.
   - **Position:** "Sitting on the sofa", ideal true.
   - **Expected:**
     - non-rebreather 10–15;
     - ECG 12-lead;
     - signs ["low SpO2", "high HR", "ST elevation"];
     - suspected "AMI", load-and-go;
     - `expected.oxygen.note`: "A chest pain patient gets high-flow oxygen: a non-rebreather at 10 to 15 L/min. Never withhold oxygen (notes 17).".
   - **Flags:** []. **notesRef:** `s17#acute-myocardial-infarction-ami`.
3. **`legbleed-punggol-01`** (trauma; complaint "Bleeding"; Punggol). Notes s05 #2 (Arresting Haemorrhage, Load & Go); s01 (Approach bleeding control; Immobilization; Position supine for low BP); s11 (all trauma gets high-flow O2).
   - **Call:** callText "Adult male, fall with a deep leg wound, heavy bleeding"; location "Blk 6xx Punggol Field, void deck"; the caller is his co-worker.
     - criticalInjuries: "His leg got a big cut, the blood keep coming out, and the leg look bent."
   - **Patient:** Lee Wei Jie, Chinese male, 38; ic `S88xxxxxH`; callName "Mr Lee".
     - Voice: "In pain and frightened, pale, speaks in full sentences."
   - **Story:** he fell about 2 m from a painting platform at the void deck. He landed on his left leg on the edge of a metal paint tray. He didn't hit his head.
   - **Scene:** void deck, with blood on the floor. Items: ladder, paint tray. Hazards: "fallen ladder beside the patient".
   - **Findings:**
     - `catastrophicBleeding` true, with bleeding "Yes: heavy bleeding from a deep cut on the left lower leg.";
     - `control`: pressure "Still bleeding.", dressing "Blood soaking through the dressing.", cat "Bleeding has stopped.";
     - spine: fall "Yes, from the platform"; hitHead "No"; `neckPain` false;
     - pulse "Radial pulse present, fast and weak";
     - RBS "Deep cut and deformity of the left lower leg, bleeding controlled; no other injuries";
     - gloves "A lot of blood"; pockets ["IC"];
     - `limb`: injury "Left lower leg, deformed, with a deep cut"; where "left leg"; distalPulse "Distal pulse present in the left foot."; immobilise "Buddy splints the left leg as instructed.";
     - BP "86/56 mmHg", left arm;
     - ECG 4-lead "Sinus tachycardia about 118";
     - hypocount 6.2; GCS 4/5/6; severity "9".
   - **Vitals:** room air SpO2 95, PR 118, RR 24, BP 84/54, temp 36.4, skin "pale, cold, clammy", CRT "over 2 s". After O2, SpO2 99.
   - **Position:** "Sitting on the floor against the pillar", ideal false, toward supine; `convinced` "OK... I lie down flat.".
   - **Expected:**
     - non-rebreather 10–15;
     - ECG 4-lead;
     - signs ["low BP", "high HR"];
     - suspected "arresting haemorrhage", load-and-go.
   - **Flags:** ["limbInjury"]. **notesRef:** `s05#2-arresting-haemorrhage-load-go`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/data-integrity.test.ts`:
- **`ALL`:** append `'ams-sengkang-01'`, `'toothache-clementi-01'` and `'legbleed-punggol-01'`. The index test expects `Object.keys(CASE_FILES).length` to be 11.
- **The complaint chips test** expects `['Breathlessness', 'Giddiness', 'Chest pain', 'Bleeding', 'Fall', 'Road accident', 'Confusion', 'Toothache']`.
- **New test** "the three Plan 3 cases keep their plan values":

| Case | Asserted values |
|---|---|
| AMS | hypocount 6.1; GCS `{ e: 4, v: 4, m: 6 }`; plan load-and-go; oxygen `{ device: 'nasal-cannula', flowMin: 2, flowMax: 4, optional: true }`; ECG 4-lead |
| Toothache | complaint "Toothache"; ECG 12-lead; plan load-and-go; history "No asthma or COPD" and "High cholesterol"; SpO2 94 → 98 |
| Leg bleed | `catastrophicBleeding` true; `flags` `['limbInjury']`; `limb.where` "left leg"; plan load-and-go; BP systolic under 90 in all three BP values |

- **The RTA limb:** `limb.where` is "right leg".
- **The plan conditions:**
  - for each of the 8 existing cases, `conditionHolds(c, 'stayAndTreat') === conditionHolds(c, 'medical')` and `conditionHolds(c, 'loadAndGo') === conditionHolds(c, 'trauma')`;
  - for every case, `stayAndTreat` and `loadAndGo` don't both hold;
  - in `steps.json`, `decision-point/stay-and-treat`'s `when` is `'stayAndTreat'` and `load-and-go`'s is `'loadAndGo'`.

`tests/unit/paraphrases.ts`, appended:
```ts
{ at: 'decision-point', case: 'ams-sengkang-01', line: 'It is a Load & Go case.', hits: ['decision-point/load-and-go'],
  not: ['decision-point/stay-and-treat'], why: 'Plan 3 T3: a medical Load & Go (plan conditions)' },
{ at: 'decision-point', case: 'toothache-clementi-01', line: 'It is a Load & Go case.', hits: ['decision-point/load-and-go'],
  not: ['decision-point/stay-and-treat'], why: 'Plan 3 T3: not on GTN, so Load & Go' },
{ at: 'decision-point', line: 'So, I will Stay & Treat to see whether I can initiate any protocols.', hits: ['decision-point/stay-and-treat'],
  why: 'Plan 3 T3: COPD unchanged' },
```
`tests/unit/paraphrases.test.ts`: the tests "the says change nothing the rest of the line reads, sentence by sentence" and "each say, said alone…" build each say as `fillCanonical(m.say!, c, 6, s.mustHit)` before `splitSentences` or `interpret`, so a say holding `{limbWhere}` matches the filled line.

`tests/unit/schema.test.ts`:
- a say holding `'{limbWhere}'` passes;
- a say holding `'{name}'` fails;
- a `limb` without `where` fails.

`tests/unit/replies.test.ts`:
- `fillCanonical` of step 12 for RTA contains "Buddy, immobilise the right leg.";
- for the leg bleed it contains "Buddy, immobilise the left leg.";
- for COPD it contains neither sentence.

The existing tests then cover all 11 cases:
- every case unstable, masked and unreviewed;
- conditional content exactly where its condition holds;
- no impending respiratory failure (`NEW = ALL.slice(2)`);
- the canonical read sweep (`paraphrases.test.ts`) and the reply sweep;
- every filled canonical line within 600 characters;
- the run-engine and drill sweeps over `CASES`.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/unit/data-integrity.test.ts tests/unit/schema.test.ts tests/unit/replies.test.ts`
Expected: FAIL. The index lists 8 cases.

- [ ] **Step 3: Implement the schema, the slot and the plan conditions, then write the three case files and the index** from the blocks above. Set `contentVersion` to `'2026-11-15.4'` and its pin to match.

- [ ] **Step 4: Run the whole suite**

Run: `npx vitest run && npm run typecheck`
Expected:
- all PASS;
- the canonical typed and tapped sweeps at 0 faults in all 11 cases;
- the reply sweep green;
- for the 8 existing cases, the typed and tapped sweeps' faults and routes identical to before the task. Dump both sweeps before and after, and `cmp` them, as the Plan 2 final fix did;
- the RTA step 12 line at 598 characters or fewer.

If a sweep's own timeout is hit, raise that file's timeout, and say so in the report.

- [ ] **Step 5: Commit, and list the three cases' clinical facts in the ledger** for the user's check, as Plan 2 did for its six. The list includes these calls:
- the two medical Load & Go decisions;
- the leg bleed's 2 m fall with `neckPain` false and no `spinal` flag. Its `noSpinal` points apply: the head-tilt chin-lift and releasing the head grip.

```bash
git add public/data src/data/schema.ts src/sim/replies.ts tests/unit
git commit -m "feat(data): three more cases (AMS, toothache AMI, leg bleed with a limb injury); {limbWhere} in the immobilise say" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Soft sentence breaks for dictated lines

**Files:**
- Create: `src/sim/softBreaks.ts`, `tests/unit/soft-breaks.test.ts`
- Modify:
  - `src/sim/grader.ts` (export `PATIENT_WORDS`);
  - `tests/unit/sim-helpers.ts` and `tests/unit/paraphrases.test.ts` (`readOf` moves);
  - `public/data/steps.json` and `tests/unit/data-integrity.test.ts`, only if a comma-free term is needed (Step 3).

**Interfaces:**
- Consumes: `PATIENT_WORDS`, `keywordGrader`, `fillCanonical`, `ctxAt`, and `CASES` and `STEPS` (`sim-helpers`); `RUN_LIMITS.lineChars`.
- Produces:
```ts
// src/sim/softBreaks.ts
export const BREAK_ADDRESSEES: readonly string[]   // 'arm buddy','head buddy','buddy','ops ctr','ops centre','ops center','crew','tester','caller', ...PATIENT_WORDS
export const STEP_OPENERS: readonly string[]       // starts as: 'may i','can you','could you','do you','did you','are you','is there','are there',
                                                   // 'does the','fmv 123','please allow',"i'm going",'i am going','checking','taking','patient is'
                                                   // ('does the' and 'fmv 123' fix the notification step in all 8 cases, pre-flight prototype)
export function softBreaks(transcript: string, callName: string): string
export function appendHeard(field: string, heard: string, callName: string, max: number = RUN_LIMITS.lineChars): string
```
**`softBreaks`'s rule** (D7):
1. **Already punctuated:** a transcript holding `.`, `?` or `!` is returned trimmed, otherwise unchanged.
2. **Cues:** a break goes before word `i ≥ 1` when the words from `i` start a cue. A cue is a `BREAK_ADDRESSEES` phrase, the last word of `callName`, or a `STEP_OPENERS` phrase.
3. **Not right after certain words:** word `i − 1` is none of these:
   - an addressee word: the last word of a `BREAK_ADDRESSEES` phrase, or the last word of `callName`;
   - a filler: `ok`, `okay`, `and`, `also`, `so`;
   - one of `my`, `your`, `our`, `his`, `her`, `the`, `a`, `an`, `to`, `with`, `for`, `of`, `on`, `at`, `by`.
4. **Spacing:** at least 2 words follow the previous break.
5. **Matching:** the longest cue at a word wins, and the words inside it are not tried again.
6. **Output:** each piece gets a capital first letter and ends with ".".

**`appendHeard(field, heard)`:**
- the field empty: `softBreaks(heard)`;
- the field ending in `.`, `?` or `!`: the field, a space, then the soft-broken text;
- otherwise: the field, ". ", then the soft-broken text.

Either way it is cut to `max` characters.

- [ ] **Step 1: Write the failing tests** in `tests/unit/soft-breaks.test.ts`.

| Call | Result |
|---|---|
| `softBreaks('buddy do a head grip sir what is bothering you', 'Mdm Tan')` | `'Buddy do a head grip. Sir what is bothering you.'` |
| `softBreaks('sir can you hear me', 'Mdm Tan')` | `'Sir can you hear me.'` (never right after an addressee) |
| `softBreaks('my buddy will do a head grip on you please allow him', 'Mdm Tan')` | `'My buddy will do a head grip on you. Please allow him.'` |
| `softBreaks('mdm tan can you hear me', 'Mdm Tan')` | `'Mdm tan can you hear me.'` |
| `softBreaks('Is there any bleeding? any hazards', 'Mdm Tan')` | unchanged |
| `softBreaks('  ', 'Mdm Tan')` | `''` |
| `appendHeard('Ops Ctr, roger', 'responding to blk 2xx', 'Mdm Tan')` | `'Ops Ctr, roger. Responding to blk 2xx.'` |
| `appendHeard('x'.repeat(598), 'hello there', 'Mdm Tan')` | length 600 |

The sweep:
```ts
test('every canonical line, dictated (no punctuation), then soft-broken, reads what the typed line reads', async () => {
  // a dictation has no punctuation; an initialism ("C.A.T.") is said as one word, so its dots go first
  const strip = (s: string) => s.replace(/\b(?:[a-z]\.){2,}/gi, m => m.replace(/\./g, ''))
    .replace(/[.?!;,:]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  for (const c of CASES) for (const s of STEPS) {
    const typed = fillCanonical(s.canonicalLine, c, 6, s.mustHit);
    const said = softBreaks(strip(typed), c.patient.callName);
    const a = readOf((await keywordGrader.interpret(typed, ctxAt(s.id, c.id))).sentences);
    const b = readOf((await keywordGrader.interpret(said, ctxAt(s.id, c.id))).sentences);
    expect([...b.whole].sort(), `${c.id} ${s.id}: ${said}`).toEqual([...a.whole].sort());
    expect([...b.parts].sort(), `${c.id} ${s.id}`).toEqual([...a.parts].sort());
    expect(b.missing, `${c.id} ${s.id}`).toEqual([]);
  }
});
```
- **`readOf`:** move the helper from `paraphrases.test.ts` into `sim-helpers.ts` and import it in both files.
- **Cross-step dictation fixtures,** each read through `ctxAt`:

| At | Dictated line | Must read |
|---|---|---|
| `loc-avpu` | "sir can you hear me patient is alert loc is a on the avpu scale sir did you fall" | `loc-avpu`'s points, and `delicate-spine/ask-fall` |
| `breathing` | "arm buddy please measure the spo2 reading on room air sir do you have any lung problems" | `breathing/spo2` and `breathing/asthma-copd-history` |

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run tests/unit/soft-breaks.test.ts`
Expected: FAIL. The module is missing.

- [ ] **Step 3: Implement `softBreaks.ts`.** Tune `STEP_OPENERS` only against the sweep:
- remove an opener that breaks a line wrongly;
- add one only with a fixture.

With the drafted openers and the initialism-aware `strip`, the pre-flight prototype passes the sweep in every case.

A step that still fails only because a match term needs punctuation dictation never gives (a comma inside a term) gets a comma-free alternative in `steps.json`. It comes with a fixture, `contentVersion` `'2026-11-15.5'`, and the pin.

If a step can't be made to pass, stop and report it with the failing line. The controller rules.

- [ ] **Step 4: Run the whole suite**

Run: `npx vitest run && npm run typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sim tests/unit public/data/steps.json
git commit -m "feat(sim): soft sentence breaks for a dictated line, pinned by the canonical sweep" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Voice input: Answer by, the mic key and the speech wrapper

**Files:**
- Create: `src/voice/speech.ts`, `src/run/useVoice.ts`
- Modify:
  - `src/progress/types.ts` (`settings.answerBy`);
  - `src/run/Composer.tsx`, `src/run/RunStart.tsx` and `src/run/Run.tsx`;
  - `src/ui/Icon.tsx` (`'mic'`: the mockup's path, `<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3"/>`);
  - `src/styles/components.css`.
- Test:
  - `tests/unit/voice.test.ts` (new);
  - `tests/unit/run-chat.test.tsx`, `tests/unit/progress-v2.test.ts` and `tests/unit/icons.test.ts` (append);
  - `tests/unit/run-start.test.tsx` (modify: its asserts at `:151` and `:230` of "Typing. Voice comes in a later update." become the Typing radio, with its sub "Type each line, then Send.");
  - the `settings` literals the typecheck flags gain `answerBy: 'typing'`: `reader.test.tsx:117`, `run-chat.test.tsx:380`, `settings.test.tsx:84` and `:279`, and `store.test.ts:335` (modify).

**Interfaces:**
- Consumes: `appendHeard` (Task 4), `haptic`, `toast`, `RUN_LIMITS`, `useProgress` and `useStore`.
- Produces:
```ts
// src/progress/types.ts
export type AnswerBy = 'typing' | 'voice';
// Progress.settings: { textSize: TextSize; haptics: boolean; answerBy: AnswerBy }   // v.optional(picklist, 'typing'); defaultProgress 'typing'
// src/voice/speech.ts
export type VoiceError = 'not-allowed' | 'network' | 'no-speech' | 'audio-capture' | 'language' | 'other';
export interface VoiceHandlers { start(): void; interim(text: string): void; final(text: string): void; error(e: VoiceError): void; end(): void }
export interface Listening { stop(): void; abort(): void }
export const VOICE_LANGS = ['en-SG', 'en-GB'] as const;
export const VOICE_COPY: Record<VoiceError, string>;
export function voiceSupported(win?: Window): boolean          // SpeechRecognition ?? webkitSpeechRecognition
export function listen(h: VoiceHandlers, win?: Window): Listening | null   // null when unsupported
// src/run/useVoice.ts
export function useVoice(o: { onFinal(text: string): void; hold: boolean }):
  { supported: boolean; listening: boolean; hearing: string; toggle(): void; stop(): void }
// src/run/Composer.tsx: Composer gains  answerBy: AnswerBy; callName: string; hold: boolean; status?: string
//   and renders <p class="vh" role="status">, in both Typing and Voice: the composer's one status line (Global Constraints).
//   It shows the voice text while listening or just after a result ("Listening.", "Added to your line."), else `status`.
//   Task 9 passes status "Checking your line.".
```

**Error mapping:** in `listen`, the recogniser's error codes map to `VoiceError`:

| Recogniser error | `VoiceError` |
|---|---|
| `not-allowed`, `service-not-allowed` | `not-allowed` |
| `network` | `network` |
| `no-speech` | `no-speech` |
| `audio-capture` | `audio-capture` |
| `language-not-supported` | a restart with `'en-GB'` the first time; `language` after that |
| `aborted` | nothing (`end` only) |
| anything else | `other` |

**`VOICE_COPY`, exact:**

| Error | Copy |
|---|---|
| `not-allowed` | "Crew Leader can't use the mic. Allow it in Chrome's site settings, or type instead." |
| `network` | "Voice needs a connection right now. Type instead." |
| `no-speech` | "Didn't catch that. Tap the mic and try again." |
| `audio-capture` | "No mic found on this phone. Type instead." |
| `language` | "Chrome can't take speech in English here. Type instead." |
| `other` | "Voice stopped. Tap the mic to try again." |

**The composer in Voice** (D2, mockup `.as-mic`):
- **Keys:** `[Step list?] [field] [Send: .sq style, aria-label "Send"] [Speak: banded, class "mic", aria-label "Speak", aria-pressed]`.
- **The `.mic` style:** the `.send` band style, 54px wide, at least 48px high.
- **The layout:** `.composer` stays `display:flex; flex-wrap:wrap` (components.css:347).
  - The field becomes `flex: 1 1 160px`.
  - The keys keep their fixed widths: Step list 48px, Send 48px, Speak 54px.
  - The note, the hear line and the status line take a full row each (`flex-basis: 100%`).
  - At 360px the field gets 162px.
- **Speak** toggles listening.
- **While listening:**
  - a `.composer-hear` line above the keys shows "Hearing: {interim}", `aria-hidden`;
  - the composer's one `role="status"` line says "Listening.".
- **On a final result:** `field.value = appendHeard(field.value, text, callName)`. The status says "Added to your line.". Focus stays on Speak. Nothing is sent.
- **Errors:** `toast(VOICE_COPY[e])`.
- **Stopping:** `hold` turning true (the Pause sheet), `visibilitychange` to hidden, `pagehide`, Send and unmount all abort listening.
- **Typing mode:** no Speak key; the composer is unchanged from Plan 2.

**Run start's "Answer by":** a radio group, replacing "Typing. Voice comes in a later update.".
- "Typing", sub "Type each line, then Send."
- "Voice", sub "Tap the mic and speak. Check the words, then Send. Chrome usually needs a connection for this."
- Without `voiceSupported()`, Voice is disabled, with sub "This browser can't take speech. Type instead."

Picking one saves `settings.answerBy`. The run and drills read it; it is not stored per run.

- [ ] **Step 1: Write the failing tests**

`tests/unit/voice.test.ts`, with a `FakeRecognition` class on `window.webkitSpeechRecognition`. The class records `lang`, `continuous`, `interimResults`, and calls to `start`, `stop` and `abort`, and the test fires `onresult`, `onerror` and `onend`.
- **Setup:**
  - `voiceSupported(fakeWinWithout)` is false;
  - `listen` sets `lang 'en-SG'`, `continuous false` and `interimResults true`.
- **Results:**
  - an interim result calls `interim('buddy do a')`;
  - a final result calls `final('buddy do a head grip')`.
- **Errors:**
  - `'service-not-allowed'` calls `error('not-allowed')`;
  - `'aborted'` calls no `error`;
  - `'language-not-supported'` starts a second recogniser with `lang 'en-GB'`, and a second `'language-not-supported'` calls `error('language')`.

`tests/unit/run-chat.test.tsx` (the Composer):
- **Voice mode:**
  - the buttons "Send" and "Speak" are there, with Speak `aria-pressed="false"`;
  - a press makes it `"true"`, and the status reads "Listening.";
  - a final 'buddy do a head grip sir what is bothering you' sets the field to 'Buddy do a head grip. Sir what is bothering you.', and `onSend` is not called;
  - a press on Send then calls `onSend` with that text.
- **Stopping:**
  - `hold` true while listening calls `abort`;
  - dispatching `visibilitychange` with `visibilityState` "hidden" calls `abort`.
- **Errors:** an error `'network'` toasts "Voice needs a connection right now. Type instead.".
- **Typing mode:** no "Speak" button.
- **The status line:** in both modes the Composer has one `role="status"` element. With `status="Checking your line."` and not listening, it reads that; while listening, it reads "Listening.".

`tests/unit/run-start.test.tsx`:
- **Radios:** the radios "Typing" (checked by default) and "Voice".
- **Saving:** picking Voice sets `store.get().settings.answerBy` to `'voice'`.
- **Unsupported:** with no recogniser on `window`, Voice is disabled and described by "This browser can't take speech. Type instead.".

`tests/unit/progress-v2.test.ts`:
- `normalizeProgress({ settings: { textSize: 'large' } })!.settings.answerBy` is `'typing'`;
- `normalizeProgress({})` still equals `defaultProgress()`.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/unit/voice.test.ts tests/unit/run-chat.test.tsx tests/unit/run-start.test.tsx tests/unit/progress-v2.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement it.** `Run.tsx` passes:
- `answerBy` from settings;
- `callName` as `env.case.patient.callName`;
- `hold` as `paused`.

Haptics: `haptic('tap', …)` when listening starts.

- [ ] **Step 4: Run the whole suite**

Run: `npx vitest run && npm run typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src tests/unit
git commit -m "feat(run): voice input behind the banded mic key; Answer by at Run start; never sends by itself" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Run history on the PAM tab

**Files:**
- Create: `src/pam/RunHistory.tsx`
- Modify:
  - `src/pam/PamTab.tsx` (history replaces the Last run card);
  - `src/ui/RunStrip.tsx` (`MiniStrip`);
  - `src/styles/tokens.css` and `src/styles/components.css`: `--c-table-cover: #151b1d` and `--c-table-sticky: #171e20` replace the two hard-coded colours at `components.css` 807 and 820, comments kept.
- Test:
  - `tests/unit/pam-tab.test.tsx` (modify: "Last run" becomes "Run history");
  - `tests/unit/runstrip.test.tsx` (append).

**Interfaces:**
- Consumes: `todayTraceOf(r, steps, null)`, `caseLine`, `figuresOf`, `verdict`, `activeFaults`, `formatRunAt`, `useRunContent`, `NoRunsPanel`, `RUN_LIMITS.runsKept`, `STRIP`, `timeToX`, `spikePath`.
- Produces:
```ts
// src/ui/RunStrip.tsx
export function traceGeometry(trace: StripTrace | undefined): { xs: number[]; traceTo: number | null; restFrom: number;
  endX: number | null; mx: number | null }   // RunStrip's xs and traceTo computation, moved out unchanged; both components use it
export function MiniStrip({ trace }: { trace: StripTrace }): JSX.Element   // traceGeometry's trace, the limit line, end line, fault
                                                                           // dot and chevrons; no <text>; aria-hidden; class "strip strip-mini"
// src/pam/RunHistory.tsx
export const HISTORY_PAGE = 10;
export function historyRows(runs: RunRecord[]): RunRecord[]                  // every record, newest startedAt first (drills too)
export function historyMeta(r: RunRecord, steps: Step[], now: Date): string  // '{formatRunAt} · 17:42 of 20:00'; '— of 20:00' unclocked; drill: '{formatRunAt} · untimed'
export function RunHistory(): JSX.Element
```
**The PAM tab,** top to bottom:
1. the h1 "PAM";
2. `RunResume`;
3. New case;
4. `RunHistory`.

**`RunHistory`:**
- **Empty:** with no record at all, `NoRunsPanel title="Run history"`.
- **Otherwise:** a Panel with the h2 "Run history" and an `<ol class="hist">`. Each item is one link, `<a class="hist-row" href="#/debrief/{id}">`, holding:
  - `caseLine` (for example "Breathlessness, Ang Mo Kio. Coached." or "A removed case. Drill on steps 11 to 13.");
  - `historyMeta`;
  - the verdict, `verdict(activeFaults(r).length)`;
  - `MiniStrip` for a non-drill run.
- **Paging:** the first `HISTORY_PAGE` items, then a Secondary "Show 10 more" while more remain. Focus moves to the first newly shown link.
- **Foot note:** "Crew Leader keeps your last 50 runs on this phone."
- **While content loads:** a sized skeleton.
- **If content fails:** no rows show, since without the cases every row would read "A removed case.".
  - With no run open, the panel shows `contentErrorCopy(key)` for the failing key, with a Secondary "Try again" that calls `retry()`.
  - With a run open, RunResume's row (Task 7) already says so with its own Try again, so the panel shows only its h2 and no second error.

- [ ] **Step 1: Write the failing tests**

`tests/unit/pam-tab.test.tsx`, with records seeded through `recordOf` (Plan 2 sim-helpers):

| Seeded | Expected |
|---|---|
| A COPD Coached record with 3 active faults, at 17:42 | a list named "Run history"; a link containing "Breathlessness, Ang Mo Kio. Coached." and "3 to fix", `href` `#/debrief/{id}`; inside it a `svg.strip-mini` with `aria-hidden="true"` |
| A drill record | its link contains "Drill on steps" and "untimed", and holds no `svg` |
| A record whose case isn't in the cases | its link contains "A removed case." |
| 12 records | 10 links, then "Show 10 more"; pressing it shows 12 links and the key goes |
| No records | "No runs yet. A run takes about 20 minutes. The clock starts when you say Approach." |

Also:
- `historyRows` returns newest first by `startedAt`;
- with the cases fetch failing and no run open, the panel shows the cases' error copy and "Try again". With a run open, it shows no error of its own.

`tests/unit/runstrip.test.tsx`:
- `MiniStrip` renders no `<text>`, has `aria-hidden="true"`, and draws the same `sv-trace` path `d` as `RunStrip` does for the same trace;
- the existing `RunStrip` tests pass unchanged after `traceGeometry` moves out.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/unit/pam-tab.test.tsx tests/unit/runstrip.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement it.**
- **CSS:**
  - `.strip-mini{width:158px;height:auto}`;
  - `.hist-row` is a grid of text and strip, at least 44px high, with a focus ring, and hover only under `(hover: hover)`;
  - the strip wraps under the text below 360px.
- **Tokens:** add the two tokens to `tokens.css`, and use them at the two sites.

- [ ] **Step 4: Run the whole suite**

Run: `npx vitest run && npm run typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src tests/unit
git commit -m "feat(pam): run history as strip thumbnails, each opening its debrief; table colours tokenised" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: No lost work: Undo on replace, the composer draft, the cases-failed row, the quota trim

**Files:**
- Modify:
  - `src/today/discard.ts` (`replaceOpenRun`) and `src/run/start.ts` (`beginRun` and `beginDrill` take `opts`);
  - `src/run/Run.tsx`: Restart passes `{ undo: false }`, and the Composer gets `draftKey={draftKeyOf(session.id)}`;
  - `src/run/Composer.tsx` (draft), `src/run/useRunLifecycle.ts` (`finishRun` clears the draft) and `src/run/Debrief.tsx` (the transcript note);
  - `src/today/RunResume.tsx` (the error row);
  - `src/progress/types.ts`, `src/progress/slots.ts` and `src/progress/store.ts` (the quota trim).
- Test:
  - `tests/unit/today.test.tsx`, `tests/unit/run-start.test.tsx`, `tests/unit/run-chat.test.tsx` and `tests/unit/debrief.test.tsx` (append);
  - `tests/unit/run-screen.test.tsx` (append: the Restart test);
  - `tests/unit/store.test.ts` and `tests/unit/slots.test.ts` (append).

**Interfaces:**
- Consumes: `discardOpen`'s machinery (`pending`, `forgetDiscard`, `UNDO_MS`), `toast`, `useOpenRun` (its `'error'` state carries `retry`), `contentErrorCopy`, `saveProgress`, `addRunRecord`.
- Produces:
```ts
// src/today/discard.ts
export function replaceOpenRun(store: ProgressStore, next: RunSession, opts?: { undo?: boolean }): void
  // writes next as runOpen. With another run open and undo !== false: toast 'Run replaced.' ('Drill replaced.' when the
  // old one was a drill) with [Undo] for UNDO_MS, focusAction. Undo puts the old run back while runOpen.id is still
  // next.id, runOpen.tapped is still empty, and runOpen.lines holds no line of the trainee's beyond those `next` began
  // with. It lapses when any of that changes, when the generation moves, or when the toast closes.
// src/run/start.ts
export function beginRun(store: ProgressStore, env: RunEnv, mode: RunMode, opts?: { undo?: boolean }): void
export function beginDrill(store: ProgressStore, env: RunEnv, target: string, chain: string[], sourceRunId: string | null, opts?: { undo?: boolean }): void
// src/run/Composer.tsx
export const draftKeyOf = (runId: string): string => `crewleader.draft.${runId}`;
export function clearDraft(runId: string): void                 // sessionStorage, try/catch
// Composer gains draftKey: string. It restores on mount into an empty field, saves on input and after a voice append,
// and clears on send.
// src/progress/types.ts
export const RUN_LIMITS = { lineChars: 600, transcriptLines: 400, runsKept: 50, transcriptsKept: 10, transcriptsOnQuota: 3 } as const;
export function trimTranscripts(p: Progress, keep: number): Progress   // empties every record's transcript but the newest `keep`; runOpen untouched
// src/progress/slots.ts
// saveProgress(...): { ok: true; savedAt: string } | { ok: false; error: string; quota?: true }
//   quota: setItem threw a DOMException named 'QuotaExceededError' or 'NS_ERROR_DOM_QUOTA_REACHED', or code 22
// src/progress/store.ts: persist(): on { ok: false, quota: true }, data = trimTranscripts(data, RUN_LIMITS.transcriptsOnQuota),
//   save once more at the same seq, and notify subscribers of the trimmed data
```
**Copy, exact:**
- **The content-failed row** shows on Today and the PAM tab while `runOpen !== null` and `useOpenRun()` is `'error'`. It reads "A run is open, but the cases didn't load. They aren't saved on this phone yet. Connect once, then try again.", with a Secondary "Try again". When the error key is `'steps'`, the row says "the PAM steps" in place of "the cases".
- **The debrief's empty-transcript note** becomes "Only your newest runs keep their transcripts."

- [ ] **Step 1: Write the failing tests**
- **`run-start.test.tsx`, with a run open:**
  - "Take the call" opens a new run and toasts "Run replaced." with "Undo";
  - Undo restores the first session (`toEqual` the saved one), and its `id` is back in `runOpen`;
  - a `resumeRun` write to the new session (a new object, same id, no new line) keeps Undo working;
  - after a line is sent to the new run, Undo does nothing;
  - with no run open, there is no toast.
- **`debrief.test.tsx`:** "Drill the fixes" with a run open toasts "Run replaced.".
- **Restart (`run-screen.test.tsx`):** Pause → Restart → confirm gives no "Run replaced." toast.
- **`run-chat.test.tsx`:**
  - typing "Ops Ctr" into the field of run `r1`, unmounting, and mounting a new Composer with `draftKey` `draftKeyOf('r1')` restores "Ops Ctr";
  - Send clears it;
  - `sessionStorage.setItem` throwing changes nothing.
- **`today.test.tsx`:** with `runOpen` set and the cases fetch failing, the row's copy above and "Try again" show. Pressing Try again re-fetches (`fetch` called again).
- **`store.test.ts`,** with a `MemoryStorage` whose `setItem` throws `new DOMException('full', 'QuotaExceededError')` once for a write over 20 000 characters:
  - an update with 12 records of 30 transcript lines saves `ok`;
  - only the newest 3 records keep transcripts;
  - `lastSaveError()` is null;
  - `runOpen.lines` is unchanged.

  A storage that always throws gives the `SAVE_ERROR` path as before.
- **`slots.test.ts`:** `saveProgress` returns `quota: true` for that `DOMException`, and no `quota` for a plain `Error`.
- **`debrief.test.tsx`:** a record with an empty transcript shows "Only your newest runs keep their transcripts.".

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/unit/run-start.test.tsx tests/unit/debrief.test.tsx tests/unit/run-chat.test.tsx tests/unit/today.test.tsx tests/unit/store.test.ts tests/unit/slots.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement it.** `replaceOpenRun` shares `discardOpen`'s pending-Undo table, under a third kind `'replace'`. Notes' drill chips reach `beginDrill` through Run start, so they're covered.

- [ ] **Step 4: Run the whole suite, then the save profile**

Run: `npx vitest run && npm run typecheck`
Expected: all PASS, including `store-immutable.test.tsx`: the trim returns fresh objects.

Run: `npx playwright test tests/e2e/perf.spec.ts --project=pixel --workers=1` on a quiet host (below 40%). Stop a stale preview first.
Expected: median 30 ms or less, max 80 ms or less, logged in the ledger.

- [ ] **Step 5: Commit**

```bash
git add src tests/unit
git commit -m "fix(run): Undo on replacing an open run, the composer draft survives a reload, a cases-failed row, the quota trim" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Smart tester core: the grader behind the seam

**Files:**
- Create: `src/sim/smart.ts`, `tests/unit/smart.test.ts`
- Modify:
  - `src/sim/grader.ts`:
    - `SentenceReading.smart`;
    - export `resolveAddressee`;
    - one line in the `Grader` doc comment: "A grader may add credit to a sentence after passing its first reading to `ctx.next`, as the smart grader does; it must never remove credit.";
  - `src/sim/run.ts` (`readLine` marks `smart` on the trainee's line; `endRun` sets `smartLines`);
  - `src/progress/types.ts`: `ChatLine.smart` as `v.optional(v.literal(true))` with no default, like `tapped`; `RunRecord.smartLines` as `v.optional(v.number(), 0)`; both schemas.
- Test:
  - `tests/unit/smart.test.ts` (new);
  - `tests/unit/progress-v2.test.ts` (append);
  - the `RunRecord` literals the typecheck flags (about 8 test files) gain `smartLines: 0` (modify).

**Interfaces:**
- Consumes: `Grader`, `GradeContext`, `SentenceReading`, `PointReading`, `keywordGrader`, `arrivedIn`, `LAST_CALL_STEP`, `detectAddressee`, `replyRole`, `resolveAddressee`, `normalizeLine`, `matchAt`, `conditionHolds`, `CONDITIONS`.
- Produces:
```ts
// src/sim/smart.ts (pure)
export const SMART_TIMEOUT_MS = 6000;
export const SMART_MAX_CHECKS = 40;
export interface SmartPoint { key: string; label: string; parts: { id: string; label: string }[] }   // key 'stepId/pointId'
export interface SmartFacts { complaint: string; type: 'medical' | 'trauma'; sex: 'male' | 'female'; race: string; age: number;
  eta: number | null; conditions: string[] }
export interface SmartRequest { step: { order: number; name: string }; arrived: boolean; sentences: { index: number; text: string }[];
  candidates: SmartPoint[]; facts: SmartFacts }
export interface SmartVerdict { sentences: { index: number; points: { key: string; parts: string[] }[] }[] }
export interface SmartUsage { inputTokens: number; outputTokens: number }
export type SmartTransport = (req: SmartRequest) => Promise<{ verdict: SmartVerdict | null; usage: SmartUsage | null }>;
export interface SmartOptions { transport: SmartTransport; online(): boolean; onUsage?(u: SmartUsage): void; onFailure?(): void;
  timeoutMs?: number /* SMART_TIMEOUT_MS */; maxChecks?: number /* SMART_MAX_CHECKS */ }
export function smartCandidates(ctx: GradeContext): SmartPoint[]                    // D12
export function smartFacts(c: Case, eta: number | null): SmartFacts                 // D17: nothing else
export function maskCase(text: string, c: Case): string                             // D17: the case's own values out of a sentence
export function smartRequest(ctx: GradeContext, sentences: SentenceReading[], unread: number[]): SmartRequest
  // each sentence's text is maskCase(text, ctx.case) before it goes in
export function mergeVerdict(sentences: SentenceReading[], v: SmartVerdict, ctx: GradeContext): SentenceReading[]
export function smartGrader(o: SmartOptions): Grader                                 // id 'smart'
// src/sim/grader.ts
export interface SentenceReading { /* … */ smart?: true }
export function resolveAddressee(heard: Heard | null, targets: (Addressee | null)[]): Heard | 'unclear' | null   // now exported, unchanged
// src/progress/types.ts
// ChatLine gains smart?: true;  RunRecord gains smartLines: number (v.optional(v.number(), 0))
```
**`maskCase(text, c)`** replaces the case's own values in a sentence, case-insensitively and at word boundaries, before any request is built (as amended by the Task 8 rulings and the final review's parked item 1). Names go only as whole phrases, never one word alone, so "every 5 min" or "Any wei?" is left as said even where a name holds "Min" or "Wei". A phrase's words may be split by any run of spaces or hyphens ("Tan Ah-Mui"). A title is any of `PATIENT_WORDS`, `mrs`, `miss` or `mister`, its full stop optional. In this order:
1. **"the patient":** an optional title and `patient.name` whole; `patient.callName`; any title and the call name's last word ("Uncle Tan", "Mister Tan"). A sentence ending in a title, cut from the name after it by the sentence split, keeps its next sentence's opening call-name word masked too.
2. **"the IC":** `patient.ic`; any NRIC-shaped token, anyone's (s, t, f, g or m, 2 digits, digits or x's with a space or two among them, then a letter); one with a space, full stop or hyphen before any of its 7 digits and its letter, or with no letter ("S90-12345-A", "S90 12 34 5A", "S9012345", the case's IC hyphenated); 7 digits alone, never a phone's 8; any word that starts with the IC's first 3 characters; and its last 6 characters, with a space, full stop or hyphen before the letter allowed ("xxxxx A").
3. **"the address":** `location` whole; each of its comma-separated pieces that holds a digit or "#" (the block and street, the unit); the block alone ("Blk 2xx", "Block 2xx") and the street alone ("Compassvale St") of a piece that opens with its block; then the case's `area` ("Hougang", "Ang Mo Kio"). A landmark piece ("void deck") is left.

The verdict is matched to sentences by index, so the masked text never reaches the run.

**`smartGrader(o).interpret(line, ctx)`:**
1. **Keyword reading:** `const k = await keywordGrader.interpret(line, ctx)`. The keyword grader calls `ctx.next` as it always does.
2. **Unread sentences:** `unread` holds the indexes whose `points` is empty and with no `dropped`. Return `k` unchanged, with no `onFailure` and so no toast (D14), if any of these holds:
   - `unread` is empty;
   - `o.online()` is false;
   - `smartCandidates(ctx)` is empty;
   - the per-grader count has reached `maxChecks`.
3. **The cache:** look up `smartRequest(ctx, k.sentences, unread)`, keyed by its JSON, in a per-grader `Map`. Otherwise race `o.transport(req)` against `timeoutMs`.
   - A late answer is ignored.
   - A throw, a timeout or a null verdict calls `o.onFailure?.()` and returns `k`.
   - Only a verdict is cached. `onUsage` gets the usage.
4. **The merge:** return `{ sentences: mergeVerdict(k.sentences, verdict, ctx) }`.

**`mergeVerdict`:** each verdict entry for an index that is in `unread` and still has no points becomes that sentence's points.
- **Kept points:** only keys among `smartCandidates(ctx)`, and only part ids of that point.
- **Each point:**
  - `step` and `point` from its key;
  - a point with parts gets `parts` as given and `whole: false`; one without gets `parts: []` and `whole: true`;
  - `pos: 0`;
  - `missing`: the point's `requiredWords` that `matchAt(normalizeLine(text), [[w]], ctx.slots)` doesn't find.
- **The sentence:** `step` is the first point's step, and `smart: true`.
- **The addressee:** `resolveAddressee(detectAddressee(normalizeLine(text), callName), targets)`, with targets `m.to ?? replyRole(step, m.id)`.
- **The rest:** `oxygen`, `ecg`, `arm` and `question` stay as the keyword grader read them.

**The engine:**
- `readLine` adds `smart: true` to the trainee's `ChatLine` when any of its sentences has `smart`.
- `endRun` sets `smartLines` to `s.lines.filter(l => l.smart).length`.

- [ ] **Step 1: Write the failing tests** in `tests/unit/smart.test.ts`.

The fake transport:
```ts
const fake = (verdict: SmartVerdict | null) => {
  const calls: SmartRequest[] = [];
  const transport: SmartTransport = async (req) => { calls.push(req); return { verdict, usage: { inputTokens: 900, outputTokens: 40 } }; };
  return { calls, transport };
};
const FALL = 'fall-yishun-01';
const neckLine = 'Sir, did you fall? Any ouch at your nape?';
// "Any ouch at the neck area?" would not do: the keyword grader reads it as the RBS neck region (pre-flight scan)
```
- **Candidates:**
  - `smartCandidates(ctxAt('delicate-spine', FALL))` holds `'delicate-spine/ask-neck-pain'`;
  - it holds no key with a `check`: `breathing/mask-flow` (order 10, in the window);
  - it holds no step of order 1 or 2;
  - none outside orders 1–10.
- **Check points in the window:** `smartCandidates(ctxAt('circulation', FALL))` (window 11–13) holds neither `investigation/ecg` nor `investigation/bp-arm`.
- **Candidates before arrival:** with `ctxAt('call-caller', 'copd-amk-01')` and `arrived: false`, every key's step order is 1 or 2.
- **Facts** for `smartFacts(caseById('hypo-hougang-01'), 6)`:
  - they equal `{ complaint: 'Giddiness', type: 'medical', sex: 'male', race: 'Chinese', age: 68, eta: 6, conditions: [...] }`;
  - `JSON.stringify` of them holds none of 'S58xxxxxB', 'Lim Boon Huat', 'Mr Lim' and 'Hougang Ave'.
- **The masking (D17),** in hypo:
  - `maskCase('Mr Lim, any ouch at your nape?', hypo)` is `'the patient, any ouch at your nape?'`.
  - `maskCase('Lim Boon Huat, IC S58xxxxxB, at Blk 4xx Hougang Ave 8, #11-xx?', hypo)` holds "the patient", "the IC" and "the address". It holds none of 'Lim', 'Boon', 'Huat', 'S58', 'Hougang' and 'Blk 4xx', case-insensitively.
  - "Boon is in pain." alone gives "the patient is in pain.", and "Is this Hougang?" gives "Is this the address?".
  - `JSON.stringify(smartRequest(ctx, sentences, [0]))`, for sentence 0 "Mr Lim, Lim Boon Huat, IC S58xxxxxB, Blk 4xx Hougang Ave 8, any ouch at your nape?", holds none of the case's own `patient.name`, `patient.callName`, `patient.ic`, `location` and `area`, nor 'S58'.
- **The merge:**
  - **Precondition:** `keywordGrader` reads nothing for "Any ouch at your nape?" at `delicate-spine` in FALL. Assert this first. The pre-flight scan verified it, while "Sir, did you fall?" still reads `ask-fall`.
  - **Verdict:** a fake verdict `{ sentences: [{ index: 1, points: [{ key: 'delicate-spine/ask-neck-pain', parts: [] }] }] }`.
  - **Result:** `interpret(neckLine, ctx)` keeps sentence 0 as the keyword grader read it. Sentence 1 reads `ask-neck-pain` whole, with `smart: true` and addressee `'patient'`.
  - **One call:** the transport is called once, with `sentences` `[{ index: 1, text: 'Any ouch at your nape?' }]`.
- **Unknown keys and parts:** a verdict naming `'circulation/pulse'` (order 11: outside step 8's window, and not pending in `ctxAt`) or a part id the point lacks is dropped.
- **Failures:**
  - a transport that never settles: with `vi.useFakeTimers()` and `advanceTimersByTimeAsync(6000)`, `interpret` resolves with the keyword reading, and `onFailure` is called once;
  - a transport that throws gives the same result;
  - a verdict of `null` gives the same result.
- **Offline:** with `online: () => false`, the transport is never called, and `onFailure` isn't either.
- **The cache:** the same line and ctx twice call the transport once.
- **The cap:** with `maxChecks: 2`, the third distinct line doesn't call the transport.
- **Usage:** `onUsage` gets `{ inputTokens: 900, outputTokens: 40 }`.
- **The engine:**
  - `sendLine(envOf(FALL, smartGrader({ transport, online: () => true })), s, neckLine, now)` gives a session whose `hits['delicate-spine/ask-neck-pain']` exists, and whose last trainee line has `smart: true`;
  - `endRun(...).smartLines` is 1.

`tests/unit/progress-v2.test.ts`:
- a v2 record without `smartLines` loads with 0;
- a session line with `smart: true` round-trips through `normalizeProgress`.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/unit/smart.test.ts tests/unit/progress-v2.test.ts`
Expected: FAIL. The module is missing.

- [ ] **Step 3: Implement `smart.ts` and the engine and type changes.** The timer uses `setTimeout` only, which exists in Node; there is no `window`.

- [ ] **Step 4: Run the whole suite**

Run: `npx vitest run && npm run typecheck`
Expected: all PASS. The keyword-only sweeps are unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/sim src/progress tests/unit
git commit -m "feat(sim): the smart grader behind the Grader seam: unread sentences only, keyword fallback, cached and capped" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Smart tester on the phone: the Claude transport, Settings and the run's wiring

**Files:**
- Create:
  - `src/smart/settings.ts` and `src/smart/claude.ts`;
  - `tests/unit/smart-settings.test.ts` and `tests/unit/claude-transport.test.ts`.
- Modify:
  - `package.json` and `package-lock.json` (`npm install @anthropic-ai/sdk`);
  - `src/settings/Settings.tsx`;
  - `src/run/useRun.ts` (`useOpenRun`'s env grader);
  - `src/run/useSendQueue.ts`, `src/run/Run.tsx` and `src/run/Chat.tsx` (pending lines, the smart tag, the once-per-run toast);
  - `src/run/Composer.tsx`: no new code, since Task 5 made its `status` prop. Run.tsx passes `status="Checking your line."` while a pending line has waited 300 ms;
  - `src/run/Debrief.tsx` (the smart note);
  - `src/styles/components.css`.
- Test:
  - `tests/unit/run-screen.test.tsx` and `tests/unit/debrief.test.tsx` (append). The `useOpenRun` grader test goes in `run-screen.test.tsx`, and that file's slow-grader and `onFailure` tests reach `graderFor` through `vi.mock('../../src/smart/claude')`;
  - `tests/unit/settings.test.tsx` (modify: its assert at `:191` of the h2 groups becomes `['Haptics', 'Offline', 'Install', 'Storage', 'Smart tester', 'Reset progress']`; then append).

**Interfaces:**
- Consumes: `smartGrader`, `SmartTransport`, `SmartRequest`, `SmartVerdict`, `SmartUsage`, `SMART_TIMEOUT_MS` (Task 8); `envFor`; `useDelayedFlag`; `toast`.
- Produces:
```ts
// src/smart/settings.ts
export const SMART_STORAGE_KEY = 'crewleader.smart';
export type SmartModelId = 'claude-opus-5-5' | 'claude-sonnet-5-5' | 'claude-haiku-5-5';
export const SMART_MODELS: readonly { id: SmartModelId; label: string; sub: string; inPerM: number; outPerM: number }[] = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', sub: 'Most careful. The default.', inPerM: 4, outPerM: 20 },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', sub: 'Faster, about half the cost.', inPerM: 2, outPerM: 10 },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', sub: 'Fastest and cheapest.', inPerM: 0.1, outPerM: 0.5 },
];   // US$ per million tokens, from the claude-api skill's model table (cached 2026-11-03)
export interface SmartSettings { on: boolean; key: string | null; model: SmartModelId; checks: number; spentUsd: number }
export const DEFAULT_SMART: SmartSettings = { on: false, key: null, model: 'claude-opus-5-5', checks: 0, spentUsd: 0 };
export function readSmart(storage?: Storage | null): SmartSettings
  // each field optional, taking DEFAULT_SMART's value when missing, so { on: true, key: 'sk-ant-x' } reads whole.
  // A field of the wrong type, JSON that won't parse, or a throw → DEFAULT_SMART
export function writeSmart(s: SmartSettings, storage?: Storage | null): boolean
export function smartReady(s: SmartSettings): boolean                          // on && key !== null
export function withSpend(s: SmartSettings, u: SmartUsage): SmartSettings     // checks + 1, spentUsd + priced usage
export function useSmartSettings(): [SmartSettings, (fn: (s: SmartSettings) => SmartSettings) => void]   // also follows 'storage' events
// src/smart/claude.ts (the only file importing '@anthropic-ai/sdk', by dynamic import)
export const SMART_SYSTEM: string;
export function verdictSchema(req: SmartRequest): object       // json_schema; points[].key enum = req.candidates' keys; additionalProperties false
export function requestBody(req: SmartRequest, model: SmartModelId): Record<string, unknown>
  // { model, max_tokens: 2048, system: SMART_SYSTEM, messages: [{ role: 'user', content: JSON.stringify(req) }],
  //   output_config: { effort: 'low', format: { type: 'json_schema', schema: verdictSchema(req) } } }
  //   sent with client.messages.create for every model: no betas, no fallbacks (D19)
export function parseVerdict(message: { stop_reason: string | null; content: { type: string; text?: string }[] }): SmartVerdict | null
  // null on 'refusal', no text block, bad JSON, or a shape valibot rejects
export function claudeTransport(get: () => SmartSettings, onSpend: (u: SmartUsage) => void, opts?: { fetch?: typeof fetch }): SmartTransport
  // new Anthropic({ apiKey, dangerouslyAllowBrowser: true, timeout: SMART_TIMEOUT_MS, maxRetries: 0, fetch? })
export type KeyCheck = 'ok' | 'bad-key' | 'browser-blocked' | 'rate-limited' | 'offline' | 'error';
export function testKey(key: string, model: SmartModelId, opts?: { fetch?: typeof fetch }): Promise<KeyCheck>
  // a tiny request (max_tokens 16). Typed SDK errors, most specific first: APIConnectionError → 'offline';
  // AuthenticationError whose message starts 'CORS requests are not allowed for this Organization' → 'browser-blocked',
  // else 'bad-key'; RateLimitError → 'rate-limited'; APIError → 'error'
export function graderFor(s: SmartSettings, onSpend: (u: SmartUsage) => void, onFailure: () => void): Grader   // keywordGrader unless smartReady
// src/run/useSendQueue.ts: useSendQueue(store, env, sessionId, announce, onPending?: (texts: string[]) => void)
// src/run/Chat.tsx: Chat gains pending?: string[]
```
**`SMART_SYSTEM`,** in substance (the implementer writes the words):
- You check sentences from an EMT trainee's PAM practice run.
- Return, for each listed sentence, the candidate points it clearly says or asks, in the trainee's own words.
- Name a part only when the sentence says it. Return no points for a sentence that says none. Never guess.
- Never credit a point because it would be the right next step.
- Return only the JSON the schema allows.

**Wiring:**
- **The env:** `useOpenRun` builds `envFor(steps, c, graderFor(smart, …))`, memoised on `[steps, case, session id, smart.on, smart.key, smart.model]`. A new run gets a fresh grader, so its cache and cap start fresh.
- **Spend:** `onSpend` writes `withSpend`. `graderFor` passes `onSpend` only to `claudeTransport`, which sees every billed response, a late one included. It leaves `smartGrader`'s `onUsage` unset, so no check is counted twice.
- **Failure:** `onFailure` toasts "The smart tester didn't answer, so the keyword rules graded that line." once per session id.
- **Pending lines:** inputs still in the queue render after the log, outside `role="log"`: `<div class="msg me pending" aria-hidden="true">`, with the route "Checking…". They appear only once a line has waited 300 ms (`useDelayedFlag`). From then, Run.tsx passes the Composer `status="Checking your line."` (Task 5's status line).
- **The smart tag:** a line with `smart` shows a "Smart tester" tag before its route, with the visually hidden text "Checked by the smart tester.".
- **The debrief:** when `smartLines > 0`, a `dnote` under the case line reads "The smart tester credited {n} {line|lines} the keyword rules couldn't place.".

**Settings' "Smart tester" group** sits after Storage and before Reset. Copy, exact:
- **Intro:** "Optional. Uses your own Claude API key to check lines the keyword rules couldn't place. Off until you add a key and turn it on."
- **The key:**
  - label "Claude API key": `type="password"`, `autocomplete="off"`, `autocapitalize="off"`, `spellcheck={false}`;
  - Secondary "Save key", enabled once the field is non-blank;
  - once saved: "Key saved on this phone, ending {last 4}.", with Secondary "Remove key" (which also turns the switch off).
- **The switch:** label "Use the smart tester", sub "Needs a connection. Each check is billed to your Anthropic account." It is disabled until a key is saved.
- **The model:** a radio group named "Model", from `SMART_MODELS`' labels and subs.
- **Test key:** Secondary "Test key". The result line (`role="status"`) shows one of:

| Result | Copy |
|---|---|
| `ok` | "The key works." |
| `bad-key` | "That key didn't work. Check it in the Claude Console." |
| `browser-blocked` | "This key's organisation doesn't allow calls from a browser, so the smart tester can't use it." |
| `rate-limited` | "Too many requests right now. Try again in a minute." |
| `offline` | "Couldn't reach Anthropic. Check your connection." |
| `error` | "Something went wrong. Try again later." |

- **Usage:** "{n} checks so far on this phone, about US${x.xx}.", with Secondary "Reset count".
- **What it sends:** "When a line has a sentence the keyword rules couldn't place, Crew Leader sends Anthropic that sentence, the steps it could belong to, and the made-up case's complaint, type and ETA, and the patient's age, sex and race. It first replaces any name, IC number or address in the sentence, and it never sends the IC number, your other runs, quiz or notes, or anything about you. Anthropic also sees what any web request shows, such as your IP address."
- **The key's safety:** "Your key stays in this browser on this phone and goes only to Anthropic. Anyone who can open Crew Leader on this phone can use it."
- **The fallback:** "Offline, or when a check takes longer than 6 seconds, the keyword rules grade the line on their own."

- [ ] **Step 1: Install the SDK and record its version**

Run: `npm install @anthropic-ai/sdk && npm ls @anthropic-ai/sdk`
Expected: one new dependency in `package.json`. Write its version in the ledger.

Check the SDK's types:
- does `client.messages.create` accept `output_config.effort` and `output_config.format`?
- does `new Anthropic` accept `fetch`, `timeout`, `maxRetries` and `dangerouslyAllowBrowser`?

If any of these isn't typed, stop and report it rather than casting.

- [ ] **Step 2: Write the failing tests**

`tests/unit/smart-settings.test.ts`:
- **Reading:**
  - `readSmart` gives `DEFAULT_SMART` on an empty storage, on `'{bad'`, on `'{"on":"yes"}'` (a wrong type), and on a `getItem` that throws;
  - the partial `{ on: true, key: 'sk-ant-x' }` reads as `{ ...DEFAULT_SMART, on: true, key: 'sk-ant-x' }`.
- **Writing:** `writeSmart` then `readSmart` round-trips; `writeSmart` returns false when `setItem` throws.
- **`smartReady`:** false for `{ on: true, key: null }`, and false for `{ on: false, key: 'sk-ant-x' }`.
- **`withSpend`:** for Opus and `{ inputTokens: 1_000_000, outputTokens: 0 }`, it adds 4 to `spentUsd` and 1 to `checks`.

`tests/unit/claude-transport.test.ts`, starting `// @vitest-environment node`:
- **`requestBody(req, 'claude-opus-5-5')`:**
  - `model 'claude-opus-5-5'`, `max_tokens 2048`, `output_config.effort 'low'`, `output_config.format.type 'json_schema'`;
  - the schema's key `enum` equals the candidates' keys;
  - `JSON.stringify` of the body holds none of the hypo case's IC, name, call name and location.
- **Every model in `SMART_MODELS`:** the body has the same keys, and none named `betas` or `fallbacks` (D19).
- **The transport,** with an injected `fetch` that records its `Request` and returns a Messages response:
  - **The call:** the URL is exactly `https://api.anthropic.com/v1/messages`, with no `?beta=true`. The headers carry `authorization: Bearer sk-ant-test` (SDK 1.8.0 sends an API key this way, never as `x-api-key`; Task 9 review) and `anthropic-dangerous-direct-browser-access: true`, and no `anthropic-beta`.
  - **The response:** a text block's JSON verdict is returned, and `onSpend` gets the usage.
  - **Null verdicts:** `stop_reason 'refusal'`, a text that isn't JSON, and a verdict missing `sentences` each give `verdict: null`.
- **`testKey`,** with injected `fetch`:

| Response | Result |
|---|---|
| 200 | `'ok'` |
| 401 with `{"type":"error","error":{"type":"authentication_error","message":"CORS requests are not allowed for this Organization …"}}` | `'browser-blocked'` |
| 401, another message | `'bad-key'` |
| 429 | `'rate-limited'` |
| `fetch` rejecting a `TypeError` | `'offline'` |

`tests/unit/settings.test.tsx`:
- **No key:** the switch "Use the smart tester" is disabled, and the model radio "Claude Opus 5.5" is checked.
- **Saving:** typing `sk-ant-abcd1234` and pressing "Save key" shows "Key saved on this phone, ending 1234.".
  - `localStorage.getItem('crewleader.smart')` holds the key;
  - `JSON.stringify(store.get())` doesn't;
  - Reset progress keeps it.
- **Removing:** "Remove key" clears the key and turns the switch off.
- **Copy:** the privacy paragraphs and the usage line show.

`tests/unit/run-screen.test.tsx`:
- **Pending lines:** with a grader whose `interpret` resolves after 1 s (`vi.useFakeTimers()`):
  - the sent line appears as `.msg.pending` after 300 ms, not before;
  - the status reads "Checking your line.";
  - the pending line is gone once the line is applied.
- **The smart tag:** a session line with `smart: true` shows "Smart tester".
- **The failure toast:** a grader calling its `onFailure` twice in one run toasts the failure copy once.

`tests/unit/debrief.test.tsx`:
- `smartLines: 2` shows "The smart tester credited 2 lines the keyword rules couldn't place.";
- 0 shows nothing.

`tests/unit/run-screen.test.tsx`, also: `useOpenRun().env.grader.id` is `'smart'` when `crewleader.smart` holds `{ on: true, key: 'sk-ant-x' }`, and `'keywords'` otherwise.

`tests/unit/claude-transport.test.ts`, also, on spend: one billed response through `graderFor`'s transport raises `checks` by exactly 1, so `onSpend` is not wired twice.

- [ ] **Step 3: Run them and see them fail**

Run: `npx vitest run tests/unit/smart-settings.test.ts tests/unit/claude-transport.test.ts tests/unit/settings.test.tsx tests/unit/run-screen.test.tsx tests/unit/debrief.test.tsx`
Expected: FAIL.

- [ ] **Step 4: Implement it.** Errors are caught as a typed chain (claude-api skill):
1. `APIConnectionError`, checked before `APIError` (in the TypeScript SDK it is a subclass);
2. `AuthenticationError`;
3. `RateLimitError`;
4. `APIError`.

Never string-match except the documented CORS message prefix. Never log the key or the request headers.

- [ ] **Step 5: Run the whole suite and the build**

Run: `npx vitest run && npm run build && grep -l "anthropic-dangerous-direct-browser-access" dist/assets/*.js`
Expected:
- all PASS;
- the build succeeds;
- the grep names one chunk, never the entry `index-*.js`.

The header string is the SDK's own literal. `claude.ts` names only the option `dangerouslyAllowBrowser`, and it is imported statically through `graderFor`, so grepping for the option would match the entry chunk too.

Write the chunk's size in the ledger.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src tests/unit
git commit -m "feat(smart): the optional Claude API tester: key on this phone only, Settings, Test key, pending lines, keyword fallback" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Notes pass: rhythm strip alt text

**Files:**
- Modify:
  - `tools/import_notes.py` (`_caption_alts`);
  - `public/data/notes.json` (regenerated: only `alt` values and `contentVersion` change).
- Test: `tests/py/test_import_notes.py` (modify: its assert at `:124`, `imgs["s10-3"] == "Figure 3: Rhythm strips"`, becomes `imgs["s10-3"] == "Normal Sinus Rhythm, ECG rhythm strip"`; then append).

**Interfaces:**
- Consumes: `_caption_alts(blocks)`, `CAPTION_RE`, the block shapes (`{"k": "list", "items": [{"marker", "runs"}]}`, `{"k": "img", "alt", "src"}`, `{"k": "p", "runs"}`).
- Produces: an image with no "Figure N:" caption, right after a one-item list block whose item text is all bold, takes the alt text `"{label}, ECG rhythm strip"`.
  - The label is the item's runs joined and stripped, with a trailing "(not tested)" dropped.
  - When the next block is a paragraph starting "Left:", its text up to " Remark:" is added in brackets.
  - Captioned images keep their caption. Every other image keeps "Figure k: heading".

- [ ] **Step 1: Write the failing test** in `tests/py/test_import_notes.py`. On the generated document (as the file's other tests load it), s10's image alts in order are:
```python
["Figure 5: \"PQRST\" graph of a normal sinus rhythm",
 "Figure 6: Measurement of duration of an ECG strip (constant speed of 25 mm/sec)",
 "Normal Sinus Rhythm, ECG rhythm strip", "Sinus Bradycardia, ECG rhythm strip", "Sinus Tachycardia, ECG rhythm strip",
 "Ventricular Fibrillation, ECG rhythm strip", "Asystole, ECG rhythm strip",
 "ST-Depression, ECG rhythm strip (Left: normal ECG. Right: ST depression.)",
 "ST-Elevation, ECG rhythm strip (Left: normal ECG. Right: ST elevation.)"]
```
A unit test of `_caption_alts` on hand-built blocks pins the "(not tested)" drop and the caption precedence.

- [ ] **Step 2: Run it and see it fail**

Run: `py -m pytest tests/py/test_import_notes.py -q`
Expected: FAIL.

- [ ] **Step 3: Implement it, then re-import:** `npm run import:notes`. The docx is in `sources/`, on disk and untracked.

Diff `public/data/notes.json`: only 7 `alt` values and `contentVersion` change. Anything else means stop and report.

- [ ] **Step 4: Run the suites**

Run: `py -m pytest && npx vitest run`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/import_notes.py public/data/notes.json tests/py
git commit -m "fix(notes): rhythm strips take their labels as alt text" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Publishing readiness: a scanned snapshot, the docs scrub, and a dry run in a temporary clone

**Files:**
- Create: `tools/publish_history.py`, `tests/py/test_publish_history.py`, `docs/publishing.md`
- Modify:
  - `docs/superpowers/specs/2026-11-09-crew-leader-design.md`: line 3's "Owner: …" becomes "Owner: the trainee (SCDF FMV EMT)";
  - every tracked file the tool's `--scan-only` reports. Absolute Windows profile paths (a drive's Users folder followed by the account name, with either slash) become repo-relative paths (`.superpowers/alts/scdf.fragment.html`, `sources/…`) or generic wording ("the brief PDF in Downloads"). Any other personal marker it finds is removed in the same way. Importer config and code keep working through repo-relative paths.
  - `.github/workflows/deploy.yml`: header steps 2–4 become:
    - "The user chose a public GitHub repo named crew-leader (2026-11-15). Everything in it is public.";
    - "Publish the snapshot commit that tools/publish_history.py builds in a temporary clone (docs/publishing.md), never this repo's own history.".

    The note on what a public repo shows, and on private Pages needing a paid plan, stays.
  - `tests/unit/deploy-workflow.test.ts` (append).

**Interfaces:**
- Consumes: git 2.53 (`clone`, `commit-tree`, `branch`, `fetch`, `for-each-ref`, `status`, `rev-list --objects`, `ls-tree`, `log`, `cat-file --batch` and `--batch-check`, `config`); Python 3.13 standard library only (`subprocess`, `hashlib`, `shutil`, `pathlib`, `dataclasses`, `argparse`, `fnmatch`, `os`, `re`).
- Produces:
```python
# tools/publish_history.py
MAX_BLOB_BYTES = 5 * 1024 * 1024
SNAPSHOT_BRANCH = 'publish'
SNAPSHOT_MESSAGE = 'Publish Crew Leader'          # the whole message: no personal value, no local sha
@dataclass(frozen=True)
class Marker:
    kind: str     # 'email' | 'name' | 'user'
    value: str    # never printed, logged or written to a file
@dataclass
class Report:
    snapshot: str | None; parent: str | None
    tree_equal: bool; refs_untouched: bool; worktree_untouched: bool
    problems: list[str]     # masked: a marker shows only as '#n (kind, k chars)', with the path and line it was found at
    @property
    def ok(self) -> bool: ...   # snapshot set, tree_equal, refs_untouched, worktree_untouched, and no problems

def noreply_email(user: str, user_id: str | None = None) -> str
    # '{user_id}+{user}@users.noreply.github.com', or '{user}@users.noreply.github.com' with no id; a user that isn't a
    # GitHub username (1–39 of [A-Za-z0-9-], no leading or trailing '-') raises
def os_username() -> str                        # os.getlogin(), else Path.home().name
def personal_markers(repo: Path, allowed: set[str]) -> list[Marker]
    # read at runtime: every distinct author and committer email and name in repo's history (git log --all), git config
    # user.name, and os_username(). Emails ending '@users.noreply.github.com', emails whose local part is 'noreply', and
    # anything in `allowed` (the --github-user value) are skipped. Values of 3 characters or fewer are skipped, and
    # the count of skipped ones is reported.
def mask(m: Marker, n: int) -> str              # '#n (kind, k chars)'
def state_of(repo: Path) -> str                 # for-each-ref refname and objectname, HEAD's target, and git status --porcelain=v1 --ignored
def backup_sources(repo: Path, dest: Path) -> dict[str, str]
    # copies repo/sources to dest (refuses a dest inside repo, or an existing non-empty dest); returns {relative path: sha256}
    # and re-hashes the copies, raising on any mismatch. Runs before anything is written.
def make_clone(repo: Path, work: Path, rev: str = 'main') -> Path
    # git clone --no-local --single-branch --branch <rev> <repo> <work>/clean; never touches repo
def build_snapshot(clone: Path, user: str, email: str, rev: str = 'main', parent: str | None = None,
                   remote: str | None = None) -> str
    # with remote: git fetch <remote> main (the published branch), and refuse unless FETCH_HEAD == parent; parent
    # without remote refuses. GIT_AUTHOR_NAME = GIT_COMMITTER_NAME = user and GIT_AUTHOR_EMAIL = GIT_COMMITTER_EMAIL =
    # email in the command's own environment; git commit-tree <rev>^{tree} [-p parent] -m SNAPSHOT_MESSAGE;
    # git branch -f SNAPSHOT_BRANCH <sha>. Returns the sha.
def ignored_dirs(repo: Path) -> list[str]       # the directory patterns in repo/.gitignore ('.superpowers/', 'sources/', 'dist/', …)
def scan_tree(git_dir: Path, tree_ish: str, markers: list[Marker], ignored: list[str]) -> list[str]
    # every blob path in tree_ish: a path under sources/; a path under an ignored directory (.superpowers/ first); a blob
    # over MAX_BLOB_BYTES; a marker in a path or in blob text. Emails match case-insensitively as substrings; names and
    # the OS username match case-insensitively at word boundaries.
def scan_commits(clone: Path, rev: str, markers: list[Marker]) -> list[str]
    # every commit reachable from rev: a marker in its author, committer or message; a 'gpgsig' header (a signature
    # names its key's owner)
def verify(repo: Path, clone: Path, snap: str, before: str, user: str, email: str, parent: str | None,
           markers: list[Marker], rev: str = 'main') -> Report
    # problems: scan_tree(clone, snap) + scan_commits(clone, snap); the snapshot's author and committer name == user and
    # email == email; its parents == [parent] or []. tree_equal: snap^{tree} == repo's <rev>^{tree}.
    # refs_untouched and worktree_untouched: state_of(repo) == before, split into its two halves.
def shown(text: str, markers: list[Marker]) -> str   # text with every marker replaced by its mask: all printed text goes through it
def main(argv: list[str] | None = None) -> int
    # py tools/publish_history.py --github-user <name> [--github-id <id>] [--parent <sha> --remote <url>]
    #     --work <dir outside the repo> --backup <dir outside the repo> [--repo <path>, default '.'] [--rev <ref>, default 'main']
    #   order: state_of(repo) → backup_sources → make_clone → build_snapshot → verify, every step at --rev. Prints, through
    #   shown(), the masked report, the snapshot sha and the clone's path relative to --work ('clean/'): never an
    #   absolute path, which under $TEMP would hold the OS username. Exit 0 only when report.ok. Never pushes.
    # py tools/publish_history.py --scan-only [--repo <path>] [--rev <ref>, default 'main']
    #   scan_tree(repo, '<rev>^{tree}') with the markers, read-only: the docs scrub's finder. Exit 0 only with no problems.
    # --rev: Plan 3's own work is on plan-3-polish until the merge, so Task 11 runs with --rev plan-3-polish; the real
    #   publish after the merge keeps the default.
```
**`docs/publishing.md`:** a page in the voice of `docs/updating-content.md`. It names no site URL, holds no email address or personal name, and is no README.
1. **What and when:**
   - the public GitHub repo `crew-leader`, deployed by `.github/workflows/deploy.yml` to GitHub Pages;
   - published after Plan 3, by the controller with the user;
   - the site stays unlisted (noindex and `robots.txt`), but the repo is public.
2. **What a publish is:**
   - one snapshot commit of `main`'s current tree. `sources/` is untracked there, so it is never in it.
   - Its author and committer is the user's GitHub username, with its noreply email.
   - Its parent is the last published commit, so GitHub shows one commit per publish.
   - The local history is never rewritten and never pushed.
3. **Before you start:**
   - Ask the user for their GitHub username, and their numeric id if they want the `id+user` form (GitHub's email settings show it).
   - The tool backs up `sources/` first. Keep that backup somewhere lasting, not in Temp.
   - Never check out a commit from before `c1c3ef5` in this repo. Git deletes `sources/` working copies when it moves off such a commit (the Plan 2 merge incident).
4. **The first publish:**
   1. The user creates the empty public repo `crew-leader` on github.com, with no README, licence or other starter files.
   2. After Plan 3 is merged into `main`, the controller runs `py tools/publish_history.py --github-user <name> --work <dir> --backup <dir>`, with `--rev` left at its default, `main`. The report must show:
      - one snapshot with no parent;
      - tree equal;
      - refs and working tree untouched;
      - no problems.
   3. `git -C <clone> push https://github.com/<name>/crew-leader.git publish:main`.
   4. In the repo, set Settings > Pages > Source to "GitHub Actions". In the Actions tab, open Deploy and press "Run workflow".
5. **Later publishes:** add `--parent <the remote main's sha> --remote https://github.com/<name>/crew-leader.git`, then push `publish:main` as before. It is a fast-forward.
6. **When the scan refuses:** remove each reported hit from the tracked file in a normal commit on `main`, run `--scan-only` until it passes, then publish again. Never push a snapshot the tool refused.

- [ ] **Step 1: Write the failing tests**

`tests/py/test_publish_history.py`, on toy repos built in `tmp_path` by a fixture.
- **The toy repo:**
  - commit 1 adds `app.txt` and `sources/notes.pdf`;
  - commit 2 adds `sources/` and `.superpowers/` to `.gitignore` and `git rm --cached -r sources`, keeping the file on disk;
  - commit 3 edits `app.txt`, with an untracked `.superpowers/ledger.md` on disk;
  - all on branch `main`.

  The config is the toy repo's own: `user.name "Toy Person"`, `user.email "toy.person@example.test"` and `commit.gpgsign false`. These are made-up values, never real ones.

  `monkeypatch` replaces `publish_history.os_username` to return `"toyuser"`.
- **The noreply address:**
  - `noreply_email('dry-run-user')` is `'dry-run-user@users.noreply.github.com'`;
  - `noreply_email('dry-run-user', '123')` is `'123+dry-run-user@users.noreply.github.com'`;
  - `noreply_email('bad user')` raises.
- **The markers:** `personal_markers(toy, {'dry-run-user'})` holds an email, a name and a user, and `mask` shows none of their values.
- **The backup:**
  - `backup_sources(toy, tmp_path / 'bk')` returns `{'notes.pdf': <sha256>}`, and the copy's bytes equal the original's;
  - it raises for a `dest` inside the toy repo.
- **A clean first publish,** through `main(['--github-user', 'dry-run-user', '--work', w, '--backup', b, '--repo', str(toy)])` (`--rev` left at `main`):
  - it returns 0;
  - the clone's `publish` branch is one commit with no parent, whose tree equals the toy's `main^{tree}`;
  - its author and committer are both `dry-run-user <dry-run-user@users.noreply.github.com>`, and its message is `SNAPSHOT_MESSAGE`;
  - `git rev-list --count publish` is 1;
  - the toy repo's `state_of` is unchanged; `toy/sources/notes.pdf` and `toy/.superpowers/ledger.md` still exist;
  - the captured output (`capsys`) contains none of "Toy Person", "toy.person@example.test" and "toyuser".
- **Refusals:** each of these returns 1, with a masked problem naming the path, and its output holds no marker value. Each is a toy repo whose `main` tree:
  - holds a file containing "Toy Person";
  - holds one containing "toy.person@example.test";
  - holds one containing a Windows profile path to the toy user's Downloads folder;
  - holds a 6 MB blob;
  - tracks `.superpowers/x.md` (force-added);
  - still tracks `sources/a.pdf`.
- **Stacked publishing:**
  - publish once, and push `publish:main` from the clone to a bare repo in `tmp_path`;
  - a second run with `--parent <that sha> --remote <bare>` builds a snapshot whose only parent is that sha;
  - `--parent` with a sha the remote's `main` doesn't have refuses;
  - `--parent` without `--remote` refuses.
- **The docs scrub's finder:** `main(['--scan-only', '--repo', str(dirty_toy)])` returns 1, and 0 once the hit is removed in a commit.
- **`--rev`:** a toy repo whose `main` still holds a marker hit, with the scrub committed on a branch `side`:
  - `main(['--scan-only', '--repo', str(toy), '--rev', 'side'])` returns 0, while the default (`main`) returns 1;
  - a full run with `--rev side` returns 0, and builds a snapshot whose tree equals `side^{tree}`.
- **No path leaks:** with `os_username` patched to `"leakword"` and `--work` set to `tmp_path / 'leakword-work'`, a full run's output holds "leakword" nowhere. The clone path is printed relative to `--work`, and any marker inside a printed path shows only as its mask.

`tests/unit/deploy-workflow.test.ts`:
- the header names `crew-leader`, `docs/publishing.md`, `sources/` and "public";
- the whole file matches no Pages URL: `/https?:\/\/[^\s)'"\]]*github\.io/i`.

A test in either suite:
- no tracked file matches that Pages URL pattern;
- there is no `README` at the repo root.

The pattern looks for a URL, which is what the Global Constraints forbid, so this plan's own words about a Pages URL need no exception.

- [ ] **Step 2: Run them and see them fail**

Run: `py -m pytest tests/py/test_publish_history.py -q && npx vitest run tests/unit/deploy-workflow.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the tool and `docs/publishing.md`, and edit the workflow header.**
- The tool never prints, logs or writes a marker's value.
- The tests use only the toy values; nothing in the repo holds a real one.
- The tool passes the GitHub identity only through `commit-tree`'s environment, so neither git config is ever changed.

- [ ] **Step 4: The docs scrub, in its own commit**

Run: `py tools/publish_history.py --scan-only --rev plan-3-polish`
Expected: FAIL, listing masked hits by path and line: the OS username inside the profile paths of Plan 1's plan, Plan 2's plan and the spec (the pre-flight count was 6, 1 and 3), and any others it finds.

The spec's line-3 "Owner:" name is no runtime marker (it is neither a commit identity nor `git config user.name`), so the scan won't list it. Edit it by hand, as the Files block says.

Edit each hit as the Files block says. Re-run the importers' tests if a config path changed (`py -m pytest`). Repeat `--scan-only --rev plan-3-polish` until it exits 0. Each run scans the committed tree, so commit the scrub before the last run.

Commit only the scrubbed files, never Step 3's tool, tests or workflow edits. Stage each file `--scan-only` reported, plus the spec, by name. Check `git diff --cached --name-only` lists nothing else. The message holds no personal value:
```bash
git add docs/superpowers/specs/2026-11-09-crew-leader-design.md <each other scrubbed file>
git diff --cached --name-only
git commit -m "docs: no owner name or local profile paths in tracked files" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Dry-run it on this repo, then run the suites**

Run, from Git Bash at the repo root:
```bash
T="$(cygpath -u "$TEMP")/crew-leader-publish-$(date +%Y%m%d%H%M%S)"
git for-each-ref --format='%(refname) %(objectname)' > "$T.refs-before.txt"
git status --porcelain=v1 --ignored > "$T.status-before.txt"
py tools/publish_history.py --github-user dry-run-user --rev plan-3-polish --work "$T/work" --backup "$T/sources-backup"
git for-each-ref --format='%(refname) %(objectname)' | diff - "$T.refs-before.txt" \
  && git status --porcelain=v1 --ignored | diff - "$T.status-before.txt" && echo UNTOUCHED
```
Expected:
- exit 0, and UNTOUCHED;
- the report shows one snapshot with no parent, tree equal to `plan-3-polish^{tree}`, refs and working tree untouched, and no problems;
- `git -C "$T/work/clean" log --format='%an %ae %cn %ce' publish` prints one line, `dry-run-user dry-run-user@users.noreply.github.com dry-run-user dry-run-user@users.noreply.github.com`;
- `sources/` is still in place;
- `git rev-parse main` and `git rev-parse plan-3-polish` are unchanged.

Write the masked report in the ledger, for the controller's publish step. Record the work path only as `$TEMP/crew-leader-publish-<stamp>`, never expanded. Nothing is pushed.

Run: `py -m pytest && npx vitest run`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add tools/publish_history.py tests/py/test_publish_history.py docs/publishing.md .github/workflows/deploy.yml tests/unit/deploy-workflow.test.ts
git commit -m "chore(publish): snapshot publishing for the public crew-leader repo: one noreply commit of main's tree, scanned for personal markers; dry-run in a temporary clone" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: End-to-end flows, baselines and the quiet-host gates

**Files:**
- Create: `tests/e2e/voice.spec.ts`, `tests/e2e/smart.spec.ts`
- Modify:
  - `playwright.config.ts`: the pixel project's `testMatch` becomes `/(run|perf|voice|smart)\.spec\.ts/`;
  - `tests/e2e/screens.spec.ts` and `tests/e2e/seed.ts`;
  - `tests/e2e/perf.spec.ts`: the "every cap at once" annotation (`perf.spec.ts:200`, "…exceeds the localStorage quota; final review item 7") now says that a save at every cap trims old transcripts and retries once (Task 7, D28);
  - `tests/e2e/__screens__/`: new and re-baselined PNGs.

**Interfaces:**
- Consumes: every screen; Plan 2's `seed`, `progressWith`, `checkScreen`, `playRun` and `recordOf`; `softBreaks` (Task 4); `SMART_STORAGE_KEY` (Task 9).
- Produces:
```ts
// tests/e2e/seed.ts
export function fakeSpeech(transcripts: string[], opts?: { error?: string; delayMs?: number }): string
  // an addInitScript source: window.webkitSpeechRecognition whose start() fires onstart, then (delayMs later, 30 by
  // default) one final onresult with the next transcript, or onerror {error}, then onend; abort() cancels a pending result
export function seedSmart(page: Page, s: { on: boolean; key: string; model?: string }): Promise<void>   // localStorage crewleader.smart
```
**`voice.spec.ts`** (both projects; service workers blocked):
1. **A dictated line:** Run start → Voice → Pick by complaint → Giddiness → Take the call.
   - Press "Speak" with the fake transcript "fmv 123 to ops ctr responding to blk 4xx hougang ave 8 for case of elderly male giddiness".
   - The field equals `softBreaks(that, 'Mr Lim')`, and the chat has no new trainee line.
   - Press "Send": the line appears, with a route starting "To Ops Ctr:".
2. **Denied:** the fake error `not-allowed` toasts "Crew Leader can't use the mic. Allow it in Chrome's site settings, or type instead.".
3. **Paused while listening:** with `fakeSpeech([…], { delayMs: 500 })`, Pause while the fake is listening. No text is added after the sheet opens.
4. **Layout:** at 360×780 the composer's field is 160px or wider, and `scrollWidth <= innerWidth`.

**`smart.spec.ts`** (both projects):
- **Setup:** `seedSmart(page, { on: true, key: 'sk-ant-e2e-0000' })`. Then `page.route('**/v1/messages*', …)` records each request and fulfils it with a Messages JSON body:
  - its `content` is `[{ type: 'text', text: JSON.stringify(verdict) }]`;
  - `stop_reason 'end_turn'`;
  - `usage { input_tokens: 900, output_tokens: 40 }`.
1. **A smart credit:** a COPD Coached run, seeded open at step 8 with `playRun` (the canonical lines of steps 1–7). The canned verdict credits `delicate-spine/ask-neck-pain` for sentence 1. The line "Mdm Tan, did you fall? Any ouch at your nape?" then shows "Smart tester" on that line. Its second sentence reads nothing by keywords at current 7 (pre-flight scan), so it is the one sent. The captured request carries:
   - the header `anthropic-dangerous-direct-browser-access: true`, and `authorization` equal to `Bearer ` plus the seeded key (no `x-api-key`; SDK 1.8.0, Task 9 review);
   - a body that holds none of the COPD case's `patient.ic`, `patient.name` or `location`, each read from its case file;
   - `model` `claude-opus-5-5`.
2. **A slow answer:** the route waits 8 s before fulfilling. Within 7 s the line is applied with the keyword route, and the failure toast shows once. A response fulfilled at once with `stop_reason: 'refusal'` behaves the same way (D19).
3. **Offline:** after `context.setOffline(true)`, the same line makes no request, and is applied with the keyword route.
4. **Off:** with `on: false`, no request at all over a 6-line run.

**`screens.spec.ts`:**
- **New baselines:**
  - `run-voice`: Coached, voice mode, the composer with Speak, `fullPage: false`;
  - `pam-history`: three records (a Coached run with 3 faults, a clean Exam run, a drill).
- **Re-baselined on purpose:**
  - `pam-tab`: history replaces Last run;
  - `run-start`: the Answer by radios;
  - `settings`: the Smart tester group, with `.set-line` masked as before.
- **Unchanged:** every other baseline must match.
- **Targets:** `TARGETS` gains `.mic`, `.hist-row` and the Settings key buttons.

- [ ] **Step 1: Write the specs and the seed helpers**

- [ ] **Step 2: Create the baselines**

Stop any stale `vite preview` on :4173 first.

Run: `npx playwright test tests/e2e/screens.spec.ts --project=phone --update-snapshots`
Expected: the 2 new PNGs and the 3 re-baselined ones are written, and every axe, width and target check passes.

Fix any axe violation in its component. Open each PNG beside mockup screen 2 for the mic: the banded key is in the right slot, and the band is a pattern only.

- [ ] **Step 3: Run every Playwright project**

Run: `npx playwright test`
Expected: PASS on both projects.

- [ ] **Step 4: Run the whole suite, then the quiet-host gate**

Run: `py -m pytest && npx vitest run && npm run build && npx playwright test`
Expected:
- everything passes;
- `grep -o "data/cases/" dist/sw.js | wc -l` is 12 or more (11 cases and the index). It counts occurrences: `sw.js` is one minified line, so `grep -c` would give 1.

Run, on a quiet host (below 40%): `npx playwright test tests/e2e/perf.spec.ts --project=pixel --workers=1`
Expected: median 30 ms or less, max 80 ms or less, logged in the ledger.

- [ ] **Step 5: Write the phone-check list in the ledger, then commit**

The ledger lists for the user:
- Plan 2's phone-only checks (final review "Phone-only checks");
- the real mic: permission, offline, background, TalkBack on Speak and "Added to your line.";
- the smart tester with the user's own key, and Test key;
- run history under TalkBack;
- the three new cases' clinical facts.

```bash
git add playwright.config.ts tests/e2e
git commit -m "test(e2e): voice and smart tester flows with fakes, history and voice baselines, quiet-host gates" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Spec coverage (Plan 3 scope)

| Spec item | Task |
|---|---|
| §2 voice input (planned in polish; the mic designed in) | 4, 5, 12 |
| §4 optional smart tester with the user's own Claude API key, entered in Settings | 8, 9, 12 |
| §6.1 PAM tab: run history as strip thumbnails, each opening its debrief | 6, 12 |
| §6.1 Run start: Answer by, typing or voice | 5 |
| §6.1 Settings: an optional Claude API key | 9 |
| §6.2 the grading engine "designed so the later Claude API tester can replace the matcher behind the same interface" | 8 (the `Grader` seam, unchanged) |
| §6.3 more cases, from the notes' protocols, masked, `reviewed: false`, all clinical content marked for review | 3 (step 18 keyed on the case's own plan, so a medical Load & Go grades right) |
| §6.6 per run: the transcript kept for the newest runs, trimmed under quota | 7 |
| §7 copy: No runs; Run left open; Content failed to load (the run row); new copy in the same voice | 5, 6, 7, 9 |
| §8: real buttons and links, aria labels, `role="status"` for new live text, the strip's text summary (in the history link), 44px targets, no horizontal scroll | 5, 6, 9, 12 |
| §9: the banded mic key; the band never a status | 5, 12 |
| §10 phase 4: more cases, voice input, run history, the optional Claude API tester | 3–9 |
| §10 deploy needs the user's go-ahead (user, 2026-11-15: public repo `crew-leader`, after Plan 3) | 11 (a scanned dry run; the publish is the controller's later step) |
| §11 privacy: unlisted; the smart tester sends only D17's fields | 8, 9, 12 |
| §2 anti-goals: a correct answer flagged for its wording (voice never sends; the smart tester; Task 1–2 carries); a stray tap losing a run (Undo on replace) | 1, 2, 4, 5, 7, 8 |
