"""INV-3 holdout H1: a marine spares stockist's four inventory files per
story, from a lineage that imports nothing from the foundation, and the intent
written by hand: every register row linked or unlinked with its reasons, every
other unlinked record, and the financial outcome.

    python3 -B audit/inventory-links-holdout-h1/stories.py > frozen/stories.json
"""
import json
import sys

SCOPE_ORDER = ["entity", "inventoryLedger", "glLedger", "currency", "currencyBasis", "postingStatus",
               "postingLayer", "asOf", "chartVersion", "mapVersion", "valuationPolicyVersion",
               "inventoryAccountSetVersion"]
SCOPE_NAMES = ["Entity", "Inventory ledger", "GL ledger", "Currency", "Currency basis", "Posting status",
               "Posting layer", "As of", "Chart version", "Map version", "Valuation policy version",
               "Inventory account set version"]
COLUMNS = {
    "register": ["Item ID", "Item dimensions", "Quantity", "Unit", "Quantity precision", "Posted value",
                 "Valuation reference"],
    "mapping": ["Mapping ID", "Item ID", "Item dimensions", "GL account", "GL dimensions", "Evidence ID"],
    "evidence": ["Evidence ID", "Item ID", "Item dimensions", "Unit", "Quantity precision", "Valuation reference",
                 "GL account", "GL dimensions", "Account class", "Sign", "Value basis", "Valid from", "Valid to",
                 "Reference"],
    "gl": ["GL account", "GL dimensions", "Account class", "Debit", "Credit"],
}
PLACES = {"SAR": 2, "KWD": 3, "JPY": 0}


class Book:
    def __init__(self, sid, title, currency="SAR", entity="Synthetic Marine Spares Trading", writer="php",
                 writers=None, order=None):
        self.id, self.title = sid, title
        self.scope = dict(zip(SCOPE_ORDER, [entity, f"MS-STOCK-{sid}", f"MS-GL-{sid}", currency, "functional",
                                            "posted", "Quarter close", "2027-06-30", "MS-COA-3", f"MS-MAP-{sid}",
                                            "MS-VAL-2", "MS-SET-1"]))
        self.places = PLACES[currency]
        self.writers = writers or {r: writer for r in COLUMNS}
        self.order = order or {}
        self.rows = {r: [] for r in COLUMNS}
        self.links, self.unlinked, self.financial = [], [], None
        self.sums = {}

    def amount(self, minor):
        if not self.places:
            return str(minor)
        return f"{minor // 10 ** self.places}.{minor % 10 ** self.places:0{self.places}d}"

    def add(self, item, dims, minor, unit="pcs", precision="0", qty="3", ref=None, account="14100",
            account_dims="port=DMM", mapping=True, evidence=True, policy=None, why=None, mid=None, eid=None):
        """One register row with its own mapping and evidence unless told
        otherwise; `why` is the hand-written reason list, None when linked."""
        n = len(self.rows["register"]) + 1
        ref = ref or f"VAL-{n:03d}"
        mid, eid = mid or f"MAP-{self.id}-{n:03d}", eid or f"POL-{self.id}-{n:03d}"
        self.rows["register"].append([item, dims, qty, unit, precision, self.amount(minor), ref])
        if mapping:
            self.rows["mapping"].append([mid, item, dims, account, account_dims, eid])
        if evidence:
            e = {"Evidence ID": eid, "Item ID": item, "Item dimensions": dims, "Unit": unit,
                 "Quantity precision": precision, "Valuation reference": ref, "GL account": account,
                 "GL dimensions": account_dims, "Account class": "inventory", "Sign": "debit-positive",
                 "Value basis": "provided-posted-carrying-value", "Valid from": "2027-01-01",
                 "Valid to": "2027-12-31", "Reference": f"MS-POLICY-{n:03d}"}
            e.update(policy or {})
            self.rows["evidence"].append([e[c] for c in COLUMNS["evidence"]])
        self.links.append([n + 1, "unlinked" if why else "linked", why or []])
        if not why:
            self.sums[(account, account_dims)] = self.sums.get((account, account_dims), 0) + minor
        return self

    def gl(self, account, dims, minor=None, offset=0):
        value = self.sums.get((account, dims), 0) + offset if minor is None else minor
        self.rows["gl"].append([account, dims, "inventory", self.amount(value), self.amount(0)])
        return self

    def all_gl(self, offsets=None):
        for key in list(self.sums):
            self.gl(*key, offset=(offsets or {}).get(key, 0))
        return self

    def to_json(self):
        files = {}
        for role, cols in COLUMNS.items():
            header = cols + SCOPE_NAMES
            body = [r + [self.scope[k] for k in SCOPE_ORDER] if len(r) == len(cols) else r
                    for r in self.rows[role]]
            order = self.order.get(role)
            if order:
                header = [header[i] for i in order]
                body = [[r[i] for i in order] for r in body]
            files[role] = {"name": f"{self.id}-{role}.csv", "writer": self.writers[role], "cells": [header] + body}
        return {"id": self.id, "title": self.title, "scope": self.scope, "files": files,
                "intent": {"financial": self.financial, "links": self.links, "unlinked": self.unlinked}}


