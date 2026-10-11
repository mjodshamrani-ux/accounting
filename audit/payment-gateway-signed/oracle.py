#!/usr/bin/env python3
"""Independent raw-source/Decimal specification oracle. Python standard library only.

No product modules, product execution, old reference implementation, or floating
point money arithmetic. This is a pre-code oracle, not an implementation verdict.
"""
import argparse
import csv
from datetime import date
from decimal import Decimal, InvalidOperation, localcontext
import hashlib
import io
import json
from pathlib import Path
import re
import unicodedata
import zipfile
from xml.etree import ElementTree as ET

FAMILY = "payment-gateway-signed-kind-1"
CANONICAL = "payment-gateway-batch-1"
ROLES = ["transactions", "fee-evidence", "settlement", "payout"]
SCOPE_KEYS = ["entity", "gateway", "merchantAccount", "bankAccount", "dimensions", "currency", "currencyBasis", "fxPolicy", "start", "end", "asOf", "policyVersion", "batchId"]
SCOPE_HEADERS = ["Entity", "Gateway", "Merchant account", "Bank account", "Complete dimensions", "Currency", "Currency basis", "FX policy", "Period start", "Period end", "As of", "Policy version", "Batch ID"]
VALUE_HEADERS = [["Transaction ID", "Kind", "Posting date", "Signed amount", "Reference"], ["Evidence ID", "Fee ID", "Amount", "Reference", "Valid from", "Valid to"], ["Settlement ID", "Settlement date", "Gross sales", "Refunds", "Fees", "Net", "Payout ID", "Reference"], ["Payout ID", "Value date", "Credit", "Reference"]]
HEADERS = [v + SCOPE_HEADERS for v in VALUE_HEADERS]
PRECISION = {"SAR": 2, "JPY": 0, "KWD": 3}
BOUND = Decimal("100000000000000")
MAX_ROWS = 20000
MAX_FILE_BYTES = 8 * 1024 * 1024
SS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL = "http://schemas.openxmlformats.org/package/2006/relationships"
DOC_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹٫", "01234567890123456789.")

class InvalidSource(Exception):
    pass

def demand(condition, code):
    if not condition:
        raise InvalidSource(code)

def identity(value, relaxed=False):
    demand(isinstance(value, str) and bool(value) and value == value.strip() and utf16_units(value) <= (2000 if relaxed else 500), "IDENTITY")
    demand(not any(unicodedata.category(c) in ("Cc", "Cf") for c in value), "IDENTITY")
    if not relaxed:
        demand(not re.match(r"^[=+@-]|^#(?:REF!|VALUE!|N/A|DIV/0!)", value, re.I), "IDENTITY")

def utf16_units(value):
    return len(value.encode("utf-16-le")) // 2

def day(value):
    demand(bool(re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value)), "DATE")
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise InvalidSource("DATE")

def money(raw, precision, *, signed=False, kind=None):
    """Validate the lexical grammar/sign BEFORE creating a canonical magnitude."""
    normalized = raw.translate(DIGITS)
    grammar = r"[+-]?[0-9]+(?:\.[0-9]+)?" if signed else r"[0-9]+(?:\.[0-9]+)?"
    demand(bool(re.fullmatch(grammar, normalized)), "AMOUNT")
    fraction = normalized.partition(".")[2]
    demand(len(fraction) <= precision, "AMOUNT_PRECISION")
    try:
        number = Decimal(normalized)
    except InvalidOperation:
        raise InvalidSource("AMOUNT")
    sign = normalized[0] if normalized[0] in "+-" else "unsigned"
    if signed:
        demand(kind in ("sale", "refund"), "KIND")
        demand(not (sign == "-" and number == 0), "NEGATIVE_ZERO")
        demand(not (kind == "sale" and number < 0), "SIGN_KIND")
        demand(not (kind == "refund" and number > 0), "SIGN_KIND")
    with localcontext() as context:
        context.prec = max(40, len(normalized) + precision + 2)
        minor = number.copy_abs() * (Decimal(10) ** precision)
        signed_minor = number * (Decimal(10) ** precision)
    demand(minor <= BOUND, "AMOUNT_BOUND")
    demand(minor == minor.to_integral_exact(), "AMOUNT_PRECISION")
    return int(minor), {"rawLexeme": raw, "normalizedLexeme": normalized, "originalSign": sign, "signedMinor": int(signed_minor), "canonicalMagnitudeMinor": int(minor)}

def bounded_sum(values):
    total = sum((Decimal(v) for v in values), Decimal(0))
    demand(abs(total) <= BOUND, "TOTAL_BOUND")
    return int(total)

