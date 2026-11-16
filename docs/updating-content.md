# Updating the content

EMTNotes' notes and questions come from the files in `sources/`. When a newer copy of one arrives, re-import it, run the tests, and fix what they point at. Run every command from the project folder.

## Updating the notes

1. Save the new notes over `sources/EMT_Survey_Notes.docx`. Keep that exact file name.
2. Run `py tools/import_notes.py`.
   - It rewrites `public/data/notes.json` and the pictures in `public/img/notes/`.
   - It deletes any picture there that the new notes no longer have.
3. Run `npm test`.

**If a link test fails.** These tests check that every link into the notes still lands on a real heading:
- `tests/unit/overrides.test.ts` checks the quiz explanations ("real notes link");
- `tests/unit/data-integrity.test.ts` checks the PAM steps and the cases.

A failing link test means the new notes moved something:
- **A renamed heading.** A link ends in the heading's id, made from its words. For example, "Oxygen Masks" is `oxygen-masks`, so renaming the heading changes the id.
- **An inserted or removed section.** Sections are numbered `s01`, `s02` and on. A new section 5 turns the old `s05` into `s06`, and every later section moves too.

To fix a failing link:
1. The test names the question, step or case.
2. Find the heading in `public/data/notes.json`: search for its words and copy its `"id"`.
3. Put the new link in the `notesRef` of that entry, in the file the failing test checks:
   - `public/data/overrides.json` for a question;
   - `public/data/steps.json` for a step;
   - a file in `public/data/cases/` for a case.

   A link looks like `s11#oxygen-masks`.
4. Run `npm test` again.

## Updating a question bank PDF

1. Save the new PDF over the old one in `sources/`, with the same file name:
   - `EMT Medical & Trauma Question Bank 2017.pdf`;
   - `HMLS Question Bank for EMT-CT, MOCT & HRCT-C.pdf`.
2. Run `py tools/import_questions.py`.
   - It rewrites `public/data/questions.json`.
   - It writes `tools/import-log.md`. Read the log: it lists the review flags, the typo fixes, and every explanation whose question changed ("Stale explanations").
3. Run `npm test`.

**If a question changed.** Each explanation in `public/data/overrides.json` keeps a hash (`srcHash`) of the wording it was written for. When a question's wording or answer changes, the hash no longer matches:
- `tests/unit/overrides.test.ts` fails on that question;
- the app shows "Under review: The source question changed since this explanation was written."

For each question the log lists:
1. Read its new wording in `questions.json` and its explanation in `overrides.json`. Fix the explanation if it no longer fits.
2. Accept it: `py tools/overrides_stub.py --accept mt-b-q115`. Separate several ids with commas: `--accept mt-b-q115,mt-b-q116`. This sets the hash to the new one, and changes nothing else.
3. Run `npm test` again.

**If a question is new.** A new question needs an explanation:
1. Add an empty entry for it: `py tools/overrides_stub.py --bank mt-b --from 257 --to 260`.
2. Write its `topic`, `explanation` and `notesRef` by hand.
3. Update the question count in `tests/unit/overrides.test.ts` and `tests/unit/data-integrity.test.ts`, which is 407 now.
