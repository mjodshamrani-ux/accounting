"""CLR-1 holdout H1: a hotel group's guest-deposit clearing account, one
extract per story, from a lineage that imports nothing from the foundation,
and the intent written by hand: every group with its member rows, its status
and every reason it is not cleared, every faulty line with its code, and the
blank lines. Nets are the story's own arithmetic.

    python3 -B audit/clearing-groups-holdout-h1/stories.py > frozen/stories.json
"""
import json
import sys

HEADER = ["Voucher", "Clearing Document", "Value date", "Amount", "GL", "Currency", "Remarks"]
SPLIT_HEADER = ["Voucher", "Clearing Document", "Value date", "Debit", "Credit", "GL", "Currency", "Remarks"]
PLACES = {"SAR": 2, "KWD": 3}
U, C, D, G, M, V, R = ("UNISOLATED_ERROR", "CONNECTED_ERROR", "DUPLICATE_MEMBER", "GROUP_LIMIT",
                       "MISSING_REFERENCE", "UNVERIFIED_REFERENCE_ROLE", "RESIDUAL")


class Account:
    def __init__(self, sid, title, writer, currency="SAR", header=None, split=False, comma=","):
        self.id, self.title, self.writer, self.comma = sid, title, writer, comma
        self.places = PLACES[currency]
        self.split = split
        self.scope = {"entity": "Synthetic Hotel Group LLC", "ledger": "HTL-2027", "account": "2430",
                      "currency": currency, "start": "2027-11-01", "end": "2027-11-30", "confirmed": True}
        cols = ["posting", "reference", "date"] + (["debit", "credit"] if split else ["amount"]) + \
               ["account", "currency", "description"]
        self.reading = {"sheet": 0, "header": 0, "posting": -1, "reference": -1, "date": -1, "amount": -1,
                        "debit": -1, "credit": -1, "account": -1, "currency": -1, "description": -1,
                        "mode": "split" if split else "signed"}
        for i, c in enumerate(cols):
            self.reading[c] = i
        self.cells = [list(header or (SPLIT_HEADER if split else HEADER))]
        self.hidden, self.formulas = [], []
        self.minor = {}
        self.groups, self.errors, self.blank = [], [], []

    def text(self, minor):
        sign, n = ("-", -minor) if minor < 0 else ("", minor)
        return f"{sign}{n // 10 ** self.places}.{n % 10 ** self.places:0{self.places}d}"

    def line(self, voucher, doc, day, minor, remarks="Folio", gl="2430", currency=None, date=None, amount=None):
        when = date or f"2027-11-{day:02d}"
        cur = currency or self.scope["currency"]
        if self.split:
            debit = self.text(minor) if minor > 0 else self.text(0)
            credit = self.text(-minor) if minor < 0 else self.text(0)
            self.cells.append([voucher, doc, when, debit, credit, gl, cur, remarks])
        else:
            self.cells.append([voucher, doc, when, amount if amount is not None else self.text(minor), gl, cur,
                               remarks])
        self.minor[len(self.cells)] = minor
        return len(self.cells)

    def raw(self, cells):
        self.cells.append(list(cells))
        return len(self.cells)

    def group(self, doc, rows, reasons=()):
        net = sum(self.minor[r] for r in rows)
        self.groups.append([doc, list(rows), net, "review" if reasons else "cleared", list(reasons)])
        return self

    def error(self, row, code):
        self.errors.append([row, code])
        return self

    def to_json(self):
        xlsx = self.writer == "lo-xlsx"
        return {"id": self.id, "title": self.title, "writer": self.writer, "comma": self.comma,
                "name": f"{self.id}.{'xlsx' if xlsx else 'csv'}", "reading": self.reading, "scope": self.scope,
                "cells": self.cells, "hidden": self.hidden, "formulas": self.formulas,
                "intent": {"refused": None, "groups": self.groups, "errors": self.errors, "blank": self.blank}}


