"""Independent Decimal, archive and OOXML proof. No product imports."""
import argparse
import base64
import csv
from decimal import Decimal
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET
import zipfile

spec = importlib.util.spec_from_file_location('ooxml_only', Path(__file__).with_name('check-split-section-exports.py'))
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)
HEADER = ['Seq', 'Date', 'Reference', 'Description', 'Debit', 'Credit', 'Balance']


def sha(data):
    return hashlib.sha256(data).hexdigest()


def minor(text):
    assert re.fullmatch(r'-?[0-9]+(?:\.[0-9]{1,2})?', text), text
    value = Decimal(text) * 100
    assert value == value.to_integral_value()
    return int(value)


def inventory(facts):
    return [(p + 1, values) for p, rows in enumerate(facts['pages']) for values in rows]


def proof(e, facts, rows):
    assert e['sourceHash'] == facts['sourceSha256']
    assert e['sheet'] == 1
    page, values = rows[e['row'] - 1]
    assert e['page'] == page
    text = values[e['column'] - 1]
    assert e['literal'] == e['cellText'] == text
    units = text.encode('utf-16-le')
    lo, hi = e['spanStartInclusive'], e['spanEndExclusive']
    assert 0 <= lo <= hi <= len(units) // 2
    assert e['spanText'] == units[2 * lo:2 * hi].decode('utf-16-le')


def source_controls(rows):
    """Derive control membership and values from source roles, independently."""
    controls = []
    movements = []
    page_moves = []
    section_moves = []
    current_page = 0
    opening = previous = carried = None
    opening_row = previous_row = carry_row = None
    for rn, (page, values) in enumerate(rows, 1):
        if page != current_page:
            current_page = page
            page_moves = []
        label = values[0]
        role = None
        c = {'originalRow': rn, 'page': page, 'providedMinor': None, 'expectedMinor': None, 'differenceMinor': None}
        if label == 'Opening balance':
            opening = previous = minor(values[6])
            opening_row = previous_row = rn
            role = 'opening'
            c.update(providedMinor=str(opening), expectedMinor=str(opening), differenceMinor='0')
            members = []
        elif label.startswith('Invoice: '):
            section_moves = []
        elif re.fullmatch(r'[1-9][0-9]*', label):
            movements.append((rn, values))
            page_moves.append((rn, values))
            section_moves.append((rn, values))
            previous, previous_row = minor(values[6]), rn
        elif label in ['Carried balance', 'Brought balance', 'Closing balance']:
            role = {'Carried balance': 'carried', 'Brought balance': 'brought', 'Closing balance': 'closing'}[label]
            reference = carried if role == 'brought' else previous
            reference_row = carry_row if role == 'brought' else previous_row
            supplied = minor(values[6])
            assert supplied == reference
            c.update(providedMinor=str(supplied), expectedMinor=str(reference), differenceMinor='0')
            members = [(reference_row, 7)]
            if role == 'carried':
                carried, carry_row = supplied, rn
            if role == 'brought':
                previous, previous_row = supplied, rn
        elif label.startswith('Section total: ') or label in ['Page total', 'Statement total']:
            role = 'section-total' if label.startswith('Section total: ') else ('page-total' if label == 'Page total' else 'statement-total')
            selected = section_moves if role == 'section-total' else (page_moves if role == 'page-total' else movements)
            d = sum(minor(v[4]) for _, v in selected)
            cr = sum(minor(v[5]) for _, v in selected)
            assert (minor(values[4]), minor(values[5])) == (d, cr)
            c.update(debitProvidedMinor=str(d), creditProvidedMinor=str(cr), debitExpectedMinor=str(d), creditExpectedMinor=str(cr), debitDifferenceMinor='0', creditDifferenceMinor='0')
            members = [(r, col) for r, _ in selected for col in [5, 6]]
        elif label.startswith('Page count: ') or label.startswith('Statement count: '):
            role = 'page-count' if label.startswith('Page count: ') else 'statement-count'
            selected = page_moves if role == 'page-count' else movements
            n = len(selected)
            assert int(label.split(': ')[1]) == n
            c.update(providedMinor=str(n), expectedMinor=str(n), differenceMinor='0')
            members = [(r, 1) for r, _ in selected]
        if role:
            c.update(role=role, members=members)
            controls.append(c)
            if role == 'closing':
                computed = opening + sum(minor(v[4]) - minor(v[5]) for _, v in movements)
                assert computed == minor(values[6])
                controls.append({'originalRow': rn, 'page': page, 'role': 'closing-global', 'providedMinor': str(minor(values[6])), 'expectedMinor': str(computed), 'differenceMinor': '0', 'members': [(opening_row, 7)] + [(r, col) for r, _ in movements for col in [5, 6]]})
    return controls


