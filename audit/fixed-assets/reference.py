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

VERSION = 'fixed-assets-posted-components-gl-1'
FIELDS = ['entity', 'assetLedger', 'glLedger', 'currency', 'currencyBasis', 'postingStatus',
          'postingLayer', 'asOf', 'chartVersion', 'mapVersion', 'componentPolicyVersion', 'assetAccountSetVersion']
SCOPE_HEADERS = ['Entity', 'Asset ledger', 'GL ledger', 'Currency', 'Currency basis', 'Posting status',
                 'Posting layer', 'As of', 'Chart version', 'Map version', 'Component policy version', 'Asset account set version']
VALUES = [
    ['Asset ID', 'Asset dimensions', 'Cost', 'Accumulated depreciation', 'Impairment', 'Carrying amount', 'Valuation reference'],
    ['Mapping ID', 'Asset ID', 'Asset dimensions', 'Component', 'GL account', 'GL dimensions', 'Evidence ID'],
    ['Evidence ID', 'Asset ID', 'Asset dimensions', 'Component', 'Valuation reference', 'GL account', 'GL dimensions',
     'Account class', 'Sign', 'Value basis', 'Valid from', 'Valid to', 'Reference'],
    ['GL account', 'GL dimensions', 'Account class', 'Debit', 'Credit'],
]
HEADERS = [v + SCOPE_HEADERS for v in VALUES]
COMPONENTS = ['cost', 'depreciation', 'impairment']
CLASSES = ['fixed-asset-cost', 'accumulated-depreciation', 'accumulated-impairment']
SIGNS = ['debit-positive', 'credit-positive', 'credit-positive']
BOUND = 10 ** 14


def text(value, maximum=500):
    if not value or value != value.strip() or len(value.encode('utf-16-le')) // 2 > maximum:
        raise ValueError('IDENTITY')
    if value[0] in '=+@-' or any(unicodedata.category(c) in {'Cc', 'Cf'} for c in value):
        raise ValueError('IDENTITY')
    return value


