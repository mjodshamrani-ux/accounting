"""Independent oracle for the proposed inventory-movement-bridge-1 contract.
Reads each story's <id>-register.csv, <id>-gl.csv and <id>-scope.json with a
CSV reader written here, and contract.json for the columns, kinds and
currencies. It never reads stories.json, the intents or the product.

  python3 -B audit/inventory-movement-foundation/oracle.py frozen > frozen/EXPECTED.json
"""
import json
import re
import sys
import unicodedata
from collections import Counter
from datetime import date as Date
from pathlib import Path

HERE = Path(__file__).resolve().parent
CONTRACT = json.loads((HERE / 'contract.json').read_text(encoding='utf-8'))
COLUMNS = CONTRACT['register']['columns']
GL_COLUMNS = CONTRACT['gl']['columns']
KINDS = list(CONTRACT['register']['kinds'])
INFLOWS = CONTRACT['register']['inflows']
OUTFLOWS = CONTRACT['register']['outflows']
MOVES = [k for k in KINDS if k not in ('opening', 'closing')]
TRANSFERS = ('transfer-in', 'transfer-out')
RETURNS = {'return-out': 'receipt', 'return-in': 'issue'}
SCOPE_FIELDS = CONTRACT['runScope']['fields']
DECIMALS = CONTRACT['reading']['currencies']
POSITION_HOLDS = set(CONTRACT['codes']['position']) | {'LINE_UNREADABLE'}
ERRORS = ('#REF!', '#VALUE!', '#N/A', '#DIV/0!', '#NAME?', '#NULL!', '#NUM!')
DIGITS = str.maketrans('\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669'
                       '\u06f0\u06f1\u06f2\u06f3\u06f4\u06f5\u06f6\u06f7\u06f8\u06f9', '01234567890123456789')
LIMIT = 10 ** 14
FIELD = re.compile(r'"((?:[^"]|"")*)"|([^",\r\n]*)')


class Refused(Exception):
    pass


def strip(v):
    return v.strip(' ')


def width(row):
    n = len(row)
    while n and not strip(row[n - 1]):
        n -= 1
    return n


def cell(row, j):
    return row[j] if j < len(row) else ''


def text(v):
    """The value as written, ordinary spaces removed, or None when the text
    rules refuse it."""
    s = strip(v)
    if not s or len(s) > 500 or s[0] in '=+@-' or s.upper().startswith(ERRORS):
        return None
    for ch in s:
        kind = unicodedata.category(ch)
        if kind in ('Cc', 'Cf') or (kind[0] == 'Z' and ch != ' '):
            return None
    return s


def real_date(v):
    s = strip(v)
    if not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}', s):
        return None
    try:
        Date.fromisoformat(s)
    except ValueError:
        return None
    return s


def number(v, places, signed):
    """An integer in 10^-places, or None when the number rules refuse the
    cell. A minus sign reads only where signed."""
    s = strip(v).translate(DIGITS).replace('\u066b', '.')
    m = re.fullmatch(r'(-?)([0-9]+)(?:\.([0-9]+))?', s)
    if not m or (m.group(1) and not signed) or len(m.group(3) or '') > places:
        return None
    n = int(m.group(2)) * 10 ** places + int((m.group(3) or '').ljust(places, '0') or 0)
    if n > LIMIT:
        return None
    return -n if m.group(1) else n


def records(path):
    """RFC 4180 records. A quote inside an unquoted field, text after a
    closing quote or an unclosed quote refuses the file."""
    try:
        t = path.read_bytes().decode('utf-8')
    except UnicodeDecodeError:
        raise Refused('ENCODING')
    if t.startswith('\ufeff'):
        t = t[1:]
    rows, row, i, n = [], [], 0, len(t)
    while i < n:
        m = FIELD.match(t, i)
        row.append(m.group(1).replace('""', '"') if m.group(1) is not None else m.group(2))
        i = m.end()
        if i == n:
            break
        if t[i] == ',':
            i += 1
            if i == n:
                row.append('')
            continue
        if t[i] not in '\r\n':
            raise Refused('CSV')
        i += 2 if t.startswith('\r\n', i) else 1
        rows.append(row)
        row = []
    if row:
        rows.append(row)
    return rows


def table(rows, columns):
    """(column index by name, line rows as (number, row), repeated header row
    numbers), or None when the header row is not the columns."""
    numbered = [(i + 1, r) for i, r in enumerate(rows) if width(r)]
    if not numbered:
        return None
    head = [strip(c) for c in numbered[0][1][:width(numbered[0][1])]]
    if len(head) != len(columns) or set(head) != set(columns):
        return None
    lines, repeated = [], []
    for n, r in numbered[1:]:
        if [strip(c) for c in r[:width(r)]] == head:
            repeated.append(n)
        else:
            lines.append((n, r))
    return {c: j for j, c in enumerate(head)}, lines, repeated


