"""WF-1 MAP-1 foundation oracle: what a column map, a choice by hand and the
declared reading make of each cashbook, from the files and the contract
alone.

  python3 -B audit/bank-map-foundation/oracle.py [--frozen frozen] [--write]

It checks map files and choices by hand by contract.json, decides whether a
map fits a file, and reads the cashbook with the mapped columns. An XLSX
file is read cell by cell as the product's reader records it, by the
pre-seal cashbook check of the bank statement eligibility tool
(audit/bank-statement-eligibility/cashbook.py, read_workbook and
issues_of), which reads the ZIP and XML itself; a CSV file by a port of the
product's delimiter choice. The entries read are written back as a declared
cashbook and the period is settled by the sealed ROLL-1 oracle
(audit/bank-roll-foundation/oracle.py, period_result) on the statement facts
sealed with the period. It never reads a story's recipe or intent and
imports neither the generator nor the product.
"""
import argparse
import csv
import datetime
import hashlib
import importlib.util
import io
import json
import os
import re
import sys
import unicodedata
from pathlib import Path

HERE = Path(__file__).resolve().parent
# Where the sealed packages are, and the tools this oracle stands on; the
# planted faults of mutate_oracle.py run a copy of this file elsewhere and
# name them by these variables.
AUDIT = Path(os.environ.get('MAP_AUDIT', HERE.parent))
ELIGIBILITY = Path(os.environ.get('MAP_ELIGIBILITY', AUDIT / 'bank-statement-eligibility'))
ROLL = Path(os.environ.get('ROLL_FOUNDATION', AUDIT / 'bank-roll-foundation'))
CONTRACT_PATH = Path(os.environ.get('MAP_CONTRACT', HERE / 'contract.json'))


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


cells = load('map_eligibility_cashbook', ELIGIBILITY / 'cashbook.py')
roll = load('map_roll_oracle', ROLL / 'oracle.py')

CONTRACT = json.loads(CONTRACT_PATH.read_text(encoding='utf-8'))
ROLES = CONTRACT['roles']['order']
REQUIRED = set(CONTRACT['roles']['required'])
DECLARED = CONTRACT['declared']['headers']
FORM = CONTRACT['map']['form']
TOP_KEYS = set(FORM)
CODES = [rule.split(':', 1)[0] for rule in CONTRACT['map']['valid']]
assert CODES == ['MAP_JSON', 'MAP_FORMAT', 'MAP_KEYS', 'MAP_NAME', 'MAP_HEADER', 'MAP_COLUMN', 'MAP_LABEL']
MAX_BYTES, MAX_NAME, MAX_LABEL, MAX_HEADER, MAX_COLUMN = 16384, 80, 120, 30, 100
# JavaScript's \s, which the contract names for white space.
SPACE = '\t\n\x0b\x0c\r \xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'
SPACE_RUN = re.compile(f'[{SPACE}]+')
EDGES = re.compile(f'^[{SPACE}]+|[{SPACE}]+$')
CONTROL = re.compile('[\x00-\x08\x0e-\x1f\x7f]')
STORAGE = 'bank-cashbook'


