"""GLT-1 holdout H1: eighteen new gl-tb-sections-1 stories, written after the
product supported the contract, sealed before any product run on them.

A new lineage: nothing is imported from the foundation's stories. Another
entity, ledger, quarter, currencies and account numbering; structures the
foundation lacked (sections and pages in another currency, columns and labels
in another order per section, values padded with spaces, Arabic section IDs,
dimensions holding a comma and quotes, a record ID shared across sections, a
section ID used twice, Persian digits, totals across pages and over totals,
case-only dimension differences, a footer under the TB, an extra page label,
period boundaries, an End section naming another section, yen at the
ceiling, Excel errors and a bracketed amount, a repeated Account label); and
four other CSV writers: Go encoding/csv, PHP fputcsv, LibreOffice Calc's CSV
export and a hand-written Java writer. Each story's intent was written by hand
from the contract before the sealed foundation oracle ran on these files.

  python3 -B audit/gl-tb-sections-holdout-h1/stories.py > frozen/stories.json
"""
import json
import random
import sys

RUN = {'Entity': 'Rawabi Contracting Co', 'Ledger': 'Statutory GL', 'Currency': 'SAR',
       'Currency basis': 'functional', 'Posting status': 'posted', 'Posting layer': 'actual',
       'Period start': '2027-01-01', 'Period end': '2027-03-31'}
SECTION_LABELS = ['Entity', 'Ledger', 'Account', 'Complete dimensions', 'Currency', 'Currency basis',
                  'Posting status', 'Posting layer', 'Period start', 'Period end']
PAGE_LABELS = ['Entity', 'Ledger', 'Currency', 'Currency basis', 'Posting status', 'Posting layer',
               'Period start', 'Period end']
GL_COLS = ['Record ID', 'Record kind', 'Posting date', 'Debit', 'Credit']
TB_COLS = ['Account', 'Complete dimensions', 'Row type', 'Parent account', 'Opening debit', 'Opening credit',
           'Period debit', 'Period credit', 'Closing debit', 'Closing credit']
COMPONENTS = ['openingDebit', 'openingCredit', 'periodDebit', 'periodCredit', 'closingDebit', 'closingCredit']
DEC = {'SAR': 2, 'BHD': 3, 'JPY': 0, 'USD': 2, 'EUR': 2}
PERSIAN = str.maketrans('0123456789.', '۰۱۲۳۴۵۶۷۸۹٫')
WRITERS = {'go', 'php', 'libreoffice', 'java'}


def sides(net):
    return (net, 0) if net >= 0 else (0, -net)


