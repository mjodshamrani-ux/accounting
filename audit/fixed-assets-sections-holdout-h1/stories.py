"""FA-1 holdout H1 stories: a hotel group's asset register by hotel and
category, its category account map and its GL balances, under the proposed
fixed-assets-sections-1 contract as it is. A lineage of its own: nothing is
imported from the foundation's stories, writers or oracle.

Each story writes its three files as rows of cells, names a writer for each
file, and states its intent by hand: every section's status and codes, every
held asset's codes, every account's status and codes, the pairs the map leaves
unplaced, the rows that cannot be placed and the run codes; or the refusal of
the whole story. Members, sums, record numbers and the inventory follow from
the rows the story writes.

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
PLACES = {"SAR": 2, "AED": 2, "USD": 2, "EUR": 2, "KWD": 3, "BHD": 3, "OMR": 3, "JPY": 0}
WRITERS = ["php", "java", "go", "perl", "calc"]

ENTITY = "Synthetic Pearl Coast Hotels Co"
KIT, ROOM, LIFT, LDY, POOL = "Kitchen equipment", "Guest room furniture", "Lifts", "Laundry machines", "Pool and spa"
KIT_AR = "\u0645\u0639\u062f\u0627\u062a \u0627\u0644\u0645\u0637\u0628\u062e"
KHIRAN = "\u0645\u0646\u062a\u062c\u0639 \u0627\u0644\u062e\u064a\u0631\u0627\u0646"
JAHRA_AR = "\u0641\u0646\u062f\u0642 \u0627\u0644\u062c\u0647\u0631\u0627\u0621"
SALMIYA, FINTAS, JAHRA = "Salmiya tower", "Fintas beach resort", "Jahra inn"
# Category: the accounts of its three components and their GL dimensions.
ACCOUNTS = {
    KIT: ("2610", "2619", "2618", "HTL-KIT"),
    ROOM: ("2620", "2629", "2628", "HTL-ROOM"),
    LIFT: ("2630", "2639", "2638", "HTL-ENG"),
    LDY: ("2640", "2649", "2648", "HTL-LDY"),
    POOL: ("2650", "2659", "2658", "HTL-POOL"),
    KIT_AR: ("2660", "2669", "2668", "HTL-KIT"),
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


class Asset:
    """An asset's rows: [Asset ID, dimensions, cost, depreciation, impairment] in minor units, carrying
    computed unless given; rows may be replaced to write what a story needs."""

    def __init__(self, aid, dims, cost, dep, imp, carrying=None, valuation=None, rows=None, held=()):
        self.id, self.dims = aid, dims
        self.amounts = {"cost": cost, "depreciation": dep, "impairment": imp,
                        "carrying": cost - dep - imp if carrying is None else carrying}
        self.valuation = valuation
        self.rows = rows
        self.held = sorted(held)


class Story:
    def __init__(self, sid, title, writers, currency="KWD", as_of="2028-03-31", entity=ENTITY):
        self.id, self.title, self.writers = sid, title, writers
        self.places = PLACES.get(currency, 3)
        self.scope = {"entity": entity, "assetLedger": "FAR-HTL", "glLedger": "GL-HTL", "currency": currency,
                      "asOf": as_of, "confirmed": True}
        self.files = [[], [list(MAP_HEADER)], [list(GL_HEADER)]]
        self.kinds = [[], ["header"], ["header"]]
        self.sections = []
        self.placed = {}
        self.gl_written = {}
        self.gl_rows = {}
        self.refused = None
        self.run, self.unmapped, self.unplaced = [], [], []
        self.account_intent = {}
        self.patch = []

    def m(self, minor):
        return money(minor, self.places)

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
                before_columns=(), extra=(), end="same", status="read", codes=(), judged=True, scope=None,
                listed=None):
        """Write a section; the intent is its status and codes, and whether its records are judged."""
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
        for cells in before_columns:
            reg.append(list(cells))
            kinds.append("label")
        cols = list(COLUMNS) if columns is None else columns
        if cols:
            reg.append(list(cols))
            kinds.append("columns")
        entries = []
        for a in assets:
            rows = a.rows if a.rows is not None else [
                [c, self.m(a.amounts[c]), a.valuation or f"VAL-{sec_id}"] for c in FOUR]
            for comp, amount, valuation, *more in rows:
                fields = {"Asset ID": a.id, "Asset dimensions": a.dims, "Component": comp, "Amount": amount,
                          "Valuation reference": valuation}
                reg.append([fields.get(h, "") for h in (cols or COLUMNS)] + list(more))
                kinds.append("record")
            entries.append(a)
        for cells, kind in extra:
            reg.append(list(cells))
            kinds.append(kind)
        for comp, amount in totals:
            reg.append(["Section total", comp, amount])
            kinds.append("total")
        end_row = None
        if end is not None:
            reg.append(["End section", sec_id if end == "same" else end])
            kinds.append("end")
            end_row = len(reg)
        self.sections.append({"row": start, "end": end_row, "id": sec_id,
                              "location": location if listed is None else listed[0],
                              "category": category if listed is None else listed[1],
                              "status": status, "codes": sorted(codes), "judged": judged,
                              "assets": entries})
        return start

    # ----- map
    def map_row(self, category, component, gl_account, dims, cls=None, valid=("2020-01-01", "9999-12-31"),
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

    def map_blank(self):
        self.files[1].append([])
        self.kinds[1].append("blank")

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

    def gl_consistent(self, adjust=None, skip=()):
        """A GL row for every placed account, equal to the register sum the story intends, moved by adjust."""
        adjust = adjust or {}
        for (cat, comp), (acct, dims) in sorted(self.placed.items(), key=lambda kv: kv[1]):
            if acct in skip or (acct, dims) in self.gl_written:
                continue
            self.gl_row(acct, self.register_sum(acct, dims) + adjust.get(acct, 0), dims, CLASS[comp])

    # ----- what follows from the rows
    def members(self, acct, dims):
        out = []
        for s in self.sections:
            if not s["judged"]:
                continue
            for a in s["assets"]:
                for comp in THREE:
                    if self.placed.get((s["category"], comp)) == (acct, dims):
                        out.append([s["id"], a.id, a.dims, comp])
        return sorted(out)

    def register_sum(self, acct, dims):
        total = 0
        for s in self.sections:
            if s["judged"]:
                for a in s["assets"]:
                    for comp in THREE:
                        if self.placed.get((s["category"], comp)) == (acct, dims):
                            total += a.amounts[comp]
        return total

    # ----- intent
    def expect(self, acct, status, codes=(), dims=None):
        if dims is None:
            dims = next(d for (a, d) in list(self.placed.values()) + list(self.gl_written) if a == acct)
        self.account_intent[(acct, dims)] = [status, sorted(codes)]

    def hold_all(self, codes):
        for key in self.judged_accounts():
            self.account_intent[key] = ["held", sorted(codes)]

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

    def intent(self):
        if self.refused:
            return {"refused": self.refused}
        accounts = {}
        for key in self.judged_accounts():
            status, codes = self.account_intent.get(key, ["consistent", []])
            members = self.members(*key)
            register = gl = difference = None
            if status != "held":
                register = self.register_sum(*key) if members else None
                gl = self.gl_written.get(key) if len(self.gl_rows.get(key, [])) == 1 else None
                if register is not None and gl is not None:
                    difference = register - gl
            accounts["|".join(key)] = [status, codes, register, gl, difference, members]
        assets = {}
        for s in self.sections:
            if s["judged"]:
                for a in s["assets"]:
                    assets["|".join([s["id"], a.id, a.dims])] = ["held" if a.held else "read", a.held]
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
    """Each story's three files by three different writers, turning through the five."""
    return [WRITERS[(i + k) % 5] for k in range(3)]


