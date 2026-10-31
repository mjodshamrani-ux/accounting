"""IC-1 foundation stories: several group entities in one run, written as the
proposed intercompany-batch-1 contract (contract.json) reads them.

Each story names its files (batch declaration, one ledger per entity, relation
members), the CSV writer for each, and its intent: the status and codes of
every batch, the residual of every relation, and the number of unassigned
rows, written by hand from the contract before any oracle ran. Members of a
relation with a residual are the members it names. The scale story's intent
follows its recipe. All names, numbers and references are invented.

  python3 -B audit/intercompany-batch-foundation/stories.py > stories.json
"""
import json
import random
import sys

SCOPE = ['functional', 'same-currency-no-conversion', 'posted', 'actual',
         '2026-09-01', '2026-09-30', '2026-09-30', 'IC-1-2026']
VF, VT = '2026-01-01', '2026-12-31'
DECIMALS = {'SAR': 2, 'KWD': 3, 'JPY': 0}
ENT = {
    'A': ('Synthetic Alpha Holding', 'Alpha GL', 'cc=100'),
    'B': ('Synthetic Beta Trading', 'Beta GL', 'cc=200'),
    'G': ('Synthetic Gamma Services', 'Gamma GL', 'cc=300'),
    'D': ('Synthetic Delta Logistics', 'Delta GL', 'cc=400'),
}
BATCH_HEAD = ['Batch ID', 'Entity A', 'Entity B', 'Ledger A', 'Ledger B', 'Account A', 'Account B',
              'Dimensions A', 'Dimensions B', 'Currency', 'Currency basis', 'FX policy',
              'Posting status', 'Posting layer', 'Period start', 'Period end', 'As of', 'Policy version']
LEDGER_HEAD = ['Entity', 'Counterparty', 'Ledger', 'Account ID', 'Complete dimensions', 'Transaction ID',
               'Counterparty transaction ID', 'Posting date', 'Debit', 'Credit', 'Currency',
               'Currency basis', 'FX policy', 'Posting status', 'Posting layer', 'Period start',
               'Period end', 'As of', 'Policy version']
REL_HEAD = ['Relation ID', 'Batch ID', 'Side', 'Transaction ID', 'Relationship reference', 'Valid from', 'Valid to']
WRITERS = {'py', 'py-crlf-bom', 'node', 'ruby'}


class Story:
    def __init__(self, sid, title, writer, ents=None):
        self.id, self.title, self.writer = sid, title, writer
        self.ents = dict(ENT, **(ents or {}))
        self.batches, self.ledgers, self.relations = [], {}, []
        self.intent = None
        self.order = None
        self.permute = {}

    def batch(self, bid, a, b, acc_a, acc_b, currency='SAR', scope=None):
        ea, eb = self.ents[a], self.ents[b]
        row = dict(bid=bid, a=a, b=b, values=[bid, ea[0], eb[0], ea[1], eb[1], acc_a, acc_b, ea[2], eb[2],
                                              currency, *(scope or SCOPE)])
        self.batches.append(row)
        return row

    def zero(self, bid):
        d = DECIMALS[self.find(bid)['values'][9]]
        return '0.' + '0' * d if d else '0'

    def find(self, bid):
        return next(b for b in self.batches if b['bid'] == bid)

    def row(self, bid, side, tx, cp, date, dr=None, cr=None, file=None, **over):
        b = self.find(bid)
        v = b['values']
        me, other = (b['a'], b['b']) if side == 'A' else (b['b'], b['a'])
        i = 0 if side == 'A' else 1
        cells = {'Entity': v[1 + i], 'Counterparty': v[2 - i], 'Ledger': v[3 + i], 'Account ID': v[5 + i],
                 'Complete dimensions': v[7 + i], 'Transaction ID': tx, 'Counterparty transaction ID': cp,
                 'Posting date': date, 'Debit': dr or self.zero(bid), 'Credit': cr or self.zero(bid)}
        cells.update(zip(LEDGER_HEAD[10:], v[9:]))
        cells.update(over)
        self.ledgers.setdefault(file or me, []).append([cells[h] for h in LEDGER_HEAD])

    def rel(self, rid, bid, members, ref, vf=VF, vt=VT):
        for side, tx in members:
            self.relations.append([rid, bid, side, tx, ref, vf, vt])

    def files(self):
        out = [{'name': f'{self.id}-batches.csv', 'role': 'batch-declaration',
                'head': BATCH_HEAD, 'rows': [b['values'] for b in self.batches]}]
        order = self.order or list(self.ledgers)
        for n, key in enumerate(order, 1):
            out.append({'name': f'{self.id}-ledger-{n}.csv', 'role': 'entity-ledger',
                        'head': LEDGER_HEAD, 'rows': self.ledgers[key]})
        out.append({'name': f'{self.id}-relations.csv', 'role': 'relation-members',
                    'head': REL_HEAD, 'rows': self.relations})
        for f in out:
            f['writer'] = self.writer
            p = self.permute.get(f['role'])
            if p:
                f['head'] = [f['head'][i] for i in p]
                f['rows'] = [[r[i] for i in p] for r in f['rows']]
            f['cells'] = [f.pop('head'), *f.pop('rows')]
        return out

    def done(self, batches, residuals, unassigned=0, recipe=''):
        rels = {}
        for rid, bid, side, tx, *_ in self.relations:
            rels.setdefault(f'{bid}/{rid}', {'A': [], 'B': []})[side].append(tx)
        assert set(residuals) == set(rels), (self.id, set(residuals) ^ set(rels))
        self.intent = {
            'batches': {k: [v[0], sorted(v[1])] for k, v in batches.items()},
            'relations': {k: {'residual': r, 'members': rels[k] if r is not None else None}
                          for k, r in residuals.items()},
            'unassigned': unassigned,
        }
        self.recipe = recipe
        return self


