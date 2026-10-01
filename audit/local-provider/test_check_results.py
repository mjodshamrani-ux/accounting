import copy
import importlib.util
import json
import pathlib
import tempfile
import unittest

root = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('local_provider_oracle', root / 'check_results.py')
oracle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(oracle)

class IndependentProviderOracleTests(unittest.TestCase):
    def test_actual_runs_verify(self):
        for name in ['cpu-4', 'v2-cpu-4']:
            self.assertTrue(oracle.check(root / 'results' / name)['verified'])

    def test_false_success_and_fabricated_evidence_are_rejected(self):
        original = json.loads((root / 'results/v2-cpu-4/observations.json').read_text())
        def changed_source(report):
            report['cases'][0]['sourceSha256'] = 'f' * 64
        def changed_header(report):
            report['cases'][0]['nativeRequest']['columns'][0]['header']['text'] = 'Invented'
        def invented_success(report):
            report['summary']['modelExact'] = 24
        def invented_approval(report):
            report['cases'][0]['modelAuthority'] = 'approved'
        def missing_case(report):
            report['cases'].pop()
        def concealed_network(report):
            report['networkAttempts'].append({'method': 'fetch', 'target': 'https://example.invalid/'})
        def changed_source_sample(report):
            report['cases'][0]['nativeRequest']['columns'][0]['samples'][0]['text'] = '2026-06-01'
        def changed_semantic_score(report):
            report['cases'][0]['rawQuality']['wrongRoles'] = []
        for alter in [changed_source, changed_header, invented_success, invented_approval, missing_case, concealed_network, changed_source_sample, changed_semantic_score]:
            with self.subTest(alter=alter.__name__), tempfile.TemporaryDirectory() as directory:
                report = copy.deepcopy(original)
                alter(report)
                pathlib.Path(directory, 'observations.json').write_text(json.dumps(report))
                with self.assertRaises(AssertionError):
                    oracle.check(directory)

if __name__ == '__main__':
    unittest.main()
