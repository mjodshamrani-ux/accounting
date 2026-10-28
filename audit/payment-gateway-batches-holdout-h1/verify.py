"""Independent check that every frozen PG-1 H1 file carries its story's
cells and its writer's form, read here without the csv module the oracle
uses: for CSV, a tokenizer written here, the byte-order mark, the line ends,
which fields are quoted and the padding; for XLSX, the sheet's cells, hidden
rows and the absence of formulas read from the XML. Each input file is built
again here from the story: the five names, the readings and the scope. Then
a self-test: the check must fail on a copy with one planted change. The
reading code is copied from the ALL-1 H1 check.

  PYTHONPATH= python3 -B audit/payment-gateway-batches-holdout-h1/verify.py frozen
"""
import hashlib
import io
import json
import re
import shutil
import sys
import tempfile
import unicodedata
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

OWN = {"stories.json", "EXPECTED.json", "VERIFY.json", "ELIGIBILITY.json", "INPUT-MANIFEST.json", "SEAL.json"}
MAIN = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
ROLES = ["transactions", "fee-evidence", "settlements", "payout-lines", "bank-credits"]
FAMILY = "payment-gateway-batches-1"


def php_quotes(v):
    return any(ch in v for ch in ',"\n\r\t ')


def go_quotes(v):
    return v != "" and (any(ch in v for ch in ',"\r\n') or unicodedata.category(v[0])[0] == "Z"
                        or v[0] in "\t\n\v\f\r\x85")


def plain_quotes(v):
    return any(ch in v for ch in ',"\r\n')


FORMS = {
    "php": {"bom": False, "end": "\n", "quoted": php_quotes, "pad": False},
    "java": {"bom": False, "end": "\r\n", "quoted": plain_quotes, "pad": False},
    "go": {"bom": False, "end": "\r\n", "quoted": go_quotes, "pad": False},
    "perl": {"bom": True, "end": "\r", "quoted": plain_quotes, "pad": False},
    "calc": {"bom": False, "end": "\n", "quoted": lambda v: v != "", "pad": True},
}


def tokens(raw):
    """RFC 4180 records as [(text, quoted)], an empty line as [], and every
    line end seen outside quotes."""
    rows, row, cell, quoted, ends = [], [], [], False, []
    i, inside, n = 0, False, len(raw)
    while i < n:
        c = raw[i]
        if inside:
            if c == '"':
                if i + 1 < n and raw[i + 1] == '"':
                    cell.append('"')
                    i += 1
                else:
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
            end = "\r\n" if raw[i:i + 2] == "\r\n" else c
            ends.append(end)
            i += len(end) - 1
            if row or cell or quoted:
                row.append(("".join(cell), quoted))
            rows.append(row)
            row, cell, quoted = [], [], False
        else:
            cell.append(c)
        i += 1
    if inside:
        raise ValueError("an unclosed quote")
    if cell or row or quoted:
        raise ValueError("no line end after the last record")
    return rows, ends


def read_csv(path, writer, cells):
    form = FORMS[writer]
    raw = path.read_bytes()
    out = []
    if raw.startswith(b"\xef\xbb\xbf") != form["bom"]:
        out.append(f"{path.name}: byte-order mark")
    try:
        rows, ends = tokens(raw.decode("utf-8")[1 if form["bom"] else 0:])
    except (UnicodeDecodeError, ValueError) as e:
        return None, out + [f"{path.name}: {e}"]
    if set(ends) - {form["end"]}:
        out.append(f"{path.name}: line ends {sorted(set(ends))}")
    want = [list(r) for r in cells]
    if form["pad"]:
        width = max(len(r) for r in want)
        want = [r + [""] * (width - len(r)) for r in want]
    read = [[t for t, _ in r] for r in rows]
    if read != want:
        out.append(f"{path.name}: cells differ from the story")
    for r in rows:
        for t, q in r:
            if q != form["quoted"](t):
                out.append(f"{path.name}: quoting of {t!r}")
                break
    return read, out