def csv_rows(raw):
    # csv.reader preserves comma records, quoted text and empty physical records.
    # physicalRow below is the source-grid record ordinal; lineSpan additionally
    # preserves actual text-line offsets if a quoted cell contains a newline.
    try:
        stream = io.StringIO(raw.decode("utf-8", errors="strict"), newline="")
        reader = csv.reader(stream, delimiter=",", strict=True)
        rows, spans, previous = [], [], 0
        for row in reader:
            rows.append(row)
            spans.append([previous + 1, reader.line_num])
            previous = reader.line_num
        return rows, spans
    except (UnicodeError, csv.Error):
        raise InvalidSource("CSV")

def xlsx_rows(raw):
    """Resolve the actual workbook relationship and cell XML, never a cache grid."""
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            demand(sum(i.file_size for i in z.infolist()) <= 64 * 1024 * 1024, "XLSX_CAPACITY")
            wb = ET.fromstring(z.read("xl/workbook.xml"))
            demand(wb.tag == f"{{{SS}}}workbook", "XLSX_NAMESPACE")
            sheets = wb.findall(f"{{{SS}}}sheets/{{{SS}}}sheet")
            demand(len(sheets) == 1 and sheets[0].get("state", "visible") == "visible", "XLSX_SHEETS")
            rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
            demand(rels.tag == f"{{{REL}}}Relationships" and all(r.tag == f"{{{REL}}}Relationship" for r in rels), "XLSX_RELATIONSHIP")
            demand(all(r.get("Id") for r in rels) and len({r.get("Id") for r in rels}) == len(rels), "XLSX_RELATIONSHIP")
            links = {r.get("Id"): r for r in rels}
            link = links[sheets[0].get(f"{{{DOC_REL}}}id")]
            demand(link.get("TargetMode") != "External" and link.get("Type") == DOC_REL + "/worksheet", "XLSX_RELATIONSHIP")
            target = link.get("Target", "")
            demand(".." not in target and not target.startswith("/"), "XLSX_RELATIONSHIP")
            sheet = ET.fromstring(z.read("xl/" + target))
            demand(sheet.tag == f"{{{SS}}}worksheet", "XLSX_NAMESPACE")
            styles = ET.fromstring(z.read("xl/styles.xml"))
            demand(styles.tag == f"{{{SS}}}styleSheet", "XLSX_NAMESPACE")
            formats = [int(x.get("numFmtId", "0")) for x in styles.findall(f"{{{SS}}}cellXfs/{{{SS}}}xf")]
            demand(not sheet.findall(f"{{{SS}}}mergeCells/{{{SS}}}mergeCell"), "XLSX_MERGE")
            demand(not any(c.get("hidden") in ("1", "true") for c in sheet.findall(f"{{{SS}}}cols/{{{SS}}}col")), "XLSX_HIDDEN")
            shared = []
            if "xl/sharedStrings.xml" in z.namelist():
                shared = ["".join(t.text or "" for t in si.iter(f"{{{SS}}}t")) for si in ET.fromstring(z.read("xl/sharedStrings.xml"))]
            values = {}
            metadata = {}
            seen = set()
            highest = 0
            for row in sheet.findall(f"{{{SS}}}sheetData/{{{SS}}}row"):
                n = int(row.get("r", "0"))
                demand(n >= 1 and n not in seen, "XLSX_ROW")
                seen.add(n)
                demand(row.get("hidden") not in ("1", "true"), "XLSX_HIDDEN")
                highest = max(highest, n)
                cols = {}
                for cell in row.findall(f"{{{SS}}}c"):
                    address = cell.get("r", "")
                    match = re.fullmatch(r"([A-Z]+)([0-9]+)", address)
                    demand(match is not None and int(match[2]) == n, "XLSX_CELL")
                    col = 0
                    for char in match[1]:
                        col = col * 26 + ord(char) - ord("A") + 1
                    demand(col <= 100 and col not in cols, "XLSX_CELL")
                    demand(cell.find(f"{{{SS}}}f") is None, "XLSX_FORMULA")
                    typ = cell.get("t", "n")
                    v = cell.find(f"{{{SS}}}v")
                    if typ == "inlineStr":
                        value = "".join(t.text or "" for t in cell.iter(f"{{{SS}}}t"))
                    elif typ == "s":
                        value = shared[int(v.text)]
                    elif typ in ("n", "str"):
                        value = v.text if v is not None and v.text is not None else ""
                    else:
                        raise InvalidSource("XLSX_CELL_TYPE")
                    cols[col] = value
                    style_index = int(cell.get("s", "0"))
                    demand(0 <= style_index < len(formats), "XLSX_STYLE")
                    metadata[(n, col)] = (typ, formats[style_index])
                values[n] = [cols.get(i, "") for i in range(1, max(cols, default=0) + 1)]
            demand(highest <= MAX_ROWS + 1, "ROWS")
            rows = [values.get(i, []) for i in range(1, highest + 1)]
            head = rows[0] if rows else []
            monetary = {"Signed amount", "Amount", "Gross sales", "Refunds", "Fees", "Net", "Credit"}
            for (n, col), (typ, fmt) in metadata.items():
                field = head[col - 1] if col <= len(head) else ""
                if n > 1 and field in monetary:
                    demand(typ == "n" and fmt == 2, "XLSX_MONEY_TYPE_FORMAT")
                    grammar = r"[+-]?[0-9]+(?:\.[0-9]+)?" if field == "Signed amount" else r"[0-9]+(?:\.[0-9]+)?"
                    demand(bool(re.fullmatch(grammar, rows[n-1][col-1])), "XLSX_MONEY_LEXEME")
                else:
                    demand(typ in ("s", "inlineStr") and fmt == 0, "XLSX_LITERAL_TYPE_FORMAT")
            return rows, [[i, i] for i in range(1, highest + 1)]
    except InvalidSource:
        raise
    except (KeyError, IndexError, ValueError, ET.ParseError, zipfile.BadZipFile):
        raise InvalidSource("XLSX")

