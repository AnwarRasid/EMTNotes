# Crew Leader: design

Date: 2026-11-09. Owner: the trainee (SCDF FMV EMT). Status: design locked, ready for planning.

The source brief is `EMT PAM Practice Site – Build Brief.pdf`, the brief PDF in Downloads. This document settles the brief's open questions and adds everything decided since. Where the two differ, this document wins.

## 1. Intent

Practising the PAM (primary assessment and management) test needs a second person to play the tester, and there usually isn't one. Theory revision is spread across several PDFs with no way to self-test. Crew Leader lets one trainee, alone on a phone between duties and often at night, do three things:

1. Run a full PAM primary survey against a simulated tester, patient, buddies, caller and Ops Ctr, then get a debrief on what to fix.
2. Drill the 407 official theory questions with the official answers and a one-line reason for each.
3. Read their own EMT survey notes, highlights included, linked to the PAM steps and questions that use them.

Success: a full run (activation to standby call) works one-handed in about 20 minutes. The tester never volunteers the next step. The debrief names missed steps, out-of-order steps and wrong key phrases. Every question shows the official answer and a reason. Progress stays on the device.

## 2. Goals, non-goals, anti-goals

**Goals:**
- the PAM simulator for medical and trauma cases;
- the theory quiz;
- the notes reader;
- a debrief per run;
- local progress;
- an installable offline PWA;
- a repeatable PDF import.

**Non-goals for now:**
- the secondary survey as a simulated phase (the notes reader still covers it);
- multiplayer;
- accounts or cloud sync;
- an instructor dashboard;
- voice input (planned in polish; the mic button is designed in, see 6.3).

**Anti-goals** (failure even if it technically works):
- the tester leaks the next step or the step order in Exam mode;
- a correct answer gets flagged because of the trainee's wording (unfair flags destroy trust);
- a stray tap loses a run in progress;
- bright screens at night;
- official SCDF logos, crest or wordmark anywhere;
- content that departs from the trainee's own notes.

## 3. Constraints

- **Phone and use:** mobile-first, one-handed, 375px wide as the baseline; desktop is a bonus.
- **Theme:** dim theme only; no light mode.
- **Hosting and data:** a static site with no backend, on GitHub Pages under the user's account. Content lives in JSON, so cases and questions can change without code changes.
- **Imports:** the question-bank PDFs are still being added to, so the import must be repeatable.
- **Content source:** the trainee's notes, not general EMT protocols from elsewhere.
- **Machine:** Node 24, Python 3.13 via `py` (pypdf only; PyMuPDF must be installed) and git. The `gh` CLI is not installed.

## 4. Decided by the user

| Topic | Decision |
|---|---|
| Free-text grading | Keyword and synonym rules now (free, offline). Later, an optional "smart tester" using the user's own Claude API key, entered in Settings. |
| Notes | The full notes go in as a searchable reader section. |
| Hosting | GitHub Pages, installable PWA, works offline. |
| Design language | **EMS night shift**, with the ambulance-cabin background (section 9). |
| Inline flags | Coached mode flags inline; Exam mode saves everything for the debrief. Exam mode is the brief's "strict mode". |

## 5. Sources

All the source files are in the Downloads folder. Copy them into the repo under `sources/`.

- `EMT Medical & Trauma Question Bank 2017.pdf`:
  - part A: Q1–92, options a–d;
  - part B: Q1–256, options A–D, with Q175–176 missing from the numbering.
- `HMLS Question Bank for EMT-CT, MOCT & HRCT-C.pdf`: Q1–61.
- `EMT_Survey_Notes.docx`: the latest notes, 20 sections. Its highlights, bold and underline carry meaning. Use this file, not the PDF, for the reader.
- `EMT_Survey_Notes.pdf`: a copy of the docx, used for cross-checking only.
- `EMT SURVEY  NOTES.pdf`: the original scanned sheets. Reference only.

## 6. The product

### 6.1 Information architecture

There are four tabs: **Today**, **PAM**, **Quiz** and **Notes**. Settings opens from a button on Today.

**Focus screens** hide the tab bar and share one header layout: an exit button, the title with a sub-line, and a timer or counter. Exits are Pause for a run, ✕ elsewhere. The focus screens are:
- Run start
- Run
- Debrief
- Quiz session
- Quiz result
- Notes section reader

**Today:**
- A resume row, if a run or quiz is open.
- The headline is the most common recent mistake, with a drill button that starts a run partway through, around those steps.
- The last-run card shows the compact run strip and opens the debrief.
- Quiz progress per bank, plus "Review N you got wrong".
- Continue reading.

