"""CLR-1 groups oracle, independent of the product.

Reads each story's file name, reading and scope from <story>-input.json and
the extract from its bytes here: CSV with Python's csv module after
choosing the separator the way the contract states it, XLSX with zipfile and
ElementTree. Applies clearing-1's reading rules as the contract restates
them, then forms groups by the proposed contract clearing-groups-1:
membership by reference, posting numbers that may repeat, duplicate sets,
and the isolation of faulty lines.

    python3 -B oracle.py frozen > frozen/EXPECTED.json        # focused stories
    python3 -B oracle.py --dense DIR > DIR/EXPECTED-DENSE.json  # dense stories
"""
import csv
import hashlib
import io
import json
import re
import sys
import unicodedata
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

LIMIT = 20030
GROUP_LIMIT = 100
DECIMALS = {"SAR": 2, "KWD": 3, "JPY": 0}
ROLES = {"clearingreference", "clearingdocument", "مرجعالمقاصة", "رقمالمقاصة"}
REASONS = ["UNISOLATED_ERROR", "CONNECTED_ERROR", "DUPLICATE_MEMBER", "GROUP_LIMIT", "MISSING_REFERENCE",
           "UNVERIFIED_REFERENCE_ROLE", "RESIDUAL"]
SUMMARY = re.compile(
    r"^(?:total|subtotal|grand total|opening balance|balance b/f|balance c/f|closing (?:ap )?balance|"
    r"balance brought forward|balance carried forward|carried forward|brought forward|page total|المجموع|"
    r"المرحل|رصيد مرحل|مجموع الصفحة|الإجمالي|الرصيد الافتتاحي|الرصيد الختامي|رصيد افتتاحي|رصيد ختامي)"
    r"\s*[:：]?$", re.IGNORECASE)
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
      "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
      "p": "http://schemas.openxmlformats.org/package/2006/relationships"}


class Refused(Exception):
    pass


class RowError(Exception):
    pass


# Reading -------------------------------------------------------------------

def csv_rows(data):
    text = data.decode("utf-8")
    if text.startswith("\ufeff"):
        text = text[1:]
    best = []
    for sep in [",", ";", "\t"]:
        try:
            rows = list(csv.reader(io.StringIO(text, newline=""), delimiter=sep, strict=True))
        except csv.Error:
            best.append((-1, sep, []))
            continue
        widths = [len(r) for r in rows if any(r)][:20]
        best.append((sum(1 for w in widths if w > 1), sep, rows))
    best.sort(key=lambda t: -t[0])
    if best[0][0] <= 0 or best[1][0] == best[0][0]:
        raise Refused("SOURCE")
    rows = [r if r else [""] for r in best[0][2]]
    if len(rows) > LIMIT:
        raise Refused("ROWS")
    return {"rows": rows, "hidden": set(), "formulaCells": set()}


def column(ref):
    n = 0
    for ch in re.match(r"[A-Z]+", ref).group(0):
        n = n * 26 + ord(ch) - 64
    return n


def xlsx_rows(data):
    z = zipfile.ZipFile(io.BytesIO(data))
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS):
            shared.append("".join(t.text or "" for t in si.iter(f"{{{NS['m']}}}t")))
    book = ET.fromstring(z.read("xl/workbook.xml"))
    rels = {r.get("Id"): r.get("Target") for r in
            ET.fromstring(z.read("xl/_rels/workbook.xml.rels")).findall("p:Relationship", NS)}
    first = book.find("m:sheets", NS)[0]
    target = rels[first.get(f"{{{NS['r']}}}id")].lstrip("/")
    sheet = ET.fromstring(z.read(target if target.startswith("xl/") else "xl/" + target))
    cells, hidden, formulas = {}, set(), set()
    for row in sheet.iter(f"{{{NS['m']}}}row"):
        r = int(row.get("r"))
        if row.get("hidden") in ("1", "true"):
            hidden.add(r)
        for c in row.findall("m:c", NS):
            col = column(c.get("r"))
            kind, v = c.get("t"), c.find("m:v", NS)
            if c.find("m:f", NS) is not None:
                formulas.add((r, col))
            if kind == "s":
                value = shared[int(v.text)]
            elif kind == "inlineStr":
                value = "".join(t.text or "" for t in c.iter(f"{{{NS['m']}}}t"))
            else:
                value = "" if v is None else (v.text or "")
            cells[(r, col)] = value
    height = max([r for r, _ in cells] + list(hidden) + [0])
    width = max([c for _, c in cells] + [0])
    if height > LIMIT:
        raise Refused("ROWS")
    rows = [[cells.get((r, c), "") for c in range(1, width + 1)] for r in range(1, height + 1)]
    return {"rows": rows, "hidden": hidden, "formulaCells": formulas}


