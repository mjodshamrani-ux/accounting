"""Independent check of the REVIEW-1 statement PDFs with pdfminer.six, as the
REPORT-1 foundation checks its own (this file is its verify.py with these
plants): through the sealed ROLL-1 foundation's check (verify.check),
unchanged, and the sign of every balance of an English-layout statement.
Then a self-test: the check must fail when one printed fact the queue reads
(an amount, a date, a reference) differs from its page.

  node audit/bank-review-foundation/stories.mjs > stories.json
  PYTHONPATH=<pdfminer.six> python3 -B audit/bank-review-foundation/verify.py frozen stories.json
"""
import copy
import hashlib
import importlib.util
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location('bank_roll_verify', HERE.parent / 'bank-roll-foundation' / 'verify.py')
roll = importlib.util.module_from_spec(_spec)  # the sealed ROLL-1 PDF check
_spec.loader.exec_module(roll)


def signs(folder, facts):
    """Every printed balance of an English-layout statement with its sign."""
    out = []
    for story in facts['stories']:
        if story['layout'] != 'en':
            continue
        for p in story['periods']:
            texts = roll.bank.page_texts(Path(folder) / f"{p['id']}-statement.pdf")
            for page, text in zip(p['statement']['pages'], texts):
                flat = ' '.join(text.split())
                for line in page['lines']:
                    if 'balance' not in line:
                        continue
                    amount = re.escape(roll.bank.money(abs(line['balance'])) or '0.00')
                    pattern = rf'(?<![\d,.]){amount} DR' if line['balance'] < 0 else rf'(?<![\d,.]){amount}(?! DR)(?![\d])'
                    if not re.search(pattern, flat):
                        out.append(f"{p['id']} page {page['number']}: {line.get('key', line['kind'])} balance sign")
    return out


def check(folder, facts):
    report = roll.check(folder, facts)
    report['signs'] = signs(folder, facts)
    report['ok'] = report['ok'] and not report['signs']
    return report


def self_test(folder, facts):
    def period(f, pid):
        return next(p for s in f['stories'] for p in s['periods'] if p['id'] == pid)

    def first(p, kind, cond=lambda l: True):
        return next(l for pg in p['statement']['pages'] for l in pg['lines'] if l['kind'] == kind and cond(l))
    def bump(p, cond, field, by):
        line = first(p, 'movement', cond)
        line[field] = line[field] + by
    plants = [
        ('Q01-NOV', 'an unreferenced withdrawal of a suggestion one halala off',
         lambda p: bump(p, lambda l: l['reference'] == '' and l['withdrawal'], 'withdrawal', 1)),
        ('Q05-NOV', "a date-gap cheque's date moved a day",
         lambda p: first(p, 'movement', lambda l: l['reference'].startswith('CHQ-Q05N')).update(date='2026-11-18')),
        ('Q02-NOV', 'a repeated reference changed on one of its movements',
         lambda p: first(p, 'movement', lambda l: l['reference'] == 'CHQ-Q02-504').update(reference='CHQ-Q02-505')),
        ('Q10-NOV', 'an Arabic unreferenced withdrawal one halala off',
         lambda p: bump(p, lambda l: l['reference'] == '' and l['withdrawal'], 'withdrawal', 1)),
        ('Q16-NOV', 'the large suggestion read as another amount',
         lambda p: bump(p, lambda l: l['reference'] == '', 'withdrawal', 100)),
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
                      'signs': report['signs'][:5],
                      'selfTest': report['selfTest']}, ensure_ascii=False))
    if not report['passed']:
        sys.exit(1)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
