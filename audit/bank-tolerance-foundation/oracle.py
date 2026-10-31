"""WF-1 TOL-1 foundation oracle: a tolerance the accountant declares on one
bank statement period (bank-tolerance-1, proposed), from the files and the
contract alone. Standard library only.

  node audit/bank-tolerance-foundation/stories.mjs > stories.json
  python3 -B audit/bank-tolerance-foundation/oracle.py [--frozen frozen] [--write]

It reads each story's printed facts (bound to the PDFs by VERIFY.json), the
cashbook files under frozen/ and contract.json. It settles the period itself
in integer minor units of the statement currency: the proof of the statement
from its printed lines, the cashbook at the currency's exponent, and the
matching of the sealed bank statement foundation's contract
(bank-statement-native-1), with the cases numbered as
bank-statement-lifecycle-1 numbers them. test_oracle.py holds this
settlement to the sealed ROLL-1 oracle's period_result on every story of two
decimals. Then the policy, the decisions and the reconciliation sheet, by
bank-tolerance-1. It never reads a story's recipe or intent and imports
neither the generator nor the product. --write stores EXPECTED.json.
"""
import argparse
import csv
import io
import json
import sys
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path

HERE = Path(__file__).resolve().parent
CONTRACT = json.loads((HERE / 'contract.json').read_text(encoding='utf-8'))
BANK = json.loads((HERE.parent / 'bank-statement-foundation' / 'contract.json').read_text(encoding='utf-8'))
WINDOW = BANK['matching']['dateWindowDays']
# ISO 4217 List One exponents of the currencies these stories may use.
EXPONENT = {'SAR': 2, 'KWD': 3, 'JPY': 0}
HEADERS = ['Date', 'Voucher', 'Description', 'Reference', 'Receipts', 'Payments']
ACCEPTABLE = {'amount-date-suggestion', 'date-gap'}


class Refused(Exception):
    pass


def days(a, b):
    return abs((date.fromisoformat(a) - date.fromisoformat(b)).days)


# ---- the period -------------------------------------------------------------

def prove(statement):
    """'verified' when the printed pages are complete and every balance
    follows from the one before it; the movements in printed order."""
    pages = statement['pages']
    if len({p['of'] for p in pages}) != 1 or [p['number'] for p in pages] != list(range(1, pages[0]['of'] + 1)):
        return 'incomplete-pages', []
    movements, running, closing = [], None, None
    totals = [0, 0]
    for page in pages:
        for line in page['lines']:
            kind = line['kind']
            if kind in ('opening', 'brought-forward'):
                if kind == 'opening' and running is not None or kind == 'brought-forward' and running != line['balance']:
                    return 'balance-break', []
                running = line['balance']
            elif kind == 'movement':
                running += line['deposit'] - line['withdrawal']
                if line['balance'] != running:
                    return 'balance-break', []
                totals[0] += line['withdrawal']
                totals[1] += line['deposit']
                movements.append(dict(line, page=page['number']))
            elif kind in ('carried-forward', 'closing'):
                if line['balance'] != running:
                    return 'balance-break', []
                if kind == 'closing':
                    closing = running
            elif kind == 'totals':
                if [line['withdrawal'], line['deposit']] != totals:
                    return 'totals-break', []
    return ('verified' if closing is not None else 'no-closing'), movements


def minor(text, exponent):
    text = text.strip()
    if not text:
        return 0
    try:
        value = Decimal(text) * (10 ** exponent)
    except InvalidOperation:
        raise ValueError(f'amount {text!r}')
    if value < 0 or value != value.to_integral_value():
        raise ValueError(f'amount {text!r}')
    return int(value)


def cashbook(data, exponent):
    rows = list(csv.reader(io.StringIO(data.decode('utf-8'))))
    if rows[0] != HEADERS:
        raise ValueError(f'cashbook headers {rows[0]}')
    out, seen = [], set()
    for r in rows[1:]:
        d, voucher, _, reference, receipt, payment = (r + [''] * 6)[:6]
        receipt, payment = minor(receipt, exponent), minor(payment, exponent)
        if (receipt > 0) == (payment > 0) or voucher in seen:
            raise ValueError(f'cashbook row {r}')
        seen.add(voucher)
        date.fromisoformat(d)
        out.append({'voucher': voucher, 'date': d, 'reference': reference.strip(),
                    'direction': 'in' if receipt else 'out', 'amount': receipt or payment})
    return out


