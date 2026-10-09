"""Pre-engine independent CSV/Decimal reference for supplied posted stock values.

No quantity aggregation, price derivation, financial posting or valuation algorithm.
All fixtures are synthetic. No product imports or generated product expectations.
"""
import csv
import hashlib
import io
import re
import unicodedata
from collections import Counter
from datetime import date
from decimal import Decimal
from pathlib import Path

VERSION = "inventory-posted-register-gl-1"
FIELDS = ["entity", "inventoryLedger", "glLedger", "currency", "currencyBasis",
          "postingStatus", "postingLayer", "asOf", "chartVersion", "mapVersion",
          "valuationPolicyVersion", "inventoryAccountSetVersion"]
SCOPE_HEADERS = ["Entity", "Inventory ledger", "GL ledger", "Currency", "Currency basis",
                 "Posting status", "Posting layer", "As of", "Chart version", "Map version",
                 "Valuation policy version", "Inventory account set version"]
VALUES = [
    ["Item ID", "Item dimensions", "Quantity", "Unit", "Quantity precision", "Posted value", "Valuation reference"],
    ["Mapping ID", "Item ID", "Item dimensions", "GL account", "GL dimensions", "Evidence ID"],
    ["Evidence ID", "Item ID", "Item dimensions", "Unit", "Quantity precision", "Valuation reference",
     "GL account", "GL dimensions", "Account class", "Sign", "Value basis", "Valid from", "Valid to", "Reference"],
    ["GL account", "GL dimensions", "Account class", "Debit", "Credit"],
]
HEADERS = [v + SCOPE_HEADERS for v in VALUES]
BOUND = Decimal(10 ** 14)


def scaled(value, precision):
    if not re.fullmatch(r"[0-9]+(?:\.[0-9]+)?", value):
        raise ValueError("NUMBER")
    if len(value.partition(".")[2]) > precision:
        raise ValueError("PRECISION")
    result = Decimal(value) * (10 ** precision)
    if result > BOUND:
        raise ValueError("BOUND")
    return int(result)


def identity(value, limit=500):
    if not value or value != value.strip() or len(value.encode("utf-16-le")) // 2 > limit:
        raise ValueError("IDENTITY")
    if any(unicodedata.category(c) in {"Cc", "Cf"} for c in value) or value[0] in "=+@-":
        raise ValueError("IDENTITY")
    return value


def day(value):
    if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
        raise ValueError("VALIDITY")
    parsed = date.fromisoformat(value)
    if parsed.isoformat() != value:
        raise ValueError("VALIDITY")
    return parsed


