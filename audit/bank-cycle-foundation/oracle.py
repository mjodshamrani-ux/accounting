"""WF-1 CYCLE foundation oracle: two consecutive months on the bank
statement path, through the five sealed layers of the accountant's
workflow, from the files and the contracts alone. Standard library only.

  python3 -B audit/bank-cycle-foundation/stories.py > stories.json
  python3 -B audit/bank-cycle-foundation/oracle.py [--frozen frozen] [--write]

It composes the sealed oracles and adds only the rules where their
contracts meet (contract.json, `composition`), each with the clauses it
rests on:

- the ledger is read by columns with the sealed MAP-1 oracle
  (bank-map-foundation/oracle.py), and must give the entries of the
  declared cashbook of the same rows (C1);
- a month is settled by the sealed ROLL-1 oracle (bank-roll-foundation):
  period_result for the matching and the case numbering, continuity and
  clear for the previous month's items (C4, C5, C6);
- the cases, their decisions and the sheet's items come from the sealed
  REPORT-1 oracle (bank-sheet-foundation: items_of and its cleared rule);
  the sections are ordered by the contract's own words, earlier periods
  first (C7);
- the queue is the sealed REVIEW-1 oracle's (bank-review-foundation),
  over the month's own cases that need a decision (C3);
- the policy's rules are the sealed TOL-1 oracle's refusal
  (bank-tolerance-foundation); eligibility and the all-or-none rule are
  written here on the ROLL-1 settlement, and test_oracle.py holds them to
  the TOL-1 oracle's judge on every month it can judge (C2, C7).

It never reads a story's recipe or intent and imports neither the
generator nor the product. --write stores EXPECTED.json.
"""
import argparse
import copy
import hashlib
import importlib.util
import json
import os
import sys
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
# A copy of this file elsewhere (the planted faults of mutate_oracle.py)
# names the audit directory and this package by CYCLE_AUDIT and CYCLE_HOME.
AUDIT = Path(os.environ.get('CYCLE_AUDIT', HERE.parent))
HOME = Path(os.environ.get('CYCLE_HOME', HERE))


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


roll = load('cycle_roll_oracle', AUDIT / 'bank-roll-foundation' / 'oracle.py')
sheets = load('cycle_sheet_oracle', AUDIT / 'bank-sheet-foundation' / 'oracle.py')
review = load('cycle_review_oracle', AUDIT / 'bank-review-foundation' / 'oracle.py')
maps = load('cycle_map_oracle', AUDIT / 'bank-map-foundation' / 'oracle.py')
tolerance = load('cycle_tolerance_oracle', AUDIT / 'bank-tolerance-foundation' / 'oracle.py')

WINDOW = json.loads((AUDIT / 'bank-statement-foundation' / 'contract.json').read_text(encoding='utf-8'))[
    'matching']['dateWindowDays']
DECIMALS = 2  # SAR, the only currency of these stories
ACCEPT_CARRIED = sheets.ACCEPT_CARRIED


class StoryError(Exception):
    """A story that does not stand: a step the contracts do not allow."""


def sha(data):
    return hashlib.sha256(data).hexdigest()


def days(a, b):
    return abs((date.fromisoformat(a) - date.fromisoformat(b)).days)


# ---- reading (C1) -----------------------------------------------------------

def declared_entries(period):
    """The declared cashbook's entries as the map oracle reads them."""
    return [{'voucher': r['voucher'], 'date': r['date'], 'description': r['description'],
             'reference': r['reference'], 'direction': 'in' if r['receipt'] else 'out',
             'amount': r['receipt'] or r['payment']} for r in period['cashbook']]


