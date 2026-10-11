"""Verify actual browser downloads with raw originals and independent oracle."""
from pathlib import Path
import importlib.util
import json
import math
import os
import sys

root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('asset_evidence', root / 'audit/fixed-assets-long/check-evidence.py')
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)
folder = Path(sys.argv[1]).resolve()
report = checker.read_json(folder / 'BROWSER-PROOF.json')
ids = ('01-two-assets-separated', '10-all-zero-members-retained', '20-blank-amount-not-zero', '29-missing-zero-mapping', '39-net-equal-component-differences', '42-malformed-last-row-width')
expected = {(lang, width, case) for lang in ('ar', 'en') for width in (1440, 390, 320) for case in ids}
checker.require(report['actualBrowser'] is True and report['browserRun'] is True and report['expectedFromProduct'] is False, 'Actual browser evidence required')
checker.require(len(report['entries']) == 36, 'Complete bilingual responsive cases required')
geometry = report.get('geometry', [])
checker.require(len(geometry) == 36 and {(r['lang'], r['width'], r['id']) for r in geometry} == expected, 'Exact screenshot-time result geometry coverage')
for record in geometry:
    checker.require(record.get('phase') == 'result-before-family-reset' and record.get('selector') == '[data-asset-workspace]:visible' and record.get('panelTag') == 'SECTION', 'Actual visible asset result panel identity')
    checker.require(isinstance(record.get('panelClass'), str) and {'app-shell', 'gl-tb-workspace', 'reconciliation-workspace'} <= set(record['panelClass'].split()), 'Actual asset panel class identity')
    checker.require(record.get('visible') is True and type(record.get('visiblePanels')) is int and record['visiblePanels'] == 1, 'One visible asset result panel required')
    checker.require(type(record.get('viewport')) is int and record['viewport'] == record['width'], 'Actual requested viewport required')
    for field in ('document', 'body', 'panel', 'panelHeight'):
        checker.require(type(record.get(field)) in (int, float) and math.isfinite(record[field]) and record[field] > 0, f'Positive finite visible result geometry: {field}')
    checker.require(all(record[field] <= record['width'] + 1 for field in ('document', 'body', 'panel')), 'Result panel and page must fit actual viewport')
checker.require({(e['lang'], e['width'], e['truthCase']) for e in report['entries']} == expected, 'Exact unique positive/negative case coverage')
checker.require(len({e['folder'] for e in report['entries']}) == 36 and all(Path(e['folder']).name == e['folder'] and e['phase'] == 'browser-unreviewed' for e in report['entries']), 'Unique local evidence folders')
for key in ('pageErrors', 'externalRequests', 'failedRequests'):
    checker.require(report[key] == [], f'Unexpected browser {key}')
for key, flag, expected_keys in (
    ('keyboard', 'operation', expected),
    ('invalidation', 'layoutInvalidated', expected),
    ('review', 'acceptedAndUndone', {(l,w,ids[0]) for l in ('ar','en') for w in (1440,390,320)}),
    ('cancellation', 'cancelledAndRetried', {(l,1440,ids[0]) for l in ('ar','en')}),
    ('blockedReview', 'blockedAfterPrerequisites', {(l,w,case) for l,w,case in expected if case in ids[2:]}),
):
    records = report[key]
    checker.require(len(records) == len(expected_keys) and {(r['lang'],r['width'],r['id']) for r in records} == expected_keys, f'Exact {key} coverage')
    checker.require(all(r[flag] == ('compare-enter' if key == 'keyboard' else True) for r in records), f'Unexercised {key}')
for record in report['blockedReview']:
    truth = checker.read_json(root / 'audit/fixed-assets-long/frozen' / record['id'] / 'case.json')
    checker.require(record['financial'] == truth['expectedFinancial'] and record['financial'] != 'ready', 'Negative financial acceptance prerequisite control')
for record in report['cancellation']:
    for flag in ('cancelled', 'submitted', 'terminated', 'resultAbsent', 'exportDisabled', 'lateResultAbsent'):
        checker.require(record.get(flag) is True, f'Actual cancellation control missing: {flag}')
    checker.require(record.get('lateResultAbsentObservationMs') == 100, 'Bounded late-result observation required')
    for field in ('workerId', 'requestId', 'retryWorkerId', 'retryRequestId'):
        checker.require(type(record.get(field)) is int and record[field] > 0, f'Native identity required: {field}')
    checker.require(record['workerId'] != record['retryWorkerId'] and record.get('retryFinancial') == 'ready', 'Successful retry must use fresh native worker')
    messages = record.get('nativeTelemetry')
    checker.require(isinstance(messages, list), 'Native request/reply/termination telemetry required')
    requests = [m for m in messages if m.get('direction') == 'request' and m.get('action') == 'asset-reconcile']
    checker.require(len(requests) == 2 and [(m.get('workerId'), m.get('id')) for m in requests] == [(record['workerId'], record['requestId']), (record['retryWorkerId'], record['retryRequestId'])], 'Cancelled and retry requests must match native identities')
    cancelled_index = messages.index(requests[0])
    retry_index = messages.index(requests[1])
    termination_indices = [i for i, m in enumerate(messages) if m.get('direction') == 'terminate' and m.get('workerId') == record['workerId']]
    checker.require(len(termination_indices) == 1 and cancelled_index < termination_indices[0] < retry_index, 'Specific cancelled native worker must terminate before retry')
    replies = [m for m in messages[retry_index + 1:] if m.get('direction') == 'reply' and m.get('action') == 'asset-reconcile' and m.get('workerId') == record['retryWorkerId'] and m.get('id') == record['retryRequestId']]
    checker.require(len(replies) == 1 and replies[0].get('ok') is True and replies[0].get('financial') == 'ready', 'Native retry must return successful ready result')
frozen_bytes = (folder / 'FROZEN-INPUTS.json').read_bytes()
checker.require(checker.sha(frozen_bytes) == report['frozenInputsSha256'], 'Frozen inputs report binding')
freeze = json.loads(frozen_bytes)
checker.require(freeze['syntheticOnly'] is True and freeze['truthFromProduct'] is False, 'Synthetic independently frozen truth')
expected_sources = {f'{case}/{name}' for case in ids for name in ('case.json', 'source-0.csv', 'source-1.csv', 'source-2.csv', 'source-3.csv')}
checker.require(set(freeze['sourceFiles']) == expected_sources, 'Complete frozen original inventory')
for relative, digest in freeze['sourceFiles'].items():
    checker.require(checker.sha((root / 'audit/fixed-assets-long/frozen' / relative).read_bytes()) == digest, 'Frozen original changed')
checker.require(checker.sha((root / 'scripts/fixed-assets-long-browser.mjs').read_bytes()) == freeze['driverSha256'], 'Driver changed after freeze')
checker.require(bool(freeze['buildFiles']), 'Frozen browser build inventory required')
dist = Path(os.environ.get('MIZAN_DIST_DIR', root / 'dist')).resolve()
build = {p.relative_to(dist).as_posix(): checker.sha(p.read_bytes()) for p in dist.rglob('*') if p.is_file()}
checker.require(build == freeze['buildFiles'], 'Exact browser build changed after freeze')
engine = checker.oracle()
results = [checker.verify(folder / e['folder'], e, engine) for e in report['entries']]
result = {'passed':True,'actualBrowser':True,'productImported':False,'entries':len(results),'workbooks':len(results)*2,'results':results}
(folder / 'INDEPENDENT-CHECK.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'passed':True,'entries':len(results),'workbooks':len(results)*2}))
