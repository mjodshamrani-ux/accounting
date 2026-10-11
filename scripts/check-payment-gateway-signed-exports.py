#!/usr/bin/env python3
"""Independently verify every gateway export table against session originals.

Python stdlib only; no product or previous oracle imports/execution. Financial
expectations derive from original CSV/OOXML bytes and Decimal, and additionally
cross-check separate literal signed truths when a named case is available.
"""
import argparse
import base64
import csv
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, localcontext
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import sys
import unicodedata
import zipfile
from xml.etree import ElementTree as ET

VERSION = "payment-gateway-batch-1"
SIGNED = "payment-gateway-signed-kind-1"
ROLES = ["transactions", "fee-evidence", "settlement", "payout"]
KEYS = ["entity", "gateway", "merchantAccount", "bankAccount", "dimensions", "currency", "currencyBasis", "fxPolicy", "start", "end", "asOf", "policyVersion", "batchId"]
SCOPE_HEADERS = ["Entity", "Gateway", "Merchant account", "Bank account", "Complete dimensions", "Currency", "Currency basis", "FX policy", "Period start", "Period end", "As of", "Policy version", "Batch ID"]
VALUES = [["Transaction ID", "Kind", "Posting date", "Amount", "Reference"], ["Evidence ID", "Fee ID", "Amount", "Reference", "Valid from", "Valid to"], ["Settlement ID", "Settlement date", "Gross sales", "Refunds", "Fees", "Net", "Payout ID", "Reference"], ["Payout ID", "Value date", "Credit", "Reference"]]
SIGNED_VALUES = ["Transaction ID", "Kind", "Posting date", "Signed amount", "Reference"]
CLAIM = "Consistency of supplied sales, refunds and independently evidenced fees with one gateway settlement and bank credit only; no posting, revenue recognition, fee legitimacy, source authenticity or completeness opinion"
NAMES = ["Summary", "Transactions", "Fee evidence", "Settlement", "Payout", "Totals", "Residuals", "Missing", "Issues", "Cell evidence", "Inventory", "Reading", "Events", "Event members", "Sources"]
HEADERS = {"Summary": ["Field", "Value"], "Totals": ["Gross sales", "Refunds", "Evidenced fees", "Calculated net"], "Residuals": ["Gross sales", "Refunds", "Fees", "Net", "Bank credit"], "Missing": ["Kind"], "Issues": ["Code", "Source", "Source row", "Key"], "Cell evidence": ["Source", "Hash", "Sheet", "Sheet name", "Source row", "Column", "Header", "Value"], "Inventory": ["Source", "Hash", "Source row", "Kind", "Errors"], "Reading": ["Source", "Sheet", "Role", "Family", "Confirmed"], "Events": ["Sequence", "Event ID", "Type", "Batch ID", "UTC time", "Reference", "Note", "Context"], "Event members": ["Sequence", "Event ID", "Record ID"], "Sources": ["Source", "Name", "Hash", "Chunk", "Original base64"]}
SS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
P = "http://schemas.openxmlformats.org/package/2006/relationships"
MONEY_FIELDS = {"Amount", "Signed amount", "Gross sales", "Refunds", "Fees", "Net", "Credit"}
DATE_FIELDS = {"Posting date", "Settlement date", "Value date", "Valid from", "Valid to", "Period start", "Period end", "As of"}
DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹٫", "01234567890123456789.")
BOUND = 100000000000000
PRECISION = {"SAR": 2, "JPY": 0, "KWD": 3}

class Rejected(Exception):
    pass

class SourceIssue(Exception):
    pass

def require(ok, message):
    if not ok:
        raise Rejected(message)

