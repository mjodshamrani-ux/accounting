"""Independent check of a bank statement workbook with a declared tolerance
(proposed bank-tolerance-1), or without one. Standard library only.

  python3 -B audit/bank-tolerance-foundation/check_export.py < request.json

  request: {"frozen": path, "selfTest": [labels],
            "exports": [{"label", "story", "path", "language" or null}]}

Each workbook is read from its OOXML parts directly, never by the product,
and held against the sealed package (stories.json, EXPECTED.json, the frozen
files) and the bank statement foundation's matching window, never against
the product's own output. language is that of the reconciliation sheet, or
null for a workbook of the period alone.

- the Cases sheet holds the expected cases, each with its kind, reason,
  status and exact members;
- with a policy, the Tolerance sheet names it (perItem, perPeriod, note), the
  number of eligible pairs, the sum of their absolute differences and the
  outcome; the Tolerance pairs sheet lists every eligible pair, worked out
  here from the printed facts and the cashbook file by the contract's rule,
  with its members, direction, both amounts, its difference, whether it was
  tolerated and its case status. Without a policy neither sheet exists, and
  the Summary claim says nothing of a tolerance;
- the reconciliation sheet, first, in its language, has its status and, with
  a policy only, the policy row, the tolerated total, each tolerated
  difference with its members, both amounts and its effect, and the
  unexplained rest, as EXPECTED.json has them and as its own cells add up;
- the statement and cashbook reassembled from the Sources sheet are the
  sealed files, byte for byte.

selfTest names exports whose parsed workbooks are then altered; each
alteration must be caught wherever it applies, and each must apply somewhere,
or the checker itself has failed.
"""
import base64
import copy
import csv
import io
import json
import re
import sys
import zipfile
from datetime import date
from decimal import Decimal
from pathlib import Path
from xml.etree import ElementTree

HERE = Path(__file__).resolve().parent
M = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
P = 'http://schemas.openxmlformats.org/package/2006/relationships'
WINDOW = json.loads((HERE.parent / 'bank-statement-foundation' / 'contract.json').read_text(encoding='utf-8'))[
    'matching']['dateWindowDays']
# The sealed oracle's exponents (oracle.EXPONENT); the yen since the T4
# holdout, whose yen period without a policy is exported.
DECIMALS = {'SAR': 2, 'KWD': 3, 'JPY': 0}
NAMES = {'ar': 'التسوية', 'en': 'Reconciliation'}
ARABIC = re.compile('[؀-ۿ]')
# The product names two statuses as the sealed oracle does not.
STATUS = {'matched-automatic': 'matched', 'matched-accepted': 'accepted'}
TOLERANCE_KEYS = ['tolerance', 'toleratedHeaders', 'tolerated', 'toleratedItem', 'unexplained']


class CheckError(Exception):
    pass


def need(ok, what):
    if not ok:
        raise CheckError(what)


def xstring(text):
    """OOXML ST_Xstring: _xHHHH_ stands for that character."""
    return re.sub(r'_x([0-9A-Fa-f]{4})_', lambda m: chr(int(m.group(1), 16)), text)


