"""FA-1 holdout H2 stories: a freight company's asset register by depot and
category, its category account map and its GL balances, under the proposed
fixed-assets-sections-1 contract as it is. A lineage of its own: nothing is
imported from the foundation's or H1's stories, writers or oracle.

Each story writes its three files as rows of cells, names a writer for each
file, and states its intent. The statuses and codes of every section, asset
and account, the pairs the map leaves unplaced, the rows that cannot be
placed and the run codes are written by hand; or the refusal of the whole
story. Unlike H1, the intent also carries what follows from the story's own
model of its rows, kept apart from the files: every asset's location,
category, section row, amounts by component, rows by component, unread rows
and valuation reference, and every account's component, register, GL and
difference amounts, GL row and members. The oracle reads the files; the
intent never does.

Synthetic only.

    python3 -B stories.py > frozen/stories.json
"""
import json
import sys

FAMILY = "fixed-assets-sections-1"
ROLES = ["register-sections", "category-map", "gl-balances"]
KINDS = ["register", "map", "gl"]
LABELS = ["Entity", "Asset ledger", "Currency", "As of", "Location", "Category"]
COLUMNS = ["Asset ID", "Asset dimensions", "Component", "Amount", "Valuation reference"]
MAP_HEADER = ["Category", "Component", "GL account", "GL dimensions", "Account class", "Valid from", "Valid to"]
GL_HEADER = ["GL account", "GL dimensions", "Account class", "Debit", "Credit", "Entity", "GL ledger", "Currency",
             "As of"]
FOUR = ["cost", "depreciation", "impairment", "carrying"]
THREE = ["cost", "depreciation", "impairment"]
CLASS = {"cost": "fixed-asset-cost", "depreciation": "accumulated-depreciation",
         "impairment": "accumulated-impairment"}
COMPONENT_OF_CLASS = {v: k for k, v in CLASS.items()}
PLACES = {"SAR": 2, "AED": 2, "USD": 2, "EUR": 2, "KWD": 3, "BHD": 3, "OMR": 3, "JPY": 0}
WRITERS = ["ruby", "jq", "awk", "rust"]

ENTITY = "Synthetic Sohar Freight LLC"
FLT, RCK, RFR, TRK, SRV = "Forklifts", "Pallet racking", "Reefer units", "Delivery trucks", "Server room"
TRK_AR = "\u0634\u0627\u062d\u0646\u0627\u062a \u0627\u0644\u062a\u0648\u0635\u064a\u0644"
NIZWA_AR = "\u0645\u0633\u062a\u0648\u062f\u0639 \u0646\u0632\u0648\u0649"
SOHAR, MUSCAT, SALALAH = "Sohar port yard", "Muscat depot", "Salalah cold store"
# Category: the accounts of its three components and their GL dimensions.
ACCOUNTS = {
    FLT: ("1710", "1719", "1718", "LOG-FLT"),
    RCK: ("1720", "1729", "1728", "LOG-RCK"),
    RFR: ("1730", "1739", "1738", "LOG-RFR"),
    TRK: ("1740", "1749", "1748", "LOG-TRK"),
    SRV: ("1750", "1759", "1758", "LOG-IT"),
    TRK_AR: ("1760", "1769", "1768", "LOG-TRK"),
}


def account(category, component):
    a = ACCOUNTS[category]
    return a[THREE.index(component)], a[3]


def money(minor, places):
    if not places:
        return str(minor)
    sign = "-" if minor < 0 else ""
    minor = abs(minor)
    return f"{sign}{minor // 10 ** places}.{minor % 10 ** places:0{places}d}"


class Bad:
    """A cell the contract cannot read, written as given."""

    def __init__(self, text):
        self.text = text


class Asset:
    """An asset in minor units. Its rows are four [component, amount, valuation] by default; a story may give
    its own rows, where an amount is minor units or Bad text, a valuation is text or Bad text, and a row may
    carry more cells past the five columns."""

    def __init__(self, aid, dims, cost, dep, imp, carrying=None, valuation=None, rows=None, held=()):
        self.id, self.dims = aid, dims
        self.amounts = {"cost": cost, "depreciation": dep, "impairment": imp,
                        "carrying": cost - dep - imp if carrying is None else carrying}
        self.valuation = valuation
        self.rows = rows
        self.held = sorted(held)
        self.written = []  # [record number, component, amount or Bad, valuation or Bad]