def day(value):
    if not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}', value):
        raise ValueError('DATE')
    parsed = date.fromisoformat(value)
    if parsed.isoformat() != value:
        raise ValueError('DATE')
    return parsed


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
    if len(paths) != 4 or set(scope) != set(FIELDS):
        raise ValueError('SCOPE')
    for v in scope.values():
        text(v)
    if scope['currencyBasis'] != 'functional' or scope['postingStatus'] != 'posted':
        raise ValueError('SCOPE')
    as_of = day(scope['asOf'])
    decimals = {'SAR': 2, 'JPY': 0, 'KWD': 3}[scope['currency']]
    records = [[], [], [], []]
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
        valid_header = len(header) == len(HEADERS[source]) and set(header) == set(HEADERS[source])
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
                    aid, dimensions = text(values[0]), text(values[1])
                    cost, dep, impairment, carrying = [amount(v, decimals) for v in values[2:6]]
                    if cost - dep - impairment < 0 or cost - dep - impairment != carrying:
                        raise ValueError('CARRYING_EQUATION')
                    item.update(asset=aid, dimensions=dimensions, cost=cost, depreciation=dep,
                                impairment=impairment, carrying=carrying, valuation=text(values[6]))
                elif source == 1:
                    mid, aid, dimensions, component, account, gldim, eid = values
                    if component not in COMPONENTS:
                        raise ValueError('COMPONENT')
                    item.update(id=text(mid), asset=text(aid), dimensions=text(dimensions), component=component,
                                account=text(account), glDimensions=text(gldim), evidence=text(eid))
                elif source == 2:
                    eid, aid, dimensions, component, valuation, account, gldim, cls, sign, basis, start, end, ref = values
                    if component not in COMPONENTS:
                        raise ValueError('COMPONENT')
                    index = COMPONENTS.index(component)
                    if cls != CLASSES[index] or sign != SIGNS[index] or basis != 'provided-posted-component':
                        raise ValueError('POLICY')
                    if not day(start) <= as_of <= day(end):
                        raise ValueError('VALIDITY')
                    item.update(id=text(eid), asset=text(aid), dimensions=text(dimensions), component=component,
                                valuation=text(valuation), account=text(account), glDimensions=text(gldim),
                                accountClass=cls, sign=sign, basis=basis, validFrom=start, validTo=end, reference=text(ref, 2000))
                else:
                    account, dimensions, cls, debit, credit = values
                    if cls not in CLASSES:
                        raise ValueError('CLASS')
                    component = COMPONENTS[CLASSES.index(cls)]
                    debit, credit = amount(debit, decimals), amount(credit, decimals)
                    normal = debit - credit if component == 'cost' else credit - debit
                    item.update(account=text(account), glDimensions=text(dimensions), accountClass=cls,
                                component=component, debit=debit, credit=credit, normal=normal)
                records[source].append(item)
            except (ValueError, KeyError) as error:
                issues.append([source, number, str(error)])
    # Raw duplicate identities include malformed competitors; never fake uniqueness by discarding them.
    for source, key_names in enumerate([
        ['Asset ID', 'Asset dimensions'], ['Asset ID', 'Asset dimensions', 'Component'], ['Evidence ID'], ['GL account', 'GL dimensions']
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
    reg, maps, policies, gls = records
    asset_key = lambda r: (r['asset'], r['dimensions'])
    account_key = lambda r: (r['account'], r['glDimensions'])
    map_by_asset = {}
    evidence_by_id = {}
    gl_by_account = {}
    for m in maps:
        map_by_asset.setdefault((*asset_key(m), m['component']), []).append(m)
    for p in policies:
        evidence_by_id.setdefault(p['id'], []).append(p)
    for g in gls:
        gl_by_account.setdefault(account_key(g), []).append(g)
    used_maps, used_evidence, allocations = set(), set(), {}
    for item in reg:
        for component in COMPONENTS:
            group = map_by_asset.get((*asset_key(item), component), [])
            if len(group) != 1:
                missing.append(dict(reason='mapping', source=0, row=item['row'], component=component))
                continue
            m = group[0]
            used_maps.add(m['row'])
            evidence = evidence_by_id.get(m['evidence'], [])
            if len(evidence) != 1:
                missing.append(dict(reason='evidence', source=1, row=m['row'], component=component))
                continue
            p = evidence[0]
            if (asset_key(p) != asset_key(item) or p['component'] != component or p['valuation'] != item['valuation']
                    or account_key(p) != account_key(m)):
                missing.append(dict(reason='evidence-match', source=1, row=m['row'], component=component))
                continue
            used_evidence.add(p['row'])
            gs = gl_by_account.get(account_key(m), [])
            if len(gs) != 1 or gs[0]['component'] != component:
                missing.append(dict(reason='gl', source=1, row=m['row'], component=component))
                continue
            allocations.setdefault(account_key(m), []).append((item, component))
    missing.extend(dict(reason='orphan-mapping', source=1, row=m['row'], component=m['component']) for m in maps if m['row'] not in used_maps)
    missing.extend(dict(reason='orphan-evidence', source=2, row=p['row'], component=p['component']) for p in policies if p['row'] not in used_evidence)
    comparisons = []
    reg_totals = {k: sum(r[k] for r in reg) for k in [*COMPONENTS, 'carrying']}
    if any(abs(v) > BOUND for v in reg_totals.values()):
        issues.append([0, 0, 'AGGREGATE_BOUND'])
    gl_totals = dict.fromkeys(COMPONENTS, 0)
    for g in gls:
        component = g['component']
        gl_totals[component] += g['normal']
        if abs(gl_totals[component]) > BOUND:
            issues.append([3, g['row'], 'AGGREGATE_BOUND'])
        assigned = allocations.get(account_key(g), [])
        if not assigned:
            missing.append(dict(reason='unmapped-gl', source=3, row=g['row'], component=component))
        value = sum(item[c] for item, c in assigned)
        if value > BOUND:
            issues.append([3, g['row'], 'AGGREGATE_BOUND'])
        comparisons.append(dict(account=g['account'], dimensions=g['glDimensions'], component=component,
                                register=value, gl=g['normal'], difference=value-g['normal'], glRow=g['row'],
                                registerRows=[item['row'] for item, _ in assigned]))
    gl_totals['carrying'] = gl_totals['cost'] - gl_totals['depreciation'] - gl_totals['impairment']
    if abs(gl_totals['carrying']) > BOUND:
        issues.append([3, 0, 'AGGREGATE_BOUND'])
    for source in range(4):
        if not records[source]:
            missing.append(dict(reason='empty-source', source=source, row=0))
    totals = dict(register=reg_totals, gl=gl_totals)
    if issues:
        kind = 'source-error'
        totals = None
        for c in comparisons:
            c.update(register=None, gl=None, difference=None)
    elif missing:
        kind = 'missing'
    elif any(c['difference'] != 0 for c in comparisons):
        kind = 'difference'
    else:
        kind = 'ready'
    return dict(version=VERSION, scope=scope, decimals=decimals, kind=kind, records=records, issues=issues,
                missing=missing, comparisons=comparisons, totals=totals, cells=cells, inventory=inventory,
                members=members, hashes=hashes)