def inspect(paths, scope):
    if set(scope) != set(FIELDS):
        raise ValueError("SCOPE")
    for value in scope.values():
        identity(value)
    if scope["currencyBasis"] != "functional" or scope["postingStatus"] != "posted":
        raise ValueError("SCOPE")
    day(scope["asOf"])
    decimals = {"SAR": 2, "JPY": 0, "KWD": 3}[scope["currency"]]
    parsed = [[], [], [], []]
    problems, inventory, cells, members, hashes = [], [], [], [], []
    physical = []
    data_count = 0
    for source, path in enumerate(paths):
        data = Path(path).read_bytes()
        if not data or len(data) > 8 * 1024 * 1024:
            raise ValueError("SOURCE_CAPACITY")
        hashes.append(hashlib.sha256(data).hexdigest())
        rows = list(csv.reader(io.StringIO(data.decode("utf-8-sig"), newline=""), strict=True))
        data_count += max(0, len(rows) - 1)
        if data_count > 20000 or any(len(row) > 100 or any(len(v.encode("utf-16-le")) // 2 > 32767 for v in row) for row in rows):
            raise ValueError("SOURCE_CAPACITY")
        if any(any(ord(c) in list(range(0, 9)) + [11, 12] + list(range(14, 32)) + [65534, 65535] for c in v) for row in rows for v in row):
            raise ValueError("SOURCE_TEXT")
        physical.append(rows)
        header = rows[0] if rows else []
        good = len(header) == len(HEADERS[source]) and set(header) == set(HEADERS[source])
        if not rows:
            problems.append([source, 1, "COLUMNS"])
        positions = {v: i for i, v in enumerate(header)}
        for row_number, raw in enumerate(rows, 1):
            blank = not any(v.strip() for v in raw)
            inventory.append([source, row_number, "header" if row_number == 1 else "blank" if blank else "data"])
            cells.extend([source, row_number, column, header[column - 1] if column <= len(header) else "", v]
                         for column, v in enumerate(raw, 1))
            if row_number > 1 and not blank:
                members.append([source, row_number])
            if not good:
                problems.append([source, row_number, "COLUMNS"])
                continue
            if row_number == 1 or blank:
                continue
            try:
                if len(raw) != len(header):
                    raise ValueError("COLUMNS")
                get = lambda key: raw[positions[key]]
                if any(get(h) != scope[k] for h, k in zip(SCOPE_HEADERS, FIELDS)):
                    raise ValueError("ROW_SCOPE")
                values = [get(h) for h in VALUES[source]]
                for key, val in zip(VALUES[source], values):
                    if key not in {"Quantity", "Posted value", "Debit", "Credit", "Quantity precision"}:
                        identity(val, 2000 if key in {"Valuation reference", "Reference"} else 500)
                if source in (0, 2):
                    qi = 4
                    if not re.fullmatch("[0-6]", values[qi]):
                        raise ValueError("QUANTITY_PRECISION")
                    values[qi] = int(values[qi])
                if source == 0:
                    values[2] = scaled(values[2], values[4])
                    values[5] = scaled(values[5], decimals)
                if source == 2:
                    if values[8:11] != ["inventory", "debit-positive", "provided-posted-carrying-value"]:
                        raise ValueError("POLICY")
                    if not (day(values[11]) <= day(scope["asOf"]) <= day(values[12])):
                        raise ValueError("VALIDITY")
                if source == 3:
                    if values[2] != "inventory":
                        raise ValueError("ACCOUNT_CLASS")
                    values[3] = scaled(values[3], decimals)
                    values[4] = scaled(values[4], decimals)
                parsed[source].append({"row": row_number, "values": values})
            except (ValueError, IndexError) as exc:
                code = str(exc) if str(exc) in {"NUMBER", "PRECISION", "BOUND", "IDENTITY", "COLUMNS", "ROW_SCOPE", "QUANTITY_PRECISION", "POLICY", "VALIDITY", "ACCOUNT_CLASS"} else "VALIDITY"
                problems.append([source, row_number, code])
        # Competing malformed rows participate in identity uniqueness.
        key_fields = [VALUES[source][:2], ["Mapping ID"], ["Evidence ID"], VALUES[source][:2]][source]
        identities = []
        if good:
            for row_number, raw in enumerate(rows[1:], 2):
                key = tuple(raw[positions[k]] if positions[k] < len(raw) else "" for k in key_fields)
                if all(key):
                    identities.append((row_number, key))
            counts = Counter(key for _, key in identities)
            problems.extend([source, n, "DUPLICATE"] for n, key in identities if counts[key] > 1)
            if source == 1:
                keys = [(n, tuple(raw[positions[k]] if positions[k] < len(raw) else "" for k in ["Item ID", "Item dimensions"]))
                        for n, raw in enumerate(rows[1:], 2)]
                counts = Counter(k for _, k in keys if all(k))
                problems.extend([source, n, "DUPLICATE_MAPPING"] for n, k in keys if all(k) and counts[k] > 1)
    missing, comparisons = [], []
    for source, rows in enumerate(parsed):
        if not rows:
            missing.append(f"source:{source}")
    valid_values = Counter()
    supported_accounts = set()
    for item in parsed[0]:
        v = item["values"]
        key = tuple(v[:2])
        mapping = [r["values"] for r in parsed[1] if tuple(r["values"][1:3]) == key]
        if len(mapping) != 1:
            missing.append("mapping:" + repr(key))
            continue
        m = mapping[0]
        evidence = [r["values"] for r in parsed[2] if r["values"][0] == m[5]]
        wanted = [*key, v[3], v[4], v[6], m[3], m[4]]
        if len(evidence) != 1 or evidence[0][1:8] != wanted:
            missing.append("evidence:" + repr(key))
            continue
        account = tuple(m[3:5])
        supported_accounts.add(account)
        valid_values[account] += v[5]
    used_mapping = {tuple(r["values"][:2]) for r in parsed[0]}
    used_evidence = {r["values"][5] for r in parsed[1]}
    missing.extend("orphan-mapping:" + r["values"][0] for r in parsed[1] if tuple(r["values"][1:3]) not in used_mapping)
    missing.extend("orphan-evidence:" + r["values"][0] for r in parsed[2] if r["values"][0] not in used_evidence)
    gl_keys = {tuple(r["values"][:2]) for r in parsed[3]}
    missing.extend("gl:" + repr(k) for k in sorted(supported_accounts - gl_keys))
    gl_running = 0
    for gl in parsed[3]:
        v = gl["values"]
        key = tuple(v[:2])
        if key not in supported_accounts:
            missing.append("account:" + repr(key))
        value = valid_values[key]
        net = v[3] - v[4]
        gl_running += net
        if abs(gl_running) > BOUND:
            problems.append([3, gl["row"], "TOTAL_BOUND"])
        diff = value - net
        if any(abs(n) > BOUND for n in (value, net, diff)):
            problems.append([3, gl["row"], "TOTAL_BOUND"])
        comparisons.append({"account": v[0], "dimensions": v[1], "registerMinor": value, "debitMinor": v[3], "creditMinor": v[4], "glMinor": net, "differenceMinor": diff})
    if sum(valid_values.values()) > BOUND:
        problems.append([-1, 0, "TOTAL_BOUND"])
    financial = "source-error" if problems else "missing" if missing else "difference" if any(v["differenceMinor"] for v in comparisons) else "ready"
    if problems:
        for comparison in comparisons:
            for key in ["registerMinor", "debitMinor", "creditMinor", "glMinor", "differenceMinor"]:
                comparison[key] = None
    totals = None if problems else {"registerMinor": sum(valid_values.values()), "glMinor": sum(r["values"][3] - r["values"][4] for r in parsed[3])}
    if totals and any(abs(n) > BOUND for n in totals.values()):
        problems.append([-1, 0, "TOTAL_BOUND"])
        totals = None
        financial = "source-error"
        for comparison in comparisons:
            for key in ["registerMinor", "debitMinor", "creditMinor", "glMinor", "differenceMinor"]:
                comparison[key] = None
    return dict(financial=financial, decimals=decimals, records=parsed, issues=sorted(problems), missing=sorted(set(missing)),
                comparisons=comparisons, totals=totals, inventory=inventory, cells=cells, members=members, hashes=hashes)