def register_line(n, r, cols, decimals):
    get = lambda c: cell(r, cols[c])
    kind = strip(get('Kind'))
    kind = kind if kind in KINDS else None
    balance = kind in ('opening', 'closing')
    x = {'row': n, 'mid': text(get('Movement ID')), 'item': text(get('Item ID')),
         'dims': text(get('Item dimensions')), 'kind': kind, 'q': number(get('Quantity'), 3, balance),
         'unit': text(get('Unit')), 'v': number(get('Value'), decimals, balance),
         'md': real_date(get('Movement date')), 'pd': real_date(get('Posting date')),
         'account': text(get('GL account')), 'tid': text(get('Transfer ID')), 'oid': text(get('Origin ID'))}
    tid_blank, oid_blank = not strip(get('Transfer ID')), not strip(get('Origin ID'))
    codes = set()
    if None in (x['mid'], x['unit'], x['account']):
        codes.add('IDENTITY')
    if kind is None:
        codes.add('KIND')
    if x['q'] is None:
        codes.add('QUANTITY')
    if x['v'] is None:
        codes.add('VALUE')
    if x['md'] is None or x['pd'] is None:
        codes.add('DATE')
    if kind in TRANSFERS:
        link = x['tid'] is None or not oid_blank
    elif kind in RETURNS:
        link = x['oid'] is None or not tid_blank
    else:
        link = not tid_blank or not oid_blank
    if link:
        codes.add('LINK')
    if width(r) > len(COLUMNS):
        codes.add('LINE_WIDTH')
    x['codes'] = codes
    x['whole'] = not codes and x['item'] is not None and x['dims'] is not None
    return x


def scope_ok(run):
    return isinstance(run, dict) and sorted(run) == sorted(SCOPE_FIELDS) \
        and all(isinstance(v, str) and text(v) == v for v in run.values()) \
        and run['Currency'] in DECIMALS \
        and real_date(run['Period start']) is not None and real_date(run['Period end']) is not None \
        and run['Period start'] <= run['Period end'] \
        and run['Negative balances'] in ('allowed', 'not allowed')


def gl_lines(path, decimals):
    """(GL lines, repeated header rows), or None when the GL file is refused
    as a file."""
    try:
        rows = records(path)
    except Refused:
        return None
    found = table(rows, GL_COLUMNS)
    if found is None:
        return None
    cols, body, repeated = found
    out = []
    for n, r in body:
        get = lambda c: cell(r, cols[c])
        out.append({'row': n, 'account': text(get('GL account')), 'opening': number(get('Opening'), decimals, True),
                    'debit': number(get('Debit'), decimals, False), 'credit': number(get('Credit'), decimals, False),
                    'closing': number(get('Closing'), decimals, True), 'wide': width(r) > len(GL_COLUMNS)})
    return out, repeated