**First-run state:** a short checklist that ticks itself off (read the PAM steps section, do a Coached run, do an Exam run), plus an empty run strip showing only its time limits.

**PAM tab:**
- "New case".
- Run history as strip thumbnails; each opens its debrief.

**Run start:**
- Case: random and hidden by default, or pick by complaint.
- Mode: Coached or Exam.
- Answer by: typing (voice later).
- A "The clock" card showing the 3:00 RBS limit and the 20:00 limit, and the last 3 run times.
- "Take the call".

**Quiz tab:**
- Mode picker:
  - Practice: pick bank and topic; instant feedback.
  - Test: 20 or 50 questions, score at the end, then review.
  - Review wrong: questions answered wrong, until each is answered right twice.
- Bank progress.

**Notes tab:**
- 20 sections, with highlight counts, search and a last-read marker.
- The section reader has:
  - a Full text / Highlights only switch;
  - cross-links to the PAM steps and quiz questions that use the section;
  - previous and next section at the bottom;
  - a text-size control.

**Settings:**
- text size;
- haptics on or off;
- the offline content version;
- an optional Claude API key (later phase);
- reset progress, with a typed confirmation.

**Shared link key:** every PAM step and every quiz question carries a `notesRef`, a section ID with an optional anchor. Debrief fixes, quiz explanations and notes cross-links all use this one key.

### 6.2 PAM simulator

**Step flow.** Use the brief's 19-step table (pages 4–7) as the source for `steps.json`: each step's must-hit points, what the site replies with, and accepted variations. The notes refine it:
- Head grip starts at Introduction, not Approach.
- In Approach, the order is: sound out, catastrophic bleeding, hazards, never move the head.
- MOI must include "suspected".
- Breathing rate and quality is only ever "fast and shallow" or "slow and deep".
- The tester gives ETA as the time left on the 20 minutes.

**Roles.** The site plays:
- **Ops Ctr:** radio acknowledgements.
- **Caller:** casual Singapore English, using only what the case says.
- **Patient:** in character; a breathless or confused patient speaks in short, broken lines.
- **Head buddy and arm buddy:** report readings when told to check them.
- **Tester:** gives only findings that are asked for, and flags mistakes.

**Modes:**
- **Coached:**
  - a 19-segment step bar;
  - inline flags under the line that caused them;
  - all vital tiles shown, with dashes until reported;
  - a step-list sheet: the tap-mode fallback, a docked non-modal bottom sheet that replaces the composer and sends the chosen step as the trainee's line.
- **Exam:**
  - no step bar and no inline flags; everything goes to the debrief;
  - vital tiles appear only once reported;
  - no step list.

**Clock:**
- Before Approach it shows `--:--` and "Starts at Approach". It starts on the Approach patient step.
- Under the time, a time-limit line reads "RBS by 3:00", then "RBS 2:41 ✓", or "RBS limit passed" in the warning colour.
- At 15:00, "5 min left"; at 18:00 the warning colour; past 20:00 it shows `+0:42` and the run continues.
- The clock pauses while the Pause sheet is open and while the app is in the background.
- It is computed from a stored start time, so it survives reloads.

**Interpretation line.** Under each trainee bubble, a small grey line shows what the simulator understood, for example "To arm buddy: SpO2". When the addressee is unclear, ask "Who's this for? Tester, patient or buddy". Every flag has "Not what I meant"; a disputed flag is logged and left out of the score.

**Vitals rail.** Four tiles: SpO2, PR, RR and BP. More appear as reported (temperature, hypocount, GCS). Readings are always cabin white, never a status or "correct" colour, and never shown as alarms. Judging them is the trainee's job.

**Pause and leaving:**
- The Pause button sits at the top left, and system back opens the pause sheet.
- Sheet rows: Resume (primary, nearest the thumb), Restart case, Mode (read-only mid-run), End run.
- End asks to confirm: "End run at 09:40? Steps 15 to 19 count as missed." Then it goes to the debrief.
- The run is saved after every line, so Today can offer to resume.
- A wake lock is held during runs.

**Debrief:**
- **Heading:** the verdict ("3 to fix") with the case line.
- **Run strip replay:** a "Call" segment for untimed steps 1–4, then the 0–20 min trace (one spike per step), with numbered markers matching the fix list.
- **Figures:** Time /20:00, RBS done /3:00, Steps /19.
- **Fix list:** ordered Missed, then Order, then Phrase. Each row has a number, a status chip with a word, the step, and a link to notes.
- **Went well:** a short list.
- **Case record:** laid out like the Ambulance Case Record, filled only from what the trainee asked for and did. It covers complaint, MOI, oxygen, ECG, hypocount, position, decision, a vitals table with times, and the standby call transcript with SRACIE letter slots lit as covered.
- **Actions:** "New case" and "Drill the fixes".

