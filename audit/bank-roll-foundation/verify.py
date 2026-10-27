"""Independent check of the ROLL-1 statement PDFs with pdfminer.six, through
the sealed bank statement foundation's checker (verify_assets.check),
unchanged: every period's statement is one statement there, named by its
period. Then a self-test: the check must fail when one printed fact differs
from its page.

  node audit/bank-roll-foundation/stories.mjs > stories.json
  PYTHONPATH=<pdfminer.six> python3 -B audit/bank-roll-foundation/verify.py frozen stories.json
"""
import copy
import hashlib
import json
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'bank-statement-foundation'))
import verify_assets as bank  # noqa: E402  the sealed bank statement checker


def as_bank_facts(facts):
    """One bank-foundation story per period: its printed statement, named
    by the period, in the story's layout."""
    return {'stories': [{'id': p['id'], 'layout': s['layout'], 'statement': p['statement']}
                        for s in facts['stories'] for p in s['periods']]}


def check(folder, facts):
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / 'periods.json'
        path.write_text(json.dumps(as_bank_facts(facts), ensure_ascii=False), encoding='utf-8')
        return bank.check(folder, path)


def self_test(folder, facts):
    def period(f, pid):
        return next(p for s in f['stories'] for p in s['periods'] if p['id'] == pid)

    def first(p, kind, cond=lambda l: True):
        return next(l for pg in p['statement']['pages'] for l in pg['lines'] if l['kind'] == kind and cond(l))
    plants = [
        ('R01-AUG', 'a carried cheque presented one halala off',
         lambda p: first(p, 'movement', lambda l: l['withdrawal']).update(withdrawal=first(p, 'movement', lambda l: l['withdrawal'])['withdrawal'] + 1)),
        ('R20-AUG', 'an Arabic reference changed', lambda p: first(p, 'movement').update(reference=first(p, 'movement')['reference'] + 'X')),
        ('R13-AUG', 'the opening balance the continuity check reads', lambda p: first(p, 'opening').update(balance=first(p, 'opening')['balance'] + 10000)),
        ('R13-JUL', 'the closing balance the continuity check reads', lambda p: first(p, 'closing').update(balance=first(p, 'closing')['balance'] - 1)),
    ]
    out = []
    for pid, name, change in plants:
        data = copy.deepcopy(facts)
        change(period(data, pid))
        story = next(s for s in data['stories'] if any(p['id'] == pid for p in s['periods']))
        story['periods'] = [p for p in story['periods'] if p['id'] == pid]
        data['stories'] = [story]
        out.append({'period': pid, 'plant': name, 'rejected': not check(folder, data)['ok']})
    return out


def main(folder, facts_path):
    facts_bytes = Path(facts_path).read_bytes()
    facts = json.loads(facts_bytes)
    report = check(folder, facts)
    report['factsSha256'] = hashlib.sha256(facts_bytes).hexdigest()
    report['selfTest'] = self_test(folder, facts)
    report['passed'] = report['ok'] and all(p['rejected'] for p in report['selfTest'])
    (Path(folder) / 'VERIFY.json').write_text(json.dumps(report, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(json.dumps({'passed': report['passed'], 'statements': len(report['statements']),
                      'values': sum(s['valuesFound'] for s in report['statements']),
                      'problems': [(s['id'], s['problems'][:2]) for s in report['statements'] if not s['ok']],
                      'selfTest': report['selfTest']}, ensure_ascii=False))
    if not report['passed']:
        sys.exit(1)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
