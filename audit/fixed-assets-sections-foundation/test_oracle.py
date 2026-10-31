"""The FA-1 sections oracle: every reading rule, every section, asset, map, GL
and account code on small synthetic stories, every refusal, the reader's
ceilings, metamorphic pairs, and the oracle's agreement with every focused
story's intent. Run by mutate_oracle.py against planted faults.

    python3 -B -m unittest discover -s audit/fixed-assets-sections-foundation -p test_oracle.py -v
"""
import ast
import json
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
FROZEN = HERE / "frozen"
sys.path.insert(0, str(HERE))
import oracle  # noqa: E402
import render  # noqa: E402
import stories as model  # noqa: E402

V1, V2, F1, F2, I1 = model.V1, model.V2, model.F1, model.F2, model.I1
BOM = b"\xef\xbb\xbf"


def raw_files(s):
    j = s.to_json()
    writer = "py-min" if j["writer"] == "node-all" else j["writer"]
    return [render.patched(render.write(j["cells"][i], writer, i), i, j["patch"]) for i in range(3)], j


def call(fn, *args):
    """The oracle returns a review or a refusal for every input: anything it raises
    besides a refusal fails here as an assertion, not as an error."""
    try:
        return fn(*args)
    except oracle.Refused:
        raise
    except Exception as e:  # noqa: BLE001
        raise AssertionError(f"the oracle raised {type(e).__name__}: {e}") from None


def tokens(raw):
    try:
        return call(oracle.tokenize, raw)
    except oracle.Refused as r:
        raise AssertionError(f"refused {r.args[0]}") from None


def judge(s, raws=None):
    files, j = raw_files(s)
    given = {"names": j["names"], "readings": j["readings"], "scope": j["scope"]}
    try:
        return call(oracle.review, given, raws or files)
    except oracle.Refused as r:
        return {"refused": r.args[0]}


def project(x):
    if x["refused"]:
        return {"refused": x["refused"]}
    return {"refused": None, "run": x["run"], "sections": x["sections"],
            "assets": {"|".join([a["section"], a["assetId"], a["dimensions"]]): [a["status"], a["codes"]]
                       for a in x["assets"]},
            "unmapped": x["unmapped"],
            "accounts": {f'{a["account"]}|{a["dimensions"]}': [a["status"], a["codes"], a["register"], a["gl"],
                                                               a["difference"], a["members"]]
                         for a in x["accounts"]},
            "unplaced": x["unplaced"], "inventory": x["inventory"]}


def story(**kw):
    return model.Story("T", "test", **kw)


def two(**kw):
    """Vehicles in Riyadh and furniture in Jeddah, mapped and in the GL: every account consistent."""
    s = story(**kw)
    s.section("S-RUH-VEH", "Riyadh HQ", "Vehicles", [V1, V2])
    s.section("S-JED-FUR", "Jeddah depot", "Furniture", [F1, F2])
    model.base(s, "Vehicles", "Furniture")
    return s


def ready(test, s):
    r = judge(s)
    test.assertIsNone(r["refused"], r.get("refused"))
    return r


def accounts(r):
    return {a["account"]: [a["status"], a["codes"]] for a in r["accounts"]}


def account(r, acct):
    return next(a for a in r["accounts"] if a["account"] == acct)


def assets(r):
    return {(a["section"], a["assetId"], a["dimensions"]): [a["status"], a["codes"]] for a in r["assets"]}


def veh(r):
    return next(a for a in r["assets"] if a["section"] == "S-RUH-VEH")


def sections(r):
    return [[x[2], x[5], x[6]] for x in r["sections"]]


VEH = ("1510", "1519", "1518")
FUR = ("1520", "1529", "1528")


