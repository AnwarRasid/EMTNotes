"""Read the EMT question-bank PDFs into raw questions with their printed marks.

The banks print the official answer bold and/or underlined. This module reads
the layout only; answers, ids and review flags are the importer's job.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import NamedTuple

import pymupdf

BOLD_FLAG = 16
RULE_LEFT, RULE_RIGHT = 75, 520        # a page rule runs from x < 75 to x > 520
FLAT_DY = 1.5                          # a drawn line is horizontal below this |dy|
MIN_SEGMENT = 3
THIN_RECT = 2
UNDERLINE_DY = 3
UNDERLINE_OVERLAP = 2
BASELINE_DY = 1.5
QUESTION_MAX_X = 100
MAX_NUMBER_STEP = 3

QUESTION_RE = re.compile(r"\s*(\d{1,3})\.\s*")
MARKER_RE = re.compile(r"\s*(answer questions|scenario\s+\d+)", re.IGNORECASE)
OPTION_RE = re.compile(r"\s*([a-dA-D])[.)]\s*")

BBox = tuple[float, float, float, float]


@dataclass(frozen=True)
class RawOption:
    label: str            # as printed: "a".."d" or "A".."D" (duplicates kept)
    text: str             # body without the label, whitespace collapsed
    underlined: bool      # any alphanumeric char in the body is underlined
    bold_share: float     # bold alphanumeric chars / alphanumeric chars in the body

    @property
    def marked(self) -> bool:
        return self.underlined or self.bold_share >= 0.5


@dataclass
class RawQuestion:
    number: int
    page: int                          # 1-based page of the question start
    stem: str
    options: list[RawOption]
    passage_marker: str | None         # "Answer questions 11–15 …" / "Scenario 1", on the first question after it
    passage: str | None                # the passage lines after the marker, joined
    images: list[tuple[int, BBox]]     # (page, bbox) of image blocks met while open


def read_bank(pdf_path: Path) -> tuple[list[list[RawQuestion]], list[str]]:
    """Parts in document order (numbering restarts at 1 => new part), plus unplaced lines."""
    reader = _Reader()
    with pymupdf.open(pdf_path) as doc:
        for page_no, page in enumerate(doc, start=1):
            for event in _page_events(page, page_no):
                reader.feed(event)
    return reader.finish()


# --- page layout -----------------------------------------------------------

class _Segment(NamedTuple):
    x0: float
    x1: float
    y: float


@dataclass(frozen=True)
class _Span:
    text: str
    bold: bool
    underlined: bool


@dataclass
class _Line:
    page: int
    x0: float
    y0: float
    baseline: float
    spans: list[_Span]

    @property
    def text(self) -> str:
        return "".join(s.text for s in self.spans)


@dataclass(frozen=True)
class _Image:
    page: int
    bbox: BBox


def _page_events(page: pymupdf.Page, page_no: int) -> list[_Line | _Image]:
    """Body lines (same-baseline lines merged) and image blocks, in reading order."""
    segments = _horizontal_segments(page)
    rules = [s for s in segments if s.x0 < RULE_LEFT and s.x1 > RULE_RIGHT]
    underlines = [s for s in segments if s not in rules]
    middle = page.rect.height / 2
    top = min((r.y for r in rules if r.y < middle), default=-math.inf)
    bottom = max((r.y for r in rules if r.y >= middle), default=math.inf)

    lines: list[_Line] = []
    events: list[_Line | _Image] = []
    for block in page.get_text("dict")["blocks"]:
        if block["type"] == 1:
            events.append(_Image(page_no, tuple(float(v) for v in block["bbox"])))
            continue
        for raw in block.get("lines", []):
            x0, y0, _, y1 = raw["bbox"]
            if not (top < (y0 + y1) / 2 < bottom):
                continue                       # running header or page number
            spans = [_span(s, underlines) for s in raw["spans"]]
            # A line with no letter or digit is blank or a typed rule, such as the row
            # of underscores between Part A and Part B on MT page 15: not wording.
            if any(ch.isalnum() for s in spans for ch in s.text):
                lines.append(_Line(page_no, x0, y0, raw["spans"][0]["origin"][1], spans))

    events.extend(_merge_baselines(lines))
    return sorted(events, key=_reading_key)


def _horizontal_segments(page: pymupdf.Page) -> list[_Segment]:
    segments = []
    for drawing in page.get_drawings():
        for item in drawing["items"]:
            if item[0] == "l":
                p1, p2 = item[1], item[2]
                if abs(p1.y - p2.y) < FLAT_DY and abs(p2.x - p1.x) > MIN_SEGMENT:
                    segments.append(_Segment(min(p1.x, p2.x), max(p1.x, p2.x), (p1.y + p2.y) / 2))
            elif item[0] == "re":
                r = item[1]
                if abs(r.y1 - r.y0) < THIN_RECT:
                    segments.append(_Segment(min(r.x0, r.x1), max(r.x0, r.x1), (r.y0 + r.y1) / 2))
    return segments


def _span(span: dict, underlines: list[_Segment]) -> _Span:
    x0, _, x1, y1 = span["bbox"]
    bold = bool(span["flags"] & BOLD_FLAG) or "Bold" in span["font"]
    underlined = any(
        abs(s.y - y1) <= UNDERLINE_DY and min(s.x1, x1) - max(s.x0, x0) > UNDERLINE_OVERLAP
        for s in underlines
    )
    return _Span(span["text"], bold, underlined)


def _merge_baselines(lines: list[_Line]) -> list[_Line]:
    """Join lines that share a baseline, left to right (Part B prints "165." apart from its stem)."""
    groups: list[list[_Line]] = []
    for line in sorted(lines, key=lambda l: (l.baseline, l.x0)):
        if groups and abs(line.baseline - groups[-1][0].baseline) < BASELINE_DY:
            groups[-1].append(line)
        else:
            groups.append([line])
    merged = []
    for group in groups:
        group.sort(key=lambda l: l.x0)
        spans = list(group[0].spans)
        for line in group[1:]:
            spans += [_Span(" ", False, False), *line.spans]
        merged.append(_Line(group[0].page, group[0].x0, min(l.y0 for l in group),
                            group[0].baseline, spans))
    return merged


def _reading_key(event: _Line | _Image) -> tuple[float, float]:
    if isinstance(event, _Image):
        return event.bbox[1], event.bbox[0]
    return event.y0, event.x0


# --- question assembly -----------------------------------------------------

def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


class _OptionDraft:
    def __init__(self, label: str) -> None:
        self.label = label
        self.pieces: list[str] = []
        self.alnum = 0
        self.bold = 0
        self.underlined = False

    def add(self, line: _Line, start: int = 0) -> None:
        """Take the line's text from `start` (past the label) into the option body."""
        self.pieces.append(line.text[start:])
        pos = 0
        for span in line.spans:
            for i, ch in enumerate(span.text):
                if pos + i >= start and ch.isalnum():
                    self.alnum += 1
                    self.bold += span.bold
                    self.underlined |= span.underlined
            pos += len(span.text)

    def build(self) -> RawOption:
        share = self.bold / self.alnum if self.alnum else 0.0
        return RawOption(self.label, _clean(" ".join(self.pieces)), self.underlined, share)


