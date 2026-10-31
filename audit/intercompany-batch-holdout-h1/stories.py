"""IC-1 holdout H1: fifteen new intercompany-batch-1 stories, written after
the product supported the contract, sealed before any product run on them.

A new lineage: nothing is imported from the foundation's stories. Other
entities, numbering, accounts and periods; structures the foundation lacked
(an entity's ledger in two files, a pair declared for two accounts, partial
period overlap, a five-entity cycle, Persian digits, a case-only counterparty
mismatch, a ledger with an extra column, references with commas and quotes);
and four other CSV writers: Go encoding/csv, PHP fputcsv, LibreOffice Calc's
CSV export and a hand-written Java writer. Each story's intent was written by
hand from contract.json before the sealed oracle ran on these files.

  python3 -B audit/intercompany-batch-holdout-h1/stories.py > frozen/stories.json
"""
import json
import random
import sys

COMMON = ['functional', 'same-currency-no-conversion', 'posted', 'actual',
          '2027-03-01', '2027-03-31', '2027-03-31', 'GRP-IC-7']
VF, VT = '2027-01-01', '2027-12-31'
ENT = {
    'N': ('Nadir Industrial Co', 'NADIR-LEDGER', 'branch=JED'),
    'O': ('Orbit Logistics LLC', 'ORBIT-LEDGER', 'branch=DMM'),
    'P': ('Pillar Retail Est.', 'PILLAR-LEDGER', 'branch=RUH'),
    'Q': ('Quartz Services WLL', 'QUARTZ-LEDGER', 'branch=KWI'),
    'R': ('شركة ريادة للتجارة', 'دفتر ريادة', 'فرع=المدينة'),
}
BATCH_HEAD = ['Batch ID', 'Entity A', 'Entity B', 'Ledger A', 'Ledger B', 'Account A', 'Account B',
              'Dimensions A', 'Dimensions B', 'Currency', 'Currency basis', 'FX policy',
              'Posting status', 'Posting layer', 'Period start', 'Period end', 'As of', 'Policy version']
LEDGER_HEAD = ['Entity', 'Counterparty', 'Ledger', 'Account ID', 'Complete dimensions', 'Transaction ID',
               'Counterparty transaction ID', 'Posting date', 'Debit', 'Credit', 'Currency',
               'Currency basis', 'FX policy', 'Posting status', 'Posting layer', 'Period start',
               'Period end', 'As of', 'Policy version']
REL_HEAD = ['Relation ID', 'Batch ID', 'Side', 'Transaction ID', 'Relationship reference', 'Valid from', 'Valid to']
ZERO = {'SAR': '0.00', 'KWD': '0.000', 'JPY': '0', 'USD': '0.00'}


