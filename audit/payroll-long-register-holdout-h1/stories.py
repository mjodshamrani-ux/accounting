"""PAY-1 holdout H1 stories: long payroll registers under the proposed
payroll-long-register-1 contract (audit/payroll-long-register-foundation/
contract.json), written after the engine and before any product run on
them. Nothing here is imported from the foundation's stories.

A marine services company paid in Omani rials (three decimals), with
dirhams and dollars in some stories; vessels and depots as dimensions, some
with spaces and Arabic; pages of uneven length; run totals before or after
the pages. Each story's intent is written by hand from the contract: the
status and codes of every employee, the excluded sections, the shared payee
accounts, the unplaced rows and the run codes. The components of each
employee that is not held, and the run sums, come from the story's own record
of the lines it printed. All names, identifiers and amounts are invented.

  python3 -B audit/payroll-long-register-holdout-h1/stories.py > frozen/stories.json
"""
import json
import random
import sys

SCOPE = {'Entity': 'Synthetic Marine Services LLC', 'Payroll run': 'MS-2027-11', 'Currency': 'OMR',
         'Period start': '2027-11-01', 'Period end': '2027-11-30', 'Payroll posting date': '2027-11-25',
         'Payment date': '2027-11-26'}
HEAD = ['Line ID', 'Employee ID', 'Employee dimensions', 'Payee account', 'Component', 'Kind', 'Amount']
FOOT = ['Total earnings', 'Total deductions', 'Total employer', 'Total net']
KIND = ['earning', 'deduction', 'employer', 'net']
PLACES = {'OMR': 3, 'AED': 2, 'USD': 2, 'BHD': 3}
WRITERS = ('php', 'java', 'go', 'perl', 'calc')


def show(units, places):
    if isinstance(units, str):
        return units
    text = str(units).rjust(places + 1, '0')
    return f'{text[:-places]}.{text[-places:]}' if places else text


