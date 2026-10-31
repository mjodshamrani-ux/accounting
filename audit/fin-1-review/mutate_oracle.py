"""Review measure for the FIN-1A oracle, which is left as it is: plant one
fault at a time in a copy of oracle.py and run FIN-1A's own tests on the copy.
A fault counts as caught only when a test fails by assertion; a crash alone
is recorded apart. With --h1, each copy also meets the sealed FIN-1 H1 intents
(test_intent.py there), and with --review the review tests here
(test_review.py), so the record shows what each adds.

  python3 -B audit/fin-1-review/mutate_oracle.py [--h1] [--review] [--out results/oracle-mutants-N.json]
  python3 -B audit/fin-1-review/mutate_oracle.py --h1 --review --assert results/oracle-mutants-3.json

--assert reruns and fails unless every fault meets the same fate as in the
record: no fault newly missed, none newly caught without the record saying so.
"""
import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
FIN1A = HERE.parent / 'tb-financial-hierarchy'
H1 = HERE.parent / 'fin-hierarchy-holdout-h1'

FAULTS = [
    ('TB balance not checked', "    if debit != credit:\n        problem('TB_BALANCE')", "    if False:\n        problem('TB_BALANCE')"),
    ('debit and credit on one row allowed', 'if dr > 0 and cr > 0:', 'if dr > 0 and cr > 0 and False:'),
    ('negative debit allowed', "money(row, 'Debit', True)", "money(row, 'Debit')"),
    ('negative credit allowed', "money(row, 'Credit', True)", "money(row, 'Credit')"),
    ('three fraction digits read', r"(?:\.[0-9]{1,2})?'", r"(?:\.[0-9]{1,3})?'"),
    ('blank amount read as zero', "        value = row[field]\n        if not re", "        value = row[field] or '0'\n        if not re"),
    ('leading zeros allowed', "r'-?(?:0|[1-9][0-9]*)", "r'-?(?:[0-9]+)"),
    ('per-value money limit off', 'if abs(amount) > 100000000000000 or', 'if abs(amount) > 10 * 100000000000000 or'),
    ('unmapped account not reported', "        if key not in mapped:\n            problem('UNMAPPED_ACCOUNT', row)", "        if False:\n            problem('UNMAPPED_ACCOUNT', row)"),
    ('unmapped leaf not reported', "            problem('UNMAPPED_LEAF', row)", '            pass'),
    ('cycle not reported', "problem('CYCLE', row, 'Parent ID'); break", 'break'),
    ('depth limit one deeper', "if len(visited) > contract['limits']['treeDepth']:", "if len(visited) > contract['limits']['treeDepth'] + 1:"),
    ('depth not reported', "problem('DEPTH', row); break", 'break'),
    ('a leaf may own children', "if not owner or owner['Kind'] != 'parent':", 'if not owner:'),
    ('absent parent allowed', "if not owner or owner['Kind'] != 'parent':", "if owner and owner['Kind'] != 'parent':"),
    ('child class may differ from parent', "if owner['Line class'] != row['Line class']:", 'if False:'),
    ('control total not checked', "problem('CONTROL_TOTAL', row, 'Amount')", 'pass'),
    ('parents counted in categories', "if row['Kind'] == 'leaf' and row['Line class'] == classification and reported.get(node) is not None]", "if row['Kind'] != 'title' and row['Line class'] == classification and reported.get(node) is not None]"),
    ('empty parent allowed', "problem('EMPTY_PARENT', row)", 'pass'),
    ('title may carry an amount', "if parent or row['Amount'] or row['Line class']:", 'if parent:'),
    ('unknown kind read as leaf', "        if kind not in ('leaf', 'parent', 'title'):\n            problem('KIND', row, 'Kind'); continue", "        if kind not in ('leaf', 'parent', 'title'):\n            kind = 'leaf'"),
    ('unknown TB class allowed', "if row['Account class'] not in CATEGORIES:", 'if False:'),
    ('unknown line class allowed', "        if row['Line class'] not in CATEGORIES:\n            problem('CLASSIFICATION', row, 'Line class')\n        reported", "        if False:\n            problem('CLASSIFICATION', row, 'Line class')\n        reported"),
    ('proof account class not held to TB', "if account and account['Account class'] != proof['Account class']:", 'if False:'),
    ('proof line class and label not held to statement', "if line and (proof['Line class'] != line['Line class'] or proof['Line label'] != line['Line label']):", 'if False:'),
    ('proof label not held to statement', " or proof['Line label'] != line['Line label']):", '):'),
    ('proof account class may differ from its line class', "        if proof['Account class'] != proof['Line class']:\n            problem('CLASSIFICATION', proof, 'Line class')", "        if False:\n            problem('CLASSIFICATION', proof, 'Line class')"),
    ('validity start not checked', 'if start > period_start or end < period_end or start > end:', 'if end < period_end or start > end:'),
    ('validity end not checked', 'if start > period_start or end < period_end or start > end:', 'if start > period_start or start > end:'),
    ('validity measured at the period end only', "period_start = date.fromisoformat(contract['scope']['Period start'])", "period_start = date.fromisoformat(contract['scope']['Period end'])"),
    ('date lexeme not strict', "if not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}', value):", 'if False:'),
    ('proof reference not required', "problem('PROOF_REFERENCE', proof)", 'pass'),
    ('sign policy not checked on proof', "                problem('SIGN_POLICY', proof, 'Sign')", '                pass'),
    ('sign policy not checked on mapping', "                problem('SIGN_POLICY', row, 'Sign')", '                pass'),
    ('mapping sign not held to proof', "('Account ID', 'Complete dimensions', 'Line ID', 'Sign')", "('Account ID', 'Complete dimensions', 'Line ID')"),
    ('mapping line not held to proof', "('Account ID', 'Complete dimensions', 'Line ID', 'Sign')", "('Account ID', 'Complete dimensions', 'Sign')"),
    ('mapping dimensions not held to proof', "('Account ID', 'Complete dimensions', 'Line ID', 'Sign')", "('Account ID', 'Line ID', 'Sign')"),
    ('mapping may target a parent', "        if not node or node['Kind'] != 'leaf':\n            problem('MAPPING_TARGET', row, 'Line ID')", "        if not node:\n            problem('MAPPING_TARGET', row, 'Line ID')"),
    ('mapping may target an absent line', "        if not node or node['Kind'] != 'leaf':\n            problem('MAPPING_TARGET', row, 'Line ID')", "        if node and node['Kind'] != 'leaf':\n            problem('MAPPING_TARGET', row, 'Line ID')"),
    ('proof may cite a parent', "        if not line or line['Kind'] != 'leaf':\n            problem('PROOF_LINE', proof, 'Line ID')", "        if not line:\n            problem('PROOF_LINE', proof, 'Line ID')"),
    ('proof account need not exist', "            problem('PROOF_ACCOUNT', proof)", '            pass'),
    ('mapping account need not exist', "            problem('MAPPING_ACCOUNT', row)", '            pass'),
    ('missing proof not reported', "            problem('MISSING_PROOF', row)", '            pass'),
    ('unused proof not reported', "            problem('UNUSED_PROOF', proof)", '            pass'),
    ('leaf difference not reported', "                problem('LEAF_TOTAL', row, 'Amount')", '                pass'),
    ('credit-positive not turned', "(nets[key] if row['Sign'] == 'debit-positive' else -nets[key])", 'nets[key]'),
    ('statement equation not checked', "    if equation:\n        problem('STATEMENT_EQUATION')", "    if False:\n        problem('STATEMENT_EQUATION')"),
    ('row scope not checked', "            if any(row[field] != expected for field, expected in contract['scope'].items()):", '            if False:'),
    ('extra columns allowed', "if len(set(headers)) != len(headers) or set(headers) != set(wanted):", 'if len(set(headers)) != len(headers) or not set(wanted) <= set(headers):'),
    ('row width not checked', "            if len(cells) != len(headers):\n                problem('WIDTH', row); continue", '            if False:\n                pass'),
    ('row limit off', "if len(serialized) - 1 > contract['limits']['rowsPerSource']:", "if len(serialized) - 1 > 10 * contract['limits']['rowsPerSource']:"),
    ('field length limit off', "if len(value) > contract['limits']['fieldCharacters']:", 'if False:'),
    ('byte limit off', "if len(raw) > contract['limits']['sourceBytes']:", 'if False:'),
    ('duplicate node not reported', "nodes = unique(statements, lambda r: r['Node ID'], 'DUPLICATE_NODE')", "nodes = unique(statements, lambda r: r['Node ID'], 'IGNORED')"),
    ('duplicate account not reported', "accounts = unique(tb, account_key, 'DUPLICATE_ACCOUNT')", "accounts = unique(tb, account_key, 'IGNORED')"),
    ('duplicate mapping of one account not reported', "mapped = unique(mapping, account_key, 'DUPLICATE_MAPPING_ACCOUNT')", "mapped = unique(mapping, account_key, 'IGNORED')"),
    ('duplicate mapping ID not reported', "unique(mapping, lambda r: r['Mapping ID'], 'DUPLICATE_MAPPING_ID')", "unique(mapping, lambda r: r['Mapping ID'], 'IGNORED')"),
    ('duplicate proof ID not reported', "proof_ids = unique(proofs, lambda r: r['Evidence ID'], 'DUPLICATE_PROOF')", "proof_ids = unique(proofs, lambda r: r['Evidence ID'], 'IGNORED')"),
    ('second proof of one account not reported', "unique(proofs, account_key, 'DUPLICATE_PROOF_ACCOUNT')", "unique(proofs, account_key, 'IGNORED')"),
    ('account key without dimensions', "account_key = lambda r: (r['Account ID'], r['Complete dimensions'])", "account_key = lambda r: (r['Account ID'], '')"),
    ('blank identity allowed', "if not identity or (isinstance(identity, tuple) and not all(identity)):", 'if False:'),
    ('empty source not reported', "            problem('EMPTY_SOURCE', {'_source': source, '_row': 1})", '            pass'),
    ('no account not reported', "        problem('NO_ACCOUNT')", '        pass'),
    ('no financial leaf not reported', "        problem('NO_FINANCIAL_LEAF')", '        pass'),
    ('aggregate limit off', "if any(abs(value) > limit for value in values) or abs(total) > limit:", 'if any(abs(value) > limit for value in values):'),
    ('lenient CSV', 'newline=\'\'), strict=True))', 'newline=\'\'), strict=False))'),
    ('rejected rows left out of the inventory', "            inventory.append({'source': source, 'row': number, 'raw': cells})\n            if len(cells) != len(headers):\n                problem('WIDTH', row); continue", "            if len(cells) != len(headers):\n                problem('WIDTH', row); continue\n            inventory.append({'source': source, 'row': number, 'raw': cells})"),
    ('citation columns from zero', 'enumerate(zip(headers, cells), 1)', 'enumerate(zip(headers, cells), 0)'),
    ('first row cited as the header', 'enumerate(serialized[1:], 2)', 'enumerate(serialized[1:], 1)'),
]

