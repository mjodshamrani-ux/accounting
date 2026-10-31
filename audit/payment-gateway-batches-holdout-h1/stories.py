"""PG-1 holdout H1 stories: a food delivery marketplace's card gateway in
dirhams for March 2028, with a dinar story and a yen story, from a lineage
that imports nothing from the foundation. One review per story over five
files (gateway transactions, fee evidence, settlement rows, the gateway's
payout lines and the bank's credits), each file from its own writer, and the
intent written by hand: for every batch its status, every reason in contract
order and its members by row, for every payout its status, reasons, lines and
credit, every unlinked credit; or the refusal of the whole story. Sums are
the story's own arithmetic.

    python3 -B stories.py > frozen/stories.json
"""
import json

KINDS = ["transactions", "fees", "settlements", "payout-lines", "bank-credits"]
HEADERS = [
    ["Transaction ID", "Batch ID", "Kind", "Posting date", "Amount", "Reference", "Merchant account", "Currency"],
    ["Fee ID", "Batch ID", "Amount", "Reference", "Merchant account", "Currency"],
    ["Batch ID", "Settlement date", "Gross sales", "Refunds", "Fees", "Net", "Merchant account", "Currency"],
    ["Payout ID", "Batch ID", "Amount", "Merchant account", "Currency"],
    ["Bank reference", "Payout ID", "Value date", "Credit", "Bank account", "Currency"],
]
PLACES = {"AED": 2, "KWD": 3, "JPY": 0, "XAU": 2}
CYCLE = ["php", "java", "go", "perl", "calc"]
MERCHANT, BANK = "MER-UAE-3307", "AE07-SYN-0331"
SALES, REFUNDS, FEES, NET, SHORT, OVER, PAYOUT = "SALES", "REFUNDS", "FEES", "NET", "PAID_SHORT", "PAID_OVER", "PAYOUT"
CREDIT, MISSING = "CREDIT", "NOT_DEPOSITED"


def money(minor, places):
    if not places:
        return str(minor)
    return f"{minor // 10 ** places}.{minor % 10 ** places:0{places}d}"


class Story:
    def __init__(self, sid, title, currency="AED", writers=None, entity="Synthetic Desert Eats Marketplace LLC",
                 gateway="Synthetic NetPay Switch"):
        n = int(sid[1:])
        self.id, self.title = sid, title
        self.writers = writers or [CYCLE[(n + k) % len(CYCLE)] for k in range(5)]
        self.currency = currency
        self.places = PLACES[currency]
        self.scope = {"entity": entity, "gateway": gateway, "merchantAccount": MERCHANT, "bankAccount": BANK,
                      "currency": currency, "start": "2028-03-01", "end": "2028-03-31", "asOf": "2028-04-06",
                      "confirmed": True}
        self.headers = [list(h) for h in HEADERS]
        self.rows = [[], [], [], [], []]
        self.hidden = [[], [], [], [], []]
        self.refused = None
        self.intent_batches, self.intent_payouts, self.intent_credits = [], [], []

    def _put(self, side, cells):
        self.rows[side].append(list(cells))
        return len(self.rows[side]) + 1

    def _m(self, minor, text):
        return text if text is not None else money(minor, self.places)

    def sale(self, tid, batch, minor, date="2028-03-05", ref=None, text=None, kind="sale"):
        return self._put(0, [tid, batch, kind, date, self._m(minor, text), ref or f"Delivery order {tid}",
                             MERCHANT, self.currency])

    def refund(self, tid, batch, minor, date="2028-03-09", ref=None, text=None):
        return self.sale(tid, batch, minor, date, ref or f"Cancelled order {tid}", text, kind="refund")

    def fee(self, fid, batch, minor, ref=None, text=None):
        return self._put(1, [fid, batch, self._m(minor, text), ref or f"Acquirer charge {fid}", MERCHANT,
                             self.currency])

    def settle(self, batch, gross, refunds, fees, net=None, date="2028-03-14", text=None):
        net = gross - refunds - fees if net is None else net
        cells = text or [money(v, self.places) for v in (gross, refunds, fees, net)]
        return self._put(2, [batch, date, *cells, MERCHANT, self.currency])

    def line(self, payout, batch, minor, text=None):
        return self._put(3, [payout, batch, self._m(minor, text), MERCHANT, self.currency])

    def credit(self, ref, payout, minor, date="2028-03-17", text=None):
        return self._put(4, [ref, payout, date, self._m(minor, text), BANK, self.currency])

    def blank(self, side):
        return self._put(side, [])

    def order(self, side, headers):
        assert sorted(headers) == sorted(self.headers[side])
        at = [self.headers[side].index(h) for h in headers]
        self.headers[side] = list(headers)
        self.rows[side] = [[r[k] for k in at] if r else [] for r in self.rows[side]]
        return self

    def drop(self, side, header):
        k = self.headers[side].index(header)
        self.headers[side].pop(k)
        for r in self.rows[side]:
            if r:
                r.pop(k)
        return self

    def batch(self, row, status, reasons=(), sales=(), refunds=(), fees=(), paid=0, payouts=()):
        self.intent_batches.append([row, status, list(reasons), list(sales), list(refunds), list(fees), paid,
                                    list(payouts)])
        return self

    def payout(self, pid, status, reasons=(), lines=(), credit=None):
        self.intent_payouts.append([pid, status, list(reasons), list(lines), credit])
        return self

    def unlinked(self, row, pid):
        self.intent_credits.append([row, pid])
        return self

    def refuse(self, code):
        self.refused = code
        return self

    def to_json(self):
        names = [f"{self.id}-{k}.{'xlsx' if w == 'lo-xlsx' else 'csv'}" for k, w in zip(KINDS, self.writers)]
        if self.refused:
            intent = {"refused": self.refused, "batches": [], "payouts": [], "credits": []}
        else:
            intent = {"refused": None, "batches": self.intent_batches, "payouts": self.intent_payouts,
                      "credits": self.intent_credits}
        return {"id": self.id, "title": self.title, "writers": self.writers, "names": names, "scope": self.scope,
                "decimals": self.places, "cells": [[self.headers[s]] + self.rows[s] for s in range(5)],
                "hidden": self.hidden, "intent": intent}