class Story:
    def __init__(self, sid, title, writer, currency='SAR'):
        assert writer in WRITERS
        self.id, self.title, self.writer = sid, title, writer
        self.run = dict(RUN, Currency=currency)
        self.d = DEC[currency]
        self.gl, self.tb, self.at = [], [], {}

    def amt(self, minor, persian=False):
        if isinstance(minor, str):
            return minor
        s = str(minor).rjust(self.d + 1, '0')
        s = f'{s[:-self.d]}.{s[-self.d:]}' if self.d else s
        return s.translate(PERSIAN) if persian else s

    def section(self, sec, account, dims, opening, moves, closing=None, order=None, over=None, extra=(),
                cols=GL_COLS, end=True, closing_row=True, pad=False, persian=False):
        """A GL section; returns its six components in minor units. moves are
        (record ID, date, debit, credit); a str amount is written as is and
        not summed."""
        self.at[sec] = len(self.gl) + 1
        lab = dict(self.run, Account=account, **{'Complete dimensions': dims})
        lab.update(over or {})
        rows = [['Section', sec]]
        rows += [[n, f'  {lab[n]} ' if pad else lab[n]] for n in (order or SECTION_LABELS)]
        rows += [list(r) for r in extra]
        rows.append(list(cols))

        def rec(rid, kind, date, dr, cr):
            v = {'Record ID': rid, 'Record kind': kind, 'Posting date': date,
                 'Debit': self.amt(dr, persian), 'Credit': self.amt(cr, persian)}
            rows.append([v[c] for c in cols])
        od, oc = sides(opening)
        rec(f'{sec}/O', 'opening', self.run['Period start'], od, oc)
        for rid, date, dr, cr in moves:
            rec(rid, 'movement', date, dr, cr)
        pd = sum(dr for _, _, dr, _ in moves if isinstance(dr, int))
        pc = sum(cr for _, _, _, cr in moves if isinstance(cr, int))
        cd, cc = sides(opening + pd - pc if closing is None else closing)
        if closing_row:
            rec(f'{sec}/C', 'closing', self.run['Period end'], cd, cc)
        if end:
            rows.append(['End section', sec if end is True else end])
        rows.append([])
        self.gl += rows
        return [od, oc, pd, pc, cd, cc]

    def page(self, pid, rows, over=None, order=None, cols=TB_COLS, extra=(), pad=False):
        """A TB page; rows are (account, dims, row type, parent, six amounts).
        Returns the row number of each TB row."""
        self.at[pid] = len(self.tb) + 1
        lab = dict(self.run)
        lab.update(over or {})
        out = [['Page', pid]] + [[n, f' {lab[n]}  ' if pad else lab[n]] for n in (order or PAGE_LABELS)]
        out += [list(r) for r in extra]
        out.append(list(cols))
        numbers = []
        for account, dims, kind, parent, six in rows:
            v = dict(zip(TB_COLS, [account, dims, kind, parent, *[self.amt(x) for x in six]]))
            numbers.append(len(self.tb) + len(out) + 1)
            out.append([v[c] for c in cols])
        out += [['End page', pid], []]
        self.tb += out
        return numbers

    def stray(self, row):
        self.tb.append(row)
        return len(self.tb)

    def done(self, accounts, excluded_sections=(), excluded_pages=(), orphans=(), unplaced=(), run=(), recipe=''):
        self.intent = {
            'accounts': {k: [v[0], sorted(v[1])] for k, v in accounts.items()},
            'excludedSections': sorted(excluded_sections),
            'excludedPages': sorted(excluded_pages),
            'orphanTotals': sorted(orphans),
            'unplaced': [[f, f'row {n}', sorted(c)] for f, n, c in sorted(unplaced)],
            'run': sorted(run),
        }
        self.recipe = recipe
        return self

    def files(self):
        out = []
        for role, rows in (('gl', self.gl), ('tb', self.tb)):
            while rows and not rows[-1]:
                rows = rows[:-1]
            out.append({'name': f'{self.id}-{role}.csv', 'writer': self.writer, 'cells': rows})
        return out


def moved(six, **delta):
    out = list(six)
    for k, v in delta.items():
        out[COMPONENTS.index(k)] += v
    return out


