"""Independent check that every frozen FA-1 H1 file carries its story's
cells and its writer's form, read here without the oracle's tokenizer: a
tokenizer written here, the byte-order mark, the line ends, which fields are
quoted and Calc's padding. A story's byte patch is undone before reading,
after checking that it is there. Each input file is built again here from
the story: the three names, the readings and the scope. Then a self-test:
the check must fail on a copy with one planted change. The reading code is
copied from the PG-1 H1 check, CSV only.

  PYTHONPATH= python3 -B audit/fixed-assets-sections-holdout-h1/verify.py frozen
"""
import hashlib
import json
import shutil
import sys
import tempfile
import unicodedata
from pathlib import Path

OWN = {"stories.json", "EXPECTED.json", "VERIFY.json", "INPUT-MANIFEST.json", "SEAL.json"}
ROLES = ["register-sections", "category-map", "gl-balances"]
FAMILY = "fixed-assets-sections-1"


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


def read_csv(path, writer, cells, patches):
    form = FORMS[writer]
    raw = path.read_bytes()
    out = []
    for old, new in patches:
        if raw.count(new.encode()) != 1:
            out.append(f"{path.name}: the patch is not there once")
            continue
        raw = raw.replace(new.encode(), old.encode(), 1)
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
                out.append(f"{path.name}: quoting of {t[:40]!r}")
                break
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
            patches = [(old, new) for at, old, new in s["patch"] if at == side]
            _, found = read_csv(path, writer, s["cells"][side], patches)
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


PLANTS = [
    ("one amount changed", lambda d: edit(d / "H01-register.csv", b"18500.000", b"18500.001")),
    ("one row dropped", lambda d: drop_last_record(d / "H02-register.csv", b"\r\n")),
    ("byte-order mark removed", lambda d: edit(d / "H02-gl.csv", b"\xef\xbb\xbf", b"")),
    ("LF in a CR file", lambda d: edit(d / "H02-gl.csv", b"\r", b"\n")),
    ("LF in a CRLF file", lambda d: edit(d / "H01-map.csv", b"\r\n", b"\n")),
    ("a quoted cell unquoted by Calc", lambda d: edit(d / "H03-gl.csv", b'"GL-HTL"', b"GL-HTL")),
    ("an Arabic letter changed",
     lambda d: edit(d / "H03-register.csv", "\u062e\u064a".encode(), "\u062d\u064a".encode())),
    ("a blank record removed", lambda d: edit(d / "H02-register.csv", b"\r\n\r\n", b"\r\n")),
    ("the byte patch undone", lambda d: edit(d / "H34-register.csv", b'KIT"0001', b"KIT/0001")),
    ("an input as-of date changed", lambda d: edit(d / "H01-input.json", b'"asOf": "2028-03-31"',
                                                   b'"asOf": "2028-04-01"')),
    ("an input naming another file", lambda d: edit(d / "H03-input.json", b'"H03-map.csv"',
                                                    b'"H03-map-2.csv"')),
    ("a file no story names", lambda d: (d / "H99-map.csv").write_bytes(b"Category\n")),
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
        "schema": "tarasuf-fa1-sections-h1-verify/1",
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