def stories():
    out = []
    a = Account("H01", "a deposit settled by two folio charges", "php")
    rows = [a.line("V101", "DEP-101", 2, 150000, "Group deposit"), a.line("V102", "DEP-101", 5, -90000),
            a.line("V103", "DEP-101", 6, -60000)]
    a.group("DEP-101", rows); out.append(a)

    a = Account("H02", "a semicolon export, a refund that leaves a remainder", "go", comma=";")
    x = [a.line("V201", "DEP-201", 3, 80000, "Deposit, room 4"), a.line("V202", "DEP-201", 4, -80000)]
    y = [a.line("V203", "DEP-202", 4, 25000), a.line("V204", "DEP-202", 7, -20000, "Refund, partial")]
    a.group("DEP-201", x).group("DEP-202", y, [R]); out.append(a)

    a = Account("H03", "a faulty line names the document only in its remarks", "java")
    x = [a.line("V301", "DEP-301", 2, 30000), a.line("V302", "DEP-301", 3, -30000)]
    f = a.line("V309", "DEP-399", 3, 0, "see DEP-301", amount="n/a")
    a.error(f, "AMOUNT_FORMAT").group("DEP-301", x); out.append(a)

    a = Account("H04", "a faulty line names the document in lower case", "java")
    x = [a.line("V401", "DEP-401", 2, 12000), a.line("V402", "DEP-401", 3, -12000)]
    f = a.line("V409", "dep-401", 3, 0, amount="?")
    a.error(f, "AMOUNT_FORMAT").group("DEP-401", x); out.append(a)

    a = Account("H05", "a document with spaces around it is the same document", "php")
    x = [a.line("V501", " DEP-501 ", 2, 70000), a.line("V502", "DEP-501", 9, -70000)]
    a.group("DEP-501", x); out.append(a)

    a = Account("H06", "Arabic-Indic digits in a date and an amount", "perl")
    x = [a.line("V601", "DEP-601", 0, 45000, date="\u0662\u0660\u0662\u0667-\u0661\u0661-\u0660\u0663",
                amount="\u0664\u0665\u0660\u066b\u0660\u0660"),
         a.line("V602", "DEP-601", 4, -45000)]
    a.group("DEP-601", x); out.append(a)

    a = Account("H07", "a subtotal line", "calc")
    x = [a.line("V701", "DEP-701", 2, 5000), a.line("V702", "DEP-701", 3, -5000)]
    f = a.raw(["", "Subtotal", "", "0.00", "2430", "SAR", ""])
    a.error(f, "POSTING").group("DEP-701", x, [U]); out.append(a)

    a = Account("H08", "an opening balance line at the top", "calc")
    f = a.raw(["", "", "", "1200.00", "2430", "SAR", "Balance b/f"])
    x = [a.line("V801", "DEP-801", 2, 5000), a.line("V802", "DEP-801", 3, -5000)]
    a.error(f, "POSTING").group("DEP-801", x, [U]); out.append(a)

    a = Account("H09", "a deposit, a credit note and a payment", "go")
    x = [a.line("V901", "DEP-901", 2, 100000, "Invoice"), a.line("V902", "DEP-901", 8, -20000, "Credit note"),
         a.line("V903", "DEP-901", 9, -80000, "Payment")]
    a.group("DEP-901", x); out.append(a)

    a = Account("H10", "one hundred lines in one document and one hundred and one in another", "php")
    x = [a.line("VA00", "DEP-A", 1, 9900)] + [a.line(f"VA{k:02d}", "DEP-A", 1 + k % 28, -100) for k in range(1, 100)]
    y = [a.line("VB00", "DEP-B", 1, 10000)] + [a.line(f"VB{k:03d}", "DEP-B", 1 + k % 28, -100) for k in range(1, 101)]
    a.group("DEP-A", x).group("DEP-B", y, [G]); out.append(a)

    a = Account("H11", "DEP-11 and DEP-011 are two documents", "java")
    x = [a.line("V111", "DEP-11", 2, 500), a.line("V112", "DEP-11", 3, -500)]
    y = [a.line("V113", "DEP-011", 3, 700)]
    a.group("DEP-11", x).group("DEP-011", y, [R]); out.append(a)

    a = Account("H12", "dinars to three places, and one amount with four", "perl", currency="KWD")
    x = [a.line("V121", "DEP-121", 2, 12345), a.line("V122", "DEP-121", 3, -12345)]
    y = [a.line("V123", "DEP-122", 3, 1000)]
    f = a.line("V124", "DEP-122", 4, 0, amount="-1.2345")
    a.error(f, "AMOUNT_FORMAT").group("DEP-121", x).group("DEP-122", y, [C, R]); out.append(a)

    a = Account("H13", "debit and credit columns, and a line of nothing", "perl", split=True)
    x = [a.line("V131", "DEP-131", 2, 30000), a.line("V132", "DEP-131", 3, -30000),
         a.line("V133", "DEP-131", 3, 0, "Nothing to post")]
    a.group("DEP-131", x); out.append(a)

    a = Account("H14", "an XLSX extract with a hidden line", "lo-xlsx")
    x = [a.line("V141", "DEP-141", 2, 6000), a.line("V142", "DEP-141", 3, -6000)]
    f = a.line("V149", "DEP-149", 3, 1000, "Hidden adjustment")
    a.hidden.append(f)
    a.error(f, "CELL").group("DEP-141", x, [U]); out.append(a)

    a = Account("H15", "an XLSX extract with a formula in the remarks of a line", "lo-xlsx")
    x = [a.line("V151", "DEP-151", 2, 8000), a.line("V152", "DEP-151", 3, -8000)]
    f = a.line("V159", "DEP-159", 3, 500, "latefee")
    a.formulas.append([f, 7, '="late"&"fee"'])
    a.error(f, "CELL").group("DEP-151", x, [U]); out.append(a)

    a = Account("H16", "an XLSX extract, a date that is not in the calendar", "lo-xlsx")
    x = [a.line("V161", "DEP-161", 2, 4000), a.line("V162", "DEP-161", 3, -4000)]
    f = a.line("V163", "DEP-161", 0, 100, "Minibar", date="2027-11-31")
    y = [a.line("V164", "DEP-162", 4, 3000), a.line("V165", "DEP-162", 5, -3000)]
    a.error(f, "DATE").group("DEP-161", x, [C]).group("DEP-162", y); out.append(a)

    a = Account("H17", "remarks that differ by a trailing space are two lines", "php")
    x = [a.line("V171", "DEP-171", 2, 30000, "Room 12"), a.line("V171", "DEP-171", 2, 30000, "Room 12 "),
         a.line("V172", "DEP-171", 3, -60000)]
    a.group("DEP-171", x); out.append(a)

    a = Account("H18", "one settlement voucher with lines in three documents", "go")
    d = [a.line(f"V18{k}", f"DEP-18{k}", 2, 10000 * k) for k in (1, 2, 3)]
    s = [a.line("V-SET", f"DEP-18{k}", 9, -10000 * k, f"Settlement line {k}") for k in (1, 2, 3)]
    for k in range(3):
        a.group(f"DEP-18{k + 1}", [d[k], s[k]])
    out.append(a)

    a = Account("H19", "a late October line under a November document", "php")
    x = [a.line("V191", "DEP-191", 2, 50000), a.line("V192", "DEP-191", 3, -50000)]
    f = a.line("V193", "DEP-191", 0, 50000, date="2027-10-31")
    y = [a.line("V194", "DEP-192", 4, 1000), a.line("V195", "DEP-192", 5, -1000)]
    a.error(f, "PERIOD").group("DEP-191", x, [C]).group("DEP-192", y); out.append(a)

    a = Account("H20", "Arabic headings, and a dollar line under a document", "java",
                header=["رقم القيد",
                        "رقم المقاصة",
                        "التاريخ", "المبلغ",
                        "الحساب", "العملة",
                        "البيان"])
    x = [a.line("V201", "MQ-201", 2, 9000), a.line("V202", "MQ-201", 3, -9000)]
    f = a.line("V203", "MQ-201", 3, -9000, currency="USD")
    y = [a.line("V204", "MQ-202", 4, 1500), a.line("V205", "MQ-202", 5, -1500)]
    a.error(f, "ROW_SCOPE").group("MQ-201", x, [C]).group("MQ-202", y); out.append(a)

    a = Account("H21", "only the headings", "calc")
    out.append(a)

    a = Account("H22", "a faulty line past the last heading, and a blank line", "go")
    x = [a.line("V221", "DEP-221", 2, 500), a.line("V222", "DEP-221", 3, -500)]
    a.blank.append(a.raw([""] * 7))
    f = a.raw(["V229", "DEP-299", "2027-11-04", "bad", "2430", "SAR", "Note", "extra"])
    a.error(f, "AMOUNT_FORMAT").group("DEP-221", x, [U]); out.append(a)

    a = Account("H23", "a voucher that reads like a formula", "php")
    x = [a.line("V231", "DEP-231", 2, 2000), a.line("V232", "DEP-231", 3, -2000)]
    f = a.line("=V239", "DEP-231", 3, 1000)
    a.error(f, "IDENTITY").group("DEP-231", x, [C]); out.append(a)

    a = Account("H24", "a folio charge exported twice", "java")
    x = [a.line("V241", "DEP-241", 2, 60000, "Deposit"), a.line("V242", "DEP-241", 3, -30000, "Room 7"),
         a.line("V242", "DEP-241", 3, -30000, "Room 7")]
    y = [a.line("V243", "DEP-242", 4, 2000), a.line("V244", "DEP-242", 4, -2000)]
    a.group("DEP-241", x, [D]).group("DEP-242", y); out.append(a)

    a = Account("H25", "a tab export, and a line with no document", "go", comma="\t")
    x = [a.line("V251", "DEP-251", 2, 7000), a.line("V252", "DEP-251", 3, -7000)]
    n = a.line("V253", "", 3, -1500, "Unallocated")
    a.group("DEP-251", x).group("", [n], [M, R]); out.append(a)

    a = Account("H26", "the documents under an Assignment heading", "php",
                header=["Voucher", "Assignment", "Value date", "Amount", "GL", "Currency", "Remarks"])
    x = [a.line("V261", "DEP-261", 2, 4000), a.line("V262", "DEP-261", 3, -4000)]
    y = [a.line("V263", "DEP-262", 3, 900)]
    a.group("DEP-261", x, [V]).group("DEP-262", y, [V, R]); out.append(a)

    a = Account("H27", "debit and credit columns, and a line with both", "calc", split=True)
    x = [a.line("V271", "DEP-271", 2, 11000), a.line("V272", "DEP-271", 3, -11000)]
    f = a.raw(["V273", "DEP-271", "2027-11-03", "100.00", "40.00", "2430", "SAR", "Folio"])
    y = [a.line("V274", "DEP-272", 4, 2500), a.line("V275", "DEP-272", 5, -2500)]
    a.error(f, "SPLIT").group("DEP-271", x, [C]).group("DEP-272", y); out.append(a)
    return out


if __name__ == "__main__":
    json.dump({"schema": "tarasuf-clr1-h1-stories/1", "stories": [s.to_json() for s in stories()]},
              sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
