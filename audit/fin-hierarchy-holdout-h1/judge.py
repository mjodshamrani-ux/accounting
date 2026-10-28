"""The FIN-1A oracle as it is, on each H1 story: audit/tb-financial-hierarchy/
oracle.py's evaluate() with FIN-1A's contract, its scope replaced by the
story's confirmed run scope and nothing else changed. It reads the four CSV
files and scope.json of each story folder, never stories.json.

  python3 -B audit/fin-hierarchy-holdout-h1/judge.py frozen > frozen/EXPECTED.json
"""
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
FIN1A = HERE.parent / 'tb-financial-hierarchy'
_spec = importlib.util.spec_from_file_location('fin1a_oracle', FIN1A / 'oracle.py')
oracle = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(oracle)


def judge(story_folder):
    contract = json.loads((FIN1A / 'contract.json').read_text(encoding='utf-8'))
    contract['scope'] = json.loads((Path(story_folder) / 'scope.json').read_text(encoding='utf-8'))
    result = oracle.evaluate(story_folder, contract)
    whole = json.dumps(result, sort_keys=True, ensure_ascii=False, separators=(',', ':'))
    return {
        'status': result['status'],
        'codes': sorted({i['code'] for i in result['issues']}),
        'issues': result['issues'],
        'facts': result['facts'],
        'ownership': result['ownership'],
        'sources': result['sources'],
        'inventoryRows': len(result['inventory']),
        'citations': len(result['citations']),
        'resultSha256': hashlib.sha256(whole.encode('utf-8')).hexdigest(),
    }


def run(folder):
    folder = Path(folder)
    stories = sorted(p.name for p in folder.iterdir() if p.is_dir())
    return {'oracle': 'audit/tb-financial-hierarchy/oracle.py, unchanged',
            'contract': 'audit/tb-financial-hierarchy/contract.json with the scope of each story',
            'stories': {sid: judge(folder / sid) for sid in stories}}


if __name__ == '__main__':
    print(json.dumps(run(sys.argv[1]), ensure_ascii=False, indent=1))
