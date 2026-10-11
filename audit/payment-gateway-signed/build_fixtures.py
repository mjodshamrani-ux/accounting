#!/usr/bin/env python3
"""Author synthetic originals and HAND-DECLARED truths; does not import oracle.

No real gateway files were available. Every business name, account, reference,
date and financial value in this corpus was invented for specification testing.
Expected values below are literal declarations, never computed by the oracle.
"""
import copy
import csv
import io
import json
from pathlib import Path
import zipfile
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parent
FAMILY = "payment-gateway-signed-kind-1"
CANONICAL = "payment-gateway-batch-1"
KEYS = ["entity", "gateway", "merchantAccount", "bankAccount", "dimensions", "currency", "currencyBasis", "fxPolicy", "start", "end", "asOf", "policyVersion", "batchId"]
SCOPE_HEADERS = ["Entity", "Gateway", "Merchant account", "Bank account", "Complete dimensions", "Currency", "Currency basis", "FX policy", "Period start", "Period end", "As of", "Policy version", "Batch ID"]
HEADERS = [["Transaction ID", "Kind", "Posting date", "Signed amount", "Reference"], ["Evidence ID", "Fee ID", "Amount", "Reference", "Valid from", "Valid to"], ["Settlement ID", "Settlement date", "Gross sales", "Refunds", "Fees", "Net", "Payout ID", "Reference"], ["Payout ID", "Value date", "Credit", "Reference"]]
SS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
P = "http://schemas.openxmlformats.org/package/2006/relationships"
CT = "http://schemas.openxmlformats.org/package/2006/content-types"
ET.register_namespace("", SS)
truths = {}

def base_scope(currency="SAR"):
    return dict(zip(KEYS, ["Synthetic Example Entity", "Synthetic Gateway", "00017", "00029", "region=TEST;channel=synthetic", currency, "functional", "same-currency-no-conversion", "2026-10-01", "2026-10-05", "2026-10-05", "synthetic-policy-1", "SYNTH-BATCH-01"]))

def tx(id, kind, amount, date="2026-10-02"):
    return [id, kind, date, amount, "Synthetic transaction " + id]

def fee(id, amount, fee_id=None):
    return [id, fee_id or ("F-" + id), amount, "Synthetic independent fee " + id, "2026-09-01", "2026-10-31"]

def data(transactions, fees, summary, credit=None):
    # No arithmetic: summary and credit are deliberately handwritten inputs.
    return [transactions, fees, [["SYNTH-SETTLE", "2026-10-05", *summary, "SYNTH-PAYOUT", "Synthetic settlement original"]], [["SYNTH-PAYOUT", "2026-10-05", credit if credit is not None else summary[3], "Synthetic bank original"]]]

def rows_for(values, scope):
    return [[head + SCOPE_HEADERS] + [v + list(scope.values()) if v else [] for v in role] for head, role in zip(HEADERS, values)]

def column_name(index):
    out = ""
    while index:
        index, rem = divmod(index - 1, 26)
        out = chr(65 + rem) + out
    return out

def xml_bytes(tree):
    return ET.tostring(tree, encoding="utf-8", xml_declaration=True)

