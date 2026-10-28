"""What the inventory family adds beyond the contract, checked on the four
files of each INV-3 H1 story without running the product: a name ending in
.csv, a non-empty file of at most 8 MiB, at most 100 cells in a record, at
most 32,767 UTF-16 units in a cell, and four files with four different
hashes. The bytes are decoded as the product decodes them, strictly and with
any byte-order mark kept until the reader drops it (DEV-85), and split by the
tokenizer in verify.py. The 20,000-record budget across the four files is the
contract's, and the oracle refuses a story over it.

  PYTHONPATH= python3 -B audit/inventory-links-holdout-h1/eligibility.py frozen
"""
import hashlib
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
    if any(len(r) > 100 for r in rows):
        out.append('cells in a record')
    if any(len(t.encode('utf-16-le')) // 2 > 32767 for r in rows for t, _ in r):
        out.append('cell length')
    return out


def main(folder):
    folder = Path(folder)
    facts = json.loads((folder / 'stories.json').read_text(encoding='utf-8'))
    found = {}
    for story in facts['stories']:
        names = [f['name'] for f in story['files'].values()]
        for name in names:
            found[name] = check(folder / name)
        if len({hashlib.sha256((folder / n).read_bytes()).hexdigest() for n in names}) != len(names):
            found[story['id']] = ['four different files']
    result = {
        'schema': 'tarasuf-inv3-links-h1-eligibility/1',
        'checks': ['name', 'size', 'cells in a record', 'cell length', 'four different files'],
        'beyondContract': {k: v for k, v in found.items() if v},
    }
    (folder / 'ELIGIBILITY.json').write_text(json.dumps(result, indent=1) + '\n', encoding='utf-8')
    print(json.dumps(result, indent=1))


if __name__ == '__main__':
    main(sys.argv[1])
