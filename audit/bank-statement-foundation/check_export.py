"""Independent check of BNK-PDF-1 G3 export workbooks. Standard library only.

  python3 -B check_export.py < request.json

  request: {"facts": path, "frozen": path, "selfTest": name,
            "exports": [{"name", "story", "path", "statement", "cashbook",
                         "confirmedClosing", "decisions": [{"id", "type",
                         "bank": [keys], "cash": [keys], "at", "note"}]}]}

Each workbook is read from its OOXML parts directly, never by the product.
The originals are reassembled from its Sources sheet and must be the frozen
files byte for byte. Every statement line must equal the sealed facts (a PDF)
or the statement file parsed here (a table); the cashbook sheet must equal the
cashbook file parsed by oracle.cashbook. Case membership must equal the
oracle's EXPECTED.json in the foundation's keys, the statuses must follow from
the decisions the scenario took (replayed here by the contract's rules), and
every member, outstanding item and timing flag must cite the same page, text
items and values as its statement line or cashbook row.

selfTest names one export whose parsed sheets are then altered in a dozen
ways (a source byte, a reference, a balance, an amount, a status, a member, a
citation, a reason, a context, a completeness claim, a page number, a line);
each alteration must be caught, or the checker itself has failed.
"""
import base64
import copy
import csv
import hashlib
import io
import json
import re
import sys
import unicodedata
import zipfile
from decimal import Decimal
from pathlib import Path
from xml.etree import ElementTree

import oracle

HERE = Path(__file__).resolve().parent
M = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
P = 'http://schemas.openxmlformats.org/package/2006/relationships'
SHEETS = ['Summary', 'Statement lines', 'Pages', 'Cashbook', 'Cases', 'Case members',
          'Outstanding', 'Timing', 'Decisions', 'Decision members', 'Sources']
ACCEPTABLE = {'amount-date-suggestion', 'date-gap'}


class CheckError(Exception):
    pass


def need(ok, what):
    if not ok:
        raise CheckError(what)


def xstring(text):
    """OOXML ST_Xstring: _xHHHH_ stands for that character."""
    return re.sub(r'_x([0-9A-Fa-f]{4})_', lambda m: chr(int(m.group(1), 16)), text)


def workbook(data):
    """Every worksheet by name, as rows of strings."""
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        book = ElementTree.fromstring(z.read('xl/workbook.xml'))
        rels = {r.get('Id'): r.get('Target') for r in
                ElementTree.fromstring(z.read('xl/_rels/workbook.xml.rels')).iter(f'{{{P}}}Relationship')}
        shared = []
        if 'xl/sharedStrings.xml' in z.namelist():
            for si in ElementTree.fromstring(z.read('xl/sharedStrings.xml')).findall(f'{{{M}}}si'):
                shared.append(xstring(''.join(t.text or '' for t in si.iter(f'{{{M}}}t'))))
        out = {}
        for s in book.find(f'{{{M}}}sheets').findall(f'{{{M}}}sheet'):
            target = rels[s.get(f'{{{R}}}id')].lstrip('/')
            sheet = ElementTree.fromstring(z.read(target if target.startswith('xl/') else f'xl/{target}'))
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
            out[s.get('name')] = rows
    return out


def body(sheets, name, width):
    """Data rows of a sheet, padded to its header width."""
    rows = sheets[name]
    need(rows and len(rows[0]) == width, f'{name}: header')
    return [r + [''] * (width - len(r)) for r in rows[1:]]


def integer(text, what):
    need(re.fullmatch(r'-?\d+', text or '') is not None, f'{what}: {text!r} is not an integer')
    return int(text)


def cents(value):
    return int((Decimal(value) * 100).to_integral_value())


def words(s):
    return re.sub(r'\s+', ' ', unicodedata.normalize('NFKC', s)).strip()


def table_rows(name, data):
    if name.lower().endswith('.csv'):
        return list(csv.reader(io.StringIO(data.decode('utf-8'), newline='')))
    return oracle.xlsx_rows(io.BytesIO(data))


