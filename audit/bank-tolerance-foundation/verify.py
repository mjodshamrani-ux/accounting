"""Independent check of the TOL-1 statement PDFs with pdfminer.six, as the
REVIEW-1 foundation checks its own: through the sealed ROLL-1 foundation's
check (verify.check), unchanged. A statement in a currency of another
exponent (KWD, three decimals) goes through the same check with its amounts
formatted to that exponent instead of two. And the sign of every balance of
an English-layout statement. Then a self-test: the check must fail when one
printed fact the tolerance reads (an amount, a date, a reference) differs
from its page.

  node audit/bank-tolerance-foundation/stories.mjs > stories.json
  PYTHONPATH=<pdfminer.six> python3 -B audit/bank-tolerance-foundation/verify.py frozen stories.json
"""
import copy
import hashlib
import importlib.util
import json
import re
import sys
from contextlib import contextmanager
from decimal import Decimal
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location('bank_roll_verify', HERE.parent / 'bank-roll-foundation' / 'verify.py')
roll = importlib.util.module_from_spec(_spec)  # the sealed ROLL-1 PDF check
_spec.loader.exec_module(roll)

EXPONENT = {'SAR': 2, 'KWD': 3}


def formats(exponent):
    """money and balance_text as the sealed checker writes them, to another
    exponent: thousands with commas, the point, `exponent` decimals."""
    def money(minor):
        if not minor:
            return ''
        whole, frac = f'{Decimal(abs(minor)).scaleb(-exponent):.{exponent}f}'.split('.')
        return ('-' if minor < 0 else '') + f'{int(whole):,}' + '.' + frac

    def balance_text(minor):
        return money(-minor) + ' DR' if minor < 0 else (money(minor) or f'{0:.{exponent}f}')
    return money, balance_text


@contextmanager
def exponent_of(currency):
    """The sealed checker as it is for two decimals; for another exponent, its
    two formatting functions replaced for the duration of the check."""
    if EXPONENT[currency] == 2:
        yield
        return
    saved = roll.bank.money, roll.bank.balance_text
    roll.bank.money, roll.bank.balance_text = formats(EXPONENT[currency])
    try:
        yield
    finally:
        roll.bank.money, roll.bank.balance_text = saved


def currency(period):
    return period['statement']['currency']


def signs(folder, facts):
    """Every printed balance of an English-layout statement with its sign."""
    out = []
    for story in facts['stories']:
        if story['layout'] != 'en':
            continue
        for p in story['periods']:
            money = formats(EXPONENT[currency(p)])[0]
            texts = roll.bank.page_texts(Path(folder) / f"{p['id']}-statement.pdf")
            for page, text in zip(p['statement']['pages'], texts):
                flat = ' '.join(text.split())
                for line in page['lines']:
                    if 'balance' not in line:
                        continue
                    amount = re.escape(money(abs(line['balance'])) or formats(EXPONENT[currency(p)])[1](0))
                    pattern = rf'(?<![\d,.]){amount} DR' if line['balance'] < 0 else rf'(?<![\d,.]){amount}(?! DR)(?![\d])'
                    if not re.search(pattern, flat):
                        out.append(f"{p['id']} page {page['number']}: {line.get('key', line['kind'])} balance sign")
    return out


def check(folder, facts):
    """The sealed check on the statements of each currency, merged."""
    report = None
    for code in sorted({currency(p) for s in facts['stories'] for p in s['periods']}):
        part = copy.deepcopy(facts)
        part['stories'] = [dict(s, periods=[p for p in s['periods'] if currency(p) == code]) for s in part['stories']]
        part['stories'] = [s for s in part['stories'] if s['periods']]
        with exponent_of(code):
            r = roll.check(folder, part)
        if report is None:
            report = {k: v for k, v in r.items() if k not in ('statements', 'ok', 'factsSha256')}
            report['statements'] = []
        report['statements'] += r['statements']
    report['statements'].sort(key=lambda s: s['id'])
    report['signs'] = signs(folder, facts)
    report['ok'] = all(s['ok'] for s in report['statements']) and not report['signs']
    return report


def self_test(folder, facts):
    def period(f, pid):
        return next(p for s in f['stories'] for p in s['periods'] if p['id'] == pid)

    def first(p, cond):
        return next(l for pg in p['statement']['pages'] for l in pg['lines'] if l['kind'] == 'movement' and cond(l))

    def bump(p, cond, field, by):
        line = first(p, cond)
        line[field] = line[field] + by
    plants = [
        ('T01-DEC', 'the tolerated transfer one halala off',
         lambda p: bump(p, lambda l: l['reference'] == 'INV-T01-101', 'withdrawal', 1)),
        ('T07-DEC', 'the Kuwaiti transfer one fils off',
         lambda p: bump(p, lambda l: l['reference'] == 'INV-T07-701', 'withdrawal', 1)),
        ('T07-DEC', 'the Kuwaiti receipt nine fils off',
         lambda p: bump(p, lambda l: l['reference'] == 'RCV-T07-702', 'deposit', -9)),
        ('T19-DEC', 'an Arabic tolerated payment one halala off',
         lambda p: bump(p, lambda l: l['reference'] == 'INV-T19-1903', 'withdrawal', 1)),
        ('T20-DEC', "the tolerated movement's reference changed",
         lambda p: first(p, lambda l: l['reference'] == 'INV-T20-2001').update(reference='INV-T20-2002')),
        ('T12-DEC', "the late cheque's date moved into the window",
         lambda p: first(p, lambda l: l['reference'] == 'CHQ-T12-1201').update(date='2026-12-11')),
    ]
    out = []
    for pid, name, change in plants:
        data = copy.deepcopy(facts)
        before = json.dumps(period(data, pid), sort_keys=True)
        change(period(data, pid))
        assert json.dumps(period(data, pid), sort_keys=True) != before, name
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
