"""Independent G3 PDF/CSV, Decimal, physical-owner and link checker.
No product, producer or generator imports. The frozen source oracle is unchanged.
The PDF grammar here is the synthetic Type1/Tm/Tj foundation, not a general reader.
"""
import argparse
import csv
import hashlib
import importlib.util
import json
import math
import re
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BASE / 'inventory-pdf-foundation'))
import oracle
spec = importlib.util.spec_from_file_location('tarasuf_g2_checker', BASE / 'inventory-pdf-local-fields/check_reading.py')
g2 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g2)
CONTRACT = json.loads(Path(__file__).with_name('contract.json').read_text())


def same_value(actual, wanted):
    if wanted is None:
        return actual is None
    if type(wanted) is bool:
        return type(actual) is bool and actual == wanted
    if type(wanted) in (int, float):
        return type(actual) in (int, float) and math.isfinite(actual) and actual == wanted
    if isinstance(wanted, list):
        return isinstance(actual, list) and len(actual) == len(wanted) and all(same_value(a, b) for a, b in zip(actual, wanted))
    if isinstance(wanted, dict):
        return isinstance(actual, dict) and actual.keys() == wanted.keys() and all(same_value(actual[k], v) for k, v in wanted.items())
    return type(actual) is type(wanted) and actual == wanted


def paint_cells(path):
    # oracle.pdf_read validates xref/lengths/page tree/visible boxes first.
    oracle.pdf_read(path)
    text = path.read_text('ascii')
    objects = {int(m[1]): m[2] for m in re.finditer(r'(?m)^(\d+) 0 obj\n(.*?)\nendobj\n', text, re.S)}
    kids = [int(v) for v in re.findall(r'(\d+) 0 R', re.search(r'/Kids \[(.*?)\]', objects[2])[1])]
    pages = []
    for page in kids:
        content = int(re.search(r'/Contents (\d+) 0 R', objects[page])[1])
        stream = re.fullmatch(r'<< /Length (\d+) >>\nstream\n(.*?)\nendstream', objects[content], re.S)[2]
        cells, shows, offset = [], [], 0
        for command in stream.splitlines():
            block = re.fullmatch(r'BT /F1 (\d+) Tf 1 0 0 1 (\d+) (\d+) Tm ((?:\((?:\\.|[^\\()])*\) Tj ?)+) ET', command)
            assert block, 'LITERAL_GRAMMAR'
            parts = [re.sub(r'\\([\\()])', r'\1', v) for v in re.findall(r'\(((?:\\.|[^\\()])*)\) Tj', block[4])]
            start = offset
            show_indices = []
            for part in parts:
                show_indices.append(len(shows))
                shows.append(dict(start=offset, end=offset + len(part), raw=part))
                offset += len(part)
            cells.append(dict(raw=''.join(parts), start=start, end=offset, x=int(block[2]), y=int(block[3]), height=int(block[1]), shows=show_indices))
        pages.append(dict(cells=cells, shows=shows, text=''.join(s['raw'] for s in shows)))
    return pages


