"""WF-1 REVIEW-1 foundation oracle: the review queue of a bank statement
period, and what group decisions do, from the files and the contract alone.

  python3 -B audit/bank-review-foundation/oracle.py [--frozen frozen] [--write]

It reads each story's printed facts and the cashbook files under frozen/,
takes the period as the sealed ROLL-1 oracle settles it
(audit/bank-roll-foundation/oracle.py, period_result: the bank statement
foundation's matching, the cases in the product's numbering, and decisions
applied as bank-statement-lifecycle-1 applies them), and builds the queue
and the group decisions from contract.json. It never reads a story's recipe
or intent and imports neither the generator nor the product.
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
# The sealed ROLL-1 foundation; a copy of this file elsewhere (the planted
# faults of mutate_oracle.py) names it by ROLL_FOUNDATION.
ROLL = Path(os.environ.get('ROLL_FOUNDATION', HERE.parent / 'bank-roll-foundation'))
_spec = importlib.util.spec_from_file_location('bank_roll_foundation_oracle', ROLL / 'oracle.py')
roll = importlib.util.module_from_spec(_spec)  # the sealed ROLL-1 oracle
_spec.loader.exec_module(roll)

CONTRACT = json.loads((HERE / 'contract.json').read_text(encoding='utf-8'))
QUEUE = CONTRACT['queue']
REASON_ORDER = QUEUE['reasonOrder']
EXCEPTIONS = {r.strip() for r in QUEUE['classes']['exception'].split(':', 1)[1].split(',')}
SUGGESTIONS = {r.strip() for r in QUEUE['classes']['suggestion'].split(':', 1)[1].split(',')}
assert EXCEPTIONS | SUGGESTIONS == set(REASON_ORDER) and not EXCEPTIONS & SUGGESTIONS
assert SUGGESTIONS == set(roll.ACCEPTABLE)


class StoryError(Exception):
    """An action the contract does not offer: the story is wrong, not the queue."""


def sha(data):
    return hashlib.sha256(data).hexdigest()


def settle(story, frozen, window, decisions, cashbook=None):
    period = story['periods'][-1]
    statement = (frozen / f"{period['id']}-statement.pdf").read_bytes()
    cash = (frozen / (cashbook or f"{period['id']}-cashbook.csv")).read_bytes()
    return roll.period_result(period, cash, sha(statement), sha(cash), decisions, window)


def evidence(settled, case):
    """What a case rests on: its members' amounts and directions, and the
    days between a date-gap pair."""
    moves = {m['key']: m for m in settled['movements']}
    entries = {e['voucher']: e for e in settled['entries']}
    s = [moves[k] for k in case['statement']]
    c = [entries[v] for v in case['cashbook']]
    directions = {'out' if m['withdrawal'] else 'in' for m in s} | {e['direction'] for e in c}
    total_s = sum(m['withdrawal'] or m['deposit'] for m in s)
    total_c = sum(roll.cents(e['amount']) for e in c)
    out = {
        'reason': case['reason'],
        'direction': '+'.join(sorted(directions)),
        'statement': len(s),
        'cashbook': len(c),
        'impact': max(total_s, total_c),
    }
    if case['reason'] == 'date-gap':
        out['gap'] = abs((date.fromisoformat(s[0]['date']) - date.fromisoformat(c[0]['date'])).days)
    return out


def signature(ev):
    return '|'.join([ev['reason'], ev['direction'], f"{ev['statement']}:{ev['cashbook']}", str(ev.get('gap', ''))])


def queue(settled):
    """The groups of the cases needing a decision, in the contract's order."""
    if settled['held']:
        return []
    groups = {}
    for case in settled['cases']:
        if case['kind'] != 'review' or case['status'] != 'needs-review':
            continue
        ev = evidence(settled, case)
        key = signature(ev)
        g = groups.setdefault(key, {
            'signature': key,
            'reason': ev['reason'],
            'class': 'exception' if ev['reason'] in EXCEPTIONS else 'suggestion',
            'direction': ev['direction'],
            'statement': ev['statement'],
            'cashbook': ev['cashbook'],
            **({'gap': ev['gap']} if 'gap' in ev else {}),
            'cases': [],
        })
        g['cases'].append({'case': case['id'], 'statement': list(case['statement']),
                           'cashbook': list(case['cashbook']), 'impact': ev['impact']})
    out = []
    for g in groups.values():
        g['cases'].sort(key=lambda c: (-c['impact'], int(c['case'][1:])))
        g['impact'] = max(c['impact'] for c in g['cases'])
        g['members'] = sum(len(c['statement']) + len(c['cashbook']) for c in g['cases'])
        g['offers'] = {'accept': len(g['cases']) >= 2 and g['class'] == 'suggestion',
                       'reject': len(g['cases']) >= 2}
        out.append(g)
    out.sort(key=lambda g: (0 if g['class'] == 'exception' else 1, -g['impact'], -g['members'],
                            REASON_ORDER.index(g['reason']), g['signature']))
    return out