def workbook(data):
    """Every sheet in order: its name, whether it reads right to left,
    whether a cell holds a formula, and its rows of strings."""
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        book = ElementTree.fromstring(z.read('xl/workbook.xml'))
        rels = {r.get('Id'): r.get('Target') for r in
                ElementTree.fromstring(z.read('xl/_rels/workbook.xml.rels')).iter(f'{{{P}}}Relationship')}
        shared = []
        if 'xl/sharedStrings.xml' in z.namelist():
            for si in ElementTree.fromstring(z.read('xl/sharedStrings.xml')).findall(f'{{{M}}}si'):
                shared.append(xstring(''.join(t.text or '' for t in si.iter(f'{{{M}}}t'))))
        sheets = []
        for s in book.find(f'{{{M}}}sheets').findall(f'{{{M}}}sheet'):
            target = rels[s.get(f'{{{R}}}id')].lstrip('/')
            sheet = ElementTree.fromstring(z.read(target if target.startswith('xl/') else f'xl/{target}'))
            views = sheet.find(f'{{{M}}}sheetViews')
            rows = []
            for row in sheet.find(f'{{{M}}}sheetData').findall(f'{{{M}}}row'):
                need(int(row.get('r')) == len(rows) + 1, f"{s.get('name')}: a row is missing")
                cells = {}
                for c in row.findall(f'{{{M}}}c'):
                    col = 0
                    for ch in c.get('r'):
                        if ch.isalpha():
                            col = col * 26 + ord(ch.upper()) - 64
                    kind, v = c.get('t'), c.find(f'{{{M}}}v')
                    if kind == 's':
                        cells[col] = shared[int(v.text)]
                    elif kind == 'inlineStr':
                        cells[col] = xstring(''.join(t.text or '' for t in c.iter(f'{{{M}}}t')))
                    else:
                        cells[col] = v.text if v is not None and v.text is not None else ''
                rows.append([cells.get(i, '') for i in range(1, (max(cells) if cells else 0) + 1)])
            sheets.append({'name': s.get('name'),
                           'rtl': views is not None and any(v.get('rightToLeft') in ('1', 'true') for v in views),
                           'formula': sheet.find(f'.//{{{M}}}f') is not None, 'rows': rows})
        return sheets


def cell(row, col):
    return row[col - 1] if len(row) >= col else ''


def integer(text, what):
    need(re.fullmatch(r'-?\d+', text or '') is not None, f'{what}: {text!r} is not an integer')
    return int(text)


def major(minor, decimals):
    sign = '-' if minor < 0 else ''
    digits = str(abs(minor)).rjust(decimals + 1, '0')
    return f'{sign}{digits[:-decimals]}.{digits[-decimals:]}' if decimals else f'{sign}{digits}'


def money(row, col, what, minor, decimals):
    """Columns col (text in major units) and col + 1 (integer) hold this amount."""
    need(integer(cell(row, col + 1), what) == minor, f'{what}: {cell(row, col + 1)} != {minor}')
    need(cell(row, col) == major(minor, decimals), f'{what}: text {cell(row, col)!r} != {major(minor, decimals)!r}')


def table(sheets, name):
    found = [s for s in sheets if s['name'] == name]
    return found[0]['rows'] if found else None


# ---- what the sealed package lets this checker work out ---------------------

def eligible(story, want, frozen, policy):
    """Every pair the contract makes eligible, in case order: an
    amount-difference case of one movement and one entry, dates within the
    window, absolute difference at most perItem. From the printed facts and
    the cashbook file."""
    period = story['periods'][0]
    exponent = DECIMALS[period['statement']['currency']]
    moves = {l['key']: l for p in period['statement']['pages'] for l in p['lines'] if l['kind'] == 'movement'}
    rows = list(csv.reader(io.StringIO((frozen / f"{period['id']}-cashbook.csv").read_bytes().decode('utf-8'))))
    entries = {}
    for r in rows[1:]:
        receipt, payment = (Decimal(x) * 10 ** exponent if x.strip() else Decimal(0) for x in (r[4], r[5]))
        entries[r[1]] = {'date': r[0], 'direction': 'in' if receipt else 'out', 'amount': int(receipt or payment)}
    out = []
    for c in want['cases']:
        if c['reason'] not in ('amount-difference', 'within-tolerance') or len(c['statement']) + len(c['cashbook']) != 2:
            continue
        m, e = moves[c['statement'][0]], entries[c['cashbook'][0]]
        amount = m['withdrawal'] or m['deposit']
        gap = abs((date.fromisoformat(m['date']) - date.fromisoformat(e['date'])).days)
        if gap <= WINDOW and abs(amount - e['amount']) <= policy['perItem']:
            out.append({'case': c['id'], 'statement': m['key'], 'cashbook': c['cashbook'][0],
                        'direction': e['direction'], 'amounts': [amount, e['amount'], amount - e['amount']],
                        'status': c['status']})
    return out


def policy_of(story):
    found = [a['policy'] for a in story['actions'] if 'policy' in a]
    return found[-1] if found else None


# ---- the check --------------------------------------------------------------

