"""PAY-1 foundation stories: a long payroll register, one line per employee,
dimensions and component, printed in sections that restate the run scope,
with section totals and run totals, as the proposed payroll-long-register-1
contract (contract.json) reads it.

Each story names its file, its CSV writer, the run scope the accountant
confirms, and its intent: the status and codes of every employee
(Employee ID|Employee dimensions), the excluded sections, the shared payee
accounts, the unplaced rows and the run codes, written by hand from the
contract before any oracle ran. The components of every employee that is not
held, and the run sums, come from the story's own model of the lines it
wrote. All identifiers, components and amounts are invented.

  python3 -B audit/payroll-long-register-foundation/stories.py > frozen/stories.json
"""
import json
import random
import sys

RUN = {'Entity': 'Synthetic Clinics Co', 'Payroll run': 'PR-2026-09', 'Currency': 'SAR',
       'Period start': '2026-09-01', 'Period end': '2026-09-30', 'Payroll posting date': '2026-09-27',
       'Payment date': '2026-09-28'}
LABELS = ['Entity', 'Payroll run', 'Currency', 'Period start', 'Period end', 'Payroll posting date', 'Payment date']
COLUMNS = ['Line ID', 'Employee ID', 'Employee dimensions', 'Payee account', 'Component', 'Kind', 'Amount']
TOTALS = ['Total earnings', 'Total deductions', 'Total employer', 'Total net']
KINDS = ['earning', 'deduction', 'employer', 'net']
FOOT = dict(zip(KINDS, TOTALS))
DECIMALS = {'SAR': 2, 'KWD': 3, 'JPY': 0}
WRITERS = {'py', 'py-pad', 'node', 'raw', 'cp1256'}


def money(minor, decimals):
    if isinstance(minor, str):
        return minor
    s = str(minor).rjust(decimals + 1, '0')
    return f'{s[:-decimals]}.{s[-decimals:]}' if decimals else s


class Story:
    def __init__(self, sid, title, writer, currency='SAR'):
        assert writer in WRITERS
        self.id, self.title, self.writer = sid, title, writer
        self.run = dict(RUN, Currency=currency)
        self.d = DECIMALS[currency]
        self.rows, self.at, self.n = [], {}, 0
        self.counted = {k: 0 for k in KINDS}
        self.model = {}
        self.readable = True
        self.recipe = ''

    def m(self, v):
        return money(v, self.d)

    def emp(self, eid, dims, payee, earn, ded=(), er=(), net=None, nets=None):
        """One employee's lines: earnings, deductions, employer contributions
        and one net line (earnings minus deductions unless given; nets lists
        several, [] none). Amounts in minor units."""
        out = []
        for kind, items in (('earning', earn), ('deduction', ded), ('employer', er)):
            for component, amt in items:
                out.append(self.line(eid, dims, payee, component, kind, amt))
        if nets is None:
            nets = [sum(a for _, a in earn) - sum(a for _, a in ded) if net is None else net]
        for amt in nets:
            out.append(self.line(eid, dims, payee, 'Net pay', 'net', amt))
        return out

    def line(self, eid, dims, payee, component, kind, amt, lid=None, written=None, reads=None, counted=True):
        """amt is the true amount the system footed; written, when given, is
        what the line shows instead, and reads what the contract reads from
        a written text (None when it reads nothing)."""
        if lid is None:
            self.n += 1
            lid = f'L-{self.n:04d}'
        return {'Line ID': lid, 'Employee ID': eid, 'Employee dimensions': dims, 'Payee account': payee,
                'Component': component, 'Kind': kind, 'amt': amt, 'written': written, 'reads': reads,
                'counted': counted}

    def section(self, sid, lines, over=None, omit=(), extra=(), head=COLUMNS, end=True, foot=None, totals=True,
                read=True, counted=True, write=True):
        """A section. foot moves a printed total by a delta (int) or writes
        it as given (str); totals=False prints none, a list prints those
        rows. read says whether the contract reads the section; counted
        whether the system footed it in this run's totals; write=False is a
        page that never arrived."""
        for ln in lines:
            if counted and ln['counted'] and ln['Kind'] in KINDS:
                self.counted[ln['Kind']] += ln['amt']
        if not write:
            return
        self.at[sid] = len(self.rows) + 1
        scope = dict(self.run)
        scope.update(over or {})
        rows = [['Section', sid]] + [[lab, scope[lab]] for lab in LABELS if lab not in omit]
        rows += [list(r) for r in extra] + [list(head)]
        for ln in lines:
            ln['row'] = len(self.rows) + len(rows) + 1
            amount = self.m(ln['amt'] if ln['written'] is None else ln['written'])
            rows.append([amount if c == 'Amount' else ln.get(c, '') for c in head] + ln.get('after', []))
            if read:
                reads = ln['amt'] if ln['written'] is None else \
                    ln['written'] if isinstance(ln['written'], int) else ln['reads']
                self.model.setdefault((ln['Employee ID'], ln['Employee dimensions']), []).append((ln['Kind'], reads))
                if reads is None or ln['Kind'] not in KINDS:
                    self.readable = False
        if totals is True:
            sums = {k: sum(ln['amt'] for ln in lines if ln['Kind'] == k) for k in KINDS}  # as the system footed
            for k in KINDS:
                v = (foot or {}).get(FOOT[k], 0)
                rows.append([FOOT[k], v if isinstance(v, str) else self.m(sums[k] + v)])
        elif totals:
            rows += [list(r) for r in totals]
        if end:
            rows.append(['End section', sid if end is True else end])
        rows.append([])
        self.rows.extend(rows)

    def run_totals(self, over=None, rows=None, run=None, end=True):
        self.at['run'] = len(self.rows) + 1
        out = [['Run totals', run or self.run['Payroll run']]]
        if rows is None:
            for k in KINDS:
                v = (over or {}).get(FOOT[k], 0)
                out.append([FOOT[k], v if isinstance(v, str) else self.m(self.counted[k] + v)])
        else:
            out += [list(r) for r in rows]
        if end:
            out.append(['End run totals', run or self.run['Payroll run']])
        out.append([])
        self.rows.extend(out)

    def stray(self, row):
        self.rows.append(row)
        return len(self.rows)

    def done(self, employees, excluded=(), shared=(), unplaced=(), run=(), recipe=''):
        """employees: {key: (status, codes)} by hand. unplaced: (row, code)."""
        components = {}
        for key, (status, _) in employees.items():
            if status == 'held':
                continue
            own = self.model[tuple(key.split('|', 1))]
            nets = [a for k, a in own if k == 'net']
            components[key] = [sum(a for k, a in own if k == kind) for kind in KINDS[:3]] + \
                [nets[0] if nets else None]
        sums = None
        if self.readable:
            sums = {'earnings': 0, 'deductions': 0, 'employer': 0, 'net': 0}
            for own in self.model.values():
                for k, a in own:
                    sums[dict(zip(KINDS, sums))[k]] += a
        self.intent = {
            'employees': {k: [v[0], sorted(v[1])] for k, v in sorted(employees.items())},
            'components': dict(sorted(components.items())),
            'excludedSections': sorted(excluded),
            'sharedPayees': [[p, sorted(e)] for p, e in sorted(shared)],
            'unplaced': sorted([n, c] for n, c in unplaced),
            'totals': sums,
            'run': sorted(run),
        }
        self.recipe = recipe
        return self

    def file(self):
        rows = list(self.rows)
        while rows and not rows[-1]:
            rows = rows[:-1]
        return {'name': f'{self.id}-register.csv', 'writer': self.writer, 'cells': rows}


