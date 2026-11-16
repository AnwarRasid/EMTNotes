"""Build public/data/questions.json from the two question-bank PDFs.

qbank_pdf reads the layout and the printed marks. This module turns them into
stable ids, answers, shared passages, review flags, typo fixes and the ECG
crop, and writes tools/import-log.md. It reads public/data/overrides.json only
to log stale explanations and never writes it.

Run from anywhere: py tools/import_questions.py
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

import pymupdf

from qbank_pdf import RawQuestion, read_bank
from textio import dump_json, say, sha12, write_text

ROOT = Path(__file__).resolve().parents[1]
CONFIG_NAME = "tools/import_config.json"
IMG_URL = "img/q"                       # where the app finds the crops, relative to its base
CROP_DPI = 200
OPTION_COUNT = 4
RANGE_RE = re.compile(r"answer questions (\d+)\s*(?:–|-|to|and)\s*(\d+)", re.IGNORECASE)

BANK_LABELS = {
    "mt-a": "Medical and trauma, part A",
    "mt-b": "Medical and trauma, part B",
    "hmls": "HMLS",
}

REASONS = {
    "no-answer": "No option is marked as the answer in the PDF.",
    "multiple-answers": "More than one option is marked as the answer in the PDF.",
    "missing-option": "This question has {n} options instead of 4.",
    "duplicate-label": "The bank printed the letter {label} on two options.",
    "duplicate-text": "Two options have the same text.",
    "image": "It has an image in the PDF that isn't cropped yet.",
}


class ImportProblem(Exception):
    """The PDFs and the config disagree, so the import stops instead of guessing."""


def review_flags(raw: RawQuestion) -> list[dict]:
    """Reasons a question needs a human look, read from the PDF alone."""
    flags: list[dict] = []

    def flag(code: str, **values: object) -> None:
        flags.append({"code": code, "reason": REASONS[code].format(**values)})

    marked = sum(o.marked for o in raw.options)
    if marked == 0:
        flag("no-answer")
    elif marked > 1:
        flag("multiple-answers")
    if len(raw.options) != OPTION_COUNT:
        flag("missing-option", n=len(raw.options))
    seen: set[str] = set()
    for option in raw.options:
        if option.label.upper() in seen:
            flag("duplicate-label", label=option.label)
            break
        seen.add(option.label.upper())
    texts = [o.text.casefold() for o in raw.options]
    if len(set(texts)) < len(texts):
        flag("duplicate-text")
    if raw.images:
        flag("image")
    return flags


def src_hash(passage: str | None, stem: str, option_texts: list[str], answer: str | None) -> str:
    """12 hex over the wording and the answer, so an explanation can tell its question changed."""
    payload = {"passage": passage, "stem": stem, "options": option_texts, "answer": answer}
    return sha12(json.dumps(payload, ensure_ascii=False, sort_keys=True))


def build(mt_pdf: Path, hmls_pdf: Path, config: dict, overrides: dict | None,
          img_dir: Path) -> tuple[dict, str]:
    """The questions.json document and the import log. Writes the image crops into img_dir."""
    pdfs = {"mt-a": mt_pdf, "mt-b": mt_pdf, "hmls": hmls_pdf}
    raw: dict[str, list[RawQuestion]] = {}
    unplaced: list[str] = []
    for pdf, bank_ids in ((mt_pdf, ("mt-a", "mt-b")), (hmls_pdf, ("hmls",))):
        parts, lines = read_bank(pdf)
        if len(parts) != len(bank_ids):
            raise ImportProblem(f"{pdf.name} has {len(parts)} parts; expected {len(bank_ids)}")
        raw.update(zip(bank_ids, (sorted(p, key=lambda q: q.number) for p in parts)))
        unplaced += [f"{pdf.name}: {line}" for line in lines]

    questions: dict[str, dict] = {}            # output order: bank order, then number
    for bank in BANK_LABELS:
        part = raw[bank]
        passages = _passages(bank, part, config.get("scenarios", {}).get(bank, []))
        for q in part:
            questions[_qid(bank, q.number)] = _question(bank, q, passages.get(q.number))

    for group in config.get("imageGroups", []):
        _crop_group(group, raw, pdfs, questions, img_dir)
    applied, not_applied = _apply_fixes(questions, config.get("fixes", []))
    for q in questions.values():
        q["srcHash"] = src_hash(q["passage"], q["stem"], [o["text"] for o in q["options"]], q["answer"])

    ordered = list(questions.values())
    doc = {
        "contentVersion": sha12(json.dumps(ordered, ensure_ascii=False, sort_keys=True)),
        "banks": [{"id": b, "label": BANK_LABELS[b], "source": pdfs[b].name} for b in BANK_LABELS],
        "questions": ordered,
    }
    log = _log(
        sources=[mt_pdf, hmls_pdf],
        counts={b: len(raw[b]) for b in BANK_LABELS},
        flags=[f"{q['id']} ({f['code']}): {f['reason']}" for q in ordered for f in q["review"]],
        applied=applied,
        not_applied=not_applied,
        stale=_stale(questions, overrides),
        unplaced=unplaced,
    )
    return doc, log


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    config = json.loads(args.config.read_text(encoding="utf-8"))
    overrides = (json.loads(args.overrides.read_text(encoding="utf-8"))
                 if args.overrides.exists() else None)
    try:
        doc, log = build(args.mt, args.hmls, config, overrides, args.img)
    except ImportProblem as problem:
        say(f"Import stopped: {problem}", sys.stderr)
        return 1
    write_text(args.out, dump_json(doc))
    write_text(args.log, log)
    flagged = sum(1 for q in doc["questions"] if q["review"])
    say(f"Wrote {len(doc['questions'])} questions ({flagged} flagged for review) "
        f"to {args.out.as_posix()}; see {args.log.as_posix()} for fixes and stale explanations.")
    return 0


# --- questions --------------------------------------------------------------

def _qid(bank: str, number: int) -> str:
    return f"{bank}-q{number:03}"


def _passages(bank: str, part: list[RawQuestion], scenarios: list[dict]) -> dict[int, str | None]:
    """Question number -> the shared passage it reads, for every passage marker in the part."""
    configured = {s["marker"]: (s["from"], s["to"]) for s in scenarios}
    passages: dict[int, str | None] = {}
    for q in part:
        if q.passage_marker is None:
            continue
        printed = RANGE_RE.search(q.passage_marker)
        span = (int(printed[1]), int(printed[2])) if printed else configured.get(q.passage_marker)
        if span is None:
            raise ImportProblem(f"{q.passage_marker} before {bank} Q{q.number} has no range in {CONFIG_NAME}")
        first, last = span
        if first != q.number:
            raise ImportProblem(f"{q.passage_marker} before {bank} Q{q.number} has a range "
                                f"starting at Q{first}, not Q{q.number}")
        passages.update(dict.fromkeys(range(first, last + 1), q.passage))
    return passages


def _question(bank: str, raw: RawQuestion, passage: str | None) -> dict:
    options = [{"id": chr(ord("a") + i), "label": o.label, "text": o.text}
               for i, o in enumerate(raw.options)]
    marked = [o["id"] for o, r in zip(options, raw.options) if r.marked]
    return {
        "id": _qid(bank, raw.number),
        "bank": bank,
        "number": raw.number,
        "passage": passage,
        "stem": raw.stem,
        "options": options,
        "answer": marked[0] if marked else None,   # a no-answer question is flagged for review
        "image": None,
        "topic": "hmls" if bank == "hmls" else None,
        "review": review_flags(raw),
    }


def _crop_group(group: dict, raw: dict[str, list[RawQuestion]], pdfs: dict[str, Path],
                questions: dict[str, dict], img_dir: Path) -> None:
    """Crop the group's image from the PDF and attach it, with its reason, to each question."""
    bank, first, last, file = group["bank"], group["from"], group["to"], group["file"]
    owner = next((q for q in raw[bank] if q.number == first), None)
    if owner is None or not owner.images:
        raise ImportProblem(f"Image group {file} expects an image on {bank} Q{first}, and the PDF has none")
    page, bbox = owner.images[0]
    with pymupdf.open(pdfs[bank]) as doc:
        png = doc[page - 1].get_pixmap(clip=bbox, dpi=CROP_DPI).tobytes("png")
    img_dir.mkdir(parents=True, exist_ok=True)
    (img_dir / file).write_bytes(png)
    for n in range(first, last + 1):
        q = questions.get(_qid(bank, n))
        if q is not None:
            q["image"] = f"{IMG_URL}/{file}"
            q["review"] = [f for f in q["review"] if f["code"] != "image"]
            q["review"].append({"code": "image", "reason": group["reason"]})