def holding(settled, statement, cashbook):
    found = [c for c in settled['cases'] if c['kind'] == 'review'
             and sorted(c['statement']) == sorted(statement) and sorted(c['cashbook']) == sorted(cashbook)]
    if len(found) != 1:
        raise StoryError(f'no single case holds {statement} {cashbook}')
    return found[0]


def record(decisions, settled, case, kind):
    decisions.append({'id': f'D{len(decisions) + 1}', 'type': kind, 'context': settled['context'],
                      'case': case['id'], 'statement': list(case['statement']),
                      'cashbook': list(case['cashbook']), 'note': 'synthetic foundation decision'})


def judge(story, frozen, window):
    settled = settle(story, frozen, window, [])
    first = queue(settled)
    out = {
        'held': settled['held'],
        'queue': first,
        'actions': {'single': sum(len(g['cases']) for g in first), 'grouped': len(first)},
    }
    decisions = []
    cashbook = None
    for action in story['actions']:
        if settled['held']:
            raise StoryError('a held statement has no case to decide')
        if 'group' in action:
            a = action['group']
            current = queue(settled)
            found = [g for g in current
                     if any(a['with'] in c['statement'] + c['cashbook'] for c in g['cases'])]
            if len(found) != 1:
                raise StoryError(f"no group holds {a['with']}")
            g = found[0]
            if not g['offers'][a['type']]:
                raise StoryError(f"a group {a['type']} is not offered for {g['signature']}")
            by_id = {c['id']: c for c in settled['cases']}
            for c in g['cases']:
                record(decisions, settled, by_id[c['case']], a['type'])
        elif 'decide' in action:
            a = action['decide']
            record(decisions, settled, holding(settled, a['statement'], a['cashbook']), a['type'])
        elif 'undo' in action:
            a = action['undo']
            case = holding(settled, a['statement'], a['cashbook'])
            if case['decision'] is None:
                raise StoryError('undo of an undecided case')
            record(decisions, settled, case, 'undo')
        elif 'replace' in action:
            cashbook = f"{story['periods'][-1]['id']}-cashbook-corrected.csv"
        else:
            raise StoryError(f'unknown action {sorted(action)}')
        if cashbook:
            fresh = settle(story, frozen, window, [], cashbook)
            if any(d['context'] != fresh['context'] for d in decisions):
                out['refusal'] = 'BANK_STATEMENT_DECISION'
                out['decisions'] = [[d['type'], d['case']] for d in decisions]
                return out
            settled = settle(story, frozen, window, decisions, cashbook)
        else:
            settled = settle(story, frozen, window, decisions)
    reviews = [c for c in settled['cases'] if c['kind'] == 'review']
    out['refusal'] = None
    out['decisions'] = [[d['type'], d['case']] for d in decisions]
    out['statuses'] = {c['id']: c['status'] for c in reviews}
    out['after'] = {
        'accepted': sum(c['status'] == 'accepted' for c in reviews),
        'rejected': sum(c['status'] == 'rejected' for c in reviews),
        'open': sum(c['status'] == 'needs-review' for c in reviews),
    }
    out['queueAfter'] = queue(settled)
    return out


def run(frozen, facts_path):
    facts = json.loads(Path(facts_path).read_text(encoding='utf-8'))
    window = json.loads((roll.BANK / 'contract.json').read_text())['matching']['dateWindowDays']
    return {'version': 'bank-review-foundation-oracle-1',
            'stories': {s['id']: judge(copy.deepcopy(s), Path(frozen), window) for s in facts['stories']}}


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
