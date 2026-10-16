"""Deterministic synthetic CSV author. Never imports the oracle or product."""
import argparse
import copy
import csv
import io
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VERSION = 'fin1a-csv-writer-1'

def bundle():
    scope = json.loads((ROOT / 'contract.json').read_text(encoding='utf-8'))['scope']
    def row(**values):
        return dict(values, **scope)
    accounts = [
        ('0010', 'branch=10', 'نقد، الفرع الأول', 'current-asset', '500.00', '0.00', 'CASH-A', 'debit-positive'),
        ('0010', 'branch=20', 'Cash branch 20', 'current-asset', '500.00', '0.00', 'CASH-B', 'debit-positive'),
        ('001', 'branch=10', 'Receivable', 'current-asset', '300.00', '0.00', 'REC', 'debit-positive'),
        ('0019', 'branch=10', 'Allowance (contra asset)', 'current-asset', '0.00', '100.00', 'ALLOW', 'debit-positive'),
        ('0099', 'branch=10', 'Explicit zero', 'current-asset', '0.00', '0.00', 'ZERO', 'debit-positive'),
        ('2000', 'branch=10', 'Payable', 'current-liability', '0.00', '500.00', 'PAY', 'credit-positive'),
        ('3000', 'branch=10', 'Capital', 'equity', '0.00', '700.00', 'CAP', 'credit-positive'),
    ]
    tb, mapping, proof = [], [], []
    for i, (account, dimensions, label, category, debit, credit, line, sign) in enumerate(accounts, 1):
        tb.append(row(**{'Account ID': account, 'Complete dimensions': dimensions, 'Account label': label, 'Account class': category, 'Debit': debit, 'Credit': credit}))
        mapping.append(row(**{'Mapping ID': 'M' + str(i), 'Account ID': account, 'Complete dimensions': dimensions, 'Line ID': line, 'Sign': sign, 'Evidence ID': 'E' + str(i)}))
        proof.append(row(**{'Evidence ID': 'E' + str(i), 'Account ID': account, 'Complete dimensions': dimensions, 'Account class': category, 'Line ID': line, 'Line label': label, 'Line class': category, 'Sign': sign, 'Valid from': '2026-01-01', 'Valid to': '2026-12-31', 'Evidence reference': 'SYNTHETIC-PRESENTATION-' + str(i)}))
    nodes = [
        ('TITLE', '', 'title', 'Synthetic financial position', '', ''),
        ('ASSETS', '', 'parent', 'Current assets', 'current-asset', '1200.00'),
        ('CASH', 'ASSETS', 'parent', 'Cash subtotal', 'current-asset', '1000.00'),
        ('CASH-A', 'CASH', 'leaf', accounts[0][2], 'current-asset', '500.00'),
        ('CASH-B', 'CASH', 'leaf', accounts[1][2], 'current-asset', '500.00'),
        ('REC', 'ASSETS', 'leaf', accounts[2][2], 'current-asset', '300.00'),
        ('ALLOW', 'ASSETS', 'leaf', accounts[3][2], 'current-asset', '-100.00'),
        ('ZERO', 'ASSETS', 'leaf', accounts[4][2], 'current-asset', '0.00'),
        ('LIABILITIES', '', 'parent', 'Liabilities', 'current-liability', '500.00'),
        ('PAY', 'LIABILITIES', 'leaf', accounts[5][2], 'current-liability', '500.00'),
        ('EQUITY', '', 'parent', 'Equity', 'equity', '700.00'),
        ('CAP', 'EQUITY', 'leaf', accounts[6][2], 'equity', '700.00'),
    ]
    statement = [row(**dict(zip(['Node ID', 'Parent ID', 'Kind', 'Line label', 'Line class', 'Amount'], node))) for node in nodes]
    return [tb, mapping, proof, statement]

