"""The INV-3 links oracle: every rule of the proposed contract on small
synthetic books, the order of links and related records, the agreement with
the reference's missing keys, and the oracle's agreement with every focused
story's intent. Run by mutate_oracle.py against planted faults.

    python3 -B -m unittest discover -s audit/inventory-links-foundation -p test_oracle.py -v
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


def run(story):
    """Write a Story with one Python writer and judge it."""
    with tempfile.TemporaryDirectory() as tmp:
        data = story.to_json()
        for f in data["files"]:
            f["writer"] = "py-min"
        render.emit([data], Path(tmp), True)
        return oracle.judge(tmp, story.id)


def book(sid="T", **kw):
    return model.Story(sid, "test", model.scope(n=90), **kw)


def reasons(result):
    return [[row, status, codes] for row, status, codes, *_ in result["links"]]


class Links(unittest.TestCase):
    def test_linked_row_names_its_mapping_evidence_account_and_gl_rows(self):
        s = book().item("A", "w=1").item("B", "w=1", acct="1320").gls()
        r = run(s)
        self.assertEqual(r["links"], [[2, "linked", [], [2], [2], "1310|branch=01", [2]],
                                      [3, "linked", [], [3], [3], "1320|branch=01", [3]]])
        self.assertEqual(r["unlinked"], [])
        self.assertEqual(r["financial"], "ready")

    def test_no_mapping_lists_no_evidence_or_account(self):
        s = book().item("A", "w=1").item("B", "w=1", mapping=False, evidence=False).gls()
        r = run(s)
        self.assertEqual(r["links"][1], [3, "unlinked", ["NO_MAPPING"], [], [], None, []])
        self.assertIn('mapping:["B","w=1"]', r["missing"])

    def test_two_mappings_are_listed_and_none_is_chosen(self):
        s = book().item("A", "w=1")
        s.rows[1].append(["MP-2", "A", "w=1", "1320", "branch=02", "EV-00001"])
        r = run(s.gls())
        self.assertEqual(r["links"][0], [2, "unlinked", ["MAPPINGS"], [2, 3], [], None, []])
        self.assertIn('mapping:["A","w=1"]', r["missing"])

    def test_missing_evidence_keeps_the_account_and_gl_rows(self):
        s = book().item("A", "w=1").item("B", "w=1", evidence=False).gls()
        r = run(s)
        self.assertEqual(r["links"][1], [3, "unlinked", ["NO_EVIDENCE"], [3], [], "1310|branch=01", [2]])
        self.assertIn('evidence:["B","w=1"]', r["missing"])

    def test_two_evidence_rows_are_listed_and_none_is_chosen(self):
        s = book().item("A", "w=1")
        e = list(s.rows[2][-1]); e[13] = "OTHER"; s.rows[2].append(e)
        r = run(s.gls())
        self.assertEqual(r["links"][0][:5], [2, "unlinked", ["EVIDENCES"], [2], [2, 3]])

    def test_every_differing_evidence_field_in_contract_order(self):
        s = book().item("A", "w=1", unit="BOX", prec="1", qty="1.5", val="V1", acct="1310",
                        ev_over={"Item ID": "Z", "Item dimensions": "w=9", "Unit": "EA", "Quantity precision": "2",
                                 "Valuation reference": "V0", "GL account": "1399", "GL dimensions": "branch=09"},
                        link=("unlinked", []))
        r = run(s.gl("1310", "branch=01", debit="0.00"))
        self.assertEqual(r["links"][0][2], oracle.EVIDENCE_CODES)

    def test_each_evidence_field_alone(self):
        for field, code in zip(["Unit", "Quantity precision", "Valuation reference", "GL account", "GL dimensions"],
                               oracle.EVIDENCE_CODES[2:]):
            with self.subTest(field=field):
                other = {"Unit": "KG", "Quantity precision": "3", "Valuation reference": "VX", "GL account": "1388",
                         "GL dimensions": "branch=88"}[field]
                s = book().item("A", "w=1", ev_over={field: other}, link=("unlinked", []))
                r = run(s.gl("1310", "branch=01", debit="0.00"))
                self.assertEqual(r["links"][0][2], [code])

    def test_evidence_of_another_item(self):
        s = book().item("A", "w=1", eid="EV-S", val="V").item("B", "w=2", evidence=False, eid="EV-S", val="V")
        r = run(s.gls())
        self.assertEqual(r["links"][1][2], ["EVIDENCE_ITEM", "EVIDENCE_DIMENSIONS"])

    def test_identity_is_compared_as_written(self):
        s = book().item("420", "w=1").item("00420", "w=1", mapping=False, evidence=False)
        s.item("C", "Warehouse=1", mapping=False, evidence=False)
        s.rows[1].append(["MP-L", "C", "warehouse=1", "1310", "branch=01", "EV-00001"])
        r = run(s.gls())
        self.assertEqual(reasons(r), [[2, "linked", []], [3, "unlinked", ["NO_MAPPING"]],
                                      [4, "unlinked", ["NO_MAPPING"]]])
        self.assertEqual(r["unlinked"], [["mapping", 3, "MP-L", "NO_REGISTER"]])

    def test_a_linked_row_whose_account_has_no_gl_row(self):
        s = book().item("A", "w=1").item("B", "w=1", acct="1330")
        r = run(s.gl("1310", "branch=01"))
        self.assertEqual(r["links"][1], [3, "linked", [], [3], [3], "1330|branch=01", []])
        self.assertEqual(r["unlinked"], [["account", None, "1330|branch=01", "NO_GL_RECORD"]])
        self.assertIn('gl:["1330","branch=01"]', r["missing"])

    def test_unlinked_records_in_role_then_record_order(self):
        s = book().item("A", "w=1")
        s.rows[1].append(["MP-X", "X", "w=1", "1310", "branch=01", "EV-00001"])
        s.rows[2].append(["EV-X", "X", "w=1", "EA", "0", "V", "1310", "branch=01", "inventory", "debit-positive",
                          "provided-posted-carrying-value", "2026-01-01", "2027-12-31", "R"])
        s.gls().gl("1390", "branch=01", debit="5.00").gl("1391", "branch=01", debit="6.00")
        s.item("B", "w=1", acct="1340")
        r = run(s)
        self.assertEqual(r["unlinked"], [["mapping", 3, "MP-X", "NO_REGISTER"], ["evidence", 3, "EV-X", "NO_MAPPING"],
                                         ["gl", 3, "1390|branch=01", "NO_LINKED_REGISTER"],
                                         ["gl", 4, "1391|branch=01", "NO_LINKED_REGISTER"],
                                         ["account", None, "1340|branch=01", "NO_GL_RECORD"]])

    def test_a_mapping_naming_an_unlinked_register_row_is_not_an_orphan(self):
        s = book().item("A", "w=1", evidence=False).item("B", "w=1")
        r = run(s.gls())
        self.assertEqual(r["unlinked"], [])

    def test_unparsed_rows_have_no_link_and_their_neighbours_read_without_them(self):
        s = book().item("A", "w=1").item("B", "w=1", mapping=False)
        s.raw[0].append(["C", "w=1", "ten", "EA", "0", "1.00", "V"] + [s.scope[f] for f in model.FIELDS])
        s.raw[1].append(["MP-B", "B", "w=1", "1310", "branch=01", ""] + [s.scope[f] for f in model.FIELDS])
        r = run(s.gls())
        self.assertEqual(reasons(r), [[2, "linked", []], [3, "unlinked", ["NO_MAPPING"]]])
        self.assertEqual(r["unlinked"], [["evidence", 3, "EV-00002", "NO_MAPPING"]])
        self.assertEqual(r["financial"], "source-error")

    def test_duplicate_register_rows_both_link(self):
        s = book().item("A", "w=1")
        s.rows[0].append(list(s.rows[0][-1]))
        r = run(s.gls())
        self.assertEqual(reasons(r), [[2, "linked", []], [3, "linked", []]])

    def test_order_follows_the_register_not_the_item(self):
        s = book().item("Z", "w=1").item("A", "w=1", mapping=False, evidence=False).item("M", "w=1")
        r = run(s.gls())
        self.assertEqual([x[0] for x in r["links"]], [2, 3, 4])

    def test_related_rows_in_record_order(self):
        s = book().item("A", "w=1")
        s.rows[1].insert(0, ["MP-0", "A", "w=1", "1310", "branch=01", "EV-00001"])
        r = run(s.gls())
        self.assertEqual(r["links"][0][3], [2, 3])

    def test_over_the_row_budget_is_refused(self):
        s = book()
        for k in range(6667):
            s.item(f"S{k}", "w=1")
        s.gls()
        try:
            got = run(s)
        except ValueError as error:
            self.fail(f"the oracle stopped instead of refusing: {error}")
        self.assertEqual(got, {"refused": "ROWS"})

    def test_the_budget_admits_exactly_its_limit(self):
        original = oracle.LIMIT
        try:
            oracle.LIMIT = 7  # three items of three rows, and one GL row
            s = book().item("A", "w=1").item("B", "w=1")
            self.assertIsNone(run(s.gls())["refused"])
            s.gl("1390", "branch=01", debit="1.00")
            self.assertEqual(run(s), {"refused": "ROWS"})
        finally:
            oracle.LIMIT = original

    def test_a_gl_row_named_only_by_unlinked_rows_is_unlinked(self):
        s = book().item("A", "w=1").item("B", "w=1", acct="1350", unit="BOX", ev_over={"Unit": "EA"},
                                          link=("unlinked", ["EVIDENCE_UNIT"]))
        r = run(s.gls().gl("1350", "branch=01", debit="9.00"))
        self.assertEqual(r["unlinked"], [["gl", 3, "1350|branch=01", "NO_LINKED_REGISTER"]])

    def test_product_missing_keys_use_the_product_spelling(self):
        s = book().item("A", "w=1").item("ب", "م=1", mapping=False, evidence=False)
        r = run(s.gls())
        self.assertEqual(r["missing"], ['mapping:["ب","م=1"]'])

    def test_disagreement_with_the_reference_stops_the_oracle(self):
        original = oracle.EVIDENCE_CODES
        try:
            oracle.EVIDENCE_CODES = original[:2]  # unit and later fields never compared
            s = book().item("A", "w=1", unit="BOX", ev_over={"Unit": "EA"})
            with self.assertRaises(AssertionError):
                run(s.gls())
        finally:
            oracle.EVIDENCE_CODES = original


class Blindness(unittest.TestCase):
    def test_the_oracle_does_not_read_the_intent(self):
        text = (HERE / "oracle.py").read_text(encoding="utf-8").split('"""', 2)[2]
        for word in ("import stories", "stories.json", "intent", "render"):
            self.assertNotIn(word, text)


class Intent(unittest.TestCase):
    def test_every_focused_story_equals_its_intent(self):
        facts = json.loads((HERE / "frozen" / "stories.json").read_text(encoding="utf-8"))["stories"]
        for s in facts:
            with self.subTest(story=s["id"]):
                got = oracle.judge(HERE / "frozen", s["id"])
                i = s["intent"]
                self.assertEqual(got["refused"], i["refused"])
                self.assertEqual(got["financial"], i["financial"])
                self.assertEqual([[r, st, c] for r, st, c, *_ in got["links"]], i["links"])
                self.assertEqual(got["unlinked"], i["unlinked"])


if __name__ == "__main__":
    unittest.main()