def read_xlsx(path, cells, hidden_rows):
    z = zipfile.ZipFile(io.BytesIO(path.read_bytes()))
    strings = ["".join(t.text or "" for t in si.iter(MAIN + "t"))
               for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall(MAIN + "si")]
    sheet = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
    got, hidden, formulas, height, width = {}, [], [], 0, 0
    for row in sheet.iter(MAIN + "row"):
        r = int(row.get("r"))
        if row.get("hidden") in ("1", "true"):
            hidden.append(r)
        for c in row.findall(MAIN + "c"):
            col = 0
            for ch in re.match(r"[A-Z]+", c.get("r")).group(0):
                col = col * 26 + ord(ch) - 64
            v = c.find(MAIN + "v")
            if c.find(MAIN + "f") is not None:
                formulas.append([r, col])
            if v is not None:
                got[(r, col)] = strings[int(v.text)] if c.get("t") == "s" else (v.text or "")
                height, width = max(height, r), max(width, col)
    want = {(r + 1, c + 1): v for r, row in enumerate(cells) for c, v in enumerate(row) if v}
    out = []
    if got != want:
        out.append(f"{path.name}: cells differ from the story")
    if hidden != hidden_rows:
        out.append(f"{path.name}: hidden rows")
    if formulas:
        out.append(f"{path.name}: formulas")
    read = [[got.get((r, c), "") for c in range(1, width + 1)] for r in range(1, height + 1)]
    return read, out


def given(s):
    """The story's input built again from the story."""
    readings = [{"sheet": 0, "role": r, "family": FAMILY, "confirmed": True} for r in ROLES]
    return {"names": s["names"], "readings": readings, "scope": s["scope"]}


def problems(folder):
    folder = Path(folder)
    facts = json.loads((folder / "stories.json").read_text(encoding="utf-8"))
    out, named = [], set(OWN)
    for s in facts["stories"]:
        for side, (name, writer) in enumerate(zip(s["names"], s["writers"])):
            named.add(name)
            path = folder / name
            if not path.exists():
                out.append(f"{name}: absent")
                continue
            if writer == "lo-xlsx":
                _, found = read_xlsx(path, s["cells"][side], s["hidden"][side])
            else:
                _, found = read_csv(path, writer, s["cells"][side])
            out += found
        path = folder / f"{s['id']}-input.json"
        named.add(path.name)
        want = json.dumps(given(s), ensure_ascii=False, indent=1) + "\n"
        if not path.exists() or path.read_text(encoding="utf-8") != want:
            out.append(f"{path.name}: not the story input")
    extra = sorted({p.name for p in folder.iterdir()} - named)
    if extra:
        out.append(f"files no story names: {extra}")
    return out


def edit(path, before, after):
    raw = path.read_bytes()
    assert raw.count(before) >= 1, (path, before)
    path.write_bytes(raw.replace(before, after, 1))


def drop_last_record(path, end):
    raw = path.read_bytes()
    records = raw.split(end)
    assert len(records) > 2 and records[-1] == b"", path
    path.write_bytes(end.join(records[:-2] + [b""]))


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
    ("one amount changed", lambda d: edit(d / "H01-payout-lines.csv", b'"1564.00"', b'"1564.01"')),
    ("one row dropped", lambda d: drop_last_record(d / "H02-transactions.csv", b"\r\n")),
    ("byte-order mark removed", lambda d: edit(d / "H01-settlements.csv", b"\xef\xbb\xbf", b"")),
    ("LF in a CR file", lambda d: edit(d / "H01-settlements.csv", b"\r", b"\n")),
    ("LF in a CRLF file", lambda d: edit(d / "H01-transactions.csv", b"\r\n", b"\n")),
    ("a quoted cell unquoted by Calc", lambda d: edit(d / "H01-payout-lines.csv", b'"PYO-7001"', b"PYO-7001")),
    ("an Arabic-Indic digit changed",
     lambda d: edit(d / "H16-transactions.csv", "\u0661\u0662".encode(), "\u0661\u0663".encode())),
    ("an XLSX row no longer hidden", lambda d: edit_zip(d / "H20-fees.xlsx", "xl/worksheets/sheet1.xml",
                                                        b'hidden="true"', b'hidden="false"')),
    ("an XLSX cell changed", lambda d: edit_zip(d / "H19-settlements.xlsx", "xl/sharedStrings.xml",
                                                b"STL/0319/A", b"STL/0319/C")),
    ("an input as-of date changed", lambda d: edit(d / "H12-input.json", b'"asOf": "2028-04-06"',
                                                   b'"asOf": "2028-04-07"')),
    ("an input naming another file", lambda d: edit(d / "H03-input.json", b'"H03-fees.csv"',
                                                    b'"H03-fees-2.csv"')),
    ("a file no story names", lambda d: (d / "H99-fees.csv").write_bytes(b"Fee ID\n")),
]


def main(folder):
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
        "schema": "tarasuf-pg1-batches-h1-verify/1",
        "factsSha256": hashlib.sha256((folder / "stories.json").read_bytes()).hexdigest(),
        "stories": len(stories),
        "files": sum(len(s["names"]) for s in stories),
        "cells": sum(len(r) for s in stories for side in s["cells"] for r in side),
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
