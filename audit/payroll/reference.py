"""Independent pre-engine CSV/Decimal oracle for supplied asset components.
No product imports, depreciation algorithm, price, useful life or posting.
"""
import csv
import hashlib
import io
import re
import unicodedata
from collections import Counter
from datetime import date
from decimal import Decimal
from pathlib import Path

VERSION = 'payroll-posted-run-gl-bank-1'
FIELDS = ['entity', 'payrollRun', 'payrollLedger', 'glLedger', 'currency', 'currencyBasis', 'postingStatus', 'postingLayer', 'periodStart', 'periodEnd', 'payrollPostingDate', 'paymentDate', 'bankAccount', 'payoutReference', 'chartVersion', 'mapVersion', 'payrollPolicyVersion', 'bankMappingVersion', 'accountSetVersion']
SCOPE_HEADERS = ['Entity', 'Payroll run', 'Payroll ledger', 'GL ledger', 'Currency', 'Currency basis', 'Posting status', 'Posting layer', 'Period start', 'Period end', 'Payroll posting date', 'Payment date', 'Bank account', 'Payout reference', 'Chart version', 'Map version', 'Payroll policy version', 'Bank mapping version', 'Account set version']
VALUES = [['Employee ID', 'Employee dimensions', 'Gross', 'Deductions', 'Employer contribution', 'Net', 'Payroll reference'], ['Mapping ID', 'Employee ID', 'Employee dimensions', 'Component', 'GL account', 'GL dimensions', 'Evidence ID'], ['Evidence ID', 'Employee ID', 'Employee dimensions', 'Component', 'Payroll reference', 'GL account', 'GL dimensions', 'Account class', 'Sign', 'Value basis', 'Valid from', 'Valid to', 'Reference'], ['Entry ID', 'Phase', 'Component', 'GL account', 'GL dimensions', 'Account class', 'Debit', 'Credit', 'Entry date', 'Posting reference'], ['Transaction ID', 'Transaction bank account', 'Direction', 'Amount', 'Value date', 'Transaction payout reference']]
HEADERS = [v + SCOPE_HEADERS for v in VALUES]
COMPONENTS = ['gross-expense', 'employee-deduction-payable', 'net-payable', 'employer-expense', 'employer-payable', 'net-clearing', 'bank-cash']
CLASSES = ['payroll-expense', 'employee-deduction-liability', 'payroll-net-liability', 'employer-contribution-expense', 'employer-contribution-liability', 'payroll-net-liability', 'cash']
SIGNS = ['debit-positive', 'credit-positive', 'credit-positive', 'debit-positive', 'credit-positive', 'debit-positive', 'credit-positive']
PHASES = ['payroll'] * 5 + ['disbursement'] * 2
AMOUNT_KEYS = ['gross','deductions','net','employer','employer','net','net']
BOUND = 10 ** 14
def text(value, maximum=500):
    if not value or value != value.strip() or len(value.encode('utf-16-le')) // 2 > maximum:
        raise ValueError('IDENTITY')
    if value[0] in '=+@-' or any(unicodedata.category(c) in {'Cc', 'Cf'} for c in value):
        raise ValueError('IDENTITY')
    return value


def day(value):
    try:
        if not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}', value): raise ValueError()
        parsed = date.fromisoformat(value)
        if parsed.isoformat() != value: raise ValueError()
        return parsed
    except ValueError:
        raise ValueError('VALIDITY')


def amount(value, decimals):
    if not re.fullmatch(r'[0-9]+(?:\.[0-9]+)?', value):
        raise ValueError('NUMBER')
    if len(value.partition('.')[2]) > decimals:
        raise ValueError('PRECISION')
    n = Decimal(value) * 10 ** decimals
    if n > BOUND:
        raise ValueError('BOUND')
    return int(n)


