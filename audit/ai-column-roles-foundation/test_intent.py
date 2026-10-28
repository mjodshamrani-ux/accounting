"""The headings, read by hand, agree with the keys the stories print them over.

  python3 -B -m unittest discover -s audit/ai-column-roles-foundation -p test_intent.py -v

INTENT below was written from the headings alone: for each, the role a
reader of the printed statement may conclude (one of the mapping's seven),
'none' for a column that holds no role a reconciliation reads, or
'undecided' when the heading says nothing a reader could decide from. It is
not derived from stories.py; the tests check that the two agree, and that
each class holds what its definition promises.
"""
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from roles import ROLE_OF_KEY, roles  # noqa: E402
from stories import STORIES  # noqa: E402

INTENT = {
    # English
    'Date': 'date', 'Txn Date': 'date', 'Trans. Date': 'date', 'Entry Date': 'date', 'Bill Date': 'date',
    'Booked': 'date', 'Day posted': 'date', 'When': 'date', 'Recorded on': 'date', 'Inv. Date': 'date',
    'Posted': 'date', 'Value Dt': 'date',
    'Invoice No': 'reference', 'Doc #': 'reference', 'Inv. No': 'reference', 'Ref #': 'reference',
    'Bill No': 'reference', 'Document': 'reference', 'Our invoice': 'reference', 'Document number': 'reference',
    'Reference': 'reference', 'Inv. Ref': 'reference', 'Supplier Doc': 'reference', 'Txn Ref': 'reference',
    'Bill Ref': 'reference',
    'Description': 'description', 'Narrative': 'description', 'Details': 'description',
    'Particulars': 'description', 'Memo': 'description', 'Item': 'description', 'What for': 'description',
    'Line text': 'description', 'Narration': 'description',
    'Amount': 'amount', 'Total SAR': 'amount', 'Amt': 'amount', 'Net Amt': 'amount', 'Sum (SAR)': 'amount',
    'Movement value': 'amount', 'Gross': 'amount', 'Line Total': 'amount', 'Incl. VAT': 'amount',
    'Charges': 'debit', 'Dr Amount': 'debit', 'Billed to you': 'debit', 'Charged': 'debit',
    'Payments': 'credit', 'Cr Amount': 'credit', 'Received from you': 'credit', 'Settled': 'credit',
    'Curr.': 'currencyColumn',
    'Type': 'none', 'Balance': 'none', 'Running Bal.': 'none', 'You owe': 'none', 'Due Date': 'none',
    'PO No': 'none', 'Qty': 'none', 'VAT': 'none', 'Bal.': 'none', 'Order Ref': 'none', 'Outstanding': 'none',
    # Arabic
    'التاريخ': 'date', 'تاريخ الفاتورة': 'date', 'تاريخ العملية': 'date', 'يوم الحركة': 'date',
    'تاريخ التسجيل': 'date', 'يوم القيد': 'date',
    'رقم الفاتورة': 'reference', 'رقم المرجع': 'reference', 'المستند': 'reference', 'رقم الوثيقة': 'reference',
    'رقم المستند': 'reference', 'رقم فاتورتنا': 'reference', 'معرف المستند': 'reference',
    'البيان': 'description', 'التفاصيل': 'description', 'الشرح': 'description', 'الوصف': 'description',
    'تفاصيل العملية': 'description',
    'قيمة الحركة': 'amount', 'صافي المبلغ': 'amount', 'المبلغ المستحق': 'amount', 'الإجمالي': 'amount',
    'مدين': 'debit', 'المدين': 'debit', 'عليه': 'debit', 'ما عليكم': 'debit',
    'دائن': 'credit', 'الدائن': 'credit', 'له': 'credit', 'ما لكم': 'credit',
    'الرصيد': 'none', 'النوع': 'none', 'الرصيد بعد القيد': 'none', 'تاريخ الاستحقاق': 'none', 'الضريبة': 'none',
}
UNDECIDED = {f'Col {n}' for n in range(1, 8)} | set('ABCDEFG') | {f'حقل {n}' for n in range(1, 8)}

