"""Independent check that every frozen CLR-1 extract carries its story's cells
and its writer's form, read here without the csv module the oracle uses: for
CSV, a tokenizer written here, the byte-order mark, the line ends and which
fields are quoted; for XLSX, the sheet's cells, hidden rows and formulas read
from the XML; and each input file equal to the story's name, reading and
scope. Then a self-test: the check must fail on a copy with one planted
change.

    PYTHONPATH= python3 -B audit/clearing-groups-foundation/verify.py frozen
"""
import hashlib
import io
import json
import re
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path

OWN = {"stories.json", "EXPECTED.json", "VERIFY.json", "DENSE-MANIFEST.json", "INPUT-MANIFEST.json", "SEAL.json"}
FORMS = {"py-min": (False, "\n", "minimal"), "py-min-crlf": (False, "\r\n", "minimal"),
         "py-all-bom": (True, "\r\n", "all")}
MAIN = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def tokens(text):
    """RFC 4180 records as [(cell, quoted)], and the line ends seen."""
    rows, row, cell, quoted, inside, ends = [], [], [], False, False, []
    i = 0
    while i < len(text):
        c = text[i]
        if inside:
            if c == '"' and text[i + 1:i + 2] == '"':
                cell.append('"')
                i += 1
            elif c == '"':
                inside = False
            else:
                cell.append(c)
        elif c == '"':
            if cell or quoted:
                raise ValueError("a quote inside an unquoted field")
            inside = quoted = True
        elif c == ",":
            row.append(("".join(cell), quoted))
            cell, quoted = [], False
        elif c in "\r\n":
            end = "\r\n" if text[i:i + 2] == "\r\n" else c
            ends.append(end)
            i += len(end) - 1
            row.append(("".join(cell), quoted))
            rows.append(row)
            row, cell, quoted = [], [], False
        else:
            cell.append(c)
        i += 1
    if inside or cell or row or quoted:
        raise ValueError("no line end after the last record")
    return rows, ends


def check_csv(path, story):
    bom, end, quoting = FORMS[story["writer"]]
    raw = path.read_bytes()
    out = []
    if raw.startswith(b"\xef\xbb\xbf") != bom:
        out.append(f"{path.name}: byte-order mark")
    try:
        rows, ends = tokens(raw.decode("utf-8")[1 if bom else 0:])
    except (UnicodeDecodeError, ValueError) as error:
        return out + [f"{path.name}: {error}"]
    if set(ends) != {end}:
        out.append(f"{path.name}: line ends")
    if [[t for t, _ in r] for r in rows] != story["cells"]:
        out.append(f"{path.name}: cells differ from the story")
    for r in rows:
        for t, q in r:
            need = quoting == "all" or any(ch in t for ch in ',"\r\n')
            if q != need:
                out.append(f"{path.name}: quoting of {t!r}")
                break
    return out


def check_xlsx(path, story):
    z = zipfile.ZipFile(io.BytesIO(path.read_bytes()))
    strings = ["".join(t.text or "" for t in si.iter(MAIN + "t"))
               for si in zipfile_xml(z, "xl/sharedStrings.xml").findall(MAIN + "si")]
    sheet = zipfile_xml(z, "xl/worksheets/sheet1.xml")
    cells, hidden, formulas = {}, [], []
    for row in sheet.iter(MAIN + "row"):
        r = int(row.get("r"))
        if row.get("hidden") == "1":
            hidden.append(r)
        for c in row.findall(MAIN + "c"):
            col = 0
            for ch in re.match(r"[A-Z]+", c.get("r")).group(0):
                col = col * 26 + ord(ch) - 64
            v, f = c.find(MAIN + "v"), c.find(MAIN + "f")
            if f is not None:
                formulas.append([r, col, f.text])
            cells[(r, col)] = strings[int(v.text)] if c.get("t") == "s" else (v.text if v is not None else "")
    want = {(r + 1, c + 1): v for r, row in enumerate(story["cells"]) for c, v in enumerate(row)}
    out = []
    if cells != want:
        out.append(f"{path.name}: cells differ from the story")
    if hidden != story["hidden"]:
        out.append(f"{path.name}: hidden rows")
    if sorted(formulas) != sorted(story["formulas"]):
        out.append(f"{path.name}: formulas")
    return out


def zipfile_xml(z, name):
    from xml.etree import ElementTree as ET
    return ET.fromstring(z.read(name))


