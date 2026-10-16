"""Independent serialized-source oracle. No generator/product imports.

This checks a proposed FIN-1 source contract; it is not a product parser.
"""
import csv
import hashlib
import io
import json
import re
from datetime import date
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CATEGORIES = ('current-asset', 'noncurrent-asset', 'current-liability', 'noncurrent-liability', 'equity')
HEADERS = [
    ['Account ID', 'Complete dimensions', 'Account label', 'Account class', 'Debit', 'Credit'],
    ['Mapping ID', 'Account ID', 'Complete dimensions', 'Line ID', 'Sign', 'Evidence ID'],
    ['Evidence ID', 'Account ID', 'Complete dimensions', 'Account class', 'Line ID', 'Line label', 'Line class', 'Sign', 'Valid from', 'Valid to', 'Evidence reference'],
    ['Node ID', 'Parent ID', 'Kind', 'Line label', 'Line class', 'Amount'],
]
ROLES = ('trial-balance', 'proposed-mapping', 'presentation-evidence', 'financial-position')


def evaluate(folder, contract=None):
    contract = contract or json.loads((ROOT / 'contract.json').read_text(encoding='utf-8'))
    issues, citations, inventory, sources, tables = [], [], [], [], []
    def problem(code, row=None, field=''):
        issue = {'code': code}
        if row is not None:
            issue.update(source=row['_source'], row=row['_row'], field=field)
        if issue not in issues:
            issues.append(issue)
    def checked_sum(values, row=None, field=''):
        values = list(values)
        total = sum(values)
        limit = contract['aggregateMinorAbsLimit']
        if any(abs(value) > limit for value in values) or abs(total) > limit:
            problem('SUM', row, field)
        return total
    for source, role in enumerate(ROLES):
        raw = (Path(folder) / (role + '.csv')).read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        sources.append({'role': role, 'sha256': digest, 'bytes': len(raw)})
        if len(raw) > contract['limits']['sourceBytes']:
            problem('BYTES'); tables.append([]); continue
        try:
            serialized = list(csv.reader(io.StringIO(raw.decode('utf-8'), newline=''), strict=True))
        except (UnicodeDecodeError, csv.Error):
            problem('CSV'); tables.append([]); continue
        if not serialized:
            problem('HEADERS'); tables.append([]); continue
        headers = serialized[0]
        wanted = HEADERS[source] + list(contract['scope'])
        if len(set(headers)) != len(headers) or set(headers) != set(wanted):
            problem('HEADERS'); tables.append([]); continue
        if len(serialized) - 1 > contract['limits']['rowsPerSource']:
            problem('ROWS'); tables.append([]); continue
        table = []
        for number, cells in enumerate(serialized[1:], 2):
            row = {'_source': source, '_row': number}
            inventory.append({'source': source, 'row': number, 'raw': cells})
            if len(cells) != len(headers):
                problem('WIDTH', row); continue
            row.update(zip(headers, cells)); table.append(row)
            for column, (field, value) in enumerate(zip(headers, cells), 1):
                citations.append({'source': source, 'sha256': digest, 'row': number, 'column': column, 'field': field, 'raw': value})
                if len(value) > contract['limits']['fieldCharacters']:
                    problem('TEXT', row, field)
            if any(row[field] != expected for field, expected in contract['scope'].items()):
                problem('SCOPE', row)
        tables.append(table)
    tb, mapping, proofs, statements = tables
    for source, table in enumerate(tables):
        if not table:
            problem('EMPTY_SOURCE', {'_source': source, '_row': 1})
    if not tb:
        problem('NO_ACCOUNT')
    if not any(row['Kind'] == 'leaf' for row in statements):
        problem('NO_FINANCIAL_LEAF')
    def money(row, field, nonnegative=False):
        value = row[field]
        if not re.fullmatch(r'-?(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?', value):
            problem('MONEY', row, field); return None
        amount = int(Decimal(value) * 100)
        if abs(amount) > 100000000000000 or (nonnegative and amount < 0):
            problem('MONEY', row, field); return None
        return amount
    def unique(rows, key, code):
        indexed = {}
        for row in rows:
            identity = key(row)
            if not identity or (isinstance(identity, tuple) and not all(identity)):
                problem('IDENTITY', row); continue
            if identity in indexed:
                problem(code, row); continue
            indexed[identity] = row
        return indexed
    account_key = lambda r: (r['Account ID'], r['Complete dimensions'])
    accounts = unique(tb, account_key, 'DUPLICATE_ACCOUNT')
    unique(mapping, lambda r: r['Mapping ID'], 'DUPLICATE_MAPPING_ID')
    mapped = unique(mapping, account_key, 'DUPLICATE_MAPPING_ACCOUNT')
    proof_ids = unique(proofs, lambda r: r['Evidence ID'], 'DUPLICATE_PROOF')
    unique(proofs, account_key, 'DUPLICATE_PROOF_ACCOUNT')
    nodes = unique(statements, lambda r: r['Node ID'], 'DUPLICATE_NODE')
    debit, credit, nets, reported = 0, 0, {}, {}
    debit_values, credit_values = [], []
    for key, row in accounts.items():
        if row['Account class'] not in CATEGORIES:
            problem('CLASSIFICATION', row, 'Account class')
        dr, cr = money(row, 'Debit', True), money(row, 'Credit', True)
        if dr is not None:
            debit_values.append(dr)
        if cr is not None:
            credit_values.append(cr)
        if dr is not None and cr is not None:
            if dr > 0 and cr > 0:
                problem('BOTH_SIDES', row)
            debit += dr; credit += cr; nets[key] = checked_sum([dr, -cr], row, 'Net')
        if key not in mapped:
            problem('UNMAPPED_ACCOUNT', row)
    debit = checked_sum(debit_values, field='TB debit total')
    credit = checked_sum(credit_values, field='TB credit total')
    checked_sum([debit, -credit], field='TB residual')
    if debit != credit:
        problem('TB_BALANCE')
    children = {node: [] for node in nodes}
    for node, row in nodes.items():
        kind, parent = row['Kind'], row['Parent ID']
        if kind not in ('leaf', 'parent', 'title'):
            problem('KIND', row, 'Kind'); continue
        if kind == 'title':
            if parent or row['Amount'] or row['Line class']:
                problem('TITLE', row)
            continue
        if row['Line class'] not in CATEGORIES:
            problem('CLASSIFICATION', row, 'Line class')
        reported[node] = money(row, 'Amount')
        if parent:
            owner = nodes.get(parent)
            if not owner or owner['Kind'] != 'parent':
                problem('PARENT', row, 'Parent ID')
            else:
                children[parent].append(node)
                if owner['Line class'] != row['Line class']:
                    problem('CLASSIFICATION', row, 'Line class')
    for node, row in nodes.items():
        visited, cursor = set(), node
        while cursor in nodes and nodes[cursor]['Kind'] != 'title':
            if cursor in visited:
                problem('CYCLE', row, 'Parent ID'); break
            visited.add(cursor)
            if len(visited) > contract['limits']['treeDepth']:
                problem('DEPTH', row); break
            cursor = nodes[cursor]['Parent ID']
    for node, row in nodes.items():
        if row['Kind'] == 'parent':
            if not children[node]:
                problem('EMPTY_PARENT', row)
            values = [reported.get(child) for child in children[node]]
            if reported.get(node) is not None and all(value is not None for value in values):
                if checked_sum(values, row, 'Parent child total') != reported[node]:
                    problem('CONTROL_TOTAL', row, 'Amount')
    for proof in proofs:
        account, line = accounts.get(account_key(proof)), nodes.get(proof['Line ID'])
        if not account:
            problem('PROOF_ACCOUNT', proof)
        if not line or line['Kind'] != 'leaf':
            problem('PROOF_LINE', proof, 'Line ID')
        if account and account['Account class'] != proof['Account class']:
            problem('CLASSIFICATION', proof, 'Account class')
        if line and (proof['Line class'] != line['Line class'] or proof['Line label'] != line['Line label']):
            problem('CLASSIFICATION', proof, 'Line class')
        if proof['Account class'] != proof['Line class']:
            problem('CLASSIFICATION', proof, 'Line class')
        validity = {}
        for field in ('Valid from', 'Valid to'):
            value = proof[field]
            try:
                if not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}', value):
                    raise ValueError('ISO_DATE')
                parsed = date.fromisoformat(value)
                if parsed.isoformat() != value:
                    raise ValueError('ISO_DATE')
                validity[field] = parsed
            except ValueError:
                problem('DATE', proof, field)
        if len(validity) == 2:
            start, end = validity['Valid from'], validity['Valid to']
            period_start = date.fromisoformat(contract['scope']['Period start'])
            period_end = date.fromisoformat(contract['scope']['Period end'])
            if start > period_start or end < period_end or start > end:
                problem('VALIDITY', proof)
        if not proof['Evidence reference']:
            problem('PROOF_REFERENCE', proof)
        if proof['Sign'] not in ('debit-positive', 'credit-positive'):
            problem('SIGN', proof)
        if account and account['Account class'] in CATEGORIES:
            policy = 'debit-positive' if account['Account class'].endswith('asset') else 'credit-positive'
            if proof['Sign'] != policy:
                problem('SIGN_POLICY', proof, 'Sign')
    contributions, members, used_proofs = {}, {}, set()
    for row in mapping:
        key, line_id = account_key(row), row['Line ID']
        proof, node = proof_ids.get(row['Evidence ID']), nodes.get(line_id)
        if key not in accounts:
            problem('MAPPING_ACCOUNT', row)
        if not node or node['Kind'] != 'leaf':
            problem('MAPPING_TARGET', row, 'Line ID')
        if not proof:
            problem('MISSING_PROOF', row)
        else:
            used_proofs.add(row['Evidence ID'])
            if any(row[field] != proof[field] for field in ('Account ID', 'Complete dimensions', 'Line ID', 'Sign')):
                problem('MAPPING_PROOF', row)
        if row['Sign'] not in ('debit-positive', 'credit-positive'):
            problem('SIGN', row); continue
        account = accounts.get(key)
        if account and account['Account class'] in CATEGORIES:
            policy = 'debit-positive' if account['Account class'].endswith('asset') else 'credit-positive'
            if row['Sign'] != policy:
                problem('SIGN_POLICY', row, 'Sign')
        members.setdefault(line_id, []).append('|'.join(key))
        if key in nets:
            contributions[line_id] = contributions.get(line_id, 0) + (nets[key] if row['Sign'] == 'debit-positive' else -nets[key])
    for line_id in contributions:
        contributions[line_id] = checked_sum([contributions[line_id]], nodes.get(line_id), 'Line contribution')
    for proof in proofs:
        if proof['Evidence ID'] not in used_proofs:
            problem('UNUSED_PROOF', proof)
    category = {c: 0 for c in CATEGORIES}
    for node, row in nodes.items():
        if row['Kind'] != 'leaf':
            continue
        if node not in members:
            problem('UNMAPPED_LEAF', row)
        if reported.get(node) is not None and node in contributions:
            difference = checked_sum([contributions[node], -reported[node]], row, 'Line difference')
            if difference != 0:
                problem('LEAF_TOTAL', row, 'Amount')
        if row['Line class'] in category and reported.get(node) is not None:
            category[row['Line class']] += reported[node]
    calculated_category = {}
    for classification in CATEGORIES:
        category[classification] = checked_sum([reported[node] for node, row in nodes.items() if row['Kind'] == 'leaf' and row['Line class'] == classification and reported.get(node) is not None], field='Reported category:' + classification)
        calculated_category[classification] = checked_sum([contributions[node] for node, row in nodes.items() if row['Kind'] == 'leaf' and row['Line class'] == classification and node in contributions], field='Calculated category:' + classification)
    assets = checked_sum([category['current-asset'], category['noncurrent-asset']], field='Assets total')
    liabilities = checked_sum([category['current-liability'], category['noncurrent-liability']], field='Liabilities total')
    equation = checked_sum([assets, -liabilities, -category['equity']], field='Statement equation')
    calculated_assets = checked_sum([calculated_category['current-asset'], calculated_category['noncurrent-asset']], field='Calculated assets total')
    calculated_liabilities = checked_sum([calculated_category['current-liability'], calculated_category['noncurrent-liability']], field='Calculated liabilities total')
    checked_sum([calculated_assets, -calculated_liabilities, -calculated_category['equity']], field='Calculated statement equation')
    if equation:
        problem('STATEMENT_EQUATION')
    return {
        'status': 'blocked' if issues else 'eligible', 'issues': issues,
        'facts': {'debitMinor': debit, 'creditMinor': credit,
                  'leafMinor': {n: reported.get(n) for n, r in nodes.items() if r['Kind'] == 'leaf'},
                  'parentMinor': {n: reported.get(n) for n, r in nodes.items() if r['Kind'] == 'parent'},
                  'members': {n: sorted(m) for n, m in members.items()},
                  'categoryMinor': category, 'equationMinor': equation},
        'sources': sources, 'inventory': inventory, 'citations': citations,
        'ownership': {n: r['Parent ID'] for n, r in nodes.items() if r['Kind'] != 'title'},
        'claim': 'Synthetic proposed-source eligibility only; no product support, decision or completeness certification',
    }


def verify_claim(actual, claimed):
    """Exact evidence gate for an eventual adapter, exercised with forged claims.

    Not a current product API. All fields are compared, including original raw
    rows and field citations. Python bool must not substitute for numeric zero.
    """
    expected = json.dumps(actual, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
    supplied = json.dumps(claimed, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
    if expected != supplied:
        raise AssertionError('FIN1A_CLAIM_MISMATCH')
