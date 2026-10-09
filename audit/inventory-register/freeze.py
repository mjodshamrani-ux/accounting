"""Freeze independently calculated synthetic originals before product implementation."""
import copy
import csv
import hashlib
import io
import json
from pathlib import Path
from reference import FIELDS, HEADERS, inspect

ROOT = Path(__file__).resolve().parent
SCOPE = dict(zip(FIELDS, ["Synthetic Stock Owner", "STOCK-BOOK", "GL-BOOK", "SAR", "functional", "posted",
                          "Current", "2026-09-30", "CHART-1", "MAP-1", "provided-posted-values-1", "INV-SET-1"]))
BASE = [
    [["A", "warehouse=W1", "10", "EA", "0", "1000", "V-A"],
     ["B", "warehouse=W2", "3.5", "KG", "1", "300", "V-B"]],
    [["MAP-A", "A", "warehouse=W1", "INV-1", "branch=01", "POL-A"],
     ["MAP-B", "B", "warehouse=W2", "INV-1", "branch=01", "POL-B"]],
    [["POL-A", "A", "warehouse=W1", "EA", "0", "V-A", "INV-1", "branch=01", "inventory", "debit-positive",
      "provided-posted-carrying-value", "2026-01-01", "2026-12-31", "SYN-POL-A"],
     ["POL-B", "B", "warehouse=W2", "KG", "1", "V-B", "INV-1", "branch=01", "inventory", "debit-positive",
      "provided-posted-carrying-value", "2026-01-01", "2026-12-31", "SYN-POL-B"]],
    [["INV-1", "branch=01", "inventory", "1300", "0"]],
]


def changed(source, row, column, value):
    rows = copy.deepcopy(BASE)
    rows[source][row][column] = value
    return rows


CASES = [("independent-units-positive", copy.deepcopy(BASE), "ready")]
for case, src, row, col, value, result in [
    ("quantity-not-a-value", 0, 0, 2, "999", "ready"),
    ("zero-quantity-does-not-invent-value", 0, 0, 2, "0", "ready"),
    ("quantity-fraction-not-exact", 0, 0, 2, "10.1", "source-error"),
    ("quantity-missing", 0, 0, 2, "", "source-error"),
    ("unit-mismatch", 0, 0, 3, "BOX", "missing"),
    ("unit-missing", 0, 0, 3, "", "source-error"),
    ("precision-evidence-mismatch", 2, 0, 4, "1", "missing"),
    ("quantity-precision-seven", 0, 0, 4, "7", "source-error"),
    ("value-missing", 0, 0, 5, "", "source-error"),
    ("value-excess-precision", 0, 0, 5, "1000.001", "source-error"),
    ("value-negative", 0, 0, 5, "-1000", "source-error"),
    ("value-arabic-digits-unsupported", 0, 0, 5, "١٠٠٠", "source-error"),
    ("value-valuation-evidence-mismatch", 0, 0, 6, "V-OTHER", "missing"),
    ("item-dimensions-complete", 1, 0, 2, "warehouse=W2", "missing"),
    ("gl-dimensions-complete", 1, 0, 4, "branch=02", "missing"),
    ("expired-policy", 2, 0, 12, "2026-09-29", "source-error"),
    ("policy-validity-inclusive", 2, 0, 12, "2026-09-30", "ready"),
    ("policy-sign-not-inferred", 2, 0, 9, "credit-positive", "source-error"),
    ("policy-basis-not-inferred", 2, 0, 10, "quantity-times-price", "source-error"),
    ("class-not-inventory", 3, 0, 2, "expense", "source-error"),
    ("difference-one-minor", 3, 0, 3, "1299.99", "difference"),
    ("debit-credit-independent", 3, 0, 4, "1", "difference"),
    ("literal-item-id", 1, 0, 1, "001", "missing"),
    ("quantity-bound-positive", 0, 0, 2, "100000000000000", "ready"),
    ("quantity-bound-negative", 0, 0, 2, "100000000000001", "source-error"),
]:
    CASES.append((case, changed(src, row, col, value), result))

