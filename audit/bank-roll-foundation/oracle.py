"""Independent oracle for the WF-1 ROLL-1 foundation (proposed
bank-statement-roll-1). Standard library only.

  node audit/bank-roll-foundation/stories.mjs > stories.json
  python3 -B audit/bank-roll-foundation/oracle.py [--frozen frozen] [--write]

Reads the printed statement lines of every period in the facts (bound to the
PDFs by VERIFY.json), the cashbook files and the previous-period session
files under frozen/, and contract.json. It never reads a story's `recipe` or
`intent`, imports nothing from the generator or the product, and takes the
proof of one statement and the matching of one period from the sealed bank
statement foundation oracle (prove, match, cashbook), unchanged.

For each story it reads the session the story brings as the product would
have to: the format, every embedded file against its recorded fingerprint,
the decisions against the cases of their period, then the session's own
previous session down the chain. It derives the previous period's
outstanding items with their age, decides whether they may be carried, and
clears them against the current period by the contract: repetition first,
then the period's own matching, then carried items against what that left.
--write stores the result as EXPECTED.json beside the assets.
"""
import argparse
import base64
import csv
import hashlib
import importlib.util
import io
import json
import os
import sys
from datetime import date, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
# The sealed bank statement foundation; a copy of this file elsewhere (the
# planted faults of mutate_oracle.py) names it by BANK_FOUNDATION.
BANK = Path(os.environ.get('BANK_FOUNDATION', HERE.parent / 'bank-statement-foundation'))
_spec = importlib.util.spec_from_file_location('bank_statement_foundation_oracle', BANK / 'oracle.py')
bank = importlib.util.module_from_spec(_spec)  # the sealed bank statement oracle
_spec.loader.exec_module(bank)

LIFECYCLE = 'bank-statement-lifecycle-1'
ROLL = 'bank-statement-roll-1'
FORMAT = 'tarasuf-bank-statement-session'
ACCEPTABLE = {'amount-date-suggestion', 'date-gap'}
REFUSAL_ORDER = ['ROLL_PREVIOUS_UNREADABLE', 'ROLL_PREVIOUS_HELD', 'ROLL_PREVIOUS_UNDECIDED',
                 'ROLL_CURRENCY', 'ROLL_NOT_CONSECUTIVE', 'ROLL_OPENING']


class Refused(Exception):
    pass


def sha(data):
    return hashlib.sha256(data).hexdigest()


def cents(value):
    return int((value * 100).to_integral_value())


