"""Independent synthetic long-component oracle; Python stdlib only.

Only case.json.scope controls computation. Expected fields are runner inputs,
never calculation inputs. All accounting values are integral minor units,
parsed through Decimal; source rows and amount-cell coordinates are retained.
"""
from __future__ import annotations

import csv
from collections import Counter, defaultdict
from datetime import date
from decimal import Decimal, localcontext
from hashlib import sha256
from io import StringIO
import json
from pathlib import Path
import re
import unicodedata

LIMIT = 10**14
SCOPE = {
    'entity': 'Entity', 'assetLedger': 'Asset ledger', 'glLedger': 'GL ledger',
    'currency': 'Currency', 'currencyBasis': 'Currency basis',
    'postingStatus': 'Posting status', 'postingLayer': 'Posting layer',
    'asOf': 'As of', 'chartVersion': 'Chart version', 'mapVersion': 'Map version',
    'componentPolicyVersion': 'Component policy version',
    'assetAccountSetVersion': 'Asset account set version',
}
COMPONENTS = ('cost', 'depreciation', 'impairment')
LONG_COMPONENTS = COMPONENTS + ('carrying',)
POLICY = {
    'cost': ('fixed-asset-cost', 'debit-positive'),
    'depreciation': ('accumulated-depreciation', 'credit-positive'),
    'impairment': ('accumulated-impairment', 'credit-positive'),
}
HEADERS = (
    ['Asset ID', 'Asset dimensions', 'Component', 'Amount', 'Valuation reference'],
    ['Mapping ID', 'Asset ID', 'Asset dimensions', 'Component', 'GL account', 'GL dimensions', 'Evidence ID'],
    ['Evidence ID', 'Asset ID', 'Asset dimensions', 'Component', 'Valuation reference', 'GL account', 'GL dimensions', 'Account class', 'Sign', 'Value basis', 'Valid from', 'Valid to', 'Reference'],
    ['GL account', 'GL dimensions', 'Account class', 'Debit', 'Credit'],
)
HEADERS = tuple(h + list(SCOPE.values()) for h in HEADERS)
MONEY_RE = re.compile(r'[0-9]+(?:\.[0-9]+)?\Z')
ERROR_PREFIX = re.compile(r'^(?:[=+@-]|#(?:REF!|VALUE!|N/A|DIV/0!))', re.I)


class Invalid(ValueError):
    pass


def utf16_length(value):
    return len(value.encode('utf-16-le', errors='surrogatepass')) // 2


def identity(value, maximum=500):
    if (not isinstance(value, str) or not value or value != value.strip()
            or utf16_length(value) > maximum or ERROR_PREFIX.search(value)
            or any(unicodedata.category(c) in ('Cc', 'Cf', 'Cs') for c in value)):
        raise Invalid('IDENTITY')
    return value


def day(value):
    if not isinstance(value, str) or not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}', value):
        raise Invalid('VALIDITY')
    try:
        date.fromisoformat(value)
    except ValueError as error:
        raise Invalid('VALIDITY') from error
    return value


def minor(value, decimals):
    if not isinstance(value, str) or not MONEY_RE.fullmatch(value):
        raise Invalid('NUMBER')
    fraction = value.partition('.')[2]
    if len(fraction) > decimals:
        raise Invalid('PRECISION')
    # Precision follows the bounded source lexeme, never binary float.
    with localcontext() as context:
        context.prec = max(40, len(value) + decimals + 4)
        amount = Decimal(value) * Decimal(10)**decimals
        if amount > LIMIT:
            raise Invalid('AMOUNT_BOUND')
        return int(amount)