# Hotel assets in fils (KWD, three decimals).
K1 = lambda **kw: Asset("KIT/0001", "SAL-F1", 18500000, 7400000, 0, **kw)  # noqa: E731
K2 = lambda **kw: Asset("KIT/0002", "SAL-F1", 9250500, 3700200, 462500, **kw)  # noqa: E731
K3 = lambda **kw: Asset("KIT/0003", "FIN-G", 4100000, 4100000, 0, **kw)  # noqa: E731
R1 = lambda **kw: Asset("RM-1101", "FIN-W2", 2750000, 1100000, 0, **kw)  # noqa: E731
R2 = lambda **kw: Asset("RM-1102", "FIN-W2", 2750000, 1375000, 137500, **kw)  # noqa: E731
L1 = lambda **kw: Asset("LFT-0301", "JAH-C", 64000000, 25600000, 3200000, **kw)  # noqa: E731
D1 = lambda **kw: Asset("LDY-0901", "JAH-B", 7300375, 2920150, 0, **kw)  # noqa: E731
D2 = lambda **kw: Asset("LDY-0902", "JAH-B", 1999999, 999999, 1, **kw)  # noqa: E731


def three(s):
    s.section("SEC-SAL-KIT", SALMIYA, KIT, [K1(), K2()])
    s.section("SEC-FIN-RM", FINTAS, ROOM, [R1(), R2()])
    s.section("SEC-JAH-LFT", JAHRA, LIFT, [L1()])