class Intent(unittest.TestCase):
    def test_every_focused_story_agrees_with_its_hand_written_intent(self):
        stories = {s.id: s for s in model.focused()}
        for sid, s in stories.items():
            got = project(call(oracle.judge, FROZEN, sid))
            self.assertEqual(got, s.intent(), sid)

    def test_the_oracle_does_not_read_the_stories_or_the_intent(self):
        tree = ast.parse((HERE / "oracle.py").read_text(encoding="utf-8"))
        imported = {a.name for n in ast.walk(tree) if isinstance(n, ast.Import) for a in n.names}
        imported |= {n.module for n in ast.walk(tree) if isinstance(n, ast.ImportFrom)}
        self.assertEqual(imported, {"hashlib", "json", "re", "sys", "unicodedata", "datetime", "pathlib"})
        names = {n.id for n in ast.walk(tree) if isinstance(n, ast.Name)}
        names |= {n.attr for n in ast.walk(tree) if isinstance(n, ast.Attribute)}
        strings = {n.value for n in ast.walk(tree) if isinstance(n, ast.Constant) and isinstance(n.value, str)}
        self.assertFalse({"intent", "stories", "model"} & names)
        self.assertFalse([v for v in strings if "stories.json" in v and not v.startswith("Independent oracle")])

    def test_another_layout_of_the_same_facts_gives_the_same_accounts_and_assets(self):
        a, b = call(oracle.judge, FROZEN, "F01"), call(oracle.judge, FROZEN, "F39")
        self.assertEqual(project(a)["accounts"], project(b)["accounts"])
        self.assertEqual(project(a)["assets"], project(b)["assets"])
        self.assertEqual([x["amounts"] for x in a["assets"]], [x["amounts"] for x in b["assets"]])

    def test_every_writer_reads_the_same(self):
        base = None
        for writer in ["py-min", "py-min-crlf", "py-cr", "py-all-bom", "py-pad"]:
            got = project(judge(two(writer=writer)))
            self.assertIsNone(got["refused"], writer)
            got.pop("inventory")
            base = base or got
            self.assertEqual(got, base, writer)

    def test_every_record_row_of_a_judged_section_is_counted_once(self):
        for s in model.focused():
            r = call(oracle.judge, FROZEN, s.id)
            if r["refused"]:
                continue
            self.assertEqual(sum(r["inventory"]["register"].values()), len(s.files[0]), s.id)
            rows = [n for a in r["assets"] for n in sum(a["rows"].values(), []) + a["unread"]]
            rows += [u[1] for u in r["unplaced"] if u[2] == "ROW_UNPLACED"]
            self.assertEqual(len(rows), len(set(rows)), s.id)


class Tokenizer(unittest.TestCase):
    def test_line_ends_quotes_and_blank_records(self):
        self.assertEqual(tokens(b"a,b\r\nc\rd\ne"), [["a", "b"], ["c"], ["d"], ["e"]])
        self.assertEqual(tokens(b'"a,b","c""d","e\nf"\n'), [["a,b", 'c"d', "e\nf"]])
        self.assertEqual(tokens(b'\n""\n,\n'), [[], [""], ["", ""]])
        self.assertEqual(tokens(b"a\n\n"), [["a"], []])

    def test_one_byte_order_mark_is_dropped_and_a_second_is_text(self):
        self.assertEqual(tokens(BOM + b"a"), [["a"]])
        self.assertEqual(tokens(BOM + BOM + b"a"), [["\ufeffa"]])

    def test_refusals_of_the_grammar_and_the_encoding(self):
        for raw in [b"", b"\xff", b"a\x01", b"a\x0b", "a\uffff".encode("utf-8"), b'a"b', b'"a"b', b'"a',
                    b'"a""', BOM + BOM + b'"a"']:
            with self.assertRaises(oracle.Refused) as e:
                oracle.tokenize(raw)
            self.assertEqual(e.exception.args[0], "SOURCE", raw)
        self.assertEqual(tokens(b"a\tb"), [["a\tb"]])

    def test_the_record_cell_and_size_ceilings(self):
        self.assertEqual(len(tokens(b"\n" * 20001)), 20001)
        self.assertEqual(len(tokens(b"a\n" * 20000 + b"a")), 20001)
        for raw in [b"\n" * 20002, b"a\n" * 20001 + b"a", b"," * 100, b"a" * 32768,
                    "\U0001F600".encode("utf-8") * 16384, b"\xff" + b"a" * (8 * 1024 * 1024)]:
            with self.assertRaises(oracle.Refused) as e:
                oracle.tokenize(raw)
            self.assertEqual(e.exception.args[0], "CAPACITY")
        self.assertEqual(len(tokens(b"," * 99)[0]), 100)
        self.assertEqual(len(tokens(b"a" * 32767)[0][0]), 32767)
        self.assertEqual(len(tokens("\U0001F600".encode("utf-8") * 16383 + b"a")[0][0]), 16384)


class Text(unittest.TestCase):
    def test_text_rules(self):
        for v in ["A", "\u0645", "x" * 500, "VEH 01", "a-b", "#REFX", "\U0001F600" * 250]:
            self.assertTrue(oracle.readable(v), v)
        for v in ["", " A", "A ", "\u00a0A", "A\u3000", "A\u2028", "A\u200fB", "A\tB", "=A", "+A", "@A", "-A",
                  "#N/A", "#ref!", "#DIV/0!x", "x" * 501, "\U0001F600" * 251, None]:
            self.assertFalse(oracle.readable(v), v)

    def test_dates(self):
        self.assertEqual(oracle.real_date("2028-02-29"), "2028-02-29")
        for v in ["2027-02-29", "0000-01-01", "2027-1-01", "2027-12-31 ", "\u0662\u0660\u0662\u0667-12-31", None]:
            self.assertIsNone(oracle.real_date(v), v)

    def test_amounts(self):
        self.assertEqual(oracle.amount("0", 2), 0)
        self.assertEqual(oracle.amount("00.10", 2), 10)
        self.assertEqual(oracle.amount("12.5", 3), 12500)
        self.assertEqual(oracle.amount("1000000000000.00", 2), 10 ** 14)
        self.assertEqual(oracle.amount("100000000000000", 0), 10 ** 14)
        for v, places in [("1000000000000.01", 2), ("1.5", 0), ("1.234", 2), ("-0", 2), ("+1", 2), ("1e3", 2),
                          ("1,000.00", 2), (".5", 2), ("1.", 2), (" 1", 2), ("1\u00a0", 2), ("", 2),
                          ("\u0664\u0662", 2), ("\u06f4\u06f2", 2), ("1\u066b5", 2), (None, 2)]:
            self.assertIsNone(oracle.amount(v, places), v)


