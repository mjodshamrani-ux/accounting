"""Independent oracle for the proposed allocation-advice-review-1 (ALL-1).

Reads each story's three files from its own bytes, CSV with Python's csv
module and XLSX with zipfile and ElementTree, applies the reading rules of
allocation-snapshot-1 as contract.json states them, replays the accountant's
decisions from <id>-input.json, and then reviews every advice line. It never
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

FAMILY = "allocation-snapshot-1"
REVIEW = "allocation-advice-review-1"
META = ["Entity", "Ledger", "Party", "Account", "Currency", "Snapshot date", "Allocation basis"]
FIELDS = ["entity", "ledger", "party", "account", "currency", "cutoff", "basis"]
HEADERS = [
    ["Payment ID", "Payment date", *META, "Original amount", "Available amount"],
    ["Invoice ID", "Invoice date", *META, "Original amount", "Available amount"],
    ["Advice line ID", *META, "Payment ID", "Invoice ID", "Allocation amount"],
]
ROLES = ["available-payments", "open-invoices", "proposed-remittance"]
PLACES = {"SAR": 2, "AED": 2, "USD": 2, "EUR": 2, "KWD": 3, "BHD": 3, "OMR": 3, "JPY": 0}
LIMIT = 20030
REASONS = ["OVER_PAYMENT", "OVER_INVOICE", "COMPETES_PAYMENT", "COMPETES_INVOICE", "TWIN"]
MAIN = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
RELS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"


class Refused(Exception):
    pass


class RowError(Exception):
    pass


def digits(s):
    out = []
    for c in s:
        if "\u0660" <= c <= "\u0669":
            out.append(chr(ord(c) - 0x660 + 48))
        elif "\u06f0" <= c <= "\u06f9":
            out.append(chr(ord(c) - 0x6F0 + 48))
        elif c in "\u200e\u200f\u061c":
            continue
        else:
            out.append(c)
    return "".join(out)


def hidden_char(s):
    return any(unicodedata.category(c) in ("Cc", "Cf") for c in s)


def text(v, limit=500, fail=RowError):
    if not isinstance(v, str) or not v.strip() or v != v.strip() or len(v) > limit or hidden_char(v):
        raise fail("TEXT")
    return v


def identity(v, fail=RowError):
    s = text(v, fail=fail)
    if s[0] in "=+@-" or re.match(r"#(?:REF!|VALUE!|N/A|DIV/0!)", s, re.I):
        raise fail("IDENTITY")
    return s


def iso(v):
    if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", v):
        return None
    try:
        return date.fromisoformat(v).isoformat()
    except ValueError:
        return None


def amount(raw, places):
    v = digits(raw.strip()).replace("\u066b", ".")
    m = re.fullmatch(r"([0-9]+)(?:\.([0-9]+))?", v)
    if not m or len(m.group(2) or "") > places:
        raise RowError("AMOUNT")
    n = int(m.group(1)) * 10 ** places + int((m.group(2) or "").ljust(places, "0") or "0")
    if n > 10 ** 14:
        raise RowError("AMOUNT")
    return n


def read_csv(raw):
    text_ = raw.decode("utf-8")
    if text_.startswith("\ufeff"):
        text_ = text_[1:]
    rows = list(csv.reader(io.StringIO(text_, newline="")))
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
    cells, hidden, width, height = {}, set(), 0, 0
    for row in sheet.iter(MAIN + "row"):
        r = int(row.get("r"))
        height = max(height, r)
        if row.get("hidden") in ("1", "true"):
            hidden.add(r)
        for c in row.findall(MAIN + "c"):
            col = 0
            for ch in re.match(r"[A-Z]+", c.get("r")).group(0):
                col = col * 26 + ord(ch) - 64
            width = max(width, col)
            if c.find(MAIN + "f") is not None:
                raise Refused("FORMULA_NOT_IN_STORIES")
            kind, v = c.get("t"), c.find(MAIN + "v")
            if kind == "s":
                cells[(r, col)] = strings[int(v.text)]
            elif kind == "inlineStr":
                cells[(r, col)] = "".join(t.text or "" for t in c.iter(MAIN + "t"))
            elif v is not None:
                cells[(r, col)] = v.text or ""
    if height > LIMIT:
        raise Refused("SOURCE")
    rows = [[cells.get((r, c), "") for c in range(1, width + 1)] for r in range(1, height + 1)]
    return rows, hidden


def read_side(path, side, scope, places):
    if not re.search(r"\.(csv|xlsx)$", path.name, re.I):
        raise Refused("SOURCE")
    raw = path.read_bytes()
    try:
        rows, hidden = read_xlsx(raw) if path.name.lower().endswith(".xlsx") else read_csv(raw)
    except UnicodeDecodeError:
        raise Refused("SOURCE")
    if not rows or 1 in hidden:
        raise Refused("COLUMNS")
    want = HEADERS[side]
    head = [h.strip() for h in rows[0]]
    if len(head) != len(want) or len(set(head)) != len(head) or any(h not in head for h in want):
        raise Refused("COLUMNS")
    col = {h: head.index(h) for h in want}
    entries, errors, blank = [], [], []
    for r, values in enumerate(rows[1:], start=2):
        try:
            if r in hidden:
                raise RowError("CELL")
            if not any(v.strip() for v in values):
                blank.append(r)
                continue
            if any(v.strip() for v in values[len(want):]):
                raise RowError("COLUMNS")
            get = lambda h: (values[col[h]] if col[h] < len(values) else "").strip()  # noqa: E731
            for k, h in zip(FIELDS, META):
                if get(h) != scope[k]:
                    raise RowError("ROW_SCOPE")
            if side == 2:
                e = {"row": r, "reference": identity(get("Advice line ID")), "payment": identity(get("Payment ID")),
                     "invoice": identity(get("Invoice ID")), "amount": amount(get("Allocation amount"), places)}
                if e["amount"] <= 0:
                    raise RowError("AMOUNT")
            else:
                ref = identity(get("Invoice ID" if side else "Payment ID"))
                when = iso(get("Invoice date" if side else "Payment date"))
                if when is None or when > scope["cutoff"]:
                    raise RowError("DATE")
                original, available = amount(get("Original amount"), places), amount(get("Available amount"), places)
                if original <= 0 or available > original:
                    raise RowError("CAPACITY")
                e = {"row": r, "reference": ref, "available": available}
            entries.append(e)
        except RowError as x:
            errors.append([r, str(x)])
    count = {}
    for e in entries:
        count[e["reference"]] = count.get(e["reference"], 0) + 1
    kept = []
    for e in entries:
        if count[e["reference"]] > 1:
            errors.append([e["row"], "DUPLICATE"])
        else:
            kept.append(e)
    return kept, errors, blank


def check_scope(scope):
    if set(scope) != {*FIELDS, "confirmed"} or scope["confirmed"] is not True:
        raise Refused("SCOPE")
    for k in FIELDS:
        identity(scope[k], fail=Refused)
    if scope["currency"] not in PLACES or scope["basis"] != "before-proposed-allocation" or iso(scope["cutoff"]) is None:
        raise Refused("SCOPE")
    return PLACES[scope["currency"]]


def context(hashes, readings, scope):
    return json.dumps([FAMILY, hashes, [[r["sheet"], r["role"], r["family"], r["confirmed"]] for r in readings],
                       [scope[k] for k in FIELDS], scope["confirmed"]], ensure_ascii=False, separators=(",", ":"))


def replay(given, hashes, items, proofs):
    """The family's decision ledger: every active link and the proofs used."""
    ctx = context(hashes, given["readings"], given["scope"])
    by_id = {f"{s}:{hashes[s]}:0:{e['row']}": (s, e) for s in (0, 1) for e in items[s]}
    proof_by_id = {f"2:{hashes[2]}:0:{p['row']}": p for p in proofs}
    active, seen = {}, set()
    for e in given["events"]:
        keys = {"id", "context", "at", "note", "type", "links" if e.get("type") == "allocate" else "target"}
        if set(e) != keys or e["context"] != ctx or e["id"] in seen:
            raise Refused("EVENT")
        identity(e["id"], fail=Refused)
        text(e["note"], 2000, fail=Refused)
        if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z", e["at"]):
            raise Refused("EVENT_TIME")
        seen.add(e["id"])
        if e["type"] == "undo":
            if e["target"] not in active:
                raise Refused("UNDO")
            del active[e["target"]]
            continue
        if not 1 <= len(e["links"]) <= 100:
            raise Refused("LINKS")
        used, proofs_used = {}, set()
        for links in active.values():
            for side_ids, m, proof in links:
                for x in side_ids:
                    used[x] = used.get(x, 0) + m
                if proof:
                    proofs_used.add(proof)
        mine = []
        for link in e["links"]:
            m = link["amount"]
            if not isinstance(m, int) or m <= 0 or m > 10 ** 14:
                raise Refused("LINK")
            pay, inv = by_id.get(link["paymentId"]), by_id.get(link["invoiceId"])
            if not pay or pay[0] != 0 or not inv or inv[0] != 1:
                raise Refused("MEMBER")
            b = link["basis"]
            if b["kind"] == "remittance":
                p = proof_by_id.get(b["proofId"])
                if (not p or p["reference"] != b["reference"] or p["payment"] != pay[1]["reference"]
                        or p["invoice"] != inv[1]["reference"] or p["amount"] != m or b["proofId"] in proofs_used):
                    raise Refused("PROOF")
                proofs_used.add(b["proofId"])
            elif b["proofId"] != "":
                raise Refused("BASIS")
            for x, (_, it) in ((link["paymentId"], pay), (link["invoiceId"], inv)):
                if used.get(x, 0) + m > it["available"]:
                    raise Refused("OVER_AVAILABLE")
                used[x] = used.get(x, 0) + m
            mine.append(((link["paymentId"], link["invoiceId"]), m,
                         b["proofId"] if b["kind"] == "remittance" else None))
        active[e["id"]] = mine
    allocated, used_proofs = {}, set()
    for links in active.values():
        for side_ids, m, proof in links:
            for x in side_ids:
                allocated[x] = allocated.get(x, 0) + m
            if proof:
                used_proofs.add(proof)
    return allocated, used_proofs


