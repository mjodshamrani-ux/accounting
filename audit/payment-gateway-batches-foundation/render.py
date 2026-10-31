"""Write the PG-1 stories' five files and their inputs.

    python3 -B render.py frozen            # focused stories F01-F35, every writer
    python3 -B render.py --dense DIR       # dense stories D1-D3, Python writers only

Each story gets five files (transactions, fees, settlements, payout lines,
bank credits) and <id>-input.json: the file names, the confirmed readings and
the scope.

Writers: py-min (minimal quoting, LF), py-min-crlf (minimal quoting, CRLF),
py-all-bom (every field quoted, CRLF, byte order mark) and exceljs
(render.mjs: XLSX sheets of text cells, with the story's hidden rows,
through the ExcelJS the application already depends on).
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


def write(rows, writer):
    buf = io.StringIO(newline="")
    if writer == "py-min":
        w = csv.writer(buf, quoting=csv.QUOTE_MINIMAL, lineterminator="\n")
    elif writer == "py-min-crlf":
        w = csv.writer(buf, quoting=csv.QUOTE_MINIMAL, lineterminator="\r\n")
    elif writer == "py-all-bom":
        w = csv.writer(buf, quoting=csv.QUOTE_ALL, lineterminator="\r\n")
    else:
        raise ValueError(writer)
    w.writerows(rows)
    data = buf.getvalue().encode("utf-8")
    return b"\xef\xbb\xbf" + data if writer == "py-all-bom" else data


def readings():
    return [{"sheet": 0, "role": role, "family": model.FAMILY, "confirmed": True} for role in model.ROLES]


def emit(stories, out, python_only):
    out.mkdir(parents=True, exist_ok=True)
    pending = []
    for s in stories:
        for side, name in enumerate(s["names"]):
            if s["writer"] == "exceljs":
                if python_only:
                    raise ValueError("dense stories use Python writers only")
                pending.append({"path": str(out / name), "rows": s["cells"][side], "hidden": s["hidden"][side]})
            else:
                (out / name).write_bytes(write(s["cells"][side], s["writer"]))
    if pending:
        subprocess.run(["node", str(HERE / "render.mjs")], input=json.dumps(pending).encode("utf-8"), check=True)
    for s in stories:
        given = {"names": s["names"], "readings": readings(), "scope": s["scope"]}
        (out / f"{s['id']}-input.json").write_text(json.dumps(given, ensure_ascii=False, indent=1) + "\n",
                                                   encoding="utf-8")


def main(argv):
    if argv[:1] == ["--dense"]:
        emit([s.to_json() for s in model.dense()], Path(argv[1]), True)
    else:
        emit([s.to_json() for s in model.focused()], Path(argv[0]), False)


if __name__ == "__main__":
    main(sys.argv[1:])
