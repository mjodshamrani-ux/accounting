#!/usr/bin/env python3
"""Independent P8 oracle: stdlib ZIP/XML/CSV/Decimal only, no product imports.

Checks actual exported workbooks against the pre-driver financial/format truth.
An execution report supplies locations, never expected memberships or money.
"""
import argparse
import base64
import csv
import copy
import hashlib
import io
import json
from collections import Counter, defaultdict
from decimal import Decimal
from datetime import date
from pathlib import Path
import posixpath
import re
import tempfile
import xml.etree.ElementTree as ET
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parent.parent
FROZEN = ROOT / 'audit/p8-non-ai-four-story-v1/frozen'
NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def verify_freeze():
    for entry in json.loads((FROZEN / 'MANIFEST.json').read_text())['files']:
        data = (FROZEN / entry['path']).read_bytes()
        assert len(data) == entry['bytes'] and digest(data) == entry['sha256'], entry['path']


def read_book(file):
    with ZipFile(file) as z:
        shared = []
        if 'xl/sharedStrings.xml' in z.namelist():
            for item in ET.fromstring(z.read('xl/sharedStrings.xml')):
                shared.append(''.join(item.itertext()))
        rels = {r.attrib['Id']: r.attrib['Target'] for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
        sheets = {}
        for sheet in ET.fromstring(z.read('xl/workbook.xml')).find('s:sheets', NS):
            target = rels[sheet.attrib['{' + REL + '}id']]
            target = target.lstrip('/') if target.startswith('/') else posixpath.normpath('xl/' + target)
            rows = []
            for row in ET.fromstring(z.read(target)).find('s:sheetData', NS):
                cells = {}
                for cell in row:
                    letters = ''.join(c for c in cell.attrib['r'] if c.isalpha())
                    col = 0
                    for c in letters:
                        col = col * 26 + ord(c) - 64
                    value = cell.find('s:v', NS)
                    value = value.text if value is not None else ''
                    if cell.attrib.get('t') == 's':
                        value = shared[int(value)]
                    elif cell.attrib.get('t') == 'inlineStr':
                        value = ''.join(cell.find('s:is', NS).itertext())
                    cells[col - 1] = value or ''
                rows.append([cells.get(i, '') for i in range(max(cells, default=-1) + 1)])
            sheets[sheet.attrib['name']] = rows
        return sheets


def table(rows):
    assert rows, 'Missing table header'
    return [dict(zip(rows[0], row + [''] * (len(rows[0]) - len(row)))) for row in rows[1:]]


def links(file, sheet_name):
    with ZipFile(file) as z:
        rels = {r.attrib['Id']: r.attrib['Target'] for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
        sheet = next(s for s in ET.fromstring(z.read('xl/workbook.xml')).find('s:sheets', NS) if s.attrib['name'] == sheet_name)
        target = rels[sheet.attrib['{' + REL + '}id']]
        target = target.lstrip('/') if target.startswith('/') else posixpath.normpath('xl/' + target)
        path = posixpath.join(posixpath.dirname(target), '_rels', posixpath.basename(target) + '.rels')
        cell_rels = {r.attrib['Id']: r.attrib['Target'] for r in ET.fromstring(z.read(path))} if path in z.namelist() else {}
        hyperlinks = ET.fromstring(z.read(target)).find('s:hyperlinks', NS)
        return {} if hyperlinks is None else {h.attrib['ref']: h.attrib.get('location', cell_rels.get(h.attrib.get('{' + REL + '}id'))) for h in hyperlinks}


def minor(value):
    exact = Decimal(str(value)) * 100
    assert exact == exact.to_integral_value(), 'Fractional minor money: ' + str(value)
    return int(exact)


def expectations(case_id):
    truth = json.loads((FROZEN / 'FINANCIAL-TRUTH.json').read_text())
    stories = truth['stories']
    case = next((s for s in stories if s['id'] == case_id), None)
    if case is None:
        case = next(c for c in stories[-1]['cases'] if c['id'] == case_id)
    inputs, literals, movements = {}, {}, {}
    if case_id == 'P2D06':
        inputs = {'supplier': 'story1/P2D06-supplier.xlsx', 'ledger': 'story1/P2D06-ledger.pdf'}
        layouts = json.loads((FROZEN / 'FORMAT-EXPECTATIONS.json').read_text())['layouts']
        for side in inputs:
            layout = next(x for x in layouts if x['path'] == inputs[side])
            literals[side] = layout.get('rows', layout.get('cellRows'))
    elif case_id in ('P2V2H03', 'P2V2H07'):
        control = case_id[-3:]
        inputs = {side: f'story2/{control}/{case_id}-{side}.csv' for side in ('supplier', 'ledger')}
    elif case_id == 'native-main-A':
        inputs = {side: f'story3/native-main-A-{side}.csv' for side in ('supplier', 'ledger')}
    else:
        inputs = {'supplier': case['derivedSourceExpected']['expectedSerializedCsvArtifact'], 'ledger': case['counterpart']}
    for side, file in inputs.items():
        if side not in literals:
            literals[side] = list(csv.reader(io.StringIO((FROZEN / file).read_text())))
        rows = literals[side]
        header = rows[0]
        ref_col = header.index('Invoice No' if case_id == 'native-main-A' else 'Reference')
        amount_col = header.index('Amount')
        date_col = header.index('Date')
        currency_col = header.index('Currency') if 'Currency' in header else None
        doc_col = header.index('Document No') if 'Document No' in header else ref_col
        movements[side] = [{'row': i + 2, 'minor': minor(row[amount_col]), 'reference': row[ref_col], 'primary': row[doc_col], 'documentColumn': doc_col + 1 if 'Document No' in header else None, 'date': row[date_col], 'sheet': 'Sheet1' if file.endswith('.xlsx') else 'PDF' if file.endswith('.pdf') else 'CSV', 'pdfPage': '1' if file.endswith('.pdf') else '', 'currency': row[currency_col] if currency_col is not None else case['scope']['currency']} for i, row in enumerate(rows[1:])]
    expected = case['nativeExportExpected']
    if case_id == 'native-main-A':
        groups = [expected['acceptedGroup']]
    elif case_id.startswith('deterministic-'):
        groups = [expected]
    else:
        groups = case['originalCase']['requiredAutoGroups']
    return case, inputs, literals, movements, expected, groups


def group_key(supplier, ledger):
    return (tuple(sorted(supplier)), tuple(sorted(ledger)))


def json_chunks(rows, keys, text_field):
    grouped = defaultdict(list)
    for row in rows:
        grouped[tuple(row[k] for k in keys)].append(row)
    result = []
    for key, parts in grouped.items():
        count = int(parts[0]['Total chunks'])
        assert count > 0 and len(parts) == count
        assert all(int(p['Total chunks']) == count for p in parts)
        assert sorted(int(p['Chunk']) for p in parts) == list(range(1, count + 1))
        value = json.loads(''.join(p[text_field] for p in sorted(parts, key=lambda p: int(p['Chunk']))))
        result.append((key, value))
    return result


def check_native_manual(file, book, case, inputs, literals, movements, expected):
    """Actual reviewed-aggregate export, whose proof sheets differ from regular IO.

    Generation counters are separate domains. Retained drafts grant no approval.
    Financial truth remains the independent exact original A member sets/money.
    """
    rows = table(book['Original movements'])
    original = {(side, r['row']): r for side in movements for r in movements[side]}
    assert Counter((r['Side'], int(r['Row'])) for r in rows) == Counter({key: 1 for key in original})
    assert len(rows) == 4 and len({r['ID'] for r in rows}) == 4
    by_id = {r['ID']: r for r in rows}
    approved = {('supplier', 2), ('ledger', 2), ('ledger', 3)}
    for row in rows:
        key = (row['Side'], int(row['Row']))
        wanted = original[key]
        assert row['ID'] and row['Sheet'] == 'CSV' and row['Date'] == wanted['date']
        assert Decimal(row['Amount minor']) == wanted['minor']
        assert row['Original reference'] == wanted['reference']
        assert row['Disposition'] == ('accepted-aggregate-member' if key in approved else 'unmatched')
    inventory = json_chunks(table(book['Native row inventory']), ['Side', 'Source SHA', 'Sheet', 'Row'], 'Raw cells JSON chunk')
    assert Counter((key[0], int(key[3])) for key, _ in inventory) == Counter({(side, rn): 1 for side in literals for rn in range(1, len(literals[side]) + 1)})
    for key, cells in inventory:
        side, source_sha, sheet, row = key
        assert sheet == 'CSV' and source_sha == digest((FROZEN / inputs[side]).read_bytes())
        assert cells == literals[side][int(row) - 1]
    for side in literals:
        assert book['Parsed ' + side.capitalize() + ' Source'][1:] == literals[side]
    aggregate = table(book['Accepted aggregates'])
    assert len(aggregate) == 1
    aggregate = aggregate[0]
    supplier_ids = json.loads(aggregate['Supplier member IDs'])
    ledger_ids = json.loads(aggregate['Ledger member IDs'])
    actual_members = {(by_id[id]['Side'], int(by_id[id]['Row'])) for id in supplier_ids + ledger_ids}
    assert len(supplier_ids) == 1 and len(ledger_ids) == 2 and actual_members == approved
    assert all(by_id[id]['Side'] == 'supplier' for id in supplier_ids)
    assert all(by_id[id]['Side'] == 'ledger' for id in ledger_ids)
    assert Decimal(aggregate['Total minor']) == 100 and aggregate['Relation'] == 'group-equivalence' and aggregate['Pairwise allocation'] == '0'
    matches = table(book['Matches'])
    assert len(matches) == 1
    match = matches[0]
    assert match['Match Decision'] == 'Manual' and match['Rule'] == 'REVIEWED_INVOICE_AGGREGATE_V1' and match['Status'] == 'Matched'
    assert match['Supplier References'] == movements['supplier'][0]['reference'] == match['Ledger References']
    assert minor(match['Supplier Amount']) == 100 and minor(match['Ledger Amount']) == 100
    assert match['Supplier Source Rows'] == '1' and match['Ledger Source Rows'] == '2'
    assert Decimal(match['Supplier Date']) == (date(2026, 9, 1) - date(1899, 12, 30)).days
    assert Decimal(match['Ledger Date']) == (date(2026, 9, 1) - date(1899, 12, 30)).days and match['Date Gap'] == '1'
    expected_links = {'R2': "#'Parsed Supplier Source'!A3", 'S2': "#'Parsed Ledger Source'!A3", 'T2': "#'Parsed Ledger Source'!A4"}
    assert links(file, 'Matches') == expected_links, 'Each source hyperlink belongs to its exact side/member coordinate'
    assert match['Supplier Source 1'] == 'supplier · CSV · row 2'
    assert match['Ledger Source 1'] == 'ledger · CSV · row 2' and match['Ledger Source 2'] == 'ledger · CSV · row 3'
    unmatched = table(book['Unmatched'])
    assert len(unmatched) == 1 and len(book['Needs Review']) == 1
    row = unmatched[0]
    assert row['Side'] == 'ledger' and row['Reference'] == 'INV-X-1' and minor(row['Amount']) == 100 and row['Source Rows'] == '1'
    assert row['Source Link'] == 'ledger · CSV · row 4' and links(file, 'Unmatched') == {'J2': "#'Parsed Ledger Source'!A5"}
    assert Decimal(row['Date']) == (date(2026, 9, 3) - date(1899, 12, 30)).days and row['Reason']
    binding = table(book['Source binding'])
    assert len(binding) == 1
    binding = binding[0]
    assert binding['Version'] == 'INVOICE_OVERLAP_REVIEW_V1' and binding['Revision'] == 'native-overlap-reading-v1'
    assert json.loads(binding['Scope JSON']) == case['scope']
    snapshot = binding['Snapshot']
    assert re.fullmatch(r'[0-9a-f]{64}', snapshot)
    receipts = json_chunks(table(book['Review ledger']), ['Receipt ID'], 'Immutable receipt JSON')
    proofs = json_chunks(table(book['Main aggregate proof']), ['Receipt', 'Candidate'], 'Original member proof JSON')
    assert len(receipts) == len(proofs) == 1
    receipt_key, receipt = receipts[0]
    proof_key, proof = proofs[0]
    assert receipt_key[0] == receipt['id'] == aggregate['Receipt'] == proof_key[0] == proof['receiptId']
    assert receipt['action'] == 'commit' and isinstance(receipt['generation'], int) and receipt['generation'] >= 1
    assert receipt['snapshotKey'] == snapshot == proof['snapshotKey']
    assert receipt['componentId'] == aggregate['Component'] == proof['componentId']
    assert aggregate['Candidate'] == proof_key[1] == proof['candidateId']
    assert receipt['reviewerLabel'] == proof['reviewerLabel'] and receipt['reviewerLabel'] and receipt['rationale'] and proof['rationale']
    assert Counter(receipt['reviewedRowKeys']) == Counter(row['Side'] + ':' + row['ID'] for row in rows)
    assert Counter(proof['supplierIds']) == Counter(supplier_ids) and Counter(proof['ledgerIds']) == Counter(ledger_ids)
    assert proof['totalMinor'] == 100 and proof['relation'] == 'group-equivalence' and proof['pairwiseAllocation'] is False
    assert len(receipt['decisions']) == 2
    choices = {}
    for decision in receipt['decisions']:
        assert decision['rationale'] and decision['candidateId'].startswith('INVOICE_OVERLAP_SEARCH_V1:candidate:')
        candidate = json.loads(decision['candidateId'].split(':candidate:', 1)[1])
        assert candidate[0:2] == ['INV-X-1', '']
        assert len(set(candidate[2] + candidate[3])) == len(candidate[2] + candidate[3])
        assert all(by_id[id]['Side'] == 'supplier' for id in candidate[2])
        assert all(by_id[id]['Side'] == 'ledger' for id in candidate[3])
        keys = frozenset((by_id[id]['Side'], int(by_id[id]['Row'])) for id in candidate[2] + candidate[3])
        assert keys not in choices
        choices[keys] = decision['decision']
        if decision['decision'] == 'accepted':
            assert decision['candidateId'] == aggregate['Candidate'] == proof['candidateId'], 'Exported proof must bind the accepted receipt candidate'
            assert Counter(candidate[2]) == Counter(supplier_ids) and Counter(candidate[3]) == Counter(ledger_ids)
    assert choices == {frozenset(approved): 'accepted', frozenset({('supplier', 2), ('ledger', 4)}): 'rejected'}
    main = table(book['Main comparison binding'])
    assert len(main) == 1 and main[0]['Contract'] == 'SUPPLIER_OVERLAP_MAIN_V1' and main[0]['Native snapshot'] == snapshot
    state = json_chunks(main, ['Contract', 'Native snapshot', 'Main generation'], 'Main decisions and rejected JSON')[0][1]
    assert int(main[0]['Main generation']) == state['generation'] >= 0
    assert state['decisions'] == [] and state['rejected'] == []
    # Imported generation1/archive receipt IDs can equal current local IDs;
    # their separate draft scope is never an active authority source.
    for draft in table(book['Imported review draft']):
        assert draft['Authority'] == 'archived-not-authoritative'
    return {'case': case['id'], 'status': 'PASS', 'file': str(file), 'sha256': digest(Path(file).read_bytes()), 'schema': 'Native reviewed aggregate + complete original inventory/receipt/main proof', 'sourceOccurrences': expected['sourceOccurrences'], 'automaticGroups': 0, 'manualGroups': 1, 'checker': 'stdlib ZIP/XML/CSV/Decimal; no product imports'}


def check_workbook(file, case_id, undone=False):
    case, inputs, literals, movements, expected, groups = expectations(case_id)
    if undone:
        assert case_id == 'native-main-A'
        groups = []
        expected = {**expected, 'manualGroups': 0, 'approvedSourceOccurrences': 0, 'nonApprovedSourceOccurrences': expected['sourceOccurrences']}
    book = read_book(file)
    metadata = {r['Field']: r['Value'] for r in table(book['Export Metadata'])}
    version = re.search(r"^export const ENGINE_VERSION = '([^']+)';", (ROOT / 'lib/reconciliation/types.ts').read_text()).group(1)
    assert metadata['Engine version'] == version, 'Wrong exported engine version'
    assert Decimal(metadata['Export time']) > 0
    summary_row = next(i for i, row in enumerate(book['Summary'], 1) if row[0] == 'Audit Metadata')
    assert links(file, 'Summary').get('B' + str(summary_row)) == "#'Export Metadata'!A1"
    for side in inputs:
        assert metadata[side.capitalize() + ' SHA-256'] == digest((FROZEN / inputs[side]).read_bytes())
    if case_id == 'native-main-A' and not undone:
        return check_native_manual(file, book, case, inputs, literals, movements, expected)
    evidence = table(book['Match Evidence'])
    matches = table(book['Matches'])
    evidence_links = links(file, 'Match Evidence')
    expected_rows = {(side, row['row']): row for side in movements for row in movements[side]}
    occurrences = Counter((r['Side'], int(r['Source Row'])) for r in evidence)
    assert occurrences == Counter({k: 1 for k in expected_rows}), ('Source occurrences', occurrences)
    assert len(evidence) == expected['sourceOccurrences']
    assert all(r['Source Row ID'] for r in evidence)
    assert len({(r['Side'], r['Source Row ID']) for r in evidence}) == len(evidence), 'Repeated source IDs'
    grouped = defaultdict(lambda: {'supplier': [], 'ledger': []})
    matched = {}
    for index, row in enumerate(evidence, 2):
        source = expected_rows[(row['Side'], int(row['Source Row']))]
        assert minor(row['Amount']) == source['minor'], ('Money', row)
        assert row['Primary Reference'] == source['primary'], ('Primary identity', row)
        if source['documentColumn'] is not None:
            assert row['Document Reference'] == source['primary']
            assert row['Document Number Role'] == 'document-number' and row['Document Number Header'] == 'Document No'
            assert int(row['Document Number Column']) == source['documentColumn']
            assert row['Document Type'] == 'Invoice'
            assert 'mappedReference (Reference): ' + source['reference'] in row['Retained Evidence'].split(' | ')
            assert row['Chosen Reference Role'] == 'document-reference', 'Retained literal alone is not semantic chosen-reference authority'
        assert row['Currency'] == source['currency'], ('Currency', row)
        assert row['Source Sheet'] == source['sheet'], ('Source sheet', row)
        assert row['PDF Page'] == source['pdfPage'], ('PDF page', row)
        assert Decimal(row['Date']) == (date.fromisoformat(source['date']) - date(1899, 12, 30)).days, ('Original date', row)
        wanted_text = f"{row['Side']} · {source['sheet']} · row {source['row']}" + (f" · PDF p{source['pdfPage']}" if source['pdfPage'] else '')
        assert row['Source Link'] == wanted_text, ('Source link text', row)
        wanted_target = f"#'Parsed {row['Side'].capitalize()} Source'!A{source['row'] + 1}"
        assert evidence_links.get('T' + str(index)) == wanted_target, ('Source hyperlink target', row)
        if undone:
            assert row['Status'] == 'Needs Review' and row['Reviewer Decision'] == '', ('Undo fate', row)
        if row['Status'] == 'Matched':
            grouped[row['Case ID']][row['Side']].append(int(row['Source Row']))
            matched[(row['Side'], int(row['Source Row']))] = row
            assert row['Reviewer Decision'] == ('Accepted' if case_id == 'native-main-A' else ''), ('Authority', row)
    actual = Counter(group_key(g['supplier'], g['ledger']) for g in grouped.values())
    required = Counter(group_key(g['supplierRows'], g['ledgerRows']) for g in groups)
    assert actual == required, ('Approved whole groups', actual, required)
    assert len(matched) == expected['approvedSourceOccurrences']
    assert len(evidence) - len(matched) == expected['nonApprovedSourceOccurrences']
    assert Counter(r['Case ID'] for r in matches) == Counter({key: 1 for key in grouped})
    assert Counter(r['Match Decision'] for r in matches) == Counter({k: v for k, v in {'Auto': expected['automaticGroups'], 'Manual': expected['manualGroups']}.items() if v})
    for row in matches:
        members = grouped[row['Case ID']]
        for side, label in [('supplier', 'Supplier'), ('ledger', 'Ledger')]:
            amount = sum(expected_rows[(side, rn)]['minor'] for rn in members[side])
            assert minor(row[label + ' Amount']) == amount
            assert int(row[label + ' Source Rows']) == len(members[side])
    for side in ('supplier', 'ledger'):
        name = side.capitalize()
        assert metadata[name + ' SHA-256'] == digest((FROZEN / inputs[side]).read_bytes()), ('SHA', side)
        source_sheet = book['Parsed ' + name + ' Source']
        original = literals[side]
        assert len(source_sheet) == len(original) + 1, ('Parsed row count', side)
        for rn, (actual_row, wanted) in enumerate(zip(source_sheet[1:], original), 1):
            assert int(actual_row[0]) == rn
            actual_values = actual_row[1:]
            width = max(len(actual_values), len(wanted))
            assert actual_values + [''] * (width - len(actual_values)) == wanted + [''] * (width - len(wanted)), ('Original literal', side, rn, actual_values, wanted)
        raw_total = sum(row['minor'] for row in movements[side])
        expected_total = expected.get(side + 'RawTotalMinor', expected.get(side + 'TotalMinor'))
        assert raw_total == expected_total
    return {'case': case_id, 'status': 'PASS', 'file': str(file), 'sha256': digest(Path(file).read_bytes()), 'sourceOccurrences': len(evidence), 'automaticGroups': expected['automaticGroups'], 'manualGroups': expected['manualGroups'], 'checker': 'stdlib ZIP/XML/CSV/Decimal; no product imports'}


def check_report(report_file):
    report = json.loads(Path(report_file).read_text())
    assert report['status'] == 'PASS', 'Failed/incomplete browser report'
    assert len(report['runs']) == 12
    contract = json.loads((FROZEN / 'CONTRACT.json').read_text())
    required = Counter((c, m['uiLanguage'], tuple(m['viewport'])) for c in contract['plannedExecutionMatrix']['caseIDs'] for m in contract['plannedExecutionMatrix']['perCase'])
    assert Counter((r['case'], r['language'], tuple(r['viewport'])) for r in report['runs']) == required
    checked = []
    for run in report['runs']:
        assert run['status'] == 'PASS'
        lifecycle = run['lifecycle']
        assert lifecycle['cancelledRealRead']['staleIgnored'] is True
        assert lifecycle['cancelledRealRead']['releasedExactEvent'] is True
        assert lifecycle['restoredSession']['freshPage'] is True
        assert lifecycle['network']['nonlocalAttempts'] == []
        assert run['pageErrors'] == []
        assert lifecycle['staticReady']['actualReadyReply'] is True
        assert lifecycle['staticReady']['actualReadyReplies'] and all(r['ready'] is True and r['engine'] == re.search(r"^export const ENGINE_VERSION = '([^']+)';", (ROOT / 'lib/reconciliation/types.ts').read_text()).group(1) for r in lifecycle['staticReady']['actualReadyReplies'])
        session = json.loads(Path(run['session']['file']).read_text())
        assert digest(Path(run['session']['file']).read_bytes()) == run['session']['sha256']
        case, inputs, _, _, _, _ = expectations(run['case'])
        assert len(session['files']) == 2
        for index, side in enumerate(('supplier', 'ledger')):
            original = (FROZEN / inputs[side]).read_bytes()
            saved_source = session['files'][index]
            wanted_name = 'multiline-explicitly-derived-invoice.csv' if side == 'supplier' and run['case'].startswith('deterministic-') else Path(inputs[side]).name
            assert saved_source['name'] == wanted_name
            assert saved_source['sha256'] == digest(original)
            assert base64.b64decode(saved_source['data'], validate=True) == original
            restored = lifecycle['restoredSession']['actualRestoreReplies']
            assert len(restored) == 1 and len(restored[0]['files']) == 2
            restored_source = restored[0]['files'][index]
            assert restored_source['name'] == wanted_name
            assert restored_source['sha256'] == digest(original)
            assert restored_source['sheets'][0]['rows'] == expectations(run['case'])[2][side], 'Restored original literals'
        assert run['assistance'], 'Unlogged assistance'
        for assist in run['assistance']:
            assert all(k in assist for k in contract['assistanceSchema']['requiredEntryKeys'])
            assert assist['kind'] in contract['assistanceSchema']['allowedKinds']
            assert assist['count'] > 0 and assist['scriptedSynthetic'] is True
        for workbook in run['workbooks']:
            checked.append(check_workbook(workbook, run['case']))
        assert len(run['workbooks']) == 2, 'Before/after restore exports required'
        if run['case'] == 'P2D06':
            explanation_file = Path(run['decoyExplanation']['file'])
            assert digest(explanation_file.read_bytes()) == run['decoyExplanation']['sha256']
            explanation = json.loads(explanation_file.read_text())
            assert 'INV-C' in explanation['visibleExistingExplanation']
            assert explanation['independentFrozenRationale'] == case['originalCase']['rationale']
            source_book = read_book(run['workbooks'][0])
            for citation in explanation['sourceCitations']:
                row = next(r for r in table(source_book['Match Evidence']) if r['Side'] == citation['side'] and int(r['Source Row']) == citation['row'])
                assert 'mappedReference (Reference): ' + citation['reference'] in row['Retained Evidence'].split(' | ') and row['Chosen Reference Role'] == 'document-reference'
                assert row['PO Reference'] == citation['po']
                assert minor(row['Amount']) == citation['amountMinor']
            citations = explanation['sourceCitations']
            assert [c['reference'] for c in citations] == ['INV-A', 'INV-B', 'INV-C']
            assert [c['po'] for c in citations] == ['PO-A', 'PO-B', 'PO-C']
            assert citations[1]['amountMinor'] + citations[2]['amountMinor'] == citations[0]['amountMinor']
        if run['case'] == 'native-main-A':
            assert lifecycle['restoredSession']['activeOldReceipts'] == 0
            assert lifecycle['undo']['matchedSourceRows'] == 0
            checked.append(check_workbook(run['undoWorkbook'], run['case'], undone=True))
        if run['case'].startswith('deterministic-'):
            case = expectations(run['case'])[0]
            proofs = run['sourceReviewProofs']
            assert len(proofs) == 2
            assert proofs[0]['pageLifetime'] != proofs[1]['pageLifetime'], 'Must use distinct actual destroyed/new page lifetimes'
            for proof_file in proofs:
                proof = json.loads(Path(proof_file['file']).read_text())
                assert digest(Path(proof_file['file']).read_bytes()) == proof_file['sha256']
                assert all(k in proof for k in contract['story4ExternalProvenanceLinkKeys'])
                assert proof['originalTxtSha256'] == case['expectedOriginalSha256']
                assert proof['originalTxtName'] == Path(case['original']).name
                assert proof['derivedCsvSha256'] == case['derivedSourceExpected']['expectedSerializedCsvSha256']
                assert proof['spans'] == case['reviewOracle']['evidence']
                assert proof['pageLifetime'] == proof_file['pageLifetime'] and proof['pageLifetime'] > 0
                assert proof['extractionRevision'] == proof_file['extractionRevision'] and proof['extractionRevision']
                assert proof['freshEmptyReviewObserved'] is True
                selected = [{'field': field, **proof['spans'][field], 'sourceSha256': case['expectedOriginalSha256'], 'extractionRevision': proof['extractionRevision']} for field in sorted(proof['spans'])]
                assert proof['selections'] == selected
                canonical = json.dumps(selected, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()
                assert proof['selectionSha256'] == digest(canonical)
                assert proof['separateReviewerLabel'] and proof['separateRationale'] and proof['selectionSha256']
                assert proof['explicitFinancialImportAction'] is True
                assert proof['financialStateUnchangedThroughSourceApply'] is True
                assert digest(Path(proof['derivedCsvFile']).read_bytes()) == proof['derivedCsvSha256']
                assert proof['separateReviewerLabel'] in proof['recordedReviewText'] and proof['separateRationale'] in proof['recordedReviewText']
    return {'status': 'PASS', 'baseReplays': 12, 'workbooks': checked, 'limits': contract['limits'], 'fullP8ClaimBoundary': contract['fullP8ClaimBoundary']}


def selftest(report_file):
    """Corrupt actual export bytes/actual report copies; every mutant must fail.

    These are evaluator fault probes, never financial-engine mutation coverage.
    Retain mutants and rejection messages for independent review.
    """
    report = json.loads(Path(report_file).read_text())
    check_report(report_file)
    out = Path(tempfile.mkdtemp(prefix='evaluator-faults-', dir=Path(report_file).parent))
    failures = []

    def rejected(name, callback):
        try:
            callback()
        except (AssertionError, KeyError, ValueError) as error:
            failures.append({'fault': name, 'status': 'REJECTED', 'reason': str(error)})
        else:
            raise AssertionError('Evaluator accepted corrupt evidence: ' + name)

    def mutate_book(case_id, name, sheet_name, cell_ref=None, value=None, delete_row=False, duplicate_row=False, wrong_link=False, swap_links=False, swap_labels=False, relocated_unmatched_link=False, rejected_candidate=False):
        run = next(r for r in report['runs'] if r['case'] == case_id)
        source = run['workbooks'][0]
        with ZipFile(source) as z:
            files = {file: z.read(file) for file in z.namelist()}
        rels = {r.attrib['Id']: r.attrib['Target'] for r in ET.fromstring(files['xl/_rels/workbook.xml.rels'])}
        def sheet_xml(name):
            sheet = next(s for s in ET.fromstring(files['xl/workbook.xml']).find('s:sheets', NS) if s.attrib['name'] == name)
            target = rels[sheet.attrib['{' + REL + '}id']]
            target = target.lstrip('/') if target.startswith('/') else posixpath.normpath('xl/' + target)
            return target, ET.fromstring(files[target])

        def put_cell(tree, ref, value):
            cell = next(c for row in tree.find('s:sheetData', NS) for c in row if c.attrib['r'] == ref)
            for child in list(cell):
                cell.remove(child)
            cell.attrib['t'] = 'inlineStr'
            inline = ET.SubElement(cell, '{' + NS['s'] + '}is')
            ET.SubElement(inline, '{' + NS['s'] + '}t').text = value

        target, tree = sheet_xml(sheet_name)
        data = tree.find('s:sheetData', NS)
        if wrong_link:
            link = next(h for h in tree.find('s:hyperlinks', NS) if h.attrib['ref'] == 'T2')
            link.attrib['location'] = "#'Parsed Supplier Source'!A999"
        elif swap_links:
            source_links = {h.attrib['ref']: h for h in tree.find('s:hyperlinks', NS)}
            source_links['R2'].attrib['location'], source_links['S2'].attrib['location'] = source_links['S2'].attrib['location'], source_links['R2'].attrib['location']
        elif swap_labels:
            put_cell(tree, 'S2', 'ledger · CSV · row 3')
            put_cell(tree, 'T2', 'ledger · CSV · row 2')
        elif relocated_unmatched_link:
            link = next(h for h in tree.find('s:hyperlinks', NS) if h.attrib['ref'] == 'J2')
            link.attrib['ref'] = 'A2'
        elif rejected_candidate:
            original_book = read_book(source)
            receipt = json_chunks(table(original_book['Review ledger']), ['Receipt ID'], 'Immutable receipt JSON')[0][1]
            rejected_id = next(d['candidateId'] for d in receipt['decisions'] if d['decision'] == 'rejected')
            proof = json_chunks(table(original_book['Main aggregate proof']), ['Receipt', 'Candidate'], 'Original member proof JSON')[0][1]
            assert table(original_book['Main aggregate proof'])[0]['Total chunks'] == '1'
            proof['candidateId'] = rejected_id
            put_cell(tree, 'B2', rejected_id)
            proof_target, proof_tree = sheet_xml('Main aggregate proof')
            put_cell(proof_tree, 'B2', rejected_id)
            put_cell(proof_tree, 'E2', json.dumps(proof))
            files[proof_target] = ET.tostring(proof_tree)
        elif delete_row:
            data.remove(list(data)[1])
        elif duplicate_row:
            data.append(copy.deepcopy(list(data)[1]))
        else:
            put_cell(tree, cell_ref, value)
        files[target] = ET.tostring(tree)
        file = out / (name + '.xlsx')
        with ZipFile(file, 'w') as z:
            for member, data in files.items():
                z.writestr(member, data)
        rejected(name, lambda: check_workbook(file, case_id))

    for name, sheet, cell, value in [
        ('wrong-source-sha', 'Export Metadata', 'B3', '0' * 64),
        ('wrong-source-row', 'Match Evidence', 'I2', '999'),
        ('wrong-primary-identity', 'Match Evidence', 'L2', 'CORRUPTED-IDENTITY'),
        ('wrong-minor-money', 'Match Evidence', 'S2', '999.99'),
        ('wrong-group-membership', 'Match Evidence', 'A2', 'invented-group'),
        ('wrong-source-side', 'Match Evidence', 'F2', 'ledger'),
        ('wrong-currency', 'Match Evidence', 'R2', 'USD'),
        ('wrong-original-cell-literal', 'Parsed Supplier Source', 'B3', 'changed original literal'),
        ('wrong-original-date', 'Match Evidence', 'K2', '123'),
        ('wrong-source-sheet', 'Match Evidence', 'H2', 'made-up sheet'),
        ('wrong-PDF-page', 'Match Evidence', 'J2', '999'),
        ('wrong-source-link-text', 'Match Evidence', 'T2', 'nonempty but wrong'),
        ('empty-source-row-ID', 'Match Evidence', 'G2', ''),
    ]:
        mutate_book('P2D06', name, sheet, cell, value)
    mutate_book('P2D06', 'drop-original-occurrence', 'Match Evidence', delete_row=True)
    mutate_book('P2V2H07', 'deduplicate-original-duplicate', 'Match Evidence', delete_row=True)
    mutate_book('P2V2H07', 'approve-H07', 'Match Evidence', 'C2', 'Matched')
    mutate_book('P2D06', 'duplicate-original-occurrence', 'Match Evidence', duplicate_row=True)
    mutate_book('P2D06', 'wrong-source-hyperlink-destination', 'Match Evidence', wrong_link=True)
    mutate_book('native-main-A', 'manual-marked-auto', 'Matches', 'Q2', 'Auto')
    mutate_book('native-main-A', 'native-swapped-source-hyperlink-coordinates', 'Matches', swap_links=True)
    mutate_book('native-main-A', 'native-swapped-source-display-labels', 'Matches', swap_labels=True)
    mutate_book('native-main-A', 'native-relocated-unmatched-source-hyperlink', 'Unmatched', relocated_unmatched_link=True)
    mutate_book('native-main-A', 'native-proof-uses-rejected-receipt-candidate', 'Accepted aggregates', rejected_candidate=True)
    mutate_book('P2D06', 'wrong-selected-reference-proof', 'Match Evidence', 'W2', 'mappedReference (Reference): WRONG')
    mutate_book('P2D06', 'wrong-selected-reference-role', 'Match Evidence', 'AE2', 'audit-only')
    for name, sheet, cell, value in [
        ('native-wrong-minor-money', 'Original movements', 'F2', '999'),
        ('native-wrong-physical-row', 'Original movements', 'D2', '999'),
        ('native-wrong-source-hash', 'Native row inventory', 'B2', '0' * 64),
        ('native-wrong-membership', 'Accepted aggregates', 'E2', '["ledger:0:4"]'),
        ('native-invent-pairwise-allocation', 'Accepted aggregates', 'H2', '1'),
        ('native-wrong-aggregate-total', 'Accepted aggregates', 'F2', '200'),
        ('native-erased-reviewer-proof', 'Review ledger', 'D2', '{}'),
        ('native-wrong-match-reference', 'Matches', 'D2', 'WRONG'),
    ]:
        mutate_book('native-main-A', name, sheet, cell, value)
    for name, mutator in [
        ('missing-cancellation', lambda r: r['runs'][0]['lifecycle']['cancelledRealRead'].update(staleIgnored=False)),
        ('missing-fresh-page-restore', lambda r: r['runs'][0]['lifecycle']['restoredSession'].update(freshPage=False)),
        ('nonlocal-request-attempt', lambda r: r['runs'][0]['lifecycle']['network'].update(nonlocalAttempts=['https://example.invalid'])),
        ('missing-export', lambda r: r['runs'][0].update(workbooks=[])),
        ('missing-base-case', lambda r: r['runs'].pop()),
    ]:
        mutant = copy.deepcopy(report)
        mutator(mutant)
        file = out / (name + '.json')
        file.write_text(json.dumps(mutant))
        rejected(name, lambda file=file: check_report(file))
    for name, mutator in [
        ('wrong-selected-span-digest', lambda p: p.update(selectionSha256='0' * 64)),
        ('wrong-source-proof-revision', lambda p: p.update(extractionRevision='made-up-revision')),
        ('resurrect-source-review-authority', lambda p: p.update(freshEmptyReviewObserved=False)),
    ]:
        mutant = copy.deepcopy(report)
        run = next(r for r in mutant['runs'] if r['case'] == 'deterministic-en')
        entry = run['sourceReviewProofs'][0]
        proof = json.loads(Path(entry['file']).read_text())
        mutator(proof)
        proof_file = out / (name + '-proof.json')
        proof_file.write_text(json.dumps(proof))
        entry.update(file=str(proof_file), sha256=digest(proof_file.read_bytes()))
        file = out / (name + '.json')
        file.write_text(json.dumps(mutant))
        rejected(name, lambda file=file: check_report(file))
    result = {'status': 'PASS', 'faultsRejected': len(failures), 'faults': failures, 'retainedMutantDirectory': str(out), 'scope': 'Independent evaluator fault probes; no claim of engine mutation coverage'}
    (out / 'REPORT.json').write_text(json.dumps(result, indent=2) + '\n')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--report')
    parser.add_argument('--workbook')
    parser.add_argument('--case')
    parser.add_argument('--out')
    parser.add_argument('--selftest', action='store_true')
    args = parser.parse_args()
    verify_freeze()
    result = selftest(args.report) if args.selftest else check_report(args.report) if args.report else check_workbook(args.workbook, args.case)
    rendered = json.dumps(result, ensure_ascii=False, indent=2) + '\n'
    if args.out:
        Path(args.out).write_text(rendered)
    else:
        print(rendered)