def read_ledger(step, period, ledger_path, saved_maps):
    """How the month's ledger is read: by hand, or by a saved map that fits
    or does not (then by hand). Its entries must be the declared cashbook's."""
    table = maps.read_table(ledger_path)
    ledger = step['ledger']
    out = {'by': ledger['by'], 'map': ledger.get('map'), 'misfit': None}
    choice = ledger
    if ledger['by'] == 'map':
        m = saved_maps.get(ledger['map'])
        if m is None:
            raise StoryError(f"no map saved as {ledger['map']}")
        problems = maps.fit(table, m)
        if problems:
            out['misfit'] = problems
            choice = ledger.get('then')
            if choice is None:
                raise StoryError('a saved map that does not fit, and no choice by hand after it')
        else:
            choice = {'by': 'map', 'header': m['header'],
                      'columns': {r: (m['columns'][r] or {}).get('column') for r in maps.ROLES}}
    if choice['by'] == 'hand':
        m = maps.by_hand(table, choice['header'], choice['columns'], choice.get('save'))
        if choice.get('save'):
            saved_maps[choice['save']] = m
            out['saved'] = choice['save']
    reading = maps.read(table, choice['header'], choice['columns'], DECIMALS)
    if reading['refused'] is not None:
        raise StoryError(f"the ledger is refused: {reading['refused']}")
    entries = [{k: e[k] for k in ('voucher', 'date', 'description', 'reference', 'direction', 'amount')}
               for e in reading['entries']]
    if entries != declared_entries(period):
        raise StoryError(f"{period['id']}: the ledger does not read as its declared cashbook")
    out.update(header=reading['header'], above=reading['above'], unread=reading['unread'],
               columns={r: choice['columns'][r] for r in maps.ROLES}, entries=len(entries))
    return out


# ---- the month ----------------------------------------------------------------

def numbered(base, cleared):
    """The month's cases in the lifecycle's numbering (bank-statement-roll-1
    caseNumbering): own automatic pairs, own review groups as period_result
    orders them, then carried cases in their carried items' order."""
    own = cleared['own']
    month = base['id']
    by_ref = [g for g in own['review'] if g['reason'] not in ('amount-date-suggestion', 'ambiguous-amount-date')]
    by_amount = [g for g in own['review'] if g['reason'] in ('amount-date-suggestion', 'ambiguous-amount-date')]
    by_amount.sort(key=lambda g: min([f'C:{c}' for c in g['cash']] + [f'S:{b}' for b in g['bank']]))
    cases = [{'kind': 'automatic', 'reason': 'reference', 'statement': [a[0]], 'cashbook': [a[1]], 'carried': [],
              'status': 'matched-automatic'} for a in own['auto']]
    cases += [{'kind': 'review', 'reason': g['reason'], 'statement': list(g['bank']), 'cashbook': list(g['cash']),
               'carried': [], 'status': 'needs-review'} for g in by_ref + by_amount]
    for c in cleared['cases']:
        current = [k.split(':', 1)[1] for k in c['current']]
        cases.append({'kind': 'carried', 'reason': c['reason'], 'carried': list(c['carried']),
                      'statement': [i for i in current if i in base['pages']],
                      'cashbook': [i for i in current if i not in base['pages']], 'status': 'needs-review'})
    for k, c in enumerate(cases):
        c['id'] = f'C{k + 1}'
        c['members'] = [f'{month}:{s}' for s in c['statement']] + [f'{month}:{v}' for v in c['cashbook']] + c['carried']
        c['decision'] = None
    return cases


def tolerate(cases, base, policy):
    """bank-tolerance-1 on the month's own cases (C2): only an own review
    case of reason amount-difference is eligible, never a carried case;
    the absolute differences are summed and, past the period limit, none
    is tolerated."""
    if policy is None:
        return None
    moves = {m['key']: m for m in base['movements']}
    entries = {e['voucher']: e for e in base['entries']}
    eligible = []
    for c in cases:
        if c['kind'] != 'review' or c['reason'] != 'amount-difference':
            continue
        s, e = moves[c['statement'][0]], entries[c['cashbook'][0]]
        amount = roll.cents(roll.bank.minor(s['withdrawal'] or s['deposit']))
        book = roll.cents(e['amount'])
        if days(s['date'], e['date']) <= WINDOW and abs(amount - book) <= policy['perItem']:
            eligible.append((c, amount, book, e['direction']))
    total = sum(abs(a - b) for _, a, b, _ in eligible)
    if total > policy['perPeriod']:
        return {'sum': total, 'cap': policy['perPeriod']}
    for c, a, b, direction in eligible:
        c.update(kind='tolerated', reason='within-tolerance', status='matched-tolerated',
                 amounts={'statement': a, 'cashbook': b, 'difference': a - b, 'direction': direction})
    return None


def queue(cases, base):
    """The REVIEW-1 queue over the month's own cases that need a decision
    (C3). Whether carried cases belong to it is not decided by any contract
    (contract.json, Y1), so they are left out of what is compared."""
    settled = {'held': False, 'movements': base['movements'], 'entries': base['entries'],
               'cases': [{'id': c['id'], 'kind': 'review', 'status': 'needs-review', 'reason': c['reason'],
                          'statement': c['statement'], 'cashbook': c['cashbook']}
                         for c in cases if c['kind'] == 'review' and c['decision'] is None]}
    return review.queue(settled)


