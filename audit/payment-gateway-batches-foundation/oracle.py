"""Independent oracle for the proposed payment-gateway-batches-1 (PG-1).

Reads each story's five files from their own bytes, CSV with Python's csv
module and XLSX with zipfile and ElementTree, applies the reading rules of
contract.json, and reviews every batch, payout and bank credit. It never
reads stories.json, so it cannot see the intent.

    python3 -B oracle.py frozen            # EXPECTED.json for the focused stories
    python3 -B oracle.py --dense DIR       # the same for the dense stories
"""
import csv
import hashlib
import io
import json
import re
import sys
import unicodedata
import zipfile
from datetime import date
from pathlib import Path
from xml.etree import ElementTree as ET

FAMILY = "payment-gateway-batches-1"
ROLES = ["transactions", "fee-evidence", "settlements", "payout-lines", "bank-credits"]
HEADERS = [
    ["Transaction ID", "Batch ID", "Kind", "Posting date", "Amount", "Reference", "Merchant account", "Currency"],
    ["Fee ID", "Batch ID", "Amount", "Reference", "Merchant account", "Currency"],
    ["Batch ID", "Settlement date", "Gross sales", "Refunds", "Fees", "Net", "Merchant account", "Currency"],
    ["Payout ID", "Batch ID", "Amount", "Merchant account", "Currency"],
    ["Bank reference", "Payout ID", "Value date", "Credit", "Bank account", "Currency"],
]
SCOPE_FIELDS = ["entity", "gateway", "merchantAccount", "bankAccount", "currency", "start", "end", "asOf"]
PLACES = {"SAR": 2, "AED": 2, "USD": 2, "EUR": 2, "KWD": 3, "BHD": 3, "OMR": 3, "JPY": 0}
LIMIT = 20030
MAIN = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
RELS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
KEY = {0: "Transaction ID", 1: "Fee ID", 2: "Batch ID", 4: "Bank reference"}


class Refused(Exception):
    pass


class RowError(Exception):
    pass


def latin_digits(s):
    out = []
    for c in s:
        if "\u0660" <= c <= "\u0669":
            out.append(chr(ord(c) - 0x660 + 48))
        elif "\u06f0" <= c <= "\u06f9":
            out.append(chr(ord(c) - 0x6F0 + 48))
        elif c == "\u066b":
            out.append(".")
        else:
            out.append(c)
    return "".join(out)


def controls(s):
    return any(unicodedata.category(c) in ("Cc", "Cf") for c in s)


def identity(v, fail=RowError):
    if not isinstance(v, str) or not v or v != v.strip() or len(v) > 500 or controls(v):
        raise fail("IDENTITY")
    if v[0] in "=+@-" or re.match(r"#(?:REF!|VALUE!|N/A|DIV/0!)", v, re.I):
        raise fail("IDENTITY")
    return v


def reference(v):
    if not v or v != v.strip() or len(v) > 2000 or controls(v):
        raise RowError("TEXT")
    return v


def calendar(v):
    if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", v):
        return None
    try:
        return date.fromisoformat(v).isoformat()
    except ValueError:
        return None


def day(v, low, high):
    d = calendar(v)
    if d is None:
        raise RowError("DATE")
    if d < low or d > high:
        raise RowError("PERIOD")
    return d


def amount(raw, places):
    v = latin_digits(raw)
    m = re.fullmatch(r"([0-9]+)(?:\.([0-9]+))?", v)
    if not m or len(m.group(2) or "") > places:
        raise RowError("AMOUNT")
    n = int(m.group(1)) * 10 ** places + int((m.group(2) or "").ljust(places, "0") or "0")
    if n > 10 ** 14:
        raise RowError("AMOUNT")
    return n


def read_csv(raw):
    text = raw.decode("utf-8")
    if text.startswith("\ufeff"):
        text = text[1:]
    rows = list(csv.reader(io.StringIO(text, newline="")))
    if len(rows) > LIMIT:
        raise Refused("ROWS")
    return rows, set()


def read_xlsx(raw):
    z = zipfile.ZipFile(io.BytesIO(raw))
    book = ET.fromstring(z.read("xl/workbook.xml"))
    first = book.find(f"{MAIN}sheets/{MAIN}sheet").get(f"{RELS}id")
    rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    target = next(r.get("Target") for r in rels if r.get("Id") == first)
    path = target.lstrip("/") if target.startswith("/") else "xl/" + target
    strings = []
    if "xl/sharedStrings.xml" in z.namelist():
        strings = ["".join(t.text or "" for t in si.iter(MAIN + "t"))
                   for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall(MAIN + "si")]
    sheet = ET.fromstring(z.read(path))
    cells, flagged, width, height = {}, set(), 0, 0
    for row in sheet.iter(MAIN + "row"):
        r = int(row.get("r"))
        height = max(height, r)
        if row.get("hidden") in ("1", "true"):
            flagged.add(r)
        for c in row.findall(MAIN + "c"):
            col = 0
            for ch in re.match(r"[A-Z]+", c.get("r")).group(0):
                col = col * 26 + ord(ch) - 64
            width = max(width, col)
            if c.find(MAIN + "f") is not None:
                flagged.add(r)
            kind, v = c.get("t"), c.find(MAIN + "v")
            if kind == "s":
                cells[(r, col)] = strings[int(v.text)]
            elif kind == "inlineStr":
                cells[(r, col)] = "".join(t.text or "" for t in c.iter(MAIN + "t"))
            elif v is not None:
                cells[(r, col)] = v.text or ""
    if height > LIMIT:
        raise Refused("ROWS")
    rows = [[cells.get((r, c), "") for c in range(1, width + 1)] for r in range(1, height + 1)]
    return rows, flagged


