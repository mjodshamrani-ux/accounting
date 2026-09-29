"""Verify actual browser XLSX against literal CSV + authored whole-group sets.
Stdlib only: no engine, ExcelJS or spreadsheet writer code is imported.
"""
import csv
import hashlib
import json
import sys
from datetime import date
from decimal import Decimal
from pathlib import Path
from zipfile import ZipFile
import xml.etree.ElementTree as ET

root = Path(sys.argv[1])
out = Path(sys.argv[2])
assert not out.exists(), 'Never overwrite validation evidence'
ns = {'x': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
relationships = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'
def member_set(a, b):
    return tuple(sorted([f'supplier:0:{r}' for r in a] + [f'ledger:0:{r}' for r in b]))
group = [member_set([2, 3], [2, 3])]
invoice = [member_set([2], [3, 4]), member_set([3], [2])]
numeric = [member_set([2, 3], [2, 3, 4]), member_set([4, 5], [5])]
cases = [
    ('matched', 'group', group), ('restored-matched', 'group', group),
    ('unlinked', 'group', []), ('restored-rejection', 'group', []),
    ('competing', 'competing', []), ('invoice', 'invoice', invoice),
    ('invoice-vouchers', 'invoice-vouchers', invoice),
    ('numeric-receipts', 'numericReceipts', numeric),
    ('restored-numeric-receipts', 'numericReceipts', numeric),
]
results = []
for workbook, source, expected_groups in cases:
    expected = {}
    for side in ['supplier', 'ledger']:
        with (root / f'{source}-{side}.csv').open(newline='') as f:
            for rn, row in enumerate(csv.DictReader(f), 2):
                expected[f'{side}:0:{rn}'] = row
    wb = root / f'{workbook}.xlsx'
    with ZipFile(wb) as z:
        assert z.testzip() is None
        assert not any('externalLinks/' in n or 'vbaProject' in n for n in z.namelist())
        strings = [''.join(e.itertext()) for e in ET.fromstring(z.read('xl/sharedStrings.xml'))]
        def text(cell):
            v = cell.find('x:v', ns)
            if v is None: return ''
            return strings[int(v.text)] if cell.get('t') == 's' else v.text
        def number(cell):
            assert cell.get('t', 'n') == 'n'
            assert cell.find('x:f', ns) is None
            return Decimal(text(cell))
        rels = {e.get('Id'): e.get('Target') for e in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
        sheets = {}
        for sh in ET.fromstring(z.read('xl/workbook.xml')).find('x:sheets', ns):
            target = rels[sh.get(relationships)]
            name = target.lstrip('/') if target.startswith('/') else 'xl/' + target
            sheets[sh.get('name')] = ET.fromstring(z.read(name))
        def rows(sheet):
            return [{c.get('r').rstrip('0123456789'): c for c in r} for r in sheets[sheet].findall('.//x:sheetData/x:row', ns)]
        evidence = rows('Match Evidence')[1:]
        seen, members, totals = set(), {}, {}
        for row in evidence:
            assert all(c.find('x:f', ns) is None for c in row.values())
            sid = text(row['G']); cid = text(row['A'])
            assert sid in expected and sid not in seen
            seen.add(sid)
            original = expected[sid]
            assert number(row['S']) == Decimal(original['Amount'])
            assert text(row['R']) == original['Currency']
            assert number(row['K']) == (date.fromisoformat(original['Date']) - date(1899, 12, 30)).days
            for column, header in [('M', 'Document No'), ('N', 'Voucher No'), ('O', 'PO'), ('P', 'Bank Reference'), ('Q', 'Receipt No')]:
                expected_text = original[header]
                # These authored Payment fixtures have a PAY-labelled document
                # number. Existing normalized audit fields retain that literal
                # document number as a receipt fallback when Receipt No is
                # empty. It is not an explicitly stated receipt identity.
                if header == 'Receipt No' and not expected_text and original['Type'] == 'Payment':
                    assert '-PAY-' in original['Document No']
                    expected_text = original['Document No']
                assert text(row[column]) == expected_text, (workbook, sid, header)
                if expected_text: assert row[column].get('t') == 's', 'Identifiers must remain text'
            if text(row['C']) == 'Matched':
                members.setdefault(cid, []).append(sid)
                by_side = totals.setdefault(cid, {'supplier': Decimal(0), 'ledger': Decimal(0)})
                by_side[sid.split(':')[0]] += Decimal(original['Amount'])
        assert seen == set(expected), (workbook, 'Lost or duplicated source row')
        assert sorted(tuple(sorted(ids)) for ids in members.values()) == sorted(expected_groups), workbook
        matches = rows('Matches')[1:]
        assert len(matches) == len(expected_groups)
        for row in matches:
            cid = text(row['A']); ids = members[cid]
            a = sum(s.startswith('supplier:') for s in ids)
            b = sum(s.startswith('ledger:') for s in ids)
            expected_type = 'N:M' if a > 1 and b > 1 else '1:1' if a == b == 1 else '1:M' if a == 1 else 'M:1'
            assert text(row['B']) == expected_type
            assert number(row['E']) == totals[cid]['supplier'] == totals[cid]['ledger'] == number(row['H'])
        results.append({'file': wb.name, 'sha256': hashlib.sha256(wb.read_bytes()).hexdigest(), 'sourceRows': len(seen), 'approvedGroups': len(matches), 'passed': True})
report = {'verifier': 'Python stdlib ZIP/XML/CSV/Decimal, independent of engine and ExcelJS', 'auditFieldNote': 'Blank Receipt No in PAY-document fixtures retains the original Document No as a normalized display fallback, not positive explicit receipt proof. Initial verifier incorrectly expected that normalized field to stay blank; only this expectation changed, not the engine or workbooks.', 'workbooks': len(results), 'sourceRowsVerified': sum(r['sourceRows'] for r in results), 'allPassed': True, 'results': results}
out.write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