**Grading engine (keyword phase).** Each step's `mustHit` points have:
- keyword sets, with synonym groups and stemmed forms;
- negative keywords;
- accepted variations, per the brief's examples.

The engine matches the trainee's line against:
1. intents: who is addressed and which finding is asked for, mapped to case findings;
2. the current and nearby steps' must-hit points, for grading and order detection.

It ships with a fixture file of paraphrases per must-hit point, used as unit tests. It is designed so the later Claude API tester can replace the matcher behind the same interface.

### 6.3 Cases

`cases/*.json`, following the brief's case shape and the brief's two example cases:
- COPD (Ang Mo Kio);
- hypoglycaemia (Hougang).

Write 6 more from the notes' protocols:
- chest pain;
- CCF;
- asthma;
- arresting haemorrhage (trauma);
- a fall with a spinal concern (trauma);
- RTA (trauma).

Every case is unstable (PAM rule). Names, addresses and IC numbers are invented and masked (S54xxxxxA). All clinical content is marked for the user to review before release.

### 6.4 Theory quiz

**Import** (`tools/import_questions.py`, PyMuPDF), run again whenever a newer PDF arrives:
- Read the text spans with their font flags and the drawn underlines. The official answer is the option that is **bold and/or underlined**. Accept bold-only, because part B switches to bold-only from about Q214.
- Keep question and option wording as written. Fix obvious typos only, and log every change to `tools/import-log.md`.
- Stable IDs: `mt-a-q001…q092`, `mt-b-q001…q256` (gaps kept) and `hmls-q001…q061`.
- Tag each question with its source and topic. Topics: respiratory, cardiac, trauma, burns, shock, neuro, diabetic, drugs, airway, assessment, IV, ops and conduct, and HMLS.
- Shared scenario passages ("Answer questions 11–15…", "Scenario 1…7") attach to each of their questions.
- Write `needsReview` with a reason for any question with zero or more than one marked answer, a missing option, duplicate option labels, duplicate option text, or a dependency on an image. Known cases now:
  - B-Q168: two options labelled "A";
  - B-Q169: identical options B and C;
  - B-Q197–199: depend on an ECG image (crop it from the PDF into `public/img/`);
  - B-Q207 and B-Q208: the official answers contradict each other (simple face mask vs BVM reasoning).

  Questions flagged for review are shown, with a small "Under review" note, until the user clears them.
- **Conflicts with the notes:** for example B-Q232's pyrexia range against the notes' 37.5–38.4 °C. Keep the official answer, and have the explanation say what the notes say.

**Explanations:** one line in plain language, written from the notes and citing `notesRef`. Questions outside the notes' scope get a plain-language reason with no `notesRef`. All 407 are written at build time and marked as generated, for the user to spot-check.

**Behaviour:**
- Options shuffle every time, and answers match by ID.
- Practice shows the trainee's pick ("Yours") and the official answer ("Answer") side by side, in words and colour, then the explanation with its notes link.
- Test is scored at the end.
- Review wrong runs until each question is answered right twice.

### 6.5 Notes reader

`tools/import_notes.py` (Python standard library: zipfile and ElementTree) turns the docx into `notes.json`:
- sections and headings;
- paragraphs keeping their **highlight**, bold, underline and italics;
- lists;
- tables;
- "Remark" and "Added note" boxes;
- images, extracted to `public/img/notes/`.

Search covers all text. "Highlights only" shows just the highlighted passages, each with its heading for context.

### 6.6 Progress (on the device)

- **Per run:** case ID, mode, date, time used, step timings, missed steps, order flags, phrase flags, disputes, and the transcript.
- **Per question:** times seen, times right, last answered, and the right-twice counter.
- **Notes:** last-read section.

Stored in localStorage with two save slots, so a bad write rolls back to the last good one. Call `navigator.storage.persist()`. Include a schema version.

## 7. States and copy

Use this copy. The builder writes any other states in the same plain voice:

