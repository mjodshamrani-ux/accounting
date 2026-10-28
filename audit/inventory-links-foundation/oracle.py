"""INV-3 links oracle, independent of the product.

Parsing, records, issues, missing keys and the financial outcome come from the
existing pre-engine reference (audit/inventory-register/reference.py),
imported as it is. The links are derived here from those records by the
proposed contract, and checked against the reference's own missing keys: a
link that disagrees with them stops the oracle.

    python3 -B oracle.py frozen > frozen/EXPECTED.json        # focused stories
    python3 -B oracle.py --dense DIR > DIR/EXPECTED-DENSE.json  # dense stories
"""
import csv
import hashlib
import io
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "inventory-register"))
import reference  # noqa: E402

ROLES = ["register", "mapping", "evidence", "gl"]
EVIDENCE_CODES = ["EVIDENCE_ITEM", "EVIDENCE_DIMENSIONS", "EVIDENCE_UNIT", "EVIDENCE_PRECISION",
                  "EVIDENCE_VALUATION", "EVIDENCE_ACCOUNT", "EVIDENCE_ACCOUNT_DIMENSIONS"]
LIMIT = 20000


def rows_of(path):
    return list(csv.reader(io.StringIO(Path(path).read_bytes().decode("utf-8-sig"), newline=""), strict=True))


def key_text(a, b):
    return f"{a}|{b}"


def product_key(a, b):
    return json.dumps([a, b], ensure_ascii=False, separators=(",", ":"))


def judge(folder, sid):
    paths = [Path(folder) / f"{sid}-{role}.csv" for role in ROLES]
    scope = json.loads((Path(folder) / f"{sid}-scope.json").read_text(encoding="utf-8"))
    # The family refuses a run over its row budget before reading a record.
    if sum(max(0, len(rows_of(p)) - 1) for p in paths) > LIMIT:
        return {"refused": "ROWS"}
    r = reference.inspect([str(p) for p in paths], scope)
    reg, maps, evs, gls = r["records"]
    by_key, by_id, gl_by = {}, {}, {}
    for m in maps:
        by_key.setdefault(tuple(m["values"][1:3]), []).append(m)
    for e in evs:
        by_id.setdefault(e["values"][0], []).append(e)
    for g in gls:
        gl_by.setdefault(tuple(g["values"][:2]), []).append(g)
    links, accounts = [], []
    for rec in reg:
        v = rec["values"]
        found = by_key.get((v[0], v[1]), [])
        evidence, account, gl, reasons = [], None, [], []
        if not found:
            reasons = ["NO_MAPPING"]
        elif len(found) > 1:
            reasons = ["MAPPINGS"]
        else:
            m = found[0]["values"]
            named = by_id.get(m[5], [])
            evidence = [e["row"] for e in named]
            account = key_text(m[3], m[4])
            gl = [g["row"] for g in gl_by.get((m[3], m[4]), [])]
            if not named:
                reasons = ["NO_EVIDENCE"]
            elif len(named) > 1:
                reasons = ["EVIDENCES"]
            else:
                wanted = [v[0], v[1], v[3], v[4], v[6], m[3], m[4]]
                reasons = [c for c, a, b in zip(EVIDENCE_CODES, wanted, named[0]["values"][1:8]) if a != b]
            if not reasons and (m[3], m[4]) not in accounts:
                accounts.append((m[3], m[4]))
        links.append([rec["row"], "unlinked" if reasons else "linked", reasons,
                      [m["row"] for m in found], evidence, account, gl])
    register_keys = {tuple(x["values"][:2]) for x in reg}
    named_ids = {x["values"][5] for x in maps}
    linked = set(accounts)
    unlinked = (
        [["mapping", m["row"], m["values"][0], "NO_REGISTER"] for m in maps if tuple(m["values"][1:3]) not in register_keys]
        + [["evidence", e["row"], e["values"][0], "NO_MAPPING"] for e in evs if e["values"][0] not in named_ids]
        + [["gl", g["row"], key_text(*g["values"][:2]), "NO_LINKED_REGISTER"] for g in gls if tuple(g["values"][:2]) not in linked]
        + [["account", None, key_text(*a), "NO_GL_RECORD"] for a in accounts if a not in gl_by]
    )
    # The links must say exactly what the reference's missing keys say.
    derived = {f"source:{i}" for i in range(4) if not r["records"][i]}
    for (row, status, reasons, *_), rec in zip(links, reg):
        if status == "unlinked":
            kind = "mapping" if reasons[0] in ("NO_MAPPING", "MAPPINGS") else "evidence"
            derived.add(f"{kind}:" + repr(tuple(rec["values"][:2])))
    for role, row, key, reason in unlinked:
        if role == "mapping":
            derived.add("orphan-mapping:" + key)
        elif role == "evidence":
            derived.add("orphan-evidence:" + key)
        elif role == "gl":
            derived.add("account:" + repr(tuple(key.split("|", 1))))
        else:
            derived.add("gl:" + repr(tuple(key.split("|", 1))))
    if sorted(derived) != r["missing"]:
        raise AssertionError(f"{sid}: links disagree with the reference's missing keys")
    product_missing = sorted(
        ({f"source:{i}" for i in range(4) if not r["records"][i]})
        | {("mapping:" if l[2][0] in ("NO_MAPPING", "MAPPINGS") else "evidence:") + product_key(*rec["values"][:2])
           for l, rec in zip(links, reg) if l[1] == "unlinked"}
        | {{"mapping": "orphan-mapping:", "evidence": "orphan-evidence:"}[u[0]] + u[2] for u in unlinked if u[0] in ("mapping", "evidence")}
        | {("account:" if u[0] == "gl" else "gl:") + product_key(*u[2].split("|", 1)) for u in unlinked if u[0] in ("gl", "account")})
    return {"refused": None, "financial": r["financial"], "decimals": r["decimals"], "issues": r["issues"],
            "missing": product_missing, "links": links, "unlinked": unlinked,
            "comparisons": r["comparisons"], "totals": r["totals"], "hashes": r["hashes"]}


def canonical(obj):
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def main(argv):
    dense = argv[:1] == ["--dense"]
    folder = Path(argv[1] if dense else argv[0])
    ids = sorted(p.name[: -len("-scope.json")] for p in folder.glob("*-scope.json"))
    stories = {sid: judge(folder, sid) for sid in ids}
    out = {"schema": "tarasuf-inv3-expected/1", "oracle": "audit/inventory-links-foundation/oracle.py",
           "reference": "audit/inventory-register/reference.py", "stories": stories}
    if dense:
        out["sha256"] = {sid: hashlib.sha256(canonical(v).encode("utf-8")).hexdigest() for sid, v in stories.items()}
    sys.stdout.write(json.dumps(out, ensure_ascii=False, indent=None if dense else 1) + "\n")


if __name__ == "__main__":
    main(sys.argv[1:])
