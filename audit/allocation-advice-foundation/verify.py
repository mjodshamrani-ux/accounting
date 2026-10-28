"""Independent check that every ALL-1 snapshot file carries its story's
cells and its writer's form, read here without the csv module the oracle
uses: for CSV, a tokenizer written here, the byte-order mark, the line ends
and which fields are quoted; for XLSX, the sheet's cells and hidden rows from
the XML. And each session input: the story's names, readings and scope, and
every decision's links naming the right payment, invoice and advice rows by
the hash of their file. Then a self-test: the check must fail on a copy with
one planted change.

    PYTHONPATH= python3 -B audit/allocation-advice-foundation/verify.py frozen
    PYTHONPATH= python3 -B audit/allocation-advice-foundation/verify.py --dense DIR
"""
import hashlib
import io
import json
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

HERE = Path(__file__).resolve().parent
OWN = {"stories.json", "EXPECTED.json", "VERIFY.json", "INPUT-MANIFEST.json", "SEAL.json", "DENSE-MANIFEST.json"}
MAIN = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
FORMS = {
    "py-min": {"bom": False, "end": "\n", "quoted": lambda v: any(c in v for c in ',"\r\n')},
    "py-min-crlf": {"bom": False, "end": "\r\n", "quoted": lambda v: any(c in v for c in ',"\r\n')},
    "py-all-bom": {"bom": True, "end": "\r\n", "quoted": lambda v: True},
}
ROLES = ["available-payments", "open-invoices", "proposed-remittance"]


def tokens(raw):
    """RFC 4180 records as [(text, quoted)] and every line end seen outside
    quotes."""
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


def check_csv(path, cells, writer):
    form, raw, out = FORMS[writer], path.read_bytes(), []
    if raw.startswith(b"\xef\xbb\xbf") != form["bom"]:
        out.append(f"{path.name}: byte-order mark")
    try:
        rows, ends = tokens(raw.decode("utf-8")[1 if form["bom"] else 0:])
    except (UnicodeDecodeError, ValueError) as e:
        return out + [f"{path.name}: {e}"]
    if set(ends) - {form["end"]}:
        out.append(f"{path.name}: line ends")
    if [[t for t, _ in r] for r in rows] != cells:
        out.append(f"{path.name}: cells differ from the story")
    if any(q != form["quoted"](t) for r in rows for t, q in r):
        out.append(f"{path.name}: quoting")
    return out


def check_xlsx(path, cells, hidden):
    z = zipfile.ZipFile(io.BytesIO(path.read_bytes()))
    strings = ["".join(t.text or "" for t in si.iter(MAIN + "t"))
               for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall(MAIN + "si")]
    sheet = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
    got, seen_hidden = {}, []
    for row in sheet.iter(MAIN + "row"):
        r = int(row.get("r"))
        if row.get("hidden") in ("1", "true"):
            seen_hidden.append(r)
        for c in row.findall(MAIN + "c"):
            col = 0
            for ch in re.match(r"[A-Z]+", c.get("r")).group(0):
                col = col * 26 + ord(ch) - 64
            v = c.find(MAIN + "v")
            if v is not None:
                got[(r, col)] = strings[int(v.text)] if c.get("t") == "s" else (v.text or "")
    want = {(r + 1, c + 1): v for r, row in enumerate(cells) for c, v in enumerate(row) if v}
    out = []
    if got != want:
        out.append(f"{path.name}: cells differ from the story")
    if seen_hidden != hidden:
        out.append(f"{path.name}: hidden rows")
    return out


def check_input(folder, s):
    given = json.loads((folder / f"{s['id']}-input.json").read_text(encoding="utf-8"))
    out = []
    if given["names"] != s["names"] or given["scope"] != s["scope"] or given["readings"] != [
            {"sheet": 0, "role": r, "family": "allocation-snapshot-1", "confirmed": True} for r in ROLES]:
        return [f"{s['id']}-input.json: not the story's names, readings or scope"]
    hashes = [hashlib.sha256((folder / n).read_bytes()).hexdigest() for n in s["names"]]
    head = [s["cells"][k][0] for k in range(3)]
    ref_row = [{row[head[k].index(("Payment ID", "Invoice ID")[k])]: r + 1 for r, row in enumerate(s["cells"][k])
                if r} for k in (0, 1)]
    if len(given["events"]) != len(s["decisions"]):
        return [f"{s['id']}-input.json: events"]
    for e, d in zip(given["events"], s["decisions"]):
        if e["id"] != d["id"] or e["type"] != ("undo" if d["type"] == "undo" else "allocate"):
            out.append(f"{s['id']}-input.json: event {e['id']}")
            continue
        if d["type"] == "undo":
            if e["target"] != d["target"]:
                out.append(f"{s['id']}-input.json: undo target")
            continue
        if d["type"] == "remittance":
            want = []
            for x in d["lines"]:
                row = s["lineRows"][x]
                cells = dict(zip(head[2], s["cells"][2][row - 1]))
                want.append((cells["Payment ID"], cells["Invoice ID"], s["adviceMinor"][x], f"2:{hashes[2]}:0:{row}"))
        else:
            want = [(p, i, m, "") for p, i, m in d["links"]]
        got = [(link["paymentId"], link["invoiceId"], link["amount"], link["basis"]["proofId"]) for link in e["links"]]
        expect = [(f"0:{hashes[0]}:0:{ref_row[0][p]}", f"1:{hashes[1]}:0:{ref_row[1][i]}", m, proof)
                  for p, i, m, proof in want]
        if got != expect:
            out.append(f"{s['id']}-input.json: links of {e['id']}")
    return out


