"""Pre-seal check that the product's CSV reader would read every GLT-1 H1
file, without running the product (DEV-61). The rules are copied from
lib/reconciliation/io.ts (readFile's CSV branch with its default
4096-character cell limit, validateCellText, parseCSV) and the row limit of
lib/reconciliation/gl-tb-sections.ts: strict UTF-8; a leading byte-order
mark dropped; no control character but tab and line ends; the separator
chosen among comma, semicolon and tab by the number of the first twenty
non-empty rows wider than one cell, the best unique; quotes only at a
field's start; at most 100 columns; at most 20,030 rows.

  python3 -B audit/gl-tb-sections-holdout-h1/eligibility.py frozen
"""
import json
import re
import sys
from pathlib import Path

CONTROL = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]')


def tokenize(text, sep, limit=4096):
    rows, row, cell, quoted, after = [], [], '', False, False
    i = 0
    while i < len(text):
        c = text[i]
        if quoted:
            if c == '"':
                if text[i + 1:i + 2] == '"':
                    cell += '"'
                    i += 1
                else:
                    quoted, after = False, True
            else:
                cell += c
        elif c == '"':
            if cell or after:
                raise ValueError('quote')
            quoted = True
        elif c == sep:
            if len(cell) > limit or len(row) >= 100:
                raise OverflowError('limit')
            row.append(cell)
            cell, after = '', False
        elif c in '\r\n':
            if c == '\r' and text[i + 1:i + 2] == '\n':
                i += 1
            row.append(cell)
            rows.append(row)
            row, cell, after = [], '', False
        else:
            if after:
                raise ValueError('text after a closing quote')
            cell += c
        i += 1
    if quoted:
        raise ValueError('open quote')
    if cell or row or after:
        row.append(cell)
        rows.append(row)
    return rows


def verdict(path):
    try:
        text = path.read_bytes().decode('utf-8')
    except UnicodeDecodeError:
        return 'not UTF-8'
    text = text[1:] if text.startswith('\ufeff') else text
    if '\u0000' in text or CONTROL.search(text):
        return 'control character'
    scores = []
    for sep in (',', ';', '\t'):
        try:
            rows = tokenize(text, sep)
            widths = [len(r) for r in rows[:20] if any(r)]
            scores.append((sum(w > 1 for w in widths), sep))
        except (ValueError, OverflowError):
            scores.append((-1, sep))
    scores.sort(key=lambda s: -s[0])
    if scores[0][0] <= 0:
        return 'no separator'
    if scores[1][0] == scores[0][0]:
        return 'ambiguous separator'
    if scores[0][1] != ',':
        return f'separator {scores[0][1]!r}'
    if len(tokenize(text, ',')) > 20030:
        return 'too many rows'
    return None


def main(folder):
    folder = Path(folder)
    report = {p.name: verdict(p) for p in sorted(folder.glob('*.csv'))}
    refused = {k: v for k, v in report.items() if v}
    out = {'files': len(report), 'refused': refused, 'clear': not refused,
           'copiedFrom': ['lib/reconciliation/io.ts', 'lib/reconciliation/gl-tb-sections.ts']}
    (folder / 'ELIGIBILITY.json').write_text(json.dumps(out, indent=1) + '\n', encoding='utf-8')
    print(json.dumps(out))
    if refused:
        sys.exit(1)


if __name__ == '__main__':
    main(sys.argv[1])