def check(sheets, case, story, want, frozen):
    policy = policy_of(story)
    period = story['periods'][0]
    decimals = DECIMALS[period['statement']['currency']]
    names = [s['name'] for s in sheets]
    # Cases.
    cases = table(sheets, 'Cases')
    need(cases is not None and cases[0][:8] == ['Case ID', 'Kind', 'Reason', 'Reference', 'Status', 'Decision',
                                                'Statement IDs', 'Cashbook IDs'], 'the Cases sheet')
    got = [[cell(r, 1), cell(r, 2), cell(r, 3), STATUS.get(cell(r, 5), cell(r, 5)), cell(r, 7).split(),
            cell(r, 8).split()] for r in cases[1:]]
    need(got == [[c['id'], c['kind'], c['reason'], c['status'], c['statement'], c['cashbook']] for c in want['cases']],
         'the cases differ from the expectation')
    # Sources.
    sources = table(sheets, 'Sources')
    need(sources is not None, 'no Sources sheet')
    for role, name in (('statement', 'statement.pdf'), ('cashbook', 'cashbook.csv')):
        chunks = sorted((integer(cell(r, 4), 'chunk'), cell(r, 5)) for r in sources[1:] if cell(r, 1) == role)
        need([i for i, _ in chunks] == list(range(len(chunks))), f'{role}: chunks out of order')
        data = base64.b64decode(''.join(t for _, t in chunks), validate=True)
        need(data == (frozen / f"{period['id']}-{name}").read_bytes(), f'{role}: not the sealed file')
    # Summary.
    summary = table(sheets, 'Summary')
    claim = [cell(r, 2) for r in summary or [] if cell(r, 1) == 'Claim']
    need(len(claim) == 1, 'no Summary claim')
    need(('tolerance the accountant declared' in claim[0]) == bool(policy), 'the Summary claim and the policy')
    # Tolerance.
    tol, pairs = table(sheets, 'Tolerance'), table(sheets, 'Tolerance pairs')
    if policy is None:
        need(tol is None and pairs is None, 'a tolerance sheet without a policy')
    else:
        need(tol is not None and pairs is not None, 'no tolerance sheets with a policy')
        found = eligible(story, want, frozen, policy)
        total = sum(abs(p['amounts'][2]) for p in found)
        exceeded = want['exceeded']
        need((exceeded is not None) == (total > policy['perPeriod']), 'the expectation and the eligible sum disagree')
        if exceeded:
            need(exceeded == {'sum': total, 'cap': policy['perPeriod']}, 'the exceeded sum')
        props = {cell(r, 1): cell(r, 2) for r in tol[1:]}
        need(len(tol) == 8 and props == {
            'Family': 'bank-tolerance-1', 'Per item minor units': str(policy['perItem']),
            'Per period minor units': str(policy['perPeriod']), 'Note': policy['note'],
            'Eligible pairs': str(len(found)), 'Sum of absolute differences minor units': str(total),
            'Outcome': 'exceeded' if exceeded else 'tolerated'}, f'the Tolerance sheet {props}')
        need(pairs[0] == ['Case ID', 'Statement ID', 'Cashbook ID', 'Direction', 'Statement amount minor units',
                          'Cashbook amount minor units', 'Difference minor units', 'Tolerated', 'Case status'],
             'the Tolerance pairs headers')
        rows = [[cell(r, 1), cell(r, 2), cell(r, 3), cell(r, 4), integer(cell(r, 5), 'amount'),
                 integer(cell(r, 6), 'amount'), integer(cell(r, 7), 'difference'), cell(r, 8),
                 STATUS.get(cell(r, 9), cell(r, 9))] for r in pairs[1:]]
        need(rows == [[p['case'], p['statement'], p['cashbook'], p['direction'], *p['amounts'],
                       'no' if exceeded else 'yes', p['status']] for p in found], 'the Tolerance pairs')
        for r in rows:
            need(r[6] == r[4] - r[5], f'{r[0]}: the difference is not statement minus cashbook')
    # The reconciliation sheet.
    language = case['language']
    if language is None:
        need('Reconciliation' not in names and NAMES['ar'] not in names, 'a reconciliation sheet in a period workbook')
        return
    first = sheets[0]
    need(first['name'] == NAMES[language], f"first sheet {first['name']!r}")
    need(first['rtl'] == (language == 'ar'), 'reading direction')
    need(not first['formula'], 'a formula in the reconciliation sheet')
    rows = first['rows']
    by = {}
    for r in rows:
        by.setdefault(cell(r, 1), []).append(r)
    s = want['sheet']
    need(cell(by['status'][0], 4) == s['status'], f"status {cell(by['status'][0], 4)} != {s['status']}")
    claim = cell(by['claim'][0], 3)
    need(bool(re.search('السماحية' if language == 'ar' else 'tolerance', claim)) == bool(policy), 'the sheet claim')
    if policy is None:
        need(not any(k in by for k in TOLERANCE_KEYS), 'tolerance rows without a policy')
        return
    for key in TOLERANCE_KEYS:
        # Every row but the tolerated items, which a period may not have.
        need(key in by or key == 'toleratedItem', f'no {key} row')
        for r in by.get(key, []):
            label = cell(r, 2)
            need(bool(ARABIC.search(label)) == (language == 'ar'), f'{key}: label {label!r} is not in {language}')
    order = [cell(r, 1) for r in rows]
    need(order.index('difference') < order.index('tolerance') < order.index('tolerated') < order.index('unexplained'),
         'the tolerance rows are out of place')
    p = by['tolerance'][0]
    money(p, 3, 'perItem', policy['perItem'], decimals)
    money(p, 5, 'perPeriod', policy['perPeriod'], decimals)
    need(cell(p, 7) == policy['note'], 'the policy note')
    cases_by = {c['id']: c for c in want['cases']}
    items = by.get('toleratedItem', [])
    need(len(items) == len(s['toleratedDifferences']), f"{len(items)} tolerated rows, {len(s['toleratedDifferences'])} expected")
    effects = 0
    for r, (case_id, effect) in zip(items, s['toleratedDifferences']):
        c = cases_by[case_id]
        a = c['amounts']
        need([cell(r, 3), cell(r, 4), cell(r, 5)] == [case_id, c['statement'][0], c['cashbook'][0]], f'{case_id}: members')
        money(r, 6, f'{case_id} statement', a['statement'], decimals)
        money(r, 8, f'{case_id} cashbook', a['cashbook'], decimals)
        money(r, 10, f'{case_id} effect', effect, decimals)
        need(effect == (a['statement'] - a['cashbook'] if a['direction'] == 'in' else a['cashbook'] - a['statement']),
             f'{case_id}: the effect and the direction')
        effects += integer(cell(r, 11), 'effect')
    money(by['tolerated'][0], 3, 'tolerated', s['tolerated'], decimals)
    money(by['unexplained'][0], 3, 'unexplained', s['unexplained'], decimals)
    # The sheet's own cells, added up.
    need(integer(cell(by['tolerated'][0], 4), 'tolerated') == effects, 'the tolerated total is not the sum of its rows')
    difference = integer(cell(by['difference'][0], 4), 'difference')
    need(integer(cell(by['unexplained'][0], 4), 'unexplained') == difference - effects,
         'the unexplained rest is not the difference less the tolerated total')