def read_side(path, side, scope, places):
    if not re.search(r"\.(csv|xlsx)$", path.name, re.I):
        raise Refused("SOURCE")
    raw = path.read_bytes()
    try:
        rows, flagged = read_xlsx(raw) if path.name.lower().endswith(".xlsx") else read_csv(raw)
    except (UnicodeDecodeError, zipfile.BadZipFile, KeyError, StopIteration, ET.ParseError):
        raise Refused("SOURCE")
    want = HEADERS[side]
    if not rows or 1 in flagged:
        raise Refused("COLUMNS")
    head = [h.strip() for h in rows[0]]
    while head and not head[-1]:
        head.pop()
    if len(head) != len(want) or len(set(head)) != len(head) or set(head) != set(want):
        raise Refused("COLUMNS")
    col = {h: head.index(h) for h in want}
    entries, errors = [], []
    for r, values in enumerate(rows[1:], start=2):
        try:
            if not any(v.strip() for v in values):
                if r in flagged:
                    raise RowError("CELL")
                continue
            if r in flagged:
                raise RowError("CELL")
            if any(v.strip() for v in values[len(head):]):
                raise RowError("COLUMNS")
            cell = lambda h: values[col[h]] if col[h] < len(values) else ""  # noqa: E731
            account = "Bank account" if side == 4 else "Merchant account"
            if cell(account).strip() != scope["bankAccount" if side == 4 else "merchantAccount"] \
                    or cell("Currency").strip() != scope["currency"]:
                raise RowError("ROW_SCOPE")
            e = {"row": r}
            if side == 0:
                e.update(id=identity(cell("Transaction ID")), batch=identity(cell("Batch ID")))
                if cell("Kind") not in ("sale", "refund"):
                    raise RowError("KIND")
                e["kind"] = cell("Kind")
                day(cell("Posting date"), scope["start"], scope["end"])
                e["amount"] = amount(cell("Amount").strip(), places)
                reference(cell("Reference"))
            elif side == 1:
                e.update(id=identity(cell("Fee ID")), batch=identity(cell("Batch ID")))
                e["amount"] = amount(cell("Amount").strip(), places)
                reference(cell("Reference"))
            elif side == 2:
                e.update(id=identity(cell("Batch ID")), batch=cell("Batch ID"))
                day(cell("Settlement date"), scope["start"], scope["end"])
                for h, k in (("Gross sales", "gross"), ("Refunds", "refunds"), ("Fees", "fees"), ("Net", "net")):
                    e[k] = amount(cell(h).strip(), places)
            elif side == 3:
                e.update(payout=identity(cell("Payout ID")), batch=identity(cell("Batch ID")))
                e["id"] = json.dumps([e["payout"], e["batch"]])
                e["amount"] = amount(cell("Amount").strip(), places)
            else:
                e.update(id=identity(cell("Bank reference")), payout=identity(cell("Payout ID")))
                e["valueDate"] = day(cell("Value date"), scope["start"], scope["asOf"])
                e["amount"] = amount(cell("Credit").strip(), places)
            entries.append(e)
        except RowError as x:
            errors.append([r, str(x)])
    keys = [("id",)] + ([("payout",)] if side == 4 else [])
    bad = set()
    for key in keys:
        count = {}
        for e in entries:
            count[e[key[0]]] = count.get(e[key[0]], 0) + 1
        bad |= {e["row"] for e in entries if count[e[key[0]]] > 1}
    for r in sorted(bad):
        errors.append([r, "DUPLICATE"])
    return [e for e in entries if e["row"] not in bad], errors


def check_scope(scope):
    if not isinstance(scope, dict) or set(scope) != {*SCOPE_FIELDS, "confirmed"} or scope["confirmed"] is not True:
        raise Refused("SCOPE")
    for k in SCOPE_FIELDS:
        identity(scope[k], fail=Refused)
    if scope["currency"] not in PLACES:
        raise Refused("SCOPE")
    days = [calendar(scope[k]) for k in ("start", "end", "asOf")]
    if None in days or not days[0] <= days[1] <= days[2]:
        raise Refused("SCOPE")
    return PLACES[scope["currency"]]