def find(cases, wanted):
    key = sorted(wanted)
    found = [c for c in cases if sorted(c['members']) == key]
    if len(found) != 1:
        raise StoryError(f'no single case holds exactly {key}')
    return found[0]


def decide(case, kind):
    """The lifecycle's decisions, with bank-tolerance-1's on a tolerated case
    (T5): it may be rejected, never accepted."""
    if case['decision'] is not None:
        raise StoryError(f"case {case['id']} is already decided")
    if kind == 'accept':
        allowed = roll.ACCEPTABLE if case['kind'] == 'review' else ACCEPT_CARRIED if case['kind'] == 'carried' else set()
        if case['reason'] not in allowed:
            raise StoryError(f"{case['reason']} cannot be accepted")
        case.update(decision='accepted', status='matched-accepted')
    elif kind == 'reject':
        if case['kind'] == 'automatic':
            raise StoryError('an automatic pair is not decided')
        case.update(decision='rejected', status='rejected')
    else:
        raise StoryError(f'unknown decision {kind}')


def keys_of(month, m):
    return [f'{month}:{s}' for s in m['statement']] + [f'{month}:{v}' for v in m['cashbook']] + list(m['carried'])


def apply_decision(step, cases, base, month):
    if 'group' in step:
        g = step['group']
        wanted = [sorted(keys_of(month, m)) for m in g['cases']]
        groups = queue(cases, base)
        by_id = {c['id']: c for c in cases}
        found = [q for q in groups
                 if sorted(sorted(by_id[x['case']]['members']) for x in q['cases']) == sorted(wanted)]
        if len(found) != 1:
            raise StoryError(f'no group of the queue holds exactly {wanted}')
        if not found[0]['offers'][g['type']]:
            raise StoryError(f"the group does not offer {g['type']}")
        for x in found[0]['cases']:
            decide(by_id[x['case']], g['type'])
    else:
        kind = 'accept' if 'accept' in step else 'reject'
        decide(find(cases, keys_of(month, step[kind])), kind)


def view(cases):
    """The cases as the sealed REPORT-1 oracle reads them, a tolerated case
    clearing its members as an accepted one does (bank-tolerance-1
    sheet.cleared, C7)."""
    out = []
    for c in cases:
        if c['kind'] == 'automatic':
            continue
        decision = 'accepted' if c['kind'] == 'tolerated' and c['decision'] is None else c['decision']
        out.append({'kind': 'own' if c['kind'] != 'carried' else 'carried', 'reason': c['reason'],
                    'members': c['members'], 'decision': decision})
    return out


def items(settled, cases):
    """The sealed REPORT-1 items_of over that view."""
    return sheets.items_of(settled, view(cases))


def position(item, month):
    """REPORT-1 sheet.items: items of earlier periods first, then statement
    items in printed order and cashbook items in row order."""
    earlier = item['period'] != month
    return (0 if earlier else 1, item['date'] if earlier else '', 0 if item['side'] == 'statement' else 1,
            int(item['id'][1:]) if item['side'] == 'statement' else item['row'])