for role, label in enumerate(["register", "mapping", "evidence", "gl"]):
    rows = copy.deepcopy(BASE)
    rows[role].append(copy.deepcopy(rows[role][0]))
    CASES.append(("duplicate-" + label, rows, "source-error"))
    rows = copy.deepcopy(BASE)
    rows[role] = []
    CASES.append(("empty-" + label, rows, "missing"))

rows = copy.deepcopy(BASE)
rows[0].append(["A", "warehouse=W1", "broken", "EA", "0", "1000", "V-A"])
CASES.append(("malformed-competitor-still-member", rows, "source-error"))
rows = copy.deepcopy(BASE)
rows[1].append(["MAP-C", "A", "warehouse=W1", "INV-1", "branch=01", "POL-A"])
CASES.append(("unique-map-id-not-unique-item", rows, "source-error"))
rows = copy.deepcopy(BASE)
rows[3].append(["INV-ZERO", "branch=01", "inventory", "0", "0"])
CASES.append(("unmapped-zero-gl-not-dropped", rows, "missing"))
rows = copy.deepcopy(BASE)
rows[1][1][3] = rows[2][1][6] = "INV-2"
rows[3] = [["INV-1", "branch=01", "inventory", "900", "0"], ["INV-2", "branch=01", "inventory", "400", "0"]]
CASES.append(("opposite-account-differences-zero-grand", rows, "difference"))
rows = copy.deepcopy(BASE)
rows[0][0][5] = "999999999700"
rows[3][0][3] = "1000000000000"
CASES.append(("money-aggregate-bound-positive", rows, "ready"))
rows = copy.deepcopy(rows)
rows[0][0][5] = "999999999700.01"
CASES.append(("money-aggregate-bound-negative", rows, "source-error"))
rows = copy.deepcopy(BASE)
rows[3][0][3:5] = ["0", "1300"]
CASES.append(("signed-gl-net-not-flipped", rows, "difference"))


def freeze():
    manifest = []
    for name, values, financial in CASES:
        folder = ROOT / "cases" / name
        folder.mkdir(parents=True, exist_ok=True)
        paths = []
        for source, records in enumerate(values):
            buffer = io.StringIO(newline="")
            writer = csv.writer(buffer, lineterminator="\n")
            writer.writerow(HEADERS[source])
            writer.writerows(v + list(SCOPE.values()) for v in records)
            target = folder / f"source-{source}.csv"
            target.write_text(buffer.getvalue(), encoding="utf-8")
            paths.append(target)
        expected = inspect(paths, SCOPE)
        assert expected["financial"] == financial, (name, expected)
        (folder / "expected.json").write_text(json.dumps(dict(scope=SCOPE, expected=expected), ensure_ascii=False, indent=2) + "\n")
        manifest.append({"case": name, "financial": financial})
    baseline = json.loads((ROOT / "cases/independent-units-positive/expected.json").read_text())["expected"]
    # Manual arithmetic, independent of algorithm and future engine.
    assert baseline["records"][0][0]["values"][2:6] == [10, "EA", 0, 100000]
    assert baseline["records"][0][1]["values"][2:6] == [35, "KG", 1, 30000]
    assert baseline["totals"] == {"registerMinor": 130000, "glMinor": 130000}
    assert len(baseline["members"]) == 7 and len(baseline["comparisons"]) == 1
    opposite = json.loads((ROOT / "cases/opposite-account-differences-zero-grand/expected.json").read_text())["expected"]
    assert [r["differenceMinor"] for r in opposite["comparisons"]] == [10000, -10000]
    assert opposite["totals"]["registerMinor"] == opposite["totals"]["glMinor"] == 130000
    (ROOT / "cases.json").write_text(json.dumps(manifest, indent=2) + "\n")
    files = [p for p in (ROOT / "cases").rglob("*") if p.is_file()]
    (ROOT / "source-manifest.json").write_text(json.dumps([
        dict(path=str(p.relative_to(ROOT)), bytes=p.stat().st_size, sha256=hashlib.sha256(p.read_bytes()).hexdigest())
        for p in sorted(files)], indent=2) + "\n")
    print(json.dumps({"cases": len(manifest), "files": len(files), "manual_checks": 6, "product_imports": False}))


if __name__ == "__main__":
    freeze()
