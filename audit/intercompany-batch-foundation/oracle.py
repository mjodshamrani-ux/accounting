"""Independent IC-1 oracle: the proposed intercompany-batch-1 contract
(contract.json) applied to the frozen CSV files with Python's csv module. It
reads the files and the contract only: not stories.py, not the facts, not
the intent, and not the product.

  python3 -B audit/intercompany-batch-foundation/oracle.py frozen > frozen/EXPECTED.json
"""
import csv
import io
import json
import re
import sys
import unicodedata
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
CONTRACT = json.loads((HERE / 'contract.json').read_text(encoding='utf-8'))
HEADS = {k: CONTRACT['inputs'][k]['headers'] for k in ('batches', 'ledgers', 'relations')}
DECIMALS = CONTRACT['reading']['currencies']
BLOCKING = CONTRACT['codes']['blocking']
MISSING = CONTRACT['codes']['missing']
FORMULA = re.compile(r'^[=+@-]|^#(?:REF!|VALUE!|N/A|DIV/0!)', re.I)
DIGITS = str.maketrans('٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789')
COMMON = ['Currency', 'Currency basis', 'FX policy', 'Posting status', 'Posting layer',
          'Period start', 'Period end', 'As of', 'Policy version']
ROW_KEY = ['Entity', 'Counterparty', 'Ledger', 'Account ID', 'Complete dimensions', *COMMON]


class Bad(Exception):
    pass


def read(path):
    raw = path.read_bytes().decode('utf-8')
    if raw.startswith('\ufeff'):
        raw = raw[1:]
    return list(csv.reader(io.StringIO(raw, newline='')))


def text(v, limit=500, identity=True):
    if (not v or v != v.strip() or len(v) > limit
            or any(unicodedata.category(c) in ('Cc', 'Cf') for c in v)
            or (identity and FORMULA.search(v))):
        raise Bad('IDENTITY')
    return v


def iso(v):
    if not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}', v):
        raise Bad('DATE')
    try:
        date.fromisoformat(v)
    except ValueError:
        raise Bad('DATE')
    return v


def amount(raw, decimals):
    v = raw.translate(DIGITS).replace('٫', '.')
    m = re.fullmatch(r'([0-9]+)(?:\.([0-9]+))?', v)
    if not m or len(m.group(2) or '') > decimals:
        raise Bad('AMOUNT')
    n = int(m.group(1)) * 10 ** decimals + int((m.group(2) or '').ljust(decimals, '0') or 0)
    if n > 10 ** 14:
        raise Bad('AMOUNT')
    return n


def ok(check, *args):
    try:
        check(*args)
        return True
    except Bad:
        return False


def table(path, head):
    rows = read(path)
    if not rows or len(rows[0]) != len(head) or set(rows[0]) != set(head):
        return None
    col = {h: i for i, h in enumerate(rows[0])}
    out = []
    for n, row in enumerate(rows[1:], start=2):
        if not any(c.strip() for c in row):
            continue
        out.append((n, {h: row[i] for h, i in col.items()} if len(row) == len(head) else None, row, col))
    return out


def declaration_ok(r):
    try:
        for h in HEADS['batches']:
            text(r[h])
        if r['Entity A'] == r['Entity B'] or r['Currency'] not in DECIMALS:
            return False
        if (r['Currency basis'], r['FX policy'], r['Posting status']) != (
                'functional', 'same-currency-no-conversion', 'posted'):
            return False
        return iso(r['Period start']) <= iso(r['Period end']) and iso(r['As of']) == r['Period end']
    except Bad:
        return False


def side_key(r, side):
    me, other = ('A', 'B') if side == 'A' else ('B', 'A')
    return (r['Entity ' + me], r['Entity ' + other], r['Ledger ' + me], r['Account ' + me],
            r['Dimensions ' + me], *(r[h] for h in COMMON))