# Values --------------------------------------------------------------------

def latin(value):
    out = []
    for ch in value:
        if "\u0660" <= ch <= "\u0669":
            out.append(str(ord(ch) - 0x660))
        elif "\u06f0" <= ch <= "\u06f9":
            out.append(str(ord(ch) - 0x6F0))
        elif ch not in "\u200e\u200f\u061c":
            out.append(ch)
    return "".join(out)


def identity(value):
    s = value.strip()
    if (len(s) > 200 or any(unicodedata.category(ch) in ("Cc", "Cf") for ch in s)
            or s[:1] in ("=", "+", "@", "-") or re.match(r"#(?:REF!|VALUE!|N/A|DIV/0!)", s, re.IGNORECASE)):
        raise RowError("IDENTITY")
    return s


def amount(value, decimals):
    raw = latin(value.strip()).replace("−", "-").replace("٫", ".")
    m = re.fullmatch(r"([+-]?)(\d+)(?:\.(\d+))?", raw)
    if not m or len(m.group(3) or "") > decimals:
        raise RowError("AMOUNT_FORMAT")
    n = int(m.group(2)) * 10 ** decimals + int(((m.group(3) or "") + "0" * decimals)[:decimals] or 0)
    if n > 10 ** 14:
        raise RowError("AMOUNT_FORMAT")
    return -n if m.group(1) == "-" else n


