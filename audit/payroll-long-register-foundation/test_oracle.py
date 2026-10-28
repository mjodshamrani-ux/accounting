"""The PAY-1 oracle agrees with every hand-written intent, reads neither the
stories nor their intent, keeps every verdict and component when nothing
decisive changes, and moves when one decisive fact moves, for each contract
rule, including the rules no story exercises.

  python3 -B -m unittest discover -s audit/payroll-long-register-foundation -p test_oracle.py -v
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
from decimal import Decimal
from pathlib import Path

HERE = Path(__file__).resolve().parent
FROZEN = HERE / 'frozen'


def load():
    spec = importlib.util.spec_from_file_location('pay1_oracle', os.environ.get('ORACLE', HERE / 'oracle.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


oracle = load()
FACTS = json.loads((FROZEN / 'stories.json').read_text(encoding='utf-8'))
RUN = {'Entity': 'Test Co', 'Payroll run': 'PR-1', 'Currency': 'SAR', 'Period start': '2026-09-01',
       'Period end': '2026-09-30', 'Payroll posting date': '2026-09-27', 'Payment date': '2026-09-28'}
LABELS = list(RUN)
COLUMNS = ['Line ID', 'Employee ID', 'Employee dimensions', 'Payee account', 'Component', 'Kind', 'Amount']
TOTALS = ['Total earnings', 'Total deductions', 'Total employer', 'Total net']
KINDS = ['earning', 'deduction', 'employer', 'net']
OK = ['consistent', []]


def summary(judged):
    if 'refused' in judged:
        return {'refused': judged['refused']}
    return {
        'employees': {k: [v['status'], v['codes']] for k, v in judged['employees'].items()},
        'components': {k: [v['earnings'], v['deductions'], v['employer'], v['net']]
                       for k, v in judged['employees'].items() if v['status'] != 'held'},
        'excludedSections': judged['excludedSections'],
        'sharedPayees': judged['sharedPayees'],
        'unplaced': judged['unplaced'],
        'totals': judged['totals'],
        'run': judged['run'],
    }


def ln(lid, emp='E-1', dims='cc=1', payee='A-1', comp='Basic', kind='earning', amount='100.00'):
    return [lid, emp, dims, payee, comp, kind, amount]


def person(prefix, emp='E-1', dims='cc=1', payee='A-1', earn='100.00', ded='10.00', er='5.00', net='90.00'):
    """Four lines: an earning, a deduction, an employer contribution and the net."""
    return [ln(f'{prefix}-1', emp, dims, payee, 'Basic', 'earning', earn),
            ln(f'{prefix}-2', emp, dims, payee, 'Insurance', 'deduction', ded),
            ln(f'{prefix}-3', emp, dims, payee, 'Insurance (employer)', 'employer', er),
            ln(f'{prefix}-4', emp, dims, payee, 'Net pay', 'net', net)]


def foot(lines, over=None):
    """The test's own footing of lines written in contract column order."""
    sums = {k: Decimal(0) for k in KINDS}
    for r in lines:
        if r[5] in sums:
            sums[r[5]] += Decimal(r[6])
    rows = [[TOTALS[i], f'{sums[k]:.2f}'] for i, k in enumerate(KINDS)]
    for label, v in (over or {}).items():
        rows[TOTALS.index(label)][1] = v
    return rows


def section(sid, lines, labels=None, drop=(), extra=(), columns=COLUMNS, totals=None, end=True):
    values = dict(RUN)
    values.update(labels or {})
    rows = [['Section', sid]] + [[k, values[k]] for k in LABELS if k not in drop] + [list(r) for r in extra]
    rows += [list(columns)] + [list(r) for r in lines]
    rows += foot(lines) if totals is None else [list(r) for r in totals]
    if end:
        rows.append(['End section', sid if end is True else end])
    return rows + [[]]


def run_totals(lines, run='PR-1', over=None, end=True):
    rows = [['Run totals', run]] + foot(lines, over)
    if end:
        rows.append(['End run totals', run if end is True else end])
    return rows + [[]]


def register(*parts, footer=True):
    """Sections given as (sid, lines, **section keywords), then run totals
    footing the lines of every part unless footer is False or a list of
    rows."""
    rows, lines = [], []
    for sid, these, *kw in parts:
        rows += section(sid, these, **(kw[0] if kw else {}))
        lines += these
    if footer is True:
        rows += run_totals(lines)
    elif footer:
        rows += footer
    return rows


