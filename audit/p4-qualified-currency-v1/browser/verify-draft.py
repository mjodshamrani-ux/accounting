"""Verify static pre-code browser matrix against sealed manual truth only."""
from pathlib import Path
from decimal import Decimal
import csv
import hashlib
import io
import json

root = Path(__file__).resolve().parent
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
matrix = json.loads((root / 'acceptance-matrix.json').read_text())
status = json.loads((root / 'STATUS.json').read_text())
for field in ['nativeAccepted', 'runtimeAcceptance', 'implementationAccepted', 'fieldAcceptance', 'financialApproval', 'expectedFromProduct', 'productImports']:
    assert matrix[field] is False and status[field] is False, field
pins = json.loads((root / 'source-pins.json').read_text())
for item in pins['sources']:
    directory = root / 'source-snapshot' / item['directory']
    manifest_path = directory / 'MANIFEST.json'
    assert sha(manifest_path) == item['authorManifestSha256'] == item['snapshotManifestSha256']
    manifest = json.loads(manifest_path.read_text())
    expected = {entry['path'] for entry in manifest['files']}
    actual = {str(p.relative_to(directory)) for p in directory.rglob('*') if p.is_file() and p != manifest_path}
    assert actual == expected, (item['directory'], actual - expected, expected - actual)
    for entry in manifest['files']:
        path = directory / entry['path']
        assert path.stat().st_size == entry['bytes'] and sha(path) == entry['sha256']
policy = {'SAR': 2, 'JPY': 0, 'KWD': 3}
assert matrix['precisionPolicy'] == policy
expected_ids = {code.lower() + '-' + topology for code in policy for topology in ['on-page', 'cross-page', 'own-reference']}
positives = matrix['positiveCases']
assert len(positives) == 18
assert {(c['lang'], c['id']) for c in positives} == {(lang, ident) for lang in ['ar', 'en'] for ident in expected_ids}
assert len({c['key'] for c in positives}) == 18
for case in positives:
    expected_path = root / case['expectedPath']
    assert sha(expected_path) == case['expectedSha256']
    truth = json.loads(expected_path.read_text())
    assert case['exactEconomicTruth'] == {k: truth[k] for k in case['exactEconomicTruth']}
    assert sha(root / case['originalPath']) == case['originalSha256'] == truth['originalSha256']
    csv_path = root / case['csvPath']
    assert sha(csv_path) == case['csvSha256'] == truth['csvSha256']
    rows = list(csv.reader(io.StringIO(csv_path.read_bytes().decode('utf8'), newline='')))
    assert rows == truth['csvRows'] and len(rows) == 4
    code = truth['currencyContext']['currency']
    decimals = policy[code]
    assert truth['currencyContext']['decimals'] == decimals
    assert rows[0] == ['Date', 'Reference', 'Description', 'Signed amount (' + code + ')']
    assert [r[3] for r in rows[1:]] == truth['signedAmounts']
    scaled = [Decimal(value) * (10 ** decimals) for value in truth['signedAmounts']]
    assert all(value == value.to_integral_value() for value in scaled)
    assert list(map(int, scaled)) == truth['amountMinor'] and sum(scaled) == truth['totalMinor']
    assert truth['cuts'] == [25, 45, 70]
    assert case['originalDotReviewRequired'] is (code == 'KWD')
    if code == 'KWD':
        dot = case['originalAndDerivedChoiceTruth']
        assert dot['numericInterpretations']['dotDecimalMinor'] == truth['amountMinor']
        assert dot['numericInterpretations']['dotGroupingMinor'] == [-12500000, 2005000, 0]
        assert dot['originalNumberFormatChoice']['sourceHash'] == truth['originalSha256']
        assert dot['derivedNumberFormatChoice']['sourceHash'] == truth['csvSha256']
        assert dot['originalNumberFormatChoice']['cuts'] == [25, 45, 70]
        assert dot['derivedNumberFormatChoice']['cuts'] == []
    else:
        assert case['originalAndDerivedChoiceTruth'] is None
    for evidence in truth['currencyEvidence']:
        row = next(r for r in truth['inventory'] if r['row'] == evidence['row'] and r['page'] == evidence['page'])
        assert evidence['sourceHash'] == truth['originalSha256'] and evidence['column'] == 4
        assert evidence['literal'] == row['values'][3] == rows[0][3]
    assert len(truth['currencyEvidence']) == (2 if case['id'].endswith('cross-page') else 1)
    assert case['financialApproval'] is False and case['scopeConfirmed'] is False
    assert case['requiredSurfaceStates'] == ['original-source-review', 'derivative-review', 'artifact']
refusals = matrix['targetedRefusalCases']
assert len(refusals) == 12 and len({c['key'] for c in refusals}) == 12
assert {c['currency'] for c in refusals} == set(policy)
for case in refusals:
    assert sha(root / case['expectedTruthPath']) == case['expectedTruthSha256']
    assert case['financialApproval'] is False and case['policyDecimals'] == policy[case['currency']]
assert matrix['surfaceEvidence']['positiveMeasurements'] == 18 * 3 * 2 == 108
assert matrix['surfaceEvidence']['refusalMeasurements'] == 12 * 2 == 24
assert matrix['surfaceEvidence']['totalPrimaryMeasurements'] == 132
assert matrix['counts']['primaryBrowserCases'] == 30
assert len(matrix['allOtherBlockedOriginalsRemainMandatoryInSeparateNativeEngineGate']) == 16
assert len(matrix['bareControls']) == 2
assert matrix['opaqueReceiptBoundary']['newSectionArchiveUI'] is False
checker = json.loads((root / 'external-checker-spec.json').read_text())
assert checker['productSidecarImportApi'] is False and checker['financialAuthority'] is False
result = {'staticDraftConsistent': True, 'productImports': False, 'expectedFromProduct': False,
          'nativeAccepted': False, 'runtimeAcceptance': False, 'implementationAccepted': False,
          'mandatoryPositiveCases': 18, 'targetedRefusalLanguageCases': 12,
          'primaryBrowserCases': 30, 'primaryWidthMeasurements': 132,
          'allThreeSourceManifestsVerified': True, 'exactFrozenEconomicTruthUnchanged': True}
print(json.dumps(result, indent=2))
