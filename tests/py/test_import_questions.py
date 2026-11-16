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

def log_section(log, title):
    """The body of a `## title` section of the import log, or "" when it is absent."""
    if f"## {title}\n" not in log:
        return ""
    return log.split(f"## {title}\n", 1)[1].split("\n## ", 1)[0]

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

def test_duplicate_label_reason_says_what_the_bank_printed(built):
    # The app re-letters every question's options A-D, so "two options carry the same label" can't be seen there.
    assert [r["reason"] for r in built[3]["mt-b-q168"]["review"]] == ["The bank printed the letter A on two options."]

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
    # The lines above would also match a fix listed as not applied, so that section must list nothing.
    assert not [line for line in log_section(built[1], "Fixes not applied").splitlines() if line.startswith("- ")]

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