def three(s, ab=('1350', '2350'), ag=('1350', '2360'), bg=('1355', '2360')):
    s.batch('AB', 'A', 'B', *ab)
    s.batch('AG', 'A', 'G', *ag)
    s.batch('BG', 'B', 'G', *bg)


def stories():
    out = []

    s = Story('I01', 'Three companies, equal amounts; Gamma never booked Alpha\'s charge', 'py')
    three(s)
    s.row('AB', 'A', 'A-0901', 'B-0901', '2026-09-05', dr='15000.00')
    s.row('AG', 'A', 'A-0902', 'G-0902', '2026-09-07', dr='15000.00')
    s.row('AB', 'B', 'B-0901', 'A-0901', '2026-09-06', cr='15000.00')
    s.row('BG', 'A', 'B-0903', 'G-0903', '2026-09-08', dr='15000.00')
    s.row('BG', 'B', 'G-0903', 'B-0903', '2026-09-09', cr='15000.00')
    s.rel('R-AB-01', 'AB', [('A', 'A-0901'), ('B', 'B-0901')], 'IC-INV-0901')
    s.rel('R-BG-01', 'BG', [('A', 'B-0903'), ('B', 'G-0903')], 'IC-INV-0903')
    s.rel('R-AG-01', 'AG', [('A', 'A-0902'), ('B', 'G-0902')], 'IC-INV-0902')
    out.append(s.done({'AB': ('ready', []), 'BG': ('ready', []),
                       'AG': ('missing', ['RELATION_MEMBER_MISSING', 'SIDE_EMPTY'])},
                      {'AB/R-AB-01': 0, 'BG/R-BG-01': 0, 'AG/R-AG-01': None},
                      recipe='Gamma\'s 15,000.00 from Beta must not stand in for Alpha\'s charge.'))

    s = Story('I02', 'An invoice split into two entries, beside an equal 4,000.00 invoice', 'node')
    s.batch('AB', 'A', 'B', '1350', '2350')
    s.row('AB', 'A', 'A-1001', 'B-2001', '2026-09-03', dr='10000.00')
    s.row('AB', 'A', 'A-1002', 'B-2003', '2026-09-10', dr='4000.00')
    s.row('AB', 'B', 'B-2001', 'A-1001', '2026-09-04', cr='6000.00')
    s.row('AB', 'B', 'B-2002', 'A-1001', '2026-09-04', cr='4000.00')
    s.row('AB', 'B', 'B-2003', 'A-1002', '2026-09-11', cr='4000.00')
    s.rel('R-1001', 'AB', [('A', 'A-1001'), ('B', 'B-2001'), ('B', 'B-2002')], 'Invoice A-1001 booked in two parts')
    s.rel('R-1002', 'AB', [('A', 'A-1002'), ('B', 'B-2003')], 'Invoice A-1002')
    out.append(s.done({'AB': ('ready', [])}, {'AB/R-1001': 0, 'AB/R-1002': 0},
                      recipe='B-2002 belongs to the split invoice, not to the equal invoice A-1002.'))

    s = Story('I03', 'Each side numbers the document its own way; the relation register links them', 'ruby')
    s.batch('AB', 'A', 'B', '1350', '2350')
    s.row('AB', 'A', 'A-3101', 'BETA-INV-77', '2026-09-12', dr='8250.50')
    s.row('AB', 'A', 'A-3102', 'BETA-INV-78', '2026-09-15', dr='1200.00')
    s.row('AB', 'B', 'JV-2026-0912', 'ALPHA-SO-5512', '2026-09-13', cr='8250.50')
    s.row('AB', 'B', 'JV-2026-0915', 'ALPHA-SO-5513', '2026-09-16', cr='1200.00')
    s.rel('R-3101', 'AB', [('A', 'A-3101'), ('B', 'JV-2026-0912')], 'Supplier invoice BETA-INV-77 for sales order ALPHA-SO-5512')
    s.rel('R-3102', 'AB', [('A', 'A-3102'), ('B', 'JV-2026-0915')], 'Supplier invoice BETA-INV-78 for sales order ALPHA-SO-5513')
    out.append(s.done({'AB': ('ready', [])}, {'AB/R-3101': 0, 'AB/R-3102': 0},
                      recipe='Counterparty numbers name no row on the other side: shown, not used.'))

    s = Story('I04', 'One recharge journal and reference for two counterparties', 'py-crlf-bom')
    s.batch('AB', 'A', 'B', '1350', '2350')
    s.batch('AG', 'A', 'G', '1350', '2360')
    s.row('AB', 'A', 'RC-77', 'B-RC-77', '2026-09-20', dr='2500.00')
    s.row('AG', 'A', 'RC-77', 'G-RC-77', '2026-09-20', dr='2500.00')
    s.row('AB', 'B', 'B-RC-77', 'RC-77', '2026-09-21', cr='2500.00')
    s.row('AG', 'B', 'G-RC-77', 'RC-77', '2026-09-22', cr='2400.00')
    s.rel('R-AB-RC77', 'AB', [('A', 'RC-77'), ('B', 'B-RC-77')], 'Shared services recharge RC-77')
    s.rel('R-AG-RC77', 'AG', [('A', 'RC-77'), ('B', 'G-RC-77')], 'Shared services recharge RC-77')
    out.append(s.done({'AB': ('ready', []), 'AG': ('difference', [])},
                      {'AB/R-AB-RC77': 0, 'AG/R-AG-RC77': 10000},
                      recipe='Same journal and reference in two batches: Gamma\'s 100.00 short stays in AG.'))

    s = Story('I05', 'A credit note booked by Alpha only', 'py')
    s.batch('AB', 'A', 'B', '1350', '2350')
    s.batch('AG', 'A', 'G', '1350', '2360')
    s.row('AB', 'A', 'A-5001', 'B-5001', '2026-09-05', dr='7000.00')
    s.row('AB', 'A', 'A-5002', 'B-CN-5002', '2026-09-25', cr='700.00')
    s.row('AB', 'B', 'B-5001', 'A-5001', '2026-09-06', cr='7000.00')
    s.row('AG', 'A', 'A-5003', 'G-5003', '2026-09-09', dr='640.00')
    s.row('AG', 'B', 'G-5003', 'A-5003', '2026-09-10', cr='640.00')
    s.rel('R-5001', 'AB', [('A', 'A-5001'), ('B', 'B-5001')], 'Invoice A-5001')
    s.rel('R-5002', 'AB', [('A', 'A-5002')], 'Credit note A-5002 against invoice A-5001, not yet booked by Beta')
    s.rel('R-5003', 'AG', [('A', 'A-5003'), ('B', 'G-5003')], 'Invoice A-5003')
    out.append(s.done({'AB': ('missing', ['RELATION_ONE_SIDED']), 'AG': ('ready', [])},
                      {'AB/R-5001': 0, 'AB/R-5002': None, 'AG/R-5003': 0}))

    s = Story('I06', 'A reversal that follows the earlier of two equal invoices', 'node')
    s.batch('AB', 'A', 'B', '1350', '2350')
    s.row('AB', 'A', 'INV-7', 'B-7', '2026-09-02', dr='3000.00')
    s.row('AB', 'A', 'INV-8', 'B-8', '2026-09-03', dr='3000.00')
    s.row('AB', 'A', 'REV-7', 'B-REV-7', '2026-09-18', cr='3000.00')
    s.row('AB', 'B', 'B-7', 'INV-7', '2026-09-03', cr='3000.00')
    s.row('AB', 'B', 'B-8', 'INV-8', '2026-09-04', cr='3000.00')
    s.row('AB', 'B', 'B-REV-7', 'REV-7', '2026-09-19', dr='3000.00')
    s.rel('R-7', 'AB', [('A', 'INV-7'), ('A', 'REV-7'), ('B', 'B-7'), ('B', 'B-REV-7')], 'Invoice INV-7 and its reversal REV-7')
    s.rel('R-8', 'AB', [('A', 'INV-8'), ('B', 'B-8')], 'Invoice INV-8')
    out.append(s.done({'AB': ('ready', [])}, {'AB/R-7': 0, 'AB/R-8': 0},
                      recipe='REV-7 reverses INV-7, not INV-8, the nearer invoice of the same amount.'))

    s = Story('I07', 'An Alpha row whose counterparty names two companies', 'ruby')
    three(s)
    s.row('AB', 'A', 'A-7001', 'B-7001', '2026-09-04', dr='5000.00')
    s.row('AG', 'A', 'A-7002', 'G-7002', '2026-09-05', dr='2000.00')
    s.row('AB', 'A', 'A-7003', 'B-OR-G-7003', '2026-09-06', dr='1000.00',
          Counterparty='Synthetic Beta Trading / Synthetic Gamma Services')
    s.row('AB', 'B', 'B-7001', 'A-7001', '2026-09-05', cr='5000.00')
    s.row('BG', 'A', 'B-7004', 'G-7004', '2026-09-07', dr='900.00')
    s.row('AG', 'B', 'G-7002', 'A-7002', '2026-09-06', cr='2000.00')
    s.row('BG', 'B', 'G-7004', 'B-7004', '2026-09-08', cr='900.00')
    s.rel('R-7001', 'AB', [('A', 'A-7001'), ('B', 'B-7001')], 'Invoice A-7001')
    s.rel('R-7002', 'AG', [('A', 'A-7002'), ('B', 'G-7002')], 'Invoice A-7002')
    s.rel('R-7004', 'BG', [('A', 'B-7004'), ('B', 'G-7004')], 'Invoice B-7004')
    out.append(s.done({'AB': ('blocked', ['UNASSIGNED']), 'AG': ('blocked', ['UNASSIGNED']), 'BG': ('ready', [])},
                      {'AB/R-7001': None, 'AG/R-7002': None, 'BG/R-7004': 0}, unassigned=1,
                      recipe='The unplaced Alpha row could be Beta\'s or Gamma\'s: both Alpha batches wait; BG does not.'))

    s = Story('I08', 'A three-part settlement with one part missing and an equal unrelated row', 'ruby')
    s.batch('AB', 'A', 'B', '1350', '2350')
    s.row('AB', 'A', 'A-8000', 'B-8001', '2026-09-10', dr='9000.00')
    s.row('AB', 'B', 'B-8001', 'A-8000', '2026-09-11', cr='4000.00')
    s.row('AB', 'B', 'B-8002', 'A-8000', '2026-09-11', cr='3000.00')
    s.row('AB', 'B', 'B-8009', 'A-8090', '2026-09-28', cr='2000.00')
    s.rel('R-8000', 'AB', [('A', 'A-8000'), ('B', 'B-8001'), ('B', 'B-8002'), ('B', 'B-8003')], 'Settlement of order A-8000 in three parts')
    out.append(s.done({'AB': ('missing', ['RELATION_MEMBER_MISSING', 'UNRELATED'])}, {'AB/R-8000': None},
                      recipe='Both sides total 9,000.00, but B-8003 is absent and B-8009 belongs to no relation.'))

    s = Story('I09', 'Relations that cross from one pair to another with equal amounts', 'node')
    three(s)
    s.row('AB', 'A', 'A-9001', 'BETA-DOC-9001', '2026-09-12', dr='4500.00')
    s.row('AG', 'A', 'A-9002', 'GAMMA-DOC-9002', '2026-09-12', dr='4500.00')
    s.row('AB', 'B', 'B-9001', 'ALPHA-DOC-9001', '2026-09-13', cr='4500.00')
    s.row('BG', 'A', 'B-9003', 'G-9003', '2026-09-14', dr='1100.00')
    s.row('AG', 'B', 'G-9002', 'ALPHA-DOC-9002', '2026-09-13', cr='4500.00')
    s.row('BG', 'B', 'G-9003', 'B-9003', '2026-09-15', cr='1100.00')
    s.rel('R-9001', 'AB', [('A', 'A-9001')], 'Cross-pair link 9001')
    s.rel('R-9001', 'AG', [('B', 'G-9002')], 'Cross-pair link 9001')
    s.rel('R-9002', 'AG', [('A', 'A-9002')], 'Cross-pair link 9002')
    s.rel('R-9002', 'AB', [('B', 'B-9001')], 'Cross-pair link 9002')
    s.rel('R-9003', 'BG', [('A', 'B-9003'), ('B', 'G-9003')], 'Invoice B-9003')
    out.append(s.done({'AB': ('blocked', ['RELATION_BATCHES']), 'AG': ('blocked', ['RELATION_BATCHES']),
                       'BG': ('ready', [])},
                      {'AB/R-9001': None, 'AG/R-9001': None, 'AG/R-9002': None, 'AB/R-9002': None, 'BG/R-9003': 0}))

    s = Story('I10', 'The group nets to zero while two pairs differ', 'py')
    three(s)
    s.row('AB', 'A', 'A-1010', 'B-1010', '2026-09-15', dr='12000.00')
    s.row('AG', 'A', 'A-1030', 'G-1030', '2026-09-17', dr='2500.00')
    s.row('AB', 'B', 'B-1010', 'A-1010', '2026-09-16', cr='11500.00')
    s.row('BG', 'A', 'B-1020', 'G-1020', '2026-09-18', dr='6000.00')
    s.row('AG', 'B', 'G-1030', 'A-1030', '2026-09-18', cr='2500.00')
    s.row('BG', 'B', 'G-1020', 'B-1020', '2026-09-19', cr='6500.00')
    s.rel('R-1010', 'AB', [('A', 'A-1010'), ('B', 'B-1010')], 'Invoice A-1010')
    s.rel('R-1020', 'BG', [('A', 'B-1020'), ('B', 'G-1020')], 'Invoice B-1020')
    s.rel('R-1030', 'AG', [('A', 'A-1030'), ('B', 'G-1030')], 'Invoice A-1030')
    i10 = s.done({'AB': ('difference', []), 'BG': ('difference', []), 'AG': ('ready', [])},
                 {'AB/R-1010': 50000, 'BG/R-1020': -50000, 'AG/R-1030': 0},
                 recipe='+500.00 in AB and -500.00 in BG: no batch offsets another.')
    out.append(i10)

    s = Story('I11', 'Beta booked one Alpha invoice twice and the register names it in two relations', 'ruby')
    s.batch('AB', 'A', 'B', '1350', '2350')
    s.batch('AG', 'A', 'G', '1350', '2360')
    s.row('AB', 'A', 'A-1101', 'BETA-DOC-1101', '2026-09-08', dr='3300.00')
    s.row('AG', 'A', 'A-1103', 'G-1103', '2026-09-09', dr='800.00')
    s.row('AB', 'B', 'B-1101', 'A-1101', '2026-09-09', cr='3300.00')
    s.row('AB', 'B', 'B-1102', 'A-1101', '2026-09-20', cr='3300.00')
    s.row('AG', 'B', 'G-1103', 'A-1103', '2026-09-10', cr='800.00')
    s.rel('R-1101', 'AB', [('A', 'A-1101'), ('B', 'B-1101')], 'Invoice A-1101')
    s.rel('R-1102', 'AB', [('A', 'A-1101'), ('B', 'B-1102')], 'Invoice A-1101 again')
    s.rel('R-1103', 'AG', [('A', 'A-1103'), ('B', 'G-1103')], 'Invoice A-1103')
    out.append(s.done({'AB': ('blocked', ['RELATION_DUPLICATE_MEMBER']), 'AG': ('ready', [])},
                      {'AB/R-1101': None, 'AB/R-1102': None, 'AG/R-1103': 0}))

    s = Story('I12', 'The same pair declared twice, once each way round', 'node')
    s.batch('AB-1', 'A', 'B', '1350', '2350')
    s.batch('AB-2', 'B', 'A', '2350', '1350')
    s.batch('AG', 'A', 'G', '1350', '2360')
    s.row('AB-1', 'A', 'A-1201', 'B-1201', '2026-09-11', dr='2000.00')
    s.row('AG', 'A', 'A-1202', 'G-1202', '2026-09-12', dr='700.00')
    s.row('AB-1', 'B', 'B-1201', 'A-1201', '2026-09-12', cr='2000.00')
    s.row('AG', 'B', 'G-1202', 'A-1202', '2026-09-13', cr='700.00')
    s.rel('R-1201', 'AB-1', [('A', 'A-1201'), ('B', 'B-1201')], 'Invoice A-1201')
    s.rel('R-1202', 'AG', [('A', 'A-1202'), ('B', 'G-1202')], 'Invoice A-1202')
    out.append(s.done({'AB-1': ('blocked', ['BATCH_OVERLAP', 'UNASSIGNED_AMBIGUOUS']),
                       'AB-2': ('blocked', ['BATCH_OVERLAP', 'UNASSIGNED_AMBIGUOUS']),
                       'AG': ('ready', [])},
                      {'AB-1/R-1201': None, 'AG/R-1202': 0}, unassigned=2))

    s = Story('I13', 'Alpha\'s counterparty numbers point across two equal relations', 'py-crlf-bom')
    s.batch('AB', 'A', 'B', '1350', '2350')
    s.batch('AG', 'A', 'G', '1350', '2360')
    s.row('AB', 'A', 'A-1301', 'B-1302', '2026-09-14', dr='1500.00')
    s.row('AB', 'A', 'A-1302', 'B-1301', '2026-09-14', dr='1500.00')
    s.row('AG', 'A', 'A-1303', 'G-1303', '2026-09-15', dr='600.00')
    s.row('AB', 'B', 'B-1301', 'A-1301', '2026-09-15', cr='1500.00')
    s.row('AB', 'B', 'B-1302', 'A-1302', '2026-09-15', cr='1500.00')
    s.row('AG', 'B', 'G-1303', 'A-1303', '2026-09-16', cr='600.00')
    s.rel('R-1301', 'AB', [('A', 'A-1301'), ('B', 'B-1301')], 'Invoice A-1301')
    s.rel('R-1302', 'AB', [('A', 'A-1302'), ('B', 'B-1302')], 'Invoice A-1302')
    s.rel('R-1303', 'AG', [('A', 'A-1303'), ('B', 'G-1303')], 'Invoice A-1303')
    out.append(s.done({'AB': ('blocked', ['COUNTERPARTY_CONFLICT']), 'AG': ('ready', [])},
                      {'AB/R-1301': None, 'AB/R-1302': None, 'AG/R-1303': 0}))

    s = Story('I14', 'Three batches in three currencies, sharing ledger files', 'ruby')
    s.batch('AB', 'A', 'B', '1350', '2350')
    s.batch('AG-KWD', 'A', 'G', '1351', '2361', currency='KWD')
    s.batch('BG-JPY', 'B', 'G', '1356', '2362', currency='JPY')
    s.row('AB', 'A', 'A-1401', 'B-1401', '2026-09-02', dr='18750.25')
    s.row('AG-KWD', 'A', 'A-1402', 'G-1402', '2026-09-03', dr='1250.125')
    s.row('AG-KWD', 'A', 'A-1404', 'G-1404', '2026-09-21', dr='310.500')
    s.row('AB', 'B', 'B-1401', 'A-1401', '2026-09-03', cr='18750.25')
    s.row('BG-JPY', 'A', 'B-1403', 'G-1403', '2026-09-04', dr='480000')
    s.row('AG-KWD', 'B', 'G-1402', 'A-1402', '2026-09-04', cr='1250.125')
    s.row('AG-KWD', 'B', 'G-1404', 'A-1404', '2026-09-22', cr='310.5')
    s.row('BG-JPY', 'B', 'G-1403', 'B-1403', '2026-09-05', cr='480000')
    s.rel('R-1401', 'AB', [('A', 'A-1401'), ('B', 'B-1401')], 'Invoice A-1401')
    s.rel('R-1402', 'AG-KWD', [('A', 'A-1402'), ('B', 'G-1402')], 'Invoice A-1402')
    s.rel('R-1404', 'AG-KWD', [('A', 'A-1404'), ('B', 'G-1404')], 'Invoice A-1404')
    s.rel('R-1403', 'BG-JPY', [('A', 'B-1403'), ('B', 'G-1403')], 'Invoice B-1403')
    out.append(s.done({'AB': ('ready', []), 'AG-KWD': ('ready', []), 'BG-JPY': ('ready', [])},
                      {'AB/R-1401': 0, 'AG-KWD/R-1402': 0, 'AG-KWD/R-1404': 0, 'BG-JPY/R-1403': 0},
                      recipe='Each batch reads its own currency\'s precision: 2, 3 and 0 decimals.'))

    s = Story('I15', 'Gamma\'s ledger was not supplied', 'py')
    three(s)
    s.row('AB', 'A', 'A-1501', 'B-1501', '2026-09-06', dr='2200.00')
    s.row('AG', 'A', 'A-1502', 'G-1502', '2026-09-07', dr='990.00')
    s.row('AB', 'B', 'B-1501', 'A-1501', '2026-09-07', cr='2200.00')
    s.rel('R-1501', 'AB', [('A', 'A-1501'), ('B', 'B-1501')], 'Invoice A-1501')
    s.rel('R-1502', 'AG', [('A', 'A-1502'), ('B', 'G-1502')], 'Invoice A-1502')
    out.append(s.done({'AB': ('ready', []), 'AG': ('missing', ['RELATION_MEMBER_MISSING', 'SIDE_EMPTY']),
                       'BG': ('missing', ['SIDE_EMPTY'])},
                      {'AB/R-1501': 0, 'AG/R-1502': None}))

    ar = {'A': ('شركة ألف القابضة', 'دفتر ألف', 'مركز=١٠٠'),
          'B': ('شركة باء للتجارة', 'دفتر باء', 'مركز=٢٠٠'),
          'G': ('شركة جيم للخدمات', 'دفتر جيم', 'مركز=٣٠٠')}
    s = Story('I16', 'Arabic names, Arabic-Indic amounts, columns in another order', 'node', ents=ar)
    s.batch('AB', 'A', 'B', '1350', '2350')
    s.batch('AG', 'A', 'G', '1350', '2360')
    s.row('AB', 'A', 'ق-2001', 'ب-3001', '2026-09-08', dr='٢٤٥٠٠٫٧٥', cr='٠٫٠٠')
    s.row('AG', 'A', 'ق-2002', 'ج-4001', '2026-09-09', dr='٨٨٠٠٫٠٠', cr='٠٫٠٠')
    s.row('AB', 'B', 'ب-3001', 'ق-2001', '2026-09-09', dr='٠٫٠٠', cr='٢٤٥٠٠٫٧٥')
    s.row('AG', 'B', 'ج-4001', 'ق-2002', '2026-09-10', dr='٠٫٠٠', cr='٨٧٥٠٫٠٠')
    s.rel('ع-1', 'AB', [('A', 'ق-2001'), ('B', 'ب-3001')], 'فاتورة خدمات مشتركة ٢٠٢٦/٠٩')
    s.rel('ع-2', 'AG', [('A', 'ق-2002'), ('B', 'ج-4001')], 'فاتورة إيجار مكتب ٢٠٢٦/٠٩')
    s.permute = {'entity-ledger': [5, 6, 0, 1, 2, 3, 4, 7, 9, 8, *range(10, 19)],
                 'relation-members': [1, 0, 3, 2, 4, 6, 5]}
    out.append(s.done({'AB': ('ready', []), 'AG': ('difference', [])}, {'AB/ع-1': 0, 'AG/ع-2': 5000}))

    out.append(scale())

    s = Story('I18', 'I10 again: rows shuffled, batches and files in another order, columns moved', 'ruby')
    s.batch('BG', 'B', 'G', '1355', '2360')
    s.batch('AG', 'A', 'G', '1350', '2360')
    s.batch('AB', 'A', 'B', '1350', '2350')
    s.row('BG', 'B', 'G-1020', 'B-1020', '2026-09-19', cr='6500.00')
    s.row('AG', 'B', 'G-1030', 'A-1030', '2026-09-18', cr='2500.00')
    s.row('BG', 'A', 'B-1020', 'G-1020', '2026-09-18', dr='6000.00')
    s.row('AB', 'B', 'B-1010', 'A-1010', '2026-09-16', cr='11500.00')
    s.row('AG', 'A', 'A-1030', 'G-1030', '2026-09-17', dr='2500.00')
    s.row('AB', 'A', 'A-1010', 'B-1010', '2026-09-15', dr='12000.00')
    s.rel('R-1030', 'AG', [('B', 'G-1030'), ('A', 'A-1030')], 'Invoice A-1030')
    s.rel('R-1020', 'BG', [('B', 'G-1020'), ('A', 'B-1020')], 'Invoice B-1020')
    s.rel('R-1010', 'AB', [('B', 'B-1010'), ('A', 'A-1010')], 'Invoice A-1010')
    s.order = ['G', 'B', 'A']
    s.permute = {'entity-ledger': [*range(10, 19), 9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
                 'batch-declaration': [0, *range(17, 0, -1)],
                 'relation-members': [6, 5, 4, 3, 2, 1, 0]}
    out.append(s.done({k: tuple(v) for k, v in i10.intent['batches'].items()},
                      {k: v['residual'] for k, v in i10.intent['relations'].items()},
                      recipe='A metamorphic twin of I10: every verdict and member the same.'))

    s = Story('I19', 'A posting after the period and a declaration with another currency basis', 'py-crlf-bom')
    s.batch('AB', 'A', 'B', '1350', '2350')
    s.batch('AG', 'A', 'G', '1350', '2360')
    s.batch('BG', 'B', 'G', '1355', '2360', scope=['transaction', *SCOPE[1:]])
    s.row('AB', 'A', 'A-1901', 'B-1901', '2026-10-02', dr='1000.00')
    s.row('AG', 'A', 'A-1902', 'G-1902', '2026-09-24', dr='450.00')
    s.row('AB', 'B', 'B-1901', 'A-1901', '2026-09-30', cr='1000.00')
    s.row('BG', 'A', 'B-1903', 'G-1903', '2026-09-25', dr='300.00')
    s.row('AG', 'B', 'G-1902', 'A-1902', '2026-09-25', cr='450.00')
    s.row('BG', 'B', 'G-1903', 'B-1903', '2026-09-26', cr='300.00')
    s.rel('R-1901', 'AB', [('A', 'A-1901'), ('B', 'B-1901')], 'Invoice A-1901')
    s.rel('R-1902', 'AG', [('A', 'A-1902'), ('B', 'G-1902')], 'Invoice A-1902')
    s.rel('R-1903', 'BG', [('A', 'B-1903'), ('B', 'G-1903')], 'Invoice B-1903')
    out.append(s.done({'AB': ('blocked', ['POSTING_PERIOD']), 'AG': ('ready', []),
                       'BG': ('blocked', ['BATCH_FIELD'])},
                      {'AB/R-1901': None, 'AG/R-1902': 0, 'BG/R-1903': None}))
    s = Story('I20', 'Two relations in one pair that offset each other', 'py')
    s.batch('AB', 'A', 'B', '1350', '2350')
    s.row('AB', 'A', 'A-2001', 'B-2001', '2026-09-03', dr='5300.00')
    s.row('AB', 'A', 'A-2002', 'B-2002', '2026-09-04', dr='1700.00')
    s.row('AB', 'B', 'B-2001', 'A-2001', '2026-09-04', cr='5000.00')
    s.row('AB', 'B', 'B-2002', 'A-2002', '2026-09-05', cr='2000.00')
    s.rel('R-2001', 'AB', [('A', 'A-2001'), ('B', 'B-2001')], 'Invoice A-2001')
    s.rel('R-2002', 'AB', [('A', 'A-2002'), ('B', 'B-2002')], 'Invoice A-2002')
    out.append(s.done({'AB': ('difference', [])}, {'AB/R-2001': 30000, 'AB/R-2002': -30000},
                      recipe='Both sides total 7,000.00, yet each invoice differs by 300.00.'))
    return out


def scale():
    """Four entities, all six pairs, mixed relation shapes. AD carries one
    difference; GD carries one row in no relation."""
    rng = random.Random(1717)
    s = Story('I17', 'Four entities, six batches, one-to-one to many-to-many relations', 'py')
    pairs = [('A', 'B'), ('A', 'G'), ('A', 'D'), ('B', 'G'), ('B', 'D'), ('G', 'D')]
    shapes = [(1, 1), (1, 2), (2, 1), (2, 2), (1, 3), (3, 2)]
    batches, residuals = {}, {}
    for a, b in pairs:
        bid = a + b
        s.batch(bid, a, b, '1300', '2300')
        for k in range(8):
            na, nb = shapes[(k + len(bid) * ord(a)) % len(shapes)]
            total = rng.randrange(10000, 2500000)
            parts_a = split(rng, total, na)
            delta = 1250 if (bid == 'AD' and k == 5) else 0
            parts_b = split(rng, total - delta, nb)
            rid = f'R-{bid}-{k + 1:02d}'
            members = []
            for i, p in enumerate(parts_a):
                tx = f'{a}-{bid}-{k + 1:02d}-{i + 1}'
                s.row(bid, 'A', tx, f'{b}-{bid}-{k + 1:02d}-1', f'2026-09-{rng.randrange(1, 29):02d}', dr=money(p))
                members.append(('A', tx))
            for i, p in enumerate(parts_b):
                tx = f'{b}-{bid}-{k + 1:02d}-{i + 1}'
                s.row(bid, 'B', tx, f'{a}-{bid}-{k + 1:02d}-1', f'2026-09-{rng.randrange(1, 29):02d}', cr=money(p))
                members.append(('B', tx))
            s.rel(rid, bid, members, f'Group invoice {bid}-{k + 1:02d}')
            residuals[f'{bid}/{rid}'] = delta
        batches[bid] = ('difference', []) if bid == 'AD' else ('ready', [])
    s.row('GD', 'B', 'D-GD-99-1', 'G-GD-99-1', '2026-09-29', cr='777.00')
    batches['GD'] = ('missing', ['UNRELATED'])
    for e in s.ledgers.values():
        rng.shuffle(e)
    return s.done(batches, residuals, recipe='Each relation\'s parts sum to its total; AD-06 is 12.50 short on side B.')


def split(rng, total, n):
    cuts = sorted(rng.sample(range(1, total), n - 1))
    return [b - a for a, b in zip([0, *cuts], [*cuts, total])]


def money(minor):
    return f'{minor // 100}.{minor % 100:02d}'


def main():
    out = []
    for s in stories():
        assert s.writer in WRITERS
        out.append({'id': s.id, 'title': s.title, 'recipe': s.recipe, 'intent': s.intent, 'files': s.files()})
    sys.stdout.write(json.dumps({'schema': 'tarasuf-ic1-batch-stories/1', 'stories': out},
                                ensure_ascii=False, indent=1) + '\n')


if __name__ == '__main__':
    main()
