"""Independent oracle for the proposed fixed-assets-sections-1 (FA-1).

Reads each story's three files from their own bytes with a comma tokenizer
written here, applies the reading rules of contract.json, splits the register
into sections, places each category's components through the map, and judges
every account against the GL. It never reads stories.json, so it cannot see
the intent.

    python3 -B oracle.py frozen            # EXPECTED.json for the focused stories
    python3 -B oracle.py --dense DIR       # the same for the dense stories
"""
import hashlib
import json
import re
import sys
import unicodedata
from datetime import date
from pathlib import Path

FAMILY = "fixed-assets-sections-1"
ROLES = ["register-sections", "category-map", "gl-balances"]
LABELS = ["Entity", "Asset ledger", "Currency", "As of", "Location", "Category"]
COLUMNS = ["Asset ID", "Asset dimensions", "Component", "Amount", "Valuation reference"]
MAP_HEADER = ["Category", "Component", "GL account", "GL dimensions", "Account class", "Valid from", "Valid to"]
GL_HEADER = ["GL account", "GL dimensions", "Account class", "Debit", "Credit", "Entity", "GL ledger", "Currency",
             "As of"]
FOUR = ["cost", "depreciation", "impairment", "carrying"]
THREE = ["cost", "depreciation", "impairment"]
CLASS = {"cost": "fixed-asset-cost", "depreciation": "accumulated-depreciation",
         "impairment": "accumulated-impairment"}
COMPONENT_OF = {v: k for k, v in CLASS.items()}
PLACES = {"SAR": 2, "AED": 2, "USD": 2, "EUR": 2, "KWD": 3, "BHD": 3, "OMR": 3, "JPY": 0}
SCOPE_FIELDS = ["entity", "assetLedger", "glLedger", "currency", "asOf"]
SECTION_SCOPE = [("Entity", "entity"), ("Asset ledger", "assetLedger"), ("Currency", "currency"), ("As of", "asOf")]
GL_SCOPE = [("Entity", "entity"), ("GL ledger", "glLedger"), ("Currency", "currency"), ("As of", "asOf")]
MAX_BYTES, MAX_RECORDS, MAX_CELLS, MAX_UNITS = 8 * 1024 * 1024, 20001, 100, 32767
BOUND, SAFE = 10 ** 14, 2 ** 53 - 1
FORBIDDEN = set(range(0x00, 0x09)) | {0x0B, 0x0C} | set(range(0x0E, 0x20)) | {0xFFFE, 0xFFFF}
RUN_CODES = ["STRAY_ROW", "SECTION_UNREADABLE", "MAP_UNREADABLE", "GL_UNREADABLE"]


class Refused(Exception):
    pass


def units(s):
    return sum(2 if ord(c) > 0xFFFF else 1 for c in s)


def tokenize(raw):
    """Records of cells by the contract's comma grammar; a refusal on anything else."""
    if not raw:
        raise Refused("SOURCE")
    if len(raw) > MAX_BYTES:
        raise Refused("CAPACITY")
    try:
        text = raw.decode("utf-8", errors="strict")
    except UnicodeDecodeError:
        raise Refused("SOURCE") from None
    if text[:1] == "\ufeff":
        text = text[1:]
    if any(ord(c) in FORBIDDEN for c in text):
        raise Refused("SOURCE")
    records, cells, buf = [], [], []
    state = "start"  # start of a cell, in a plain cell, in quotes, after a closing quote
    started = False  # the record has a character
    width = 0

    def cell_add(ch):
        nonlocal width
        width += units(ch)
        if width > MAX_UNITS:
            raise Refused("CAPACITY")
        buf.append(ch)

    def end_cell():
        nonlocal width
        cells.append("".join(buf))
        buf.clear()
        width = 0

    def end_record():
        nonlocal cells, started, state
        if len(records) == MAX_RECORDS:
            raise Refused("CAPACITY")
        if started:
            end_cell()
            records.append(cells)
        else:
            records.append([])
        cells, started, state = [], False, "start"

    i, n = 0, len(text)
    while i < n:
        ch = text[i]
        if state == "quoted":
            if ch == '"':
                if i + 1 < n and text[i + 1] == '"':
                    cell_add('"')
                    i += 2
                    continue
                state = "closed"
            else:
                cell_add(ch)
            i += 1
            continue
        if ch == '"':
            if state != "start":
                raise Refused("SOURCE")
            state, started = "quoted", True
        elif ch == ",":
            if len(cells) == MAX_CELLS - 1:
                raise Refused("CAPACITY")
            end_cell()
            state, started = "start", True
        elif ch in "\r\n":
            end_record()
            if ch == "\r" and i + 1 < n and text[i + 1] == "\n":
                i += 1
        else:
            if state == "closed":
                raise Refused("SOURCE")
            cell_add(ch)
            state, started = "plain", True
        i += 1
    if state == "quoted":
        raise Refused("SOURCE")
    if started:
        end_record()
    return records