class Input(unittest.TestCase):
    def test_reading_refusals(self):
        for change in [lambda r: r[0].update(confirmed=False), lambda r: r[1].update(family="x"),
                       lambda r: r[2].update(sheet=1), lambda r: r.reverse(), lambda r: r.pop(),
                       lambda r: r[0].update(extra=1)]:
            s = two()
            change(s.readings)
            self.assertEqual(judge(s)["refused"], "READING")

    def test_scope_refusals(self):
        for change in [lambda c: c.update(confirmed=False), lambda c: c.update(currency="XAU"),
                       lambda c: c.update(asOf="2027-02-30"), lambda c: c.update(entity=" X"),
                       lambda c: c.pop("glLedger"), lambda c: c.update(more="x")]:
            s = two()
            change(s.scope)
            self.assertEqual(judge(s)["refused"], "SCOPE")

    def test_reading_before_scope_before_source(self):
        s = two()
        s.readings[0]["confirmed"] = False
        s.scope["currency"] = "XAU"
        self.assertEqual(judge(s)["refused"], "READING")
        s = two()
        s.scope["currency"] = "XAU"
        files, _ = raw_files(s)
        self.assertEqual(judge(s, [b"\xff"] + files[1:])["refused"], "SCOPE")

    def test_file_names_and_headers(self):
        s = two()
        files, j = raw_files(s)
        given = {"names": [j["names"][0].upper(), *j["names"][1:]], "readings": j["readings"], "scope": j["scope"]}
        self.assertIsNone(oracle.review(given, files)["refused"])
        given["names"][1] = "T-map.xlsx"
        with self.assertRaises(oracle.Refused) as e:
            oracle.review(given, files)
        self.assertEqual(e.exception.args[0], "SOURCE")
        for side, header in [(1, model.MAP_HEADER + ["Note"]), (2, model.GL_HEADER[:-1] + ["Entity"]),
                             (1, model.MAP_HEADER[1:])]:
            s = two()
            s.files[side][0] = header
            self.assertEqual(judge(s)["refused"], "COLUMNS")

    def test_headers_in_any_order_and_padded(self):
        s = two()
        for side in (1, 2):
            order = list(reversed(range(len(s.files[side][0]))))
            s.files[side] = [[row[i] for i in order] + [""] for row in s.files[side]]
        r = ready(self, s)
        self.assertEqual(set(v[0] for v in accounts(r).values()), {"consistent"})


