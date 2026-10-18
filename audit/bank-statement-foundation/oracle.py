"""Independent oracle for the BNK-PDF-1 foundation. Standard library only.

  node audit/bank-statement-foundation/stories.mjs > stories.json
  python3 oracle.py --frozen frozen --facts stories.json [--write]

Reads three things and nothing else: the printed statement lines in the facts
file (bound to the PDFs by VERIFY.json), the cashbook files under frozen/,
and the policy in contract.json. It never reads a story's `recipe` (how the
pages were made) or `intent` (the designer's expected outcome), and imports
nothing from the generator or the product. Amounts are Decimal.

For each story it proves the statement (page sequence, balance chain,
carried and closing balances, totals), then matches the statement against
the cashbook by the contract: an explicit identical reference first, then
amount, direction and date as review suggestions only, then outstanding
items and timing flags. A statement that is not proven is held whole.
--write stores the result as EXPECTED.json beside the assets.
"""
import argparse
import csv
import io
import json
import zipfile
from datetime import date
from decimal import Decimal
from pathlib import Path
from xml.etree import ElementTree

HERE = Path(__file__).resolve().parent
CENT = Decimal('0.01')


def amount(text):
    """A cashbook or statement-file amount: plain digits with a point, or empty."""
    text = text.strip()
    if not text:
        return Decimal(0)
    value = Decimal(text)
    if value < 0 or value != value.quantize(CENT):
        raise ValueError(f'amount {text!r}')
    return value


def minor(n):
    return (Decimal(n) / 100).quantize(CENT)


def days(a, b):
    return abs((date.fromisoformat(a) - date.fromisoformat(b)).days)


def xlsx_rows(path):
    """First worksheet as rows of strings, from the OOXML parts directly."""
    ns = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
          'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
    rel_ns = '{http://schemas.openxmlformats.org/package/2006/relationships}'
    with zipfile.ZipFile(path) as z:
        book = ElementTree.fromstring(z.read('xl/workbook.xml'))
        first = book.find('m:sheets/m:sheet', ns).get(f"{{{ns['r']}}}id")
        rels = ElementTree.fromstring(z.read('xl/_rels/workbook.xml.rels'))
        target = next(r.get('Target') for r in rels.iter(f'{rel_ns}Relationship') if r.get('Id') == first)
        target = target.lstrip('/')
        sheet = ElementTree.fromstring(z.read(target if target.startswith('xl/') else f'xl/{target}'))
        shared = []
        if 'xl/sharedStrings.xml' in z.namelist():
            for si in ElementTree.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', ns):
                shared.append(''.join(t.text or '' for t in si.iter(f"{{{ns['m']}}}t")))
    rows = []
    for row in sheet.find('m:sheetData', ns).findall('m:row', ns):
        cells = {}
        for c in row.findall('m:c', ns):
            ref = c.get('r')
            col = 0
            for ch in ref:
                if ch.isalpha():
                    col = col * 26 + ord(ch.upper()) - 64
            kind, v = c.get('t'), c.find('m:v', ns)
            if kind == 's':
                text = shared[int(v.text)]
            elif kind == 'inlineStr':
                text = ''.join(t.text or '' for t in c.iter(f"{{{ns['m']}}}t"))
            else:
                text = v.text if v is not None and v.text is not None else ''
            cells[col] = text
        width = max(cells) if cells else 0
        rows.append([cells.get(i, '') for i in range(1, width + 1)])
    return rows


def csv_rows(path):
    with open(path, encoding='utf-8', newline='') as f:
        return list(csv.reader(f))


CASHBOOK_HEADERS = ['Date', 'Voucher', 'Description', 'Reference', 'Receipts', 'Payments']
STATEMENT_HEADERS = ['Date', 'Value Date', 'Description', 'Reference', 'Withdrawal', 'Deposit', 'Balance']


