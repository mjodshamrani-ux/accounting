"""Independent G1 source-geometry checker, not a product financial reader.
Uses the frozen source oracle, never the JS producer or product parser.
"""
import argparse
import hashlib
import json
import re
import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'inventory-pdf-foundation'))
import oracle


def near(actual, expected):
    assert isinstance(actual, (int, float)) and not isinstance(actual, bool), 'COORD_TYPE'
    assert abs(Decimal(str(actual)) - Decimal(str(expected))) <= Decimal('0.0000001'), 'COORD'


def span(tokens, expected):
    # One literal may be split at spaces by PDF.js. Check every character's
    # original fixed-Courier position. Only source spaces may be unrepresented
    # by a nonblank item; no arbitrary whitespace/column normalization is used.
    unit = expected['height'] * 0.6
    selected = [t for t in tokens if abs(t['y'] - expected['y']) < 1e-7
                and t['x'] >= expected['x'] - 1e-7
                and t['x'] + t['width'] <= expected['x'] + expected['width'] + 1e-7]
    assert selected, 'LITERAL_BOX'
    occupied = set()
    for t in selected:
        position = (t['x'] - expected['x']) / unit
        start = round(position)
        assert abs(position - start) < 1e-7, 'CHAR_POSITION'
        assert t['text'] == expected['raw'][start:start + len(t['text'])], 'LITERAL'
        assert t['glyphText'] == t['text'], 'GLYPH'
        near(t['width'], len(t['text']) * unit)
        near(t['height'], expected['height'])
        slots = set(range(start, start + len(t['text'])))
        assert not slots & occupied, 'OVERLAPPING_CHAR'
        occupied.update(slots)
    assert all(i in occupied or c == ' ' for i, c in enumerate(expected['raw'])), 'MISSING_CHAR'
    near(min(t['x'] for t in selected), expected['x'])
    near(max(t['x'] + t['width'] for t in selected), expected['x'] + expected['width'])
    return selected


def check(root, readings):
    folders = [p for p in sorted(root.glob('INV1F-*')) if (p / 'register.pdf').exists()]
    assert len(folders) == 19 and set(readings) == {p.name for p in folders}, 'SOURCE_SET'
    pages_count = token_count = citation_count = facts_count = 0
    outcomes = {}
    for folder in folders:
        raw = (folder / 'register.pdf').read_bytes()
        result = readings[folder.name]
        assert result['version'] == 'native-pdf-source-1', 'VERSION'
        assert result['coordinateSystem'] == 'visible-page-bottom-left-pdf-units', 'COORDINATES'
        assert result['sha256'] == hashlib.sha256(raw).hexdigest(), 'SOURCE_HASH'
        assert result['byteLength'] == len(raw), 'SOURCE_BYTES'
        assert result['readingIssues'] == [], 'UNEXPECTED_READING_ISSUE'
        expected = oracle.pdf_read(folder / 'register.pdf')
        assert len(result['pages']) == len(expected), 'PAGES'
        sizes = re.findall(rb'/MediaBox \[0 0 (\d+) (\d+)\]', raw)
        assert len(sizes) == len(expected), 'SIZE'
        actual_by_page = {}
        for pn, (page, lines, size) in enumerate(zip(result['pages'], expected, sizes), 1):
            assert page['page'] == pn, 'PAGE_ID'
            width, height = map(int, size)
            assert page['view'] == [0, 0, width, height], 'VIEW'
            assert page['width'] == width and page['height'] == height, 'SIZE'
            tokens = page['tokens']
            expected_tokens = [t for line in lines for t in line]
            ids = [t['item'] for t in tokens]
            assert all(type(i) is int and i > 0 for i in ids), 'ITEM_ID'
            assert ids == sorted(set(ids)), 'ITEM_OWNERSHIP'
            unmatched = list(tokens)
            for e in expected_tokens:
                for t in span(unmatched, e):
                    unmatched.remove(t)
            assert not unmatched, 'EXTRA_TOKENS'
            actual_by_page[pn] = tokens
            token_count += len(tokens)
            pages_count += 1

        # Validate *all* independent physical citations, including field roles,
        # local parents, continuation, scope and controls. Identical text on
        # another page cannot discharge this particular source citation.
        financial = oracle.inspect(folder)
        oracle.verify(financial)
        outcomes[folder.name] = financial['financial']
        def citation(value):
            nonlocal citation_count
            if isinstance(value, dict):
                if {'page', 'x', 'y', 'width', 'height', 'raw'} <= value.keys():
                    span(actual_by_page[value['page']], value)
                    citation_count += 1
                else:
                    for child in value.values():
                        citation(child)
            elif isinstance(value, list):
                for child in value:
                    citation(child)
        citation(financial)
        for fact in financial.get('facts', []):
            # Exact Decimal checks use the original, individually owned cells.
            # These are checks of source fidelity, not product reconciliation.
            fields = fact['fields']
            precision = int(fields['Quantity precision']['value']['raw'])
            assert oracle.number(fields['Quantity']['value']['raw'], precision) == fact['values'][2], 'QUANTITY'
            assert oracle.number(fields['Posted value']['value']['raw'], 3) == fact['values'][5], 'MONEY'
            assert fields['Unit']['value']['raw'] == fact['values'][3], 'UNIT'
            assert fields['Item ID']['value']['raw'] == fact['values'][0], 'ITEM'
            if 'Item dimensions' in fields:
                dimensions = fields['Item dimensions']['value']['raw']
            else:
                dimensions = 'warehouse=' + fact['parent']['raw'] + ';batch=' + fact['batch']['raw']
            assert dimensions == fact['values'][1], 'DIMENSIONS'
            facts_count += 1
    assert pages_count == 56, 'PAGE_COVERAGE'
    assert facts_count == 49, 'INTERPRETABLE_FACTS'
    return dict(pdfSources=19, pages=pages_count, tokens=token_count,
                physicalCitations=citation_count, sourceFacts=facts_count,
                sourceFinancialOutcomes=outcomes, productFinancialEnabled=False)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--readings', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(check(args.root, json.loads(args.readings.read_text())), ensure_ascii=False))