def js(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def units(text):
    return len(text.encode("utf-16-le")) // 2

def text(value, relaxed=False, limit=None):
    if not isinstance(value, str) or not value or value != value.strip() or units(value) > (limit or (2000 if relaxed else 500)) or any(unicodedata.category(c) in ("Cc", "Cf") for c in value) or (not relaxed and re.match(r"^[=+@-]|^#(?:REF!|VALUE!|N/A|DIV/0!)", value, re.I)):
        raise SourceIssue("IDENTITY")

def day(value):
    try:
        if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
            raise ValueError()
        return date.fromisoformat(value)
    except ValueError:
        raise SourceIssue("DATE")

def money(raw, decimals, *, signed=False, kind=None, native=False):
    normalized = raw if native else raw.translate(DIGITS)
    grammar = r"[+-]?[0-9]+(?:\.[0-9]+)?" if signed else r"[0-9]+(?:\.[0-9]+)?"
    if not re.fullmatch(grammar, normalized) or len(normalized.partition(".")[2]) > decimals:
        raise SourceIssue("AMOUNT")
    number = Decimal(normalized)
    sign = normalized[0] if normalized[0] in "+-" else "unsigned"
    if signed:
        if kind not in ("sale", "refund"):
            raise SourceIssue("KIND")
        if sign == "-" and number == 0:
            raise SourceIssue("NEGATIVE_ZERO")
        if (kind == "sale" and number < 0) or (kind == "refund" and number > 0):
            raise SourceIssue("SIGN_KIND")
    with localcontext() as ctx:
        ctx.prec = max(40, len(normalized) + decimals + 2)
        magnitude = number.copy_abs() * (Decimal(10) ** decimals)
        signed_minor = number * (Decimal(10) ** decimals)
    if magnitude > BOUND:
        raise SourceIssue("AMOUNT")
    return int(magnitude), [raw, int(signed_minor), int(magnitude), sign, normalized, "xlsx" if native else "csv"]

def total(values, code="TOTAL_BOUND"):
    with localcontext() as ctx:
        ctx.prec = 40
        result = sum((Decimal(v) for v in values), Decimal(0))
    if abs(result) > BOUND:
        raise SourceIssue(code)
    return int(result)

def xml(raw):
    require(b"<!DOCTYPE" not in raw.upper() and b"<!ENTITY" not in raw.upper(), "XML entity/doctype forbidden")
    return ET.fromstring(raw)

def package(raw):
    z = zipfile.ZipFile(io.BytesIO(raw))
    paths = z.namelist()
    require(len(paths) == len(set(paths)), "duplicate ZIP members")
    require(sum(i.file_size for i in z.infolist()) <= 128 * 1024 * 1024, "ZIP uncompressed capacity")
    require(all(not p.startswith("/") and ".." not in PurePosixPath(p).parts for p in paths), "unsafe ZIP member path")
    return z

def resolve(part, target):
    require(not target.startswith("/") and ".." not in PurePosixPath(target).parts, "unsafe OOXML relationship target")
    return str(PurePosixPath(part).parent / target)

def parse_book(raw, *, original=False, signed_batch=False):
    """Independently resolve workbook sheets and preserve typed/raw cell evidence."""
    with package(raw) as z:
        wb = xml(z.read("xl/workbook.xml"))
        require(wb.tag == f"{{{SS}}}workbook", "workbook namespace")
        relationships = xml(z.read("xl/_rels/workbook.xml.rels"))
        require(relationships.tag == f"{{{P}}}Relationships" and all(r.tag == f"{{{P}}}Relationship" for r in relationships), "relationship namespace")
        require(all(r.get("Id") for r in relationships) and len({r.get("Id") for r in relationships}) == len(relationships), "duplicate/missing relationship identity")
        rels = {r.get("Id"): r for r in relationships}
        shared = []
        if "xl/sharedStrings.xml" in z.namelist():
            sst = xml(z.read("xl/sharedStrings.xml"))
            require(sst.tag == f"{{{SS}}}sst", "shared string namespace")
            shared = ["".join(t.text or "" for t in si.iter(f"{{{SS}}}t")) for si in sst]
        style = xml(z.read("xl/styles.xml"))
        require(style.tag == f"{{{SS}}}styleSheet", "style namespace")
        formats = [int(x.get("numFmtId", "0")) for x in style.findall(f"{{{SS}}}cellXfs/{{{SS}}}xf")]
        date1904 = wb.find(f"{{{SS}}}workbookPr")
        is1904 = date1904 is not None and date1904.get("date1904") in ("1", "true")
        sheets = wb.findall(f"{{{SS}}}sheets/{{{SS}}}sheet")
        require(len(sheets) == (1 if original else 15), "worksheet count")
        result = {}
        for sheet_info in sheets:
            name = sheet_info.get("name")
            require(name and name not in result and sheet_info.get("state", "visible") == "visible", "worksheet identity/visibility")
            rid = sheet_info.get(f"{{{R}}}id")
            require(rid in rels, "worksheet relationship missing")
            link = rels[rid]
            require(link.get("Type") == R + "/worksheet" and link.get("TargetMode") != "External", "worksheet relationship type/mode")
            target = resolve("xl/workbook.xml", link.get("Target", ""))
            root = xml(z.read(target))
            require(root.tag == f"{{{SS}}}worksheet", "worksheet namespace")
            require(not root.findall(f"{{{SS}}}mergeCells/{{{SS}}}mergeCell"), "merged worksheet cells")
            require(not any(c.get("hidden") in ("1", "true") for c in root.findall(f"{{{SS}}}cols/{{{SS}}}col")), "hidden worksheet columns")
            cell_map, metadata, row_seen = {}, {}, set()
            height = width = 0
            for row in root.findall(f"{{{SS}}}sheetData/{{{SS}}}row"):
                n = int(row.get("r", "0"))
                require(n > 0 and n not in row_seen and row.get("hidden") not in ("1", "true"), "invalid/hidden/duplicate worksheet row")
                row_seen.add(n)
                height = max(height, n)
                for cell in row.findall(f"{{{SS}}}c"):
                    address = cell.get("r", "")
                    match = re.fullmatch(r"([A-Z]+)([1-9][0-9]*)", address)
                    require(match is not None and int(match[2]) == n, "invalid cell coordinate")
                    col = 0
                    for c in match[1]:
                        col = col * 26 + ord(c) - 64
                    require((n, col) not in cell_map, "duplicate cell coordinate")
                    require(cell.find(f"{{{SS}}}f") is None, "formula in source/export")
                    typ = cell.get("t", "n")
                    fmt_index = int(cell.get("s", "0"))
                    require(0 <= fmt_index < len(formats), "cell style index")
                    fmt = formats[fmt_index]
                    element = cell.find(f"{{{SS}}}v")
                    lexeme = element.text or "" if element is not None else ""
                    if typ == "s":
                        require(bool(re.fullmatch(r"[0-9]+", lexeme)) and int(lexeme) < len(shared), "shared string index")
                        value = shared[int(lexeme)]
                    elif typ == "inlineStr":
                        value = "".join(t.text or "" for t in cell.iter(f"{{{SS}}}t"))
                    elif typ == "n":
                        require(bool(re.fullmatch(r"[+-]?[0-9]+(?:\.[0-9]+)?", lexeme)), "numeric XML lexical grammar")
                        number = Decimal(lexeme)
                        if original:
                            if fmt == 14:
                                require(number == number.to_integral_exact(), "fractional native date serial")
                                require(not (not is1904 and number == 60), "fictional Excel leap day")
                                epoch = date(1904, 1, 1) if is1904 else date(1899, 12, 30)
                                value = (epoch + timedelta(days=int(number))).isoformat()
                            else:
                                value = format(number.normalize(), "f")
                        else:
                            require(number == number.to_integral_exact() and abs(number) <= 9007199254740991, "noninteger/unsafe export numeric value")
                            value = int(number)
                    elif typ == "str" and lexeme == "":
                        value = ""
                    else:
                        raise Rejected("unsupported source/export cell type: " + typ)
                    width = max(width, col)
                    cell_map[(n, col)] = value
                    metadata[(n, col)] = {"type": typ, "format": fmt, "lexeme": lexeme, "address": address}
            require(height <= (20001 if original else 1048576) and width <= (100 if original else 100), "worksheet capacity")
            rows = [[cell_map.get((n, c), "") for c in range(1, width + 1)] for n in range(1, height + 1)]
            if original:
                header = rows[0] if rows else []
                for (n, c), info in metadata.items():
                    field = header[c-1]
                    if n > 1 and field in MONEY_FIELDS:
                        require(info["type"] == "n" and info["format"] == 2, "native monetary type/format")
                        if field == "Signed amount":
                            rows[n-1][c-1] = info["lexeme"]
                        elif signed_batch:
                            require(bool(re.fullmatch(r"[0-9]+(?:\.[0-9]+)?", info["lexeme"])) and len(info["lexeme"].partition(".")[2]) <= 2, "unsigned native monetary grammar")
                    elif n > 1 and field in DATE_FIELDS:
                        require((info["type"] == "n" and info["format"] == 14) or (info["type"] in ("s", "inlineStr") and info["format"] == 0), "native date type/format")
                    else:
                        require(info["type"] in ("s", "inlineStr") and info["format"] == 0, "native literal type/format")
            result[name] = {"rows": rows, "cells": metadata, "part": target}
        if not original:
            require(list(result) == NAMES, "exact worksheet names/order")
        return result

def originals(session):
    require(set(session) == {"format", "version", "files", "readings", "scope", "completeness", "events"}, "session schema")
    require(session["format"] == "tarasuf-payment-gateway-session" and session["version"] == VERSION, "session version")
    require(len(session["files"]) == len(session["readings"]) == 4, "four sources/readings required")
    signed = session["readings"][0]["family"] == SIGNED
    hashes, sources = [], []
    for i, (f, reading) in enumerate(zip(session["files"], session["readings"])):
        require(set(f) == {"name", "sha256", "data"}, "source snapshot schema")
        require(set(reading) == {"sheet", "role", "family", "confirmed"} and reading["sheet"] == 0 and reading["role"] == ROLES[i] and reading["family"] == (SIGNED if i == 0 and signed else VERSION) and reading["confirmed"] is True, "explicit role/family reading")
        encoded = f["data"]
        require(isinstance(encoded, str) and len(encoded) <= 11184812, "source base64 capacity")
        raw = base64.b64decode(encoded, validate=True)
        require(0 < len(raw) <= 8 * 1024 * 1024 and base64.b64encode(raw).decode() == encoded, "source bytes/base64 canonicality")
        require(sha(raw) == f["sha256"], "session original SHA mismatch")
        hashes.append(f["sha256"])
        name = f["name"]
        text(name, relaxed=True, limit=255)
        require(re.search(r"\.(csv|xlsx)$", name, re.I), "source name/extension")
        native = name.lower().endswith(".xlsx")
        if native:
            book = parse_book(raw, original=True, signed_batch=signed)
            sheet_name, contents = next(iter(book.items()))
            rows = contents["rows"]
        else:
            rows = list(csv.reader(io.StringIO(raw.decode("utf-8", errors="strict"), newline=""), strict=True))
            sheet_name = "CSV"
        require(len(rows) <= 20001 and all(len(r) <= 100 and all(units(v) <= 32767 for v in r) for r in rows), "original source capacity")
        sources.append({"name": name, "sha256": f["sha256"], "raw": raw, "data": encoded, "rows": rows, "sheet": sheet_name, "native": native})
    require(len(set(hashes)) == 4, "independent original hashes")
    require(sum(max(0, len(s["rows"]) - 1) for s in sources) <= 20000, "combined physical source rows")
    return signed, sources

def expected_tables(session, sources, signed):
    scope = session["scope"]
    require(set(scope) == set(KEYS + ["confirmed"]) and scope["confirmed"] is True, "scope schema/confirmation")
    try:
        for k in KEYS:
            text(scope[k])
        require(scope["currency"] in PRECISION, "supported currency")
        decimals = PRECISION[scope["currency"]]
        require(scope["currencyBasis"] == "functional" and scope["fxPolicy"] == "same-currency-no-conversion" and day(scope["start"]) <= day(scope["end"]) == day(scope["asOf"]), "scope policy/dates")
        require(scope["currency"] == "SAR" or not any(s["native"] for s in sources), "native SAR-only scope")
    except SourceIssue as exc:
        raise Rejected("session scope " + str(exc))
    complete = session["completeness"]
    require(set(complete) == {"confirmed", "reference", "note"} and isinstance(complete["confirmed"], bool) and isinstance(complete["reference"], str) and isinstance(complete["note"], str), "completeness schema")
    if complete["confirmed"] or complete["reference"]:
        text(complete["reference"], relaxed=True)
    if complete["confirmed"] or complete["note"]:
        text(complete["note"], relaxed=True)
    ordered_scope = {k: scope[k] for k in KEYS}
    ordered_scope["confirmed"] = True
    context = js([VERSION, [s["sha256"] for s in sources], session["readings"], ordered_scope, complete])
    records = [[] for _ in ROLES]
    evidence, inventory, issues, members = [], [], [], []
    nonblank = []
    def problem(code, source, row, key=""):
        issues.append([code, source, row, key])
    for source, original in enumerate(sources):
        value_headers = SIGNED_VALUES if source == 0 and signed else VALUES[source]
        want = value_headers + SCOPE_HEADERS
        rows = original["rows"]
        head = rows[0] if rows else []
        good_header = len(head) == len(want) and len(set(head)) == len(head) and set(head) == set(want)
        nonblank.append(sum(any(v.strip() for v in r) for r in rows[1:]))
        for n, raw in enumerate(rows, 1):
            blank = not any(v.strip() for v in raw)
            rid = js([VERSION, source, original["sha256"], 0, n])
            if n > 1 and not blank:
                members.append(rid)
            evidence.extend([[source, original["sha256"], 0, original["sheet"], n, c, head[c-1] if c <= len(head) else "", v] for c, v in enumerate(raw, 1)])
            inventory.append([source, original["sha256"], n, "header" if n == 1 else "blank" if blank else ROLES[source], ""])
            if not good_header:
                problem("COLUMNS", source, n)
                continue
            if n == 1 or blank:
                continue
            try:
                if len(raw) != len(head):
                    raise SourceIssue("COLUMNS")
                data = dict(zip(head, raw))
                if any(data[h] != scope[k] for h, k in zip(SCOPE_HEADERS, KEYS)):
                    raise SourceIssue("ROW_SCOPE")
                vals = [data[h] for h in value_headers]
                text(vals[0])
                text(vals[4] if source == 0 else vals[7] if source == 2 else vals[3], relaxed=True)
                extra = None
                if source == 0:
                    if vals[1] not in ("sale", "refund"):
                        raise SourceIssue("KIND")
                    if not day(scope["start"]) <= day(vals[2]) <= day(scope["end"]):
                        raise SourceIssue("PERIOD")
                    vals[3], extra = money(vals[3], decimals, signed=signed, kind=vals[1], native=original["native"] and signed)
                elif source == 1:
                    text(vals[1])
                    vals[2] = money(vals[2], decimals)[0]
                    if not (day(vals[4]) <= day(scope["start"]) and day(vals[5]) >= day(scope["end"]) and day(vals[4]) <= day(vals[5])):
                        raise SourceIssue("VALIDITY")
                elif source == 2:
                    text(vals[6])
                    if not day(scope["start"]) <= day(vals[1]) <= day(scope["end"]):
                        raise SourceIssue("PERIOD")
                    vals[2:6] = [money(v, decimals)[0] for v in vals[2:6]]
                else:
                    if not day(scope["start"]) <= day(vals[1]) <= day(scope["end"]):
                        raise SourceIssue("PERIOD")
                    vals[2] = money(vals[2], decimals)[0]
                records[source].append({"id": rid, "row": n, "values": vals, "signed": extra})
            except SourceIssue as exc:
                problem(str(exc), source, n)
        if good_header:
            for field in [want[0]] + (["Fee ID"] if source == 1 else []):
                column = head.index(field)
                groups = {}
                for n, raw in enumerate(rows[1:], 2):
                    val = raw[column] if column < len(raw) else ""
                    if val and val == val.strip():
                        groups.setdefault(val, []).append(n)
                for val, group in groups.items():
                    if len(group) > 1:
                        for n in group:
                            problem("DUPLICATE", source, n, js([field, val]))
    for source in (2, 3):
        if nonblank[source] > 1:
            problem("CARDINALITY", source, 0)
    missing = [ROLES[i] for i in (0, 2, 3) if not records[i]]
    if len(records[2]) == 1 and records[2][0]["values"][4] > 0 and not records[1]:
        missing.append("fee-evidence")
    if len(records[2]) == len(records[3]) == 1 and records[2][0]["values"][6] != records[3][0]["values"][0]:
        problem("PAYOUT_LINK", 3, records[3][0]["row"])
    totals = residuals = None
    try:
        gross = total(r["values"][3] for r in records[0] if r["values"][1] == "sale")
        refunds = total(r["values"][3] for r in records[0] if r["values"][1] == "refund")
        fees = total(r["values"][2] for r in records[1])
        totals = [gross, refunds, fees, total([gross, -refunds, -fees])]
    except SourceIssue:
        problem("TOTAL_BOUND", 0, 0)
    if not issues and totals is not None and len(records[2]) == len(records[3]) == 1:
        summary = records[2][0]["values"]
        try:
            residuals = [total([t, -s], "RESIDUAL_BOUND") for t, s in zip(totals, summary[2:6])] + [total([summary[5], -records[3][0]["values"][2]], "RESIDUAL_BOUND")]
        except SourceIssue:
            problem("RESIDUAL_BOUND", 2, records[2][0]["row"])
    if issues:
        totals = residuals = None
    error_map = {}
    for code, source, n, key in issues:
        error_map.setdefault((source, n), set()).add(code)
    for row in inventory:
        errors = error_map.get((row[0], row[2]), set())
        if errors:
            row[3], row[4] = "invalid", "|".join(sorted(errors))
    financial = "source-error" if issues else "missing" if missing else "difference" if any(residuals or []) else "ready"
    review = "needs-review"
    events, event_members, event_ids = [], [], set()
    require(isinstance(session["events"], list) and len(session["events"]) <= 1000 and sum(len(e["memberIds"]) for e in session["events"]) <= 100000, "event capacity")
    for sequence, event in enumerate(session["events"], 1):
        require(set(event) == {"id", "type", "batchId", "memberIds", "context", "at", "reference", "note"}, "event schema")
        require(event["type"] in ("accept", "reject", "undo") and event["id"] not in event_ids, "event type/duplicate")
        event_ids.add(event["id"])
        for key in ("id", "batchId"):
            text(event[key])
        for key in ("reference", "note"):
            text(event[key], relaxed=True)
        require(event["batchId"] == scope["batchId"] and event["context"] == context, "event full context/batch")
        require(isinstance(event["memberIds"], list) and 0 < len(event["memberIds"]) <= 20000 and len(event["memberIds"]) == len(set(event["memberIds"])) and sorted(event["memberIds"]) == sorted(members), "event exact full member set")
        stamp = event["at"]
        require(bool(re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z", stamp)), "event UTC timestamp grammar")
        datetime.strptime(stamp, "%Y-%m-%dT%H:%M:%S.%fZ")
        if event["type"] == "accept":
            require(financial == "ready" and complete["confirmed"], "event acceptance financial/completeness")
        if event["type"] == "undo":
            require(review != "needs-review", "undo transition")
            review = "needs-review"
        else:
            require(review == "needs-review", "review transition")
            review = "accepted" if event["type"] == "accept" else "rejected"
        events.append([sequence, event["id"], event["type"], event["batchId"], stamp, event["reference"], event["note"], event["context"]])
        event_members.extend([[sequence, event["id"], rid] for rid in event["memberIds"]])
    status = financial if financial != "ready" else "consistent-with-evidence" if complete["confirmed"] and review == "accepted" else "needs-review"
    tables = {}
    summary = [["Domain", "payment-gateway-batch"], ["Version", VERSION]] + ([["Transaction family", SIGNED]] if signed else []) + [["Claim", CLAIM], ["Status", status], ["Review", review], ["Decimals", decimals], ["Context", context]] + [[k, scope[k]] for k in KEYS] + [["Scope confirmed", "true"], ["Completeness confirmed", str(complete["confirmed"]).lower()], ["Completeness reference", complete["reference"]], ["Completeness reason", complete["note"]]]
    tables["Summary"] = [HEADERS["Summary"], summary]
    for source, name in enumerate(NAMES[1:5]):
        headers = ["Record ID", "Source", "Source row"] + (SIGNED_VALUES + ["Signed minor units", "Canonical magnitude minor units", "Original sign", "Normalized signed amount", "Representation"] if source == 0 and signed else VALUES[source])
        rows = []
        for rec in records[source]:
            vals = rec["values"]
            if source == 0 and signed:
                raw, signed_minor, magnitude, sign, normalized, representation = rec["signed"]
                vals = [vals[0], vals[1], vals[2], raw, vals[4], signed_minor, magnitude, sign, normalized, representation]
            rows.append([rec["id"], source, rec["row"], *vals])
        tables[name] = [headers, rows]
    for name, rows in [("Totals", [totals] if totals is not None else []), ("Residuals", [residuals] if residuals is not None else []), ("Missing", [[v] for v in missing]), ("Issues", issues), ("Cell evidence", evidence), ("Inventory", inventory), ("Reading", [[i, r["sheet"], r["role"], r["family"], "true"] for i, r in enumerate(session["readings"])]), ("Events", events), ("Event members", event_members), ("Sources", [[i, s["name"], s["sha256"], offset // 30000, s["data"][offset:offset+30000]] for i, s in enumerate(sources) for offset in range(0, len(s["data"]), 30000)])]:
        tables[name] = [HEADERS[name], rows]
    return tables, {"financial": financial, "review": review, "status": status, "totalsMinor": totals, "residualsMinor": residuals, "missing": missing, "memberCount": len(members), "sourceRowCount": len(inventory), "sourceCellCount": len(evidence), "eventCount": len(events), "signed": signed}

def verify_artifact(workbook, session_file, case, truths=None):
    session_raw = session_file.read_bytes()
    require(0 < len(session_raw) <= 64 * 1024 * 1024, "session byte capacity")
    session = json.loads(session_raw.decode("utf-8", errors="strict"))
    signed, sources = originals(session)
    expected, financial = expected_tables(session, sources, signed)
    book_raw = workbook.read_bytes()
    book = parse_book(book_raw)
    compared = []
    for name in NAMES:
        headers, rows = expected[name]
        actual = book[name]["rows"]
        require(actual and actual[0] == headers, name + " exact headers")
        require(actual[1:] == rows, name + " complete table mismatch")
        compared.append({"sheet": name, "rows": len(rows), "columns": len(headers)})
    # Decode and hash the exported chunks themselves as well as the matching
    # session originals. Table equality is checked separately above.
    exported_sources = book["Sources"]["rows"][1:]
    for i, source in enumerate(sources):
        chunks = [row for row in exported_sources if row[0] == i]
        require(chunks and [row[3] for row in chunks] == list(range(len(chunks))), "export source chunk order/completeness")
        require(all(row[1] == source["name"] and row[2] == source["sha256"] for row in chunks), "export source chunk identity")
        require(all(len(row[4]) == 30000 for row in chunks[:-1]) and 0 < len(chunks[-1][4]) <= 30000, "export source chunk boundaries")
        encoded = "".join(row[4] for row in chunks)
        decoded = base64.b64decode(encoded, validate=True)
        require(base64.b64encode(decoded).decode() == encoded and decoded == source["raw"] and sha(decoded) == source["sha256"], "export original chunks/base64/SHA bytes")
    truth_checked = False
    if signed and truths and case in truths:
        declaration = truths[case]
        for field in ("financial", "totalsMinor", "residualsMinor", "missing"):
            if field in declaration:
                require(financial[field] == declaration[field], "separate literal truth " + field)
        truth_checked = True
    return {"case": case, "workbook": str(workbook), "session": str(session_file), "workbookSHA256": sha(book_raw), "sessionSHA256": sha(session_raw), "originalHashes": [s["sha256"] for s in sources], "originalBytes": [len(s["raw"]) for s in sources], "nativeOriginals": sum(s["native"] for s in sources), "all15TablesCompared": compared, "literalSignedTruthChecked": truth_checked, **financial, "passed": True}

def mutation_file(workbook, output, kind):
    """Corrupt a real export using independent raw OOXML, without product APIs."""
    raw = workbook.read_bytes()
    book = parse_book(raw)
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        parts = {p: z.read(p) for p in z.namelist()}
    sheet_name = "Transactions" if kind in ("refund-sign", "omit-zero") else "Residuals" if kind == "bank-residual" else "Sources"
    target = book[sheet_name]["part"]
    root = xml(parts[target])
    rows = root.find(f"{{{SS}}}sheetData")
    raw_rows = book[sheet_name]["rows"]
    header = raw_rows[0]
    if kind == "omit-zero":
        column = header.index("Canonical magnitude minor units")
        n = next((i for i, row in enumerate(raw_rows[1:], 2) if row[column] == 0), None)
        require(n is not None, "falsification needs exported zero transaction")
        for row in list(rows):
            if int(row.get("r")) == n:
                rows.remove(row)
                break
    else:
        if kind == "refund-sign":
            column = header.index("Signed amount") + 1
            n = next((i for i, row in enumerate(raw_rows[1:], 2) if row[header.index("Kind")] == "refund" and str(row[column-1]).startswith("-")), None)
            require(n is not None, "falsification needs negative refund transaction")
            replacement = "+" + str(raw_rows[n-1][column-1])[1:]
        elif kind == "bank-residual":
            column, n = header.index("Bank credit") + 1, 2
            require(len(raw_rows) > 1, "falsification needs financial residuals")
            replacement = str(int(raw_rows[1][column-1]) + 1)
        else:
            column, n = header.index("Original base64") + 1, 2
            require(len(raw_rows) > 1, "falsification needs source chunks")
            old = raw_rows[1][column-1]
            replacement = ("A" if old[0] != "A" else "B") + old[1:]
        letters = ""
        col = column
        while col:
            col, remainder = divmod(col-1, 26)
            letters = chr(65+remainder) + letters
        coordinate = letters + str(n)
        cell = next(c for c in root.iter(f"{{{SS}}}c") if c.get("r") == coordinate)
        cell.clear()
        cell.set("r", coordinate)
        if kind == "bank-residual":
            cell.set("t", "n")
            ET.SubElement(cell, f"{{{SS}}}v").text = replacement
        else:
            cell.set("t", "inlineStr")
            ET.SubElement(ET.SubElement(cell, f"{{{SS}}}is"), f"{{{SS}}}t").text = replacement
    parts[target] = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as z:
        for path, data in parts.items():
            z.writestr(path, data)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--index", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--truths", type=Path, default=Path(__file__).resolve().parents[1] / "audit/payment-gateway-signed/handcrafted_truths.json")
    parser.add_argument("--falsify", action="store_true")
    args = parser.parse_args()
    require(args.index.is_file(), "evidence index missing")
    index_raw = args.index.read_bytes()
    index = json.loads(index_raw.decode())
    require("artifacts" in index and set(index) <= {"artifacts", "stage", "synthetic", "fieldOriginals", "family", "checks", "passed"} and isinstance(index["artifacts"], list) and index["artifacts"], "evidence index schema/nonempty")
    truths = json.loads(args.truths.read_text(encoding="utf-8")) if args.truths.is_file() else None
    args.output_dir.mkdir(parents=True, exist_ok=True)
    artifacts = []
    locations = []
    seen_paths = set()
    for item in index["artifacts"]:
        require(set(item) == {"workbook", "session", "case", "phase"}, "artifact index entry schema")
        paths = [Path(item[key]) for key in ("workbook", "session")]
        workbook, session = [p if p.is_absolute() else args.index.parent / p for p in paths]
        require(workbook.is_file() and session.is_file(), "indexed workbook/session missing")
        require((workbook.resolve(), session.resolve()) not in seen_paths, "duplicate indexed artifact pair")
        seen_paths.add((workbook.resolve(), session.resolve()))
        result = verify_artifact(workbook, session, item["case"], truths)
        result["phase"] = item["phase"]
        artifacts.append(result)
        locations.append((workbook, session, item))
    falsifications = []
    if args.falsify:
        for kind in ("refund-sign", "omit-zero", "bank-residual", "source-chunk"):
            selected = None
            for workbook, session, item in locations:
                candidate = parse_book(workbook.read_bytes())["Transactions"]["rows"]
                head = candidate[0]
                if kind == "refund-sign" and "Signed amount" in head and any(r[head.index("Kind")] == "refund" and str(r[head.index("Signed amount")]).startswith("-") for r in candidate[1:]):
                    selected = (workbook, session, item); break
                if kind == "omit-zero" and "Canonical magnitude minor units" in head and any(r[head.index("Canonical magnitude minor units")] == 0 for r in candidate[1:]):
                    selected = (workbook, session, item); break
                if kind in ("bank-residual", "source-chunk") and (kind == "source-chunk" or len(parse_book(workbook.read_bytes())["Residuals"]["rows"]) > 1):
                    selected = (workbook, session, item); break
            require(selected is not None, "no indexed baseline for required falsification " + kind)
            workbook, session, item = selected
            mutated = args.output_dir / ("corrupted-" + kind + ".xlsx")
            mutation_file(workbook, mutated, kind)
            try:
                verify_artifact(mutated, session, item["case"], truths)
            except Rejected as exc:
                falsifications.append({"kind": kind, "baselineWorkbook": str(workbook), "baselineSHA256": sha(workbook.read_bytes()), "corruptedWorkbook": str(mutated), "corruptedSHA256": sha(mutated.read_bytes()), "rejected": True, "reason": str(exc)})
            else:
                raise Rejected("corrupted workbook incorrectly passed: " + kind)
    receipt = {"executedAtUTC": datetime.now(timezone.utc).isoformat(), "python": sys.version, "checkerSHA256": sha(Path(__file__).read_bytes()), "index": str(args.index), "indexSHA256": sha(index_raw), "provenance": "Synthetic source artifacts; financial expectations independently computed with Decimal by AI preparation agent, no real field claim", "productImportedOrExecutedByChecker": False, "previousOracleImported": False, "artifactCount": len(artifacts), "allTableComparisons": len(artifacts) * 15, "signedArtifacts": sum(a["signed"] for a in artifacts), "canonicalArtifacts": sum(not a["signed"] for a in artifacts), "literalTruthCrosschecks": sum(a["literalSignedTruthChecked"] for a in artifacts), "sourceSnapshotsVerified": len(artifacts) * 4, "nativeSourceSnapshotsVerified": sum(a["nativeOriginals"] for a in artifacts), "coverage": "All fifteen complete table values, headers and row order; original chunks/base64/SHA; raw sign and zero membership; precision/bounds; scope/readings/context; full event membership and review transitions; literal/fmt14 native dates and selected raw native guards", "nativeDisplayLimitations": "Does not independently reproduce full bank font/theme/geometry/conditional-display guard", "artifacts": artifacts, "falsifications": falsifications, "passed": True}
    (args.output_dir / "independent-export-receipt.json").write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(js({"passed": True, "artifactCount": len(artifacts), "allTableComparisons": len(artifacts) * 15, "sourceSnapshotsVerified": len(artifacts) * 4, "falsificationsRejected": len(falsifications), "checkerSHA256": receipt["checkerSHA256"]}))

if __name__ == "__main__":
    try:
        main()
    except (Rejected, SourceIssue, OSError, ValueError, TypeError, KeyError, IndexError, csv.Error, ET.ParseError, zipfile.BadZipFile) as exc:
        print(js({"passed": False, "error": type(exc).__name__, "reason": str(exc)}), file=sys.stderr)
        sys.exit(1)
