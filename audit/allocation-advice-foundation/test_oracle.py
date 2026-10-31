"""The ALL-1 advice oracle: every rule of the proposed review on small
synthetic snapshots, the family's reading and replay rules it applies, the
reader's ceiling, and the oracle's agreement with every focused story's
intent. Run by mutate_oracle.py against planted faults.

    python3 -B -m unittest discover -s audit/allocation-advice-foundation -p test_oracle.py -v
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

OP, OI, CP, CI, TW = model.OP, model.OI, model.CP, model.CI, model.TW


def run(s):
    with tempfile.TemporaryDirectory() as tmp:
        render.emit([s.to_json()], Path(tmp), s.writer != "exceljs")
        return oracle.judge(tmp, s.id)


def story(**kw):
    return model.Story("T", "test", **kw)


def lines(result):
    return [[x["reference"], x["status"], x["reasons"]] for x in result["lines"]]


def item(result, side, ref):
    return next(i for i in result["items"] if i["side"] == side and i["reference"] == ref)


class Fits(unittest.TestCase):
    def test_one_payment_for_two_invoices_fits(self):
        s = story()
        s.pay("P1", 1000); s.inv("I1", 600); s.inv("I2", 400)
        s.advice("R1", "P1", "I1", 600); s.advice("R2", "P1", "I2", 400)
        self.assertEqual(lines(run(s)), [["R1", "fits", []], ["R2", "fits", []]])

    def test_two_payments_crossing_three_invoices_fit(self):
        s = story()
        s.pay("P1", 700); s.pay("P2", 500); s.inv("I1", 400); s.inv("I2", 500); s.inv("I3", 300)
        s.advice("R1", "P1", "I1", 400); s.advice("R2", "P1", "I2", 300)
        s.advice("R3", "P2", "I2", 200); s.advice("R4", "P2", "I3", 300)
        self.assertEqual([x[1] for x in lines(run(s))], ["fits"] * 4)

    def test_exactly_the_remaining_capacity_fits(self):
        s = story()
        s.pay("P1", 1000); s.inv("I1", 1000); s.advice("R1", "P1", "I1", 1000)
        self.assertEqual(lines(run(s)), [["R1", "fits", []]])

    def test_a_line_fits_beside_a_competition_on_other_items(self):
        s = story()
        s.pay("P1", 1000); s.pay("P2", 500); s.inv("I1", 400); s.inv("I2", 500)
        s.advice("R1", "P1", "I1", 400); s.advice("R2", "P2", "I1", 300); s.advice("R3", "P1", "I2", 500)
        self.assertEqual(lines(run(s))[2], ["R3", "fits", []])


class Competition(unittest.TestCase):
    def test_every_open_line_on_a_crowded_invoice_competes_and_none_is_preferred(self):
        s = story()
        for p in ("P1", "P2", "P3"):
            s.pay(p, 400)
        s.inv("I1", 400)
        rows = [s.advice(f"R{k}", f"P{k}", "I1", 400) for k in (1, 2, 3)]
        r = run(s)
        self.assertEqual(lines(r), [[f"R{k}", "review", [CI]] for k in (1, 2, 3)])
        self.assertEqual([x["competitors"] for x in r["lines"]],
                         [[rows[1], rows[2]], [rows[0], rows[2]], [rows[0], rows[1]]])

    def test_a_crowded_payment(self):
        s = story()
        s.pay("P1", 1000); s.inv("I1", 700); s.inv("I2", 500)
        a, b = s.advice("R1", "P1", "I1", 700), s.advice("R2", "P1", "I2", 500)
        r = run(s)
        self.assertEqual(lines(r), [["R1", "review", [CP]], ["R2", "review", [CP]]])
        self.assertEqual([x["competitors"] for x in r["lines"]], [[b], [a]])

    def test_one_minor_unit_over_the_advice_makes_them_compete(self):
        s = story()
        s.pay("P1", 1000); s.inv("I1", 600); s.inv("I2", 401)
        s.advice("R1", "P1", "I1", 600); s.advice("R2", "P1", "I2", 401)
        self.assertEqual([x[2] for x in lines(run(s))], [[CP], [CP]])

    def test_a_line_over_alone_is_over_not_competing_and_still_names_its_competitors(self):
        s = story()
        s.pay("P1", 1000); s.pay("P2", 200); s.inv("I1", 500)
        a, b = s.advice("R1", "P1", "I1", 600), s.advice("R2", "P2", "I1", 200)
        r = run(s)
        self.assertEqual(lines(r), [["R1", "review", [OI]], ["R2", "review", [CI]]])
        self.assertEqual([x["competitors"] for x in r["lines"]], [[b], [a]])

    def test_over_both_by_one_minor_unit(self):
        s = story()
        s.pay("P1", 1000); s.inv("I1", 1000); s.advice("R1", "P1", "I1", 1001)
        r = run(s)
        self.assertEqual(lines(r), [["R1", "review", [OP, OI]]])
        self.assertEqual(r["lines"][0]["competitors"], [])

    def test_competition_on_both_items_in_contract_order(self):
        s = story()
        s.pay("P1", 600); s.pay("P2", 300); s.inv("I1", 500); s.inv("I2", 400)
        a = s.advice("R1", "P1", "I1", 400)
        b, c = s.advice("R2", "P1", "I2", 300), s.advice("R3", "P2", "I1", 200)
        r = run(s)
        self.assertEqual(lines(r), [["R1", "review", [CP, CI]], ["R2", "review", [CP]], ["R3", "review", [CI]]])
        self.assertEqual(r["lines"][0]["competitors"], [b, c])

    def test_reordered_rows_keep_statuses_by_line_id(self):
        s, t = story(), story()
        for x in (s, t):
            x.pay("P1", 400); x.pay("P2", 400); x.pay("P3", 300); x.inv("I1", 400); x.inv("I2", 300)
        s.advice("R1", "P1", "I1", 400); s.advice("R2", "P2", "I1", 400); s.advice("R3", "P3", "I2", 300)
        t.advice("R3", "P3", "I2", 300); t.advice("R2", "P2", "I1", 400); t.advice("R1", "P1", "I1", 400)
        self.assertEqual(sorted(lines(run(s))), sorted(lines(run(t))))


class Twins(unittest.TestCase):
    def test_identical_lines_are_twins_both_ways(self):
        s = story()
        s.pay("P1", 1000); s.inv("I1", 1000)
        a, b = s.advice("R1", "P1", "I1", 400), s.advice("R2", "P1", "I1", 400)
        r = run(s)
        self.assertEqual(lines(r), [["R1", "review", [TW]], ["R2", "review", [TW]]])
        self.assertEqual([x["twins"] for x in r["lines"]], [[b], [a]])

    def test_another_amount_is_not_a_twin(self):
        s = story()
        s.pay("P1", 500); s.inv("I1", 500)
        s.advice("R1", "P1", "I1", 300); s.advice("R2", "P1", "I1", 200)
        self.assertEqual([x["twins"] for x in run(s)["lines"]], [[], []])

    def test_another_invoice_is_not_a_twin(self):
        s = story()
        s.pay("P1", 1000); s.inv("I1", 400); s.inv("I2", 400)
        s.advice("R1", "P1", "I1", 400); s.advice("R2", "P1", "I2", 400)
        self.assertEqual(lines(run(s)), [["R1", "fits", []], ["R2", "fits", []]])

    def test_the_open_twin_of_an_allocated_line_needs_review(self):
        s = story()
        s.pay("P1", 1000); s.inv("I1", 1000)
        a, b = s.advice("R1", "P1", "I1", 400), s.advice("R2", "P1", "I1", 400)
        s.remit("D1", ["R1"])
        r = run(s)
        self.assertEqual(lines(r), [["R1", "allocated", []], ["R2", "review", [TW]]])
        self.assertEqual(r["lines"][0]["twins"], [b])


class Decisions(unittest.TestCase):
    def test_an_allocated_line_does_not_compete_and_its_capacity_is_taken(self):
        s = story()
        s.pay("P1", 700); s.pay("P2", 400); s.inv("I1", 1000)
        s.advice("R1", "P1", "I1", 700); s.advice("R2", "P2", "I1", 400)
        s.remit("D1", ["R1"])
        r = run(s)
        self.assertEqual(lines(r), [["R1", "allocated", []], ["R2", "review", [OI]]])
        self.assertEqual(r["lines"][1]["competitors"], [])
        i = item(r, 1, "I1")
        self.assertEqual([i["allocated"], i["remaining"], i["advised"], i["excess"]], [700, 300, 400, 100])

    def test_undo_returns_the_line_and_the_capacity(self):
        s = story()
        s.pay("P1", 700); s.pay("P2", 400); s.inv("I1", 1000)
        s.advice("R1", "P1", "I1", 700); s.advice("R2", "P2", "I1", 400)
        s.remit("D1", ["R1"]).undo("U1", "D1")
        r = run(s)
        self.assertEqual(lines(r), [["R1", "review", [CI]], ["R2", "review", [CI]]])
        self.assertEqual(item(r, 1, "I1")["allocated"], 0)

    def test_a_human_allocation_takes_capacity_of_every_basis(self):
        for kind in ("accountant-review", "external-confirmation"):
            s = story()
            s.pay("P1", 1000); s.pay("P2", 800); s.inv("I1", 600); s.inv("I2", 1000)
            s.advice("R1", "P1", "I2", 500)
            s.human("D1", [("P1", "I1", 600)], kind=kind)
            r = run(s)
            self.assertEqual(lines(r), [["R1", "review", [OP]]], kind)
            p = item(r, 0, "P1")
            self.assertEqual(p["allocated"] + p["remaining"], p["available"])

    def test_a_decision_over_capacity_refuses_the_review(self):
        s = story()
        s.pay("P1", 500); s.inv("I1", 800); s.advice("R1", "P1", "I1", 200)
        s.human("D1", [("P1", "I1", 600)])
        self.assertEqual(run(s)["refused"], "OVER_AVAILABLE")

    def test_an_item_advised_below_its_capacity_has_no_excess(self):
        s = story()
        s.pay("P1", 1000); s.inv("I1", 600)
        s.advice("R1", "P1", "I1", 400)
        r = run(s)
        self.assertEqual([[i["remaining"], i["advised"], i["excess"]] for i in r["items"]], [[1000, 400, 0], [600, 400, 0]])

    def test_an_advice_line_used_by_two_decisions_refuses_the_review(self):
        s = story()
        s.pay("P1", 1000); s.inv("I1", 1000); s.advice("R1", "P1", "I1", 300)
        s.remit("D1", ["R1"]).remit("D2", ["R1"])
        self.assertEqual(run(s)["refused"], "PROOF")

    def test_part_paid_invoices_use_the_snapshot_available_amount(self):
        s = story()
        s.pay("P1", 300); s.inv("I1", 1000, 300)
        s.advice("R1", "P1", "I1", 300)
        r = run(s)
        self.assertEqual(lines(r), [["R1", "fits", []]])
        self.assertEqual(item(r, 1, "I1")["remaining"], 300)


class Reading(unittest.TestCase):
    def refused(self, s):
        return run(s)["refused"]

    def test_each_row_error_refuses_the_review(self):
        cases = [
            ("ROW_SCOPE", lambda s: s.advice("R2", "P1", "I1", 100, meta={"Party": "Supplier S02"})),
            ("DUPLICATE", lambda s: s.raw(2, ["R1", *s.meta(), "P1", "I1", "1.00"])),
            ("PROOF_MEMBER", lambda s: s.advice("R2", "P9", "I1", 100)),
            ("DATE", lambda s: s.pay("P2", 100, date="2026-10-01")),
            ("CAPACITY", lambda s: s.inv("I2", 100, 200)),
            ("ZERO", lambda s: s.advice("R2", "P1", "I1", 0)),
            ("EXTRA_DECIMALS", lambda s: s.advice("R2", "P1", "I1", 0, text="1.005")),
            ("FORMULA_IDENTITY", lambda s: s.advice("=R2", "P1", "I1", 100)),
        ]
        for name, plant in cases:
            s = story()
            s.pay("P1", 1000); s.inv("I1", 1000); s.advice("R1", "P1", "I1", 500)
            plant(s)
            self.assertEqual(self.refused(s), "SOURCE_ERRORS", name)

    def test_dates_on_the_cut_off_are_read(self):
        s = story()
        s.pay("P1", 1000, date="2026-09-30"); s.inv("I1", 1000, date="2026-09-30")
        s.advice("R1", "P1", "I1", 500)
        self.assertEqual(lines(run(s)), [["R1", "fits", []]])

    def test_a_hidden_xlsx_line_refuses_the_review(self):
        s = story(writer="exceljs")
        s.pay("P1", 1000); s.inv("I1", 1000); s.advice("R1", "P1", "I1", 500)
        s.hidden[2].append(s.advice("R2", "P1", "I1", 100))
        self.assertEqual(self.refused(s), "SOURCE_ERRORS")

    def test_xlsx_without_hidden_lines_is_read(self):
        s = story(writer="exceljs")
        s.pay("P1", 1000); s.inv("I1", 1000); s.advice("R1", "P1", "I1", 500)
        self.assertEqual(lines(run(s)), [["R1", "fits", []]])

    def test_a_missing_column_refuses_the_files(self):
        s = story(orders=[list(range(11)), list(range(11)), list(range(10))])
        s.pay("P1", 1000); s.inv("I1", 1000); s.advice("R1", "P1", "I1", 500)
        self.assertEqual(self.refused(s), "COLUMNS")

    def test_an_unknown_currency_refuses_the_scope(self):
        s = story()
        s.scope["currency"] = "XXX"
        s.dec = 2
        s.pay("P1", 1000); s.inv("I1", 1000)
        self.assertEqual(self.refused(s), "SCOPE")

    def test_three_places_and_none(self):
        for cur, amount in (("KWD", "0.5001"), ("JPY", "1.5")):
            s = story(currency=cur)
            s.pay("P1", 1000); s.inv("I1", 500); s.inv("I2", 500)
            s.advice("R1", "P1", "I1", 500); s.advice("R2", "P1", "I2", 0, text=amount)
            self.assertEqual(self.refused(s), "SOURCE_ERRORS", cur)

    def test_arabic_indic_digits_are_read(self):
        s = story()
        s.pay("P1", 100000); s.inv("I1", 40000)
        s.advice("R1", "P1", "I1", 40000, text="\u0664\u0660\u0660\u066b\u0660\u0660")
        self.assertEqual([x["amount"] for x in run(s)["lines"]], [40000])

    def test_other_digit_scripts_are_not_read(self):
        for name, plant in (("devanagari amount", lambda s: s.advice("R2", "P1", "I1", 0, text="\u0967\u0966\u0966")),
                            ("arabic-indic date", lambda s: s.pay("P2", 100, date="\u0662\u0660\u0662\u0666-09-01"))):
            s = story()
            s.pay("P1", 1000); s.inv("I1", 1000); s.advice("R1", "P1", "I1", 500)
            plant(s)
            self.assertEqual(self.refused(s), "SOURCE_ERRORS", name)

    def test_the_reader_ceiling(self):
        for n, want in ((model.LIMIT - 1, None), (model.LIMIT, "ROWS")):
            s = story()
            s.pay("P1", 10 ** 10); s.inv("I1", 10 ** 10)
            for k in range(n):
                s.advice(f"L{k:05d}", "P1", "I1", k + 1)
            self.assertEqual(self.refused(s), want, n)


class Stories(unittest.TestCase):
    def test_the_oracle_agrees_with_every_focused_intent(self):
        with tempfile.TemporaryDirectory() as tmp:
            focused = [s.to_json() for s in model.focused()]
            render.emit(focused, Path(tmp), False)
            for s in focused:
                with self.subTest(story=s["id"]):
                    got = oracle.judge(tmp, s["id"])
                    seen = {"refused": got["refused"],
                            "lines": [[x["row"], x["status"], x["reasons"], x["competitors"], x["twins"]]
                                      for x in got["lines"]],
                            "items": [[i["side"], i["reference"], i["remaining"], i["advised"]] for i in got["items"]]}
                    self.assertEqual(seen, s["intent"])

    def test_the_sealed_expectations_are_the_oracle(self):
        frozen = HERE / "frozen"
        if not (frozen / "EXPECTED.json").exists():
            self.skipTest("not sealed yet")
        expected = json.loads((frozen / "EXPECTED.json").read_text(encoding="utf-8"))
        self.assertEqual(expected, oracle.run(frozen))


if __name__ == "__main__":
    unittest.main()
