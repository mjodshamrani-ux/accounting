"""Independent oracle for the proposed payroll-long-register-1 contract.
Reads each story's <id>-register.csv and <id>-scope.json with a CSV reader
written here, and contract.json for the labels, columns, kinds and
currencies. It never reads stories.json, the intents or the product.

  python3 -B audit/payroll-long-register-foundation/oracle.py frozen > frozen/EXPECTED.json
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
LABELS = CONTRACT['input']['sectionLabels']
COLUMNS = CONTRACT['input']['columns']
KINDS = list(CONTRACT['input']['kinds'])
TOTALS = CONTRACT['input']['totalLabels']
SCOPE_FIELDS = CONTRACT['runScope']['fields']
DECIMALS = CONTRACT['reading']['currencies']
BLOCKING = set(CONTRACT['codes']['run']) | set(CONTRACT['codes']['employee'])
DATE_LABELS = ('Period start', 'Period end', 'Payroll posting date', 'Payment date')
# The total label that foots each kind, and the result name of each sum.
FOOT = dict(zip(KINDS, TOTALS))
SUMS = dict(zip(KINDS, ('earnings', 'deductions', 'employer', 'net')))
ERRORS = ('#REF!', '#VALUE!', '#N/A', '#DIV/0!', '#NAME?', '#NULL!', '#NUM!')
DIGITS = str.maketrans('٠١٢٣٤٥٦٧٨٩'
                       '۰۱۲۳۴۵۶۷۸۹', '01234567890123456789')
MAX_MINOR = 10 ** 14
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


def amount(v, decimals):
    """Minor units, or None when the amount rules refuse the cell."""
    s = strip(v).translate(DIGITS).replace('٫', '.')
    m = re.fullmatch(r'([0-9]+)(?:\.([0-9]+))?', s)
    if not m or len(m.group(2) or '') > decimals:
        return None
    n = int(m.group(1)) * 10 ** decimals + int((m.group(2) or '').ljust(decimals, '0') or 0)
    return n if n <= MAX_MINOR else None


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


def blocks(rows):
    """Sections and run totals blocks in file order, and the stray rows."""
    out, strays, i = [], [], 0
    while i < len(rows):
        r, n = rows[i], i + 1
        i += 1
        if not width(r):
            continue
        first = strip(r[0])
        if first not in ('Section', 'Run totals'):
            strays.append(n)
            continue
        own = 'End section' if first == 'Section' else 'End run totals'
        b = {'kind': first, 'row': n, 'opening': r, 'rows': [], 'closed': False}
        while i < len(rows):
            r = rows[i]
            if not width(r):
                i += 1
                continue
            mark = strip(r[0])
            if mark in ('Section', 'Run totals'):
                break
            i += 1
            if mark in ('End section', 'End run totals'):
                b['closed'] = mark == own and width(r) == 2 and width(b['opening']) == 2 \
                    and strip(r[1]) == strip(b['opening'][1])
                break
            b['rows'].append((i, r))
        out.append(b)
    return out, strays


def header(opening, labels):
    """(values by label, whether the Section row and labels read whole)."""
    counts = Counter(strip(r[0]) for r in labels)
    values = {lab: None for lab in LABELS}
    for r in labels:
        lab = strip(r[0])
        if lab in values and counts[lab] == 1:
            values[lab] = real_date(cell(r, 1)) if lab in DATE_LABELS else text(cell(r, 1))
    whole = width(opening) == 2 and text(opening[1]) is not None \
        and set(counts) <= set(LABELS) and all(v is not None for v in values.values())
    return values, whole


def column_map(row):
    if row is None or width(row) != len(COLUMNS):
        return None
    cols = {strip(c): j for j, c in enumerate(row[:width(row)])}
    return cols if set(cols) == set(COLUMNS) else None


def foot(rows, decimals):
    """The four printed totals by label, or None when they are not each total
    label once with two meaningful cells and a readable amount."""
    labels = [strip(r[0]) for r in rows]
    if sorted(labels) != sorted(TOTALS) or any(width(r) != 2 for r in rows):
        return None
    printed = {strip(r[0]): amount(r[1], decimals) for r in rows}
    return None if None in printed.values() else printed


def judge_section(b, run, decimals):
    labels, columns, body = [], None, []
    for n, r in b['rows']:
        if columns is None and width(r) > 2:
            columns = r
        elif columns is None:
            labels.append(r)
        else:
            body.append((n, r))
    values, whole = header(b['opening'], labels)
    s = {'row': b['row'], 'id': text(cell(b['opening'], 1)), 'whole': whole, 'closed': b['closed'],
         'excluded': False, 'columns': True, 'read': False, 'lines': [], 'totals': None}
    if not whole:
        return s
    other = any(values[lab] != run[lab] for lab in LABELS)
    if other and b['closed']:
        s['excluded'] = True
        return s
    cols = column_map(columns)
    if cols is None:
        s['columns'] = False
        return s
    if other:
        return s
    s['read'] = True
    totals, after = [], False
    for n, r in body:
        if strip(r[0]) in TOTALS:
            totals.append(r)
            continue
        after = after or bool(totals)
        get = lambda c: cell(r, cols[c])
        kind = strip(get('Kind'))
        s['lines'].append({
            'row': n, 'id': text(get('Line ID')), 'employee': text(get('Employee ID')),
            'dims': text(get('Employee dimensions')), 'payee': text(get('Payee account')),
            'component': text(get('Component')), 'kind': kind if kind in KINDS else None,
            'amount': amount(get('Amount'), decimals), 'wide': width(r) > len(COLUMNS)})
    printed = None if after else foot(totals, decimals)
    if printed is None or any(x['kind'] is None or x['amount'] is None for x in s['lines']):
        s['totals'] = 'TOTAL_FIELD'
    elif any(printed[FOOT[k]] != sum(x['amount'] for x in s['lines'] if x['kind'] == k) for k in KINDS):
        s['totals'] = 'TOTAL_MISMATCH'
    return s


def scope_ok(run):
    return isinstance(run, dict) and sorted(run) == sorted(SCOPE_FIELDS) \
        and all(isinstance(v, str) and text(v) == v for v in run.values()) \
        and run['Currency'] in DECIMALS \
        and all(real_date(run[k]) is not None for k in DATE_LABELS) \
        and run['Period start'] <= run['Period end'] and run['Payroll posting date'] <= run['Payment date']


def judge(folder, sid):
    run = json.loads((folder / f'{sid}-scope.json').read_text(encoding='utf-8'))
    if not scope_ok(run):
        return {'refused': 'SCOPE'}
    decimals = DECIMALS[run['Currency']]
    try:
        rows = records(folder / f'{sid}-register.csv')
    except Refused as e:
        return {'refused': str(e)}
    found, strays = blocks(rows)
    sections = [judge_section(b, run, decimals) for b in found if b['kind'] == 'Section']
    footers = [b for b in found if b['kind'] == 'Run totals']
    read = [s for s in sections if s['read']]
    lines = [x for s in read for x in s['lines']]

    run_codes, unplaced = set(), []
    for n in strays:
        run_codes.add('STRAY_ROW')
        unplaced.append([n, 'STRAY_ROW'])
    for s in sections:
        if not s['whole']:
            run_codes.add('SECTION_HEADER')
            unplaced.append([s['row'], 'SECTION_HEADER'])
        elif not s['columns']:
            run_codes.add('SECTION_COLUMNS')
            unplaced.append([s['row'], 'SECTION_COLUMNS'])
        if not s['closed']:
            run_codes.add('SECTION_UNCLOSED')
    ids = Counter(s['id'] for s in sections if not s['excluded'] and s['id'] is not None)
    if any(c > 1 for c in ids.values()):
        run_codes.add('SECTION_DUPLICATE')
    for x in lines:
        if x['employee'] is None or x['dims'] is None:
            run_codes.add('LINE_UNREADABLE')
            unplaced.append([x['row'], 'LINE_UNREADABLE'])

    checkable = all(x['kind'] is not None and x['amount'] is not None for x in lines)
    sums = {SUMS[k]: sum(x['amount'] for x in lines if x['kind'] == k) for k in KINDS} if checkable else None
    printed = None
    if len(footers) == 1:
        b = footers[0]
        if b['closed'] and width(b['opening']) == 2 and text(b['opening'][1]) == run['Payroll run']:
            printed = foot([r for _, r in b['rows']], decimals)
    if printed is None or sums is None:
        run_codes.add('RUN_TOTALS')
    elif any(printed[FOOT[k]] != sums[SUMS[k]] for k in KINDS):
        run_codes.add('RUN_TOTAL_MISMATCH')

    held, mine = {}, {}
    hold = lambda key, code: held.setdefault(key, set()).add(code)
    line_ids = Counter(x['id'] for x in lines if x['id'] is not None)
    for s in read:
        for x in s['lines']:
            if x['employee'] is None or x['dims'] is None:
                continue
            key = (x['employee'], x['dims'])
            mine.setdefault(key, []).append(x)
            if None in (x['id'], x['payee'], x['component']):
                hold(key, 'IDENTITY')
            if x['kind'] is None:
                hold(key, 'KIND')
            if x['amount'] is None:
                hold(key, 'AMOUNT')
            if x['wide']:
                hold(key, 'LINE_WIDTH')
            if x['id'] is not None and line_ids[x['id']] > 1:
                hold(key, 'DUPLICATE_LINE')
            if s['totals']:
                hold(key, s['totals'])
    out = {}
    for key in sorted(mine):
        own = mine[key]
        if len({x['payee'] for x in own if x['payee'] is not None}) > 1:
            hold(key, 'PAYEE_CONFLICT')
        nets = [x for x in own if x['kind'] == 'net']
        if len(nets) > 1:
            hold(key, 'NET_REPEATED')
        for code in run_codes:
            hold(key, code)
        codes = sorted(held.get(key, set()) & BLOCKING)
        name = '|'.join(key)
        if codes:
            out[name] = {'status': 'held', 'codes': codes, 'earnings': None, 'deductions': None, 'employer': None,
                         'net': None, 'payee': None, 'lines': None}
            continue
        part = {SUMS[k]: sum(x['amount'] for x in own if x['kind'] == k) for k in KINDS if k != 'net'}
        net = nets[0]['amount'] if nets else None
        if net is None:
            status, codes = 'missing', ['NET_ABSENT']
        elif part['earnings'] - part['deductions'] != net:
            status, codes = 'inconsistent', ['NET_EQUATION']
        else:
            status, codes = 'consistent', []
        out[name] = {'status': status, 'codes': codes, **part, 'net': net, 'payee': own[0]['payee'],
                     'lines': sorted([x['id'], x['component'], x['kind'], x['amount']] for x in own)}

    payees = {}
    for x in lines:
        if x['employee'] is not None and x['payee'] is not None:
            payees.setdefault(x['payee'], set()).add(x['employee'])
    return {
        'employees': out,
        'excludedSections': sorted(s['id'] for s in sections if s['excluded']),
        'sharedPayees': [[p, sorted(e)] for p, e in sorted(payees.items()) if len(e) > 1],
        'unplaced': sorted(unplaced),
        'totals': sums,
        'run': sorted(run_codes),
    }


def run(folder):
    folder = Path(folder)
    ids = sorted(p.name[:-len('-scope.json')] for p in folder.glob('*-scope.json'))
    return {'schema': 'tarasuf-pay1-long-register-expected/1', 'stories': {sid: judge(folder, sid) for sid in ids}}


if __name__ == '__main__':
    sys.stdout.write(json.dumps(run(sys.argv[1]), ensure_ascii=False, indent=1) + '\n')
