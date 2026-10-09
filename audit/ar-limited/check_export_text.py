"""Exact review-text and monetary conservation check with a non-product reader."""
import json
from pathlib import Path
import re
import sys

from check_export import sheets, verify


def check(expected_path, workbooks):
    expected = json.loads(Path(expected_path).read_text(encoding='utf-8'))
    for path in workbooks:
        # This also checks native originals, per-row amounts and membership.
        verify(path, reopened=True)
        # OOXML ST_Xstring uses a single escape-decoding pass; escaped literal
        # underscores must not be decoded a second time into new source text.
        book = {
            name: [[re.sub(r'_x([0-9a-fA-F]{4})_', lambda m: chr(int(m[1], 16)), value)
                    for value in row] for row in rows]
            for name, rows in sheets(path).items()
        }
        decisions = book['Decisions']
        assert len(decisions) == 2
        assert decisions[1][decisions[0].index('Note')] == expected['note']
        cases = book['Cases']
        notes = [row[cases[0].index('Note')] for row in cases[1:] if row[cases[0].index('Note')]]
        assert notes == [expected['note']], notes
        summary = dict(book['Summary'][1:])
        assert [int(summary['Ledger total minor units']), int(summary['Statement total minor units'])] == expected['totals']
        assert len(book['Membership']) - 1 == expected['members']
    return {'verified': True, 'workbooks': len(workbooks), 'reader': 'Python stdlib ZIP/XML and CSV/Decimal oracle', 'exactText': True}


if __name__ == '__main__':
    assert len(sys.argv) >= 3, 'Expected JSON and at least one workbook are required'
    print(json.dumps(check(sys.argv[1], sys.argv[2:])))
