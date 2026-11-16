import xml.etree.ElementTree as ET
import pytest
from notes_docx import Run, runs_of, split_lines, classify, heading_kind, slugify

NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
def p(body: str): return ET.fromstring(f"<w:p {NS}>{body}</w:p>")
def r(text, props=""): return f"<w:r><w:rPr>{props}</w:rPr><w:t xml:space=\"preserve\">{text}</w:t></w:r>"

def test_flags():
    [run] = runs_of(p(r("x", '<w:b/><w:i/><w:u w:val="single"/><w:highlight w:val="yellow"/>')))
    assert (run.b, run.i, run.u, run.h) == (True, True, True, True)
    [off] = runs_of(p(r("x", '<w:b w:val="0"/><w:u w:val="none"/>')))
    assert (off.b, off.u) == (False, False)

def test_neighbours_with_equal_flags_merge():
    assert [x.t for x in runs_of(p(r("Ask ", "<w:b/>") + r("crew", "<w:b/>") + r(" now")))] == ["Ask crew", " now"]

def test_breaks_split_lines():
    lines = split_lines(runs_of(p(r("•One") + "<w:r><w:br/></w:r>" + r("–Two"))))
    assert ["".join(x.t for x in line) for line in lines] == ["•One", "–Two"]

def test_classify():
    line = lambda s: runs_of(p(r(s)))
    assert classify(line("•Ask crew"))[0] == "bullet" and classify(line("•Ask crew"))[1]["depth"] == 1
    kind, data = classify(line("\t–\"Ops Centre, Roger\""))
    assert (kind, data["depth"], data["runs"][0].t) == ("bullet", 2, '"Ops Centre, Roger"')
    kind, data = classify(line("1. MUST sound out"))
    assert (kind, data["marker"], data["runs"][0].t) == ("ordered", "1.", "MUST sound out")
    assert classify(line("Note: plain"))[0] == "text"

def test_heading_kind():
    assert heading_kind(runs_of(p(r("1. Primary Survey", '<w:b/><w:sz w:val="32"/>')))) == "section"
    assert heading_kind(runs_of(p(r("Asthma", '<w:b/><w:sz w:val="26"/>') + r(" (tested)", '<w:b/><w:highlight w:val="yellow"/><w:sz w:val="26"/>')))) == "sub"
    assert heading_kind(runs_of(p(r("EMT Drugs (Must Know)", '<w:b/><w:sz w:val="28"/>')))) == "group"
    assert heading_kind(runs_of(p(r("Breathing", '<w:sz w:val="26"/>')))) is None

@pytest.mark.parametrize("text,slug", [
    ("Respond Call & Call Caller", "respond-call-call-caller"),
    ("LOC (AVPU Scale)", "loc-avpu-scale"),
    ("C-Collar Application (ENSAPA) – after RBS", "c-collar-application-ensapa-after-rbs"),
    ("3. Diabetic Emergency – Hypoglycemia < 4 mmol/L (Stay & Treat)", "3-diabetic-emergency-hypoglycemia-4-mmol-l-stay-treat"),
])
def test_slugify(text, slug):
    assert slugify(text) == slug

# Beyond the plan's list: interface behaviour the cases above leave open.

DRAWING = ('<w:r><w:drawing><a:blip xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
           'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId7"/></w:drawing></w:r>')

def test_tab_and_drawing():
    runs = runs_of(p(r("A") + "<w:r><w:tab/></w:r>" + r("B") + DRAWING + r("C")))
    assert [(x.t, x.img) for x in runs] == [("A B", None), ("", "rId7"), ("C", None)]

def test_marker_in_its_own_run_is_stripped_across_runs():
    kind, data = classify(runs_of(p(r("•") + r(" ") + r("Check", "<w:b/>") + r(" pulse"))))
    assert (kind, [(x.t, x.b) for x in data["runs"]]) == ("bullet", [("Check", True), (" pulse", False)])

def test_indented_ordered_marker():
    kind, data = classify(runs_of(p(r("\t\t2. Patient's ID number"))))
    assert (kind, data["depth"], data["marker"], data["runs"][0].t) == ("ordered", 1, "2.", "Patient's ID number")
    assert classify(runs_of(p(r("1.5 mg"))))[0] == "text"

def test_to_json_exports_set_flags_only():
    assert Run("x", b=True, h=True, sz=26).to_json() == {"t": "x", "b": True, "h": True}
    assert Run("y").to_json() == {"t": "y"}