def stories():
    out = []
    ok = ('consistent', [])

    s = Story('H01', 'A USD section in a SAR run, and an EUR page', 'go')
    a = s.section('G-1010', '1010', 'proj=A', 250000, [('J-1', '2027-01-15', 50000, 0)])
    s.section('G-1020-USD', '1020', 'proj=A', 10000, [('J-2', '2027-02-01', 0, 2000)], over={'Currency': 'USD'})
    c = s.section('G-1030', '1030', 'proj=A', 0, [('J-3', '2027-03-10', 7500, 0)])
    s.page('TB-1', [('1010', 'proj=A', 'account', '', a), ('1020', 'proj=A', 'account', '', [10000, 0, 0, 2000, 8000, 0])])
    s.page('TB-2', [('1030', 'proj=A', 'account', '', c)], over={'Currency': 'EUR'})
    out.append(s.done({'1010|proj=A': ok, '1020|proj=A': ('missing', ['GL_SECTION_ABSENT']),
                       '1030|proj=A': ('missing', ['TB_ROW_ABSENT'])},
                      excluded_sections=['G-1020-USD'], excluded_pages=['TB-2']))

    s = Story('H02', 'Columns in another order in every section and page', 'php')
    a = s.section('G-2010', '2010', 'proj=B', -400000, [('J-21', '2027-01-05', 0, 120000), ('J-22', '2027-02-05', 30000, 0)],
                  cols=['Credit', 'Debit', 'Posting date', 'Record kind', 'Record ID'])
    b = s.section('G-2020', '2020', 'proj=B', 90000, [('J-23', '2027-03-05', 15000, 5000)],
                  cols=['Record kind', 'Record ID', 'Debit', 'Credit', 'Posting date'])
    c = s.section('G-2030', '2030', 'proj=B', 1200, [('J-24', '2027-03-06', 0, 300)])
    s.page('TB-1', [('2010', 'proj=B', 'account', '', a), ('2020', 'proj=B', 'account', '', b),
                    ('2030', 'proj=B', 'account', '', moved(c, periodCredit=100, closingDebit=-100))], cols=TB_COLS[::-1])
    out.append(s.done({'2010|proj=B': ok, '2020|proj=B': ok,
                       '2030|proj=B': ('difference', ['closingDebit', 'periodCredit'])}))

    s = Story('H03', 'Labels in another order, values padded with spaces, a blank row among them', 'java')
    a = s.section('G-3010', '3010', 'proj=C', 7700, [('J-31', '2027-01-07', 0, 700)], order=SECTION_LABELS[::-1],
                  pad=True, extra=[[]])
    b = s.section('G-3020', '3020', 'proj=C', 0, [('J-32', '2027-01-08', 1500, 0)],
                  order=SECTION_LABELS[5:] + SECTION_LABELS[:5], pad=True)
    s.page('TB-1', [('3010', 'proj=C', 'account', '', a), ('3020', ' proj=C ', 'account', '', b)],
           order=PAGE_LABELS[::-1], pad=True)
    out.append(s.done({'3010|proj=C': ok, '3020|proj=C': ok},
                      recipe='Ordinary spaces at both ends are removed; the order of labels and the blank row change nothing.'))

    s = Story('H04', 'Arabic section IDs, and dimensions holding a comma and quotes', 'libreoffice')
    dims = 'cc=1, region="N"'
    a = s.section('قسم-١', '4010', dims, 50000, [('J-41', '2027-02-02', 10000, 0)])
    b = s.section('قسم-٢', '4020', dims, 0, [('J-42', '2027-02-03', 0, 4000)])
    s.page('TB-1', [('4010', dims, 'account', '', a), ('4020', 'cc=1,region="N"', 'account', '', b)])
    out.append(s.done({f'4010|{dims}': ok, f'4020|{dims}': ('missing', ['TB_ROW_ABSENT']),
                       '4020|cc=1,region="N"': ('missing', ['GL_SECTION_ABSENT'])},
                      recipe='A dropped space after the comma is another dimension.'))

    s = Story('H05', 'A record ID shared across sections, and a section ID used twice', 'go')
    a = s.section('G-5010', '5010', 'proj=E', 1000, [('J-51', '2027-01-20', 500, 0)])
    b = s.section('G-5020', '5020', 'proj=E', 2000, [('J-51', '2027-01-21', 0, 500)])
    c = s.section('G-5030', '5030', 'proj=E', 300, [('J-53', '2027-01-22', 0, 100)])
    d = s.section('G-5030', '5040', 'proj=E', 400, [('J-54', '2027-01-23', 0, 100)])
    s.page('TB-1', [('5010', 'proj=E', 'account', '', a), ('5020', 'proj=E', 'account', '', b),
                    ('5030', 'proj=E', 'account', '', c), ('5040', 'proj=E', 'account', '', d)])
    out.append(s.done({'5010|proj=E': ok, '5020|proj=E': ok, '5030|proj=E': ('held', ['SECTION_DUPLICATE']),
                       '5040|proj=E': ('held', ['SECTION_DUPLICATE'])},
                      recipe='Record IDs are unique within a section; section IDs within the file.'))

    s = Story('H06', 'Bahraini dinars written in Persian digits in the GL', 'php', currency='BHD')
    a = s.section('G-6010', '6010', 'proj=F', 1234567, [('J-61', '2027-01-11', 2500, 0), ('J-62', '2027-02-11', 0, 1005)],
                  persian=True)
    b = s.section('G-6020', '6020', 'proj=F', -50000, [('J-63', '2027-03-11', 0, 1)], persian=True)
    s.page('TB-1', [('6010', 'proj=F', 'account', '', a),
                    ('6020', 'proj=F', 'account', '', moved(b, periodCredit=1, closingCredit=1))])
    out.append(s.done({'6010|proj=F': ok, '6020|proj=F': ('difference', ['closingCredit', 'periodCredit'])},
                      recipe='One fils: the TB credits 0.002 where the GL credits 0.001.'))

    s = Story('H07', 'A total whose rows sit on another page, and one whose row sits on an excluded page', 'libreoffice')
    a = s.section('G-7110', '7110', 'proj=G', 10000, [('J-71', '2027-01-02', 5000, 0)])
    b = s.section('G-7120', '7120', 'proj=G', 20000, [('J-72', '2027-01-03', 0, 1000)])
    c = s.section('G-7210', '7210', 'proj=G', 3000, [('J-73', '2027-01-04', 300, 0)])
    d = s.section('G-7220', '7220', 'proj=G', 4000, [('J-74', '2027-01-05', 0, 400)])
    s.page('TB-1', [('7110', 'proj=G', 'account', '7100', a), ('7120', 'proj=G', 'account', '7100', b),
                    ('7210', 'proj=G', 'account', '7200', c)])
    s.page('TB-2', [('7100', 'proj=G', 'total', '', [x + y for x, y in zip(a, b)]),
                    ('7200', 'proj=G', 'total', '', [x + y for x, y in zip(c, d)])])
    s.page('TB-3', [('7220', 'proj=G', 'account', '7200', d)],
           over={'Period start': '2026-10-01', 'Period end': '2026-12-31'})
    out.append(s.done({'7110|proj=G': ok, '7120|proj=G': ok, '7210|proj=G': ('held', ['TOTAL_MISMATCH']),
                       '7220|proj=G': ('missing', ['TB_ROW_ABSENT'])}, excluded_pages=['TB-3'],
                      recipe='A total counts the rows on read pages only.'))

    s = Story('H08', 'Two equal totals for one parent, and a total over totals', 'java')
    a = s.section('G-8110', '8110', 'proj=H', 6000, [('J-81', '2027-02-14', 100, 0)])
    b = s.section('G-8120', '8120', 'proj=H', 7000, [('J-82', '2027-02-15', 0, 200)])
    total = [x + y for x, y in zip(a, b)]
    s.page('TB-1', [('8110', 'proj=H', 'account', '8100', a), ('8120', 'proj=H', 'account', '8100', b),
                    ('8100', 'proj=H', 'total', '8000', total), ('8100', 'proj=H', 'total', '8000', total),
                    ('8000', 'proj=H', 'total', '', total)])
    out.append(s.done({'8110|proj=H': ok, '8120|proj=H': ok}, orphans=['8000|proj=H'],
                      recipe='Each total is checked on its own; a total over totals has no account rows.'))

    s = Story('H09', 'Dimensions that differ only by case', 'go')
    a = s.section('G-9010', '9010', 'Dept=Sales', 100, [('J-91', '2027-01-09', 50, 0)])
    b = s.section('G-9020', '9020', 'dept=ops', 0, [('J-92', '2027-01-10', 0, 20)])
    s.page('TB-1', [('9010', 'dept=sales', 'account', '', a), ('9020', 'dept=ops', 'account', '', b)])
    out.append(s.done({'9010|Dept=Sales': ('missing', ['TB_ROW_ABSENT']),
                       '9010|dept=sales': ('missing', ['GL_SECTION_ABSENT']), '9020|dept=ops': ok}))

    s = Story('H10', 'A zero section beside a zero TB row, and a TB zero with no section', 'php')
    a = s.section('G-1110', '1110', 'proj=J', 0, [])
    b = s.section('G-1120', '1120', 'proj=J', 5000, [])
    s.page('TB-1', [('1110', 'proj=J', 'account', '', a), ('1120', 'proj=J', 'account', '', b),
                    ('1130', 'proj=J', 'account', '', [0] * 6)])
    out.append(s.done({'1110|proj=J': ok, '1120|proj=J': ok, '1130|proj=J': ('missing', ['GL_SECTION_ABSENT'])},
                      recipe='Zero against a zero section agrees; zero against nothing is missing.'))

    s = Story('H11', 'A printed footer under the last TB page', 'libreoffice')
    a = s.section('G-1210', '1210', 'proj=K', 800, [('J-121', '2027-01-12', 80, 0)])
    b = s.section('G-1220', '1220', 'proj=K', 900, [('J-122', '2027-01-13', 0, 90)])
    s.page('TB-1', [('1210', 'proj=K', 'account', '', a), ('1220', 'proj=K', 'account', '', b)])
    footer = s.stray(['Printed by the ERP on 2027-04-02'])
    out.append(s.done({'1210|proj=K': ('held', ['STRAY_ROW']), '1220|proj=K': ('held', ['STRAY_ROW'])},
                      unplaced=[('tb', footer, ['STRAY_ROW'])], run=['STRAY_ROW']))

    s = Story('H12', 'A TB page with an extra Region label', 'java')
    a = s.section('G-1310', '1310', 'proj=L', 100, [('J-131', '2027-01-14', 10, 0)])
    b = s.section('G-1320', '1320', 'proj=L', 200, [('J-132', '2027-01-15', 0, 20)])
    s.page('TB-1', [('1310', 'proj=L', 'account', '', a)])
    s.page('TB-2', [('1320', 'proj=L', 'account', '', b)], extra=[['Region', 'West']])
    out.append(s.done({'1310|proj=L': ('held', ['PAGE_UNREADABLE']), '1320|proj=L': ('held', ['PAGE_UNREADABLE'])},
                      unplaced=[('tb', s.at['TB-2'], ['PAGE_UNREADABLE'])], run=['PAGE_UNREADABLE']))

    s = Story('H13', 'Movements on the first and last day, and one the day before', 'go')
    a = s.section('G-1410', '1410', 'proj=M', 0, [('J-141', '2027-01-01', 100, 0), ('J-142', '2027-03-31', 0, 40)])
    b = s.section('G-1420', '1420', 'proj=M', 0, [('J-143', '2026-12-31', 100, 0)])
    s.page('TB-1', [('1410', 'proj=M', 'account', '', a), ('1420', 'proj=M', 'account', '', b)])
    out.append(s.done({'1410|proj=M': ok, '1420|proj=M': ('held', ['POSTING_PERIOD'])}))

    s = Story('H14', 'An End section row naming another section', 'php')
    a = s.section('G-1510', '1510', 'proj=N', 700, [('J-151', '2027-02-20', 0, 70)], end='G-1520')
    b = s.section('G-1520', '1520', 'proj=N', 50, [('J-152', '2027-02-21', 5, 0)])
    s.page('TB-1', [('1510', 'proj=N', 'account', '', a), ('1520', 'proj=N', 'account', '', b)])
    out.append(s.done({'1510|proj=N': ('held', ['SECTION_UNCLOSED']), '1520|proj=N': ok}))

    out.append(scale())

    s = Story('H16', 'Yen at the ceiling', 'go', currency='JPY')
    a = s.section('G-1710', '1710', 'proj=P', 99999999999000, [('J-171', '2027-03-01', 999, 0)])
    b = s.section('G-1720', '1720', 'proj=P', 5000, [('J-172', '2027-03-02', 0, 1000)])
    c = s.section('G-1730', '1730', 'proj=P', 0, [('J-173', '2027-03-03', 1, 0)])
    s.section('G-1740', '1740', 'proj=P', 100000000000001, [])
    comma = [s.amt(x) for x in b]
    comma[3] = '1,000'
    s.page('TB-1', [('1710', 'proj=P', 'account', '', a), ('1720', 'proj=P', 'account', '', comma),
                    ('1730', 'proj=P', 'account', '', c), ('1740', 'proj=P', 'account', '', [0, 0, 0, 0, 0, 0])])
    out.append(s.done({'1710|proj=P': ok, '1720|proj=P': ('held', ['AMOUNT']), '1730|proj=P': ok,
                       '1740|proj=P': ('held', ['AMOUNT'])},
                      recipe='99,999,999,999,999 yen reads; one more than 10^14 and a thousands comma do not.'))

    s = Story('H17', 'Excel errors and a bracketed amount', 'php')
    a = s.section('G-1810', '1810', 'proj=Q', 100, [('J-181', '2027-01-17', 10, 0)])
    b = s.section('G-1820', '1820', 'proj=Q', 100, [('J-182', '2027-01-18', 10, 0)], over={'Ledger': '#REF!'})
    c = s.section('G-1830', '1830', 'proj=Q', 100, [('J-183', '2027-01-19', 0, '(5.00)')])
    d = s.section('G-1840', '1840', 'proj=Q', 100, [('J-184', '2027-01-20', 10, 0)])
    error = [s.amt(x) for x in d]
    error[4] = '#N/A'
    s.page('TB-1', [('1810', 'proj=Q', 'account', '', a), ('1820', 'proj=Q', 'account', '', b),
                    ('1830', 'proj=Q', 'account', '', c), ('1840', 'proj=Q', 'account', '', error)])
    out.append(s.done({'1810|proj=Q': ok, '1820|proj=Q': ('held', ['SECTION_HEADER']),
                       '1830|proj=Q': ('held', ['AMOUNT']), '1840|proj=Q': ('held', ['AMOUNT'])}))

    s = Story('H18', 'A section that writes its Account label twice', 'libreoffice')
    a = s.section('G-1910', '1910', 'proj=R', 100, [('J-191', '2027-01-21', 10, 0)], extra=[['Account', '1910']])
    b = s.section('G-1920', '1920', 'proj=R', 300, [('J-192', '2027-01-22', 0, 30)])
    s.page('TB-1', [('1910', 'proj=R', 'account', '', a), ('1920', 'proj=R', 'account', '', b)])
    out.append(s.done({'1910|proj=R': ('held', ['SECTION_UNREADABLE']), '1920|proj=R': ('held', ['SECTION_UNREADABLE'])},
                      unplaced=[('gl', s.at['G-1910'], ['SECTION_UNREADABLE'])], run=['SECTION_UNREADABLE'],
                      recipe='Twice is not once, even with one value.'))
    return out