def review(items, proofs, allocated, used_proofs, hashes):
    key = lambda s, e: f"{s}:{hashes[s]}:0:{e['row']}"  # noqa: E731
    remaining = {(s, e["reference"]): e["available"] - allocated.get(key(s, e), 0) for s in (0, 1) for e in items[s]}
    pid = lambda p: f"2:{hashes[2]}:0:{p['row']}"  # noqa: E731
    open_ = [p for p in proofs if pid(p) not in used_proofs]
    advised, naming = {}, {}
    for p in open_:
        for k in ((0, p["payment"]), (1, p["invoice"])):
            advised[k] = advised.get(k, 0) + p["amount"]
            naming.setdefault(k, []).append(p["row"])
    twin_key = lambda p: (p["payment"], p["invoice"], p["amount"])  # noqa: E731
    same = {}
    for p in proofs:
        same.setdefault(twin_key(p), []).append(p["row"])
    lines = []
    for p in proofs:
        twins = sorted(r for r in same.get(twin_key(p), []) if r != p["row"])
        pay, inv = (0, p["payment"]), (1, p["invoice"])
        if pid(p) in used_proofs:
            lines.append({"row": p["row"], "reference": p["reference"], "payment": p["payment"],
                          "invoice": p["invoice"], "amount": p["amount"], "status": "allocated", "reasons": [],
                          "competitors": [], "twins": twins})
            continue
        reasons, competitors = [], set()
        room = [remaining.get(pay, 0), remaining.get(inv, 0)]
        over = [p["amount"] > room[0], p["amount"] > room[1]]
        crowded = [advised[pay] > room[0], advised[inv] > room[1]]
        if over[0]:
            reasons.append("OVER_PAYMENT")
        if over[1]:
            reasons.append("OVER_INVOICE")
        if crowded[0] and not over[0]:
            reasons.append("COMPETES_PAYMENT")
        if crowded[1] and not over[1]:
            reasons.append("COMPETES_INVOICE")
        if twins:
            reasons.append("TWIN")
        for k, c in ((pay, crowded[0]), (inv, crowded[1])):
            if c:
                competitors |= {r for r in naming[k] if r != p["row"]}
        lines.append({"row": p["row"], "reference": p["reference"], "payment": p["payment"], "invoice": p["invoice"],
                      "amount": p["amount"], "status": "review" if reasons else "fits", "reasons": reasons,
                      "competitors": sorted(competitors), "twins": twins})
    out_items = []
    for s in (0, 1):
        for e in items[s]:
            k = (s, e["reference"])
            a = allocated.get(key(s, e), 0)
            out_items.append({"side": s, "row": e["row"], "reference": e["reference"], "available": e["available"],
                              "allocated": a, "remaining": remaining[k], "advised": advised.get(k, 0),
                              "excess": max(0, advised.get(k, 0) - remaining[k])})
    return lines, out_items


