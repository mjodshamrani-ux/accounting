"""The PG-1 batches oracle: every rule of the proposed review on small
synthetic stories, every refusal and row error by its code, the reader's
ceiling, and the oracle's agreement with every focused story's intent. Run by
mutate_oracle.py against planted faults.

    python3 -B -m unittest discover -s audit/payment-gateway-batches-foundation -p test_oracle.py -v
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import oracle  # noqa: E402
import render  # noqa: E402
import stories as model  # noqa: E402

SALES, REFUNDS, FEES, NET = model.SALES, model.REFUNDS, model.FEES, model.NET
SHORT, OVER, PAYOUT = model.SHORT, model.OVER, model.PAYOUT
CREDIT, MISSING = model.CREDIT, model.MISSING


def run(s):
    with tempfile.TemporaryDirectory() as tmp:
        render.emit([s.to_json()], Path(tmp), s.writer != "exceljs")
        return oracle.judge(tmp, s.id)


def codes(s):
    """The row errors the oracle finds, by file, row and code."""
    with tempfile.TemporaryDirectory() as tmp:
        render.emit([s.to_json()], Path(tmp), s.writer != "exceljs")
        given = json.loads((Path(tmp) / f"{s.id}-input.json").read_text(encoding="utf-8"))
        places = oracle.check_scope(given["scope"])
        out, read = [], []
        for side, name in enumerate(given["names"]):
            entries, errors = oracle.read_side(Path(tmp) / name, side, given["scope"], places)
            read.append(entries)
            out += [[side, r, c] for r, c in errors]
        batches = {e["id"] for e in read[2]}
        out += [[side, e["row"], "MEMBER"] for side in (0, 1, 3) for e in read[side] if e["batch"] not in batches]
        return sorted(out)


def ready(test, s):
    """The review of a story that must not be refused: a refusal fails here by
    an assertion, not by an empty list read later."""
    r = run(s)
    test.assertIsNone(r["refused"], s.id)
    return r


def story(**kw):
    return model.Story("T", "test", **kw)


def plain(**kw):
    """One batch of 1000.00 in sales, 20.00 of fees, paid by P1 and credited."""
    s = story(**kw)
    s.sale("T1", "B1", 100000); s.fee("FE1", "B1", 2000); s.settle("B1", 100000, 0, 2000)
    s.line("P1", "B1", 98000); s.credit("BR1", "P1", 98000)
    return s


def batches(r):
    return [[b["batch"], b["status"], b["reasons"]] for b in r["batches"]]


def payouts(r):
    return [[p["payout"], p["status"], p["reasons"]] for p in r["payouts"]]


class Batches(unittest.TestCase):
    def test_a_batch_whose_members_settlement_payout_and_credit_agree(self):
        r = ready(self, plain())
        self.assertEqual(batches(r), [["B1", "consistent", []]])
        self.assertEqual(payouts(r), [["P1", "consistent", []]])
        self.assertEqual(r["batches"][0]["components"], {"sales": 100000, "refunds": 0, "fees": 2000})
        self.assertEqual(r["batches"][0]["settlement"], {"gross": 100000, "refunds": 0, "fees": 2000, "net": 98000})

    def test_members_by_kind_and_row(self):
        s = story()
        s.sale("T1", "B1", 5000); s.refund("T2", "B1", 1000); s.sale("T3", "B1", 2000)
        s.fee("FE1", "B1", 100); s.fee("FE2", "B1", 0)
        s.settle("B1", 7000, 1000, 100); s.line("P1", "B1", 5900); s.credit("BR1", "P1", 5900)
        b = ready(self, s)["batches"][0]
        self.assertEqual([b["sales"], b["refunds"], b["fees"]], [[2, 4], [3], [2, 3]])
        self.assertEqual(b["status"], "consistent")

    def test_each_component_against_its_members(self):
        for name, settle, want in (("sales", (100100, 0, 2000, 98100), [SALES]),
                                   ("refunds", (100000, 500, 2000, 97500), [REFUNDS]),
                                   ("fees", (100000, 0, 2500, 97500), [FEES])):
            s = story()
            s.sale("T1", "B1", 100000); s.fee("FE1", "B1", 2000)
            s.settle("B1", *settle[:3], net=settle[3])
            s.line("P1", "B1", settle[3]); s.credit("BR1", "P1", settle[3])
            self.assertEqual(batches(run(s)), [["B1", "review", want]], name)

    def test_the_rows_own_arithmetic_apart_from_its_members(self):
        s = story()
        s.sale("T1", "B1", 100000); s.fee("FE1", "B1", 2000); s.settle("B1", 100000, 0, 2000, net=98500)
        s.line("P1", "B1", 98500); s.credit("BR1", "P1", 98500)
        self.assertEqual(batches(run(s)), [["B1", "review", [NET]]])

    def test_paid_short_and_over_and_exact(self):
        for paid, want in ((97999, [SHORT]), (98001, [OVER]), (98000, [])):
            s = story()
            s.sale("T1", "B1", 100000); s.fee("FE1", "B1", 2000); s.settle("B1", 100000, 0, 2000)
            s.line("P1", "B1", paid); s.credit("BR1", "P1", paid)
            self.assertEqual(batches(run(s))[0][2], want, paid)

    def test_a_payout_needing_review_holds_each_of_its_batches(self):
        s = story()
        s.sale("T1", "B1", 1000); s.sale("T2", "B2", 2000); s.settle("B1", 1000, 0, 0); s.settle("B2", 2000, 0, 0)
        s.line("P1", "B1", 1000); s.line("P1", "B2", 2000); s.credit("BR1", "P1", 2999)
        self.assertEqual(batches(run(s)), [["B1", "review", [PAYOUT]], ["B2", "review", [PAYOUT]]])

    def test_two_batches_with_the_same_net_stay_apart(self):
        s = story()
        s.sale("T1", "B1", 1000); s.sale("T2", "B2", 1000); s.settle("B1", 1000, 0, 0); s.settle("B2", 1000, 0, 0)
        s.line("P1", "B1", 1000); s.line("P2", "B2", 1000); s.credit("BR1", "P1", 1000); s.credit("BR2", "P2", 1000)
        r = run(s)
        self.assertEqual([b["sales"] for b in r["batches"]], [[2], [3]])
        self.assertEqual([b["payouts"] for b in r["batches"]], [["P1"], ["P2"]])

    def test_a_member_under_the_wrong_batch_shows_on_both_even_when_totals_agree(self):
        s = story()
        s.sale("T1", "B1", 600); s.sale("T2", "B1", 400); s.sale("T3", "B2", 200)
        s.settle("B1", 600, 0, 0); s.settle("B2", 600, 0, 0)
        s.line("P1", "B1", 600); s.line("P1", "B2", 600); s.credit("BR1", "P1", 1200)
        self.assertEqual(batches(run(s)), [["B1", "review", [SALES]], ["B2", "review", [SALES]]])

    def test_a_fee_counts_for_the_batch_it_names(self):
        s = story()
        s.sale("T1", "B1", 1000); s.sale("T2", "B2", 1000); s.fee("FE1", "B2", 30)
        s.settle("B1", 1000, 0, 30); s.settle("B2", 1000, 0, 0)
        s.line("P1", "B1", 970); s.line("P2", "B2", 1000); s.credit("BR1", "P1", 970); s.credit("BR2", "P2", 1000)
        r = run(s)
        self.assertEqual(batches(r), [["B1", "review", [FEES]], ["B2", "review", [FEES]]])
        self.assertEqual([b["fees"] for b in r["batches"]], [[], [2]])

    def test_a_batchs_payouts_in_the_order_of_their_first_line(self):
        s = story()
        s.sale("T1", "B1", 900); s.settle("B1", 900, 0, 0)
        s.line("P2", "B1", 300); s.line("P1", "B1", 300)
        s.line("P3", "B1", 300)
        for p in ("P1", "P2", "P3"):
            s.credit(f"BR{p}", p, 300)
        self.assertEqual(ready(self, s)["batches"][0]["payouts"], ["P2", "P1", "P3"])

    def test_reasons_in_contract_order(self):
        s = story()
        s.sale("T1", "B1", 1000); s.refund("T2", "B1", 10); s.fee("FE1", "B1", 5)
        s.settle("B1", 1001, 11, 6, net=990)
        s.line("P1", "B1", 980)
        self.assertEqual(batches(run(s)), [["B1", "review", [SALES, REFUNDS, FEES, NET, SHORT, PAYOUT]]])


class Payouts(unittest.TestCase):
    def test_a_credit_for_another_amount(self):
        s = plain()
        s.rows[4][0][3] = "979.99"
        self.assertEqual(payouts(run(s)), [["P1", "review", [CREDIT]]])

    def test_no_credit_by_the_as_of_date(self):
        s = story()
        s.sale("T1", "B1", 1000); s.settle("B1", 1000, 0, 0); s.line("P1", "B1", 1000)
        r = ready(self, s)
        self.assertEqual(payouts(r), [["P1", "review", [MISSING]]])
        self.assertIsNone(r["payouts"][0]["credit"])

    def test_after_the_period_end_is_in_transit_and_on_it_is_not(self):
        for d, want in (("2026-09-30", "consistent"), ("2026-10-01", "in-transit"), ("2026-10-10", "in-transit")):
            s = story()
            s.sale("T1", "B1", 1000); s.settle("B1", 1000, 0, 0); s.line("P1", "B1", 1000)
            s.credit("BR1", "P1", 1000, date=d)
            r = ready(self, s)
            self.assertEqual([payouts(r)[0][1], batches(r)[0][1]], [want, want], d)

    def test_a_late_credit_for_another_amount_is_not_in_transit(self):
        s = story()
        s.sale("T1", "B1", 1000); s.settle("B1", 1000, 0, 0); s.line("P1", "B1", 1000)
        s.credit("BR1", "P1", 999, date="2026-10-02")
        self.assertEqual(payouts(run(s)), [["P1", "review", [CREDIT]]])

    def test_a_payout_sums_its_lines_across_batches(self):
        s = story()
        s.sale("T1", "B1", 1000); s.sale("T2", "B2", 2000); s.settle("B1", 1000, 0, 0); s.settle("B2", 2000, 0, 0)
        s.line("P1", "B1", 1000); s.line("P1", "B2", 2000); s.credit("BR1", "P1", 3000)
        p = ready(self, s)["payouts"][0]
        self.assertEqual([p["amount"], p["lines"], p["batches"], p["status"]], [3000, [2, 3], ["B1", "B2"], "consistent"])

    def test_swapped_credits_with_the_right_total(self):
        s = story()
        s.sale("T1", "B1", 500); s.sale("T2", "B2", 300); s.settle("B1", 500, 0, 0); s.settle("B2", 300, 0, 0)
        s.line("P1", "B1", 500); s.line("P2", "B2", 300); s.credit("BR1", "P1", 300); s.credit("BR2", "P2", 500)
        self.assertEqual(payouts(run(s)), [["P1", "review", [CREDIT]], ["P2", "review", [CREDIT]]])

    def test_a_credit_no_line_explains(self):
        s = plain()
        s.credit("BR2", "P7", 500)
        r = run(s)
        self.assertEqual([[c["row"], c["payout"], c["reasons"]] for c in r["credits"]], [[3, "P7", ["UNLINKED_CREDIT"]]])
        self.assertEqual(batches(r), [["B1", "consistent", []]])

    def test_payouts_in_the_order_of_their_first_line(self):
        s = story()
        s.sale("T1", "B1", 900); s.settle("B1", 900, 0, 0)
        s.line("P9", "B1", 300); s.line("P1", "B1", 600)
        s.credit("BR1", "P1", 600); s.credit("BR9", "P9", 300)
        self.assertEqual([p["payout"] for p in ready(self, s)["payouts"]], ["P9", "P1"])


class Reading(unittest.TestCase):
    def refused(self, s):
        return run(s)["refused"]

    def test_readings_and_scope(self):
        s = plain(); s.scope["confirmed"] = False
        self.assertEqual(self.refused(s), "SCOPE")
        for k, v in (("start", "2026-10-01"), ("asOf", "2026-09-29"), ("currency", "XYZ"), ("end", "2026-09-31")):
            s = plain(); s.scope[k] = v
            self.assertEqual(self.refused(s), "SCOPE", k)
        with tempfile.TemporaryDirectory() as tmp:
            s = plain()
            render.emit([s.to_json()], Path(tmp), True)
            p = Path(tmp) / "T-input.json"
            given = json.loads(p.read_text(encoding="utf-8"))
            given["readings"][3]["family"] = "payment-gateway-batch-1"
            p.write_text(json.dumps(given), encoding="utf-8")
            self.assertEqual(oracle.judge(tmp, "T")["refused"], "READING")

    def test_columns(self):
        for side, header in ((0, "Kind"), (4, "Payout ID"), (2, "Net")):
            s = plain(); s.drop(side, header)
            self.assertEqual(self.refused(s), "COLUMNS", header)
        s = plain(); s.headers[1][3] = "Notes"
        self.assertEqual(self.refused(s), "COLUMNS")
        s = plain(); s.headers[3][2] = "Batch ID"
        self.assertEqual(self.refused(s), "COLUMNS")

    def test_columns_in_any_order(self):
        s = plain()
        s.order(2, ["Net", "Fees", "Refunds", "Gross sales", "Currency", "Merchant account", "Settlement date",
                    "Batch ID"])
        s.order(4, ["Credit", "Currency", "Bank account", "Value date", "Payout ID", "Bank reference"])
        self.assertEqual(batches(run(s)), [["B1", "consistent", []]])

    def test_a_file_that_is_not_utf8_or_not_a_snapshot(self):
        with tempfile.TemporaryDirectory() as tmp:
            s = plain()
            render.emit([s.to_json()], Path(tmp), True)
            (Path(tmp) / "T-fees.csv").write_bytes("Fee ID,Batch ID\n\u00e9".encode("cp1256", "replace") + b"\xe9\n")
            self.assertEqual(oracle.judge(tmp, "T")["refused"], "SOURCE")

    def test_row_scope(self):
        s = plain(); s.rows[0][0][6] = "MA-0000"
        self.assertEqual(codes(s), [[0, 2, "ROW_SCOPE"]])
        s = plain(); s.rows[4][0][4] = "BANK-9999"
        self.assertEqual(codes(s), [[4, 2, "ROW_SCOPE"]])
        s = plain(); s.rows[3][0][4] = "USD"
        self.assertEqual(codes(s), [[3, 2, "ROW_SCOPE"]])

    def test_identities_and_kind(self):
        for side, k, v, code in ((0, 0, "=T1", "IDENTITY"), (1, 0, " FE1", "IDENTITY"), (3, 0, "+P1", "IDENTITY"),
                                 (0, 2, "Sale", "KIND"), (0, 5, "", "TEXT"), (4, 0, "#REF!", "IDENTITY")):
            s = plain(); s.rows[side][0][k] = v
            self.assertEqual(codes(s), [[side, 2, code]], v)

    def test_dates_and_periods(self):
        for side, k, v, code in ((0, 3, "2026-08-31", "PERIOD"), (4, 2, "2026-10-11", "PERIOD"),
                                 (4, 2, "2026-08-31", "PERIOD"), (0, 3, "2026-09-31", "DATE"),
                                 (4, 2, "20/09/2026", "DATE")):
            s = plain(); s.rows[side][0][k] = v
            self.assertEqual(codes(s), [[side, 2, code]], v)
        # A settlement row in error leaves its batch unreadable, so every
        # member naming it is a row error too.
        s = plain(); s.rows[2][0][1] = "2026-10-01"
        self.assertEqual(codes(s), [[0, 2, "MEMBER"], [1, 2, "MEMBER"], [2, 2, "PERIOD"], [3, 2, "MEMBER"]])

    def test_amounts(self):
        for v in ("-20.00", "-0.00", "20.001", "1,000.00", "20.", ".5", "\u0967\u0966"):
            s = plain(); s.rows[1][0][2] = v
            self.assertEqual(codes(s), [[1, 2, "AMOUNT"]], v)
        for v, minor in (("\u0662\u0660\u066b\u0660\u0660", 2000), ("\u06f2\u06f0.\u06f0\u06f0", 2000), ("20", 2000)):
            s = plain(); s.rows[1][0][2] = v
            self.assertEqual(ready(self, s)["batches"][0]["components"]["fees"], minor, v)

    def test_keys(self):
        s = plain(); s.sale("T1", "B1", 0)
        self.assertEqual(codes(s), [[0, 2, "DUPLICATE"], [0, 3, "DUPLICATE"]])
        s = plain(); s.fee("FE1", "B1", 0)
        self.assertEqual(codes(s), [[1, 2, "DUPLICATE"], [1, 3, "DUPLICATE"]])
        s = plain(); s.settle("B1", 0, 0, 0)
        self.assertEqual(codes(s), [[0, 2, "MEMBER"], [1, 2, "MEMBER"], [2, 2, "DUPLICATE"], [2, 3, "DUPLICATE"],
                                    [3, 2, "MEMBER"]])
        s = plain(); s.line("P1", "B1", 0)
        self.assertEqual(codes(s), [[3, 2, "DUPLICATE"], [3, 3, "DUPLICATE"]])
        s = plain(); s.credit("BR1", "P2", 0)
        self.assertEqual(codes(s), [[4, 2, "DUPLICATE"], [4, 3, "DUPLICATE"]])
        s = plain(); s.credit("BR2", "P1", 98000)
        self.assertEqual(codes(s), [[4, 2, "DUPLICATE"], [4, 3, "DUPLICATE"]])

    def test_members_need_a_settlement_row(self):
        s = plain(); s.sale("T2", "B9", 10); s.fee("FE2", "B9", 1); s.line("P2", "B9", 9)
        self.assertEqual(codes(s), [[0, 3, "MEMBER"], [1, 3, "MEMBER"], [3, 3, "MEMBER"]])
        self.assertEqual(run(s)["refused"], "SOURCE_ERRORS")

    def test_hidden_xlsx_row_and_blank_rows(self):
        s = plain(writer="exceljs"); s.hidden[1].append(s.fee("FE2", "B1", 0))
        self.assertEqual(codes(s), [[1, 3, "CELL"]])
        s = plain(); s.rows[0].insert(0, ["", "", "", "", "", "", "", ""]); s.rows[0].append([])
        self.assertEqual(ready(self, s)["batches"][0]["sales"], [3])

    def test_a_row_longer_than_its_header(self):
        s = plain(); s.rows[3][0].append("extra")
        self.assertEqual(codes(s), [[3, 2, "COLUMNS"]])

    def test_the_reader_ceiling(self):
        for n, want in ((model.LIMIT - 1, None), (model.LIMIT, "ROWS")):
            s = story()
            for k in range(n):
                s.sale(f"T{k:05d}", "B1", 1)
            s.settle("B1", n, 0, 0); s.line("P1", "B1", n); s.credit("BR1", "P1", n)
            self.assertEqual(run(s)["refused"], want, n)


class Stories(unittest.TestCase):
    def test_the_oracle_agrees_with_every_focused_intent(self):
        with tempfile.TemporaryDirectory() as tmp:
            focused = [s.to_json() for s in model.focused()]
            render.emit(focused, Path(tmp), False)
            for s in focused:
                with self.subTest(story=s["id"]):
                    got = oracle.judge(tmp, s["id"])
                    seen = {"refused": got["refused"],
                            "batches": [[b["row"], b["status"], b["reasons"], b["sales"], b["refunds"], b["fees"],
                                         b["paid"], b["payouts"]] for b in got["batches"]],
                            "payouts": [[p["payout"], p["status"], p["reasons"], p["lines"],
                                         p["credit"]["row"] if p["credit"] else None] for p in got["payouts"]],
                            "credits": [[c["row"], c["payout"]] for c in got["credits"]]}
                    self.assertEqual(seen, s["intent"])

    def test_the_sealed_expectations_are_the_oracle(self):
        frozen = HERE / "frozen"
        if not (frozen / "EXPECTED.json").exists():
            self.skipTest("not sealed yet")
        expected = json.loads((frozen / "EXPECTED.json").read_text(encoding="utf-8"))
        self.assertEqual(expected, oracle.run(frozen))


if __name__ == "__main__":
    unittest.main()