def match(movements, entries):
    """bank-statement-native-1: the reference step, then amount and date."""
    bank = [{'id': m['key'], 'date': m['date'], 'reference': m['reference'].strip(),
             'direction': 'out' if m['withdrawal'] else 'in', 'amount': m['withdrawal'] or m['deposit']}
            for m in movements]
    cash = [dict(e, id=e['voucher']) for e in entries]
    used, auto, review = set(), [], []
    for ref in sorted({r['reference'] for r in bank + cash if r['reference']}):
        b = [r for r in bank if r['reference'] == ref]
        c = [r for r in cash if r['reference'] == ref]
        if not b or not c:
            continue
        if len(b) == 1 and len(c) == 1:
            x, y = b[0], c[0]
            reason = ('direction-conflict' if x['direction'] != y['direction'] else
                      'amount-difference' if x['amount'] != y['amount'] else
                      'date-gap' if days(x['date'], y['date']) > WINDOW else None)
            if reason:
                review.append({'bank': [x['id']], 'cash': [y['id']], 'reason': reason})
            else:
                auto.append([x['id'], y['id']])
        else:
            review.append({'bank': [r['id'] for r in b], 'cash': [r['id'] for r in c], 'reason': 'duplicate-reference'})
        used |= {('b', r['id']) for r in b} | {('c', r['id']) for r in c}
    pool_b = [r for r in bank if ('b', r['id']) not in used]
    pool_c = [r for r in cash if ('c', r['id']) not in used]
    edges = {}
    for x in pool_b:
        for y in pool_c:
            if x['direction'] == y['direction'] and x['amount'] == y['amount'] and days(x['date'], y['date']) <= WINDOW:
                edges.setdefault(('b', x['id']), set()).add(('c', y['id']))
                edges.setdefault(('c', y['id']), set()).add(('b', x['id']))
    by_amount, seen = [], set()
    for start in sorted(edges):
        if start in seen:
            continue
        component, todo = set(), [start]
        while todo:
            node = todo.pop()
            if node not in component:
                component.add(node)
                todo.extend(edges[node] - component)
        seen |= component
        by_amount.append({'bank': sorted(i for s, i in component if s == 'b'),
                          'cash': sorted(i for s, i in component if s == 'c'),
                          'reason': 'amount-date-suggestion' if len(component) == 2 else 'ambiguous-amount-date'})
        used |= component
    # The lifecycle numbers amount components by their first member key,
    # cashbook keys `C:<voucher>` before statement keys `S:<id>`.
    by_amount.sort(key=lambda g: min([f'C:{c}' for c in g['cash']] + [f'S:{b}' for b in g['bank']]))
    return {'auto': auto, 'review': review + by_amount,
            'bankOnly': [r['id'] for r in bank if ('b', r['id']) not in used],
            'cashOnly': [r['id'] for r in cash if ('c', r['id']) not in used]}


def settle(period, cash_bytes):
    """The period without a policy, as bank-statement-lifecycle-1 settles it."""
    st = period['statement']
    exponent = EXPONENT[st['currency']]
    status, movements = prove(st)
    entries = cashbook(cash_bytes, exponent)
    out = {'currency': st['currency'], 'exponent': exponent, 'status': status,
           'movements': movements, 'entries': entries}
    if status != 'verified':
        return dict(out, held=True, cases=[], match=None)
    m = match(movements, entries)
    cases = [{'kind': 'automatic', 'reason': 'reference', 'statement': [a[0]], 'cashbook': [a[1]]} for a in m['auto']]
    cases += [{'kind': 'review', 'reason': g['reason'], 'statement': g['bank'], 'cashbook': g['cash']} for g in m['review']]
    for k, c in enumerate(cases):
        c.update(id=f'C{k + 1}', status='matched' if c['kind'] == 'automatic' else 'needs-review', decision=None)
    return dict(out, held=False, cases=cases, match=m)


