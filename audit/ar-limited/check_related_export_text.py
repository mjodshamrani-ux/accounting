"""Exact metadata plus existing independent money/membership oracles."""
import importlib.util
import json
from pathlib import Path
import re
import sys


def load(domain):
    path = Path(__file__).resolve().parent.parent / domain / 'check_export.py'
    spec = importlib.util.spec_from_file_location('oracle_' + domain.replace('-', '_'), path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def check(out):
    out = Path(out)
    expected = json.loads((out / 'expected.json').read_text(encoding='utf-8'))['name']
    for domain in ['clearing', 'bank', 'gl-tb']:
        oracle = load(domain)
        path = out / (domain + '.xlsx')
        oracle.verify(path)
        book = oracle.sheets(path)
        if domain == 'clearing':
            raw = dict(book['Summary'][1:])['Source name']
        else:
            column = 'Name' if domain == 'bank' else 'Source name'
            raw = book['Sources'][1][book['Sources'][0].index(column)]
        actual = re.sub(r'_x([0-9a-fA-F]{4})_', lambda m: chr(int(m[1], 16)), raw)
        assert actual == expected, (domain, actual, expected)
    return {'verified': True, 'workbooks': 3, 'exactText': True,
            'reader': 'Python stdlib ZIP/XML and frozen independent financial oracles'}


if __name__ == '__main__':
    assert len(sys.argv) == 2
    print(json.dumps(check(sys.argv[1])))
