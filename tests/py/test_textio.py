import hashlib
import json
from textio import dump_json, say, sha12, write_text

DOC = {"b": [1, {"t": "37.5 °C"}], "a": None}

def test_write_text_is_utf8_with_lf_only_and_makes_the_folder(tmp_path):
    out = tmp_path / "new" / "f.txt"
    write_text(out, "line one\nSpO2 ≥ 95 °\n")
    assert out.read_bytes() == "line one\nSpO2 ≥ 95 °\n".encode("utf-8")
    assert b"\r" not in out.read_bytes()

def test_dump_json_is_the_house_style_with_a_trailing_newline():
    text = dump_json(DOC)
    assert text == json.dumps(DOC, ensure_ascii=False, indent=1) + "\n"
    assert text.endswith("}\n") and not text.endswith("\n\n")
    assert "°" in text                                  # characters kept, not \u escapes
    assert text.splitlines()[1] == ' "b": ['            # 1-space indent, insertion order
    assert list(json.loads(dump_json(DOC, sort_keys=True))) == ["a", "b"]

def test_sha12_is_the_first_12_hex_of_sha256():
    assert sha12("é") == hashlib.sha256("é".encode("utf-8")).hexdigest()[:12]

def test_say_prints_ascii_only(capsys):
    say("SpO2 ≥ 95")
    assert capsys.readouterr().out == "SpO2 \\u2265 95\n"
