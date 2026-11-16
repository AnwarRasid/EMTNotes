import json
from pathlib import Path
import pytest
from import_notes import _caption_alts, build_notes, main

DOCX = Path(__file__).parents[2] / "sources/EMT_Survey_Notes.docx"
TITLES = ["Primary Survey", "Secondary Survey", "Glasgow Coma Scale", "Chief Complaint & L.O.T.A.A.R.R.R.P.",
          "EMT Protocols", "Guide for Head-to-Toe Examination", "Auscultation (6 points)", "4-Lead ECG Placement",
          "12-Lead ECG Placement", "Heart Rhythms", "Oxygen & SpO2", "Drugs", "Devices & Machines", "PPE",
          "Vital Signs", "Respiratory Emergencies", "Cardiac Emergencies", "IV Therapy (Intravenous)",
          "IO Infusion (Intraosseous)", "Injection of Drugs"]
STEP_ANCHORS = ["respond-call-call-caller", "preparation", "rescue-scene-evaluation", "approach-patient",
                "introduction", "loc-avpu-scale", "fast-check-a-b-c-loc-unresponsive", "delicate-spine", "airway",
                "breathing", "circulation", "c-collar-application-ensapa", "rapid-body-survey",
                "c-collar-application-ensapa-after-rbs", "immobilization", "investigation-vital-signs", "oxygen",
                "airway-recheck", "position", "decision-point", "notification"]

@pytest.fixture(scope="module")
def built(tmp_path_factory):
    img = tmp_path_factory.mktemp("img")
    return build_notes(DOCX, img), img

def walk(blocks):
    for b in blocks:
        yield b
        if b["k"] == "box": yield from walk(b["blocks"])
        if b["k"] == "table":
            for row in b["rows"]:
                for cell in row["cells"]: yield from walk(cell)

def all_blocks(doc): return [b for s in doc["sections"] for b in walk(s["blocks"])]
def text(b): return "".join(r["t"] for r in b.get("runs", [])) if b["k"] == "p" else ""

def test_sections(built):
    doc = built[0]
    assert [s["id"] for s in doc["sections"]] == [f"s{n:02}" for n in range(1, 21)]
    assert [s["title"] for s in doc["sections"]] == TITLES
    assert doc["sections"][18]["tags"] == ["not tested"] and doc["sections"][19]["tags"] == ["not tested"]
    assert doc["sections"][0]["tags"] == []

def test_front_matter_skipped(built):
    assert not any("Formatting key" in text(b) for b in all_blocks(built[0]))

def test_step_anchors_exist_in_order(built):
    ids = [b["id"] for b in built[0]["sections"][0]["blocks"] if b["k"] == "h"]
    assert [a for a in ids if a in STEP_ANCHORS] == STEP_ANCHORS

def test_anchors_unique_per_section(built):
    for s in built[0]["sections"]:
        ids = [b["id"] for b in s["blocks"] if b["k"] == "h"]
        assert len(ids) == len(set(ids)), s["id"]

def test_boxes(built):
    boxes = [b for b in all_blocks(built[0]) if b["k"] == "box"]
    assert sum(b["variant"] == "remark" for b in boxes) == 17
    assert sum(b["variant"] == "added" for b in boxes) == 9
    assert all(b["title"] for b in boxes)

def test_split_box_is_merged(built):
    boxes = [b for b in all_blocks(built[0]) if b["k"] == "box"]
    rescue = [b for b in boxes if "Rescue breathing" in json.dumps(b, ensure_ascii=False)]
    assert rescue and "12 bpm" in json.dumps(rescue[0], ensure_ascii=False)

def test_tables(built):
    tables = [b for b in all_blocks(built[0]) if b["k"] == "table"]
    assert len(tables) == 9
    assert all(t["rows"][0]["header"] for t in tables)

def test_images(built):
    doc, img = built
    imgs = [b for b in all_blocks(doc) if b["k"] == "img"]
    assert len(imgs) == 14 and len(list(img.glob("*.png"))) == 14
    assert all((img / Path(b["src"]).name).exists() and b["alt"] for b in imgs)
    assert any(b["k"] == "img" for b in doc["sections"][6]["blocks"])

def runs_in(b): return b.get("runs", []) + [run for item in b.get("items", []) for run in item["runs"]]

def test_highlights(built):
    s01 = built[0]["sections"][0]
    assert s01["highlights"] > 0 and sum(s["highlights"] for s in built[0]["sections"]) > 60
    runs = [run for b in walk(s01["blocks"]) for run in runs_in(b)]
    assert any(run.get("h") and "NEVER move the patient" in run["t"] for run in runs)

def test_approach_order(built):
    blocks = built[0]["sections"][0]["blocks"]
    start = next(i for i, b in enumerate(blocks) if b.get("id") == "approach-patient")
    items = [it for b in blocks[start:start + 8] if b["k"] == "list" for it in b["items"] if it["marker"].endswith(".")]
    assert [it["marker"] for it in items][:4] == ["1.", "2.", "3.", "4."]

def test_continuations_join_the_last_paragraph(built):
    # Each continuation table is text that wrapped out of its box; the PDF shows one wrapped line.
    paragraphs = [text(b) for box in all_blocks(built[0]) if box["k"] == "box"
                  for b in walk(box["blocks"]) if b["k"] == "p"]
    for phrase in ["> 12 yr old: 12 bpm (1 every 5s)", "2. Insert tube first then power on LSU.",
                   "· ECG interpretation is required.", "Bring IC & Medic Awas tag if any.",
                   "What is the heart rate of the respective ECG strips (in bpm)?"]:
        assert sum(phrase in p for p in paragraphs) == 1, phrase