def cashbook(rows):
    if rows[0] != CASHBOOK_HEADERS:
        raise ValueError(f'cashbook headers {rows[0]}')
    out, vouchers = [], set()
    for r in rows[1:]:
        r = r + [''] * (len(CASHBOOK_HEADERS) - len(r))
        d, voucher, _, reference, receipt, payment = r[:6]
        receipt, payment = amount(receipt), amount(payment)
        if (receipt > 0) == (payment > 0) or voucher in vouchers:
            raise ValueError(f'cashbook row {r}')
        vouchers.add(voucher)
        date.fromisoformat(d)
        out.append({'voucher': voucher, 'date': d, 'reference': reference.strip(),
                    'direction': 'in' if receipt else 'out', 'amount': receipt or payment})
    return out


def prove(statement):
    """Statement status from the printed lines alone, with the movements."""
    pages = statement['pages']
    declared = {p['of'] for p in pages}
    numbers = [p['number'] for p in pages]
    movements, kinds = [], {}
    for p in pages:
        for line in p['lines']:
            kinds[line['kind']] = kinds.get(line['kind'], 0) + 1
            if line['kind'] == 'movement':
                movements.append(dict(line, page=p['number']))
    summary = {'printedPages': len(pages), 'movements': len(movements), 'nonMovementLines': dict(sorted(
        (k, v) for k, v in kinds.items() if k != 'movement'))}
    if len(declared) != 1 or numbers != list(range(1, next(iter(declared)) + 1)):
        return dict(summary, statement='incomplete-pages',
                    reason=f'pages {numbers} of {sorted(declared)}'), movements
    running = None
    first_problem = None

    def broken(where):
        nonlocal first_problem
        if first_problem is None:
            first_problem = where
    opening = closing = None
    total_wd = total_dep = Decimal(0)
    for p in pages:
        page_wd = page_dep = Decimal(0)
        for i, line in enumerate(p['lines']):
            kind = line['kind']
            where = f"page {p['number']} line {i + 1} {kind}"
            if i == 0 and kind != ('opening' if p['number'] == 1 else 'brought-forward'):
                broken(f'{where}: page does not start with its carried balance')
            if kind == 'opening':
                if running is not None:
                    broken(where)
                running = opening = minor(line['balance'])
            elif kind in ('brought-forward', 'carried-forward', 'closing'):
                if running is None or minor(line['balance']) != running:
                    broken(where)
                if kind == 'closing':
                    closing = minor(line['balance'])
            elif kind == 'movement':
                wd, dep = minor(line['withdrawal']), minor(line['deposit'])
                if (wd > 0) == (dep > 0) or wd < 0 or dep < 0 or running is None:
                    broken(f'{where}: not one positive withdrawal or deposit')
                    continue
                running += dep - wd
                page_wd += wd
                page_dep += dep
                if minor(line['balance']) != running:
                    broken(f"{where} {line['key']}: printed {minor(line['balance'])} != {running}")
            elif kind == 'page-totals':
                if (minor(line['withdrawal']), minor(line['deposit'])) != (page_wd, page_dep):
                    broken(where)
            elif kind == 'totals':
                if (minor(line['withdrawal']), minor(line['deposit'])) != (total_wd + page_wd, total_dep + page_dep):
                    broken(where)
            elif kind != 'continuation':
                broken(f'{where}: unknown line')
        total_wd += page_wd
        total_dep += page_dep
        last = p['lines'][-1]['kind'] if p['lines'] else None
        if p['number'] < len(pages) and last != 'carried-forward':
            broken(f"page {p['number']}: no carried-forward line")
    if closing is None:
        broken('no closing balance')
    if 'totals' not in kinds:
        broken('no statement totals')
    summary.update(opening=str(opening), closing=str(closing), withdrawals=str(total_wd), deposits=str(total_dep))
    if first_problem:
        return dict(summary, statement='balance-broken', reason=first_problem), movements
    return dict(summary, statement='verified'), movements