def alterations():
    def sheet_named(p, name):
        found = [s for s in p if s['name'] == name]
        return found[0] if found else None

    def at(name, key, col, change, first_sheet=False):
        def apply(p):
            sheets = [p[0]] if first_sheet else [s for s in p if s['name'] == name]
            for s in sheets:
                for r in s['rows'][1:] if not first_sheet else s['rows']:
                    if (key is None or cell(r, 1) == key) and len(r) >= col:
                        r[col - 1] = change(r[col - 1])
                        return True
            return False
        return apply

    def drop(name, key=None, first_sheet=False):
        def apply(p):
            s = p[0] if first_sheet else sheet_named(p, name)
            if s is None:
                return False
            for i, r in enumerate(s['rows'][1:], 1):
                if key is None or cell(r, 1) == key:
                    del s['rows'][i]
                    return True
            return False
        return apply

    def drop_sheet(name):
        def apply(p):
            s = sheet_named(p, name)
            if s is None:
                return False
            p.remove(s)
            return True
        return apply

    def bump(v):
        return str(int(v) + 1)

    def flip_case(p):
        cases = sheet_named(p, 'Cases')
        for r in cases['rows'][1:]:
            if cell(r, 2) == 'tolerated':
                r[1] = 'review'
                return True
        return False

    def relabel(p):
        if p[0]['name'] not in NAMES.values():
            return False
        for r in p[0]['rows']:
            if cell(r, 1) == 'toleratedItem':
                r[1] = 'Payment' if ARABIC.search(r[1]) else 'دفع'
                return True
        return False

    def source_byte(p):
        s = sheet_named(p, 'Sources')
        r = s['rows'][1]
        r[4] = ('B' if r[4][0] != 'B' else 'C') + r[4][1:]
        return True

    def claim(p):
        s = sheet_named(p, 'Summary')
        for r in s['rows']:
            if cell(r, 1) == 'Claim' and 'tolerance the accountant declared' in r[1]:
                r[1] = r[1].split('. A tolerance')[0]
                return True
        return False
    return {
        'pair-dropped': drop('Tolerance pairs'),
        'pair-difference': at('Tolerance pairs', None, 7, bump),
        'pair-tolerated': at('Tolerance pairs', None, 8, lambda v: 'no' if v == 'yes' else 'yes'),
        'pair-status': at('Tolerance pairs', None, 9, lambda v: 'rejected' if v != 'rejected' else 'needs-review'),
        'policy-per-item': at('Tolerance', 'Per item minor units', 2, bump),
        'outcome': at('Tolerance', 'Outcome', 2, lambda v: 'exceeded' if v == 'tolerated' else 'tolerated'),
        'tolerance-sheet-dropped': drop_sheet('Tolerance'),
        'case-kind': flip_case,
        'case-status': at('Cases', None, 5, lambda v: 'matched-tolerated' if v != 'matched-tolerated' else 'rejected'),
        'item-effect': at(None, 'toleratedItem', 11, bump, first_sheet=True),
        'item-dropped': drop(None, 'toleratedItem', first_sheet=True),
        'unexplained': at(None, 'unexplained', 4, bump, first_sheet=True),
        'tolerated-total': at(None, 'tolerated', 4, bump, first_sheet=True),
        'status': at(None, 'status', 4, lambda v: 'reconciled' if v != 'reconciled' else 'reconciled-within-tolerance',
                     first_sheet=True),
        'policy-note': at(None, 'tolerance', 7, lambda v: v + ' (edited)', first_sheet=True),
        'direction-label': relabel,
        'source-byte': source_byte,
        'summary-claim': claim,
    }


