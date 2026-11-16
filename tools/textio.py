"""Text helpers shared by the tools: a short content hash, LF file writes, JSON
text in the house style and ASCII-only console output.

The importers (import_questions, import_notes) and overrides_stub all use these,
so every generated or hand-maintained data file is written the same way.
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path
from typing import TextIO


def sha12(text: str) -> str:
    """The first 12 hex digits of the text's SHA-256 (UTF-8)."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:12]


def write_text(path: Path, text: str) -> None:
    """UTF-8 with LF line endings on every platform."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(text.encode("utf-8"))


def dump_json(obj: object, *, sort_keys: bool = False) -> str:
    """JSON in the house style: UTF-8 characters kept, 1-space indent, trailing newline.
    Hand-written files pass sort_keys=True so their diffs stay stable."""
    return json.dumps(obj, ensure_ascii=False, indent=1, sort_keys=sort_keys) + "\n"


def say(text: str, stream: TextIO | None = None) -> None:
    """ASCII only: the Windows console is cp1252 and would crash on other characters."""
    print(text.encode("ascii", "backslashreplace").decode("ascii"), file=stream or sys.stdout)