def match(movements, entries, window, period):
    bank = [{'id': m['key'], 'date': m['date'], 'valueDate': m['valueDate'], 'reference': m['reference'].strip(),
             'direction': 'out' if m['withdrawal'] else 'in', 'amount': minor(m['withdrawal'] or m['deposit'])}
            for m in movements]
    cash = [dict(e, id=e['voucher']) for e in entries]
    used = set()
    auto, review = [], []
    references = sorted({r['reference'] for r in bank + cash if r['reference']})
    for ref in references:
        b = [r for r in bank if r['reference'] == ref]
        c = [r for r in cash if r['reference'] == ref]
        if not b or not c:
            continue
        if len(b) == 1 and len(c) == 1:
            x, y = b[0], c[0]
            if x['direction'] != y['direction']:
                reason = 'direction-conflict'
            elif x['amount'] != y['amount']:
                reason = 'amount-difference'
            elif days(x['date'], y['date']) > window:
                reason = 'date-gap'
            else:
                reason = None
            if reason:
                review.append({'bank': [x['id']], 'cash': [y['id']], 'reason': reason})
            else:
                auto.append([x['id'], y['id']])
        else:
            review.append({'bank': [r['id'] for r in b], 'cash': [r['id'] for r in c], 'reason': 'duplicate-reference'})
        used.update(('b', r['id']) for r in b)
        used.update(('c', r['id']) for r in c)
    pool_b = [r for r in bank if ('b', r['id']) not in used]
    pool_c = [r for r in cash if ('c', r['id']) not in used]
    edges = {}
    for x in pool_b:
        for y in pool_c:
            if x['direction'] == y['direction'] and x['amount'] == y['amount'] and days(x['date'], y['date']) <= window:
                edges.setdefault(('b', x['id']), set()).add(('c', y['id']))
                edges.setdefault(('c', y['id']), set()).add(('b', x['id']))
    seen = set()
    for start in sorted(edges):
        if start in seen:
            continue
        component, todo = set(), [start]
        while todo:
            node = todo.pop()
            if node in component:
                continue
            component.add(node)
            todo.extend(edges[node] - component)
        seen |= component
        members = {'bank': sorted(i for s, i in component if s == 'b'), 'cash': sorted(i for s, i in component if s == 'c')}
        reason = 'amount-date-suggestion' if len(component) == 2 else 'ambiguous-amount-date'
        review.append(dict(members, reason=reason))
        used |= component
    return {
        'auto': auto,
        'review': review,
        'bankOnly': [r['id'] for r in bank if ('b', r['id']) not in used],
        'cashOnly': [r['id'] for r in cash if ('c', r['id']) not in used],
        'timing': [r['id'] for r in bank if not period['start'] <= r['valueDate'] <= period['end']],
    }


def statement_file_rows(rows):
    """A statement exported as a table: header, an Opening balance row, then
    one row per movement with its running balance."""
    if rows[0] != STATEMENT_HEADERS or rows[1][2] != 'Opening balance':
        raise ValueError('statement file layout')
    out = [('opening', Decimal(rows[1][6]))]
    for r in rows[2:]:
        r = r + [''] * (len(STATEMENT_HEADERS) - len(r))
        out.append((r[0], r[1], r[2], r[3], amount(r[4]), amount(r[5]), Decimal(r[6])))
    return out


def same_story_as_pdf(rows, story):
    """The CSV/XLSX statement tells exactly the printed story: same opening,
    same movements in order with the same running balances."""
    lines = [l for p in story['statement']['pages'] for l in p['lines']]
    opening = [minor(l['balance']) for l in lines if l['kind'] == 'opening']
    printed = [(l['date'], l['valueDate'], l['description'].replace('\n', ' — '), l['reference'],
                minor(l['withdrawal']), minor(l['deposit']), minor(l['balance'])) for l in lines if l['kind'] == 'movement']
    return len(opening) == 1 and rows == [('opening', opening[0])] + printed