class Register:
    """One story: the rows it prints, what the system footed, and what the
    contract will read from each printed line."""

    def __init__(self, sid, title, writer, **scope):
        assert writer in WRITERS
        self.id, self.title, self.writer = sid, title, writer
        self.scope = dict(SCOPE, **scope)
        self.places = PLACES.get(self.scope['Currency'], 3)
        self.rows, self.where, self.seq = [], {}, 0
        self.footed = dict.fromkeys(KIND, 0)
        self.read = {}
        self.clean = True
        self.recipe = ''

    def fmt(self, units):
        return show(units, self.places)

    def ln(self, emp, dims, payee, component, kind, units, lid=None, shows=None, reads='same'):
        """A printed line. units is what the system footed; shows replaces
        the printed amount; reads is what the contract reads from it."""
        if lid is None:
            self.seq += 1
            lid = f'{self.id}-{self.seq:03d}'
        return {'lid': lid, 'emp': emp, 'dims': dims, 'payee': payee, 'component': component, 'kind': kind,
                'units': units, 'shows': shows, 'reads': units if reads == 'same' else reads}

    def crew(self, emp, dims, payee, base, sea=0, ded=(), er=None, net=None, extra=(), nets=None):
        """Base pay, an optional sea allowance and extra earnings; a pension
        deduction at 7% of base plus the given deductions; the employer
        pension at 10.5% unless given; one net line (earnings minus
        deductions unless net or nets say otherwise)."""
        earn = [('Base pay', base)] + ([('Sea allowance', sea)] if sea else []) + list(extra)
        deds = [('Pension (employee)', base * 7 // 100)] + list(ded)
        out = [self.ln(emp, dims, payee, c, 'earning', u) for c, u in earn]
        out += [self.ln(emp, dims, payee, c, 'deduction', u) for c, u in deds]
        out.append(self.ln(emp, dims, payee, 'Pension (employer)', 'employer',
                           base * 105 // 1000 if er is None else er))
        if nets is None:
            nets = [sum(u for _, u in earn) - sum(u for _, u in deds) if net is None else net]
        out += [self.ln(emp, dims, payee, 'Net salary', 'net', u) for u in nets]
        return out

    def page(self, pid, lines, labels=None, drop=(), extra=(), head=HEAD, totals=True, foot=None, end=True,
             read=True, footed=True, printed=True, order=None):
        """A section. labels replace label values; order lists the labels in
        print order; foot adds a delta to a printed total or replaces it
        (str); totals=False prints none; read and footed say whether the
        contract reads the page and whether the system counted it in the
        run totals; printed=False is a page that never arrived."""
        for x in lines:
            if footed and x['kind'] in KIND:
                self.footed[x['kind']] += x['units']
        if not printed:
            return
        self.where[pid] = len(self.rows) + 1
        values = dict(self.scope, **(labels or {}))
        names = [k for k in (order or list(SCOPE)) if k not in drop]
        out = [['Section', pid]] + [[k, values[k]] for k in names] + [list(r) for r in extra] + [list(head)]
        for x in lines:
            x['row'] = len(self.rows) + len(out) + 1
            cell = {'Line ID': x['lid'], 'Employee ID': x['emp'], 'Employee dimensions': x['dims'],
                    'Payee account': x['payee'], 'Component': x['component'], 'Kind': x['kind'],
                    'Amount': self.fmt(x['units']) if x['shows'] is None else x['shows']}
            out.append([cell.get(h.strip(' '), '') for h in head] + x.get('after', []))
            if read:
                self.read.setdefault((x['emp'], x['dims']), []).append((x['kind'], x['reads']))
                if x['reads'] is None or x['kind'] not in KIND:
                    self.clean = False
        if totals:
            sums = {k: sum(x['units'] for x in lines if x['kind'] == k) for k in KIND}
            for k, label in zip(KIND, FOOT):
                v = (foot or {}).get(label, 0)
                out.append([label, v if isinstance(v, str) else self.fmt(sums[k] + v)])
        if end:
            out.append(['End section', pid if end is True else end])
        self.rows.extend(out)

    def run_totals(self, delta=None, run=None, close=True, extra=()):
        self.where['totals'] = len(self.rows) + 1
        name = run or self.scope['Payroll run']
        out = [['Run totals', name]]
        for k, label in zip(KIND, FOOT):
            out.append([label, self.fmt(self.footed[k] + (delta or {}).get(label, 0))])
        out[2:2] = [list(r) for r in extra]
        if close:
            out.append(['End run totals', name])
        self.rows.extend(out)

    def blank(self):
        self.rows.append([])

    def stray(self, row):
        self.rows.append(row)
        return len(self.rows)

    def intent(self, verdicts, excluded=(), shared=(), unplaced=(), run=(), recipe=''):
        components = {}
        for key, (status, _) in verdicts.items():
            if status == 'held':
                continue
            seen = self.read[tuple(key.split('|', 1))]
            nets = [u for k, u in seen if k == 'net']
            components[key] = [sum(u for k, u in seen if k == kind) for kind in KIND[:3]] + [nets[0] if nets else None]
        sums = None
        if self.clean:
            sums = dict.fromkeys(('earnings', 'deductions', 'employer', 'net'), 0)
            for seen in self.read.values():
                for k, u in seen:
                    sums[{'earning': 'earnings', 'deduction': 'deductions', 'employer': 'employer', 'net': 'net'}[k]] += u
        self.want = {
            'employees': {k: [v[0], sorted(v[1])] for k, v in sorted(verdicts.items())},
            'components': dict(sorted(components.items())),
            'excludedSections': sorted(excluded),
            'sharedPayees': [[p, sorted(e)] for p, e in sorted(shared)],
            'unplaced': sorted([n, c] for n, c in unplaced),
            'totals': sums,
            'run': sorted(run),
        }
        self.recipe = recipe
        return self


def every(keys, *codes, more=None):
    out = {k: ('held', sorted(codes)) for k in keys}
    for k, extra in (more or {}).items():
        out[k] = ('held', sorted(set(codes) | set(extra)))
    return out


OK = ('consistent', [])


def stories():
    out = []

    r = Register('H01', 'Eight pages, crew spanning three of them', 'php')
    a = r.crew('MS-0101', 'vessel=Al Noor', 'BK-55101', 812500, sea=120000)
    b = r.crew('MS-0102', 'vessel=Al Noor', 'BK-55102', 655000, sea=95000, extra=[('Overtime', 43250)])
    c = r.crew('MS-0103', 'depot=Sohar', 'BK-55103', 540250)
    d = r.crew('MS-0104', 'depot=Sohar', 'BK-55104', 1210000, ded=[('Advance recovery', 150000)])
    lines = a + b + c + d
    assert len(lines) == 20
    for i, (start, cut) in enumerate(zip([0, 2, 5, 7, 10, 12, 15, 17], [2, 5, 7, 10, 12, 15, 17, 20])):
        r.page(f'S{i + 1}', lines[start:cut])
    r.run_totals()
    out.append(r.intent({k: OK for k in ('MS-0101|vessel=Al Noor', 'MS-0102|vessel=Al Noor', 'MS-0103|depot=Sohar',
                                         'MS-0104|depot=Sohar')},
                        recipe='Pages of two or three lines; every employee crosses at least one page break.'))

    r = Register('H02', 'One seafarer in three vessels, each with its own net', 'java')
    lines = (r.crew('MS-0201', 'vessel=Al Noor', 'BK-56201', 400000, sea=60000)
             + r.crew('MS-0201', 'vessel=Bahar 2', 'BK-56201', 250000, sea=40000)
             + r.crew('MS-0201', 'سفينة=الوفاء', 'BK-56201', 125000)
             + r.crew('MS-0202', 'vessel=Bahar 2', 'BK-56202', 380000))
    r.page('S1', lines)
    r.run_totals()
    out.append(r.intent({'MS-0201|vessel=Al Noor': OK, 'MS-0201|vessel=Bahar 2': OK, 'MS-0201|سفينة=الوفاء': OK,
                         'MS-0202|vessel=Bahar 2': OK},
                        recipe='Three nets for one person in three vessels; the payee account is one person’s and is not listed.'))

    r = Register('H03', 'An advance recovered in three installments', 'go')
    a = r.crew('MS-0301', 'depot=Sur', 'BK-57301', 900000,
               ded=[('Advance recovery', 50000), ('Advance recovery', 50000), ('Advance recovery', 50000)])
    b = r.crew('MS-0302', 'depot=Sur', 'BK-57302', 900000)
    r.page('S1', a + b)
    r.run_totals()
    out.append(r.intent({'MS-0301|depot=Sur': OK, 'MS-0302|depot=Sur': OK},
                        recipe='Three equal deductions with three line IDs are three deductions.'))

    r = Register('H04', 'One line ID on two pages with two different amounts', 'perl')
    a = r.crew('MS-0401', 'depot=Sohar', 'BK-58401', 700000, sea=50000)
    b = r.crew('MS-0402', 'depot=Sohar', 'BK-58402', 600000)
    other = dict(a[1], units=45000, reads=45000)
    r.page('S1', a)
    r.page('S2', [other] + b)
    r.run_totals()
    out.append(r.intent({'MS-0401|depot=Sohar': ('held', ['DUPLICATE_LINE']), 'MS-0402|depot=Sohar': OK},
                        recipe='The second copy of the sea allowance shows 45.000, not 50.000; one line ID cannot be '
                               'two amounts, and every total foots what was printed.'))

    r = Register('H05', 'The employer pension printed as a deduction', 'calc')
    a = r.crew('MS-0501', 'vessel=Al Noor', 'BK-59501', 800000)
    a[2]['kind'] = 'deduction'
    b = r.crew('MS-0502', 'vessel=Al Noor', 'BK-59502', 820000)
    r.page('S1', a + b)
    r.run_totals()
    out.append(r.intent({'MS-0501|vessel=Al Noor': ('inconsistent', ['NET_EQUATION']), 'MS-0502|vessel=Al Noor': OK},
                        recipe='Typed as a deduction, the employer’s 84.000 would come out of the seafarer’s pay; the '
                               'printed net did not take it, so the equation fails.'))

    r = Register('H06', 'Zero components written as 0 and 0.000', 'php')
    a = r.crew('MS-0601', 'depot=Sur', 'BK-50601', 500000, extra=[('Overtime', 0), ('Night shift', 0)])
    a[1]['shows'] = '0'
    b = r.crew('MS-0602', 'depot=Sur', 'BK-50602', 510000)
    r.page('S1', a + b)
    r.run_totals()
    out.append(r.intent({'MS-0601|depot=Sur': OK, 'MS-0602|depot=Sur': OK},
                        recipe='0 and 0.000 are both written zeros in rials; both lines stay.'))

    r = Register('H07', 'Two employees with equal pay, dimensions and payee account', 'java')
    a = r.crew('MS-0701', 'vessel=Bahar 2', 'BK-JOINT-1', 450000, sea=50000)
    b = r.crew('MS-0702', 'vessel=Bahar 2', 'BK-JOINT-1', 450000, sea=50000)
    r.page('S1', a + b)
    r.run_totals()
    out.append(r.intent({'MS-0701|vessel=Bahar 2': OK, 'MS-0702|vessel=Bahar 2': OK},
                        shared=[('BK-JOINT-1', ['MS-0701', 'MS-0702'])],
                        recipe='Everything equal but the employee ID: two employees, and the shared account listed.'))

    r = Register('H08', 'A page whose currency label is written in lower case', 'go')
    a = r.crew('MS-0801', 'depot=Sohar', 'BK-51801', 600000)
    b = r.crew('MS-0802', 'depot=Sohar', 'BK-51802', 610000)
    r.page('S1', a)
    r.page('S2', b, labels={'Currency': 'omr'}, read=False)
    r.run_totals()
    out.append(r.intent(every(['MS-0801|depot=Sohar'], 'RUN_TOTAL_MISMATCH'), excluded=['S2'],
                        run=['RUN_TOTAL_MISMATCH'],
                        recipe='omr is not OMR as text, so the page is excluded; the run totals counted it, so '
                               'nothing foots.'))

    r = Register('H09', 'A page from the October run', 'perl')
    a = r.crew('MS-0901', 'vessel=Al Noor', 'BK-52901', 700000)
    late = r.crew('MS-0901', 'vessel=Al Noor', 'BK-52901', 90000)
    r.page('S1', a)
    r.page('S0', late, labels={'Payroll run': 'MS-2027-10', 'Period start': '2027-10-01', 'Period end': '2027-10-31',
                               'Payroll posting date': '2027-10-25', 'Payment date': '2027-10-26'},
           read=False, footed=False)
    r.run_totals()
    out.append(r.intent({'MS-0901|vessel=Al Noor': OK}, excluded=['S0'],
                        recipe="October's page for the same seafarer counts nowhere."))

    r = Register('H10', 'A page that loses its end row before the run totals', 'calc')
    a = r.crew('MS-1001', 'depot=Sur', 'BK-53001', 640000)
    b = r.crew('MS-1002', 'depot=Sur', 'BK-53002', 650000)
    r.page('S1', a, end=False)
    r.page('S2', b)
    r.run_totals()
    out.append(r.intent(every(['MS-1001|depot=Sur', 'MS-1002|depot=Sur'], 'SECTION_UNCLOSED'),
                        run=['SECTION_UNCLOSED']))

    r = Register('H11', 'The run totals printed before the pages', 'php')
    a = r.crew('MS-1101', 'depot=Sohar', 'BK-54101', 720000, sea=80000)
    b = r.crew('MS-1102', 'depot=Sohar', 'BK-54102', 730000)
    for x in a + b:
        r.footed[x['kind']] += x['units']
    r.run_totals()
    r.page('S1', a, footed=False)
    r.page('S2', b, footed=False)
    out.append(r.intent({'MS-1101|depot=Sohar': OK, 'MS-1102|depot=Sohar': OK},
                        recipe='The block can stand anywhere in the file.'))

    r = Register('H12', 'Labels in another order, spaces around values and column names', 'java')
    a = r.crew('MS-1201', 'vessel=Al Noor', 'BK-55201', 560000)
    b = r.crew('MS-1202', 'vessel=Al Noor', 'BK-55202', 570000)
    spaced = [' Line ID', 'Employee ID ', 'Employee dimensions', ' Payee account ', 'Component', 'Kind', ' Amount']
    r.page('S1', a, order=['Payment date', 'Currency', 'Payroll run', 'Entity', 'Period end', 'Period start',
                           'Payroll posting date'], head=spaced)
    r.page('S2', b, labels={'Payroll run': ' MS-2027-11  '})
    r.run_totals()
    out.append(r.intent({'MS-1201|vessel=Al Noor': OK, 'MS-1202|vessel=Al Noor': OK},
                        recipe='Ordinary spaces at either end are removed from labels, values and column names.'))

    r = Register('H13', 'A blank line after every row', 'go')
    a = r.crew('MS-1301', 'depot=Sur', 'BK-56301', 480000)
    b = r.crew('MS-1302', 'depot=Sur', 'BK-56302', 490000)
    r.page('S1', a + b)
    r.run_totals()
    spaced = []
    for row in r.rows:
        spaced += [row, []]
    r.rows = spaced
    for x in a + b:
        x['row'] = x['row'] * 2 - 1
    out.append(r.intent({'MS-1301|depot=Sur': OK, 'MS-1302|depot=Sur': OK},
                        recipe='Blank rows are ignored everywhere.'))

    r = Register('H14', 'Amounts with leading zeros and Persian digits', 'perl', Currency='AED')
    a = r.crew('MS-1401', 'depot=Dubai', 'BK-57401', 1250000, sea=30000)
    b = r.crew('MS-1402', 'depot=Dubai', 'BK-57402', 980000)
    to_fa = str.maketrans('0123456789', '۰۱۲۳۴۵۶۷۸۹')
    a[0]['shows'] = '0' + r.fmt(a[0]['units'])
    for x in b:
        x['shows'] = r.fmt(x['units']).translate(to_fa)
    r.page('S1', a + b)
    r.run_totals()
    out.append(r.intent({'MS-1401|depot=Dubai': OK, 'MS-1402|depot=Dubai': OK},
                        recipe='012500.00 and Persian digits are amounts; the point stays a point.'))

    r = Register('H15', 'A thousands separator in one amount', 'calc', Currency='USD')
    a = r.crew('MS-1501', 'depot=Duqm', 'BK-58501', 325000)
    b = r.crew('MS-1502', 'depot=Duqm', 'BK-58502', 330000)
    a[0]['shows'], a[0]['reads'] = '3,250.00', None
    r.page('S1', a + b)
    r.run_totals()
    out.append(r.intent(every(['MS-1501|depot=Duqm', 'MS-1502|depot=Duqm'], 'RUN_TOTALS', 'TOTAL_FIELD',
                              more={'MS-1501|depot=Duqm': ['AMOUNT']}), run=['RUN_TOTALS'],
                        recipe='3,250.00 is not read as 3250.00, and without it nothing foots.'))

    r = Register('H16', 'An employee ID that ends in a no-break space', 'php')
    a = r.crew('MS-1601', 'depot=Sohar', 'BK-59601', 520000)
    b = r.crew('MS-1602', 'depot=Sohar', 'BK-59602', 530000)
    b[0]['emp'] = 'MS-1602\u00a0'
    r.page('S1', a + b)
    r.run_totals()
    out.append(r.intent(every(['MS-1601|depot=Sohar', 'MS-1602|depot=Sohar'], 'LINE_UNREADABLE'),
                        unplaced=[(b[0]['row'], 'LINE_UNREADABLE')], run=['LINE_UNREADABLE'],
                        recipe='Only ordinary spaces are removed; the base pay line is no one’s.'))

    r = Register('H17', 'A component that begins with a plus sign', 'java')
    a = r.crew('MS-1701', 'vessel=Al Noor', 'BK-50701', 610000, extra=[('+Bonus', 25000)])
    b = r.crew('MS-1702', 'vessel=Al Noor', 'BK-50702', 615000)
    r.page('S1', a + b)
    r.run_totals()
    out.append(r.intent({'MS-1701|vessel=Al Noor': ('held', ['IDENTITY']), 'MS-1702|vessel=Al Noor': OK},
                        recipe='+Bonus could be a formula; the line still foots.'))

    r = Register('H18', 'A net line whose kind is written Net', 'go')
    a = r.crew('MS-1801', 'depot=Sur', 'BK-51801', 450000)
    b = r.crew('MS-1802', 'depot=Sur', 'BK-51802', 455000)
    a[-1]['kind'] = 'Net'
    r.page('S1', a + b)
    r.run_totals(delta={'Total net': a[-1]['units']})
    out.append(r.intent(every(['MS-1801|depot=Sur', 'MS-1802|depot=Sur'], 'RUN_TOTALS', 'TOTAL_FIELD',
                              more={'MS-1801|depot=Sur': ['KIND']}), run=['RUN_TOTALS']))

    r = Register('H19', 'One line ID used for two seafarers', 'perl')
    a = r.crew('MS-1901', 'vessel=Bahar 2', 'BK-52901', 500000)
    b = r.crew('MS-1902', 'vessel=Bahar 2', 'BK-52902', 505000)
    b[0]['lid'] = a[0]['lid']
    r.page('S1', a + b)
    r.run_totals()
    out.append(r.intent({'MS-1901|vessel=Bahar 2': ('held', ['DUPLICATE_LINE']),
                         'MS-1902|vessel=Bahar 2': ('held', ['DUPLICATE_LINE'])},
                        recipe='Neither line can be told from the other by its ID.'))

    r = Register('H20', 'The net paid into another account', 'calc')
    a = r.crew('MS-2001', 'depot=Duqm', 'BK-53201', 700000)
    b = r.crew('MS-2002', 'depot=Duqm', 'BK-53202', 705000)
    a[-1]['payee'] = 'BK-99999'
    r.page('S1', a + b)
    r.run_totals()
    out.append(r.intent({'MS-2001|depot=Duqm': ('held', ['PAYEE_CONFLICT']), 'MS-2002|depot=Duqm': OK}))

    r = Register('H21', 'An unpaid month: a zero net and nothing else', 'php')
    a = [r.ln('MS-2101', 'depot=Sur', 'BK-54201', 'Net salary', 'net', 0)]
    b = r.crew('MS-2102', 'depot=Sur', 'BK-54202', 470000)
    r.page('S1', a + b)
    r.run_totals()
    out.append(r.intent({'MS-2101|depot=Sur': OK, 'MS-2102|depot=Sur': OK},
                        recipe='Zero earnings minus zero deductions is the zero printed.'))

    r = Register('H22', 'A page total of the employer pension off by one baisa', 'java')
    a = r.crew('MS-2201', 'depot=Sohar', 'BK-55301', 690000)
    b = r.crew('MS-2202', 'depot=Sohar', 'BK-55302', 695000) + r.crew('MS-2203', 'depot=Sohar', 'BK-55303', 700000)
    r.page('S1', a)
    r.page('S2', b, foot={'Total employer': 1})
    r.run_totals()
    out.append(r.intent({'MS-2201|depot=Sohar': OK, 'MS-2202|depot=Sohar': ('held', ['TOTAL_MISMATCH']),
                         'MS-2203|depot=Sohar': ('held', ['TOTAL_MISMATCH'])}))

    r = Register('H23', 'A run net total one baisa short', 'go')
    a = r.crew('MS-2301', 'vessel=Al Noor', 'BK-56401', 580000)
    b = r.crew('MS-2302', 'vessel=Al Noor', 'BK-56402', 585000)
    r.page('S1', a + b)
    r.run_totals(delta={'Total net': -1})
    out.append(r.intent(every(['MS-2301|vessel=Al Noor', 'MS-2302|vessel=Al Noor'], 'RUN_TOTAL_MISMATCH'),
                        run=['RUN_TOTAL_MISMATCH']))

    r = Register('H24', 'Two section IDs, one reused by an excluded page', 'perl')
    a = r.crew('MS-2401', 'depot=Sur', 'BK-57501', 610000)
    old = r.crew('MS-2401', 'depot=Sur', 'BK-57501', 600000)
    r.page('S1', a)
    r.page('S1', old, labels={'Payment date': '2027-10-26'}, read=False, footed=False)
    r.run_totals()
    out.append(r.intent({'MS-2401|depot=Sur': OK}, excluded=['S1'],
                        recipe='The excluded page shares the ID but is not a second section of this run.'))

    r = Register('H25', 'Run totals closed under another run', 'calc')
    a = r.crew('MS-2501', 'depot=Duqm', 'BK-58601', 530000)
    r.page('S1', a)
    r.run_totals(close=False)
    r.rows.append(['End run totals', 'MS-2027-10'])
    out.append(r.intent(every(['MS-2501|depot=Duqm'], 'RUN_TOTALS'), run=['RUN_TOTALS']))

    r = Register('H26', 'A reviewer note inside the run totals', 'php')
    a = r.crew('MS-2601', 'depot=Sohar', 'BK-59701', 540000)
    r.page('S1', a)
    r.run_totals(extra=[['Checked by', 'payroll desk']])
    out.append(r.intent(every(['MS-2601|depot=Sohar'], 'RUN_TOTALS'), run=['RUN_TOTALS']))

    r = Register('H27', 'A scope currency the contract does not list', 'java', Currency='XAU')
    a = r.crew('MS-2701', 'depot=Sur', 'BK-50801', 500000)
    r.page('S1', a)
    r.run_totals()
    r.want = {'refused': 'SCOPE'}
    out.append(r)

    r = Register('H28', 'A component holding a line break', 'go')
    a = r.crew('MS-2801', 'vessel=Al Noor', 'BK-51901', 600000, extra=[('Sea allowance\n(partial)', 40000)])
    b = r.crew('MS-2802', 'vessel=Al Noor', 'BK-51902', 605000)
    r.page('S1', a + b)
    r.run_totals()
    out.append(r.intent({'MS-2801|vessel=Al Noor': ('held', ['IDENTITY']), 'MS-2802|vessel=Al Noor': OK},
                        recipe='A line break is a control character in a component; the record still counts as one row.'))

    r = Register('H29', 'The net line printed before the earnings', 'perl')
    a = r.crew('MS-2901', 'depot=Sohar', 'BK-52001', 760000, sea=45000)
    a = [a[-1]] + a[:-1]
    b = r.crew('MS-2902', 'depot=Sohar', 'BK-52002', 765000)
    r.page('S1', b)
    r.page('S2', a)
    r.run_totals()
    out.append(r.intent({'MS-2901|depot=Sohar': OK, 'MS-2902|depot=Sohar': OK}))

    r = Register('H30', "An employee ID equal to another's payee account", 'calc')
    a = r.crew('MS-3001', 'depot=Sur', 'MS-3002', 520000)
    b = r.crew('MS-3002', 'depot=Sur', 'BK-53101', 525000)
    r.page('S1', a + b)
    r.run_totals()
    out.append(r.intent({'MS-3001|depot=Sur': OK, 'MS-3002|depot=Sur': OK},
                        recipe='The payee column is never read as an employee.'))

    r = Register('H31', 'Bahraini dinars and Arabic identifiers', 'php', Currency='BHD')
    a = r.crew('م-٣١٠١', 'مستودع=المنامة', 'حساب-٧١', 455500, sea=20250)
    b = r.crew('م-٣١٠٢', 'مستودع=المنامة', 'حساب-٧٢', 460125)
    r.page('ص١', a + b)
    r.run_totals()
    out.append(r.intent({'م-٣١٠١|مستودع=المنامة': OK, 'م-٣١٠٢|مستودع=المنامة': OK}))

    out.append(fleet())
    return out


def fleet():
    """240 employees over twelve pages of uneven length. Employee 77's
    second net line holds it; employee 150 is missing its net; employee
    199's pay was entered with its pension deducted twice in the net."""
    rng = random.Random(9031)
    r = Register('H32', '240 employees across twelve pages', 'java')
    places = ['vessel=Al Noor', 'vessel=Bahar 2', 'depot=Sohar', 'depot=Sur', 'depot=Duqm']
    lines, want = [], {}
    for k in range(240):
        emp, dims = f'MS-{9000 + k * 7}', places[k % 5]
        payee = f'BK-{70000 + k}'
        base = rng.randrange(250000, 1800000)
        sea = rng.choice([0, 0, rng.randrange(10000, 200000)])
        ded = [('Advance recovery', rng.randrange(5000, 80000))] if rng.random() < 0.25 else []
        key = f'{emp}|{dims}'
        if k == 77:
            mine = r.crew(emp, dims, payee, base, sea=sea, ded=ded)
            mine.append(r.ln(emp, dims, payee, 'Net salary', 'net', 0))
            want[key] = ('held', ['NET_REPEATED'])
        elif k == 150:
            mine = r.crew(emp, dims, payee, base, sea=sea, ded=ded, nets=[])
            want[key] = ('missing', ['NET_ABSENT'])
        elif k == 199:
            mine = r.crew(emp, dims, payee, base, sea=sea, ded=ded,
                          net=base + sea - 2 * (base * 7 // 100) - sum(u for _, u in ded))
            want[key] = ('inconsistent', ['NET_EQUATION'])
        else:
            mine = r.crew(emp, dims, payee, base, sea=sea, ded=ded)
            want[key] = OK
        lines += mine
    cuts = sorted(rng.sample(range(1, len(lines)), 11))
    for i, (a, b) in enumerate(zip([0] + cuts, cuts + [len(lines)])):
        r.page(f'S{i + 1:02d}', lines[a:b])
    r.run_totals()
    return r.intent(want, recipe='Uneven page breaks fall inside employees; three planted faults.')


def main():
    out = []
    for s in stories():
        rows = list(s.rows)
        while rows and not rows[-1]:
            rows.pop()
        out.append({'id': s.id, 'title': s.title, 'recipe': s.recipe, 'runScope': s.scope, 'intent': s.want,
                    'file': {'name': f'{s.id}-register.csv', 'writer': s.writer, 'cells': rows}})
    sys.stdout.write(json.dumps({'schema': 'tarasuf-pay1-long-register-h1-stories/1', 'stories': out},
                                ensure_ascii=False, indent=1) + '\n')


if __name__ == '__main__':
    main()
