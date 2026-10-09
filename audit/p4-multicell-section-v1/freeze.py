"""Independent pre-engine two-cell section truth. No product imports or outputs.

PDF text and expected movement membership/citations are manually specified.
CSV quoting uses Python csv; signed minor units use Decimal. Existing freeze
must never be regenerated in place.
"""
from pathlib import Path
from decimal import Decimal
import csv
import hashlib
import io
import json

ROOT = Path(__file__).parent / 'frozen'
if (ROOT / 'freeze.json').exists():
    raise SystemExit('Existing frozen evidence is immutable; use a new version directory.')
ROOT.mkdir(parents=True, exist_ok=True)
H = ['Date', 'Reference', 'Description', 'Amount']
P = lambda ref='INV-271', label='Invoice No': [label, ref, '', '']
C = lambda ref='INV-271', label='Continued invoice': [label, ref, '', '']
S = lambda ref='INV-271': ['', '', 'Invoice: ' + ref, '']
T = lambda ref='INV-271': ['', '', 'Continued invoice: ' + ref, '']
M = lambda desc='first line', ref='', amount='-12.50', date='2026-10-01': [date, ref, desc, amount]
# Each accepted movement explicitly names its independent source parent and all
# continuation/header rows. Column coordinates below are one-based.
cases = [
    ('pair-signed', [[H, P(), M('line, "one"'), M('second', amount='+2.50')]], [(3, 2, [], []), (4, 2, [], [])], 'derived'),
    ('pair-cross-page', [[H, P(), M()], [H, C(), M('second', amount='+2.50', date='2026-10-02')]], [(3, 2, [], []), (6, 2, [5], [4])], 'derived'),
    ('pair-colon-labels', [[H, P(label='Invoice Number:'), M()], [H, C(label='Continued invoice No:'), M('second', amount='+2.50')]], [(3, 2, [], []), (6, 2, [5], [4])], 'derived'),
    ('single-parent-pair-continuation', [[H, S(), M()], [H, C(), M('second', amount='+2.50')]], [(3, 2, [], []), (6, 2, [5], [4])], 'derived'),
    ('pair-parent-single-continuation', [[H, P(), M()], [H, T(), M('second', amount='+2.50')]], [(3, 2, [], []), (6, 2, [5], [4])], 'derived'),
    ('pair-columns-two-three', [[H, ['', 'Invoice No', 'INV-271', ''], M()]], [(3, 2, [], [])], 'derived'),
    ('explicit-own-reference', [[H, P(), M(ref='INV-271'), M('second', amount='+2.50')]], [(4, 2, [], [])], 'derived'),
    ('numeric-leading-zero-reference', [[H, P('000271'), M()]], [(3, 2, [], [])], 'derived'),
    ('maximum-reference-length', [[H, P('I' * 64), M()]], [(3, 2, [], [])], 'derived'),
    ('new-section', [[H, P('INV-271'), M(), P('INV-272'), M('second', amount='+2.50')]], [(3, 2, [], []), (5, 4, [], [])], 'derived'),
    ('unknown-role', [[H, P(label='Purchase Order'), M()]], [], 'blocked'),
    ('extra-occupied-cell', [[H, ['Invoice No', 'INV-271', 'memo', ''], M()]], [], 'blocked'),
    ('reversed-pair', [[H, ['INV-271', 'Invoice No', '', ''], M()]], [], 'blocked'),
    ('nonadjacent-pair', [[H, ['Invoice No', '', 'INV-271', ''], M()]], [], 'blocked'),
    ('amount-column-reference', [[H, ['', '', 'Invoice No', '000271'], M()]], [], 'blocked'),
    ('missing-value', [[H, ['Invoice No', '', '', ''], M()]], [], 'blocked'),
    ('duplicate-mixed-parent', [[H, P(), M(), S(), M('second')]], [], 'blocked'),
    ('competing-movement-reference', [[H, P(), M(), M('second', ref='INV-999')]], [], 'blocked'),
    ('missing-continuation', [[H, P(), M()], [H, M('second')]], [], 'blocked'),
    ('competing-continuation', [[H, P(), M()], [H, C('INV-999'), M('second')]], [], 'blocked'),
    ('missing-page-header', [[H, P(), M()], [C(), M('second')]], [], 'blocked'),
    ('changed-page-header', [[H, P(), M()], [['Date', 'Reference', 'Description', 'Balance'], C(), M('second')]], [], 'blocked'),
    ('intervening-unknown', [[H, P(), M()], [H, ['', '', 'unknown footer', ''], C(), M('second')]], [], 'blocked'),
    ('duplicate-continuation', [[H, P(), M()], [H, C(), C(), M('second')]], [], 'blocked'),
    ('missing-movement-date', [[H, P(), M(), M('second', date='')]], [], 'blocked'),
    ('late-corrupt-date', [[H, P(), M(), M('second', date='BROKEN')]], [], 'blocked'),
    ('late-corrupt-amount', [[H, P(), M(), M('second', amount='BROKEN')]], [], 'blocked'),
    ('invalid-reference-character', [[H, P('INV@271'), M()]], [], 'blocked'),
    ('overlong-reference', [[H, P('I' * 65), M()]], [], 'blocked'),
    ('native-empty-page-gap', [[H, P(), M()], [], [H, C(), M('second')]], [], 'native-import-blocked'),
]