@dataclass
class _PassageDraft:
    marker: str
    lines: list[str] = field(default_factory=list)
    images: list[tuple[int, BBox]] = field(default_factory=list)


@dataclass
class _QuestionDraft:
    number: int
    page: int
    stem: list[str]
    passage: _PassageDraft | None
    options: list[_OptionDraft] = field(default_factory=list)
    images: list[tuple[int, BBox]] = field(default_factory=list)

    def build(self) -> RawQuestion:
        passage = self.passage
        return RawQuestion(
            number=self.number,
            page=self.page,
            stem=_clean(" ".join(self.stem)),
            options=[o.build() for o in self.options],
            passage_marker=passage.marker if passage else None,
            passage=(_clean(" ".join(passage.lines)) or None) if passage else None,
            images=(passage.images if passage else []) + self.images,
        )


class _Reader:
    def __init__(self) -> None:
        self.parts: list[list[RawQuestion]] = []
        self.unplaced: list[str] = []
        self.last = 0
        self.question: _QuestionDraft | None = None
        self.passage: _PassageDraft | None = None

    def feed(self, event: _Line | _Image) -> None:
        if isinstance(event, _Image):
            self._feed_image(event)
        else:
            self._feed_line(event)

    def finish(self) -> tuple[list[list[RawQuestion]], list[str]]:
        self._close_question()
        if self.passage:                       # a passage no question followed
            self.unplaced += [self.passage.marker, *map(_clean, self.passage.lines)]
            self.passage = None
        return self.parts, self.unplaced

    def _feed_image(self, image: _Image) -> None:
        if self.passage:
            self.passage.images.append((image.page, image.bbox))
        elif self.question:
            self.question.images.append((image.page, image.bbox))
        else:
            self.unplaced.append(f"[image on page {image.page}]")

    def _feed_line(self, line: _Line) -> None:
        text = line.text
        start = QUESTION_RE.match(text)
        if start and line.x0 < QUESTION_MAX_X and self._next_in_sequence(int(start.group(1))):
            self._start_question(int(start.group(1)), line, start.end())
        elif self.passage:
            self.passage.lines.append(text)
        elif MARKER_RE.match(text):
            self._close_question()
            self.passage = _PassageDraft(_clean(text))
        elif self.question is None:
            self.unplaced.append(_clean(text))
        elif option := OPTION_RE.match(text):
            draft = _OptionDraft(option.group(1))
            draft.add(line, option.end())
            self.question.options.append(draft)
        elif self.question.options:
            self.question.options[-1].add(line)
        else:
            self.question.stem.append(text)

    def _next_in_sequence(self, n: int) -> bool:
        # The step limit keeps a wrapped "92. Auscultation…" inside B-Q203 from reading as Q92.
        return n == 1 or self.last < n <= self.last + MAX_NUMBER_STEP

    def _start_question(self, n: int, line: _Line, stem_start: int) -> None:
        self._close_question()
        if n == 1 or not self.parts:
            self.parts.append([])
        self.last = n
        self.question = _QuestionDraft(n, line.page, [line.text[stem_start:]], self.passage)
        self.passage = None

    def _close_question(self) -> None:
        if self.question:
            self.parts[-1].append(self.question.build())
            self.question = None