def inspect(paths, scope):
    if len(paths) != 5 or set(scope) != set(FIELDS):
        raise ValueError('SCOPE')
    for v in scope.values():
        text(v)
    if scope['currencyBasis'] != 'functional' or scope['postingStatus'] != 'posted':
        raise ValueError('SCOPE')
    start, end, posting, paid = [day(scope[k]) for k in ['periodStart','periodEnd','payrollPostingDate','paymentDate']]
    if not start <= end <= posting <= paid: raise ValueError('SCOPE_DATES')
    if sum(Path(p).stat().st_size for p in paths) > 32 * 1024 * 1024: raise ValueError('SOURCE_CAPACITY')
    decimals = {'SAR': 2, 'JPY': 0, 'KWD': 3}[scope['currency']]
    records = [[], [], [], [], []]
    issues, missing, cells, inventory, members, hashes, physical = [], [], [], [], [], [], []
    data_count = 0
    for source, path in enumerate(paths):
        raw = Path(path).read_bytes()
        if not raw or len(raw) > 8 * 1024 * 1024:
            raise ValueError('SOURCE_CAPACITY')
        hashes.append(hashlib.sha256(raw).hexdigest())
        rows = list(csv.reader(io.StringIO(raw.decode('utf-8-sig'), newline=''), strict=True))
        data_count += max(0, len(rows) - 1)
        if data_count > 20000 or any(len(r) > 100 or any(len(v.encode('utf-16-le')) // 2 > 32767 for v in r) for r in rows):
            raise ValueError('SOURCE_CAPACITY')
        if any(any(ord(c) in [*range(0, 9), 11, 12, *range(14, 32), 65534, 65535] for c in v) for r in rows for v in r):
            raise ValueError('SOURCE_TEXT')
        physical.append(rows)
        header = rows[0] if rows else []
        valid_header = len(header) == len(HEADERS[source]) and len(set(header)) == len(header) and set(header) == set(HEADERS[source])
        positions = {v: i for i, v in enumerate(header)}
        if not rows:
            issues.append([source, 1, 'COLUMNS'])
        for number, row in enumerate(rows, 1):
            blank = not any(v.strip() for v in row)
            inventory.append([source, number, 'header' if number == 1 else 'blank' if blank else 'data'])
            cells.extend([source, number, column, header[column - 1] if column <= len(header) else '', value]
                         for column, value in enumerate(row, 1))
            if number == 1:
                if not valid_header:
                    issues.append([source, number, 'COLUMNS'])
                continue
            if blank:
                continue
            members.append([source, number])
            if not valid_header or len(row) != len(header):
                issues.append([source, number, 'COLUMNS'])
                continue
            get = lambda key: row[positions[key]]
            try:
                if any(get(h) != scope[k] for h, k in zip(SCOPE_HEADERS, FIELDS)):
                    raise ValueError('ROW_SCOPE')
                values = [get(k) for k in VALUES[source]]
                item = dict(source=source, row=number)
                if source == 0:
                    employee, dimensions = text(values[0]), text(values[1])
                    gross, deductions, employer, net = [amount(v, decimals) for v in values[2:6]]
                    if gross - deductions < 0 or gross - deductions != net: raise ValueError('NET_EQUATION')
                    item.update(employee=employee, dimensions=dimensions, gross=gross, deductions=deductions, employer=employer, net=net, payrollReference=text(values[6],2000))
                elif source == 1:
                    mid, employee, dimensions, component, account, gldim, eid = values
                    if component not in COMPONENTS: raise ValueError('COMPONENT')
                    item.update(id=text(mid), employee=text(employee), dimensions=text(dimensions), component=component, account=text(account), glDimensions=text(gldim), evidence=text(eid))
                elif source == 2:
                    eid, employee, dimensions, component, payroll_ref, account, gldim, cls, sign, basis, begin, finish, ref = values
                    if component not in COMPONENTS: raise ValueError('COMPONENT')
                    index = COMPONENTS.index(component)
                    if cls != CLASSES[index] or sign != SIGNS[index] or basis != 'provided-posted-payroll-component': raise ValueError('POLICY')
                    relevant = posting if PHASES[index] == 'payroll' else paid
                    if not day(begin) <= relevant <= day(finish): raise ValueError('VALIDITY')
                    item.update(id=text(eid), employee=text(employee), dimensions=text(dimensions), component=component, payrollReference=text(payroll_ref,2000), account=text(account), glDimensions=text(gldim), accountClass=cls, sign=sign, basis=basis, validFrom=begin, validTo=finish, reference=text(ref,2000))
                elif source == 3:
                    eid, phase, component, account, dimensions, cls, debit, credit, entry_date, ref = values
                    if component not in COMPONENTS: raise ValueError('COMPONENT')
                    index = COMPONENTS.index(component)
                    if phase != PHASES[index]: raise ValueError('PHASE')
                    if cls != CLASSES[index]: raise ValueError('CLASS')
                    relevant_date = scope['payrollPostingDate'] if phase == 'payroll' else scope['paymentDate']
                    relevant_ref = scope['payrollRun'] if phase == 'payroll' else scope['payoutReference']
                    if day(entry_date).isoformat() != relevant_date or ref != relevant_ref: raise ValueError('POSTING_REFERENCE')
                    debit, credit = amount(debit,decimals), amount(credit,decimals)
                    normal = debit-credit if SIGNS[index] == 'debit-positive' else credit-debit
                    item.update(id=text(eid), phase=phase, component=component, account=text(account), glDimensions=text(dimensions), accountClass=cls, debit=debit, credit=credit, entryDate=entry_date, postingReference=text(ref), normal=normal)
                else:
                    tid, account, direction, value, value_date, ref = values
                    if account != scope['bankAccount'] or direction != 'outflow' or day(value_date).isoformat() != scope['paymentDate'] or ref != scope['payoutReference']: raise ValueError('BANK_SCOPE')
                    value = amount(value,decimals)
                    if value == 0: raise ValueError('BANK_AMOUNT')
                    item.update(id=text(tid), bankAccount=text(account), direction=direction, amount=value, valueDate=value_date, payoutReference=text(ref))
                records[source].append(item)
            except (ValueError, KeyError) as error:
                issues.append([source, number, str(error)])
    # Raw duplicate identities include malformed competitors; never fake uniqueness by discarding them.
    for source, key_names in enumerate([
        ['Employee ID', 'Employee dimensions'], ['Employee ID', 'Employee dimensions', 'Component'], ['Evidence ID'], ['Phase', 'Component', 'GL account', 'GL dimensions'], ['Transaction ID']
    ]):
        rows = physical[source]
        if not rows or not all(k in rows[0] for k in key_names):
            continue
        positions = [rows[0].index(k) for k in key_names]
        identified = [(n, tuple(row[p] if p < len(row) else '' for p in positions))
                      for n, row in enumerate(rows[1:], 2) if any(v.strip() for v in row)]
        counts = Counter(k for _, k in identified)
        issues.extend([source, n, 'DUPLICATE'] for n, k in identified if counts[k] > 1)
    rows = physical[1]
    if rows and 'Mapping ID' in rows[0]:
        p = rows[0].index('Mapping ID')
        keys = [(n, row[p] if p < len(row) else '') for n, row in enumerate(rows[1:], 2) if any(v.strip() for v in row)]
        counts = Counter(k for _, k in keys)
        issues.extend([1, n, 'DUPLICATE_MAPPING_ID'] for n, k in keys if counts[k] > 1)
    for source, identity in [(3,'Entry ID')]:
        rows = physical[source]
        if rows and identity in rows[0]:
            p = rows[0].index(identity)
            identified = [(n,row[p] if p < len(row) else '') for n,row in enumerate(rows[1:],2) if any(v.strip() for v in row)]
            counts = Counter(k for _,k in identified)
            issues.extend([source,n,'DUPLICATE_ENTRY_ID'] for n,k in identified if counts[k] > 1)
    if sum(any(v.strip() for v in row) for row in physical[4][1:]) > 1:
        issues.append([4,0,'BANK_CARDINALITY'])
    reg, maps, policies, gls, banks = records
    employee_key = lambda r: (r['employee'],r['dimensions'])
    account_key = lambda r: (r['account'],r['glDimensions'])
    component_key = lambda r: (*account_key(r),r['component'])
    map_index, evidence_index, gl_index = {}, {}, {}
    for m in maps: map_index.setdefault((*employee_key(m),m['component']),[]).append(m)
    for p in policies: evidence_index.setdefault(p['id'],[]).append(p)
    for g in gls: gl_index.setdefault(component_key(g),[]).append(g)
    # A GL account may not disguise distinct roles in the same phase. Across phases
    # only net payable/net clearing may share the exact liability account.
    seen = {}
    for g in gls:
        roles = seen.setdefault(account_key(g),set()); roles.add(g['component'])
        if len(roles)>1 and roles != {'net-payable','net-clearing'}:
            issues.append([3,g['row'],'ACCOUNT_ROLE_CONFLICT'])
    used_maps, used_evidence, allocations = set(),set(),{}
    for item in reg:
        net_map = map_index.get((*employee_key(item),'net-payable'),[])
        clearing_map = map_index.get((*employee_key(item),'net-clearing'),[])
        if len(net_map)==len(clearing_map)==1 and account_key(net_map[0]) != account_key(clearing_map[0]):
            missing.append(dict(reason='net-liability-account',source=1,row=clearing_map[0]['row'],component='net-clearing'))
        for component in COMPONENTS:
            group = map_index.get((*employee_key(item),component),[])
            if len(group)!=1:
                missing.append(dict(reason='mapping',source=0,row=item['row'],component=component)); continue
            m=group[0]; used_maps.add(m['row']); evidence=evidence_index.get(m['evidence'],[])
            if len(evidence)!=1:
                missing.append(dict(reason='evidence',source=1,row=m['row'],component=component)); continue
            p=evidence[0]
            if employee_key(p)!=employee_key(item) or p['component']!=component or p['payrollReference']!=item['payrollReference'] or account_key(p)!=account_key(m):
                missing.append(dict(reason='evidence-match',source=1,row=m['row'],component=component)); continue
            used_evidence.add(p['row']); gs=gl_index.get(component_key(m),[])
            if len(gs)!=1:
                missing.append(dict(reason='gl',source=1,row=m['row'],component=component)); continue
            allocations.setdefault(component_key(m),[]).append((item,component))
    missing.extend(dict(reason='orphan-mapping',source=1,row=m['row'],component=m['component']) for m in maps if m['row'] not in used_maps)
    missing.extend(dict(reason='orphan-evidence',source=2,row=p['row'],component=p['component']) for p in policies if p['row'] not in used_evidence)
    reg_totals={k:sum(r[k] for r in reg) for k in ['gross','deductions','employer','net']}
    if any(v>BOUND for v in reg_totals.values()): issues.append([0,0,'AGGREGATE_BOUND'])
    if reg and reg_totals['net']==0: issues.append([0,0,'ZERO_RUN_UNSUPPORTED'])
    gl_totals=dict.fromkeys(COMPONENTS,0); comparisons=[]
    for g in gls:
        component=g['component']; gl_totals[component]+=g['normal']
        if abs(gl_totals[component])>BOUND: issues.append([3,g['row'],'AGGREGATE_BOUND'])
        assigned=allocations.get(component_key(g),[])
        if not assigned: missing.append(dict(reason='unmapped-gl',source=3,row=g['row'],component=component))
        value=sum(item[AMOUNT_KEYS[COMPONENTS.index(c)]] for item,c in assigned)
        if value>BOUND: issues.append([3,g['row'],'AGGREGATE_BOUND'])
        comparisons.append(dict(account=g['account'],dimensions=g['glDimensions'],component=component,register=value,gl=g['normal'],difference=value-g['normal'],glRow=g['row'],registerRows=[r['row'] for r,_ in assigned]))
    bank_value=sum(b['amount'] for b in banks)
    if bank_value>BOUND: issues.append([4,0,'AGGREGATE_BOUND'])
    bank_comparison=dict(register=reg_totals['net'],bank=bank_value,difference=reg_totals['net']-bank_value,bankRows=[b['row'] for b in banks])
    for source in range(5):
        if not records[source]: missing.append(dict(reason='empty-source',source=source,row=0))
    totals=dict(register=reg_totals,gl=gl_totals,bank=bank_value)
    if issues:
        kind='source-error';totals=None
        for c in comparisons:c.update(register=None,gl=None,difference=None)
        bank_comparison.update(register=None,bank=None,difference=None)
    elif missing:kind='missing'
    elif any(c['difference']!=0 for c in comparisons) or bank_comparison['difference']!=0:kind='difference'
    else:kind='ready'
    return dict(version=VERSION,scope=scope,decimals=decimals,kind=kind,records=records,issues=issues,missing=missing,comparisons=comparisons,bankComparison=bank_comparison,totals=totals,cells=cells,inventory=inventory,members=members,hashes=hashes)