class Story:
    def __init__(self, sid, title, writers, currency="OMR", as_of="2028-09-30", entity=ENTITY):
        self.id, self.title, self.writers = sid, title, writers
        self.places = PLACES.get(currency, 3)
        self.scope = {"entity": entity, "assetLedger": "FAR-LOG", "glLedger": "GL-LOG", "currency": currency,
                      "asOf": as_of, "confirmed": True}
        self.files = [[], [list(MAP_HEADER)], [list(GL_HEADER)]]
        self.kinds = [[], ["header"], ["header"]]
        self.sections = []
        self.placed = {}
        self.gl_written = {}
        self.gl_rows = {}
        self.gl_class = {}
        self.refused = None
        self.run, self.unmapped, self.unplaced = [], [], []
        self.account_intent = {}
        self.patch = []

    def m(self, minor):
        return money(minor, self.places)

    def cell(self, v):
        return v.text if isinstance(v, Bad) else self.m(v) if isinstance(v, int) else v

    # ----- register
    def blank(self, n=1):
        for _ in range(n):
            self.files[0].append([])
            self.kinds[0].append("blank")

    def stray(self, cells):
        self.files[0].append(list(cells))
        self.kinds[0].append("stray")
        return len(self.files[0])

    def section(self, sec_id, location, category, assets, labels=None, order=None, columns=None, totals=(),
                extra=(), end="same", status="read", codes=(), judged=True, scope=None, listed=None):
        reg, kinds = self.files[0], self.kinds[0]
        start = len(reg) + 1
        reg.append(["Section", sec_id])
        kinds.append("section")
        values = {"Entity": self.scope["entity"], "Asset ledger": self.scope["assetLedger"],
                  "Currency": self.scope["currency"], "As of": self.scope["asOf"], "Location": location,
                  "Category": category}
        values.update(scope or {})
        if labels is not None:
            values.update(labels)
        for label in order or LABELS:
            if values.get(label) is not None:
                reg.append([label, values[label]])
                kinds.append("label")
        cols = list(COLUMNS) if columns is None else columns
        if cols:
            reg.append(list(cols))
            kinds.append("columns")
        for a in assets:
            rows = a.rows if a.rows is not None else [
                [c, a.amounts[c], a.valuation or f"VAL-{sec_id}"] for c in FOUR]
            for comp, amount, valuation, *more in rows:
                fields = {"Asset ID": a.id, "Asset dimensions": a.dims, "Component": comp,
                          "Amount": self.cell(amount), "Valuation reference": self.cell(valuation)}
                reg.append([fields.get(h, "") for h in (cols or COLUMNS)] + list(more))
                kinds.append("record")
                a.written.append([len(reg), comp, amount, valuation])
        for cells, kind in extra:
            reg.append(list(cells))
            kinds.append(kind)
        for comp, amount in totals:
            reg.append(["Section total", comp, self.cell(amount)])
            kinds.append("total")
        end_row = None
        if end is not None:
            reg.append(["End section", sec_id if end == "same" else end])
            kinds.append("end")
            end_row = len(reg)
        self.sections.append({"row": start, "end": end_row, "id": sec_id,
                              "location": location if listed is None else listed[0],
                              "category": category if listed is None else listed[1],
                              "status": status, "codes": sorted(codes), "judged": judged, "assets": list(assets)})
        return start

    # ----- map
    def map_row(self, category, component, gl_account, dims, cls=None, valid=("2025-01-01", "9999-12-31"),
                more=(), place=True):
        self.files[1].append([category, component, gl_account, dims, cls or CLASS[component], *valid, *more])
        self.kinds[1].append("row")
        if place:
            self.placed[(category, component)] = (gl_account, dims)
        return len(self.files[1])

    def standard_map(self, *categories, skip=()):
        for cat in categories:
            for comp in THREE:
                if (cat, comp) not in skip:
                    self.map_row(cat, comp, *account(cat, comp))

    # ----- GL
    def gl_row(self, gl_account, normal, dims, cls, entity=None, ledger=None, currency=None, as_of=None,
               cells=None, more=()):
        if cells is None:
            debit, credit = (normal, 0) if cls == "fixed-asset-cost" else (0, normal)
            if debit < 0 or credit < 0:
                debit, credit = (0, -debit) if debit < 0 else (-credit, 0)
            cells = [self.m(debit), self.m(credit)]
        self.files[2].append([gl_account, dims, cls, *cells, entity or self.scope["entity"],
                              ledger or self.scope["glLedger"], currency or self.scope["currency"],
                              as_of or self.scope["asOf"], *more])
        self.kinds[2].append("row")
        self.gl_written[(gl_account, dims)] = normal
        self.gl_rows.setdefault((gl_account, dims), []).append(len(self.files[2]))
        self.gl_class.setdefault((gl_account, dims), []).append(cls)

    def gl_consistent(self, adjust=None, skip=()):
        """A GL row for every placed account, equal to the register sum, moved by adjust."""
        adjust = adjust or {}
        for (cat, comp), (acct, dims) in sorted(self.placed.items(), key=lambda kv: kv[1]):
            if acct in skip or (acct, dims) in self.gl_written:
                continue
            self.gl_row(acct, self.register_sum(acct, dims) + adjust.get(acct, 0), dims, CLASS[comp])

    # ----- the model: what follows from the rows the story writes
    def judged_sections(self):
        return [s for s in self.sections if s["judged"]]

    def members(self, acct, dims):
        out = []
        for s in self.judged_sections():
            for a in s["assets"]:
                for comp in THREE:
                    if self.placed.get((s["category"], comp)) == (acct, dims):
                        out.append([s["id"], a.id, a.dims, comp])
        return sorted(out)

    def register_sum(self, acct, dims):
        total = 0
        for s in self.judged_sections():
            for a in s["assets"]:
                for comp in THREE:
                    if self.placed.get((s["category"], comp)) == (acct, dims):
                        total += a.amounts[comp]
        return total

    def component(self, key):
        named = {comp for (cat, comp), placed in self.placed.items() if placed == key}
        if named:
            return named.pop() if len(named) == 1 else None
        classes = self.gl_class.get(key, [])
        return COMPONENT_OF_CLASS.get(classes[0]) if len(classes) == 1 else None

    # ----- intent
    def expect(self, acct, status, codes=(), dims=None):
        if dims is None:
            dims = next(d for (a, d) in list(self.placed.values()) + list(self.gl_written) if a == acct)
        self.account_intent[(acct, dims)] = [status, sorted(codes)]

    def hold(self, keys, codes):
        for key in keys:
            self.account_intent[key] = ["held", sorted(codes)]

    def hold_all(self, codes):
        self.hold(self.judged_accounts(), codes)

    def category_accounts(self, category):
        return [self.placed[(category, c)] for c in THREE if (category, c) in self.placed]

    def judged_accounts(self):
        keys = set(self.placed.values())
        for row, kind in zip(self.files[2], self.kinds[2]):
            if kind == "row" and len(row) >= 2 and row[0] and row[1]:
                keys.add((row[0], row[1]))
        return sorted(keys)

    def inventory(self):
        reg = {k: 0 for k in ["blank", "section", "end", "stray", "label", "columns", "total", "record"]}
        for k in self.kinds[0]:
            reg[k] += 1
        flat = [{k: kinds.count(k) for k in ["header", "blank", "row"]} for kinds in self.kinds[1:]]
        return {"register": reg, "map": flat[0], "gl": flat[1]}

    def asset_intent(self, s, a):
        rows = {c: [n for n, comp, _, _ in a.written if comp == c] for c in FOUR}
        amounts = {}
        for c in FOUR:
            mine = [amount for _, comp, amount, _ in a.written if comp == c]
            amounts[c] = mine[0] if len(mine) == 1 and isinstance(mine[0], int) else None
        readable = sorted({v for _, _, _, v in a.written if isinstance(v, str)})
        return {"location": s["location"], "category": s["category"], "sectionRow": s["row"],
                "status": "held" if a.held else "read", "codes": a.held, "amounts": amounts, "rows": rows,
                "unread": [n for n, comp, _, _ in a.written if comp not in FOUR],
                "valuation": readable[0] if len(readable) == 1 else None}

    def intent(self):
        if self.refused:
            return {"refused": self.refused}
        accounts = {}
        for key in self.judged_accounts():
            status, codes = self.account_intent.get(key, ["consistent", []])
            members = self.members(*key)
            gl_rows = self.gl_rows.get(key, [])
            register = gl = difference = None
            if status != "held":
                register = self.register_sum(*key) if members else None
                gl = self.gl_written.get(key) if len(gl_rows) == 1 else None
                if register is not None and gl is not None:
                    difference = register - gl
            accounts["|".join(key)] = {"component": self.component(key), "status": status, "codes": codes,
                                       "register": register, "gl": gl, "difference": difference,
                                       "glRow": gl_rows[0] if len(gl_rows) == 1 else None, "members": members}
        assets = {}
        for s in self.judged_sections():
            for a in s["assets"]:
                assets["|".join([s["id"], a.id, a.dims])] = self.asset_intent(s, a)
        return {
            "refused": None,
            "run": sorted(self.run),
            "sections": [[s["row"], s["end"], s["id"], s["location"], s["category"], s["status"], s["codes"]]
                         for s in self.sections],
            "assets": assets,
            "unmapped": sorted(self.unmapped),
            "accounts": accounts,
            "unplaced": sorted(self.unplaced, key=lambda u: (ROLES.index(u[0]), u[1])),
            "inventory": self.inventory(),
        }

    def to_json(self):
        return {"id": self.id, "title": self.title, "writers": self.writers, "scope": self.scope,
                "names": [f"{self.id}-{k}.csv" for k in KINDS], "cells": self.files, "patch": self.patch,
                "intent": self.intent()}