def csv_rows(original):
    if not original or len(original) > 8 * 1024 * 1024:
        raise Invalid('SOURCE_CAPACITY')
    try:
        # Match the inherited transport's single initial UTF-8 signature.
        # SHA256 above remains over untouched original bytes; embedded BOMs
        # remain literal text and fail scope/header/identity validation.
        text = original.decode('utf-8-sig', errors='strict')
    except UnicodeDecodeError as error:
        raise Invalid('UTF8') from error
    # Inherited full-source text guard precedes CSV/blank classification.
    # TAB, CR and LF remain legitimate transport characters; identity fields
    # apply their separate stricter Cc/Cf rule after parsing.
    if re.search(r'[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]', text):
        raise Invalid('CSV_CHARACTER')
    # csv.reader(strict=True) accepts quotes inside unquoted fields. Explicitly
    # prohibit those and characters after a closing quote, per this CSV family.
    state = 'start'
    position = 0
    while position < len(text):
        char = text[position]
        if state == 'quoted':
            if char == '"':
                if position + 1 < len(text) and text[position + 1] == '"':
                    position += 1
                else:
                    state = 'closed'
        elif char == '"':
            if state != 'start':
                raise Invalid('CSV')
            state = 'quoted'
        elif char in ',\r\n':
            state = 'start'
        elif state == 'closed':
            raise Invalid('CSV')
        else:
            state = 'bare'
        position += 1
    if state == 'quoted':
        raise Invalid('CSV')
    try:
        rows = list(csv.reader(StringIO(text, newline=''), strict=True))
    except csv.Error as error:
        raise Invalid('CSV') from error
    if len(rows) > 20001 or any(len(row) > 100 for row in rows):
        raise Invalid('SOURCE_LIMIT')
    if any(utf16_length(cell) > 32767 for row in rows for cell in row):
        raise Invalid('CELL_LIMIT')
    return rows