class Sections(unittest.TestCase):
    def test_a_section_ended_by_the_next_section_is_unclosed(self):
        s = story()
        s.open("S-RUH-VEH", "Riyadh HQ", "Vehicles")
        s.asset(V1)
        s.close(write=False)
        s.section("S-JED-FUR", "Jeddah depot", "Furniture", [F1])
        model.base(s, "Vehicles", "Furniture")
        r = ready(self, s)
        self.assertEqual(r["sections"][0][:2], [1, None])
        self.assertEqual(sections(r), [["S-RUH-VEH", "held", ["SECTION_UNCLOSED"]], ["S-JED-FUR", "read", []]])
        self.assertEqual(accounts(r)["1510"], ["held", ["SECTION_UNCLOSED"]])
        self.assertEqual(accounts(r)["1520"][0], "consistent")

    def test_an_end_record_padded_with_empty_cells_closes(self):
        s = two()
        s.files[0][s.sections[0]["end"] - 1] += ["", ""]
        self.assertEqual(sections(ready(self, s))[0], ["S-RUH-VEH", "read", []])

    def test_header_failures(self):
        changes = [
            lambda s, k: s.files[0][k].append("extra"),
            lambda s, k: s.files[0].insert(k + 1, ["Location", "Riyadh HQ"]),
            lambda s, k: s.files[0].__setitem__(k + 4, ["As of", "2027-13-31"]),
            lambda s, k: s.files[0].insert(k + 1, ["Note"]),
            lambda s, k: s.files[0].__delitem__(k + 5),
        ]
        for change in changes:
            s = two()
            k = s.sections[0]["row"] - 1
            change(s, k)
            r = ready(self, s)
            self.assertEqual(sections(r)[0][1:], ["held", ["SECTION_HEADER"]])
            self.assertEqual(accounts(r)["1510"], ["held", ["SECTION_HEADER"]])
            self.assertEqual(accounts(r)["1520"][0], "consistent")

    def test_a_section_id_with_a_formula_sign_is_a_header_failure(self):
        s = two()
        s.files[0][0] = ["Section", "=S1"]
        s.files[0][s.sections[0]["end"] - 1] = ["End section", "=S1"]
        self.assertEqual(sections(ready(self, s))[0], ["=S1", "held", ["SECTION_HEADER"]])

    def test_a_category_that_cannot_be_read_holds_every_account(self):
        for value in [None, "=Vehicles"]:
            s = story()
            labels = {"Category": value} if value else {}
            extra = [] if value else [["Category", "Vehicles"], ["Category", "Vans"]]
            s.open("S-RUH-VEH", "Riyadh HQ", "Vehicles", labels=labels, extra=extra)
            s.asset(V1)
            s.close()
            s.section("S-JED-FUR", "Jeddah depot", "Furniture", [F1])
            model.base(s, "Vehicles", "Furniture")
            r = ready(self, s)
            self.assertEqual(r["run"], ["SECTION_UNREADABLE"])
            self.assertEqual(r["sections"][0][4], None)
            self.assertEqual(accounts(r)["1520"], ["held", ["SECTION_UNREADABLE"]])
            self.assertEqual(r["unplaced"], [["register-sections", 1, "SECTION_UNREADABLE"]])

    def test_column_failures(self):
        for columns in [None, model.COLUMNS + ["Amount"], model.COLUMNS[:4] + ["Valuation"]]:
            s = story()
            s.open("S-RUH-VEH", "Riyadh HQ", "Vehicles", columns=columns)
            if columns is not None:
                for c in model.COMPONENTS:
                    s.record(None, cells=[V1[0], V1[1], c, "1.00", "VAL"])
            s.close()
            s.section("S-JED-FUR", "Jeddah depot", "Furniture", [F1])
            model.base(s, "Vehicles", "Furniture")
            r = ready(self, s)
            self.assertEqual(sections(r)[0][1:], ["held", ["SECTION_COLUMNS"]])
            self.assertEqual(accounts(r)["1519"], ["held", ["SECTION_COLUMNS"]])

    def test_each_section_takes_the_first_code_in_order(self):
        s = story()
        s.open("S1", "Riyadh HQ", "Vehicles", extra=[["Note", "x"]])
        s.asset(V1)
        s.close(end_id="S9")
        s.open("S2", "Riyadh HQ", "Furniture", extra=[["Note", "x"]], labels={"As of": "2026-12-31"})
        s.asset(F1)
        s.close()
        s.open("S3", "Riyadh HQ", "IT equipment", labels={"Entity": "Other Co"}, columns=["Asset ID"] * 3)
        s.close()
        model.base(s, "Vehicles", "Furniture", "IT equipment")
        r = ready(self, s)
        self.assertEqual(sections(r), [["S1", "held", ["SECTION_UNCLOSED"]], ["S2", "held", ["SECTION_HEADER"]],
                                       ["S3", "excluded", ["SECTION_SCOPE"]]])

    def test_another_scope_excludes_the_section_and_holds_nothing(self):
        for label, value in [("Entity", "Other Co"), ("Asset ledger", "FA-2"), ("Currency", "USD"),
                             ("As of", "2027-12-30")]:
            s = story()
            s.section("S-RUH-VEH", "Riyadh HQ", "Vehicles", [V1])
            s.open("S-OLD", "Riyadh HQ", "Vehicles", labels={label: value})
            s.asset(V1)
            s.close()
            s.sections[-1]["judged"] = False
            model.base(s, "Vehicles")
            r = ready(self, s)
            self.assertEqual(sections(r)[1][1:], ["excluded", ["SECTION_SCOPE"]], label)
            self.assertEqual(assets(r), {("S-RUH-VEH", "VEH-0101", "CC-110"): ["read", []]})
            self.assertEqual(set(v[0] for v in accounts(r).values()), {"consistent"})

    def test_an_excluded_category_needs_no_map(self):
        s = story()
        s.section("S-RUH-VEH", "Riyadh HQ", "Vehicles", [V1])
        s.open("S-OLD", "Riyadh HQ", "Ships", labels={"As of": "2026-12-31"})
        s.close()
        model.base(s, "Vehicles")
        r = ready(self, s)
        self.assertEqual(r["unmapped"], [])
        self.assertEqual(set(v[0] for v in accounts(r).values()), {"consistent"})

    def test_labels_are_not_carried_from_the_section_before(self):
        s = story()
        s.section("S-RUH-VEH", "Riyadh HQ", "Vehicles", [V1])
        s.section("S-RUH-FUR", "Riyadh HQ", "Furniture", [F1], labels={"Location": None})
        model.base(s, "Vehicles", "Furniture")
        r = ready(self, s)
        self.assertEqual(sections(r)[1][1:], ["held", ["SECTION_HEADER"]])
        self.assertIsNone(r["sections"][1][3])

    def test_rows_outside_sections(self):
        for cells in [["End section", "S-RUH-VEH"], [" "], ["", "x"], ["Section total", "cost", "1.00"]]:
            s = two()
            s.files[0].insert(s.sections[0]["end"], cells)
            r = ready(self, s)
            self.assertEqual(r["run"], ["STRAY_ROW"], cells)
            self.assertEqual(r["unplaced"], [["register-sections", s.sections[0]["end"] + 1, "STRAY_ROW"]])
            self.assertEqual(set(v[1][0] for v in accounts(r).items()), {"held"})
        s = two()
        s.files[0].insert(s.sections[0]["end"], ["", ""])
        self.assertEqual(ready(self, s)["run"], [])

    def test_two_sections_with_one_id_are_held_but_read(self):
        s = story()
        s.section("S-VEH", "Riyadh HQ", "Vehicles", [V1])
        s.section("S-VEH", "Jeddah depot", "Furniture", [F1])
        model.base(s, "Vehicles", "Furniture")
        r = ready(self, s)
        self.assertEqual(sections(r), [["S-VEH", "held", ["SECTION_DUPLICATE"]]] * 2)
        self.assertEqual(len(r["assets"]), 2)
        self.assertEqual(accounts(r)["1528"], ["held", ["SECTION_DUPLICATE"]])