def problems(folder, facts):
    folder = Path(folder)
    out, named = [], set(OWN)
    for s in facts:
        named |= {f"{s['id']}-input.json", *s["names"]}
        for k, name in enumerate(s["names"]):
            path = folder / name
            if not path.exists():
                out.append(f"{name}: absent")
            elif s["writer"] == "exceljs":
                out += check_xlsx(path, s["cells"][k], s["hidden"][k])
            else:
                out += check_csv(path, s["cells"][k], s["writer"])
        if (folder / f"{s['id']}-input.json").exists():
            out += check_input(folder, s)
        else:
            out.append(f"{s['id']}-input.json: absent")
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


def edit_json(path, change):
    data = json.loads(path.read_text(encoding="utf-8"))
    change(data)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


PLANTS = [
    ("an advice amount changed", lambda d: edit(d / "F04-advice.csv", b"I1,400.00\n", b"I1,400.01\n")),
    ("an invoice reference changed", lambda d: edit(d / "F01-invoices.csv", b"I2,", b"I3,")),
    ("a byte-order mark removed", lambda d: edit(d / "F23-advice.csv", b"\xef\xbb\xbf", b"")),
    ("an LF in a CRLF file", lambda d: edit(d / "F02-advice.csv", b"\r\nR2", b"\nR2")),
    ("a field quoted where the writer does not", lambda d: edit(d / "F01-advice.csv", b",P1,", b',"P1",')),
    ("an XLSX line no longer hidden", lambda d: edit_zip(d / "F25-advice.xlsx", "xl/worksheets/sheet1.xml",
                                                          b'hidden="1"', b'hidden="0"')),
    ("a decision naming another advice row", lambda d: edit_json(
        d / "F11-input.json", lambda j: j["events"][0]["links"][0]["basis"].update(
            proofId=j["events"][0]["links"][0]["basis"]["proofId"][:-1] + "3"))),
    ("a decision naming another file", lambda d: edit_json(
        d / "F12-input.json", lambda j: j["events"][0]["links"][0].update(
            paymentId="0:" + "0" * 64 + ":0:2"))),
    ("an undo of another decision", lambda d: edit_json(d / "F14-input.json",
                                                        lambda j: j["events"][1].update(target="D9"))),
    ("a scope changed", lambda d: edit_json(d / "F01-input.json", lambda j: j["scope"].update(party="Supplier S02"))),
    ("a file no story names", lambda d: (d / "F99-advice.csv").write_bytes(b"Advice line ID\n")),
]


def facts_of(folder, dense):
    if dense:
        raw = subprocess.run([sys.executable, "-B", str(HERE / "stories.py"), "--dense"], check=True,
                             capture_output=True).stdout
    else:
        raw = (Path(folder) / "stories.json").read_bytes()
    return json.loads(raw)["stories"], hashlib.sha256(raw).hexdigest()


def main(argv):
    dense = argv[:1] == ["--dense"]
    folder = Path(argv[1] if dense else argv[0])
    facts, facts_sha = facts_of(folder, dense)
    found = problems(folder, facts)
    self_test = []
    if not dense:
        for name, plant in PLANTS:
            with tempfile.TemporaryDirectory() as tmp:
                copy = Path(tmp) / "frozen"
                shutil.copytree(folder, copy)
                plant(copy)
                self_test.append({"plant": name, "rejected": bool(problems(copy, facts))})
    result = {"schema": "tarasuf-all1-advice-verify/1", "dense": dense,
              "factsSha256": facts_sha,
              "stories": len(facts), "files": sum(len(s["names"]) for s in facts),
              "cells": sum(len(r) for s in facts for c in s["cells"] for r in c),
              "passed": not found, "problems": found, "selfTest": self_test}
    if not dense:
        (folder / "VERIFY.json").write_text(json.dumps(result, indent=1) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=1))
    if found or not all(p["rejected"] for p in self_test):
        sys.exit(1)


if __name__ == "__main__":
    main(sys.argv[1:])