def _apply_fixes(questions: dict[str, dict], fixes: list[dict]) -> tuple[list[str], list[str]]:
    """Replace every occurrence in passage, stem and option text. Returns (applied, not applied)."""
    applied: list[str] = []
    not_applied: list[str] = []
    for fix in fixes:
        line = f"{fix['id']}: {fix['find']} → {fix['replace']}"
        q = questions.get(fix["id"])
        if q is None:
            not_applied.append(f"{line} (no such question)")
            continue
        holders = [(q, "passage"), (q, "stem"), *((o, "text") for o in q["options"])]
        hits = 0
        for holder, key in holders:
            text = holder[key]
            if text and fix["find"] in text:
                hits += text.count(fix["find"])
                holder[key] = text.replace(fix["find"], fix["replace"])
        if hits:
            applied.append(line)
        else:
            not_applied.append(f"{line} (text not found)")
    return applied, not_applied


def _stale(questions: dict[str, dict], overrides: dict | None) -> list[str]:
    """Override ids whose srcHash no longer matches the imported question."""
    entries = (overrides or {}).get("questions", {})
    stale = [qid for qid, q in questions.items()
             if qid in entries and entries[qid].get("srcHash") != q["srcHash"]]
    gone = sorted(qid for qid in entries if qid not in questions)
    return stale + [f"{qid} (no longer in the banks)" for qid in gone]


