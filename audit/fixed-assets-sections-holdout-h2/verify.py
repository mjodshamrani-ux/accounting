"""Independent check that every frozen FA-1 H2 file carries its story's
cells and its writer's form, read here without the oracle's tokenizer: a
tokenizer written here, the byte-order mark, the line ends, whether the last
record ends with one, and which fields are quoted. A story's byte patch is
undone before reading, after checking that it is there. Each input file is
built again here from the story: the three names, the readings and the
scope. Then a self-test: the check must fail on a copy with one planted
change, and pass on the copy without one.

  PYTHONPATH= python3 -B audit/fixed-assets-sections-holdout-h2/verify.py frozen
"""
import hashlib
import json
import shutil
import sys
import tempfile
from pathlib import Path

OWN = {"stories.json", "EXPECTED.json", "VERIFY.json", "INPUT-MANIFEST.json", "SEAL.json"}
ROLES = ["register-sections", "category-map", "gl-balances"]
FAMILY = "fixed-assets-sections-1"


def special(v):
    return any(ch in v for ch in ',"\r\n')


FORMS = {
    "ruby": {"bom": False, "end": "\r\n", "last": True, "quoted": lambda v: v == "" or special(v)},
    "jq": {"bom": False, "end": "\n", "last": True, "quoted": lambda v: True},
    "awk": {"bom": True, "end": "\n", "last": True, "quoted": special},
    "rust": {"bom": False, "end": "\r\n", "last": False,
             "quoted": lambda v: special(v) or v[:1] == " " or v[-1:] == " "},
}


def tokens(raw):
    """RFC 4180 records as [(text, quoted)], an empty line as [], every line
    end seen outside quotes, and whether the last record ends with one."""
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
            if quoted:
                raise ValueError("text after a closing quote")
            cell.append(c)
        i += 1
    if inside:
        raise ValueError("an unclosed quote")
    last_ended = not (cell or row or quoted)
    if not last_ended:
        row.append(("".join(cell), quoted))
        rows.append(row)
    return rows, ends, last_ended


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
        rows, ends, last_ended = tokens(raw.decode("utf-8")[1 if form["bom"] else 0:])
    except (UnicodeDecodeError, ValueError) as e:
        return out + [f"{path.name}: {e}"]
    if set(ends) - {form["end"]}:
        out.append(f"{path.name}: line ends {sorted(set(ends))}")
    want_last = form["last"] or (bool(cells) and cells[-1] == [])
    if last_ended != want_last:
        out.append(f"{path.name}: line end after the last record")
    if [[t for t, _ in r] for r in rows] != [list(r) for r in cells]:
        out.append(f"{path.name}: cells differ from the story")
    for r in rows:
        for t, q in r:
            if q != form["quoted"](t):
                out.append(f"{path.name}: quoting of {t[:40]!r}")
                break
    return out


def given(s):
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
            out += read_csv(path, writer, s["cells"][side], patches)
        path = folder / f"{s['id']}-input.json"
        named.add(path.name)
        want = json.dumps(given(s), ensure_ascii=False, indent=1) + "\n"
        if not path.exists() or path.read_text(encoding="utf-8") != want:
            out.append(f"{path.name}: not the story input")
    extra = sorted({p.name for p in folder.iterdir()} - named)
    if extra:
        out.append(f"files no story names: {extra}")
    return out


def first_of(folder, writer, side=0):
    facts = json.loads((Path(folder) / "stories.json").read_text(encoding="utf-8"))
    for s in facts["stories"]:
        if s["writers"][side] == writer and not s["patch"]:
            return Path(folder) / s["names"][side]
    raise SystemExit(f"no {writer} file at side {side}")


def edit(path, before, after):
    raw = path.read_bytes()
    assert raw.count(before) >= 1, (path, before)
    path.write_bytes(raw.replace(before, after, 1))


def append(path, more):
    path.write_bytes(path.read_bytes() + more)


def drop_blank(folder, sid):
    """One blank record of a story's register removed, in its writer's line end."""
    facts = json.loads((Path(folder) / "stories.json").read_text(encoding="utf-8"))
    s = next(x for x in facts["stories"] if x["id"] == sid)
    end = FORMS[s["writers"][0]]["end"].encode()
    edit(Path(folder) / s["names"][0], end + end, end)


def drop_last_line(path, end):
    raw = path.read_bytes()
    body = raw[:-len(end)] if raw.endswith(end) else raw
    path.write_bytes(body[:body.rindex(end) + len(end)])


PLANTS = [
    ("one amount changed", lambda d: edit(d / "O01-register.csv", b"14250.000", b"14250.001")),
    ("a record dropped", lambda d: drop_last_line(first_of(d, "ruby"), b"\r\n")),
    ("the awk byte-order mark removed", lambda d: edit(first_of(d, "awk", 1), b"\xef\xbb\xbf", b"")),
    ("a byte-order mark before a Ruby file", lambda d: edit(first_of(d, "ruby", 1), b"Category", b"\xef\xbb\xbfCategory")),
    ("LF in a Ruby CRLF file", lambda d: edit(first_of(d, "ruby"), b"\r\n", b"\n")),
    ("a line end after the last Rust record", lambda d: append(first_of(d, "rust", 1), b"\r\n")),
    ("a jq field left unquoted", lambda d: edit(first_of(d, "jq", 1), b'"Category"', b"Category")),
    ("an awk field quoted", lambda d: edit(first_of(d, "awk", 1), b"Category,", b'"Category",')),
    ("an Arabic letter changed", lambda d: edit(d / "O27-register.csv", "\u0646\u0632".encode(), "\u0646\u0631".encode())),
    ("a blank record removed", lambda d: drop_blank(d, "O02")),
    ("the byte patch undone", lambda d: edit(d / "O30-register.csv", b'RCK"12', b"RCK 12")),
    ("an input as-of date changed", lambda d: edit(d / "O01-input.json", b'"asOf": "2028-09-30"', b'"asOf": "2028-10-01"')),
    ("an input naming another file", lambda d: edit(d / "O03-input.json", b'"O03-map.csv"', b'"O03-map-2.csv"')),
    ("a file no story names", lambda d: (d / "O99-map.csv").write_bytes(b"Category\n")),
]


def main(folder):
    folder = Path(folder)
    found = problems(folder)
    self_test = []
    with tempfile.TemporaryDirectory() as tmp:
        copy = Path(tmp) / "frozen"
        shutil.copytree(folder, copy)
        control = not problems(copy)
    for name, plant in PLANTS:
        with tempfile.TemporaryDirectory() as tmp:
            copy = Path(tmp) / "frozen"
            shutil.copytree(folder, copy)
            plant(copy)
            self_test.append({"plant": name, "rejected": bool(problems(copy))})
    stories = json.loads((folder / "stories.json").read_text(encoding="utf-8"))["stories"]
    result = {
        "schema": "tarasuf-fa1-sections-h2-verify/1",
        "factsSha256": hashlib.sha256((folder / "stories.json").read_bytes()).hexdigest(),
        "stories": len(stories),
        "files": sum(len(s["names"]) for s in stories),
        "cells": sum(len(r) for s in stories for side in s["cells"] for r in side),
        "passed": not found,
        "problems": found,
        "copyWithoutPlantPasses": control,
        "selfTest": self_test,
    }
    (folder / "VERIFY.json").write_text(json.dumps(result, indent=1) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=1))
    if found or not control or not all(p["rejected"] for p in self_test):
        sys.exit(1)


if __name__ == "__main__":
    main(sys.argv[1])
