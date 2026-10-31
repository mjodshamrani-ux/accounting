"""Independent check of a links workbook downloaded from the product, read
with zipfile and ElementTree (not ExcelJS): every sheet, every link row and
related record against the sealed expectations, every Item ID, dimension,
Mapping ID and Evidence ID as text exactly as the source files carry it, and
the counts in Summary. --self-test plants changes in a copy of the workbook,
each of which must be rejected.

    python3 -B check_workbook.py WORKBOOK --story ID [--folder DIR] [--expected FILE] [--self-test]
"""
import argparse
import io
import json
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from verify import parse  # noqa: E402

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
      "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
      "p": "http://schemas.openxmlformats.org/package/2006/relationships"}
SHEETS = ["Summary", "Links", "Link members", "Unlinked records"]
ROLES = ["register", "mapping", "evidence", "gl"]


def column(ref):
    n = 0
    for ch in re.match(r"[A-Z]+", ref).group(0):
        n = n * 26 + ord(ch) - 64
    return n - 1


def read(data):
    z = zipfile.ZipFile(io.BytesIO(data))
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS):
            shared.append("".join(t.text or "" for t in si.iter(f"{{{NS['m']}}}t")))
    book = ET.fromstring(z.read("xl/workbook.xml"))
    rels = {r.get("Id"): r.get("Target") for r in
            ET.fromstring(z.read("xl/_rels/workbook.xml.rels")).findall("p:Relationship", NS)}
    sheets = {}
    for s in book.find("m:sheets", NS):
        target = rels[s.get(f"{{{NS['r']}}}id")].lstrip("/")
        path = target if target.startswith("xl/") else "xl/" + target
        rows = []
        for row in ET.fromstring(z.read(path)).iter(f"{{{NS['m']}}}row"):
            cells = {}
            for c in row.findall("m:c", NS):
                kind, v = c.get("t"), c.find("m:v", NS)
                if kind == "s":
                    value = shared[int(v.text)]
                elif kind == "inlineStr":
                    value = "".join(t.text or "" for t in c.iter(f"{{{NS['m']}}}t"))
                elif kind == "str":
                    value = v.text or ""
                elif v is None:
                    value = None
                else:
                    value = float(v.text) if "." in v.text else int(v.text)
                    kind = "n"
                cells[column(c.get("r"))] = (value, kind)
            width = max(cells) + 1 if cells else 0
            rows.append([cells.get(i, (None, None)) for i in range(width)])
        sheets[s.get("name")] = rows
    return sheets


def sources(folder, sid):
    """The register, mapping and evidence cells by row, read here from bytes."""
    out = {}
    for role in ROLES:
        text = (Path(folder) / f"{sid}-{role}.csv").read_bytes().decode("utf-8")
        rows = parse(text[1:] if text.startswith("\ufeff") else text)
        header = rows[0]
        out[role] = {i + 1: dict(zip(header, r)) for i, r in enumerate(rows) if i}
    return out


