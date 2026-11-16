"""Build public/data/notes.json from the survey notes docx.

notes_docx reads paragraphs into flagged runs, lines and headings. This module
groups those lines into sections, headings, paragraphs, lists, data tables,
Remark and Added note boxes and images, and copies the images into
public/img/notes. The docx has no paragraph styles, numbering or bookmarks, so
every rule here reads the typed markers, the run sizes and the table shading.

Run from anywhere: py tools/import_notes.py
"""
from __future__ import annotations

import argparse
import json
import posixpath
import re
import sys
import zipfile
from collections.abc import Iterator
from dataclasses import replace
from pathlib import Path
from xml.etree import ElementTree as ET
from xml.etree.ElementTree import Element

from notes_docx import (OBJECT, W, Run, _drop_prefix, classify, heading_kind, runs_of, slugify,
                        split_lines)
from textio import dump_json, say, sha12, write_text

ROOT = Path(__file__).resolve().parents[1]
SOURCE = "EMT_Survey_Notes.docx"
IMG_URL = "img/notes"                   # where the app finds the images, relative to its base
RELS = "{http://schemas.openxmlformats.org/package/2006/relationships}"

HEADER_FILL = "e2e2e2"                  # data-table header cells
BOX_FILLS = {"eeeeee": "remark", "f1f2f1": "added"}
BOX_TITLES = {"remark": "Remark", "added": "Added note"}
SECTION_RE = re.compile(r"(\d+)\.\s+(.+)")
TAG_RE = re.compile(r"\s*\(([^()]+)\)\s*$")
ADDED_RE = re.compile(r"\s*Added note\s*–\s*")
REMARK_RE = re.compile(r"\s*Remark:\s*")
CAPTION_RE = re.compile(r"Figure\s+\d+\s*:\s*\S")   # "Figure 3: Example of patient on 12-lead ECG monitoring"
NOT_TESTED_RE = re.compile(r"\s*\(not tested\)$")    # "4. Ventricular Fibrillation (not tested)"


class NotesProblem(Exception):
    """The docx breaks a structure rule, so the import stops instead of guessing."""


def build_notes(docx: Path, img_out: Path) -> dict:
    """The notes.json document. Copies each image into img_out as {section}-{k}.png, then removes any other
    PNG there, so a re-import leaves no image the notes no longer have."""
    with zipfile.ZipFile(docx) as package:
        body = ET.fromstring(package.read("word/document.xml")).find(W + "body")
        builder = _Builder(package, img_out)
        sections = builder.build(body)
    for png in img_out.glob("*.png"):
        if png.name not in builder.written:
            png.unlink()
    return {
        "contentVersion": sha12(json.dumps(sections, ensure_ascii=False, sort_keys=True)),
        "source": SOURCE,
        "sections": sections,
    }


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    try:
        doc = build_notes(args.docx, args.img)
    except NotesProblem as problem:
        say(f"Import stopped: {problem}", sys.stderr)
        return 1
    write_text(args.out, dump_json(doc))
    sections = doc["sections"]
    images = sum(b["k"] == "img" for s in sections for b in _walk(s["blocks"]))
    say(f"Wrote {len(sections)} sections ({sum(s['highlights'] for s in sections)} highlight passages, "
        f"{images} images) to {args.out.as_posix()}; images in {args.img.as_posix()}.")
    return 0


# --- document ---------------------------------------------------------------