class Assets(unittest.TestCase):
    def section_of(self, a, **kw):
        s = story()
        s.open("S-RUH-VEH", "Riyadh HQ", "Vehicles")
        rows = s.asset(a, **kw)
        s.close()
        s.section("S-JED-FUR", "Jeddah depot", "Furniture", [F1])
        model.base(s, "Vehicles", "Furniture")
        return s, rows

    def test_a_missing_component_is_never_derived(self):
        for c in model.COMPONENTS:
            s, _ = self.section_of(V1, omit=[c])
            r = ready(self, s)
            self.assertEqual(veh(r)["codes"], ["COMPONENT_MISSING"], c)
            self.assertIsNone(veh(r)["amounts"][c])
            self.assertEqual(accounts(r)["1518"], ["held", ["COMPONENT_MISSING"]])

    def test_a_written_zero_is_a_component(self):
        s, _ = self.section_of(V1, text={"impairment": "0"})
        r = ready(self, s)
        self.assertEqual(veh(r)["amounts"]["impairment"], 0)
        self.assertEqual(accounts(r)["1518"], ["consistent", []])

    def test_repeated_components_and_their_rows(self):
        s, rows = self.section_of(V1, repeat={"cost": [V1[2]]})
        r = ready(self, s)
        self.assertEqual(veh(r)["codes"], ["COMPONENT_REPEATED"])
        self.assertEqual(veh(r)["rows"]["cost"], rows["cost"])
        self.assertIsNone(veh(r)["amounts"]["cost"])

    def test_amounts_that_do_not_read(self):
        for text in ["", "-0.00", "+1.00", "1e3", "1,000.00", "180000.000", "180000.00 ", "\u0661.00"]:
            s, _ = self.section_of(V1, text={"cost": text})
            r = ready(self, s)
            self.assertEqual(veh(r)["codes"], ["AMOUNT"], text)
            self.assertEqual(accounts(r)["1519"], ["held", ["AMOUNT"]])

    def test_the_carrying_equation(self):
        for kw in [{"carrying": V1[2] - V1[3] - V1[4] + 1}, {"imp": V1[2], "carrying": 0}]:
            s, _ = self.section_of(V1, **kw)
            self.assertEqual(veh(ready(self, s))["codes"], ["CARRYING"])
        s, _ = self.section_of(["VEH-0", "CC-1", 500, 500, 0])
        self.assertEqual(veh(ready(self, s))["codes"], [])

    def test_valuation_references(self):
        s, _ = self.section_of(V1, vals={"cost": "VAL-X"})
        r = ready(self, s)
        self.assertEqual(veh(r)["codes"], ["VALUATION"])
        self.assertIsNone(veh(r)["valuation"])
        s, _ = self.section_of(V1, vals={"cost": "=VAL"})
        r = ready(self, s)
        self.assertEqual(veh(r)["codes"], ["TEXT"])
        self.assertEqual(veh(r)["valuation"], "VAL-2027-VEH")

    def test_unknown_component_words(self):
        for word in ["Cost", "cost ", "accumulated depreciation", ""]:
            s, rows = self.section_of(V1, word={"cost": word})
            r = ready(self, s)
            self.assertEqual(veh(r)["codes"], ["COMPONENT", "COMPONENT_MISSING"], word)
            self.assertEqual(veh(r)["unread"], rows["cost"])

    def test_cells_past_the_columns(self):
        s, _ = self.section_of(V1, extra={"cost": ["", "note"]})
        self.assertEqual(veh(ready(self, s))["codes"], ["CELLS"])
        s, _ = self.section_of(V1, extra={"cost": ["", ""]})
        self.assertEqual(veh(ready(self, s))["codes"], [])

    def test_identity_is_section_asset_and_dimensions_as_written(self):
        s = story()
        s.section("S-RUH-VEH", "Riyadh HQ", "Vehicles", [V1, ["VEH-0101", "CC-110 ", 1, 0, 0],
                                                       ["veh-0101", "CC-110", 1, 0, 0]])
        model.base(s, "Vehicles")
        r = ready(self, s)
        self.assertEqual(sorted(a["assetId"] for a in r["assets"]), ["VEH-0101", "veh-0101"])
        self.assertEqual(sections(r)[0][1:], ["held", ["ROW_UNPLACED"]])
        self.assertEqual(len(r["unplaced"]), 4)

    def test_one_asset_id_in_two_sections_whatever_the_dimensions(self):
        s = story()
        s.section("S1", "Riyadh HQ", "Vehicles", [V1])
        s.section("S2", "Jeddah depot", "Furniture", [F1, ["VEH-0101", "CC-999", 100, 0, 0]])
        model.base(s, "Vehicles", "Furniture")
        r = ready(self, s)
        self.assertEqual(assets(r), {("S1", "VEH-0101", "CC-110"): ["held", ["ID_SECTIONS"]],
                                     ("S2", "FUR-0201", "CC-120"): ["read", []],
                                     ("S2", "VEH-0101", "CC-999"): ["held", ["ID_SECTIONS"]]})

    def test_a_held_asset_holds_every_account_of_its_category(self):
        s, _ = self.section_of(V1, repeat={"impairment": [0]})
        r = ready(self, s)
        for acct in VEH:
            self.assertEqual(accounts(r)[acct], ["held", ["COMPONENT_REPEATED"]])
        for acct in FUR:
            self.assertEqual(accounts(r)[acct][0], "consistent")