def writers(i):
    """Each story's three files by three different writers, turning through the four."""
    return [WRITERS[(i + k) % 4] for k in range(3)]


# Freight assets in baisa (OMR, three decimals).
F1 = lambda **kw: Asset("FL.0001", "SOH-Y1", 14250000, 5700000, 0, **kw)  # noqa: E731
F2 = lambda **kw: Asset("FL.0002", "SOH-Y1", 13999999, 6999999, 250000, **kw)  # noqa: E731
R1 = lambda **kw: Asset("RCK 12", "MCT-A", 3200500, 1280200, 0, **kw)  # noqa: E731
R2 = lambda **kw: Asset("RCK 13", "MCT-A", 3200500, 3200500, 0, **kw)  # noqa: E731
C1 = lambda **kw: Asset("RF-000123", "SLL-C", 41500000, 8300000, 4150000, **kw)  # noqa: E731
T1 = lambda **kw: Asset("TRK#7", "MCT-F", 27800000, 13900000, 0, **kw)  # noqa: E731
S1 = lambda **kw: Asset("SRV_01", "MCT-DC", 9600000, 9600000, 0, **kw)  # noqa: E731


def rows_of(asset, valuation, drop=(), extra=(), replace=None):
    """The four default rows of an asset with its amounts, less some, more appended, some replaced."""
    replace = replace or {}
    out = [replace.get(c, [c, asset.amounts[c], valuation]) for c in FOUR if c not in drop]
    return out + [list(r) for r in extra]