def stories():
    out = []
    b = Book("K01", "every row linked, three accounts, an Arabic entity", entity="شركة قطع الغيار البحرية الاصطناعية")
    b.add("IMP-220", "port=DMM;rack=1", 412550).add("IMP-220", "port=JED;rack=4", 98000, account="14200",
                                                       account_dims="port=JED")
    b.add("SEAL-9", "port=DMM;rack=2", 15025, unit="set", account="14300")
    b.all_gl(); b.financial = "ready"; out.append(b)

    b = Book("K02", "12.0 is not 12", writer="java")
    b.add("12", "port=DMM", 5000).add("12.0", "port=DMM", 7000, mapping=False, evidence=False, why=["NO_MAPPING"])
    b.rows["mapping"].append(["MAP-K02-X", "12", "port=JED", "14100", "port=DMM", "POL-K02-001"])
    b.all_gl(); b.financial = "missing"
    b.unlinked = [["mapping", 3, "MAP-K02-X", "NO_REGISTER"]]
    out.append(b)

    b = Book("K03", "two mappings naming two accounts", writer="go")
    b.add("BELT-3", "port=DMM", 2300).add("BELT-4", "port=DMM", 4100, why=["MAPPINGS"])
    b.rows["mapping"].append(["MAP-K03-ALT", "BELT-4", "port=DMM", "14900", "port=DMM", "POL-K03-002"])
    b.all_gl(); b.financial = "source-error"; out.append(b)

    b = Book("K04", "the mapping names policy evidence nobody supplied", writer="perl")
    b.add("PUMP-1", "port=DMM", 66000).add("PUMP-2", "port=DMM", 31000, evidence=False, why=["NO_EVIDENCE"])
    b.all_gl(); b.financial = "missing"; out.append(b)

    b = Book("K05", "the same evidence row twice", writer="calc")
    b.add("VALVE-5", "port=DMM", 900).add("VALVE-6", "port=DMM", 1200, why=["EVIDENCES"])
    b.rows["evidence"].append(list(b.rows["evidence"][-1]))
    b.all_gl(); b.financial = "source-error"; out.append(b)

    b = Book("K06", "kg is not KG", writer="php")
    b.add("ROPE-40", "port=DMM", 18000, unit="kg", qty="12.5", precision="1",
          policy={"Unit": "KG"}, why=["EVIDENCE_UNIT"])
    b.add("ROPE-41", "port=DMM", 9000, unit="kg", qty="6.25", precision="2")
    b.all_gl(); b.financial = "missing"; out.append(b)

    b = Book("K07", "the evidence is for last quarter's precision and valuation", writer="java")
    b.add("FUEL-F", "port=DMM", 77777, unit="L", qty="400.125", precision="3", ref="VAL-Q2",
          policy={"Quantity precision": "2", "Valuation reference": "VAL-Q1"},
          why=["EVIDENCE_PRECISION", "EVIDENCE_VALUATION"])
    b.add("FUEL-G", "port=DMM", 1000)
    b.all_gl(); b.financial = "missing"; out.append(b)

    b = Book("K08", "branch=1 is not branch=01", writer="go")
    b.add("CHAIN-8", "port=DMM", 4400, account_dims="branch=1", policy={"GL dimensions": "branch=01"},
          why=["EVIDENCE_ACCOUNT_DIMENSIONS"])
    b.add("CHAIN-9", "port=DMM", 3300)
    b.all_gl(); b.financial = "missing"; out.append(b)

    b = Book("K09", "PUMP-07 named by evidence for PUMP-7", writer="perl")
    b.add("PUMP-07", "port=DMM", 21000, ref="VAL-P7", policy={"Item ID": "PUMP-7"}, why=["EVIDENCE_ITEM"])
    b.add("PUMP-08", "port=DMM", 21000)
    b.all_gl(); b.financial = "missing"; out.append(b)

    b = Book("K10", "every kind of unlinked record at once", writer="calc")
    b.add("HOSE-1", "port=DMM", 1500).add("HOSE-2", "port=DMM", 2500, account="14500")
    b.rows["mapping"].append(["MAP-K10-X", "HOSE-99", "port=DMM", "14100", "port=DMM", "POL-K10-001"])
    b.rows["evidence"].append(["POL-K10-X", "HOSE-98", "port=DMM", "pcs", "0", "VAL-X", "14100", "port=DMM",
                               "inventory", "debit-positive", "provided-posted-carrying-value", "2027-01-01",
                               "2027-12-31", "MS-POLICY-X"])
    b.gl("14100", "port=DMM").gl("14800", "port=DMM", minor=600)
    b.financial = "missing"
    b.unlinked = [["mapping", 4, "MAP-K10-X", "NO_REGISTER"], ["evidence", 4, "POL-K10-X", "NO_MAPPING"],
                  ["gl", 3, "14800|port=DMM", "NO_LINKED_REGISTER"], ["account", None, "14500|port=DMM", "NO_GL_RECORD"]]
    out.append(b)

    b = Book("K11", "dimensions holding commas and quotes", writer="php")
    b.add("FLARE-2", 'bay="A",row=2', 6200).add("FLARE-3", "w=A,B", 3100)
    b.add("FLARE-4", "w=A, B", 1000, mapping=False, evidence=False, why=["NO_MAPPING"])
    b.all_gl(); b.financial = "missing"; out.append(b)

    rev = lambda role: list(reversed(range(len(COLUMNS[role]) + 12)))
    b = Book("K12", "yen, every column in another order", currency="JPY", writer="java",
             order={r: rev(r) for r in COLUMNS})
    b.add("BUOY-1", "port=TYO", 450000).add("BUOY-2", "port=TYO", 12000, ref="VAL-B2",
                                              policy={"Valuation reference": "VAL-B2-OLD"}, why=["EVIDENCE_VALUATION"])
    b.all_gl(); b.financial = "missing"; out.append(b)

    b = Book("K13", "policy evidence that has expired is no evidence", writer="go")
    b.add("ANCHOR-1", "port=DMM", 990000)
    b.add("ANCHOR-2", "port=DMM", 880000, evidence=False, why=["NO_EVIDENCE"])
    expired = ["POL-K13-002", "ANCHOR-2", "port=DMM", "pcs", "0", "VAL-002", "14100", "port=DMM", "inventory",
               "debit-positive", "provided-posted-carrying-value", "2026-01-01", "2026-12-31", "MS-POLICY-OLD"]
    b.rows["evidence"].append(expired)
    b.all_gl(); b.financial = "source-error"; out.append(b)

    b = Book("K14", "1,200 items in dinars, one in twenty-five unlinked", currency="KWD", writer="perl")
    for k in range(1200):
        code, dims = f"MS{k:05d}", f"port=DMM;bin={k % 37};lot=L{k % 11}"
        if k % 75 == 74:
            b.add(code, dims, 5000 + k, mapping=False, evidence=False, why=["NO_MAPPING"])
        elif k % 75 == 49:
            b.add(code, dims, 5000 + k, unit="box", policy={"Unit": "pcs"}, why=["EVIDENCE_UNIT"])
        elif k % 75 == 24:
            b.add(code, dims, 5000 + k, evidence=False, why=["NO_EVIDENCE"])
        else:
            b.add(code, dims, 5000 + k, account=f"14{k % 9}00")
    b.all_gl(); b.financial = "missing"; out.append(b)

    b = Book("K15", "Arabic codes, and 0071 beside 071", writer="calc", entity="مؤسسة المرافئ الاصطناعية")
    b.add("صمام-0071", "الميناء=الدمام", 8100).add("0071", "port=DMM", 2500)
    b.add("071", "port=DMM", 2600, mapping=False, evidence=False, why=["NO_MAPPING"])
    b.all_gl(); b.financial = "missing"; out.append(b)

    b = Book("K16", "one item in five bins", writer="go")
    b.add("FILTER-5", "bin=1", 1000).add("FILTER-5", "bin=2", 1100)
    b.add("FILTER-5", "bin=3", 1200, ref="VAL-B3", policy={"Valuation reference": "VAL-B3-OLD"},
          why=["EVIDENCE_VALUATION"])
    b.add("FILTER-5", "bin=4", 1300, ref="VAL-B4", policy={"Valuation reference": "VAL-B4-OLD"},
          why=["EVIDENCE_VALUATION"])
    b.add("FILTER-5", "bin=5", 1400, why=["MAPPINGS"])
    b.rows["mapping"].append(["MAP-K16-ALT", "FILTER-5", "bin=5", "14100", "port=DMM", "POL-K16-005"])
    b.all_gl(); b.financial = "source-error"; out.append(b)

    b = Book("K17", "the evidence names 14200 where the mapping names 14100", writer="php")
    b.add("GASKET-1", "port=DMM", 3300, policy={"GL account": "14200"}, why=["EVIDENCE_ACCOUNT"])
    b.add("GASKET-2", "port=DMM", 4400)
    b.all_gl(); b.financial = "missing"; out.append(b)

    b = Book("K18", "evidence for bay=02, the register's bay=2", writer="java")
    b.add("LAMP-3", "port=DMM;bay=2", 2750, policy={"Item dimensions": "port=DMM;bay=02"},
          why=["EVIDENCE_DIMENSIONS"])
    b.add("LAMP-4", "port=DMM;bay=2", 1250)
    b.all_gl(); b.financial = "missing"; out.append(b)

    b = Book("K19", "every evidence field differs at once", writer="go")
    b.add("RADAR-1", "port=DMM", 990000, ref="VAL-R1",
          policy={"Item ID": "RADAR-01", "Item dimensions": "port=JED", "Unit": "set", "Quantity precision": "1",
                  "Valuation reference": "VAL-R0", "GL account": "14999", "GL dimensions": "port=JED"},
          why=["EVIDENCE_ITEM", "EVIDENCE_DIMENSIONS", "EVIDENCE_UNIT", "EVIDENCE_PRECISION", "EVIDENCE_VALUATION",
               "EVIDENCE_ACCOUNT", "EVIDENCE_ACCOUNT_DIMENSIONS"])
    b.add("RADAR-2", "port=DMM", 10000)
    b.all_gl(); b.financial = "missing"; out.append(b)

    b = Book("K20", "the GL writes port=dmm", writer="perl")
    b.add("CABLE-1", "port=DMM", 6400).add("CABLE-2", "port=DMM", 3600, account="14200")
    b.gl("14100", "port=dmm", minor=6400).gl("14200", "port=DMM")
    b.financial = "missing"
    b.unlinked = [["gl", 2, "14100|port=dmm", "NO_LINKED_REGISTER"], ["account", None, "14100|port=DMM", "NO_GL_RECORD"]]
    out.append(b)

    b = Book("K21", "the only row naming 14600 is unlinked, and the GL has 14600", writer="calc")
    b.add("WINCH-1", "port=DMM", 5000)
    b.add("WINCH-2", "port=DMM", 7000, account="14600", evidence=False, why=["NO_EVIDENCE"])
    b.all_gl().gl("14600", "port=DMM", minor=7000)
    b.financial = "missing"
    b.unlinked = [["gl", 3, "14600|port=DMM", "NO_LINKED_REGISTER"]]
    out.append(b)
    return out


if __name__ == "__main__":
    json.dump({"schema": "tarasuf-inv3-h1-stories/1", "stories": [s.to_json() for s in stories()]},
              sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
