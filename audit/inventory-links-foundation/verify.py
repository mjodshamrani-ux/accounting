"""Independent check of every INV-3 file against the story facts, with a CSV
reader written here (not Python's csv, not the product's): every cell, the
shape each writer promises (byte order mark, line ends, quoting), and each
period scope. Then the same check must reject planted changes.

    python3 -B verify.py frozen                 # focused files; writes frozen/VERIFY.json
    python3 -B verify.py --dense DIR            # regenerated dense files; prints the result
"""
import hashlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import stories as model  # noqa: E402

ROLES = ["register", "mapping", "evidence", "gl"]


def parse(text):
    rows, row, cell, i, quoted, was_quoted = [], [], [], 0, False, False
    while i < len(text):
        ch = text[i]
        if quoted:
            if ch == '"' and text[i + 1:i + 2] == '"':
                cell.append('"'); i += 2; continue
            if ch == '"':
                quoted = False; i += 1; continue
            cell.append(ch); i += 1; continue
        if ch == '"' and not cell:
            quoted = was_quoted = True; i += 1; continue
        if ch == ",":
            row.append("".join(cell)); cell = []; i += 1; continue
        if ch in "\r\n":
            row.append("".join(cell)); rows.append(row); row, cell = [], []
            i += 2 if text[i:i + 2] == "\r\n" else 1
            continue
        cell.append(ch); i += 1
    if quoted:
        raise ValueError("open quote")
    if cell or row:
        row.append("".join(cell)); rows.append(row)
    return rows


def shape(data, writer):
    """What the writer promises about bytes, beyond the cells."""
    bom = data.startswith(b"\xef\xbb\xbf")
    body = data[3:] if bom else data
    crlf = body.count(b"\r\n")
    lf = body.count(b"\n") - crlf
    problems = []
    if bom != (writer == "py-all-bom"):
        problems.append("byte order mark")
    wants_crlf = writer in ("py-min-crlf", "py-all-bom", "node")
    if (wants_crlf and lf) or (not wants_crlf and crlf) or not body.endswith(b"\r\n" if wants_crlf else b"\n"):
        problems.append("line ends")
    text = body.decode("utf-8")
    if writer == "py-all-bom" and any(not line.startswith('"') for line in text.splitlines()):
        problems.append("every field quoted")
    if writer == "join" and '"' in text:
        problems.append("no quoting")
    return problems


def check_story(folder, story):
    problems = []
    sid = story["id"]
    scope = json.loads((folder / f"{sid}-scope.json").read_text(encoding="utf-8"))
    if scope != story["scope"]:
        problems.append(f"{sid}: scope")
    for f in story["files"]:
        data = (folder / f"{sid}-{f['role']}.csv").read_bytes()
        problems += [f"{sid}-{f['role']}: {p}" for p in shape(data, f["writer"])]
        text = data.decode("utf-8")
        if text.startswith("\ufeff"):
            text = text[1:]
        if parse(text) != f["rows"]:
            problems.append(f"{sid}-{f['role']}: cells")
    return problems


def check(folder, stories):
    folder = Path(folder)
    problems, cells = [], 0
    for s in stories:
        problems += check_story(folder, s)
        cells += sum(len(r) for f in s["files"] for r in f["rows"])
    return problems, cells


def plants(folder, stories):
    """Each planted change to one story's files must be rejected."""
    import shutil
    import tempfile
    pick = next(s for s in stories if s["files"][0]["writer"] == "py-min")
    quoted = next(s for s in stories if s["files"][0]["writer"] == "py-all-bom")
    cases = [
        ("one cell changed", pick, "register", lambda b: b.replace(b"TILE-100", b"TILE-10O", 1)),
        ("leading zero dropped", next(s for s in stories if s["id"] == "L14"), "register",
         lambda b: b.replace(b"\n00420,", b"\n0420,", 1)),
        ("one row dropped", pick, "mapping", lambda b: b"\n".join(b.split(b"\n")[:-2]) + b"\n"),
        ("two columns swapped", pick, "gl", lambda b: b.replace(b"Debit,Credit", b"Credit,Debit", 1)),
        ("byte order mark removed", quoted, "register", lambda b: b[3:]),
        ("line ends changed", pick, "register", lambda b: b.replace(b"\n", b"\r\n")),
        ("a quote removed", quoted, "register", lambda b: b.replace(b'"', b"", 1)),
        ("scope changed", pick, None, None),
    ]
    out = []
    for name, story, role, change in cases:
        with tempfile.TemporaryDirectory() as tmp:
            for p in Path(folder).glob(f"{story['id']}-*"):
                shutil.copy(p, tmp)
            if role is None:
                path = Path(tmp) / f"{story['id']}-scope.json"
                data = json.loads(path.read_text(encoding="utf-8"))
                data["asOf"] = "2026-10-01"
                path.write_text(json.dumps(data), encoding="utf-8")
            else:
                path = Path(tmp) / f"{story['id']}-{role}.csv"
                path.write_bytes(change(path.read_bytes()))
            try:
                rejected = bool(check_story(Path(tmp), story))
            except (ValueError, UnicodeDecodeError):
                rejected = True
        out.append({"plant": name, "story": story["id"], "rejected": rejected})
    return out


def main(argv):
    if argv[:1] == ["--dense"]:
        stories = [s.to_json() for s in model.dense()]
        problems, cells = check(argv[1], stories)
        print(json.dumps({"passed": not problems, "problems": problems, "files": 4 * len(stories), "cells": cells}))
        sys.exit(1 if problems else 0)
    folder = Path(argv[0])
    facts = folder / "stories.json"
    stories = json.loads(facts.read_text(encoding="utf-8"))["stories"]
    problems, cells = check(folder, stories)
    self_test = plants(folder, stories)
    record = {"schema": "tarasuf-inv3-verify/1", "passed": not problems, "problems": problems,
              "files": 4 * len(stories), "cells": cells, "selfTest": self_test,
              "factsSha256": hashlib.sha256(facts.read_bytes()).hexdigest()}
    (folder / "VERIFY.json").write_text(json.dumps(record, indent=1) + "\n", encoding="utf-8")
    print(json.dumps({k: record[k] for k in ("passed", "files", "cells")} |
                     {"rejected": sum(p["rejected"] for p in self_test), "plants": len(self_test)}))
    if problems or not all(p["rejected"] for p in self_test):
        sys.exit(1)


if __name__ == "__main__":
    main(sys.argv[1:])
