"""Independent arithmetic oracle and rejection cases; no production reducer imported."""
import copy
import unittest
from check_record import check


def fixture():
    return {'kind': 'review-effort', 'version': 1, 'sourceSha256': 'a'*64,
            'sample': 'development', 'startedAt': '2026-10-05T00:00:00.000Z',
            'idleAfterMs': 30000, 'events': [
                {'type': 'stage', 'stage': 'table', 'atMs': 1000},
                {'type': 'pause', 'reason': 'manual', 'atMs': 3000},
                {'type': 'resume', 'atMs': 13000},
                {'type': 'rework', 'enabled': True, 'atMs': 15000},
                {'type': 'finish', 'reason': 'user', 'atMs': 19000}]}


class RecordTests(unittest.TestCase):
    def test_independent_expected_duration(self):
        result = check(fixture())
        self.assertEqual(result['firstMs'], {'values': 1000, 'table': 4000, 'context': 0})
        self.assertEqual(result['reworkMs'], {'values': 0, 'table': 4000, 'context': 0})
        self.assertEqual(result['pausedMs']['manual'], 10000)
        self.assertEqual(result['wallMs'], 19000)

    def test_expired_idle_deadline_is_rejected(self):
        r = fixture()
        r['events'] = [{'type': 'finish', 'reason': 'user', 'atMs': 40000}]
        with self.assertRaises(AssertionError): check(r)
        r['events'].insert(0, {'type': 'pause', 'reason': 'idle', 'atMs': 30000})
        self.assertEqual(check(r)['pausedMs']['idle'], 10000)

    def test_unfinished_or_content_injected_is_rejected(self):
        for kind in ('unfinished', 'private', 'totals', 'after-finish'):
            r = fixture()
            if kind == 'unfinished': r['events'].pop()
            elif kind == 'private': r['events'][0]['value'] = 'private'
            elif kind == 'totals': r['activeMs'] = 9000
            else: r['events'].append(copy.deepcopy(r['events'][-1]))
            with self.subTest(kind=kind), self.assertRaises(AssertionError): check(r)

    def test_declared_case_is_not_provenance_and_date_must_be_valid(self):
        r = fixture()
        r['sample'] = 'field-self-declared'
        self.assertEqual(check(r)['wallMs'], 19000)
        for stamp in ('2026-02-30T00:00:00.000Z', 'yesterday'):
            r['startedAt'] = stamp
            with self.subTest(stamp=stamp), self.assertRaises((AssertionError, ValueError)): check(r)


if __name__ == '__main__':
    unittest.main()