class _Builder:
    """Walks the body once, keeping the state that spans paragraphs: the open
    section, its heading ids and image count, and the box a continuation joins."""

    def __init__(self, package: zipfile.ZipFile, img_out: Path) -> None:
        self.package = package
        self.img_out = img_out
        rels = ET.fromstring(package.read("word/_rels/document.xml.rels"))
        self.targets = {rel.get("Id"): rel.get("Target") for rel in rels.iter(RELS + "Relationship")}
        self.sections: list[dict] = []
        self.section: dict | None = None      # None until the first section heading: front matter
        self.ids: set[str] = set()
        self.images = 0
        self.written: set[str] = set()        # the image files copied into img_out
        self.heading = ""                     # the nearest heading text, for image alt text
        self.open_box: dict | None = None     # the box a following unshaded 1x1 table continues

    def build(self, body: Element) -> list[dict]:
        for el in body:
            if el.tag == W + "p":
                self._paragraph(el)
            elif el.tag == W + "tbl":
                self._table(el)
            elif el.tag != W + "sectPr":
                raise NotesProblem(f"unexpected {el.tag.removeprefix(W)} element in the document body")
        for section in self.sections:
            section["highlights"] = _highlights(section["blocks"])
            _caption_alts(section["blocks"])
        return self.sections

    # --- top level ---

    def _paragraph(self, p: Element) -> None:
        lines = [_tabs(line) for line in split_lines(runs_of(p))]
        after_heading = False                 # lines after a heading line are body
        for line in lines:
            kind = None if after_heading else heading_kind(line)
            if kind == "section":
                self._start_section(line)
            elif self.section is None:
                pass                          # front matter: title, contents, formatting key
            elif kind is not None:
                self._heading(line, group=kind == "group")
            else:
                self._line(self.section["blocks"], line)
            after_heading = after_heading or kind is not None
        if not all(_is_empty(line) for line in lines):
            self.open_box = None

    def _table(self, tbl: Element) -> None:
        if self.section is None:
            return                            # front matter
        blocks = self.section["blocks"]
        fills = _fills(tbl)
        variant = next((v for fill, v in BOX_FILLS.items() if fill in fills), None)
        box, self.open_box = self.open_box, None
        if HEADER_FILL in fills:
            blocks.append(self._data_table(tbl, headers=True))
        elif variant is not None:
            self.open_box = self._box(tbl, variant)
            blocks.append(self.open_box)
        elif not fills and box is not None and _is_1x1(tbl):
            self._continue_box(box, tbl)
            self.open_box = box               # it may wrap once more
        else:
            blocks.append(self._data_table(tbl, headers=False))

    def _start_section(self, line: list[Run]) -> None:
        text = "".join(run.t for run in line)
        lit = [run.h for run in line for _ in run.t]
        tags: list[str] = []
        tag = TAG_RE.search(text)
        if tag and all(lit[tag.start(1) - 1:tag.end(1) + 1]):   # the whole "(...)" is highlighted
            tags.append(tag[1].strip())
            text = text[:tag.start()]
        numbered = SECTION_RE.fullmatch(text.strip())
        if numbered is None:
            raise NotesProblem(f'section heading "{text.strip()}" does not start with "N. "')
        n, title = int(numbered[1]), numbered[2].strip()
        if any(s["n"] == n for s in self.sections):
            raise NotesProblem(f"section {n} appears twice")
        self.section = {"id": f"s{n:02}", "n": n, "title": title, "tags": tags, "highlights": 0, "blocks": []}
        self.sections.append(self.section)
        self.ids = set()
        self.images = 0
        self.heading = title

    def _heading(self, line: list[Run], group: bool) -> None:
        """A sub or group heading. Its plain text feeds the slug and search; its runs
        come along only when part of it is marked beyond the heading's bold, such as
        a highlighted "(tested)"."""
        assert self.section is not None
        runs = _export(line)
        text = "".join(run["t"] for run in runs)
        base = anchor = slugify(text)
        n = 1
        while anchor in self.ids:
            n += 1
            anchor = f"{base}-{n}"
        self.ids.add(anchor)
        block: dict = {"k": "h", "id": anchor, "text": text}
        if group:
            block["group"] = True
        if any(run.keys() - {"t", "b"} for run in runs):
            block["runs"] = runs
        self.section["blocks"].append(block)
        self.heading = text

    # --- tables and boxes ---

    def _data_table(self, tbl: Element, headers: bool) -> dict:
        rows = []
        for tr in tbl.findall(W + "tr"):
            cells = []
            for tc in tr.findall(W + "tc"):
                cell: list[dict] = []
                for line in _lines(tc):
                    self._line(cell, line)
                cells.append(cell)
            rows.append({"header": headers and HEADER_FILL in _fills(tr), "cells": cells})
        return {"k": "table", "rows": rows}

    def _box(self, tbl: Element, variant: str) -> dict:
        """A Remark or Added note box, its title taken from the prefix on its first line."""
        lines = list(_lines(tbl))             # a remark wraps a nested table: read through it
        title = BOX_TITLES[variant]
        first = next((i for i, line in enumerate(lines) if not _is_empty(line)), None)
        if first is not None:
            text = _chars(lines[first])
            if added := ADDED_RE.match(text):
                title = text[added.end():].strip() or title
                del lines[first]
            elif remark := REMARK_RE.match(text):
                lines[first] = _drop_prefix(lines[first], remark.end())
        blocks: list[dict] = []
        for line in lines:
            self._line(blocks, line)
        return {"k": "box", "variant": variant, "title": title, "blocks": blocks}

    def _continue_box(self, box: dict, tbl: Element) -> None:
        """Text that wrapped out of a box into the unshaded table under it. Its first
        line finishes the box's last paragraph after the word space the PDF wraps
        at; any further lines follow as blocks."""
        lines = [line for line in _lines(tbl) if not _is_empty(line)]
        last = box["blocks"][-1] if box["blocks"] else None
        if (lines and last is not None and last["k"] == "p" and classify(lines[0])[0] == "text"
                and all(run.img is None for run in lines[0])):
            last["runs"][-1]["t"] += " "
            last["runs"] = _coalesce(last["runs"] + _export(lines.pop(0)))
        for line in lines:
            self._line(box["blocks"], line)

    # --- body lines ---

    def _line(self, out: list[dict], line: list[Run]) -> None:
        """Add a body line to out. Images become img blocks; the text between them
        becomes a p, or a list item that joins the list ending out."""
        segment: list[Run] = []
        for run in line:
            if run.img is None:
                segment.append(run)
                continue
            self._text_line(out, segment)
            out.append(self._image(run.img))
            segment = []
        self._text_line(out, segment)

    def _text_line(self, out: list[dict], line: list[Run]) -> None:
        kind, data = classify(line)
        runs = _export(data["runs"])
        if not runs:
            return                            # an empty line
        if kind == "text":
            out.append({"k": "p", "runs": runs})
            return
        item = {"depth": data["depth"], "marker": data["marker"], "runs": runs}
        if out and out[-1]["k"] == "list":
            out[-1]["items"].append(item)
        else:
            out.append({"k": "list", "items": [item]})

    def _image(self, rid: str) -> dict:
        assert self.section is not None
        target = self.targets.get(rid)
        if target is None:
            raise NotesProblem(f"image {rid} in {self.section['id']} has no relationship")
        member = posixpath.normpath(posixpath.join("word", target)).lstrip("/")
        if not member.lower().endswith(".png"):
            raise NotesProblem(f"image {rid} in {self.section['id']} is {member}, not a PNG")
        self.images += 1
        name = f"{self.section['id']}-{self.images}.png"
        self.img_out.mkdir(parents=True, exist_ok=True)
        (self.img_out / name).write_bytes(self.package.read(member))
        self.written.add(name)
        # A caption printed under the image, or a strip label above it, replaces this alt text later (_caption_alts).
        return {"k": "img", "src": f"{IMG_URL}/{name}", "alt": f"Figure {self.images}: {self.heading}"}