- **No runs yet:** "No runs yet. A run takes about 20 minutes. The clock starts when you say Approach." [Start your first run]
- **Review empty:** "Nothing to review yet. Questions you get wrong will collect here." [Start practice]
- **Review cleared:** "All 12 cleared. New mistakes will show up here." [Practise 20 more]
- **Clean debrief:** "Nothing to fix this run."
- **Run left open:** "Run in progress: {case}, step {n}, {mm:ss} used. The clock paused when you left." [Resume] [Discard]
- **First install:** "Ready to use offline." (toast)
- **Offline:** "You're offline. Everything still works." (shown once)
- **Update:** "A new version is ready." [Reload]. Never shown during a run.
- **Corrupt save:** "Some progress couldn't be read. Your last good save, from {time}, is back." If there is no backup: [Try again] [Start fresh].
- **Content failed to load:** "The question bank didn't load. It isn't saved on this phone yet. Connect once, then try again." [Try again]
- **Loading:** show nothing under 300 ms; after that, a skeleton at the final size.

## 8. Accessibility and phone details

- Real buttons and links.
- aria labels on icon buttons, and `aria-current` on the active tab.
- The chat has `role="log"` with hidden speaker prefixes. Flags are `role="status"`.
- The clock is `role="timer"`, with time limits announced through a polite live region.
- Quiz options are a radio group.
- The run strip is `role="img"` with a text summary.
- Text contrast is 4.5:1 or better; non-text contrast 3:1 or better. Track and empty-segment fills must be visible.
- Visible focus rings.
- 44px targets; 16px body text and inputs (stops iOS zooming).
- `min-height`, not fixed heights.
- `lang="en-SG"`.
- `prefers-reduced-motion` and `prefers-contrast: more`.
- Run layout:
  - a `100dvh` grid with `viewport-fit=cover` and `interactive-widget=resizes-content`;
  - a visualViewport keyboard fix for iOS;
  - safe-area padding;
  - the chat is the only scroller, with `overscroll-behavior: contain` and stick-to-bottom within 80px, otherwise a "↓ N new" pill.
- Hover styles only under `(hover: hover)`, with a transparent tap highlight.

## 9. Visual design: EMS night shift

The approved mockup is the reference. Match it: `.superpowers/alts/scdf.fragment.html`, with the cabin background. The map version is kept as `scdf-map.fragment.html`, but it is not chosen.

**Concept:** the back of an SCDF ambulance at night. The ground is a dim graphite cabin: overhead locker seams, a dimmed LED strip, and outside light that changes by screen (street-lamp amber on Today, red and blue beacons on a run, quiet on Debrief and Quiz). The scene fades to solid dark behind all content.

