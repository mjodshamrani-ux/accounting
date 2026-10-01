"""Independent stdlib oracle for the frozen actual-provider experiment.

Recreates native CSV bytes, source IDs and semantic truth without importing the
engine or model runtime. A refused proposal is not a successful interpretation.
"""
import argparse
import csv
import hashlib
import io
import json
import pathlib
from collections import Counter

root = pathlib.Path(__file__).resolve().parent

def quality(columns, expected):
    return {
        'correctRoles': [key for key in expected if columns.get(key) == expected[key]],
        'wrongRoles': [key for key in columns if columns[key] != expected.get(key)],
        'missingRoles': [key for key in expected if key not in columns],
        'exact': all(columns.get(key) == index for key, index in expected.items()) and
                 all(expected.get(key) == index for key, index in columns.items()),
    }

def check(directory):
    directory = pathlib.Path(directory)
    report = json.loads((directory / 'observations.json').read_text())
    freeze = report['experiment']
    for name, sha in freeze['files'].items():
        assert hashlib.sha256((root / name).read_bytes()).hexdigest() == sha, ('frozen-file', name)
    contract = json.loads((root / 'contract.json').read_text())
    manifest = json.loads((root / 'model.json').read_text())
    fixtures = {case['id']: case for case in contract['cases']}
    expected_ids = [(case['id'], lang) for case in contract['cases'] for lang in ('en', 'ar')]
    actual_ids = [(case['id'], case['language']) for case in report['cases']]
    assert actual_ids == expected_ids, ('missing/duplicate/order', actual_ids)
    assert report['modelRevision'] == manifest['revision']
    assert report['modelAssetBytes'] == sum(file['bytes'] for file in manifest['files'])
    assert report['productEnabled'] is False
    assert report['networkAttempts'] == [], 'network-attempts'
    details = []
    for observed in report['cases']:
        fixture, language = fixtures[observed['id']], observed['language']
        rows = [fixture['headers'][language]] + fixture['rows']
        stream = io.StringIO(newline='')
        csv.writer(stream, quoting=csv.QUOTE_ALL, lineterminator='\r\n').writerows(rows)
        native = stream.getvalue().encode('utf-8')
        assert observed['sourceSha256'] == hashlib.sha256(native).hexdigest(), (fixture['id'], 'source-sha')
        assert observed['sourceBytes'] == len(native)
        assert observed['sourceUnchanged'] is True
        assert observed['modelAuthority'] in ('none', 'needs-review')
        for i, column in enumerate(observed['nativeRequest']['columns']):
            assert column['index'] == i
            assert column['header'] == {'id': 'r1c' + str(i + 1), 'text': rows[0][i], 'truncated': False}
            for sample in column['samples']:
                row, col = sample['id'][1:].split('c')
                assert sample['text'] == rows[int(row) - 1][int(col) - 1]
        baseline, proposed = quality(observed['baselineColumns'], fixture['expected']), quality(observed['proposedColumns'], fixture['expected'])
        assert baseline == observed['baselineQuality']
        assert proposed == observed['modelQuality']
        if observed['boundKind'] == 'needs-review':
            output = json.loads(observed['raw'])
            assert set(output) == {'columns', 'citations'}
            assert observed['proposedColumns'] == output['columns']
            assert set(output['citations']) == set(output['columns'])
            assert observed['modelAuthority'] == 'needs-review'
            for role, index in output['columns'].items():
                assert role in observed['nativeRequest']['allowed']
                assert type(index) is int and 0 <= index < len(rows[0])
                assert output['citations'][role] == 'r1c' + str(index + 1)
        else:
            assert observed['proposedColumns'] == {}
            assert observed['modelAuthority'] == 'none'
        if 'rawQuality' in observed:
            assert observed['rawQuality'] == (quality(observed['rawColumns'], fixture['expected']) if observed['rawColumns'] is not None else None)
        details.append({'id': fixture['id'], 'language': language, 'baselineExact': baseline['exact'], 'modelExact': proposed['exact'], 'wrongRoles': proposed['wrongRoles'], 'refused': observed['boundKind'] != 'needs-review', 'timedOut': observed['timedOut']})
    summary = report['summary']
    assert summary['semanticFamilies'] == len(fixtures)
    assert summary['languagePresentations'] == len(details)
    for field, predicate in [
        ('baselineExact', lambda c: c['baselineExact']), ('modelExact', lambda c: c['modelExact']),
        ('wrongSemanticProposals', lambda c: bool(c['wrongRoles'])), ('refusedOrAbstained', lambda c: c['refused']),
    ]:
        assert summary[field] == sum(predicate(c) for c in details)
    assert summary['sourceMutations'] == summary['authorityViolations'] == summary['networkAttempts'] == 0
    latencies = sorted(c['elapsedMs'] for c in report['cases'])
    result = {
        'verified': True, 'reportSha256': hashlib.sha256((directory / 'observations.json').read_bytes()).hexdigest(),
        'modelExact': summary['modelExact'], 'baselineExact': summary['baselineExact'],
        'acceptedWrongSemanticProposals': summary['wrongSemanticProposals'],
        'rawWrongSemanticProposals': summary.get('rawWrongSemanticProposals'),
        'rejectionReasons': dict(Counter(c['rejectedReason'] for c in report['cases'])),
        'medianMs': (latencies[11] + latencies[12]) / 2, 'maxMs': max(latencies),
        'loadMs': report['loadMs'], 'peakObservedProcessRssBytes': max(c['processRssBytes'] for c in report['cases']),
        'timeouts': sum(c['timedOut'] for c in details), 'languagePresentations': len(details),
        'families': len(fixtures), 'limitations': ['synthetic development cases', 'one physical device', 'Node CPU; not browser model inference', 'cold means session load with already downloaded files; OS file cache not controlled', 'sampled RSS is not total system/GPU memory'],
    }
    if (directory / 'supervisor.json').exists():
        supervisor = json.loads((directory / 'supervisor.json').read_text())
        assert supervisor['code'] == 0 and supervisor['timedOutCase'] is None
        result['hardDeadlineSupervisorPassed'] = True
    return result

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('directory')
    parser.add_argument('--out')
    args = parser.parse_args()
    result = check(args.directory)
    if args.out:
        pathlib.Path(args.out).write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))
