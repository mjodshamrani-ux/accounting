"""Independent oracle for the proposed gl-tb-sections-1 contract. Reads each
story's <id>-gl.csv, <id>-tb.csv and <id>-scope.json with Python's csv module,
and contract.json for the labels, columns and currencies. It never reads
stories.json, the intents or the product.

  python3 -B audit/gl-tb-sections-foundation/oracle.py frozen > frozen/EXPECTED.json
"""
import csv
import io
import json
import re
import sys
import unicodedata
from collections import Counter
from datetime import date as Date
from pathlib import Path

HERE = Path(__file__).resolve().parent
CONTRACT = json.loads((HERE / 'contract.json').read_text(encoding='utf-8'))
SECTION_LABELS = CONTRACT['inputs']['glDetail']['sectionLabels']
GL_COLUMNS = CONTRACT['inputs']['glDetail']['columns']
PAGE_LABELS = CONTRACT['inputs']['trialBalance']['pageLabels']
TB_COLUMNS = CONTRACT['inputs']['trialBalance']['columns']
SCOPE_FIELDS = CONTRACT['runScope']['fields']
DECIMALS = CONTRACT['reading']['currencies']
BLOCKING = set(CONTRACT['codes']['blocking'])
SIX = ['openingDebit', 'openingCredit', 'periodDebit', 'periodCredit', 'closingDebit', 'closingCredit']
TB_AMOUNTS = ['Opening debit', 'Opening credit', 'Period debit', 'Period credit', 'Closing debit', 'Closing credit']
KINDS = ('opening', 'movement', 'closing')
ERRORS = ('#REF!', '#VALUE!', '#N/A', '#DIV/0!', '#NAME?', '#NULL!', '#NUM!')
DIGITS = str.maketrans('٠١٢٣٤٥٦٧٨٩'
                       '۰۱۲۳۴۵۶۷۸۹', '01234567890123456789')
MAX_MINOR = 10 ** 14


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
    raw = path.read_bytes()
    try:
        t = raw.decode('utf-8')
    except UnicodeDecodeError:
        raise Refused('ENCODING')
    if t.startswith('\ufeff'):
        t = t[1:]
    try:
        return [list(r) for r in csv.reader(io.StringIO(t, newline=''), strict=True)]
    except csv.Error:
        raise Refused('CSV')


def blocks(rows, start, end):
    """Sections or pages, and the rows outside every one of them."""
    out, strays, i = [], [], 0
    while i < len(rows):
        r, n = rows[i], i + 1
        i += 1
        if not width(r):
            continue
        if strip(r[0]) != start:
            strays.append(n)
            continue
        b = {'row': n, 'opening': r, 'labels': [], 'columns': None, 'body': [], 'closed': False}
        while i < len(rows):
            r = rows[i]
            if not width(r):
                i += 1
                continue
            first = strip(r[0])
            if first == start:
                break
            i += 1
            if first == end:
                b['closed'] = width(r) == 2 and width(b['opening']) == 2 and strip(r[1]) == strip(b['opening'][1])
                break
            if b['columns'] is None and width(r) > 2:
                b['columns'] = r
            elif b['columns'] is None:
                b['labels'].append(r)
            else:
                b['body'].append((i, r))
        out.append(b)
    return out, strays


def header(b, names):
    """(values by label, whether the header reads whole). A value is None when
    its label is absent, repeated or its value is refused."""
    counts = Counter(strip(r[0]) for r in b['labels'])
    values = {lab: None for lab in names}
    for r in b['labels']:
        lab = strip(r[0])
        if lab in values and counts[lab] == 1:
            values[lab] = real_date(cell(r, 1)) if lab.startswith('Period ') else text(cell(r, 1))
    whole = width(b['opening']) == 2 and text(b['opening'][1]) is not None \
        and set(counts) <= set(names) and all(v is not None for v in values.values())
    return values, whole


def column_map(row, names):
    if row is None or width(row) != len(names):
        return None
    cols = {strip(c): j for j, c in enumerate(row[:width(row)])}
    return cols if set(cols) == set(names) else None


