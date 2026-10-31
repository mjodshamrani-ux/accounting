"""The CLR-1 groups oracle: every rule of the proposed contract on small
synthetic extracts, the reading codes in their order, the isolation envelope
one condition at a time, the reader's ceiling, and the oracle's agreement
with every focused story's intent. Run by mutate_oracle.py against planted
faults.

    python3 -B -m unittest discover -s audit/clearing-groups-foundation -p test_oracle.py -v
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


def run(e, writer=None):
    """Write an Extract and judge it."""
    with tempfile.TemporaryDirectory() as tmp:
        data = e.to_json()
        if writer:
            data["writer"] = writer
        render.emit([data], Path(tmp), data["writer"] != "exceljs")
        return oracle.judge(tmp, e.id)


def ext(sid="T", **kw):
    return model.Extract(sid, "test", **kw)


def summary(result):
    return [[g["reference"], [m[0] for m in g["members"]], g["status"], g["reasons"]] for g in result["groups"]]


def pair(e, ref, posting, day=3, minor=1000):
    return [e.line(posting + "a", ref, day, minor, "Invoice"), e.line(posting + "b", ref, day, -minor, "Payment")]


class Groups(unittest.TestCase):
    def test_a_whole_reference_that_nets_to_zero_with_both_signs_clears(self):
        e = ext()
        rows = [e.line("P1", "C1", 1, 1000), e.line("P2", "C1", 2, -600), e.line("P3", "C1", 3, -400)]
        r = run(e)
        self.assertEqual(summary(r), [["C1", rows, "cleared", []]])
        self.assertEqual([m[3] for m in r["groups"][0]["members"]], ["REFERENCE"] * 3)
        self.assertEqual(r["groups"][0]["net"], 0)

    def test_a_reference_that_does_not_net_to_zero_is_residual_and_no_subset_is_chosen(self):
        e = ext()
        rows = [e.line("P1", "C1", 1, 1000), e.line("P2", "C1", 2, -1000), e.line("P3", "C1", 3, 300)]
        r = run(e)
        self.assertEqual(summary(r), [["C1", rows, "review", ["RESIDUAL"]]])
        self.assertEqual(r["groups"][0]["net"], 300)

    def test_zero_lines_alone_are_not_an_offset(self):
        e = ext()
        e.line("P1", "C1", 1, 0)
        e.line("P2", "C1", 2, 0)
        self.assertEqual(run(e)["groups"][0]["reasons"], ["RESIDUAL"])

    def test_a_zero_line_stays_a_member_of_a_cleared_group(self):
        e = ext()
        rows = [e.line("P1", "C1", 1, 0), *pair(e, "C1", "P2")]
        self.assertEqual(summary(run(e)), [["C1", rows, "cleared", []]])

    def test_lines_without_a_reference_are_each_a_group_of_their_own(self):
        e = ext()
        a, b = e.line("P1", "", 1, 75), e.line("P2", "", 1, -75)
        r = run(e)
        self.assertEqual(summary(r), [["", [a], "review", ["MISSING_REFERENCE"]], ["", [b], "review", ["MISSING_REFERENCE"]]])
        self.assertEqual([g["members"][0][3] for g in r["groups"]], ["ROW", "ROW"])

    def test_groups_follow_their_first_member_and_members_their_rows(self):
        e = ext()
        a = e.line("P1", "C2", 1, 5)
        b = e.line("P2", "C1", 1, 7)
        c = e.line("P3", "C2", 1, -5)
        d = e.line("P4", "C1", 1, -7)
        self.assertEqual(summary(run(e)), [["C2", [a, c], "cleared", []], ["C1", [b, d], "cleared", []]])

    def test_a_reordered_extract_has_the_same_groups_by_posting(self):
        def build(order):
            e = ext()
            lines = [("P1", "C1", 1000), ("P2", "C1", -1000), ("P3", "C2", 50), ("P4", "C2", -40), ("P5", "", 9)]
            for k in order:
                e.line(lines[k][0], lines[k][1], 4, lines[k][2])
            r = run(e)
            return sorted((g["reference"], sorted(m[1] for m in g["members"]), g["status"], tuple(g["reasons"]))
                          for g in r["groups"])
        self.assertEqual(build([0, 1, 2, 3, 4]), build([4, 3, 1, 2, 0]))

    def test_more_than_one_hundred_members_hold_the_group(self):
        e = ext()
        for k in range(100):
            e.line(f"P{k}", "C1", 1, -1 if k else 99)
        self.assertEqual(run(e)["groups"][0]["status"], "cleared")
        e.line("P100", "C1", 1, 0)
        self.assertEqual(run(e)["groups"][0]["reasons"], ["GROUP_LIMIT"])

    def test_a_reference_column_without_a_clearing_header_holds_referenced_groups(self):
        e = ext(header=["Posting ID", "Reference", "Date", "Amount", "Account", "Currency", "Description"])
        pair(e, "C1", "P1")
        e.line("P9", "", 1, 5)
        self.assertEqual([g["reasons"] for g in run(e)["groups"]],
                         [["UNVERIFIED_REFERENCE_ROLE"], ["MISSING_REFERENCE"]])

    def test_arabic_clearing_headers_are_roles(self):
        for name in ["مرجع المقاصة", "رقم المقاصة", "Clearing  Document"]:
            e = ext(header=["Posting ID", name, "Date", "Amount", "Account", "Currency", "Description"])
            pair(e, "C1", "P1")
            self.assertEqual(run(e)["groups"][0]["status"], "cleared", name)

    def test_nets_sum_to_the_total_and_every_movement_is_in_one_group(self):
        e = ext()
        pair(e, "C1", "P1")
        e.line("P2", "C2", 1, 33)
        e.line("P3", "", 1, -8)
        r = run(e)
        self.assertEqual(r["total"], 25)
        self.assertEqual(sum(g["net"] for g in r["groups"]), 25)


class PostingNumbers(unittest.TestCase):
    def test_a_posting_number_on_two_lines_is_not_an_error(self):
        e = ext()
        a, b = e.line("P1", "C1", 1, 600), e.line("P1", "C2", 1, 400)
        c, d = e.line("P9", "C1", 2, -600), e.line("P9", "C2", 2, -400)
        r = run(e)
        self.assertEqual(r["errors"], [])
        self.assertEqual(summary(r), [["C1", [a, c], "cleared", []], ["C2", [b, d], "cleared", []]])

    def test_lines_equal_in_every_selected_cell_hold_their_group_and_stay(self):
        e = ext()
        a = e.line("P1", "C1", 1, 300, "Delivery")
        b = e.line("P1", "C1", 1, 300, "Delivery")
        c = e.line("P2", "C1", 2, -600, "Payment")
        r = run(e)
        self.assertEqual(summary(r), [["C1", [a, b, c], "review", ["DUPLICATE_MEMBER"]]])
        self.assertEqual(r["groups"][0]["duplicates"], [[a, b]])

    def test_the_same_amount_written_two_ways_is_still_a_duplicate(self):
        e = ext()
        e.line("P1", "C1", 1, 300, "Delivery", text="3.00")
        e.line("P1", "C1", 1, 300, "Delivery", text="3.0")
        e.line("P2", "C1", 2, -600, "Payment")
        self.assertEqual(run(e)["groups"][0]["reasons"], ["DUPLICATE_MEMBER"])

    def test_a_different_description_is_not_a_duplicate(self):
        e = ext()
        e.line("P1", "C1", 1, 300, "Delivery 1")
        e.line("P1", "C1", 1, 300, "Delivery 2")
        e.line("P2", "C1", 2, -600, "Payment")
        self.assertEqual(run(e)["groups"][0]["status"], "cleared")

    def test_duplicates_without_a_reference_hold_each_line(self):
        e = ext()
        e.line("P1", "", 1, 5, "Same")
        e.line("P1", "", 1, 5, "Same")
        self.assertEqual([g["reasons"] for g in run(e)["groups"]],
                         [["DUPLICATE_MEMBER", "MISSING_REFERENCE"]] * 2)


class Codes(unittest.TestCase):
    def code(self, cells=None, **kw):
        e = ext(split=kw.pop("split", False))
        pair(e, "C1", "P1")
        x = e.raw(cells) if cells else e.line(**kw)
        return [c for r, c, _ in run(e)["errors"] if r == x]

    def test_each_reading_code(self):
        base = dict(posting="P9", ref="C9", day=4, minor=100, desc="x")
        self.assertEqual(self.code(**dict(base, posting="")), ["POSTING"])
        self.assertEqual(self.code(**dict(base, posting="-P9")), ["IDENTITY"])
        self.assertEqual(self.code(**dict(base, ref="@C9")), ["IDENTITY"])
        self.assertEqual(self.code(**dict(base, account="2160")), ["ROW_SCOPE"])
        self.assertEqual(self.code(**dict(base, currency="USD")), ["ROW_SCOPE"])
        self.assertEqual(self.code(**dict(base, date="04/09/2026")), ["DATE"])
        self.assertEqual(self.code(**dict(base, date="2026-02-30")), ["DATE"])
        self.assertEqual(self.code(**dict(base, date="2026-08-31")), ["PERIOD"])
        self.assertEqual(self.code(**dict(base, date="2026-10-01")), ["PERIOD"])
        self.assertEqual(self.code(**dict(base, date="2026-09-30")), [])
        self.assertEqual(self.code(**dict(base, date="2026-09-01")), [])
        for text in ["1,000.00", "(5.00)", "", "1.005", "5.", "1e3"]:
            self.assertEqual(self.code(**dict(base, text=text)), ["AMOUNT_FORMAT"], text)
        self.assertEqual(self.code(**dict(base, text="\u0661\u0662٫\u0665\u0660")), [])
        self.assertEqual(self.code(["P9", "C9", "2026-09-04", "1.00", "1.00", "2150", "SAR", "x"], split=True),
                         ["SPLIT"])
        self.assertEqual(self.code(["P9", "C9", "2026-09-04", "-1.00", "0.00", "2150", "SAR", "x"], split=True),
                         ["SPLIT"])

    def test_the_period_and_scope_codes_come_before_the_amount(self):
        self.assertEqual(self.code(posting="P9", ref="C9", day=0, minor=0, date="2026-10-02", text="bad"), ["PERIOD"])
        self.assertEqual(self.code(posting="P9", ref="C9", day=4, minor=0, account="1", text="bad"), ["ROW_SCOPE"])

    def test_a_blank_line_is_blank(self):
        e = ext()
        pair(e, "C1", "P1")
        x = e.raw([""] * 7)
        r = run(e)
        self.assertEqual((r["blank"], r["errors"]), ([x], []))


class Isolation(unittest.TestCase):
    def held(self, faulty, header=None):
        """Two clean groups, C1 and C2, then the faulty line; returns the
        reasons of each group."""
        e = ext(header=header)
        pair(e, "C1", "P1")
        pair(e, "C2", "P2")
        if callable(faulty):
            faulty(e)
        else:
            e.raw(faulty)
        return [g["reasons"] for g in run(e)["groups"]]

    def test_a_faulty_line_holds_the_group_of_its_reference_only(self):
        self.assertEqual(self.held(["P9", "C1", "2026-09-04", "bad", "2150", "SAR", "x"]), [["CONNECTED_ERROR"], []])

    def test_a_faulty_line_of_a_reference_no_group_has_holds_nothing(self):
        self.assertEqual(self.held(["P9", "C9", "2026-09-04", "bad", "2150", "SAR", "x"]), [[], []])

    def test_every_cell_of_a_faulty_line_is_a_possible_reference(self):
        self.assertEqual(self.held(["P9", "C9", "2026-09-04", "C2", "2150", "SAR", "x"]), [[], ["CONNECTED_ERROR"]])
        self.assertEqual(self.held(["P9", "C9", "2026-09-04", "bad", "2150", "SAR", " C1 "]), [["CONNECTED_ERROR"], []])

    def test_a_faulty_line_sharing_a_members_posting_number_holds_that_group(self):
        self.assertEqual(self.held(["P2a", "C9", "2026-09-04", "bad", "2150", "SAR", "x"]), [[], ["CONNECTED_ERROR"]])

    def test_lines_of_another_account_currency_or_period_hold_their_reference(self):
        for cells in (["P9", "C2", "2026-09-04", "1.00", "9999", "SAR", "x"],
                      ["P9", "C2", "2026-09-04", "1.00", "2150", "USD", "x"],
                      ["P9", "C2", "2026-10-04", "1.00", "2150", "SAR", "x"]):
            self.assertEqual(self.held(cells), [[], ["CONNECTED_ERROR"]], cells)

    def test_what_a_faulty_line_cannot_prove_holds_every_group(self):
        u = [["UNISOLATED_ERROR"], ["UNISOLATED_ERROR"]]
        self.assertEqual(self.held(["P9", "", "2026-09-04", "bad", "2150", "SAR", "x"]), u, "no reference")
        self.assertEqual(self.held(["P9", "Total", "2026-09-04", "bad", "2150", "SAR", "x"]), u, "summary label")
        self.assertEqual(self.held(["P9", "Grand total:", "2026-09-04", "bad", "2150", "SAR", "x"]), u, "with colon")
        self.assertEqual(self.held(["P9", "=C1", "2026-09-04", "1.00", "2150", "SAR", "x"]), u, "formula-like")
        self.assertEqual(self.held(["P9", "C9", "2026-09-04", "bad", "2150", "SAR", "x", "more"]), u, "past the header")
        self.assertEqual(self.held(list(model.HEADER)), u, "the header again")
        role = ["Posting ID", "Reference", "Date", "Amount", "Account", "Currency", "Description"]
        self.assertEqual(self.held(["P9", "C9", "2026-09-04", "bad", "2150", "SAR", "x"], header=role),
                         [["UNISOLATED_ERROR", "UNVERIFIED_REFERENCE_ROLE"]] * 2, "no clearing header")

    def test_an_empty_cell_past_the_header_does_not_unisolate(self):
        self.assertEqual(self.held(["P9", "C9", "2026-09-04", "bad", "2150", "SAR", "x", " "]), [[], []])

    def test_an_xlsx_hidden_or_formula_line_holds_every_group(self):
        def hidden(e):
            e.hidden.append(e.line("P9", "C9", 4, 100))

        def formula(e):
            x = e.line("P9", "C9", 4, 100, "note")
            e.formulas[(x, 7)] = '"no" & "te"'

        def plain(e):
            e.line("P9", "C9", 0, 100, date="2026-09-31")
        for build, want in ((hidden, [["UNISOLATED_ERROR"]] * 2), (formula, [["UNISOLATED_ERROR"]] * 2),
                            (plain, [[], []])):
            e = ext(fmt="xlsx", writer="exceljs")
            pair(e, "C1", "P1")
            pair(e, "C2", "P2")
            build(e)
            self.assertEqual([g["reasons"] for g in run(e)["groups"]], want, build.__name__)

    def test_an_xlsx_formula_outside_the_selected_cells_is_still_a_formula_line(self):
        for formula, want in ((True, [["UNISOLATED_ERROR"]]), (False, [[]])):
            e = ext(fmt="xlsx", writer="exceljs")
            e.reading["description"] = -1
            pair(e, "C1", "P1")
            x = e.line("P9", "C9", 4, 100, "note", text="bad")
            if formula:
                e.formulas[(x, 7)] = '"no" & "te"'
            self.assertEqual([g["reasons"] for g in run(e)["groups"]], want, formula)

    def test_an_xlsx_header_copy_and_a_cell_past_the_header(self):
        for extra, want in (([], [["UNISOLATED_ERROR"]]), (["x"], [["UNISOLATED_ERROR"]])):
            e = ext(fmt="xlsx", writer="exceljs")
            pair(e, "C1", "P1")
            e.raw(list(model.HEADER) + extra)
            self.assertEqual([g["reasons"] for g in run(e)["groups"]], want, extra)
        e = ext(fmt="xlsx", writer="exceljs")
        pair(e, "C1", "P1")
        e.raw(["P9", "C9", "2026-09-04", "bad", "2150", "SAR", "x", "y"])
        self.assertEqual([g["reasons"] for g in run(e)["groups"]], [["UNISOLATED_ERROR"]])


class Reader(unittest.TestCase):
    def test_semicolons_read_like_commas(self):
        e = ext()
        pair(e, "C1", "P1")
        with tempfile.TemporaryDirectory() as tmp:
            data = e.to_json()
            render.emit([data], Path(tmp), True)
            path = Path(tmp) / data["name"]
            path.write_text(path.read_text(encoding="utf-8").replace(",", ";"), encoding="utf-8")
            self.assertEqual(oracle.judge(tmp, e.id)["groups"][0]["status"], "cleared")

    def test_a_byte_order_mark_and_crlf_read_the_same(self):
        e = ext()
        pair(e, "C1", "P1")
        self.assertEqual(summary(run(e, "py-all-bom")), summary(run(e, "py-min")))

    def test_the_ceiling_is_the_readers(self):
        e = ext()
        for k in range(model.LIMIT - 1):
            e.line(f"P{k}", "", 1, 1)
        self.assertIsNone(run(e)["refused"])
        e.line("PX", "", 1, 1)
        self.assertEqual(run(e)["refused"], "ROWS")


class Blindness(unittest.TestCase):
    def test_the_oracle_does_not_read_the_intent(self):
        text = (HERE / "oracle.py").read_text(encoding="utf-8").split('"""', 2)[2]
        for word in ("import stories", "stories.json", "intent", "render", "lib/reconciliation"):
            self.assertNotIn(word, text)


class Intent(unittest.TestCase):
    def test_every_focused_story_equals_its_intent(self):
        facts = json.loads((HERE / "frozen" / "stories.json").read_text(encoding="utf-8"))["stories"]
        for s in facts:
            with self.subTest(story=s["id"]):
                got = oracle.judge(HERE / "frozen", s["id"])
                i = s["intent"]
                self.assertEqual(got["refused"], i["refused"])
                self.assertEqual([[g["reference"], [m[0] for m in g["members"]], g["net"], g["status"], g["reasons"]]
                                  for g in got["groups"]], i["groups"])
                self.assertEqual([[r, c] for r, c, _ in got["errors"]], i["errors"])
                self.assertEqual(got["blank"], i["blank"])


if __name__ == "__main__":
    unittest.main()
