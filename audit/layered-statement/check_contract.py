#!/usr/bin/env python3
"""Independent source/amount audit for the frozen F02 synthetic fixture."""

import csv
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET
from zipfile import ZipFile


ROOT = Path(__file__).resolve().parent
CONTRACT = ROOT / "contract.json"
MAIN = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
ADDRESS = re.compile(r"^[A-Z]+([1-9][0-9]*)$")


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def minor(value):
    numerator, denominator = Decimal(str(value)).as_integer_ratio()
    require((numerator * 100) % denominator == 0, "fractional currency unit")
    return numerator * 100 // denominator


def read_sheet(book, name):
    root = ET.fromstring(book.read(name))
    rows = {}
    last = 0
    for row in root.find(MAIN + "sheetData"):
        number = int(row.get("r"))
        require(last < number, "unordered or repeated physical row")
        last = number
        values = {}
        for cell in row.findall(MAIN + "c"):
            address = cell.get("r", "")
            match = ADDRESS.fullmatch(address)
            require(match and int(match.group(1)) == number and address not in values,
                    "bad or repeated cell address")
            require(cell.find(MAIN + "f") is None, "formula not in frozen source")
            if cell.get("t") == "inlineStr":
                values[address] = "".join(cell.find(MAIN + "is").itertext())
            else:
                values[address] = Decimal(cell.find(MAIN + "v").text)
        rows[number] = values
    return rows, {item.get("ref") for item in root.findall(".//" + MAIN + "mergeCell")}


def check_supplier(path, expected, *, conflict):
    with ZipFile(path) as book:
        require(len(book.namelist()) == len(set(book.namelist())), "duplicate OOXML ZIP part")
        workbook = ET.fromstring(book.read("xl/workbook.xml"))
        require([item.get("name") for item in workbook.find(MAIN + "sheets")] ==
                ["Cover", "Statement"], "sheet selection changed")
        cover, _ = read_sheet(book, "xl/worksheets/sheet1.xml")
        require(len(cover) == 3 and "no transaction rows" in cover[3]["A3"],
                "cover sheet became a transaction source")
        rows, merges = read_sheet(book, "xl/worksheets/sheet2.xml")
    require(set(rows) == set(range(1, 11)), "source row coverage changed")
    require({"A3:A4", "B3:B4", "C3:D3", "E3:E4"} <= merges,
            "two-level headings changed")
    require(rows[3]["C3"] == "Movement" and rows[4]["C4"] == "Debit" and
            rows[4]["D4"] == "Credit", "amount role headings changed")
    require(rows[5]["A5"] == "Opening balance" and
            rows[10]["A10"] == "Closing balance", "balance labels changed")
    balance = minor(rows[5]["E5"])
    require(balance == expected["supplierBalance"]["openingMinor"], "opening differs")
    observed = []
    for number in range(6, 10):
        row = rows[number]
        amount = minor(row.get(f"C{number}", 0)) - minor(row.get(f"D{number}", 0))
        balance += amount
        require(balance == minor(row[f"E{number}"]) ==
                expected["supplierBalance"]["afterSourceRowsMinor"][str(number)],
                f"running balance differs after row {number}")
        observed.append({"sourceRow": number, "reference": row[f"B{number}"],
                         "secondaryReference": row.get(f"G{number}", ""),
                         "amountMinor": amount})
    require(balance == minor(rows[10]["E10"]) ==
            expected["supplierBalance"]["closingMinor"], "closing balance differs")
    wanted = [dict(item) for item in expected["supplierMovements"]]
    if conflict:
        wanted[1]["reference"] = "INV-934"
        wanted[1]["secondaryReference"] = "PO-99"
    require(observed == wanted, "supplier movement or source identity differs")
    return observed


def check():
    contract_bytes = CONTRACT.read_bytes()
    contract = json.loads(contract_bytes)
    for name, expected_hash in contract["files"].items():
        path = ROOT / "frozen" / name
        require(hashlib.sha256(path.read_bytes()).hexdigest() == expected_hash,
                f"frozen source changed: {name}")
    positive = check_supplier(ROOT / "frozen/supplier-layered-proven.xlsx", contract, conflict=False)
    negative = check_supplier(ROOT / "frozen/supplier-layered-conflict.xlsx", contract, conflict=True)
    require(sum(row["amountMinor"] for row in positive) ==
            contract["positive"]["requiredSupplierMovementTotalMinor"],
            "supplier transaction total differs")
    require(sum(row["amountMinor"] for row in negative) ==
            sum(row["amountMinor"] for row in positive), "counter-case must keep the tempting total")
    with (ROOT / "frozen/ledger-plain.csv").open(newline="") as stream:
        ledger = list(csv.DictReader(stream))
    observed_ledger = [
        {"sourceRow": n, "reference": row["Document No"],
         "secondaryReference": row["PO / Bank reference"],
         "amountMinor": minor(row["Amount"])}
        for n, row in enumerate(ledger, 2)
    ]
    require(observed_ledger == contract["ledgerMovements"], "ledger source differs")
    require(sum(item["amountMinor"] for item in observed_ledger) ==
            contract["positive"]["requiredLedgerMovementTotalMinor"],
            "ledger total differs")
    require(positive[0]["reference"] == positive[1]["reference"] == observed_ledger[0]["reference"] and
            positive[0]["secondaryReference"] == positive[1]["secondaryReference"] ==
            observed_ledger[0]["secondaryReference"] and
            positive[0]["amountMinor"] + positive[1]["amountMinor"] == observed_ledger[0]["amountMinor"],
            "positive invoice group lacks identity or amount proof")
    require(negative[1]["reference"] != observed_ledger[0]["reference"] and
            negative[1]["secondaryReference"] != observed_ledger[0]["secondaryReference"],
            "counter-case no longer conflicts")
    return {"verified": True, "contractSha256": hashlib.sha256(contract_bytes).hexdigest(),
            "positiveSupplierRows": [row["sourceRow"] for row in positive],
            "negativeAmountTotalUnchanged": True,
            "ledgerRows": [row["sourceRow"] for row in observed_ledger]}


if __name__ == "__main__":
    print(json.dumps(check(), indent=2))
