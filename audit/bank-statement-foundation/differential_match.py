"""Runs the oracle's matching (oracle.match) on cases given as JSON on stdin,
for the differential test of the product engine. Standard library only.

  stdin:  {"window": 3, "period": {...}, "cases": [{"bank": [...], "cash": [...]}]}
  stdout: [{"auto": [...], "review": [...], "bankOnly": [...], "cashOnly": [...], "timing": [...]}]

A bank row is a printed movement (key, date, valueDate, reference, withdrawal,
deposit in minor units). A cash row is a cashbook entry as oracle.cashbook()
returns it (voucher, date, reference trimmed, direction, amount as Decimal).
"""
import json
import sys
from decimal import Decimal

import oracle

data = json.load(sys.stdin)
out = []
for case in data['cases']:
    entries = [{'voucher': c['voucher'], 'date': c['date'], 'reference': c['reference'].strip(),
                'direction': c['direction'], 'amount': Decimal(c['amount'])} for c in case['cash']]
    out.append(oracle.match(case['bank'], entries, data['window'], data['period']))
json.dump(out, sys.stdout)