def check(sheets, case, facts, expected, manifest, frozen):
    story = next(s for s in facts['stories'] if s['id'] == case['story'])
    want = next(s for s in expected['stories'] if s['id'] == case['story'])
    need(list(sheets) == SHEETS, f'sheets {list(sheets)}')
    pdf = case['statement'].lower().endswith('.pdf')

    # The originals, reassembled and compared with the frozen files.
    hashes = {e['file']: e['sha256'] for e in manifest['files']}
    chunks = {}
    for role, name, sha, index, data in body(sheets, 'Sources', 5):
        chunks.setdefault(role, []).append((integer(index, 'chunk'), name, sha, data))
    need(sorted(chunks) == ['cashbook', 'statement'], 'source roles')
    originals = {}
    for role, file in (('statement', case['statement']), ('cashbook', case['cashbook'])):
        parts = sorted(chunks[role])
        need([p[0] for p in parts] == list(range(len(parts))), f'{role}: chunk sequence')
        need({(p[1], p[2]) for p in parts} == {(file, hashes[file])}, f'{role}: name or fingerprint')
        data = base64.b64decode(''.join(p[3] for p in parts), validate=True)
        need(hashlib.sha256(data).hexdigest() == hashes[file], f'{role}: reassembled bytes differ from the fingerprint')
        need(data == (frozen / file).read_bytes(), f'{role}: reassembled bytes differ from the frozen file')
        originals[role] = data

    summary = dict((r[0], r[1]) for r in body(sheets, 'Summary', 2))
    for k, v in (('Lifecycle', 'bank-statement-lifecycle-1'), ('Family', 'bank-statement-native-1'),
                 ('Currency', facts['currency']), ('Decimals', str(facts['decimals'])),
                 ('Format', Path(case['statement']).suffix[1:].lower()),
                 ('Date window days', str(expected['dateWindowDays']))):
        need(summary.get(k) == v, f'summary {k}: {summary.get(k)!r} != {v!r}')
    confirmed = case['confirmedClosing']
    need(summary['Confirmed closing minor units'] == ('' if confirmed is None else str(confirmed)), 'summary confirmed closing')
    held = want['statement'] != 'verified' if pdf else confirmed is None
    need(summary['Status'] in (['held'] if held else ['needs-review', 'reviewed']), f"summary status {summary['Status']}")
    need(bool(summary['Held reason']) == held, 'summary held reason')
    completeness = ('printed' if not held else 'unproven') if pdf else ('confirmed-closing' if not held else 'unproven')
    need(summary['Completeness'] == completeness, f"summary completeness {summary['Completeness']}")
    need((summary['Period start'], summary['Period end']) == (facts['period']['start'], facts['period']['end']), 'summary period')

    # Statement lines: the sealed facts for a PDF, the file itself for a table.
    lines = body(sheets, 'Statement lines', 13)
    keys = []
    movement = {}
    if pdf:
        need(summary['Statement status'] == want['statement'], 'summary statement status')
        printed = [dict(l, page=i + 1) for i, p in enumerate(story['statement']['pages']) for l in p['lines']]
        need(len(lines) == len(printed), f'{len(lines)} statement lines, {len(printed)} printed')
        for i, (row, fact) in enumerate(zip(lines, printed)):
            where = f"line {i + 1} ({fact['kind']})"
            n, kind, page, items, mid, d, vd, desc, ref, w, dep, bal, text = row
            need(integer(n, where) == i + 1 and kind == fact['kind'] and integer(page, where) == fact['page'], where)
            need(re.fullmatch(r'\d+( \d+)*', items) is not None, f'{where}: no citation')
            fields = {'date': d, 'valueDate': vd, 'reference': ref, 'withdrawal': w, 'deposit': dep, 'balance': bal}
            used = (['date', 'valueDate', 'reference', 'withdrawal', 'deposit', 'balance'] if kind == 'movement'
                    else ['withdrawal', 'deposit'] if kind in ('totals', 'page-totals')
                    else [] if kind == 'continuation' else ['balance'])
            for f in used:
                need(fields[f] == str(fact[f]), f'{where} {f}: {fields[f]!r} != {fact[f]!r}')
            for f in set(fields) - set(used):
                need(fields[f] == '', f'{where} {f}: a value the line does not print')
            if kind == 'movement':
                need(words(desc) == words(fact['description']), f'{where} description')
                keys.append(fact['key'])
                movement[mid] = row
                need(mid == f'S{len(keys)}', f'{where}: movement id {mid}')
            else:
                need(mid == '', f'{where}: movement id on a non-movement line')
            if kind == 'continuation':
                need(words(text) == words(fact['text']), f'{where} text')
        pages = [[integer(c, 'page') for c in r] for r in body(sheets, 'Pages', 3)]
        need(pages == [[i + 1, p['number'], p['of']] for i, p in enumerate(story['statement']['pages'])], 'pages')
        if want['statement'] != 'incomplete-pages':
            for k in ('opening', 'closing', 'withdrawals', 'deposits'):
                need(summary[f'{k.capitalize()} minor units'] == str(cents(want[k])), f'summary {k}')
    else:
        rows = table_rows(case['statement'], originals['statement'])
        need(rows[0] == oracle.STATEMENT_HEADERS, 'statement file headers')
        need(len(lines) == len(rows) - 1, 'statement line count')
        facts_moves = [l for p in story['statement']['pages'] for l in p['lines'] if l['kind'] == 'movement']
        for i, (row, raw) in enumerate(zip(lines, rows[1:])):
            where = f'statement row {i + 2}'
            raw = [c.strip() for c in raw + [''] * (7 - len(raw))]
            n, kind, page, items, mid, d, vd, desc, ref, w, dep, bal, text = row
            need(integer(n, where) == i + 1 and page == '0' and items == str(i + 2) and text == '', where)
            need(integer(bal, where) == cents(raw[6]), f'{where} balance')
            if raw[2] in ('Opening balance', 'Closing balance') and not raw[0]:
                need(kind == raw[2].split()[0].lower() and mid == '' and (d, vd, ref, w, dep) == ('',) * 5, where)
                continue
            need(kind == 'movement' and (d, vd, desc, ref) == tuple(raw[:4]), where)
            need((integer(w, where), integer(dep, where)) == (cents(oracle.amount(raw[4])), cents(oracle.amount(raw[5]))), f'{where} amounts')
            keys.append(facts_moves[len(keys)]['key'])
            movement[mid] = row
            need(mid == f'S{len(keys)}', f'{where}: movement id {mid}')
        need(len(keys) == len(facts_moves), 'table movements')
        need(body(sheets, 'Pages', 3) == [], 'a table has no pages')
    key_of = {f'S{i + 1}': k for i, k in enumerate(keys)}

    # The cashbook, parsed here from its original bytes.
    raw_rows = table_rows(case['cashbook'], originals['cashbook'])
    entries = oracle.cashbook(raw_rows)
    cash = body(sheets, 'Cashbook', 7)
    need(len(cash) == len(entries), 'cashbook rows')
    voucher_key = {r['voucher']: r['key'] for r in story['cashbook']}
    cash_row = {}
    for i, (row, e, raw) in enumerate(zip(cash, entries, raw_rows[1:])):
        where = f'cashbook row {i + 2}'
        voucher, at, d, desc, ref, direction, amt = row
        need((voucher, integer(at, where), d, ref, direction) == (e['voucher'], i + 2, e['date'], e['reference'], e['direction']), where)
        need(desc == raw[2].strip() and integer(amt, where) == cents(e['amount']), where)
        cash_row[voucher] = row
    need(sorted(voucher_key) == sorted(cash_row), 'cashbook vouchers differ from the facts')

    def cite(side, member):
        if side == 'statement':
            row = movement[member]
            out = 'out' if row[9] != '0' else 'in'
            return [row[2], row[3], row[5], out, row[9] if out == 'out' else row[10]]
        row = cash_row[member]
        return [row[1], '', row[2], row[5], row[6]]

    def key(side, member):
        return key_of[member] if side == 'statement' else voucher_key[member]

    # Cases and their members, in the foundation's keys.
    cases = {}
    for cid, kind, reason, ref, status, decision, s_ids, c_ids in body(sheets, 'Cases', 8):
        need(cid == f'C{len(cases) + 1}', f'case id {cid}')
        cases[cid] = {'kind': kind, 'reason': reason, 'reference': ref, 'status': status, 'decision': decision,
                      'statement': s_ids.split(), 'cashbook': c_ids.split()}
    members = {}
    for cid, side, member, *cited in body(sheets, 'Case members', 8):
        need(cid in cases and cited == cite(side, member), f'case member {cid} {side} {member}: citation')
        members.setdefault(cid, {'statement': [], 'cashbook': []})[side].append(member)
    for cid, c in cases.items():
        need(members.get(cid) == {'statement': c['statement'], 'cashbook': c['cashbook']}, f'{cid}: members')
    if held:
        need(not cases, 'a held statement has cases')
    else:
        auto = sorted([key('statement', c['statement'][0]), key('cashbook', c['cashbook'][0])]
                      for c in cases.values() if c['kind'] == 'automatic')
        need(all(c['reason'] == 'reference' and len(c['statement']) == len(c['cashbook']) == 1
                 for c in cases.values() if c['kind'] == 'automatic'), 'automatic case shape')
        need(auto == sorted(want['auto']), 'automatic pairs differ from EXPECTED')
        review = sorted((sorted(key('statement', m) for m in c['statement']), sorted(key('cashbook', m) for m in c['cashbook']), c['reason'])
                        for c in cases.values() if c['kind'] == 'review')
        need(review == sorted((sorted(g['bank']), sorted(g['cash']), g['reason']) for g in want['review']), 'review groups differ from EXPECTED')
        need(all(c['kind'] in ('automatic', 'review') for c in cases.values()), 'case kind')

    # The scenario's decisions, replayed here.
    state = {cid: ('matched-automatic' if c['kind'] == 'automatic' else 'needs-review', '') for cid, c in cases.items()}
    by_keys = {(tuple(sorted(key('statement', m) for m in c['statement'])), tuple(sorted(key('cashbook', m) for m in c['cashbook']))): cid
               for cid, c in cases.items()}
    decided = []
    for d in case['decisions']:
        cid = by_keys[(tuple(sorted(d['bank'])), tuple(sorted(d['cash'])))]
        status, current = state[cid]
        if d['type'] == 'accept':
            need(status == 'needs-review' and cases[cid]['reason'] in ACCEPTABLE, f"{d['id']}: not acceptable")
            state[cid] = ('matched-accepted', d['id'])
        elif d['type'] == 'reject':
            need(not current, f"{d['id']}: already decided")
            state[cid] = ('rejected', d['id'])
        else:
            need(current, f"{d['id']}: nothing to undo")
            state[cid] = ('matched-automatic' if cases[cid]['kind'] == 'automatic' else 'needs-review', '')
        decided.append((d, cid))
    for cid, (status, decision) in state.items():
        need((cases[cid]['status'], cases[cid]['decision']) == (status, decision), f'{cid}: status after the decisions')
    review_left = any(s == 'needs-review' for s, _ in state.values())
    if not held:
        need(summary['Status'] == ('needs-review' if review_left else 'reviewed'), 'summary status after the decisions')
    rows = body(sheets, 'Decisions', 7)
    need(len(rows) == len(decided), 'decision count')
    dm = body(sheets, 'Decision members', 3)
    expected_dm = []
    for i, (row, (d, cid)) in enumerate(zip(rows, decided)):
        need(row == [str(i + 1), d['id'], d['type'], cid, summary['Context'], d['at'], d['note']], f"decision {d['id']}")
        expected_dm += [[d['id'], 'statement', m] for m in cases[cid]['statement']]
        expected_dm += [[d['id'], 'cashbook', m] for m in cases[cid]['cashbook']]
    need(dm == expected_dm, 'decision members')

    # Outstanding: the oracle's, plus the members of rejected cases.
    origin = {('statement', k): 'unmatched' for k in want['bankOnly']}
    origin.update({('cashbook', k): 'unmatched' for k in want['cashOnly']})
    for cid, (status, _) in state.items():
        if status == 'rejected':
            for side in ('statement', 'cashbook'):
                for m in cases[cid][side]:
                    origin[(side, key(side, m))] = cid
    got = {}
    for side, member, how, *cited in body(sheets, 'Outstanding', 8):
        need(cited == cite(side, member), f'outstanding {member}: citation')
        got[(side, key(side, member))] = how
    need(got == origin, 'outstanding items differ')

    timing = body(sheets, 'Timing', 7)
    need(sorted(key_of[r[0]] for r in timing) == sorted(want['timing']), 'timing')
    for mid, page, items, d, vd, start, end in timing:
        row = movement[mid]
        need([page, items, d, vd] == [row[2], row[3], row[5], row[6]], f'timing {mid}: citation')
        need((start, end) == (facts['period']['start'], facts['period']['end']) and not start <= vd <= end, f'timing {mid}')
    return {'name': case['name'], 'lines': len(lines), 'cases': len(cases), 'decisions': len(decided),
            'outstanding': len(got), 'timing': len(timing)}