class Case:
    """One register written here as CSV, judged by the oracle under test."""

    def __init__(self, rows, scope=None, raw=None):
        self.tmp = tempfile.TemporaryDirectory()
        folder = Path(self.tmp.name)
        (folder / 'X-scope.json').write_text(json.dumps(RUN if scope is None else scope), encoding='utf-8')
        if raw is not None:
            (folder / 'X-register.csv').write_bytes(raw)
        else:
            with (folder / 'X-register.csv').open('w', encoding='utf-8', newline='') as f:
                csv.writer(f, lineterminator='\n').writerows(rows)
        self.folder = folder


class Copy:
    """A private copy of one frozen story, rewritten as CSV."""

    def __init__(self, sid):
        self.sid = sid
        self.tmp = tempfile.TemporaryDirectory()
        self.folder = Path(self.tmp.name)
        for p in FROZEN.glob(f'{sid}-*'):
            shutil.copy(p, self.folder / p.name)

    def rows(self):
        raw = (self.folder / f'{self.sid}-register.csv').read_bytes().decode('utf-8').lstrip('\ufeff')
        return [list(r) for r in csv.reader(io.StringIO(raw, newline=''))]

    def write(self, rows, end='\n', bom=False, pad=False):
        width = max(len(r) for r in rows)
        with (self.folder / f'{self.sid}-register.csv').open('w', encoding='utf-8-sig' if bom else 'utf-8',
                                                              newline='') as f:
            csv.writer(f, lineterminator=end).writerows(r + [''] * (width - len(r)) if pad else r for r in rows)

    def edit(self, first, column, value, nth=0):
        """Set one cell in the nth row whose first cell is first."""
        rows = self.rows()
        [r for r in rows if r and r[0] == first][nth][column] = value
        self.write(rows)