def run(frozen, facts_path, contract_path=HERE / 'contract.json', only=None):
    frozen = Path(frozen)
    facts = json.loads(Path(facts_path).read_text(encoding='utf-8'))
    contract = json.loads(Path(contract_path).read_text(encoding='utf-8'))
    window = contract['matching']['dateWindowDays']
    period = facts['period']
    results = []
    for story in facts['stories']:
        if only and story['id'] not in only:
            continue
        status, movements = prove(story['statement'])
        entries = cashbook(csv_rows(frozen / f"{story['id']}-cashbook.csv"))
        keys = {r['voucher']: r['key'] for r in story['cashbook']}
        if sorted(keys) != sorted(e['voucher'] for e in entries):
            raise ValueError(f"{story['id']}: cashbook vouchers differ from the facts")
        result = {'id': story['id'], **status, 'cashbookRows': len(entries),
                  'receipts': str(sum((e['amount'] for e in entries if e['direction'] == 'in'), Decimal(0))),
                  'payments': str(sum((e['amount'] for e in entries if e['direction'] == 'out'), Decimal(0)))}
        if status['statement'] != 'verified':
            result.update(auto=[], review=[], bankOnly=[], cashOnly=[], timing=[],
                          held={'bank': len(movements), 'cash': len(entries)})
        else:
            m = match(movements, entries, window, period)
            ids = lambda xs: [keys[x] for x in xs]  # noqa: E731
            result.update(auto=[[b, keys[c]] for b, c in m['auto']],
                          review=[{'bank': g['bank'], 'cash': ids(g['cash']), 'reason': g['reason']} for g in m['review']],
                          bankOnly=m['bankOnly'], cashOnly=ids(m['cashOnly']), timing=m['timing'])
        if story['id'] == 'BS01':
            cb_csv = csv_rows(frozen / 'BS01-cashbook.csv')
            result['formats'] = {
                'statementCsv': same_story_as_pdf(statement_file_rows(csv_rows(frozen / 'BS01-statement.csv')), story),
                'statementXlsx': same_story_as_pdf(statement_file_rows(xlsx_rows(frozen / 'BS01-statement.xlsx')), story),
                'cashbookXlsx': xlsx_rows(frozen / 'BS01-cashbook.xlsx') == cb_csv,
            }
        results.append(result)
    return {'schema': 'tarasuf-bnk-pdf1-expected/1', 'contract': contract['schema'],
            'dateWindowDays': window, 'period': period, 'stories': results}


def agrees_with_intent(result, story):
    """Compare one oracle result with the designer's hand-written intent."""
    intent = story['intent']
    norm_review = lambda gs: sorted((sorted(g['bank']), sorted(g['cash']), g['reason']) for g in gs)  # noqa: E731
    problems = []
    if result['statement'] != intent['statement']:
        problems.append(('statement', result['statement'], intent['statement']))
    for k in ('bankOnly', 'cashOnly', 'timing'):
        if sorted(result[k]) != sorted(intent[k]):
            problems.append((k, result[k], intent[k]))
    if sorted(map(tuple, result['auto'])) != sorted(map(tuple, intent['auto'])):
        problems.append(('auto', len(result['auto']), len(intent['auto'])))
    if norm_review(result['review']) != norm_review(intent['review']):
        problems.append(('review', result['review'], intent['review']))
    return problems


def dumps(expected):
    head = {k: v for k, v in expected.items() if k != 'stories'}
    body = ',\n'.join(' ' + json.dumps(s, ensure_ascii=False, separators=(',', ':')) for s in expected['stories'])
    return json.dumps(head, ensure_ascii=False)[:-1] + ',"stories":[\n' + body + '\n]}\n'


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--frozen', default=str(HERE / 'frozen'))
    parser.add_argument('--facts', required=True)
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    expected = run(args.frozen, args.facts)
    facts = json.loads(Path(args.facts).read_text(encoding='utf-8'))
    disagreements = {s['id']: agrees_with_intent(r, s) for r, s in zip(expected['stories'], facts['stories'])}
    disagreements = {k: v for k, v in disagreements.items() if v}
    if args.write:
        (Path(args.frozen) / 'EXPECTED.json').write_text(dumps(expected), encoding='utf-8')
    print(json.dumps({'stories': [(r['id'], r['statement'], len(r['auto']), [g['reason'] for g in r['review']],
                                   len(r['bankOnly']), len(r['cashOnly']), len(r['timing'])) for r in expected['stories']],
                      'disagreeWithIntent': disagreements}, ensure_ascii=False, default=str))
    raise SystemExit(1 if disagreements else 0)