def alterations(sheets):
    """Each returns an altered copy that a sound checker must refuse."""
    def edit(name, row, col, change):
        def apply(s):
            s = copy.deepcopy(s)
            s[name][row][col] = change(s[name][row][col])
            return s
        return apply

    def first(name, test):
        return next(i for i, r in enumerate(sheets[name]) if i and test(r))

    def drop(name, row):
        def apply(s):
            s = copy.deepcopy(s)
            del s[name][row]
            return s
        return apply

    move = first('Statement lines', lambda r: r[1] == 'movement')
    decided = first('Cases', lambda r: r[5])
    flip = {'A': 'B', 'B': 'A'}
    return [
        ('source byte', edit('Sources', 1, 4, lambda v: v[:100] + flip.get(v[100], 'A') + v[101:])),
        ('reference', edit('Statement lines', move, 8, lambda v: v + 'X')),
        ('balance', edit('Statement lines', move, 11, lambda v: str(int(v) + 1))),
        ('cashbook amount', edit('Cashbook', 1, 6, lambda v: str(int(v) + 1))),
        ('status', edit('Cases', decided, 4, lambda v: 'needs-review')),
        ('member', drop('Case members', len(sheets['Case members']) - 1)),
        ('citation', edit('Case members', 1, 4, lambda v: v + ' 1')),
        ('reason', edit('Cases', decided, 2, lambda v: 'date-gap' if v != 'date-gap' else 'amount-date-suggestion')),
        ('context', edit('Decisions', 1, 4, lambda v: v + ' ')),
        ('completeness', edit('Summary', first('Summary', lambda r: r[0] == 'Completeness'), 1, lambda v: 'confirmed-closing')),
        ('page number', edit('Pages', 1, 1, lambda v: str(int(v) + 1))),
        ('line', drop('Statement lines', move)),
        ('outstanding origin', edit('Outstanding', 1, 2, lambda v: 'unmatched' if v != 'unmatched' else 'C1')),
    ]


