"""The INV-2 oracle agrees with every hand-written intent, reads neither the
stories nor their intent, keeps every verdict and component when nothing
decisive changes, and moves when one decisive fact moves, for each contract
rule, including the rules no story exercises.

  python3 -B -m unittest discover -s audit/inventory-movement-foundation -p test_oracle.py -v
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
from decimal import Decimal, InvalidOperation
from pathlib import Path

HERE = Path(__file__).resolve().parent
FROZEN = HERE / 'frozen'


def load():
    spec = importlib.util.spec_from_file_location('inv2_oracle', os.environ.get('ORACLE', HERE / 'oracle.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


oracle = load()
FACTS = json.loads((FROZEN / 'stories.json').read_text(encoding='utf-8'))
START, END = '2026-10-01', '2026-10-31'
RUN = {'Entity': 'Test Co', 'Currency': 'SAR', 'Period start': START, 'Period end': END,
       'Negative balances': 'not allowed'}
COLUMNS = ['Movement ID', 'Item ID', 'Item dimensions', 'Kind', 'Quantity', 'Unit', 'Value', 'Movement date',
           'Posting date', 'GL account', 'Transfer ID', 'Origin ID']
GL_COLUMNS = ['GL account', 'Opening', 'Debit', 'Credit', 'Closing']
INFLOWS = ('receipt', 'transfer-in', 'adjustment-in', 'return-in')
OUTFLOWS = ('issue', 'transfer-out', 'adjustment-out', 'return-out')
OK = ['consistent', []]
MID = '2026-10-10'


def money(minor):
    return ('-' if minor < 0 else '') + f'{abs(minor) // 100}.{abs(minor) % 100:02d}'


def line(mid, kind, q, v, item='A', dims='w=1', unit='pcs', acct='1310', md=None, pd=None, tid='', oid=''):
    """One register line in contract column order. q in whole units or as
    text; v in halalas or as text."""
    if md is None:
        md = START if kind == 'opening' else END if kind == 'closing' else MID
    return [mid, item, dims, kind, str(q), unit, money(v) if isinstance(v, int) else v, md, pd or md, acct, tid,
            oid]


def position(prefix, item='A', dims='w=1', acct='1310', unit='pcs', opening=(10, 1000), moves=(), closing='auto'):
    """An opening, movements (kind, q, v[, options]) and a closing the test
    foots itself from the movements posted in October."""
    rows = []
    if opening is not None:
        rows.append(line(f'{prefix}-O', 'opening', opening[0], opening[1], item, dims, unit, acct))
    q, v = opening if opening is not None else (0, 0)
    for i, m in enumerate(moves):
        kind, mq, mv, *more = m
        kw = more[0] if more else {}
        rows.append(line(kw.get('mid', f'{prefix}-{i + 1}'), kind, mq, mv, kw.get('item', item), dims,
                         kw.get('unit', unit), kw.get('acct', acct), kw.get('md'), kw.get('pd'), kw.get('tid', ''),
                         kw.get('oid', '')))
        if START <= (kw.get('pd') or kw.get('md') or MID) <= END and isinstance(mq, int) and isinstance(mv, int):
            sign = 1 if kind in INFLOWS else -1
            q, v = q + sign * mq, v + sign * mv
    if closing == 'auto':
        closing = (q, v)
    if closing is not None:
        rows.append(line(f'{prefix}-C', 'closing', closing[0], closing[1], item, dims, unit, acct))
    return rows


def halalas(text):
    try:
        return int(Decimal(text) * 100)
    except (InvalidOperation, ValueError):
        return None


def gl_for(rows):
    """The test's own GL of the lines: openings, October inflows as debits
    and outflows as credits, a transfer within one account in neither."""
    groups = {}
    for r in rows:
        if r[3] in ('transfer-in', 'transfer-out') and START <= r[8] <= END:
            groups.setdefault(r[10], []).append(r)
    internal = {id(r) for g in groups.values() if len(g) == 2 and g[0][9] == g[1][9] for r in g}
    acc = {}
    for r in rows:
        a = acc.setdefault(r[9], [0, 0, 0])
        v = halalas(r[6])
        if v is None:
            continue
        if r[3] == 'opening':
            a[0] += v
        elif r[3] in INFLOWS + OUTFLOWS and START <= r[8] <= END and id(r) not in internal:
            a[1 if r[3] in INFLOWS else 2] += v
    return [list(GL_COLUMNS)] + [[k, money(o), money(d), money(c), money(o + d - c)] for k, (o, d, c) in
                                 sorted(acc.items())]


class Case:
    """One register and GL summary written here as CSV."""

    def __init__(self, rows, gl=None, scope=None, raw=None, gl_raw=None, header=COLUMNS):
        self.tmp = tempfile.TemporaryDirectory()
        folder = Path(self.tmp.name)
        (folder / 'X-scope.json').write_text(json.dumps(RUN if scope is None else scope), encoding='utf-8')
        if raw is not None:
            (folder / 'X-register.csv').write_bytes(raw)
        else:
            with (folder / 'X-register.csv').open('w', encoding='utf-8', newline='') as f:
                csv.writer(f, lineterminator='\n').writerows([list(header)] + [list(r) for r in rows])
        if gl_raw is not None:
            (folder / 'X-gl.csv').write_bytes(gl_raw)
        else:
            with (folder / 'X-gl.csv').open('w', encoding='utf-8', newline='') as f:
                csv.writer(f, lineterminator='\n').writerows(gl_for(rows) if gl is None else gl)
        self.folder = folder


class Copy:
    """A private copy of one frozen story."""

    def __init__(self, sid):
        self.sid = sid
        self.tmp = tempfile.TemporaryDirectory()
        self.folder = Path(self.tmp.name)
        for p in FROZEN.glob(f'{sid}-*'):
            shutil.copy(p, self.folder / p.name)

    def rows(self, part='register'):
        raw = (self.folder / f'{self.sid}-{part}.csv').read_bytes().decode('utf-8').lstrip('\ufeff')
        return [list(r) for r in csv.reader(io.StringIO(raw, newline=''))]

    def write(self, rows, part='register'):
        with (self.folder / f'{self.sid}-{part}.csv').open('w', encoding='utf-8', newline='') as f:
            csv.writer(f, lineterminator='\r\n').writerows(rows)


class Oracle(unittest.TestCase):
    _result = None

    def judged(self, folder, sid='X'):
        try:
            return oracle.judge(Path(folder), sid)
        except Exception as error:  # the oracle must judge any input it is given
            self.fail(f'the oracle stopped on {sid}: {error!r}')

    def same(self, got, want):
        """Equality without unittest's diff of large results, which takes
        minutes on a wrong oracle; the message names the first difference."""
        if got != want:
            keys = sorted(set(got) | set(want)) if isinstance(got, dict) and isinstance(want, dict) else []
            first = next((k for k in keys if got.get(k) != want.get(k)), None)
            self.fail(f'differs at {first!r}: {str(got.get(first) if first else got)[:300]} != '
                      f'{str(want.get(first) if first else want)[:300]}')

    def result(self):
        if Oracle._result is None:
            Oracle._result = oracle.run(FROZEN)['stories']
        return Oracle._result

    def case(self, rows, **kw):
        written = Case(rows, **kw)  # kept until judged: the folder goes with it
        return self.judged(written.folder)

    def positions(self, r):
        self.assertNotIn('refused', r, r)
        return {k: [v['status'], v['codes']] for k, v in r['positions'].items()}

    def accounts(self, r):
        self.assertNotIn('refused', r, r)
        return {k: [v['status'], v['codes']] for k, v in r['accounts'].items()}

    # -- the stories --------------------------------------------------------
    def test_every_intent(self):
        got = self.result()
        self.assertEqual(sorted(got), sorted(s['id'] for s in FACTS['stories']))
        for story in FACTS['stories']:
            with self.subTest(story=story['id']):
                self.same(got[story['id']], story['intent'])

    def test_the_oracle_reads_no_story_facts(self):
        source = Path(oracle.__file__).read_text(encoding='utf-8')
        for word in ("'stories.json'", "'intent'", "'recipe'", 'stories.py'):
            self.assertFalse(word in source, word)

    def test_the_stories_reach_every_code(self):
        seen = set()
        for r in self.result().values():
            if 'refused' in r:
                seen.add(r['refused'])
                continue
            seen.update(c for p in r['positions'].values() for c in p['codes'])
            seen.update(c for a in r['accounts'].values() for c in a['codes'])
            seen.update(r['run'])
        contract = json.loads((HERE / 'contract.json').read_text(encoding='utf-8'))['codes']
        every = {c for group in contract.values() for c in group}
        # The rule tests below reach these five; no story needs them.
        self.assertEqual(every - seen, {'CREDIT_DIFF', 'CSV', 'DATE', 'IDENTITY', 'OPENING_DIFF'})

    # -- reading rules ------------------------------------------------------
    def test_text_rules(self):
        t = oracle.text
        self.assertEqual(t('  MV-1  '), 'MV-1')
        self.assertEqual(t('x' * 500), 'x' * 500)
        self.assertIsNone(t('x' * 501))
        for bad in ('', '   ', '=A', '+A', '@A', '-A', '#REF!', '#ref!x', '#n/a', '#Value!', '#div/0!', '#name?',
                    '#null!', '#num!', 'A\u200bB', 'A\u00a0B', 'A\tB', 'A\nB', '\tA', 'A\u2028B'):
            self.assertIsNone(t(bad), repr(bad))
        self.assertEqual(t('A B'), 'A B')
        self.assertEqual(t('0420'), '0420')

    def test_dates(self):
        d = oracle.real_date
        self.assertEqual(d(' 2026-10-01 '), '2026-10-01')
        for bad in ('2026-02-30', '2026-13-01', '2026-1-01', '01/10/2026', '', '\u0662\u0660\u0662\u0666-\u0661\u0660-\u0660\u0661', '2026-10-01T00'):
            self.assertIsNone(d(bad), bad)

    def test_numbers(self):
        n = oracle.number
        self.assertEqual(n('12', 3, False), 12000)
        self.assertEqual(n('12.5', 3, False), 12500)
        self.assertEqual(n('12.125', 3, False), 12125)
        self.assertIsNone(n('12.1255', 3, False))
        self.assertEqual(n('1.5', 2, False), 150)
        self.assertIsNone(n('1.505', 2, False))
        self.assertEqual(n('7', 0, False), 7)
        self.assertIsNone(n('7.0', 0, False))
        self.assertEqual(n('\u0661\u0662\u066b\u0665', 2, False), 1250)
        self.assertEqual(n('\u06f1\u06f2', 0, False), 12)
        self.assertIsNone(n('-5', 2, False))
        self.assertEqual(n('-5', 2, True), -500)
        self.assertEqual(n('-0', 2, True), 0)
        for bad in ('', ' ', '1,000', '+5', '5-', '1e3', '.5', '5.', '--5', '- 5', '(5)'):
            self.assertIsNone(n(bad, 2, True), bad)
        self.assertEqual(n('1000000000000', 2, False), 10 ** 14)
        self.assertIsNone(n('1000000000000.01', 2, False))
        self.assertIsNone(n('-1000000000000.01', 2, True))

    def test_records(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / 'f.csv'
            for raw, want in ((b'a,b\r\nc,d\r\n', [['a', 'b'], ['c', 'd']]),
                              (b'a,b\rc,d', [['a', 'b'], ['c', 'd']]),
                              (b'\xef\xbb\xbfa,"b ""q"", c"\n', [['a', 'b "q", c']]),
                              (b'a,\n,b\n', [['a', ''], ['', 'b']]),
                              (b'"a\nb",c\n', [['a\nb', 'c']])):
                p.write_bytes(raw)
                try:
                    got = oracle.records(p)
                except oracle.Refused as refused:  # a refusal here is a wrong reading, not a crash
                    self.fail(f'{raw!r} refused as {refused}')
                self.assertEqual(got, want, raw)
            for raw, code in ((b'a,b"c\n', 'CSV'), (b'"a"b,c\n', 'CSV'), (b'"abc\n', 'CSV'), (b'\xff\xfea\n', 'ENCODING')):
                p.write_bytes(raw)
                with self.assertRaises(oracle.Refused) as caught:
                    oracle.records(p)
                self.assertEqual(str(caught.exception), code, raw)

    # -- refusals -----------------------------------------------------------
    def test_scope_refusals(self):
        rows = position('A')
        for change in ({'Currency': 'XAU'}, {'Period start': '2026-11-01'}, {'Period end': '2026-10-32'},
                       {'Negative balances': 'Allowed'}, {'Negative balances': 'yes'}, {'Entity': '=Co'},
                       {'Entity': ' Test Co'}, {'Extra': 'x'}):
            scope = dict(RUN, **change)
            self.assertEqual(self.case(rows, scope=scope), {'refused': 'SCOPE'}, change)
        scope = dict(RUN)
        del scope['Entity']
        self.assertEqual(self.case(rows, scope=scope), {'refused': 'SCOPE'})
        self.assertEqual(self.case(rows, scope=dict(RUN, **{'Period end': START}))['run'], [])

    def test_register_refusals(self):
        rows = position('A')
        self.assertEqual(self.case(rows, raw='Movement ID\n'.encode('cp1256') + 'ا'.encode('cp1256')),
                         {'refused': 'ENCODING'})
        self.assertEqual(self.case(rows, raw=b'"Movement ID,Item ID\n'), {'refused': 'CSV'})
        self.assertEqual(self.case(rows, raw=b''), {'refused': 'HEADER'})
        self.assertEqual(self.case(rows, raw=b'\n,,\n'), {'refused': 'HEADER'})
        self.assertEqual(self.case(rows, header=COLUMNS + ['Note']), {'refused': 'HEADER'})
        self.assertEqual(self.case(rows, header=COLUMNS[:-1] + ['Movement ID']), {'refused': 'HEADER'})
        self.assertEqual(self.case(rows, header=COLUMNS + ['Movement ID']), {'refused': 'HEADER'})
        self.assertEqual(self.case(rows, header=[c.lower() for c in COLUMNS]), {'refused': 'HEADER'})

    def test_header_in_any_order_with_padding_and_spaces(self):
        rows = position('A')
        order = COLUMNS[::-1]
        moved = [[r[COLUMNS.index(c)] for c in order] + ['', ''] for r in rows]
        r = self.case(moved, header=[f' {c} ' for c in order] + ['', ''])
        self.assertEqual(self.positions(r), {'A|w=1': OK})

    def test_blank_rows_and_a_first_blank_row(self):
        rows = position('A')
        raw = ('\n,,\n' + ','.join(COLUMNS) + '\n\n' + '\n'.join(','.join(r) for r in rows) + '\n\n').encode()
        r = self.case(rows, raw=raw)
        self.assertEqual(self.positions(r), {'A|w=1': OK})
        self.assertEqual(r['positions']['A|w=1']['rows'], [5, 6])

    # -- lines --------------------------------------------------------------
    def held(self, rows, key='A|w=1', **kw):
        r = self.case(rows, **kw)
        return self.positions(r)[key]

    def test_identity(self):
        for j, v in ((0, ''), (0, '-1'), (5, ''), (5, '\tpcs'), (9, '=1310'), (0, 'M\u200b1')):
            rows = position('A', moves=[('receipt', 5, 500)])
            rows[1][j] = v
            self.assertEqual(self.held(rows), ['held', ['IDENTITY']], (j, v))

    def test_kind(self):
        for v in ('Receipt', 'receipts', 'transfer', ''):
            rows = position('A', moves=[('receipt', 5, 500)])
            rows[1][3] = v
            self.assertEqual(self.held(rows), ['held', ['KIND']], v)
        rows = position('A', moves=[('receipt', 5, 500)])
        rows[1][3] = ' receipt '
        self.assertEqual(self.held(rows), OK)

    def test_quantity_and_value(self):
        for j, v, code in ((4, '', 'QUANTITY'), (4, '1,000', 'QUANTITY'), (4, '-5', 'QUANTITY'),
                           (4, '1.2345', 'QUANTITY'), (6, '', 'VALUE'), (6, '-5.00', 'VALUE'), (6, '5.001', 'VALUE'),
                           (6, '1000000000000.01', 'VALUE')):
            rows = position('A', moves=[('receipt', 5, 500)])
            rows[1][j] = v
            self.assertEqual(self.held(rows), ['held', [code]], (j, v))

    def test_dates_of_a_line(self):
        for j in (7, 8):
            rows = position('A', moves=[('receipt', 5, 500)])
            rows[1][j] = '2026-10-32'
            self.assertEqual(self.held(rows), ['held', ['DATE']], j)

    def test_links(self):
        cases = (('receipt', 'T-1', ''), ('receipt', '', 'O-1'), ('issue', '', 'O-1'), ('adjustment-in', 'T-1', ''),
                 ('opening', 'T-1', ''), ('closing', '', 'O-1'))
        for kind, tid, oid in cases:
            rows = position('A', moves=[('receipt', 5, 500), ('issue', 2, 200)])
            target = {'opening': 0, 'closing': -1, 'receipt': 1, 'issue': 2, 'adjustment-in': 1}[kind]
            if kind == 'adjustment-in':
                rows[1][3] = kind
                rows = position('A', moves=[('adjustment-in', 5, 500, {'tid': tid}), ('issue', 2, 200)])
            else:
                rows[target][10], rows[target][11] = tid, oid
            self.assertEqual(self.held(rows), ['held', ['LINK']], (kind, tid, oid))
        b = position('B', dims='w=2', opening=(0, 0), moves=[('transfer-in', 5, 500, {'tid': 'T-1'})])
        a = position('A', moves=[('transfer-out', 5, 500, {'tid': 'T-1', 'oid': 'X'})])
        self.assertEqual(self.held(a + b), ['held', ['LINK']])
        a = position('A', moves=[('transfer-out', 5, 500, {'tid': '=T'})])
        self.assertEqual(self.held(a), ['held', ['LINK']])
        a = position('A', moves=[('receipt', 5, 500, {'mid': 'R-1'}), ('return-out', 1, 100, {'oid': 'R-1', 'tid': 'T'})])
        self.assertEqual(self.held(a), ['held', ['LINK']])
        a = position('A', moves=[('receipt', 5, 500, {'mid': 'R-1'}), ('return-out', 1, 100, {'oid': ' '})])
        self.assertEqual(self.held(a), ['held', ['LINK']])
        a = position('A', moves=[('receipt', 5, 500)])
        a[1][3], a[1][11] = 'Return-out', 'R-1'
        self.assertEqual(self.held(a), ['held', ['KIND', 'LINK']])

    def test_line_width(self):
        rows = position('A', moves=[('receipt', 5, 500)])
        rows[1] += ['', 'note']
        self.assertEqual(self.held(rows), ['held', ['LINE_WIDTH']])
        rows = position('A', moves=[('receipt', 5, 500)])
        rows[1] += ['', '  ']
        self.assertEqual(self.held(rows), OK)

    def test_an_unreadable_item_holds_everything(self):
        a = position('A', moves=[('receipt', 5, 500)])
        b = position('B', item='B', acct='1320')
        for j, v in ((1, '=A'), (2, ''), (2, 'w\u00a01')):
            rows = [list(r) for r in a + b]
            rows[1][j] = v
            r = self.case(rows)
            self.assertEqual(self.positions(r), {'A|w=1': ['held', ['LINE_UNREADABLE']],
                                                 'B|w=1': ['held', ['LINE_UNREADABLE']]}, (j, v))
            self.assertEqual(self.accounts(r), {'1310': ['held', ['LINE_UNREADABLE', 'POSITION']],
                                                '1320': ['held', ['LINE_UNREADABLE', 'POSITION']]})
            self.assertEqual(r['unplaced'], [['register', 3, 'LINE_UNREADABLE']])
            self.assertEqual(r['run'], ['LINE_UNREADABLE'])
            self.assertIsNone(r['totals'])
        only = [line('Z-1', 'receipt', 5, 500, item='=Z')]
        r = self.case(only, gl=gl_for(position('A')) + [['=1399', '0.00', '0.00', '0.00', '0.00']])
        self.assertEqual(r['positions'], {})
        self.assertIsNone(r['totals'])
        self.assertEqual(r['unplaced'], [['gl', 3, 'GL_UNREADABLE'], ['register', 2, 'LINE_UNREADABLE']])
        self.assertEqual(r['run'], ['GL_UNREADABLE', 'LINE_UNREADABLE'])

    # -- the period ----------------------------------------------------------
    def test_posting_date_places_the_movement(self):
        a = position('A', moves=[('receipt', 5, 500, {'md': MID, 'pd': '2026-11-01'}), ('issue', 2, 200)])
        r = self.case(a)
        self.assertEqual(self.positions(r), {'A|w=1': OK})
        self.assertEqual(r['excluded'], [[3, 'A-1']])
        self.assertEqual(r['positions']['A|w=1']['rows'], [2, 4, 5])
        b = position('A', moves=[('receipt', 5, 500, {'md': '2026-11-01', 'pd': MID})])
        r = self.case(b)
        self.assertEqual(self.positions(r), {'A|w=1': OK})
        self.assertEqual(r['datedOutside'], [[3, 'A-1']])
        self.assertEqual(r['excluded'], [])
        c = position('A', moves=[('receipt', 5, 500, {'md': MID, 'pd': '2026-09-30'})])
        self.assertEqual(self.case(c)['excluded'], [[3, 'A-1']])
        d = position('A', moves=[('receipt', 5, 500, {'md': START, 'pd': END})])
        r = self.case(d)
        self.assertEqual((r['excluded'], r['datedOutside']), ([], []))

    def test_an_excluded_line_is_no_position_and_holds_nothing(self):
        a = position('A')
        a.append(line('Z-1', 'receipt', 5, 500, item='Z', unit='box', acct='1399', pd='2026-11-02'))
        a.append(line('Z-2', 'issue', 1, 100, unit='box', pd='2026-11-02'))
        r = self.case(a, gl=gl_for(position('A')))
        self.assertEqual(self.positions(r), {'A|w=1': OK})
        self.assertEqual(self.accounts(r), {'1310': OK})
        self.assertEqual(r['excluded'], [[4, 'Z-1'], [5, 'Z-2']])

    def test_a_line_that_does_not_read_whole_is_not_excluded(self):
        a = position('A')
        a.append(line('Z-1', 'receipt', 5, '5.0.0', pd='2026-11-02'))
        r = self.case(a)
        self.assertEqual(self.positions(r), {'A|w=1': ['held', ['VALUE']]})
        self.assertEqual(r['excluded'], [])

    # -- positions -----------------------------------------------------------
    def test_duplicate_movement_ids(self):
        a = position('A', moves=[('receipt', 5, 500, {'mid': 'M-1'})])
        b = position('B', item='B', moves=[('issue', 5, 500, {'mid': 'M-1'})], opening=(10, 1000))
        r = self.case(a + b)
        self.assertEqual(self.positions(r), {'A|w=1': ['held', ['DUPLICATE_MOVEMENT']],
                                             'B|w=1': ['held', ['DUPLICATE_MOVEMENT']]})
        a = position('A', moves=[('receipt', 5, 500, {'mid': 'M-1'})])
        a.append(line('M-1', 'receipt', 5, 500, item='Z', pd='2026-11-02'))
        r = self.case(a)
        self.assertEqual(self.positions(r), {'A|w=1': ['held', ['DUPLICATE_MOVEMENT']]})
        a = position('A', moves=[('receipt', 5, 500, {'mid': 'M-1'}), ('issue', 5, 500, {'mid': 'M-2'})])
        self.assertEqual(self.held(a), OK)

    def test_conflicts(self):
        a = position('A', moves=[('receipt', 5, 500, {'unit': 'PCS'})])
        self.assertEqual(self.held(a), ['held', ['UNIT_CONFLICT']])
        a = position('A', moves=[('receipt', 5, 500, {'acct': '1320'})])
        r = self.case(a)
        self.assertEqual(self.positions(r), {'A|w=1': ['held', ['ACCOUNT_CONFLICT']]})
        self.assertEqual(self.accounts(r), {'1310': ['held', ['POSITION']], '1320': ['held', ['POSITION']]})

    def test_balance_dates(self):
        for j, row, v in ((7, 0, '2026-10-02'), (8, 0, '2026-09-30'), (7, -1, '2026-10-30'), (8, -1, '2026-11-01')):
            a = position('A', moves=[('receipt', 5, 500)])
            a[row][j] = v
            self.assertEqual(self.held(a), ['held', ['BALANCE_DATE']], (j, row))
        a = position('A')
        a[0][7] = '2026-10-41'
        self.assertEqual(self.held(a), ['held', ['DATE']])

    def test_repeated_balances(self):
        a = position('A')
        a.append(line('A-C2', 'closing', 10, 1000))
        self.assertEqual(self.held(a), ['held', ['BALANCE_REPEATED']])
        a = position('A')
        a.insert(0, line('A-O2', 'opening', 10, 1000))
        self.assertEqual(self.held(a), ['held', ['BALANCE_REPEATED']])

    def test_negative_balances(self):
        for opening, closing in (((-2, 1000), 'auto'), ((10, -1000), 'auto'), ((10, 1000), (-1, 500)),
                                 ((10, 1000), (1, -500))):
            a = position('A', opening=opening, moves=[], closing=closing)
            if closing != 'auto':
                a = position('A', opening=opening, moves=[('issue', 9, 500 if closing[1] > 0 else 1500)],
                             closing='auto')
                if closing[0] < 0:
                    a = position('A', opening=opening, moves=[('issue', 11, 500)], closing='auto')
            self.assertEqual(self.held(a), ['held', ['NEGATIVE_BALANCE']], (opening, closing))
            self.assertEqual(self.held(a, scope=dict(RUN, **{'Negative balances': 'allowed'})), OK)
        a = position('A', opening=(0, 0))
        a[0][4], a[0][6] = '-0', '-0.00'
        self.assertEqual(self.held(a), OK)

    def test_missing_balances(self):
        a = position('A', opening=None, closing=None, moves=[('receipt', 5, 500)])
        r = self.case(a)
        self.assertEqual(self.positions(r), {'A|w=1': ['missing', ['CLOSING_ABSENT', 'OPENING_ABSENT']]})
        p = r['positions']['A|w=1']
        self.assertEqual((p['opening'], p['closing'], p['computed']), (None, None, None))
        self.assertEqual(p['flows']['receipt'], {'quantity': 5000, 'value': 500})
        self.assertEqual(self.accounts(r), {'1310': ['held', ['POSITION']]})
        self.assertIsNone(r['totals'])
        a = position('A', closing=None, moves=[('receipt', 5, 500)])
        p = self.case(a)['positions']['A|w=1']
        self.assertEqual((p['status'], p['computed']), ('missing', {'quantity': 15000, 'value': 1500}))

    def test_bridges(self):
        for closing, codes in (((15, 1500), []), ((14, 1500), ['QUANTITY_BRIDGE']), ((15, 1501), ['VALUE_BRIDGE']),
                               ((16, 1400), ['QUANTITY_BRIDGE', 'VALUE_BRIDGE'])):
            a = position('A', moves=[('receipt', 5, 500)], closing=closing)
            self.assertEqual(self.held(a), ['inconsistent' if codes else 'consistent', codes], closing)
        moves = [('receipt', 7, 700), ('issue', 2, 210), ('adjustment-in', 1, 90), ('adjustment-out', 0, 35),
                 ('return-in', 1, 105, {'oid': 'S-1'}), ('return-out', 3, 300, {'oid': 'S-2'})]
        a = position('A', moves=moves)
        p = self.case(a)['positions']['A|w=1']
        self.assertEqual(p['computed'], {'quantity': 14000, 'value': 1350})
        self.assertEqual(p['status'], 'consistent')
        self.assertEqual(p['lines'][0], ['A-1', 'receipt', 7000, 700])

    def test_quantities_in_thousandths(self):
        a = position('A', moves=[('receipt', '0.125', 13), ('issue', '0.005', 1)], closing=('10.12', 1012))
        p = self.case(a)['positions']['A|w=1']
        self.assertEqual(p['status'], 'consistent')
        self.assertEqual(p['flows']['receipt']['quantity'], 125)
        self.assertEqual(p['closing']['quantity'], 10120)

    def test_components_of_a_position(self):
        a = position('A', moves=[('receipt', '2.5', '0.25'), ('issue', 1, 10)], closing=('11.5', '10.15'))
        p = self.case(a)['positions']['A|w=1']
        self.assertEqual(p['status'], 'consistent')
        self.assertEqual(p['opening'], {'quantity': 10000, 'value': 1000})
        self.assertEqual(p['closing'], {'quantity': 11500, 'value': 1015})
        self.assertEqual(p['flows']['receipt'], {'quantity': 2500, 'value': 25})
        self.assertEqual((p['unit'], p['account']), ('pcs', '1310'))
        self.assertEqual(p['lines'], [['A-1', 'receipt', 2500, 25], ['A-2', 'issue', 1000, 10],
                                      ['A-C', 'closing', 11500, 1015], ['A-O', 'opening', 10000, 1000]])

    # -- transfers -----------------------------------------------------------
    def pair(self, out=None, inn=None, b_acct='1320'):
        o = dict({'tid': 'T-1'}, **(out or {}))
        i = dict({'tid': 'T-1'}, **(inn or {}))
        a = position('A', moves=[('transfer-out', o.pop('q', 4), o.pop('v', 400), o)])
        b = position('B', dims='w=2', acct=b_acct, unit=i.get('unit', 'pcs'),
                     moves=[('transfer-in', i.pop('q', 4), i.pop('v', 400), i)])
        return a + b

    def test_a_proven_transfer(self):
        r = self.case(self.pair())
        self.assertEqual(self.positions(r), {'A|w=1': OK, 'A|w=2': OK})
        self.assertEqual(self.accounts(r), {'1310': OK, '1320': OK})
        self.assertEqual(r['accounts']['1310']['register'], {'opening': 1000, 'debit': 0, 'credit': 400,
                                                             'closing': 600})
        self.assertEqual(r['accounts']['1320']['register']['debit'], 400)
        self.assertEqual(r['totals'], {'opening': 2000, 'receipt': 0, 'issue': 0, 'adjustment-in': 0,
                                       'adjustment-out': 0, 'return-in': 0, 'return-out': 0, 'closing': 2000,
                                       'transferred': 400})

    def test_a_transfer_within_one_account(self):
        r = self.case(self.pair(b_acct='1310'))
        self.assertEqual(self.accounts(r), {'1310': OK})
        self.assertEqual(r['accounts']['1310']['register'], {'opening': 2000, 'debit': 0, 'credit': 0,
                                                             'closing': 2000})

    def test_transfer_mismatches(self):
        for out, inn in (({}, {'item': 'B'}), ({}, {'unit': 'box'}), ({}, {'q': 3}), ({}, {'v': 399}),
                         ({'q': 'x'}, {}), ({}, {'v': ''}), ({'q': 'x'}, {'q': 'y'})):
            rows = self.pair(out, inn)
            if 'item' in inn:
                rows = position('A', moves=[('transfer-out', 4, 400, {'tid': 'T-1'})]) + \
                    position('B', item='B', dims='w=2', acct='1320', moves=[('transfer-in', 4, 400, {'tid': 'T-1'})])
            r = self.case(rows)
            p = self.positions(r)
            key_b = 'B|w=2' if 'item' in inn else 'A|w=2'
            self.assertIn('TRANSFER_MISMATCH', p['A|w=1'][1], (out, inn))
            self.assertIn('TRANSFER_MISMATCH', p[key_b][1], (out, inn))

    def test_unpaired_and_repeated_transfers(self):
        b = position('B', dims='w=2', moves=[('transfer-in', 4, 400, {'tid': 'T-1'})])
        self.assertEqual(self.held(b, key='A|w=2'), ['held', ['TRANSFER_UNPAIRED']])
        rows = self.pair() + position('C', dims='w=3', moves=[('transfer-in', 4, 400, {'tid': 'T-1'})])
        r = self.case(rows)
        self.assertEqual(self.positions(r), {k: ['held', ['TRANSFER_REPEATED']] for k in ('A|w=1', 'A|w=2', 'A|w=3')})
        rows = self.pair(inn={'pd': '2026-11-01'})
        r = self.case(rows)
        self.assertEqual(self.positions(r), {'A|w=1': ['held', ['TRANSFER_UNPAIRED']], 'A|w=2': OK})
        rows = self.pair(inn={'tid': 'T-2'})
        r = self.case(rows)
        self.assertEqual(self.positions(r), {'A|w=1': ['held', ['TRANSFER_UNPAIRED']],
                                             'A|w=2': ['held', ['TRANSFER_UNPAIRED']]})

    # -- returns -------------------------------------------------------------
    def returns(self, kind='return-out', origin='receipt', q=2, v=200, origin_q=5, origin_v=500, **kw):
        moves = [(origin, origin_q, origin_v, {'mid': 'R-1'}), (kind, q, v, dict({'oid': 'R-1'}, **kw))]
        return position('A', moves=moves)

    def test_valid_returns(self):
        self.assertEqual(self.held(self.returns()), OK)
        self.assertEqual(self.held(self.returns('return-in', 'issue')), OK)
        self.assertEqual(self.held(self.returns(q=5, v=500)), OK)

    def test_return_origins(self):
        self.assertEqual(self.held(self.returns('return-in', 'receipt')), ['held', ['RETURN_ORIGIN']])
        self.assertEqual(self.held(self.returns('return-out', 'issue')), ['held', ['RETURN_ORIGIN']])
        self.assertEqual(self.held(self.returns(unit='box')), ['held', ['RETURN_ORIGIN', 'UNIT_CONFLICT']])
        rows = self.returns()
        rows.append(line('R-1', 'receipt', 1, 100, item='Q', pd='2026-11-01'))
        self.assertEqual(self.held(rows), ['held', ['DUPLICATE_MOVEMENT', 'RETURN_ORIGIN']])
        rows = position('A', moves=[('return-out', 2, 200, {'oid': 'R-1'})])
        rows += position('B', dims='w=2', moves=[('receipt', 5, 500, {'mid': 'R-1', 'tid': 'T-9'})])
        got = self.positions(self.case(rows))
        self.assertEqual(got, {'A|w=1': ['held', ['RETURN_ORIGIN']], 'A|w=2': ['held', ['LINK']]})
        rows = position('A', moves=[('return-out', 2, 200, {'oid': 'R-1'})])
        rows += position('B', item='B', moves=[('receipt', 5, 500, {'mid': 'R-1'})])
        self.assertEqual(self.positions(self.case(rows))['A|w=1'], ['held', ['RETURN_ORIGIN']])
        rows = position('A', moves=[('return-out', 2, 200, {'oid': 'R-1'})])
        rows += position('B', dims='w=2', moves=[('receipt', 5, 500, {'mid': 'R-1'})])
        self.assertEqual(self.positions(self.case(rows)), {'A|w=1': OK, 'A|w=2': OK})

    def test_an_origin_of_another_period(self):
        rows = self.returns()
        rows[1][8] = '2026-09-28'
        rows[1][7] = '2026-09-28'
        rows[-1][4], rows[-1][6] = '8', '8.00'
        r = self.case(rows)
        self.assertEqual(self.positions(r), {'A|w=1': OK})
        self.assertEqual(r['excluded'], [[3, 'R-1']])
        rows = position('A', moves=[('return-out', 2, 200, {'oid': 'R-9'})])
        r = self.case(rows)
        self.assertEqual(self.positions(r), {'A|w=1': OK})
        self.assertEqual(r['unseenOrigins'], [[3, 'A-1', 'R-9']])

    def test_return_capacity(self):
        self.assertEqual(self.held(self.returns(q=6, v=200)), ['held', ['RETURN_CAPACITY']])
        self.assertEqual(self.held(self.returns(q=2, v=501)), ['held', ['RETURN_CAPACITY']])
        rows = self.returns(q=3, v=300)
        rows.insert(3, line('A-3', 'return-out', 3, 300, oid='R-1'))
        self.assertEqual(self.held(rows), ['held', ['RETURN_CAPACITY']])
        rows = self.returns(q=3, v=300)
        rows.insert(3, line('A-3', 'return-out', 3, 300, oid='R-1', pd='2026-11-01'))
        self.assertEqual(self.held(rows), OK)
        rows = self.returns(q=1, v=100)
        rows.insert(3, line('A-3', 'return-out', '', 100, oid='R-1'))
        self.assertEqual(self.held(rows), ['held', ['QUANTITY', 'RETURN_CAPACITY']])
        rows = self.returns(q=1, v=100)
        rows += position('B', dims='w=2', moves=[('return-out', 1, 100, {'oid': 'R-1'})])
        self.assertEqual(self.positions(self.case(rows)), {'A|w=1': OK, 'A|w=2': OK})
        rows = self.returns(q=3, v=300)
        rows += position('B', dims='w=2', moves=[('return-out', 3, 300, {'oid': 'R-1'})])
        self.assertEqual(self.positions(self.case(rows)), {'A|w=1': ['held', ['RETURN_CAPACITY']],
                                                           'A|w=2': ['held', ['RETURN_CAPACITY']]})

    # -- headers -------------------------------------------------------------
    def test_repeated_headers(self):
        rows = position('A', moves=[('receipt', 5, 500)])
        r = self.case(rows[:2] + [list(COLUMNS)] + rows[2:])
        self.assertEqual(self.positions(r), {'A|w=1': OK})
        self.assertEqual(r['repeatedHeaders'], [['register', 4]])
        r = self.case(rows[:2] + [[f' {c}' for c in COLUMNS] + ['']] + rows[2:])
        self.assertEqual(r['repeatedHeaders'], [['register', 4]])
        moved = COLUMNS[1:] + COLUMNS[:1]
        r = self.case(rows[:2] + [moved] + rows[2:])
        self.assertEqual(r['repeatedHeaders'], [])
        self.assertEqual(r['run'], [])
        self.assertEqual(self.positions(r)['A|w=1'], OK)
        self.assertIn('Item dimensions|Kind', r['positions'])
        gl = gl_for(rows)
        r = self.case(rows, gl=gl[:2] + [list(GL_COLUMNS)] + gl[2:])
        self.assertEqual(r['repeatedHeaders'], [['gl', 3]])
        self.assertEqual(self.accounts(r), {'1310': OK})

    # -- accounts ------------------------------------------------------------
    def two(self):
        return position('A', moves=[('receipt', 5, 500), ('issue', 2, 300)]) + \
            position('B', item='B', acct='1320', moves=[('issue', 3, 300)])

    def test_gl_compared_component_by_component(self):
        rows = self.two()
        gl = gl_for(rows)
        self.assertEqual(self.accounts(self.case(rows, gl=gl)), {'1310': OK, '1320': OK})
        for j, code in ((1, 'OPENING_DIFF'), (2, 'DEBIT_DIFF'), (3, 'CREDIT_DIFF'), (4, 'CLOSING_DIFF')):
            changed = [list(g) for g in gl]
            changed[1][j] = money(halalas(changed[1][j]) + 1)
            r = self.case(rows, gl=changed)
            self.assertEqual(self.accounts(r), {'1310': ['difference', [code]], '1320': OK}, code)
            self.assertEqual(r['accounts']['1310']['difference'][code[:-5].lower()], -1)
        swapped = [list(g) for g in gl]
        swapped[1][2], swapped[2][2] = swapped[2][2], swapped[1][2]
        r = self.case(rows, gl=swapped)
        self.assertEqual(self.accounts(r), {'1310': ['difference', ['DEBIT_DIFF']],
                                            '1320': ['difference', ['DEBIT_DIFF']]})
        p = r['accounts']['1310']
        self.assertEqual(p['register']['debit'] - p['gl']['debit'], p['difference']['debit'])

    def test_gl_balances_may_be_negative(self):
        rows = position('A', moves=[('issue', 12, 1200)])
        scope = dict(RUN, **{'Negative balances': 'allowed'})
        r = self.case(rows, scope=scope)
        self.assertEqual(self.accounts(r), {'1310': OK})
        self.assertEqual(r['accounts']['1310']['gl']['closing'], -200)
        gl = [list(GL_COLUMNS), ['1310', '-1.00', '0.00', '0.00', '-1.00']]
        r = self.case(position('A', opening=(0, -100), moves=[]), gl=gl, scope=scope)
        self.assertEqual(self.accounts(r), {'1310': OK})

    def test_gl_line_faults(self):
        rows = self.two()
        gl = gl_for(rows)
        for j, v in ((2, '-1.00'), (3, '-1.00'), (1, '1,000.00'), (4, ''), (2, '1.001')):
            changed = [list(g) for g in gl]
            changed[1][j] = v
            self.assertEqual(self.accounts(self.case(rows, gl=changed)),
                             {'1310': ['held', ['GL_AMOUNT']], '1320': OK}, (j, v))
        changed = [list(g) for g in gl]
        changed[1] += ['x']
        self.assertEqual(self.accounts(self.case(rows, gl=changed))['1310'], ['held', ['GL_WIDTH']])
        changed = [list(g) for g in gl] + [list(gl[2])]
        self.assertEqual(self.accounts(self.case(rows, gl=changed))['1320'], ['held', ['GL_DUPLICATE']])
        changed = [list(g) for g in gl] + [['#ref!', '0.00', '0.00', '0.00', '0.00']]
        r = self.case(rows, gl=changed)
        self.assertEqual(self.accounts(r), {'1310': ['held', ['GL_UNREADABLE']], '1320': ['held', ['GL_UNREADABLE']]})
        self.assertEqual(r['unplaced'], [['gl', 4, 'GL_UNREADABLE']])
        self.assertEqual(self.positions(r), {'A|w=1': OK, 'B|w=1': OK})

    def test_gl_file_refused_as_a_file(self):
        rows = self.two()
        for raw in (b'"GL account,Opening\n', b'\xff\xfe\n', b'', b'GL account,Opening,Debit,Credit\n',
                    b'GL account,Opening,Debit,Credit,Closing,Closing\n'):
            r = self.case(rows, gl_raw=raw)
            self.assertEqual(self.accounts(r), {'1310': ['held', ['GL_FILE']], '1320': ['held', ['GL_FILE']]}, raw)
            self.assertEqual(self.positions(r), {'A|w=1': OK, 'B|w=1': OK})
            self.assertEqual(r['run'], ['GL_FILE'])
            self.assertIsNotNone(r['totals'])

    def test_missing_accounts(self):
        rows = self.two()
        gl = gl_for(rows)
        r = self.case(rows, gl=gl[:2])
        self.assertEqual(self.accounts(r), {'1310': OK, '1320': ['missing', ['GL_ABSENT']]})
        self.assertIsNone(r['accounts']['1320']['gl'])
        self.assertEqual(r['accounts']['1320']['register']['credit'], 300)
        r = self.case(rows, gl=gl + [['1399', '1.00', '0.00', '0.00', '1.00']])
        self.assertEqual(self.accounts(r)['1399'], ['missing', ['REGISTER_ABSENT']])
        self.assertEqual(r['accounts']['1399']['gl'], {'opening': 100, 'debit': 0, 'credit': 0, 'closing': 100})
        self.assertIsNone(r['accounts']['1399']['register'])

    def test_an_account_waits_for_every_position_that_names_it(self):
        rows = self.two()
        rows[-1][6] = money(halalas(rows[-1][6]) + 1)
        r = self.case(rows, gl=gl_for(self.two()))
        self.assertEqual(self.positions(r)['B|w=1'], ['inconsistent', ['VALUE_BRIDGE']])
        self.assertEqual(self.accounts(r), {'1310': OK, '1320': ['held', ['POSITION']]})
        self.assertIsNotNone(r['totals'])

    # -- metamorphic ---------------------------------------------------------
    def strip_rows(self, r):
        return {k: {kk: vv for kk, vv in v.items() if kk != 'rows'} for k, v in r['positions'].items()}

    def test_line_order_and_gl_order_change_nothing(self):
        for sid in ('M02', 'M19', 'M41'):
            c = Copy(sid)
            rows = c.rows()
            body = [r for r in rows[1:] if any(x.strip(' ') for x in r)]
            random.Random(7).shuffle(body)
            c.write([rows[0]] + body)
            gl = c.rows('gl')
            c.write([gl[0]] + gl[1:][::-1], 'gl')
            got = self.judged(c.folder, sid)
            want = self.result()[sid]
            self.same(self.strip_rows(got), self.strip_rows(want))
            self.same(got['accounts'], want['accounts'])
            self.assertEqual(got['totals'], want['totals'])

    def test_one_decisive_fact_moves_the_verdict(self):
        c = Copy('M02')
        rows = c.rows()
        j = rows[0].index('Value')
        k = rows[0].index('Kind')
        target = next(r for r in rows if len(r) > k and r[k] == 'transfer-in')
        target[j] = money(halalas(target[j]) + 1)
        c.write(rows)
        got = self.positions(self.judged(c.folder, 'M02'))
        self.assertEqual(got['CEM-50|wh=RIY-1'], ['held', ['TRANSFER_MISMATCH']])
        c = Copy('M10')
        (c.folder / 'M10-scope.json').write_text(json.dumps(dict(RUN, Entity='Synthetic Building Supplies Co')),
                                                 encoding='utf-8')
        got = self.positions(self.judged(c.folder, 'M10'))
        self.assertEqual(got['CEM-50|wh=RIY-1'], ['held', ['NEGATIVE_BALANCE']])

    def test_entity_and_file_names_change_nothing(self):
        c = Copy('M01')
        (c.folder / 'M01-scope.json').write_text(json.dumps(dict(RUN, Entity='Other Co')), encoding='utf-8')
        self.same(self.judged(c.folder, 'M01'), self.result()['M01'])
        for p in list(c.folder.iterdir()):
            p.rename(c.folder / p.name.replace('M01', 'ZZ'))
        self.same(self.judged(c.folder, 'ZZ'), self.result()['M01'])


if __name__ == '__main__':
    unittest.main()