**Identity:**
- **Orange-and-yellow chequered band** (#E2711F / #E3BC2B, from the user's description; the real colours are still to be confirmed). It appears along the top edge of the run screen, under the brand mark, on the lower edge of the primary key, over the debrief verdict, and as chevrons at the 20:00 limit.
- **Star of Life** (blue #3381D4), drawn from scratch, in the brand mark.
- **No SCDF logo, crest or wordmark.**

**Status rule:** the band is always a two-colour pattern and never means status. Status is always a solid chip with !!! or !! and a word:
- magenta #F26BB0: missed or wrong;
- lavender #B3A1FF: order or phrase;
- green #7DD6A9: done or right.

**Other colours:**
- Ambulance white #C8CFCB: the one action key.
- Cabin white #EEF1EC: text and all vitals.

**Taken from the Monitor language:**
- the vitals parameter tiles;
- large tabular figures;
- the run strip as a trace with one spike per step;
- the !!! and !! priorities;
- soft-key style actions.

**Type:** Barlow, Barlow Semi Condensed and Barlow Condensed.

**Motion** (from the motion review):
- Tokens: press 90 ms, fast 160 ms, base 220 ms, exit 140 ms, screen 280 ms, reveal 700 ms, stagger 60 ms. Easing enter `cubic-bezier(.22,1,.36,1)`; easing exit `cubic-bezier(.4,0,1,1)`.
- Readings arrive as "– –" settling to a value. No count-ups.
- Debrief reveal: the strip draws once (700 ms or less), then the figures, then the fixes. A tap skips it. Total 1.1 s or less.
- Quiz feedback: the right answer's ring draws in; one small shake on a wrong pick.
- Never animate the timer.
- Reduced motion drops movement and keeps fades of 150 ms or less.
- Haptics through `navigator.vibrate` on Android only, behind the Settings toggle.

## 10. Technical approach

These are my calls. The user did not specify them.

- **Stack:** Vite and TypeScript with Preact. Plain CSS with tokens; no UI kit. `vite-plugin-pwa` for the service worker, with update prompts held until no run is active.
- **Layout:**
  - `src/` for the app;
  - `public/data/` for steps.json, cases/, questions.json and notes.json;
  - `tools/` for the Python importers and their logs;
  - `sources/` for the PDFs and docx;
  - `tests/`.
- **Tests:**
  - Vitest for the grading engine (the paraphrase fixtures), the clock logic, the save and restore with rollback, and quiz scoring;
  - pytest for the importers, with known questions checked against their marked answers;
  - Playwright screenshots at 390px for the main screens.
- **Deploy:** a GitHub Actions workflow builds to GitHub Pages. The first deploy needs the user's go-ahead (the brief requires sign-off before anything hard to undo).
- **Build phases (from the brief):**
  1. Data: steps, cases, the question import with its review list, the notes import.
  2. Theory quiz and notes reader, shipped first because neither needs free-text grading.
  3. PAM simulator.
  4. Polish: more cases, voice input, run history, the optional Claude API tester.

## 11. Decisions from the builder check

### Decided by the user

**Late steps.** A point done after its own step counts as an **Order** fault. A point never done by the end of the run counts as **Missed**. In Coached mode, the trainee gets a nudge flag once they are 2 steps past a point without doing it. The final classification happens at the end of the run, so a nudged point done later becomes Order. "Steps N/19" counts steps with no fault of any kind: Missed, Order or Phrase.

**Detail of physical actions: every part must be said.**
- **RBS:** each region, in order: head, neck, chest, abdomen, pelvis, lower extremities, upper extremities, back. Eye contact is mentioned, and "any abnormalities noted?" is asked.
- **Auscultation:** all 6 points, plus the 3 questions.
- **DTBL:** each letter.
- **NTUCP:** each item.
- **Equipment:** B.B.O.L.T.Z., or "4 in 1" plus LSU.
- **Standby call:** each SRACIE element.

One line may cover several parts (for example "RBS head, neck, chest, abdomen, pelvis, legs, arms, back, with eye contact"), so a run still fits 20 minutes one-handed. Missing parts are listed by name in the debrief.

**Privacy: unlisted and hidden from search.** Use a `noindex` meta tag on every page, a `robots.txt` that disallows everything, and no links to the site from anywhere public. The question banks and notes ship with the site, so anyone who has the link can see them.

### My calls (the user can change any of these)

- **Trauma extras** are graded as must-hit points within their normal step, and only when the case calls for them:
  - bleeding control (direct pressure → pressure dressing → C.A.T., Expose & Examine) in Approach, when there is catastrophic bleeding;
  - C-collar (ENSAPA) in Delicate Spine when there's neck pain, or after RBS;
  - modified jaw thrust in Airway, when spinal;
  - realign and distal pulse checks, and immobilisation instructions, after RBS;
  - Load & Go at the Decision point.

  The run stays at 19 steps.
- **Unconscious branch:** the first 8 cases are all conscious, because the notes say test patients usually are. The step schema leaves room for the U branch (fast-check A, B, C, then CPR or rescue breathing, and OPA) in a later phase.
- **Readings change over the run:**
  - each case defines vitals by phase: on room air, then after the right oxygen;
  - the wrong mask or flow gives no improvement, and the debrief notes it;
  - buddies give new readings when asked, or every 5 minutes on the run clock once told to "reassess every 5 mins";
  - the case record's vitals table shows each reading's time.
- **Drills:**
  - a drill starts one step before the target step;
  - earlier steps are filled in from the case data, with their findings already known;
  - drills are untimed (no RBS limit) and labelled "Drill";
  - they are left out of run history stats, the last-3 times and the Today headline;
  - "Drill the fixes" chains one short drill per fix, in run order.
- **Tap mode:** a step picked from the step list counts as covered and plays its canonical replies. Each step has one canonical line. The step is marked "tapped" in the debrief and left out of stats.
- **Review flags and re-imports:**
  - explanations, topic tags and review flags written at build time live in `public/data/overrides.json`, keyed by question ID, with a hash of the source text;
  - re-importing never overwrites that file;
  - if a question's source text or answer changes under the same ID, its explanation is flagged `needsReview`;
  - the trainee can dismiss an "Under review" note in the app, saved on the device.
- **Sources:** `EMT Survey Notes-1.pdf` (4 Nov) is out of date; ignore it. The docx has only one highlight colour (yellow), so the reader needs one dim-theme highlight style.

## 12. Left to the builder

Exact component breakdown, file names inside `src/`, synonym lists, the wording of in-character replies within each case's facts, the topic tagging for each question, and the skeleton layouts.