def check_case(directory, output):
    facts = json.loads((directory / 'facts.json').read_text())
    target = output / directory.name
    pdf = (directory / 'source.pdf').read_bytes()
    expected_csv = (directory / 'expected.csv').read_bytes()
    assert sha(pdf) == facts['sourceSha256']
    assert (target / 'derived.csv').read_bytes() == expected_csv
    assert (target / 'original.pdf').read_bytes() == pdf
    rows = inventory(facts)
    source_moves = [(r + 1, p, v) for r, (p, v) in enumerate(rows) if re.fullmatch(r'[1-9][0-9]*', v[0])]
    assert len(source_moves) == facts['expected']['count']
    expected = list(csv.reader(io.StringIO(expected_csv.decode(), newline='')))
    assert expected[0] == HEADER
    previous = facts['expected']['openingMinor']
    debit = credit = 0
    expected_steps = []
    for i, (row, page, values) in enumerate(source_moves):
        d, c, b = minor(values[4]), minor(values[5]), minor(values[6])
        assert not (d > 0 and c > 0)
        computed = previous + d - c
        assert b == computed
        assert values[0] == str(i + 1)
        literal = values[:]
        literal[2] = facts['expected']['references'][i]
        assert expected[i + 1] == literal
        expected_steps.append((row, page, previous, d, c, b, computed, 0))
        previous = b
        debit += d
        credit += c
    assert (debit, credit, previous) == (facts['expected']['debitMinor'], facts['expected']['creditMinor'], facts['expected']['closingMinor'])
    archive = json.loads((target / 'archive.json').read_text())
    assert base64.b64decode(archive['pdf'], validate=True) == pdf
    assert base64.b64decode(archive['derived'], validate=True) == expected_csv
    artifact = archive['artifact']
    assert artifact['financialApproval'] is False and artifact['scopeConfirmed'] is False
    p = artifact['provenance']
    review = p['review']
    assert review['state'] == 'review-ready' and review['sourceVerified'] is True
    assert [(r['page'], r['values']) for r in review['rows']] == rows
    assert p['inventory'] == review['rows'] and p['steps'] == review['balanceSteps'] and p['controls'] == review['controls']
    assert review['openingMinor'] == str(facts['expected']['openingMinor'])
    assert review['closingMinor'] == str(previous)
    assert review['grossDebitMinor'] == str(debit) and review['grossCreditMinor'] == str(credit)
    assert review['netMinor'] == str(debit - credit)
    controls = source_controls(rows)
    assert len(controls) == len(review['controls'])
    for actual, truth in zip(review['controls'], controls, strict=True):
        for key, expected_value in truth.items():
            if key == 'members':
                assert [(e['row'], e['column']) for e in actual[key]] == expected_value
            else:
                assert actual[key] == expected_value, (directory.name, key, actual[key], expected_value)
    evidence_count = 0
    def walk(value):
        nonlocal evidence_count
        if isinstance(value, dict):
            if all(k in value for k in ('sourceHash', 'cellText', 'spanText', 'column')):
                proof(value, facts, rows)
                evidence_count += 1
            for item in value.values():
                walk(item)
        elif isinstance(value, list):
            for item in value:
                walk(item)
    walk(p)
    for actual, truth in zip(review['balanceSteps'], expected_steps, strict=True):
        assert tuple([actual['originalRow'], actual['page']] + [int(actual[k]) for k in ['previousProvidedMinor', 'debitProvidedMinor', 'creditProvidedMinor', 'nextProvidedMinor', 'computedMinor', 'differenceMinor']]) == truth
        assert actual['debitEvidence']['row'] == actual['creditEvidence']['row'] == actual['nextEvidence']['row'] == actual['originalRow']
        assert [actual[k]['column'] for k in ['debitEvidence', 'creditEvidence', 'nextEvidence']] == [5, 6, 7]
        assert actual['previousEvidence']['column'] == 7
        assert minor(actual['previousEvidence']['literal']) == int(actual['previousProvidedMinor'])
    workbook_checks = 0
    for name in ['direct.xlsx', 'restored.xlsx']:
        filename = target / name
        sheets, cells = reader.workbook_rows(filename)
        assert sheets['DerivedReading'] == expected
        actual_inventory = sheets['OriginalInventory'][1:]
        for actual, (row, (page, values)) in zip(actual_inventory, enumerate(rows, 1), strict=True):
            assert actual[0:2] == [str(row), str(page)]
            assert (actual[4:] + [''] * 7)[:7] == values
        for actual, truth in zip(sheets['BalanceSteps'][1:], expected_steps, strict=True):
            assert actual[:8] == [str(n) for n in truth]
        for actual in sheets['SourceCellEvidence'][1:]:
            e = dict(zip(['owner','role','sourceHash','extractionHash','extractionRevision','sheet','row','page','column','literal','cellText','spanStartInclusive','spanEndExclusive','spanText'], actual + [''] * 14))
            for key in ['sheet','row','page','column','spanStartInclusive','spanEndExclusive']:
                e[key] = int(e[key])
            proof(e, facts, rows)
        assert len(sheets['Controls']) - 1 == len(review['controls'])
        for actual, truth in zip(sheets['Controls'][1:], controls, strict=True):
            columns = ['originalRow', 'page', 'role', 'providedMinor', 'expectedMinor', 'differenceMinor', 'debitProvidedMinor', 'creditProvidedMinor', 'debitExpectedMinor', 'creditExpectedMinor', 'debitDifferenceMinor', 'creditDifferenceMinor']
            wanted = ['' if truth.get(key) is None else str(truth[key]) for key in columns] + [str(len(truth['members']))]
            assert (actual + [''] * 13)[:13] == wanted
        expected_members = []
        for control in review['controls']:
            for i, e in enumerate(control['members'], 1):
                expected_members.append([str(control['originalRow']), control['role'], str(i), str(e['sheet']), str(e['row']), str(e['page']), str(e['column']), e['literal'], e['cellText'], str(e['spanStartInclusive']), str(e['spanEndExclusive']), e['spanText']])
        actual_members = [(row + [''] * 12)[:12] for row in sheets['ControlMembers'][1:]]
        assert actual_members == expected_members
        encoded = ''.join(r[1] for r in sheets['OriginalPdf'][1:])
        assert base64.b64decode(encoded, validate=True) == pdf
        history = dict(sheets['ReviewHistory'][1:])
        assert history['FinancialApproval'] == 'false' and history['ScopeConfirmed'] == 'false'
        assert history['OriginalSha256'] == sha(pdf) and history['DerivedSha256'] == sha(expected_csv)
        with zipfile.ZipFile(filename) as z:
            assert not any('externalLinks' in n or 'vbaProject' in n for n in z.namelist())
            for n in z.namelist():
                if n.endswith('.rels'):
                    assert not any(r.get('TargetMode') == 'External' for r in ET.fromstring(z.read(n)))
        workbook_checks += cells
    return {'id': directory.name, 'passed': True, 'movements': len(source_moves), 'exactEvidenceOccurrences': evidence_count, 'literalWorkbookCells': workbook_checks, 'workbooks': 2}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('output', type=Path)
    parser.add_argument('--frozen', type=Path, default=Path('audit/running-balance/frozen'))
    args = parser.parse_args()
    cases = []
    for directory in sorted(args.frozen.iterdir()) + [args.frozen.parent / 'unicode']:
        if directory.is_dir() and json.loads((directory / 'facts.json').read_text())['accepted']:
            try:
                cases.append(check_case(directory, args.output))
            except Exception as error:
                cases.append({'id': directory.name, 'passed': False, 'error': str(error), 'type': type(error).__name__})
    report = {'checker': 'independent-Decimal-archive-ZIP-XML', 'productImports': False, 'passed': len(cases) == 9 and all(c['passed'] for c in cases), 'cases': cases}
    (args.output / 'INDEPENDENT-EXPORT-CHECK.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
