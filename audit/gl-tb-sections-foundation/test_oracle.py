"""The GLT-1 oracle agrees with every hand-written intent, reads neither the
stories nor their intent, keeps every verdict and component when nothing
decisive changes, and moves when one decisive fact moves, for each contract
rule, including the rules no story exercises.

  python3 -B -m unittest discover -s audit/gl-tb-sections-foundation -p test_oracle.py -v
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
    spec = importlib.util.spec_from_file_location('glt1_oracle', os.environ.get('ORACLE', HERE / 'oracle.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


oracle = load()
FACTS = json.loads((FROZEN / 'stories.json').read_text(encoding='utf-8'))
RUN = {'Entity': 'Synthetic Holding Co', 'Ledger': 'Main GL', 'Currency': 'SAR', 'Currency basis': 'functional',
       'Posting status': 'posted', 'Posting layer': 'actual', 'Period start': '2026-09-01', 'Period end': '2026-09-30'}
LABELS = ['Entity', 'Ledger', 'Account', 'Complete dimensions', 'Currency', 'Currency basis', 'Posting status',
          'Posting layer', 'Period start', 'Period end']
GL = ['Record ID', 'Record kind', 'Posting date', 'Debit', 'Credit']
TB = ['Account', 'Complete dimensions', 'Row type', 'Parent account', 'Opening debit', 'Opening credit',
      'Period debit', 'Period credit', 'Closing debit', 'Closing credit']
SOUND = ['100.00', '0.00', '50.00', '0.00', '150.00', '0.00']


def summary(judged):
    return {
        'accounts': {k: [v['status'], v['codes']] for k, v in judged['accounts'].items()},
        'excludedSections': judged['excludedSections'],
        'excludedPages': judged['excludedPages'],
        'orphanTotals': judged['orphanTotals'],
        'unplaced': judged['unplaced'],
        'run': judged['run'],
    }


def section(sid, account='1100', dims='cc=10', records=None, labels=None, drop=(), extra=(), columns=GL, end=True):
    """A GL section with one opening, one movement and one closing unless
    records are given, as rows in GL column order."""
    values = dict(RUN, Account=account, **{'Complete dimensions': dims})
    values.update(labels or {})
    if records is None:
        records = [[f'{sid}-O', 'opening', '2026-09-01', '100.00', '0.00'],
                   [f'{sid}-M', 'movement', '2026-09-10', '50.00', '0.00'],
                   [f'{sid}-C', 'closing', '2026-09-30', '150.00', '0.00']]
    rows = [['Section', sid]] + [[k, values[k]] for k in LABELS if k not in drop] + [list(r) for r in extra]
    rows += [list(columns)] + [list(r) for r in records]
    if end:
        rows.append(['End section', sid if end is True else end])
    return rows + [[]]


def page(pid, rows, labels=None, drop=(), columns=TB, end=True):
    values = dict(RUN)
    values.update(labels or {})
    out = [['Page', pid]] + [[k, values[k]] for k in LABELS if k in values and k not in drop]
    out += [list(columns)] + [list(r) for r in rows]
    if end:
        out.append(['End page', pid if end is True else end])
    return out + [[]]


def row(account='1100', dims='cc=10', kind='account', parent='', six=SOUND, after=()):
    return [account, dims, kind, parent, *six, *after]


class Case:
    """One story written here as CSV, judged by the oracle under test."""

    def __init__(self, gl, tb, scope=None, raw=None):
        self.tmp = tempfile.TemporaryDirectory()
        folder = Path(self.tmp.name)
        (folder / 'X-scope.json').write_text(json.dumps(RUN if scope is None else scope), encoding='utf-8')
        for name, rows in (('gl', gl), ('tb', tb)):
            if raw and name in raw:
                (folder / f'X-{name}.csv').write_bytes(raw[name])
                continue
            with (folder / f'X-{name}.csv').open('w', encoding='utf-8', newline='') as f:
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

    def rows(self, name):
        raw = (self.folder / f'{self.sid}-{name}.csv').read_bytes().decode('utf-8').lstrip('\ufeff')
        return [list(r) for r in csv.reader(io.StringIO(raw, newline=''))]

    def write(self, name, rows, end='\n', bom=False, pad=False):
        width = max(len(r) for r in rows)
        with (self.folder / f'{self.sid}-{name}.csv').open('w', encoding='utf-8-sig' if bom else 'utf-8',
                                                             newline='') as f:
            csv.writer(f, lineterminator=end).writerows(r + [''] * (width - len(r)) if pad else r for r in rows)

    def edit(self, name, first, column, value, nth=0):
        """Set one cell in the nth row whose first cell is first."""
        rows = self.rows(name)
        hits = [r for r in rows if r and r[0] == first]
        hits[nth][column] = value
        self.write(name, rows)


def blocks(rows, start, end):
    """The test's own split of a well-formed story: [(opening row, labels,
    column row, body, end row)], and blank rows dropped."""
    out, i = [], 0
    rows = [r for r in rows if any(c.strip(' ') for c in r)]
    while i < len(rows):
        assert rows[i][0] == start, rows[i]
        j = i + 1
        while rows[j][0] != end:
            j += 1
        inner = rows[i + 1:j]
        k = next(n for n, r in enumerate(inner) if len([c for c in r if c]) > 2)
        out.append((rows[i], inner[:k], inner[k], inner[k + 1:], rows[j]))
        i = j + 1
    return out


class Oracle(unittest.TestCase):
    _result = None

    def judged(self, folder, sid='X'):
        try:
            return oracle.judge(Path(folder), sid)
        except Exception as error:  # the oracle must judge any input it is given
            self.fail(f'the oracle stopped on {sid}: {error!r}')

    def result(self):
        if Oracle._result is None:
            try:
                Oracle._result = oracle.run(FROZEN)['stories']
            except Exception as error:
                self.fail(f'the oracle stopped on the frozen stories: {error!r}')
        return Oracle._result

    def case(self, gl, tb, **kw):
        c = Case(gl, tb, **kw)
        try:
            return self.judged(c.folder)
        finally:
            c.tmp.cleanup()

    def accounts(self, gl, tb, **kw):
        return summary(self.case(gl, tb, **kw))['accounts']

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
                self.assertEqual(summary(result[story['id']]), story['intent'])

    def test_expected_is_what_the_oracle_returns(self):
        expected = json.loads((FROZEN / 'EXPECTED.json').read_text(encoding='utf-8'))
        self.assertEqual(expected['stories'], self.result())

    def test_reads_neither_stories_nor_intent(self):
        with tempfile.TemporaryDirectory() as tmp:
            for p in [*FROZEN.glob('*.csv'), *FROZEN.glob('*-scope.json')]:
                shutil.copy(p, Path(tmp) / p.name)
            self.assertEqual(oracle.run(tmp)['stories'], self.result())

    def test_components_are_the_written_amounts(self):
        t02 = self.result()['T02']['accounts']
        self.assertEqual(t02['3000|cc=11']['gl'], [1000000, 0, 500000, 100000, 1400000, 0])
        self.assertEqual(t02['3000|cc=11']['tb'], [1000000, 0, 200000, 100000, 1100000, 0])
        t17 = self.result()['T17']['accounts']
        self.assertEqual(t17['3310|مركز=١']['tb'], [125500, 0, 10250, 0, 135750, 0])
        self.assertEqual(t17['3320|مركز=٢']['gl'], [0, 7000, 0, 1005, 0, 8005])
        self.assertEqual(self.result()['T09']['accounts']['9110|cc=10'], {'status': 'held', 'codes': ['TOTAL_MISMATCH'],
                                                                           'gl': None, 'tb': None})

    # Changes that must keep every verdict and component.

    def test_metamorphic_layout_keeps_everything(self):
        rng = random.Random(31)
        for sid in ('T01', 'T02', 'T03', 'T07', 'T08', 'T09', 'T11', 'T14', 'T17', 'T29'):
            c = Copy(sid)
            try:
                for name, start, end in (('gl', 'Section', 'End section'), ('tb', 'Page', 'End page')):
                    out = []
                    found = blocks(c.rows(name), start, end)
                    rng.shuffle(found)
                    for opening, labels, columns, body, closing in found:
                        labels = list(labels)
                        rng.shuffle(labels)
                        order = list(range(len(columns)))
                        rng.shuffle(order)
                        body = list(body)
                        if name == 'tb':
                            rng.shuffle(body)
                        out += [opening, *labels, *[[r[i] if i < len(r) else '' for i in order]
                                                    for r in [columns, *body]], closing, []]
                    c.write(name, out, end='\r\n', bom=True, pad=True)
                with self.subTest(story=sid):
                    self.assertEqual(self.judged(c.folder, sid), self.result()[sid])
            finally:
                c.tmp.cleanup()

    def test_blank_rows_and_spaces_change_nothing(self):
        gl = section('S-1') + [[]]
        gl.insert(5, ['', '  '])
        gl.insert(14, [' ', '', ''])
        tb = page('P-1', [row(), ['  ']])
        tb[2][1] = '  ' + tb[2][1] + ' '
        self.assertEqual(self.accounts(gl, tb), {'1100|cc=10': ['consistent', []]})

    def test_isolation(self):
        def change(c):
            c.edit('tb', '1100', 4, '5000.01')
            c.edit('tb', '1100', 8, '5900.01')
        got = summary(self.copy('T01', change))['accounts']
        self.assertEqual(got, {'1100|cc=10': ['difference', ['closingDebit', 'openingDebit']],
                               '1200|cc=10': ['consistent', []], '2100|cc=20': ['consistent', []]})

    # Changes that must move a verdict.

    def test_dimensions_are_part_of_the_key(self):
        got = summary(self.copy('T01', lambda c: c.edit('tb', '1100', 1, 'cc=010')))['accounts']
        self.assertEqual(got['1100|cc=10'], ['missing', ['TB_ROW_ABSENT']])
        self.assertEqual(got['1100|cc=010'], ['missing', ['GL_SECTION_ABSENT']])

    def test_section_currency_excludes_it(self):
        got = summary(self.copy('T01', lambda c: c.edit('gl', 'Currency', 1, 'USD', nth=1)))
        self.assertEqual(got['excludedSections'], ['S-1200'])
        self.assertEqual(got['accounts']['1200|cc=10'], ['missing', ['GL_SECTION_ABSENT']])

    def test_movement_after_the_period(self):
        got = summary(self.copy('T01', lambda c: c.edit('gl', 'G-12', 2, '2026-10-01')))['accounts']
        self.assertEqual(got['1100|cc=10'], ['held', ['POSTING_PERIOD']])

    def test_one_minor_unit_moves_the_verdict(self):
        got = summary(self.copy('T17', lambda c: c.edit('tb', '3320', 7, '1.005')))['accounts']
        self.assertEqual(got['3320|مركز=٢'], ['inconsistent', ['TB_BRIDGE']])

    # Refusals.

    def test_scope_refusals(self):
        for change in ({'Currency': 'XYZ'}, {'Currency basis': 'presentation'}, {'Posting status': 'draft'},
                       {'Period start': '2026-10-01'}, {'Period end': '2026-09-31'}, {'Entity': ' Synthetic'},
                       {'Extra': 'x'}):
            with self.subTest(change=change):
                self.assertEqual(self.case(section('S-1'), page('P-1', [row()]), scope=dict(RUN, **change)),
                                 {'refused': 'SCOPE'})
        scope = dict(RUN)
        del scope['Ledger']
        self.assertEqual(self.case(section('S-1'), page('P-1', [row()]), scope=scope), {'refused': 'SCOPE'})

    def test_encoding_and_csv_refusals(self):
        self.assertEqual(self.case([], page('P-1', [row()]), raw={'gl': b'Section,S-1\n\xff\xfe\n'}),
                         {'refused': 'ENCODING'})
        self.assertEqual(self.case([], page('P-1', [row()]), raw={'gl': b'Section,"S-1\n'}), {'refused': 'CSV'})

    # Text, dates and amounts.

    def test_text_rules(self):
        for bad in ('=1100', '+1100', '@1100', '-1100', '#n/a', '#DIV/0!', '1100\u00a0', 'cc\u200b', '1100\t',
                    'a' * 501, '\u202e1100'):
            with self.subTest(account=bad):
                got = self.case(section('S-1', account=bad) + section('S-2', account='1200'),
                                page('P-1', [row('1200')]))
                self.assertEqual(got['run'], ['SECTION_UNREADABLE'])
                self.assertEqual(summary(got)['accounts'], {'1200|cc=10': ['held', ['SECTION_UNREADABLE']]})
        self.assertEqual(self.accounts(section('S-1', account='a' * 500, dims='cc 10'),
                                       page('P-1', [row('a' * 500, 'cc 10')])),
                         {f"{'a' * 500}|cc 10": ['consistent', []]})

    def test_record_identity(self):
        records = [['S-1-O', 'opening', '2026-09-01', '100.00', '0.00'], ['=M', 'movement', '2026-09-10', '50.00', '0.00'],
                   ['S-1-C', 'closing', '2026-09-30', '150.00', '0.00']]
        self.assertEqual(self.accounts(section('S-1', records=records), page('P-1', [row()])),
                         {'1100|cc=10': ['held', ['IDENTITY']]})

    def test_amount_rules(self):
        for cell, ok in (('-5.00', False), ('5.001', False), ('1.', False), ('.5', False), ('1,000.00', False),
                         ('', False), ('1000000000000.01', False), ('1000000000000.00', True),
                         (' 150.00 ', True), ('۱۵۰٫۰۰', True), ('150', True), ('150.0', True)):
            with self.subTest(cell=cell):
                six = list(SOUND)
                six[4] = cell
                got = self.accounts(section('S-1', records=[
                    ['S-1-O', 'opening', '2026-09-01', '100.00', '0.00'],
                    ['S-1-M', 'movement', '2026-09-10', '50.00', '0.00'],
                    ['S-1-C', 'closing', '2026-09-30', '150.00', '0.00']]), page('P-1', [row(six=six)]))
                if ok and cell.strip() == '1000000000000.00':
                    self.assertEqual(got['1100|cc=10'], ['inconsistent', ['TB_BRIDGE']])
                elif ok:
                    self.assertEqual(got['1100|cc=10'], ['consistent', []])
                else:
                    self.assertEqual(got['1100|cc=10'], ['held', ['AMOUNT']])
        top = self.case(section('S-1', labels={'Currency': 'JPY'}, records=[
            ['S-1-O', 'opening', '2026-09-01', '100000000000000', '0'],
            ['S-1-C', 'closing', '2026-09-30', '100000000000000', '0']]),
            page('P-1', [row(six=['100000000000000', '0', '0', '0', '100000000000000', '0'])], labels={'Currency': 'JPY'}),
            scope=dict(RUN, Currency='JPY'))
        self.assertEqual(summary(top)['accounts'], {'1100|cc=10': ['consistent', []]})

    def test_dates(self):
        def records(opening='2026-09-01', moved='2026-09-10', closing='2026-09-30'):
            return [['S-1-O', 'opening', opening, '100.00', '0.00'], ['S-1-M', 'movement', moved, '50.00', '0.00'],
                    ['S-1-C', 'closing', closing, '150.00', '0.00']]
        for kw, want in (({'moved': '2026-09-01'}, 'consistent'), ({'moved': '2026-09-30'}, 'consistent'),
                         ({'moved': '2026-08-31'}, 'POSTING_PERIOD'), ({'moved': '2026-9-10'}, 'DATE'),
                         ({'moved': '2026-09-31'}, 'DATE'), ({'opening': '2026-08-31'}, 'DATE'),
                         ({'closing': '2026-09-29'}, 'DATE'), ({'moved': ' 2026-09-10 '}, 'consistent'),
                         ({'moved': '٢٠٢٦-٠٩-١٠'}, 'DATE')):
            with self.subTest(**kw):
                got = self.accounts(section('S-1', records=records(**kw)), page('P-1', [row()]))['1100|cc=10']
                self.assertEqual(got, ['consistent', []] if want == 'consistent' else ['held', [want]])
        got = self.accounts(section('S-1', labels={'Period start': '2026-02-30'}), page('P-1', [row()]))
        self.assertEqual(got, {'1100|cc=10': ['held', ['SECTION_HEADER']]})

    # GL sections.

    def test_section_header_faults(self):
        cases = (
            ({'extra': [['Region', 'North']]}, ['SECTION_HEADER']),
            ({'extra': [['Ledger', 'Main GL']]}, ['SECTION_HEADER']),
            ({'drop': ['Posting layer']}, ['SECTION_HEADER']),
            ({'labels': {'Ledger': '=Main'}}, ['SECTION_HEADER']),
        )
        for kw, want in cases:
            with self.subTest(**{k: str(v) for k, v in kw.items()}):
                self.assertEqual(self.accounts(section('S-1', **kw), page('P-1', [row()])),
                                 {'1100|cc=10': ['held', want]})
        three = section('S-1')
        three[0] = ['Section', 'S-1', 'x']
        self.assertEqual(self.accounts(three, page('P-1', [row()])),
                         {'1100|cc=10': ['held', ['SECTION_HEADER', 'SECTION_UNCLOSED']]})
        got = self.case(section('S-1', extra=[['Account', '1100']]) + section('S-2', account='1200'),
                        page('P-1', [row(), row('1200')]))
        self.assertEqual(got['run'], ['SECTION_UNREADABLE'])

    def test_unreadable_dimensions_hold_the_code_and_list_the_section(self):
        got = self.case(section('S-1', dims='\u200bcc') + section('S-2', dims='cc=20') + section('S-3', account='1200'),
                        page('P-1', [row(dims='cc=20'), row('1200')]))
        self.assertEqual(summary(got)['accounts'], {'1100|cc=20': ['held', ['SECTION_HEADER']],
                                                    '1200|cc=10': ['consistent', []]})
        self.assertEqual(got['unplaced'], [['gl', 'row 1', ['SECTION_HEADER']]])
        self.assertEqual(got['run'], [])

    def test_closure(self):
        for end in ('S-2', False):
            with self.subTest(end=end):
                got = self.accounts(section('S-1', end=end) + section('S-3', account='1200'),
                                    page('P-1', [row(), row('1200')]))
                self.assertEqual(got, {'1100|cc=10': ['held', ['SECTION_UNCLOSED']], '1200|cc=10': ['consistent', []]})
        late = section('S-1', labels={'Period start': '2026-08-01', 'Period end': '2026-08-31'}, end=False)
        got = self.case(late + section('S-3', account='1200'), page('P-1', [row(), row('1200')]))
        self.assertEqual(got['excludedSections'], [])
        self.assertEqual(summary(got)['accounts']['1100|cc=10'], ['held', ['SECTION_UNCLOSED']])

    def test_columns(self):
        twice = ['Record ID', 'Record kind', 'Posting date', 'Debit', 'Debit']
        wide = [['S-1-O', 'opening', '2026-09-01', '100.00', '0.00', 'note'],
                ['S-1-C', 'closing', '2026-09-30', '100.00', '0.00']]
        for kw in ({'columns': twice}, {'records': wide}, {'columns': [], 'records': []}):
            with self.subTest(**{k: str(v) for k, v in kw.items()}):
                self.assertEqual(self.accounts(section('S-1', **kw), page('P-1', [row()])),
                                 {'1100|cc=10': ['held', ['SECTION_COLUMNS']]})

    def test_excluded_section_is_not_judged_and_not_a_duplicate(self):
        late = section('S-0', labels={'Period start': '2026-08-01', 'Period end': '2026-08-31'},
                       records=[['=x', 'odd', 'never', '-1', '']])
        got = self.case(late + section('S-1'), page('P-1', [row()]))
        self.assertEqual(summary(got)['accounts'], {'1100|cc=10': ['consistent', []]})
        self.assertEqual(got['excludedSections'], ['S-0'])

    def test_section_id_twice(self):
        got = self.accounts(section('S-1') + section('S-1', account='1200'), page('P-1', [row(), row('1200')]))
        self.assertEqual(got, {'1100|cc=10': ['held', ['SECTION_DUPLICATE']],
                               '1200|cc=10': ['held', ['SECTION_DUPLICATE']]})

    def test_roles_absent_and_bridges(self):
        no_closing = [['S-1-O', 'opening', '2026-09-01', '100.00', '0.00']]
        self.assertEqual(self.accounts(section('S-1', records=no_closing), page('P-2', [row('1200')])),
                         {'1100|cc=10': ['missing', ['GL_CLOSING_ABSENT', 'TB_ROW_ABSENT']],
                          '1200|cc=10': ['missing', ['GL_SECTION_ABSENT']]})
        broken = [['S-1-O', 'opening', '2026-09-01', '100.00', '0.00'],
                  ['S-1-C', 'closing', '2026-09-30', '150.00', '0.00']]
        six = ['100.00', '0.00', '0.00', '0.00', '160.00', '0.00']
        self.assertEqual(self.accounts(section('S-1', records=broken), page('P-1', [row(six=six)])),
                         {'1100|cc=10': ['inconsistent', ['GL_BRIDGE', 'TB_BRIDGE']]})

    def test_both_sides_of_a_record_count(self):
        records = [['S-1-O', 'opening', '2026-09-01', '100.00', '30.00'],
                   ['S-1-M', 'movement', '2026-09-10', '50.00', '20.00'],
                   ['S-1-C', 'closing', '2026-09-30', '100.00', '0.00']]
        six = ['70.00', '0.00', '30.00', '0.00', '100.00', '0.00']
        self.assertEqual(self.accounts(section('S-1', records=records), page('P-1', [row(six=six)])),
                         {'1100|cc=10': ['difference', ['openingCredit', 'openingDebit', 'periodCredit',
                                                        'periodDebit']]})

    def test_empty_gl(self):
        self.assertEqual(self.accounts([], page('P-1', [row(), row('1200')])),
                         {'1100|cc=10': ['missing', ['GL_SECTION_ABSENT']],
                          '1200|cc=10': ['missing', ['GL_SECTION_ABSENT']]})

    # TB pages.

    def test_tb_stray_row(self):
        got = self.case(section('S-1'), [['Printed 2026-10-01']] + page('P-1', [row()]))
        self.assertEqual(summary(got)['accounts'], {'1100|cc=10': ['held', ['STRAY_ROW']]})
        self.assertEqual(got['unplaced'], [['tb', 'row 1', ['STRAY_ROW']]])

    def test_page_unreadable(self):
        for kw in ({'labels': {'Ledger': '#REF!'}}, {'drop': ['Currency']}, {'end': 'P-9'},
                   {'columns': TB[:-1]}):
            with self.subTest(**{k: str(v) for k, v in kw.items()}):
                got = self.case(section('S-1') + section('S-2', account='1200'),
                                page('P-1', [row()]) + page('P-2', [row('1200')], **kw))
                self.assertEqual(got['run'], ['PAGE_UNREADABLE'])
                self.assertEqual(summary(got)['accounts'], {'1100|cc=10': ['held', ['PAGE_UNREADABLE']],
                                                            '1200|cc=10': ['held', ['PAGE_UNREADABLE']]})
        extra = page('P-2', [row('1200')])
        extra.insert(3, ['Region', 'North'])
        got = self.case(section('S-1'), page('P-1', [row()]) + extra)
        self.assertEqual(got['unplaced'], [['tb', 'row 14', ['PAGE_UNREADABLE']]])

    def test_excluded_page_rows_do_not_conflict(self):
        got = self.case(section('S-1'), page('P-1', [row()]) + page('P-0', [row()], labels={'Ledger': 'Old GL'}))
        self.assertEqual(summary(got)['accounts'], {'1100|cc=10': ['consistent', []]})
        self.assertEqual(got['excludedPages'], ['P-0'])

    def test_rows(self):
        for bad in (row(dims=''), row(kind='Total'), row(account='-'), row(dims='cc=10\u200f')):
            with self.subTest(row=bad[:3]):
                got = self.case(section('S-1') + section('S-2', account='1200'), page('P-1', [bad, row('1200')]))
                self.assertEqual(got['run'], ['ROW_UNREADABLE'])
                self.assertEqual(got['unplaced'], [['tb', 'row 11', ['ROW_UNREADABLE']]])
        self.assertEqual(self.accounts(section('S-1'), page('P-1', [row(parent='=9000')])),
                         {'1100|cc=10': ['held', ['ROW_FIELD']]})
        self.assertEqual(self.accounts(section('S-1'), page('P-1', [row(parent='9000')])),
                         {'1100|cc=10': ['consistent', []]})

    def test_totals(self):
        a, b = row('1110', parent='1100'), row('1120', parent='1100', six=['1.00', '0.00', '0.00', '0.00', '1.00', '0.00'])
        gl = section('S-1', account='1110') + section('S-2', account='1120', records=[
            ['S-2-O', 'opening', '2026-09-01', '1.00', '0.00'], ['S-2-C', 'closing', '2026-09-30', '1.00', '0.00']])
        total = ['101.00', '0.00', '50.00', '0.00', '151.00', '0.00']
        ok = {'1110|cc=10': ['consistent', []], '1120|cc=10': ['consistent', []]}
        self.assertEqual(self.accounts(gl, page('P-1', [a, b, row('1100', kind='total', six=total)])), ok)
        other = row('1100', 'cc=20', kind='total', six=total)
        got = self.case(gl, page('P-1', [a, b, other]))
        self.assertEqual((summary(got)['accounts'], got['orphanTotals']), (ok, ['1100|cc=20']))
        nested = row('1000', kind='total', six=total)
        got = self.case(gl, page('P-1', [a, b, row('1100', kind='total', parent='1000', six=total), nested]))
        self.assertEqual((summary(got)['accounts'], got['orphanTotals']), (ok, ['1000|cc=10']))
        blank = list(b)
        blank[6] = ''
        got = self.accounts(gl, page('P-1', [a, blank, row('1100', kind='total', six=total)]))
        self.assertEqual(got, {'1110|cc=10': ['held', ['TOTAL_FIELD']], '1120|cc=10': ['held', ['AMOUNT', 'TOTAL_FIELD']]})
        got = self.accounts(gl, page('P-1', [a, row('1100', kind='total', six=total)]) + page('P-0', [b], labels={
            'Period start': '2026-08-01', 'Period end': '2026-08-31'}))
        self.assertEqual(got, {'1110|cc=10': ['held', ['TOTAL_MISMATCH']], '1120|cc=10': ['missing', ['TB_ROW_ABSENT']]})
        got = self.accounts(gl + section('S-3', account='1100', records=[
            ['S-3-O', 'opening', '2026-09-01', '101.00', '0.00'], ['S-3-M', 'movement', '2026-09-10', '50.00', '0.00'],
            ['S-3-C', 'closing', '2026-09-30', '151.00', '0.00']]), page('P-1', [a, b, row('1100', kind='total', six=total)]))
        self.assertEqual(got, dict(ok, **{'1100|cc=10': ['missing', ['TB_ROW_ABSENT']]}))
