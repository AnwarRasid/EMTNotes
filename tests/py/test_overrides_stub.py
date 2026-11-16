import json
from pathlib import Path
import pytest
from overrides_stub import accept, add_stubs, main

ROOT = Path(__file__).parents[2]
QUESTIONS = ROOT / "public/data/questions.json"

def q(qid, bank, number, src_hash):
    return {"id": qid, "bank": bank, "number": number, "srcHash": src_hash}

DOC = {"questions": [q("mt-a-q001", "mt-a", 1, "aaaaaaaaaaaa"), q("mt-a-q002", "mt-a", 2, "bbbbbbbbbbbb"),
                     q("hmls-q001", "hmls", 1, "cccccccccccc")]}

def written(path):
    text = path.read_text(encoding="utf-8")
    return text, json.loads(text)

def test_add_stubs_adds_only_missing_ids_with_the_question_hash():
    existing = {"version": 1, "questions": {"mt-a-q001": {
        "srcHash": "aaaaaaaaaaaa", "topic": "airway", "explanation": "Written already.", "notesRef": None,
        "generated": True}}}
    doc, added = add_stubs(DOC, existing, ["mt-a-q001", "mt-a-q002", "hmls-q001"])
    assert added == 2
    assert sorted(doc["questions"]) == ["hmls-q001", "mt-a-q001", "mt-a-q002"]
    assert doc["questions"]["mt-a-q002"] == {"srcHash": "bbbbbbbbbbbb", "topic": None, "explanation": "",
                                             "notesRef": None, "generated": True}
    assert doc["questions"]["hmls-q001"]["topic"] == "hmls"
    assert doc["questions"]["hmls-q001"]["srcHash"] == "cccccccccccc"
    assert doc["version"] == 1

def test_an_existing_entry_comes_back_identical_even_when_its_hash_is_stale():
    entry = {"srcHash": "000000000000", "topic": "ops", "explanation": "Hand-written and now stale.",
             "notesRef": "s14", "generated": True, "review": "Check this one."}
    before = json.loads(json.dumps(entry))
    doc, added = add_stubs(DOC, {"version": 1, "questions": {"mt-a-q001": entry}}, ["mt-a-q001"])
    assert added == 0
    assert doc["questions"]["mt-a-q001"] == before

def test_add_stubs_starts_an_empty_overlay():
    doc, added = add_stubs(DOC, {}, ["mt-a-q002"])
    assert (doc, added) == ({"version": 1, "questions": {"mt-a-q002": {
        "srcHash": "bbbbbbbbbbbb", "topic": None, "explanation": "", "notesRef": None, "generated": True}}}, 1)

def test_add_stubs_rejects_an_id_that_is_not_a_question():
    with pytest.raises(ValueError, match="mt-a-q999"):
        add_stubs(DOC, {}, ["mt-a-q999"])

def test_main_adds_exactly_the_requested_range(tmp_path):
    out = tmp_path / "overrides.json"
    assert main(["--bank", "mt-b", "--from", "1", "--to", "3", "--questions", str(QUESTIONS),
                 "--overrides", str(out)]) == 0
    _, doc = written(out)
    assert sorted(doc["questions"]) == ["mt-b-q001", "mt-b-q002", "mt-b-q003"]
    hashes = {x["id"]: x["srcHash"] for x in json.loads(QUESTIONS.read_text(encoding="utf-8"))["questions"]}
    assert all(e["srcHash"] == hashes[i] and e["topic"] is None for i, e in doc["questions"].items())

def test_a_run_that_writes_keeps_stale_and_edited_entries_and_a_rerun_changes_nothing(tmp_path, capsys):
    out = tmp_path / "overrides.json"
    base = ["--questions", str(QUESTIONS), "--overrides", str(out)]
    stale = {"srcHash": "000000000000", "topic": "hmls", "explanation": "Kept as written.", "notesRef": "s14",
             "generated": True, "review": "Stale on purpose."}
    out.write_text(json.dumps({"version": 1, "questions": {"hmls-q001": stale}}), encoding="utf-8")
    assert main(["--bank", "hmls", "--to", "30", *base]) == 0
    _, doc = written(out)
    assert len(doc["questions"]) == 30
    edited = {**doc["questions"]["hmls-q002"], "explanation": "Filled in by hand after the stub run."}
    doc["questions"]["hmls-q002"] = edited                # hand-edit a stub the tool created
    out.write_text(json.dumps(doc, indent=1), encoding="utf-8")
    before = json.loads(json.dumps(doc["questions"]))

    assert main(["--bank", "hmls", *base]) == 0           # adds q031-q061, so this run does write
    second, doc = written(out)
    assert len(doc["questions"]) == 61
    assert doc["questions"]["hmls-q001"] == stale         # stale hash, notesRef and review all survive
    assert doc["questions"]["hmls-q002"] == edited
    assert {i: doc["questions"][i] for i in before} == before
    assert all(e["topic"] == "hmls" for e in doc["questions"].values())

    capsys.readouterr()
    assert main(["--bank", "hmls", *base]) == 0           # nothing left to add
    assert out.read_text(encoding="utf-8") == second
    assert "Nothing to add" in capsys.readouterr().out