def period_result(story_period, cash_bytes, statement_sha, cash_sha, decisions, window):
    """One period as bank-statement-lifecycle-1 settles it: proof, matching,
    cases in the product's numbering, decisions, status, outstanding."""
    st = story_period['statement']
    proof, movements = bank.prove(st)
    entries = bank.cashbook(list(csv.reader(io.StringIO(cash_bytes.decode('utf-8')))))
    rows = {e['voucher']: k + 2 for k, e in enumerate(entries)}
    pages = {m['key']: m['page'] for m in movements}
    out = {'proof': proof['statement'], 'movements': movements, 'entries': entries, 'rows': rows, 'pages': pages}
    context = json.dumps([LIFECYCLE, 'bank-statement-native-1', [statement_sha, cash_sha], st['currency'],
                          {'start': st['period']['start'], 'end': st['period']['end']}, None, 'printed'],
                         separators=(',', ':'), ensure_ascii=False)
    out['context'] = context
    if proof['statement'] != 'verified':
        if decisions:
            raise Refused('ROLL_PREVIOUS_UNREADABLE')
        out.update(held=True, cases=[], outstanding=[])
        return out
    m = bank.match(movements, entries, window, st['period'])
    by_ref = [g for g in m['review'] if g['reason'] not in ('amount-date-suggestion', 'ambiguous-amount-date')]
    by_amount = [g for g in m['review'] if g['reason'] in ('amount-date-suggestion', 'ambiguous-amount-date')]
    # The product orders amount components by their first member key, cashbook
    # keys `C:<voucher>` before statement keys `S:<id>`.
    by_amount.sort(key=lambda g: min([f'C:{c}' for c in g['cash']] + [f'S:{b}' for b in g['bank']]))
    cases = [{'kind': 'automatic', 'reason': 'reference', 'statement': [a[0]], 'cashbook': [a[1]]} for a in m['auto']]
    cases += [{'kind': 'review', 'reason': g['reason'], 'statement': g['bank'], 'cashbook': g['cash']}
              for g in by_ref + by_amount]
    for k, c in enumerate(cases):
        c.update(id=f'C{k + 1}', status='matched' if c['kind'] == 'automatic' else 'needs-review', decision=None)
    by_id = {c['id']: c for c in cases}
    for d in decisions:
        c = by_id.get(d['case'])
        if d['context'] != context or c is None or c['statement'] != d['statement'] or c['cashbook'] != d['cashbook']:
            raise Refused('ROLL_PREVIOUS_UNREADABLE')
        if d['type'] == 'accept':
            if c['status'] != 'needs-review' or c['reason'] not in ACCEPTABLE:
                raise Refused('ROLL_PREVIOUS_UNREADABLE')
            c.update(status='accepted', decision=d['id'])
        elif d['type'] == 'reject':
            if c['decision'] is not None:
                raise Refused('ROLL_PREVIOUS_UNREADABLE')
            c.update(status='rejected', decision=d['id'])
        else:
            if c['decision'] is None:
                raise Refused('ROLL_PREVIOUS_UNREADABLE')
            c.update(status='matched' if c['kind'] == 'automatic' else 'needs-review', decision=None)
    origin = {('S', s): 'unmatched' for s in m['bankOnly']}
    origin.update({('C', c): 'unmatched' for c in m['cashOnly']})
    for c in cases:
        if c['status'] == 'rejected':
            origin.update({('S', s): c['id'] for s in c['statement']})
            origin.update({('C', v): c['id'] for v in c['cashbook']})
    out.update(held=False, cases=cases, match=m,
               outstanding=[('S', mv['key'], origin[('S', mv['key'])]) for mv in movements if ('S', mv['key']) in origin] +
               [('C', e['voucher'], origin[('C', e['voucher'])]) for e in entries if ('C', e['voucher']) in origin])
    return out


def item(period, result, side, ident, origin, age, source_sha, session_sha):
    """A carried item with its provenance."""
    month = period['id'].split('-')[1]
    if side == 'S':
        mv = next(m for m in result['movements'] if m['key'] == ident)
        direction = 'out' if mv['withdrawal'] else 'in'
        amount = cents(bank.minor(mv['withdrawal'] or mv['deposit']))
        place = {'page': result['pages'][ident]}
        when, reference = mv['date'], mv['reference'].strip()
    else:
        e = next(e for e in result['entries'] if e['voucher'] == ident)
        direction, amount = e['direction'], cents(e['amount'])
        place = {'row': result['rows'][ident]}
        when, reference = e['date'], e['reference']
    return {'item': f'{month}:{ident}', 'period': month, 'side': 'statement' if side == 'S' else 'cashbook',
            'id': ident, **place, 'date': when, 'direction': direction, 'amount': amount, 'reference': reference,
            'origin': origin, 'age': age, 'source': source_sha, 'session': session_sha}