def check(root, results):
    assert set(results) == {'INV1F-' + c for c in CONTRACT['ready'] + CONTRACT['difference'] + CONTRACT['missing'] + list(CONTRACT['sourceErrors'])}, 'CASE_SET'
    reading_check = g2.check(root, {k: r['pdfEvidence']['reading'] for k, r in results.items()})
    checked_facts = checked_links = checked_literals = checked_items = supported_links = 0
    outcomes = {}
    for name, result in results.items():
        folder = root / name
        expected = oracle.inspect(folder)
        oracle.verify(expected)
        assert result['financial'] == expected['financial'], 'FINANCIAL'
        assert result['review'] == 'needs-review' and result['status'] != 'consistent-with-evidence', 'NO_APPROVAL'
        assert result['events'] == [] and result['completeness']['confirmed'] is False, 'NO_COMPLETENESS'
        evidence = result['pdfEvidence']
        source = evidence['reading']['source']
        assert evidence['version'] == CONTRACT['version'] and source['literalVersion'] == CONTRACT['literalVersion'], 'VERSIONS'
        pages = paint_cells(folder / 'register.pdf')
        for page, painted in zip(source['pages'], pages):
            trace = page['literals']
            assert trace['version'] == CONTRACT['literalVersion'] and trace['text'] == painted['text'], 'GLYPH_LITERAL_TEXT'
            assert len(trace['operators']) == len(painted['shows']), 'SHOW_COUNT'
            assert [o['operator'] for o in trace['operators']] == sorted(set(o['operator'] for o in trace['operators'])), 'SHOW_IDS'
            for actual, wanted in zip(trace['operators'], painted['shows']):
                assert [actual['start'], actual['end']] == [wanted['start'], wanted['end']] and actual['adjusted'] is False, 'SHOW_OFFSETS'
            ranges = {r['item']: r for r in trace['items']}
            assert set(ranges) == {t['item'] for t in page['tokens']} and len(ranges) == len(trace['items']), 'ITEM_RANGES'
            for token in page['tokens']:
                cells = [c for c in painted['cells'] if abs(c['y'] - token['y']) < 1e-7 and c['x'] <= token['x'] < c['x'] + len(c['raw']) * c['height'] * .6]
                assert len(cells) == 1, 'ITEM_OWNER'
                cell = cells[0]
                relative = (token['x'] - cell['x']) / (cell['height'] * .6)
                assert abs(relative - round(relative)) < 1e-7, 'ITEM_POSITION'
                start = cell['start'] + round(relative)
                wanted = dict(item=token['item'], start=start, end=start + len(token['text']))
                assert same_value(ranges[token['item']], wanted), 'ITEM_LITERAL_OFFSETS'
                assert trace['text'][wanted['start']:wanted['end']] == token['text'], 'ITEM_LITERAL'
                checked_items += 1
        for literal in evidence['literals']:
            span = literal['span']
            painted = pages[span['page'] - 1]
            cells = [c for c in painted['cells'] if c['x'] == span['box'][0] and c['y'] == span['box'][1] and c['height'] == span['box'][3]]
            assert len(cells) == 1, 'LITERAL_OWNER'
            cell = cells[0]
            assert literal['text'] == cell['raw'] and literal['start'] == cell['start'] and literal['end'] == cell['end'], 'EXACT_LITERAL'
            ops = source['pages'][span['page'] - 1]['literals']['operators']
            assert literal['operators'] == [ops[i]['operator'] for i in cell['shows']], 'LITERAL_SHOW_OWNER'
            checked_literals += 1
        outcomes[name] = result['financial']
        if expected['financial'] == 'source-error':
            assert result['totals'] is None and any(e['code'] == expected['reason'] for e in result['issues']), 'SOURCE_ERROR_MONEY'
            assert all(all(c[k] is None for k in ['registerMinor','debitMinor','creditMinor','glMinor','differenceMinor']) for c in result['comparisons']), 'ERROR_COMPARISONS'
            continue
        assert result['issues'] == [] and len(result['records']) == 4, 'RECORD_TABLES'
        assert same_value(result['totals'], expected['totals']), 'TOTALS'
        assert result['pdfEvidence']['reportTotal'] == dict(declaredMinor=1285750, actualMinor=1285750), 'REPORT_TOTAL'
        assert len(result['pdfEvidence']['pageTotals']) == len(pages), 'PAGE_TOTAL_COUNT'
        for total in result['pdfEvidence']['pageTotals']:
            facts = [f for f in expected['facts'] if f['page'] == total['page']]
            amount = sum(f['values'][5] for f in facts)
            assert total == dict(page=total['page'], declaredMinor=amount, actualMinor=amount), 'PAGE_SUM'
        assert len(result['records'][0]) == len(expected['facts']) == len(evidence['records']) == 7, 'FACT_COUNT'
        physical = []
        for actual, raw, fact in zip(result['records'][0], evidence['records'], expected['facts']):
            row = sum(len(p) for p in oracle.pdf_read(folder/'register.pdf')[:fact['page'] - 1]) + fact['row']
            identity = json.dumps(['inventory-native-pdf-register-1',0,source['sha256'],fact['page'],fact['row']], separators=(',',':'))
            assert same_value(actual, dict(id=identity,source=0,row=row,page=fact['page'],values=fact['values'])), 'FACT_VALUES_OWNER'
            assert [raw['id'],raw['page'],raw['line'],raw['row']] == [identity,fact['page'],fact['row'],row], 'RAW_OWNER'
            get = lambda key: fact['fields'][key]['value']['raw']
            expected_raw = {key:get(key) for key in fact['fields']}
            expected_raw['Item dimensions'] = fact['values'][1]
            assert raw['raw'] == expected_raw, 'RAW_LITERAL_FIELDS'
            physical.append(identity)
            checked_facts += 1
        headers = [
            ['Mapping ID','Item ID','Item dimensions','GL account','GL dimensions','Evidence ID'],
            ['Evidence ID','Item ID','Item dimensions','Unit','Quantity precision','Valuation reference','GL account','GL dimensions','Account class','Sign','Value basis','Valid from','Valid to','Reference'],
            ['GL account','GL dimensions','Account class','Debit','Credit'],
        ]
        for number, filename in enumerate(['mapping.csv','policy.csv','gl.csv'],1):
            data = list(csv.DictReader((folder/filename).open()))
            digest = hashlib.sha256((folder/filename).read_bytes()).hexdigest()
            assert len(result['records'][number]) == len(data), 'COMPANION_COUNT'
            for row, (actual, record) in enumerate(zip(result['records'][number],data),2):
                values = [record[k] for k in headers[number-1]]
                if number == 2: values[4] = int(values[4])
                if number == 3: values[3:] = [oracle.number(v,3) for v in values[3:]]
                identity = json.dumps(['inventory-posted-register-gl-1',number,digest,0,row],separators=(',',':'))
                assert same_value(actual, dict(id=identity,source=number,row=row,values=values)), 'COMPANION_VALUES_OWNER'
                physical.append(identity)
        assert result['memberIds'] == physical and len(set(physical)) == 28, 'PHYSICAL_MEMBERS'
        assert len(evidence['links']) == len(expected['links']) == 7, 'LINK_COUNT'
        for fact, actual, wanted in zip(result['records'][0], evidence['links'], expected['links']):
            assert same_value(actual, dict(registerId=fact['id'],mappingIds=[result['records'][1][wanted['mappingRow']-2]['id']],policyIds=[result['records'][2][wanted['policyRow']-2]['id']],glIds=[result['records'][3][wanted['glRow']-2]['id']],account=wanted['account'],supported=wanted['supported'])), 'LINK_MEMBERSHIP'
            checked_links += 1
            supported_links += actual['supported']
        comparisons = [[c[k] for k in ['account','dimensions','registerMinor','debitMinor','creditMinor','glMinor','differenceMinor']] for c in result['comparisons']]
        assert same_value(sorted(comparisons), sorted(expected['comparisons'])), 'BRANCH_COMPARISONS'
    assert checked_facts == checked_links == 49 and checked_items == 4349 and supported_links == 46, 'COVERAGE'
    return dict(g2=reading_check, checkedFacts=checked_facts, checkedLinks=checked_links, checkedGlyphItems=checked_items, checkedLiterals=checked_literals, supportedLinks=supported_links, unsupportedLinks=checked_links-supported_links, outcomes=outcomes, stockWorkerActivated=False)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--results', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(check(args.root, json.loads(args.results.read_text())), ensure_ascii=False))