def sheet(settled, cases, book, policy):
    """REPORT-1's sheet of the month with bank-tolerance-1's section (T7)."""
    if settled['base']['held']:
        return {'refusal': 'SHEET_STATEMENT_HELD'}
    if settled['previous'] not in ('none', 'accepted'):
        return {'refusal': 'SHEET_PREVIOUS_REFUSED'}
    if book is None:
        return {'refusal': 'SHEET_NO_BOOK_BALANCE'}
    month = settled['current']['id'].split('-')[1]
    st = settled['current']['statement']
    closing = next((l['balance'], p['number']) for p in st['pages'] for l in p['lines'] if l['kind'] == 'closing')
    listed = items(settled, cases)
    sections = {}
    for name, side, direction in sheets.SECTIONS:
        chosen = sorted((i for i in listed if i['side'] == side and i['direction'] == direction),
                        key=lambda i: position(i, month))
        sections[name] = {'items': chosen, 'total': sum(i['amount'] for i in chosen)}
    adjusted_bank = closing[0] + sections['bookReceiptsNotOnStatement']['total'] - \
        sections['bookPaymentsNotOnStatement']['total']
    adjusted_book = book['balance'] + sections['statementDepositsNotInBook']['total'] - \
        sections['statementWithdrawalsNotInBook']['total']
    difference = adjusted_bank - adjusted_book
    tolerated = []
    for c in cases:
        if c['status'] == 'matched-tolerated':
            a = c['amounts']
            effect = a['statement'] - a['cashbook'] if a['direction'] == 'in' else a['cashbook'] - a['statement']
            tolerated.append({'case': c['id'], 'statement': c['statement'], 'cashbook': c['cashbook'],
                              'amounts': a, 'effect': effect})
    total = sum(t['effect'] for t in tolerated)
    unexplained = difference - total
    if any(i['origin'] == 'pending' for i in listed):
        status = 'draft'
    elif tolerated:
        status = 'reconciled-within-tolerance' if unexplained == 0 else 'difference'
    else:
        status = 'reconciled' if difference == 0 else 'difference'
    return {'refusal': None, 'status': status, 'bank': {'balance': closing[0], 'page': closing[1]},
            'book': book, 'sections': sections, 'adjustedBank': adjusted_bank, 'adjustedBook': adjusted_book,
            'difference': difference, 'toleratedDifferences': tolerated, 'tolerated': total,
            'unexplained': unexplained, 'policy': policy}


def carried_from(previous, current):
    """The previous month's session as the current one takes it (C4, C5,
    C6): refused while a case of it needs review or its statement does not
    run on; otherwise its outstanding items, one period end older."""
    if previous['refused']:
        return 'ROLL_PREVIOUS_UNREADABLE', []
    if previous['held']:
        return 'ROLL_PREVIOUS_HELD', []
    if previous['pending']:
        return 'ROLL_PREVIOUS_UNDECIDED', []
    problem = roll.continuity(previous['period'], current)
    if problem:
        return problem, []
    return 'accepted', copy.deepcopy(previous['outstanding'])


def evaluate(month_state, frozen, keep=False):
    """The month as it stands after its steps so far; with keep, the
    settlement and the cases too, for test_oracle.py."""
    period, previous = month_state['period'], month_state['previous']
    pid = period['id']
    month = pid.split('-')[1]
    statement = (frozen / f'{pid}-statement.pdf').read_bytes()
    ledger = (frozen / f'{pid}-ledger.xlsx').read_bytes()
    declared = (frozen / f'{pid}-cashbook.csv').read_bytes()
    shas = {'statement': sha(statement), 'cashbook': sha(ledger)}
    base = roll.period_result(period, declared, shas['statement'], shas['cashbook'], [], WINDOW)
    base['id'] = month
    verdict, carried = ('none', []) if previous is None else carried_from(previous, period)
    out = {'period': pid, 'previous': verdict, 'reading': month_state['reading'], 'policy': month_state['policy'],
           'refused': None}
    if month_state['policy'] is not None:
        rule = tolerance.refusal(month_state['policy'], DECIMALS)
        if rule:
            return dict(out, refused=f'TOLERANCE:{rule}')
    if base['held']:
        return dict(out, held=True)
    cleared = roll.clear(carried, period, base, WINDOW)
    settled = {'current': period, 'base': base, 'previous': verdict, 'carried': carried, 'shas': shas,
               'cleared': cleared}
    cases = numbered(base, cleared)
    exceeded = tolerate(cases, base, month_state['policy'])
    groups = queue(cases, base)
    for step in month_state['decisions']:
        apply_decision(step, cases, base, month)
    listed = items(settled, cases)
    pending = sum(1 for c in cases if c['status'] == 'needs-review')
    # The items this month leaves outstanding, as the next month carries
    # them (bank-statement-roll-1 carried.items, R3).
    rejected_by = {k: c['id'] for c in cases if c['status'] == 'rejected' for k in c['members']}
    by_item = {c['item']: c for c in carried}
    outstanding = []
    for i in listed:
        if i['origin'] == 'pending':
            continue
        if i['item'] in by_item:
            c = dict(by_item[i['item']], age=by_item[i['item']]['age'] + 1)
            outstanding.append(c)
        else:
            side = 'S' if i['side'] == 'statement' else 'C'
            origin = rejected_by[i['item']] if i['origin'] == 'rejected' else 'unmatched'
            outstanding.append(roll.item(period, base, side, i['id'], origin, 1,
                                         shas['statement' if side == 'S' else 'cashbook'], 'previous'))
    outstanding.sort(key=lambda c: (c['period'] != month, c['side'] != 'statement',
                                    int(c['id'][1:]) if c['side'] == 'statement' else c.get('row', 0)))
    final = sheet(settled, cases, month_state['book'], month_state['policy'])
    signoffs = {}
    for kind in ('prepared', 'reviewed'):
        if kind in month_state['signs']:
            who, content = month_state['signs'][kind]
            signoffs[kind] = {'name': who['name'], 'date': who['date'], 'valid': content == final}
        else:
            signoffs[kind] = None
    out.update(
        held=False,
        cases=[{k: c[k] for k in ('id', 'kind', 'reason', 'status', 'statement', 'cashbook', 'carried')}
               for c in cases],
        exceeded=exceeded,
        tolerated=[c['id'] for c in cases if c['status'] == 'matched-tolerated'],
        queue=[{'reason': g['reason'], 'class': g['class'], 'direction': g['direction'], 'shape':
                f"{g['statement']}:{g['cashbook']}", 'gap': g.get('gap'), 'cases': [x['case'] for x in g['cases']],
                'impact': g['impact'], 'offers': g['offers']} for g in groups],
        carried=[{k: c[k] for k in ('item', 'side', 'id', 'period', 'date', 'direction', 'amount', 'reference',
                                    'origin', 'age')} for c in carried],
        withheld=cleared['withheld'],
        still=[{'item': c['item'], 'age': c['age'] + 1} for c in cleared['still']],
        pending=pending,
        outstanding=[{k: c.get(k) for k in ('item', 'side', 'id', 'period', 'date', 'direction', 'amount',
                                            'reference', 'origin', 'age')} for c in outstanding],
        sheet=final,
        language=month_state['language'],
        signoffs=signoffs,
    )
    out['_carry'] = {'refused': False, 'held': False, 'pending': pending, 'period': period,
                     'outstanding': outstanding}
    if keep:
        out['_kept'] = {'settled': settled, 'cases': cases, 'base': base}
    return out