# ---- the policy -------------------------------------------------------------

def refusal(policy, exponent):
    """The first rule of bank-tolerance-1 a policy breaks, or None."""
    whole = lambda v: isinstance(v, int) and not isinstance(v, bool)  # noqa: E731
    if exponent == 0:
        return 'CURRENCY'
    if not whole(policy.get('perItem')) or not 1 <= policy['perItem'] < 10 ** exponent:
        return 'PER_ITEM'
    if not whole(policy.get('perPeriod')) or not policy['perItem'] <= policy['perPeriod'] < 100 * 10 ** exponent:
        return 'PER_PERIOD'
    note = policy.get('note')
    if not isinstance(note, str) or not note.strip() or '\n' in note or '\r' in note:
        return 'NOTE'
    return None


def tolerate(settled, policy):
    """The cases the policy tolerates, all or none (T1, T3)."""
    if policy is None or settled['held']:
        return None
    moves = {m['key']: m for m in settled['movements']}
    entries = {e['voucher']: e for e in settled['entries']}
    eligible = []
    for c in settled['cases']:
        if c['kind'] != 'review' or c['reason'] != 'amount-difference':
            continue
        s, e = moves[c['statement'][0]], entries[c['cashbook'][0]]
        amount = s['withdrawal'] or s['deposit']
        if days(s['date'], e['date']) <= WINDOW and abs(amount - e['amount']) <= policy['perItem']:
            eligible.append((c, amount, e['amount'], e['direction']))
    total = sum(abs(a - b) for _, a, b, _ in eligible)
    if total > policy['perPeriod']:
        return {'sum': total, 'cap': policy['perPeriod']}
    for c, a, b, direction in eligible:
        c.update(kind='tolerated', reason='within-tolerance', status='matched-tolerated',
                 amounts={'statement': a, 'cashbook': b, 'difference': a - b, 'direction': direction})
    return None


# ---- a story ----------------------------------------------------------------

def judge(story, frozen):
    period = story['periods'][0]
    settled = settle(period, (frozen / f"{period['id']}-cashbook.csv").read_bytes())
    # The actions: a policy in force, and decisions bound to the policy they
    # were taken under (T5).
    policy, decisions = None, []
    for action in story.get('actions', []):
        if 'policy' in action:
            policy = action['policy']
        else:
            kind = 'reject' if 'reject' in action else 'undo'
            decisions.append({'type': kind, 'policy': policy, **action[kind]})
    out = {'refused': None, 'policy': policy, 'cases': [], 'exceeded': None, 'outstanding': [], 'sheet': None}
    if policy is not None:
        rule = refusal(policy, settled['exponent'])
        if rule:
            return dict(out, refused=f'TOLERANCE:{rule}')
    exceeded = tolerate(settled, policy)
    cases = settled['cases']
    for d in decisions:
        if d['policy'] != policy:
            return dict(out, refused='DECISION')
        found = [c for c in cases if sorted(c['statement']) == sorted(d['statement'])
                 and sorted(c['cashbook']) == sorted(d['cashbook'])]
        if len(found) != 1:
            return dict(out, refused='MEMBERS')
        c = found[0]
        if d['type'] == 'reject':
            if c['decision'] is not None:
                return dict(out, refused='INELIGIBLE')
            c.update(status='rejected', decision=True)
        else:
            if c['decision'] is None:
                return dict(out, refused='UNDO')
            c.update(status={'automatic': 'matched', 'tolerated': 'matched-tolerated'}.get(c['kind'], 'needs-review'),
                     decision=None)
    origin = {}
    if not settled['held']:
        origin.update({('S', s): 'unmatched' for s in settled['match']['bankOnly']})
        origin.update({('C', v): 'unmatched' for v in settled['match']['cashOnly']})
    for c in cases:
        if c['status'] == 'rejected':
            origin.update({('S', s): c['id'] for s in c['statement']})
            origin.update({('C', v): c['id'] for v in c['cashbook']})
    outstanding = [['S', m['key'], origin[('S', m['key'])]] for m in settled['movements'] if ('S', m['key']) in origin]
    outstanding += [['C', e['voucher'], origin[('C', e['voucher'])]] for e in settled['entries']
                    if ('C', e['voucher']) in origin]
    out.update(held=settled['held'], exceeded=exceeded, outstanding=outstanding,
               cases=[{k: v for k, v in c.items() if k != 'decision'} for c in cases])
    if story.get('book') is not None and not settled['held']:
        out['sheet'] = sheet(period, settled, cases, story['book']['balance'])
    return out