def judge_section(b, run, decimals):
    values, whole = header(b, SECTION_LABELS)
    s = {'row': b['row'], 'id': text(cell(b['opening'], 1)), 'account': values['Account'],
         'dims': values['Complete dimensions'], 'codes': set(), 'excluded': False, 'six': None, 'missing': []}
    if not whole:
        s['codes'].add('SECTION_HEADER')
    if not b['closed']:
        s['codes'].add('SECTION_UNCLOSED')
    if s['codes']:
        return s
    if any(values[lab] != run[lab] for lab in SCOPE_FIELDS):
        s['excluded'] = True
        return s
    cols = column_map(b['columns'], GL_COLUMNS)
    if cols is None or any(width(r) > len(GL_COLUMNS) for _, r in b['body']):
        s['codes'].add('SECTION_COLUMNS')
        return s
    start, end = run['Period start'], run['Period end']
    ids, roles = Counter(), {k: [] for k in KINDS}
    for _, r in b['body']:
        get = lambda c: cell(r, cols[c])
        rid = text(get('Record ID'))
        if rid is None:
            s['codes'].add('IDENTITY')
        else:
            ids[rid] += 1
        kind = strip(get('Record kind'))
        if kind not in KINDS:
            s['codes'].add('KIND')
        d = real_date(get('Posting date'))
        if d is None or (kind == 'opening' and d != start) or (kind == 'closing' and d != end):
            s['codes'].add('DATE')
        elif kind == 'movement' and not start <= d <= end:
            s['codes'].add('POSTING_PERIOD')
        dr, cr = amount(get('Debit'), decimals), amount(get('Credit'), decimals)
        if dr is None or cr is None:
            s['codes'].add('AMOUNT')
        if kind in KINDS:
            roles[kind].append((dr, cr))
    if any(c > 1 for c in ids.values()):
        s['codes'].add('DUPLICATE_RECORD')
    if len(roles['opening']) > 1 or len(roles['closing']) > 1:
        s['codes'].add('ROLE_REPEATED')
    if s['codes']:
        return s
    if not roles['opening']:
        s['missing'].append('GL_OPENING_ABSENT')
    if not roles['closing']:
        s['missing'].append('GL_CLOSING_ABSENT')
    if not s['missing']:
        (od, oc), (cd, cc) = roles['opening'][0], roles['closing'][0]
        s['six'] = [od, oc, sum(d for d, _ in roles['movement']), sum(c for _, c in roles['movement']), cd, cc]
    return s


def judge_page(b, run, decimals):
    values, whole = header(b, PAGE_LABELS)
    p = {'row': b['row'], 'id': text(cell(b['opening'], 1)), 'unreadable': False, 'excluded': False, 'rows': []}
    cols = column_map(b['columns'], TB_COLUMNS)
    if not whole or cols is None or not b['closed']:
        p['unreadable'] = True
        return p
    if any(values[lab] != run[lab] for lab in SCOPE_FIELDS):
        p['excluded'] = True
        return p
    for n, r in b['body']:
        get = lambda c: cell(r, cols[c])
        kind = strip(get('Row type'))
        row = {'row': n, 'account': text(get('Account')), 'dims': text(get('Complete dimensions')), 'kind': kind}
        if row['account'] is None or row['dims'] is None or kind not in ('account', 'total'):
            row['kind'] = None
            p['rows'].append(row)
            continue
        written = strip(get('Parent account'))
        row['parent'] = text(written) if written else ''
        row['fieldOk'] = row['parent'] is not None and width(r) <= len(TB_COLUMNS)
        row['six'] = [amount(get(c), decimals) for c in TB_AMOUNTS]
        p['rows'].append(row)
    return p


def bridge(six):
    od, oc, pd, pc, cd, cc = six
    return cd - cc - od + oc - pd + pc