class MapRefused(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


class Misfit(Exception):
    def __init__(self, problems):
        super().__init__(problems)
        self.problems = problems


def sha(data):
    return hashlib.sha256(data).hexdigest()


def normal(s):
    return SPACE_RUN.sub(' ', unicodedata.normalize('NFC', s)).strip(' ')


def trim(s):
    """String.prototype.trim."""
    return EDGES.sub('', s)


def units(s):
    return len(s.encode('utf-16-le')) // 2


def number(v):
    return type(v) in (int, float)


def integer(v):
    return number(v) and float(v).is_integer()


def a1(r, c):
    s = ''
    while c:
        c, k = divmod(c - 1, 26)
        s = chr(65 + k) + s
    return f'{s}{r}'


# ---- maps -----------------------------------------------------------------

def text_ok(v, limit):
    return isinstance(v, str) and normal(v) == v and 0 < units(v) <= limit and not CONTROL.search(v)


def check_columns(columns):
    used = []
    for role in ROLES:
        entry = columns[role]
        column = entry if not isinstance(entry, dict) else entry['column']
        if entry is None:
            if role in REQUIRED:
                raise MapRefused('MAP_COLUMN')
            continue
        if not integer(column) or not 1 <= column <= MAX_COLUMN:
            raise MapRefused('MAP_COLUMN')
        used.append(int(column))
    if len(set(used)) != len(used):
        raise MapRefused('MAP_COLUMN')


def validate(obj):
    """A parsed map, by the contract's rules in order; the canonical map."""
    if not isinstance(obj, dict):
        raise MapRefused('MAP_JSON')
    if obj.get('format') != FORM['format'] or not (number(obj.get('version')) and obj['version'] == FORM['version']) \
            or obj.get('role') != FORM['role']:
        raise MapRefused('MAP_FORMAT')
    columns = obj.get('columns')
    if set(obj) != TOP_KEYS or not isinstance(columns, dict) or set(columns) != set(ROLES) or any(
            v is not None and (not isinstance(v, dict) or set(v) != {'column', 'label'}) for v in columns.values()):
        raise MapRefused('MAP_KEYS')
    if not text_ok(obj['name'], MAX_NAME):
        raise MapRefused('MAP_NAME')
    if not integer(obj['header']) or not 1 <= obj['header'] <= MAX_HEADER:
        raise MapRefused('MAP_HEADER')
    check_columns(columns)
    for v in columns.values():
        if v is not None and not text_ok(v['label'], MAX_LABEL):
            raise MapRefused('MAP_LABEL')
    return {'format': FORM['format'], 'version': FORM['version'], 'role': FORM['role'], 'name': obj['name'],
            'header': int(obj['header']),
            'columns': {r: None if columns[r] is None else {'column': int(columns[r]['column']),
                                                             'label': columns[r]['label']} for r in ROLES}}


def no_constant(token):
    raise ValueError(token)


def parse_map(data):
    """A map file's bytes, read as TextDecoder (a leading BOM dropped) and
    JSON.parse read them."""
    if len(data) > MAX_BYTES:
        raise MapRefused('MAP_JSON')
    try:
        text = data.decode('utf-8')
        if text.startswith('\ufeff'):
            text = text[1:]
        obj = json.loads(text, parse_constant=no_constant)
    except (UnicodeDecodeError, ValueError):
        raise MapRefused('MAP_JSON')
    return validate(obj)


# ---- tables ---------------------------------------------------------------

def parse_csv(text):
    """lib/reconciliation/io.ts parseCSV: the delimiter of ',', ';' and tab
    that splits most of the first twenty non-empty rows, rows as written."""
    text = text[1:] if text.startswith('\ufeff') else text

    def tokenize(d):
        rows, row, cell, quoted, after = [], [], '', False, False
        i = 0
        while i < len(text):
            c = text[i]
            if quoted:
                if c == '"':
                    if text[i + 1:i + 2] == '"':
                        cell += '"'
                        i += 1
                    else:
                        quoted, after = False, True
                else:
                    cell += c
            elif c == '"':
                if cell or after:
                    raise ValueError('quote')
                quoted = True
            elif c == d:
                row.append(cell)
                cell, after = '', False
            elif c in '\r\n':
                if c == '\r' and text[i + 1:i + 2] == '\n':
                    i += 1
                row.append(cell)
                rows.append(row)
                row, cell, after = [], '', False
            else:
                if after:
                    raise ValueError('after quote')
                cell += c
            i += 1
        if quoted:
            raise ValueError('open quote')
        if cell or row or after:
            row.append(cell)
            rows.append(row)
        return rows
    scored = []
    for d in [',', ';', '\t']:
        try:
            rows = tokenize(d)
            scored.append((sum(1 for r in [r for r in rows[:20] if any(r)] if len(r) > 1), rows))
        except ValueError:
            scored.append((-1, []))
    ranked = sorted(scored, key=lambda s: -s[0])
    if ranked[0][0] <= 0 or ranked[1][0] == ranked[0][0]:
        raise ValueError('no delimiter')
    return ranked[0][1]


def read_table(path):
    """{'sheets', 'rows', 'width', 'hidden', 'cell'(r, c) -> (issues, reference
    issues, text, kind)} for the first and only sheet."""
    path = Path(path)
    if path.suffix.lower() == '.csv':
        rows = parse_csv(path.read_bytes().decode('utf-8'))
        width = max((len(r) for r in rows), default=0)

        def cell(r, c):
            row = rows[r - 1] if r <= len(rows) else []
            return [], [], row[c - 1] if c <= len(row) else '', 'string'
        return {'sheets': 1, 'rows': len(rows), 'width': width, 'hidden': False, 'cell': cell}
    book = cells.read_workbook(path)
    if book['sheets'] != 1:
        return {'sheets': book['sheets']}
    grid = {}

    def cell(r, c):
        if (r, c) not in grid:
            grid[(r, c)] = cells.issues_of(book, r, c) if r <= book['rows'] and c <= book['columns'] \
                else ([], [], '', 'null')
        return grid[(r, c)]
    return {'sheets': 1, 'rows': book['rows'], 'width': book['columns'], 'hidden': book['sheet']['hidden'],
            'cell': cell}


def text_at(table, r, c):
    return table['cell'](r, c)[2]


# ---- fit and choice by hand -----------------------------------------------

def file_problems(table, header):
    if table['sheets'] != 1:
        return [{'kind': 'sheets', 'count': table['sheets']}]
    if header > table['rows']:
        return [{'kind': 'header-row', 'row': header}]
    return []


def fit(table, m):
    problems = file_problems(table, m['header'])
    if problems:
        return problems
    for role in ROLES:
        entry = m['columns'][role]
        if entry is None:
            continue
        found = normal(text_at(table, m['header'], entry['column']))
        if found != entry['label']:
            elsewhere = [a1(r, c) for r in range(1, min(MAX_HEADER, table['rows']) + 1)
                         for c in range(1, table['width'] + 1) if normal(text_at(table, r, c)) == entry['label']]
            problems.append({'kind': 'column', 'role': role, 'column': entry['column'], 'label': entry['label'],
                             'found': found, 'elsewhere': elsewhere})
    return problems


def by_hand(table, header, columns, name):
    """The map a choice by hand stands for; MapRefused or Misfit if none."""
    if not integer(header) or not 1 <= header <= MAX_HEADER:
        raise MapRefused('MAP_HEADER')
    check_columns(columns)
    problems = file_problems(table, header)
    if problems:
        raise Misfit(problems)
    out = {}
    for role in ROLES:
        if columns[role] is None:
            out[role] = None
            continue
        label = normal(text_at(table, header, columns[role]))
        if not text_ok(label, MAX_LABEL):
            raise MapRefused('MAP_LABEL')
        out[role] = {'column': columns[role], 'label': label}
    return {'format': FORM['format'], 'version': FORM['version'], 'role': FORM['role'], 'name': name,
            'header': header, 'columns': out}


# ---- reading --------------------------------------------------------------

class Refused(Exception):
    def __init__(self, code, row):
        super().__init__(code, row)
        self.code, self.row = code, row


def read(table, header, columns, decimals, declared=False):
    """The cashbook read with columns {role: column or None} under the header
    row; the declared reading when declared."""
    labels = {c: normal(text_at(table, header, c)) for c in range(1, table['width'] + 1)}
    mapped = {role: c for role, c in columns.items() if c is not None}
    unread = [] if declared else [{'column': c, 'label': labels[c]} for c in sorted(labels)
                                  if labels[c] and c not in mapped.values()]
    out = {'header': header, 'above': header - 1, 'unread': unread, 'refused': None, 'entries': []}
    try:
        if decimals is None:
            raise Refused('SCOPE', 0)

        def recorded(at):
            if table['hidden']:
                raise Refused('SHEET', at)
            for role, c in mapped.items():
                issues, reference, _, _ = table['cell'](at, c)
                found = issues + (reference if role in ('voucher', 'reference') else [])
                if role in ('receipts', 'payments'):
                    found = [i for i in found if i != cells.PRECISION_NOTE]
                if found:
                    raise Refused('CELL', at)
        recorded(header)
        money = re.compile(rf'(\d+)\.(\d{{{decimals}}})' if decimals else r'(\d+)')
        typed = re.compile(rf'(\d+)(?:\.(\d{{1,{decimals}}}))?' if decimals else r'(\d+)')
        vouchers = set()
        for at in range(header + 1, table['rows'] + 1):
            recorded(at)
            for c in range(1, table['width'] + 1):
                outside = c > len(DECLARED) if declared else not labels.get(c)
                if outside and trim(text_at(table, at, c)):
                    raise Refused('COLUMN', at)
            texts = {role: trim(text_at(table, at, mapped[role])) if role in mapped else '' for role in ROLES}
            if not any(texts.values()):
                raise Refused('ROW', at)

            def amount(role):
                s = texts[role]
                if not s:
                    return 0
                kind = table['cell'](at, mapped[role])[3]
                m = (typed if kind == 'number' else money).fullmatch(s)
                if not m:
                    raise Refused('AMOUNT', at)
                return int(m.group(1) + (m.group(2) or '').ljust(decimals, '0'))
            receipt, payment = amount('receipts'), amount('payments')
            if (receipt > 0) == (payment > 0):
                raise Refused('AMOUNT', at)
            voucher = texts['voucher']
            if not voucher or voucher in vouchers:
                raise Refused('VOUCHER', at)
            vouchers.add(voucher)
            d = re.fullmatch(r'(\d{4})-(\d{2})-(\d{2})', texts['date'])
            try:
                ok = d is not None and datetime.date(int(d[1]), int(d[2]), int(d[3])).isoformat() == texts['date']
            except ValueError:
                ok = False
            if not ok:
                raise Refused('DATE', at)
            out['entries'].append({'voucher': voucher, 'row': at, 'date': texts['date'],
                                   'description': texts['description'], 'reference': texts['reference'],
                                   'direction': 'in' if receipt else 'out', 'amount': receipt or payment})
    except Refused as e:
        out.update(refused={'code': e.code, 'row': e.row}, entries=[])
    return out


def declared_reading(table, decimals):
    """readBankCashbookTable: one sheet whose first row is the declared
    headers in order and no wider."""
    if table['sheets'] != 1 or table['width'] != len(DECLARED) or \
            [trim(text_at(table, 1, c)) for c in range(1, len(DECLARED) + 1)] != DECLARED:
        return {'header': 1, 'above': 0, 'unread': [], 'refused': {'code': 'HEADER', 'row': 1}, 'entries': []}
    return read(table, 1, {r: k + 1 for k, r in enumerate(ROLES)}, decimals, declared=True)


# ---- the period -----------------------------------------------------------

def period_facts(action):
    facts = json.loads((AUDIT / action['source'] / 'frozen' / 'stories.json').read_text(encoding='utf-8'))
    found = [p for s in facts['stories'] for p in s['periods'] if p['id'] == action['period']]
    assert len(found) == 1, action['period']
    return found[0]


def major(m):
    return f'{m // 100}.{m % 100:02d}'


def settle(action, entries, cash_bytes, window):
    """The period as the lifecycle settles it on these entries, written as
    the declared cashbook they stand for."""
    out = io.StringIO()
    w = csv.writer(out, lineterminator='\r\n')
    w.writerow(DECLARED)
    for e in entries:
        w.writerow([e['date'], e['voucher'], e['description'], e['reference'],
                    major(e['amount']) if e['direction'] == 'in' else '',
                    major(e['amount']) if e['direction'] == 'out' else ''])
    statement = (AUDIT / action['source'] / 'frozen' / f"{action['period']}-statement.pdf").read_bytes()
    r = roll.period_result(period_facts(action), out.getvalue().encode('utf-8'), sha(statement), sha(cash_bytes),
                           [], window)
    return {'held': r['held'],
            'cases': [{k: c[k] for k in ('id', 'kind', 'reason', 'statement', 'cashbook', 'status')}
                      for c in r['cases']],
            'outstanding': [list(o) for o in r['outstanding']]}


def decimals_of(action):
    currency = period_facts(action)['statement']['currency']
    return cells.DECIMALS.get(currency)


# ---- stories --------------------------------------------------------------

def judge(story, frozen, window):
    store = {}
    outcomes = []
    for action in story['actions']:
        out = {'do': action['do']}
        if action['do'] == 'import':
            try:
                m = parse_map((frozen / action['file']).read_bytes())
                store[(m['role'], m['name'])] = m
                out['accepted'] = True
            except MapRefused as e:
                out.update(accepted=False, code=e.code)
        elif action['do'] == 'export':
            out['map'] = store.get((STORAGE, action['map']))
        else:
            out['by'] = action['by']
            path = (AUDIT / action['source'] / 'frozen' / action['file']) if action.get('twin') \
                else frozen / action['file']
            table = read_table(path)
            decimals = decimals_of(action)
            reading = None
            if action['by'] == 'declared':
                reading = declared_reading(table, decimals)
            else:
                try:
                    if action['by'] == 'hand':
                        m = by_hand(table, action['header'], action['columns'], action.get('save'))
                        problems = []
                    else:
                        m = store.get((STORAGE, action['map']))
                        if m is None:
                            raise MapRefused('MAP_MISSING')
                        problems = fit(table, m)
                    if problems:
                        raise Misfit(problems)
                    out['fit'] = {'fits': True, 'problems': []}
                    reading = read(table, m['header'], {r: (m['columns'][r] or {}).get('column') for r in ROLES},
                                   decimals)
                    if action['by'] == 'hand' and action.get('save'):
                        if not text_ok(action['save'], MAX_NAME):
                            raise MapRefused('MAP_NAME')
                        store[(STORAGE, action['save'])] = m
                        out['saved'] = action['save']
                except MapRefused as e:
                    out['invalid'] = e.code
                except Misfit as e:
                    out['fit'] = {'fits': False, 'problems': e.problems}
            if reading is not None:
                out['reading'] = reading
                if reading['refused'] is None:
                    out['period'] = settle(action, reading['entries'], path.read_bytes(), window)
        out['store'] = sorted(name for _, name in store)
        outcomes.append(out)
    return outcomes


def run(frozen, facts_path):
    facts = json.loads(Path(facts_path).read_text(encoding='utf-8'))
    window = json.loads((roll.BANK / 'contract.json').read_text())['matching']['dateWindowDays']
    return {'version': 'bank-map-foundation-oracle-1',
            'stories': {s['id']: judge(s, Path(frozen), window) for s in facts['stories']}}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--frozen', default=str(HERE / 'frozen'))
    ap.add_argument('--facts')
    ap.add_argument('--write', action='store_true')
    a = ap.parse_args()
    result = run(a.frozen, a.facts or Path(a.frozen) / 'stories.json')
    text = json.dumps(result, ensure_ascii=False, indent=1, sort_keys=True) + '\n'
    if a.write:
        (Path(a.frozen) / 'EXPECTED.json').write_text(text, encoding='utf-8')
    sys.stdout.write(text)


if __name__ == '__main__':
    main()