def date(value):
    raw = latin(value.strip())
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw):
        raise RowError("DATE")
    y, mth, d = map(int, raw.split("-"))
    days = [31, 29 if (y % 4 == 0 and y % 100) or y % 400 == 0 else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    if not (1900 <= y <= 2100 and 1 <= mth <= 12 and 1 <= d <= days[mth - 1]):
        raise RowError("DATE")
    return raw


# The extract ---------------------------------------------------------------

def judge(folder, sid):
    given = json.loads((Path(folder) / f"{sid}-input.json").read_text(encoding="utf-8"))
    reading, scope = given["reading"], given["scope"]
    path = Path(folder) / given["name"]
    data = path.read_bytes()
    try:
        sheet = xlsx_rows(data) if path.name.lower().endswith(".xlsx") else csv_rows(data)
    except Refused as r:
        return {"refused": str(r)}
    decimals = DECIMALS[scope["currency"]]
    rows = sheet["rows"]
    header = rows[0]
    signed = reading["mode"] == "signed"
    selected = [reading[k] for k in ("posting", "reference", "date", "account", "currency")]
    selected += [reading["amount"]] if signed else [reading["debit"], reading["credit"]]
    if reading["description"] >= 0:
        selected.append(reading["description"])
    if (any(c < 0 or c >= len(header) or not header[c].strip() for c in selected)
            or len(set(selected)) != len(selected)):
        return {"refused": "COLUMNS"}
    role = re.sub(r"\s", "", header[reading["reference"]].lower()) in ROLES

    movements, errors, blank = [], [], []
    for index, values in enumerate(rows[1:], start=2):
        cell = lambda c: values[c] if c < len(values) else ""  # noqa: E731
        try:
            if index in sheet["hidden"] or any((index, c + 1) in sheet["formulaCells"] for c in selected):
                raise RowError("CELL")
            if not any(v.strip() for v in values):
                blank.append(index)
                continue
            posting = identity(cell(reading["posting"]))
            reference = identity(cell(reading["reference"]))
            if not posting:
                raise RowError("POSTING")
            if identity(cell(reading["account"])) != scope["account"] \
                    or cell(reading["currency"]).strip() != scope["currency"]:
                raise RowError("ROW_SCOPE")
            when = date(cell(reading["date"]))
            if when < scope["start"] or when > scope["end"]:
                raise RowError("PERIOD")
            if signed:
                value = amount(cell(reading["amount"]), decimals)
            else:
                debit, credit = amount(cell(reading["debit"]), decimals), amount(cell(reading["credit"]), decimals)
                if debit < 0 or credit < 0 or (debit and credit):
                    raise RowError("SPLIT")
                value = debit - credit
            description = cell(reading["description"]) if reading["description"] >= 0 else ""
            movements.append({"row": index, "posting": posting, "reference": reference, "date": when,
                              "amount": value, "description": description})
        except RowError as error:
            errors.append({"row": index, "code": str(error), "values": values})

    # Isolation of each faulty line.
    width = max(i + 1 for i, h in enumerate(header) if h.strip())
    head = sorted(h.strip() for h in header[:width])
    for e in errors:
        values, r = e["values"], e["row"]
        ref = values[reading["reference"]] if reading["reference"] < len(values) else ""
        try:
            ref_ok = bool(identity(ref)) and not SUMMARY.match(re.split(r"[:：]", ref.strip())[0].strip())
        except RowError:
            ref_ok = False
        e["isolated"] = (role and r not in sheet["hidden"]
                         and not any(rr == r for rr, _ in sheet["formulaCells"])
                         and not any(v.strip() for v in values[width:])
                         and sorted(v.strip() for v in values[:width]) != head
                         and ref_ok)
        e["keys"] = sorted({v.strip() for v in values if v.strip()})
    unisolated = [e["row"] for e in errors if not e["isolated"]]

    # Groups by reference, whole; a line without a reference on its own.
    buckets, order = {}, []
    for mv in movements:
        key = ("ref", mv["reference"]) if mv["reference"] else ("row", mv["row"])
        if key not in buckets:
            buckets[key] = []
            order.append(key)
        buckets[key].append(mv)
    # Duplicate sets: equal in every selected cell as read.
    seen = {}
    for mv in movements:
        seen.setdefault((mv["posting"], mv["reference"], mv["date"], mv["amount"], mv["description"]), []).append(mv["row"])
    duplicate_sets = [rows_ for rows_ in seen.values() if len(rows_) > 1]
    in_duplicate = {r: s for s in duplicate_sets for r in s}

    groups = []
    for key in order:
        members = buckets[key]
        ref = members[0]["reference"]
        net = sum(m["amount"] for m in members)
        postings = {m["posting"] for m in members}
        connected = [[e["row"], e["code"]] for e in errors
                     if e["isolated"] and ref and (ref in e["keys"] or postings & set(e["keys"]))]
        dups = sorted({tuple(in_duplicate[m["row"]]) for m in members if m["row"] in in_duplicate})
        reasons = []
        if unisolated:
            reasons.append("UNISOLATED_ERROR")
        if connected:
            reasons.append("CONNECTED_ERROR")
        if dups:
            reasons.append("DUPLICATE_MEMBER")
        if len(members) > GROUP_LIMIT:
            reasons.append("GROUP_LIMIT")
        if not ref:
            reasons.append("MISSING_REFERENCE")
        else:
            if not role:
                reasons.append("UNVERIFIED_REFERENCE_ROLE")
            if net != 0 or not any(m["amount"] > 0 for m in members) or not any(m["amount"] < 0 for m in members):
                reasons.append("RESIDUAL")
        groups.append({"reference": ref, "members": [[m["row"], m["posting"], m["amount"],
                                                      "REFERENCE" if ref else "ROW"] for m in members],
                       "net": net, "status": "review" if reasons else "cleared", "reasons": reasons,
                       "connected": connected, "duplicates": [list(d) for d in dups]})
    total = sum(m["amount"] for m in movements)
    assert sum(g["net"] for g in groups) == total
    assert sorted(m[0] for g in groups for m in g["members"]) == [m["row"] for m in movements]
    return {"refused": None, "decimals": decimals, "role": role, "groups": groups,
            "errors": [[e["row"], e["code"], e["isolated"]] for e in errors], "blank": blank,
            "unisolated": unisolated, "total": total, "sha256": hashlib.sha256(data).hexdigest()}


def canonical(obj):
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def main(argv):
    dense = argv[:1] == ["--dense"]
    folder = Path(argv[1] if dense else argv[0])
    ids = sorted(p.name[: -len("-input.json")] for p in folder.glob("*-input.json"))
    stories = {sid: judge(folder, sid) for sid in ids}
    out = {"schema": "tarasuf-clr1-expected/1", "oracle": "audit/clearing-groups-foundation/oracle.py",
           "stories": stories}
    if dense:
        out["sha256"] = {sid: hashlib.sha256(canonical(v).encode("utf-8")).hexdigest() for sid, v in stories.items()}
    sys.stdout.write(json.dumps(out, ensure_ascii=False, indent=None if dense else 1) + "\n")


if __name__ == "__main__":
    main(sys.argv[1:])
