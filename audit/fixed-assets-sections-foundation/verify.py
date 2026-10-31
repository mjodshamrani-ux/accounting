"""Independent check of the FA-1 files, with Python's csv module rather than
the oracle's tokenizer: every file's cells equal the facts in stories.json,
each writer's shape holds (byte order marks, line ends, quoting, padding),
every patch is the only difference from its writer's output, every input
names its files, readings and scope, and nothing else is in the folder. Then
12 planted changes in copies of the folder must each be rejected.

    PYTHONPATH= python3 -B verify.py frozen        # writes frozen/VERIFY.json
    PYTHONPATH= python3 -B verify.py --dense DIR   # prints the check of the dense files
"""
import csv
import hashlib
import io
import json
import shutil
import sys
import tempfile
from pathlib import Path

BOM = "\ufeff"
ENDS = {"py-min": "\n", "py-min-crlf": "\r\n", "py-cr": "\r", "py-all-bom": "\r\n", "py-min-bom2": "\n",
        "py-pad": "\r\n", "node-all": "\r\n"}
QUOTED = {"py-all-bom", "node-all"}
NOT_INPUTS = {"stories.json", "EXPECTED.json", "VERIFY.json", "INPUT-MANIFEST.json", "SEAL.json",
              "DENSE-MANIFEST.json"}


def boms(writer, side):
    if writer == "py-all-bom":
        return 1
    if writer == "py-min-bom2":
        return 2 if side == 0 else 1
    return 0


def line_ends(text):
    """Every line end outside quotes, as written."""
    out, quoted, i = [], False, 0
    while i < len(text):
        ch = text[i]
        if ch == '"':
            quoted = not quoted
        elif not quoted and ch in "\r\n":
            if text[i:i + 2] == "\r\n":
                out.append("\r\n")
                i += 1
            else:
                out.append(ch)
        i += 1
    return out


def records(text):
    """Records split on the writer's line end outside quotes, to check quoting record by record."""
    out, cur, quoted = [], [], False
    for ch in text:
        if ch == '"':
            quoted = not quoted
        if not quoted and ch in "\r\n":
            out.append("".join(cur))
            cur = []
            continue
        cur.append(ch)
    if cur:
        out.append("".join(cur))
    return out


def check_file(raw, cells, writer, side, patch):
    problems = []
    for target, old, new in patch:
        if target == side:
            if raw.count(new.encode("utf-8")) != 1:
                return ["the patch is not in the file once"]
            raw = raw.replace(new.encode("utf-8"), old.encode("utf-8"))
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        return ["not UTF-8"]
    want = boms(writer, side)
    if not text.startswith(BOM * want) or text[want:want + 1] == BOM:
        problems.append(f"expected {want} byte order marks")
    text = text[want:]
    end = ENDS[writer]
    if any(e != end for e in line_ends(text)):
        problems.append(f"a line end other than {end!r}")
    if cells and not text.endswith(end):
        problems.append("the last record does not end with the writer's line end")
    rows = list(csv.reader(io.StringIO(text, newline="")))
    want_cells = [list(r) for r in cells]
    if writer == "py-pad":
        width = max((len(r) for r in want_cells), default=0)
        want_cells = [r + [""] * (width - len(r)) for r in want_cells]
        if any(len(r) != width for r in rows if r):
            problems.append("a record is not padded to the widest")
    if rows != want_cells:
        problems.append("the cells differ from the facts")
    if writer in QUOTED:
        for rec in records(text):
            if rec and not (rec.startswith('"') and rec.endswith('"')):
                problems.append("a field is not quoted")
                break
    return problems


def check(folder, facts):
    problems, files = [], 0
    expected_names = {"stories.json"}
    for s in facts["stories"]:
        given = {"names": s["names"], "readings": s["readings"], "scope": s["scope"]}
        path = folder / f"{s['id']}-input.json"
        expected_names.add(path.name)
        if not path.exists() or json.loads(path.read_text(encoding="utf-8")) != given:
            problems.append(f"{s['id']}: the input does not name its files, readings and scope")
        for side, name in enumerate(s["names"]):
            expected_names.add(name)
            if name != f"{s['id']}-{['register', 'map', 'gl'][side]}.csv":
                problems.append(f"{s['id']}: file {side} is named {name}")
            p = folder / name
            if not p.exists():
                problems.append(f"{name} is absent")
                continue
            files += 1
            for problem in check_file(p.read_bytes(), s["cells"][side], s["writer"], side, s["patch"]):
                problems.append(f"{name}: {problem}")
    extra = {p.name for p in folder.iterdir()} - expected_names - NOT_INPUTS
    if extra:
        problems.append(f"files the facts do not name: {sorted(extra)}")
    return problems, files