def read_session(data, story, shas, window):
    """A previous session as the product must read it. Returns the period it
    closes, its result and the items outstanding at its end (with their
    age), or raises Refused."""
    try:
        doc = json.loads(data.decode('utf-8'))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise Refused('ROLL_PREVIOUS_UNREADABLE')
    keys = {'format', 'version', 'files', 'scope', 'decisions'}
    if not isinstance(doc, dict) or doc.get('format') != FORMAT:
        raise Refused('ROLL_PREVIOUS_UNREADABLE')
    if not (doc.get('version') == LIFECYCLE and set(doc) == keys
            or doc.get('version') == ROLL and set(doc) == keys | {'previous'}):
        raise Refused('ROLL_PREVIOUS_UNREADABLE')
    if doc['scope'] != {'currency': None, 'period': None, 'confirmedClosing': None} or len(doc['files']) != 2:
        raise Refused('ROLL_PREVIOUS_UNREADABLE')
    blobs = []
    for f in doc['files']:
        raw = base64.b64decode(f['data'], validate=True)
        if sha(raw) != f['sha256']:
            raise Refused('ROLL_PREVIOUS_UNREADABLE')
        blobs.append(raw)
    period = next((p for p in story['periods'] if shas[p['id']] == sha(blobs[0])), None)
    if period is None:
        raise Refused('ROLL_PREVIOUS_UNREADABLE')
    result = period_result(period, blobs[1], sha(blobs[0]), sha(blobs[1]), doc['decisions'], window)
    session_sha = sha(data)
    if result['held']:
        raise Refused('ROLL_PREVIOUS_HELD')
    if any(c['status'] == 'needs-review' for c in result['cases']):
        raise Refused('ROLL_PREVIOUS_UNDECIDED')
    left = [item(period, result, side, ident, origin, 1, sha(blobs[0] if side == 'S' else blobs[1]), session_sha)
            for side, ident, origin in result['outstanding']]
    if doc['version'] == ROLL:
        prev = doc['previous']
        inner = base64.b64decode(prev['data'], validate=True)
        if sha(inner) != prev['sha256']:
            raise Refused('ROLL_PREVIOUS_UNREADABLE')
        try:
            before, carried = read_session(inner, story, shas, window)[0::2]
        except Refused:
            raise Refused('ROLL_PREVIOUS_UNREADABLE')
        problem = continuity(before, period)
        if problem:
            raise Refused('ROLL_PREVIOUS_UNREADABLE')
        cleared = clear(carried, period, result, window)
        if cleared['cases']:
            # A closed period has no carried case left undecided; this
            # foundation records no decision on one.
            raise Refused('ROLL_PREVIOUS_UNDECIDED')
        left += [dict(c, age=c['age'] + 1) for c in cleared['still']]
    return period, result, left


def continuity(previous, current):
    a, b = previous['statement'], current['statement']
    if a['currency'] != b['currency']:
        return 'ROLL_CURRENCY'
    if date.fromisoformat(a['period']['end']) + timedelta(days=1) != date.fromisoformat(b['period']['start']):
        return 'ROLL_NOT_CONSECUTIVE'
    closing = next(l['balance'] for p in a['pages'] for l in p['lines'] if l['kind'] == 'closing')
    opening = next(l['balance'] for p in b['pages'] for l in p['lines'] if l['kind'] == 'opening')
    if closing != opening:
        return 'ROLL_OPENING'
    return None


def clear(carried, period, own_base, window):
    """The current period with carried items: repetition, the period's own
    matching on what repetition left, then carried items against what the
    own matching left unmatched. Nothing here is automatic."""
    movements, entries = own_base['movements'], own_base['entries']
    cur = [('S', m['key'], 'out' if m['withdrawal'] else 'in', cents(bank.minor(m['withdrawal'] or m['deposit'])),
            m['reference'].strip(), m['date']) for m in movements]
    cur += [('C', e['voucher'], e['direction'], cents(e['amount']), e['reference'], e['date']) for e in entries]
    side_of = {'statement': 'S', 'cashbook': 'C'}
    # 1) Repetition: a current item on the carried item's own side with its
    # reference, or (cashbook) its voucher.
    links = []
    for c in carried:
        s = side_of[c['side']]
        same = [x for x in cur if x[0] == s and ((c['reference'] and x[4] == c['reference']) or (s == 'C' and x[1] == c['id']))]
        if not same:
            continue
        members = set(same)
        if c['reference']:
            members |= {x for x in cur if x[4] == c['reference']}
        restated = any((x[2], x[3], x[5]) != (c['direction'], c['amount'], c['date']) for x in same)
        links.append(({c['item']}, members, 'carried-restated' if restated else 'carried-repeated'))
    groups = merge(links, lambda reasons: 'carried-restated' if 'carried-restated' in reasons else 'carried-repeated')
    withheld = {x for _, members, _ in groups for x in members}
    held_items = {i for items, _, _ in groups for i in items}
    # 2) The period's own matching on what repetition left.
    keep_s = [m for m in movements if ('S', m['key']) not in {(x[0], x[1]) for x in withheld}]
    keep_c = [e for e in entries if ('C', e['voucher']) not in {(x[0], x[1]) for x in withheld}]
    own = bank.match(keep_s, keep_c, window, period['statement']['period'])
    unmatched = [x for x in cur if (x[0] == 'S' and x[1] in own['bankOnly']) or (x[0] == 'C' and x[1] in own['cashOnly'])]
    # 3) Carried items against what the own matching left, opposite side.
    links = []
    for c in carried:
        if c['item'] in held_items:
            continue
        other = 'C' if side_of[c['side']] == 'S' else 'S'
        pool = [x for x in unmatched if x[0] == other and x[2] == c['direction']]
        by_ref = [x for x in pool if c['reference'] and x[4] == c['reference']]
        if by_ref:
            if len(by_ref) > 1:
                reason = 'carried-ambiguous'
            else:
                reason = 'carried-reference' if by_ref[0][3] == c['amount'] else 'carried-amount-difference'
            links.append(({c['item']}, set(by_ref), reason))
            continue
        by_amount = [x for x in pool if x[3] == c['amount'] and (not c['reference'] or not x[4])]
        if by_amount:
            links.append(({c['item']}, set(by_amount),
                          'carried-amount-suggestion' if len(by_amount) == 1 else 'carried-ambiguous'))
    pairs = merge(links, lambda reasons: next(iter(reasons)) if len(reasons) == 1 else 'carried-ambiguous', ambiguous_when_shared=True)
    cases = groups + pairs
    in_case = {i for items, _, _ in cases for i in items}
    order = {c['item']: k for k, c in enumerate(carried)}
    cases.sort(key=lambda g: min(order[i] for i in g[0]))
    name = period['id'].split('-')[1]
    key = lambda x: (0 if x[0] == 'S' else 1, int(x[1][1:]) if x[0] == 'S' else own_base['rows'][x[1]])  # noqa: E731
    return {
        'own': own,
        'withheld': sorted(f'{name}:{x[1]}' for x in withheld),
        'cases': [{'reason': reason, 'carried': sorted(items, key=order.get),
                   'current': [f'{name}:{x[1]}' for x in sorted(members, key=key)]} for items, members, reason in cases],
        'still': [c for c in carried if c['item'] not in in_case],
    }