# The headings the S3 supplier contract names (its COLUMN_SETS), written out.
NAMED = {'Date', 'Invoice No', 'Description', 'Debit', 'Credit', 'Balance', 'Type', 'Document No', 'Amount',
         'Supplier Ref', 'Running Balance', 'Invoice Date', 'Due Date', 'Currency', 'التاريخ', 'رقم الفاتورة',
         'البيان', 'مدين', 'دائن', 'الرصيد', 'نوع المستند', 'رقم المستند', 'الوصف', 'المبلغ'}
DECOYS = {'due', 'balance', 'qty', 'vat', 'order'}


class Intent(unittest.TestCase):
    def test_every_heading_is_read_by_hand(self):
        for st in STORIES:
            for key, heading in st['columns']:
                self.assertTrue(heading in INTENT or heading in UNDECIDED, f"{st['id']}: {heading} not read")

    def test_a_decidable_heading_names_the_role_its_column_holds(self):
        for st in STORIES:
            if st['class'] == 'K5':
                continue
            for key, heading in st['columns']:
                self.assertEqual(INTENT[heading], ROLE_OF_KEY.get(key, 'none'), f"{st['id']}: {heading} over {key}")

    def test_k5_headings_say_nothing_and_every_role_has_a_twin(self):
        for st in [s for s in STORIES if s['class'] == 'K5']:
            keys = [k for k, _ in st['columns']]
            self.assertTrue(all(h in UNDECIDED for _, h in st['columns']), st['id'])
            for pair in (('date', 'due'), ('ref', 'order'), ('amount', 'balance')):
                self.assertTrue(set(pair) <= set(keys), f"{st['id']}: {pair}")

    def test_controls_print_only_named_headings_and_others_at_least_one_role_unnamed(self):
        for st in STORIES:
            unnamed = [h for h in roles(st).values() if h not in NAMED]
            if st['class'] == 'K0':
                self.assertEqual(unnamed, [], st['id'])
            else:
                self.assertTrue(unnamed, st['id'])

    def test_k4_prints_a_decoy_beside_a_role(self):
        for st in [s for s in STORIES if s['class'] == 'K4']:
            keys = [k for k, _ in st['columns']]
            near = any(keys[i] in DECOYS and ((i and keys[i - 1] in ROLE_OF_KEY) or
                                               (i + 1 < len(keys) and keys[i + 1] in ROLE_OF_KEY))
                       for i in range(len(keys)))
            self.assertTrue(near, st['id'])

    def test_the_set_holds_every_class_both_languages_and_both_writers(self):
        classes = {}
        for st in STORIES:
            classes.setdefault(st['class'], []).append(st)
        self.assertEqual(sorted(classes), ['K0', 'K1', 'K2', 'K3', 'K4', 'K5'])
        self.assertEqual(len(STORIES), 24)
        self.assertEqual({s['language'] for s in STORIES}, {'en', 'ar'})
        self.assertEqual({s['producer'] for s in STORIES}, {'hexapdf', 'pdflib'})
        self.assertTrue(all(s['producer'] == 'pdflib' for s in STORIES if s['language'] == 'ar'))
        for cls in ('K1', 'K3', 'K4', 'K5'):
            self.assertEqual({s['producer'] for s in classes[cls]}, {'hexapdf', 'pdflib'}, cls)
        for cls in ('K0', 'K3', 'K4', 'K5'):
            self.assertEqual({s['language'] for s in classes[cls]}, {'en', 'ar'}, cls)
        self.assertTrue(any(ROLE_OF_KEY.get(k) == 'currencyColumn' for s in STORIES for k, _ in s['columns']))
        self.assertTrue(any({'debit', 'credit'} <= {k for k, _ in s['columns']} for s in STORIES if s['class'] != 'K0'))

    def test_an_arabic_signed_amount_prints_a_negative_in_parentheses(self):
        for st in STORIES:
            keys = {k for k, _ in st['columns']}
            if st['language'] == 'ar' and 'amount' in keys:
                self.assertEqual(st['negative'], 'parens', st['id'])

    def test_the_intent_table_would_catch_a_swapped_key(self):
        st = next(s for s in STORIES if s['id'] == 'X01')
        swapped = [[('due' if k == 'date' else 'date' if k == 'due' else k), h] for k, h in st['columns']]
        wrong = [h for k, h in swapped if INTENT[h] != ROLE_OF_KEY.get(k, 'none')]
        self.assertEqual(wrong, ['Inv. Date', 'Due Date'])


if __name__ == '__main__':
    unittest.main()