# Expected rejection reasons are curated before any product implementation.
CASES = {
    'positive-nested': [], 'positive-reordered': [],
    'equal-amount-wrong-owner': ['MAPPING_PROOF'],
    'two-parents': ['DUPLICATE_NODE'],
    'parent-cycle': ['CYCLE'],
    'missing-zero-leaf': ['PROOF_LINE', 'MAPPING_TARGET'],
    'blank-zero-amount': ['MONEY'],
    'wrong-control-total': ['CONTROL_TOTAL'],
    'wrong-classification-balanced': ['CLASSIFICATION'],
    'expired-proof': ['VALIDITY'],
    'duplicate-mapping': ['DUPLICATE_MAPPING_ACCOUNT'],
    'unmapped-zero-account': ['UNMAPPED_ACCOUNT', 'UNMAPPED_LEAF'],
    'mapping-to-parent': ['MAPPING_TARGET'],
    'wrong-contra-sign': ['LEAF_TOTAL'],
    'late-unknown-row': ['KIND'],
    'foreign-scope': ['SCOPE'],
    'missing-parent': ['PARENT'],
    'subminor-value': ['MONEY'],
}

def cases():
    for name, required in CASES.items():
        tables = copy.deepcopy(bundle())
        tb, mapping, proof, statement = tables
        by_node = {r['Node ID']: r for r in statement}
        if name == 'equal-amount-wrong-owner':
            mapping[0]['Line ID'], mapping[1]['Line ID'] = mapping[1]['Line ID'], mapping[0]['Line ID']
        elif name == 'two-parents':
            duplicate = dict(by_node['CASH-A']); duplicate['Parent ID'] = 'ASSETS'; statement.append(duplicate)
        elif name == 'parent-cycle':
            by_node['ASSETS']['Parent ID'] = 'CASH'
        elif name == 'missing-zero-leaf':
            statement.remove(by_node['ZERO'])
        elif name == 'blank-zero-amount':
            by_node['ZERO']['Amount'] = ''
        elif name == 'wrong-control-total':
            by_node['CASH']['Amount'] = '1100.00'
        elif name == 'wrong-classification-balanced':
            proof[0]['Account class'] = 'current-liability'
        elif name == 'expired-proof':
            proof[0]['Valid to'] = '2026-09-29'
        elif name == 'duplicate-mapping':
            duplicate = dict(mapping[0]); duplicate['Mapping ID'] = 'M-COMPETITOR'; mapping.append(duplicate)
        elif name == 'unmapped-zero-account':
            mapping.pop(4)
        elif name == 'mapping-to-parent':
            mapping[0]['Line ID'] = 'CASH'; proof[0]['Line ID'] = 'CASH'
        elif name == 'wrong-contra-sign':
            mapping[3]['Sign'] = 'credit-positive'; proof[3]['Sign'] = 'credit-positive'
        elif name == 'late-unknown-row':
            unexpected = dict(statement[-1]); unexpected['Node ID'] = 'UNKNOWN'; unexpected['Kind'] = 'mystery'; statement.append(unexpected)
        elif name == 'foreign-scope':
            tb[-1]['Entity'] = 'OTHER-SYNTHETIC-ENTITY'
        elif name == 'missing-parent':
            by_node['ZERO']['Parent ID'] = 'ABSENT'
        elif name == 'subminor-value':
            tb[0]['Debit'] = '500.001'
        if name == 'positive-reordered':
            for table in tables:
                table.reverse()
        yield name, tables, required

def csv_bytes(table, reordered=False):
    columns = list(table[0])
    if reordered:
        columns.reverse()
    stream = io.StringIO(newline='')
    writer = csv.DictWriter(stream, fieldnames=columns, lineterminator='\n')
    writer.writeheader(); writer.writerows(table)
    return stream.getvalue().encode('utf-8')

def generate(destination):
    destination.mkdir(parents=True, exist_ok=True)
    index = {'generator': VERSION, 'synthetic': True, 'cases': []}
    for name, tables, required in cases():
        folder = destination / name; folder.mkdir(exist_ok=True)
        for role, table in zip(['trial-balance', 'proposed-mapping', 'presentation-evidence', 'financial-position'], tables):
            (folder / (role + '.csv')).write_bytes(csv_bytes(table, name == 'positive-reordered'))
        index['cases'].append({'id': name, 'expected': 'eligible' if not required else 'blocked', 'requiredCodes': required})
    (destination / 'cases.json').write_text(json.dumps(index, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--output', type=Path, required=True)
    generate(parser.parse_args().output)
