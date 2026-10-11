"""Immutable-input gate: compute first, compare frozen expectations afterward."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import sys
import tempfile

from compute import compute

ACCEPTED_MANIFEST = 'a466e5375aeb97cf9787e46a39dc3af5e0a969a062b771905c2d86796c5faaf7'
ACCEPTED_DIAGNOSTICS = 'cc8de1b325d063a73faa708a8a7198a48c213dc8a05bc481ebe92fc8c497a14f'


def gate(frozen, output):
    report = {'independentOracle': True, 'productImported': False, 'expectedUsedForCompute': False,
        'syntheticOnly': True, 'allPassed': False, 'cases': [], 'inputs': [], 'failures': []}
    try:
        original = (frozen / 'INPUT-MANIFEST.json').read_bytes()
        report['manifestSha256'] = sha256(original).hexdigest()
        assert report['manifestSha256'] == ACCEPTED_MANIFEST, 'Accepted immutable input manifest differs.'
        manifest = json.loads(original)
        report['contractSha256'] = sha256((frozen.parent / 'CONTRACT.ar.md').read_bytes()).hexdigest()
        for entry in manifest['files']:
            relative = Path(entry['path'])
            assert not relative.is_absolute() and '..' not in relative.parts, 'Unsafe manifest path'
            data = (frozen / relative).read_bytes()
            digest = sha256(data).hexdigest()
            report['inputs'].append({'path': str(relative), 'bytes': len(data), 'sha256': digest})
            assert digest == entry['sha256'] and len(data) == entry['bytes'], f'Frozen input changed: {relative}'
        for folder in sorted(p.parent for p in frozen.glob('*/case.json')):
            observation = {'case': folder.name, 'passed': False, 'failures': []}
            report['cases'].append(observation)
            try:
                result = compute(folder)
                observation['result'] = result
                # Expectations are deliberately read only after the calculation.
                expected = json.loads((folder / 'case.json').read_text(encoding='utf-8'))
                observation['expectedFinancial'] = expected['expectedFinancial']
                if result['financial'] != expected['expectedFinancial']:
                    observation['failures'].append({'assertion': 'expectedFinancial', 'expected': expected['expectedFinancial'], 'actual': result['financial']})
                assertions = expected.get('assertions', {})
                actual = {'physicalMembers': len(result['physicalMembers']),
                    'physicalRows': sum(i['kind'] != 'header' for i in result['inventory']),
                    'totals': result['totals'],
                    'differences': {f"{c['account']}|{c['dimensions']}|{c['component']}": c['difference'] for c in result['comparisons']}}
                for key, value in assertions.items():
                    if key not in actual:
                        observation['failures'].append({'assertion': key, 'error': 'Unknown manual assertion; do not silently ignore it.'})
                    elif key == 'differences':
                        for account, difference in value.items():
                            if account not in actual[key] or actual[key][account] != difference:
                                observation['failures'].append({'assertion': f'{key}.{account}', 'expected': difference, 'actual': actual[key].get(account), 'present': account in actual[key]})
                    elif actual[key] != value:
                        observation['failures'].append({'assertion': key, 'expected': value, 'actual': actual[key]})
                observation['passed'] = not observation['failures']
            except Exception as error:
                observation['failures'].append({'error': f'{type(error).__name__}: {error}'})
            if not observation['passed']:
                report['failures'].append({'case': folder.name, 'failures': observation['failures']})
        if len(report['cases']) != manifest['cases']:
            report['failures'].append({'error': 'Case count differs from accepted manifest.'})
        # Supplemental hand-authored diagnostics are another comparison input,
        # loaded only after all four-original computations have completed.
        supplemental_bytes = (frozen.parent / 'supplemental/diagnostic-assertions.json').read_bytes()
        report['diagnosticAssertionsSha256'] = sha256(supplemental_bytes).hexdigest()
        assert report['diagnosticAssertionsSha256'] == ACCEPTED_DIAGNOSTICS, 'Accepted supplemental diagnostic assertions differ.'
        diagnostics = json.loads(supplemental_bytes)
        assert diagnostics['frozenManifestSha256'] == ACCEPTED_MANIFEST
        observations = {entry['case']: entry for entry in report['cases']}
        report['diagnosticChecks'] = []
        for name, expected in diagnostics['cases'].items():
            actual = observations[name]['result']
            fields = ('account', 'dimensions', 'component', 'register', 'gl', 'difference')
            project = lambda row: {field: row[field] for field in fields}
            order = lambda row: (row['account'], row['dimensions'], row['component'])
            checks = {'case': name, 'financial': actual['financial'], 'comparisons': [project(row) for row in actual['comparisons']], 'passed': False}
            checks['passed'] = actual['financial'] == expected['financial'] and sorted(checks['comparisons'], key=order) == sorted(expected['comparisons'], key=order)
            report['diagnosticChecks'].append(checks)
            if not checks['passed']:
                report['failures'].append({'case': name, 'error': 'Supplemental manual diagnostic assertions differ.', 'expected': expected, 'actual': checks})
        report['diagnosticComparisonCount'] = sum(len(check['comparisons']) for check in report['diagnosticChecks'])
        assert len(report['diagnosticChecks']) == 7 and report['diagnosticComparisonCount'] == 21
        for original in report['inputs']:
            assert sha256((frozen / original['path']).read_bytes()).hexdigest() == original['sha256'], 'Frozen bytes changed during the gate.'
        report['allPassed'] = not report['failures']
    except Exception as error:
        report['failures'].append({'error': f'{type(error).__name__}: {error}'})
    for file in ('compute.py', 'run.py', 'test_oracle.py'):
        location = Path(__file__).parent / file
        if location.exists():
            report.setdefault('oracleFiles', {})[file] = sha256(location.read_bytes()).hexdigest()
    for file in ('CLARIFICATIONS-V1.ar.md', 'CLARIFICATIONS-V2.ar.md', 'TEXT-POLICY.ar.md'):
        location = frozen.parent / file
        if location.exists():
            report.setdefault('contractCompanions', {})[file] = sha256(location.read_bytes()).hexdigest()
    (output / 'RESULTS.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--frozen', type=Path, default=Path(__file__).resolve().parent.parent / 'frozen')
    args = parser.parse_args()
    attempts = Path(__file__).resolve().parent / 'attempts'
    attempts.mkdir(exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ-')
    output = Path(tempfile.mkdtemp(prefix=timestamp, dir=attempts))
    report = gate(args.frozen, output)
    print(json.dumps({'output': str(output), 'cases': len(report['cases']), 'allPassed': report['allPassed'], 'failures': report['failures']}, ensure_ascii=False))
    sys.exit(0 if report['allPassed'] else 1)