def blocks(rows):
    """The test's own split of a well-formed story: sections as (opening,
    labels, column row, lines, totals, end row), and the run totals block."""
    rows = [r for r in rows if any(c.strip(' ') for c in r)]
    out, footer, i = [], None, 0
    while i < len(rows):
        j = i + 1
        end = 'End section' if rows[i][0] == 'Section' else 'End run totals'
        while rows[j][0] != end:
            j += 1
        if end == 'End run totals':
            footer = rows[i:j + 1]
        else:
            inner = rows[i + 1:j]
            k = next(n for n, r in enumerate(inner) if len([c for c in r if c]) > 2)
            body = inner[k + 1:]
            t = next(n for n, r in enumerate(body) if r[0] in TOTALS)
            out.append((rows[i], inner[:k], inner[k], body[:t], body[t:], rows[j]))
        i = j + 1
    return out, footer


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
            try:
                Oracle._result = oracle.run(FROZEN)['stories']
            except Exception as error:
                self.fail(f'the oracle stopped on the frozen stories: {error!r}')
        return Oracle._result

    def case(self, rows, **kw):
        c = Case(rows, **kw)
        try:
            return self.judged(c.folder)
        finally:
            c.tmp.cleanup()

    def employees(self, rows, **kw):
        return summary(self.case(rows, **kw))['employees']

    def copy(self, sid, *edits):
        c = Copy(sid)
        try:
            for e in edits:
                e(c)
            return self.judged(c.folder, sid)
        finally:
            c.tmp.cleanup()

    # Agreement and blindness.

    def test_agrees_with_every_intent(self):
        result = self.result()
        self.assertEqual(sorted(result), sorted(s['id'] for s in FACTS['stories']))
        for story in FACTS['stories']:
            with self.subTest(story=story['id']):
                self.same(summary(result[story['id']]), story['intent'])

    def test_expected_is_what_the_oracle_returns(self):
        expected = json.loads((FROZEN / 'EXPECTED.json').read_text(encoding='utf-8'))
        self.same(expected['stories'], self.result())

    def test_reads_neither_stories_nor_intent(self):
        with tempfile.TemporaryDirectory() as tmp:
            for p in [*FROZEN.glob('*-register.csv'), *FROZEN.glob('*-scope.json')]:
                shutil.copy(p, Path(tmp) / p.name)
            self.same(oracle.run(tmp)['stories'], self.result())

    def test_components_and_lines_are_what_was_printed(self):
        p03 = self.result()['P03']['employees']['E-3001|cc=ICU']
        loans = [x for x in p03['lines'] if x[1] == 'Loan installment']
        self.assertEqual([x[2:] for x in loans], [['deduction', 50000], ['deduction', 50000]])
        self.assertNotEqual(loans[0][0], loans[1][0])
        self.assertEqual(p03['payee'], 'ACCT-70021')
        p09 = self.result()['P09']['employees']['E-9001|cc=LAB']
        self.assertIn(['L-0003', 'Overtime', 'earning', 0], p09['lines'])
        self.assertEqual(len(p09['lines']), 6)
        p29 = self.result()['P29']['employees']['E-2901|مركز=١']
        self.assertEqual([p29['earnings'], p29['deductions'], p29['employer'], p29['net']],
                         [1563125, 125050, 140612, 1438075])
        self.assertEqual(self.result()['P27']['employees']['E-2702|cc=OPD'],
                         {'status': 'held', 'codes': ['TOTAL_MISMATCH'], 'earnings': None, 'deductions': None,
                          'employer': None, 'net': None, 'payee': None, 'lines': None})
        self.assertEqual(self.result()['P01']['totals'],
                         {'earnings': sum(v['earnings'] for v in self.result()['P01']['employees'].values()),
                          'deductions': sum(v['deductions'] for v in self.result()['P01']['employees'].values()),
                          'employer': sum(v['employer'] for v in self.result()['P01']['employees'].values()),
                          'net': sum(v['net'] for v in self.result()['P01']['employees'].values())})

    # Changes that must keep every verdict and component.

    def test_metamorphic_layout_keeps_everything(self):
        rng = random.Random(53)
        for sid in ('P01', 'P02', 'P03', 'P06', 'P07', 'P08', 'P12', 'P13', 'P14', 'P16', 'P27', 'P29', 'P32',
                    'P38'):
            c = Copy(sid)
            try:
                found, footer = blocks(c.rows())
                rng.shuffle(found)
                out = []
                for opening, labels, columns, lines, totals, closing in found:
                    labels, lines, totals = list(labels), list(lines), list(totals)
                    for part in (labels, lines, totals):
                        rng.shuffle(part)
                    order = list(range(len(columns)))
                    rng.shuffle(order)
                    out += [opening, *labels, *[[r[i] for i in order] for r in [columns, *lines]], *totals, closing,
                            []]
                head = footer[1:-1]
                rng.shuffle(head)
                out = [footer[0], *head, footer[-1], []] + out
                c.write(out, end='\r\n', bom=True, pad=True)
                with self.subTest(story=sid):
                    self.same(self.judged(c.folder, sid), self.result()[sid])
            finally:
                c.tmp.cleanup()

    def test_a_page_break_moved_and_refooted_keeps_everyone(self):
        a, b = person('A', 'E-1'), person('B', 'E-2')
        c = person('C', 'E-3', earn='300.00', ded='30.00', er='15.00', net='270.00')
        lines = a + b + c
        want = {'E-1|cc=1': OK, 'E-2|cc=1': OK, 'E-3|cc=1': OK}
        for cut in (0, 3, 4, 6, 9, 12):
            with self.subTest(cut=cut):
                parts = [p for p in (('PG-1', lines[:cut]), ('PG-2', lines[cut:])) if p[1]]
                self.assertEqual(self.employees(register(*parts)), want)

    def test_blank_rows_and_spaces_change_nothing(self):
        rows = register(('PG-1', person('A')))
        rows.insert(4, ['', '  '])
        rows.insert(11, [' ', '', ''])
        rows[14][5] = '  net '
        rows[14][6] = ' 90.00 '
        rows[2][1] = ' ' + rows[2][1] + '  '
        got = self.case(rows)
        self.assertEqual(summary(got)['employees'], {'E-1|cc=1': OK})
        self.assertEqual(got['employees']['E-1|cc=1']['net'], 9000)

    def test_quoted_fields_read_as_written(self):
        lines = person('A')
        lines[0][4] = 'Allowance, "A"\nnight'
        lines += person('B', 'E-2')
        lines[5][2] = ''
        got = self.case(register(('PG-1', lines)))
        self.assertEqual(summary(got)['employees']['E-1|cc=1'], ['held', ['IDENTITY', 'LINE_UNREADABLE']])
        self.assertEqual(got['unplaced'], [[15, 'LINE_UNREADABLE']])
        lines[5][2] = 'cc=1'
        lines[0][4] = 'Allowance, "A"'
        got = self.case(register(('PG-1', lines)))
        self.assertIn(['A-1', 'Allowance, "A"', 'earning', 10000], got['employees']['E-1|cc=1']['lines'])

    def test_lone_carriage_returns_read_as_line_ends(self):
        raw = '\r'.join(','.join(r) for r in register(('PG-1', person('A')))) + '\r'
        got = self.case([], raw=raw.encode())
        self.assertNotIn('refused', got)
        self.assertEqual(summary(got)['employees'], {'E-1|cc=1': OK})

    def test_isolation(self):
        a, b = person('A', 'E-1'), person('B', 'E-2', net='90.01')
        self.assertEqual(self.employees(register(('PG-1', a + b))),
                         {'E-1|cc=1': OK, 'E-2|cc=1': ['inconsistent', ['NET_EQUATION']]})

    # Changes that must move a verdict.

    def test_dimensions_are_part_of_the_employee(self):
        lines = person('A')
        lines[1][2] = 'cc=2'
        self.assertEqual(self.employees(register(('PG-1', lines))),
                         {'E-1|cc=1': ['inconsistent', ['NET_EQUATION']], 'E-1|cc=2': ['missing', ['NET_ABSENT']]})

    def test_the_payee_is_never_the_employee(self):
        a, b = person('A', 'E-1', payee='E-2'), person('B', 'E-2', payee='E-2')
        got = self.case(register(('PG-1', a + b)))
        self.assertEqual(summary(got)['employees'], {'E-1|cc=1': OK, 'E-2|cc=1': OK})
        self.assertEqual(got['sharedPayees'], [['E-2', ['E-1', 'E-2']]])
        one = self.case(register(('PG-1', person('A', 'E-1', 'cc=1', 'P') + person('B', 'E-1', 'cc=2', 'P'))))
        self.assertEqual(one['sharedPayees'], [])

    def test_employer_never_in_net(self):
        got = self.employees(register(('PG-1', person('A', net='85.00'))))
        self.assertEqual(got, {'E-1|cc=1': ['inconsistent', ['NET_EQUATION']]})
        got = self.case(register(('PG-1', person('A', er='0.00'))))
        self.assertEqual(got['employees']['E-1|cc=1']['employer'], 0)

    def test_every_label_excludes_a_section(self):
        other = {'Entity': 'Other Co', 'Payroll run': 'PR-2', 'Currency': 'USD', 'Period start': '2026-08-01',
                 'Period end': '2026-10-31', 'Payroll posting date': '2026-09-26', 'Payment date': '2026-09-29'}
        for label in LABELS:
            with self.subTest(label=label):
                rows = register(('PG-1', person('A')), ('PG-X', person('X', 'E-9'), {'labels': {label: other[label]}}),
                                footer=run_totals(person('A')))
                got = self.case(rows)
                self.assertEqual(got['excludedSections'], ['PG-X'])
                self.assertEqual(summary(got)['employees'], {'E-1|cc=1': OK})

    def test_one_line_id_twice(self):
        a = person('A')
        twice = [a[0], ln('A-1', 'E-2', amount='100.00')] + person('B', 'E-2')[1:]
        got = self.employees(register(('PG-1', a), ('PG-2', twice)))
        self.assertEqual(got, {'E-1|cc=1': ['held', ['DUPLICATE_LINE']], 'E-2|cc=1': ['held', ['DUPLICATE_LINE']]})
        same = person('A') + [person('A')[0]]
        same[3][6] = '190.00'
        self.assertEqual(self.employees(register(('PG-1', same))), {'E-1|cc=1': ['held', ['DUPLICATE_LINE']]})

    def test_two_line_ids_with_equal_content_are_two_lines(self):
        lines = person('A', net='190.00')
        lines.append(ln('A-5', amount='100.00'))
        got = self.case(register(('PG-1', lines)))
        self.assertEqual(summary(got)['employees'], {'E-1|cc=1': OK})
        self.assertEqual(got['employees']['E-1|cc=1']['earnings'], 20000)

    def test_net_lines(self):
        self.assertEqual(self.employees(register(('PG-1', person('A')[:3]))), {'E-1|cc=1': ['missing', ['NET_ABSENT']]})
        two = person('A', net='45.00') + [ln('A-5', comp='Net pay', kind='net', amount='45.00')]
        self.assertEqual(self.employees(register(('PG-1', two))), {'E-1|cc=1': ['held', ['NET_REPEATED']]})
        only = [ln('A-1', comp='Net pay', kind='net', amount='0.00')]
        self.assertEqual(self.employees(register(('PG-1', only))), {'E-1|cc=1': OK})

    def test_payees(self):
        lines = person('A')
        lines[3][3] = 'A-2'
        self.assertEqual(self.employees(register(('PG-1', lines))), {'E-1|cc=1': ['held', ['PAYEE_CONFLICT']]})
        lines[3][3] = '=A-2'
        self.assertEqual(self.employees(register(('PG-1', lines))), {'E-1|cc=1': ['held', ['IDENTITY']]})

    # Refusals.

    def test_scope_refusals(self):
        rows = register(('PG-1', person('A')))
        for change in ({'Currency': 'XYZ'}, {'Period start': '2026-10-01'}, {'Period end': '2026-09-31'},
                       {'Payment date': '2026-09-26'}, {'Payroll posting date': '27-09-2026'},
                       {'Entity': ' Test Co'}, {'Payroll run': '=PR-1'}, {'Extra': 'x'}):
            with self.subTest(change=change):
                self.assertEqual(self.case(rows, scope=dict(RUN, **change)), {'refused': 'SCOPE'})
        for drop in LABELS:
            with self.subTest(drop=drop):
                self.assertEqual(self.case(rows, scope={k: v for k, v in RUN.items() if k != drop}),
                                 {'refused': 'SCOPE'})
        same_day = dict(RUN, **{'Period start': '2026-09-30', 'Payroll posting date': '2026-09-28'})
        self.assertNotIn('refused', self.case(rows, scope=same_day))

    def test_encoding_and_csv_refusals(self):
        for raw, want in ((b'Section,PG-1\n\xff\xfe\n', 'ENCODING'), (b'Section,"PG-1\n', 'CSV'),
                          (b'Section,P"G-1\n', 'CSV'), (b'Section,"PG"-1\n', 'CSV'), (b'"Section" ,PG-1\n', 'CSV')):
            with self.subTest(raw=raw):
                self.assertEqual(self.case([], raw=raw), {'refused': want})
        ok = self.case([], raw='\ufeff'.encode() + b'Section,"P""G-1"\n')
        self.assertNotIn('refused', ok)

    # Text, dates and amounts.

    def test_text_rules(self):
        for bad in ('=E-1', '+E-1', '@E-1', '-E-1', '#n/a', '#DIV/0!', 'E-1\u00a0', 'E\u200b1', 'E-1\t', 'a' * 501,
                    '\u202eE-1', ''):
            with self.subTest(employee=bad):
                lines = person('A') + person('B', 'E-2')
                lines[0][1] = bad
                got = self.case(register(('PG-1', lines)))
                self.assertEqual(got['run'], ['LINE_UNREADABLE'])
                self.assertEqual(got['unplaced'], [[10, 'LINE_UNREADABLE']])
                self.assertEqual(summary(got)['employees'], {'E-1|cc=1': ['held', ['LINE_UNREADABLE']],
                                                             'E-2|cc=1': ['held', ['LINE_UNREADABLE']]})
        long = 'a' * 500
        self.assertEqual(self.employees(register(('PG-1', person('A', long, 'cc 1'))))[f'{long}|cc 1'], OK)
        for column in (0, 3, 4):
            with self.subTest(column=column):
                lines = person('A')
                lines[1][column] = '#REF!'
                self.assertEqual(self.employees(register(('PG-1', lines))), {'E-1|cc=1': ['held', ['IDENTITY']]})

    def test_kinds_are_exact(self):
        for kind in ('Earning', 'earnings', 'allowance', 'NET'):
            with self.subTest(kind=kind):
                lines = person('A')
                lines[0][5] = kind
                got = self.case(register(('PG-1', lines), footer=run_totals(person('A'))))
                self.assertEqual(summary(got)['employees'],
                                 {'E-1|cc=1': ['held', ['KIND', 'RUN_TOTALS', 'TOTAL_FIELD']]})
                self.assertIsNone(got['totals'])

    def test_amount_rules(self):
        for cell, ok in (('-5.00', False), ('5.001', False), ('1.', False), ('.5', False), ('1,000.00', False),
                         ('', False), ('+5', False), ('5e2', False), ('1000000000000.01', False),
                         ('1000000000000.00', True), (' 90.00 ', True), ('٩٠٫٠٠', True), ('۹۰', True), ('90', True),
                         ('90.0', True), ('090.00', True)):
            with self.subTest(cell=cell):
                lines = person('A')
                lines[3][6] = cell
                printed = person('A')
                if ok:
                    printed[3][6] = str(Decimal(cell.strip().translate(oracle.DIGITS).replace('٫', '.')))
                got = self.case(register(('PG-1', lines, {'totals': foot(printed)}), footer=run_totals(printed)))
                if not ok:
                    self.assertEqual(summary(got)['employees'],
                                     {'E-1|cc=1': ['held', ['AMOUNT', 'RUN_TOTALS', 'TOTAL_FIELD']]})
                elif cell == '1000000000000.00':
                    self.assertEqual(summary(got)['employees'], {'E-1|cc=1': ['inconsistent', ['NET_EQUATION']]})
                else:
                    self.assertEqual(summary(got)['employees'], {'E-1|cc=1': OK})
        top = [ln('A-1', amount='100000000000000'), ln('A-2', comp='Net pay', kind='net', amount='100000000000000')]
        got = self.case(register(('PG-1', top, {'labels': {'Currency': 'JPY'}, 'totals': [
            ['Total earnings', '100000000000000'], ['Total deductions', '0'], ['Total employer', '0'],
            ['Total net', '100000000000000']]}), footer=[['Run totals', 'PR-1'], ['Total earnings', '100000000000000'],
                                                         ['Total deductions', '0'], ['Total employer', '0'],
                                                         ['Total net', '100000000000000'], ['End run totals', 'PR-1']]),
            scope=dict(RUN, Currency='JPY'))
        self.assertEqual(summary(got)['employees'], {'E-1|cc=1': OK})
        self.assertEqual(got['employees']['E-1|cc=1']['net'], 10 ** 14)

    def test_section_dates(self):
        for label in ('Period start', 'Period end', 'Payroll posting date', 'Payment date'):
            for bad in ('2026-02-30', '2026-9-01', '٢٠٢٦-٠٩-٠١'):
                with self.subTest(label=label, value=bad):
                    got = self.case(register(('PG-1', person('A')), ('PG-2', person('B', 'E-2'),
                                                                     {'labels': {label: bad}})))
                    self.assertEqual(got['run'], ['RUN_TOTAL_MISMATCH', 'SECTION_HEADER'])
                    self.assertEqual(got['unplaced'], [[20, 'SECTION_HEADER']])
        spaced = self.case(register(('PG-1', person('A'), {'labels': {'Payment date': ' 2026-09-28 '}})))
        self.assertEqual(summary(spaced)['employees'], {'E-1|cc=1': OK})

    # Sections.

    def test_section_header_faults(self):
        for kw in ({'extra': [['Region', 'North']]}, {'extra': [['Currency', 'SAR']]}, {'drop': ['Entity']},
                   {'labels': {'Entity': '=Test'}}, {'labels': {'Payroll run': ''}}):
            with self.subTest(**{k: str(v) for k, v in kw.items()}):
                got = self.case(register(('PG-1', person('A')), ('PG-2', person('B', 'E-2'), kw),
                                         footer=run_totals(person('A'))))
                self.assertEqual(got['run'], ['SECTION_HEADER'])
                self.assertEqual(got['excludedSections'], [])
                self.assertEqual(summary(got)['employees'], {'E-1|cc=1': ['held', ['SECTION_HEADER']]})
        three = register(('PG-1', person('A')))
        three[0] = ['Section', 'PG-1', 'x']
        got = self.case(three)
        self.assertEqual(got['run'], ['RUN_TOTAL_MISMATCH', 'SECTION_HEADER', 'SECTION_UNCLOSED'])
        self.assertEqual(got['employees'], {})
        bad_id = register(('PG-1', person('A')))
        bad_id[0][1] = '@PG'
        bad_id[-9][1] = '@PG'
        self.assertEqual(self.case(bad_id)['run'], ['RUN_TOTAL_MISMATCH', 'SECTION_HEADER'])

    def test_closure(self):
        for end in ('PG-9', False):
            with self.subTest(end=end):
                got = self.case(register(('PG-1', person('A'), {'end': end}), ('PG-2', person('B', 'E-2'))))
                self.assertEqual(got['run'], ['SECTION_UNCLOSED'])
                self.assertEqual(summary(got)['employees'], {'E-1|cc=1': ['held', ['SECTION_UNCLOSED']],
                                                             'E-2|cc=1': ['held', ['SECTION_UNCLOSED']]})
        rows = register(('PG-1', person('A'), {'end': False}), footer=False)
        rows += [['End run totals', 'PG-1']] + run_totals(person('A'))
        got = self.case(rows)
        self.assertEqual(got['run'], ['SECTION_UNCLOSED'])
        wide = register(('PG-1', person('A')))
        wide[-9] = ['End section', 'PG-1', 'x']
        self.assertEqual(self.case(wide)['run'], ['SECTION_UNCLOSED'])
        last = self.case(register(('PG-1', person('A'), {'end': False})))
        self.assertEqual((last['run'], last['totals']['net']), (['SECTION_UNCLOSED'], 9000))

    def test_unclosed_section_of_another_scope_is_not_excluded(self):
        other = {'labels': {'Payroll run': 'PR-0'}, 'end': False}
        got = self.case(register(('PG-1', person('A')), ('PG-0', person('X', 'E-9'), other),
                                 footer=run_totals(person('A'))))
        self.assertEqual(got['excludedSections'], [])
        self.assertEqual(got['run'], ['SECTION_UNCLOSED'])
        self.assertEqual(summary(got)['employees'], {'E-1|cc=1': ['held', ['SECTION_UNCLOSED']]})
        noted = dict(other, columns=COLUMNS + ['Notes'])
        got = self.case(register(('PG-1', person('A')), ('PG-0', person('X', 'E-9'), noted),
                                 footer=run_totals(person('A'))))
        self.assertEqual(got['run'], ['SECTION_COLUMNS', 'SECTION_UNCLOSED'])

    def test_columns(self):
        twice = ['Line ID', 'Employee ID', 'Employee dimensions', 'Payee account', 'Component', 'Kind', 'Kind']
        for columns in (twice, COLUMNS[:6], COLUMNS + ['Notes'], COLUMNS + ['Kind'],
                        ['employee ID' if c == 'Employee ID' else c for c in COLUMNS]):
            with self.subTest(columns=columns):
                got = self.case(register(('PG-1', person('A')), ('PG-2', person('B', 'E-2'), {'columns': columns}),
                                         footer=run_totals(person('A'))))
                self.assertEqual(got['run'], ['SECTION_COLUMNS'])
                self.assertEqual(got['unplaced'], [[20, 'SECTION_COLUMNS']])
        none = section('PG-2', [], columns=[], totals=[])
        got = self.case(section('PG-1', person('A')) + none + run_totals(person('A')))
        self.assertEqual(got['run'], ['SECTION_COLUMNS'])

    def test_excluded_section_is_not_judged_or_counted(self):
        junk = [['=x', 'E-1', 'cc=1', 'A-1', '', 'odd', '-1', 'more'], person('A')[0]]
        other = {'labels': {'Period start': '2026-08-01', 'Period end': '2026-08-31'}, 'totals': [['Total net', 'x']]}
        got = self.case(register(('PG-1', person('A')), ('PG-1', junk, other), footer=run_totals(person('A'))))
        self.assertEqual(summary(got)['employees'], {'E-1|cc=1': OK})
        self.assertEqual(got['excludedSections'], ['PG-1'])
        self.assertEqual(got['totals'], {'earnings': 10000, 'deductions': 1000, 'employer': 500, 'net': 9000})

    def test_section_id_twice(self):
        got = self.case(register(('PG-1', person('A')), ('PG-1', person('B', 'E-2'))))
        self.assertEqual(got['run'], ['SECTION_DUPLICATE'])

    def test_line_width(self):
        lines = person('A') + person('B', 'E-2')
        lines[0] = lines[0] + ['', 'checked']
        lines[4] = lines[4] + ['', '  ']
        self.assertEqual(self.employees(register(('PG-1', lines))),
                         {'E-1|cc=1': ['held', ['LINE_WIDTH']], 'E-2|cc=1': OK})

    def test_section_totals(self):
        a, b = person('A'), person('B', 'E-2')
        for totals in (foot(b)[:3], foot(b) + [['Total net', '90.00']], foot(b)[:3] + [['Total net', '90.00', 'x']],
                       foot(b, {'Total employer': ''}), foot(b, {'Total net': '9O.00'})):
            with self.subTest(totals=totals):
                got = self.employees(register(('PG-1', a), ('PG-2', b, {'totals': totals})))
                self.assertEqual(got, {'E-1|cc=1': OK, 'E-2|cc=1': ['held', ['TOTAL_FIELD']]})
        late = foot(b)[:2] + [b[3]] + foot(b)[2:]
        got = self.employees(register(('PG-1', a), ('PG-2', b[:3], {'totals': late}), footer=run_totals(a + b)))
        self.assertEqual(got, {'E-1|cc=1': OK, 'E-2|cc=1': ['held', ['TOTAL_FIELD']]})
        for label in TOTALS:
            with self.subTest(label=label):
                moved = foot(b, {label: str(Decimal(dict(foot(b))[label]) + Decimal('0.01'))})
                got = self.employees(register(('PG-1', a), ('PG-2', b, {'totals': moved})))
                self.assertEqual(got, {'E-1|cc=1': OK, 'E-2|cc=1': ['held', ['TOTAL_MISMATCH']]})

    def test_a_section_mismatch_holds_an_employee_whose_lines_span_it(self):
        b = person('B', 'E-2')
        got = self.employees(register(('PG-1', person('A') + b[:2]), ('PG-2', b[2:] + person('C', 'E-3'),
                                                                       {'totals': foot(b[2:] + person('C', 'E-3'),
                                                                                       {'Total employer': '10.01'})})))
        self.assertEqual(got, {'E-1|cc=1': OK, 'E-2|cc=1': ['held', ['TOTAL_MISMATCH']],
                               'E-3|cc=1': ['held', ['TOTAL_MISMATCH']]})

    # Run totals.

    def test_run_totals(self):
        lines = person('A')
        footers = {
            'absent': [],
            'twice': run_totals(lines) + run_totals(lines),
            'unclosed': run_totals(lines, end=False),
            'closed by another run': run_totals(lines, end='PR-2'),
            'another run': run_totals(lines, run='PR-2'),
            'a label missing': run_totals(lines)[:4] + run_totals(lines)[5:],
            'a label twice': run_totals(lines)[:5] + [['Total net', '90.00']] + run_totals(lines)[5:],
            'a note inside': run_totals(lines)[:5] + [['Checked', 'yes']] + run_totals(lines)[5:],
            'three cells': run_totals(lines, over={'Total net': '90.00'})[:4] + [['Total net', '90.00', 'x']]
            + run_totals(lines)[5:],
            'a blank total': run_totals(lines, over={'Total deductions': ''}),
            'a wide opening': [['Run totals', 'PR-1', 'x']] + run_totals(lines)[1:],
        }
        for name, footer in footers.items():
            with self.subTest(footer=name):
                got = self.case(register(('PG-1', lines), footer=footer or False))
                self.assertEqual(got['run'], ['RUN_TOTALS'])
                self.assertEqual(got['totals'], {'earnings': 10000, 'deductions': 1000, 'employer': 500, 'net': 9000})
        for label in TOTALS:
            with self.subTest(label=label):
                got = self.case(register(('PG-1', lines), footer=run_totals(lines, over={label: '0.01'})))
                self.assertEqual(got['run'], ['RUN_TOTAL_MISMATCH'])
        first = run_totals(lines) + section('PG-1', lines)
        self.assertEqual(summary(self.case(first))['employees'], {'E-1|cc=1': OK})

    def test_run_totals_count_read_sections_only(self):
        a, b = person('A'), person('B', 'E-2')
        got = self.case(register(('PG-1', a), ('PG-2', b, {'drop': ['Payment date']})))
        self.assertEqual(got['run'], ['RUN_TOTAL_MISMATCH', 'SECTION_HEADER'])
        got = self.case(register(('PG-1', a), ('PG-2', b, {'drop': ['Payment date']}), footer=run_totals(a)))
        self.assertEqual(got['run'], ['SECTION_HEADER'])
        self.assertEqual(got['totals'], {'earnings': 10000, 'deductions': 1000, 'employer': 500, 'net': 9000})

    def test_unreadable_lines_still_foot(self):
        lines = person('A') + person('B', 'E-2')
        lines[5][2] = ''
        got = self.case(register(('PG-1', lines)))
        self.assertEqual(got['run'], ['LINE_UNREADABLE'])
        self.assertEqual(got['totals']['deductions'], 2000)

    # Stray rows and unplaced.

    def test_stray_rows(self):
        for stray in (['Printed 2026-10-01'], ['End section', 'PG-1'], ['End run totals', 'PR-1'], ['', 'x']):
            with self.subTest(stray=stray):
                got = self.case([stray] + register(('PG-1', person('A'))))
                self.assertEqual(got['run'], ['STRAY_ROW'])
                self.assertEqual(got['unplaced'], [[1, 'STRAY_ROW']])
                self.assertEqual(summary(got)['employees'], {'E-1|cc=1': ['held', ['STRAY_ROW']]})

    def test_unplaced_is_in_row_order(self):
        lines = person('A') + person('B', 'E-2')
        lines[1][1] = ''
        rows = register(('PG-1', lines))
        rows.insert(0, ['note'])
        rows.append(['note'])
        got = self.case(rows)
        self.assertEqual(got['unplaced'], [[1, 'STRAY_ROW'], [12, 'LINE_UNREADABLE'], [len(rows), 'STRAY_ROW']])

    def test_empty_register(self):
        got = self.case([], raw=b'')
        self.assertEqual(summary(got), {'employees': {}, 'components': {}, 'excludedSections': [], 'sharedPayees': [],
                                        'unplaced': [], 'totals': {'earnings': 0, 'deductions': 0, 'employer': 0,
                                                                   'net': 0}, 'run': ['RUN_TOTALS']})


if __name__ == '__main__':
    unittest.main()