def judge(folder, sid):
    run = json.loads((folder / f'{sid}-scope.json').read_text(encoding='utf-8'))
    if not isinstance(run, dict) or sorted(run) != sorted(SCOPE_FIELDS) \
            or not all(isinstance(v, str) and text(v) == v for v in run.values()) \
            or run['Currency'] not in DECIMALS or run['Currency basis'] != 'functional' \
            or run['Posting status'] != 'posted' or real_date(run['Period start']) is None \
            or real_date(run['Period end']) is None or run['Period start'] > run['Period end']:
        return {'refused': 'SCOPE'}
    decimals = DECIMALS[run['Currency']]
    try:
        gl_rows, tb_rows = records(folder / f'{sid}-gl.csv'), records(folder / f'{sid}-tb.csv')
    except Refused as e:
        return {'refused': str(e)}
    sections, gl_strays = blocks(gl_rows, 'Section', 'End section')
    pages, tb_strays = blocks(tb_rows, 'Page', 'End page')
    sections = [judge_section(b, run, decimals) for b in sections]
    pages = [judge_page(b, run, decimals) for b in pages]

    run_codes, unplaced, by_code = set(), [], []
    for n in gl_strays:
        run_codes.add('STRAY_ROW')
        unplaced.append(('gl', n, ['STRAY_ROW']))
    for n in tb_strays:
        run_codes.add('STRAY_ROW')
        unplaced.append(('tb', n, ['STRAY_ROW']))

    held, gl, tb = {}, {}, {}
    hold = lambda key, code: held.setdefault(key, set()).add(code)
    live = [s for s in sections if not s['excluded']]
    for s in live:
        if s['account'] is None:
            run_codes.add('SECTION_UNREADABLE')
            unplaced.append(('gl', s['row'], ['SECTION_UNREADABLE']))
        elif s['dims'] is None:
            by_code.append(s['account'])
            unplaced.append(('gl', s['row'], ['SECTION_HEADER']))
        else:
            key = (s['account'], s['dims'])
            gl.setdefault(key, []).append(s)
            for code in s['codes']:
                hold(key, code)
    ids = Counter(s['id'] for s in live if s['id'] is not None)
    for key, found in gl.items():
        if len(found) > 1 or any(ids[s['id']] > 1 for s in found if s['id'] is not None):
            hold(key, 'SECTION_DUPLICATE')

    rows = []
    for p in pages:
        if p['unreadable']:
            run_codes.add('PAGE_UNREADABLE')
            unplaced.append(('tb', p['row'], ['PAGE_UNREADABLE']))
        elif not p['excluded']:
            rows.extend(p['rows'])
    accounts = [r for r in rows if r['kind'] == 'account']
    for r in rows:
        if r['kind'] is None:
            run_codes.add('ROW_UNREADABLE')
            unplaced.append(('tb', r['row'], ['ROW_UNREADABLE']))
    for r in accounts:
        key = (r['account'], r['dims'])
        tb.setdefault(key, []).append(r)
        if not r['fieldOk']:
            hold(key, 'ROW_FIELD')
        if None in r['six']:
            hold(key, 'AMOUNT')
    for key, found in tb.items():
        if len(found) > 1:
            hold(key, 'TB_CONFLICT')
    orphans = []
    for t in (r for r in rows if r['kind'] == 'total'):
        children = [r for r in accounts if r['parent'] == t['account'] and r['dims'] == t['dims']]
        if not children:
            orphans.append(f"{t['account']}|{t['dims']}")
            continue
        if not t['fieldOk'] or None in t['six'] or any(None in r['six'] for r in children):
            code = 'TOTAL_FIELD'
        elif any(t['six'][i] != sum(r['six'][i] for r in children) for i in range(6)):
            code = 'TOTAL_MISMATCH'
        else:
            continue
        for r in children:
            hold((r['account'], r['dims']), code)

    keys = set(gl) | set(tb)
    for key in keys:
        if key[0] in by_code:
            hold(key, 'SECTION_HEADER')
        for code in run_codes:
            hold(key, code)
    out = {}
    for key in sorted(keys):
        codes = sorted(held.get(key, set()) & BLOCKING)
        if codes:
            out['|'.join(key)] = {'status': 'held', 'codes': codes, 'gl': None, 'tb': None}
            continue
        s, r = (gl.get(key) or [None])[0], (tb.get(key) or [None])[0]
        missing = (['GL_SECTION_ABSENT'] if s is None else s['missing']) + ([] if r else ['TB_ROW_ABSENT'])
        g, t = (s or {}).get('six'), (r or {}).get('six')
        if missing:
            status, codes = 'missing', sorted(missing)
        elif bridge(g) or bridge(t):
            status, codes = 'inconsistent', [c for c, v in (('GL_BRIDGE', g), ('TB_BRIDGE', t)) if bridge(v)]
        elif g != t:
            status, codes = 'difference', sorted(SIX[i] for i in range(6) if g[i] != t[i])
        else:
            status, codes = 'consistent', []
        out['|'.join(key)] = {'status': status, 'codes': codes, 'gl': g, 'tb': t}
    return {
        'accounts': out,
        'excludedSections': sorted(s['id'] for s in sections if s['excluded']),
        'excludedPages': sorted(p['id'] for p in pages if p['excluded']),
        'orphanTotals': sorted(orphans),
        'unplaced': [[f, f'row {n}', c] for f, n, c in sorted(unplaced)],
        'run': sorted(run_codes),
    }


def run(folder):
    folder = Path(folder)
    ids = sorted(p.name[:-len('-scope.json')] for p in folder.glob('*-scope.json'))
    return {'schema': 'tarasuf-glt1-sections-expected/1', 'stories': {sid: judge(folder, sid) for sid in ids}}


if __name__ == '__main__':
    sys.stdout.write(json.dumps(run(sys.argv[1]), ensure_ascii=False, indent=1) + '\n')