# --- helpers ----------------------------------------------------------------

def _caption_alts(blocks: list[dict]) -> None:
    """An image with a "Figure N: ..." caption straight after it takes the caption as its alt text, numbered as the
    notes number their figures (across sections). An uncaptioned image straight after a one-item list whose text
    is all bold, as each rhythm strip sits under its numbered label, takes "<label>, ECG rhythm strip", with a
    "Left: ... Right: ..." line under it added in brackets. Any other image keeps "Figure k: <heading>". Boxes and
    table cells too."""
    for i, b in enumerate(blocks):
        if b["k"] == "box":
            _caption_alts(b["blocks"])
        elif b["k"] == "table":
            for row in b["rows"]:
                for cell in row["cells"]:
                    _caption_alts(cell)
        elif b["k"] == "img":
            after = blocks[i + 1] if i + 1 < len(blocks) else None
            below = "".join(run["t"] for run in after["runs"]).strip() if after and after["k"] == "p" else ""
            label = _strip_label(blocks[i - 1]) if i > 0 else ""
            if CAPTION_RE.match(below):
                b["alt"] = below
            elif label:
                b["alt"] = f"{label}, ECG rhythm strip"
                if below.startswith("Left:"):
                    b["alt"] += f" ({below.partition(' Remark:')[0].strip()})"