def sheet(period, settled, cases, book):
    """REPORT-1's sheet of one period with bank-tolerance-1's section (T7)."""
    closing = next(l['balance'] for p in period['statement']['pages'] for l in p['lines'] if l['kind'] == 'closing')
    cleared, pending = set(), set()
    for c in cases:
        members = {('S', s) for s in c['statement']} | {('C', v) for v in c['cashbook']}
        if c['status'] in ('matched', 'accepted', 'matched-tolerated'):
            cleared |= members
        elif c['status'] == 'needs-review':
            pending |= members
    sections = {'bookReceiptsNotOnStatement': [], 'bookPaymentsNotOnStatement': [],
                'statementDepositsNotInBook': [], 'statementWithdrawalsNotInBook': []}
    for m in settled['movements']:
        if ('S', m['key']) not in cleared:
            sections['statementWithdrawalsNotInBook' if m['withdrawal'] else 'statementDepositsNotInBook'].append(
                [m['key'], m['withdrawal'] or m['deposit']])
    for e in settled['entries']:
        if ('C', e['voucher']) not in cleared:
            sections['bookReceiptsNotOnStatement' if e['direction'] == 'in' else 'bookPaymentsNotOnStatement'].append(
                [e['voucher'], e['amount']])
    total = {k: sum(a for _, a in v) for k, v in sections.items()}
    adjusted_bank = closing + total['bookReceiptsNotOnStatement'] - total['bookPaymentsNotOnStatement']
    adjusted_book = book + total['statementDepositsNotInBook'] - total['statementWithdrawalsNotInBook']
    difference = adjusted_bank - adjusted_book
    tolerated = []
    for c in cases:
        if c['status'] == 'matched-tolerated':
            a = c['amounts']
            effect = a['statement'] - a['cashbook'] if a['direction'] == 'in' else a['cashbook'] - a['statement']
            tolerated.append([c['id'], effect])
    tolerated_sum = sum(e for _, e in tolerated)
    unexplained = difference - tolerated_sum
    if pending:
        status = 'draft'
    elif tolerated:
        status = 'reconciled-within-tolerance' if unexplained == 0 else 'difference'
    else:
        status = 'reconciled' if difference == 0 else 'difference'
    return {'bank': closing, 'book': book, 'sections': sections, 'adjustedBank': adjusted_bank,
            'adjustedBook': adjusted_book, 'difference': difference, 'toleratedDifferences': tolerated,
            'tolerated': tolerated_sum, 'unexplained': unexplained, 'status': status}


def run(frozen, facts_path):
    facts = json.loads(Path(facts_path).read_text(encoding='utf-8'))
    return {'version': facts['version'], 'window': WINDOW,
            'stories': {s['id']: judge(s, Path(frozen)) for s in facts['stories']}}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--frozen', default=str(HERE / 'frozen'))
    ap.add_argument('--write', action='store_true')
    a = ap.parse_args()
    frozen = Path(a.frozen)
    expected = run(frozen, frozen / 'stories.json')
    text = json.dumps(expected, ensure_ascii=False, indent=1, sort_keys=True) + '\n'
    if a.write:
        (frozen / 'EXPECTED.json').write_text(text, encoding='utf-8')
    summary = {sid: (r['refused'] or r['sheet'] and r['sheet']['status']) for sid, r in expected['stories'].items()}
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == '__main__':
    sys.exit(main())
