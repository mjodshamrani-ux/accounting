"""ALL-1 holdout H1 stories, a lineage that imports nothing from the
foundation: a synthetic clinic group's payable to a reagent supplier, cut off
on a leap day, mostly in Omani rials to three places, with stories in
dirhams and yen. Each story is one allocation snapshot (transfers, open
invoices and a remittance advice, each file with its own writer), the
accountant's decisions already taken, and the intent written by hand: for
every advice line its status, every reason it needs review, the other open
lines it competes with and its twins, or the refusal of the whole story.
Capacities, allocations and the advice on each transfer and invoice are the
story's own arithmetic.

    python3 -B stories.py > frozen/stories.json
"""
import json
import sys

META = ["Entity", "Ledger", "Party", "Account", "Currency", "Snapshot date", "Allocation basis"]
HEADERS = [
    ["Payment ID", "Payment date", *META, "Original amount", "Available amount"],
    ["Invoice ID", "Invoice date", *META, "Original amount", "Available amount"],
    ["Advice line ID", *META, "Payment ID", "Invoice ID", "Allocation amount"],
]
ROLES = ["available-payments", "open-invoices", "proposed-remittance"]
PLACES = {"OMR": 3, "AED": 2, "JPY": 0}
WRITERS = ("php", "java", "go", "perl", "calc", "lo-xlsx")
OP, OI, CP, CI, TW = "OVER_PAYMENT", "OVER_INVOICE", "COMPETES_PAYMENT", "COMPETES_INVOICE", "TWIN"
KINDS = ("payments", "invoices", "advice")


def fmt(minor, places):
    if not places:
        return str(minor)
    return f"{minor // 10 ** places}.{minor % 10 ** places:0{places}d}"