def review(read, end):
    tx, fees, settlements, lines, credits = read
    by_payout_credit = {c["payout"]: c for c in credits}
    payouts, order = {}, []
    for ln in lines:
        if ln["payout"] not in payouts:
            payouts[ln["payout"]] = []
            order.append(ln["payout"])
        payouts[ln["payout"]].append(ln)
    out_payouts, payout_status = [], {}
    for p in order:
        mine = payouts[p]
        total = sum(ln["amount"] for ln in mine)
        c = by_payout_credit.get(p)
        reasons = []
        if c is None:
            reasons.append("NOT_DEPOSITED")
        elif c["amount"] != total:
            reasons.append("CREDIT")
        status = "review" if reasons else "in-transit" if c["valueDate"] > end else "consistent"
        payout_status[p] = status
        out_payouts.append({"payout": p, "lines": [ln["row"] for ln in mine], "batches": [ln["batch"] for ln in mine],
                            "amount": total,
                            "credit": None if c is None else {"row": c["row"], "valueDate": c["valueDate"],
                                                               "amount": c["amount"]},
                            "status": status, "reasons": reasons})
    out_batches = []
    for s in settlements:
        b = s["id"]
        sales = [t for t in tx if t["batch"] == b and t["kind"] == "sale"]
        refunds = [t for t in tx if t["batch"] == b and t["kind"] == "refund"]
        mine_fees = [f for f in fees if f["batch"] == b]
        mine_lines = [ln for ln in lines if ln["batch"] == b]
        comp = {"sales": sum(t["amount"] for t in sales), "refunds": sum(t["amount"] for t in refunds),
                "fees": sum(f["amount"] for f in mine_fees)}
        paid = sum(ln["amount"] for ln in mine_lines)
        its = []
        for ln in mine_lines:
            if ln["payout"] not in its:
                its.append(ln["payout"])
        reasons = []
        if comp["sales"] != s["gross"]:
            reasons.append("SALES")
        if comp["refunds"] != s["refunds"]:
            reasons.append("REFUNDS")
        if comp["fees"] != s["fees"]:
            reasons.append("FEES")
        if s["gross"] - s["refunds"] - s["fees"] != s["net"]:
            reasons.append("NET")
        if paid < s["net"]:
            reasons.append("PAID_SHORT")
        if paid > s["net"]:
            reasons.append("PAID_OVER")
        if any(payout_status[p] == "review" for p in its):
            reasons.append("PAYOUT")
        status = "review" if reasons else "in-transit" if any(payout_status[p] == "in-transit" for p in its) \
            else "consistent"
        out_batches.append({"row": s["row"], "batch": b, "sales": [t["row"] for t in sales],
                            "refunds": [t["row"] for t in refunds], "fees": [f["row"] for f in mine_fees],
                            "components": comp,
                            "settlement": {k: s[k] for k in ("gross", "refunds", "fees", "net")},
                            "paid": paid, "payouts": its, "status": status, "reasons": reasons})
    out_credits = [{"row": c["row"], "reference": c["id"], "payout": c["payout"], "valueDate": c["valueDate"],
                    "amount": c["amount"], "reasons": ["UNLINKED_CREDIT"]}
                   for c in credits if c["payout"] not in payouts]
    return out_batches, out_payouts, out_credits


def judge(folder, sid):
    folder = Path(folder)
    given = json.loads((folder / f"{sid}-input.json").read_text(encoding="utf-8"))
    paths = [folder / n for n in given["names"]]
    hashes = [hashlib.sha256(p.read_bytes()).hexdigest() for p in paths]
    out = {"refused": None, "decimals": None, "batches": [], "payouts": [], "credits": [], "sha256": hashes}
    try:
        if given["readings"] != [{"sheet": 0, "role": r, "family": FAMILY, "confirmed": True} for r in ROLES]:
            raise Refused("READING")
        places = check_scope(given["scope"])
        out["decimals"] = places
        read, errors = [], []
        for side in range(5):
            entries, errs = read_side(paths[side], side, given["scope"], places)
            read.append(entries)
            errors += errs
        batches = {s["id"] for s in read[2]}
        for side in (0, 1, 3):
            for e in read[side]:
                if e["batch"] not in batches:
                    errors.append([e["row"], "MEMBER"])
        if errors:
            raise Refused("SOURCE_ERRORS")
        out["batches"], out["payouts"], out["credits"] = review(read, given["scope"]["end"])
    except Refused as x:
        out.update(refused=str(x), batches=[], payouts=[], credits=[])
    return out


def run(folder):
    folder = Path(folder)
    ids = sorted(p.name[: -len("-input.json")] for p in folder.glob("*-input.json"))
    return {"schema": "tarasuf-pg1-batches-expected/1", "review": FAMILY, "stories": {s: judge(folder, s) for s in ids}}


if __name__ == "__main__":
    args = sys.argv[1:]
    folder = args[1] if args[:1] == ["--dense"] else args[0]
    sys.stdout.write(json.dumps(run(folder), ensure_ascii=False, indent=1) + "\n")