class Totals(unittest.TestCase):
    def with_totals(self, totals, assets=(V1, V2), extra=None):
        s = story()
        s.open("S-RUH-VEH", "Riyadh HQ", "Vehicles")
        for a in assets:
            s.asset(a)
        if extra:
            s.record(None, cells=extra)
        for t in totals:
            s.put(t, "total")
        s.close()
        model.base(s, "Vehicles")
        return ready(self, s)

    def test_totals_that_agree_for_each_component(self):
        totals = [["Section total", c, model.money(v, 2)] for c, v in
                  [("cost", 27500000), ("depreciation", 10050000), ("impairment", 150000), ("carrying", 17300000)]]
        r = self.with_totals(totals)
        self.assertEqual(sections(r)[0][1:], ["read", []])

    def test_a_total_one_minor_unit_out(self):
        for c, v in [("cost", 27500001), ("carrying", 17299999)]:
            r = self.with_totals([["Section total", c, model.money(v, 2)]])
            self.assertEqual(sections(r)[0][1:], ["held", ["TOTAL_MISMATCH"]], c)
            self.assertEqual(accounts(r)["1518"], ["held", ["TOTAL_MISMATCH"]])

    def test_totals_that_cannot_be_read_or_checked(self):
        bad = [[["Section total", "cost", "275000.00", "x"]], [["Section total", "Cost", "275000.00"]],
               [["Section total", "cost", "275,000.00"]],
               [["Section total", "cost", "275000.00"], ["Section total", "cost", "275000.00"]]]
        for totals in bad:
            r = self.with_totals(totals)
            self.assertEqual(sections(r)[0][1:], ["held", ["TOTAL_FIELD"]], totals)
        r = self.with_totals([["Section total", "cost", "275000.00"]], extra=["VEH-9", "CC-1", "Cost", "1.00", "V"])
        self.assertEqual(sections(r)[0][1:], ["held", ["TOTAL_FIELD"]])
        r = self.with_totals([["Section total", "cost", "275000.00"]], extra=["VEH-9", "CC-1", "cost", "x", "V"])
        self.assertEqual(sections(r)[0][1:], ["held", ["TOTAL_FIELD"]])
        r = self.with_totals([["Section total", "depreciation", "100500.00"]],
                             extra=["VEH-9", "CC-1", "cost", "x", "V"])
        self.assertEqual(sections(r)[0][1:], ["read", []])

    def test_a_total_counts_rows_of_held_assets_and_unplaced_rows(self):
        r = self.with_totals([["Section total", "cost", "275001.00"]], extra=["=X", "CC-1", "cost", "1.00", "V"])
        self.assertEqual(sections(r)[0][1:], ["held", ["ROW_UNPLACED"]])