def test_heading_runs_keep_highlights(built):
    headings = [b for b in all_blocks(built[0]) if b["k"] == "h"]
    asthma = next(b for b in built[0]["sections"][15]["blocks"] if b.get("id") == "asthma-tested")
    assert asthma["text"] == "".join(r["t"] for r in asthma["runs"]) == "Asthma (tested)"
    assert any(r.get("h") and "(tested)" in r["t"] for r in asthma["runs"])
    assert sum("runs" in h for h in headings) == 11   # only headings with inline highlights carry runs
    assert all(h["text"] == "".join(r["t"] for r in h["runs"]) for h in headings if "runs" in h)

def test_deterministic(tmp_path):
    for d in ("a", "b"):
        assert main(["--out", str(tmp_path / d / "notes.json"), "--img", str(tmp_path / d / "img")]) == 0
    assert (tmp_path / "a/notes.json").read_bytes() == (tmp_path / "b/notes.json").read_bytes()

def test_image_alt_is_the_following_figure_caption_where_there_is_one(built):
    imgs = {Path(b["src"]).stem: b["alt"] for b in all_blocks(built[0]) if b["k"] == "img"}
    assert {k: v for k, v in imgs.items() if k[:3] in ("s08", "s09") or k in ("s10-1", "s10-2")} == {
        "s08-1": "Figure 1: 4-lead ECG placement on chest",
        "s08-2": "Figure 2: Alternative 4-lead placement on the limbs",
        "s09-1": "Figure 3: Example of patient on 12-lead ECG monitoring",
        "s09-2": "Figure 4: 12-lead ECG placement",
        "s10-1": 'Figure 5: "PQRST" graph of a normal sinus rhythm',
        "s10-2": "Figure 6: Measurement of duration of an ECG strip (constant speed of 25 mm/sec)",
    }
    # With no caption after it, an image keeps its number in the section and the heading above it.
    assert imgs["s07-1"] == "Figure 1: Auscultation (6 points)"
    assert imgs["s10-3"] == "Normal Sinus Rhythm, ECG rhythm strip"

def test_a_reimport_removes_note_images_it_did_not_write(tmp_path):
    img = tmp_path / "img"
    img.mkdir()
    (img / "s99-1.png").write_bytes(b"a section that has gone")
    (img / "s08-3.png").write_bytes(b"an image the notes no longer have")
    (img / "s08-1.png").write_bytes(b"stale bytes")
    (img / "README.txt").write_text("not an image: left alone", encoding="utf-8")
    doc = build_notes(DOCX, img)
    written = sorted(Path(b["src"]).name for b in all_blocks(doc) if b["k"] == "img")
    assert sorted(p.name for p in img.glob("*.png")) == written
    assert len(written) == 14
    assert (img / "s08-1.png").read_bytes() != b"stale bytes"
    assert (img / "README.txt").exists()

def test_rhythm_strips_take_their_bold_label_as_alt_text(built):
    s10 = next(s for s in built[0]["sections"] if s["id"] == "s10")
    assert [b["alt"] for b in walk(s10["blocks"]) if b["k"] == "img"] == [
        "Figure 5: \"PQRST\" graph of a normal sinus rhythm",
        "Figure 6: Measurement of duration of an ECG strip (constant speed of 25 mm/sec)",
        "Normal Sinus Rhythm, ECG rhythm strip", "Sinus Bradycardia, ECG rhythm strip",
        "Sinus Tachycardia, ECG rhythm strip", "Ventricular Fibrillation, ECG rhythm strip", "Asystole, ECG rhythm strip",
        "ST-Depression, ECG rhythm strip (Left: normal ECG. Right: ST depression.)",
        "ST-Elevation, ECG rhythm strip (Left: normal ECG. Right: ST elevation.)"]

def test_caption_alts_on_hand_built_blocks():
    def label(*items): return {"k": "list", "items": [{"depth": 1, "marker": f"{n}.", "runs": runs}
                                                      for n, runs in enumerate(items, 1)]}
    def img(k): return {"k": "img", "src": f"img/notes/s99-{k}.png", "alt": f"Figure {k}: Rhythm strips"}
    def p(*runs): return {"k": "p", "runs": list(runs)}
    blocks = [
        label([{"t": "Ventricular Fibrillation", "b": True}, {"t": " (not tested)", "b": True, "h": True}]), img(1),
        label([{"t": "Normal Sinus Rhythm", "b": True}]), img(2), p({"t": "Figure 7: A captioned strip", "i": True}),
        label([{"t": "ST-Elevation", "b": True}]), img(3),
        p({"t": "Left: normal ECG. Right: ST elevation. Remark: "}, {"t": "infarction (cell death)", "b": True}),
        label([{"t": "Asystole", "b": True}, {"t": " flat"}]), img(4),
        label([{"t": "Sinus Bradycardia", "b": True}], [{"t": "Sinus Tachycardia", "b": True}]), img(5),
        p({"t": "Under a heading"}), img(6),
    ]
    _caption_alts(blocks)
    assert [b["alt"] for b in blocks if b["k"] == "img"] == [
        "Ventricular Fibrillation, ECG rhythm strip",          # "(not tested)" dropped
        "Figure 7: A captioned strip",                         # the caption wins over the label
        "ST-Elevation, ECG rhythm strip (Left: normal ECG. Right: ST elevation.)",
        "Figure 4: Rhythm strips",                             # the label is not all bold
        "Figure 5: Rhythm strips",                             # two items: not a label
        "Figure 6: Rhythm strips"]                             # no list above