def main():
    request = json.load(sys.stdin)
    facts_text = Path(request['facts']).read_bytes()
    frozen = Path(request['frozen'])
    manifest = json.loads((frozen / 'INPUT-MANIFEST.json').read_text(encoding='utf-8'))
    need(hashlib.sha256(facts_text).hexdigest() == manifest['facts']['sha256'], 'facts differ from the seal')
    facts = json.loads(facts_text)
    expected = json.loads((frozen / 'EXPECTED.json').read_text(encoding='utf-8'))
    report = {'exports': [], 'selfTest': None}
    for case in request['exports']:
        sheets = workbook(Path(case['path']).read_bytes())
        try:
            report['exports'].append(check(sheets, case, facts, expected, manifest, frozen))
        except CheckError as e:
            raise CheckError(f"{case['name']}: {e}") from None
        if case['name'] == request.get('selfTest'):
            caught = []
            for name, alter in alterations(sheets):
                try:
                    check(alter(sheets), case, facts, expected, manifest, frozen)
                except CheckError:
                    caught.append(name)
                    continue
                raise CheckError(f'self-test: the checker accepted an altered workbook ({name})')
            report['selfTest'] = {'export': case['name'], 'alterations': len(caught), 'caught': caught}
    need(request.get('selfTest') is None or report['selfTest'] is not None, 'self-test export not found')
    json.dump(report, sys.stdout)


if __name__ == '__main__':
    try:
        main()
    except CheckError as e:
        print(f'CHECK FAILED: {e}', file=sys.stderr)
        sys.exit(1)
