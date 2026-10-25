"""EXPECTED.json for the G14 holdout, from the foundation's independent oracle.

  python3 -B audit/bank-statement-holdout-g14/stories.py > stories.json
  python3 -B expected.py --frozen frozen --facts stories.json [--write]

audit/bank-statement-foundation/oracle.py is used unchanged. It takes one
period per facts file, and each holdout statement has its own, so it runs
story by story on a facts file holding that story and its period. It reads
the printed lines, the cashbook CSV and the contract; never `recipe` or
`intent`. Each result must agree with the designer's hand-written intent.
"""
import argparse
import json
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'bank-statement-foundation'))
import oracle  # noqa: E402


def run(frozen, facts_path):
    facts = json.loads(Path(facts_path).read_text(encoding='utf-8'))
    results, disagreements = [], {}
    with tempfile.TemporaryDirectory() as tmp:
        for story in facts['stories']:
            one = dict(facts, period=story['statement']['period'], stories=[story])
            path = Path(tmp) / f"{story['id']}.json"
            path.write_text(json.dumps(one, ensure_ascii=False), encoding='utf-8')
            result = oracle.run(frozen, path)['stories'][0]
            result['period'] = story['statement']['period']
            results.append(result)
            problems = oracle.agrees_with_intent(result, story)
            if problems:
                disagreements[story['id']] = problems
    contract = json.loads((HERE.parent / 'bank-statement-foundation' / 'contract.json').read_text(encoding='utf-8'))
    expected = {'schema': 'tarasuf-bnk-pdf1-holdout-expected/1', 'contract': contract['schema'],
                'oracle': 'audit/bank-statement-foundation/oracle.py, one story and its period at a time',
                'dateWindowDays': contract['matching']['dateWindowDays'], 'stories': results}
    return expected, disagreements


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--frozen', default=str(HERE / 'frozen'))
    parser.add_argument('--facts', required=True)
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    expected, disagreements = run(args.frozen, args.facts)
    if args.write:
        (Path(args.frozen) / 'EXPECTED.json').write_text(oracle.dumps(expected), encoding='utf-8')
    print(json.dumps({'stories': [(r['id'], r['statement'], len(r.get('auto', [])), [g['reason'] for g in r.get('review', [])],
                                   len(r.get('bankOnly', [])), len(r.get('cashOnly', [])), len(r.get('timing', [])))
                                  for r in expected['stories']], 'disagreeWithIntent': disagreements},
                     ensure_ascii=False, default=str))
    raise SystemExit(1 if disagreements else 0)
