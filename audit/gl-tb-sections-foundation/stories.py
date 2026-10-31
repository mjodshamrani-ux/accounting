"""GLT-1 foundation stories: a GL detail report in account sections and a
trial balance in pages, written as the proposed gl-tb-sections-1 contract
(contract.json) reads them.

Each story names its two files, the CSV writer for each, the run scope the
accountant confirms, and its intent: the status and codes of every account
(account|dimensions), the excluded sections and pages, and the run codes,
written by hand from the contract before any oracle ran. All names and
amounts are invented.

  python3 -B audit/gl-tb-sections-foundation/stories.py > frozen/stories.json
"""
import json
import random
import sys

RUN = {'Entity': 'Synthetic Holding Co', 'Ledger': 'Main GL', 'Currency': 'SAR', 'Currency basis': 'functional',
       'Posting status': 'posted', 'Posting layer': 'actual', 'Period start': '2026-09-01',
       'Period end': '2026-09-30'}
SECTION_LABELS = ['Entity', 'Ledger', 'Account', 'Complete dimensions', 'Currency', 'Currency basis',
                  'Posting status', 'Posting layer', 'Period start', 'Period end']
PAGE_LABELS = ['Entity', 'Ledger', 'Currency', 'Currency basis', 'Posting status', 'Posting layer',
               'Period start', 'Period end']
GL_COLUMNS = ['Record ID', 'Record kind', 'Posting date', 'Debit', 'Credit']
TB_COLUMNS = ['Account', 'Complete dimensions', 'Row type', 'Parent account', 'Opening debit', 'Opening credit',
              'Period debit', 'Period credit', 'Closing debit', 'Closing credit']
SIX = ['openingDebit', 'openingCredit', 'periodDebit', 'periodCredit', 'closingDebit', 'closingCredit']
DECIMALS = {'SAR': 2, 'KWD': 3, 'JPY': 0}
WRITERS = {'py', 'py-pad', 'node'}


def money(minor, decimals):
    if isinstance(minor, str):
        return minor
    s = str(minor).rjust(decimals + 1, '0')
    return f'{s[:-decimals]}.{s[-decimals:]}' if decimals else s


def sides(net):
    return (net, 0) if net >= 0 else (0, -net)