class Story:
    def __init__(self, sid, title, writers, currency="OMR", party="Reagent House R4", ledger="GC-AP-28"):
        self.id, self.title = sid, title
        self.writers = list(writers) if isinstance(writers, (list, tuple)) else [writers] * 3
        assert all(w in WRITERS for w in self.writers)
        self.places = PLACES[currency]
        self.scope = {"entity": "Synthetic Gulf Clinics WLL", "ledger": ledger, "party": party, "account": "2150",
                      "currency": currency, "cutoff": "2028-02-29", "basis": "before-proposed-allocation",
                      "confirmed": True}
        self.headers = [list(h) for h in HEADERS]
        self.rows = [[], [], []]  # data rows in self.headers order; [] is a blank row
        self.hidden = [[], [], []]
        self.items = [{}, {}]  # reference -> [row, available minor]
        self.lines = {}  # line id -> [row, payment, invoice, minor]
        self.decisions = []
        self.refused = None
        self.intent_lines = []

    def meta(self):
        s = self.scope
        return [s["entity"], s["ledger"], s["party"], s["account"], s["currency"], s["cutoff"], s["basis"]]

    def _put(self, side, by_header):
        self.rows[side].append([by_header[h] for h in self.headers[side]])
        return len(self.rows[side]) + 1

    def pay(self, ref, original, available=None, date="2028-02-15", text=None):
        available = original if available is None else available
        amounts = text or [fmt(original, self.places), fmt(available, self.places)]
        row = self._put(0, dict(zip(HEADERS[0], [ref, date, *self.meta(), *amounts])))
        self.items[0][ref] = [row, available]
        return row

    def inv(self, ref, original, available=None, date="2028-01-20", text=None):
        available = original if available is None else available
        amounts = text or [fmt(original, self.places), fmt(available, self.places)]
        row = self._put(1, dict(zip(HEADERS[1], [ref, date, *self.meta(), *amounts])))
        self.items[1][ref] = [row, available]
        return row

    def advice(self, line, payment, invoice, minor, text=None):
        cells = [line, *self.meta(), payment, invoice, text or fmt(minor, self.places)]
        row = self._put(2, dict(zip(HEADERS[2], cells)))
        self.lines[line] = [row, payment, invoice, minor]
        return row

    def blank(self, side):
        self.rows[side].append([])
        return self

    def hide(self, side, row):
        self.hidden[side].append(row)
        return self

    def drop(self, side, header):
        """A file without one of the family's columns: written without it."""
        k = self.headers[side].index(header)
        self.headers[side].pop(k)
        for r in self.rows[side]:
            if r:
                r.pop(k)
        return self

    def order(self, side, headers):
        """The columns of one file in another order."""
        assert sorted(headers) == sorted(self.headers[side])
        at = [self.headers[side].index(h) for h in headers]
        self.headers[side] = list(headers)
        self.rows[side] = [[r[k] for k in at] if r else [] for r in self.rows[side]]
        return self

    def remit(self, did, lines):
        self.decisions.append({"type": "remittance", "id": did, "lines": list(lines)})
        return self

    def human(self, did, links, kind="external-confirmation"):
        self.decisions.append({"type": "human", "id": did, "kind": kind, "links": [list(x) for x in links]})
        return self

    def undo(self, did, target):
        self.decisions.append({"type": "undo", "id": did, "target": target})
        return self

    def line(self, lid, status, reasons=(), competitors=(), twins=()):
        self.intent_lines.append([lid, status, list(reasons), list(competitors), list(twins)])
        return self

    def refuse(self, code):
        self.refused = code
        return self

    def arithmetic(self):
        """Allocated per transfer and invoice from the story's own active
        decisions, and the open advice on each."""
        active = {}
        for d in self.decisions:
            if d["type"] == "undo":
                active.pop(d["target"])
            elif d["type"] == "remittance":
                active[d["id"]] = [(*self.lines[x][1:4], x) for x in d["lines"]]
            else:
                active[d["id"]] = [(p, i, m, None) for p, i, m in d["links"]]
        allocated, used = [{}, {}], set()
        for links in active.values():
            for p, i, m, x in links:
                allocated[0][p] = allocated[0].get(p, 0) + m
                allocated[1][i] = allocated[1].get(i, 0) + m
                if x:
                    used.add(x)
        advised = [{}, {}]
        for x, (_, p, i, m) in self.lines.items():
            if x not in used:
                advised[0][p] = advised[0].get(p, 0) + m
                advised[1][i] = advised[1].get(i, 0) + m
        out = []
        for side in (0, 1):
            for ref, (_, available) in self.items[side].items():
                out.append([side, ref, available - allocated[side].get(ref, 0), advised[side].get(ref, 0)])
        return out

    def to_json(self):
        names = [f"{self.id}-{k}.{'xlsx' if w == 'lo-xlsx' else 'csv'}" for k, w in zip(KINDS, self.writers)]
        row_of = {x: v[0] for x, v in self.lines.items()}
        if self.refused:
            intent = {"refused": self.refused, "lines": [], "items": []}
        else:
            assert sorted(x for x, *_ in self.intent_lines) == sorted(self.lines), self.id
            intent = {"refused": None,
                      "lines": [[row_of[x], st, rs, sorted(row_of[c] for c in cs), sorted(row_of[t] for t in ts)]
                                for x, st, rs, cs, ts in sorted(self.intent_lines, key=lambda v: row_of[v[0]])],
                      "items": self.arithmetic()}
        return {"id": self.id, "title": self.title, "writers": self.writers, "names": names, "scope": self.scope,
                "decimals": self.places, "cells": [[self.headers[s]] + self.rows[s] for s in range(3)],
                "hidden": self.hidden, "lineRows": row_of,
                "adviceMinor": {x: v[3] for x, v in self.lines.items()},
                "lineCells": {x: [v[1], v[2]] for x, v in self.lines.items()},
                "itemRows": [{r: v[0] for r, v in self.items[s].items()} for s in (0, 1)],
                "decisions": self.decisions, "intent": intent}