def stories():
    out = []

    def new(sid, title, **kw):
        s = Story(sid, title, writers(len(out)), **kw)
        out.append(s)
        return s

    s = new("H01", "Three hotels, every account consistent")
    three(s)
    s.standard_map(KIT, ROOM, LIFT)
    s.gl_consistent()

    s = new("H02", "Labels in reverse order, the columns Amount first, and every section totalled")
    order = list(reversed(LABELS))
    cols = ["Amount", "Component", "Valuation reference", "Asset dimensions", "Asset ID"]
    tot = lambda assets: [(c, s.m(sum(a.amounts[c] for a in assets))) for c in FOUR]  # noqa: E731
    s.section("SEC-SAL-KIT", SALMIYA, KIT, [K1(), K2()], order=order, columns=cols, totals=tot([K1(), K2()]))
    s.blank()
    s.section("SEC-JAH-LDY", JAHRA, LDY, [D1(), D2()], order=order, columns=cols, totals=tot([D1(), D2()]))
    s.standard_map(KIT, LDY)
    s.gl_consistent()

    s = new("H03", "An Arabic hotel and category, beside the same category in English on other accounts")
    s.section("SEC-KHR-KIT", KHIRAN, KIT_AR, [K3()])
    s.section("SEC-SAL-KIT", SALMIYA, KIT, [K1()])
    s.standard_map(KIT_AR, KIT)
    s.gl_consistent()

    s = new("H04", "One category in two hotels, one account each; depreciation five fils short in the GL")
    s.section("SEC-SAL-KIT", SALMIYA, KIT, [K1(), K2()])
    s.section("SEC-FIN-KIT", FINTAS, KIT, [K3()])
    s.standard_map(KIT)
    s.gl_consistent(adjust={"2619": -5})
    s.expect("2619", "difference")

    s = new("H05", "An impairment account with a debit balance against a written zero")
    s.section("SEC-JAH-LFT", JAHRA, LIFT, [Asset("LFT-0302", "JAH-C", 30000000, 6000000, 0)])
    s.standard_map(LIFT)
    s.gl_consistent(skip=("2638",))
    s.gl_row("2638", -250000, "HTL-ENG", CLASS["impairment"])
    s.expect("2638", "difference")

    s = new("H06", "One asset ID under two hotels and two categories, other dimensions")
    s.section("SEC-JAH-LFT", JAHRA, LIFT, [L1(held=["ID_SECTIONS"])])
    s.section("SEC-SAL-KIT", SALMIYA, KIT, [K1(), Asset("LFT-0301", "SAL-F9", 900000, 90000, 0,
                                                         held=["ID_SECTIONS"])])
    s.section("SEC-FIN-RM", FINTAS, ROOM, [R1()])
    s.standard_map(KIT, ROOM, LIFT)
    s.gl_consistent()
    for cat in (KIT, LIFT):
        for comp in THREE:
            s.expect(account(cat, comp)[0], "held", ["ID_SECTIONS"])

    s = new("H07", "An asset with no impairment row beside one with a written zero")
    s.section("SEC-FIN-RM", FINTAS, ROOM, [
        R1(), Asset("RM-1103", "FIN-W3", 1800000, 360000, 0, held=["COMPONENT_MISSING"],
                    rows=[["cost", "1800.000", "VAL-RM"], ["depreciation", "360.000", "VAL-RM"],
                          ["carrying", "1440.000", "VAL-RM"]])])
    s.section("SEC-JAH-LDY", JAHRA, LDY, [D1()])
    s.standard_map(ROOM, LDY)
    s.gl_consistent()
    for comp in THREE:
        s.expect(account(ROOM, comp)[0], "held", ["COMPONENT_MISSING"])

    s = new("H08", "Depreciation written twice, equal, for one laundry machine")
    s.section("SEC-JAH-LDY", JAHRA, LDY, [
        D1(), Asset("LDY-0903", "JAH-B", 500000, 100000, 0, held=["COMPONENT_REPEATED"],
                    rows=[["cost", "500.000", "VAL-LD"], ["depreciation", "100.000", "VAL-LD"],
                          ["depreciation", "100.000", "VAL-LD"], ["impairment", "0.000", "VAL-LD"],
                          ["carrying", "400.000", "VAL-LD"]])])
    s.section("SEC-SAL-KIT", SALMIYA, KIT, [K2()])
    s.standard_map(LDY, KIT)
    s.gl_consistent()
    for comp in THREE:
        s.expect(account(LDY, comp)[0], "held", ["COMPONENT_REPEATED"])

    s = new("H09", "A carrying amount one fils off, the GL agreeing with the components")
    s.section("SEC-SAL-KIT", SALMIYA, KIT, [K1(), K2(carrying=5087801, held=["CARRYING"])])
    s.section("SEC-JAH-LFT", JAHRA, LIFT, [L1()])
    s.standard_map(KIT, LIFT)
    s.gl_consistent()
    for comp in THREE:
        s.expect(account(KIT, comp)[0], "held", ["CARRYING"])

    s = new("H10", "Two valuation references for one asset")
    s.section("SEC-FIN-RM", FINTAS, ROOM, [
        R1(), Asset("RM-1104", "FIN-W4", 1000000, 200000, 0, held=["VALUATION"],
                    rows=[["cost", "1000.000", "VAL-2027"], ["depreciation", "200.000", "VAL-2028"],
                          ["impairment", "0.000", "VAL-2028"], ["carrying", "800.000", "VAL-2028"]])])
    s.standard_map(ROOM)
    s.gl_consistent()
    for comp in THREE:
        s.expect(account(ROOM, comp)[0], "held", ["VALUATION"])

    s = new("H11", "A note past the five columns on one record row")
    s.section("SEC-JAH-LFT", JAHRA, LIFT, [
        Asset("LFT-0303", "JAH-D", 12000000, 4800000, 0, held=["CELLS"],
              rows=[["cost", "12000.000", "VAL-LF", "replaced cabin 2027"], ["depreciation", "4800.000", "VAL-LF"],
                    ["impairment", "0.000", "VAL-LF"], ["carrying", "7200.000", "VAL-LF"]])])
    s.section("SEC-SAL-KIT", SALMIYA, KIT, [K1()])
    s.standard_map(LIFT, KIT)
    s.gl_consistent()
    for comp in THREE:
        s.expect(account(LIFT, comp)[0], "held", ["CELLS"])

    s = new("H12", "A thousands separator, and four decimals in dinars")
    s.section("SEC-SAL-KIT", SALMIYA, KIT, [
        Asset("KIT/0004", "SAL-F2", 12500000, 2500000, 0, held=["AMOUNT"],
              rows=[["cost", "12,500.000", "VAL-K"], ["depreciation", "2500.000", "VAL-K"],
                    ["impairment", "0.000", "VAL-K"], ["carrying", "10000.000", "VAL-K"]]),
        Asset("KIT/0005", "SAL-F2", 600000, 120000, 0, held=["AMOUNT"],
              rows=[["cost", "600.000", "VAL-K"], ["depreciation", "120.0000", "VAL-K"],
                    ["impairment", "0.000", "VAL-K"], ["carrying", "480.000", "VAL-K"]])])
    s.section("SEC-FIN-RM", FINTAS, ROOM, [R2()])
    s.standard_map(KIT, ROOM)
    s.gl_consistent()
    for comp in THREE:
        s.expect(account(KIT, comp)[0], "held", ["AMOUNT"])

    s = new("H13", "A valuation reference written as a formula")
    s.section("SEC-JAH-LDY", JAHRA, LDY, [
        Asset("LDY-0904", "JAH-B", 800000, 160000, 0, held=["TEXT"],
              rows=[["cost", "800.000", "=VLOOKUP(A2)"], ["depreciation", "160.000", "=VLOOKUP(A2)"],
                    ["impairment", "0.000", "=VLOOKUP(A2)"], ["carrying", "640.000", "=VLOOKUP(A2)"]])])
    s.section("SEC-JAH-LFT", JAHRA, LIFT, [L1()])
    s.standard_map(LDY, LIFT)
    s.gl_consistent()
    for comp in THREE:
        s.expect(account(LDY, comp)[0], "held", ["TEXT"])

    s = new("H14", "Cost written as Cost: a component that is not one of the four, and no cost row")
    s.section("SEC-FIN-RM", FINTAS, ROOM, [
        Asset("RM-1105", "FIN-W5", 900000, 450000, 0, held=["COMPONENT", "COMPONENT_MISSING"],
              rows=[["Cost", "900.000", "VAL-R"], ["depreciation", "450.000", "VAL-R"],
                    ["impairment", "0.000", "VAL-R"], ["carrying", "450.000", "VAL-R"]]), R1()])
    s.standard_map(ROOM)
    s.gl_consistent()
    for comp in THREE:
        s.expect(account(ROOM, comp)[0], "held", ["COMPONENT", "COMPONENT_MISSING"])

    s = new("H15", "A record row with no asset ID cannot be placed and holds its hotel's category")
    s.section("SEC-SAL-KIT", SALMIYA, KIT, [K1()], extra=[(["", "SAL-F1", "cost", "75.000", "VAL-SEC-SAL-KIT"],
                                                          "record")], status="held", codes=["ROW_UNPLACED"])
    s.unplaced.append(["register-sections", s.sections[-1]["end"] - 1, "ROW_UNPLACED"])
    s.section("SEC-JAH-LDY", JAHRA, LDY, [D2()])
    s.standard_map(KIT, LDY)
    s.gl_consistent()
    for comp in THREE:
        s.expect(account(KIT, comp)[0], "held", ["ROW_UNPLACED"])

    s = new("H16", "Two sections with one ID, other hotels and categories")
    s.section("SEC-0001", SALMIYA, KIT, [K2()], status="held", codes=["SECTION_DUPLICATE"])
    s.section("SEC-0001", FINTAS, ROOM, [R2()], status="held", codes=["SECTION_DUPLICATE"])
    s.section("SEC-0002", JAHRA, LIFT, [L1()])
    s.standard_map(KIT, ROOM, LIFT)
    s.gl_consistent()
    for cat in (KIT, ROOM):
        for comp in THREE:
            s.expect(account(cat, comp)[0], "held", ["SECTION_DUPLICATE"])

    s = new("H17", "A cost total ten fils off in one hotel, and a total of the carrying amount spelled out in another")
    s.section("SEC-SAL-KIT", SALMIYA, KIT, [K1(), K2()], totals=[("cost", s.m(27750510))], status="held",
              codes=["TOTAL_MISMATCH"])
    s.section("SEC-JAH-LDY", JAHRA, LDY, [D1()], totals=[("carrying amount", s.m(4380225))], status="held",
              codes=["TOTAL_FIELD"])
    s.section("SEC-FIN-RM", FINTAS, ROOM, [R1()], totals=[("cost", s.m(2750000)), ("impairment", s.m(0))])
    s.standard_map(KIT, LDY, ROOM)
    s.gl_consistent()
    for comp in THREE:
        s.expect(account(KIT, comp)[0], "held", ["TOTAL_MISMATCH"])
        s.expect(account(LDY, comp)[0], "held", ["TOTAL_FIELD"])

    s = new("H18", "A section with no Location label: nothing is carried from the section above")
    s.section("SEC-FIN-RM", FINTAS, ROOM, [R1()])
    s.section("SEC-FIN-LDY", None, LDY, [D1()], status="held", codes=["SECTION_HEADER"], judged=False)
    s.standard_map(ROOM, LDY)
    s.gl_consistent()
    for comp in THREE:
        s.expect(account(LDY, comp)[0], "held", ["SECTION_HEADER"])

    s = new("H19", "Last year's copy of a hotel's section is excluded and listed")
    s.section("SEC-SAL-KIT", SALMIYA, KIT, [K1()])
    s.section("SEC-SAL-KIT-2027", SALMIYA, KIT, [K1(), K2()], scope={"As of": "2027-03-31"}, status="excluded",
              codes=["SECTION_SCOPE"], judged=False)
    s.section("SEC-JAH-LFT", JAHRA, LIFT, [L1()])
    s.standard_map(KIT, LIFT)
    s.gl_consistent()

    s = new("H20", "A column row with Asset Id for Asset ID")
    s.section("SEC-JAH-LFT", JAHRA, LIFT, [L1()], columns=["Asset Id", "Asset dimensions", "Component", "Amount",
                                                         "Valuation reference"], status="held",
              codes=["SECTION_COLUMNS"], judged=False)
    s.section("SEC-FIN-RM", FINTAS, ROOM, [R2()])
    s.standard_map(LIFT, ROOM)
    s.gl_consistent()
    for comp in THREE:
        s.expect(account(LIFT, comp)[0], "held", ["SECTION_COLUMNS"])

    s = new("H21", "A section ended by the next hotel's End section row")
    s.section("SEC-SAL-KIT", SALMIYA, KIT, [K2()], end="SEC-SAL-ROOM", status="held", codes=["SECTION_UNCLOSED"],
              judged=False)
    s.section("SEC-JAH-LDY", JAHRA, LDY, [D2()])
    s.standard_map(KIT, LDY)
    s.gl_consistent()
    for comp in THREE:
        s.expect(account(KIT, comp)[0], "held", ["SECTION_UNCLOSED"])

    s = new("H22", "A category label with a trailing space cannot be read: every account is held")
    start = s.section("SEC-FIN-RM", FINTAS, ROOM + " ", [R1()], status="held", codes=["SECTION_UNREADABLE"],
                      judged=False, listed=(FINTAS, None))
    s.section("SEC-JAH-LFT", JAHRA, LIFT, [L1()])
    s.standard_map(ROOM, LIFT)
    s.gl_consistent()
    s.run = ["SECTION_UNREADABLE"]
    s.unplaced.append(["register-sections", start, "SECTION_UNREADABLE"])
    s.hold_all(["SECTION_UNREADABLE"])

    s = new("H23", "A page footer between two hotels' sections is outside every section")
    s.section("SEC-SAL-KIT", SALMIYA, KIT, [K1()])
    footer = s.stray(["Pearl Coast Hotels asset register", "page 1 of 2"])
    s.section("SEC-JAH-LFT", JAHRA, LIFT, [L1()])
    s.standard_map(KIT, LIFT)
    s.gl_consistent()
    s.run = ["STRAY_ROW"]
    s.unplaced.append(["register-sections", footer, "STRAY_ROW"])
    s.hold_all(["STRAY_ROW"])

    s = new("H24", "The laundry cost map row ended in December: every cost account is held")
    s.section("SEC-JAH-LDY", JAHRA, LDY, [D1(), D2()])
    s.section("SEC-SAL-KIT", SALMIYA, KIT, [K2()])
    s.map_row(LDY, "cost", *account(LDY, "cost"), valid=("2020-01-01", "2027-12-31"), place=False)
    s.map_row(LDY, "depreciation", *account(LDY, "depreciation"))
    s.map_row(LDY, "impairment", *account(LDY, "impairment"))
    s.standard_map(KIT)
    s.gl_consistent()
    s.gl_row("2640", sum(a.amounts["cost"] for a in (D1(), D2())), "HTL-LDY", CLASS["cost"])
    s.unmapped.append([LDY, "cost", "MAP_EXPIRED"])
    s.expect("2610", "held", ["MAP_EXPIRED"])
    s.expect("2640", "held", ["MAP_EXPIRED"])

    s = new("H25", "Two kitchen depreciation rows valid at the as-of date, and a superseded room account still in the GL at zero")
    s.section("SEC-SAL-KIT", SALMIYA, KIT, [K1()])
    s.section("SEC-FIN-RM", FINTAS, ROOM, [R1()])
    s.map_row(KIT, "cost", *account(KIT, "cost"))
    s.map_row(KIT, "depreciation", "2619", "HTL-KIT", place=False)
    s.map_row(KIT, "depreciation", "2619", "HTL-KIT", valid=("2028-01-01", "9999-12-31"), place=False)
    s.map_row(KIT, "impairment", *account(KIT, "impairment"))
    s.map_row(ROOM, "cost", "2621", "HTL-ROOM", valid=("2020-01-01", "2027-06-30"), place=False)
    s.map_row(ROOM, "cost", *account(ROOM, "cost"), valid=("2027-07-01", "9999-12-31"))
    s.map_row(ROOM, "depreciation", *account(ROOM, "depreciation"))
    s.map_row(ROOM, "impairment", *account(ROOM, "impairment"))
    s.gl_consistent()
    s.gl_row("2619", K1().amounts["depreciation"], "HTL-KIT", CLASS["depreciation"])
    s.gl_row("2621", 0, "HTL-ROOM", CLASS["cost"])
    s.unmapped.append([KIT, "depreciation", "MAP_REPEATED"])
    s.expect("2619", "held", ["MAP_REPEATED"])
    s.expect("2629", "held", ["MAP_REPEATED"])
    s.expect("2621", "missing", ["UNMAPPED"])

    s = new("H26", "A lift impairment map row of the cost class, and a room cost account the GL calls depreciation")
    s.section("SEC-JAH-LFT", JAHRA, LIFT, [L1()])
    s.section("SEC-FIN-RM", FINTAS, ROOM, [R1()])
    s.standard_map(ROOM)
    s.map_row(LIFT, "cost", *account(LIFT, "cost"))
    s.map_row(LIFT, "depreciation", *account(LIFT, "depreciation"))
    s.map_row(LIFT, "impairment", "2638", "HTL-ENG", cls="fixed-asset-cost", place=False)
    s.gl_consistent(skip=("2620",))
    s.gl_row("2620", R1().amounts["cost"], "HTL-ROOM", CLASS["depreciation"])
    s.gl_row("2638", L1().amounts["impairment"], "HTL-ENG", CLASS["impairment"])
    s.unmapped.append([LIFT, "impairment", "MAP_CLASS"])
    s.expect("2620", "held", ["CLASS_CONFLICT"])
    s.expect("2628", "held", ["MAP_CLASS"])
    s.expect("2638", "held", ["MAP_CLASS"])

    s = new("H27", "A GL row of the day before, a GL row twice, an account with no GL row, and a pool with no section")
    s.section("SEC-SAL-KIT", SALMIYA, KIT, [K1(), K2()])
    s.section("SEC-JAH-LDY", JAHRA, LDY, [D1()])
    s.standard_map(KIT, LDY, POOL)
    kit_cost = K1().amounts["cost"] + K2().amounts["cost"]
    s.gl_row("2610", kit_cost, "HTL-KIT", CLASS["cost"], as_of="2028-03-30")
    s.gl_row("2619", s.register_sum("2619", "HTL-KIT"), "HTL-KIT", CLASS["depreciation"])
    s.gl_row("2619", s.register_sum("2619", "HTL-KIT"), "HTL-KIT", CLASS["depreciation"])
    s.gl_consistent(skip=("2618", "2650", "2659", "2658"))
    s.gl_row("2650", 0, "HTL-POOL", CLASS["cost"])
    s.expect("2610", "held", ["GL_SCOPE"])
    s.expect("2619", "held", ["GL_REPEATED"])
    s.expect("2618", "missing", ["GL_ABSENT"])
    s.expect("2650", "missing", ["REGISTER_ABSENT"])
    s.expect("2658", "missing", ["GL_ABSENT", "REGISTER_ABSENT"])
    s.expect("2659", "missing", ["GL_ABSENT", "REGISTER_ABSENT"])

    s = new("H28", "A GL debit with a thousands separator, and a GL row with no account")
    s.section("SEC-SAL-KIT", SALMIYA, KIT, [K1()])
    s.standard_map(KIT)
    s.gl_row("2610", K1().amounts["cost"], "HTL-KIT", CLASS["cost"], cells=["18,500.000", "0.000"])
    s.gl_consistent()
    s.gl_row("", 0, "HTL-KIT", CLASS["cost"])
    s.run = ["GL_UNREADABLE"]
    s.unplaced.append(["gl-balances", len(s.files[2]), "GL_UNREADABLE"])
    s.hold_all(["GL_UNREADABLE"])
    s.account_intent[("2610", "HTL-KIT")] = ["held", ["GL_ROW", "GL_UNREADABLE"]]

    s = new("H29", "A map row for Depreciation with a capital cannot be put under a pair")
    s.section("SEC-JAH-LFT", JAHRA, LIFT, [L1()])
    s.standard_map(LIFT)
    bad = s.map_row(LIFT, "Depreciation", "2639", "HTL-ENG", cls=CLASS["depreciation"], place=False)
    s.gl_consistent()
    s.run = ["MAP_UNREADABLE"]
    s.unplaced.append(["category-map", bad, "MAP_UNREADABLE"])
    s.hold_all(["MAP_UNREADABLE"])

    s = new("H30", "The map puts kitchen cost and room depreciation on one account")
    s.section("SEC-SAL-KIT", SALMIYA, KIT, [K1()])
    s.section("SEC-FIN-RM", FINTAS, ROOM, [R1()])
    s.map_row(KIT, "cost", "2600", "HTL-SHARED")
    s.map_row(KIT, "depreciation", *account(KIT, "depreciation"))
    s.map_row(KIT, "impairment", *account(KIT, "impairment"))
    s.map_row(ROOM, "cost", *account(ROOM, "cost"))
    s.map_row(ROOM, "depreciation", "2600", "HTL-SHARED")
    s.map_row(ROOM, "impairment", *account(ROOM, "impairment"))
    s.gl_consistent(skip=("2600",))
    s.gl_row("2600", K1().amounts["cost"], "HTL-SHARED", CLASS["cost"])
    s.expect("2600", "held", ["ACCOUNT_COMPONENTS"])

    s = new("H31", "Yen, no decimals: a lift and a laundry machine, the laundry cost one yen over in the GL",
            currency="JPY")
    s.section("SEC-JAH-LFT", JAHRA, LIFT, [Asset("LFT-0310", "JAH-C", 48000000, 16000000, 800000)])
    s.section("SEC-JAH-LDY", JAHRA, LDY, [Asset("LDY-0910", "JAH-B", 2400000, 960000, 0)])
    s.standard_map(LIFT, LDY)
    s.gl_consistent(adjust={"2640": 1})
    s.expect("2640", "difference")

    s = new("H32", "Dirhams, two decimals, an Arabic hotel under an English category; all consistent",
            currency="AED")
    s.section("SEC-KHR-RM", KHIRAN, ROOM, [Asset("RM-2201", "KHR-1", 1520050, 304010, 0),
                                           Asset("RM-2202", "KHR-1", 980000, 980000, 0)])
    s.section("SEC-JAH-KIT", JAHRA_AR, KIT, [Asset("KIT/0101", "JAH-K", 2210075, 442015, 110000)])
    s.standard_map(ROOM, KIT)
    s.gl_consistent()

    s = new("H33", "Refused: an as-of date of 30 February")
    s.scope["asOf"] = "2028-02-30"
    three(s)
    s.standard_map(KIT, ROOM, LIFT)
    s.gl_consistent()
    s.refused = "SCOPE"

    s = new("H34", "Refused: a double quote inside an unquoted asset ID")
    s.section("SEC-SAL-KIT", SALMIYA, KIT, [K1()])
    s.standard_map(KIT)
    s.gl_consistent()
    s.patch = [[0, "KIT/0001", 'KIT"0001']]
    s.refused = "SOURCE"

    s = new("H35", "Refused: a map without its Valid to column")
    s.section("SEC-SAL-KIT", SALMIYA, KIT, [K1()])
    s.standard_map(KIT)
    s.gl_consistent()
    s.files[1] = [row[:6] for row in s.files[1]]
    s.refused = "COLUMNS"

    s = new("H36", "Refused: a register note longer than a cell may hold")
    s.section("SEC-SAL-KIT", SALMIYA, KIT, [K1()])
    s.stray(["Note", "x" * 40000])
    s.standard_map(KIT)
    s.gl_consistent()
    s.refused = "CAPACITY"

    s = new("H37", "Refused: ninety-one lifts at the largest amount, a cost account no integer holds exactly")
    s.section("SEC-JAH-LFT", JAHRA, LIFT, [Asset(f"LFT-{n:04d}", "JAH-C", 10 ** 14, 0, 0) for n in range(1, 92)])
    s.standard_map(LIFT)
    s.gl_row("2630", 0, "HTL-ENG", CLASS["cost"])
    s.gl_row("2639", 0, "HTL-ENG", CLASS["depreciation"])
    s.gl_row("2638", 0, "HTL-ENG", CLASS["impairment"])
    s.refused = "TOTAL_LIMIT"

    s = new("H38", "No map row for laundry impairment: every impairment account is held")
    s.section("SEC-JAH-LDY", JAHRA, LDY, [D1(), D2()])
    s.section("SEC-SAL-KIT", SALMIYA, KIT, [K2()])
    s.standard_map(KIT)
    s.standard_map(LDY, skip=((LDY, "impairment"),))
    s.gl_consistent()
    s.gl_row("2648", sum(a.amounts["impairment"] for a in (D1(), D2())), "HTL-LDY", CLASS["impairment"])
    s.unmapped.append([LDY, "impairment", "MAP_ABSENT"])
    s.expect("2618", "held", ["MAP_ABSENT"])
    s.expect("2648", "held", ["MAP_ABSENT"])

    s = new("H39", "A room depreciation map row whose GL dimensions start with a minus sign")
    s.section("SEC-FIN-RM", FINTAS, ROOM, [R1(), R2()])
    s.section("SEC-JAH-LFT", JAHRA, LIFT, [L1()])
    s.standard_map(LIFT)
    s.standard_map(ROOM, skip=((ROOM, "depreciation"),))
    s.map_row(ROOM, "depreciation", "2629", "-HTL-ROOM", place=False)
    s.gl_consistent()
    s.gl_row("2629", sum(a.amounts["depreciation"] for a in (R1(), R2())), "HTL-ROOM", CLASS["depreciation"])
    s.unmapped.append([ROOM, "depreciation", "MAP_ROW"])
    s.expect("2629", "held", ["MAP_ROW"])
    s.expect("2639", "held", ["MAP_ROW"])
    return out


def main():
    facts = {"schema": "tarasuf-fa1-sections-h1-stories/1", "family": FAMILY, "synthetic": True,
             "stories": [s.to_json() for s in stories()]}
    sys.stdout.write(json.dumps(facts, ensure_ascii=False, indent=1) + "\n")


if __name__ == "__main__":
    main()