def plants(folder):
    """Each planted change, applied to a copy of the folder."""
    def edit(name, fn):
        def apply(d):
            p = d / name
            p.write_bytes(fn(p.read_bytes()))
        return apply

    def input_edit(sid, fn):
        def apply(d):
            p = d / f"{sid}-input.json"
            x = json.loads(p.read_text(encoding="utf-8"))
            fn(x)
            p.write_text(json.dumps(x, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        return apply

    return [
        ("an amount digit changed", edit("F01-register.csv", lambda b: b.replace(b"180000.00", b"180000.01", 1))),
        ("a map row dropped", edit("F01-map.csv", lambda b: b"\n".join(b.split(b"\n")[:-2]) + b"\n")),
        ("a byte order mark dropped", edit("F03-register.csv", lambda b: b[3:])),
        ("CRLF written as LF", edit("F02-register.csv", lambda b: b.replace(b"\r\n", b"\n"))),
        ("a scope currency changed", input_edit("F01", lambda x: x["scope"].update(currency="AED"))),
        ("a padded record unpadded", edit("F04-register.csv", lambda b: b.replace(b",,\r\n", b"\r\n", 1))),
        ("a quoted field unquoted", edit("F03-map.csv", lambda b: b.replace(b'"Vehicles"', b"Vehicles", 1))),
        ("a file the facts do not name", lambda d: (d / "F99-register.csv").write_bytes(b"Section,X\n")),
        ("a GL debit and credit swapped", edit("F01-gl.csv", lambda b: b.replace(b"275000.00,0.00", b"0.00,275000.00",
                                                                                 1))),
        ("the stray quote escaped", edit("F43-register.csv", lambda b: b.replace(b'VEH-01"01', b'"VEH-01""01"', 1))),
        ("the second byte order mark dropped", edit("F41-register.csv", lambda b: b[3:])),
        ("CR written as CRLF", edit("F35-gl.csv", lambda b: b.replace(b"\r", b"\r\n"))),
    ]


def main(argv):
    if argv[:1] == ["--dense"]:
        here = Path(__file__).resolve().parent
        sys.path.insert(0, str(here))
        import stories as model  # noqa: E402
        facts = {"stories": [s.to_json() for s in model.dense()]}
        folder = Path(argv[1])
        problems, files = check(folder, facts)
        print(json.dumps({"passed": not problems, "files": files, "problems": problems}, indent=1))
        return
    folder = Path(argv[0])
    facts_raw = (folder / "stories.json").read_bytes()
    facts = json.loads(facts_raw)
    problems, files = check(folder, facts)
    self_test = []
    for name, apply in plants(folder):
        with tempfile.TemporaryDirectory() as tmp:
            copy = Path(tmp) / "f"
            shutil.copytree(folder, copy)
            apply(copy)
            found, _ = check(copy, facts)
            self_test.append({"plant": name, "rejected": bool(found)})
    record = {"schema": "tarasuf-fa1-verify/1", "passed": not problems, "stories": len(facts["stories"]),
              "files": files, "problems": problems, "selfTest": self_test,
              "factsSha256": hashlib.sha256(facts_raw).hexdigest()}
    (folder / "VERIFY.json").write_text(json.dumps(record, indent=1) + "\n", encoding="utf-8")
    print(json.dumps({"passed": record["passed"], "files": files, "problems": problems[:20],
                      "rejected": sum(p["rejected"] for p in self_test), "of": len(self_test)}, indent=1))
    if problems or not all(p["rejected"] for p in self_test):
        sys.exit(1)


if __name__ == "__main__":
    main(sys.argv[1:])
