"""Independent original/session/context/decision checker; no product/generator import.
Uses unchanged G3 checker and source oracle for money, quantity, glyphs and links.
This learned synthetic corpus is lifecycle evidence, not field/holdout accuracy.
"""
import argparse
import base64
import copy
import hashlib
import importlib.util
import json
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('g3_lifecycle_check', BASE / 'inventory-pdf-accounting/check_result.py')
g3 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g3)
CONTRACT = json.loads(Path(__file__).with_name('contract.json').read_text())
PHASES = {'unreviewed': (False, [], 'needs-review'), 'complete': (True, [], 'needs-review'), 'accepted': (True, ['accept'], 'accepted'), 'undone': (True, ['accept', 'undo'], 'needs-review'), 'rejected': (True, ['accept', 'undo', 'reject'], 'rejected'), 'reopened': (True, ['accept', 'undo', 'reject', 'undo'], 'needs-review')}
FIELDS = ['entity', 'inventoryLedger', 'glLedger', 'currency', 'currencyBasis', 'postingStatus', 'postingLayer', 'asOf', 'chartVersion', 'mapVersion', 'valuationPolicyVersion', 'inventoryAccountSetVersion']
VALUES = ['Synthetic INV1F Owner', 'STOCK-PDF', 'GL-PDF', 'KWD', 'functional', 'posted', 'Current', '2026-10-31', 'CHART-F', 'MAP-F', 'SUPPLIED-F', 'SET-F']
SCOPE = dict(zip(FIELDS, VALUES), confirmed=True)
NAMES = ['register.pdf', 'mapping.csv', 'policy.csv', 'gl.csv']
READINGS = [dict(sheet=0, role=role, family='inventory-native-pdf-register-1' if i == 0 else 'inventory-posted-register-gl-1', confirmed=True) for i, role in enumerate(['register', 'mapping', 'policy-evidence', 'gl'])]

def check(root, report):
    assert report.keys() == {'version', 'cases'}, 'REPORT_FIELDS'
    assert report['version'] == CONTRACT['version'], 'REPORT_VERSION'
    codes = g3.CONTRACT['ready'] + g3.CONTRACT['difference'] + g3.CONTRACT['missing'] + list(g3.CONTRACT['sourceErrors'])
    assert set(report['cases']) == {'INV1F-' + c for c in codes}, 'CASE_SET'
    baselines, checked_phases = {}, 0
    for name, phases in report['cases'].items():
        positive = name[6:] in g3.CONTRACT['ready']
        # Derive the required phase set from the frozen case identity, not product output.
        assert set(phases) == (set(PHASES) if positive else {'unreviewed'}), 'PHASE_SET'
        source_files = [root / name / f for f in NAMES]
        hashes = [hashlib.sha256(p.read_bytes()).hexdigest() for p in source_files]
        first_result = None
        for phase, evidence in phases.items():
            assert evidence.keys() == {'value', 'restored', 'session'}, 'EVIDENCE_FIELDS'
            value = evidence['value']
            assert g3.same_value(value, evidence['restored']), 'RESTORE_PARITY'
            assert value.keys() == {'version', 'state', 'result'} and value['version'] == CONTRACT['version'], 'REPLY_FIELDS'
            state, result, session = value['state'], value['result'], evidence['session']
            assert state.keys() == {'version', 'files', 'scope', 'completeness', 'events'} and state['version'] == CONTRACT['version'], 'STATE_VERSION'
            assert session.keys() == set(CONTRACT['sessionFields']) and session['format'] == CONTRACT['sessionFormat'] and session['version'] == CONTRACT['version'], 'SESSION_FIELDS'
            assert len(session['files']) == len(state['files']) == 4, 'SOURCE_COUNT'
            for index, f in enumerate(session['files']):
                assert f.keys() == {'name', 'sha256', 'data'}, 'SESSION_SOURCE_FIELDS'
                assert state['files'][index].keys() == {'name', 'sha256', 'data'}, 'STATE_SOURCE_FIELDS'
                assert f == state['files'][index] and f['name'] == NAMES[index] and f['sha256'] == hashes[index], 'SOURCE_IDENTITY'
                original = base64.b64decode(f['data'], validate=True)
                assert base64.b64encode(original).decode() == f['data'] and original == source_files[index].read_bytes(), 'ORIGINAL_BYTES'
            complete, types, review = PHASES[phase]
            assert g3.same_value(state['scope'], SCOPE) and g3.same_value(result['scope'], SCOPE), 'SCOPE'
            completeness = dict(confirmed=complete, reference='Synthetic completeness review' if complete else '', note='All original pages reviewed' if complete else '')
            assert all(g3.same_value(x, completeness) for x in [state['completeness'], result['completeness'], session['completeness']]), 'COMPLETENESS'
            assert g3.same_value(session['scope'], SCOPE) and g3.same_value(session['events'], state['events']) and g3.same_value(state['events'], result['events']), 'SESSION_CHOICES'
            expected_context = [CONTRACT['version'], hashes, READINGS, SCOPE, completeness]
            assert g3.same_value(json.loads(result['context']), expected_context), 'CONTEXT'
            assert g3.same_value(result['readings'], READINGS), 'READINGS'
            assert [e['type'] for e in state['events']] == types, 'EVENT_TYPES'
            for i, e in enumerate(state['events']):
                assert e.keys() == {'id', 'type', 'memberIds', 'context', 'at', 'reference', 'note'}, 'EVENT_FIELDS'
                assert e['id'] == f'decision-{i}' and e['context'] == result['context'] and e['at'] == '2026-10-16T09:00:00.000Z', 'EVENT_CONTEXT'
                assert e['reference'] == 'Synthetic source review' and e['note'] == 'All supplied scope reviewed', 'EVENT_REFERENCE'
                assert e['memberIds'] == result['memberIds'], 'EVENT_MEMBERS'
            assert result['review'] == review, 'REVIEW'
            financial = g3.oracle.inspect(root / name)['financial']
            assert result['status'] == (financial if financial != 'ready' else 'consistent-with-evidence' if review == 'accepted' else 'needs-review'), 'STATUS'
            # G3 intentionally has no decisions; independently validate that part
            # above, then present only the unchanged accounting payload to G3.
            normalized = copy.deepcopy(result)
            normalized.update(review='needs-review', status=financial if financial != 'ready' else 'needs-review', events=[], completeness=dict(confirmed=False, reference='', note=''))
            normalized.pop('context')
            if first_result is None:
                first_result = normalized
                baselines[name] = copy.deepcopy(result)
                baselines[name].update(review='needs-review', status=financial if financial != 'ready' else 'needs-review', events=[], completeness=dict(confirmed=False, reference='', note=''))
            else:
                assert g3.same_value(normalized, first_result), 'ACCOUNTING_PHASE_PARITY'
            checked_phases += 1
    accounting = g3.check(root, baselines)
    return dict(passed=True, cases=len(baselines), phases=checked_phases, accounting=accounting)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--result', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(check(args.root, json.loads(args.result.read_text())), indent=2))