class Story:
    def __init__(self, sid, title, writer):
        self.id, self.title, self.writer = sid, title, writer
        self.batches, self.ledgers, self.relations = [], {}, []
        self.extra_columns = {}
        self.blank_relation_rows = []

    def batch(self, bid, a, b, acc_a, acc_b, currency='SAR', period=None):
        ea, eb = ENT[a], ENT[b]
        common = list(COMMON)
        if period:
            common[4], common[5], common[6] = period[0], period[1], period[1]
        self.batches.append({'bid': bid, 'a': a, 'b': b, 'values': [
            bid, ea[0], eb[0], ea[1], eb[1], acc_a, acc_b, ea[2], eb[2], currency, *common]})

    def find(self, bid):
        return next(b for b in self.batches if b['bid'] == bid)

    def row(self, bid, side, tx, cp, date, dr=None, cr=None, file=None, **over):
        b = self.find(bid)
        v = b['values']
        me = b['a'] if side == 'A' else b['b']
        i = 0 if side == 'A' else 1
        cells = {'Entity': v[1 + i], 'Counterparty': v[2 - i], 'Ledger': v[3 + i], 'Account ID': v[5 + i],
                 'Complete dimensions': v[7 + i], 'Transaction ID': tx, 'Counterparty transaction ID': cp,
                 'Posting date': date, 'Debit': dr or ZERO[v[9]], 'Credit': cr or ZERO[v[9]]}
        cells.update(zip(LEDGER_HEAD[10:], v[9:]))
        cells.update(over)
        self.ledgers.setdefault(file or me, []).append(cells)

    def rel(self, rid, bid, members, ref, vf=VF, vt=VT):
        for side, tx in members:
            self.relations.append([rid, bid, side, tx, ref, vf, vt])

    def files(self):
        out = [{'name': f'{self.id}-batches.csv', 'cells': [BATCH_HEAD, *[b['values'] for b in self.batches]]}]
        for n, key in enumerate(self.ledgers, 1):
            head = LEDGER_HEAD + self.extra_columns.get(key, [])
            out.append({'name': f'{self.id}-ledger-{n}.csv',
                        'cells': [head, *[[r.get(h, '') for h in head] for r in self.ledgers[key]]]})
        rows = [REL_HEAD, *self.relations]
        for at in sorted(self.blank_relation_rows, reverse=True):
            rows.insert(at, [''] * len(REL_HEAD))
        out.append({'name': f'{self.id}-relations.csv', 'cells': rows})
        for f in out:
            f['writer'] = self.writer
        return out

    def done(self, batches, residuals, unassigned=0, run=(), invalid=(), recipe=''):
        """invalid: relations whose every row the contract refuses (RELATION_FIELD), so
        no relation by that key is reported."""
        rels = {}
        for rid, bid, side, tx, *_ in self.relations:
            if f'{bid}/{rid}' not in invalid:
                rels.setdefault(f'{bid}/{rid}', {'A': [], 'B': []})[side].append(tx)
        assert set(residuals) == set(rels), (self.id, sorted(set(residuals) ^ set(rels)))
        self.intent = {
            'batches': {k: [v[0], sorted(v[1])] for k, v in batches.items()},
            'relations': {k: {'residual': r, 'members': rels[k] if r is not None else None}
                          for k, r in residuals.items()},
            'unassigned': unassigned,
            'run': sorted(run),
        }
        self.recipe = recipe
        return self