def native_workbook(rows, shape):
    """A real OPC workbook, with relationships, styles and inline/shared cells.

    Both shapes use true numeric money cells with built-in numFmtId 2. Native
    signed money preserves its original sign in raw v XML, before any coercion.
    Empty records become explicit empty rows, and sparse empty cells are omitted.
    """
    workbook = ET.Element(f"{{{SS}}}workbook")
    sheets = ET.SubElement(workbook, f"{{{SS}}}sheets")
    ET.SubElement(sheets, f"{{{SS}}}sheet", {"name": "Synthetic original", "sheetId": "1", f"{{{R}}}id": "rIdOriginal"})
    relationships = ET.Element(f"{{{P}}}Relationships")
    ET.SubElement(relationships, f"{{{P}}}Relationship", {"Id": "rIdOriginal", "Type": R + "/worksheet", "Target": "worksheets/original.xml"})
    ET.SubElement(relationships, f"{{{P}}}Relationship", {"Id": "rIdStyles", "Type": R + "/styles", "Target": "styles.xml"})
    package_rels = ET.Element(f"{{{P}}}Relationships")
    ET.SubElement(package_rels, f"{{{P}}}Relationship", {"Id": "rIdWorkbook", "Type": R + "/officeDocument", "Target": "xl/workbook.xml"})
    sheet = ET.Element(f"{{{SS}}}worksheet")
    ET.SubElement(sheet, f"{{{SS}}}dimension", {"ref": "A1:" + column_name(len(rows[0])) + str(len(rows))})
    sheetdata = ET.SubElement(sheet, f"{{{SS}}}sheetData")
    shared_values, shared_index = [], {}
    numeric_headers = {"Signed amount", "Amount", "Gross sales", "Refunds", "Fees", "Net", "Credit"}
    for i, row in enumerate(rows, 1):
        r = ET.SubElement(sheetdata, f"{{{SS}}}row", {"r": str(i)})
        for j, value in enumerate(row, 1):
            if value == "":
                continue
            address = column_name(j) + str(i)
            if i > 1 and rows[0][j-1] in numeric_headers:
                cell = ET.SubElement(r, f"{{{SS}}}c", {"r": address, "t": "n", "s": "1"})
                ET.SubElement(cell, f"{{{SS}}}v").text = value
            elif shape == "shared-numeric":
                if value not in shared_index:
                    shared_index[value] = len(shared_values)
                    shared_values.append(value)
                cell = ET.SubElement(r, f"{{{SS}}}c", {"r": address, "t": "s"})
                ET.SubElement(cell, f"{{{SS}}}v").text = str(shared_index[value])
            else:
                cell = ET.SubElement(r, f"{{{SS}}}c", {"r": address, "t": "inlineStr"})
                inline = ET.SubElement(cell, f"{{{SS}}}is")
                ET.SubElement(inline, f"{{{SS}}}t").text = value
    style = ET.Element(f"{{{SS}}}styleSheet")
    fonts = ET.SubElement(style, f"{{{SS}}}fonts", {"count": "1"})
    font = ET.SubElement(fonts, f"{{{SS}}}font")
    ET.SubElement(font, f"{{{SS}}}sz", {"val": "11"})
    ET.SubElement(font, f"{{{SS}}}name", {"val": "Calibri"})
    fills = ET.SubElement(style, f"{{{SS}}}fills", {"count": "2"})
    for pat in ("none", "gray125"):
        ET.SubElement(ET.SubElement(fills, f"{{{SS}}}fill"), f"{{{SS}}}patternFill", {"patternType": pat})
    ET.SubElement(ET.SubElement(style, f"{{{SS}}}borders", {"count": "1"}), f"{{{SS}}}border")
    for name in ("cellStyleXfs", "cellXfs"):
        xfs = ET.SubElement(style, f"{{{SS}}}" + name, {"count": "2" if name == "cellXfs" else "1"})
        ET.SubElement(xfs, f"{{{SS}}}xf", {"numFmtId": "0", "fontId": "0", "fillId": "0", "borderId": "0"})
        if name == "cellXfs":
            ET.SubElement(xfs, f"{{{SS}}}xf", {"numFmtId": "2", "fontId": "0", "fillId": "0", "borderId": "0", "applyNumberFormat": "1"})
    styles = ET.SubElement(style, f"{{{SS}}}cellStyles", {"count": "1"})
    ET.SubElement(styles, f"{{{SS}}}cellStyle", {"name": "Normal", "xfId": "0", "builtinId": "0"})
    parts = {"xl/workbook.xml": xml_bytes(workbook), "xl/_rels/workbook.xml.rels": xml_bytes(relationships), "_rels/.rels": xml_bytes(package_rels), "xl/worksheets/original.xml": xml_bytes(sheet), "xl/styles.xml": xml_bytes(style)}
    if shared_values:
        sst = ET.Element(f"{{{SS}}}sst", {"count": str(len(shared_values)), "uniqueCount": str(len(shared_values))})
        for v in shared_values:
            ET.SubElement(ET.SubElement(sst, f"{{{SS}}}si"), f"{{{SS}}}t").text = v
        parts["xl/sharedStrings.xml"] = xml_bytes(sst)
        ET.SubElement(relationships, f"{{{P}}}Relationship", {"Id": "rIdStrings", "Type": R + "/sharedStrings", "Target": "sharedStrings.xml"})
        parts["xl/_rels/workbook.xml.rels"] = xml_bytes(relationships)
    types = ET.Element(f"{{{CT}}}Types")
    for ext, typ in [("rels", "application/vnd.openxmlformats-package.relationships+xml"), ("xml", "application/xml")]:
        ET.SubElement(types, f"{{{CT}}}Default", {"Extension": ext, "ContentType": typ})
    for part, typ in [("xl/workbook.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"), ("xl/worksheets/original.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"), ("xl/styles.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml")]:
        ET.SubElement(types, f"{{{CT}}}Override", {"PartName": "/" + part, "ContentType": typ})
    if shared_values:
        ET.SubElement(types, f"{{{CT}}}Override", {"PartName": "/xl/sharedStrings.xml", "ContentType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"})
    parts["[Content_Types].xml"] = xml_bytes(types)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for path, content in parts.items():
            info = zipfile.ZipInfo(path, date_time=(2026, 10, 11, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, content)
    return buf.getvalue()

def emit(name, values, truth, *, currency="SAR", structure, shape=None, rows_override=None, manifest_extra=None):
    directory = ROOT / "fixtures" / name
    directory.mkdir(parents=True, exist_ok=True)
    scope = base_scope(currency)
    rows = rows_override if rows_override is not None else rows_for(values, scope)
    files = []
    for i, raw_rows in enumerate(rows):
        path = directory / (str(i) + "." + ("xlsx" if shape else "csv"))
        if shape:
            path.write_bytes(native_workbook(raw_rows, shape))
        else:
            with path.open("w", encoding="utf-8", newline="") as stream:
                csv.writer(stream, lineterminator="\n").writerows(raw_rows)
        files.append(path.name)
    manifest = {"provenance": "synthetic; no real field data available", "scope": scope, "readings": [FAMILY, CANONICAL, CANONICAL, CANONICAL], "files": files}
    manifest.update(manifest_extra or {})
    (directory / "bundle.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    truths[name] = {"structure": structure, "provenance": "hand-declared synthetic truth", **truth}
    return rows

def valid(financial, totals, residuals):
    return {"financial": financial, "totalsMinor": totals, "residualsMinor": residuals, "issueCodes": [], "missing": []}

def rejected(code):
    return {"financial": "source-error", "totalsMinor": None, "residualsMinor": None, "requiredIssueCodes": [code]}

def build():
    mixed = data([tx("S1", "sale", "+100.00"), tx("R1", "refund", "-20.00"), tx("S2", "sale", "50")], [fee("E1", "1.00"), fee("E2", "2.00")], ["150.00", "20.00", "3.00", "127.00"])
    mixed_truth = valid("ready", [15000, 2000, 300, 12700], [0, 0, 0, 0, 0])
    emit("sar-mixed", mixed, mixed_truth, structure="3 interleaved sale/refund movements; 2 independent fee rows")
    nofees = data([tx("S1", "sale", "7")], [], ["7", "0", "0", "7"])
    emit("sar-one-sale-header-fees", nofees, valid("ready", [700, 0, 0, 700], [0, 0, 0, 0, 0]), structure="one sale; fee original is header-only; explicit settlement fees 0")
    zeros = data([tx("Z1", "sale", "0"), tx("Z2", "refund", "+0.00"), tx("Z3", "sale", "+00.0"), tx("Z4", "refund", "00")], [fee("E0", "0")], ["0", "0", "0", "0"])
    emit("sar-zero-kinds", zeros, valid("ready", [0, 0, 0, 0], [0, 0, 0, 0, 0]), structure="4 zero-valued movements across both explicit kinds; explicit zero fee row")
    jpy = data([tx("R1", "refund", "-2"), tx("S1", "sale", "+101"), tx("S2", "sale", "20"), tx("R2", "refund", "-3"), tx("S3", "sale", "4")], [fee("E1", "1"), fee("E2", "2"), fee("E3", "1")], ["125", "5", "4", "116"])
    emit("jpy-many-fees", jpy, valid("ready", [125, 5, 4, 116], [0, 0, 0, 0, 0]), currency="JPY", structure="zero-decimal currency; 5 mixed movements; 3 fee rows")
    kwd = data([tx("S1", "sale", "+12.345"), tx("R1", "refund", "-0.345"), tx("S2", "sale", "0.001"), tx("Z1", "refund", "+0")], [fee("E1", "0.001")], ["12.346", "0.345", "0.001", "12.000"])
    kwd_truth = valid("ready", [12346, 345, 1, 12000], [0, 0, 0, 0, 0])
    emit("kwd-three-decimal", kwd, kwd_truth, currency="KWD", structure="3-decimal currency; 4 movements including explicit refund +0; 1 fee")
    arabic = data([tx("S1", "sale", "+١٢٫٥٠"), tx("R1", "refund", "-۲٫۵۰")], [fee("E1", "٠٫٥٠")], ["۱۲٫۵۰", "٢٫٥٠", "۰٫۵۰", "٩٫٥٠"])
    emit("sar-arabic-persian", arabic, valid("ready", [1250, 250, 50, 950], [0, 0, 0, 0, 0]), structure="Arabic and Persian digits with Arabic decimal separator in all money roles")
    blanked = copy.deepcopy(mixed)
    blanked[0] = [[], blanked[0][2], [], blanked[0][1], blanked[0][0], []]
    blanked[1] = [blanked[1][1], [], blanked[1][0]]
    blanked[2].insert(0, [])
    emit("sar-blank-row-permutation", blanked, mixed_truth, structure="row permutation with 4 blank transaction records, blank fee and settlement records")
    offset = data([tx("S1", "sale", "100"), tx("R1", "refund", "-20")], [fee("E1", "3")], ["101", "21", "3", "77"])
    emit("sar-component-cancellation", offset, valid("difference", [10000, 2000, 300, 7700], [-100, -100, 0, 0, 0]), structure="gross/refund discrepancies cancel exactly in net; component differences remain")
    fee_diff = data([tx("S1", "sale", "+100")], [fee("E1", "3")], ["100", "0", "4", "96"])
    emit("sar-fee-component-difference", fee_diff, valid("difference", [10000, 0, 300, 9700], [0, 0, -100, 100, 0]), structure="independent fee 3 vs summary 4; retain fee and net residuals")
    payout_diff = data([tx("S1", "sale", "10")], [], ["10", "0", "0", "10"], "9.99")
    emit("sar-bank-credit-difference", payout_diff, valid("difference", [1000, 0, 0, 1000], [0, 0, 0, 0, 1]), structure="one-cent payout discrepancy with exact settlement components")
    bound = data([tx("S1", "sale", "+1000000000000.00")], [], ["1000000000000.00", "0", "0", "1000000000000.00"])
    emit("sar-inclusive-bound", bound, valid("ready", [100000000000000, 0, 0, 100000000000000], [0, 0, 0, 0, 0]), structure="one movement exactly at inherited inclusive 1e14-minor-unit bound")
    refund_only = data([tx("R1", "refund", "-5")], [], ["0", "5", "0", "0"])
    emit("sar-refund-only-difference", refund_only, valid("difference", [0, 500, 0, -500], [0, 0, 0, -500, 0]), structure="refund-only population; derived negative net vs nonnegative supplied net")
    inline_rows = emit("format-sar-mixed-inline-xlsx", mixed, {**mixed_truth, "formatEquivalentTo": "sar-mixed"}, structure="FORMAT CHECK ONLY: native inlineStr OOXML paired to sar-mixed", shape="inline")
    shared_rows = emit("format-sar-blank-shared-numeric-xlsx", blanked, {**mixed_truth, "formatEquivalentTo": "sar-blank-row-permutation"}, structure="FORMAT CHECK ONLY: shared identity strings, numeric money fmt2, explicit blank rows paired to SAR", shape="shared-numeric")
    neg_specs = [
        ("sale-negative", "sale", "-100", "SIGN_KIND"),
        ("refund-positive", "refund", "+100", "SIGN_KIND"),
        ("refund-unsigned-positive", "refund", "100", "SIGN_KIND"),
        ("sale-negative-zero", "sale", "-0.00", "NEGATIVE_ZERO"),
        ("refund-negative-zero", "refund", "-٠٫٠٠", "NEGATIVE_ZERO"),
        ("missing-kind", "", "100", "KIND"),
        ("chargeback-kind", "chargeback", "-100", "KIND"),
        ("sar-excess-precision", "sale", "+1.001", "AMOUNT_PRECISION"),
        ("unicode-minus", "refund", "−1", "AMOUNT"),
        ("accounting-parentheses", "refund", "(1)", "AMOUNT"),
        ("scientific-money", "sale", "1e2", "AMOUNT"),
        ("sign-whitespace", "sale", "+ 1", "AMOUNT"),
        ("individual-bound", "sale", "1000000000000.01", "AMOUNT_BOUND"),
    ]
    for name, kind, amount, code in neg_specs:
        v = copy.deepcopy(nofees)
        v[0][0][1], v[0][0][3] = kind, amount
        emit("negative-" + name, v, rejected(code), structure="negative lexical/kind case: " + name)
    for name, value, col, code in [("identity-bidi-cf", "SYNTH\u202eID", 0, "IDENTITY"), ("identity-c1-control", "SYNTH\u0085ID", 0, "IDENTITY"), ("identity-astral-501-units", "😀" * 251, 0, "IDENTITY"), ("reference-astral-2002-units", "😀" * 1001, 4, "IDENTITY"), ("cell-astral-32768-units", "😀" * 16384, 4, "CELL_LIMIT")]:
        v = copy.deepcopy(nofees); v[0][0][col] = value
        emit("negative-" + name, v, rejected(code), structure="Unicode/UTF16 boundary: " + name)
    for currency, amount in [("JPY", "+1.0"), ("KWD", "+1.0001")]:
        v = data([tx("S1", "sale", amount)], [], ["1", "0", "0", "1"])
        emit("negative-precision-" + currency.lower(), v, rejected("AMOUNT_PRECISION"), currency=currency, structure="excess lexical fractional digits for currency precision")
    v = copy.deepcopy(mixed); v[0].append(tx("S1", "refund", "-0"))
    emit("negative-duplicate-transaction-even-invalid", v, rejected("DUPLICATE"), structure="duplicate Transaction ID across valid sale and invalid negative-zero refund")
    v = copy.deepcopy(mixed); v[1][1][1] = v[1][0][1]
    emit("negative-duplicate-fee-id", v, rejected("DUPLICATE"), structure="distinct evidence IDs but duplicate fee ID")
    v = copy.deepcopy(mixed); v[1] = []
    emit("missing-positive-fee-detail", v, {"financial": "missing", "totalsMinor": [15000, 2000, 0, 13000], "residualsMinor": [0, 0, -300, 300, 0], "issueCodes": [], "missing": ["fee-evidence"]}, structure="header-only fee original with positive summary fee; never infer 3 from summary or net")
    rows = rows_for(mixed, base_scope()); rows[0][2][-1] = "SYNTH-SECOND-BATCH"
    emit("negative-multiple-batch", mixed, rejected("ROW_SCOPE"), rows_override=rows, structure="second batch in one refund transaction original")
    v = copy.deepcopy(mixed); v[3].append(["SYNTH-PAYOUT-2", "2026-10-05", "1", "Synthetic second bank credit"])
    emit("negative-multiple-payout", v, rejected("CARDINALITY"), structure="two distinct bank credits; splitting/netting out of scope")
    v = copy.deepcopy(mixed); v[2].append(["SYNTH-SETTLE-2", "2026-10-05", "0", "0", "0", "0", "SYNTH-PAYOUT", "Synthetic second settlement"])
    emit("negative-multiple-settlement", v, rejected("CARDINALITY"), structure="two settlement rows; combining batches out of scope")
    for role, col, name in [(1, 2, "fee"), (2, 5, "settlement-net"), (3, 2, "bank-credit")]:
        v = copy.deepcopy(mixed); v[role][0][col] = "-1"
        emit("negative-canonical-" + name, v, rejected("AMOUNT"), structure="canonical other-role money grammar remains unsigned: " + name)
    v = copy.deepcopy(mixed); v[1][0][2] = "+1"
    emit("negative-canonical-fee-plus", v, rejected("AMOUNT"), structure="plus permission applies only to signed transaction family")
    v = copy.deepcopy(bound); v[0].append(tx("S2", "sale", "0.01"))
    emit("negative-aggregate-bound", v, rejected("TOTAL_BOUND"), structure="two individually bounded sales sum above inherited bound")
    emit("negative-unsupported-currency", mixed, rejected("CURRENCY"), currency="USD", structure="four internally consistent originals but unsupported currency")
    rows = rows_for(mixed, base_scope()); rows[0][0][3] = "Amount"
    emit("negative-canonical-header-signed-reading", mixed, rejected("COLUMNS"), rows_override=rows, structure="canonical Amount header cannot satisfy Signed amount family")
    emit("negative-signed-header-canonical-reading", mixed, rejected("READING"), structure="Signed amount header requires explicit signed family reading", manifest_extra={"readings": [CANONICAL] * 4})
    rows = copy.deepcopy(inline_rows); rows[0][1][3] = "999.00"
    emit("negative-native-cache-mismatch", mixed, rejected("NATIVE_CACHE_MISMATCH"), shape="inline", structure="actual raw numeric XLSX remains +100.00; supplied parsed grid falsely claims 999.00", manifest_extra={"suppliedParsedGrids": rows})
    v = copy.deepcopy(nofees); v[0][0][3] = "-0.00"
    emit("negative-native-negative-zero", v, rejected("NEGATIVE_ZERO"), shape="inline", structure="raw numeric v=-0.00 must be rejected before coercion loses minus sign")
    v = copy.deepcopy(nofees); v[0][0][3] = "1e2"
    emit("negative-native-exponent", v, rejected("XLSX_MONEY_LEXEME"), shape="shared-numeric", structure="raw monetary exponent is rejected despite numerically representable value")
    v = copy.deepcopy(nofees); v[0][0][3] = "+١٠٠٫٠٠"
    emit("negative-native-arabic-numeric", v, rejected("XLSX_MONEY_LEXEME"), shape="inline", structure="native numeric XML monetary lexemes must be ASCII; CSV Arabic normalization is separate")
    emit("negative-native-jpy-scope", jpy, rejected("XLSX_CURRENCY"), currency="JPY", shape="inline", structure="JPY allowed in CSV only; native guard remains SAR/2-decimal")
    emit("negative-native-formula-cache", mixed, rejected("XLSX_FORMULA"), shape="inline", structure="formula cell with plausible stale cache; raw formula remains disallowed")
    path = ROOT / "fixtures/negative-native-formula-cache/0.xlsx"
    with zipfile.ZipFile(path) as z:
        parts = {name: z.read(name) for name in z.namelist()}
    sheet = ET.fromstring(parts["xl/worksheets/original.xml"])
    target = next(c for c in sheet.iter(f"{{{SS}}}c") if c.get("r") == "D2")
    target.clear(); target.attrib.update({"r": "D2", "t": "n", "s": "1"})
    ET.SubElement(target, f"{{{SS}}}f").text = "-100"
    ET.SubElement(target, f"{{{SS}}}v").text = "100"
    parts["xl/worksheets/original.xml"] = xml_bytes(sheet)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for name, raw in parts.items():
            info = zipfile.ZipInfo(name, date_time=(2026, 10, 11, 0, 0, 0)); info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, raw)
    for name, code in [("relationship-type", "XLSX_RELATIONSHIP"), ("duplicate-relationship-id", "XLSX_RELATIONSHIP"), ("relationship-namespace", "XLSX_RELATIONSHIP"), ("worksheet-namespace", "XLSX_NAMESPACE")]:
        emit("negative-native-" + name, mixed, rejected(code), shape="inline", structure="independent source-identity negative: " + name)
        path = ROOT / ("fixtures/negative-native-" + name + "/0.xlsx")
        with zipfile.ZipFile(path) as z:
            parts = {entry: z.read(entry) for entry in z.namelist()}
        part = "xl/worksheets/original.xml" if name == "worksheet-namespace" else "xl/_rels/workbook.xml.rels"
        tree = ET.fromstring(parts[part])
        if name == "relationship-type":
            tree[0].set("Type", R + "/styles")
        elif name == "duplicate-relationship-id":
            tree[1].set("Id", tree[0].get("Id"))
        elif name == "relationship-namespace":
            tree.tag = "{urn:synthetic-invalid}Relationships"
        else:
            tree.tag = "{urn:synthetic-invalid}worksheet"
        parts[part] = xml_bytes(tree)
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
            for entry, raw in parts.items():
                info = zipfile.ZipInfo(entry, date_time=(2026, 10, 11, 0, 0, 0)); info.compress_type = zipfile.ZIP_DEFLATED
                z.writestr(info, raw)
    (ROOT / "handcrafted_truths.json").write_text(json.dumps(truths, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    valid_count = sum(t["financial"] in ("ready", "difference") and "formatEquivalentTo" not in t for t in truths.values())
    format_count = sum("formatEquivalentTo" in t for t in truths.values())
    print(json.dumps({"syntheticBundles": len(truths), "validSourceCases": valid_count, "formatEquivalenceBundles": format_count, "negativeOrMissingBundles": len(truths) - valid_count - format_count, "realFieldBundles": 0}))

if __name__ == "__main__":
    build()