def scale():
    """One hundred and fifty accounts in six cost centres over six pages.
    Account 41's TB moves period debit and closing debit by 2.50; account
    128's TB moves period credit down and closing debit up by 1.00; account
    77's row is on two pages; account 103's section has no closing."""
    rng = random.Random(7151)
    s = Story('H15', 'One hundred and fifty accounts in six cost centres over six pages', 'java')
    rows, want = [], {}
    for k in range(150):
        account, dims = f'{20000 + k * 13}', f'cc={k % 6}'
        moves = []
        for j in range(rng.randrange(0, 7)):
            amt = rng.randrange(100, 900000)
            date = f'2027-{rng.randrange(1, 4):02d}-{rng.randrange(1, 29):02d}'
            moves.append((f'M{k:03d}-{j}', date, amt, 0) if rng.random() < 0.5 else (f'M{k:03d}-{j}', date, 0, amt))
        opening = rng.randrange(-4000000, 4000000)
        if k in (41, 128):
            moves = [(f'M{k:03d}-0', '2027-02-10', 120000, 0), (f'M{k:03d}-1', '2027-02-20', 0, 50000)]
            opening = 6000000
        key = f'{account}|{dims}'
        six = s.section(f'S{k:03d}', account, dims, opening, moves, closing_row=k != 103)
        if k == 41:
            rows.append((account, dims, 'account', '', moved(six, periodDebit=250, closingDebit=250)))
            want[key] = ('difference', ['closingDebit', 'periodDebit'])
        elif k == 128:
            rows.append((account, dims, 'account', '', moved(six, periodCredit=-100, closingDebit=100)))
            want[key] = ('difference', ['closingDebit', 'periodCredit'])
        elif k == 77:
            rows += [(account, dims, 'account', '', six)] * 2
            want[key] = ('held', ['TB_CONFLICT'])
        elif k == 103:
            rows.append((account, dims, 'account', '', six))
            want[key] = ('missing', ['GL_CLOSING_ABSENT'])
        else:
            rows.append((account, dims, 'account', '', six))
            want[key] = ('consistent', [])
    rng.shuffle(rows)
    first = [i for i, r in enumerate(rows) if r[0] == '21001']
    assert len(first) == 2
    if first[1] // 25 == first[0] // 25:
        j = (first[0] // 25 + 1) % 6 * 25
        rows[first[1]], rows[j] = rows[j], rows[first[1]]
    for p in range(6):
        s.page(f'TB-{p + 1}', rows[p * 25:(p + 1) * 25 + (1 if p == 5 else 0)])
    return s.done(want, recipe='Two accounts that differ, one on two pages, one section without a closing.')


def main():
    out = [{'id': s.id, 'title': s.title, 'recipe': s.recipe, 'runScope': s.run, 'intent': s.intent,
            'files': s.files()} for s in stories()]
    out.sort(key=lambda s: s['id'])
    sys.stdout.write(json.dumps({'schema': 'tarasuf-glt1-sections-holdout-h1-stories/1', 'stories': out},
                                ensure_ascii=False, indent=1) + '\n')


if __name__ == '__main__':
    main()
