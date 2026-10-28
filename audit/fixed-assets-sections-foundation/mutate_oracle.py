"""Plant one fault at a time in a copy of oracle.py and require test_oracle.py
to fail with an assertion. A crash or a stale anchor is not a detection.

    python3 -B audit/fixed-assets-sections-foundation/mutate_oracle.py [--out results/oracle-mutants-1.json]
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
FAULTS = [
    ("bom-kept", 'if text[:1] == "\\ufeff":', "if False:"),
    ("every-bom-dropped", "        text = text[1:]\n", '        text = text.lstrip("\\ufeff")\n'),
    ("control-characters-read", "if any(ord(c) in FORBIDDEN for c in text):", "if False:"),
    ("quote-inside-a-cell-read", '            if state != "start":\n                raise Refused("SOURCE")',
     '            if state == "closed":\n                raise Refused("SOURCE")'),
    ("text-after-a-closing-quote-read", '            if state == "closed":\n                raise Refused("SOURCE")\n'
     "            cell_add(ch)", "            cell_add(ch)"),
    ("record-ceiling-one-short", "if len(records) == MAX_RECORDS:", "if len(records) == MAX_RECORDS - 1:"),
    ("cell-ceiling-one-over", "if len(cells) == MAX_CELLS - 1:", "if len(cells) == MAX_CELLS:"),
    ("astral-characters-one-unit", "return sum(2 if ord(c) > 0xFFFF else 1 for c in s)", "return len(s)"),
    ("size-checked-after-decoding", "    if len(raw) > MAX_BYTES:\n        raise Refused(\"CAPACITY\")\n", ""),
    ("trailing-empty-cells-meaningful", 'while k and cells[k - 1] == "":', "while False:"),
    ("spaces-only-row-blank", 'return all(c == "" for c in cells)', 'return all(c.strip() == "" for c in cells)'),
    ("edge-spaces-read", 'if edge(v[0]) or edge(v[-1]) or v[0] in "=+@-":', 'if v[0] in "=+@-":'),
    ("formula-signs-read", 'if edge(v[0]) or edge(v[-1]) or v[0] in "=+@-":', "if edge(v[0]) or edge(v[-1]):"),
    ("format-characters-read", 'in ("Cc", "Cf")', 'in ("Cc",)'),
    ("excel-errors-read", 'return not re.match(r"#(?:REF!|VALUE!|N/A|DIV/0!)", v, re.IGNORECASE)', "return True"),
    ("extra-decimals-read", ' or len(m.group(2) or "") > places', ""),
    ("bound-off", "return n if n <= BOUND else None", "return n"),
    ("arabic-indic-digits-read", 'm = re.fullmatch(r"([0-9]+)(?:\\.([0-9]+))?", v)',
     'm = re.fullmatch(r"(\\d+)(?:\\.(\\d+))?", v)'),
    ("family-unchecked", ' or r["family"] != FAMILY', ""),
    ("file-type-unchecked", 'if not isinstance(name, str) or not name.lower().endswith(".csv"):',
     "if not isinstance(name, str):"),
    ("headers-in-fixed-order", "if len(head) != len(header) or set(head) != set(header):", "if head != header:"),
    ("unclosed-read", "    elif not closed:\n", "    elif False:\n"),
    ("any-end-closes", "closed = sec[\"end\"] is not None and meaningful(records[sec[\"end\"]]) == "
     "[\"End section\", sid if sid else \"\"]", "closed = sec[\"end\"] is not None"),
    ("header-unchecked", "    elif not header_ok:\n", "    elif False:\n"),
    ("unknown-labels-read", "                 and all(len(meaningful(records[k])) == 2 and meaningful(records[k])[0] "
     "in LABELS\n                         for k in label_rows)\n", ""),
    ("as-of-label-not-a-date", "\n                 and real_date(labels[\"As of\"][0]) is not None)", ")"),
    ("section-scope-unchecked", "    elif any(once[lab] != scope[key] for lab, key in SECTION_SCOPE):\n",
     "    elif False:\n"),
    ("columns-unchecked", "elif column is None or (lambda m: len(m) != 5 or set(m) != set(COLUMNS))"
     "(meaningful(records[column])):", "elif column is None:"),
    ("duplicate-sections-read", 'if ids.count(s["id"]) > 1:', "if False:"),
    ("unplaced-row-dropped", '            sec["codes"].append("ROW_UNPLACED")\n', ""),
    ("cells-past-the-columns-read", "if len(meaningful(cells)) > 5:", "if False:"),
    ("unknown-component-ignored", '            a["codes"].add("COMPONENT")\n', ""),
    ("blank-amount-zero", "minor = amount(text, places)\n", "minor = amount(text, places) if text else 0\n"),
    ("missing-carrying-derived", "if any(v == 0 for v in counts.values()):",
     'if any(v == 0 for c, v in counts.items() if c != "carrying"):'),
    ("repeated-component-read", "if any(v > 1 for v in counts.values()):", "if False:"),
    ("valuation-unchecked", 'if len(a["vals"]) > 1:', "if False:"),
    ("carrying-unchecked", '!= once["carrying"]:', '!= once["carrying"] and False:'),
    ("asset-id-in-two-sections-read", 'if len(where[a["id"]]) > 1:', "if False:"),
    ("totals-unchecked", '            sec["codes"].append("TOTAL_MISMATCH")\n', "            pass\n"),
    ("total-fields-unchecked", '    if field:\n        sec["codes"].append("TOTAL_FIELD")\n', ""),
    ("totals-checked-past-unknown-components",
     'if any(r["comp"] not in FOUR for r in rows) or any(r["comp"] == c and not r["amountReads"] for r in rows):',
     'if any(r["comp"] == c and not r["amountReads"] for r in rows):'),
    ("map-class-unchecked", 'if get(cells, mpos, "Account class") != CLASS[comp]:', "if False:"),
    ("map-validity-ignored", 'valid = [r for r in rows if r["from"] <= scope["asOf"] <= r["to"]]',
     "valid = list(rows)"),
    ("map-validity-exclusive", 'r["from"] <= scope["asOf"] <= r["to"]', 'r["from"] < scope["asOf"] <= r["to"]'),
    ("first-valid-map-row-taken", "        if len(valid) == 1:\n            placed[pair]",
     "        if valid:\n            placed[pair]"),
    ("map-absent-ignored", '                unplaced_pairs[(cat, comp)] = {"MAP_ABSENT"}\n', "                pass\n"),
    ("excluded-category-needs-a-map", 'register_categories = {s["category"] for s in sections if s["code"] not in '
     '("SECTION_SCOPE", "SECTION_UNREADABLE")}', 'register_categories = {s["category"] for s in sections if '
     's["code"] != "SECTION_UNREADABLE"}'),
    ("unplaced-pair-holds-nothing", "            if comp == component:\n                codes.update(c)\n",
     "            pass\n"),
    ("held-asset-holds-nothing", "        for s, a in held_assets:\n            if s[\"category\"] in cats:",
     "        for s, a in held_assets:\n            if False:"),
    ("held-section-holds-nothing", "        for s in held_sections:\n            if s[\"category\"] in cats:",
     "        for s in held_sections:\n            if False:"),
    ("gl-scope-unchecked", '            codes.add("GL_SCOPE")\n', "            pass\n"),
    ("gl-row-unchecked", '            codes.add("GL_ROW")\n', "            pass\n"),
    ("repeated-gl-read", '        if len(rows) > 1:\n            codes.add("GL_REPEATED")\n', ""),
    ("class-conflict-unchecked", '            codes.add("CLASS_CONFLICT")\n', "            pass\n"),
    ("account-components-unchecked", '            codes.add("ACCOUNT_COMPONENTS")\n', "            pass\n"),
    ("gl-sign-of-cost-everywhere", 'balance = r["debit"] - r["credit"] if component == "cost" else r["credit"] - '
     'r["debit"]', 'balance = r["debit"] - r["credit"]'),
    ("negative-gl-flipped", 'balance = r["debit"] - r["credit"] if component == "cost" else r["credit"] - '
     'r["debit"]', 'balance = abs(r["debit"] - r["credit"])'),
    ("register-absent-on-unmapped", "if on and not members:", "if not members:"),
    ("empty-account-consistent", '            if on and not members:\n                missing.add("REGISTER_ABSENT")\n',
     ""),
    ("stray-rows-ignored", '            run.add("STRAY_ROW")\n', "            pass\n"),
    ("unreadable-section-holds-itself", '            run.add("SECTION_UNREADABLE")\n', "            pass\n"),
    ("unreadable-map-row-ignored", '            run.add("MAP_UNREADABLE")\n', ""),
    ("unreadable-gl-row-ignored", '            run.add("GL_UNREADABLE")\n', ""),
    ("excluded-section-holds", 'held_sections = [s for s in sections if s["codes"] and s["code"] not in '
     '("SECTION_SCOPE", "SECTION_UNREADABLE")]', 'held_sections = [s for s in sections if s["codes"] and '
     's["code"] != "SECTION_UNREADABLE"]'),
    ("total-limit-off", "    if abs(n) > SAFE:\n", "    if False:\n"),
]


def tests(text):
    """Run test_oracle.py in a private copy of this folder with oracle.py
    replaced by `text`."""
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp) / "audit" / "fixed-assets-sections-foundation"
        shutil.copytree(HERE, work, ignore=shutil.ignore_patterns("results", "__pycache__"))
        (work / "oracle.py").write_text(text, encoding="utf-8")
        env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
        run = subprocess.run([sys.executable, "-B", "-m", "unittest", "discover", "-s", str(work), "-p",
                              "test_oracle.py"], capture_output=True, text=True, env=env, cwd=tmp)
        return run.returncode, run.stdout + run.stderr


def main(argv):
    source = (HERE / "oracle.py").read_text(encoding="utf-8")
    code, _ = tests(source)
    baseline = code == 0
    results = []
    for name, old, new in FAULTS if baseline else []:
        if source.count(old) != 1:
            results.append({"fault": name, "killed": False, "why": "stale anchor"})
            continue
        code, text = tests(source.replace(old, new))
        asserted = "AssertionError" in text or "FAIL:" in text
        crashed = "ERROR:" in text
        results.append({"fault": name, "killed": code != 0 and asserted and not crashed,
                        "returncode": code, "assertion": asserted, "error": crashed})
    killed = sum(r["killed"] for r in results)
    record = {"schema": "tarasuf-fa1-oracle-mutants/1", "baselinePassed": baseline, "killed": killed,
              "of": len(FAULTS), "faults": results}
    if argv[:1] == ["--out"]:
        (HERE / argv[1]).write_text(json.dumps(record, indent=1) + "\n", encoding="utf-8")
    print(json.dumps({"baselinePassed": baseline, "killed": killed, "of": len(FAULTS),
                      "survivors": [r["fault"] for r in results if not r["killed"]]}))
    if killed != len(FAULTS):
        sys.exit(1)


if __name__ == "__main__":
    main(sys.argv[1:])