def judge(story, frozen, keep=False):
    periods = {p['id']: p for p in story['periods']}
    saved_maps, saved, out = {}, {}, {}
    state = None
    for step in story['steps']:
        if 'open' in step:
            period = periods[step['open']]
            previous = None
            if step.get('previous'):
                if step['previous'] not in saved:
                    raise StoryError(f"no session saved as {step['previous']}")
                previous = saved[step['previous']]
            reading = read_ledger(step, period, frozen / story['ledgers'][period['id']]['file'], saved_maps)
            state = {'period': period, 'previous': previous, 'reading': reading, 'policy': None, 'decisions': [],
                     'book': None, 'language': None, 'signs': {}}
        elif state is None:
            raise StoryError('a step before any month is open')
        elif 'policy' in step:
            if state['decisions']:
                raise StoryError('a policy declared after a decision refuses the session (T5)')
            state['policy'] = step['policy']
        elif 'accept' in step or 'reject' in step or 'group' in step:
            state['decisions'].append(step)
        elif 'book' in step:
            state['book'] = step['book']
        elif 'language' in step:
            state['language'] = step['language']
        elif 'prepare' in step or 'review' in step:
            kind = 'prepared' if 'prepare' in step else 'reviewed'
            now = evaluate(state, frozen)
            if now['refused'] or now['sheet']['refusal']:
                raise StoryError(f'{kind} on a refused sheet')
            state['signs'][kind] = (step['prepare' if kind == 'prepared' else 'review'], now['sheet'])
        elif 'save' in step:
            snapshot = evaluate(state, frozen, keep)
            carry = snapshot.pop('_carry', None)
            if keep:
                snapshot['_state'] = copy.deepcopy({k: v for k, v in state.items() if k != 'previous'})
            saved[step['save']] = carry or {'refused': True, 'held': False, 'pending': 0, 'period': state['period'],
                                            'outstanding': []}
            out[step['save']] = snapshot
        else:
            raise StoryError(f'unknown step {sorted(step)}')
    return out


def run(frozen, facts_path):
    facts = json.loads(Path(facts_path).read_text(encoding='utf-8'))
    return {'version': 'bank-cycle-foundation-oracle-1', 'window': WINDOW,
            'stories': {s['id']: judge(s, Path(frozen)) for s in facts['stories']}}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--frozen', default=str(HOME / 'frozen'))
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
