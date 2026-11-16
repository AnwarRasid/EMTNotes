# Crew Leader Plan 1 of 3: Foundation, Data, Theory Quiz and Notes Reader. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an installable, offline, dim-theme PWA with the four-tab shell, the Theory quiz over all 407 official questions with a one-line explanation each, the Notes reader, Today (first-run state), minimal Settings and on-device progress. Underneath sits the data layer that Plan 2's PAM simulator plugs into: importers, `steps.json`, and the case schema with two cases.

**Architecture:** Python importers turn `sources/` into deterministic JSON and images under `public/data/` and `public/img/`, using PyMuPDF for the PDFs and the standard library for the docx. Hand-written content (`steps.json`, `cases/`, `overrides.json`) sits beside the generated files, and re-imports never touch it. A static Vite + TypeScript + Preact app loads the JSON, validates it with valibot schemas that also serve as the TypeScript types, and keeps progress in two localStorage slots. vite-plugin-pwa precaches the app and all data, so everything works offline after the first visit.

**Tech Stack:**
- Python 3.13 with PyMuPDF and pytest.
- Node 24 with Vite 8, TypeScript 6 and Preact 10.
- valibot, vite-plugin-pwa (Workbox) and @fontsource Barlow.
- Vitest with jsdom and @testing-library/preact.
- Playwright with @axe-core/playwright.

**Spec:** `docs/superpowers/specs/2026-11-09-crew-leader-design.md`. It is read with the brief, `EMT PAM Practice Site – Build Brief.pdf` in Downloads: the step table is on pages 4–7, the example cases on pages 8–9 and the data model on pages 10–12. Where the two differ, the spec wins.

**Scope:**
- **In:**
  - spec §5 and §6.1 (shell, Today first-run/empty, Quiz, Notes, minimal Settings);
  - §6.2 data only (`steps.json`);
  - §6.3 (schema and the COPD and hypoglycaemia cases);
  - §6.4, §6.5 and §6.6;
  - §7 copy for these screens;
  - §8, the §9 tokens and §10;
  - §11 overrides, privacy, review flags and sources.
- **Out, Plan 2:** the simulator engine, Run start, Run and Debrief screens, the grading matcher and its paraphrase fixtures, the other 6 cases, drills, tap mode, run history and the Today headline.
- **Out, Plan 3:** polish, voice input and the Claude API tester.

## Global Constraints

**Product and platform**
- **Platform:** mobile-first and one-handed, with 375px as the baseline; desktop is a bonus. Pages never scroll sideways at 375px, and Playwright checks run at 390px.
- **Theme:** dim theme only, no light mode. `<meta name="color-scheme" content="dark">`; `body` has an explicit `var(--c-bay)` background.
- **Hosting:**
  - a static site with no backend, on GitHub Pages;
  - Vite `base: './'` plus hash routing (`#/quiz`), so any Pages subpath works offline;
  - content lives in JSON under `public/data/`.
- **Privacy:**
  - `<meta name="robots" content="noindex, nofollow">` in `index.html`;
  - `public/robots.txt` is exactly `User-agent: *\nDisallow: /\n`;
  - no links to the site anywhere.

