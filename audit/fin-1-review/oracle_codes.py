"""The FIN-1A oracle as it is on FIN-1A's 18 frozen cases, with FIN-1A's
contract: status, every code, facts and ownership, for the engine run to
bound the engine's codes. H1's are its sealed EXPECTED.json.

  python3 -B audit/fin-1-review/oracle_codes.py
"""
import importlib.util
import json
from pathlib import Path

FIN1A = Path(__file__).resolve().parent.parent / 'tb-financial-hierarchy'
_spec = importlib.util.spec_from_file_location('fin1a_oracle', FIN1A / 'oracle.py')
oracle = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(oracle)

if __name__ == '__main__':
    cases = json.loads((FIN1A / 'frozen' / 'cases.json').read_text(encoding='utf-8'))['cases']
    out = {}
    for case in cases:
        r = oracle.evaluate(FIN1A / 'frozen' / case['id'])
        out[case['id']] = {'status': r['status'], 'codes': sorted({i['code'] for i in r['issues']}),
                           'facts': r['facts'], 'ownership': r['ownership']}
    print(json.dumps(out, ensure_ascii=False, indent=1))
