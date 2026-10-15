"""Independent G2 source-role/citation checker. No product or generator imports."""
import argparse
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BASE / 'inventory-pdf-foundation'))
import oracle
spec = importlib.util.spec_from_file_location(
    'tarasuf_native_pdf_source_checker', BASE / 'inventory-pdf-native-source/check_reading.py')
native_checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native_checker)

CONTRACT = json.loads((Path(__file__).with_name('contract.json')).read_text())


def check(root, readings):
    native = native_checker.check(root, {key: value['source'] for key, value in readings.items()})
    citations = record_count = checked_facts = 0
    for name, result in readings.items():
        code = name.split('-')[-1]
        source = result['source']
        expected_geometry = oracle.pdf_read(root / name / 'register.pdf')
        expected_status = 'interpreted' if code in CONTRACT['interpreted'] else 'source-error'
        assert result['status'] == expected_status, 'G2_STATUS'
        assert result['family'] == CONTRACT['version'], 'FAMILY'
        assert result['financialApproval'] is False and 'totals' not in result and 'matches' not in result, 'NO_ACCOUNTING'
        if expected_status == 'source-error':
            assert result['issues'][0]['code'] == CONTRACT['structuralErrors'][code], 'STRUCTURAL_ERROR'
        else:
            assert result['issues'] == [] and len(result['records']) == 7, 'RECORD_COUNT'
            assert all(e['kind'] != 'unresolved' for e in result['inventory']), 'UNRESOLVED'
            assert len(result['scope']) == 12, 'SCOPE'
            assert len(result['pageControls']) == len(source['pages']), 'PAGE_CONTROL'
            assert len(result['pageEvidence']) == len(source['pages']), 'PAGE_EVIDENCE'
            assert result['reportEnd'] is not None and result['reportTotal'] is not None, 'REPORT_END'
            record_count += len(result['records'])
        assert len(result['inventory']) == sum(len(p) for p in expected_geometry), 'INVENTORY_COUNT'
        for page, lines in enumerate(expected_geometry, 1):
            entries = [e for e in result['inventory'] if e['page'] == page]
            assert [e['line'] for e in entries] == list(range(1, len(lines) + 1)), 'INVENTORY_LINE'
            used = [i for e in entries for i in e['items']]
            assert sorted(used) == sorted(t['item'] for t in source['pages'][page - 1]['tokens']), 'TOKEN_INVENTORY'
            assert len(used) == len(set(used)), 'DUPLICATE_TOKEN'

        def cite(actual, expected=None):
            nonlocal citations
            assert actual['sourceHash'] == source['sha256'], 'CITATION_HASH'
            pn, ln = actual['page'], actual['line']
            assert type(pn) is int and 1 <= pn <= len(expected_geometry), 'CITATION_PAGE'
            assert type(ln) is int and 1 <= ln <= len(expected_geometry[pn - 1]), 'CITATION_LINE'
            candidates = [e for e in expected_geometry[pn - 1][ln - 1] if e['raw'] == actual['text']]
            candidates = [e for e in candidates if all(abs(a - b) < 1e-7 for a, b in zip(
                actual['box'], [e['x'], e['y'], e['width'], e['height']]))]
            assert len(candidates) == 1, 'CITATION_LITERAL_BOX'
            e = candidates[0]
            tokens = native_checker.span(source['pages'][pn - 1]['tokens'], e)
            assert actual['items'] == [t['item'] for t in tokens], 'CITATION_ITEMS'
            gaps = [b['x'] - (a['x'] + a['width']) for a, b in zip(tokens, tokens[1:])]
            assert len(actual['gaps']) == len(gaps), 'GAP_COUNT'
            for a, b in zip(actual['gaps'], gaps):
                native_checker.near(a, b)
            assembly = 'single-native-item' if len(tokens) == 1 else (
                'gap-presentation' if any(g > 1e-7 for g in gaps) else 'adjacent-native-items')
            assert actual['textAssembly'] == assembly, 'GAP_UNCERTAINTY'
            if expected is not None:
                assert pn == expected['page'], 'CITATION_OWNER'
                assert actual['text'] == expected['raw'], 'FIELD_LITERAL'
                for a, b in zip(actual['box'], [expected['x'], expected['y'], expected['width'], expected['height']]):
                    native_checker.near(a, b)
            citations += 1

        def walk(value):
            if isinstance(value, dict):
                if {'sourceHash', 'page', 'line', 'items', 'text', 'box'} <= value.keys():
                    cite(value)
                else:
                    for key, child in value.items():
                        if key != 'source':
                            walk(child)
            elif isinstance(value, list):
                for child in value:
                    walk(child)
        walk(result)

        financial = oracle.inspect(root / name)
        oracle.verify(financial)
        if financial['financial'] != 'source-error':
            assert result['status'] == 'interpreted', 'INTERPRETABLE_SOURCE'
            for actual, expected in zip(result['records'], financial['facts']):
                assert actual['page'] == expected['page'] and actual['line'] == expected['row'], 'RECORD_OWNER'
                assert set(actual['fields']) == set(expected['fields']), 'FIELD_SET'
                for field, pair in expected['fields'].items():
                    cite(actual['fields'][field]['role'], pair['role'])
                    cite(actual['fields'][field]['value'], pair['value'])
                for key in ['parent', 'batch']:
                    if expected[key] is None:
                        assert actual[key] is None, 'DIMENSION_OWNER'
                    else:
                        cite(actual[key]['value'], expected[key])
                for key in ['sectionEnd']:
                    if expected[key] is None:
                        assert actual[key] is None, 'SECTION_OWNER'
                    else:
                        cite(actual[key], expected[key])
                for key in ['incomingContinuation', 'outgoingContinuation']:
                    wanted = expected.get(key)
                    found = actual[key]
                    if wanted is None:
                        assert found is None, 'CONTINUATION_OWNER'
                    else:
                        cite(found['role'], wanted['role'])
                        cite(found['value'], wanted['value'])
                        if key == 'incomingContinuation':
                            cite(found['prior']['role'], wanted['prior']['role'])
                            cite(found['prior']['value'], wanted['prior']['value'])
                for actual_scope, expected_scope in [
                    (actual['scopeEvidence'], expected['scopeEvidence']),
                    (actual['documentScopeEvidence'], expected['documentScopeEvidence']),
                ]:
                    assert len(actual_scope) == len(expected_scope), 'SCOPE_COUNT'
                    for a, e in zip(actual_scope, expected_scope):
                        cite(a['role'], e['role'])
                        cite(a['value'], e['value'])
                fields = actual['fields']
                precision = int(fields['Quantity precision']['value']['text'])
                assert oracle.number(fields['Quantity']['value']['text'], precision) == expected['values'][2], 'QUANTITY'
                assert oracle.number(fields['Posted value']['value']['text'], 3) == expected['values'][5], 'MONEY'
                dims = fields['Item dimensions']['value']['text'] if 'Item dimensions' in fields else (
                    'warehouse=' + actual['parent']['value']['text'] + ';batch=' + actual['batch']['value']['text'])
                assert dims == expected['values'][1], 'DIMENSIONS'
                assert fields['Unit']['value']['text'] == expected['values'][3], 'UNIT'
                checked_facts += 1
        if code == 'N09':
            assert result['pageControls'][1]['total']['value']['text'] == '189.876', 'DEFERRED_PAGE_TOTAL'
        if code == 'N12':
            a = next(r for r in result['records'] if r['fields']['Item ID']['value']['text'] == '0008')
            assert a['fields']['Quantity precision']['value']['text'] == '1', 'DEFERRED_PRECISION'
            assert a['fields']['Quantity']['value']['text'] == '1.250', 'DEFERRED_QUANTITY'
    assert record_count == 63 and checked_facts == 49, 'FACT_COUNTS'
    return dict(sourceGeometry=native, interpretedSources=9, structuralErrors=10,
                rawRecords=record_count, independentlyCheckedFinancialSourceFacts=checked_facts,
                checkedCitations=citations, productFinancialEnabled=False)


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--root', type=Path, required=True)
    p.add_argument('--readings', type=Path, required=True)
    a = p.parse_args()
    print(json.dumps(check(a.root, json.loads(a.readings.read_text())), ensure_ascii=False))
