"""What the PAY-1 product adds beyond the contract, checked on the H1 files
without running the product: a name ending in .csv, a non-empty file of at
most 8 MiB, at most 20,000 records, at most 100 cells in a record and at
most 32,767 UTF-16 units in a cell. The bytes are decoded as the product
decodes them, strictly and with any byte-order mark kept until the reader
drops it (DEV-85), and split by the tokenizer in verify.py.

  PYTHONPATH= python3 -B audit/payroll-long-register-holdout-h1/eligibility.py frozen
"""
import json
import sys
from pathlib import Path

import verify


def check(path):
    raw = path.read_bytes()
    out = []
    if not path.name.lower().endswith('.csv'):
        out.append('name')
    if not raw or len(raw) > 8 * 1024 * 1024:
        out.append('size')
    try:
        text = raw.decode('utf-8')
    except UnicodeDecodeError:
        return out + ['not UTF-8: the contract refuses it before any bound']
    if text.startswith('\ufeff'):
        text = text[1:]
    rows, _ = verify.tokens(text if text.endswith(('\n', '\r')) else text + '\n')
    if len(rows) > 20000:
        out.append('records')
    if any(len(r) > 100 for r in rows):
        out.append('cells in a record')
    if any(len(t.encode('utf-16-le')) // 2 > 32767 for r in rows for t, _ in r):
        out.append('cell length')
    return out


def main(folder):
    folder = Path(folder)
    facts = json.loads((folder / 'stories.json').read_text(encoding='utf-8'))
    found = {s['id']: check(folder / s['file']['name']) for s in facts['stories']}
    result = {
        'schema': 'tarasuf-pay1-long-register-h1-eligibility/1',
        'checks': ['name', 'size', 'records', 'cells in a record', 'cell length'],
        'beyondContract': {k: v for k, v in found.items() if v},
    }
    (folder / 'ELIGIBILITY.json').write_text(json.dumps(result, indent=1) + '\n', encoding='utf-8')
    print(json.dumps(result, indent=1))


if __name__ == '__main__':
    main(sys.argv[1])