class Map(unittest.TestCase):
    def mapped(self, rows, more=()):
        s = story()
        s.section("S-RUH-VEH", "Riyadh HQ", "Vehicles", [V1])
        for row in rows:
            s.map_row(None, None, cells=row, placed=False)
        for acct, normal in {"1510": V1[2], "1519": V1[3], "1518": V1[4]}.items():
            s.gl_row(acct, normal)
        for acct, normal, component in more:
            s.gl_row(acct, normal, component=component)
        return ready(self, s)

    def rows(self, **change):
        out = []
        for c in model.THREE if hasattr(model, "THREE") else ["cost", "depreciation", "impairment"]:
            row = ["Vehicles", c, model.ACCOUNTS["Vehicles"][c], "BU-01", model.CLASSES[c], "2020-01-01",
                   "9999-12-31"]
            for k, v in change.get(c, {}).items():
                row[k] = v
            out.append(row)
        return out

    def test_validity_is_inclusive(self):
        for frm, to in [("2027-12-31", "9999-12-31"), ("2020-01-01", "2027-12-31")]:
            r = self.mapped(self.rows(cost={5: frm, 6: to}))
            self.assertEqual(accounts(r)["1510"], ["consistent", []])
        r = self.mapped(self.rows(cost={6: "2027-12-30"}))
        self.assertEqual(r["unmapped"], [["Vehicles", "cost", "MAP_EXPIRED"]])
        self.assertEqual(accounts(r)["1510"], ["held", ["MAP_EXPIRED"]])

    def test_map_row_failures(self):
        for change in [{5: "2028-01-01", 6: "2027-01-01"}, {5: "2027-02-30"}, {2: "=1510"}, {3: ""}, None]:
            rows = self.rows(depreciation=change or {})
            if change is None:
                rows[1].append("note")
            r = self.mapped(rows)
            self.assertEqual(r["unmapped"], [["Vehicles", "depreciation", "MAP_ROW"]], change)
            self.assertEqual(accounts(r)["1519"], ["held", ["MAP_ROW"]])
            self.assertEqual(accounts(r)["1510"], ["consistent", []])

    def test_a_class_that_is_not_the_component_s(self):
        r = self.mapped(self.rows(impairment={4: "accumulated-depreciation"}))
        self.assertEqual(r["unmapped"], [["Vehicles", "impairment", "MAP_CLASS"]])

    def test_two_valid_rows_and_no_row(self):
        rows = self.rows()
        rows.append(["Vehicles", "cost", "1511", "BU-01", "fixed-asset-cost", "2027-01-01", "9999-12-31"])
        r = self.mapped(rows)
        self.assertEqual(r["unmapped"], [["Vehicles", "cost", "MAP_REPEATED"]])
        r = self.mapped(self.rows()[:2])
        self.assertEqual(r["unmapped"], [["Vehicles", "impairment", "MAP_ABSENT"]])
        self.assertEqual(accounts(r)["1518"], ["held", ["MAP_ABSENT"]])

    def test_a_pair_of_another_category_holds_nothing(self):
        rows = self.rows() + [["Ships", "cost", "1560", "BU-01", "fixed-asset-cost", "2020-01-01", "2026-12-31"]]
        r = self.mapped(rows)
        self.assertEqual(r["unmapped"], [])
        self.assertEqual(set(v[0] for v in accounts(r).values()), {"consistent"})

    def test_an_unplaced_pair_holds_an_unmapped_account_of_its_component(self):
        r = self.mapped(self.rows(cost={6: "2027-12-30"}), more=[("1595", 100, "cost")])
        self.assertEqual(accounts(r)["1595"], ["held", ["MAP_EXPIRED"]])

    def test_rows_that_cannot_be_put_under_a_pair(self):
        for row in [["=Vehicles", "cost", "1", "BU-01", "fixed-asset-cost", "2020-01-01", "9999-12-31"],
                    ["Vehicles", "Cost", "1", "BU-01", "fixed-asset-cost", "2020-01-01", "9999-12-31"],
                    ["Vehicles", "carrying", "1", "BU-01", "fixed-asset-cost", "2020-01-01", "9999-12-31"]]:
            r = self.mapped(self.rows() + [row])
            self.assertEqual(r["run"], ["MAP_UNREADABLE"])
            self.assertEqual(r["unplaced"], [["category-map", 5, "MAP_UNREADABLE"]])


