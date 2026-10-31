"""The IC-1 oracle agrees with every hand-written intent, reads neither the
stories nor their intent, keeps its verdict when nothing decisive changes,
and moves it when one decisive fact moves, for each contract rule, including
the rules no story exercises.

  python3 -B -m unittest discover -s audit/intercompany-batch-foundation -p test_oracle.py -v
ORACLE=<path> runs the same tests on another copy of oracle.py (mutate_oracle.py).
"""
import csv
import importlib.util
import io
import json
import os
import random
import shutil
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
FROZEN = HERE / 'frozen'


def load():
    spec = importlib.util.spec_from_file_location('ic1_oracle', os.environ.get('ORACLE', HERE / 'oracle.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


oracle = load()
FACTS = json.loads((FROZEN / 'stories.json').read_text(encoding='utf-8'))


def summary(judged):
    return {
        'batches': {k: [v['status'], v['codes']] for k, v in judged['batches'].items()},
        'relations': {k: {'residual': v['residual'], 'members': v['members']}
                      for b in judged['batches'].values() for k, v in b['relations'].items()},
        'unassigned': len(judged['unassigned']),
    }


def canonical(judged):
    """The summary with each side's members as a set: row order is not evidence."""
    out = summary(judged)
    for r in out['relations'].values():
        if r['members']:
            r['members'] = {s: sorted(v) for s, v in r['members'].items()}
    return out


def statuses(judged):
    return {k: [v['status'], v['codes']] for k, v in judged['batches'].items()}


class Copy:
    """A private copy of one story's files, edited as CSV text."""

    def __init__(self, sid):
        self.sid = sid
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        for p in FROZEN.glob(f'{sid}-*.csv'):
            shutil.copy(p, self.dir / p.name)

    def rows(self, name):
        raw = (self.dir / f'{self.sid}-{name}.csv').read_bytes().decode('utf-8').lstrip('\ufeff')
        return list(csv.reader(io.StringIO(raw, newline='')))

    def write(self, name, rows):
        with (self.dir / f'{self.sid}-{name}.csv').open('w', encoding='utf-8', newline='') as f:
            csv.writer(f, lineterminator='\n').writerows(rows)

    def edit(self, name, match, column, value):
        rows = self.rows(name)
        col = rows[0].index(column)
        hits = [r for r in rows[1:] if all(r[rows[0].index(k)] == v for k, v in match.items())]
        assert len(hits) == 1, (name, match, len(hits))
        hits[0][col] = value
        self.write(name, rows)

    def append(self, name, values):
        rows = self.rows(name)
        rows.append([values[h] for h in rows[0]])
        self.write(name, rows)

    def judge(self):
        return oracle.story(self.dir, self.sid)

    def close(self):
        self.tmp.cleanup()


class Oracle(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.result = oracle.run(FROZEN)['stories']

    def changed(self, sid, *edits):
        c = Copy(sid)
        try:
            for e in edits:
                e(c)
            try:
                return c.judge()
            except Exception as error:  # the oracle must judge any input it is given
                self.fail(f'the oracle stopped on {sid}: {error!r}')
        finally:
            c.close()

    def test_agrees_with_every_intent(self):
        self.assertEqual(sorted(self.result), sorted(s['id'] for s in FACTS['stories']))
        for story in FACTS['stories']:
            with self.subTest(story=story['id']):
                self.assertEqual(summary(self.result[story['id']]), story['intent'])

    def test_reads_neither_stories_nor_intent(self):
        with tempfile.TemporaryDirectory() as tmp:
            for p in FROZEN.glob('*.csv'):
                shutil.copy(p, Path(tmp) / p.name)
            self.assertEqual(oracle.run(tmp)['stories'], self.result)

    def test_metamorphic_order_keeps_every_verdict_and_member(self):
        rng = random.Random(20)
        for sid in ('I02', 'I07', 'I09', 'I12', 'I17', 'I20'):
            c = Copy(sid)
            try:
                for p in sorted(c.dir.glob('*.csv')):
                    name = p.stem.split('-', 1)[1]
                    rows = c.rows(name)
                    order = list(range(len(rows[0])))
                    rng.shuffle(order)
                    body = rows[1:]
                    rng.shuffle(body)
                    c.write(name, [[r[i] for i in order] for r in [rows[0], *body]])
                with self.subTest(story=sid):
                    self.assertEqual(canonical(c.judge()), canonical(self.result[sid]))
            finally:
                c.close()

    def test_i18_is_i10(self):
        self.assertEqual(summary(self.result['I18']), summary(self.result['I10']))

    def test_member_rows_are_the_named_transactions(self):
        r = self.result['I02']['batches']['AB']['relations']['AB/R-1001']
        self.assertEqual(r['members'], {'A': ['A-1001'], 'B': ['B-2001', 'B-2002']})
        self.assertEqual(r['net'], {'A': 1000000, 'B': -1000000})
        self.assertEqual([x[0] for x in r['rows']['B']], ['I02-ledger-2.csv'] * 2)

    # A decisive fact moves the verdict.
    def test_the_short_payment_completed_closes_the_pair(self):
        j = self.changed('I10', lambda c: c.edit('ledger-2', {'Transaction ID': 'B-1010'}, 'Credit', '12000.00'))
        self.assertEqual(statuses(j)['AB'], ['ready', []])
        self.assertEqual(statuses(j)['BG'], ['difference', []])

    def test_a_clear_counterparty_places_the_row(self):
        j = self.changed('I07', lambda c: c.edit('ledger-1', {'Transaction ID': 'A-7003'}, 'Counterparty',
                                                 'Synthetic Beta Trading'))
        self.assertEqual(statuses(j), {'AB': ['missing', ['UNRELATED']], 'AG': ['ready', []], 'BG': ['ready', []]})
        self.assertEqual(j['unassigned'], [])

    def test_an_unknown_entity_row_blocks_only_its_file_batches(self):
        j = self.changed('I07', lambda c: c.edit('ledger-1', {'Transaction ID': 'A-7003'}, 'Entity',
                                                 'Synthetic Omega Unknown'))
        self.assertEqual(statuses(j), {'AB': ['blocked', ['UNASSIGNED']], 'AG': ['blocked', ['UNASSIGNED']],
                                       'BG': ['ready', []]})

    def test_an_alpha_row_in_beta_s_file_blocks_alpha_s_batches_and_the_file_s(self):
        def move(c):
            alpha, beta = c.rows('ledger-1'), c.rows('ledger-2')
            row = next(r for r in alpha[1:] if r[alpha[0].index('Transaction ID')] == 'A-7003')
            alpha.remove(row)
            beta.append([row[alpha[0].index(h)] for h in beta[0]])
            c.write('ledger-1', alpha)
            c.write('ledger-2', beta)
        j = self.changed('I07', move)
        self.assertEqual(statuses(j), {'AB': ['blocked', ['UNASSIGNED']], 'AG': ['blocked', ['UNASSIGNED']],
                                       'BG': ['blocked', ['UNASSIGNED']]})

    def test_a_short_row_is_unassigned(self):
        def short(c):
            rows = c.rows('ledger-3')
            rows.append(rows[1][:5])
            c.write('ledger-3', rows)
        j = self.changed('I07', short)
        self.assertEqual(statuses(j)['BG'], ['blocked', ['UNASSIGNED']])
        self.assertEqual(statuses(j)['AG'], ['blocked', ['UNASSIGNED']])
        self.assertEqual(len(j['unassigned']), 2)

    def test_the_missing_part_supplied_leaves_only_the_unrelated_row(self):
        def add(c):
            rows = c.rows('ledger-2')
            extra = list(rows[2])
            h = rows[0]
            extra[h.index('Transaction ID')] = 'B-8003'
            extra[h.index('Credit')] = '2000.00'
            rows.append(extra)
            c.write('ledger-2', rows)
        j = self.changed('I08', add)
        self.assertEqual(statuses(j)['AB'], ['missing', ['UNRELATED']])
        self.assertEqual(j['batches']['AB']['relations']['AB/R-8000']['residual'], 0)

    def test_the_credit_note_booked_by_beta_closes_the_pair(self):
        def add(c):
            rows = c.rows('ledger-2')
            h = rows[0]
            extra = list(rows[1])
            extra[h.index('Transaction ID')] = 'B-CN-5002'
            extra[h.index('Counterparty transaction ID')] = 'A-5002'
            extra[h.index('Debit')], extra[h.index('Credit')] = '700.00', '0.00'
            rows.append(extra)
            c.write('ledger-2', rows)
            c.append('relations', {'Relation ID': 'R-5002', 'Batch ID': 'AB', 'Side': 'B',
                                   'Transaction ID': 'B-CN-5002',
                                   'Relationship reference': 'Credit note A-5002 against invoice A-5001, not yet booked by Beta',
                                   'Valid from': '2026-01-01', 'Valid to': '2026-12-31'})
        j = self.changed('I05', add)
        self.assertEqual(statuses(j)['AB'], ['ready', []])

    def test_counterparty_numbers_set_right_clear_the_conflict(self):
        j = self.changed('I13',
                         lambda c: c.edit('ledger-1', {'Transaction ID': 'A-1301'}, 'Counterparty transaction ID', 'B-1301'),
                         lambda c: c.edit('ledger-1', {'Transaction ID': 'A-1302'}, 'Counterparty transaction ID', 'B-1302'))
        self.assertEqual(statuses(j)['AB'], ['ready', []])

    def test_a_relation_kept_in_its_batch_unblocks_both(self):
        j = self.changed('I09',
                         lambda c: c.edit('relations', {'Relation ID': 'R-9001', 'Transaction ID': 'G-9002'}, 'Batch ID', 'AB'),
                         lambda c: c.edit('relations', {'Relation ID': 'R-9001', 'Transaction ID': 'G-9002'}, 'Transaction ID', 'B-9001'),
                         lambda c: c.edit('relations', {'Relation ID': 'R-9002', 'Transaction ID': 'B-9001'}, 'Batch ID', 'AG'),
                         lambda c: c.edit('relations', {'Relation ID': 'R-9002', 'Batch ID': 'AG', 'Side': 'B'}, 'Transaction ID', 'G-9002'))
        self.assertEqual(statuses(j), {'AB': ['ready', []], 'AG': ['ready', []], 'BG': ['ready', []]})

    def test_the_later_declaration_moved_clears_the_overlap(self):
        j = self.changed('I12', lambda c: c.edit('batches', {'Batch ID': 'AB-2'}, 'Period start', '2026-10-01'),
                         lambda c: c.edit('batches', {'Batch ID': 'AB-2'}, 'Period end', '2026-10-31'),
                         lambda c: c.edit('batches', {'Batch ID': 'AB-2'}, 'As of', '2026-10-31'))
        self.assertEqual(statuses(j), {'AB-1': ['ready', []], 'AB-2': ['missing', ['SIDE_EMPTY']], 'AG': ['ready', []]})

    def test_a_shared_side_with_another_counterparty_is_no_overlap(self):
        j = self.changed('I12', lambda c: c.edit('batches', {'Batch ID': 'AB-2'}, 'Entity A', 'Synthetic Delta Logistics'))
        self.assertEqual(statuses(j)['AB-1'], ['ready', []])

    def test_kwd_needs_three_decimals_at_most(self):
        j = self.changed('I14', lambda c: c.edit('ledger-1', {'Transaction ID': 'A-1402'}, 'Debit', '1250.1250'))
        self.assertEqual(statuses(j)['AG-KWD'], ['blocked', ['AMOUNT']])
        self.assertEqual(statuses(j)['AB'], ['ready', []])

    def test_jpy_has_no_decimals(self):
        j = self.changed('I14', lambda c: c.edit('ledger-2', {'Transaction ID': 'B-1403'}, 'Debit', '480000.0'))
        self.assertEqual(statuses(j)['BG-JPY'], ['blocked', ['AMOUNT']])

    def test_rules_no_story_exercises(self):
        cases = [
            ('BOTH_SIDES', 'I02', lambda c: c.edit('ledger-1', {'Transaction ID': 'A-1002'}, 'Credit', '1.00')),
            ('DATE', 'I02', lambda c: c.edit('ledger-1', {'Transaction ID': 'A-1002'}, 'Posting date', '2026-09-31')),
            ('IDENTITY', 'I02', lambda c: c.edit('ledger-2', {'Transaction ID': 'B-2003'}, 'Counterparty transaction ID', '=A-1002')),
            ('DUPLICATE_TRANSACTION', 'I02', lambda c: c.edit('ledger-2', {'Transaction ID': 'B-2003'}, 'Transaction ID', 'B-2001')),
            ('VALIDITY', 'I02', lambda c: [c.edit('relations', {'Relation ID': 'R-1002', 'Side': s}, 'Valid from', '2026-09-02') for s in 'AB']),
            ('RELATION_FIELDS_DIFFER', 'I02', lambda c: c.edit('relations', {'Relation ID': 'R-1002', 'Side': 'B'}, 'Relationship reference', 'Invoice A-1002 (B)')),
            ('RELATION_FIELD', 'I02', lambda c: c.edit('relations', {'Relation ID': 'R-1002', 'Side': 'B'}, 'Side', 'C')),
            ('RELATION_FIELD', 'I02', lambda c: [c.edit('relations', {'Relation ID': 'R-1002', 'Side': s}, 'Valid to', '2026-12-32') for s in 'AB']),
            ('BATCH_DUPLICATE', 'I05', lambda c: c.edit('batches', {'Batch ID': 'AG'}, 'Batch ID', 'AB')),
            ('BATCH_FIELD', 'I02', lambda c: c.edit('batches', {'Batch ID': 'AB'}, 'As of', '2026-09-29')),
            ('BATCH_FIELD', 'I02', lambda c: c.edit('batches', {'Batch ID': 'AB'}, 'Currency', 'XAU')),
            ('BATCH_FIELD', 'I02', lambda c: c.edit('batches', {'Batch ID': 'AB'}, 'Entity B', 'Synthetic Alpha Holding')),
            ('POSTING_PERIOD', 'I02', lambda c: c.edit('ledger-2', {'Transaction ID': 'B-2003'}, 'Posting date', '2026-08-31')),
        ]
        for code, sid, edit in cases:
            with self.subTest(code=code, story=sid):
                j = self.changed(sid, edit)
                self.assertEqual(statuses(j)['AB'][0], 'blocked')
                self.assertIn(code, statuses(j)['AB'][1])

    def test_run_level_blocks(self):
        def header(c):
            rows = c.rows('ledger-1')
            rows[0][rows[0].index('Debit')] = 'Debits'
            c.write('ledger-1', rows)

        def stray_relation(c):
            c.append('relations', {'Relation ID': 'R-X', 'Batch ID': 'AZ', 'Side': 'A', 'Transaction ID': 'A-1030',
                                   'Relationship reference': 'Unknown batch', 'Valid from': '2026-01-01',
                                   'Valid to': '2026-12-31'})

        def unreadable_declaration(c):
            rows = c.rows('batches')
            extra = list(rows[1])
            extra[rows[0].index('Batch ID')] = ' AZ'
            rows.append(extra)
            c.write('batches', rows)
        for code, edit in [('HEADER', header), ('RELATION_UNATTRIBUTED', stray_relation),
                           ('BATCH_FIELD', unreadable_declaration)]:
            with self.subTest(code=code):
                j = self.changed('I10', edit)
                self.assertIn(code, j['run'])
                for bid, v in statuses(j).items():
                    self.assertEqual(v[0], 'blocked', bid)
                    self.assertIn(code, v[1], bid)

    def test_the_byte_order_mark_is_not_part_of_the_header(self):
        self.assertTrue((FROZEN / 'I04-batches.csv').read_bytes().startswith(b'\xef\xbb\xbf'))
        self.assertEqual(statuses(self.result['I04'])['AB'], ['ready', []])


if __name__ == '__main__':
    unittest.main()
