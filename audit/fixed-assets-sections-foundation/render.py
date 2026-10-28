"""Write the FA-1 stories' three files and their inputs.

    python3 -B render.py frozen            # focused stories F01-F48, every writer
    python3 -B render.py --dense DIR       # dense stories D1-D2, Python writers only

Each story gets a register, a category map and a GL file, and <id>-input.json:
the file names, the confirmed readings and the scope.

Writers: py-min (minimal quoting, LF), py-min-crlf (minimal quoting, CRLF),
py-cr (minimal quoting, CR alone), py-all-bom (every field quoted, CRLF, byte
order mark), py-min-bom2 (minimal quoting, LF, two byte order marks before the
register and one before the map and the GL), py-pad
(minimal quoting, CRLF, every record padded with empty cells to the widest
record of its file, as spreadsheets export) and node-all (render.mjs: every
field quoted by Node, CRLF). A story's patch replaces one byte string once
after writing, for input no writer produces.
"""
import csv
import io
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import stories as model  # noqa: E402

BOM = b"\xef\xbb\xbf"


def write(rows, writer, side=0):
    buf = io.StringIO(newline="")
    ends = {"py-min": "\n", "py-min-crlf": "\r\n", "py-cr": "\r", "py-all-bom": "\r\n", "py-min-bom2": "\n",
            "py-pad": "\r\n"}
    quoting = csv.QUOTE_ALL if writer == "py-all-bom" else csv.QUOTE_MINIMAL
    w = csv.writer(buf, quoting=quoting, lineterminator=ends[writer])
    if writer == "py-pad":
        width = max((len(r) for r in rows), default=0)
        rows = [list(r) + [""] * (width - len(r)) for r in rows]
    w.writerows(rows)
    data = buf.getvalue().encode("utf-8")
    if writer == "py-all-bom":
        return BOM + data
    if writer == "py-min-bom2":
        return BOM + BOM + data if side == 0 else BOM + data
    return data


def patched(data, side, patch):
    for target, old, new in patch:
        if target == side:
            if data.count(old.encode("utf-8")) != 1:
                raise ValueError(f"patch {old!r} does not occur once")
            data = data.replace(old.encode("utf-8"), new.encode("utf-8"))
    return data


def emit(stories, out, python_only):
    out.mkdir(parents=True, exist_ok=True)
    pending = []
    for s in stories:
        for side, name in enumerate(s["names"]):
            if s["writer"] == "node-all":
                if python_only:
                    raise ValueError("dense stories use Python writers only")
                pending.append({"path": str(out / name), "rows": s["cells"][side]})
            else:
                (out / name).write_bytes(patched(write(s["cells"][side], s["writer"], side), side, s["patch"]))
    if pending:
        subprocess.run(["node", str(HERE / "render.mjs")], input=json.dumps(pending).encode("utf-8"), check=True)
    for s in stories:
        if s["writer"] == "node-all":
            for side, name in enumerate(s["names"]):
                (out / name).write_bytes(patched((out / name).read_bytes(), side, s["patch"]))
        given = {"names": s["names"], "readings": s["readings"], "scope": s["scope"]}
        (out / f"{s['id']}-input.json").write_text(json.dumps(given, ensure_ascii=False, indent=1) + "\n",
                                                   encoding="utf-8")


def main(argv):
    if argv[:1] == ["--dense"]:
        emit([s.to_json() for s in model.dense()], Path(argv[1]), True)
    else:
        emit([s.to_json() for s in model.focused()], Path(argv[0]), False)


if __name__ == "__main__":
    main(sys.argv[1:])