def compute(case_path):
    folder = Path(case_path)
    metadata = json.loads((folder / 'case.json').read_text(encoding='utf-8'))
    scope = metadata.get('scope')  # No expectedFinancial/assertions access here.
    result = {
        'financial': 'source-error', 'totals': None, 'comparisons': [],
        'issues': [], 'missing': [], 'evidence': [], 'inventory': [],
        'physicalMembers': [], 'sources': [],
    }

    def problem(source, row, code):
        item = {'source': source, 'row': row, 'code': code}
        if item not in result['issues']:
            result['issues'].append(item)

    def missing(source, row, reason, **details):
        item = {'source': source, 'row': row, 'reason': reason, **details}
        if item not in result['missing']:
            result['missing'].append(item)

    decimals = None
    try:
        if not isinstance(scope, dict) or set(scope) != set(SCOPE) | {'confirmed'} or scope['confirmed'] is not True:
            raise Invalid('SCOPE')
        for value in (scope[k] for k in SCOPE):
            identity(value)
        day(scope['asOf'])
        decimals = {'SAR': 2, 'JPY': 0, 'KWD': 3}.get(scope['currency'])
        if decimals is None or scope['currencyBasis'] != 'functional' or scope['postingStatus'] != 'posted':
            raise Invalid('SCOPE')
    except Invalid as error:
        problem(-1, 0, str(error))

    parsed = [[], [], [], []]
    raw = [[], [], [], []]
    physical_count = 0
    for source in range(4):
        file = folder / f'source-{source}.csv'
        try:
            original = file.read_bytes()
            result['sources'].append({'source': source, 'name': file.name, 'bytes': len(original), 'sha256': sha256(original).hexdigest()})
            rows = csv_rows(original)
        except (Invalid, OSError) as error:
            problem(source, 0, str(error) if isinstance(error, Invalid) else 'SOURCE_READ')
            continue
        physical_count += max(0, len(rows) - 1)
        header = rows[0] if rows else []
        good_header = len(header) == len(HEADERS[source]) and set(header) == set(HEADERS[source])
        if not good_header:
            problem(source, 1, 'COLUMNS')
        for index, values in enumerate(rows):
            row = index + 1
            blank = not any(v.strip() for v in values)
            entry = {'source': source, 'row': row, 'kind': 'header' if index == 0 else 'blank' if blank else 'data', 'values': values}
            result['inventory'].append(entry)
            if index == 0 or blank:
                continue
            result['physicalMembers'].append({'source': source, 'row': row})
            cells = dict(zip(header, values))
            raw[source].append((row, cells))
            # Keep amount evidence even for malformed identity, duplicate,
            # scope-contaminated or incomplete component competitors.
            for column, label in enumerate(header):
                if label not in (('Amount',) if source == 0 else ('Debit', 'Credit') if source == 3 else ()):
                    continue
                present = column < len(values)
                if not present and not good_header:
                    # An invalid header cannot authoritatively define an
                    # expected position for a cell absent from the raw row.
                    continue
                text = values[column] if present else None
                try:
                    amount = minor(text, decimals) if present and decimals is not None else None
                except Invalid:
                    amount = None
                result['evidence'].append({'source': source, 'row': row, 'column': column + 1,
                    'header': label, 'present': present, 'text': text, 'minor': amount,
                    'component': cells.get('Component'), 'asset': cells.get('Asset ID'),
                    'dimensions': cells.get('Asset dimensions'), 'valuation': cells.get('Valuation reference'),
                    'account': cells.get('GL account'), 'glDimensions': cells.get('GL dimensions')})
            if not good_header or len(values) != len(header):
                problem(source, row, 'COLUMNS')
                continue
            if decimals is None:
                continue
            try:
                if any(cells.get(label) != scope[key] for key, label in SCOPE.items()):
                    raise Invalid('ROW_SCOPE')
                if source in (0, 1, 2):
                    asset = (identity(cells['Asset ID']), identity(cells['Asset dimensions']))
                    component = cells['Component']
                    if component not in (LONG_COMPONENTS if source == 0 else COMPONENTS):
                        raise Invalid('COMPONENT')
                item = {'source': source, 'row': row, **cells}
                if source == 0:
                    item.update(assetKey=asset, component=component, valuation=identity(cells['Valuation reference']), amount=minor(cells['Amount'], decimals))
                elif source == 1:
                    item.update(assetKey=asset, component=component, id=identity(cells['Mapping ID']), evidenceId=identity(cells['Evidence ID']),
                        accountKey=(identity(cells['GL account']), identity(cells['GL dimensions'])))
                elif source == 2:
                    valid_from, valid_to = day(cells['Valid from']), day(cells['Valid to'])
                    if not valid_from <= scope['asOf'] <= valid_to:
                        raise Invalid('VALIDITY')
                    if (cells['Account class'], cells['Sign']) != POLICY[component] or cells['Value basis'] != 'provided-posted-component':
                        raise Invalid('POLICY')
                    item.update(assetKey=asset, component=component, id=identity(cells['Evidence ID']), valuation=identity(cells['Valuation reference']),
                        accountKey=(identity(cells['GL account']), identity(cells['GL dimensions'])))
                    identity(cells['Reference'], 2000)
                else:
                    class_components = {value[0]: key for key, value in POLICY.items()}
                    if cells['Account class'] not in class_components:
                        raise Invalid('CLASS')
                    component = class_components[cells['Account class']]
                    debit, credit = minor(cells['Debit'], decimals), minor(cells['Credit'], decimals)
                    item.update(component=component, accountKey=(identity(cells['GL account']), identity(cells['GL dimensions'])),
                        debit=debit, credit=credit, normal=debit-credit if component == 'cost' else credit-debit)
                parsed[source].append(item)
            except Invalid as error:
                problem(source, row, str(error))
        duplicate_fields = [('Asset ID', 'Asset dimensions', 'Component')]
        if source == 1:
            duplicate_fields.append(('Mapping ID',))
        elif source == 2:
            duplicate_fields = [('Evidence ID',)]
        elif source == 3:
            duplicate_fields = [('GL account', 'GL dimensions')]
        for fields in duplicate_fields:
            if not set(fields).issubset(header):
                continue
            groups = defaultdict(list)
            for row, cells in raw[source]:
                groups[tuple(cells.get(k, '') for k in fields)].append(row)
            for members in groups.values():
                if len(members) > 1:
                    for row in members:
                        problem(source, row, 'DUPLICATE_MAPPING_ID' if fields == ('Mapping ID',) else 'DUPLICATE')
    if physical_count > 20000:
        problem(-1, 0, 'SOURCE_LIMIT')

    # Build complete long asset sets from RAW membership, then attach each
    # parsed amount. Invalid contenders never disappear before cardinality.
    asset_raw = defaultdict(list)
    for row, cells in raw[0]:
        asset_raw[(cells.get('Asset ID', ''), cells.get('Asset dimensions', ''))].append((row, cells))
    amount_rows = {r['row']: r for r in parsed[0]}
    assets = []
    for key, members in asset_raw.items():
        counts = Counter(cells.get('Component') for _, cells in members)
        if counts != Counter(LONG_COMPONENTS):
            for row, _ in members:
                problem(0, row, 'COMPONENT_SET')
            continue
        valuations = {cells.get('Valuation reference') for _, cells in members}
        if len(valuations) != 1:
            for row, _ in members:
                problem(0, row, 'VALUATION_REFERENCE')
            continue
        if not all(row in amount_rows for row, _ in members):
            continue
        components = {amount_rows[row]['component']: amount_rows[row] for row, _ in members}
        values = {k: components[k]['amount'] for k in LONG_COMPONENTS}
        if values['cost'] - values['depreciation'] - values['impairment'] != values['carrying']:
            for row, _ in members:
                problem(0, row, 'CARRYING_EQUATION')
            continue
        assets.append({'key': key, 'valuation': next(iter(valuations)), 'components': components, 'values': values})

    mappings, policies, gls = parsed[1:]
    map_by_asset = defaultdict(list)
    evidence_by_id = defaultdict(list)
    gl_by_account = defaultdict(list)
    for item in mappings:
        map_by_asset[(item['assetKey'], item['component'])].append(item)
    for item in policies:
        evidence_by_id[item['id']].append(item)
    for item in gls:
        gl_by_account[item['accountKey']].append(item)
    used_mapping, used_evidence, allocated = set(), set(), defaultdict(list)
    for asset in assets:
        for component in COMPONENTS:
            original = asset['components'][component]
            details = {'asset': asset['key'][0], 'dimensions': asset['key'][1], 'component': component}
            linked = map_by_asset[(asset['key'], component)]
            if len(linked) != 1:
                missing(0, original['row'], 'mapping', **details)
                continue
            mapping = linked[0]
            used_mapping.add(mapping['row'])
            proofs = evidence_by_id[mapping['evidenceId']]
            if len(proofs) != 1:
                missing(1, mapping['row'], 'evidence', **details)
                continue
            proof = proofs[0]
            if (proof['assetKey'], proof['component'], proof['valuation'], proof['accountKey']) != (asset['key'], component, asset['valuation'], mapping['accountKey']):
                missing(1, mapping['row'], 'evidence-match', **details)
                continue
            used_evidence.add(proof['row'])
            balances = gl_by_account[mapping['accountKey']]
            if len(balances) != 1 or balances[0]['component'] != component:
                missing(1, mapping['row'], 'gl', **details)
                continue
            allocated[mapping['accountKey']].append(original)
    for mapping in mappings:
        if mapping['row'] not in used_mapping:
            missing(1, mapping['row'], 'orphan-mapping', component=mapping['component'])
    for proof in policies:
        if proof['row'] not in used_evidence:
            missing(2, proof['row'], 'orphan-evidence', component=proof['component'])
    register_totals = {k: sum(asset['values'][k] for asset in assets) for k in LONG_COMPONENTS}
    if any(value > LIMIT for value in register_totals.values()):
        problem(0, 0, 'AGGREGATE_BOUND')
    gl_totals = dict.fromkeys(LONG_COMPONENTS, 0)
    for gl in gls:
        gl_totals[gl['component']] += gl['normal']
        if abs(gl_totals[gl['component']]) > LIMIT:
            problem(3, gl['row'], 'AGGREGATE_BOUND')
        assigned = allocated[gl['accountKey']]
        # Inherited account diagnostic: sum(empty allocation set) is zero.
        # This never supplies a missing asset component; missing links still
        # prevent financial readiness and a broken quartet nulls all values.
        value = sum(row['amount'] for row in assigned)
        if not assigned:
            missing(3, gl['row'], 'unmapped-gl', component=gl['component'])
        if value > LIMIT:
            problem(3, gl['row'], 'AGGREGATE_BOUND')
        result['comparisons'].append({'account': gl['accountKey'][0], 'dimensions': gl['accountKey'][1], 'component': gl['component'],
            'register': value, 'gl': gl['normal'], 'difference': value-gl['normal'],
            'glRow': gl['row'], 'physicalMembers': [{'source': 0, 'row': r['row']} for r in assigned]})
    gl_totals['carrying'] = gl_totals['cost'] - gl_totals['depreciation'] - gl_totals['impairment']
    if abs(gl_totals['carrying']) > LIMIT:
        problem(3, 0, 'AGGREGATE_BOUND')
    for source in range(4):
        if not parsed[source]:
            missing(source, 0, 'empty-source')
    if result['issues']:
        for row in result['comparisons']:
            row.update(register=None, gl=None, difference=None)
    else:
        result['totals'] = {'register': register_totals, 'gl': gl_totals}
        result['financial'] = 'missing' if result['missing'] else 'difference' if any(row['difference'] != 0 for row in result['comparisons']) else 'ready'
    return result
