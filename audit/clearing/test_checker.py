import copy
import unittest
from unittest.mock import patch
import check_export as checker


class ClearingOracleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.book = checker.sheets('work/clearing/direct.xlsx')

    def test_actual_export_passes(self):
        self.assertEqual(checker.verify('work/clearing/direct.xlsx')['cleared'], 5)

    def rejected(self, mutate):
        book = copy.deepcopy(self.book)
        mutate(book)
        with patch.object(checker, 'sheets', return_value=book):
            with self.assertRaises((AssertionError, KeyError, ValueError)):
                checker.verify('tampered.xlsx')

    def test_changed_original_amount_rejected(self):
        self.rejected(lambda b: b['Movements'][1].__setitem__(5, '100001'))

    def test_duplicate_membership_rejected(self):
        self.rejected(lambda b: b['Membership'][2].__setitem__(1, b['Membership'][1][1]))

    def test_invented_automatic_relationship_rejected(self):
        self.rejected(lambda b: b['Movements'][1].__setitem__(3, 'Other reference'))

    def test_lost_source_row_rejected(self):
        self.rejected(lambda b: b['Source inventory'].pop())

    def test_false_group_net_rejected(self):
        self.rejected(lambda b: b['Cases'][1].__setitem__(5, '1'))


if __name__ == '__main__':
    unittest.main()