def test_the_written_file_has_sorted_keys_one_space_indent_and_lf(tmp_path):
    out = tmp_path / "overrides.json"
    assert main(["--bank", "mt-a", "--from", "3", "--to", "1", "--questions", str(QUESTIONS),
                 "--overrides", str(out)]) == 1
    assert not out.exists()                       # an empty range is an error and writes nothing
    main(["--bank", "mt-a", "--from", "10", "--to", "12", "--questions", str(QUESTIONS), "--overrides", str(out)])
    text, doc = written(out)
    assert list(doc) == sorted(doc)
    assert list(doc["questions"]) == sorted(doc["questions"])
    assert all(list(e) == sorted(e) for e in doc["questions"].values())
    assert text == json.dumps(doc, ensure_ascii=False, indent=1, sort_keys=True) + "\n"
    assert b"\r" not in out.read_bytes()


# --- --accept: an explanation reviewed against a re-imported question ----------------------------------------

def stale(src_hash="000000000000", **extra):
    return {"srcHash": src_hash, "topic": "airway", "explanation": "Reviewed and still right.", "notesRef": "s01",
            "generated": True, **extra}

def test_accept_sets_the_current_hash_and_changes_nothing_else():
    entry = stale(review="Check this one.")
    other = stale()
    overrides = {"version": 1, "questions": {"mt-a-q001": entry, "mt-a-q002": other}}
    before = json.loads(json.dumps(overrides))
    doc, accepted = accept(DOC, overrides, ["mt-a-q001"])
    assert accepted == ["mt-a-q001"]
    assert doc["questions"]["mt-a-q001"] == {**before["questions"]["mt-a-q001"], "srcHash": "aaaaaaaaaaaa"}
    assert doc["questions"]["mt-a-q002"] == before["questions"]["mt-a-q002"]   # not named: still stale
    assert overrides == before                                                  # the input is not mutated

def test_accept_leaves_a_current_hash_alone_and_says_so():
    doc, accepted = accept(DOC, {"version": 1, "questions": {"mt-a-q001": stale("aaaaaaaaaaaa")}}, ["mt-a-q001"])
    assert accepted == []
    assert doc["questions"]["mt-a-q001"]["srcHash"] == "aaaaaaaaaaaa"

def test_accept_refuses_an_id_that_is_not_a_question_or_has_no_entry():
    with pytest.raises(ValueError, match="mt-a-q999"):
        accept(DOC, {"questions": {}}, ["mt-a-q999"])
    with pytest.raises(ValueError, match="mt-a-q002"):
        accept(DOC, {"questions": {"mt-a-q001": stale()}}, ["mt-a-q001", "mt-a-q002"])

def test_main_accept_rewrites_only_the_named_hashes(tmp_path, capsys):
    out = tmp_path / "overrides.json"
    hashes = {x["id"]: x["srcHash"] for x in json.loads(QUESTIONS.read_text(encoding="utf-8"))["questions"]}
    entries = {qid: stale() for qid in ("mt-b-q001", "mt-b-q002", "mt-b-q003")}
    out.write_text(json.dumps({"version": 1, "questions": entries}, ensure_ascii=False, indent=1, sort_keys=True) + "\n",
                   encoding="utf-8")
    before = out.read_text(encoding="utf-8")
    assert main(["--accept", "mt-b-q001, mt-b-q003", "--questions", str(QUESTIONS), "--overrides", str(out)]) == 0
    text, doc = written(out)
    assert doc["questions"]["mt-b-q001"]["srcHash"] == hashes["mt-b-q001"]
    assert doc["questions"]["mt-b-q003"]["srcHash"] == hashes["mt-b-q003"]
    assert doc["questions"]["mt-b-q002"]["srcHash"] == "000000000000"
    changed = [(a, b) for a, b in zip(before.splitlines(), text.splitlines()) if a != b]
    assert len(changed) == 2 and all('"srcHash"' in a for a, _ in changed)   # two lines, both hashes
    assert b"\r" not in out.read_bytes()
    assert "Accepted 2" in capsys.readouterr().out

    assert main(["--accept", "mt-b-q001", "--questions", str(QUESTIONS), "--overrides", str(out)]) == 0
    assert out.read_text(encoding="utf-8") == text                            # already current: unchanged
    assert "already" in capsys.readouterr().out

def test_main_accept_fails_without_writing_for_an_unknown_id(tmp_path, capsys):
    out = tmp_path / "overrides.json"
    out.write_text(json.dumps({"version": 1, "questions": {"mt-b-q001": stale()}}), encoding="utf-8")
    before = out.read_bytes()
    assert main(["--accept", "mt-b-q001,mt-b-q999", "--questions", str(QUESTIONS), "--overrides", str(out)]) == 1
    assert out.read_bytes() == before
    assert "mt-b-q999" in capsys.readouterr().err

def test_bank_and_accept_are_one_or_the_other():
    with pytest.raises(SystemExit):
        main(["--bank", "mt-a", "--accept", "mt-a-q001"])
    with pytest.raises(SystemExit):
        main([])
