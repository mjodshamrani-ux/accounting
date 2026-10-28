"""Write the PG-1 H1 files into frozen/, each file with its own writer:
PHP's fputcsv (render.php), a Java writer with CRLF (Render.java), Go's
encoding/csv with UseCRLF (render.go), a Perl writer with a byte-order mark
and carriage returns alone (render.pl), LibreOffice Calc's CSV export of a
flat ODS spreadsheet holding every cell as text, every text cell quoted
(calc), and LibreOffice Calc's XLSX export of such a spreadsheet with the
story's hidden rows (lo-xlsx). Then each story's <id>-input.json: the five
file names, the confirmed readings and the scope. The writers are copied from
the ALL-1 H1 writers.

  python3 -B audit/payment-gateway-batches-holdout-h1/stories.py > frozen/stories.json
  python3 -B audit/payment-gateway-batches-holdout-h1/render.py frozen
"""
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from xml.sax.saxutils import escape

HERE = Path(__file__).resolve().parent
FAMILY = "payment-gateway-batches-1"
ROLES = ["transactions", "fee-evidence", "settlements", "payout-lines", "bank-credits"]
# Field separator, text delimiter, UTF-8, first line, column formats,
# language, quote every text cell, then the export defaults.
CSV_FILTER = "csv:Text - txt - csv (StarCalc):44,34,76,1,,0,true,true"
XLSX_FILTER = "xlsx:Calc MS Excel 2007 XML"


def fods(cells, hidden=()):
    """A flat ODS spreadsheet holding every cell as text; a hidden row is
    collapsed."""
    rows = []
    for r, row in enumerate(cells, start=1):
        out = [f"<table:table-cell office:value-type=\"string\"><text:p>{escape(v)}</text:p></table:table-cell>"
               if v else "<table:table-cell/>" for v in row]
        visibility = ' table:visibility="collapse"' if r in hidden else ""
        rows.append(f"<table:table-row{visibility}>" + "".join(out or ["<table:table-cell/>"]) + "</table:table-row>")
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" '
            'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" '
            'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" '
            'office:version="1.3" office:mimetype="application/vnd.oasis.opendocument.spreadsheet">'
            '<office:body><office:spreadsheet><table:table table:name="Sheet1">'
            + "".join(rows) + "</table:table></office:spreadsheet></office:body></office:document>\n")


def libreoffice(jobs, flt, suffix):
    if not jobs:
        return
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        for i, j in enumerate(jobs):
            (tmp / f"f{i:03d}.fods").write_text(fods(j["cells"], j["hidden"]), encoding="utf-8")
        subprocess.run(["soffice", f"-env:UserInstallation=file://{tmp}/profile", "--headless",
                        "--convert-to", flt, "--outdir", str(tmp / "out"),
                        *sorted(str(p) for p in tmp.glob("*.fods"))],
                       check=True, capture_output=True)
        for i, j in enumerate(jobs):
            shutil.copy(tmp / "out" / f"f{i:03d}.{suffix}", j["path"])


def framed(jobs):
    """Tab-separated, backslash-escaped lines for the Java and Perl writers."""
    def esc(v):
        return v.replace("\\", "\\\\").replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t")
    out = []
    for j in jobs:
        out.append("FILE\t" + esc(j["path"]))
        out += ["ROW\t" + "\t".join(esc(v) for v in row) if row else "ROW" for row in j["cells"]]
    return ("\n".join(out) + "\n").encode("utf-8")


def readings():
    return [{"sheet": 0, "role": role, "family": FAMILY, "confirmed": True} for role in ROLES]


def main(folder):
    folder = Path(folder).resolve()
    facts = json.loads((folder / "stories.json").read_text(encoding="utf-8"))
    jobs = {w: [] for w in ("php", "java", "go", "perl", "calc", "lo-xlsx")}
    for s in facts["stories"]:
        for side, (name, writer) in enumerate(zip(s["names"], s["writers"])):
            jobs[writer].append({"path": str(folder / name), "cells": s["cells"][side], "comma": "",
                                 "hidden": s["hidden"][side]})
    subprocess.run(["php", str(HERE / "render.php")], input=json.dumps(jobs["php"]).encode(), check=True)
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(["javac", "-d", tmp, str(HERE / "Render.java")], check=True)
        subprocess.run(["java", "-cp", tmp, "Render"], input=framed(jobs["java"]), check=True)
    subprocess.run(["go", "run", str(HERE / "render.go")], input=json.dumps(jobs["go"]).encode(), check=True)
    subprocess.run(["perl", str(HERE / "render.pl")], input=framed(jobs["perl"]), check=True)
    libreoffice(jobs["calc"], CSV_FILTER, "csv")
    libreoffice(jobs["lo-xlsx"], XLSX_FILTER, "xlsx")
    for s in facts["stories"]:
        given = {"names": s["names"], "readings": readings(), "scope": s["scope"]}
        (folder / f"{s['id']}-input.json").write_text(json.dumps(given, ensure_ascii=False, indent=1) + "\n",
                                                      encoding="utf-8")


if __name__ == "__main__":
    main(sys.argv[1])