def story(folder, sid):
    batches_file = folder / f'{sid}-batches.csv'
    ledgers = sorted(folder.glob(f'{sid}-ledger-*.csv'), key=lambda p: int(p.stem.rsplit('-', 1)[1]))
    relations_file = folder / f'{sid}-relations.csv'
    declared, run, unassigned = {}, [], []
    codes = {}
    findings = {}

    def flag(bid, code, where=None):
        codes.setdefault(bid, set()).add(code)
        if where:
            findings.setdefault(bid, set()).add((code, *where))

    decl_rows = table(batches_file, HEADS['batches'])
    if decl_rows is None:
        run.append('HEADER')
        decl_rows = []
    for n, r, raw, col in decl_rows:
        bid = r['Batch ID'] if r else None
        if bid is None or not ok(text, bid):
            run.append('BATCH_FIELD')
            continue
        declared.setdefault(bid, []).append((n, r))
        if not declaration_ok(r):
            flag(bid, 'BATCH_FIELD', (batches_file.name, n))
    for bid, rows in declared.items():
        if len(rows) > 1:
            for n, _ in rows:
                flag(bid, 'BATCH_DUPLICATE', (batches_file.name, n))
    decls = [(bid, n, r) for bid, rows in declared.items() for n, r in rows]
    for i, (b1, n1, r1) in enumerate(decls):
        for b2, n2, r2 in decls[i + 1:]:
            if b1 == b2 or not (ok(iso, r1['Period start']) and ok(iso, r1['Period end'])
                                and ok(iso, r2['Period start']) and ok(iso, r2['Period end'])):
                continue
            sides = lambda r: {tuple(r[f'{h} {s}'] for h in ('Entity', 'Ledger', 'Account', 'Dimensions'))
                               for s in 'AB'}
            same = [r1[h] for h in COMMON if h not in ('Period start', 'Period end', 'As of')] == \
                   [r2[h] for h in COMMON if h not in ('Period start', 'Period end', 'As of')]
            if same and sides(r1) == sides(r2) and \
                    max(r1['Period start'], r2['Period start']) <= min(r1['Period end'], r2['Period end']):
                flag(b1, 'BATCH_OVERLAP', (batches_file.name, n1))
                flag(b2, 'BATCH_OVERLAP', (batches_file.name, n2))

    # Assignment by declared identity only (B1).
    keys = {}
    for bid, n, r in decls:
        for side in 'AB':
            keys.setdefault(side_key(r, side), set()).add((bid, side))
    assigned = []  # (bid, side, file, row, record)
    loose = []  # (file, row, entity, code, candidates)
    for path in ledgers:
        rows = table(path, HEADS['ledgers'])
        if rows is None:
            run.append('HEADER')
            continue
        for n, r, raw, col in rows:
            if r is None:
                entity = raw[col['Entity']] if col['Entity'] < len(raw) else ''
                loose.append((path.name, n, entity, 'UNASSIGNED', set()))
                continue
            found = keys.get(tuple(r[h] for h in ROW_KEY), set())
            if len(found) == 1:
                bid, side = next(iter(found))
                assigned.append((bid, side, path.name, n, r))
            else:
                loose.append((path.name, n, r['Entity'], 'UNASSIGNED' if not found else 'UNASSIGNED_AMBIGUOUS', found))
    feeds = {}
    for bid, side, name, n, r in assigned:
        feeds.setdefault(name, set()).add(bid)
    for name, n, entity, code, found in loose:
        unassigned.append([name, n, code])
        if code == 'UNASSIGNED_AMBIGUOUS':
            hit = {bid for bid, _ in found}
        else:
            hit = {bid for bid, _, r in decls if entity in (r['Entity A'], r['Entity B'])} | feeds.get(name, set())
        for bid in hit:
            flag(bid, code, (name, n))

    first = {bid: rows[0][1] for bid, rows in declared.items()}
    entries = {}
    for bid, side, name, n, r in assigned:
        d = first[bid]
        decimals = DECIMALS.get(d['Currency'])
        where = (name, n)
        try:
            text(r['Transaction ID'])
            text(r['Counterparty transaction ID'])
            posted = iso(r['Posting date'])
        except Bad as e:
            flag(bid, str(e), where)
            continue
        if ok(iso, d['Period start']) and ok(iso, d['Period end']) and \
                not d['Period start'] <= posted <= d['Period end']:
            flag(bid, 'POSTING_PERIOD', where)
        if decimals is None:
            continue
        try:
            dr, cr = amount(r['Debit'], decimals), amount(r['Credit'], decimals)
        except Bad:
            flag(bid, 'AMOUNT', where)
            continue
        if dr > 0 and cr > 0:
            flag(bid, 'BOTH_SIDES', where)
            continue
        entries.setdefault((bid, side, r['Transaction ID']), []).append(
            {'file': name, 'row': n, 'tx': r['Transaction ID'], 'cp': r['Counterparty transaction ID'],
             'net': dr - cr})
    for bid, side, name, n, r in assigned:
        same = [x for x in assigned if x[:2] == (bid, side) and x[4]['Transaction ID'] == r['Transaction ID']]
        if r['Transaction ID'] and len(same) > 1:
            flag(bid, 'DUPLICATE_TRANSACTION', (name, n))

    # Relations.
    members = []  # (bid, rid, side, tx, ref, vf, vt, row)
    rel_rows = table(relations_file, HEADS['relations'])
    if rel_rows is None:
        run.append('HEADER')
        rel_rows = []
    for n, r, raw, col in rel_rows:
        if r is None or r['Batch ID'] not in declared:
            run.append('RELATION_UNATTRIBUTED')
            continue
        bid = r['Batch ID']
        try:
            text(r['Relation ID'])
            if r['Side'] not in ('A', 'B'):
                raise Bad('RELATION_FIELD')
            text(r['Transaction ID'])
            text(r['Relationship reference'], 2000, False)
            iso(r['Valid from'])
            iso(r['Valid to'])
        except Bad:
            flag(bid, 'RELATION_FIELD', (relations_file.name, n))
            continue
        members.append((bid, r['Relation ID'], r['Side'], r['Transaction ID'], r['Relationship reference'],
                        r['Valid from'], r['Valid to'], n))
    groups = {}
    for m in members:
        groups.setdefault(m[1], []).append(m)
    for rid, ms in groups.items():
        if len({m[0] for m in ms}) > 1:
            for m in ms:
                flag(m[0], 'RELATION_BATCHES', (relations_file.name, m[7]))
        if len({m[4:7] for m in ms}) > 1:
            for m in ms:
                flag(m[0], 'RELATION_FIELDS_DIFFER', (relations_file.name, m[7]))
        for m in ms:
            d = first[m[0]]
            if ok(iso, d['Period start']) and ok(iso, d['Period end']) and \
                    (m[5] > d['Period start'] or m[6] < d['Period end'] or m[5] > m[6]):
                flag(m[0], 'VALIDITY', (relations_file.name, m[7]))
    for m in members:
        if sum(1 for x in members if (x[0], x[2], x[3]) == (m[0], m[2], m[3])) > 1:
            flag(m[0], 'RELATION_DUPLICATE_MEMBER', (relations_file.name, m[7]))
    named = {}
    for m in members:
        named.setdefault((m[0], m[1]), {'A': [], 'B': []})[m[2]].append(m[3])
    for (bid, rid), sides in named.items():
        for side, other in (('A', 'B'), ('B', 'A')):
            for tx in sides[side]:
                for e in entries.get((bid, side, tx), []):
                    if (bid, other, e['cp']) in entries and e['cp'] not in sides[other]:
                        flag(bid, 'COUNTERPARTY_CONFLICT', (e['file'], e['row']))

    # Decide each batch on its own (B5).
    out = {}
    for bid in declared:
        for code in run:
            if code in BLOCKING:
                flag(bid, code)
        blocking = sorted(c for c in codes.get(bid, ()) if c in BLOCKING)
        rows = {s: sorted([[x[2], x[3]] for x in assigned if x[:2] == (bid, s)]) for s in 'AB'}
        mine = {k: v for k, v in named.items() if k[0] == bid}
        relations = {}
        if blocking:
            for (_, rid) in mine:
                relations[f'{bid}/{rid}'] = {'status': 'blocked', 'residual': None, 'members': None, 'rows': None}
            out[bid] = {'status': 'blocked', 'codes': blocking, 'sides': rows, 'relations': relations}
            continue
        missing = set()
        for (_, rid), sides in mine.items():
            found = {s: [entries.get((bid, s, tx)) for tx in sides[s]] for s in 'AB'}
            if not sides['A'] or not sides['B']:
                missing.add('RELATION_ONE_SIDED')
            if any(f is None for s in 'AB' for f in found[s]):
                missing.add('RELATION_MEMBER_MISSING')
            if not sides['A'] or not sides['B'] or any(f is None for s in 'AB' for f in found[s]):
                relations[f'{bid}/{rid}'] = {'status': 'missing', 'residual': None, 'members': None, 'rows': None}
                continue
            net = {s: sum(f[0]['net'] for f in found[s]) for s in 'AB'}
            residual = net['A'] + net['B']
            relations[f'{bid}/{rid}'] = {
                'status': 'ready' if residual == 0 else 'difference', 'residual': residual, 'net': net,
                'members': {s: list(sides[s]) for s in 'AB'},
                'rows': {s: [[f[0]['file'], f[0]['row']] for f in found[s]] for s in 'AB'}}
        related = {(s, tx) for (_, _), sides in mine.items() for s in 'AB' for tx in sides[s]}
        for (b, s, tx) in entries:
            if b == bid and (s, tx) not in related:
                missing.add('UNRELATED')
        if not rows['A'] or not rows['B']:
            missing.add('SIDE_EMPTY')
        status = 'missing' if missing else (
            'difference' if any(r['status'] == 'difference' for r in relations.values()) else 'ready')
        out[bid] = {'status': status, 'codes': sorted(missing), 'sides': rows, 'relations': relations}
    for bid in out:
        out[bid]['findings'] = sorted(list(f) for f in findings.get(bid, ()))
    return {'batches': out, 'unassigned': sorted(unassigned), 'run': sorted(set(run))}


def run(folder):
    folder = Path(folder)
    ids = sorted({p.name.split('-', 1)[0] for p in folder.glob('*-batches.csv')})
    return {'schema': 'tarasuf-ic1-batch-expected/1',
            'contract': CONTRACT['proposedFamily'],
            'stories': {sid: story(folder, sid) for sid in ids}}


if __name__ == '__main__':
    sys.stdout.write(json.dumps(run(sys.argv[1]), ensure_ascii=False, indent=1) + '\n')