def _strip_label(block: dict) -> str:
    """The text of a one-item list whose runs are all bold, less a trailing "(not tested)"; "" for any other block."""
    if block["k"] != "list" or len(block["items"]) != 1:
        return ""
    runs = block["items"][0]["runs"]
    if not all(run.get("b") for run in runs):
        return ""
    return NOT_TESTED_RE.sub("", "".join(run["t"] for run in runs).strip())


def _paragraphs(el: Element) -> Iterator[Element]:
    """The paragraphs inside el in document order, nested tables included."""
    for child in el:
        if child.tag == W + "p":
            yield child
        else:
            yield from _paragraphs(child)


def _lines(el: Element) -> Iterator[list[Run]]:
    for p in _paragraphs(el):
        yield from (_tabs(line) for line in split_lines(runs_of(p)))


def _tabs(line: list[Run]) -> list[Run]:
    """A tab typed into the text reads as one space, like a w:tab does."""
    return [replace(run, t=run.t.replace("\t", " ")) if "\t" in run.t else run for run in line]


def _is_empty(line: list[Run]) -> bool:
    return all(run.img is None and not run.t.strip() for run in line)


def _chars(line: list[Run]) -> str:
    """The line's text with OBJECT for each image, the offsets _drop_prefix counts in."""
    return "".join(OBJECT if run.img is not None else run.t for run in line)


def _fills(el: Element) -> set[str]:
    """Every shading fill under el, searched recursively; "auto" is no shading."""
    return {shd.get(W + "fill", "").lower() for shd in el.iter(W + "shd")} - {"", "auto"}


def _is_1x1(tbl: Element) -> bool:
    rows = tbl.findall(W + "tr")
    return len(rows) == 1 and len(rows[0].findall(W + "tc")) == 1


def _coalesce(runs: list[dict]) -> list[dict]:
    """Join JSON runs with equal flags into their left neighbour. Equal keys are
    equal flags, so runs that differed only in w:sz join here."""
    out: list[dict] = []
    for run in runs:
        if out and out[-1].keys() == run.keys():
            out[-1]["t"] += run["t"]
        else:
            out.append(run)
    return out


def _export(runs: list[Run]) -> list[dict]:
    """The runs as JSON, coalesced, with whitespace stripped at the line's two ends only."""
    out = _coalesce([run.to_json() for run in runs])
    while out and not out[0]["t"].strip():
        out.pop(0)
    while out and not out[-1]["t"].strip():
        out.pop()
    if out:
        out[0]["t"] = out[0]["t"].lstrip()
        out[-1]["t"] = out[-1]["t"].rstrip()
    return out


def _walk(blocks: list[dict]) -> Iterator[dict]:
    for b in blocks:
        yield b
        if b["k"] == "box":
            yield from _walk(b["blocks"])
        elif b["k"] == "table":
            for row in b["rows"]:
                for cell in row["cells"]:
                    yield from _walk(cell)


def _passages(blocks: list[dict]) -> Iterator[list[dict]]:
    """The runs of each p block and each list item, at any depth: inside boxes and cells too."""
    for b in _walk(blocks):
        if b["k"] == "p":
            yield b["runs"]
        elif b["k"] == "list":
            yield from (item["runs"] for item in b["items"])


def _highlights(blocks: list[dict]) -> int:
    """The count of highlight passages: passages with at least one highlighted run."""
    return sum(any(run.get("h") for run in runs) for runs in _passages(blocks))


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build notes.json from the survey notes docx.")
    parser.add_argument("--docx", type=Path, default=ROOT / "sources" / SOURCE)
    parser.add_argument("--out", type=Path, default=ROOT / "public/data/notes.json")
    parser.add_argument("--img", type=Path, default=ROOT / "public/img/notes")
    return parser.parse_args(argv)


if __name__ == "__main__":
    sys.exit(main())