class GL(unittest.TestCase):
    def test_gl_row_failures(self):
        for k, v in [(2, "other"), (3, ""), (4, "1.5.0"), (9, "note")]:
            s = two()
            row = s.files[2][1]
            if k == 9:
                row.append(v)
            else:
                row[k] = v
            r = ready(self, s)
            self.assertEqual(accounts(r)[row[0]], ["held", ["GL_ROW"]], k)

    def test_gl_scope(self):
        for k, v in [(5, "Other Co"), (6, "GL-2026"), (7, "USD"), (8, "2027-12-30")]:
            s = two()
            s.files[2][1][k] = v
            r = ready(self, s)
            self.assertEqual(accounts(r)[s.files[2][1][0]], ["held", ["GL_SCOPE"]], k)

    def test_a_repeated_gl_account_even_when_equal(self):
        s = two()
        s.files[2].append(list(s.files[2][1]))
        r = ready(self, s)
        self.assertEqual(accounts(r)[s.files[2][1][0]], ["held", ["GL_REPEATED"]])

    def test_a_gl_row_with_no_account_holds_everything(self):
        s = two()
        s.files[2][1][1] = "=BU"
        r = ready(self, s)
        self.assertEqual(r["run"], ["GL_UNREADABLE"])
        self.assertEqual(r["unplaced"], [["gl-balances", 2, "GL_UNREADABLE"]])

    def test_normal_balances_keep_their_sign(self):
        s = story()
        s.section("S-RUH-VEH", "Riyadh HQ", "Vehicles", [V1])
        s.standard_map("Vehicles")
        s.gl_row("1510", -500, debit="0.00", credit="5.00")
        s.gl_row("1519", -700, debit="10.00", credit="3.00")
        s.gl_row("1518", 0, debit="2.00", credit="2.00")
        r = ready(self, s)
        self.assertEqual([account(r, a)["gl"] for a in VEH], [-500, -700, 0])
        self.assertEqual(account(r, "1510")["difference"], V1[2] + 500)
        self.assertEqual(account(r, "1518")["status"], "consistent")

    def test_class_conflict_needs_a_map(self):
        s = two()
        s.gl_row(None, cells=["1599", "BU-01", "accumulated-impairment", "0.00", "4.00", model.ENTITY, "GL-2027",
                              "SAR", "2027-12-31"])
        r = ready(self, s)
        self.assertEqual(accounts(r)["1599"], ["missing", ["UNMAPPED"]])
        self.assertEqual(account(r, "1599")["component"], "impairment")
        self.assertEqual(account(r, "1599")["gl"], 400)


class Accounts(unittest.TestCase):
    def test_members_and_a_shared_account(self):
        s = story()
        s.section("S-RUH-VEH", "Riyadh HQ", "Vehicles", [V1, V2])
        s.section("S-JED-FUR", "Jeddah depot", "Furniture", [F1])
        s.standard_map("Vehicles", "Furniture", skip=[("Furniture", "impairment")])
        s.map_row("Furniture", "impairment", "1518")
        s.gl_consistent()
        r = ready(self, s)
        self.assertEqual(account(r, "1518")["members"],
                         [["S-JED-FUR", "FUR-0201", "CC-120", "impairment"],
                          ["S-RUH-VEH", "VEH-0101", "CC-110", "impairment"],
                          ["S-RUH-VEH", "VEH-0102", "CC-110", "impairment"]])
        self.assertEqual(account(r, "1518")["register"], V1[4] + V2[4] + F1[4])
        self.assertNotIn("1528", accounts(r))

    def test_a_held_account_shows_no_amounts_but_its_members(self):
        s = two()
        s.files[2][1][7] = "USD"
        r = ready(self, s)
        a = account(r, s.files[2][1][0])
        self.assertEqual([a["register"], a["gl"], a["difference"]], [None, None, None])
        self.assertEqual(len(a["members"]), 2)

    def test_missing_accounts_even_at_zero(self):
        s = story()
        s.section("S-RUH-VEH", "Riyadh HQ", "Vehicles", [V1])
        s.standard_map("Vehicles", "Buildings")
        s.gl_consistent(skip=("1519",))
        r = ready(self, s)
        self.assertEqual(accounts(r)["1540"], ["missing", ["REGISTER_ABSENT"]])
        self.assertEqual(account(r, "1540")["gl"], 0)
        self.assertEqual(accounts(r)["1519"], ["missing", ["GL_ABSENT"]])
        self.assertEqual(account(r, "1519")["register"], V1[3])

    def test_a_difference_is_its_own(self):
        s = story()
        s.section("S-RUH-VEH", "Riyadh HQ", "Vehicles", [V1])
        s.standard_map("Vehicles")
        s.gl_consistent(adjust={"1510": 1, "1519": 1})
        r = ready(self, s)
        self.assertEqual([account(r, a)["difference"] for a in VEH], [-1, -1, 0])
        self.assertEqual([accounts(r)[a][0] for a in VEH], ["difference", "difference", "consistent"])

    def test_sums_beyond_exact_integers_are_refused(self):
        def big(n):
            s = story()
            s.section("S-BIG", "Riyadh HQ", "Buildings",
                      [[f"B{i}", "CC-1", 10 ** 14, 0, 0] for i in range(n)])
            s.standard_map("Buildings")
            s.gl_row("1540", 0)
            s.gl_row("1549", 0)
            s.gl_row("1548", 0)
            return judge(s)
        self.assertEqual(big(90)["accounts"][0]["register"], 90 * 10 ** 14)
        self.assertEqual(big(91)["refused"], "TOTAL_LIMIT")


if __name__ == "__main__":
    unittest.main()