def check(data, sid, folder, want):
    problems = []
    try:
        sheets = read(data)
    except Exception as error:  # an unreadable workbook is a rejection
        return [f"unreadable: {error}"]
    if list(sheets) != SHEETS:
        return [f"sheets {list(sheets)}"]
    text = lambda cell: cell[0] if cell[1] in ("s", "inlineStr", "str") else None
    number = lambda cell: cell[0] if cell[1] == "n" else None
    src = sources(folder, sid)
    links, unlinked = want["links"], want["unlinked"]
    summary = {text(r[0]): r[1] for r in sheets["Summary"][1:]}
    linked = sum(1 for l in links if l[1] == "linked")
    for field, value in (("Register records", len(links)), ("Linked", linked),
                         ("Unlinked", len(links) - linked), ("Unlinked records", len(unlinked))):
        if number(summary.get(field, (None, None))) != value:
            problems.append(f"Summary {field}")
    if text(summary.get("Financial", (None, None))) != want["financial"]:
        problems.append("Summary Financial")
    head = [text(c) for c in sheets["Links"][0]]
    if head != ["Register record ID", "Source row", "Item ID", "Item dimensions", "Status", "Reasons",
                "GL account", "GL dimensions"]:
        problems.append("Links header")
    body = sheets["Links"][1:]
    if len(body) != len(links):
        problems.append("Links rows")
    for got, (row, status, reasons, maps, evs, account, gl) in zip(body, links):
        reg = src["register"][row]
        expect = [row, reg["Item ID"], reg["Item dimensions"], status, " ".join(reasons),
                  account.split("|", 1)[0] if account else None,
                  account.split("|", 1)[1] if account else None]
        seen = [number(got[1]), text(got[2]), text(got[3]), text(got[4]), text(got[5]) or "",
                text(got[6]) if len(got) > 6 else None, text(got[7]) if len(got) > 7 else None]
        if seen != expect:
            problems.append(f"Links row {row}")
    members = [[number(r[1]), text(r[2]), number(r[4]), text(r[5]), text(r[6]) if len(r) > 6 else None]
               for r in sheets["Link members"][1:]]
    want_members = []
    for row, status, reasons, maps, evs, account, gl in links:
        want_members += [[row, "mapping", m, src["mapping"][m]["Mapping ID"], None] for m in maps]
        want_members += [[row, "evidence", e, src["evidence"][e]["Evidence ID"], None] for e in evs]
        want_members += [[row, "gl", g, *account.split("|", 1)] for g in gl]
    if members != want_members:
        problems.append("Link members")
    others = [[text(r[0]), number(r[2]) if len(r) > 2 else None, text(r[3]),
               text(r[4]) if len(r) > 4 else None, text(r[5])] for r in sheets["Unlinked records"][1:]]
    want_others = [[role, row, *(key.split("|", 1) if role in ("gl", "account") else [key, None]), reason]
                   for role, row, key, reason in unlinked]
    if others != want_others:
        problems.append("Unlinked records")
    return problems


def plants(data):
    """Each change must be rejected: one reason, one leading zero, one row."""
    def edit(old, new, part="xl/sharedStrings.xml"):
        z = zipfile.ZipFile(io.BytesIO(data))
        if old not in z.read(part):
            return None  # nothing to plant in this story
        out = io.BytesIO()
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as w:
            for item in z.infolist():
                content = z.read(item.filename)
                if item.filename == part:
                    content = content.replace(old, new, 1)
                w.writestr(item, content)
        return out.getvalue()
    def drop_last_row(sheet):
        z = zipfile.ZipFile(io.BytesIO(data))
        text = z.read(sheet).decode("utf-8")
        cut = text.rfind("<row ")
        end = text.find("</row>", cut) + len("</row>")
        return edit(text[cut:end].encode("utf-8"), b"", sheet)
    return [("linked read as unlinked", edit(b">linked<", b">unlinked<")),
            ("a reason changed", edit(b"NO_MAPPING", b"NO_EVIDENCE")),
            ("a leading zero dropped", edit(b">00420<", b">420<")),
            ("last link row dropped", drop_last_row("xl/worksheets/sheet2.xml")),
            ("last member row dropped", drop_last_row("xl/worksheets/sheet3.xml"))]


def main():
    a = argparse.ArgumentParser()
    a.add_argument("workbook")
    a.add_argument("--story", required=True)
    a.add_argument("--folder", default=str(HERE / "frozen"))
    a.add_argument("--expected", default=str(HERE / "frozen" / "EXPECTED.json"))
    a.add_argument("--self-test", action="store_true")
    args = a.parse_args()
    want = json.loads(Path(args.expected).read_text(encoding="utf-8"))["stories"][args.story]
    data = Path(args.workbook).read_bytes()
    found = check(data, args.story, args.folder, want)
    result = {"story": args.story, "passed": not found, "problems": found}
    if args.self_test:
        result["selfTest"] = [{"plant": name, "planted": changed is not None,
                               "rejected": changed is not None and bool(check(changed, args.story, args.folder, want))}
                              for name, changed in plants(data)]
    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0 if not found and all(p["rejected"] or not p["planted"] for p in result.get("selfTest", [])) else 1)


if __name__ == "__main__":
    main()