def stories():
    out = []

    s = Story('H01', 'Five entities, ten declared pairs, one pair with nothing in the period', 'go')
    pairs = ['NO', 'NP', 'NQ', 'NR', 'OP', 'OQ', 'OR', 'PQ', 'PR', 'QR']
    for k, p in enumerate(pairs):
        s.batch(f'B-{p}', p[0], p[1], f'IC-REC-{k:02d}', f'IC-PAY-{k:02d}')
    want, res = {}, {}
    for k, p in enumerate(pairs):
        bid = f'B-{p}'
        if p == 'PR':
            want[bid] = ('missing', ['SIDE_EMPTY'])
            continue
        for j in range(1 + k % 3):
            amount = f'{(k + 1) * 1000 + j * 37}.{(k * 7 + j) % 100:02d}'
            ta, tb = f'{p[0]}-{k:02d}{j}', f'{p[1]}-{k:02d}{j}'
            s.row(bid, 'A', ta, tb, f'2027-03-{3 + j:02d}', dr=amount)
            s.row(bid, 'B', tb, ta, f'2027-03-{4 + j:02d}', cr=amount)
            s.rel(f'L-{k:02d}{j}', bid, [('A', ta), ('B', tb)], f'Group charge {p} {j}')
            res[f'{bid}/L-{k:02d}{j}'] = 0
        want[bid] = ('ready', [])
    out.append(s.done(want, res))

    s = Story('H02', "Nadir's ledger in two files, one row copied into both", 'php')
    s.batch('B-NO', 'N', 'O', '1510', '2510')
    s.batch('B-NP', 'N', 'P', '1520', '2520')
    s.row('B-NO', 'A', 'N-201', 'O-201', '2027-03-05', dr='4100.00', file='N-early')
    s.row('B-NP', 'A', 'N-202', 'P-202', '2027-03-08', dr='950.00', file='N-early')
    s.row('B-NO', 'A', 'N-203', 'O-203', '2027-03-22', dr='600.00', file='N-late')
    s.row('B-NP', 'A', 'N-202', 'P-202', '2027-03-08', dr='950.00', file='N-late')
    s.row('B-NO', 'B', 'O-201', 'N-201', '2027-03-06', cr='4100.00')
    s.row('B-NO', 'B', 'O-203', 'N-203', '2027-03-23', cr='600.00')
    s.row('B-NP', 'B', 'P-202', 'N-202', '2027-03-09', cr='950.00')
    s.rel('L-201', 'B-NO', [('A', 'N-201'), ('B', 'O-201')], 'Freight March')
    s.rel('L-203', 'B-NO', [('A', 'N-203'), ('B', 'O-203')], 'Freight March, late')
    s.rel('L-202', 'B-NP', [('A', 'N-202'), ('B', 'P-202')], 'Display units')
    out.append(s.done({'B-NO': ('ready', []), 'B-NP': ('blocked', ['DUPLICATE_TRANSACTION'])},
                      {'B-NO/L-201': 0, 'B-NO/L-203': 0, 'B-NP/L-202': None},
                      recipe='Two files for one entity are fine; the same transaction in both is not.'))

    s = Story('H03', 'Arabic batch IDs, references with commas, quotes and line breaks', 'libreoffice')
    s.batch('دفعة ن-ر 2027', 'N', 'R', '1530', '2530')
    s.batch('B-OR', 'O', 'R', '1540', '2540')
    s.row('دفعة ن-ر 2027', 'A', 'N-301', 'ر-301', '2027-03-10', dr='12750.40')
    s.row('دفعة ن-ر 2027', 'B', 'ر-301', 'N-301', '2027-03-11', cr='12750.40')
    s.row('B-OR', 'A', 'O-302', 'ر-302', '2027-03-12', dr='300.00')
    s.row('B-OR', 'B', 'ر-302', 'O-302', '2027-03-13', cr='310.00')
    s.rel('L/301', 'دفعة ن-ر 2027', [('A', 'N-301'), ('B', 'ر-301')], 'Invoice "N-301", lot 4, line 2')
    s.rel('L/302', 'B-OR', [('A', 'O-302'), ('B', 'ر-302')], 'Storage fee\nsecond line of the note')
    out.append(s.done({'دفعة ن-ر 2027': ('ready', []), 'B-OR': ('blocked', ['RELATION_FIELD'])},
                      {'دفعة ن-ر 2027/L/301': 0}, invalid={'B-OR/L/302'},
                      recipe='A quoted line break stays in its cell, and a reference may not hold one.'))

    s = Story('H04', 'The same pair declared for March and for mid-March to mid-April', 'go')
    s.batch('B-OP-MAR', 'O', 'P', '1550', '2550')
    s.batch('B-OP-MID', 'O', 'P', '1550', '2550', period=('2027-03-15', '2027-04-14'))
    s.batch('B-OQ', 'O', 'Q', '1560', '2560')
    s.row('B-OP-MAR', 'A', 'O-401', 'P-401', '2027-03-05', dr='800.00')
    s.row('B-OP-MAR', 'B', 'P-401', 'O-401', '2027-03-06', cr='800.00')
    s.row('B-OQ', 'A', 'O-402', 'Q-402', '2027-03-07', dr='75.50')
    s.row('B-OQ', 'B', 'Q-402', 'O-402', '2027-03-08', cr='75.50')
    s.rel('L-401', 'B-OP-MAR', [('A', 'O-401'), ('B', 'P-401')], 'Handling')
    s.rel('L-402', 'B-OQ', [('A', 'O-402'), ('B', 'Q-402')], 'Courier')
    out.append(s.done({'B-OP-MAR': ('blocked', ['BATCH_OVERLAP']), 'B-OP-MID': ('blocked', ['BATCH_OVERLAP']),
                       'B-OQ': ('ready', [])},
                      {'B-OP-MAR/L-401': None, 'B-OQ/L-402': 0},
                      recipe='Periods that share days overlap even when they differ.'))

    s = Story('H05', 'Three entries against three, beside an equal decoy relation', 'php')
    s.batch('B-PQ', 'P', 'Q', '1570', '2570')
    s.batch('B-PN', 'P', 'N', '1580', '2580')
    for i, a in enumerate(['1000.00', '2000.00', '3000.00']):
        s.row('B-PQ', 'A', f'P-50{i}', f'Q-50{i}', f'2027-03-1{i}', dr=a)
    for i, b in enumerate(['1500.00', '2500.00', '2000.00']):
        s.row('B-PQ', 'B', f'Q-50{i}', f'P-50{i}', f'2027-03-1{i + 3}', cr=b)
    s.row('B-PQ', 'A', 'P-509', 'Q-509', '2027-03-20', dr='2000.00')
    s.row('B-PQ', 'B', 'Q-509', 'P-509', '2027-03-21', cr='2000.00')
    s.rel('L-50', 'B-PQ', [('A', 'P-500'), ('A', 'P-501'), ('A', 'P-502'),
                           ('B', 'Q-500'), ('B', 'Q-501'), ('B', 'Q-502')], 'Consignment settlement')
    s.rel('L-59', 'B-PQ', [('A', 'P-509'), ('B', 'Q-509')], 'Separate invoice')
    s.row('B-PN', 'A', 'P-510', 'N-510', '2027-03-15', dr='420.00')
    s.row('B-PN', 'B', 'N-510', 'P-510', '2027-03-16', cr='400.00')
    s.rel('L-51', 'B-PN', [('A', 'P-510'), ('B', 'N-510')], 'Samples')
    out.append(s.done({'B-PQ': ('ready', []), 'B-PN': ('difference', [])},
                      {'B-PQ/L-50': 0, 'B-PQ/L-59': 0, 'B-PN/L-51': 2000}))

    s = Story('H06', 'Persian and Arabic-Indic digits, Kuwaiti dinars with three decimals', 'libreoffice')
    s.batch('B-QR', 'Q', 'R', '1590', '2590', currency='KWD')
    s.batch('B-QN', 'Q', 'N', '1600', '2600')
    s.row('B-QR', 'A', 'Q-601', 'ر-601', '2027-03-04', dr='۱۲۳۴٫۵۶۷', cr='۰٫۰۰۰')
    s.row('B-QR', 'B', 'ر-601', 'Q-601', '2027-03-05', dr='٠٫٠٠٠', cr='١٢٣٤٫٥٦٧')
    s.row('B-QN', 'A', 'Q-602', 'N-602', '2027-03-06', dr='۸۸۰٫۵۰', cr='0.00')
    s.row('B-QN', 'B', 'N-602', 'Q-602', '2027-03-07', cr='880.05')
    s.rel('L-601', 'B-QR', [('A', 'Q-601'), ('B', 'ر-601')], 'خدمات تقنية مارس')
    s.rel('L-602', 'B-QN', [('A', 'Q-602'), ('B', 'N-602')], 'Consulting')
    out.append(s.done({'B-QR': ('ready', []), 'B-QN': ('difference', [])},
                      {'B-QR/L-601': 0, 'B-QN/L-602': 45},
                      recipe='880.50 against 880.05: a transposed figure, 0.45 SAR.'))

    s = Story('H07', 'A relation valid from mid-March only', 'java')
    s.batch('B-NO', 'N', 'O', '1610', '2610')
    s.batch('B-NQ', 'N', 'Q', '1620', '2620')
    s.row('B-NO', 'A', 'N-701', 'O-701', '2027-03-20', dr='2300.00')
    s.row('B-NO', 'B', 'O-701', 'N-701', '2027-03-21', cr='2300.00')
    s.row('B-NQ', 'A', 'N-702', 'Q-702', '2027-03-02', dr='99.99')
    s.row('B-NQ', 'B', 'Q-702', 'N-702', '2027-03-03', cr='99.99')
    s.rel('L-701', 'B-NO', [('A', 'N-701'), ('B', 'O-701')], 'Agreement from 15 March', vf='2027-03-15')
    s.rel('L-702', 'B-NQ', [('A', 'N-702'), ('B', 'Q-702')], 'Annual agreement')
    out.append(s.done({'B-NO': ('blocked', ['VALIDITY']), 'B-NQ': ('ready', [])},
                      {'B-NO/L-701': None, 'B-NQ/L-702': 0}))

    s = Story('H08', 'A row with debit and credit, and yen with a decimal', 'go')
    s.batch('B-OP', 'O', 'P', '1630', '2630')
    s.batch('B-OQ-JPY', 'O', 'Q', '1640', '2640', currency='JPY')
    s.batch('B-OR', 'O', 'R', '1650', '2650')
    s.row('B-OP', 'A', 'O-801', 'P-801', '2027-03-09', dr='500.00', cr='20.00')
    s.row('B-OP', 'B', 'P-801', 'O-801', '2027-03-10', cr='480.00')
    s.row('B-OQ-JPY', 'A', 'O-802', 'Q-802', '2027-03-11', dr='125000.5')
    s.row('B-OQ-JPY', 'B', 'Q-802', 'O-802', '2027-03-12', cr='125000')
    s.row('B-OR', 'A', 'O-803', 'ر-803', '2027-03-13', dr='60.00')
    s.row('B-OR', 'B', 'ر-803', 'O-803', '2027-03-14', cr='60.00')
    s.rel('L-801', 'B-OP', [('A', 'O-801'), ('B', 'P-801')], 'Net of discount')
    s.rel('L-802', 'B-OQ-JPY', [('A', 'O-802'), ('B', 'Q-802')], 'Tokyo office')
    s.rel('L-803', 'B-OR', [('A', 'O-803'), ('B', 'ر-803')], 'Postage')
    out.append(s.done({'B-OP': ('blocked', ['BOTH_SIDES']), 'B-OQ-JPY': ('blocked', ['AMOUNT']),
                       'B-OR': ('ready', [])},
                      {'B-OP/L-801': None, 'B-OQ-JPY/L-802': None, 'B-OR/L-803': 0}))

    s = Story('H09', 'A counterparty written in other letter case', 'php')
    s.batch('B-NO', 'N', 'O', '1660', '2660')
    s.batch('B-NP', 'N', 'P', '1670', '2670')
    s.batch('B-OP', 'O', 'P', '1680', '2680')
    s.row('B-NO', 'A', 'N-901', 'O-901', '2027-03-15', dr='7000.00')
    s.row('B-NO', 'A', 'N-903', 'O-903', '2027-03-18', dr='15.00', Counterparty='orbit logistics llc')
    s.row('B-NP', 'A', 'N-902', 'P-902', '2027-03-16', dr='310.00')
    s.row('B-NO', 'B', 'O-901', 'N-901', '2027-03-16', cr='7000.00')
    s.row('B-OP', 'A', 'O-904', 'P-904', '2027-03-17', dr='44.00')
    s.row('B-NP', 'B', 'P-902', 'N-902', '2027-03-17', cr='310.00')
    s.row('B-OP', 'B', 'P-904', 'O-904', '2027-03-18', cr='44.00')
    s.rel('L-901', 'B-NO', [('A', 'N-901'), ('B', 'O-901')], 'Machine rental')
    s.rel('L-902', 'B-NP', [('A', 'N-902'), ('B', 'P-902')], 'Shelving')
    s.rel('L-904', 'B-OP', [('A', 'O-904'), ('B', 'P-904')], 'Pallets')
    out.append(s.done({'B-NO': ('blocked', ['UNASSIGNED']), 'B-NP': ('blocked', ['UNASSIGNED']),
                       'B-OP': ('ready', [])},
                      {'B-NO/L-901': None, 'B-NP/L-902': None, 'B-OP/L-904': 0}, unassigned=1,
                      recipe='Identity is matched character for character; a case change is not the same counterparty.'))

    s = Story('H10', 'Blank lines among relation rows, and one relation ID with a leading space', 'java')
    s.batch('B-PR', 'P', 'R', '1690', '2690')
    s.batch('B-PQ', 'P', 'Q', '1700', '2700')
    s.row('B-PR', 'A', 'P-1001', 'ر-1001', '2027-03-19', dr='1800.00')
    s.row('B-PR', 'B', 'ر-1001', 'P-1001', '2027-03-20', cr='1800.00')
    s.row('B-PQ', 'A', 'P-1002', 'Q-1002', '2027-03-21', dr='250.00')
    s.row('B-PQ', 'B', 'Q-1002', 'P-1002', '2027-03-22', cr='250.00')
    s.row('B-PQ', 'A', 'P-1003', 'Q-1003', '2027-03-23', dr='35.00')
    s.row('B-PQ', 'B', 'Q-1003', 'P-1003', '2027-03-24', cr='35.00')
    s.rel('L-1001', 'B-PR', [('A', 'P-1001'), ('B', 'ر-1001')], 'Rent')
    s.rel('L-1002', 'B-PQ', [('A', 'P-1002')], 'Insurance')
    s.rel(' L-1002', 'B-PQ', [('B', 'Q-1002')], 'Insurance')
    s.rel('L-1003', 'B-PQ', [('A', 'P-1003'), ('B', 'Q-1003')], 'Water')
    s.blank_relation_rows = [2, 5]
    out.append(s.done({'B-PR': ('ready', []), 'B-PQ': ('blocked', ['COUNTERPARTY_CONFLICT', 'RELATION_FIELD'])},
                      {'B-PR/L-1001': 0, 'B-PQ/L-1002': None, 'B-PQ/L-1003': None}, invalid={'B-PQ/ L-1002'},
                      recipe='The invalid row is no member: L-1002 is left one-sided and P-1002 names Q-1002 outside it.'))

    s = Story('H11', 'One ledger file carries an extra Notes column', 'go')
    s.batch('B-NO', 'N', 'O', '1710', '2710')
    s.batch('B-OP', 'O', 'P', '1720', '2720')
    s.row('B-NO', 'A', 'N-1101', 'O-1101', '2027-03-05', dr='500.00')
    s.row('B-NO', 'B', 'O-1101', 'N-1101', '2027-03-06', cr='500.00')
    s.row('B-OP', 'A', 'O-1102', 'P-1102', '2027-03-07', dr='90.00')
    s.row('B-OP', 'B', 'P-1102', 'O-1102', '2027-03-08', cr='90.00', Notes='checked by AP')
    s.extra_columns = {'P': ['Notes']}
    s.rel('L-1101', 'B-NO', [('A', 'N-1101'), ('B', 'O-1101')], 'Fuel')
    s.rel('L-1102', 'B-OP', [('A', 'O-1102'), ('B', 'P-1102')], 'Fuel')
    out.append(s.done({'B-NO': ('blocked', ['HEADER']), 'B-OP': ('blocked', ['HEADER'])},
                      {'B-NO/L-1101': None, 'B-OP/L-1102': None}, run=['HEADER'],
                      recipe="A file that is not its role's columns holds every batch."))

    s = Story('H12', 'A five-entity cycle whose differences sum to zero', 'libreoffice')
    cycle = ['NO', 'OP', 'PQ', 'QR', 'RN']
    deltas = [120000, -50000, -30000, 25000, -65000]
    want, res = {}, {}
    for k, (p, dlt) in enumerate(zip(cycle, deltas)):
        bid = f'C-{p}'
        s.batch(bid, p[0], p[1], f'{1800 + k}', f'{2800 + k}')
        a = 5000000 + k * 100000
        b = a - dlt
        ta, tb = f'{p[0]}-C{k}', f'{p[1]}-C{k}'
        s.row(bid, 'A', ta, tb, f'2027-03-{10 + k:02d}', dr=f'{a // 100}.{a % 100:02d}')
        s.row(bid, 'B', tb, ta, f'2027-03-{11 + k:02d}', cr=f'{b // 100}.{b % 100:02d}')
        s.rel(f'L-C{k}', bid, [('A', ta), ('B', tb)], f'Cycle {p}')
        want[bid] = ('difference', [])
        res[f'{bid}/L-C{k}'] = dlt
    assert sum(deltas) == 0
    out.append(s.done(want, res, recipe='Every pair differs; the group sums to zero.'))

    s = Story('H13', 'One pair declared for two accounts; a relation names the other account\'s row', 'java')
    s.batch('B-NO-TRADE', 'N', 'O', '1900', '2900')
    s.batch('B-NO-LOAN', 'N', 'O', '1950', '2950')
    s.row('B-NO-TRADE', 'A', 'N-1301', 'O-1301', '2027-03-08', dr='640.00')
    s.row('B-NO-TRADE', 'B', 'O-1301', 'N-1301', '2027-03-09', cr='640.00')
    s.row('B-NO-LOAN', 'A', 'N-1302', 'O-1302', '2027-03-10', dr='50000.00')
    s.row('B-NO-LOAN', 'B', 'O-1302', 'N-1302', '2027-03-11', cr='50000.00')
    s.rel('L-1301', 'B-NO-TRADE', [('A', 'N-1301'), ('B', 'O-1301')], 'Spare parts')
    s.rel('L-1302', 'B-NO-TRADE', [('A', 'N-1302'), ('B', 'O-1302')], 'Loan drawdown')
    out.append(s.done({'B-NO-TRADE': ('missing', ['RELATION_MEMBER_MISSING']),
                       'B-NO-LOAN': ('missing', ['UNRELATED'])},
                      {'B-NO-TRADE/L-1301': 0, 'B-NO-TRADE/L-1302': None},
                      recipe='Accounts separate the batches; the loan relation was filed under trade.'))

    s = Story('H14', "A four-part settlement whose last part's counterparty number points elsewhere", 'php')
    s.batch('B-QR', 'Q', 'R', '1960', '2960')
    s.batch('B-QP', 'Q', 'P', '1970', '2970')
    s.row('B-QR', 'A', 'Q-1400', 'ر-1401', '2027-03-02', dr='4000.00')
    for i, amt in enumerate(['1000.00', '1000.00', '1000.00', '1000.00'], 1):
        s.row('B-QR', 'B', f'ر-140{i}', 'Q-1400' if i < 4 else 'Q-1409', f'2027-03-0{2 + i}', cr=amt)
    s.row('B-QR', 'A', 'Q-1409', 'ر-1409', '2027-03-09', dr='500.00')
    s.row('B-QR', 'B', 'ر-1409', 'Q-1409', '2027-03-10', cr='500.00')
    s.rel('L-1400', 'B-QR', [('A', 'Q-1400'), ('B', 'ر-1401'), ('B', 'ر-1402'), ('B', 'ر-1403'), ('B', 'ر-1404')],
          'Settlement in four parts')
    s.rel('L-1409', 'B-QR', [('A', 'Q-1409'), ('B', 'ر-1409')], 'Separate order')
    s.row('B-QP', 'A', 'Q-1410', 'P-1410', '2027-03-11', dr='12.00')
    s.row('B-QP', 'B', 'P-1410', 'Q-1410', '2027-03-12', cr='12.00')
    s.rel('L-1410', 'B-QP', [('A', 'Q-1410'), ('B', 'P-1410')], 'Stationery')
    out.append(s.done({'B-QR': ('blocked', ['COUNTERPARTY_CONFLICT']), 'B-QP': ('ready', [])},
                      {'B-QR/L-1400': None, 'B-QR/L-1409': None, 'B-QP/L-1410': 0}))

    out.append(scale())
    return out