def judge(folder, sid):
    run = json.loads((folder / f'{sid}-scope.json').read_text(encoding='utf-8'))
    if not scope_ok(run):
        return {'refused': 'SCOPE'}
    decimals = DECIMALS[run['Currency']]
    start, end = run['Period start'], run['Period end']
    inside = lambda d: d is not None and start <= d <= end
    try:
        rows = records(folder / f'{sid}-register.csv')
    except Refused as e:
        return {'refused': str(e)}
    found = table(rows, COLUMNS)
    if found is None:
        return {'refused': 'HEADER'}
    cols, body, repeated = found
    lines = [register_line(n, r, cols, decimals) for n, r in body]

    run_codes, unplaced = set(), []
    for x in lines:
        if x['item'] is None or x['dims'] is None:
            run_codes.add('LINE_UNREADABLE')
            unplaced.append(['register', x['row'], 'LINE_UNREADABLE'])
    excluded = [x for x in lines if x['whole'] and x['kind'] in MOVES and not inside(x['pd'])]
    dated = [x for x in lines if x['whole'] and x['kind'] in MOVES and inside(x['pd']) and not inside(x['md'])]
    skip = {id(x) for x in excluded}
    mine = {}
    for x in lines:
        if id(x) not in skip and x['item'] is not None and x['dims'] is not None:
            mine.setdefault((x['item'], x['dims']), []).append(x)
    key_of = lambda x: (x['item'], x['dims']) if id(x) not in skip and x['item'] is not None \
        and x['dims'] is not None else None

    held = {}

    def hold(x, code):
        key = key_of(x)
        if key is not None:
            held.setdefault(key, set()).add(code)

    ids = Counter(x['mid'] for x in lines if x['mid'] is not None)
    for key, own in mine.items():
        for x in own:
            for code in x['codes']:
                hold(x, code)
            if x['mid'] is not None and ids[x['mid']] > 1:
                hold(x, 'DUPLICATE_MOVEMENT')
            if x['kind'] == 'opening' and (x['md'] not in (None, start) or x['pd'] not in (None, start)):
                hold(x, 'BALANCE_DATE')
            if x['kind'] == 'closing' and (x['md'] not in (None, end) or x['pd'] not in (None, end)):
                hold(x, 'BALANCE_DATE')
            if x['kind'] in ('opening', 'closing') and run['Negative balances'] == 'not allowed' \
                    and ((x['q'] or 0) < 0 or (x['v'] or 0) < 0):
                hold(x, 'NEGATIVE_BALANCE')
        if len({x['unit'] for x in own if x['unit'] is not None}) > 1:
            held.setdefault(key, set()).add('UNIT_CONFLICT')
        if len({x['account'] for x in own if x['account'] is not None}) > 1:
            held.setdefault(key, set()).add('ACCOUNT_CONFLICT')
        if sum(x['kind'] == 'opening' for x in own) > 1 or sum(x['kind'] == 'closing' for x in own) > 1:
            held.setdefault(key, set()).add('BALANCE_REPEATED')

    groups = {}
    for x in lines:
        if x['kind'] in TRANSFERS and inside(x['pd']) and x['tid'] is not None:
            groups.setdefault(x['tid'], []).append(x)
    pairs = {}
    for tid, group in groups.items():
        outs = [x for x in group if x['kind'] == 'transfer-out']
        ins = [x for x in group if x['kind'] == 'transfer-in']
        if len(outs) > 1 or len(ins) > 1:
            for x in group:
                hold(x, 'TRANSFER_REPEATED')
        elif not outs or not ins:
            hold(group[0], 'TRANSFER_UNPAIRED')
        else:
            a, b = outs[0], ins[0]
            same = all(a[f] is not None and a[f] == b[f] for f in ('item', 'unit', 'q', 'v'))
            if not same:
                hold(a, 'TRANSFER_MISMATCH')
                hold(b, 'TRANSFER_MISMATCH')
            pairs[tid] = (a, b)

    unseen, valid = [], {}
    for x in lines:
        if x['kind'] not in RETURNS or not inside(x['pd']) or x['oid'] is None:
            continue
        named = [o for o in lines if o['mid'] == x['oid']]
        if not named:
            unseen.append([x['row'], x['mid'], x['oid']])
            continue
        o = named[0]
        if len(named) > 1 or not o['whole'] or o['kind'] != RETURNS[x['kind']] or o['item'] != x['item'] \
                or o['unit'] != x['unit']:
            hold(x, 'RETURN_ORIGIN')
            continue
        valid.setdefault(id(o), (o, []))[1].append(x)
    for o, rets in valid.values():
        if any(x['q'] is None or x['v'] is None for x in rets) or sum(x['q'] for x in rets) > o['q'] \
                or sum(x['v'] for x in rets) > o['v']:
            for x in rets:
                hold(x, 'RETURN_CAPACITY')

    positions = {}
    for key in sorted(mine):
        own = mine[key]
        codes = sorted((held.get(key, set()) | run_codes) & POSITION_HOLDS)
        rows_of = sorted(x['row'] for x in own)
        name = '|'.join(key)
        if codes:
            positions[name] = {'status': 'held', 'codes': codes, 'unit': None, 'account': None, 'opening': None,
                               'closing': None, 'flows': None, 'computed': None, 'lines': None, 'rows': rows_of}
            continue
        pair = lambda x: None if x is None else {'quantity': x['q'], 'value': x['v']}
        opening = next((x for x in own if x['kind'] == 'opening'), None)
        closing = next((x for x in own if x['kind'] == 'closing'), None)
        flows = {k: {'quantity': sum(x['q'] for x in own if x['kind'] == k),
                     'value': sum(x['v'] for x in own if x['kind'] == k)} for k in MOVES}
        computed = None
        if opening is not None:
            computed = {
                'quantity': opening['q'] + sum(flows[k]['quantity'] for k in INFLOWS)
                - sum(flows[k]['quantity'] for k in OUTFLOWS),
                'value': opening['v'] + sum(flows[k]['value'] for k in INFLOWS)
                - sum(flows[k]['value'] for k in OUTFLOWS)}
        if opening is None or closing is None:
            status = 'missing'
            codes = sorted((['OPENING_ABSENT'] if opening is None else [])
                           + (['CLOSING_ABSENT'] if closing is None else []))
        else:
            codes = (['QUANTITY_BRIDGE'] if computed['quantity'] != closing['q'] else []) \
                + (['VALUE_BRIDGE'] if computed['value'] != closing['v'] else [])
            status = 'inconsistent' if codes else 'consistent'
        positions[name] = {'status': status, 'codes': codes, 'unit': own[0]['unit'], 'account': own[0]['account'],
                           'opening': pair(opening), 'closing': pair(closing), 'flows': flows, 'computed': computed,
                           'lines': sorted([x['mid'], x['kind'], x['q'], x['v']] for x in own), 'rows': rows_of}

    gl = gl_lines(folder / f'{sid}-gl.csv', decimals)
    gl_codes = set()
    if gl is None:
        gl_codes.add('GL_FILE')
        gl_rows, gl_repeated = [], []
    else:
        gl_rows, gl_repeated = gl
    for g in gl_rows:
        if g['account'] is None:
            gl_codes.add('GL_UNREADABLE')
            unplaced.append(['gl', g['row'], 'GL_UNREADABLE'])
    run_codes |= gl_codes
    by_account = {}
    for g in gl_rows:
        if g['account'] is not None:
            by_account.setdefault(g['account'], []).append(g)
    status_of = {key: positions['|'.join(key)]['status'] for key in mine}
    named = {}
    for key, own in mine.items():
        for x in own:
            if x['account'] is not None:
                named.setdefault(x['account'], set()).add(key)
    accounts = {}
    for acct in sorted(set(named) | set(by_account)):
        codes = set(run_codes & {'LINE_UNREADABLE', 'GL_FILE', 'GL_UNREADABLE'})
        rows_ = by_account.get(acct, [])
        if len(rows_) > 1:
            codes.add('GL_DUPLICATE')
        for g in rows_:
            if None in (g['opening'], g['debit'], g['credit'], g['closing']):
                codes.add('GL_AMOUNT')
            if g['wide']:
                codes.add('GL_WIDTH')
        if any(status_of[key] != 'consistent' for key in named.get(acct, ())):
            codes.add('POSITION')
        entry = {'status': 'held', 'codes': sorted(codes), 'register': None, 'gl': None, 'difference': None}
        if not codes:
            reg = gl_side = None
            if acct in named:
                reg = {'opening': 0, 'debit': 0, 'credit': 0, 'closing': 0}
                for key in named[acct]:
                    for x in mine[key]:
                        if x['kind'] in ('opening', 'closing'):
                            reg[x['kind']] += x['v']
                            continue
                        if x['kind'] in TRANSFERS:
                            a, b = pairs[x['tid']]
                            if a['account'] == acct and b['account'] == acct:
                                continue
                        reg['debit' if x['kind'] in INFLOWS else 'credit'] += x['v']
            if acct in by_account:
                g = rows_[0]
                gl_side = {k: g[k] for k in ('opening', 'debit', 'credit', 'closing')}
            if reg is None:
                entry = {'status': 'missing', 'codes': ['REGISTER_ABSENT'], 'register': None, 'gl': gl_side,
                         'difference': None}
            elif gl_side is None:
                entry = {'status': 'missing', 'codes': ['GL_ABSENT'], 'register': reg, 'gl': None,
                         'difference': None}
            else:
                diff = {k: reg[k] - gl_side[k] for k in reg}
                codes = sorted(f'{k.upper()}_DIFF' for k in diff if diff[k])
                entry = {'status': 'difference' if codes else 'consistent', 'codes': codes, 'register': reg,
                         'gl': gl_side, 'difference': diff}
        accounts[acct] = entry

    totals = None
    if 'LINE_UNREADABLE' not in run_codes and all(p['status'] in ('consistent', 'inconsistent')
                                                  for p in positions.values()):
        totals = {'opening': 0, 'receipt': 0, 'issue': 0, 'adjustment-in': 0, 'adjustment-out': 0, 'return-in': 0,
                  'return-out': 0, 'closing': 0, 'transferred': 0}
        for own in mine.values():
            for x in own:
                if x['kind'] == 'transfer-out':
                    totals['transferred'] += x['v']
                elif x['kind'] != 'transfer-in':
                    totals[x['kind']] += x['v']

    return {
        'positions': positions,
        'accounts': accounts,
        'excluded': sorted([x['row'], x['mid']] for x in excluded),
        'datedOutside': sorted([x['row'], x['mid']] for x in dated),
        'unseenOrigins': sorted(unseen),
        'repeatedHeaders': sorted([['register', n] for n in repeated] + [['gl', n] for n in gl_repeated]),
        'unplaced': sorted(unplaced),
        'totals': totals,
        'run': sorted(run_codes),
    }


def run(folder):
    folder = Path(folder)
    ids = sorted(p.name[:-len('-scope.json')] for p in folder.glob('*-scope.json'))
    return {'schema': 'tarasuf-inv2-movement-bridge-expected/1', 'stories': {sid: judge(folder, sid) for sid in ids}}


if __name__ == '__main__':
    sys.stdout.write(json.dumps(run(sys.argv[1]), ensure_ascii=False, indent=1) + '\n')