# --- output -----------------------------------------------------------------

def _log(sources: list[Path], counts: dict[str, int], flags: list[str], applied: list[str],
         not_applied: list[str], stale: list[str], unplaced: list[str]) -> str:
    lines = ["# Question import log", "",
             "Written by `py tools/import_questions.py` on every run. Do not edit by hand.", ""]

    def section(title: str, items: list[str]) -> None:
        lines.extend([f"## {title}", ""])
        lines.extend([f"- {item}" for item in items] or ["None."])
        lines.append("")

    section("Sources", [f"{p.name}: sha256 {hashlib.sha256(p.read_bytes()).hexdigest()}" for p in sources])
    section("Questions per bank", [f"{b}: {n}" for b, n in counts.items()] + [f"total: {sum(counts.values())}"])
    section("Review flags", flags)
    section("Fixes applied", applied)
    section("Fixes not applied", not_applied)
    section("Stale explanations", stale)
    section("Unplaced lines", unplaced)
    return "\n".join(lines)


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build questions.json from the question-bank PDFs.")
    parser.add_argument("--mt", type=Path, default=ROOT / "sources/EMT Medical & Trauma Question Bank 2017.pdf")
    parser.add_argument("--hmls", type=Path,
                        default=ROOT / "sources/HMLS Question Bank for EMT-CT, MOCT & HRCT-C.pdf")
    parser.add_argument("--config", type=Path, default=ROOT / CONFIG_NAME)
    parser.add_argument("--overrides", type=Path, default=ROOT / "public/data/overrides.json",
                        help="read only; skipped when missing")
    parser.add_argument("--out", type=Path, default=ROOT / "public/data/questions.json")
    parser.add_argument("--img", type=Path, default=ROOT / "public/img/q")
    parser.add_argument("--log", type=Path, default=ROOT / "tools/import-log.md")
    return parser.parse_args(argv)


if __name__ == "__main__":
    sys.exit(main())