def scale():
    """Four entities, six batches of thirty relations each, written by Java."""
    rng = random.Random(4417)
    s = Story('H15', 'Four entities, six batches, 180 relations of mixed shapes', 'java')
    pairs = [('N', 'O'), ('N', 'P'), ('N', 'Q'), ('O', 'P'), ('O', 'Q'), ('P', 'Q')]
    shapes = [(1, 1), (1, 2), (2, 1), (2, 2), (1, 4), (3, 3), (4, 1)]
    want, res = {}, {}
    for a, b in pairs:
        bid = f'S-{a}{b}'
        s.batch(bid, a, b, f'13{ord(a)}', f'23{ord(b)}')
        for k in range(30):
            na, nb = shapes[rng.randrange(len(shapes))]
            total = rng.randrange(5000, 9000000)
            delta = 0
            if (bid, k) in {('S-NQ', 7), ('S-OP', 22)}:
                delta = rng.randrange(1, 900)
            parts_a = split(rng, total, na)
            parts_b = split(rng, total - delta, nb)
            rid = f'{bid}-{k:02d}'
            members = []
            for i, p in enumerate(parts_a):
                tx = f'{a}{k:02d}{i}-{b}'
                s.row(bid, 'A', tx, f'{b}{k:02d}0-{a}', f'2027-03-{rng.randrange(1, 31):02d}', dr=money(p))
                members.append(('A', tx))
            for i, p in enumerate(parts_b):
                tx = f'{b}{k:02d}{i}-{a}'
                s.row(bid, 'B', tx, f'{a}{k:02d}0-{b}', f'2027-03-{rng.randrange(1, 31):02d}', cr=money(p))
                members.append(('B', tx))
            s.rel(rid, bid, members, f'Recharge {bid} {k:02d}')
            res[f'{bid}/{rid}'] = delta
        want[bid] = ('difference', []) if bid in ('S-NQ', 'S-OP') else ('ready', [])
    s.row('S-PQ', 'A', 'P999-Q', 'Q999-P', '2027-03-30', dr='1.00')
    want['S-PQ'] = ('missing', ['UNRELATED'])
    for rows in s.ledgers.values():
        rng.shuffle(rows)
    rng.shuffle(s.relations)
    return s.done(want, res, recipe='Two relations short by under 9 SAR; one row in no relation.')


def split(rng, total, n):
    cuts = sorted(rng.sample(range(1, total), n - 1))
    return [b - a for a, b in zip([0, *cuts], [*cuts, total])]


def money(minor):
    return f'{minor // 100}.{minor % 100:02d}'


def main():
    out = []
    for s in stories():
        out.append({'id': s.id, 'title': s.title, 'recipe': s.recipe, 'intent': s.intent, 'files': s.files()})
    sys.stdout.write(json.dumps({'schema': 'tarasuf-ic1-batch-holdout-stories/1', 'stories': out},
                                ensure_ascii=False, indent=1) + '\n')


if __name__ == '__main__':
    main()