def problems(folder):
    folder = Path(folder)
    facts = json.loads((folder / "stories.json").read_text(encoding="utf-8"))
    out, named = [], set(OWN)
    for story in facts["stories"]:
        given = folder / f"{story['id']}-input.json"
        named |= {given.name, story["name"]}
        want = json.dumps({"name": story["name"], "reading": story["reading"], "scope": story["scope"]},
                          ensure_ascii=False, indent=1) + "\n"
        if not given.exists() or given.read_text(encoding="utf-8") != want:
            out.append(f"{given.name}: not the story's input")
        path = folder / story["name"]
        if not path.exists():
            out.append(f"{story['name']}: absent")
        elif story["format"] == "xlsx":
            out += check_xlsx(path, story)
        else:
            out += check_csv(path, story)
    extra = sorted({p.name for p in folder.iterdir()} - named)
    if extra:
        out.append(f"files no story names: {extra}")
    return out


def edit(path, before, after):
    raw = path.read_bytes()
    assert raw.count(before) >= 1, (path, before)
    path.write_bytes(raw.replace(before, after, 1))


def edit_zip(path, member, before, after):
    z = zipfile.ZipFile(io.BytesIO(path.read_bytes()))
    assert before in z.read(member), (path, member, before)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as w:
        for item in z.infolist():
            data = z.read(item.filename)
            w.writestr(item, data.replace(before, after, 1) if item.filename == member else data)
    path.write_bytes(buf.getvalue())


PLANTS = [
    ("one amount changed", lambda d: edit(d / "F01.csv", b"-600.00", b"-600.01")),
    ("one line dropped", lambda d: edit(d / "F08.csv", b"P072,C050,2026-09-15,unread,2150,SAR,Bank charge\n", b"")),
    ("byte-order mark removed", lambda d: edit(d / "F09.csv", b"\xef\xbb\xbf", b"")),
    ("LF in a CRLF file", lambda d: edit(d / "F05.csv", b"Description\r\n", b"Description\n")),
    ("a field left unquoted where every field is quoted", lambda d: edit(d / "F17.csv", b'"C130"', b"C130")),
    ("a field quoted that needs none", lambda d: edit(d / "F02.csv", b",C010,", b',"C010",')),
    ("a quoted comma unquoted", lambda d: edit(d / "F13.csv", b'"Payment batch, line 1"', b"Payment batch line 1")),
    ("an Arabic-Indic digit changed", lambda d: edit(d / "F24.csv", "\u0661".encode(), "\u0662".encode())),
    ("an XLSX row no longer hidden", lambda d: edit_zip(d / "F25.xlsx", "xl/worksheets/sheet1.xml",
                                                        b' hidden="1"', b"")),
    ("an XLSX formula removed", lambda d: edit_zip(d / "F26.xlsx", "xl/worksheets/sheet1.xml",
                                                   b"<f>5*100</f>", b"")),
    ("an XLSX date changed", lambda d: edit_zip(d / "F27.xlsx", "xl/sharedStrings.xml",
                                                b"2026-09-31", b"2026-09-30")),
    ("an input's period changed", lambda d: edit(d / "F04-input.json", b'"2026-09-30"', b'"2026-10-31"')),
    ("a file no story names", lambda d: (d / "F99.csv").write_bytes(b"Posting ID\n")),
]


def dense_problems(folder):
    """The dense files against the dense stories regenerated from stories.py,
    with the same checks and no plants."""
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import stories as model
    folder = Path(folder)
    with tempfile.TemporaryDirectory() as tmp:
        copy = Path(tmp)
        for p in folder.iterdir():
            shutil.copy(p, copy / p.name)
        (copy / "stories.json").write_text(json.dumps({"stories": [s.to_json() for s in model.dense()]},
                                                      ensure_ascii=False), encoding="utf-8")
        return problems(copy)


def main(folder):
    if folder == "--dense":
        found = dense_problems(sys.argv[2])
        print(json.dumps({"schema": "tarasuf-clr1-verify-dense/1", "passed": not found, "problems": found}))
        sys.exit(1 if found else 0)
    folder = Path(folder)
    found = problems(folder)
    self_test = []
    for name, plant in PLANTS:
        with tempfile.TemporaryDirectory() as tmp:
            copy = Path(tmp) / "frozen"
            shutil.copytree(folder, copy)
            plant(copy)
            self_test.append({"plant": name, "rejected": bool(problems(copy))})
    stories = json.loads((folder / "stories.json").read_text(encoding="utf-8"))["stories"]
    result = {
        "schema": "tarasuf-clr1-verify/1",
        "factsSha256": hashlib.sha256((folder / "stories.json").read_bytes()).hexdigest(),
        "files": len(stories),
        "cells": sum(len(r) for s in stories for r in s["cells"]),
        "passed": not found,
        "problems": found,
        "selfTest": self_test,
    }
    (folder / "VERIFY.json").write_text(json.dumps(result, indent=1) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=1))
    if found or not all(p["rejected"] for p in self_test):
        sys.exit(1)


if __name__ == "__main__":
    main(sys.argv[1])