# Only the intent agreement counts for H1: EXPECTED.json would catch any
# change of output, intended or not.
INTENT_ONLY = 'test_agrees_with_every_intent'
RUNNER = r'''
import json, sys, unittest
sys.path.insert(0, sys.argv[1])
suite = unittest.defaultTestLoader.discover(sys.argv[1], pattern=sys.argv[2])
if len(sys.argv) > 3:
    def keep(s):
        for t in s:
            if isinstance(t, unittest.TestSuite):
                yield from keep(t)
            elif sys.argv[3] in t.id():
                yield t
    suite = unittest.TestSuite(list(keep(suite)))
result = unittest.TestResult()
suite.run(result)
print(json.dumps({'run': result.testsRun, 'failures': [t.id() for t, _ in result.failures],
                  'errors': [t.id() for t, _ in result.errors]}))
'''


def run_tests(folder, pattern, only=None):
    out = subprocess.run([sys.executable, '-B', '-c', RUNNER, str(folder), pattern, *([only] if only else [])],
                         capture_output=True, text=True, timeout=600)
    return json.loads(out.stdout.strip().splitlines()[-1])


def h1_copy(tmp, oracle_text):
    """A copy of H1 whose test_intent.py loads the planted oracle."""
    target = tmp / 'h1'
    shutil.copytree(H1, target, ignore=shutil.ignore_patterns('__pycache__'))
    fin1a = tmp / 'tb-financial-hierarchy'
    (fin1a / 'oracle.py').write_text(oracle_text, encoding='utf-8')
    return target


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--h1', action='store_true')
    parser.add_argument('--review', action='store_true')
    parser.add_argument('--out')
    parser.add_argument('--assert', dest='record')
    args = parser.parse_args()
    source = (FIN1A / 'oracle.py').read_text(encoding='utf-8')
    rows = []
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        copy = tmp / 'tb-financial-hierarchy'
        shutil.copytree(FIN1A, copy, ignore=shutil.ignore_patterns('__pycache__'))
        clean = run_tests(copy, 'test_*.py')
        assert not clean['failures'] and not clean['errors'], clean
        if args.h1:
            h1 = h1_copy(tmp, source)
            clean_h1 = run_tests(h1, 'test_intent.py', INTENT_ONLY)
            assert not clean_h1['failures'] and not clean_h1['errors'], clean_h1
        if args.review:
            review = tmp / 'fin-1-review'
            review.mkdir()
            shutil.copy(HERE / 'test_review.py', review / 'test_review.py')
            clean_review = run_tests(review, 'test_review.py')
            assert not clean_review['failures'] and not clean_review['errors'], clean_review
        for name, before, after in FAULTS:
            assert source.count(before) == 1, (name, source.count(before))
            planted = source.replace(before, after)
            (copy / 'oracle.py').write_text(planted, encoding='utf-8')
            got = run_tests(copy, 'test_*.py')
            row = {'fault': name, 'fin1aFailures': len(got['failures']), 'fin1aErrors': len(got['errors']),
                   'fin1aCaught': bool(got['failures'])}
            if args.h1:
                got_h1 = run_tests(h1, 'test_intent.py', INTENT_ONLY)
                row.update(h1Failures=len(got_h1['failures']), h1Errors=len(got_h1['errors']),
                           h1Caught=bool(got_h1['failures']))
            if args.review:
                got_review = run_tests(review, 'test_review.py')
                row.update(reviewFailures=len(got_review['failures']), reviewErrors=len(got_review['errors']),
                           reviewCaught=bool(got_review['failures']))
            rows.append(row)
            print(json.dumps(row, ensure_ascii=False), flush=True)
        (copy / 'oracle.py').write_text(source, encoding='utf-8')
    report = {
        'schema': 'tarasuf-fin1-review-oracle-mutants/1',
        'oracle': 'audit/tb-financial-hierarchy/oracle.py, unchanged; each fault planted in a copy',
        'faults': len(rows),
        'fin1aCaught': sum(r['fin1aCaught'] for r in rows),
        'fin1aCrashOnly': [r['fault'] for r in rows if not r['fin1aCaught'] and r['fin1aErrors']],
        'fin1aMissed': [r['fault'] for r in rows if not r['fin1aCaught']],
        'rows': rows,
    }
    if args.h1:
        report['h1Caught'] = sum(r['h1Caught'] for r in rows)
        report['eitherCaught'] = sum(r['fin1aCaught'] or r['h1Caught'] for r in rows)
        report['bothMissed'] = [r['fault'] for r in rows if not r['fin1aCaught'] and not r['h1Caught']]
    if args.review:
        report['reviewCaught'] = sum(r['reviewCaught'] for r in rows)
        report['anyCaught'] = sum(r['fin1aCaught'] or r.get('h1Caught', False) or r['reviewCaught'] for r in rows)
        report['allMissed'] = [r['fault'] for r in rows
                               if not (r['fin1aCaught'] or r.get('h1Caught', False) or r['reviewCaught'])]
    summary = {k: v for k, v in report.items() if k != 'rows'}
    print(json.dumps(summary, ensure_ascii=False, indent=1))
    if args.record:
        recorded = json.loads((HERE / args.record).read_text(encoding='utf-8'))
        keys = [k for k in rows[0] if k.endswith('Caught')]
        then = [{'fault': r['fault'], **{k: r[k] for k in keys}} for r in recorded['rows']]
        now = [{'fault': r['fault'], **{k: r[k] for k in keys}} for r in rows]
        if then != now:
            print(json.dumps([(a, b) for a, b in zip(then, now) if a != b][:8], ensure_ascii=False))
            sys.exit(1)
    if args.out:
        (HERE / args.out).parent.mkdir(parents=True, exist_ok=True)
        (HERE / args.out).write_text(json.dumps(report, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