def main():
    request = json.load(sys.stdin)
    frozen = Path(request['frozen'])
    facts = json.loads((frozen / 'stories.json').read_text(encoding='utf-8'))
    expected = json.loads((frozen / 'EXPECTED.json').read_text(encoding='utf-8'))['stories']
    stories = {s['id']: s for s in facts['stories']}
    parsed = {}
    for case in request['exports']:
        sheets = workbook(Path(case['path']).read_bytes())
        try:
            check(sheets, case, stories[case['story']], expected[case['story']], frozen)
        except CheckError as error:
            raise CheckError(f"{case['label']}: {error}")
        parsed[case['label']] = (case, sheets)
    report = {'checked': len(parsed), 'selfTest': {}}
    for label in request.get('selfTest', []):
        case, sheets = parsed[label]
        for name, change in alterations().items():
            altered = copy.deepcopy(sheets)
            if not change(altered):
                continue
            try:
                check(altered, case, stories[case['story']], expected[case['story']], frozen)
            except (CheckError, ValueError, KeyError, IndexError):
                report['selfTest'].setdefault(name, []).append(label)
                continue
            raise SystemExit(f'self-test: {name} on {label} was not caught')
    missing = set(alterations()) - set(report['selfTest'])
    if request.get('selfTest') and missing:
        raise SystemExit(f'self-test: never applied {sorted(missing)}')
    print(json.dumps(report, sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except CheckError as error:
        raise SystemExit(f'check failed: {error}')