def depots(s, flt=None, rck=None, rfr=None):
    s.section("SEC-SOH-FLT", SOHAR, FLT, flt or [F1(), F2()])
    s.section("SEC-MCT-RCK", MUSCAT, RCK, rck or [R1(), R2()])
    s.section("SEC-SLL-RFR", SALALAH, RFR, rfr or [C1()])


def stories():
    out = []

    def new(sid, title, **kw):
        s = Story(sid, title, writers(len(out)), **kw)
        out.append(s)
        return s

    s = new("O01", "Three depots, every account consistent")
    depots(s)
    s.standard_map(FLT, RCK, RFR)
    s.gl_consistent()

    s = new("O02", "Valuation reference the first column, Category the first label, every component totalled")
    order = ["Category", "Location", "As of", "Currency", "Asset ledger", "Entity"]
    cols = ["Valuation reference", "Component", "Asset dimensions", "Asset ID", "Amount"]
    tot = lambda assets: [(c, sum(a.amounts[c] for a in assets)) for c in FOUR]  # noqa: E731
    s.section("SEC-SOH-FLT", SOHAR, FLT, [F1(), F2()], order=order, columns=cols, totals=tot([F1(), F2()]))
    s.blank(2)
    s.section("SEC-SLL-RFR", SALALAH, RFR, [C1()], order=order, columns=cols, totals=tot([C1()]))
    s.standard_map(FLT, RFR)
    s.gl_consistent()

    s = new("O03", "A forklift without its impairment row, beside a written carrying amount")
    f2 = F2()
    f2.rows = rows_of(f2, "VAL-F2", drop=["impairment"])
    f2.held = ["COMPONENT_MISSING"]
    depots(s, flt=[F1(), f2])
    s.standard_map(FLT, RCK, RFR)
    s.gl_consistent()
    s.hold(s.category_accounts(FLT), ["COMPONENT_MISSING"])

    s = new("O04", "A rack's depreciation written twice, equal")
    r1 = R1()
    r1.rows = rows_of(r1, "VAL-R1", extra=[["depreciation", 1280200, "VAL-R1"]])
    r1.held = ["COMPONENT_REPEATED"]
    depots(s, rck=[r1, R2()])
    s.standard_map(FLT, RCK, RFR)
    s.gl_consistent()
    s.hold(s.category_accounts(RCK), ["COMPONENT_REPEATED"])

    s = new("O05", "A reefer unit whose carrying amount is one baisa more than its components give")
    c1 = C1(carrying=29050001, held=["CARRYING"])
    depots(s, rfr=[c1])
    s.standard_map(FLT, RCK, RFR)
    s.gl_consistent()
    s.hold(s.category_accounts(RFR), ["CARRYING"])

    s = new("O06", "A truck with two valuation references")
    t1 = T1(held=["VALUATION"])
    t1.rows = rows_of(t1, "VAL-TRK-B", replace={"cost": ["cost", 27800000, "VAL-TRK-A"]})
    s.section("SEC-SOH-FLT", SOHAR, FLT, [F1(), F2()])
    s.section("SEC-MCT-TRK", MUSCAT, TRK, [t1])
    s.standard_map(FLT, TRK)
    s.gl_consistent()
    s.hold(s.category_accounts(TRK), ["VALUATION"])

    s = new("O07", "One asset ID under a forklift section and a racking section, other dimensions")
    moved = Asset("FL.0001", "MCT-A", 500000, 100000, 0, held=["ID_SECTIONS"])
    depots(s, flt=[F1(held=["ID_SECTIONS"]), F2()], rck=[R1(), moved])
    s.standard_map(FLT, RCK, RFR)
    s.gl_consistent()
    s.hold(s.category_accounts(FLT) + s.category_accounts(RCK), ["ID_SECTIONS"])

    s = new("O08", "A note past the five columns on one depreciation row")
    r2 = R2(held=["CELLS"])
    r2.rows = rows_of(r2, "VAL-R2", replace={"depreciation": ["depreciation", 3200500, "VAL-R2", "see note 4"]})
    depots(s, rck=[R1(), r2])
    s.standard_map(FLT, RCK, RFR)
    s.gl_consistent()
    s.hold(s.category_accounts(RCK), ["CELLS"])

    s = new("O09", "A revaluation row, a component the contract does not have")
    r1 = R1(held=["COMPONENT"])
    r1.rows = rows_of(r1, "VAL-R1", extra=[["Revaluation", 150000, "VAL-R1"]])
    depots(s, rck=[r1, R2()])
    s.standard_map(FLT, RCK, RFR)
    s.gl_consistent()
    s.hold(s.category_accounts(RCK), ["COMPONENT"])

    s = new("O10", "A server's depreciation in Arabic-Indic digits")
    s1 = S1(held=["AMOUNT"])
    s1.rows = rows_of(s1, "VAL-SRV", replace={
        "depreciation": ["depreciation", Bad("\u0669\u0666\u0660\u0660.\u0660\u0660\u0660"), "VAL-SRV"]})
    s.section("SEC-SOH-FLT", SOHAR, FLT, [F1(), F2()])
    s.section("SEC-MCT-SRV", MUSCAT, SRV, [s1])
    s.standard_map(FLT, SRV)
    s.gl_consistent()
    s.hold(s.category_accounts(SRV), ["AMOUNT"])

    s = new("O11", "A valuation reference with a leading space on one row")
    f1 = F1(held=["TEXT"])
    f1.rows = rows_of(f1, "VAL-F1", replace={"impairment": ["impairment", 0, Bad(" VAL-F1")]})
    depots(s, flt=[f1, F2()])
    s.standard_map(FLT, RCK, RFR)
    s.gl_consistent()
    s.hold(s.category_accounts(FLT), ["TEXT"])

    s = new("O12", "A racking section with no End section row, the next section after it")
    s.section("SEC-SOH-FLT", SOHAR, FLT, [F1(), F2()])
    s.section("SEC-MCT-RCK", MUSCAT, RCK, [R1(), R2()], end=None, status="held", codes=["SECTION_UNCLOSED"],
              judged=False)
    s.section("SEC-SLL-RFR", SALALAH, RFR, [C1()])
    s.standard_map(FLT, RCK, RFR)
    s.gl_consistent()
    s.hold(s.category_accounts(RCK), ["SECTION_UNCLOSED"])

    s = new("O13", "A forklift section with its Location label twice")
    s.section("SEC-SOH-FLT", SOHAR, FLT, [F1(), F2()], order=LABELS + ["Location"], status="held",
              codes=["SECTION_HEADER"], judged=False, listed=(None, FLT))
    s.section("SEC-MCT-RCK", MUSCAT, RCK, [R1(), R2()])
    s.standard_map(FLT, RCK)
    s.gl_consistent()
    s.hold(s.category_accounts(FLT), ["SECTION_HEADER"])

    s = new("O14", "A truck section in dollars, excluded; the trucks' accounts reach no asset")
    s.section("SEC-SOH-FLT", SOHAR, FLT, [F1(), F2()])
    s.section("SEC-MCT-TRK", MUSCAT, TRK, [T1()], scope={"Currency": "USD"}, status="excluded",
              codes=["SECTION_SCOPE"], judged=False)
    s.standard_map(FLT, TRK)
    s.gl_consistent()
    for key in s.category_accounts(TRK):
        s.expect(key[0], "missing", ["REGISTER_ABSENT"], dims=key[1])

    s = new("O15", "A reefer section whose column row has four columns")
    s.section("SEC-SOH-FLT", SOHAR, FLT, [F1(), F2()])
    s.section("SEC-SLL-RFR", SALALAH, RFR, [C1()],
              columns=["Asset ID", "Asset dimensions", "Component", "Amount"], status="held",
              codes=["SECTION_COLUMNS"], judged=False)
    s.standard_map(FLT, RFR)
    s.gl_consistent()
    s.hold(s.category_accounts(RFR), ["SECTION_COLUMNS"])

    s = new("O16", "Two sections, forklifts and racking, with one section ID")
    s.section("SEC-MCT", MUSCAT, FLT, [Asset("FL.0003", "MCT-Y2", 8800000, 1760000, 0)], status="held",
              codes=["SECTION_DUPLICATE"])
    s.section("SEC-MCT", MUSCAT, RCK, [R1(), R2()], status="held", codes=["SECTION_DUPLICATE"])
    s.section("SEC-SLL-RFR", SALALAH, RFR, [C1()])
    s.standard_map(FLT, RCK, RFR)
    s.gl_consistent()
    s.hold(s.category_accounts(FLT) + s.category_accounts(RCK), ["SECTION_DUPLICATE"])

    s = new("O17", "A racking row without its asset ID")
    lost = ["", "MCT-A", "cost", "1.000", "VAL-RCK"]
    s.section("SEC-SOH-FLT", SOHAR, FLT, [F1(), F2()])
    s.section("SEC-MCT-RCK", MUSCAT, RCK, [R1(), R2()], extra=[(lost, "record")], status="held",
              codes=["ROW_UNPLACED"])
    s.standard_map(FLT, RCK)
    s.gl_consistent()
    s.unplaced.append(["register-sections", s.files[0].index(lost) + 1, "ROW_UNPLACED"])
    s.hold(s.category_accounts(RCK), ["ROW_UNPLACED"])

    s = new("O18", "A depreciation total one baisa over its rows, and a total of a component not one of the four")
    s.section("SEC-SOH-FLT", SOHAR, FLT, [F1(), F2()], totals=[("cost", 28249999), ("depreciation", 12700000)],
              status="held", codes=["TOTAL_MISMATCH"])
    s.section("SEC-MCT-RCK", MUSCAT, RCK, [R1(), R2()], totals=[("Accumulated depreciation", 4480700)],
              status="held", codes=["TOTAL_FIELD"])
    s.section("SEC-SLL-RFR", SALALAH, RFR, [C1()], totals=[("carrying", 29050000)])
    s.standard_map(FLT, RCK, RFR)
    s.gl_consistent()
    s.hold(s.category_accounts(FLT), ["TOTAL_MISMATCH"])
    s.hold(s.category_accounts(RCK), ["TOTAL_FIELD"])

    s = new("O19", "A preparer's line before the first section, and a section without its Category label")
    s.stray(["Prepared by", "Finance team"])
    s.section("SEC-SOH-FLT", SOHAR, FLT, [F1(), F2()])
    row = s.section("SEC-MCT-RCK", MUSCAT, RCK, [R1(), R2()], labels={"Category": None}, status="held",
                    codes=["SECTION_UNREADABLE"], judged=False, listed=(MUSCAT, None))
    s.standard_map(FLT, RCK)
    s.gl_consistent()
    s.run = ["SECTION_UNREADABLE", "STRAY_ROW"]
    s.unplaced += [["register-sections", 1, "STRAY_ROW"], ["register-sections", row, "SECTION_UNREADABLE"]]
    s.hold_all(["SECTION_UNREADABLE", "STRAY_ROW"])

    s = new("O20", "No impairment row for reefers, and the forklifts' depreciation row ended in June")
    depots(s)
    s.standard_map(FLT, RCK, RFR, skip=[(RFR, "impairment"), (FLT, "depreciation")])
    s.map_row(FLT, "depreciation", "1719", "LOG-FLT", valid=("2025-01-01", "2028-06-30"), place=False)
    s.gl_consistent()
    s.gl_row("1719", 0, "LOG-FLT", CLASS["depreciation"])
    s.unmapped = [[FLT, "depreciation", "MAP_EXPIRED"], [RFR, "impairment", "MAP_ABSENT"]]
    impairment = [k for k in s.judged_accounts() if s.component(k) == "impairment"]
    depreciation = [k for k in s.judged_accounts() if s.component(k) == "depreciation"]
    s.hold(impairment, ["MAP_ABSENT"])
    s.hold(depreciation, ["MAP_EXPIRED"])

    s = new("O21", "Two valid cost rows for racking, a truck depreciation row of the cost class, and a server "
                   "impairment row from 30 February")
    s.section("SEC-MCT-RCK", MUSCAT, RCK, [R1(), R2()])
    s.section("SEC-MCT-TRK", MUSCAT, TRK, [T1()])
    s.section("SEC-MCT-SRV", MUSCAT, SRV, [S1()])
    s.standard_map(RCK, TRK, SRV, skip=[(RCK, "cost"), (TRK, "depreciation"), (SRV, "impairment")])
    s.map_row(RCK, "cost", "1720", "LOG-RCK", place=False)
    s.map_row(RCK, "cost", "1720", "LOG-RCK", valid=("2027-01-01", "9999-12-31"), place=False)
    s.map_row(TRK, "depreciation", "1749", "LOG-TRK", cls=CLASS["cost"], place=False)
    s.map_row(SRV, "impairment", "1758", "LOG-IT", valid=("2028-02-30", "9999-12-31"), place=False)
    s.gl_consistent()
    s.gl_row("1720", 6401000, "LOG-RCK", CLASS["cost"])
    s.unmapped = [[RCK, "cost", "MAP_REPEATED"], [SRV, "impairment", "MAP_ROW"], [TRK, "depreciation", "MAP_CLASS"]]
    for comp, code in [("cost", "MAP_REPEATED"), ("depreciation", "MAP_CLASS"), ("impairment", "MAP_ROW")]:
        s.hold([k for k in s.judged_accounts() if s.component(k) == comp], [code])

    s = new("O22", "A map row whose component reads 'accumulated depreciation'")
    depots(s)
    s.standard_map(FLT, RCK, RFR, skip=[(FLT, "depreciation")])
    bad = s.map_row(FLT, "accumulated depreciation", "1719", "LOG-FLT", cls=CLASS["depreciation"], place=False)
    s.gl_consistent()
    s.gl_row("1719", 12699999, "LOG-FLT", CLASS["depreciation"])
    s.run = ["MAP_UNREADABLE"]
    s.unplaced = [["category-map", bad, "MAP_UNREADABLE"]]
    s.unmapped = [[FLT, "depreciation", "MAP_ABSENT"]]
    s.hold_all(["MAP_UNREADABLE"])
    s.hold([k for k in s.judged_accounts() if s.component(k) == "depreciation"], ["MAP_ABSENT", "MAP_UNREADABLE"])

    s = new("O23", "GL rows: a blank credit, another currency as written, a cost account twice, a depreciation "
                   "account called impairment, and a reefer cost account with no row")
    s.section("SEC-SOH-FLT", SOHAR, FLT, [F1(), F2()])
    s.section("SEC-MCT-RCK", MUSCAT, RCK, [R1(), R2()])
    s.section("SEC-SLL-RFR", SALALAH, RFR, [C1()])
    s.section("SEC-MCT-TRK", MUSCAT, TRK, [T1()])
    s.standard_map(FLT, RCK, RFR, TRK)
    s.gl_row("1710", 28249999, "LOG-FLT", CLASS["cost"], cells=[s.m(28249999), ""])
    s.gl_row("1719", 12699999, "LOG-FLT", CLASS["depreciation"], currency="omr")
    s.gl_row("1720", 6401000, "LOG-RCK", CLASS["cost"])
    s.gl_row("1720", 6401000, "LOG-RCK", CLASS["cost"])
    s.gl_row("1729", 4480700, "LOG-RCK", CLASS["impairment"])
    s.gl_consistent(skip=["1730"])
    s.expect("1710", "held", ["GL_ROW"])
    s.expect("1719", "held", ["GL_SCOPE"])
    s.expect("1720", "held", ["GL_REPEATED"])
    s.expect("1729", "held", ["CLASS_CONFLICT"])
    s.expect("1730", "missing", ["GL_ABSENT"])

    s = new("O24", "A GL row with no dimensions")
    depots(s)
    s.standard_map(FLT, RCK, RFR)
    s.gl_consistent()
    s.gl_row("1790", 0, "", CLASS["cost"])
    s.run = ["GL_UNREADABLE"]
    s.unplaced = [["gl-balances", len(s.files[2]), "GL_UNREADABLE"]]
    s.hold_all(["GL_UNREADABLE"])

    s = new("O25", "An old cost account still in the GL at zero, a server category mapped with no section, and one "
                   "account for the forklifts' impairment and the racking's depreciation")
    depots(s)
    s.standard_map(FLT, RCK, RFR, SRV, skip=[(FLT, "impairment"), (RCK, "depreciation")])
    s.map_row(FLT, "impairment", "1799", "LOG-MIX")
    s.map_row(RCK, "depreciation", "1799", "LOG-MIX")
    s.gl_consistent(skip=["1799"])
    s.gl_row("1799", 6480700, "LOG-MIX", CLASS["depreciation"])
    s.gl_row("1700", 0, "LOG-OLD", CLASS["cost"])
    s.expect("1700", "missing", ["UNMAPPED"])
    for key in s.category_accounts(SRV):
        s.expect(key[0], "missing", ["REGISTER_ABSENT"], dims=key[1])
    s.expect("1799", "held", ["ACCOUNT_COMPONENTS"])

    s = new("O26", "Differences: depreciation short by 250 baisa, a reefer cost written on both sides, and an "
                   "impairment account with a debit balance")
    depots(s)
    s.standard_map(FLT, RCK, RFR)
    s.gl_row("1719", 12699999 - 250, "LOG-FLT", CLASS["depreciation"])
    s.gl_row("1730", 41500000, "LOG-RFR", CLASS["cost"], cells=[s.m(41600000), s.m(100000)])
    s.gl_row("1728", -500, "LOG-RCK", CLASS["impairment"])
    s.gl_consistent()
    s.expect("1719", "difference")
    s.expect("1728", "difference")

    s = new("O27", "In euros: the same trucks under an Arabic category at an Arabic-named store, and in English "
                   "at Muscat", currency="EUR", as_of="2028-12-31")
    s.section("SEC-NZW-TRK", NIZWA_AR, TRK_AR, [Asset("TRK#21", "NZW-1", 6150025, 1230005, 0)])
    s.section("SEC-MCT-TRK", MUSCAT, TRK, [Asset("TRK#22", "MCT-F", 6150025, 2460010, 61500)])
    s.standard_map(TRK_AR, TRK)
    s.gl_consistent()

    s = new("O28", "In riyals at a leap day: a location with a comma, a fully depreciated server, zero impairments",
            currency="SAR", as_of="2028-02-29")
    s.section("SEC-SOH-SRV", "Sohar, berth 4", SRV, [Asset("SRV_09", "SOH-B4", 1250000, 1250000, 0),
                                                     Asset("SRV_10", "SOH-B4", 990099, 330033, 0)])
    s.standard_map(SRV)
    s.gl_consistent()

    s = new("O29", "As of 31 September", as_of="2028-09-31")
    depots(s)
    s.standard_map(FLT, RCK, RFR)
    s.gl_consistent()
    s.refused = "SCOPE"

    s = new("O30", "A quote inside an asset ID")
    depots(s)
    s.standard_map(FLT, RCK, RFR)
    s.gl_consistent()
    s.patch = [[0, "RCK 12", 'RCK"12']]
    s.refused = "SOURCE"

    s = new("O31", "The map's header says GL Account")
    depots(s)
    s.standard_map(FLT, RCK, RFR)
    s.files[1][0] = ["Category", "Component", "GL Account", "GL dimensions", "Account class", "Valid from",
                     "Valid to"]
    s.gl_consistent()
    s.refused = "COLUMNS"

    s = new("O32", "A register record of 101 cells")
    s.section("SEC-SOH-FLT", SOHAR, FLT, [F1(), F2()], extra=[(["x"] * 101, "record")])
    s.standard_map(FLT)
    s.gl_consistent()
    s.refused = "CAPACITY"
    return out


def main():
    facts = {"schema": "tarasuf-fa1-sections-h2-stories/1", "family": FAMILY,
             "stories": [s.to_json() for s in stories()]}
    sys.stdout.write(json.dumps(facts, ensure_ascii=False, indent=1) + "\n")


if __name__ == "__main__":
    main()