def stories():
    out = []

    s = Story("H01", "one transfer settles three invoices exactly", "php")
    s.pay("TT-0101", 1500000)
    s.inv("RH/5501", 700000); s.inv("RH/5502", 500250); s.inv("RH/5503", 299750)
    s.advice("RA-01", "TT-0101", "RH/5501", 700000); s.advice("RA-02", "TT-0101", "RH/5502", 500250)
    s.advice("RA-03", "TT-0101", "RH/5503", 299750)
    s.line("RA-01", "fits").line("RA-02", "fits").line("RA-03", "fits"); out.append(s)

    s = Story("H02", "two transfers ask one invoice for more than it holds", "java")
    s.pay("TT-0201", 400000); s.pay("TT-0202", 400000); s.inv("RH/5601", 600000)
    s.advice("RA-01", "TT-0201", "RH/5601", 400000); s.advice("RA-02", "TT-0202", "RH/5601", 400000)
    s.line("RA-01", "review", [CI], ["RA-02"]).line("RA-02", "review", [CI], ["RA-01"]); out.append(s)

    s = Story("H03", "a line over its transfer by one baisa", "go")
    s.pay("TT-0301", 250000); s.inv("RH/5701", 300000)
    s.advice("RA-01", "TT-0301", "RH/5701", 250001)
    s.line("RA-01", "review", [OP]); out.append(s)

    s = Story("H04", "twins whose line IDs differ only in case", "perl")
    s.pay("TT-0401", 1000000); s.inv("RH/5801", 1000000)
    s.advice("ra-7", "TT-0401", "RH/5801", 200000); s.advice("RA-7", "TT-0401", "RH/5801", 200000)
    s.line("ra-7", "review", [TW], twins=["RA-7"]).line("RA-7", "review", [TW], twins=["ra-7"]); out.append(s)

    s = Story("H05", "an approved line and its open twin", ["php", "java", "go"])
    s.pay("TT-0501", 500000); s.inv("RH/5901", 500000)
    s.advice("RA-01", "TT-0501", "RH/5901", 300000); s.advice("RA-02", "TT-0501", "RH/5901", 300000)
    s.remit("D1", ["RA-01"])
    s.line("RA-01", "allocated", twins=["RA-02"]).line("RA-02", "review", [OP, OI, TW], twins=["RA-01"])
    out.append(s)

    s = Story("H06", "an external confirmation takes most of a transfer", "calc")
    s.pay("TT-0601", 800000); s.pay("TT-0602", 300000); s.inv("RH/6001", 500000); s.inv("RH/6002", 400000)
    s.advice("RA-01", "TT-0601", "RH/6002", 400000); s.advice("RA-02", "TT-0602", "RH/6001", 50000)
    s.advice("RA-03", "TT-0602", "RH/6002", 250000)
    s.human("D1", [("TT-0601", "RH/6001", 450000)])
    s.line("RA-01", "review", [OP, CI], ["RA-03"]).line("RA-02", "fits")
    s.line("RA-03", "review", [CI], ["RA-01"]); out.append(s)

    s = Story("H07", "LibreOffice XLSX: two lines compete for a transfer, in dirhams", "lo-xlsx", currency="AED")
    s.pay("TT-0701", 120000); s.inv("RH/6101", 80000); s.inv("RH/6102", 70000)
    s.advice("RA-01", "TT-0701", "RH/6101", 80000); s.advice("RA-02", "TT-0701", "RH/6102", 70000)
    s.line("RA-01", "review", [CP], ["RA-02"]).line("RA-02", "review", [CP], ["RA-01"]); out.append(s)

    s = Story("H08", "LibreOffice XLSX advice with a hidden line", ["php", "php", "lo-xlsx"])
    s.pay("TT-0801", 300000); s.inv("RH/6201", 300000)
    s.advice("RA-01", "TT-0801", "RH/6201", 300000)
    s.hide(2, s.advice("RA-02", "TT-0801", "RH/6201", 100000))
    s.refuse("SOURCE_ERRORS"); out.append(s)

    s = Story("H09", "approved, undone, and the other line approved instead", "java")
    s.pay("TT-0901", 500000); s.inv("RH/6301", 300000); s.inv("RH/6302", 300000)
    s.advice("RA-01", "TT-0901", "RH/6301", 300000); s.advice("RA-02", "TT-0901", "RH/6302", 300000)
    s.remit("D1", ["RA-01"]).undo("D2", "D1").remit("D3", ["RA-02"])
    s.line("RA-01", "review", [OP]).line("RA-02", "allocated"); out.append(s)

    s = Story("H10", "one line crowded on its transfer and its invoice", "go")
    s.pay("TT-1001", 600000); s.pay("TT-1002", 600000); s.inv("RH/6401", 500000); s.inv("RH/6402", 500000)
    s.advice("RA-01", "TT-1001", "RH/6401", 400000); s.advice("RA-02", "TT-1001", "RH/6402", 300000)
    s.advice("RA-03", "TT-1002", "RH/6401", 200000)
    s.line("RA-01", "review", [CP, CI], ["RA-02", "RA-03"]).line("RA-02", "review", [CP], ["RA-01"])
    s.line("RA-03", "review", [CI], ["RA-01"]); out.append(s)

    s = Story("H11", "extended Arabic-Indic digits in a transfer's amounts", "perl")
    persian = "\u06f9\u06f0\u06f0.\u06f0\u06f0\u06f0"
    s.pay("TT-1101", 900000, text=[persian, persian]); s.inv("RH/6501", 600000); s.inv("RH/6502", 300000)
    s.advice("RA-01", "TT-1101", "RH/6501", 600000); s.advice("RA-02", "TT-1101", "RH/6502", 300000)
    s.line("RA-01", "fits").line("RA-02", "fits"); out.append(s)

    s = Story("H12", "an Arabic party and ledger, every file's columns in another order", "calc",
              party="\u0645\u062e\u062a\u0628\u0631\u0627\u062a \u0627\u0644\u062e\u0644\u064a\u062c "
                    "\u0644\u0644\u0643\u0648\u0627\u0634\u0641",
              ledger="\u062d\u0633\u0627\u0628\u0627\u062a \u0627\u0644\u0645\u0648\u0631\u062f\u064a\u0646")
    s.pay("TT-1201", 500000); s.inv("RH/6601", 200000); s.inv("RH/6602", 300000)
    s.advice("RA-01", "TT-1201", "RH/6601", 200000); s.advice("RA-02", "TT-1201", "RH/6602", 350000)
    s.order(0, ["Available amount", "Payment ID", *reversed(META), "Original amount", "Payment date"])
    s.order(1, ["Invoice date", "Invoice ID", "Available amount", "Original amount", *META])
    s.order(2, ["Allocation amount", "Invoice ID", "Payment ID", "Advice line ID", *META])
    s.line("RA-01", "review", [CP], ["RA-02"]).line("RA-02", "review", [OI, CP], ["RA-01"]); out.append(s)

    s = Story("H13", "an invoice part-paid before the snapshot, and a line asking its original", "php")
    s.pay("TT-1301", 1000000); s.inv("RH/6701", 900000, 400000); s.inv("RH/6702", 100000)
    s.advice("RA-01", "TT-1301", "RH/6701", 900000); s.advice("RA-02", "TT-1301", "RH/6702", 100000)
    s.line("RA-01", "review", [OI]).line("RA-02", "fits"); out.append(s)

    s = Story("H14", "a transfer with nothing left", "java")
    s.pay("TT-1401", 500000, 0); s.inv("RH/6801", 200000)
    s.advice("RA-01", "TT-1401", "RH/6801", 200000)
    s.line("RA-01", "review", [OP]); out.append(s)

    s = Story("H15", "eleven lines fill a transfer exactly, a twelfth asks for one baisa", "go")
    s.pay("TT-1501", 1100000)
    ids = []
    for k in range(1, 13):
        s.inv(f"RH/69{k:02d}", 100000)
    for k in range(1, 12):
        s.advice(f"RA-{k:02d}", "TT-1501", f"RH/69{k:02d}", 100000); ids.append(f"RA-{k:02d}")
    s.advice("RA-12", "TT-1501", "RH/6912", 1); ids.append("RA-12")
    for x in ids:
        s.line(x, "review", [CP], [y for y in ids if y != x])
    out.append(s)

    s = Story("H16", "yen without minor units, two lines over one transfer", "perl", currency="JPY")
    s.pay("TT-1601", 50000); s.inv("RH/7001", 30000); s.inv("RH/7002", 30000)
    s.advice("RA-01", "TT-1601", "RH/7001", 30000); s.advice("RA-02", "TT-1601", "RH/7002", 30000)
    s.line("RA-01", "review", [CP], ["RA-02"]).line("RA-02", "review", [CP], ["RA-01"]); out.append(s)

    s = Story("H17", "one advice line ID on two lines", "calc")
    s.pay("TT-1701", 500000); s.inv("RH/7101", 200000); s.inv("RH/7102", 300000)
    s.advice("RA-01", "TT-1701", "RH/7101", 200000)
    s.rows[2].append(["RA-01", *s.meta(), "TT-1701", "RH/7102", "300.000"])
    s.refuse("SOURCE_ERRORS"); out.append(s)

    s = Story("H18", "an advice line naming a transfer that is not in the file", "php")
    s.pay("TT-1801", 500000); s.inv("RH/7201", 500000)
    s.advice("RA-01", "TT-1801", "RH/7201", 400000); s.advice("RA-02", "TT-9999", "RH/7201", 100000)
    s.refuse("SOURCE_ERRORS"); out.append(s)

    s = Story("H19", "an advice amount to four places of a baisa", "java")
    s.pay("TT-1901", 500000); s.inv("RH/7301", 500000)
    s.advice("RA-01", "TT-1901", "RH/7301", 10000, text="10.0005")
    s.refuse("SOURCE_ERRORS"); out.append(s)

    s = Story("H20", "an invoice dated the day after the leap-day cut-off", "go")
    s.pay("TT-2001", 500000); s.inv("RH/7401", 500000, date="2028-03-01")
    s.advice("RA-01", "TT-2001", "RH/7401", 500000)
    s.refuse("SOURCE_ERRORS"); out.append(s)

    s = Story("H21", "an advice line ID that begins with an equals sign", "perl")
    s.pay("TT-2101", 500000); s.inv("RH/7501", 500000)
    s.advice("=RA-01", "TT-2101", "RH/7501", 500000)
    s.refuse("SOURCE_ERRORS"); out.append(s)

    s = Story("H22", "an advice file without its invoice column", "php")
    s.pay("TT-2201", 500000); s.inv("RH/7601", 500000)
    s.advice("RA-01", "TT-2201", "RH/7601", 500000)
    s.drop(2, "Invoice ID")
    s.refuse("COLUMNS"); out.append(s)

    s = Story("H23", "a session whose confirmation takes more than the transfer holds", "java")
    s.pay("TT-2301", 500000); s.inv("RH/7701", 800000)
    s.advice("RA-01", "TT-2301", "RH/7701", 100000)
    s.human("D1", [("TT-2301", "RH/7701", 600000)])
    s.refuse("OVER_AVAILABLE"); out.append(s)

    s = Story("H24", "LibreOffice XLSX with blank rows between the advice lines", "lo-xlsx", currency="AED")
    s.pay("TT-2401", 100000); s.pay("TT-2402", 50000); s.inv("RH/7801", 60000); s.inv("RH/7802", 40000)
    s.advice("RA-01", "TT-2401", "RH/7801", 60000); s.blank(2)
    s.advice("RA-02", "TT-2402", "RH/7801", 20000); s.blank(2)
    s.advice("RA-03", "TT-2401", "RH/7802", 40000)
    s.line("RA-01", "review", [CI], ["RA-02"]).line("RA-02", "review", [CI], ["RA-01"]).line("RA-03", "fits")
    out.append(s)

    s = Story("H25", "the same transfer and invoice for another amount, and the same amount elsewhere", "calc")
    s.pay("TT-2501", 1000000); s.inv("RH/7901", 600000); s.inv("RH/7902", 600000)
    s.advice("RA-01", "TT-2501", "RH/7901", 200000); s.advice("RA-02", "TT-2501", "RH/7901", 250000)
    s.advice("RA-03", "TT-2501", "RH/7902", 200000)
    s.line("RA-01", "fits").line("RA-02", "fits").line("RA-03", "fits"); out.append(s)

    s = Story("H26", "an invoice dated on the leap day, and two twins approved in one decision", "go")
    s.pay("TT-2601", 600000); s.inv("RH/8001", 600000, date="2028-02-29")
    s.advice("RA-01", "TT-2601", "RH/8001", 300000); s.advice("RA-02", "TT-2601", "RH/8001", 300000)
    s.remit("D1", ["RA-01", "RA-02"])
    s.line("RA-01", "allocated", twins=["RA-02"]).line("RA-02", "allocated", twins=["RA-01"]); out.append(s)

    s = Story("H27", "a session undoing a decision it does not hold", "perl")
    s.pay("TT-2701", 500000); s.inv("RH/8101", 500000)
    s.advice("RA-01", "TT-2701", "RH/8101", 500000)
    s.remit("D1", ["RA-01"]).undo("D2", "D9")
    s.refuse("UNDO"); out.append(s)

    s = Story("H28", "a transfer dated on a day not in the calendar, beside a decision", "calc")
    s.pay("TT-2801", 500000); s.pay("TT-2802", 200000, date="2028-02-30"); s.inv("RH/8201", 500000)
    s.advice("RA-01", "TT-2801", "RH/8201", 500000)
    s.remit("D1", ["RA-01"])
    s.refuse("SOURCE_ERRORS"); out.append(s)

    return out


if __name__ == "__main__":
    data = {"schema": "tarasuf-all1-h1-stories/1", "synthetic": True,
            "stories": [s.to_json() for s in stories()]}
    sys.stdout.write(json.dumps(data, ensure_ascii=False, indent=1) + "\n")