**Visual identity**
- **No SCDF marks:** no SCDF logo, crest or wordmark anywhere.
- **Band:** the band (#E2711F / #E3BC2B) is always a two-colour pattern and never means status.
- **Status:** status is always a solid chip with `!!!` or `!!` and a word:
  - magenta #F26BB0 for missed or wrong;
  - lavender #B3A1FF for order or phrase;
  - green #7DD6A9 for done or right.
- **Other colours:**
  - ambulance white #C8CFCB is the one action key on a screen;
  - cabin white #EEF1EC is used for text;
  - Star of Life blue is #3381D4.
- **Type:**
  - Barlow, Barlow Semi Condensed and Barlow Condensed, self-hosted from @fontsource latin subsets so they work offline;
  - all type sizes in `rem`, so the text-size setting scales everything;
  - the mockup's px sizes divide by 16.
- **Motion:**
  - tokens: press 90 ms, fast 160 ms, base 220 ms, exit 140 ms, screen 280 ms, reveal 700 ms, stagger 60 ms;
  - easing: enter `cubic-bezier(.22,1,.36,1)`, exit `cubic-bezier(.4,0,1,1)`;
  - `prefers-reduced-motion: reduce` drops movement and keeps only fades of 150 ms or less;
  - haptics use `navigator.vibrate` on Android only, behind the Settings toggle.

**Accessibility (§8)**
- **Controls:**
  - real `<button>` and `<a>` elements;
  - `aria-label` on icon buttons;
  - `aria-current="page"` on the active tab;
  - quiz options are a radio group.
- **Contrast:** text 4.5:1 or better; non-text 3:1 or better.
- **Focus and touch:**
  - visible focus rings;
  - targets of 44px or more;
  - body text and inputs at 16px;
  - `min-height`, never fixed heights.
- **Document:**
  - `<html lang="en-SG">`;
  - honour `prefers-reduced-motion` and `prefers-contrast: more`;
  - hover styles only inside `@media (hover: hover)`;
  - `-webkit-tap-highlight-color: transparent`;
  - safe-area padding;
  - viewport `width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content`.

**Content and copy**
- **Copy:**
  - use the §7 strings verbatim wherever this plan quotes them;
  - write any other state in the same plain voice;
  - loading shows nothing for 300 ms, then a skeleton at the final size.
- **Content source:**
  - content follows the trainee's notes, not outside protocols;
  - question and option wording is kept as written, except the typo fixes listed in `tools/import_config.json`, each logged to `tools/import-log.md`;
  - case clinical content carries `"reviewed": false`.

**Importers and Python**
- **Determinism:** importers are deterministic: the same sources produce byte-identical output, with no timestamps.
- **Hand-written files:** re-imports never write `public/data/overrides.json`, `public/data/steps.json` or `public/data/cases/`.
- **Python:**
  - Python 3.13 via `py`;
  - every file read and write passes `encoding="utf-8"` (the Windows default is cp1252);
  - JSON is written with `ensure_ascii=False, indent=1` and a trailing newline.

**Stack pins**
- **Runtime:**
  - `preact@^10.29.8`; not 11, because 11.0 is six weeks old and the preset and testing library are proven on 10;
  - `valibot@^1.5.0`;
  - `workbox-window@^7.4.1`;
  - `@fontsource/barlow`, `@fontsource/barlow-semi-condensed` and `@fontsource/barlow-condensed`, all `@^5.3.0`.
- **Build:**
  - `vite@^8.3.0`;
  - `@preact/preset-vite@^2.10.6`;
  - `typescript@~6.0.3`;
  - `vite-plugin-pwa@^1.3.0`.
- **Test:**
  - `vitest@^4.1.12`;
  - `jsdom@^30.1.3`;
  - `@testing-library/preact@^3.2.6`;
  - `@playwright/test@~1.64.1`;
  - `@axe-core/playwright@^4.13.0`.
- **Python:** `pymupdf>=2.1,<3`, `pytest>=9.2,<10`.

**Git, hook and Plan 2 seams**
- **Git:**
  - the repo starts with `git init -b main`; all work goes on branch `build/plan-1`;
  - each task ends with a commit whose message ends with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`;
  - no remote and no push;
  - the deploy workflow is written but never triggered. The first deploy needs the user's go-ahead.
- **Guard hook:** a local hook may block the first creation of each new file. It asks what calls the file, whether anything else serves the same purpose, what data schema the file has, and the user's words. The user's words are "go": the user approved the design and asked for the build. Answer from this plan's Interfaces blocks and retry.
- **Plan 2 seams:** Plan 2 builds on these names. Do not rename or remove:
  - `ROUTES`, `SCREENS`, `Progress.runs` and `Progress.runOpen`;
  - the step and must-hit ids, the case schema;
  - the `RunStrip` geometry (`timeToX`).

## Review Focus

1. **A fast double tap on Check or Next.**
   - **Expected:** one answer is recorded. Stats, the review counter and the score each move once.
   - **Tests:** Task 14 (`check` is a no-op once checked) and Task 17 (a double click on Check).
2. **Storage that is full or blocked** (private mode or quota).
   - **Expected:** a save fails without throwing, the last good slot stays intact, and the app keeps working in memory.
   - **Tests:** Task 12.
3. **A corrupt save with no backup.**
   - **Expected:** nothing writes to either slot until the trainee taps Try again or Start fresh, so Try again can still work after the problem clears.
   - **Tests:** Task 12.
4. **Content that changes between visits**, for example when a re-import rewrites or drops questions.
   - **Expected:**
     - an open quiz resumes without the vanished questions and reshuffles any question whose options changed;
     - counts ignore stats for vanished IDs;
     - an explanation whose source changed shows "Under review".
   - **Tests:** Tasks 13 and 14.
5. **The largest text size at 375px.**
   - **Expected:** wide notes tables (the 4-column hospital-code table in section 2) and long quiz options never make the page scroll sideways. Tables scroll inside their own box.
   - **Tests:** Tasks 17 and 19 (Playwright).

---

## File structure

```
emt-pam/
  .gitignore .gitattributes package.json tsconfig.json vite.config.ts playwright.config.ts
  index.html pyproject.toml requirements-dev.txt
  sources/                      the 3 source files (copied, never edited)
  tools/
    qbank_pdf.py                PDF -> raw questions (spans, bold, underlines, images)       [T2]
    import_questions.py         raw -> questions.json, review flags, fixes, ECG crop, log     [T3]
    import_config.json          hand-verified import facts: scenario ranges, image groups, typo fixes [T3]
    import-log.md               generated by every question import                           [T3]
    notes_docx.py               docx XML primitives: runs, lines, headings, slugs              [T4]
    import_notes.py             docx -> notes.json + public/img/notes/                         [T5]
    overrides_stub.py           adds empty overlay entries for new IDs, never edits existing  [T9]
    make_icons.mjs              renders PWA icon PNGs from icon.svg with Playwright           [T21]
  public/
    robots.txt
    data/ questions.json notes.json (generated) | steps.json overrides.json cases/ (hand-written)
    img/q/  img/notes/  icons/
  src/
    main.tsx env.d.ts
    styles/ tokens.css base.css components.css
    data/   schema.ts (valibot schemas = types) notesRef.ts load.ts questions.ts
    progress/ types.ts slots.ts store.ts hooks.ts index.ts
    quiz/   engine.ts useQuiz.ts QuizTab.tsx QuizSetup.tsx QuizSession.tsx QuizResult.tsx OptionList.tsx Feedback.tsx
    notes/  text.ts NotesTab.tsx SectionReader.tsx Blocks.tsx
    today/  Today.tsx FirstRun.tsx
    pam/    PamTab.tsx
    settings/ Settings.tsx
    app/    routes.ts App.tsx TabBar.tsx FocusHeader.tsx Scene.tsx PwaPrompts.tsx
    ui/     Keys.tsx Panel.tsx StatusChip.tsx BrandMark.tsx Icon.tsx Skeleton.tsx toast.tsx RunStrip.tsx
    lib/    haptics.ts format.ts rng.ts offline.ts
  tests/
    py/     pytest for every tool
    unit/   Vitest (pure logic, components, data integrity)
    e2e/    Playwright (390px, offline, axe, screenshot baselines in e2e/__screens__/)
  .github/workflows/deploy.yml  manual-only Pages deploy                                    [T23]
```

---

### Task 1: Project foundation

**Files:**
- Create:
  - `.gitignore`, `.gitattributes`;
  - `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`;
  - `public/robots.txt`;
  - `src/main.tsx`, `src/env.d.ts`, `src/styles/tokens.css`, `src/styles/base.css`;
  - `pyproject.toml`, `requirements-dev.txt`;
  - `sources/`, holding 3 copied files.
- Test: `tests/unit/foundation.test.ts`, `tests/py/test_sources.py`

**Interfaces:**
- Produces:
  - **npm scripts:**
    - `test` (`vitest run`);
    - `typecheck` (`tsc --noEmit`);
    - `build` (`tsc --noEmit && vite build`);
    - `preview` (`vite preview --port 4173 --strictPort`);
    - `e2e` (`playwright test`);
    - `import:questions` (`py tools/import_questions.py`);
    - `import:notes` (`py tools/import_notes.py`).
  - **CSS tokens:** the custom properties in Step 6.
  - **Globals:** `__APP_VERSION__` and `__BUILD_DATE__` (`string`), declared in `src/env.d.ts` and defined in `vite.config.ts` from `package.json` `version` and the build date (`YYYY-MM-DD`).
  - **Vitest:** `environment: 'jsdom'`, `globals: true`, `include: ['tests/unit/**/*.test.{ts,tsx}']`, configured in `vite.config.ts`.
  - **pytest:** `pythonpath = ["tools"]` and `testpaths = ["tests/py"]` in `pyproject.toml`.

- [ ] **Step 1: Start the repo**

`.gitignore`:
```
node_modules/
dist/
.superpowers/
.taste-skill/
test-results/
playwright-report/
coverage/
__pycache__/
.pytest_cache/
*.pyc
```
`.gitignore` excludes `.taste-skill/` because it holds a design tool's scratch file, like `.superpowers/`.

`.gitattributes`:
```
* text=auto eol=lf
*.png binary
*.pdf binary
*.docx binary
*.woff2 binary
```
```bash
cd "$HOME/emt-pam" && git init -b main
git add .gitignore .gitattributes docs
git commit -m "docs: add Crew Leader design spec and Plan 1" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git switch -c build/plan-1
```

- [ ] **Step 2: Copy the sources**

```bash
mkdir -p sources
cp "$HOME/Downloads/EMT Medical & Trauma Question Bank 2017.pdf" sources/
cp "$HOME/Downloads/HMLS Question Bank for EMT-CT, MOCT & HRCT-C.pdf" sources/
cp "$HOME/Downloads/EMT_Survey_Notes.docx" sources/
```
Copy only these three. Spec §5 and §11 make the notes PDFs reference-only, and `EMT Survey Notes-1.pdf` is out of date.

- [ ] **Step 3: Install tooling**

```bash
npm init -y
npm install preact@^10.29.8 valibot@^1.5.0 workbox-window@^7.4.1 @fontsource/barlow@^5.3.0 @fontsource/barlow-semi-condensed@^5.3.0 @fontsource/barlow-condensed@^5.3.0
npm install -D vite@^8.3.0 @preact/preset-vite@^2.10.6 typescript@~6.0.3 vite-plugin-pwa@^1.3.0 vitest@^4.1.12 jsdom@^30.1.3 @testing-library/preact@^3.2.6 @playwright/test@~1.64.1 @axe-core/playwright@^4.13.0
npx playwright install chromium
py -m pip install pymupdf pytest
```
In `package.json`, set these fields: `"name": "crew-leader"`, `"private": true`, `"version": "0.1.0"`, `"type": "module"`, plus the scripts above. `requirements-dev.txt` holds `pymupdf>=2.1,<3` and `pytest>=9.2,<10`.

- [ ] **Step 4: Write the failing test** `tests/unit/foundation.test.ts`

```ts
import { readFileSync } from 'node:fs';
const read = (p: string) => readFileSync(p, 'utf8');

test('index.html carries the privacy, language and viewport rules', () => {
  const html = read('index.html');
  expect(html).toMatch(/<html lang="en-SG">/);
  expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
  expect(html).toContain('<meta name="color-scheme" content="dark">');
  expect(html).toContain('viewport-fit=cover');
  expect(html).toContain('interactive-widget=resizes-content');
});
test('robots.txt disallows everything', () => {
  expect(read('public/robots.txt')).toBe('User-agent: *\nDisallow: /\n');
});
test.each([
  ['--c-bay', '#121719'], ['--c-text', '#EEF1EC'], ['--c-band-o', '#E2711F'], ['--c-band-y', '#E3BC2B'],
  ['--c-star', '#3381D4'], ['--c-white', '#C8CFCB'], ['--c-missed', '#F26BB0'], ['--c-order', '#B3A1FF'],
  ['--c-done', '#7DD6A9'], ['--t-press', '90ms'], ['--t-reveal', '700ms'], ['--ease-enter', 'cubic-bezier(.22,1,.36,1)'],
])('token %s is %s', (name, value) => {
  expect(read('src/styles/tokens.css')).toContain(`${name}: ${value};`);
});
test('there is no light theme', () => {
  expect(read('src/styles/base.css')).not.toMatch(/prefers-color-scheme:\s*light/);
});
```

- [ ] **Step 5: Run it and see it fail**

Run: `npx vitest run tests/unit/foundation.test.ts`
Expected: FAIL with `ENOENT` for `index.html`.

- [ ] **Step 6: Write the foundation files**

`src/styles/tokens.css`:
- **Format:** a single `:root` block, one declaration per line in the form `--name: value;`.
- **Source:** values come from `.superpowers/alts/scdf.fragment.html`, lines 5–25 and 53–56.

The tokens are:

| Token | Value | Token | Value |
|---|---|---|---|
| `--c-page` | `#1E1F21` | `--c-band-o` | `#E2711F` |
| `--c-bay` | `#121719` | `--c-band-y` | `#E3BC2B` |
| `--c-panel` | `rgba(29,37,40,.82)` | `--c-star` | `#3381D4` |
| `--c-raised` | `#2B373C` | `--c-white` | `#C8CFCB` |
| `--c-line` | `#36444A` | `--c-missed` | `#F26BB0` |
| `--c-line-2` | `#56676E` | `--c-order` | `#B3A1FF` |
| `--c-text` | `#EEF1EC` | `--c-done` | `#7DD6A9` |
| `--c-text-2` | `#B6C2C4` | `--c-ink` | `#0E1416` |
| `--c-text-3` | `#94A3A6` | `--c-hl-bg` | `rgba(240,214,120,.20)` |
| `--c-hl-edge` | `rgba(240,214,120,.60)` | `--text-scale` | `1` |
| `--f-ui` | `'Barlow Semi Condensed','Barlow',system-ui,sans-serif` | `--f-body` | `'Barlow',system-ui,sans-serif` |
| `--f-fig` | `'Barlow Condensed','Barlow',system-ui,sans-serif` | `--t-press` | `90ms` |
| `--t-fast` | `160ms` | `--t-base` | `220ms` |
| `--t-exit` | `140ms` | `--t-screen` | `280ms` |
| `--t-reveal` | `700ms` | `--t-stagger` | `60ms` |
| `--ease-enter` | `cubic-bezier(.22,1,.36,1)` | `--ease-exit` | `cubic-bezier(.4,0,1,1)` |

Notes on the highlight and band tokens:
- **Highlight:** the docx has one highlight colour. `--c-hl-*` is its single dim-theme style, a warm tint distinct from the band, because the band is identity only.
- **Band patterns:**
  - `--band` takes the two background layers of the mockup's `.as-bb`;
  - `--band-key` takes the two band layers of `.as-primary`, without the white;
  - `--chevrons` is `repeating-linear-gradient(135deg,var(--c-band-o) 0 3px,var(--c-band-y) 3px 6px)`.

`src/styles/base.css` covers:
- **Reset and body:**
  - the mockup's reset (lines 36–41), rescoped to the document;
  - `body` uses `var(--f-body)`, 1rem, line-height 1.4, weight 500, `color: var(--c-text)` and `background: var(--c-bay)`;
  - `min-height: 100dvh`.
- **Text size:** `html { font-size: calc(100% * var(--text-scale)); }`, with `html[data-text-size="large"] { --text-scale: 1.125 }` and `html[data-text-size="larger"] { --text-scale: 1.25 }`.
- **Focus, touch and numbers:**
  - `:focus-visible { outline: 2px solid var(--c-text); outline-offset: 2px }`;
  - a transparent tap highlight;
  - `.tn` sets tabular numerals.
- **Reduced motion:** a `prefers-reduced-motion: reduce` block that sets `animation: none` and makes `transition` affect opacity only, 150ms or less.
- **High contrast:** a `prefers-contrast: more` block that sets `--c-text-2` and `--c-text-3` to `#EEF1EC`, sets `--c-line` to `#56676E`, and makes panels opaque.

`index.html`:
- `<html lang="en-SG">`;
- the charset, viewport, robots, `color-scheme` and `<meta name="theme-color" content="#121719">` tags;
- `<title>Crew Leader</title>`;
- `<div id="app">` and `<script type="module" src="/src/main.tsx">`.

`src/main.tsx` imports the fonts and both stylesheets, then renders `<p>Crew Leader</p>` into `#app`; Task 15 replaces this with `<App/>`.
- **Font files:** `@fontsource/barlow/latin-{400,500,600,700}.css`, `@fontsource/barlow-semi-condensed/latin-{500,600,700}.css` and `@fontsource/barlow-condensed/latin-{500,600,700,800}.css`.
- **Fallback:** if the installed version names these files differently, list `node_modules/@fontsource/barlow` and use the latin-only per-weight files.

`vite.config.ts` uses `defineConfig` from `vitest/config`, `preact()` and `base: './'`, plus the `define` and `test` blocks from Interfaces.

`tsconfig.json` sets:
- `target`/`lib` ES2022 plus DOM;
- `module` ESNext, `moduleResolution` bundler;
- `jsx: "react-jsx"` with `jsxImportSource: "preact"`;
- `strict` and `noUncheckedIndexedAccess`;
- `resolveJsonModule`;
- `types: ["vite/client", "vitest/globals"]`;
- `include: ["src", "tests/unit", "vite.config.ts"]`.

- [ ] **Step 7: Run the tests and the build**

Run: `npx vitest run tests/unit/foundation.test.ts && npm run build`
Expected: all tests PASS; the build exits 0 and writes `dist/index.html`.

- [ ] **Step 8: Write and run the Python smoke test** `tests/py/test_sources.py`

```python
import zipfile
from pathlib import Path
import pytest

SOURCES = Path(__file__).parents[2] / "sources"

@pytest.mark.parametrize("name", [
    "EMT Medical & Trauma Question Bank 2017.pdf",
    "HMLS Question Bank for EMT-CT, MOCT & HRCT-C.pdf",
    "EMT_Survey_Notes.docx",
])
def test_source_present(name):
    assert (SOURCES / name).stat().st_size > 100_000

def test_docx_is_a_zip():
    assert zipfile.is_zipfile(SOURCES / "EMT_Survey_Notes.docx")

def test_pymupdf_reads_hmls():
    import pymupdf
    assert pymupdf.open(SOURCES / "HMLS Question Bank for EMT-CT, MOCT & HRCT-C.pdf").page_count == 10
```
Run: `py -m pytest tests/py/test_sources.py -v`
Expected: 5 passed.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "chore: scaffold Vite + Preact app, tokens, sources and test tooling" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Question bank PDF reader

**Files:**
- Create: `tools/qbank_pdf.py`
- Test: `tests/py/test_qbank_pdf.py`

**Interfaces:**
- Consumes: the `sources/` PDFs (Task 1).
- Produces (`tools/qbank_pdf.py`):
```python
@dataclass(frozen=True)
class RawOption:
    label: str            # as printed: "a".."d" or "A".."D" (duplicates kept)
    text: str             # body without the label, whitespace collapsed
    underlined: bool      # any alphanumeric char in the body is underlined
    bold_share: float     # bold alphanumeric chars / alphanumeric chars in the body
    @property
    def marked(self) -> bool: ...   # underlined or bold_share >= 0.5

@dataclass
class RawQuestion:
    number: int
    page: int                          # 1-based page of the question start
    stem: str
    options: list[RawOption]
    passage_marker: str | None         # "Answer questions 11–15 …" / "Scenario 1", on the first question after it
    passage: str | None                # the passage lines after the marker, joined
    images: list[tuple[int, tuple[float, float, float, float]]]  # (page, bbox) of image blocks met while open

def read_bank(pdf_path: Path) -> tuple[list[list[RawQuestion]], list[str]]:
    """Parts in document order (numbering restarts at 1 => new part), plus unplaced lines."""
```

- [ ] **Step 1: Write the failing tests** `tests/py/test_qbank_pdf.py`

Every value below was read from the PDFs on 9 Nov 2026.

```python
from pathlib import Path
import pytest
from qbank_pdf import read_bank

SRC = Path(__file__).parents[2] / "sources"
MT = SRC / "EMT Medical & Trauma Question Bank 2017.pdf"
HMLS = SRC / "HMLS Question Bank for EMT-CT, MOCT & HRCT-C.pdf"

@pytest.fixture(scope="module")
def mt(): return read_bank(MT)

@pytest.fixture(scope="module")
def hmls(): return read_bank(HMLS)

def q(parts, part, n): return next(x for x in parts[part] if x.number == n)

def answer(question):
    marks = [i for i, o in enumerate(question.options) if o.marked]
    assert len(marks) == 1, (question.number, marks)
    return "abcd"[marks[0]]

def test_part_sizes(mt, hmls):
    assert [len(p) for p in mt[0]] == [92, 254]
    assert [len(p) for p in hmls[0]] == [61]
    assert set(range(1, 257)) - {x.number for x in mt[0][1]} == {175, 176}

@pytest.mark.parametrize("bank,part,n,expected", [
    ("mt", 0, 1, "b"), ("mt", 0, 24, "c"), ("mt", 0, 92, "c"),
    ("mt", 1, 115, "b"), ("mt", 1, 214, "a"), ("mt", 1, 256, "b"),
    ("mt", 1, 24, "d"), ("hmls", 0, 1, "d"), ("hmls", 0, 61, "c"),
])
def test_known_answers(mt, hmls, bank, part, n, expected):
    parts = (mt if bank == "mt" else hmls)[0]
    assert answer(q(parts, part, n)) == expected

def test_every_question_has_exactly_one_mark(mt, hmls):
    for parts in (mt[0], hmls[0]):
        for part in parts:
            for question in part:
                answer(question)

def test_only_27_is_underlined_in_part_a_q24(mt):
    c = q(mt[0], 0, 24).options[2]
    assert (c.text, c.underlined) == ("27%", True)

def test_bold_subscript_is_not_a_mark_in_part_b_q24(mt):
    c = q(mt[0], 1, 24).options[2]          # "Administer O2" with a bold subscript 2
    assert c.bold_share < 0.5 and not c.marked

def test_part_b_switches_to_bold_only_at_214(mt):
    marked = lambda n: next(o for o in q(mt[0], 1, n).options if o.marked)
    assert marked(213).underlined
    assert not any(marked(n).underlined for n in range(214, 257))

def test_passage_markers(mt):
    assert q(mt[0], 0, 11).passage_marker.startswith("Answer questions 11–15")
    assert q(mt[0], 0, 28).passage_marker.startswith("Answer questions 28 and 29")
    assert q(mt[0], 1, 147).passage_marker == "Scenario 1"
    assert q(mt[0], 1, 147).passage.startswith("A 25-year-old male jumped")

def test_ecg_image_is_seen_in_part_b_q197(mt):
    assert [page for page, _ in q(mt[0], 1, 197).images] == [46]

def test_wrapped_stems(mt):
    assert q(mt[0], 1, 125).stem.endswith("inserting the oropharyngeal airway?")
    assert q(mt[0], 1, 197).stem.endswith("What is your treatment for the patient?")

def test_duplicate_labels_kept_as_printed(mt):
    assert [o.label for o in q(mt[0], 1, 168).options] == ["A", "A", "B", "C"]

def test_nothing_unplaced(mt, hmls):
    assert mt[1] == [] and hmls[1] == []
```

- [ ] **Step 2: Run them and see them fail**

Run: `py -m pytest tests/py/test_qbank_pdf.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'qbank_pdf'`.

- [ ] **Step 3: Implement `read_bank(pdf_path) -> (parts, unplaced)` in `tools/qbank_pdf.py`**

These layout rules are verified against both PDFs:
1. **Text and bold:** text comes from `page.get_text("dict")`. A span is bold if `span["flags"] & 16` or `"Bold"` is in its font name.
2. **Rules and headers:**
   - Drawn horizontal segments come from `page.get_drawings()`:
     - `"l"` items with |Δy| < 1.5 and length > 3;
     - `"re"` items with height < 2.
   - A segment running from x < 75 to x > 520 is a page rule. These rules sit at y≈56 and y≈783. Drop them, and drop all text above the top rule or below the bottom one, which removes the header and the page number.
3. **Underlines:** a span is underlined when a segment's y is within ±3 of the span's bottom edge and overlaps it horizontally by more than 2pt.
4. **Line merging:**
   - Merge lines that share a baseline (|Δy| < 1.5), left to right. Part B prints `165.` and its stem as two lines on one baseline.
   - Image blocks (`type == 1`) become image events in reading order (y, then x).
5. **Line classification:**
   - **Question start:** the line matches `^(\d{1,3})\.\s*`, its x0 is below 100, and either n == 1 or last < n ≤ last + 3. A 1 that follows a higher number starts a new part. The sequence check stops the wrapped line "92. Auscultation…" inside B-Q203 from being read as Q92.
   - **Passage marker:** a line matching `^(answer questions|scenario\s+\d+)`, case-insensitive. The marker and every line up to the next question start form that next question's `passage_marker` (the marker line) and `passage` (the rest).
   - **Option:** a line matching `^([a-dA-D])[.)]\s*`.
   - **Anything else:** it continues the stem before the first option, or the current option after it, whatever its x. B-Q125 has a stem line at x=72, and B-Q197 has a stem line after its ECG image.
   - **Leftovers:** lines met with no open question and outside a passage go to `unplaced`.
6. **Marking:** compute `bold_share` and `underlined` over the option body only, excluding the label. Part A Q24 has a plain label and a bold, partly underlined "27%".
7. **Whitespace:** join wrapped lines with one space, then collapse whitespace runs.

- [ ] **Step 4: Run the tests and see them pass**

Run: `py -m pytest tests/py/test_qbank_pdf.py -v`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add tools/qbank_pdf.py tests/py/test_qbank_pdf.py
git commit -m "feat(import): read question banks with bold and underline marks" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Question import and `questions.json`

**Files:**
- Create: `tools/import_questions.py`, `tools/import_config.json`
- Generated (committed):
  - `public/data/questions.json`;
  - `public/img/q/mt-b-q197.png`;
  - `tools/import-log.md`.
- Test: `tests/py/test_import_questions.py`

**Interfaces:**
- Consumes: `read_bank`, `RawQuestion` and `RawOption` (Task 2).
- Produces:
```python
class ImportProblem(Exception): ...
def review_flags(raw: RawQuestion) -> list[dict]                       # [{"code", "reason"}]
def src_hash(passage: str | None, stem: str, option_texts: list[str], answer: str) -> str  # 12 hex
def build(mt_pdf: Path, hmls_pdf: Path, config: dict, overrides: dict | None, img_dir: Path) -> tuple[dict, str]
def main(argv: list[str] | None = None) -> int
```
- **CLI defaults:**
  - `--mt "sources/EMT Medical & Trauma Question Bank 2017.pdf"`;
  - `--hmls "sources/HMLS Question Bank for EMT-CT, MOCT & HRCT-C.pdf"`;
  - `--config tools/import_config.json`;
  - `--overrides public/data/overrides.json`, read-only, and optional if missing;
  - `--out public/data/questions.json`;
  - `--img public/img/q`;
  - `--log tools/import-log.md`.
- `questions.json` shape, which Task 6's schema mirrors:
```json
{
  "contentVersion": "<first 12 hex of sha256 over the serialized questions array>",
  "banks": [
    { "id": "mt-a", "label": "Medical and trauma, part A", "source": "EMT Medical & Trauma Question Bank 2017.pdf" },
    { "id": "mt-b", "label": "Medical and trauma, part B", "source": "EMT Medical & Trauma Question Bank 2017.pdf" },
    { "id": "hmls", "label": "HMLS", "source": "HMLS Question Bank for EMT-CT, MOCT & HRCT-C.pdf" }
  ],
  "questions": [{
    "id": "mt-a-q001", "bank": "mt-a", "number": 1,
    "passage": null, "stem": "…",
    "options": [{ "id": "a", "label": "a", "text": "…" }],
    "answer": "b", "image": null, "topic": null,
    "review": [{ "code": "duplicate-label", "reason": "Two options carry the same label (A)." }],
    "srcHash": "3f2a91c0b7de"
  }]
}
```
- **Field rules:**
  - **Option `id`:** positional (`a`–`d`) in printed order. `label` keeps the printed label.
  - **`answer`:** the `id` of the marked option.
  - **`topic`:** `"hmls"` for the HMLS bank, `null` otherwise. Other topics come from the overlay in Tasks 9–11.
- **Review codes and reasons:**
  - `no-answer`: "No option is marked as the answer in the PDF."
  - `multiple-answers`: "More than one option is marked as the answer in the PDF."
  - `missing-option`: "This question has {n} options instead of 4."
  - `duplicate-label`: "Two options carry the same label ({L})."
  - `duplicate-text`: "Two options have the same text."
  - `image`: the reason from the config's image group, or "It has an image in the PDF that isn't cropped yet." when no group covers it.
- **Passage text:** excludes the marker line itself.
- **`srcHash`:** sha256 over `json.dumps({"passage", "stem", "options": [texts], "answer"}, ensure_ascii=False, sort_keys=True)`, first 12 hex. It is computed after typo fixes.

- [ ] **Step 1: Write `tools/import_config.json`**

These are the hand-verified facts the PDF cannot tell the importer. The part B scenario ranges were read on 9 Nov 2026; the PDF prints no ranges.
```json
{
  "scenarios": {
    "mt-b": [
      { "marker": "Scenario 1", "from": 147, "to": 148 },
      { "marker": "Scenario 2", "from": 149, "to": 151 },
      { "marker": "Scenario 3", "from": 152, "to": 155 },
      { "marker": "Scenario 4", "from": 156, "to": 158 },
      { "marker": "Scenario 5", "from": 161, "to": 163 },
      { "marker": "Scenario 6", "from": 165, "to": 168 },
      { "marker": "Scenario 7", "from": 169, "to": 171 }
    ]
  },
  "imageGroups": [
    { "bank": "mt-b", "from": 197, "to": 199, "file": "mt-b-q197.png",
      "reason": "Depends on the ECG strip printed in the PDF. Check the crop against the PDF." }
  ],
  "fixes": [
    { "id": "mt-b-q203", "find": "treament", "replace": "treatment" },
    { "id": "mt-b-q207", "find": "asculatation", "replace": "auscultation" },
    { "id": "mt-b-q209", "find": "dysarhythmias", "replace": "dysrhythmias" },
    { "id": "mt-b-q212", "find": "puritus", "replace": "pruritus" },
    { "id": "mt-b-q254", "find": "eithical", "replace": "ethical" },
    { "id": "hmls-q004", "find": "indefinetly", "replace": "indefinitely" },
    { "id": "hmls-q058", "find": "I/min", "replace": "L/min" },
    { "id": "hmls-q059", "find": "I/min", "replace": "L/min" },
    { "id": "hmls-q060", "find": "I/min", "replace": "L/min" }
  ]
}
```

- [ ] **Step 2: Write the failing tests** `tests/py/test_import_questions.py`

```python
import json
from pathlib import Path
import pytest
from import_questions import build, main, review_flags, src_hash, ImportProblem
from qbank_pdf import RawOption, RawQuestion

ROOT = Path(__file__).parents[2]
MT = ROOT / "sources/EMT Medical & Trauma Question Bank 2017.pdf"
HMLS = ROOT / "sources/HMLS Question Bank for EMT-CT, MOCT & HRCT-C.pdf"
CONFIG = json.loads((ROOT / "tools/import_config.json").read_text(encoding="utf-8"))

@pytest.fixture(scope="module")
def built(tmp_path_factory):
    img = tmp_path_factory.mktemp("img")
    doc, log = build(MT, HMLS, CONFIG, None, img)
    return doc, log, img, {x["id"]: x for x in doc["questions"]}

def test_ids(built):
    ids = [x["id"] for x in built[0]["questions"]]
    assert len(ids) == len(set(ids)) == 407
    assert [i for i in ids if i.startswith("mt-a-")] == [f"mt-a-q{n:03}" for n in range(1, 93)]
    assert "mt-b-q175" not in ids and "mt-b-q176" not in ids and "mt-b-q256" in ids
    assert [i for i in ids if i.startswith("hmls-")] == [f"hmls-q{n:03}" for n in range(1, 62)]

@pytest.mark.parametrize("qid,ans", [
    ("mt-a-q001", "b"), ("mt-a-q024", "c"), ("mt-a-q092", "c"), ("mt-b-q115", "b"),
    ("mt-b-q214", "a"), ("mt-b-q256", "b"), ("hmls-q001", "d"), ("hmls-q061", "c"),
    ("mt-b-q024", "d"), ("mt-b-q168", "a"),
])
def test_answer_ids(built, qid, ans):
    assert built[3][qid]["answer"] == ans

def test_option_ids_are_positional(built):
    assert [(o["id"], o["label"]) for o in built[3]["mt-b-q168"]["options"]] == [("a", "A"), ("b", "A"), ("c", "B"), ("d", "C")]

def test_review_flags_are_exactly_the_known_ones(built):
    flagged = {x["id"]: [r["code"] for r in x["review"]] for x in built[0]["questions"] if x["review"]}
    assert flagged == {"mt-b-q168": ["duplicate-label"], "mt-b-q169": ["duplicate-text"],
                       "mt-b-q197": ["image"], "mt-b-q198": ["image"], "mt-b-q199": ["image"]}

def test_ecg_crop(built):
    assert {built[3][f"mt-b-q{n}"]["image"] for n in (197, 198, 199)} == {"img/q/mt-b-q197.png"}
    assert (built[2] / "mt-b-q197.png").stat().st_size > 10_000

@pytest.mark.parametrize("bank,nums,start", [
    ("mt-a", range(11, 16), "You respond along with fire units"),
    ("mt-a", range(28, 30), "You respond to a 25-patient mass casualty incident"),
    ("mt-b", range(147, 149), "A 25-year-old male jumped"),
    ("mt-b", range(149, 152), "A 14-year-old female"),
    ("mt-b", range(152, 156), "A 61-year-old female"),
    ("mt-b", range(156, 159), "You respond to case of “unable to wake up”"),
    ("mt-b", range(161, 164), "You respond to case of an 89-year-old female"),
    ("mt-b", range(165, 169), "A 68-year-old male"),
    ("mt-b", range(169, 172), "A 24-year-old Indian worker"),
])
def test_passages(built, bank, nums, start):
    for n in nums:
        assert built[3][f"{bank}-q{n:03}"]["passage"].startswith(start)

@pytest.mark.parametrize("qid", ["mt-a-q010", "mt-a-q016", "mt-a-q030", "mt-b-q146", "mt-b-q159", "mt-b-q164", "mt-b-q172"])
def test_no_passage_outside_ranges(built, qid):
    assert built[3][qid]["passage"] is None

def test_wording_kept(built):
    assert built[3]["mt-a-q001"]["stem"] == ("Which consists of the collective change in vital signs associated "
                                            "with the late stages of increasing intracranial pressure?")
    assert built[3]["mt-b-q115"]["options"][1]["text"] == "24 to 44%, 2 to 4 litres/minute"

def test_typo_fixes_applied_and_logged(built):
    assert "ethical" in built[3]["mt-b-q254"]["stem"] and "eithical" not in built[3]["mt-b-q254"]["stem"]
    assert all("I/min" not in o["text"] for o in built[3]["hmls-q058"]["options"])
    for fix in CONFIG["fixes"]:
        assert f"{fix['id']}: {fix['find']} → {fix['replace']}" in built[1]

def test_topics(built):
    assert {x["topic"] for x in built[0]["questions"] if x["bank"] == "hmls"} == {"hmls"}
    assert {x["topic"] for x in built[0]["questions"] if x["bank"] != "hmls"} == {None}

def test_src_hash_tracks_answer_and_text():
    a = src_hash(None, "stem", ["x", "y"], "a")
    assert len(a) == 12 and a != src_hash(None, "stem", ["x", "y"], "b") and a != src_hash(None, "stem!", ["x", "y"], "a")

def test_stale_overrides_are_logged(tmp_path):
    doc, log = build(MT, HMLS, CONFIG, {"questions": {"mt-a-q001": {"srcHash": "000000000000"}}}, tmp_path)
    assert "## Stale explanations" in log and "- mt-a-q001" in log

def test_unmapped_scenario_fails(tmp_path):
    with pytest.raises(ImportProblem, match="Scenario 1"):
        build(MT, HMLS, {**CONFIG, "scenarios": {"mt-b": []}}, None, tmp_path)

def test_review_flags_unit():
    opt = lambda label, text, marked: RawOption(label, text, marked, 1.0 if marked else 0.0)
    base = dict(number=1, page=1, stem="s", passage_marker=None, passage=None, images=[])
    codes = lambda opts: [f["code"] for f in review_flags(RawQuestion(options=opts, **base))]
    assert codes([opt("a", "w", False), opt("b", "x", False), opt("c", "y", False), opt("d", "z", False)]) == ["no-answer"]
    assert codes([opt("a", "w", True), opt("b", "x", True), opt("c", "y", False), opt("d", "z", False)]) == ["multiple-answers"]
    assert codes([opt("a", "w", True), opt("b", "x", False), opt("c", "y", False)]) == ["missing-option"]

def test_deterministic(tmp_path):
    args = lambda d: ["--out", str(d / "q.json"), "--img", str(d / "img"), "--log", str(d / "log.md"), "--overrides", str(d / "none.json")]
    (tmp_path / "1").mkdir(); (tmp_path / "2").mkdir()
    assert main(args(tmp_path / "1")) == 0 and main(args(tmp_path / "2")) == 0
    for name in ("q.json", "log.md"):
        assert (tmp_path / "1" / name).read_bytes() == (tmp_path / "2" / name).read_bytes()
```
- [ ] **Step 3: Run them and see them fail**

Run: `py -m pytest tests/py/test_import_questions.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'import_questions'`.

- [ ] **Step 4: Implement `build`, `review_flags`, `src_hash` and `main` in `tools/import_questions.py`**

**Banks and passages:**
- Parts map to banks in order: M&T part 0 is `mt-a`, part 1 is `mt-b`, HMLS part 0 is `hmls`.
- Part A ranges come from the marker text with `answer questions (\d+)\s*(?:–|-|to|and)\s*(\d+)`. Part B ranges come from `config["scenarios"]`.
- A marker that has no range raises `ImportProblem("Scenario 1 before mt-b Q147 has no range in tools/import_config.json")`.

**Images:**
- For each image group, take the first image recorded on the group's `from` question.
- Render that bbox with `page.get_pixmap(clip=bbox, dpi=200)` to `img_dir/file`.
- Set `"image": "img/q/<file>"` and add the `image` review flag on every question in the range.

**Fixes:**
- Apply fixes to passage, stem and option text, replacing every occurrence.
- Log each applied fix as `- {id}: {find} → {replace}`. A fix whose text isn't found goes under `## Fixes not applied`.

**Log (`tools/import-log.md`):**
- source names with each file's sha256;
- counts per bank;
- the review flags;
- the fixes applied, then the fixes not applied;
- the stale explanations: override IDs whose `srcHash` differs from the new hash;
- the unplaced lines.

**Output:** sort questions by bank (`mt-a`, `mt-b`, `hmls`), then by number. Write the files with `json.dumps(doc, ensure_ascii=False, indent=1) + "\n"`.

- [ ] **Step 5: Run the tests and see them pass**

Run: `py -m pytest tests/py/test_import_questions.py -v`
Expected: all passed.

- [ ] **Step 6: Generate the real files**

Run: `py tools/import_questions.py`
Expected:
- exit 0;
- `public/data/questions.json` holds 407 questions;
- `public/img/q/mt-b-q197.png` shows the 12-lead strip;
- `tools/import-log.md` lists 5 flagged questions and 9 fixes.

Open the PNG and confirm the crop holds the whole ECG strip and nothing else.

- [ ] **Step 7: Commit**

```bash
git add tools/import_questions.py tools/import_config.json tools/import-log.md public/data/questions.json public/img/q tests/py/test_import_questions.py
git commit -m "feat(import): build questions.json with review flags, fixes and ECG crop" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Notes docx primitives

**Files:**
- Create: `tools/notes_docx.py`
- Test: `tests/py/test_notes_docx.py`

**Interfaces:**
- Produces (`tools/notes_docx.py`). `W` is the WordprocessingML namespace `http://schemas.openxmlformats.org/wordprocessingml/2006/main`.
```python
@dataclass
class Run:
    t: str
    b: bool = False; i: bool = False; u: bool = False; h: bool = False
    sz: int | None = None          # half-points (w:sz); internal, not exported
    img: str | None = None         # r:embed id of a drawing; t == "" when set
    def to_json(self) -> dict: ... # {"t": ..., plus "b"/"i"/"u"/"h": True only when set}

def runs_of(p: Element) -> list[Run]          # w:t text, w:tab -> " ", w:br -> "\n", w:drawing -> Run(img=rId); merges neighbours with equal flags
def split_lines(runs: list[Run]) -> list[list[Run]]   # split on "\n"
def classify(line: list[Run]) -> tuple[str, dict]
    # ("bullet", {"depth": 1|2, "marker": "•"|"–", "runs": [...]}) for a leading "•" (depth 1) or "–" (depth 2) after optional whitespace/tabs
    # ("ordered", {"depth": 1, "marker": "1.", "runs": [...]}) for a leading r"\d+\." followed by a space
    # ("text", {"runs": [...]}) otherwise; the marker and following whitespace are stripped from the runs
def heading_kind(line: list[Run]) -> str | None   # "section" (all text bold, sz 32) | "group" (sz 28) | "sub" (sz 26) | None
def slugify(text: str) -> str                     # NFKD -> ascii, lowercase, "&" dropped, non [a-z0-9] runs -> "-", trimmed
```
- **Flag rules:** a flag is false when its element is absent or carries `w:val` of `"0"`, `"false"` or (for `w:u`) `"none"`. `h` is set by any `w:highlight`.

- [ ] **Step 1: Write the failing tests** `tests/py/test_notes_docx.py`

The tests build paragraphs from small XML strings:
```python
import xml.etree.ElementTree as ET
import pytest
from notes_docx import runs_of, split_lines, classify, heading_kind, slugify

NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
def p(body: str): return ET.fromstring(f"<w:p {NS}>{body}</w:p>")
def r(text, props=""): return f"<w:r><w:rPr>{props}</w:rPr><w:t xml:space=\"preserve\">{text}</w:t></w:r>"

def test_flags():
    [run] = runs_of(p(r("x", '<w:b/><w:i/><w:u w:val="single"/><w:highlight w:val="yellow"/>')))
    assert (run.b, run.i, run.u, run.h) == (True, True, True, True)
    [off] = runs_of(p(r("x", '<w:b w:val="0"/><w:u w:val="none"/>')))
    assert (off.b, off.u) == (False, False)

def test_neighbours_with_equal_flags_merge():
    assert [x.t for x in runs_of(p(r("Ask ", "<w:b/>") + r("crew", "<w:b/>") + r(" now")))] == ["Ask crew", " now"]

def test_breaks_split_lines():
    lines = split_lines(runs_of(p(r("•One") + "<w:r><w:br/></w:r>" + r("–Two"))))
    assert ["".join(x.t for x in line) for line in lines] == ["•One", "–Two"]

def test_classify():
    line = lambda s: runs_of(p(r(s)))
    assert classify(line("•Ask crew"))[0] == "bullet" and classify(line("•Ask crew"))[1]["depth"] == 1
    kind, data = classify(line("\t–\"Ops Centre, Roger\""))
    assert (kind, data["depth"], data["runs"][0].t) == ("bullet", 2, '"Ops Centre, Roger"')
    kind, data = classify(line("1. MUST sound out"))
    assert (kind, data["marker"], data["runs"][0].t) == ("ordered", "1.", "MUST sound out")
    assert classify(line("Note: plain"))[0] == "text"

def test_heading_kind():
    assert heading_kind(runs_of(p(r("1. Primary Survey", '<w:b/><w:sz w:val="32"/>')))) == "section"
    assert heading_kind(runs_of(p(r("Asthma", '<w:b/><w:sz w:val="26"/>') + r(" (tested)", '<w:b/><w:highlight w:val="yellow"/><w:sz w:val="26"/>')))) == "sub"
    assert heading_kind(runs_of(p(r("EMT Drugs (Must Know)", '<w:b/><w:sz w:val="28"/>')))) == "group"
    assert heading_kind(runs_of(p(r("Breathing", '<w:sz w:val="26"/>')))) is None

@pytest.mark.parametrize("text,slug", [
    ("Respond Call & Call Caller", "respond-call-call-caller"),
    ("LOC (AVPU Scale)", "loc-avpu-scale"),
    ("C-Collar Application (ENSAPA) – after RBS", "c-collar-application-ensapa-after-rbs"),
    ("3. Diabetic Emergency – Hypoglycemia < 4 mmol/L (Stay & Treat)", "3-diabetic-emergency-hypoglycemia-4-mmol-l-stay-treat"),
])
def test_slugify(text, slug):
    assert slugify(text) == slug
```

- [ ] **Step 2: Run them and see them fail**

Run: `py -m pytest tests/py/test_notes_docx.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'notes_docx'`.

- [ ] **Step 3: Implement the five functions and `Run` in `tools/notes_docx.py`**

Use the standard library only (`xml.etree.ElementTree`, `unicodedata`, `re`). For `heading_kind`:
- ignore whitespace-only runs;
- every remaining run must be bold and share one size;
- size 32 is `section`, 28 is `group`, 26 is `sub`.

- [ ] **Step 4: Run the tests and see them pass**

Run: `py -m pytest tests/py/test_notes_docx.py -v`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add tools/notes_docx.py tests/py/test_notes_docx.py
git commit -m "feat(import): docx run, line, heading and slug primitives" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Notes import and `notes.json`

**Files:**
- Create: `tools/import_notes.py`
- Generated (committed): `public/data/notes.json`, `public/img/notes/*.png`
- Test: `tests/py/test_import_notes.py`

**Interfaces:**
- Consumes: Task 4 primitives.
- Produces:
```python
def build_notes(docx: Path, img_out: Path) -> dict
def main(argv: list[str] | None = None) -> int   # --docx sources/EMT_Survey_Notes.docx --out public/data/notes.json --img public/img/notes
```
`notes.json` has this shape. Task 6's `NotesDocSchema` and every TypeScript reader depend on it:
```ts
type Run = { t: string; b?: true; i?: true; u?: true; h?: true };
type Block =
  | { k: 'h'; id: string; text: string; group?: true }          // id: slug, unique within the section
  | { k: 'p'; runs: Run[] }
  | { k: 'list'; items: { depth: 1 | 2; marker: string; runs: Run[] }[] }
  | { k: 'table'; rows: { header: boolean; cells: Block[][] }[] }
  | { k: 'box'; variant: 'remark' | 'added'; title: string; blocks: Block[] }
  | { k: 'img'; src: string; alt: string };                      // src "img/notes/s07-1.png"
type Section = { id: string; n: number; title: string; tags: string[]; highlights: number; blocks: Block[] };
type NotesDoc = { contentVersion: string; source: 'EMT_Survey_Notes.docx'; sections: Section[] };
```
- **Highlight passage**, a definition shared with Task 19's `highlightPassages`: one `p` block or one list item, at any depth, including inside table cells and boxes, with at least one run where `h` is true.
- **`highlights`:** the section's count of highlight passages.

- [ ] **Step 1: Write the failing tests** `tests/py/test_import_notes.py`

These facts were verified in the docx on 9 Nov 2026.
```python
import json
from pathlib import Path
import pytest
from import_notes import build_notes, main

DOCX = Path(__file__).parents[2] / "sources/EMT_Survey_Notes.docx"
TITLES = ["Primary Survey", "Secondary Survey", "Glasgow Coma Scale", "Chief Complaint & L.O.T.A.A.R.R.R.P.",
          "EMT Protocols", "Guide for Head-to-Toe Examination", "Auscultation (6 points)", "4-Lead ECG Placement",
          "12-Lead ECG Placement", "Heart Rhythms", "Oxygen & SpO2", "Drugs", "Devices & Machines", "PPE",
          "Vital Signs", "Respiratory Emergencies", "Cardiac Emergencies", "IV Therapy (Intravenous)",
          "IO Infusion (Intraosseous)", "Injection of Drugs"]
STEP_ANCHORS = ["respond-call-call-caller", "preparation", "rescue-scene-evaluation", "approach-patient",
                "introduction", "loc-avpu-scale", "fast-check-a-b-c-loc-unresponsive", "delicate-spine", "airway",
                "breathing", "circulation", "c-collar-application-ensapa", "rapid-body-survey",
                "c-collar-application-ensapa-after-rbs", "immobilization", "investigation-vital-signs", "oxygen",
                "airway-recheck", "position", "decision-point", "notification"]

@pytest.fixture(scope="module")
def built(tmp_path_factory):
    img = tmp_path_factory.mktemp("img")
    return build_notes(DOCX, img), img

def walk(blocks):
    for b in blocks:
        yield b
        if b["k"] == "box": yield from walk(b["blocks"])
        if b["k"] == "table":
            for row in b["rows"]:
                for cell in row["cells"]: yield from walk(cell)

def all_blocks(doc): return [b for s in doc["sections"] for b in walk(s["blocks"])]
def text(b): return "".join(r["t"] for r in b.get("runs", [])) if b["k"] == "p" else ""

def test_sections(built):
    doc = built[0]
    assert [s["id"] for s in doc["sections"]] == [f"s{n:02}" for n in range(1, 21)]
    assert [s["title"] for s in doc["sections"]] == TITLES
    assert doc["sections"][18]["tags"] == ["not tested"] and doc["sections"][19]["tags"] == ["not tested"]
    assert doc["sections"][0]["tags"] == []

def test_front_matter_skipped(built):
    assert not any("Formatting key" in text(b) for b in all_blocks(built[0]))

def test_step_anchors_exist_in_order(built):
    ids = [b["id"] for b in built[0]["sections"][0]["blocks"] if b["k"] == "h"]
    assert [a for a in ids if a in STEP_ANCHORS] == STEP_ANCHORS

def test_anchors_unique_per_section(built):
    for s in built[0]["sections"]:
        ids = [b["id"] for b in s["blocks"] if b["k"] == "h"]
        assert len(ids) == len(set(ids)), s["id"]

def test_boxes(built):
    boxes = [b for b in all_blocks(built[0]) if b["k"] == "box"]
    assert sum(b["variant"] == "remark" for b in boxes) == 17
    assert sum(b["variant"] == "added" for b in boxes) == 9
    assert all(b["title"] for b in boxes)

def test_split_box_is_merged(built):
    boxes = [b for b in all_blocks(built[0]) if b["k"] == "box"]
    rescue = [b for b in boxes if "Rescue breathing" in json.dumps(b, ensure_ascii=False)]
    assert rescue and "12 bpm" in json.dumps(rescue[0], ensure_ascii=False)

def test_tables(built):
    tables = [b for b in all_blocks(built[0]) if b["k"] == "table"]
    assert len(tables) == 9
    assert all(t["rows"][0]["header"] for t in tables)

def test_images(built):
    doc, img = built
    imgs = [b for b in all_blocks(doc) if b["k"] == "img"]
    assert len(imgs) == 14 and len(list(img.glob("*.png"))) == 14
    assert all((img / Path(b["src"]).name).exists() and b["alt"] for b in imgs)
    assert any(b["k"] == "img" for b in doc["sections"][6]["blocks"])

def runs_in(b): return b.get("runs", []) + [run for item in b.get("items", []) for run in item["runs"]]

def test_highlights(built):
    s01 = built[0]["sections"][0]
    assert s01["highlights"] > 0 and sum(s["highlights"] for s in built[0]["sections"]) > 60
    runs = [run for b in walk(s01["blocks"]) for run in runs_in(b)]
    assert any(run.get("h") and "NEVER move the patient" in run["t"] for run in runs)

def test_approach_order(built):
    blocks = built[0]["sections"][0]["blocks"]
    start = next(i for i, b in enumerate(blocks) if b.get("id") == "approach-patient")
    items = [it for b in blocks[start:start + 8] if b["k"] == "list" for it in b["items"] if it["marker"].endswith(".")]
    assert [it["marker"] for it in items][:4] == ["1.", "2.", "3.", "4."]

def test_deterministic(tmp_path):
    for d in ("a", "b"):
        assert main(["--out", str(tmp_path / d / "notes.json"), "--img", str(tmp_path / d / "img")]) == 0
    assert (tmp_path / "a/notes.json").read_bytes() == (tmp_path / "b/notes.json").read_bytes()
```

- [ ] **Step 2: Run them and see them fail**

Run: `py -m pytest tests/py/test_import_notes.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'import_notes'`.

- [ ] **Step 3: Implement `build_notes` and `main` in `tools/import_notes.py`**

These structure rules are verified against the docx. The docx has no paragraph styles, numbering or bookmarks:

**Sections and headings**
- **Front matter:** skip everything before the first `section` heading: the title, the contents and the formatting key.
- **Section headings:** `"N. Title"` starts section `s{N:02}`.
  - `title` is the text without the number.
  - A trailing highlighted parenthetical becomes a tag: `"(not tested)"` becomes `tags: ["not tested"]` and is removed from the title.
- **Sub and group headings:** a `sub` line becomes `{k:'h', id: slugify(text), text}`. A `group` line becomes the same block with `group: true`.
  - On a duplicate id within a section, append `-2`, `-3` and so on.
  - Lines after a heading line in the same paragraph are body.

**Body lines**
- **Grouping:** classify each line. Consecutive `bullet` and `ordered` lines, across paragraphs, build one `list` block. `text` lines become `p` blocks.
- **Empty lines:** drop them.
- **Whitespace:** tabs become one space, and each run's text is stripped at line ends only.

**Tables and boxes**
- **Data table:** a top-level `w:tbl` with any `w:shd w:fill="e2e2e2"`, looking recursively.
  - Rows with e2e2e2 cells are `header: true`.
  - Each cell holds the `p` and `list` blocks of its paragraphs.
- **Box:** a table whose shading, searched recursively, includes `eeeeee` (`variant: 'remark'`) or `f1f2f1` (`variant: 'added'`).
  - Remark boxes are a 1×1 table wrapping a nested shaded table, so collect paragraphs from nested tables too.
  - **Title:**
    - a first line starting `"Added note – X"` gives `title` X, and that line is removed;
    - a first line starting with `"Remark:"` gives `title` "Remark", and the prefix is cut from that line;
    - a box without either prefix keeps all its lines and gets the title "Added note" or "Remark" from its variant. All 26 current boxes have a prefix; the fallback keeps future re-imports from failing.
- **Continuation:** an unshaded 1×1 table that follows a box, with only empty paragraphs between them, is that box continued across a page. Append its blocks to the box. There are 5 such tables.
- **Other tables:** any other unshaded table is a data table without header rows.

**Images and output**
- **Images:** for a `Run.img`, resolve the id through `word/_rels/document.xml.rels` to `word/media/*.png`.
  - Copy it to `img_out/{section}-{k}.png`, where k counts from 1 within the section.
  - Emit `{k:'img', src: 'img/notes/{section}-{k}.png', alt: 'Figure {k}: {nearest heading text, else section title}'}`. The docx has no alt text.
- **`contentVersion`:** the first 12 hex of the sha256 of the serialized `sections`.
- **Writing:** write with `ensure_ascii=False, indent=1` and a trailing newline.

- [ ] **Step 4: Run the tests and see them pass**

Run: `py -m pytest tests/py/test_import_notes.py -v`
Expected: all passed.

- [ ] **Step 5: Generate the real files**

Run: `py tools/import_notes.py`
Expected: exit 0; `public/data/notes.json` is written, and `public/img/notes/` holds 14 PNGs.

- [ ] **Step 6: Commit**

```bash
git add tools/import_notes.py tests/py/test_import_notes.py public/data/notes.json public/img/notes
git commit -m "feat(import): convert survey notes docx to notes.json" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Data schemas and notes links

**Files:**
- Create: `src/data/schema.ts`, `src/data/notesRef.ts`
- Test: `tests/unit/schema.test.ts`, `tests/unit/data-integrity.test.ts`

**Interfaces:**
- Consumes: the `questions.json` and `notes.json` shapes from Tasks 3 and 5.
- Produces (`src/data/schema.ts`). Each `*Schema` is a valibot schema, and each type is `v.InferOutput` of it, except the recursive `Block`, which is declared by hand and typed `v.GenericSchema<Block>` via `v.lazy`:
```ts
export const TOPICS = { respiratory: 'Respiratory', cardiac: 'Cardiac', trauma: 'Trauma', burns: 'Burns', shock: 'Shock',
  neuro: 'Neuro', diabetic: 'Diabetic', drugs: 'Drugs', airway: 'Airway', assessment: 'Assessment', iv: 'IV',
  ops: 'Ops and conduct', hmls: 'HMLS' } as const;
export type Topic = keyof typeof TOPICS;            export const TopicSchema
export type BankId = 'mt-a' | 'mt-b' | 'hmls';      export const BankIdSchema
export const NOTES_REF = /^s\d{2}(#[a-z0-9-]+)?$/;  export const NotesRefSchema
export const RawQuestionsDocSchema   // Task 3 shape; options length 2..6; answer must equal one option id (v.check)
export const OverrideEntrySchema     // { srcHash: string(12 hex); topic: Topic; explanation: string(min 1); notesRef: NotesRef | null;
                                     //   generated: boolean; review?: string }
export const OverridesDocSchema      // { version: 1, questions: Record<id, OverrideEntry> }
export const NotesDocSchema          // Task 5 shape
export type Run, Block, Section, NotesDoc, RawQuestionsDoc, OverrideEntry, OverridesDoc
// steps.json (Task 7) and cases (Task 8):
export const ROLES = ['opsCtr', 'caller', 'patient', 'headBuddy', 'armBuddy', 'tester'] as const;  export type Role
export type Addressee = Role | 'crew'
export const CASE_FLAGS = ['rta', 'unconscious', 'spinal', 'spinalAfterRbs', 'limbInjury', 'asthmaCopd', 'hypoglycaemia', 'extraPpe'] as const;
export const CONDITIONS = [...CASE_FLAGS, 'medical', 'trauma', 'noSpinal', 'neckPain', 'catastrophicBleeding', 'positionNotIdeal'] as const;
export type CaseFlag, Condition
export const VITAL_KEYS = ['spo2', 'pr', 'rr', 'bp', 'temp', 'skin', 'crt'] as const;  export type VitalKey
export const StepsDocSchema, CaseSchema, CaseIndexSchema
export type Step, MustHit, Part, Reply, StepsDoc, Case, CaseIndex, Vitals
export function conditionHolds(c: Case, cond: Condition): boolean
export function getFinding(c: Case, path: string): unknown   // walks dotted path from the case root, undefined when absent
```
The `Step`, `MustHit` and `Reply` shapes, which Plan 2 grades against:
```ts
type Match = string[][];             // any alternative; every term in an alternative must appear (lowercase; stems allowed, e.g. "deformit")
type Part = { id: string; label: string; match: Match };
type MustHit = { id: string; label: string; match: Match; parts?: Part[]; ordered?: true; keyPhrase?: true;
                 requiredWords?: string[]; negatives?: string[]; accept?: { label: string; match: Match }[];
                 when?: Condition; to?: Addressee };     // valid when match.length > 0 || parts.length > 0
type Reply = { role: Role; text: string } | { role: Role; finding: string } | { role: Role; vitals: VitalKey[] } | { role: 'tester'; computed: 'eta' };
type Step = { id: string; order: number; name: string; timed: boolean; startsClock?: true; inOrder?: true; notesRef: string;
              canonicalLine: string; mustHit: MustHit[]; replies: Reply[]; guidance: string[]; branches?: { if: Condition; note: string }[] };
type StepsDoc = { contentVersion: string; steps: Step[] };
```
The `Case` shape, from the brief page 11, refined:
```ts
type Vitals = { spo2: number; pr: number; rr: number; bp: string; temp: number; skin: string; crt: string };
type Case = {
  id: string; type: 'medical' | 'trauma'; complaint: string; area: string; callText: string; location: string;
  flags: CaseFlag[]; reviewed: boolean; notesRef: string;
  caller: { who: string; voice: string; answers: { location: string; whatHappened: string; casualties: string; conscious: string;
            icAndMeds: string; breathing?: string; criticalInjuries?: string; vehicles?: string } };
  patient: { name: string; sex: 'male' | 'female'; race: string; age: number; ic: string /* /^[STFG]\d{2}x{5}[A-Z]$/ */;
             voice: string; chiefComplaint: string; lines: { feelingNow: string } & Record<string, string> };
  findings: {
    scene: { description: string; items: string[]; hazards: string[]; witnesses: string };
    approach: { catastrophicBleeding: boolean };
    loc: { avpu: 'A' | 'V' | 'P' | 'U'; response: string };
    spine: { fall: string; hitHead: string; dtbl: string; neckPain: boolean };
    airway: { mouth: string; smell: string };
    breathing: { riseFall: string; rateQuality: 'fast and shallow' | 'slow and deep'; ntucp: string[] };
    history: { asthmaCopd: string; other: string };
    circulation: { pulse: string };
    rbs: { findings: string; jvd: boolean; pedalEdema: boolean; gloves: string; pockets: string[] };
    investigation: { auscultation: string; bp: string; ecg: { type: '12-lead' | '4-lead'; reading: string }; hypocount: number };
    vitals: { gcs: { e: number; v: number; m: number }; severity: string };
    position: { choice: string; ideal: boolean };
  };
  vitals: { roomAir: Vitals; afterO2: Vitals };     // wrong mask or flow = roomAir values (spec §11)
  expected: { oxygen: { device: 'nasal-cannula' | 'simple-face-mask' | 'non-rebreather' | 'nebuliser-mask' | 'bvm' | 'none';
                        flowMin: number | null; flowMax: number | null; optional?: true };
              ecg: '12-lead' | '4-lead';
              decision: { stable: false; signs: string[] /* >= 2 */; suspected: string; plan: 'stay-and-treat' | 'load-and-go' } };
};
type CaseIndex = { cases: { id: string; file: string; type: 'medical' | 'trauma'; complaint: string; area: string }[] };
```
The schema enforces two spec rules: `decision.stable` is the literal `false`, since every case is unstable (§6.3), and `ic` is masked.

`conditionHolds` derives most conditions:
- `medical` and `trauma` come from `type`;
- `neckPain` comes from `findings.spine.neckPain`;
- `catastrophicBleeding` comes from `findings.approach.catastrophicBleeding`;
- `positionNotIdeal` is `!findings.position.ideal`;
- `spinal` is the flag `spinal` or `neckPain`;
- `noSpinal` is `!spinal`;
- every other condition is `flags.includes`.

- Produces (`src/data/notesRef.ts`):
```ts
export function resolveNotesRef(notes: NotesDoc, ref: string): { section: Section; blockIndex: number; heading: string | null } | null
export function notesRefHref(ref: string): string                 // 's11#oxygen-masks' -> '#/notes/s11/oxygen-masks'; 's07' -> '#/notes/s07'
export function notesRefLabel(notes: NotesDoc | null, ref: string): string   // 'Notes 11, Oxygen Masks'; 'Notes 7' without notes or anchor
```
- **Anchor rule:** `blockIndex` is the index of the anchor's `h` block among the section's top-level blocks, or 0 when the ref has no anchor.

- [ ] **Step 1: Write the failing tests**

`tests/unit/schema.test.ts`. Build fixtures with a local `validCase()` factory that returns a complete case object, mostly placeholder strings:
- **Notes refs:**
  - `NotesRefSchema` accepts `'s01'` and `'s01#delicate-spine'`;
  - it rejects `'Section 16'`, `'s1'` and `'s01#Delicate'`.
- **Raw questions:** `RawQuestionsDocSchema` rejects a question whose `answer` isn't one of its option ids.
- **Overrides:** `OverridesDocSchema` rejects topic `'cardio'` and an empty explanation.
- **Cases:**
  - `CaseSchema` accepts `validCase()`;
  - it rejects `{...validCase(), expected: {...stable: true}}` and `ic: 'S5412345A'`.
- **Must-hit points:** a must-hit with `match: []` and no `parts` fails.
- **`conditionHolds`:**
  - `noSpinal` is true for a case with no `spinal` flag and `neckPain: false`;
  - it turns false when `neckPain: true`;
  - `trauma` follows `type`.
- **`getFinding`:**
  - `getFinding(c, 'findings.breathing.spo2RA')` is `undefined`;
  - `getFinding(c, 'vitals.roomAir.spo2')` is `c.vitals.roomAir.spo2`.
- **`resolveNotesRef`:** against a 1-section fixture `[h 'airway', p, h 'delicate-spine']`:
  - `'s01'` gives blockIndex 0 and heading `null`;
  - `'s01#delicate-spine'` gives blockIndex 2 and heading `'Delicate Spine'`;
  - `'s01#nope'` and `'s21'` give `null`.
- **`notesRefHref` and `notesRefLabel`:** as in Interfaces.

`tests/unit/data-integrity.test.ts`:
```ts
import * as v from 'valibot';
import questions from '../../public/data/questions.json';
import notes from '../../public/data/notes.json';
import { RawQuestionsDocSchema, NotesDocSchema } from '../../src/data/schema';

test('questions.json matches its schema', () => { expect(() => v.parse(RawQuestionsDocSchema, questions)).not.toThrow(); });
test('notes.json matches its schema', () => { expect(() => v.parse(NotesDocSchema, notes)).not.toThrow(); });
test('there are 407 questions and 20 sections', () => {
  expect(questions.questions).toHaveLength(407);
  expect(notes.sections).toHaveLength(20);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/unit/schema.test.ts tests/unit/data-integrity.test.ts`
Expected: FAIL with "Failed to resolve import ../../src/data/schema".

- [ ] **Step 3: Implement `src/data/schema.ts` and `src/data/notesRef.ts`**

Implement the schemas exactly as typed in Interfaces. Use `v.strictObject` for hand-written content (steps, cases, overrides), so a typo'd key fails, and `v.object` for generated files.

- [ ] **Step 4: Run them and see them pass**

Run: `npx vitest run tests/unit/schema.test.ts tests/unit/data-integrity.test.ts && npm run typecheck`
Expected: all tests PASS; `tsc` exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/data tests/unit/schema.test.ts tests/unit/data-integrity.test.ts
git commit -m "feat(data): valibot schemas for questions, notes, steps and cases" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `steps.json`, the 19 PAM steps

**Files:**
- Create: `public/data/steps.json`
- Modify: `tests/unit/data-integrity.test.ts` (append)

**Interfaces:**
- Consumes: `StepsDocSchema`, `resolveNotesRef` and `CONDITIONS` (Task 6); `notes.json` anchors (Task 5).
- Produces: `public/data/steps.json` with `contentVersion: "2026-11-09.1"` and the steps below. Plan 2 grades against these exact ids.

**Sources:**
- the brief's table on pages 4–7;
- notes section 1;
- the refinements in spec §6.2 and §11.

**Step table.** Each row has the step's must-hit ids, with parts in brackets and the `when` condition in braces.
- **Step 5:** has `inOrder: true` and `startsClock: true`. It is the only step that starts the clock.
- **Steps 1–4:** `timed: false`. Every other step is `timed: true`.

| # | id · name · notesRef (`s01#…`) | mustHit ids [parts] {when} | replies |
|---|---|---|---|
| 1 | `respond-call` · Respond call · `respond-call-call-caller` | `call-sign`, `responding-to`, `case-of` (to opsCtr) | opsCtr text "Ops Ctr, roger." |
| 2 | `call-caller` · Call caller · `respond-call-call-caller` | `intro-fmv-emt`, `confirm-location`, `what-happened`, `casualties`, `conscious`, `prepare-ic-meds`, `ask-breathing` {unconscious}, `tele-cpr` {unconscious}, `critical-injuries` {trauma}, `vehicles` {rta} (to caller) | caller findings `caller.answers.<key>` for location, whatHappened, casualties, conscious, icAndMeds, breathing, criticalInjuries, vehicles |
| 3 | `preparation` · Preparation · `preparation` | `gloves-mask`, `extra-ppe` {extraPpe}, `equipment` [burn-kit, blanket-canvas, o2-bag, lsu, trauma-bag, zoll], with `accept: [{label: '"4 in 1" plus LSU', match: [["4 in 1","lsu"]]}]` (to crew) | tester text "Crew ready. You've arrived on scene." |
| 4 | `scene-evaluation` · Rescue scene evaluation · `rescue-scene-evaluation` | `witnesses`, `environment`, `hazards`, `moi` (keyPhrase, requiredWords ["suspected"]) | tester findings `findings.scene.description`, `.items`, `.hazards`, `.witnesses` |
| 5 | `approach-patient` · Approach patient · `approach-patient` | `sound-out` (keyPhrase), `catastrophic-bleeding`, `hazards-remove`, `head-still`, `bleeding-control` {catastrophicBleeding} [expose-examine, direct-pressure, pressure-dressing, cat] ordered | tester findings `findings.approach.catastrophicBleeding`, `findings.scene.hazards` |
| 6 | `introduction` · Introduction · `introduction` | `intro-emt-scdf`, `head-grip`, `whats-bothering` (to patient) | patient finding `patient.chiefComplaint` |
| 7 | `loc-avpu` · LOC (AVPU) · `loc-avpu-scale` | `get-response`, `state-level` | patient finding `findings.loc.response`; branch `{if: 'unconscious', note: 'Fast-check A, B, C, then CPR or rescue breathing, and OPA. Later phase.'}` |
| 8 | `delicate-spine` · Delicate spine · `delicate-spine` | `ask-fall`, `neck-permission`, `palpate-dtbl` [deformities, tenderness, bruises, lacerations], `release-grip` (keyPhrase) {noSpinal}, `c-collar` {neckPain} [establish-neutral, measure, apply] ordered | patient findings `findings.spine.fall`, `.hitHead`, `.neckPain`; tester `findings.spine.dtbl` |
| 9 | `airway` · Airway · `airway` | `check-response`, `airway-clear`, `head-tilt-chin-lift` {noSpinal}, `jaw-thrust` {spinal}, `smell` [gtn, alcohol, fruity] | tester findings `findings.airway.mouth`, `.smell` |
| 10 | `breathing` · Breathing · `breathing` | `chest-rise-fall`, `rate-quality`, `spo2` (to armBuddy), `asthma-copd-history`, `monitor-closely` (keyPhrase) {asthmaCopd}, `ntucp` [nasal-flaring, tracheal-tugging, accessory-muscles, cyanosis, pursed-lips], `mask-flow` | tester `findings.breathing.riseFall`, `.rateQuality`, `.ntucp`; armBuddy vitals ["spo2"]; patient `findings.history.asthmaCopd` |
| 11 | `circulation` · Circulation · `circulation` | `pulse`, `pulse-rate-quality` | tester `findings.circulation.pulse` |
| 12 | `rapid-body-survey` · Rapid body survey · `rapid-body-survey` | `rbs-permission`, `rbs-regions` [head, neck, chest, abdomen, pelvis, lower-extremities, upper-extremities, back] ordered, `eye-contact`, `abnormalities`, `jvd`, `pedal-edema`, `gloves`, `pocket-check` [medication, ic, medic-alert], `distal-pulse` {limbInjury}, `immobilise` {limbInjury}, `c-collar-after-rbs` {spinalAfterRbs} [establish-neutral, measure, apply] | tester `findings.rbs.findings`, `.jvd`, `.pedalEdema`, `.gloves`, `.pockets` |
| 13 | `investigation` · Investigation · `investigation-vital-signs` | `auscultation` [point-1 … point-6, air-entry, equal-entry, abnormal-sounds], `bp-screen` [shunt, fistula, chest-op], `bp-arm`, `ecg`, `hypocount`, `suspected-hypo` (keyPhrase, requiredWords ["suspected"]) {hypoglycaemia} | tester `findings.investigation.auscultation`, `.bp`, `.ecg`, `.hypocount` |
| 14 | `vital-signs` · Vital signs · `investigation-vital-signs` | `vitals-permission`, `gcs` [eyes, verbal, motor, score], `severity`, `head-buddy` [temp, rr, skin] (to headBuddy), `arm-buddy` [spo2, pr, bp, crt] (to armBuddy), `reassess-5` | patient `findings.vitals.gcs`, `findings.vitals.severity`; headBuddy vitals ["temp","rr","skin"]; armBuddy vitals ["spo2","pr","bp","crt"] |
| 15 | `oxygen` · Oxygen · `oxygen` | `recheck-spo2`, `maintain-titrate` | armBuddy vitals ["spo2"] |
| 16 | `airway-recheck` · Airway recheck · `airway-recheck` | `how-feeling` (to patient) | patient finding `patient.lines.feelingNow` |
| 17 | `position` · Position · `position` | `ask-position`, `convince` {positionNotIdeal} | patient `findings.position.choice` |
| 18 | `decision-point` · Decision point · `decision-point` | `unstable-signs` (keyPhrase, requiredWords ["unstable"]), `suspected` (requiredWords ["suspected"]), `stay-and-treat` {medical}, `load-and-go` {trauma}, `call-alpha`, `monitor-5` | tester text "Accepted." |
| 19 | `notification` · Notification · `notification` | `get-ic`, `id-check` [name, ic-number, photo], `standby-opener` (keyPhrase), `sracie` [sex, race, age, case, two-signs, ic-no, eta] (to opsCtr) | opsCtr text "Ops Centre, send over."; opsCtr text "Ops Centre, roger."; tester computed "eta" |

**Breathing rule:** the `rate-quality` reply allows only "fast and shallow" or "slow and deep". The case schema enforces this.

**`guidance`** holds the brief's "Notes and accepted variations" column, word for word, one string per sentence. For example:
- step 3: `"\"4 in 1\" plus LSU accepted as the equipment list"`;
- step 5: `"Head grip belongs to Introduction, not Approach."` plus the notes' four-point order;
- step 12: `"JVD and pedal edema may come after asking about pain."` and `"Pocket check is often missed: always flag it."`;
- step 13: `"Screening questions count as choosing the arm, but the arm must still be named."` and the 12-lead rule;
- step 14: `"One of person / place / time is enough for verbal."` and `"Severity is of the chief complaint, not always pain."`;
- step 18: `"Reasons should be signs, not the diagnosis."`;
- step 19: `"Age range (e.g. \"70s\") accepted. ETA = time left of the 20 mins."`

**Labels:** every `label` is short plain English, taken from the notes. For example, `sound-out` is "Sound out: approaching from the front, please do not move your head".

**`match`:**
- **Source:** write a first pass from the notes' own wording. Examples:
  - `ask-fall`: `[["fall"], ["hit", "head"]]`;
  - `palpate-dtbl` parts: `[["deformit"]]`, `[["tender"]]`, `[["bruis"]]`, `[["lacerat"]]`;
  - `moi`: `[["moi"], ["mechanism", "injury"]]`.
- **Tuning:** Plan 2 tunes these against its paraphrase fixtures.

**`canonicalLine`:**
- **Content:** one line per step, in the notes' wording, used for tap mode.
- **Placeholders:** only `{location}`, `{callText}`, `{chiefComplaint}`, `{suspected}`, `{signs}`, `{sex}`, `{race}`, `{age}`, `{ic}` and `{eta}`.
- **Examples:**
  - step 1: `"FMV 123 to Ops Ctr, responding to {location} for case of {callText}."`;
  - step 5: `"Approaching casualty from the front. If you can hear me, please do not move your head. Is there any catastrophic bleeding? Any hazards around the patient?"`.

- [ ] **Step 1: Append the failing tests** to `tests/unit/data-integrity.test.ts`

```ts
import stepsDoc from '../../public/data/steps.json';
import { StepsDocSchema, CONDITIONS } from '../../src/data/schema';
import { resolveNotesRef } from '../../src/data/notesRef';

const STEP_IDS = ['respond-call', 'call-caller', 'preparation', 'scene-evaluation', 'approach-patient', 'introduction',
  'loc-avpu', 'delicate-spine', 'airway', 'breathing', 'circulation', 'rapid-body-survey', 'investigation',
  'vital-signs', 'oxygen', 'airway-recheck', 'position', 'decision-point', 'notification'];
const steps = () => v.parse(StepsDocSchema, stepsDoc).steps;
const point = (stepId: string, id: string) => steps().find(s => s.id === stepId)!.mustHit.find(m => m.id === id)!;
const partIds = (stepId: string, id: string) => point(stepId, id).parts!.map(p => p.id);

test('19 steps in order', () => {
  expect(steps().map(s => s.id)).toEqual(STEP_IDS);
  expect(steps().map(s => s.order)).toEqual(STEP_IDS.map((_, i) => i + 1));
  expect(steps().map(s => s.timed)).toEqual(STEP_IDS.map((_, i) => i >= 4));
  expect(steps().filter(s => s.startsClock).map(s => s.id)).toEqual(['approach-patient']);
});
test('every step links to a real notes anchor and has a canonical line', () => {
  for (const s of steps()) {
    expect(resolveNotesRef(notes as any, s.notesRef), s.id).not.toBeNull();
    expect(s.canonicalLine.length).toBeGreaterThan(10);
    expect(s.canonicalLine.replace(/\{(location|callText|chiefComplaint|suspected|signs|sex|race|age|ic|eta)\}/g, '')).not.toMatch(/[{}]/);
  }
});
test('every part the spec names is graded', () => {
  expect(partIds('rapid-body-survey', 'rbs-regions')).toEqual(['head', 'neck', 'chest', 'abdomen', 'pelvis', 'lower-extremities', 'upper-extremities', 'back']);
  expect(point('rapid-body-survey', 'rbs-regions').ordered).toBe(true);
  expect(partIds('investigation', 'auscultation')).toEqual(['point-1', 'point-2', 'point-3', 'point-4', 'point-5', 'point-6', 'air-entry', 'equal-entry', 'abnormal-sounds']);
  expect(partIds('delicate-spine', 'palpate-dtbl')).toEqual(['deformities', 'tenderness', 'bruises', 'lacerations']);
  expect(partIds('breathing', 'ntucp')).toEqual(['nasal-flaring', 'tracheal-tugging', 'accessory-muscles', 'cyanosis', 'pursed-lips']);
  expect(partIds('preparation', 'equipment')).toEqual(['burn-kit', 'blanket-canvas', 'o2-bag', 'lsu', 'trauma-bag', 'zoll']);
  expect(point('preparation', 'equipment').accept).toHaveLength(1);
  expect(partIds('notification', 'sracie')).toEqual(['sex', 'race', 'age', 'case', 'two-signs', 'ic-no', 'eta']);
  expect(point('scene-evaluation', 'moi').requiredWords).toContain('suspected');
  for (const [s, m] of [['approach-patient', 'sound-out'], ['delicate-spine', 'release-grip'], ['breathing', 'monitor-closely'], ['notification', 'standby-opener']])
    expect(point(s, m).keyPhrase, m).toBe(true);
  expect(steps().find(s => s.id === 'approach-patient')!.inOrder).toBe(true);
  expect(point('introduction', 'head-grip')).toBeDefined();
});
test('ids are unique, conditions valid and match terms lowercase', () => {
  for (const s of steps()) {
    const ids = s.mustHit.map(m => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of s.mustHit) {
      if (m.when) expect(CONDITIONS).toContain(m.when);
      for (const alt of [...m.match, ...(m.parts ?? []).flatMap(p => p.match)]) for (const t of alt) expect(t).toBe(t.toLowerCase());
    }
  }
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run tests/unit/data-integrity.test.ts`
Expected: FAIL with "Failed to resolve import ../../public/data/steps.json".

- [ ] **Step 3: Write `public/data/steps.json`** following the table and rules above.

- [ ] **Step 4: Run it and see it pass**

Run: `npx vitest run tests/unit/data-integrity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/data/steps.json tests/unit/data-integrity.test.ts
git commit -m "feat(data): steps.json with the 19 PAM steps and must-hit points" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The two example cases

**Files:**
- Create: `public/data/cases/index.json`, `public/data/cases/copd-amk-01.json`, `public/data/cases/hypo-hougang-01.json`
- Modify: `tests/unit/data-integrity.test.ts` (append)

**Interfaces:**
- Consumes: `CaseSchema`, `CaseIndexSchema` and `getFinding` (Task 6); `steps.json` replies (Task 7).
- Produces: `cases/index.json` as `{ "cases": [{ "id", "file": "cases/<id>.json", "type", "complaint", "area" }] }` and the two cases. Plan 2 loads cases through the index.

**Values from the brief (pages 8–9):**

| Field | `copd-amk-01` | `hypo-hougang-01` |
|---|---|---|
| type, complaint, area | medical, Breathlessness, Ang Mo Kio | medical, Giddiness, Hougang |
| callText | "Elderly female, breathlessness" | "Elderly male, giddiness" |
| location | "Blk 2xx Ang Mo Kio Ave 3, #07-xx" | "Blk 4xx Hougang Ave 8, #11-xx" |
| caller.who | son | wife |
| caller story | 72, breathless since morning, worse, coughing, leaning forward; long-term lung problem | 68, giddy, sweating, confused; diabetic, took medicine, skipped dinner |
| scene | cramped living room, fan on; items two inhalers, tissues | tidy living room; items pill organiser, glass of water, TV remote |
| loc | A; alert, speaks a few words at a time | A; alert, slow and confused |
| spine / airway | no fall, no DTBL; clear, no smell | no fall, no DTBL; clear, no smell |
| breathing | fast and shallow; SpO2 86% RA; NTUCP use of accessory muscles, pursed lips | fast and shallow; SpO2 97% RA; NTUCP none |
| history | COPD, smoked 40 years, stopped 5 years ago | No asthma or COPD; diabetes, high BP |
| expected oxygen | nasal-cannula 2–4 L/min | nasal-cannula 2–4, `optional: true` |
| pulse | radial, fast and strong | radial, fast and strong |
| rbs / jvd / edema / gloves | none / no / no / slight sweat | none / no / no / a lot of sweat |
| auscultation | equal but reduced, expiratory wheeze both sides | equal, clear |
| BP (investigation) | 148/88 | 138/84 |
| ECG | 12-lead: sinus tachycardia about 112, no ST changes | 4-lead: sinus tachycardia about 108 |
| hypocount | 6.8 | 2.6 |
| GCS / severity | E4 V5 M6 / "7 to 8" | E4 V4 M6 / "6 to 7" |
| vitals.afterO2 (buddies) | 37.2 °C, RR 28, pale warm sweaty; SpO2 90, PR 112, BP 146/86, CRT under 2 s | 36.6 °C, RR 24, pale cold clammy; SpO2 98, PR 108, BP 136/82, CRT under 2 s |
| position | sitting, leaning forward (ideal) | sitting on sofa (ideal) |
| decision | signs ["low SpO2","high RR"], suspected "COPD", stay-and-treat | signs ["low blood sugar","high HR","low GCS"], suspected "hypoglycaemia", stay-and-treat |
| patient | Tan Ah Mui, Chinese female, 72, ic "S54xxxxxA" | Lim Boon Huat, Chinese male, 68, ic "S58xxxxxB" |
| flags | ["asthmaCopd"] | ["hypoglycaemia"] |
| notesRef | `s05#4-asthma-copd-in-respiratory-distress-stay-treat` | `s05#3-diabetic-emergency-hypoglycemia-4-mmol-l-stay-treat` |

**Filling the gaps:**
- **`vitals.roomAir`:** copy `afterO2`, except SpO2, which uses the room-air reading. The BP reading taken at Investigation also goes in `findings.investigation.bp`.
- **Voices:**
  - caller lines in casual Singapore English, using only these facts;
  - the COPD patient speaks in short, broken lines.
- **Review:** `reviewed: false` on both.

- [ ] **Step 1: Append the failing tests** to `tests/unit/data-integrity.test.ts`

```ts
import caseIndex from '../../public/data/cases/index.json';
import copd from '../../public/data/cases/copd-amk-01.json';
import hypo from '../../public/data/cases/hypo-hougang-01.json';
import { CaseSchema, CaseIndexSchema, getFinding } from '../../src/data/schema';

const cases = [v.parse(CaseSchema, copd), v.parse(CaseSchema, hypo)];

test('the index lists both cases', () => {
  expect(v.parse(CaseIndexSchema, caseIndex).cases.map(c => c.id)).toEqual(['copd-amk-01', 'hypo-hougang-01']);
});
test('brief values are kept', () => {
  const [c, h] = cases;
  expect([c.callText, c.vitals.roomAir.spo2, c.vitals.afterO2.spo2, c.findings.investigation.hypocount, c.findings.investigation.ecg.type])
    .toEqual(['Elderly female, breathlessness', 86, 90, 6.8, '12-lead']);
  expect(c.findings.breathing.ntucp).toEqual(['use of accessory muscles', 'pursed lips']);
  expect(c.expected.decision).toMatchObject({ stable: false, suspected: 'COPD', plan: 'stay-and-treat' });
  expect([h.vitals.roomAir.spo2, h.findings.investigation.hypocount, h.findings.investigation.ecg.type, h.findings.vitals.gcs])
    .toEqual([97, 2.6, '4-lead', { e: 4, v: 4, m: 6 }]);
  expect(h.expected.oxygen).toMatchObject({ device: 'nasal-cannula', optional: true });
  expect([c.patient.name, h.patient.name]).toEqual(['Tan Ah Mui', 'Lim Boon Huat']);
});
test('every case is unstable, masked, unreviewed and links to its protocol', () => {
  for (const c of cases) {
    expect(c.expected.decision.signs.length).toBeGreaterThanOrEqual(2);
    expect(c.patient.ic).toMatch(/^[STFG]\d{2}x{5}[A-Z]$/);
    expect(c.reviewed).toBe(false);
    expect(resolveNotesRef(notes as any, c.notesRef)).not.toBeNull();
  }
});
test('every finding a step can reply with exists in each case', () => {
  // only these caller answers are conditional (unconscious / trauma / RTA cases); every other path is required
  const OPTIONAL = ['caller.answers.breathing', 'caller.answers.criticalInjuries', 'caller.answers.vehicles'];
  for (const c of cases) for (const s of steps()) for (const r of s.replies)
    if ('finding' in r && !OPTIONAL.includes(r.finding))
      expect(getFinding(c, r.finding), `${c.id} ${r.finding}`).not.toBeUndefined();
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run tests/unit/data-integrity.test.ts`
Expected: FAIL resolving `cases/index.json`.

- [ ] **Step 3: Write the three JSON files** from the table above.

- [ ] **Step 4: Run it and see it pass**

Run: `npx vitest run tests/unit/data-integrity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/data/cases tests/unit/data-integrity.test.ts
git commit -m "feat(data): COPD and hypoglycaemia cases from the brief" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Explanations overlay, batch 1 (stub tool, part A, HMLS)

**Files:**
- Create: `tools/overrides_stub.py`, `public/data/overrides.json`
- Test: `tests/py/test_overrides_stub.py`, `tests/unit/overrides.test.ts`

**Interfaces:**
- Consumes:
  - the `questions.json` `srcHash` and `topic` fields (Task 3);
  - `notes.json` (Task 5);
  - `OverrideEntrySchema`, `TOPICS` and `resolveNotesRef` (Task 6).
- Produces: `public/data/overrides.json` as `{ "version": 1, "questions": { "<id>": { "srcHash", "topic", "explanation", "notesRef", "generated": true, "review"? } } }`, with keys sorted.
```python
def add_stubs(questions_doc: dict, overrides: dict, ids: list[str]) -> tuple[dict, int]  # never changes an existing entry
def main(argv: list[str] | None = None) -> int   # --bank mt-a|mt-b|hmls [--from N --to M] [--questions ...] [--overrides ...]
```
- **Stub entry:** `{"srcHash": <current>, "topic": "hmls" for hmls else null, "explanation": "", "notesRef": null, "generated": true}`.

**How to write an explanation** (spec §6.4):
- **Form:** one line, 20–220 characters, in plain language.
- **Content:** say why the official answer is right, using the trainee's notes.
- **Notes link:**
  - `notesRef` points at the section or anchor where the notes cover the point. Find it in `public/data/notes.json` by its `h` block ids.
  - If the notes don't cover the question, give a plain reason with `notesRef: null`.
  - If the notes disagree with the official answer, keep the official answer and add what the notes say. For example: "The bank's answer is 37.0 to 38.0 °C. Your notes put pyrexia at 37.5 to 38.4 °C."
- **Never:**
  - mention option letters, because options are shuffled;
  - contradict the official answer except in that way;
  - add protocol detail the notes don't have.

**Topic:**
- **Source:** pick exactly one topic per question from `TOPICS`.
- **Guide:**
  - **airway:** OPA, suction, BVM technique, airway manoeuvres;
  - **respiratory:** asthma, COPD, oxygen therapy;
  - **assessment:** surveys, history, vitals, GCS scoring;
  - **iv:** IV therapy and fluids;
  - **ops:** conduct, consent, ethics, PPE, equipment care, scene operations;
  - **hmls:** only, and always, for the HMLS bank.
- **Style example** (mt-b-q115, from the approved mockup): explanation "Nasal cannula runs at 2 to 4 L/min for about 24 to 45% oxygen. 6 to 8 L/min is the simple face mask.", notesRef `s11#oxygen-masks`.

- [ ] **Step 1: Write the failing tests**

`tests/py/test_overrides_stub.py`:
- `add_stubs` adds only missing ids, with `srcHash` copied from the question;
- an existing entry comes back identical (`==`) even when its `srcHash` is stale;
- `main(["--bank", "mt-b", "--from", "1", "--to", "3", ...tmp paths])` adds exactly `mt-b-q001…q003`;
- the written file's keys are sorted.

`tests/unit/overrides.test.ts`:
```ts
import * as v from 'valibot';
import questionsDoc from '../../public/data/questions.json';
import overridesDoc from '../../public/data/overrides.json';
import notesDoc from '../../public/data/notes.json';
import { OverrideEntrySchema } from '../../src/data/schema';
import { resolveNotesRef } from '../../src/data/notesRef';

const REQUIRED = (q: { bank: string; number: number }) => q.bank !== 'mt-b';   // widened in Tasks 10 and 11
const overrides = overridesDoc.questions as Record<string, any>;   // parsed per entry below, so one stub fails alone
const raw = new Map(questionsDoc.questions.map(q => [q.id, q]));

test('the file header is right', () => { expect(overridesDoc.version).toBe(1); });
test('every entry belongs to a real question and carries its current source hash', () => {
  for (const [id, o] of Object.entries(overrides)) expect(o.srcHash, id).toBe(raw.get(id)?.srcHash);
});
test('every required question has an entry', () => {
  const missing = questionsDoc.questions.filter(REQUIRED).filter(q => !overrides[q.id]).map(q => q.id);
  expect(missing).toEqual([]);
});
test.each(Object.entries(overrides))('%s: one plain line, right topic, real notes link', (id, o) => {
  expect(v.safeParse(OverrideEntrySchema, o).success).toBe(true);
  expect(o.explanation).not.toMatch(/\n/);
  expect(o.explanation.length).toBeGreaterThanOrEqual(20);
  expect(o.explanation.length).toBeLessThanOrEqual(220);
  expect(o.explanation).not.toMatch(/\b(?:option|answer|choice) [A-D]\b|\([A-D]\)/);   // options are shuffled
  expect(o.generated).toBe(true);
  expect(o.topic === 'hmls').toBe(raw.get(id)!.bank === 'hmls');
  if (o.notesRef) expect(resolveNotesRef(notesDoc as any, o.notesRef)).not.toBeNull();
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `py -m pytest tests/py/test_overrides_stub.py -v; npx vitest run tests/unit/overrides.test.ts`
Expected: pytest fails with `ModuleNotFoundError`; Vitest fails resolving `overrides.json`.

- [ ] **Step 3: Implement `tools/overrides_stub.py`**

Then run `py -m pytest tests/py/test_overrides_stub.py -v`.
Expected: passed.

- [ ] **Step 4: Create the part A stubs and write mt-a-q001 to q046**

Run: `py tools/overrides_stub.py --bank mt-a`. Then fill topic, explanation and notesRef for q001–q046.

Run: `npx vitest run tests/unit/overrides.test.ts`
Expected: failures only for the still-empty q047–q092.

- [ ] **Step 5: Write mt-a-q047 to q092**

Run: `npx vitest run tests/unit/overrides.test.ts`
Expected: PASS except the HMLS required check.

- [ ] **Step 6: Create the HMLS stubs and write hmls-q001 to q061**

Run: `py tools/overrides_stub.py --bank hmls`, then fill the entries.

Run: `npx vitest run tests/unit/overrides.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add tools/overrides_stub.py tests/py/test_overrides_stub.py tests/unit/overrides.test.ts public/data/overrides.json
git commit -m "feat(content): explanation overlay for part A and HMLS" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Explanations overlay, batch 2 (part B q001 to q128)

**Files:**
- Modify: `public/data/overrides.json`, `tests/unit/overrides.test.ts`

**Interfaces:**
- Consumes: `tools/overrides_stub.py` and the explanation rules (Task 9).
- Produces: overlay entries for `mt-b-q001` to `mt-b-q128`.

- [ ] **Step 1: Widen the required set**

Change `REQUIRED` to `q => q.bank !== 'mt-b' || q.number <= 128`.

Run: `npx vitest run tests/unit/overrides.test.ts`
Expected: FAIL listing `mt-b-q001` to `mt-b-q128` as missing.

- [ ] **Step 2: Create the stubs and write q001 to q064**

Run: `py tools/overrides_stub.py --bank mt-b --from 1 --to 128`, then fill q001–q064.

Run: `npx vitest run tests/unit/overrides.test.ts`
Expected: failures only for q065–q128.

- [ ] **Step 3: Write q065 to q128**

Run: `npx vitest run tests/unit/overrides.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add public/data/overrides.json tests/unit/overrides.test.ts
git commit -m "feat(content): explanation overlay for part B q1-128" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Explanations overlay, batch 3 (part B q129 to q256, flags)

**Files:**
- Modify: `public/data/overrides.json`, `tests/unit/overrides.test.ts`

**Interfaces:**
- Consumes: the same as Task 10.
- Produces:
  - a complete overlay for all 407 questions;
  - the manual `review` notes for `mt-b-q207` and `mt-b-q208`.

**Known cases** (spec §6.4):
- **The Q207/Q208 contradiction.** B-Q207's official answer is a simple face mask at 6 L/min. B-Q208's official reason is positive-pressure ventilation, which is BVM reasoning. Each entry gets a `review`, for example "The official answers to Q207 (simple face mask) and Q208 (BVM reasoning) contradict each other. Check both."
- **The Q232 pyrexia conflict.** B-Q232's official answer, 37.0 to 38.0 °C, conflicts with the notes' 37.5 to 38.4 °C. The explanation keeps the official answer and gives the notes' range, with notesRef set to the section 15 temperature anchor.
- **The ECG questions.** B-Q197 to Q199 already carry the import's `image` flag, so explain them from the cropped strip.

- [ ] **Step 1: Make every question required and add the flag tests**

Change `REQUIRED` to `() => true` and append:
```ts
test('the Q207/Q208 contradiction is flagged on both', () => {
  expect(overrides['mt-b-q207'].review).toMatch(/Q208/);
  expect(overrides['mt-b-q208'].review).toMatch(/Q207/);
});
test('pyrexia keeps the official answer and says what the notes say', () => {
  expect(raw.get('mt-b-q232')!.answer).toBe('c');
  expect(overrides['mt-b-q232'].explanation).toMatch(/37\.5/);
});
test('all 407 questions have an explanation', () => { expect(Object.keys(overrides)).toHaveLength(407); });
```
Run: `npx vitest run tests/unit/overrides.test.ts`
Expected: FAIL.

- [ ] **Step 2: Create the stubs and write q129 to q192**

Run: `py tools/overrides_stub.py --bank mt-b --from 129 --to 256`, then fill q129–q192.

- [ ] **Step 3: Write q193 to q256**, including the known cases above.

Run: `npx vitest run tests/unit/overrides.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add public/data/overrides.json tests/unit/overrides.test.ts
git commit -m "feat(content): complete explanation overlay and manual review flags" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Progress store with two save slots

**Files:**
- Create: `src/progress/types.ts`, `src/progress/slots.ts`, `src/progress/store.ts`, `src/progress/hooks.ts`, `src/progress/index.ts`
- Test: `tests/unit/helpers.ts`, `tests/unit/slots.test.ts`, `tests/unit/store.test.ts`

**Interfaces:**
- Consumes: `Topic` (Task 6).
- Produces (`src/progress/types.ts`):
```ts
export const SCHEMA_VERSION = 1;
export type TextSize = 'standard' | 'large' | 'larger';
export interface QStat { seen: number; right: number; lastAt: string; lastRight: boolean; rightSinceWrong: number | null } // null = never wrong
export type QuizMode = 'practice' | 'test' | 'review';
export interface QuizFilter { group: 'all' | 'mt' | 'hmls'; topic: Topic | 'all'; ids?: string[] }
export interface AnswerRecord { qid: string; picked: string; right: boolean; at: string }
export interface QuizSession { id: string; mode: QuizMode; filter: QuizFilter; startedAt: string; total: number;
  queue: string[]; orders: Record<string, string[]>; picked: string | null; checked: AnswerRecord | null; done: AnswerRecord[] }
export interface RunRecord { id: string; caseId: string; mode: 'coached' | 'exam'; drill: boolean; startedAt: string; usedMs: number;
  stepTimes: Record<string, number>; missed: string[]; order: string[]; phrase: string[]; disputes: string[]; tapped: string[];
  transcript: { who: string; text: string; atMs: number | null }[] }      // §6.6; Plan 2 fills it
export interface Progress {
  questions: Record<string, QStat>; dismissedReview: string[];
  notes: { lastSection: string | null; read: string[] };
  quizOpen: QuizSession | null; quizLast: QuizSession | null;
  runs: RunRecord[]; runOpen: unknown | null;                            // Plan 2 types runOpen and bumps SCHEMA_VERSION
  settings: { textSize: TextSize; haptics: boolean };
  flags: { offlineToastShown: boolean };
}
export function defaultProgress(): Progress     // haptics true, textSize 'standard'
export function normalizeProgress(raw: unknown): Progress | null  // null if not an object or a known key has the wrong type; fills missing keys from defaults
```
- Produces (`src/progress/slots.ts`):
```ts
export interface SlotStorage { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
export const SLOT_KEYS = ['crewleader.save.0', 'crewleader.save.1'] as const;
export type LoadResult =
  | { status: 'fresh'; data: Progress; seq: 0; available: boolean }
  | { status: 'ok' | 'restored'; data: Progress; seq: number; savedAt: string }
  | { status: 'corrupt'; data: Progress; seq: number };
export function checksum(s: string): string                       // FNV-1a 32-bit, 8 hex
export function loadProgress(storage: SlotStorage | null): LoadResult
export function saveProgress(storage: SlotStorage, data: Progress, seq: number, now: Date): { ok: true; savedAt: string } | { ok: false; error: string }
```
- **Envelope:** each slot holds `{ v, seq, savedAt, sum, data }`, where `sum = checksum(JSON.stringify(data))`. Sequence `seq` lives in slot `seq % 2`.
- **Load:** reads both slots and keeps the readable one with the highest `seq`. A slot is unreadable if:
  - its JSON doesn't parse;
  - its `sum` doesn't match;
  - its `v` is greater than `SCHEMA_VERSION`;
  - `normalizeProgress` returns `null`.
- **Result status:**
  - `restored` when a higher-seq slot exists but is unreadable;
  - `corrupt` when slots exist and neither is readable;
  - `fresh` when both are empty;
  - `available: false` when storage is `null` or `getItem` throws.
- **Save:** the caller passes the next seq (last good + 1), so a save never overwrites the newest good slot. The save:
  1. writes the slot;
  2. reads it back and compares;
  3. returns `{ok:false}` on any throw or mismatch.
- Produces (`src/progress/store.ts`, `hooks.ts`, `index.ts`):
```ts
export interface ProgressStore {
  get(): Progress; subscribe(fn: (p: Progress) => void): () => void;
  update(fn: (p: Progress) => Progress): void;      // immutable; notifies; saves unless blocked
  lastLoad(): LoadResult; lastSaveError(): string | null;
  tryAgain(): LoadResult; startFresh(): void; resetProgress(): void;   // reset keeps settings
}
export function createProgressStore(storage: SlotStorage | null, now?: () => Date): ProgressStore
export function safeLocalStorage(): SlotStorage | null              // null when window.localStorage access throws
export function requestPersist(nav?: Navigator): Promise<boolean>   // navigator.storage.persist() when present, else false
// hooks.ts
export const ProgressContext: preact.Context<ProgressStore>
export function useStore(): ProgressStore
export function useProgress<T>(select: (p: Progress) => T): T       // re-renders when the selected value changes (Object.is)
// index.ts
export const progress: ProgressStore   // createProgressStore(safeLocalStorage()); calls requestPersist() once
```
- **Blocked saves:** after a `corrupt` load, `update` changes memory but writes nothing until `startFresh()`. `startFresh()` saves the defaults and unblocks.
- **`tryAgain()`:** re-runs the load and unblocks if it succeeds.

- [ ] **Step 1: Write the failing tests**

`tests/unit/helpers.ts` exports `class MemoryStorage implements SlotStorage`, backed by a `Map`, with `failWrites` and `failReads` switches. Later UI tests reuse it.

`tests/unit/slots.test.ts`:
- **Fresh:** an empty storage loads as `fresh`, with `defaultProgress()` data and `available: true`. `loadProgress(null)` gives `available: false`.
- **Round trip:** saving seq 1 then loading gives `ok`, with equal data and the `savedAt` returned by the save.
- **Alternation:**
  - seq 1 goes to slot 1, seq 2 to slot 0 and seq 3 to slot 1;
  - after the seq 3 save, slot 0 still holds seq 2.
- **Bad newest slot:**
  - corrupting the newest slot's JSON (seq 2) gives `restored`, with seq 1's data and its `savedAt`;
  - a checksum mismatch on the newest slot also gives `restored`.
- **No good slot:**
  - both slots corrupt gives `corrupt`;
  - one slot with `v: 99` and the other empty gives `corrupt`, and the `v: 99` slot is left untouched.
- **Review Focus 2:** with `failWrites` on, `saveProgress` returns `{ok:false}` without throwing, and the other slot still loads `ok`. A storage whose `getItem` throws loads `fresh` with `available: false`.

`tests/unit/store.test.ts`:
- **Updates:** `update` notifies subscribers and persists, so a new store on the same storage reads the change.
- **Review Focus 3:**
  1. Start from a corrupt storage, so both slots hold garbage.
  2. Call `update` twice. The raw slot strings are unchanged and `get()` shows the change.
  3. Call `tryAgain()`; the status is still `corrupt`.
  4. Call `startFresh()`; slots now load `ok`, and later updates persist.
- **Reset:** `resetProgress` clears questions, notes, quizOpen, quizLast, runs and dismissedReview, and keeps `settings.textSize: 'larger'`.
- **Save errors:** with `failWrites`, `lastSaveError()` is a non-empty string, the in-memory update stands, and nothing throws.
- **Persistence request:** `requestPersist({ storage: { persist: vi.fn().mockResolvedValue(true) } } as any)` resolves `true`; `requestPersist({} as any)` resolves `false`.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/unit/slots.test.ts tests/unit/store.test.ts`
Expected: FAIL resolving `src/progress/slots`.

- [ ] **Step 3: Implement the five files** to the Interfaces above.

- [ ] **Step 4: Run them and see them pass**

Run: `npx vitest run tests/unit/slots.test.ts tests/unit/store.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/progress tests/unit/slots.test.ts tests/unit/store.test.ts
git commit -m "feat(progress): two-slot local save with rollback and blocked corrupt state" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Content loading and question merge

**Files:**
- Create: `src/data/load.ts`, `src/data/questions.ts`
- Test: `tests/unit/load.test.ts`, `tests/unit/questions.test.ts`

**Interfaces:**
- Consumes: the schemas (Task 6) and the generated and overlay JSON (Tasks 3, 5, 7, 9–11).
- Produces (`src/data/questions.ts`):
```ts
export interface Question { id: string; bank: BankId; number: number; passage: string | null; stem: string;
  options: { id: string; text: string }[]; answer: string; image: string | null; topic: Topic;
  explanation: string | null; notesRef: string | null; generated: boolean; review: string[] }
export const GROUPS: { id: 'mt' | 'hmls'; label: string; banks: BankId[] }[]  // [{mt,'Medical and trauma',['mt-a','mt-b']},{hmls,'HMLS',['hmls']}]
export function groupOf(bank: BankId): 'mt' | 'hmls'
export function mergeQuestions(raw: RawQuestionsDoc, overrides: OverridesDoc): Question[]
export function questionLabel(q: Question): string   // "Medical and trauma, part B, question 115" | "HMLS, question 12"
```
- **Merge rules:**
  - **Topic:** the override topic, else the raw topic, else `'assessment'`.
  - **`review`:** concatenates, in order:
    1. the auto reasons;
    2. the override's `review`;
    3. "The source question changed since this explanation was written." when the override's `srcHash` differs from the raw hash; the explanation is still shown;
    4. "No explanation yet." when there is no override, in which case explanation and notesRef are `null`.
- Produces (`src/data/load.ts`):
```ts
export type ContentKey = 'questions' | 'notes' | 'steps';
export type ContentData = { questions: Question[]; notes: NotesDoc; steps: StepsDoc };
export class ContentError extends Error { constructor(public kind: 'network' | 'invalid', message: string) }
export function loadJson<T>(path: string, schema: v.GenericSchema<unknown, T>, fetchImpl?: typeof fetch): Promise<T>
export function loadContent<K extends ContentKey>(key: K, fetchImpl?: typeof fetch): Promise<ContentData[K]>  // memoised; 'questions' merges questions.json + overrides.json
export type ContentState<K extends ContentKey> = ({ status: 'loading' } | { status: 'ready'; data: ContentData[K] } | { status: 'error'; kind: 'network' | 'invalid' }) & { retry(): void };
export function useContent<K extends ContentKey>(key: K): ContentState<K>
export function primeContent<K extends ContentKey>(key: K, data: ContentData[K]): void   // tests and stories
export function resetContentCache(): void                                                // tests
export function contentErrorCopy(key: ContentKey): string
```
- **Paths:** `import.meta.env.BASE_URL + 'data/<file>.json'`.
- **Errors:**
  - a rejected fetch or `!res.ok` is `network`;
  - bad JSON or a schema failure is `invalid`.
- **Retry:** `retry()` clears that key's memo and refetches.
- **`contentErrorCopy`:**
  - questions: "The question bank didn't load. It isn't saved on this phone yet. Connect once, then try again." (§7, verbatim);
  - notes: "The notes didn't load. They aren't saved on this phone yet. Connect once, then try again.";
  - steps: "The PAM steps didn't load. They aren't saved on this phone yet. Connect once, then try again."

- [ ] **Step 1: Write the failing tests**

`tests/unit/questions.test.ts`, against a two-question raw fixture:
- **Override merge:** an override's topic, explanation and notesRef are merged in.
- **Review Focus 4:**
  - a stale `srcHash` adds the "source question changed" reason and keeps the explanation;
  - a missing override gives `explanation: null`, topic `'assessment'` and reason "No explanation yet.";
  - auto and manual reasons come first, in order.
- **Labels:**
  - `questionLabel` gives "Medical and trauma, part B, question 115" for `mt-b` 115 and "HMLS, question 12" for `hmls` 12;
  - `groupOf('mt-a') === 'mt'`.

`tests/unit/load.test.ts`, with mocked `fetchImpl`:
- **Error kinds:** a rejecting fetch gives a `ContentError` of kind `network`; status 404 gives `network`; schema-invalid JSON gives `invalid`.
- **Memo:**
  - `loadContent('questions', f)` twice calls `f` twice (questions plus overrides), not four times;
  - after `resetContentCache()` it fetches again.
- **`useContent`** (through `@testing-library/preact` `renderHook`): `loading`, then `error`, then `retry()`, then `ready`.
- **Copy:** `contentErrorCopy('questions')` equals the §7 string exactly.
- **Real data:** `mergeQuestions` over `public/data/questions.json` and `overrides.json` gives 407 questions, and every `review` array is free of "No explanation yet."

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/unit/questions.test.ts tests/unit/load.test.ts`
Expected: FAIL resolving `src/data/questions`.

- [ ] **Step 3: Implement both files.**

- [ ] **Step 4: Run them and see them pass**

Run: `npx vitest run tests/unit/questions.test.ts tests/unit/load.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/load.ts src/data/questions.ts tests/unit/load.test.ts tests/unit/questions.test.ts
git commit -m "feat(data): content loader with error states and question overlay merge" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Quiz engine

**Files:**
- Create: `src/quiz/engine.ts`, `src/lib/rng.ts`
- Test: `tests/unit/engine.test.ts`

**Interfaces:**
- Consumes: `Question` and `GROUPS` (Task 13); `QStat`, `QuizSession`, `QuizFilter`, `QuizMode` and `AnswerRecord` (Task 12).
- Produces:
```ts
// src/lib/rng.ts
export type Rng = () => number;
export function mulberry32(seed: number): Rng
export function randomSeed(): number
// src/quiz/engine.ts
export function filterQuestions(qs: Question[], f: QuizFilter): Question[]           // ids, if given, win over group/topic
export function selectPractice(qs: Question[], stats: Record<string, QStat>, f: QuizFilter, n: number, rng: Rng): string[]  // unseen first, then oldest lastAt; shuffled within each tier
export function selectTest(qs: Question[], f: QuizFilter, n: 20 | 50, rng: Rng): string[]
export function reviewPool(qs: Question[], stats: Record<string, QStat>): string[]  // existing ids with rightSinceWrong !== null && < 2
export function clearedCount(qs: Question[], stats: Record<string, QStat>): number  // existing ids with rightSinceWrong >= 2
export function shuffleOptions(q: Question, rng: Rng): string[]
export function startSession(mode: QuizMode, ids: string[], f: QuizFilter, byId: Map<string, Question>, rng: Rng, now: Date): QuizSession
export function current(s: QuizSession): string | null
export function pick(s: QuizSession, optionId: string): QuizSession                 // ignored once checked
export function check(s: QuizSession, q: Question, stat: QStat | undefined, now: Date): { session: QuizSession; record: AnswerRecord | null }
export function next(s: QuizSession, byId: Map<string, Question>, rng: Rng): QuizSession
export function isFinished(s: QuizSession): boolean
export function applyAnswer(stats: Record<string, QStat>, r: AnswerRecord): Record<string, QStat>
export function resumeSession(s: QuizSession, byId: Map<string, Question>, rng: Rng): QuizSession | null
export function score(s: QuizSession): { right: number; answered: number; total: number }
export function bankProgress(qs: Question[], stats: Record<string, QStat>): { group: 'mt' | 'hmls'; label: string; answered: number; total: number }[]
export function displayLetter(index: number): 'A' | 'B' | 'C' | 'D'
```

**Semantics (spec §6.4):**
- **Shuffling and grading:** options are shuffled every time a question first shows in a session (`orders`), and grading compares option ids.
- **`check`:**
  - **No-op cases:** when `checked` is already set or nothing is picked, it returns the same session and `record: null`.
  - **Recording:** otherwise it records `{qid, picked, right: picked === q.answer, at}`, pushes the record to `done`, and sets `checked`.
  - **Review mode:** the qid is re-queued at the end unless this answer brings `rightSinceWrong` to 2.
- **`applyAnswer`:**
  - `seen` increases by 1, and `right` by 1 when the answer is right;
  - `lastAt` and `lastRight` are set;
  - a wrong answer sets `rightSinceWrong` to 0;
  - a right answer adds 1 when it is a number and leaves it `null` otherwise.

  A right answer in any mode counts toward clearing review.
- **`next`:** drops the head of the queue, clears `picked` and `checked`, and creates `orders` for the new head if it is missing.
- **Finishing:** the session is finished when the queue is empty.
- **`total`:**
  - in practice and test, the set size;
  - in review, the starting pool size.
- **`resumeSession`:**
  - drops queue and done ids that no longer exist;
  - rebuilds the order of any question whose option-id set changed;
  - returns `null` if the queue ends up empty.

- [ ] **Step 1: Write the failing tests** `tests/unit/engine.test.ts`

Use a fixture of 30 questions (`mt-a-q001…` with four options and answer `b`, mixed topics, plus 5 `hmls`) and `mulberry32(1)`.
- **Shuffling:**
  - `shuffleOptions` returns a permutation of `['a','b','c','d']`;
  - two seeds give different orders for some question;
  - picking the id `'b'` grades as right whatever its position.
- **Selection:**
  - `selectPractice` with 25 unseen and 5 seen questions, n=20, returns 20 ids, all of them unseen;
  - with every question seen, it returns the 20 with the oldest `lastAt`;
  - `{group: 'hmls'}` returns only `hmls`;
  - `{topic: 'cardiac'}` returns only cardiac;
  - `ids` wins.
- **Test sets:** `selectTest(…, 50)` on a 30-question pool returns 30 distinct ids.
- **Review Focus 1:**
  1. Call `pick`, then `check`, then `check` again.
  2. The second call returns `record: null`, and `done` has length 1.
  3. Applying the first record twice is impossible through the API. Also assert that `pick` after `check` is ignored.
- **`applyAnswer`:**
  - from no stat, a wrong answer gives `{seen 1, right 0, rightSinceWrong 0}`;
  - a right answer after that gives 1, and another gives 2;
  - a right answer on a never-wrong question keeps `null`.
- **Review pool:** `reviewPool` and `clearedCount` follow `rightSinceWrong`.
- **Review mode:**
  - a wrong answer re-queues the question;
  - two rights (stat at 0, then 1) re-queue once, then drop it;
  - the session is finished when the pool is clear.
- **Review Focus 4:**
  - `resumeSession` with one queued id deleted from `byId` drops it;
  - with one question's options changed to ids `['a','b','c']`, its order is rebuilt and the session is otherwise kept;
  - with every id gone, it returns `null`.
- **Scoring:** `score` counts the right answers in `done`.
- **Bank progress:** `bankProgress` counts answered (`seen` ≥ 1) per group and ignores stats for ids not in `qs`.
- **Letters:** `displayLetter(2) === 'C'`.

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run tests/unit/engine.test.ts`
Expected: FAIL resolving `src/quiz/engine`.

- [ ] **Step 3: Implement `src/lib/rng.ts` and `src/quiz/engine.ts`.**

- [ ] **Step 4: Run it and see it pass**

Run: `npx vitest run tests/unit/engine.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/quiz/engine.ts src/lib/rng.ts tests/unit/engine.test.ts
git commit -m "feat(quiz): pure quiz engine with shuffle-by-id, review-until-twice and resume" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: App shell

**Files:**
- Create:
  - `src/app/routes.ts`, `src/app/App.tsx`, `src/app/TabBar.tsx`, `src/app/FocusHeader.tsx`, `src/app/Scene.tsx`;
  - `src/ui/Keys.tsx`, `src/ui/Panel.tsx`, `src/ui/StatusChip.tsx`, `src/ui/BrandMark.tsx`, `src/ui/Icon.tsx`, `src/ui/Skeleton.tsx`, `src/ui/toast.tsx`;
  - `src/lib/haptics.ts`, `src/lib/format.ts`;
  - `src/styles/components.css`;
  - `playwright.config.ts`.
- Create (placeholders, each rendering only its `<h1>`; later tasks replace them): `src/today/Today.tsx`, `src/pam/PamTab.tsx`, `src/quiz/QuizTab.tsx`, `src/quiz/QuizSetup.tsx`, `src/quiz/QuizSession.tsx`, `src/quiz/QuizResult.tsx`, `src/notes/NotesTab.tsx`, `src/notes/SectionReader.tsx`, `src/settings/Settings.tsx`
- Modify: `src/main.tsx` (render `<App store={progress} />`)
- Test: `tests/unit/routes.test.ts`, `tests/unit/shell.test.tsx`, `tests/unit/haptics.test.ts`, `tests/e2e/shell.spec.ts`

**Interfaces:**
- Consumes: `ProgressStore`, `ProgressContext`, `progress` and `createProgressStore` (Task 12); `MemoryStorage` (Task 12 test helper).
- Produces:
```ts
// src/app/routes.ts
export type TabId = 'today' | 'pam' | 'quiz' | 'notes';
export type SceneVariant = 'today' | 'run' | 'quiet';
export type RouteName = 'today' | 'settings' | 'pam' | 'quiz' | 'quizSetup' | 'quizSession' | 'quizResult' | 'notes' | 'notesSection' | 'notFound';
export interface RouteDef { pattern: string; name: RouteName; tab: TabId | null; focus: boolean; scene: SceneVariant }
export const ROUTES: RouteDef[]          // Plan 2 appends '/pam/start', '/run', '/debrief/:id'
export interface RouteMatch { def: RouteDef; path: string; params: Record<string, string>; query: Record<string, string> }  // path: '/notes/s01/delicate-spine', no query
export function matchRoute(hash: string): RouteMatch
export function navigate(to: string, opts?: { replace?: boolean }): void   // to: '/quiz/session'
export function back(fallback: string): void                               // history.back() if this app navigated before, else navigate(fallback, {replace:true})
export function useRoute(): RouteMatch                                     // listens to hashchange
export function isRunRoute(path: string): boolean                          // path.startsWith('/run')
// src/app/App.tsx
export const SCREENS: Record<RouteName, ComponentType<{ match: RouteMatch }>>
export function App(props: { store: ProgressStore }): JSX.Element
// src/app/FocusHeader.tsx
export function FocusHeader(p: { exit: 'close' | 'pause'; onExit(): void; title: string; sub?: string; right?: ComponentChildren }): JSX.Element
// src/app/TabBar.tsx
export function TabBar(p: { active: TabId | null }): JSX.Element
// src/app/Scene.tsx
export function Scene(p: { variant: SceneVariant }): JSX.Element
// src/ui/*
export function Primary(p: { href?: string; onClick?(): void; disabled?: boolean; children: ComponentChildren }): JSX.Element   // ambulance white + band
export function Secondary(p: same): JSX.Element
export function TextLink(p: { href: string; children: ComponentChildren }): JSX.Element                                      // min-height 44px
export function Panel(p: { as?: 'section' | 'div' | 'aside'; class?: string; children: ComponentChildren }): JSX.Element
export function StatusChip(p: { kind: 'missed' | 'order' | 'phrase' | 'done'; label: string }): JSX.Element     // !!! / !! / !! / ✓
export function BrandMark(): JSX.Element
export function Icon(p: { name: 'today' | 'pam' | 'quiz' | 'notes' | 'settings' | 'close' | 'pause' | 'check' | 'cross' | 'list' | 'search' }): JSX.Element
export function Skeleton(p: { rows: number; rowHeight: string }): JSX.Element
export function useDelayedFlag(active: boolean, ms?: number): boolean      // default 300
export function toast(message: string, action?: { label: string; run(): void }): void
export function ToastHost(): JSX.Element                                    // role="status" aria-live="polite"
// src/lib/haptics.ts
export function haptic(kind: 'tap' | 'right' | 'wrong', enabled: boolean, nav?: Navigator): void   // Android UA + vibrate only
// src/lib/format.ts
export function formatSavedAt(iso: string): string                         // "9 Nov, 22:10" (en-SG, 24h)
```

**Route table:**

| Pattern | Name | Tab | Focus | Scene |
|---|---|---|---|---|
| `/` | today | today | no | today |
| `/settings` | settings | today | no | quiet |
| `/pam` | pam | pam | no | today |
| `/quiz` | quiz | quiz | no | quiet |
| `/quiz/setup` | quizSetup | quiz | no | quiet |
| `/quiz/session` | quizSession | – | **yes** | quiet |
| `/quiz/result` | quizResult | – | **yes** | quiet |
| `/notes` | notes | notes | no | quiet |
| `/notes/:section/:anchor?` | notesSection | – | **yes** | quiet |
| other | notFound | today | no | today |

Hash form: `#/notes/s01/delicate-spine?b=12`. An empty hash means `/`, and `notFound` renders Today.

**Visuals.** Port these rules from `scdf.fragment.html` into `components.css`, renaming each `.as-x` class to `.x` and converting px type sizes to rem:
- `.as-scene`, `.as-scene-run`, `.as-scene-quiet` (lines 67–96);
- `.as-ibtn`, `.as-panel`, `.as-primary`, `.as-btn2`, `.as-link`, `.as-tag*`, `.as-bang` (lines 103–116);
- `.as-appbar`, `.as-brand`, `.as-mark`, `.as-sol-*` (lines 143–151);
- `.as-tabs`, `.as-tab`, `.as-tab.as-on` (lines 173–177);
- `.as-mhead`, `.as-title`, `.as-addr`, `.as-count` (lines 182–183, 226–227, 250–251).

Two parts of the port need care:
- **Hover:** move any hover state into `@media (hover: hover)`.
- **Mockup-only parts:** don't port the phone frame, the fake status bar or the home bar.

`BrandMark` uses the Star of Life SVG from mockup line 299 unchanged, with the band strip under it.

**`App` behaviour:**
- **Layout:** it renders `Scene(def.scene)`, then the screen, then `TabBar` when `!def.focus`, then `ToastHost`, laid out in a `min-height: 100dvh` grid with safe-area padding.
- **Text size:** it sets `document.documentElement.dataset.textSize` from settings.
- **Load results:**
  - on a `restored` load, toast "Some progress couldn't be read. Your last good save, from {formatSavedAt}, is back.";
  - on `corrupt`, a banner at the top of the screen reads "Some progress couldn't be read." with [Try again] (`store.tryAgain()`) and [Start fresh] (`store.startFresh()`).
- **Save errors:** the first time `lastSaveError()` is set, toast "Progress couldn't be saved on this phone. It's kept until you close the app."

- [ ] **Step 1: Write the failing tests**

`tests/unit/routes.test.ts`:
- `matchRoute('')` and `matchRoute('#/')` give `today`;
- `'#/notes/s07'` gives `notesSection` with `params.section` s07;
- `'#/notes/s01/delicate-spine?b=3'` gives params `{section:'s01', anchor:'delicate-spine'}` and query `{b:'3'}`;
- `'#/quiz/session'` has `def.focus === true`;
- `'#/nope'` gives `notFound`;
- `isRunRoute('/run')` is true and `isRunRoute('/quiz')` false.

`tests/unit/shell.test.tsx`:
- **Tab bar on a tab route:** with `location.hash = '#/quiz'` and `<App store={createProgressStore(new MemoryStorage())}/>`:
  - there is a `nav` named "Main" with 4 links (Today, PAM, Quiz, Notes);
  - only Quiz has `aria-current="page"`;
  - each link's `href` starts `#/`.
- **Tab bar on a focus route:** at `#/quiz/session` there is no `nav`.
- **`FocusHeader`:** with `exit="close"` it renders a button named "Close"; with `exit="pause"`, one named "Pause"; the title is an `h1`.
- **Corrupt save:** with a corrupt storage, the text "Some progress couldn't be read." and buttons "Try again" and "Start fresh" show, and clicking Start fresh removes the banner.
- **`useDelayedFlag`:** with fake timers, the flag is false at 299 ms and true at 300 ms.
- **`StatusChip`:** kind `missed` with label `Missed` renders the text `!!!Missed`.

Import `MemoryStorage` from `tests/unit/helpers.ts` (Task 12).

`tests/unit/haptics.test.ts`:
- an Android UA with `vibrate` and `enabled` calls `vibrate` once;
- an iPhone UA doesn't;
- `enabled: false` doesn't.

`tests/e2e/shell.spec.ts` (Playwright; viewport set in config):
- visit `/`; four tab links are visible, each at least 44px tall;
- `document.documentElement.scrollWidth <= innerWidth`;
- save the screenshot to `test-results/shots/shell.png`.

`playwright.config.ts`:
- `testDir: 'tests/e2e'`;
- `use: { baseURL: 'http://localhost:4173', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true }`;
- `webServer: { command: 'npm run build && npm run preview', url: 'http://localhost:4173', reuseExistingServer: true, timeout: 120_000 }`;
- `snapshotPathTemplate: '{testDir}/__screens__/{arg}{ext}'`.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/unit/routes.test.ts tests/unit/shell.test.tsx tests/unit/haptics.test.ts`
Expected: FAIL resolving `src/app/routes`.

- [ ] **Step 3: Implement the files listed**, wiring the placeholder screens into `SCREENS`.

- [ ] **Step 4: Run unit and e2e**

Run: `npx vitest run && npx playwright test tests/e2e/shell.spec.ts`
Expected: all PASS. Open `test-results/shots/shell.png` and check it against mockup screen 1, looking at the tab bar and the background scene.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(shell): hash router, tab bar, focus header, scene and UI primitives" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Quiz tab and setup

**Files:**
- Create: `src/quiz/useQuiz.ts`
- Modify: `src/quiz/QuizTab.tsx`, `src/quiz/QuizSetup.tsx`, `src/styles/components.css`
- Test: `tests/unit/quiz-tab.test.tsx`

**Interfaces:**
- Consumes:
  - `useContent('questions')`, `contentErrorCopy` (Task 13);
  - the engine (Task 14);
  - `useStore`/`useProgress` (Task 12);
  - `navigate`, `Panel`, `Primary`, `Secondary`, `Skeleton`, `useDelayedFlag` (Task 15);
  - `TOPICS` (Task 6).
- Produces:
```ts
// src/quiz/useQuiz.ts
export function startQuiz(store: ProgressStore, questions: Question[], mode: QuizMode, filter: QuizFilter, n?: 20 | 50): void
  // builds ids (practice: selectPractice n=20; test: selectTest n; review: reviewPool), startSession with randomSeed(),
  // sets quizOpen, navigates '/quiz/session'
export function filterLabel(f: QuizFilter): string   // "Respiratory, both banks" | "All topics, HMLS" | "Medical and trauma" | "From your notes"
```

**Screen content**

`QuizTab` (`#/quiz`) has:
- the header "Theory quiz";
- three mode cards:
  - **Practice:** "Pick a bank and topic. See the answer straight away." Opens `#/quiz/setup?mode=practice`.
  - **Test:** "20 or 50 questions. Score at the end." Opens `#/quiz/setup?mode=test`.
  - **Review wrong:** "Questions you got wrong, until you get each right twice."
- a bank progress panel with rows "Medical and trauma — {answered} of {total} answered" and "HMLS — {answered} of {total}", each with the track bar from mockup `.as-track`.

The Review wrong card depends on the review pool:
- **Pool of N > 0:** a Primary "Review {N} you got wrong" that calls `startQuiz(…'review'…)`.
- **Empty pool, `clearedCount` of 0:** "Nothing to review yet. Questions you get wrong will collect here." with [Start practice]. This is §7 copy, verbatim.
- **Empty pool, `clearedCount` of n > 0:** "All {n} cleared. New mistakes will show up here." with [Practise 20 more], which starts practice with `{group:'all', topic:'all'}`. This is §7 copy, verbatim.

Content states:
- **Loading:** nothing for 300 ms, then `Skeleton` rows sized like the panel.
- **Error:** `contentErrorCopy('questions')` with [Try again] (`retry`).

`QuizSetup` (`#/quiz/setup?mode=…`) has:
- a bank radio group: All banks, Medical and trauma, HMLS;
- topic chips with counts for the chosen group: "All topics", then each present topic with its count, as `aria-pressed` buttons;
- in test mode only, a length radio: 20 or 50;
- Primary "Start practice" or "Start test".

- [ ] **Step 1: Write the failing tests** `tests/unit/quiz-tab.test.tsx`

Wrap renders in `ProgressContext` with a memory store, and call `primeContent('questions', fixture)`.
- **Review states:**
  - with no stats, the exact Review empty copy shows, with a "Start practice" button;
  - with 12 stats at `rightSinceWrong: 2`, the text "All 12 cleared. New mistakes will show up here." and a "Practise 20 more" button show;
  - with 3 at `rightSinceWrong: 0`, clicking "Review 3 you got wrong" sets `quizOpen.mode` to `'review'` with 3 queued, and the hash becomes `#/quiz/session`.
- **Bank progress:** the text `0 of 346 answered` uses the real merged data, through `primeContent` with `mergeQuestions` of the real files.
- **Content states:**
  - a failing load (`resetContentCache` plus a rejecting `fetch` stub) shows the exact §7 copy and a "Try again" button;
  - while loading with fake timers, no skeleton shows before 300 ms and one does after.
- **Setup:**
  - choosing HMLS plus "All topics" and Start practice sets 20 queued ids, all `hmls-`;
  - test mode with 50 selected gives `total` 50.

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run tests/unit/quiz-tab.test.tsx`
Expected: FAIL (the placeholder renders no mode cards).

- [ ] **Step 3: Implement `useQuiz.ts`, `QuizTab` and `QuizSetup`.**

- [ ] **Step 4: Run it and see it pass**

Run: `npx vitest run tests/unit/quiz-tab.test.tsx && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/quiz tests/unit/quiz-tab.test.tsx src/styles/components.css
git commit -m "feat(quiz): quiz tab, review states and practice/test setup" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: Quiz session and result

**Files:**
- Create: `src/quiz/OptionList.tsx`, `src/quiz/Feedback.tsx`
- Modify: `src/quiz/QuizSession.tsx`, `src/quiz/QuizResult.tsx`, `src/styles/components.css`
- Test: `tests/unit/quiz-session.test.tsx`, `tests/e2e/seed.ts`, `tests/e2e/quiz.spec.ts`
- **Seeding helper:** `tests/e2e/seed.ts` exports `seed(page: Page, data: Progress): Promise<void>`.
  - It builds `{ v: SCHEMA_VERSION, seq: 1, savedAt: new Date().toISOString(), sum: checksum(JSON.stringify(data)), data }`, importing `checksum`, `SLOT_KEYS`, `SCHEMA_VERSION` and `defaultProgress` straight from `src/progress/*`, since they are pure TS.
  - It writes that envelope to `localStorage[SLOT_KEYS[1]]` with `page.addInitScript`.
  - `practiceSession(ids, orders)` builds a fresh practice `QuizSession` for seeding.

**Interfaces:**
- Consumes:
  - the engine (Task 14);
  - `questionLabel` (Task 13);
  - `notesRefHref` and `notesRefLabel` (Task 6);
  - `useContent('notes')` for link labels; it's optional and falls back to "Notes N";
  - `haptic` (Task 15);
  - `filterLabel` (Task 16).
- Produces:
```ts
export function OptionList(p: { q: Question; order: string[]; picked: string | null; checked: AnswerRecord | null; reveal: boolean; onPick(id: string): void }): JSX.Element
export function Feedback(p: { q: Question; order: string[]; record: AnswerRecord; notes: NotesDoc | null }): JSX.Element
```

**Session screen** (`#/quiz/session`), a focus screen:
- **Header:** `FocusHeader` with `exit="close"`. Close navigates to `/quiz` and leaves `quizOpen` saved, so Today can offer to resume.
  - **Title:** Practice, Test or Review wrong.
  - **Sub-line:** `filterLabel`.
  - **Right slot:** `<b>{done.length + 1}</b> of {total}`; review mode shows `{queue.length} left` instead.
- **Load:** on mount, run `resumeSession`. A `null` result clears `quizOpen` and navigates to `/quiz`.
- **Body:**
  - the bank line (`questionLabel`);
  - the passage, in a `Panel`, when present;
  - the image, `<img alt="ECG strip for this question">`, when present;
  - the "Under review" note when `q.review.length` is non-zero and the id isn't in `dismissedReview`: "Under review: {reasons joined by ' '}" with [Dismiss], which adds the id;
  - the `OptionList`: a `<fieldset>` whose `<legend>` is the stem, with native `<input type="radio">` options labelled with display letters A–D in session order.
- **Keys:** a bottom keys row, from mockup `.as-keys2`.
  - **Practice and review, before Check:** a score of `<b>{right}</b> of {answered} right` and Primary "Check", disabled until an option is picked.
  - **Practice and review, after Check:** `Feedback`, then Primary "Next question", or "See results" on the last question.
  - **Test:** Primary "Next", or "Finish test" on the last question. Nothing is revealed.
- **Check:**
  1. `check`, then `applyAnswer` into `questions` stats;
  2. save `quizOpen`;
  3. call `haptic('wrong' | 'right')`;
  4. on a wrong answer, add the `shake` class once (220 ms or less; none under reduced motion);
  5. the official option's ring draws in with `--t-base`.
- **Finish:** set `quizLast = session` and `quizOpen = null`, then navigate to `/quiz/result`.

**Feedback** (spec §6.4 and mockup screen 4):
- **Answer badges:** the official option gets the green "Answer" badge (`.opt-ok`) and the pick gets the magenta "Yours" badge (`.opt-bad`), in both words and colour.
- **Verdict:**
  - a wrong pick reads "Wrong: you picked {X}. The answer is {Y}.";
  - a right pick reads "Right: {Y} is the answer.";
  - here X and Y are display letters.
- **Explanation:** the explanation follows, then a `TextLink` to `notesRefHref` labelled with `notesRefLabel` when there is a `notesRef`.

**Result screen** (`#/quiz/result`), a focus screen with `exit="close"` that returns to `/quiz`:
- **Score:** "{right} of {total} right" in `--f-fig`.
- **List:** each question, with a `StatusChip` (`done` "Right" or `missed` "Wrong"). Wrong rows expand to Yours, Answer and the explanation.
- **Keys:** Primary "New test" or "Practise 20 more", matching the mode, and Secondary "Done".

- [ ] **Step 1: Write the failing tests**

`tests/unit/quiz-session.test.tsx` uses a store seeded with a practice session over a fixture question:
- **Fixture:** options `a…d`, answer `b`, and a fixed order `['c','b','a','d']`, so the display letters are A=c, B=b, C=a, D=d.
- **Wrong answer:**
  1. Pick display C (id `a`), then click Check.
  2. The text "Wrong: you picked C. The answer is B." shows.
  3. The label containing option `b`'s text also contains "Answer", and the label for option `a` contains "Yours".
- **Notes link:** the link labelled "Notes 11…" has href `#/notes/s11/oxygen-masks`, given the question's `notesRef: 's11#oxygen-masks'`.
- **Review Focus 1:** double-clicking Check gives `progress.get().questions[id].seen === 1` and `quizOpen.done.length === 1`.
- **Radio semantics:** `getByRole('group', { name: <stem> })` contains 4 `radio`s. Moving between radios with arrow keys does not submit.
- **Test mode:**
  - pick, then Next, and no "Wrong:" or "Right:" text shows;
  - after the last question, the hash is `#/quiz/result` and "1 of 2 right" shows.
- **Under review:** the note shows on a question with a review reason; Dismiss adds its id to `dismissedReview` and hides it.
- **Close:** Close sets the hash to `#/quiz`, and `quizOpen` is still set.

`tests/e2e/quiz.spec.ts`:
- **Practice flow:**
  - starting practice from the Quiz tab opens `#/quiz/session` with a radio group;
  - then, seeding `quizOpen = practiceSession(['mt-b-q115', 'mt-a-q001'], { 'mt-b-q115': ['a','b','c','d'] })` and opening `#/quiz/session`, pick C and press Check;
  - "Wrong: you picked C. The answer is B." is visible;
  - save `test-results/shots/quiz-wrong.png`.
- **Review Focus 5:**
  1. Set the largest text size with `await page.evaluate(() => { document.documentElement.dataset.textSize = 'larger'; })` once the screen has rendered. `App` only rewrites the attribute when settings change, so it holds.
  2. Use a 375px viewport.
  3. On the session screen and on the result screen, `scrollWidth <= innerWidth`.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/unit/quiz-session.test.tsx`
Expected: FAIL (the placeholder has no radio group).

- [ ] **Step 3: Implement the session, result, `OptionList` and `Feedback`.**

- [ ] **Step 4: Run them and see them pass**

Run: `npx vitest run tests/unit/quiz-session.test.tsx && npx playwright test tests/e2e/quiz.spec.ts`
Expected: PASS. Compare `quiz-wrong.png` with mockup screen 4.

- [ ] **Step 5: Commit**

```bash
git add src/quiz tests/unit/quiz-session.test.tsx tests/e2e/seed.ts tests/e2e/quiz.spec.ts src/styles/components.css
git commit -m "feat(quiz): practice, test and review sessions with feedback and results" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: Notes tab and search

**Files:**
- Create: `src/notes/text.ts`
- Modify: `src/notes/NotesTab.tsx`, `src/styles/components.css`
- Test: `tests/unit/notes-search.test.ts`, `tests/unit/notes-tab.test.tsx`

**Interfaces:**
- Consumes: `NotesDoc`, `Block` and `Run` (Task 6); `useContent('notes')` (Task 13); `useProgress` (Task 12).
- Produces (`src/notes/text.ts`; Task 19 extends this file):
```ts
export function runsText(runs: Run[]): string
export function blockText(b: Block): string               // all text inside, including nested table cells and boxes
export interface SearchHit { sectionId: string; sectionTitle: string; blockIndex: number; before: string; match: string; after: string }
export function searchNotes(notes: NotesDoc, query: string, limit?: number): SearchHit[]   // default 50
```
- **Search rules:**
  - case-insensitive;
  - plain substring, never a RegExp built from input;
  - a trimmed query shorter than 2 characters returns `[]`;
  - one hit per top-level block;
  - `before` and `after` are up to 40 characters each, cut at word boundaries.

**`NotesTab` (`#/notes`) content:**
- **Search:** a search input labelled "Search your notes", 16px.
  - **Results:** with 2 or more characters typed, show "{n} matches" and hit rows, each "{n}. {title}" with the snippet's `match` in `<mark>`. Each row links to `#/notes/{id}?b={blockIndex}`.
  - **No results:** "No matches for "{q}"."
- **Section list:** otherwise, 20 rows, each a link to `#/notes/{id}`, showing:
  - number and title;
  - a "not tested" tag when present;
  - "{highlights} highlights";
  - a "Last read" marker on `progress.notes.lastSection`.
- **States:** a skeleton after 300 ms, and the notes error copy with Try again.

- [ ] **Step 1: Write the failing tests**

`tests/unit/notes-search.test.ts`, against the real `public/data/notes.json`:
- `searchNotes(notes, 'ensapa')` finds a hit in `s01`;
- `'(ENSAPA'` doesn't throw and finds the same hits;
- `'e'` returns `[]`;
- `'  '` returns `[]`;
- `'1 every 5s'`, which sits only in the page-split part of the s01 rescue-breathing remark box, gives exactly one hit, and its `blockIndex` is that box's top-level index;
- `'Orientated'` finds a hit in `s03` coming from the verbal-response table;
- `limit` caps the results.

`tests/unit/notes-tab.test.tsx`, with the real notes primed:
- there are 20 section links, and the first has href `#/notes/s01`;
- with `notes.lastSection: 's07'`, the s07 row contains "Last read";
- typing "ensapa" shows "matches" and a link whose href matches `#/notes/s01?b=\d+`;
- typing "zzqx" shows `No matches for "zzqx".`

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/unit/notes-search.test.ts tests/unit/notes-tab.test.tsx`
Expected: FAIL resolving `src/notes/text`.

- [ ] **Step 3: Implement `text.ts` and `NotesTab`.**

- [ ] **Step 4: Run them and see them pass**

Run: `npx vitest run tests/unit/notes-search.test.ts tests/unit/notes-tab.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notes tests/unit/notes-search.test.ts tests/unit/notes-tab.test.tsx src/styles/components.css
git commit -m "feat(notes): notes tab with section list, last-read marker and search" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 19: Notes section reader

**Files:**
- Create: `src/notes/Blocks.tsx`
- Modify: `src/notes/SectionReader.tsx`, `src/notes/text.ts`, `src/styles/components.css`
- Test: `tests/unit/reader.test.tsx`, `tests/unit/notes-text.test.ts`, `tests/e2e/notes.spec.ts`

**Interfaces:**
- Consumes:
  - `useContent('notes')`, `useContent('steps')` and `useContent('questions')` (Task 13);
  - `startQuiz` (Task 16);
  - `FocusHeader` (Task 15);
  - `resolveNotesRef` (Task 6).
- Produces (adds to `src/notes/text.ts`):
```ts
export interface Passage { headingId: string | null; heading: string; runs: Run[] }
export function highlightPassages(section: Section): Passage[]   // Task 5's passage definition; heading = nearest preceding h, else section title
export function linksForSection(sectionId: string, steps: Step[], questions: Question[]): { steps: Step[]; questionIds: string[] }
export function Blocks(p: { blocks: Block[] }): JSX.Element      // in Blocks.tsx
```
- **`Blocks` rendering:**
  - **Headings:** `h` becomes `<h2 id={id}>`, styled as a group label when `group` is set.
  - **Paragraphs:** `p` becomes `<p>`.
  - **Runs:** each run renders `<strong>`, `<em>`, `<u>` and `<mark class="hl">` as flagged, with `mark` using `--c-hl-bg` and `--c-hl-edge`.
  - **Lists:** `list` becomes `<ul class="notes-list">`. Each `<li data-depth>` shows its marker text: an `aria-hidden` "•" or "–" for bullets, and visible text for "1.".
  - **Tables:** `table` becomes `<div class="table-scroll" tabindex="0" role="region" aria-label="Table">` wrapping a `<table>`, with `th` for header rows. The wrapper has `overflow-x: auto` so the page never scrolls sideways.
  - **Boxes:** `box` becomes `<aside class="box box-{variant}">` with its title.
  - **Images:** `img` becomes `<img loading="lazy">`, with `max-width: 100%`.
  - **Block attributes:** every top-level block carries `data-b={index}`.

**`SectionReader`** (`#/notes/:section/:anchor?`, query `b`), a focus screen:
- **Header:** `FocusHeader` with `exit="close"` that calls `back('/notes')`. Title "{n}. {title}"; sub-line "Section {n} of 20".
- **Toolbar:**
  - a two-button switch, Full text / Highlights only, using `aria-pressed`;
  - a text-size button, "Text size: Standard", that cycles standard, large and larger. It writes `settings.textSize`, the same setting Settings uses.
- **Body:**
  - **Full text:** `Blocks`.
  - **Highlights only:** passages grouped under an `<h2>` holding their heading text, in document order. With no passages, "No highlights in this section."
- **On mount:**
  - set `notes.lastSection` and add the id to `notes.read`;
  - scroll to `#anchor` or `[data-b=b]` with `scrollIntoView({ block: 'start' })`.
- **Cross-links panel:**
  - "Used in PAM steps": chips "{order} {name}", plain text in Plan 1; Plan 2 turns them into drill links;
  - "Quiz questions": "Practise the {n} questions on this section", which calls `startQuiz(…'practice', {group:'all', topic:'all', ids})`;
  - each part shows only when non-empty.
- **Footer:** links to the previous and next sections, "← {n}. {title}" and "{n}. {title} →", hidden at the ends.

- [ ] **Step 1: Write the failing tests**

`tests/unit/notes-text.test.ts`, against the real notes:
- for every section, `highlightPassages(s).length === s.highlights`, which keeps the Python and TypeScript counts in step;
- each passage has at least one run with `h`;
- `linksForSection('s01', realSteps, realQuestions).steps` has length 19;
- `questionIds` holds exactly the questions whose `notesRef` starts with `s01`.

`tests/unit/reader.test.tsx`, with the real notes and steps primed:
- **Header:** at `#/notes/s07` the heading is "7. Auscultation (6 points)" and "Section 7 of 20" shows.
- **Highlights only:**
  - at `#/notes/s01`, clicking "Highlights only" gives that button `aria-pressed="true"`;
  - a `mark` containing "NEVER move the patient" is visible;
  - `getByRole('heading', { name: 'Approach Patient' })` is present.
- **Reading progress:** after opening s07, `notes.lastSection` is `'s07'` and `read` contains `'s07'`.
- **Anchor scroll:** at `#/notes/s01/delicate-spine`, `Element.prototype.scrollIntoView` (mocked) was called on `#delicate-spine`.
- **Prev and next:**
  - s01 has no previous link, and its next link has href `#/notes/s02`;
  - s20 has no next link.
- **Cross-links:** at `#/notes/s01` the "Used in PAM steps" chips include "8 Delicate spine".
- **Tables:** every rendered `<table>` sits inside `.table-scroll`.

`tests/e2e/notes.spec.ts`:
- **Review Focus 5:**
  1. Set a 375px viewport and the largest text size, the same way as Task 17's e2e.
  2. Open `#/notes/s02`, which has the 4-column hospital-code table.
  3. `scrollWidth <= innerWidth`, and the `.table-scroll` box has `scrollWidth > clientWidth` or fits.
- **Screenshots:**
  - open `#/notes/s01` and save `test-results/shots/reader.png`;
  - switch to Highlights only and save `reader-highlights.png`.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/unit/notes-text.test.ts tests/unit/reader.test.tsx`
Expected: FAIL (`highlightPassages` not exported).

- [ ] **Step 3: Implement `Blocks.tsx`, the `text.ts` additions and `SectionReader`.**

- [ ] **Step 4: Run them and see them pass**

Run: `npx vitest run tests/unit/notes-text.test.ts tests/unit/reader.test.tsx && npx playwright test tests/e2e/notes.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notes tests/unit/notes-text.test.ts tests/unit/reader.test.tsx tests/e2e/notes.spec.ts src/styles/components.css
git commit -m "feat(notes): section reader with highlights-only view and cross-links" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 20: Today, PAM tab and Settings

**Files:**
- Create: `src/today/FirstRun.tsx`, `src/ui/RunStrip.tsx`, `src/lib/offline.ts`
- Modify: `src/today/Today.tsx`, `src/pam/PamTab.tsx`, `src/settings/Settings.tsx`, `src/styles/components.css`
- Test: `tests/unit/today.test.tsx`, `tests/unit/settings.test.tsx`, `tests/unit/runstrip.test.tsx`, `tests/e2e/today.spec.ts`

**Interfaces:**
- Consumes:
  - `bankProgress` and `reviewPool` (Task 14);
  - `useContent` (Task 13);
  - `resumeSession` (Task 14);
  - `BrandMark`, `Panel`, `Primary`, `Secondary`, `TextLink` (Task 15).
- Produces:
```ts
// src/ui/RunStrip.tsx  (Plan 2 adds the trace and markers through new optional props)
export const STRIP = { width: 315, height: 80, rbsLimitS: 180, limitS: 1200 } as const;
export function timeToX(seconds: number): number      // 8 + seconds * 145 / 600  (0 -> 8, 3:00 -> 51.5, 10:00 -> 153, 20:00 -> 298)
export function RunStrip(p: { label: string }): JSX.Element
  // role="img" aria-label={label}; draws the baseline, the dashed 3:00 RBS limit line, the band chevrons clipped at x 299–311,
  // and axis labels "0", "RBS 3:00", "10", "20 min" — exactly as the mockup's Today strip (lines 315–333) without the trace
// src/lib/offline.ts
export function offlineReady(nav?: Navigator): boolean   // !!nav.serviceWorker?.controller
```

**Today (`#/`)** has, from top to bottom:
1. **App bar:** `BrandMark` and an icon button "Settings" linking to `#/settings`.
2. **Quiz resume row**, when `quizOpen` is set and `resumeSession` is non-null: "Quiz in progress: {Practice | Test | Review wrong}, {done.length} of {total} answered." with [Resume], which opens `#/quiz/session`, and [Discard], which clears `quizOpen`.
3. **First-run checklist** (`FirstRun`), "Start here". Each item ticks itself and has an `aria-label` of "Done" or "Not done yet":
   - "Read the PAM steps in your notes" links to `#/notes/s01`, and ticks when `notes.read` includes `s01`;
   - "Do a Coached run" ticks when `runs` has a non-drill coached run;
   - "Do an Exam run" ticks when `runs` has a non-drill exam run.
   - The run items say "Arrives with the simulator" while the simulator is missing.
4. **Last run panel**, while there are no non-drill runs:
   - the §7 copy "No runs yet. A run takes about 20 minutes. The clock starts when you say Approach.";
   - `<RunStrip label="Run strip, 0 to 20 minutes. No runs yet. Limits: RBS by 3:00, whole run by 20:00."/>`;
   - the line "The simulator arrives in the next update." where §7's [Start your first run] will go in Plan 2.
5. **Theory quiz panel**, as mockup lines 336–342:
   - rows "Medical and trauma — {a} of {t} answered" and "HMLS — {a} of {t}", each with a track;
   - the link "Review {N} you got wrong", only when N > 0, which starts review.
6. **Continue reading:** "Continue reading: {n}. {title}", linking to the last-read section, or "Start with 1. Primary Survey".

**PAM tab (`#/pam`)** shows:
- the heading "PAM";
- the same No runs copy and empty `RunStrip`;
- "The simulator arrives in the next update."

**Settings (`#/settings`)** has a header with a back button, labelled "Back", that calls `back('/')`, and these sections:
- **Text size:** a radio group with Standard, Large and Larger. It writes `settings.textSize`, which applies immediately.
- **Haptics:** a switch, `role="switch"` with `aria-checked`, labelled "Vibrate on answers", with the sub-line "Android only". It writes `settings.haptics`.
- **Offline:**
  - "Version {__APP_VERSION__}, built {__BUILD_DATE__}.";
  - then either "Saved for offline use." or "Not saved for offline use yet. Open the app once with a connection.", from `offlineReady()`.
- **Reset progress:** "Clears quiz history, reading place and runs on this phone. Your settings stay."
  - an input labelled "Type RESET to confirm";
  - a Secondary button "Reset progress", enabled only when `value.trim().toUpperCase() === 'RESET'`;
  - on click, `store.resetProgress()` and the toast "Progress reset."

- [ ] **Step 1: Write the failing tests**

`tests/unit/runstrip.test.tsx`:
- `timeToX(0) === 8`, `timeToX(180) === 51.5`, `timeToX(600) === 153` and `timeToX(1200) === 298`;
- the strip is a `role="img"` with the given label;
- the texts "RBS 3:00" and "20 min" render.

`tests/unit/today.test.tsx`:
- **Fresh store:**
  - the three checklist items show "Not done yet";
  - the exact No runs copy and the strip `img` are present;
  - "Medical and trauma" and `0 of 346 answered` show;
  - no "Review" link shows.
- **Reading:** with `notes.read: ['s01']`, the first item is "Done".
- **Review link:** with 2 stats at `rightSinceWrong: 0`, "Review 2 you got wrong" shows.
- **Resume:** with an open practice session (1 done of 20), the text "Quiz in progress: Practice, 1 of 20 answered." shows, and Discard clears `quizOpen`.
- **Continue reading:** with `lastSection: 's07'`, "Continue reading: 7. Auscultation (6 points)" links to `#/notes/s07`.
- **PAM tab:** it renders the No runs copy.

`tests/unit/settings.test.tsx`:
- **Text size:** choosing Larger sets `document.documentElement.dataset.textSize === 'larger'` and `settings.textSize`.
- **Haptics:** toggling flips `settings.haptics`.
- **Reset:**
  - the Reset button is disabled with "reset " typed and enabled with "RESET";
  - after a reset, `questions` is `{}` and `settings.textSize` is still `'larger'`.
- **Version:** "Version 0.1.0" shows.

`tests/e2e/today.spec.ts`:
- visit `/`;
- the checklist and the strip are visible;
- there is no horizontal scroll;
- every visible `button` and `a` in the main content is at least 44px tall;
- save `test-results/shots/today.png`.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/unit/runstrip.test.tsx tests/unit/today.test.tsx tests/unit/settings.test.tsx`
Expected: FAIL resolving `src/ui/RunStrip`.

- [ ] **Step 3: Implement the files.**

- [ ] **Step 4: Run them and see them pass**

Run: `npx vitest run && npx playwright test tests/e2e/today.spec.ts`
Expected: PASS. Compare `today.png` with mockup screen 1, minus the headline and the last-run trace, which are Plan 2.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(today): first-run Today, PAM placeholder and minimal Settings" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 21: PWA and offline

**Files:**
- Create: `public/icons/icon.svg`, `tools/make_icons.mjs`, `public/icons/icon-192.png`, `public/icons/icon-512.png`, `public/icons/maskable-512.png`, `src/app/PwaPrompts.tsx`
- Modify:
  - `vite.config.ts`: add the plugin, and `test.setupFiles: ['tests/unit/setup.ts']`;
  - `src/app/App.tsx`: mount `<PwaPrompts/>`;
  - `tsconfig.json`: add `"vite-plugin-pwa/preact"` to `types`.
- Test: `tests/unit/setup.ts`, `tests/unit/pwa.test.tsx`, `tests/unit/icons.test.ts`, `tests/e2e/offline.spec.ts`
- **Mock:** `tests/unit/setup.ts` does `vi.mock('virtual:pwa-register/preact', …)` with inert defaults: both flags false and a no-op update. Every component test that renders `<App/>` then runs in jsdom without a service worker. `pwa.test.tsx` overrides the mock per test.

**Interfaces:**
- Consumes:
  - `useRegisterSW` from `virtual:pwa-register/preact`;
  - `toast` and `isRunRoute`/`useRoute` (Task 15);
  - `progress.flags.offlineToastShown` (Task 12).
- Produces:
  - `export function PwaPrompts(): null`;
  - the service worker and `manifest.webmanifest` in `dist/`.

**`vite.config.ts`** adds:
```ts
VitePWA({
  registerType: 'prompt', injectRegister: false,
  includeAssets: ['robots.txt', 'icons/icon.svg'],
  manifest: { name: 'Crew Leader', short_name: 'Crew Leader', description: 'PAM, theory quiz and survey notes practice.',
    start_url: './', scope: './', display: 'standalone', orientation: 'portrait',
    background_color: '#121719', theme_color: '#121719',
    icons: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }] },
  workbox: { globPatterns: ['**/*.{js,css,html,svg,png,woff2,json,txt,webmanifest}'],
    maximumFileSizeToCacheInBytes: 6 * 1024 * 1024, navigateFallback: 'index.html', cleanupOutdatedCaches: true },
})
```

**`icon.svg`:**
- **Content:** the `BrandMark` Star of Life on a `#121719` rounded square, with the band strip under the star.
- **Rendering:** `node tools/make_icons.mjs` renders it with Playwright Chromium `page.screenshot` at 192 and 512. The maskable version uses 512 with the star scaled to 60%, as the maskable safe zone requires.

**`PwaPrompts` copy** (§7, verbatim):
- **`offlineReady`:** toast "Ready to use offline."
- **`needRefresh`:** toast "A new version is ready." with [Reload], which calls `updateServiceWorker(true)`. It never shows while `isRunRoute(route.path)`; instead it waits until the route leaves the run.
- **Offline:** on a `window` `offline` event, toast "You're offline. Everything still works." once only. It checks and sets `flags.offlineToastShown`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/pwa.test.tsx`: `vi.mock('virtual:pwa-register/preact', …)` returns controllable `needRefresh`, `offlineReady` and `updateServiceWorker` mocks.
- **Offline ready:** `offlineReady: true` shows "Ready to use offline."
- **Update:**
  - `needRefresh: true` at `#/quiz` shows "A new version is ready." with a "Reload" button that calls `updateServiceWorker(true)`;
  - at `#/run` it shows nothing.
- **Offline toast:**
  - dispatching `offline` twice shows the toast once;
  - `flags.offlineToastShown` becomes true;
  - a new mount with that flag shows nothing.

`tests/unit/icons.test.ts` reads each PNG's IHDR bytes 16–23 and asserts 192×192, 512×512 and 512×512.

`tests/e2e/offline.spec.ts`:
1. Visit `/`.
2. `await page.evaluate(() => navigator.serviceWorker.ready)` and reload once, so the service worker controls the page.
3. `context.setOffline(true)`.
4. Reload.
5. Open the Quiz tab: `0 of 346 answered` is visible.
6. Open `#/notes/s07`: "7. Auscultation (6 points)" is visible, and the image in section 7 has `naturalWidth > 0`.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/unit/pwa.test.tsx tests/unit/icons.test.ts`
Expected: FAIL resolving `src/app/PwaPrompts`; the icon files are missing.

- [ ] **Step 3: Implement it.** Run `node tools/make_icons.mjs`, then build.

Run: `npm run build`
Expected: `dist/sw.js` and `dist/manifest.webmanifest` exist; the precache list in `sw.js` includes `data/questions.json`, `data/notes.json` and `img/notes/s07-1.png`.

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx vitest run tests/unit/pwa.test.tsx tests/unit/icons.test.ts && npx playwright test tests/e2e/offline.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(pwa): installable offline app with update and offline prompts" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 22: Screen checks at 390px

**Files:**
- Create: `tests/e2e/screens.spec.ts`, `tests/e2e/__screens__/*.png` (baselines)

**Interfaces:**
- Consumes:
  - every screen built so far;
  - the Playwright config (Task 15);
  - `seed` and `practiceSession` from `tests/e2e/seed.ts` (Task 17), so the screens open on fixed content.
- Produces: committed screenshot baselines that later plans update on purpose.

- [ ] **Step 1: Write the spec** `tests/e2e/screens.spec.ts`

It covers these screens:
- Today (first run);
- Quiz tab;
- Quiz setup (practice);
- a Quiz session answered wrong. Seed `quizOpen` as a practice session with `queue: ['mt-b-q115', 'mt-a-q001']` and `orders['mt-b-q115'] = ['a','b','c','d']`, then pick C and press Check;
- the Quiz result. Seed `quizLast` as a finished practice session of those two questions, one right and one wrong;
- the Notes tab;
- Notes search results for "ensapa";
- the Reader for s01, in Full text and in Highlights only;
- Settings.

For each screen:
- **Screenshot:** `await expect(page).toHaveScreenshot('<name>.png', { fullPage: true, animations: 'disabled', maxDiffPixelRatio: 0.01 })`.
- **Axe:** `new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()` has `violations` equal to `[]`.
- **Width:** `scrollWidth <= innerWidth`.
- **Target size:** every visible `button`, `[role=radio]` label, `nav a` and `.link` is at least 44px tall.

- [ ] **Step 2: Create the baselines**

Run: `npx playwright test tests/e2e/screens.spec.ts --update-snapshots`
Expected: 10 PNGs written to `tests/e2e/__screens__/`, and all axe and size assertions PASS.

Fix any axe violation in the component that causes it, never by disabling a rule. Then open each PNG and compare it with the mockup's EMS night shift look: the cabin scene, the band only as a pattern, and status only as chips.

- [ ] **Step 3: Run it again against the baselines**

Run: `npx playwright test tests/e2e/screens.spec.ts`
Expected: PASS.

- [ ] **Step 4: Run the whole suite**

Run: `py -m pytest && npx vitest run && npm run build && npx playwright test`
Expected: everything PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e && git commit -m "test(e2e): 390px screenshot baselines with axe and target-size checks" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 23: GitHub Pages deploy workflow (written, not triggered)

**Files:**
- Create: `.github/workflows/deploy.yml`
- Test: `tests/unit/deploy-workflow.test.ts`

**Interfaces:**
- Consumes: the `build` script (Task 1) and the Vitest suite.
- Produces: a manual-only workflow that builds `dist/` and deploys it to Pages. It runs only when someone presses "Run workflow" after the user approves.

- [ ] **Step 1: Write the failing test** `tests/unit/deploy-workflow.test.ts`

```ts
import { readFileSync } from 'node:fs';
const yml = readFileSync('.github/workflows/deploy.yml', 'utf8');
const onBlock = yml.split(/^on:\s*$/m)[1]!.split(/^\S/m)[0]!;

test('only a manual trigger', () => {
  expect(onBlock).toMatch(/^\s+workflow_dispatch:/m);
  expect(onBlock).not.toMatch(/push|pull_request|schedule|workflow_run/);
});
test('builds with Node 24, runs the unit tests and deploys dist', () => {
  expect(yml).toMatch(/node-version:\s*['"]?24/);
  expect(yml).toContain('npm ci');
  expect(yml).toContain('npx vitest run');
  expect(yml).toContain('npm run build');
  expect(yml).toMatch(/path:\s*['"]?dist/);
  expect(yml).toMatch(/pages:\s*write/);
  expect(yml).toMatch(/id-token:\s*write/);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run tests/unit/deploy-workflow.test.ts`
Expected: FAIL with `ENOENT`.

- [ ] **Step 3: Write `.github/workflows/deploy.yml`**

The workflow has these parts:
- **Header comments:**
  - the first deploy needs the user's go-ahead;
  - the steps: create the GitHub repo, add the remote, push `main`, set Settings → Pages → Source to "GitHub Actions", then Actions → Deploy → Run workflow;
  - the site is unlisted: noindex plus `robots.txt`, and no public links.
- **Trigger:** `on: workflow_dispatch:` only.
- **Settings:**
  - `permissions: contents: read, pages: write, id-token: write`;
  - `concurrency: group: pages, cancel-in-progress: false`.
- **Build job:**
  1. checkout;
  2. setup-node with `node-version: 24` and `cache: npm`;
  3. `npm ci`;
  4. `npx vitest run`;
  5. `npm run build`;
  6. upload-pages-artifact with `path: dist`.
- **Deploy job:** `needs: build`, `environment: github-pages`, using deploy-pages.
- **Action versions:**
  - take each action's newest major tag, checked with `git ls-remote --tags https://github.com/actions/<name>`;
  - the actions are `checkout`, `setup-node`, `upload-pages-artifact` and `deploy-pages`;
  - pin those majors, for example `actions/checkout@v5` if `v5` exists.

- [ ] **Step 4: Run it and see it pass**

Run: `npx vitest run tests/unit/deploy-workflow.test.ts`
Expected: PASS. Do not push or run the workflow.

- [ ] **Step 5: Commit**

```bash
git add .github tests/unit/deploy-workflow.test.ts
git commit -m "ci: manual-only GitHub Pages deploy workflow (not triggered)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Spec coverage (Plan 1 scope)

| Spec item | Task |
|---|---|
| §5 sources copied; old notes PDFs ignored | 1 |
| §6.4 import: bold and/or underline, bold-only from Q214, stable IDs with gaps, passages, flags, typo log, ECG crop, repeatable | 2, 3 |
| §6.4 explanations: 407, one line, notesRef, generated, conflicts with notes | 9–11 |
| §11 overrides.json with source hash, never overwritten, stale entries flagged, dismissable "Under review" | 3, 9, 13, 17 |
| §6.5 notes import: sections, highlight, bold, underline, italics, lists, tables, boxes, images | 4, 5 |
| §6.2 steps.json from the brief table plus refinements; §11 every part named; trauma extras; U branch reserved | 7 |
| §6.3 case schema, unstable rule, masked IC, COPD and hypoglycaemia cases, marked for review | 6, 8 |
| §6.1 four tabs, focus screens, Settings from Today | 15, 20 |
| §6.1 and §6.4 Quiz: Practice, Test 20/50, Review wrong until right twice, shuffle by ID, Yours/Answer | 14, 16, 17 |
| §6.1 Notes: list, highlight counts, search, last read, reader switch, cross-links, prev/next, text size | 18, 19 |
| §6.1 Today first-run checklist and empty strip; quiz progress; review link; continue reading; resume row | 20 |
| §6.6 progress: per question, notes last read, runs shape, two slots, rollback, persist(), schema version | 12 |
| §7 copy: no runs, review empty/cleared, offline, update, first install, corrupt save, content failed, loading | 12, 13, 15, 16, 20, 21 |
| §8 accessibility and phone details (checked by axe, 44px and no-sideways-scroll checks) | 15–22 |
| §9 tokens, band rule, Star of Life, status chips, motion, haptics | 1, 15, 17 |
| §10 stack, layout, Vitest/pytest/Playwright, deploy workflow without the first deploy | 1, 22, 23 |
| §11 privacy: noindex, robots.txt | 1 |