class Story:
    def __init__(self, sid, title, writer, currency='SAR'):
        assert writer in WRITERS
        self.id, self.title, self.writer = sid, title, writer
        self.run = dict(RUN, Currency=currency)
        self.d = DECIMALS[currency]
        self.gl, self.tb = [], []
        self.at = {}
        self.recipe = ''

    def m(self, v):
        return money(v, self.d)

    def section(self, sec, account, dims, opening, moves, closing=None, omit=(), over=None, head=GL_COLUMNS,
                end=True, opening_row=True, closing_row=True, opening_date=None, extra=()):
        """A GL section; returns its six components in minor units. moves are
        (record ID, date, debit, credit); closing defaults to what the bridge
        gives; extra records (ID, kind, date, debit, credit) go before the
        closing. head is the column row as written."""
        self.at[sec] = len(self.gl) + 1
        scope = dict(self.run, Account=account, **{'Complete dimensions': dims})
        scope.update(over or {})
        rows = [['Section', sec]] + [[lab, scope[lab]] for lab in SECTION_LABELS if lab not in omit]
        rows.append(list(head))

        def record(rid, kind, date, dr, cr):
            v = {'Record ID': rid, 'Record kind': kind, 'Posting date': date, 'Debit': self.m(dr), 'Credit': self.m(cr)}
            rows.append([v[c] for c in GL_COLUMNS])
        od, oc = sides(opening)
        if opening_row:
            record(f'{sec}-O', 'opening', opening_date or scope['Period start'], od, oc)
        for rid, date, dr, cr in moves:
            record(rid, 'movement', date, dr, cr)
        for r in extra:
            record(*r)
        pd = sum(dr for _, _, dr, _ in moves if isinstance(dr, int))
        pc = sum(cr for _, _, _, cr in moves if isinstance(cr, int))
        net = opening + pd - pc if closing is None else closing
        cd, cc = sides(net)
        if closing_row:
            record(f'{sec}-C', 'closing', scope['Period end'], cd, cc)
        if end:
            rows.append(['End section', sec])
        rows.append([])
        self.gl.extend(rows)
        return [od, oc, pd, pc, cd, cc]

    def page(self, pid, rows, over=None, end=True):
        """A TB page; rows are (account, dims, row type, parent, six amounts,
        optional cells after the ten). Returns the row number of each TB row."""
        self.at[pid] = len(self.tb) + 1
        head = dict(self.run)
        head.update(over or {})
        out = [['Page', pid]] + [[lab, head[lab]] for lab in PAGE_LABELS] + [list(TB_COLUMNS)]
        numbers = []
        for account, dims, kind, parent, six, *after in rows:
            numbers.append(len(self.tb) + len(out) + 1)
            out.append([account, dims, kind, parent, *[self.m(v) for v in six], *(after[0] if after else [])])
        if end:
            out.append(['End page', pid])
        out.append([])
        self.tb.extend(out)
        return numbers

    def stray(self, row):
        self.gl.append(row)
        return len(self.gl)

    def done(self, accounts, excluded_sections=(), excluded_pages=(), orphan_totals=(), unplaced=(), run=(),
             recipe=''):
        """unplaced are (file, row number, codes)."""
        self.intent = {
            'accounts': {k: [v[0], sorted(v[1])] for k, v in accounts.items()},
            'excludedSections': sorted(excluded_sections),
            'excludedPages': sorted(excluded_pages),
            'orphanTotals': sorted(orphan_totals),
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


def shifted(six, **delta):
    """Six components with some moved, the bridge kept: each named component
    moves by its delta."""
    out = list(six)
    for k, v in delta.items():
        out[SIX.index(k)] += v
    return out


def stories():
    out = []

    s = Story('T01', 'Three accounts, every component agreeing', 'py')
    a = s.section('S-1100', '1100', 'cc=10', 500000, [('G-11', '2026-09-04', 120000, 0), ('G-12', '2026-09-18', 0, 30000)])
    b = s.section('S-1200', '1200', 'cc=10', -200000, [('G-13', '2026-09-07', 15000, 45000)])
    c = s.section('S-2100', '2100', 'cc=20', 0, [('G-14', '2026-09-30', 0, 77700)])
    s.page('P-1', [('1100', 'cc=10', 'account', '', a), ('1200', 'cc=10', 'account', '', b),
                   ('2100', 'cc=20', 'account', '', c)])
    out.append(s.done({'1100|cc=10': ('consistent', []), '1200|cc=10': ('consistent', []),
                       '2100|cc=20': ('consistent', [])}))

    s = Story('T02', 'One account in two cost centres; the TB swaps their movements', 'py-pad')
    a = s.section('S-3000-11', '3000', 'cc=11', 1000000, [('G-21', '2026-09-05', 500000, 0), ('G-22', '2026-09-06', 0, 100000)])
    b = s.section('S-3000-12', '3000', 'cc=12', 1000000, [('G-23', '2026-09-05', 200000, 0), ('G-24', '2026-09-06', 0, 100000)])
    s.page('P-1', [('3000', 'cc=11', 'account', '', b), ('3000', 'cc=12', 'account', '', a)])
    out.append(s.done({'3000|cc=11': ('difference', ['closingDebit', 'periodDebit']),
                       '3000|cc=12': ('difference', ['closingDebit', 'periodDebit'])},
                      recipe='The two centres together agree; each one alone does not.'))

    s = Story('T03', 'The same net with another turnover', 'node')
    a = s.section('S-4100', '4100', 'cc=10', 0, [('G-31', '2026-09-03', 900000, 0), ('G-32', '2026-09-20', 0, 400000)])
    b = s.section('S-4200', '4200', 'cc=10', 30000, [('G-33', '2026-09-11', 5000, 0)])
    s.page('P-1', [('4100', 'cc=10', 'account', '', shifted(a, periodDebit=-200000, periodCredit=-200000)),
                   ('4200', 'cc=10', 'account', '', b)])
    out.append(s.done({'4100|cc=10': ('difference', ['periodCredit', 'periodDebit']), '4200|cc=10': ('consistent', [])},
                      recipe='Both nets are 5,000.00; the GL turned over 9,000 and 4,000, the TB 7,000 and 2,000.'))

    s = Story('T04', 'A written zero, and a blank amount', 'py')
    z = s.section('S-5100', '5100', 'cc=10', 0, [])
    b = s.section('S-5200', '5200', 'cc=10', 10000, [('G-41', '2026-09-09', 2500, 0)])
    c = s.section('S-5300', '5300', 'cc=10', -5000, [('G-42', '2026-09-10', 0, 1000)])
    blank = [s.m(v) for v in b]
    blank[3] = ''
    s.page('P-1', [('5100', 'cc=10', 'account', '', z), ('5200', 'cc=10', 'account', '', blank),
                   ('5300', 'cc=10', 'account', '', c)])
    out.append(s.done({'5100|cc=10': ('consistent', []), '5200|cc=10': ('held', ['AMOUNT']),
                       '5300|cc=10': ('consistent', [])},
                      recipe='A written zero is an amount; a blank period credit is not.'))

    s = Story('T05', 'An opening and a closing with no movement between them', 'py-pad')
    gl = s.section('S-6100', '6100', 'cc=10', 1000000, [], closing=1500000)
    b = s.section('S-6200', '6200', 'cc=10', 0, [('G-51', '2026-09-15', 4000, 0)])
    s.page('P-1', [('6100', 'cc=10', 'account', '', [1000000, 0, 500000, 0, 1500000, 0]),
                   ('6200', 'cc=10', 'account', '', b)])
    assert gl[2] == 0
    out.append(s.done({'6100|cc=10': ('inconsistent', ['GL_BRIDGE']), '6200|cc=10': ('consistent', [])},
                      recipe='The GL section cannot explain its own closing.'))

    s = Story('T06', 'A movement posted after the period end', 'node')
    a = s.section('S-7100', '7100', 'cc=10', 0, [('G-61', '2026-09-12', 8000, 0), ('G-62', '2026-10-02', 2000, 0)])
    b = s.section('S-7200', '7200', 'cc=10', 0, [('G-63', '2026-09-13', 0, 6000)])
    s.page('P-1', [('7100', 'cc=10', 'account', '', a), ('7200', 'cc=10', 'account', '', b)])
    out.append(s.done({'7100|cc=10': ('held', ['POSTING_PERIOD']), '7200|cc=10': ('consistent', [])}))

    s = Story('T07', 'A TB page with August in its header', 'py')
    a = s.section('S-8100', '8100', 'cc=10', 1000, [('G-71', '2026-09-02', 500, 0)])
    b = s.section('S-8200', '8200', 'cc=10', 2000, [('G-72', '2026-09-03', 0, 500)])
    c = s.section('S-8300', '8300', 'cc=10', 3000, [('G-73', '2026-09-04', 700, 0)])
    s.page('P-1', [('8100', 'cc=10', 'account', '', a), ('8200', 'cc=10', 'account', '', b)])
    s.page('P-2', [('8300', 'cc=10', 'account', '', c)],
           over={'Period start': '2026-08-01', 'Period end': '2026-08-31'})
    out.append(s.done({'8100|cc=10': ('consistent', []), '8200|cc=10': ('consistent', []),
                       '8300|cc=10': ('missing', ['TB_ROW_ABSENT'])}, excluded_pages=['P-2']))

    s = Story('T08', 'Sub-accounts and their parent total', 'py-pad')
    a = s.section('S-9110', '9110', 'cc=10', 40000, [('G-81', '2026-09-08', 10000, 2000)])
    b = s.section('S-9120', '9120', 'cc=10', -15000, [('G-82', '2026-09-09', 0, 3000)])
    total = [x + y for x, y in zip(a, b)]
    s.page('P-1', [('9110', 'cc=10', 'account', '9100', a), ('9120', 'cc=10', 'account', '9100', b),
                   ('9100', 'cc=10', 'total', '', total)])
    out.append(s.done({'9110|cc=10': ('consistent', []), '9120|cc=10': ('consistent', [])},
                      recipe='The total is checked and never compared with the GL.'))

    s = Story('T09', 'A parent total that disagrees with its rows', 'node')
    a = s.section('S-9110', '9110', 'cc=10', 40000, [('G-91', '2026-09-08', 10000, 2000)])
    b = s.section('S-9120', '9120', 'cc=10', -15000, [('G-92', '2026-09-09', 0, 3000)])
    c = s.section('S-9300', '9300', 'cc=10', 900, [('G-93', '2026-09-10', 100, 0)])
    total = [x + y for x, y in zip(a, b)]
    total[2] += 100000
    s.page('P-1', [('9110', 'cc=10', 'account', '9100', a), ('9120', 'cc=10', 'account', '9100', b),
                   ('9100', 'cc=10', 'total', '', total), ('9300', 'cc=10', 'account', '', c)])
    out.append(s.done({'9110|cc=10': ('held', ['TOTAL_MISMATCH']), '9120|cc=10': ('held', ['TOTAL_MISMATCH']),
                       '9300|cc=10': ('consistent', [])},
                      recipe='Each row agrees with the GL; the total says a row is missing or extra.'))

    s = Story('T10', 'A second snapshot of one account on another page', 'py')
    a = s.section('S-1500', '1500', 'cc=10', 7000, [('G-101', '2026-09-14', 3000, 0)])
    b = s.section('S-1600', '1600', 'cc=10', 0, [('G-102', '2026-09-15', 0, 400)])
    s.page('P-1', [('1500', 'cc=10', 'account', '', a), ('1600', 'cc=10', 'account', '', b)])
    s.page('P-2', [('1500', 'cc=10', 'account', '', a)])
    out.append(s.done({'1500|cc=10': ('held', ['TB_CONFLICT']), '1600|cc=10': ('consistent', [])},
                      recipe='Two equal snapshots are still two.'))

    s = Story('T11', 'An account code that lost its leading zero', 'py-pad')
    a = s.section('S-0410', '0410', 'cc=10', 12000, [('G-111', '2026-09-16', 4000, 1000)])
    b = s.section('S-0420', '0420', 'cc=10', 500, [('G-112', '2026-09-17', 0, 500)])
    s.page('P-1', [('410', 'cc=10', 'account', '', a), ('0420', 'cc=10', 'account', '', b)])
    out.append(s.done({'0410|cc=10': ('missing', ['TB_ROW_ABSENT']), '410|cc=10': ('missing', ['GL_SECTION_ABSENT']),
                       '0420|cc=10': ('consistent', [])},
                      recipe='Equal amounts never join 0410 to 410.'))

    s = Story('T12', 'A section without its dimensions label', 'node')
    a = s.section('S-2200-31', '2200', 'cc=31', 3000, [('G-121', '2026-09-18', 1000, 0)])
    b = s.section('S-2200-32', '2200', 'cc=32', 6000, [('G-122', '2026-09-19', 0, 2000)], omit=['Complete dimensions'])
    c = s.section('S-2300', '2300', 'cc=31', 100, [('G-123', '2026-09-20', 0, 100)])
    s.page('P-1', [('2200', 'cc=31', 'account', '', a), ('2200', 'cc=32', 'account', '', b),
                   ('2300', 'cc=31', 'account', '', c)])
    out.append(s.done({'2200|cc=31': ('held', ['SECTION_HEADER']), '2200|cc=32': ('held', ['SECTION_HEADER']),
                       '2300|cc=31': ('consistent', [])}, unplaced=[('gl', s.at['S-2200-32'], ['SECTION_HEADER'])],
                      recipe='The section after cc=31 does not inherit it; every 2200 waits.'))

    s = Story('T13', 'A zero account in the TB with no GL section', 'py')
    b = s.section('S-2500', '2500', 'cc=10', 800, [('G-131', '2026-09-21', 200, 0)])
    s.page('P-1', [('2400', 'cc=10', 'account', '', [0, 0, 0, 0, 0, 0]), ('2500', 'cc=10', 'account', '', b)])
    out.append(s.done({'2400|cc=10': ('missing', ['GL_SECTION_ABSENT']), '2500|cc=10': ('consistent', [])},
                      recipe='Zero is listed, not passed.'))

    s = Story('T14', 'A GL section from August', 'py-pad')
    a = s.section('S-2600', '2600', 'cc=10', 4000, [('G-141', '2026-09-22', 1000, 0)])
    s.section('S-2700-AUG', '2700', 'cc=10', 900, [('G-142', '2026-08-22', 100, 0)],
              over={'Period start': '2026-08-01', 'Period end': '2026-08-31'})
    s.page('P-1', [('2600', 'cc=10', 'account', '', a), ('2700', 'cc=10', 'account', '', [1000, 0, 0, 0, 1000, 0])])
    out.append(s.done({'2600|cc=10': ('consistent', []), '2700|cc=10': ('missing', ['GL_SECTION_ABSENT'])},
                      excluded_sections=['S-2700-AUG']))

    s = Story('T15', 'Two GL sections for one account', 'node')
    a = s.section('S-2800-A', '2800', 'cc=10', 1000, [('G-151', '2026-09-23', 500, 0)])
    s.section('S-2800-B', '2800', 'cc=10', 1000, [('G-152', '2026-09-23', 500, 0)])
    b = s.section('S-2900', '2900', 'cc=10', 0, [('G-153', '2026-09-24', 0, 50)])
    s.page('P-1', [('2800', 'cc=10', 'account', '', a), ('2900', 'cc=10', 'account', '', b)])
    out.append(s.done({'2800|cc=10': ('held', ['SECTION_DUPLICATE']), '2900|cc=10': ('consistent', [])}))

    s = Story('T16', 'A note written between two sections', 'py')
    a = s.section('S-3110', '3110', 'cc=10', 2000, [('G-161', '2026-09-25', 300, 0)])
    note = s.stray(['Reviewed by the accountant'])
    b = s.section('S-3120', '3120', 'cc=10', 0, [('G-162', '2026-09-26', 0, 70)])
    s.page('P-1', [('3110', 'cc=10', 'account', '', a), ('3120', 'cc=10', 'account', '', b)])
    out.append(s.done({'3110|cc=10': ('held', ['STRAY_ROW']), '3120|cc=10': ('held', ['STRAY_ROW'])},
                      unplaced=[('gl', note, ['STRAY_ROW'])], run=['STRAY_ROW'],
                      recipe='Nothing says which section the note belongs to.'))

    s = Story('T17', 'Kuwaiti dinars, Arabic-Indic digits, Arabic dimensions', 'node', currency='KWD')
    a = s.section('S-3310', '3310', 'مركز=١', 125500, [('G-171', '2026-09-02', 10250, 0)])
    b = s.section('S-3320', '3320', 'مركز=٢', -7000, [('G-172', '2026-09-03', 0, 1005)])
    to_ar = str.maketrans('0123456789.', '٠١٢٣٤٥٦٧٨٩٫')
    s.page('P-1', [('3310', 'مركز=١', 'account', '', [s.m(v).translate(to_ar) for v in a]),
                   ('3320', 'مركز=٢', 'account', '', shifted(b, periodCredit=5, closingCredit=5))])
    out.append(s.done({'3310|مركز=١': ('consistent', []),
                       '3320|مركز=٢': ('difference', ['closingCredit', 'periodCredit'])},
                      recipe='Three decimals: the TB credits 1.010 where the GL credits 1.005.'))

    s = Story('T18', "A TB row whose own bridge breaks", 'py-pad')
    a = s.section('S-3400', '3400', 'cc=10', 6000, [('G-181', '2026-09-04', 2000, 500)])
    b = s.section('S-3500', '3500', 'cc=10', 100, [('G-182', '2026-09-05', 50, 0)])
    broken = list(a)
    broken[4] += 10000
    s.page('P-1', [('3400', 'cc=10', 'account', '', broken), ('3500', 'cc=10', 'account', '', b)])
    out.append(s.done({'3400|cc=10': ('inconsistent', ['TB_BRIDGE']), '3500|cc=10': ('consistent', [])}))

    s = Story('T19', 'A section left without its end row', 'node')
    a = s.section('S-3600', '3600', 'cc=10', 5000, [('G-191', '2026-09-06', 0, 2500)], end=False)
    b = s.section('S-3700', '3700', 'cc=10', 0, [('G-192', '2026-09-07', 900, 0)])
    s.page('P-1', [('3600', 'cc=10', 'account', '', a), ('3700', 'cc=10', 'account', '', b)])
    out.append(s.done({'3600|cc=10': ('held', ['SECTION_UNCLOSED']), '3700|cc=10': ('consistent', [])}))

    s = Story('T20', 'A section without its opening row', 'py')
    a = s.section('S-3800', '3800', 'cc=10', 0, [('G-201', '2026-09-08', 400, 0)], opening_row=False)
    b = s.section('S-3900', '3900', 'cc=10', 2500, [('G-202', '2026-09-09', 0, 250)])
    s.page('P-1', [('3800', 'cc=10', 'account', '', a), ('3900', 'cc=10', 'account', '', b)])
    out.append(s.done({'3800|cc=10': ('missing', ['GL_OPENING_ABSENT']), '3900|cc=10': ('consistent', [])}))

    s = Story('T21', 'A TB page that never ends', 'py-pad')
    a = s.section('S-4500', '4500', 'cc=10', 6000, [('G-211', '2026-09-10', 1000, 0)])
    b = s.section('S-4600', '4600', 'cc=10', 0, [('G-212', '2026-09-11', 0, 2000)])
    c = s.section('S-4700', '4700', 'cc=10', 300, [('G-213', '2026-09-12', 0, 300)])
    s.page('P-1', [('4500', 'cc=10', 'account', '', a), ('4600', 'cc=10', 'account', '', b)])
    s.page('P-2', [('4700', 'cc=10', 'account', '', c)], end=False)
    out.append(s.done({'4500|cc=10': ('held', ['PAGE_UNREADABLE']), '4600|cc=10': ('held', ['PAGE_UNREADABLE']),
                       '4700|cc=10': ('held', ['PAGE_UNREADABLE'])},
                      unplaced=[('tb', s.at['P-2'], ['PAGE_UNREADABLE'])], run=['PAGE_UNREADABLE'],
                      recipe='Rows after an unclosed page could belong to any page.'))

    s = Story('T22', 'A section whose account reads as a formula', 'node')
    a = s.section('S-4800', '=4800', 'cc=10', 1500, [('G-221', '2026-09-13', 500, 0)])
    b = s.section('S-4900', '4900', 'cc=10', 0, [('G-222', '2026-09-14', 0, 900)])
    s.page('P-1', [('4800', 'cc=10', 'account', '', a), ('4900', 'cc=10', 'account', '', b)])
    out.append(s.done({'4800|cc=10': ('held', ['SECTION_UNREADABLE']), '4900|cc=10': ('held', ['SECTION_UNREADABLE'])},
                      unplaced=[('gl', s.at['S-4800'], ['SECTION_UNREADABLE'])], run=['SECTION_UNREADABLE'],
                      recipe='=4800 is refused, never read as 4800.'))

    s = Story('T23', 'Totals: one over nothing, one with a blank', 'py')
    a = s.section('S-5110', '5110', 'cc=10', 2000, [('G-231', '2026-09-15', 700, 0)])
    b = s.section('S-5120', '5120', 'cc=10', 3000, [('G-232', '2026-09-16', 0, 1000)])
    c = s.section('S-5200', '5200', 'cc=10', 100, [('G-233', '2026-09-17', 100, 0)])
    total = [s.m(x + y) for x, y in zip(a, b)]
    total[1] = ''
    s.page('P-1', [('5110', 'cc=10', 'account', '5100', a), ('5120', 'cc=10', 'account', '5100', b),
                   ('5100', 'cc=10', 'total', '', total), ('5200', 'cc=10', 'account', '', c),
                   ('5900', 'cc=10', 'total', '', [0, 0, 0, 0, 0, 0])])
    out.append(s.done({'5110|cc=10': ('held', ['TOTAL_FIELD']), '5120|cc=10': ('held', ['TOTAL_FIELD']),
                       '5200|cc=10': ('consistent', [])}, orphan_totals=['5900|cc=10'],
                      recipe='A total that cannot be read cannot vouch for its rows.'))

    s = Story('T24', 'A section without its closing, and one with two openings', 'py-pad')
    a = s.section('S-5410', '5410', 'cc=10', 400, [('G-241', '2026-09-18', 100, 0)], closing_row=False)
    b = s.section('S-5420', '5420', 'cc=10', 800, [('G-242', '2026-09-19', 0, 200)],
                  extra=[('S-5420-O2', 'opening', '2026-09-01', 800, 0)])
    c = s.section('S-5430', '5430', 'cc=10', 0, [('G-243', '2026-09-20', 50, 0)])
    s.page('P-1', [('5410', 'cc=10', 'account', '', a), ('5420', 'cc=10', 'account', '', b),
                   ('5430', 'cc=10', 'account', '', c)])
    out.append(s.done({'5410|cc=10': ('missing', ['GL_CLOSING_ABSENT']), '5420|cc=10': ('held', ['ROLE_REPEATED']),
                       '5430|cc=10': ('consistent', [])}))

    s = Story('T25', 'A repeated record ID, a late opening date, an unknown kind', 'node')
    a = s.section('S-5510', '5510', 'cc=10', 1000, [('G-251', '2026-09-02', 100, 0), ('G-251', '2026-09-03', 100, 0)])
    b = s.section('S-5520', '5520', 'cc=10', 1000, [('G-252', '2026-09-04', 0, 100)], opening_date='2026-09-02')
    c = s.section('S-5530', '5530', 'cc=10', 1000, [('G-253', '2026-09-05', 0, 100)],
                  extra=[('G-254', 'adjustment', '2026-09-06', 0, 0)])
    d = s.section('S-5540', '5540', 'cc=10', 1000, [('G-255', '2026-09-07', 0, 100)])
    s.page('P-1', [('5510', 'cc=10', 'account', '', a), ('5520', 'cc=10', 'account', '', b),
                   ('5530', 'cc=10', 'account', '', c), ('5540', 'cc=10', 'account', '', d)])
    out.append(s.done({'5510|cc=10': ('held', ['DUPLICATE_RECORD']), '5520|cc=10': ('held', ['DATE']),
                       '5530|cc=10': ('held', ['KIND']), '5540|cc=10': ('consistent', [])}))

    s = Story('T26', 'Yen: a fraction, and a cell past the columns', 'py', currency='JPY')
    a = s.section('S-5610', '5610', 'cc=10', 150000, [('G-261', '2026-09-08', 2500, 0)])
    b = s.section('S-5620', '5620', 'cc=10', 1500, [('G-262', '2026-09-09', 0, 300)])
    c = s.section('S-5630', '5630', 'cc=10', -4000, [('G-263', '2026-09-10', 700, 0)])
    fraction = [s.m(v) for v in b]
    fraction[0] = '1500.5'
    s.page('P-1', [('5610', 'cc=10', 'account', '', a, ['checked']), ('5620', 'cc=10', 'account', '', fraction),
                   ('5630', 'cc=10', 'account', '', c)])
    out.append(s.done({'5610|cc=10': ('held', ['ROW_FIELD']), '5620|cc=10': ('held', ['AMOUNT']),
                       '5630|cc=10': ('consistent', [])},
                      recipe='Yen has no decimals; 1500.5 is refused, not rounded.'))

    s = Story('T27', 'A TB row typed Account with a capital', 'node')
    a = s.section('S-5710', '5710', 'cc=10', 900, [('G-271', '2026-09-11', 0, 90)])
    b = s.section('S-5720', '5720', 'cc=10', 0, [('G-272', '2026-09-12', 60, 0)])
    rows = s.page('P-1', [('5710', 'cc=10', 'Account', '', a), ('5720', 'cc=10', 'account', '', b)])
    out.append(s.done({'5710|cc=10': ('held', ['ROW_UNREADABLE']), '5720|cc=10': ('held', ['ROW_UNREADABLE'])},
                      unplaced=[('tb', rows[0], ['ROW_UNREADABLE'])], run=['ROW_UNREADABLE'],
                      recipe='Account and account are two words; a row of unknown type could be a total over any.'))

    s = Story('T28', 'A section whose columns say Amount', 'py-pad')
    a = s.section('S-5810', '5810', 'cc=10', 2000, [('G-281', '2026-09-13', 0, 500)],
                  head=['Record ID', 'Record kind', 'Posting date', 'Debit', 'Amount'])
    b = s.section('S-5820', '5820', 'cc=10', 0, [('G-282', '2026-09-14', 30, 0)])
    s.page('P-1', [('5810', 'cc=10', 'account', '', a), ('5820', 'cc=10', 'account', '', b)])
    out.append(s.done({'5810|cc=10': ('held', ['SECTION_COLUMNS']), '5820|cc=10': ('consistent', [])}))

    out.append(scale())
    return out


def scale():
    """Sixty accounts, up to eight movements each, a TB of three pages.
    Account 17's TB moves period credit and closing together; account 33's GL
    closing breaks its bridge; account 48 has no TB row."""
    rng = random.Random(2140)
    s = Story('T29', 'Sixty accounts across three TB pages', 'py')
    rows, want = [], {}
    for k in range(60):
        account, dims = f'{6000 + k * 7}', f'cc={10 + k % 4}'
        moves = []
        for j in range(rng.randrange(0, 9)):
            amt = rng.randrange(100, 5000000)
            moves.append((f'G-{k:02d}{j}', f'2026-09-{rng.randrange(1, 31):02d}',
                          amt if rng.random() < 0.5 else 0, 0 if moves and rng.random() < 0.5 else amt))
        opening = rng.randrange(-9000000, 9000000)
        closing = None
        if k == 33:
            gl = s.section(f'S-{account}', account, dims, opening, moves)
            s.gl[-3][3 if s.gl[-3][3] != '0.00' else 4] = s.m(gl[4] + 1 if gl[4] else gl[5] + 1)
            want[f'{account}|{dims}'] = ('inconsistent', ['GL_BRIDGE'])
            rows.append((account, dims, 'account', '', gl))
            continue
        six = s.section(f'S-{account}', account, dims, opening, moves, closing)
        key = f'{account}|{dims}'
        if k == 17:
            tb = shifted(six, periodCredit=12345, closingCredit=12345) if six[5] else \
                shifted(six, periodCredit=12345, closingDebit=-12345)
            rows.append((account, dims, 'account', '', tb))
            want[key] = ('difference', sorted(['periodCredit', 'closingCredit' if six[5] else 'closingDebit']))
        elif k == 48:
            want[key] = ('missing', ['TB_ROW_ABSENT'])
        else:
            rows.append((account, dims, 'account', '', six))
            want[key] = ('consistent', [])
    rng.shuffle(rows)
    for p in range(3):
        s.page(f'P-{p + 1}', rows[p * 20:(p + 1) * 20])
    return s.done(want, recipe='Two accounts that differ, one inconsistent, one absent from the TB.')


def main():
    out = []
    for s in stories():
        out.append({'id': s.id, 'title': s.title, 'recipe': s.recipe, 'runScope': s.run, 'intent': s.intent,
                    'files': s.files()})
    sys.stdout.write(json.dumps({'schema': 'tarasuf-glt1-sections-stories/1', 'stories': out},
                                ensure_ascii=False, indent=1) + '\n')


if __name__ == '__main__':
    main()
