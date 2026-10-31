"""Write the CLR-1 stories' extracts.

    python3 -B render.py frozen            # focused stories F01-F32, every writer
    python3 -B render.py --dense DIR       # dense stories D1-D5, Python writers only

Writers: py-min (minimal quoting, LF), py-min-crlf (minimal quoting, CRLF),
py-all-bom (every field quoted, CRLF, byte order mark) and exceljs
(render.mjs: an XLSX sheet of text cells, with the story's hidden rows and
formulas, through the ExcelJS the application already depends on).
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


def emit(stories, out, python_only):
    out.mkdir(parents=True, exist_ok=True)
    pending = []
    for s in stories:
        (out / f"{s['id']}-input.json").write_text(json.dumps(
            {"name": s["name"], "reading": s["reading"], "scope": s["scope"]}, ensure_ascii=False, indent=1) + "\n",
            encoding="utf-8")
        name = out / s["name"]
        if s["writer"] == "exceljs":
            if python_only:
                raise ValueError("dense stories use Python writers only")
            pending.append({"path": str(name), "rows": s["cells"], "hidden": s["hidden"], "formulas": s["formulas"]})
        else:
            name.write_bytes(write(s["cells"], s["writer"]))
    if pending:
        subprocess.run(["node", str(HERE / "render.mjs")], input=json.dumps(pending).encode("utf-8"), check=True)


def main(argv):
    if argv[:1] == ["--dense"]:
        emit([s.to_json() for s in model.dense()], Path(argv[1]), True)
    else:
        emit([s.to_json() for s in model.focused()], Path(argv[0]), False)


if __name__ == "__main__":
    main(sys.argv[1:])
