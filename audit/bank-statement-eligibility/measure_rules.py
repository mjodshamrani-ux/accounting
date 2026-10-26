"""G21: the rules the eligibility tool counts against the rules the product
needed, by every recorded ablation.

scripts/bank-statement-holdout-ablation.mjs switches each of nine reader
rules off in a private copy of the product and runs a sealed package; a
statement the plain run completed or held, and the run without the rule
lost, needed the rule. For each such record, each rule and each statement it
kept, this reads whether the tool counts the rule for the statement:

  rows by ink               rowsByInk     lines the metric form refuses and today's does not (rows.py)
  rows by glyph boxes       rowsByGlyphs  lines the ink form refuses and today's does not (rows.py)
  visibility by ink         visibleByInk  runs visible by their ink and not by their font's box
  DR after its amount       drAfterAmount columns.py
  date runs joined          dateRuns      columns.py
  typed cashbook amounts    the cashbook check before G8 refuses the statement's XLSX cashbook (cashbook.py)

and names the three rules about drawings over text that the tool does not
model yet: drawing by ink, drawings by glyph boxes, and the rectangle traced
back to its start. It reads the tool and the recorded ablations only; the
product is not run.

  PYTHONPATH=<pymupdf 2.0, fontTools> python3 -B measure_rules.py [--out f.json | --assert f.json]
"""
import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE))
import cashbook  # noqa: E402
import eligibility  # noqa: E402

COUNTED = {
    'rows by ink': 'rowsByInk',
    'rows by glyph boxes': 'rowsByGlyphs',
    'visibility by ink': 'visibleByInk',
    'DR after its amount': 'drAfterAmount',
    'date runs joined': 'dateRuns',
    'typed cashbook amounts': 'typedAmounts',
}
NOT_MODELLED = ('drawing by ink', 'drawings by glyph boxes', 'rectangle traced back to its start')


def typed_amounts(frozen, sid):
    """1 where the statement's cashbook is an XLSX the check reads today and
    refuses with the reader's rules before G8, which read typed amounts as
    text."""
    book = frozen / f'{sid}-cashbook.xlsx'
    if not book.exists():
        return 0
    now = cashbook.check(str(book))
    before = cashbook.check(str(book), typed_amounts=False)
    return int(now['refused'] is None and before['refused'] is not None)


def measure():
    cache, checks = {}, []
    records = sorted((ROOT / 'audit').glob('bank-statement-holdout-*/results/diagnostic-ablation-*.json'))
    for record in records:
        ablation = json.loads(record.read_text(encoding='utf-8'))
        frozen = record.parent.parent / 'frozen'
        kept = ablation['plain']['positivesCompleted'] + ablation['plain'].get('heldCorrectly', [])
        for a in ablation['ablations']:
            lost = set(a['lostPositives']) | set(a.get('lostHeld', []))
            for sid in kept:
                key = frozen / f'{sid}-statement.pdf'
                if key not in cache:
                    counted = eligibility.counts(key)
                    counted['typedAmounts'] = typed_amounts(frozen, sid)
                    cache[key] = counted
                rule = COUNTED.get(a['rule'])
                checks.append({
                    'record': str(record.relative_to(ROOT)),
                    'rule': a['rule'],
                    'statement': sid,
                    'productNeeds': sid in lost,
                    'counts': None if rule is None else cache[key].get(rule, 0) > 0,
                })
    summary = {}
    for rule in list(COUNTED) + list(NOT_MODELLED):
        mine = [c for c in checks if c['rule'] == rule]
        needs = sorted({c['statement'] for c in mine if c['productNeeds']})
        if rule in COUNTED:
            summary[rule] = {
                'asAblations': f"{sum(c['counts'] == c['productNeeds'] for c in mine)}/{len(mine)}",
                'productNeeds': needs,
                'countedNotNeeded': sorted({c['statement'] for c in mine if c['counts'] and not c['productNeeds']}),
                'neededNotCounted': sorted({c['statement'] for c in mine if c['productNeeds'] and not c['counts']}),
            }
        else:
            summary[rule] = {'asAblations': 'not modelled', 'productNeeds': needs}
    return {
        'schema': 'tarasuf-bnk-pdf1-rules-vs-ablations/1',
        'question': 'Does the eligibility tool count, before the seal, each reader rule a statement needed by the recorded ablations?',
        'records': [str(r.relative_to(ROOT)) for r in records],
        'statements': len(cache),
        'checks': checks,
        'summary': summary,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out')
    ap.add_argument('--assert', dest='recorded')
    a = ap.parse_args()
    report = measure()
    text = json.dumps(report, indent=1, ensure_ascii=False) + '\n'
    if a.out:
        Path(a.out).write_text(text, encoding='utf-8')
    if a.recorded and json.loads(Path(a.recorded).read_text(encoding='utf-8')) != report:
        print(text, file=sys.stderr)
        raise SystemExit(f'the tool no longer counts as recorded in {a.recorded}')
    print(json.dumps(report['summary'], ensure_ascii=False))


if __name__ == '__main__':
    main()
