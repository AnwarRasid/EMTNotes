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
