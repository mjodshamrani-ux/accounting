"""Independent oracle for the WF-1 REPORT-1 foundation (proposed
bank-reconciliation-sheet-1). Standard library only.

  node audit/bank-sheet-foundation/stories.mjs > stories.json
  python3 -B audit/bank-sheet-foundation/oracle.py [--frozen frozen] [--write]

Reads the facts (bound to the PDFs by VERIFY.json), the cashbook and previous
session files under frozen/, and contract.json. It never reads a story's
`recipe` or `intent` and imports nothing from the generator or the product.
The settled period (the previous session's verdict, the carried items, the
period's own matching after repetition, the carried cases) comes from the
sealed ROLL-1 foundation oracle, unchanged; this file applies the
accountant's actions in order and builds the sheet by the contract: every
item not cleared, listed alone in its section by side and direction, the
adjusted balances, the difference, the status, and whether each sign-off was
given on the final content.
--write stores the result as EXPECTED.json beside the assets.
"""
import argparse
import copy
import hashlib
import importlib.util
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
# The sealed ROLL-1 foundation; a copy of this file elsewhere (the planted
# faults of mutate_oracle.py) names it by ROLL_FOUNDATION.
ROLL = Path(os.environ.get('ROLL_FOUNDATION', HERE.parent / 'bank-roll-foundation'))
_spec = importlib.util.spec_from_file_location('bank_roll_foundation_oracle', ROLL / 'oracle.py')
roll = importlib.util.module_from_spec(_spec)  # the sealed ROLL-1 oracle
_spec.loader.exec_module(roll)

CONTRACT = json.loads((HERE / 'contract.json').read_text(encoding='utf-8'))
_carried_rules = json.loads((ROLL / 'contract.json').read_text(encoding='utf-8'))['clearing']
ACCEPT_OWN = set(roll.ACCEPTABLE)
ACCEPT_CARRIED = {reason for reason, text in {**_carried_rules['byReference'], **_carried_rules['byAmount']}.items()
                  if 'may accept it' in text}
SECTIONS = [
    ('bookReceiptsNotOnStatement', 'cashbook', 'in'),
    ('bookPaymentsNotOnStatement', 'cashbook', 'out'),
    ('statementDepositsNotInBook', 'statement', 'in'),
    ('statementWithdrawalsNotInBook', 'statement', 'out'),
]
MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']


class StoryError(Exception):
    """An action the contract does not allow: the story is wrong, not the sheet."""


def sha(data):
    return hashlib.sha256(data).hexdigest()


def settle(story, frozen, window):
    """The current period as the ROLL-1 oracle settles it, before any
    decision of this period."""
    shas = {p['id']: sha((frozen / f"{p['id']}-statement.pdf").read_bytes()) for p in story['periods']}
    current = story['periods'][-1]
    cash = (frozen / f"{current['id']}-cashbook.csv").read_bytes()
    base = roll.period_result(current, cash, shas[current['id']], sha(cash), [], window)
    out = {'current': current, 'base': base, 'previous': 'none', 'carried': [],
           'shas': {'statement': shas[current['id']], 'cashbook': sha(cash)}}
    session = frozen / f"{story['id']}-previous-session.json"
    if session.exists():
        try:
            previous, _, carried = roll.read_session(session.read_bytes(), story, shas, window)
            problem = roll.continuity(previous, current)
            if problem:
                raise roll.Refused(problem)
            out.update(previous='accepted', carried=carried)
        except roll.Refused as r:
            out['previous'] = str(r)
    if not base['held']:
        out['cleared'] = roll.clear(out['carried'], current, base, window)
    return out


def cases_of(settled):
    """The period's review cases, own then carried, each with its members as
    item keys (`<MONTH>:<id>`) and no decision yet."""
    month = settled['current']['id'].split('-')[1]
    cleared = settled['cleared']
    out = []
    for g in cleared['own']['review']:
        out.append({'kind': 'own', 'reason': g['reason'],
                    'members': [f'{month}:{s}' for s in g['bank']] + [f'{month}:{c}' for c in g['cash']],
                    'decision': None})
    for c in cleared['cases']:
        out.append({'kind': 'carried', 'reason': c['reason'], 'members': list(c['carried']) + list(c['current']),
                    'decision': None})
    return out


def decide(cases, action, month):
    """Apply one decision, named by its members, to the case holding exactly
    those members."""
    wanted = sorted([f'{month}:{s}' for s in action['statement']] + [f'{month}:{c}' for c in action['cashbook']]
                    + list(action['carried']))
    found = [c for c in cases if sorted(c['members']) == wanted]
    if len(found) != 1:
        raise StoryError(f'no case holds exactly {wanted}')
    case = found[0]
    if case['decision'] is not None:
        raise StoryError(f'case {wanted} is already decided')
    if action['type'] == 'accept':
        allowed = ACCEPT_OWN if case['kind'] == 'own' else ACCEPT_CARRIED
        if case['reason'] not in allowed:
            raise StoryError(f"{case['reason']} cannot be accepted")
        case['decision'] = 'accepted'
    elif action['type'] == 'reject':
        case['decision'] = 'rejected'
    else:
        raise StoryError(f"unknown decision {action['type']}")