def merge(links, reason_of, ambiguous_when_shared=False):
    """Links that share a carried item or a current item are one case."""
    groups = []
    for items, members, reason in links:
        joined = [g for g in groups if g[0] & items or g[1] & members]
        for g in joined:
            groups.remove(g)
        reasons = {reason, *(r for g in joined for r in g[3])}
        all_items = set(items).union(*(g[0] for g in joined))
        all_members = set(members).union(*(g[1] for g in joined))
        groups.append((all_items, all_members, None, reasons))
    out = []
    for items, members, _, reasons in groups:
        reason = reason_of(reasons)
        if ambiguous_when_shared and len(items) > 1:
            reason = 'carried-ambiguous'
        out.append((items, members, reason))
    return out


def judge(story, frozen, window):
    shas = {p['id']: sha((frozen / f"{p['id']}-statement.pdf").read_bytes()) for p in story['periods']}
    current = story['periods'][-1]
    cash = (frozen / f"{current['id']}-cashbook.csv").read_bytes()
    base = period_result(current, cash, shas[current['id']],
                         sha(cash), [], window)
    out = {'previous': 'none', 'carried': [], 'cases': [], 'stillCarried': [], 'withheld': []}
    session = frozen / f"{story['id']}-previous-session.json"
    carried = []
    if session.exists():
        try:
            previous, _, carried = read_session(session.read_bytes(), story, shas, window)
            problem = continuity(previous, current)
            if problem:
                raise Refused(problem)
            out['previous'] = 'accepted'
        except Refused as r:
            out['previous'] = str(r)
            carried = []
    out['carried'] = carried
    if base['held']:
        out['currentHeld'] = True
        return out
    cleared = clear(carried, current, base, window)
    own = cleared['own']
    out.update(
        cases=cleared['cases'],
        stillCarried=[{'item': c['item'], 'age': c['age'] + 1} for c in cleared['still']],
        withheld=cleared['withheld'],
        own={'auto': len(own['auto']), 'review': [g['reason'] for g in own['review']],
             'statementOnly': len(own['bankOnly']), 'cashbookOnly': len(own['cashOnly'])},
    )
    return out


def run(frozen, facts_path):
    facts = json.loads(Path(facts_path).read_text(encoding='utf-8'))
    window = json.loads((BANK / 'contract.json').read_text())['matching']['dateWindowDays']
    return {'version': 'bank-roll-foundation-oracle-1', 'stories': {s['id']: judge(s, Path(frozen), window) for s in facts['stories']}}


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