def stories():
    out = []

    s = Story("H01", "three batches paid in one payout, credited in the period")
    a1 = s.sale("ORD-28030101", "STL/0301/A", 120000); a2 = s.sale("ORD-28030102", "STL/0301/A", 45050)
    a3 = s.refund("ORD-28030103", "STL/0301/A", 5050); b1 = s.sale("ORD-28030104", "STL/0301/B", 80000)
    c1 = s.sale("ORD-28030105", "STL/0301/C", 9999)
    fa = s.fee("CHG/01/001", "STL/0301/A", 3600); fb = s.fee("CHG/01/002", "STL/0301/B", 1840)
    fc = s.fee("CHG/01/003", "STL/0301/C", 300)
    ra = s.settle("STL/0301/A", 165050, 5050, 3600); rb = s.settle("STL/0301/B", 80000, 0, 1840)
    rc = s.settle("STL/0301/C", 9999, 0, 300)
    l1 = s.line("PYO-7001", "STL/0301/A", 156400); l2 = s.line("PYO-7001", "STL/0301/B", 78160)
    l3 = s.line("PYO-7001", "STL/0301/C", 9699)
    k1 = s.credit("FT2803120001", "PYO-7001", 244259, date="2028-03-12")
    s.batch(ra, "consistent", sales=[a1, a2], refunds=[a3], fees=[fa], paid=156400, payouts=["PYO-7001"])
    s.batch(rb, "consistent", sales=[b1], fees=[fb], paid=78160, payouts=["PYO-7001"])
    s.batch(rc, "consistent", sales=[c1], fees=[fc], paid=9699, payouts=["PYO-7001"])
    s.payout("PYO-7001", "consistent", lines=[l1, l2, l3], credit=k1); out.append(s)

    s = Story("H02", "one batch paid in three payouts, each credited")
    x1 = s.sale("ORD-28030201", "STL/0302", 300000); x2 = s.sale("ORD-28030202", "STL/0302", 150000)
    f1 = s.fee("CHG/02/001", "STL/0302", 9000); r = s.settle("STL/0302", 450000, 0, 9000)
    l1 = s.line("PYO-7011", "STL/0302", 200000); l2 = s.line("PYO-7012", "STL/0302", 200000)
    l3 = s.line("PYO-7013", "STL/0302", 41000)
    k1 = s.credit("FT2803100011", "PYO-7011", 200000, date="2028-03-10")
    k2 = s.credit("FT2803170012", "PYO-7012", 200000, date="2028-03-17")
    k3 = s.credit("FT2803240013", "PYO-7013", 41000, date="2028-03-24")
    s.batch(r, "consistent", sales=[x1, x2], fees=[f1], paid=441000, payouts=["PYO-7011", "PYO-7012", "PYO-7013"])
    s.payout("PYO-7011", "consistent", lines=[l1], credit=k1)
    s.payout("PYO-7012", "consistent", lines=[l2], credit=k2)
    s.payout("PYO-7013", "consistent", lines=[l3], credit=k3); out.append(s)

    s = Story("H03", "two batches crossing two payouts")
    a = s.sale("ORD-28030301", "STL/0303/A", 100000); b = s.sale("ORD-28030302", "STL/0303/B", 50000)
    ra = s.settle("STL/0303/A", 100000, 0, 0); rb = s.settle("STL/0303/B", 50000, 0, 0)
    l1 = s.line("PYO-7021", "STL/0303/A", 60000); l2 = s.line("PYO-7022", "STL/0303/A", 40000)
    l3 = s.line("PYO-7022", "STL/0303/B", 50000)
    k1 = s.credit("FT2803150021", "PYO-7021", 60000); k2 = s.credit("FT2803160022", "PYO-7022", 90000)
    s.batch(ra, "consistent", sales=[a], paid=100000, payouts=["PYO-7021", "PYO-7022"])
    s.batch(rb, "consistent", sales=[b], paid=50000, payouts=["PYO-7022"])
    s.payout("PYO-7021", "consistent", lines=[l1], credit=k1)
    s.payout("PYO-7022", "consistent", lines=[l2, l3], credit=k2); out.append(s)

    s = Story("H04", "a sale written under the other batch: the payout is right, both batches are not")
    a1 = s.sale("ORD-28030401", "STL/0304/A", 70000); a2 = s.sale("ORD-28030402", "STL/0304/B", 30000)
    b1 = s.sale("ORD-28030403", "STL/0304/B", 20000); fa = s.fee("CHG/04/001", "STL/0304/A", 2000)
    ra = s.settle("STL/0304/A", 100000, 0, 2000); rb = s.settle("STL/0304/B", 20000, 0, 0)
    l1 = s.line("PYO-7031", "STL/0304/A", 98000); l2 = s.line("PYO-7031", "STL/0304/B", 20000)
    k1 = s.credit("FT2803180031", "PYO-7031", 118000)
    s.batch(ra, "review", [SALES], sales=[a1], fees=[fa], paid=98000, payouts=["PYO-7031"])
    s.batch(rb, "review", [SALES], sales=[a2, b1], paid=20000, payouts=["PYO-7031"])
    s.payout("PYO-7031", "consistent", lines=[l1, l2], credit=k1); out.append(s)

    s = Story("H05", "a refund for another amount than the settlement row's refunds")
    x = s.sale("ORD-28030501", "STL/0305", 50000); y = s.refund("ORD-28030502", "STL/0305", 7000)
    f = s.fee("CHG/05/001", "STL/0305", 1000); r = s.settle("STL/0305", 50000, 7500, 1000)
    l = s.line("PYO-7041", "STL/0305", 41500); k = s.credit("FT2803190041", "PYO-7041", 41500)
    s.batch(r, "review", [REFUNDS], sales=[x], refunds=[y], fees=[f], paid=41500, payouts=["PYO-7041"])
    s.payout("PYO-7041", "consistent", lines=[l], credit=k); out.append(s)

    s = Story("H06", "one of two charges without its evidence")
    x = s.sale("ORD-28030601", "STL/0306", 80000); f = s.fee("CHG/06/001", "STL/0306", 1200)
    r = s.settle("STL/0306", 80000, 0, 2400)
    l = s.line("PYO-7051", "STL/0306", 77600); k = s.credit("FT2803190051", "PYO-7051", 77600)
    s.batch(r, "review", [FEES], sales=[x], fees=[f], paid=77600, payouts=["PYO-7051"])
    s.payout("PYO-7051", "consistent", lines=[l], credit=k); out.append(s)

    s = Story("H07", "a settlement row whose net is not its own arithmetic")
    x = s.sale("ORD-28030701", "STL/0307", 60000); f = s.fee("CHG/07/001", "STL/0307", 1500)
    r = s.settle("STL/0307", 60000, 0, 1500, net=58600)
    l = s.line("PYO-7061", "STL/0307", 58600); k = s.credit("FT2803200061", "PYO-7061", 58600)
    s.batch(r, "review", [NET], sales=[x], fees=[f], paid=58600, payouts=["PYO-7061"])
    s.payout("PYO-7061", "consistent", lines=[l], credit=k); out.append(s)

    s = Story("H08", "the payout pays less than the net, and the bank received what it paid")
    x = s.sale("ORD-28030801", "STL/0308", 90000); r = s.settle("STL/0308", 90000, 0, 0)
    l = s.line("PYO-7071", "STL/0308", 89000); k = s.credit("FT2803200071", "PYO-7071", 89000)
    s.batch(r, "review", [SHORT], sales=[x], paid=89000, payouts=["PYO-7071"])
    s.payout("PYO-7071", "consistent", lines=[l], credit=k); out.append(s)

    s = Story("H09", "the payout pays more than the net")
    x = s.sale("ORD-28030901", "STL/0309", 40000); r = s.settle("STL/0309", 40000, 0, 0)
    l = s.line("PYO-7081", "STL/0309", 40100); k = s.credit("FT2803210081", "PYO-7081", 40100)
    s.batch(r, "review", [OVER], sales=[x], paid=40100, payouts=["PYO-7081"])
    s.payout("PYO-7081", "consistent", lines=[l], credit=k); out.append(s)

    s = Story("H10", "the bank received ten fils less than the payout lines")
    x = s.sale("ORD-28031001", "STL/0310", 70000); r = s.settle("STL/0310", 70000, 0, 0)
    l = s.line("PYO-7091", "STL/0310", 70000); k = s.credit("FT2803210091", "PYO-7091", 69990)
    s.batch(r, "review", [PAYOUT], sales=[x], paid=70000, payouts=["PYO-7091"])
    s.payout("PYO-7091", "review", [CREDIT], lines=[l], credit=k); out.append(s)

    s = Story("H11", "one payout never credited, beside one that was")
    a = s.sale("ORD-28031101", "STL/0311/A", 25000); b = s.sale("ORD-28031102", "STL/0311/B", 12500)
    ra = s.settle("STL/0311/A", 25000, 0, 0); rb = s.settle("STL/0311/B", 12500, 0, 0)
    l1 = s.line("PYO-7101", "STL/0311/A", 25000); l2 = s.line("PYO-7102", "STL/0311/B", 12500)
    k2 = s.credit("FT2803220102", "PYO-7102", 12500)
    s.batch(ra, "review", [PAYOUT], sales=[a], paid=25000, payouts=["PYO-7101"])
    s.batch(rb, "consistent", sales=[b], paid=12500, payouts=["PYO-7102"])
    s.payout("PYO-7101", "review", [MISSING], lines=[l1])
    s.payout("PYO-7102", "consistent", lines=[l2], credit=k2); out.append(s)

    s = Story("H12", "a payout credited on 2 April, after the period and before the as-of date")
    a = s.sale("ORD-28031201", "STL/0312/A", 33000); b = s.sale("ORD-28031202", "STL/0312/B", 10000)
    ra = s.settle("STL/0312/A", 33000, 0, 0, date="2028-03-30"); rb = s.settle("STL/0312/B", 10000, 0, 0)
    l1 = s.line("PYO-7111", "STL/0312/A", 33000); l2 = s.line("PYO-7112", "STL/0312/B", 10000)
    k1 = s.credit("FT2804020111", "PYO-7111", 33000, date="2028-04-02")
    k2 = s.credit("FT2803230112", "PYO-7112", 10000, date="2028-03-31")
    s.batch(ra, "in-transit", sales=[a], paid=33000, payouts=["PYO-7111"])
    s.batch(rb, "consistent", sales=[b], paid=10000, payouts=["PYO-7112"])
    s.payout("PYO-7111", "in-transit", lines=[l1], credit=k1)
    s.payout("PYO-7112", "consistent", lines=[l2], credit=k2); out.append(s)

    s = Story("H13", "a late credit for another amount is not in transit")
    x = s.sale("ORD-28031301", "STL/0313", 33000); r = s.settle("STL/0313", 33000, 0, 0, date="2028-03-30")
    l = s.line("PYO-7121", "STL/0313", 33000)
    k = s.credit("FT2804030121", "PYO-7121", 32900, date="2028-04-03")
    s.batch(r, "review", [PAYOUT], sales=[x], paid=33000, payouts=["PYO-7121"])
    s.payout("PYO-7121", "review", [CREDIT], lines=[l], credit=k); out.append(s)

    s = Story("H14", "a bank credit no payout line names, for the same amount as a real payout")
    x = s.sale("ORD-28031401", "STL/0314", 21000); r = s.settle("STL/0314", 21000, 0, 0)
    l = s.line("PYO-7131", "STL/0314", 21000); k = s.credit("FT2803240131", "PYO-7131", 21000)
    u = s.credit("FT2803250199", "PYO-7199", 21000, date="2028-03-25")
    s.batch(r, "consistent", sales=[x], paid=21000, payouts=["PYO-7131"])
    s.payout("PYO-7131", "consistent", lines=[l], credit=k); s.unlinked(u, "PYO-7199"); out.append(s)

    s = Story("H15", "one batch with four reasons, in the contract's order")
    x = s.sale("ORD-28031501", "STL/0315", 100000); f = s.fee("CHG/15/001", "STL/0315", 1500)
    r = s.settle("STL/0315", 101000, 0, 2000)
    l = s.line("PYO-7141", "STL/0315", 98000); k = s.credit("FT2803260141", "PYO-7141", 97000)
    s.batch(r, "review", [SALES, FEES, SHORT, PAYOUT], sales=[x], fees=[f], paid=98000, payouts=["PYO-7141"])
    s.payout("PYO-7141", "review", [CREDIT], lines=[l], credit=k); out.append(s)

    s = Story("H16", "Kuwaiti dinars to three places, with Arabic-Indic and extended Arabic-Indic digits",
              currency="KWD")
    x1 = s.sale("ORD-28031601", "STL/0316", 12500, text="\u0661\u0662\u066b\u0665\u0660\u0660")
    x2 = s.sale("ORD-28031602", "STL/0316", 7250, text="\u0667\u066b\u0662\u0665\u0660")
    f = s.fee("CHG/16/001", "STL/0316", 250, text="\u06f0\u066b\u06f2\u06f5\u06f0")
    r = s.settle("STL/0316", 19750, 0, 250)
    l = s.line("PYO-7151", "STL/0316", 19500)
    k = s.credit("FT2803270151", "PYO-7151", 19500, text="\u0661\u0669\u066b\u0665\u0660\u0660")
    s.batch(r, "consistent", sales=[x1, x2], fees=[f], paid=19500, payouts=["PYO-7151"])
    s.payout("PYO-7151", "consistent", lines=[l], credit=k); out.append(s)

    s = Story("H17", "yen without minor units, and a zero charge written out", currency="JPY")
    x = s.sale("ORD-28031701", "STL/0317/A", 120000); y = s.refund("ORD-28031702", "STL/0317/A", 5000)
    f1 = s.fee("CHG/17/001", "STL/0317/A", 3480); b = s.sale("ORD-28031703", "STL/0317/B", 900)
    f2 = s.fee("CHG/17/002", "STL/0317/B", 0)
    ra = s.settle("STL/0317/A", 120000, 5000, 3480); rb = s.settle("STL/0317/B", 900, 0, 0)
    l1 = s.line("PYO-7161", "STL/0317/A", 111520); l2 = s.line("PYO-7161", "STL/0317/B", 900)
    k = s.credit("FT2803280161", "PYO-7161", 112420)
    s.batch(ra, "consistent", sales=[x], refunds=[y], fees=[f1], paid=111520, payouts=["PYO-7161"])
    s.batch(rb, "consistent", sales=[b], fees=[f2], paid=900, payouts=["PYO-7161"])
    s.payout("PYO-7161", "consistent", lines=[l1, l2], credit=k); out.append(s)

    s = Story("H18", "every file's columns in another order, an Arabic entity, gateway and references",
              entity="\u0634\u0631\u0643\u0629 \u0635\u062d\u0631\u0627\u0621 \u0644\u0644\u0645\u0623\u0643\u0648\u0644\u0627\u062a (\u0627\u0635\u0637\u0646\u0627\u0639\u064a\u0629)",
              gateway="\u0628\u0648\u0627\u0628\u0629 \u0646\u062a \u0628\u0627\u064a \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064a\u0629")
    order_ref = "\u0637\u0644\u0628 \u062a\u0648\u0635\u064a\u0644"
    x = s.sale("ORD-28031801", "STL/0318", 64000, ref=order_ref)
    y = s.refund("ORD-28031802", "STL/0318", 4000, ref=order_ref)
    f = s.fee("CHG/18/001", "STL/0318", 1600, ref="\u0631\u0633\u0645 \u0627\u0644\u0645\u0639\u0627\u0644\u062c\u0629")
    r = s.settle("STL/0318", 64000, 4000, 1600)
    l = s.line("PYO-7171", "STL/0318", 58400); k = s.credit("FT2803290171", "PYO-7171", 58400)
    for side in range(5):
        s.order(side, list(reversed(HEADERS[side])))
    s.batch(r, "consistent", sales=[x], refunds=[y], fees=[f], paid=58400, payouts=["PYO-7171"])
    s.payout("PYO-7171", "consistent", lines=[l], credit=k); out.append(s)

    s = Story("H19", "five XLSX files with blank rows between the rows", writers=["lo-xlsx"] * 5)
    a = s.sale("ORD-28031901", "STL/0319/A", 30000); s.blank(0); b = s.sale("ORD-28031902", "STL/0319/B", 20000)
    fa = s.fee("CHG/19/001", "STL/0319/A", 600)
    ra = s.settle("STL/0319/A", 30000, 0, 600); rb = s.settle("STL/0319/B", 20000, 0, 0)
    l1 = s.line("PYO-7181", "STL/0319/A", 29400); s.blank(3); l2 = s.line("PYO-7181", "STL/0319/B", 20000)
    k = s.credit("FT2803300181", "PYO-7181", 49400)
    s.batch(ra, "consistent", sales=[a], fees=[fa], paid=29400, payouts=["PYO-7181"])
    s.batch(rb, "consistent", sales=[b], paid=20000, payouts=["PYO-7181"])
    s.payout("PYO-7181", "consistent", lines=[l1, l2], credit=k); out.append(s)

    s = Story("H20", "an XLSX fee file with a hidden charge", writers=["lo-xlsx"] * 5)
    s.sale("ORD-28032001", "STL/0320", 50000); s.fee("CHG/20/001", "STL/0320", 1000)
    s.hidden[1].append(s.fee("CHG/20/002", "STL/0320", 500))
    s.settle("STL/0320", 50000, 0, 1500); s.line("PYO-7191", "STL/0320", 48500)
    s.credit("FT2803300191", "PYO-7191", 48500)
    s.refuse("SOURCE_ERRORS"); out.append(s)

    s = Story("H21", "the bank file lists one reference twice")
    s.sale("ORD-28032101", "STL/0321", 15000); s.settle("STL/0321", 15000, 0, 0)
    s.line("PYO-7201", "STL/0321", 7500); s.line("PYO-7202", "STL/0321", 7500)
    s.credit("FT2803170201", "PYO-7201", 7500); s.credit("FT2803170201", "PYO-7202", 7500)
    s.refuse("SOURCE_ERRORS"); out.append(s)

    s = Story("H22", "a payout line naming a batch with no settlement row")
    s.sale("ORD-28032201", "STL/0322", 15000); s.settle("STL/0322", 15000, 0, 0)
    s.line("PYO-7211", "STL/0322", 15000); s.line("PYO-7211", "STL/0399", 500)
    s.credit("FT2803180211", "PYO-7211", 15500)
    s.refuse("SOURCE_ERRORS"); out.append(s)

    s = Story("H23", "a transaction posted on 29 February, before the period")
    s.sale("ORD-28032301", "STL/0323", 15000, date="2028-02-29"); s.settle("STL/0323", 15000, 0, 0)
    s.line("PYO-7221", "STL/0323", 15000); s.credit("FT2803180221", "PYO-7221", 15000)
    s.refuse("SOURCE_ERRORS"); out.append(s)

    s = Story("H24", "a dirham amount to three places")
    s.sale("ORD-28032401", "STL/0324", 15000, text="150.005"); s.settle("STL/0324", 15000, 0, 0)
    s.line("PYO-7231", "STL/0324", 15000); s.credit("FT2803180231", "PYO-7231", 15000)
    s.refuse("SOURCE_ERRORS"); out.append(s)

    s = Story("H25", "a transactions file without its Kind column")
    s.sale("ORD-28032501", "STL/0325", 15000); s.settle("STL/0325", 15000, 0, 0)
    s.line("PYO-7241", "STL/0325", 15000); s.credit("FT2803180241", "PYO-7241", 15000)
    s.drop(0, "Kind"); s.refuse("COLUMNS"); out.append(s)

    s = Story("H26", "a scope currency with no known minor units", currency="XAU")
    s.sale("ORD-28032601", "STL/0326", 15000); s.settle("STL/0326", 15000, 0, 0)
    s.line("PYO-7251", "STL/0326", 15000); s.credit("FT2803180251", "PYO-7251", 15000)
    s.refuse("SCOPE"); out.append(s)

    s = Story("H27", "a chargeback in the transactions file")
    s.sale("ORD-28032701", "STL/0327", 15000); s.sale("ORD-28032702", "STL/0327", 2000, kind="chargeback")
    s.settle("STL/0327", 15000, 0, 0); s.line("PYO-7261", "STL/0327", 15000)
    s.credit("FT2803180261", "PYO-7261", 15000)
    s.refuse("SOURCE_ERRORS"); out.append(s)

    s = Story("H28", "a bank credit dated the day after the as-of date")
    s.sale("ORD-28032801", "STL/0328", 15000, date="2028-03-29"); s.settle("STL/0328", 15000, 0, 0)
    s.line("PYO-7271", "STL/0328", 15000); s.credit("FT2804070271", "PYO-7271", 15000, date="2028-04-07")
    s.refuse("SOURCE_ERRORS"); out.append(s)

    s = Story("H29", "a February sale refunded in March, and a zero charge beside a real one")
    x = s.sale("ORD-28032901", "STL/0329", 50000)
    y = s.refund("ORD-28022977", "STL/0329", 5000, date="2028-03-04", ref="Refund of a February order")
    f1 = s.fee("CHG/29/001", "STL/0329", 0); f2 = s.fee("CHG/29/002", "STL/0329", 1000)
    r = s.settle("STL/0329", 50000, 5000, 1000)
    l = s.line("PYO-7281", "STL/0329", 44000); k = s.credit("FT2803300281", "PYO-7281", 44000)
    s.batch(r, "consistent", sales=[x], refunds=[y], fees=[f1, f2], paid=44000, payouts=["PYO-7281"])
    s.payout("PYO-7281", "consistent", lines=[l], credit=k); out.append(s)

    s = Story("H30", "a batch half in transit, and a batch whose only payout never arrived")
    a = s.sale("ORD-28033001", "STL/0330/A", 60000); b = s.sale("ORD-28033002", "STL/0330/B", 8000)
    ra = s.settle("STL/0330/A", 60000, 0, 0, date="2028-03-29")
    rb = s.settle("STL/0330/B", 8000, 0, 0, date="2028-03-29")
    l1 = s.line("PYO-7291", "STL/0330/A", 30000); l2 = s.line("PYO-7292", "STL/0330/A", 30000)
    l3 = s.line("PYO-7293", "STL/0330/B", 8000)
    k1 = s.credit("FT2803310291", "PYO-7291", 30000, date="2028-03-31")
    k2 = s.credit("FT2804040292", "PYO-7292", 30000, date="2028-04-04")
    s.batch(ra, "in-transit", sales=[a], paid=60000, payouts=["PYO-7291", "PYO-7292"])
    s.batch(rb, "review", [PAYOUT], sales=[b], paid=8000, payouts=["PYO-7293"])
    s.payout("PYO-7291", "consistent", lines=[l1], credit=k1)
    s.payout("PYO-7292", "in-transit", lines=[l2], credit=k2)
    s.payout("PYO-7293", "review", [MISSING], lines=[l3]); out.append(s)

    return out


if __name__ == "__main__":
    print(json.dumps({"schema": "tarasuf-pg1-batches-h1-stories/1", "synthetic": True,
                      "stories": [s.to_json() for s in stories()]}, ensure_ascii=False, indent=1))