def items_of(settled, cases):
    """Every item not cleared at the period end, with its origin."""
    current, base, cleared = settled['current'], settled['base'], settled['cleared']
    month = current['id'].split('-')[1]
    origin = {}
    for s in cleared['own']['bankOnly']:
        origin[f'{month}:{s}'] = ('unmatched', None)
    for c in cleared['own']['cashOnly']:
        origin[f'{month}:{c}'] = ('unmatched', None)
    # A carried case holds current items the own matching left unmatched: its
    # decision, not the own matching, says whether they are cleared.
    for case in cases:
        state = {'accepted': None, 'rejected': 'rejected', None: 'pending'}[case['decision']]
        for key in case['members']:
            if state is None:
                origin.pop(key, None)
            else:
                origin[key] = (state, case['reason'])
    for c in cleared['still']:
        origin[c['item']] = ('carried', None)
    carried = {c['item']: c for c in settled['carried']}
    out = []
    for key, (how, reason) in origin.items():
        if key in carried:
            c = carried[key]
            item = {'item': key, 'side': c['side'], 'id': c['id'], 'period': c['period'],
                    'page': c.get('page'), 'row': c.get('row'), 'date': c['date'], 'direction': c['direction'],
                    'amount': c['amount'], 'reference': c['reference'], 'age': c['age'] + 1, 'source': c['source']}
        else:
            ident = key.split(':', 1)[1]
            side = 'S' if ident in base['pages'] else 'C'
            x = roll.item(current, base, side, ident, how, 1, settled['shas']['statement' if side == 'S' else 'cashbook'], None)
            item = {'item': key, 'side': x['side'], 'id': x['id'], 'period': x['period'], 'page': x.get('page'),
                    'row': x.get('row'), 'date': x['date'], 'direction': x['direction'], 'amount': x['amount'],
                    'reference': x['reference'], 'age': None, 'source': x['source']}
        item.update(origin=how, reason=reason)
        out.append(item)
    return out


def position(item):
    return (MONTHS.index(item['period']), int(item['id'][1:]) if item['side'] == 'statement' else item['row'])


def sheet(settled, cases, book):
    """The sheet's content, or the refusal."""
    if settled['base']['held']:
        return {'refusal': 'SHEET_STATEMENT_HELD'}
    if settled['previous'] not in ('none', 'accepted'):
        return {'refusal': 'SHEET_PREVIOUS_REFUSED'}
    if book is None:
        return {'refusal': 'SHEET_NO_BOOK_BALANCE'}
    st = settled['current']['statement']
    closing = next((l['balance'], p['number']) for p in st['pages'] for l in p['lines'] if l['kind'] == 'closing')
    items = items_of(settled, cases)
    sections = {}
    for name, side, direction in SECTIONS:
        listed = sorted((i for i in items if i['side'] == side and i['direction'] == direction), key=position)
        sections[name] = {'items': listed, 'total': sum(i['amount'] for i in listed)}
    adjusted_bank = closing[0] + sections['bookReceiptsNotOnStatement']['total'] - sections['bookPaymentsNotOnStatement']['total']
    adjusted_book = book['balance'] + sections['statementDepositsNotInBook']['total'] - sections['statementWithdrawalsNotInBook']['total']
    difference = adjusted_bank - adjusted_book
    if any(i['origin'] == 'pending' for i in items):
        status = 'draft'
    elif difference == 0:
        status = 'reconciled'
    else:
        status = 'difference'
    return {
        'refusal': None,
        'status': status,
        'currency': st['currency'],
        'period': st['period'],
        'bank': {'balance': closing[0], 'page': closing[1]},
        'book': {'balance': book['balance'], 'note': book['note']},
        'sections': sections,
        'adjustedBank': adjusted_bank,
        'adjustedBook': adjusted_book,
        'difference': difference,
    }


def judge(story, frozen, window):
    settled = settle(story, frozen, window)
    month = settled['current']['id'].split('-')[1]
    cases = cases_of(settled) if 'cleared' in settled else []
    book = None
    signed = {}
    for action in story['sheet']:
        if 'book' in action:
            book = action['book']
        elif 'decide' in action:
            if 'cleared' not in settled:
                raise StoryError('a held statement has no case to decide')
            decide(cases, action['decide'], month)
        elif 'prepare' in action or 'review' in action:
            kind = 'prepared' if 'prepare' in action else 'reviewed'
            content = sheet(settled, cases, book)
            if content['refusal']:
                raise StoryError(f'{kind} on a refused sheet')
            signed[kind] = (action['prepare' if kind == 'prepared' else 'review'], copy.deepcopy(content))
        else:
            raise StoryError(f'unknown action {sorted(action)}')
    final = sheet(settled, cases, book)
    out = {'previous': settled['previous'], **final}
    if final['refusal']:
        return out
    out['language'] = story['language']
    out['signoffs'] = {kind: ({'name': signed[kind][0]['name'], 'date': signed[kind][0]['date'],
                               'valid': signed[kind][1] == final} if kind in signed else None)
                       for kind in ('prepared', 'reviewed')}
    return out


def run(frozen, facts_path):
    facts = json.loads(Path(facts_path).read_text(encoding='utf-8'))
    window = json.loads((roll.BANK / 'contract.json').read_text())['matching']['dateWindowDays']
    return {'version': 'bank-sheet-foundation-oracle-1',
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