def judge(folder, sid):
    folder = Path(folder)
    given = json.loads((folder / f"{sid}-input.json").read_text(encoding="utf-8"))
    paths = [folder / n for n in given["names"]]
    hashes = [hashlib.sha256(p.read_bytes()).hexdigest() for p in paths]
    out = {"refused": None, "decimals": None, "lines": [], "items": [], "sha256": hashes}
    try:
        if given["readings"] != [{"sheet": 0, "role": r, "family": FAMILY, "confirmed": True} for r in ROLES]:
            raise Refused("READING")
        places = check_scope(given["scope"])
        out["decimals"] = places
        read = [read_side(paths[s], s, given["scope"], places) for s in range(3)]
        items = [read[0][0], read[1][0]]
        refs = [{e["reference"] for e in items[s]} for s in (0, 1)]
        proofs, errors = [], [e for r in read for e in r[1]]
        for p in read[2][0]:
            if p["payment"] in refs[0] and p["invoice"] in refs[1]:
                proofs.append(p)
            else:
                errors.append([p["row"], "PROOF_MEMBER"])
        if errors:
            raise Refused("SOURCE_ERRORS")
        allocated, used_proofs = replay(given, hashes, items, proofs)
        out["lines"], out["items"] = review(items, proofs, allocated, used_proofs, hashes)
    except Refused as x:
        out.update(refused=str(x), lines=[], items=[])
    return out


def run(folder):
    folder = Path(folder)
    ids = sorted(p.name[: -len("-input.json")] for p in folder.glob("*-input.json"))
    return {"schema": "tarasuf-all1-advice-expected/1", "review": REVIEW, "stories": {s: judge(folder, s) for s in ids}}


if __name__ == "__main__":
    args = sys.argv[1:]
    folder = args[1] if args[:1] == ["--dense"] else args[0]
    sys.stdout.write(json.dumps(run(folder), ensure_ascii=False, indent=1) + "\n")
