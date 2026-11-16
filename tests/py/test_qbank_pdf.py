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

def test_part_separator_is_not_option_text_in_part_a_q92(mt):
    # Page 15 types a row of underscores between Part A and Part B; it is not wording.
    assert q(mt[0], 0, 92).options[3].text == "administering an intramuscular injection"

def test_nothing_unplaced(mt, hmls):
    assert mt[1] == [] and hmls[1] == []