BASIC, HOUSING, TRANSPORT = 'Basic salary', 'Housing allowance', 'Transport allowance'
SI_EMP, SI_ER, LOAN = 'Social insurance (employee)', 'Social insurance (employer)', 'Loan installment'


def staff(s, eid, dims, payee, basic, **kw):
    """A usual employee: basic, housing at a quarter, transport, employee and
    employer social insurance at 9.75% and 11.75% of basic and housing."""
    housing = basic // 4
    base = basic + housing
    return s.emp(eid, dims, payee, [(BASIC, basic), (HOUSING, housing), (TRANSPORT, kw.pop('transport', 50000))],
                 [(SI_EMP, base * 975 // 10000)] + kw.pop('ded', []), [(SI_ER, base * 1175 // 10000)], **kw)


def everyone_held(keys, *codes, extra=None):
    out = {k: ('held', list(codes)) for k in keys}
    for k, more in (extra or {}).items():
        out[k] = ('held', sorted(set(codes) | set(more)))
    return out


def stories():
    out = []

    s = Story('P01', 'Two pages, six employees, every line agreeing', 'py')
    a = staff(s, 'E-1001', 'cc=ICU', 'ACCT-70001', 1200000) + staff(s, 'E-1002', 'cc=ICU', 'ACCT-70002', 950000) \
        + staff(s, 'E-1003', 'cc=OPD', 'ACCT-70003', 780000)
    b = staff(s, 'E-1004', 'cc=OPD', 'ACCT-70004', 640000) + staff(s, 'E-1005', 'cc=LAB', 'ACCT-70005', 1500000) \
        + staff(s, 'E-1006', 'cc=LAB', 'ACCT-70006', 520000)
    s.section('PG-1', a)
    s.section('PG-2', b)
    s.run_totals()
    out.append(s.done({k: ('consistent', []) for k in ('E-1001|cc=ICU', 'E-1002|cc=ICU', 'E-1003|cc=OPD',
                                                        'E-1004|cc=OPD', 'E-1005|cc=LAB', 'E-1006|cc=LAB')}))

    s = Story('P02', 'Five allowances for one employee', 'py-pad')
    a = s.emp('E-2001', 'cc=ICU', 'ACCT-70011', [(BASIC, 1100000), (HOUSING, 275000), (TRANSPORT, 50000),
                                                 ('Phone allowance', 20000), ('Night shift allowance', 87550)],
              [(SI_EMP, 134062)], [(SI_ER, 161562)])
    b = staff(s, 'E-2002', 'cc=OPD', 'ACCT-70012', 700000)
    s.section('PG-1', a + b)
    s.run_totals()
    out.append(s.done({'E-2001|cc=ICU': ('consistent', []), 'E-2002|cc=OPD': ('consistent', [])},
                      recipe='Every allowance is a component; none is folded into one gross.'))

    s = Story('P03', 'A loan installment twice, under two line IDs', 'node')
    a = staff(s, 'E-3001', 'cc=ICU', 'ACCT-70021', 900000, ded=[(LOAN, 50000), (LOAN, 50000)])
    b = staff(s, 'E-3002', 'cc=ICU', 'ACCT-70022', 900000)
    s.section('PG-1', a + b)
    s.run_totals()
    out.append(s.done({'E-3001|cc=ICU': ('consistent', []), 'E-3002|cc=ICU': ('consistent', [])},
                      recipe='Two installments of 500.00 with two line IDs are two deductions, and the net counts both.'))

    s = Story('P04', 'One line printed again after a page break, footed as printed', 'py')
    a = staff(s, 'E-4001', 'cc=OPD', 'ACCT-70031', 600000)
    b = staff(s, 'E-4002', 'cc=OPD', 'ACCT-70032', 610000)
    again = dict(a[1])
    s.section('PG-1', a)
    s.section('PG-2', [again] + b)
    s.run_totals()
    out.append(s.done({'E-4001|cc=OPD': ('held', ['DUPLICATE_LINE']), 'E-4002|cc=OPD': ('consistent', [])},
                      recipe='The housing line L-0002 is on both pages and every total foots the printed pages; '
                             'only its line ID shows it twice.'))

    s = Story('P05', "An employee's block printed twice", 'node')
    a = staff(s, 'E-5001', 'cc=LAB', 'ACCT-70041', 800000)
    b = staff(s, 'E-5002', 'cc=LAB', 'ACCT-70042', 730000)
    c = staff(s, 'E-5003', 'cc=LAB', 'ACCT-70043', 690000)
    s.section('PG-1', a + b)
    s.section('PG-2', [dict(ln, counted=False) for ln in b] + c)
    s.run_totals()
    keys = ('E-5001|cc=LAB', 'E-5002|cc=LAB', 'E-5003|cc=LAB')
    out.append(s.done(everyone_held(keys, 'RUN_TOTAL_MISMATCH',
                                    extra={'E-5002|cc=LAB': ['DUPLICATE_LINE', 'NET_REPEATED']}),
                      run=['RUN_TOTAL_MISMATCH'],
                      recipe='Each page foots itself; the run total does not count E-5002 twice.'))

    s = Story('P06', 'One employee in two cost centres', 'py-pad')
    a = staff(s, 'E-6001', 'cc=ICU', 'ACCT-70051', 720000)
    b = s.emp('E-6001', 'cc=OPD', 'ACCT-70051', [(BASIC, 480000), (HOUSING, 120000)], [(SI_EMP, 58500)],
              [(SI_ER, 70500)])
    c = staff(s, 'E-6002', 'cc=OPD', 'ACCT-70052', 720000)
    s.section('PG-1', a + b + c)
    s.run_totals()
    out.append(s.done({'E-6001|cc=ICU': ('consistent', []), 'E-6001|cc=OPD': ('consistent', []),
                       'E-6002|cc=OPD': ('consistent', [])},
                      recipe='Two centres, two nets, one payee account of one employee: nothing is shared.'))

    s = Story('P07', 'One employee in two cost centres with one net line', 'node')
    icu = [(BASIC, 600000), (HOUSING, 150000)]
    opd = [(BASIC, 400000), (HOUSING, 100000)]
    a = s.emp('E-7001', 'cc=ICU', 'ACCT-70061', icu, [(SI_EMP, 73125)], [(SI_ER, 88125)],
              net=1250000 - 73125 - 48750)
    b = s.emp('E-7001', 'cc=OPD', 'ACCT-70061', opd, [(SI_EMP, 48750)], [(SI_ER, 58750)], nets=[])
    c = staff(s, 'E-7002', 'cc=OPD', 'ACCT-70062', 500000)
    s.section('PG-1', a + b + c)
    s.run_totals()
    out.append(s.done({'E-7001|cc=ICU': ('inconsistent', ['NET_EQUATION']), 'E-7001|cc=OPD': ('missing', ['NET_ABSENT']),
                       'E-7002|cc=OPD': ('consistent', [])},
                      recipe='The net printed under ICU pays both centres; the centres are not merged to make it fit.'))

    s = Story('P08', 'Employer contribution kept beside net, and taken from it', 'py')
    a = staff(s, 'E-8001', 'cc=ICU', 'ACCT-70071', 1000000)
    b = s.emp('E-8002', 'cc=ICU', 'ACCT-70072', [(BASIC, 1000000), (HOUSING, 250000)], [(SI_EMP, 121875)],
              [(SI_ER, 146875)], net=1250000 - 121875 - 146875)
    s.section('PG-1', a + b)
    s.run_totals()
    out.append(s.done({'E-8001|cc=ICU': ('consistent', []), 'E-8002|cc=ICU': ('inconsistent', ['NET_EQUATION'])},
                      recipe="E-8002's net takes the employer's 1,468.75 out of the employee's pay."))

    s = Story('P09', 'A zero overtime line, written', 'node')
    a = s.emp('E-9001', 'cc=LAB', 'ACCT-70081', [(BASIC, 560000), (HOUSING, 140000), ('Overtime', 0)],
              [(SI_EMP, 68250)], [(SI_ER, 82250)])
    b = staff(s, 'E-9002', 'cc=LAB', 'ACCT-70082', 560000)
    s.section('PG-1', a + b)
    s.run_totals()
    out.append(s.done({'E-9001|cc=LAB': ('consistent', []), 'E-9002|cc=LAB': ('consistent', [])},
                      recipe='0.00 is a component the system printed; it stays in the lines.'))

    s = Story('P10', 'A blank amount on the last page', 'py')
    a = staff(s, 'E-1011', 'cc=ICU', 'ACCT-70091', 830000)
    b = staff(s, 'E-1012', 'cc=OPD', 'ACCT-70092', 760000)
    c = staff(s, 'E-1013', 'cc=OPD', 'ACCT-70093', 640000)
    c[2]['written'] = ''
    s.section('PG-1', a)
    s.section('PG-2', b + c)
    s.run_totals()
    out.append(s.done(everyone_held(('E-1011|cc=ICU', 'E-1012|cc=OPD', 'E-1013|cc=OPD'), 'RUN_TOTALS',
                                    extra={'E-1012|cc=OPD': ['TOTAL_FIELD'],
                                           'E-1013|cc=OPD': ['AMOUNT', 'TOTAL_FIELD']}),
                      run=['RUN_TOTALS'],
                      recipe='The blank transport is not zero, and without it no total can be checked.'))

    s = Story('P11', 'Two employees with equal lines', 'py-pad')
    a = staff(s, 'E-1101', 'cc=ICU', 'ACCT-70101', 650000)
    b = staff(s, 'E-1102', 'cc=ICU', 'ACCT-70102', 650000)
    s.section('PG-1', a + b)
    s.run_totals()
    out.append(s.done({'E-1101|cc=ICU': ('consistent', []), 'E-1102|cc=ICU': ('consistent', [])},
                      recipe='Equal amounts and components never make two employees one.'))

    s = Story('P12', 'Two employees paid into one payee account', 'node')
    a = staff(s, 'E-1201', 'cc=OPD', 'ACCT-90001', 450000)
    b = staff(s, 'E-1202', 'cc=OPD', 'ACCT-90001', 470000)
    c = staff(s, 'E-1203', 'cc=OPD', 'ACCT-70113', 480000)
    s.section('PG-1', a + b + c)
    s.run_totals()
    out.append(s.done({'E-1201|cc=OPD': ('consistent', []), 'E-1202|cc=OPD': ('consistent', []),
                       'E-1203|cc=OPD': ('consistent', [])}, shared=[('ACCT-90001', ['E-1201', 'E-1202'])],
                      recipe='The shared account is listed for the accountant; it is not the employee.'))

    s = Story('P13', "A page break inside one employee's lines", 'py')
    a = staff(s, 'E-1301', 'cc=ICU', 'ACCT-70121', 990000)
    b = staff(s, 'E-1302', 'cc=ICU', 'ACCT-70122', 870000)
    c = staff(s, 'E-1303', 'cc=LAB', 'ACCT-70123', 610000)
    s.section('PG-1', a + b[:2])
    s.section('PG-2', b[2:] + c)
    s.run_totals()
    out.append(s.done({'E-1301|cc=ICU': ('consistent', []), 'E-1302|cc=ICU': ('consistent', []),
                       'E-1303|cc=LAB': ('consistent', [])},
                      recipe="E-1302's earnings end one page and its deductions and net open the next."))

    s = Story('P14', 'A page from a supplementary run', 'py-pad')
    a = staff(s, 'E-1401', 'cc=OPD', 'ACCT-70131', 580000)
    b = staff(s, 'E-1402', 'cc=OPD', 'ACCT-70132', 590000)
    bonus = s.emp('E-1401', 'cc=OPD', 'ACCT-70131', [('Bonus', 300000)])
    s.section('PG-1', a + b)
    s.section('PG-B1', bonus, over={'Payroll run': 'PR-2026-09-SUP'}, read=False, counted=False)
    s.run_totals()
    out.append(s.done({'E-1401|cc=OPD': ('consistent', []), 'E-1402|cc=OPD': ('consistent', [])},
                      excluded=['PG-B1'], recipe="The bonus page belongs to another run and counts nowhere."))

    s = Story('P15', 'The last page never arrived', 'node')
    a = staff(s, 'E-1501', 'cc=ICU', 'ACCT-70141', 700000)
    b = staff(s, 'E-1502', 'cc=OPD', 'ACCT-70142', 710000)
    c = staff(s, 'E-1503', 'cc=LAB', 'ACCT-70143', 720000)
    s.section('PG-1', a)
    s.section('PG-2', b)
    s.section('PG-3', c, write=False)
    s.run_totals()
    out.append(s.done(everyone_held(('E-1501|cc=ICU', 'E-1502|cc=OPD'), 'RUN_TOTAL_MISMATCH'),
                      run=['RUN_TOTAL_MISMATCH'],
                      recipe='Every employee that arrived is consistent; the run totals say a page is missing.'))

    s = Story('P16', 'Two payee accounts for one employee', 'py')
    a = staff(s, 'E-1601', 'cc=ICU', 'ACCT-70151', 880000)
    a[-1]['Payee account'] = 'ACCT-70159'
    b = staff(s, 'E-1602', 'cc=ICU', 'ACCT-70152', 880000)
    s.section('PG-1', a + b)
    s.run_totals()
    out.append(s.done({'E-1601|cc=ICU': ('held', ['PAYEE_CONFLICT']), 'E-1602|cc=ICU': ('consistent', [])},
                      recipe='The net line names another account than the earnings.'))

    s = Story('P17', 'Two net lines for one employee', 'py-pad')
    a = s.emp('E-1701', 'cc=LAB', 'ACCT-70161', [(BASIC, 600000), (HOUSING, 150000)], [(SI_EMP, 73125)],
              [(SI_ER, 88125)], nets=[400000, 276875])
    b = staff(s, 'E-1702', 'cc=LAB', 'ACCT-70162', 600000)
    s.section('PG-1', a + b)
    s.run_totals()
    out.append(s.done({'E-1701|cc=LAB': ('held', ['NET_REPEATED']), 'E-1702|cc=LAB': ('consistent', [])},
                      recipe='The two nets add up to the equation, but a split payment needs its own contract.'))

    s = Story('P18', 'An employee without a net line', 'node')
    a = s.emp('E-1801', 'cc=OPD', 'ACCT-70171', [(BASIC, 300000), (HOUSING, 75000)], [(SI_EMP, 36562)],
              [(SI_ER, 44062)], nets=[])
    b = staff(s, 'E-1802', 'cc=OPD', 'ACCT-70172', 300000)
    s.section('PG-1', a + b)
    s.run_totals()
    out.append(s.done({'E-1801|cc=OPD': ('missing', ['NET_ABSENT']), 'E-1802|cc=OPD': ('consistent', [])}))

    s = Story('P19', 'A line whose kind is written allowance', 'py')
    a = staff(s, 'E-1901', 'cc=ICU', 'ACCT-70181', 500000)
    a[2]['Kind'] = 'allowance'
    b = staff(s, 'E-1902', 'cc=ICU', 'ACCT-70182', 500000)
    c = staff(s, 'E-1903', 'cc=OPD', 'ACCT-70183', 500000)
    s.section('PG-1', a + b)
    s.section('PG-2', c)
    s.run_totals(over={'Total earnings': a[2]['amt']})
    out.append(s.done(everyone_held(('E-1901|cc=ICU', 'E-1902|cc=ICU', 'E-1903|cc=OPD'), 'RUN_TOTALS',
                                    extra={'E-1901|cc=ICU': ['KIND', 'TOTAL_FIELD'], 'E-1902|cc=ICU': ['TOTAL_FIELD']}),
                      run=['RUN_TOTALS'],
                      recipe='Allowance is not a kind; the transport could be any of the four.'))

    s = Story('P20', "A line whose employee's dimensions are blank", 'py-pad')
    a = staff(s, 'E-2001', 'cc=ICU', 'ACCT-70191', 610000)
    b = staff(s, 'E-2002', 'cc=ICU', 'ACCT-70192', 620000)
    b[1]['Employee dimensions'] = ''
    s.section('PG-1', a + b)
    s.run_totals()
    out.append(s.done(everyone_held(('E-2001|cc=ICU', 'E-2002|cc=ICU'), 'LINE_UNREADABLE'),
                      unplaced=[(b[1]['row'], 'LINE_UNREADABLE')], run=['LINE_UNREADABLE'],
                      recipe='The housing line is not inherited from the line above it.'))

    s = Story('P21', 'A page footer between two pages', 'node')
    a = staff(s, 'E-2101', 'cc=LAB', 'ACCT-70201', 450000)
    b = staff(s, 'E-2102', 'cc=LAB', 'ACCT-70202', 460000)
    s.section('PG-1', a)
    note = s.stray(['Page 1 of 2'])
    s.section('PG-2', b)
    s.run_totals()
    out.append(s.done(everyone_held(('E-2101|cc=LAB', 'E-2102|cc=LAB'), 'STRAY_ROW'),
                      unplaced=[(note, 'STRAY_ROW')], run=['STRAY_ROW'],
                      recipe='Nothing says the footer holds no line.'))

    s = Story('P22', 'A file cut off inside its last page', 'py')
    a = staff(s, 'E-2201', 'cc=ICU', 'ACCT-70211', 770000)
    b = staff(s, 'E-2202', 'cc=OPD', 'ACCT-70212', 780000)
    s.section('PG-1', a)
    s.section('PG-2', b[:4], totals=False, end=False)
    out.append(s.done(everyone_held(('E-2201|cc=ICU', 'E-2202|cc=OPD'), 'RUN_TOTALS', 'SECTION_UNCLOSED',
                                    extra={'E-2202|cc=OPD': ['TOTAL_FIELD']}),
                      run=['RUN_TOTALS', 'SECTION_UNCLOSED'],
                      recipe='The last page stops after four lines: no totals, no end, no run totals.'))

    s = Story('P23', 'A page whose header lost its posting date', 'py-pad')
    a = staff(s, 'E-2301', 'cc=OPD', 'ACCT-70221', 570000)
    b = staff(s, 'E-2302', 'cc=OPD', 'ACCT-70222', 580000)
    s.section('PG-1', a)
    s.section('PG-2', b, omit=['Payroll posting date'], read=False)
    s.run_totals()
    out.append(s.done(everyone_held(('E-2301|cc=OPD',), 'RUN_TOTAL_MISMATCH', 'SECTION_HEADER'),
                      unplaced=[(s.at['PG-2'], 'SECTION_HEADER')], run=['RUN_TOTAL_MISMATCH', 'SECTION_HEADER'],
                      recipe='Without its posting date the page could belong to another run; E-2302 is not read, '
                             'so the run totals, which count it, do not foot either.'))

    s = Story('P24', 'Columns in another order on each page', 'node')
    a = staff(s, 'E-2401', 'cc=ICU', 'ACCT-70231', 640000)
    b = staff(s, 'E-2402', 'cc=LAB', 'ACCT-70232', 650000)
    s.section('PG-1', a, head=['Employee ID', 'Employee dimensions', 'Component', 'Kind', 'Amount', 'Payee account',
                               'Line ID'])
    s.section('PG-2', b, head=['Amount', 'Kind', 'Component', 'Payee account', 'Employee dimensions', 'Employee ID',
                               'Line ID'])
    s.run_totals()
    out.append(s.done({'E-2401|cc=ICU': ('consistent', []), 'E-2402|cc=LAB': ('consistent', [])}))

    s = Story('P25', 'A page with a Notes column', 'py')
    a = staff(s, 'E-2501', 'cc=OPD', 'ACCT-70241', 530000)
    b = staff(s, 'E-2502', 'cc=OPD', 'ACCT-70242', 540000)
    s.section('PG-1', a)
    s.section('PG-2', b, head=COLUMNS + ['Notes'], read=False)
    s.run_totals()
    out.append(s.done(everyone_held(('E-2501|cc=OPD',), 'RUN_TOTAL_MISMATCH', 'SECTION_COLUMNS'),
                      unplaced=[(s.at['PG-2'], 'SECTION_COLUMNS')], run=['RUN_TOTAL_MISMATCH', 'SECTION_COLUMNS'],
                      recipe='Eight columns are not the seven; the page is not read and the run does not foot.'))

    s = Story('P26', 'One section ID on two pages', 'py-pad')
    a = staff(s, 'E-2601', 'cc=ICU', 'ACCT-70251', 820000)
    b = staff(s, 'E-2602', 'cc=ICU', 'ACCT-70252', 830000)
    s.section('PG-1', a)
    s.section('PG-1', b)
    s.run_totals()
    out.append(s.done(everyone_held(('E-2601|cc=ICU', 'E-2602|cc=ICU'), 'SECTION_DUPLICATE'),
                      run=['SECTION_DUPLICATE']))

    s = Story('P27', 'A page total off by one halala', 'node')
    a = staff(s, 'E-2701', 'cc=LAB', 'ACCT-70261', 910000)
    b = staff(s, 'E-2702', 'cc=OPD', 'ACCT-70262', 920000) + staff(s, 'E-2703', 'cc=OPD', 'ACCT-70263', 930000)
    s.section('PG-1', a)
    s.section('PG-2', b, foot={'Total deductions': 1})
    s.run_totals()
    out.append(s.done({'E-2701|cc=LAB': ('consistent', []), 'E-2702|cc=OPD': ('held', ['TOTAL_MISMATCH']),
                       'E-2703|cc=OPD': ('held', ['TOTAL_MISMATCH'])},
                      recipe='The page cannot vouch for its two employees; the other page and the run still foot.'))

    s = Story('P28', 'Two opposite components raised, the net unchanged', 'py')
    a = staff(s, 'E-2801', 'cc=ICU', 'ACCT-70271', 760000)
    a[0]['written'] = a[0]['amt'] + 50000
    a[3]['written'] = a[3]['amt'] + 50000
    b = staff(s, 'E-2802', 'cc=ICU', 'ACCT-70272', 770000)
    c = staff(s, 'E-2803', 'cc=LAB', 'ACCT-70273', 780000)
    s.section('PG-1', a + b)
    s.section('PG-2', c)
    s.run_totals()
    out.append(s.done(everyone_held(('E-2801|cc=ICU', 'E-2802|cc=ICU', 'E-2803|cc=LAB'), 'RUN_TOTAL_MISMATCH',
                                    extra={'E-2801|cc=ICU': ['TOTAL_MISMATCH'], 'E-2802|cc=ICU': ['TOTAL_MISMATCH']}),
                      run=['RUN_TOTAL_MISMATCH'],
                      recipe="E-2801's basic and its insurance each rose by 500.00 after the totals were printed; "
                             'its net still balances, the footings do not.'))

    s = Story('P29', 'Kuwaiti dinars in Arabic-Indic digits, Arabic dimensions', 'py', currency='KWD')
    to_ar = str.maketrans('0123456789.', '٠١٢٣٤٥٦٧٨٩٫')
    a = s.emp('E-2901', 'مركز=١', 'ACCT-70281', [(BASIC, 1250500), (HOUSING, 312625)], [(SI_EMP, 125050)],
              [(SI_ER, 140612)])
    b = s.emp('E-2902', 'مركز=٢', 'ACCT-70282', [(BASIC, 980000), (HOUSING, 245000)], [(SI_EMP, 98000)],
              [(SI_ER, 110250)])
    for ln in a + b:
        ln['written'], ln['reads'] = money(ln['amt'], 3).translate(to_ar), ln['amt']
    s.section('PG-1', a + b)
    s.run_totals()
    out.append(s.done({'E-2901|مركز=١': ('consistent', []), 'E-2902|مركز=٢': ('consistent', [])},
                      recipe='Three decimals, Arabic-Indic digits and the Arabic decimal separator read as amounts.'))

    s = Story('P30', 'A line ID that reads as a formula', 'py-pad')
    a = staff(s, 'E-3001', 'cc=OPD', 'ACCT-70291', 540000)
    a[1]['Line ID'] = '=L-0002'
    b = staff(s, 'E-3002', 'cc=OPD', 'ACCT-70292', 550000)
    s.section('PG-1', a + b)
    s.run_totals()
    out.append(s.done({'E-3001|cc=OPD': ('held', ['IDENTITY']), 'E-3002|cc=OPD': ('consistent', [])},
                      recipe='The line still foots; its identity does not read.'))

    s = Story('P31', 'Yen with a fraction', 'node', currency='JPY')
    a = s.emp('E-3101', 'cc=ICU', 'ACCT-70301', [(BASIC, 420000), (HOUSING, 105000)], [(SI_EMP, 51187)],
              [(SI_ER, 61687)])
    b = s.emp('E-3102', 'cc=ICU', 'ACCT-70302', [(BASIC, 430000), (HOUSING, 107500)], [(SI_EMP, 52406)],
              [(SI_ER, 63156)])
    a[2]['written'] = '51187.5'
    s.section('PG-1', a + b)
    s.run_totals()
    out.append(s.done(everyone_held(('E-3101|cc=ICU', 'E-3102|cc=ICU'), 'RUN_TOTALS', 'TOTAL_FIELD',
                                    extra={'E-3101|cc=ICU': ['AMOUNT']}),
                      run=['RUN_TOTALS'], recipe='Yen has no decimals; 51187.5 is refused, not rounded.'))

    s = Story('P32', 'Employee IDs with and without a leading zero', 'py')
    a = staff(s, '0410', 'cc=LAB', 'ACCT-70311', 500000)
    b = staff(s, '410', 'cc=LAB', 'ACCT-70312', 500000)
    c = staff(s, '0420', 'cc=LAB', 'ACCT-70313', 510000)
    c[-1]['Employee ID'] = '420'
    s.section('PG-1', a + b + c)
    s.run_totals()
    out.append(s.done({'0410|cc=LAB': ('consistent', []), '410|cc=LAB': ('consistent', []),
                       '0420|cc=LAB': ('missing', ['NET_ABSENT']), '420|cc=LAB': ('inconsistent', ['NET_EQUATION'])},
                      shared=[('ACCT-70313', ['0420', '420'])],
                      recipe="0420's net was printed as 420; the zero is never restored, and the shared payee "
                             'account is the clue left for the accountant.'))

    s = Story('P33', 'A scope whose period ends before it starts', 'node')
    s.run['Period end'] = '2026-08-31'
    a = staff(s, 'E-3301', 'cc=ICU', 'ACCT-70321', 500000)
    s.section('PG-1', a)
    s.run_totals()
    s.done({})
    s.intent = {'refused': 'SCOPE'}
    out.append(s)

    s = Story('P34', 'A register saved in Windows Arabic', 'cp1256')
    a = staff(s, 'E-3401', 'مركز=العناية', 'ACCT-70331', 500000)
    s.section('PG-1', a)
    s.run_totals()
    s.done({})
    s.intent = {'refused': 'ENCODING'}
    out.append(s)

    s = Story('P35', 'A quote inside an unquoted component', 'raw')
    a = s.emp('E-3501', 'cc=OPD', 'ACCT-70341', [(BASIC, 500000), ('Allowance "A"', 20000)])
    s.section('PG-1', a)
    s.run_totals()
    s.done({})
    s.intent = {'refused': 'CSV'}
    out.append(s)

    s = Story('P36', 'Run totals of the supplementary run', 'py-pad')
    a = staff(s, 'E-3601', 'cc=ICU', 'ACCT-70351', 560000)
    b = staff(s, 'E-3602', 'cc=OPD', 'ACCT-70352', 570000)
    s.section('PG-1', a + b)
    s.run_totals(run='PR-2026-09-SUP')
    out.append(s.done(everyone_held(('E-3601|cc=ICU', 'E-3602|cc=OPD'), 'RUN_TOTALS'), run=['RUN_TOTALS'],
                      recipe='The figures foot, but the block says it totals another run.'))

    s = Story('P37', 'The column row printed again inside a page', 'node')
    a = staff(s, 'E-3701', 'cc=LAB', 'ACCT-70361', 590000)
    b = staff(s, 'E-3702', 'cc=LAB', 'ACCT-70362', 600000)
    repeat = s.line('Employee ID', 'Employee dimensions', 'Payee account', 'Component', 'Kind', 0, lid='Line ID',
                    written='Amount')
    s.section('PG-1', a + [repeat] + b)
    s.run_totals()
    out.append(s.done(everyone_held(('E-3701|cc=LAB', 'E-3702|cc=LAB'), 'RUN_TOTALS', 'TOTAL_FIELD',
                                    extra={'Employee ID|Employee dimensions': ['AMOUNT', 'KIND']}),
                      run=['RUN_TOTALS'],
                      recipe='A second column row is a line by the contract (P7): its words are not a kind or an '
                             'amount, so nothing foots until it is removed.'))

    out.append(scale())
    return out


def scale():
    """120 employees over six pages of twenty, two to six lines each beyond
    the net. Employee 37's net is one halala short; employee 88 has no net
    line; employees 5 and 6 share a payee account."""
    rng = random.Random(4170)
    s = Story('P38', '120 employees across six pages', 'py')
    want, pages = {}, [[] for _ in range(6)]
    centres = ['cc=ICU', 'cc=OPD', 'cc=LAB', 'cc=RAD']
    for k in range(120):
        eid, dims = f'E-{5000 + k * 3}', centres[k % 4]
        payee = 'ACCT-80005' if k in (5, 6) else f'ACCT-{80000 + k}'
        basic = rng.randrange(300000, 2500000)
        earn = [(BASIC, basic)] + [(c, rng.randrange(0, 200000)) for c in
                                   rng.sample([HOUSING, TRANSPORT, 'Phone allowance', 'Overtime'], rng.randrange(0, 4))]
        ded = [(SI_EMP, basic * 975 // 10000)] + ([(LOAN, rng.randrange(10000, 90000))] if rng.random() < 0.3 else [])
        er = [(SI_ER, basic * 1175 // 10000)]
        net = sum(a for _, a in earn) - sum(a for _, a in ded)
        key = f'{eid}|{dims}'
        if k == 37:
            lines = s.emp(eid, dims, payee, earn, ded, er, net=net - 1)
            want[key] = ('inconsistent', ['NET_EQUATION'])
        elif k == 88:
            lines = s.emp(eid, dims, payee, earn, ded, er, nets=[])
            want[key] = ('missing', ['NET_ABSENT'])
        else:
            lines = s.emp(eid, dims, payee, earn, ded, er)
            want[key] = ('consistent', [])
        pages[k // 20] += lines
    for p, lines in enumerate(pages):
        s.section(f'PG-{p + 1}', lines)
    s.run_totals()
    return s.done(want, shared=[('ACCT-80005', ['E-5015', 'E-5018'])],
                  recipe='One employee a halala short, one without a net line, two sharing a payee account.')


def main():
    out = []
    for s in stories():
        out.append({'id': s.id, 'title': s.title, 'recipe': s.recipe, 'runScope': s.run, 'intent': s.intent,
                    'file': s.file()})
    sys.stdout.write(json.dumps({'schema': 'tarasuf-pay1-long-register-stories/1', 'stories': out},
                                ensure_ascii=False, indent=1) + '\n')


if __name__ == '__main__':
    main()