def pdf(pages, step=20):
    objects = ['<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>']
    children = []
    for page in pages:
        number = len(objects) + 1
        children.append(number)
        commands = []
        for index, row in enumerate(page):
            for column, text in enumerate(row):
                escaped = text.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')
                # Long identity remains within its original column, rather than
                # introducing a crossing-token defect into the length case.
                font = 2 if len(text) > 35 else 5
                commands.append(f'BT /F1 {font} Tf 1 0 0 1 {[40,170,300,420][column]} {750-index*step} Tm ({escaped}) Tj ET')
        stream = '\n'.join(commands) + '\n'
        objects.extend([f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 3 0 R >> >> /Contents {number+1} 0 R >>', f'<< /Length {len(stream)} >>\nstream\n{stream}endstream'])
    objects[1] = f'<< /Type /Pages /Kids [{" ".join(str(number)+" 0 R" for number in children)}] /Count {len(children)} >>'
    result = '%PDF-1.7\n'
    offsets = []
    for index, obj in enumerate(objects):
        offsets.append(len(result))
        result += f'{index+1} 0 obj\n{obj}\nendobj\n'
    start = len(result)
    result += f'xref\n0 {len(objects)+1}\n0000000000 65535 f \n' + ''.join(f'{offset:010} 00000 n \n' for offset in offsets) + f'trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n'
    return result.encode('ascii')

def write_json(name, value):
    (ROOT / name).write_text(json.dumps(value, indent=2, ensure_ascii=True) + '\n')

def cells(inventory, row):
    original = inventory[row-1]
    return [{'row': row, 'page': original['page'], 'column': column+1, 'literal': text} for column, text in enumerate(original['values']) if text]

manifest = []
for name, pages, proposals, outcome in cases:
    original = pdf(pages)
    (ROOT / (name + '.pdf')).write_bytes(original)
    inventory = []
    for page, rows in enumerate(pages, 1):
        for row in rows:
            inventory.append({'row': len(inventory)+1, 'page': page, 'values': row})
    expected = {'outcome': outcome, 'originalSha256': hashlib.sha256(original).hexdigest(), 'originalByteLength': len(original), 'inventory': inventory, 'proposals': [], 'links': []}
    if outcome == 'native-import-blocked':
        expected['nativeIssueCode'] = 'PDF_NO_EXTRACTABLE_TEXT'
    if outcome == 'derived':
        for target, parent, continuations, headers in proposals:
            span = cells(inventory, parent)
            reference = span[-1]['literal'] if len(span) == 2 else span[0]['literal'].split(': ', 1)[1]
            expected['proposals'].append({'targetRow': target, 'reference': reference, 'parentCells': span, 'continuationCells': [cells(inventory, rn) for rn in continuations], 'headerCells': [cells(inventory, rn) for rn in headers]})
        by_target = {p['targetRow']: p for p in expected['proposals']}
        csv_rows = [H]
        for original_row in inventory:
            row = original_row['row']
            values = original_row['values']
            if not values[0].startswith('2026-'):
                continue
            reference = values[1] or by_target[row]['reference']
            csv_rows.append([values[0], reference, values[2], values[3]])
            expected['links'].append({'originalRow': row, 'page': original_row['page'], 'derivedRow': len(csv_rows), 'reference': reference, 'referenceOrigin': 'explicit-source-cell' if values[1] else 'accepted-section-proposal'})
        buffer = io.StringIO(newline='')
        csv.writer(buffer, lineterminator='\r\n').writerows(csv_rows)
        blob = buffer.getvalue().encode('utf-8')
        (ROOT / (name + '.csv')).write_bytes(blob)
        expected.update({'csvRows': csv_rows, 'csvSha256': hashlib.sha256(blob).hexdigest(), 'signedAmounts': [row[3] for row in csv_rows[1:]], 'amountMinor': [int(Decimal(row[3])*100) for row in csv_rows[1:]]})
    write_json(name + '.expected.json', expected)
    manifest.append({'id': name, 'original': name + '.pdf', 'expected': name + '.expected.json', 'outcome': outcome})

# Native three-page source for nontrivial row-walk yielding and cancellation.
large_pages = [[H, P()] + [M('row ' + str(index), amount='+2.50') for index in range(1, 91)]]
for start in [91, 181]:
    large_pages.append([H, C()] + [M('row ' + str(index), amount='+2.50') for index in range(start, start+90)])
large = pdf(large_pages, step=7)
(ROOT / 'resource-cancellation.pdf').write_bytes(large)
large_inventory = [{'row': page*92+index+1, 'page': page+1, 'values': row} for page, rows in enumerate(large_pages) for index, row in enumerate(rows)]
write_json('resource-cancellation.expected.json', {'originalSha256': hashlib.sha256(large).hexdigest(), 'inventory': large_inventory, 'pages': 3, 'rows': 276, 'movementRows': [item['row'] for item in large_inventory if item['values'][0].startswith('2026-')], 'signedAmountMinorEach': 250, 'totalMinor': 67500})

actions = [
    {'id': 'byte-budget', 'source': 'pair-signed.pdf', 'budget': {'maxOriginalBytes': 1}, 'expected': 'resource-blocked'},
    {'id': 'page-budget', 'source': 'pair-cross-page.pdf', 'budget': {'maxPages': 1}, 'expected': 'resource-blocked'},
    {'id': 'row-budget', 'source': 'pair-signed.pdf', 'budget': {'maxRows': 3}, 'expected': 'resource-blocked'},
    {'id': 'proposal-budget', 'source': 'pair-signed.pdf', 'budget': {'maxProposals': 1}, 'expected': 'resource-blocked'},
    {'id': 'citation-budget', 'source': 'pair-cross-page.pdf', 'budget': {'maxEvidenceCells': 1}, 'expected': 'resource-blocked'},
    {'id': 'invalid-budget', 'source': 'pair-signed.pdf', 'budget': {'maxRows': 20001}, 'expected': 'invalid-budget-blocked'},
    {'id': 'pre-aborted', 'source': 'pair-signed.pdf', 'cancel': 'before-inspect', 'expected': 'cancelled'},
    {'id': 'native-read-aborted', 'source': 'resource-cancellation.pdf', 'cancel': {'stage': 'pdf-read', 'completed': 1}, 'expected': 'cancelled-before-next-page'},
    {'id': 'row-walk-aborted', 'source': 'resource-cancellation.pdf', 'cancel': {'stage': 'section-rows', 'completed': 256}, 'expected': 'cancelled-before-publication'},
    {'id': 'replace-during-original-replay', 'source': 'resource-cancellation.pdf', 'change': 'replaceSource at pdf-read completed=1', 'expected': 'stale-generation-blocked-before-next-page'},
    {'id': 'reviewer-cleared-during-replay', 'source': 'resource-cancellation.pdf', 'change': 'updateReviewer empty label/rationale at pdf-read completed=1', 'expected': 'stale-generation-blocked-before-next-page'},
    {'id': 'cached-parent-value-tamper', 'source': 'pair-signed.pdf', 'change': {'row': 2, 'column': 2, 'literal': 'INV-999'}, 'expected': 'original-replay-blocked'},
    {'id': 'cached-parent-role-tamper', 'source': 'pair-signed.pdf', 'change': {'row': 2, 'column': 1, 'literal': 'Invoice Number'}, 'expected': 'original-replay-blocked'},
    {'id': 'cached-page-tamper', 'source': 'pair-cross-page.pdf', 'change': {'row': 5, 'page': 1}, 'expected': 'original-replay-blocked'},
    {'id': 'original-bytes-tamper', 'source': 'pair-signed.pdf', 'change': 'flip original byte without matching originalSha256', 'expected': 'original-rehash-blocked'},
    {'id': 'post-review-source-swap', 'source': 'pair-signed.pdf', 'change': 'replaceSource after owned receipt', 'expected': 'stale-receipt-blocked'},
    {'id': 'post-review-mapping-swap', 'source': 'pair-signed.pdf', 'change': 'change mapping.amount after owned receipt', 'expected': 'stale-receipt-blocked'},
    {'id': 'post-review-revision-swap', 'source': 'pair-signed.pdf', 'change': 'change extractionRevision after owned receipt', 'expected': 'stale-receipt-blocked'},
    {'id': 'proposal-span-tamper', 'source': 'pair-cross-page.pdf', 'change': 'change a role/value citation literal or column in saved review', 'expected': 'fresh-review-comparison-blocked'},
    {'id': 'receipt-clone', 'source': 'pair-signed.pdf', 'change': 'structuredClone or JSON reconstruction of owned receipt', 'expected': 'counterfeit-receipt-blocked'},
    {'id': 'unselected-movement', 'source': 'pair-signed.pdf', 'selectedMovementRows': [3], 'expected': 'unresolved-movement-blocked'},
]
write_json('actions.json', {'allFailures': {'partialReview': False, 'derivedCsv': False, 'mintedReceipt': False, 'sourceMutation': False}, 'actions': actions})
write_json('contract.json', {'version': 'P4_MULTICELL_SECTION_V1', 'syntheticEnglishNativePdfOnly': True, 'mapping': {'sheet': 0, 'header': 0, 'date': 0, 'reference': 1, 'description': 2, 'amount': 3, 'mode': 'signed', 'multiplier': 1, 'numberFormat': 'dot', 'dateFormat': 'ymd', 'pdfReviewed': True}, 'cuts': [25, 45, 69], 'decimals': 2, 'revision': 'p4-multicell-independent-v1', 'parentLabels': ['Invoice No', 'Invoice No:', 'Invoice Number', 'Invoice Number:'], 'continuationLabels': ['Continued invoice', 'Continued invoice:', 'Continued invoice No', 'Continued invoice No:'], 'pairConstraints': {'occupiedCells': 2, 'adjacent': True, 'roleBeforeValue': True, 'sameOriginalRowAndPage': True, 'mappedAmountEmpty': True, 'referencePattern': '^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$'}, 'defaultBudgets': {'maxOriginalBytes': 8388608, 'maxPages': 100, 'maxRows': 20000, 'maxProposals': 4096, 'maxEvidenceCells': 65536}, 'rowYieldInterval': 256, 'cases': manifest, 'resourceSource': 'resource-cancellation.pdf', 'actions': 'actions.json'})
files = {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(ROOT.iterdir()) if path.name != 'freeze.json'}
write_json('freeze.json', {'authorship': 'Independent manually authored original PDF, membership and cell-span truth before multicell engine implementation; no product imports or product outputs.', 'arithmetic': 'Python decimal.Decimal; exact signed literals retained; Python csv CRLF quoting', 'generatorSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), 'files': files})
print('Frozen', len(cases), 'cases and', len(actions), 'actions;', len(files), 'immutable files')
