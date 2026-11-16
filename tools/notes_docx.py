"""Read WordprocessingML paragraphs into flagged runs, lines and headings.

These are the primitives import_notes.py builds notes.json from. The survey
notes docx has no paragraph styles or numbering: lists are typed markers
("•", "–", "1.") and headings are bold runs at fixed sizes.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, replace
from xml.etree.ElementTree import Element

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"

OFF = {"0", "false", "off"}                 # ST_OnOff values that switch a flag off
HEADING_KINDS = {32: "section", 28: "group", 26: "sub"}   # w:sz half-points
BULLET_DEPTHS = {"•": 1, "–": 2}
LINE_START = re.compile(r"\s*(?:(?P<bullet>[•–])|(?P<ordered>\d+\.)(?=\s))\s*")
OBJECT = "￼"                          # stands in for an image in line text


@dataclass
class Run:
    t: str
    b: bool = False
    i: bool = False
    u: bool = False
    h: bool = False
    sz: int | None = None          # half-points (w:sz); internal, not exported
    img: str | None = None         # r:embed id of a drawing; t == "" when set

    def to_json(self) -> dict:
        out: dict = {"t": self.t}
        out.update({flag: True for flag in ("b", "i", "u", "h") if getattr(self, flag)})
        return out


def _on(rpr: Element | None, name: str, off: set[str] = OFF) -> bool:
    el = rpr.find(W + name) if rpr is not None else None
    return el is not None and el.get(W + "val", "true") not in off


def _size(rpr: Element | None) -> int | None:
    el = rpr.find(W + "sz") if rpr is not None else None
    val = el.get(W + "val", "") if el is not None else ""
    return int(val) if val.isdigit() else None


def _style(run: Run) -> tuple:
    return (run.b, run.i, run.u, run.h, run.sz)


def _append(runs: list[Run], run: Run) -> None:
    """Add a run, merging it into the previous one when both are text with one style."""
    if run.img is None and not run.t:
        return
    last = runs[-1] if runs else None
    if last is not None and last.img is None and run.img is None and _style(last) == _style(run):
        last.t += run.t
    else:
        runs.append(run)


def runs_of(p: Element) -> list[Run]:
    """The paragraph's runs in order: w:t text, w:tab as " ", w:br as "\\n",
    and each w:drawing as an image run. Neighbours with equal flags and size merge."""
    runs: list[Run] = []
    for r in p.iter(W + "r"):
        rpr = r.find(W + "rPr")
        style = dict(b=_on(rpr, "b"), i=_on(rpr, "i"), u=_on(rpr, "u", OFF | {"none"}),
                     h=rpr is not None and rpr.find(W + "highlight") is not None, sz=_size(rpr))
        text = ""
        for child in r:
            if child.tag == W + "t":
                text += child.text or ""
            elif child.tag == W + "tab":
                text += " "
            elif child.tag == W + "br":
                text += "\n"
            elif child.tag == W + "drawing":
                blip = child.find(f".//{A}blip")
                rid = blip.get(R + "embed") if blip is not None else None
                if rid:
                    _append(runs, Run(text, **style))
                    _append(runs, Run("", img=rid))
                    text = ""
        _append(runs, Run(text, **style))
    return runs


def split_lines(runs: list[Run]) -> list[list[Run]]:
    """Split runs into lines at each "\\n", like str.split: n breaks give n + 1 lines."""
    lines: list[list[Run]] = [[]]
    for run in runs:
        if run.img is not None:
            lines[-1].append(run)
            continue
        first, *rest = run.t.split("\n")
        if first:
            lines[-1].append(replace(run, t=first))
        for piece in rest:
            lines.append([replace(run, t=piece)] if piece else [])
    return lines


def _chars(run: Run) -> str:
    return OBJECT if run.img is not None else run.t


def _drop_prefix(line: list[Run], n: int) -> list[Run]:
    out: list[Run] = []
    for run in line:
        chars = _chars(run)
        if n >= len(chars):
            n -= len(chars)
        elif n:
            out.append(replace(run, t=chars[n:]))
            n = 0
        else:
            out.append(run)
    return out


def classify(line: list[Run]) -> tuple[str, dict]:
    """A line is a bullet ("•" depth 1, "–" depth 2), an ordered item ("1. "), or text.
    Markers may follow leading whitespace; the marker and the whitespace around
    it are stripped from the returned runs."""
    m = LINE_START.match("".join(_chars(run) for run in line))
    if m is None:
        return "text", {"runs": list(line)}
    runs = _drop_prefix(line, m.end())
    if m["bullet"]:
        return "bullet", {"depth": BULLET_DEPTHS[m["bullet"]], "marker": m["bullet"], "runs": runs}
    return "ordered", {"depth": 1, "marker": m["ordered"], "runs": runs}


def heading_kind(line: list[Run]) -> str | None:
    """Return "section", "group" or "sub" when every non-blank run is bold at one heading size."""
    if any(run.img is not None for run in line):
        return None
    text = [run for run in line if run.t.strip()]
    if not text or not all(run.b for run in text):
        return None
    sizes = {run.sz for run in text}
    return HEADING_KINDS.get(sizes.pop()) if len(sizes) == 1 else None


def slugify(text: str) -> str:
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "-", ascii_text.lower().replace("&", "")).strip("-")