def read_original(path):
    raw = path.read_bytes()
    demand(0 < len(raw) <= MAX_FILE_BYTES, "FILE_BYTES")
    demand(path.suffix.lower() in (".csv", ".xlsx"), "SOURCE_EXTENSION")
    rows, spans = csv_rows(raw) if path.suffix.lower() == ".csv" else xlsx_rows(raw)
    demand(len(rows) <= MAX_ROWS + 1, "ROWS")
    demand(all(len(r) <= 100 and all(utf16_units(v) <= 32767 for v in r) for r in rows), "CELL_LIMIT")
    return {"sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw), "rows": rows, "lineSpans": spans}

def evaluate(bundle_path):
    manifest = json.loads(bundle_path.read_text(encoding="utf-8"))
    result = {"financial": "source-error", "issues": [], "missing": [], "totalsMinor": None, "residualsMinor": None, "signedProvenance": [], "inventory": [], "sources": [], "memberIds": []}
    def issue(code, source=-1, row=0):
        result["issues"].append({"code": code, "source": source, "physicalRow": row})
    try:
        scope = manifest["scope"]
        demand(set(scope) == set(SCOPE_KEYS), "SCOPE")
        for v in scope.values():
            identity(v)
        demand(scope["currency"] in PRECISION, "CURRENCY")
        decimals = PRECISION[scope["currency"]]
        demand(scope["currencyBasis"] == "functional" and scope["fxPolicy"] == "same-currency-no-conversion", "SCOPE")
        demand(day(scope["start"]) <= day(scope["end"]) == day(scope["asOf"]), "SCOPE")
        demand(manifest["readings"] == [FAMILY, CANONICAL, CANONICAL, CANONICAL], "READING")
        demand(len(manifest["files"]) == 4, "FOUR_ORIGINALS")
        originals = [read_original(bundle_path.parent / f) for f in manifest["files"]]
        demand(scope["currency"] == "SAR" or not any(Path(f).suffix.lower() == ".xlsx" for f in manifest["files"]), "XLSX_CURRENCY")
        result["sources"] = [{"role": ROLES[i], "file": manifest["files"][i], "sha256": o["sha256"], "bytes": o["bytes"]} for i, o in enumerate(originals)]
        demand(len(set(o["sha256"] for o in originals)) == 4, "INDEPENDENT_ORIGINALS")
        demand(sum(max(0, len(o["rows"]) - 1) for o in originals) <= MAX_ROWS, "ROWS")
        result["memberIds"] = [json.dumps([CANONICAL, source, o["sha256"], 0, n], separators=(",", ":"), ensure_ascii=False) for source, o in enumerate(originals) for n, row in enumerate(o["rows"][1:], 2) if any(v.strip() for v in row)]
        if "suppliedParsedGrids" in manifest:
            demand(manifest["suppliedParsedGrids"] == [o["rows"] for o in originals], "NATIVE_CACHE_MISMATCH")
    except InvalidSource as e:
        issue(str(e))
        return result
    records = [[] for _ in ROLES]
    nonblank_counts = []
    for source, original in enumerate(originals):
        rows = original["rows"]
        head = rows[0] if rows else []
        valid_header = len(head) == len(HEADERS[source]) and len(set(head)) == len(head) and set(head) == set(HEADERS[source])
        nonblank_counts.append(sum(bool(any(v.strip() for v in r)) for r in rows[1:]))
        for index, raw in enumerate(rows):
            row_number = index + 1
            blank = not any(v.strip() for v in raw)
            result["inventory"].append({"source": source, "physicalRow": row_number, "lineSpan": original["lineSpans"][index], "kind": "header" if index == 0 else "blank" if blank else ROLES[source], "rawCells": raw})
            if not valid_header:
                issue("COLUMNS", source, row_number)
                continue
            if index == 0 or blank:
                continue
            try:
                demand(len(raw) == len(head), "COLUMNS")
                get = dict(zip(head, raw))
                demand(all(get[h] == scope[k] for k, h in zip(SCOPE_KEYS, SCOPE_HEADERS)), "ROW_SCOPE")
                value = [get[h] for h in VALUE_HEADERS[source]]
                identity(value[0])
                identity(value[4] if source == 0 else value[3] if source in (1, 3) else value[7], relaxed=True)
                if source == 0:
                    demand(value[1] in ("sale", "refund"), "KIND")
                    demand(day(scope["start"]) <= day(value[2]) <= day(scope["end"]), "PERIOD")
                    value[3], signed_provenance = money(value[3], decimals, signed=True, kind=value[1])
                    result["signedProvenance"].append({"source": source, "physicalRow": row_number, "transactionId": value[0], "kind": value[1], **signed_provenance})
                elif source == 1:
                    identity(value[1])
                    value[2] = money(value[2], decimals)[0]
                    demand(day(value[4]) <= day(scope["start"]) and day(value[5]) >= day(scope["end"]) and day(value[4]) <= day(value[5]), "VALIDITY")
                elif source == 2:
                    identity(value[6])
                    demand(day(scope["start"]) <= day(value[1]) <= day(scope["end"]), "PERIOD")
                    value[2:6] = [money(v, decimals)[0] for v in value[2:6]]
                else:
                    demand(day(scope["start"]) <= day(value[1]) <= day(scope["end"]), "PERIOD")
                    value[2] = money(value[2], decimals)[0]
                records[source].append((row_number, value))
            except InvalidSource as e:
                issue(str(e), source, row_number)
        if valid_header:
            for field in [HEADERS[source][0]] + (["Fee ID"] if source == 1 else []):
                col = head.index(field)
                seen = {}
                for i, raw in enumerate(rows[1:], 2):
                    val = raw[col] if col < len(raw) else ""
                    if val and val == val.strip():
                        seen.setdefault(val, []).append(i)
                for same in seen.values():
                    if len(same) > 1:
                        for row_number in same:
                            issue("DUPLICATE", source, row_number)
    for source in (2, 3):
        if nonblank_counts[source] > 1:
            issue("CARDINALITY", source)
    for source in (0, 2, 3):
        if not records[source]:
            result["missing"].append(ROLES[source])
    if len(records[2]) == 1 and records[2][0][1][4] > 0 and not records[1]:
        result["missing"].append("fee-evidence")
    if len(records[2]) == len(records[3]) == 1 and records[2][0][1][6] != records[3][0][1][0]:
        issue("PAYOUT_LINK", 3, records[3][0][0])
    try:
        gross = bounded_sum(v[3] for _, v in records[0] if v[1] == "sale")
        refunds = bounded_sum(v[3] for _, v in records[0] if v[1] == "refund")
        fees = bounded_sum(v[2] for _, v in records[1])
        totals = [gross, refunds, fees, bounded_sum([gross, -refunds, -fees])]
        residuals = None
        if not result["issues"] and len(records[2]) == len(records[3]) == 1:
            summary = records[2][0][1]
            residuals = [bounded_sum([t, -s]) for t, s in zip(totals, summary[2:6])] + [bounded_sum([summary[5], -records[3][0][1][2]])]
        if not result["issues"]:
            result["totalsMinor"], result["residualsMinor"] = totals, residuals
    except InvalidSource as e:
        issue(str(e))
    if result["issues"]:
        result["totalsMinor"] = result["residualsMinor"] = None
    result["financial"] = "source-error" if result["issues"] else "missing" if result["missing"] else "difference" if any(result["residualsMinor"] or []) else "ready"
    return result

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("bundle", type=Path)
    args = parser.parse_args()
    print(json.dumps(evaluate(args.bundle), ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
