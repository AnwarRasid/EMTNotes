"""Add empty explanation stubs to public/data/overrides.json for one bank, or
accept explanations reviewed after a re-import.

overrides.json is hand-written: each entry holds a question's topic, one-line
explanation and notes link, and the srcHash of the wording it was written for.

--bank only adds the entries that are missing, as stubs to fill by hand. It
never changes an existing entry, even one whose srcHash is stale; the question
importer lists those in tools/import-log.md instead.

--accept is for after a re-import changed a question: once you have read its
explanation against the new wording (and fixed it if needed), it sets that
entry's srcHash to the question's current one. That clears the app's "source
changed" review note and the stale-hash check in tests/unit/overrides.test.ts.
It changes nothing else.

Run from anywhere:
  py tools/overrides_stub.py --bank mt-a [--from 1 --to 46]
  py tools/overrides_stub.py --accept mt-b-q115[,mt-b-q116...]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from textio import dump_json, say, write_text

ROOT = Path(__file__).resolve().parents[1]
BANKS = ("mt-a", "mt-b", "hmls")
VERSION = 1


def stub(question: dict) -> dict:
    """An empty entry for the question: HMLS questions always take the hmls topic."""
    return {
        "srcHash": question["srcHash"],
        "topic": "hmls" if question["bank"] == "hmls" else None,
        "explanation": "",
        "notesRef": None,
        "generated": True,
    }


def add_stubs(questions_doc: dict, overrides: dict, ids: list[str]) -> tuple[dict, int]:
    """The overrides doc with a stub for each id that has no entry yet, and how many were added.
    Existing entries are kept exactly as they are. Raises ValueError for an id that isn't a question."""
    by_id = {q["id"]: q for q in questions_doc["questions"]}
    unknown = [qid for qid in ids if qid not in by_id]
    if unknown:
        raise ValueError(f"Not in questions.json: {', '.join(unknown)}")
    entries = dict(overrides.get("questions", {}))
    missing = [qid for qid in dict.fromkeys(ids) if qid not in entries]
    entries.update({qid: stub(by_id[qid]) for qid in missing})
    return {**overrides, "version": overrides.get("version", VERSION), "questions": entries}, len(missing)


def accept(questions_doc: dict, overrides: dict, ids: list[str]) -> tuple[dict, list[str]]:
    """The overrides doc with each id's srcHash set to its question's current one, and the ids that changed.
    Only srcHash moves; an entry already current is left as it is. Raises ValueError for an id that isn't a
    question or has no entry yet (add a stub with --bank first)."""
    by_id = {q["id"]: q for q in questions_doc["questions"]}
    entries = dict(overrides.get("questions", {}))
    unknown = [qid for qid in ids if qid not in by_id]
    if unknown:
        raise ValueError(f"Not in questions.json: {', '.join(unknown)}")
    missing = [qid for qid in ids if qid not in entries]
    if missing:
        raise ValueError(f"No entry in overrides.json to accept: {', '.join(missing)}")
    changed = [qid for qid in dict.fromkeys(ids) if entries[qid].get("srcHash") != by_id[qid]["srcHash"]]
    entries.update({qid: {**entries[qid], "srcHash": by_id[qid]["srcHash"]} for qid in changed})
    return {**overrides, "questions": entries}, changed


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    questions_doc = json.loads(args.questions.read_text(encoding="utf-8"))
    if args.accept is not None:
        return _accept(args, questions_doc)
    last = sys.maxsize if args.last is None else args.last
    ids = [q["id"] for q in questions_doc["questions"]
           if q["bank"] == args.bank and args.first <= q["number"] <= last]
    if not ids:
        span = f"{args.first} to {'the end' if args.last is None else args.last}"
        say(f"No {args.bank} questions numbered {span}; nothing written.", sys.stderr)
        return 1
    overrides = (json.loads(args.overrides.read_text(encoding="utf-8"))
                 if args.overrides.exists() else {"version": VERSION, "questions": {}})
    doc, added = add_stubs(questions_doc, overrides, ids)
    path = args.overrides.as_posix()
    if not added:
        say(f"Nothing to add: all {len(ids)} {args.bank} questions in range already have entries; "
            f"{path} unchanged.")
        return 0
    write_text(args.overrides, dump_json(doc, sort_keys=True))
    say(f"Added {added} {args.bank} stubs ({len(ids) - added} of {len(ids)} already there) to {path}.")
    return 0


def _accept(args: argparse.Namespace, questions_doc: dict) -> int:
    ids = [qid.strip() for qid in args.accept.split(",") if qid.strip()]
    overrides = json.loads(args.overrides.read_text(encoding="utf-8"))
    try:
        doc, changed = accept(questions_doc, overrides, ids)
    except ValueError as problem:
        say(f"Nothing accepted: {problem}", sys.stderr)
        return 1
    path = args.overrides.as_posix()
    current = [qid for qid in dict.fromkeys(ids) if qid not in changed]
    if changed:
        write_text(args.overrides, dump_json(doc, sort_keys=True))
        say(f"Accepted {len(changed)}: {', '.join(changed)}. Their srcHash now matches questions.json in {path}.")
    if current:
        say(f"Hash already current, left as it is: {', '.join(current)}.")
    return 0


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Add empty explanation stubs to overrides.json (--bank), or accept reviewed explanations "
                    "after a re-import changed their questions (--accept).")
    what = parser.add_mutually_exclusive_group(required=True)
    what.add_argument("--bank", choices=BANKS)
    what.add_argument("--accept", metavar="ID[,ID...]",
                      help="question ids whose explanation you have reviewed against the new wording")
    parser.add_argument("--from", dest="first", type=int, default=1, help="first question number (default 1)")
    parser.add_argument("--to", dest="last", type=int, default=None,
                        help="last question number (default: the end of the bank)")
    parser.add_argument("--questions", type=Path, default=ROOT / "public/data/questions.json")
    parser.add_argument("--overrides", type=Path, default=ROOT / "public/data/overrides.json")
    return parser.parse_args(argv)


if __name__ == "__main__":
    sys.exit(main())
