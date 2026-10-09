import copy
import unittest
from unittest.mock import patch
import check_export as checker

class ArOracleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.book=checker.sheets('work/ar-limited/positive-direct.xlsx')
    def rejected(self,mutate):
        book=copy.deepcopy(self.book);mutate(book)
        with patch.object(checker,'sheets',return_value=book):
            with self.assertRaises((AssertionError,KeyError,ValueError)):
                checker.verify('tampered.xlsx')
    def test_actual_original_and_restored_exports_pass(self):
        for contract in ['positive','amount-difference','type-collision','receipt-is-not-invoice-allocation','duplicate-own-document']:
            for suffix in ['direct','restored']:
                self.assertTrue(checker.verify(f'work/ar-limited/{contract}-{suffix}.xlsx',contract)['passed'])
        self.assertTrue(checker.verify('work/ar-limited/positive-reconfirmed.xlsx')['passed'])
        for suffix in ['reopened','reopened-restored']:
            self.assertEqual(len(checker.verify(f'work/ar-limited/positive-{suffix}.xlsx',reopened=True)['matchedPairs']),2)
    def test_changed_original_money_rejected(self):
        self.rejected(lambda b:b['Movements'][1].__setitem__(7,'10001'))
    def test_changed_document_role_rejected(self):
        self.rejected(lambda b:b['Movements'][1].__setitem__(4,'receipt'))
    def test_related_invoice_used_as_document_rejected(self):
        self.rejected(lambda b:b['Movements'][2].__setitem__(5,'I001'))
    def test_duplicate_membership_rejected(self):
        self.rejected(lambda b:b['Membership'][2].__setitem__(1,b['Membership'][1][1]))
    def test_lost_original_row_rejected(self):
        self.rejected(lambda b:b['Ledger inventory'].pop())
    def test_changed_original_bytes_rejected(self):
        self.rejected(lambda b:b['Sources'][1].__setitem__(6,'ZmFrZQ=='))
    def test_changed_source_perspective_rejected(self):
        self.rejected(lambda b:b['Sources'][1].__setitem__(1,'buyer-ap-ledger'))
    def test_changed_reading_role_rejected(self):
        self.rejected(lambda b:next(r for r in b['Reading'][1:] if r[1]=='role').__setitem__(2,'supplier'))
    def test_forged_decision_context_or_members_rejected(self):
        for context,members in [('STALE','[]'),('STALE','["unbound"]')]:
            self.rejected(lambda b:b['Decisions'].append(['1',context,'accept',members,'Synthetic forged decision','2026-10-06T00:00:00.000Z']))
    def test_reconfirmed_decision_tampering_rejected(self):
        book=checker.sheets('work/ar-limited/positive-reconfirmed.xlsx')
        for column,value in [(1,'STALE'),(3,'[]'),(4,'tiny'),(5,'yesterday')]:
            changed=copy.deepcopy(book);changed['Decisions'][1][column]=value
            with patch.object(checker,'sheets',return_value=changed):
                with self.assertRaises((AssertionError,KeyError,ValueError)):
                    checker.verify('tampered.xlsx')

if __name__=='__main__':unittest.main()
