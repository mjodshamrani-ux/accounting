"""Independent Excel output verifier: stdlib ZIP/XML + Decimal, no ExcelJS or engine code."""
from pathlib import Path
from zipfile import ZipFile
import xml.etree.ElementTree as ET
from decimal import Decimal
from datetime import date
import json

root = Path('audit/stress/workbooks')
ns = {'x': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
cases = json.loads((root / 'manifest.json').read_text())
checks = date_checks = formula_checks = 0
visible = ['Summary', 'Matches', 'Needs Review', 'Unmatched', 'Reconciliation Bridge', 'Review Sign-off']
for case in cases:
    with ZipFile(root / case['name']) as z:
        assert z.testzip() is None
        assert not any('externalLinks/' in name or 'vbaProject' in name for name in z.namelist())
        shared = ET.fromstring(z.read('xl/sharedStrings.xml'))
        strings = [''.join(el.itertext()) for el in shared]
        assert case['description'] in strings
        assert '@SUM(A1:A2)' in strings
        book = ET.fromstring(z.read('xl/workbook.xml'))
        rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
        targets = {r.attrib['Id']: r.attrib['Target'] for r in rels}
        styles = ET.fromstring(z.read('xl/styles.xml'))
        formats = {int(f.attrib['numFmtId']): f.attrib['formatCode'] for f in styles.findall('x:numFmts/x:numFmt', ns)}
        formats.update({3: '#,##0', 4: '#,##0.00'})
        cell_styles = styles.find('x:cellXfs', ns)
        sheets = {}
        states = {}
        for sh in book.find('x:sheets', ns):
            target = targets[sh.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']]
            path = target.lstrip('/') if target.startswith('/') else 'xl/' + target
            sheets[sh.attrib['name']] = ET.fromstring(z.read(path))
            states[sh.attrib['name']] = sh.attrib.get('state', 'visible')
        assert list(sheets)[:6] == visible
        assert [name for name, state in states.items() if state == 'visible'] == visible
        assert all(state == 'hidden' for name, state in states.items() if name not in visible)

        def rows(name):
            return [{c.attrib['r'].rstrip('0123456789'): c for c in row} for row in sheets[name].findall('.//x:sheetData/x:row', ns)]

        def text(cell):
            value = cell.find('x:v', ns)
            if value is None:
                return ''
            return strings[int(value.text)] if cell.attrib.get('t') == 's' else value.text

        def number(cell, money=False):
            assert cell.attrib.get('t', 'n') == 'n'
            if money:
                fmt = int(cell_styles[int(cell.attrib.get('s', '0'))].attrib['numFmtId'])
                assert formats[fmt] == '#,##0' + ('.' + '0' * case['decimals'] if case['decimals'] else '')
            return Decimal(cell.find('x:v', ns).text)

        def native_date(cell):
            global date_checks
            fmt = int(cell_styles[int(cell.attrib.get('s', '0'))].attrib['numFmtId'])
            assert formats[fmt] == 'yyyy-mm-dd'
            assert number(cell) == (date.fromisoformat(case['date']) - date(1899, 12, 30)).days
            date_checks += 1

        # Every case membership retains the original transaction ID and amount.
        # This binds the new case IDs in Unmatched to the independent source oracle.
        evidence = {}
        source_ids = set()
        original = {r['id']: Decimal(r['minor']) for name in ['Supplier transactions', 'Ledger transactions'] for r in case['expected'][name]}
        for row in rows('Match Evidence')[1:]:
            case_id, source_id = text(row['A']), text(row['G'])
            assert source_id not in source_ids
            source_ids.add(source_id)
            evidence.setdefault(case_id, []).append(source_id)
            assert number(row['S'], True) * Decimal(10) ** case['decimals'] == original[source_id]
            native_date(row['K'])
        assert source_ids == set(original)
        observed = set()
        for name, expected_rows in case['expected'].items():
            observed.add(name)
            found = {}
            for row in rows(name)[1:]:
                if name == 'Unmatched':
                    members = evidence[text(row['A'])]
                    assert len(members) == 1
                    ident = members[0]
                    assert text(row['B']) == ident.split(':')[0]
                    native_date(row['C'])
                else:
                    ident = text(row['A'])
                    native_date(row['D'])
                assert ident not in found, ('duplicate exported id', ident)
                found[ident] = number(row['H'], True) * Decimal(10) ** case['decimals']
            expected = {r['id']: Decimal(r['minor']) for r in expected_rows}
            assert found == expected, (case['name'], name, found, expected)
            checks += len(found)
        assert observed == set(case['expected'])

        # Source content is never executable. The only formulas allowed in this
        # unchanged corpus are the exact deterministic count and bridge totals.
        counts = case['counts']
        me = max(2, counts['autoMatchedCases'] + counts['manualMatches'] + 1)
        re = max(2, counts['needsReviewCases'] + counts['rejectedCandidates'] + 1)
        ue = max(2, counts['unmatchedCases'] + 1)
        expected_summary = {
            'Auto Matched Cases': (f'COUNTIF(\'Matches\'!Q2:Q{me},"Auto")', counts['autoMatchedCases']),
            'Matched Source Rows': (f"SUM('Matches'!O2:P{me})", counts['matchedSourceRows']),
            'Needs Review Cases': (f'COUNTIF(\'Needs Review\'!M2:M{re},"Needs Review")', counts['needsReviewCases']),
            'Needs Review Source Rows': (f'SUMIF(\'Needs Review\'!M2:M{re},"Needs Review",\'Needs Review\'!N2:N{re})+SUMIF(\'Needs Review\'!M2:M{re},"Needs Review",\'Needs Review\'!O2:O{re})', counts['needsReviewSourceRows']),
            'Unmatched Cases': (f"COUNTA('Unmatched'!A2:A{ue})", counts['unmatchedCases']),
            'Unmatched Source Rows': (f"SUM('Unmatched'!K2:K{ue})", counts['unmatchedSourceRows']),
            'Manual Matches': (f'COUNTIF(\'Matches\'!Q2:Q{me},"Manual")', counts['manualMatches']),
            'Rejected Candidates': (f'COUNTIF(\'Needs Review\'!M2:M{re},"Rejected")', counts['rejectedCandidates']),
            'Net Bridge Adjustments': ("'Reconciliation Bridge'!E5", 0),
        }
        allowed = {}
        for row in rows('Summary')[1:]:
            label = text(row['A'])
            if label in expected_summary:
                expression, expected_value = expected_summary[label]
                assert row['B'].find('x:f', ns).text == expression
                assert number(row['B']) == expected_value
                allowed[('Summary', row['B'].attrib['r'])] = expression
        assert len(allowed) == len(expected_summary)
        bridge = rows('Reconciliation Bridge')
        effects = [row for row in bridge[1:] if 'A' in row and text(row['A']) in evidence]
        assert len(effects) == 2
        for row in effects:
            source_id, = evidence[text(row['A'])]
            effect = original[source_id] * (-1 if source_id.startswith('supplier:') else 1)
            assert number(row['E'], True) * Decimal(10) ** case['decimals'] == effect
        allowed[('Reconciliation Bridge', 'E5')] = 'SUM(E2:E3)'
        seen = set()
        for name, sheet in sheets.items():
            for cell in sheet.findall('.//x:c', ns):
                assert cell.attrib.get('t') != 'e', (name, cell.attrib['r'])
                expression = cell.find('x:f', ns)
                if expression is not None:
                    key = (name, cell.attrib['r'])
                    assert key in allowed and expression.text == allowed[key], ('unexpected executable formula', key)
                    if name == 'Reconciliation Bridge':
                        assert number(cell, True) == 0
                    seen.add(key)
                    formula_checks += 1
        assert seen == set(allowed)
print(json.dumps({'workbooks': len(cases), 'numeric_cells_verified_exactly': checks, 'native_dates_verified': date_checks, 'decimal_formats': 'pass', 'engine_formula_cells_verified': formula_checks, 'untrusted_formula_cells': 0, 'zip_crc': 'pass', 'xml_parse': 'pass', 'bilingual_text': 'pass', 'verifier': 'Python stdlib ZIP/XML/Decimal; independent of ExcelJS'}, indent=2))