def meaningful(cells):
    k = len(cells)
    while k and cells[k - 1] == "":
        k -= 1
    return cells[:k]


def blank(cells):
    return all(c == "" for c in cells)


def first(cells):
    return cells[0] if cells else None


def readable(v):
    if not isinstance(v, str) or not v or units(v) > 500:
        return False
    if any(unicodedata.category(c) in ("Cc", "Cf") for c in v):
        return False
    edge = lambda c: unicodedata.category(c) == "Zs" or c in "\u2028\u2029"  # noqa: E731
    if edge(v[0]) or edge(v[-1]) or v[0] in "=+@-":
        return False
    return not re.match(r"#(?:REF!|VALUE!|N/A|DIV/0!)", v, re.IGNORECASE)


def real_date(v):
    if not isinstance(v, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", v):
        return None
    try:
        return date.fromisoformat(v).isoformat()
    except ValueError:
        return None


def amount(v, places):
    if not isinstance(v, str):
        return None
    m = re.fullmatch(r"([0-9]+)(?:\.([0-9]+))?", v)
    if not m or len(m.group(2) or "") > places:
        return None
    n = int(m.group(1)) * 10 ** places + int((m.group(2) or "").ljust(places, "0") or "0")
    return n if n <= BOUND else None


def safe(n):
    if abs(n) > SAFE:
        raise Refused("TOTAL_LIMIT")
    return n


def check_input(given):
    readings = given.get("readings")
    if not isinstance(readings, list) or len(readings) != 3:
        raise Refused("READING")
    for i, r in enumerate(readings):
        if not isinstance(r, dict) or sorted(r) != ["confirmed", "family", "role", "sheet"] or r["sheet"] != 0 \
                or r["role"] != ROLES[i] or r["family"] != FAMILY or r["confirmed"] is not True:
            raise Refused("READING")
    scope = given.get("scope")
    if not isinstance(scope, dict) or sorted(scope) != sorted(SCOPE_FIELDS + ["confirmed"]) \
            or scope["confirmed"] is not True or not all(readable(scope[k]) for k in SCOPE_FIELDS) \
            or scope["currency"] not in PLACES or real_date(scope["asOf"]) is None:
        raise Refused("SCOPE")
    return scope


def flat_header(records, header):
    head = meaningful(records[0]) if records else []
    if len(head) != len(header) or set(head) != set(header):
        raise Refused("COLUMNS")
    return {h: i for i, h in enumerate(head)}


def get(cells, pos, name):
    p = pos[name]
    return cells[p] if p < len(cells) else None


# ---------------------------------------------------------------- register

def split_register(records):
    """Sections with their record numbers, and each record's kind."""
    kinds, sections = [None] * len(records), []
    i = 0
    while i < len(records):
        if first(records[i]) == "Section":
            j = i + 1
            while j < len(records) and first(records[j]) not in ("Section", "End section"):
                j += 1
            end = j if j < len(records) and first(records[j]) == "End section" else None
            sections.append({"start": i, "end": end, "body": list(range(i + 1, j))})
            kinds[i] = "section"
            if end is not None:
                kinds[end] = "end"
            i = j + 1 if end is not None else j
        else:
            kinds[i] = "blank" if blank(records[i]) else "stray"
            i += 1
    return sections, kinds


def read_section(sec, records, kinds, scope):
    head = records[sec["start"]]
    sid = head[1] if len(head) > 1 else None
    body = [k for k in sec["body"] if not blank(records[k])]
    for k in sec["body"]:
        if blank(records[k]):
            kinds[k] = "blank"
    column = next((k for k in body if len(meaningful(records[k])) > 2), None)
    label_rows = [k for k in body if column is None or k < column]
    after = [k for k in body if column is not None and k > column]
    for k in label_rows:
        kinds[k] = "label"
    if column is not None:
        kinds[column] = "columns"
    for k in after:
        kinds[k] = "total" if first(records[k]) == "Section total" else "record"
    labels = {}
    for k in label_rows:
        m = meaningful(records[k])
        if len(m) == 2 and m[0] in LABELS:
            labels.setdefault(m[0], []).append(m[1])
    once = {lab: vals[0] for lab, vals in labels.items() if len(vals) == 1 and readable(vals[0])}
    sec.update({"row": sec["start"] + 1, "endRow": None if sec["end"] is None else sec["end"] + 1, "id": sid,
                "location": once.get("Location"), "category": once.get("Category"), "column": column,
                "after": after, "codes": []})
    closed = sec["end"] is not None and meaningful(records[sec["end"]]) == ["End section", sid if sid else ""]
    header_ok = (len(meaningful(head)) == 2 and readable(sid)
                 and all(len(meaningful(records[k])) == 2 and meaningful(records[k])[0] in LABELS
                         for k in label_rows)
                 and all(len(labels.get(lab, [])) == 1 and readable(labels[lab][0]) for lab in LABELS)
                 and real_date(labels["As of"][0]) is not None)
    if "Category" not in once:
        sec["code"] = "SECTION_UNREADABLE"
    elif not closed:
        sec["code"] = "SECTION_UNCLOSED"
    elif not header_ok:
        sec["code"] = "SECTION_HEADER"
    elif any(once[lab] != scope[key] for lab, key in SECTION_SCOPE):
        sec["code"] = "SECTION_SCOPE"
    elif column is None or (lambda m: len(m) != 5 or set(m) != set(COLUMNS))(meaningful(records[column])):
        sec["code"] = "SECTION_COLUMNS"
    else:
        sec["code"] = None
    if sec["code"]:
        sec["codes"] = [sec["code"]]


def judge_records(sec, records, places, unplaced):
    pos = {h: i for i, h in enumerate(meaningful(records[sec["column"]]))}
    assets, rows, totals = {}, [], []
    for k in sec["after"]:
        cells = records[k]
        if first(cells) == "Section total":
            totals.append(k)
            continue
        aid, dims = get(cells, pos, "Asset ID"), get(cells, pos, "Asset dimensions")
        comp, text, val = get(cells, pos, "Component"), get(cells, pos, "Amount"), get(cells, pos, "Valuation reference")
        minor = amount(text, places)
        rows.append({"row": k + 1, "comp": comp, "minor": minor, "amountReads": minor is not None})
        if not readable(aid) or not readable(dims):
            unplaced.append(["register-sections", k + 1, "ROW_UNPLACED"])
            sec["codes"].append("ROW_UNPLACED")
            continue
        a = assets.setdefault((aid, dims), {"id": aid, "dims": dims, "codes": set(), "rows": {c: [] for c in FOUR},
                                            "minor": {c: [] for c in FOUR}, "unread": [], "vals": set()})
        if len(meaningful(cells)) > 5:
            a["codes"].add("CELLS")
        if comp in FOUR:
            a["rows"][comp].append(k + 1)
            a["minor"][comp].append(minor)
        else:
            a["codes"].add("COMPONENT")
            a["unread"].append(k + 1)
        if minor is None:
            a["codes"].add("AMOUNT")
        if readable(val):
            a["vals"].add(val)
        else:
            a["codes"].add("TEXT")
    for a in assets.values():
        counts = {c: len(a["rows"][c]) for c in FOUR}
        if any(v == 0 for v in counts.values()):
            a["codes"].add("COMPONENT_MISSING")
        if any(v > 1 for v in counts.values()):
            a["codes"].add("COMPONENT_REPEATED")
        if len(a["vals"]) > 1:
            a["codes"].add("VALUATION")
        once = {c: a["minor"][c][0] for c in FOUR if counts[c] == 1}
        if len(once) == 4 and all(v is not None for v in once.values()) \
                and once["cost"] - once["depreciation"] - once["impairment"] != once["carrying"]:
            a["codes"].add("CARRYING")
        a["amount"] = {c: once.get(c) for c in FOUR}
    seen, field = {}, False
    for k in totals:
        m = meaningful(records[k])
        if len(m) != 3 or m[1] not in FOUR or amount(m[2], places) is None or m[1] in seen:
            field = True
            if len(m) >= 2 and m[1] in FOUR:
                seen[m[1]] = None
            continue
        seen[m[1]] = amount(m[2], places)
    for c, total in seen.items():
        if total is None:
            continue
        if any(r["comp"] not in FOUR for r in rows) or any(r["comp"] == c and not r["amountReads"] for r in rows):
            field = True
            continue
        if safe(sum(r["minor"] for r in rows if r["comp"] == c)) != total:
            sec["codes"].append("TOTAL_MISMATCH")
    if field:
        sec["codes"].append("TOTAL_FIELD")
    sec["assets"] = assets


# ---------------------------------------------------------------- review

def review(given, raws):
    scope = check_input(given)
    places = PLACES[scope["currency"]]
    files = []
    for name, raw in zip(given["names"], raws):
        if not isinstance(name, str) or not name.lower().endswith(".csv"):
            raise Refused("SOURCE")
        files.append(tokenize(raw))
    reg, mrows, grows = files
    mpos = flat_header(mrows, MAP_HEADER)
    gpos = flat_header(grows, GL_HEADER)
    run, unplaced = set(), []

    sections, kinds = split_register(reg)
    for k, kind in enumerate(kinds):
        if kind == "stray":
            run.add("STRAY_ROW")
            unplaced.append(["register-sections", k + 1, "STRAY_ROW"])
    for sec in sections:
        read_section(sec, reg, kinds, scope)
        if sec["code"] == "SECTION_UNREADABLE":
            run.add("SECTION_UNREADABLE")
            unplaced.append(["register-sections", sec["row"], "SECTION_UNREADABLE"])
    judged = [s for s in sections if s["code"] is None]
    ids = [s["id"] for s in judged]
    for s in judged:
        if ids.count(s["id"]) > 1:
            s["codes"].append("SECTION_DUPLICATE")
        judge_records(s, reg, places, unplaced)
    where = {}
    for n, s in enumerate(judged):
        for a in s["assets"].values():
            where.setdefault(a["id"], set()).add(n)
    for s in judged:
        for a in s["assets"].values():
            if len(where[a["id"]]) > 1:
                a["codes"].add("ID_SECTIONS")
    register_categories = {s["category"] for s in sections if s["code"] not in ("SECTION_SCOPE", "SECTION_UNREADABLE")}

    # map
    pairs = {}
    for k, cells in enumerate(mrows[1:], start=2):
        if blank(cells):
            continue
        cat, comp = get(cells, mpos, "Category"), get(cells, mpos, "Component")
        if not readable(cat) or comp not in THREE:
            run.add("MAP_UNREADABLE")
            unplaced.append(["category-map", k, "MAP_UNREADABLE"])
            continue
        codes = set()
        if get(cells, mpos, "Account class") != CLASS[comp]:
            codes.add("MAP_CLASS")
        acct, dims = get(cells, mpos, "GL account"), get(cells, mpos, "GL dimensions")
        frm, to = real_date(get(cells, mpos, "Valid from")), real_date(get(cells, mpos, "Valid to"))
        if not readable(acct) or not readable(dims) or frm is None or to is None or frm > to \
                or len(meaningful(cells)) > 7:
            codes.add("MAP_ROW")
        pairs.setdefault((cat, comp), []).append({"codes": codes, "key": (acct, dims), "from": frm, "to": to})
    placed, unplaced_pairs = {}, {}
    for pair, rows in pairs.items():
        bad = set().union(*(r["codes"] for r in rows))
        if bad:
            unplaced_pairs[pair] = bad
            continue
        valid = [r for r in rows if r["from"] <= scope["asOf"] <= r["to"]]
        if len(valid) == 1:
            placed[pair] = valid[0]["key"]
        else:
            unplaced_pairs[pair] = {"MAP_EXPIRED" if not valid else "MAP_REPEATED"}
    for cat in register_categories:
        for comp in THREE:
            if (cat, comp) not in pairs:
                unplaced_pairs[(cat, comp)] = {"MAP_ABSENT"}
    unplaced_pairs = {p: c for p, c in unplaced_pairs.items() if p[0] in register_categories}

    # GL
    gl = {}
    for k, cells in enumerate(grows[1:], start=2):
        if blank(cells):
            continue
        acct, dims = get(cells, gpos, "GL account"), get(cells, gpos, "GL dimensions")
        if not readable(acct) or not readable(dims):
            run.add("GL_UNREADABLE")
            unplaced.append(["gl-balances", k, "GL_UNREADABLE"])
            continue
        cls = get(cells, gpos, "Account class")
        debit, credit = amount(get(cells, gpos, "Debit"), places), amount(get(cells, gpos, "Credit"), places)
        codes = set()
        if cls not in COMPONENT_OF or debit is None or credit is None or len(meaningful(cells)) > 9:
            codes.add("GL_ROW")
        if any(get(cells, gpos, h) != scope[key] for h, key in GL_SCOPE):
            codes.add("GL_SCOPE")
        gl.setdefault((acct, dims), []).append({"row": k, "cls": cls, "debit": debit, "credit": credit,
                                                "codes": codes})

    # accounts
    keys = set(placed.values()) | set(gl)
    held_sections = [s for s in sections if s["codes"] and s["code"] not in ("SECTION_SCOPE", "SECTION_UNREADABLE")]
    held_assets = [(s, a) for s in judged for a in s["assets"].values() if a["codes"]]
    accounts = []
    for key in sorted(keys):
        on = [pair for pair, k in placed.items() if k == key]
        comps = {comp for _, comp in on}
        rows = gl.get(key, [])
        codes = set(run)
        component = None
        if len(comps) == 1:
            component = next(iter(comps))
        elif comps:
            codes.add("ACCOUNT_COMPONENTS")
        elif len(rows) == 1 and rows[0]["cls"] in COMPONENT_OF:
            component = COMPONENT_OF[rows[0]["cls"]]
        cats = {cat for cat, _ in on}
        for s in held_sections:
            if s["category"] in cats:
                codes.update(s["codes"])
        for s, a in held_assets:
            if s["category"] in cats:
                codes.update(a["codes"])
        for (cat, comp), c in unplaced_pairs.items():
            if comp == component:
                codes.update(c)
        for r in rows:
            codes.update(r["codes"])
        if len(rows) > 1:
            codes.add("GL_REPEATED")
        if on and component and len(rows) == 1 and rows[0]["cls"] in COMPONENT_OF \
                and rows[0]["cls"] != CLASS[component]:
            codes.add("CLASS_CONFLICT")
        members = sorted([s["id"], a["id"], a["dims"], comp] for s in judged for a in s["assets"].values()
                         for comp in THREE if placed.get((s["category"], comp)) == key)
        register = balance = difference = None
        if codes:
            status = "held"
        else:
            missing = set()
            if not on:
                missing.add("UNMAPPED")
            if not rows:
                missing.add("GL_ABSENT")
            if on and not members:
                missing.add("REGISTER_ABSENT")
            if members:
                amounts = {(s["id"], a["id"], a["dims"]): a["amount"] for s in judged for a in s["assets"].values()}
                register = safe(sum(amounts[(m[0], m[1], m[2])][m[3]] for m in members))
            if rows:
                r = rows[0]
                balance = r["debit"] - r["credit"] if component == "cost" else r["credit"] - r["debit"]
            if register is not None and balance is not None:
                difference = safe(register - balance)
            codes = missing
            status = "missing" if missing else ("difference" if difference else "consistent")
        accounts.append({"account": key[0], "dimensions": key[1], "component": component, "status": status,
                         "codes": sorted(codes), "register": register, "gl": balance, "difference": difference,
                         "glRow": rows[0]["row"] if len(rows) == 1 else None, "members": members})

    out_sections = []
    for s in sections:
        status = "excluded" if s["code"] == "SECTION_SCOPE" else ("held" if s["codes"] else "read")
        out_sections.append([s["row"], s["endRow"], s["id"], s["location"], s["category"], status,
                             sorted(set(s["codes"]))])
    out_assets = []
    for s in judged:
        for a in s["assets"].values():
            out_assets.append({"section": s["id"], "sectionRow": s["row"], "assetId": a["id"],
                               "dimensions": a["dims"], "location": s["location"], "category": s["category"],
                               "status": "held" if a["codes"] else "read", "codes": sorted(a["codes"]),
                               "amounts": a["amount"], "rows": a["rows"], "unread": a["unread"],
                               "valuation": next(iter(a["vals"])) if len(a["vals"]) == 1 else None})
    out_assets.sort(key=lambda a: (a["section"], a["assetId"], a["dimensions"], a["sectionRow"]))
    inventory = {"register": {k: kinds.count(k) for k in
                              ["blank", "section", "end", "stray", "label", "columns", "total", "record"]}}
    for name, rows in (("map", mrows), ("gl", grows)):
        inventory[name] = {"header": 1, "blank": sum(1 for r in rows[1:] if blank(r)),
                           "row": sum(1 for r in rows[1:] if not blank(r))}
    return {
        "refused": None,
        "decimals": places,
        "hashes": [hashlib.sha256(raw).hexdigest() for raw in raws],
        "run": sorted(run),
        "sections": out_sections,
        "assets": out_assets,
        "unmapped": sorted([cat, comp, code] for (cat, comp), c in unplaced_pairs.items() for code in c),
        "accounts": accounts,
        "unplaced": sorted(unplaced, key=lambda u: (ROLES.index(u[0]), u[1])),
        "inventory": inventory,
    }


def judge(folder, sid):
    given = json.loads((folder / f"{sid}-input.json").read_text(encoding="utf-8"))
    raws = [(folder / name).read_bytes() for name in given["names"]]
    try:
        return review(given, raws)
    except Refused as r:
        return {"refused": r.args[0], "decimals": None, "hashes": [], "run": [], "sections": [], "assets": [],
                "unmapped": [], "accounts": [], "unplaced": [], "inventory": None}


def main(argv):
    folder = Path(argv[1] if argv[:1] == ["--dense"] else argv[0])
    ids = sorted(p.name[:-len("-input.json")] for p in folder.glob("*-input.json"))
    print(json.dumps({"schema": "tarasuf-fa1-sections-expected/1", "family": FAMILY,
                      "stories": {sid: judge(folder, sid) for sid in ids}}, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main(sys.argv[1:])
