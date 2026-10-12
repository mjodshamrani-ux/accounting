"""Self-authored semantic and raw-byte controls, independent of root fixtures/truth."""
import copy
import csv
import io
import tempfile
import unittest
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

import ar_oracle as oracle

SCOPE = {'entity': 'Seller', 'ledger': 'AR', 'customer': 'Customer 01', 'account': '001',
         'currency': 'SAR', 'start': '2026-01-01', 'end': '2026-12-31', 'confirmed': True}
COLS = oracle.REQUIRED_COLUMNS + oracle.OPTIONAL_COLUMNS


def source_rows(side=0, records=None, currency='SAR'):
    fields = {'Scope ID': 'scope-%d' % side,
              'Source role': ('company-ar-ledger', 'company-issued-customer-statement')[side],
              'Perspective': 'seller-receivable', 'Amount basis': 'original-movement',
              'Entity': 'Seller', 'Ledger': 'AR', 'Customer': 'Customer 01', 'Account': '001',
              'Currency': currency, 'Period start': '2026-01-01', 'Period end': '2026-12-31',
              'Scope reference': 'Ref-%d' % side}
    result = [['AR_SCOPE', '1']] + [[key, fields[key]] for key in oracle.REQUIRED_SCOPE]
    result += [['DETAILS'], list(COLS)]
    if records is None:
        records = [{'posting': 'p-%d' % side, 'own': '001', 'amount': '100.00'}]
    for record in records:
        result.append([record.get('parent', fields['Scope ID']), record.get('posting', 'p-%d' % side),
                       record.get('type', 'invoice'), record.get('own', '001'),
                       record.get('date', '2026-01-02'), record.get('amount', '100.00'),
                       record.get('related', ''), record.get('open', '17.00'), record.get('description', '')])
    return result + [['END_DETAILS']]


def csv_bytes(rows):
    stream = io.StringIO(newline='')
    csv.writer(stream, lineterminator='\n').writerows(rows)
    return stream.getvalue().encode('utf-8')


def xlsx_bytes(rows, alteration=None):
    output = io.BytesIO()
    xmlrows = []
    for number, values in enumerate(rows, 1):
        cells = []
        for col, raw in enumerate(values, 1):
            ref = oracle.col_letters(col) + str(number)
            text = '<c r="%s" t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>' % (ref, escape(raw))
            if alteration and alteration.get('cell') == ref:
                text = alteration['xml']
            cells.append(text)
        attr = ' hidden="1"' if alteration and alteration.get('hiddenRow') == number else ''
        if alteration and alteration.get('zeroHeightRow') == number:
            attr += ' ht="0" customHeight="1"'
        xmlrows.append('<row r="%d"%s>%s</row>' % (number, attr, ''.join(cells)))
    extra = alteration.get('extra', '') if alteration else ''
    state = ' hidden="1"' if alteration and alteration.get('hiddenSheet') else ''
    if state:
        state = ' state="hidden"'
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('xl/workbook.xml', '<workbook xmlns="%s" xmlns:r="%s"><sheets><sheet name="Data" sheetId="1" r:id="rId1"%s/></sheets></workbook>' % (oracle.NS['m'], oracle.NS['r'], state))
        z.writestr('xl/_rels/workbook.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="%s/worksheet"/></Relationships>' % oracle.NS['r'])
        z.writestr('xl/worksheets/sheet1.xml', '<worksheet xmlns="%s">%s<sheetData>%s</sheetData></worksheet>' % (oracle.NS['m'], extra, ''.join(xmlrows)))
        default_styles = '<styleSheet xmlns="%s"><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="2"/></cellXfs></styleSheet>' % oracle.NS['m']
        z.writestr('xl/styles.xml', alteration.get('styles', default_styles) if alteration else default_styles)
    return output.getvalue()


def extend_workbook(data, extra_sheets=(), extra_parts=()):
    """Rewrite only self-authored raw OOXML to exercise package/whole-book guards."""
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        parts = {name: archive.read(name) for name in archive.namelist()}
    additions, relations = [], []
    for n, rawxml in enumerate(extra_sheets, 2):
        additions.append('<sheet name="Other%d" sheetId="%d" r:id="rId%d"/>' % (n, n, n))
        relations.append('<Relationship Id="rId%d" Target="worksheets/sheet%d.xml" Type="%s/worksheet"/>' % (n, n, oracle.NS['r']))
        parts['xl/worksheets/sheet%d.xml' % n] = rawxml.encode()
    parts['xl/workbook.xml'] = parts['xl/workbook.xml'].replace(b'</sheets>', (''.join(additions) + '</sheets>').encode())
    parts['xl/_rels/workbook.xml.rels'] = parts['xl/_rels/workbook.xml.rels'].replace(b'</Relationships>', (''.join(relations) + '</Relationships>').encode())
    parts.update(extra_parts)
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name, content in parts.items():
            archive.writestr(name, content)
    return output.getvalue()


def sparse_sheet(row, col=1):
    return '<worksheet xmlns="%s"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>x</t></is></c></row><row r="%d"><c r="%s%d" t="inlineStr"><is><t>x</t></is></c></row></sheetData></worksheet>' % (oracle.NS['m'], row, oracle.col_letters(col), row)


class OracleTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(self.tmp.name)
    def tearDown(self):
        self.tmp.cleanup()
    def pair(self, left=None, right=None, fmt='csv', alteration=None, options=None):
        left = source_rows(0) if left is None else left
        right = source_rows(1) if right is None else right
        if fmt == 'xlsx':
            data = [xlsx_bytes(left, alteration), xlsx_bytes(right)]
        else:
            data = [csv_bytes(left), csv_bytes(right)]
        names = ['left.' + fmt, 'right.' + fmt]
        for name, content in zip(names, data):
            (self.base / name).write_bytes(content)
        bundle = {'files': names, 'families': ['ar-scope-details-1'] * 2,
                  'scope': copy.deepcopy(SCOPE), 'readingConfirmed': [True, True], 'sheets': [0, 0]}
        if options:
            bundle.update(options)
        return oracle.reconcile(bundle, self.base)
    def assertReject(self, result, code):
        self.assertEqual(result['status'], 'source-error')
        self.assertEqual(result['matchedPairCount'], 0)
        self.assertIn(code, result['requiredIssueCategories'])

    def test_original_is_authority(self):
        right = source_rows(1, [{'amount': '101.00', 'open': '100.00'}])
        result = self.pair(right=right)
        self.assertEqual(result['status'], 'review')
        self.assertEqual(result['totalsMinor'], [10000, 10100])
        self.assertEqual(result['cases'][0]['reason'], 'amount-difference')

    def test_open_balance_does_not_change_match(self):
        result = self.pair(right=source_rows(1, [{'open': '−999999999999999999999999٫99'}]))
        self.assertEqual(result['status'], 'matched')
        self.assertEqual(result['totalsMinor'], [10000, 10000])
        self.assertEqual(result['sources'][1]['records'][0]['openBalanceRaw'], '−999999999999999999999999٫99')
        self.assertEqual(result['receiptAllocations'], [])
        self.assertFalse(result['financialCompletenessAsserted'])

    def test_missing_original_not_filled_from_open(self):
        self.assertReject(self.pair(left=source_rows(0, [{'amount': '', 'open': '100.00'}])), 'invalid-amount')

    def test_selected_open_role_rejected(self):
        self.assertReject(self.pair(options={'selectedAmountHeaders': ['Open balance', 'Original signed amount']}), 'original-amount-role-required')

    def test_full_inventory_and_provenance(self):
        left = source_rows(0)
        left.insert(10, [])
        left.insert(17, [])
        result = self.pair(left=left)
        self.assertEqual(result['status'], 'matched')
        source = result['sources'][0]
        self.assertEqual(len(source['inventory']), len(left))
        record = source['records'][0]
        self.assertEqual(record['physicalRow'], 17)
        self.assertTrue(record['memberId'].endswith(':CSV:17'))
        self.assertEqual(record['parentCell'], {'row': 17, 'column': 1, 'raw': 'scope-0'})
        inherited = {x['field']: x for x in record['inheritedSourceCells']}
        self.assertEqual(inherited['Entity']['headerRow'], 6)
        self.assertEqual(inherited['Entity']['headerValueColumn'], 2)
        self.assertEqual(inherited['Entity']['sourceSha256'], source['sha256'])

    def test_multiline_csv_logical_row(self):
        left = source_rows(0, [{'description': 'one\ntwo'}])
        result = self.pair(left=left)
        row = result['sources'][0]['inventory'][15]
        self.assertEqual(row['physicalRow'], 16)
        self.assertEqual(row['lineSpan'], [16, 17])
        self.assertEqual(result['sources'][0]['records'][0]['physicalRow'], 16)

    def test_all_document_types_same_number(self):
        records = [{'posting': 'p1', 'own': 'same', 'amount': '100'},
                   {'posting': 'p2', 'own': 'same', 'type': 'credit-note', 'amount': '-20'},
                   {'posting': 'p3', 'own': 'same', 'type': 'receipt', 'amount': '-30', 'related': 'same'}]
        result = self.pair(source_rows(0, records), source_rows(1, records))
        self.assertEqual(result['matchedPairCount'], 3)
        self.assertEqual(result['totalsMinor'], [5000, 5000])
        self.assertEqual(result['receiptAllocations'], [])

    def test_duplicate_document_review(self):
        records = [{'posting': 'p1'}, {'posting': 'p2'}]
        result = self.pair(source_rows(0, records), source_rows(1))
        self.assertEqual(result['status'], 'review')
        self.assertEqual(result['cases'][0]['reason'], 'duplicate-document')
        self.assertEqual(len(result['cases'][0]['leftMembers']), 2)

    def test_duplicate_posting_invalid_all_members(self):
        left = source_rows(0, [{'posting': 'p1', 'own': 'a'}, {'posting': 'p1', 'own': 'b'}])
        result = self.pair(left=left)
        self.assertReject(result, 'duplicate-posting-id')
        self.assertEqual(result['validRowCounts'][0], 0)
        self.assertEqual(len([r for r in result['sources'][0]['inventory'] if r['classification'] == 'invalid-movement']), 2)

    def test_late_invalid_competitor_preserved(self):
        left = source_rows(0, [{'posting': 'p1'}, {'posting': 'p1', 'amount': 'invalid'}])
        result = self.pair(left=left)
        self.assertReject(result, 'duplicate-posting-id')
        self.assertIn('invalid-amount', result['requiredIssueCategories'])
        self.assertEqual(result['validRowCounts'][0], 0)
        self.assertEqual(result['cases'][0]['leftMembers'], [])
        self.assertEqual(len(result['sources'][0]['errorInventoryRefs']), 2)
        self.assertTrue(result['sources'][0]['errorInventoryRefs'][1].endswith(':CSV:17'))

    def test_invalid_row_diagnostic_totals(self):
        left = source_rows(0, [{'posting': 'p1'}, {'posting': 'p2', 'amount': '0'}])
        result = self.pair(left=left)
        self.assertReject(result, 'zero-amount')
        self.assertEqual(result['totalsMinor'][0], 10000)
        self.assertEqual(result['validRowCounts'][0], 1)
        self.assertEqual(result['totalBasis'], 'diagnostic-valid-records')

    def test_structural_error_null_total(self):
        left = source_rows(0)
        left.pop()
        result = self.pair(left=left)
        self.assertReject(result, 'missing-end-details')
        self.assertIsNone(result['totalsMinor'][0])
        self.assertEqual(result['validRowCounts'][0], 0)

    def test_related_conflict_only_both_explicit(self):
        result = self.pair(source_rows(0, [{'related': 'A'}]), source_rows(1, [{'related': 'B'}]))
        self.assertEqual(len(result['cases']), 1, 'explicit conflicting related references require a review case')
        self.assertEqual(result['cases'][0]['reason'], 'related-conflict')
        self.assertEqual(self.pair(left=source_rows(0, [{'related': 'A'}]))['status'], 'matched')

    def test_date_difference(self):
        result = self.pair(right=source_rows(1, [{'date': '2026-01-03'}]))
        self.assertEqual(result['cases'][0]['reason'], 'date-difference')

    def test_missing_member(self):
        result = self.pair(right=source_rows(1, []))
        self.assertEqual(result['status'], 'review')
        self.assertIn('missing-counterpart', result['requiredIssueCategories'])

    def test_empty_is_review(self):
        result = self.pair(source_rows(0, []), source_rows(1, []))
        self.assertEqual(result['status'], 'review')
        self.assertEqual(result['matchedPairCount'], 0)
        self.assertIn('empty-source', result['requiredIssueCategories'])

    def test_identical_bytes_rejected(self):
        result = self.pair(source_rows(0), source_rows(0))
        self.assertReject(result, 'identical-source-hashes')

    def test_permuted_columns(self):
        left = source_rows(0)
        left[14].reverse()
        left[15].reverse()
        self.assertEqual(self.pair(left=left)['status'], 'matched')

    def test_mixed_old_canonical_control(self):
        names = ['Posting ID', 'Document type', 'Own document number', 'Posting date', 'Original signed amount',
                 'Entity', 'Ledger', 'Customer', 'Account', 'Currency', 'Open balance', 'unrelated']
        old = [names, ['old-p1', 'invoice', '001', '2026-01-02', '100', 'Seller', 'AR', 'Customer 01', '001', 'SAR', 'nonsense', 'raw']]
        result = self.pair(right=old, options={'families': ['ar-scope-details-1', 'ar-limited-1']})
        self.assertEqual(result['status'], 'matched')
        self.assertEqual(result['sources'][1]['records'][0]['inheritedSourceCells'], [])
        self.assertEqual(result['sources'][1]['records'][0]['openBalanceRaw'], 'nonsense')

    def test_old_aliases_and_arabic_types(self):
        names = ['معرف الحركة الفريد', 'نوع المستند', 'رقم المستند الأصلي', 'تاريخ الترحيل', 'مبلغ الحركة الأصلي الموقع',
                 'الكيان', 'الدفتر', 'معرف العميل', 'الحساب', 'العملة']
        old = [names, ['old-p1', 'فاتورة', '001', '2026-01-02', '١٠٠', 'Seller', 'AR', 'Customer 01', '001', 'SAR']]
        result = self.pair(right=old, options={'families': ['ar-scope-details-1', 'ar-limited-1']})
        self.assertEqual(result['status'], 'matched')

    def test_native_iso_and_literal_numeric(self):
        change = {'cell': 'F16', 'xml': '<c r="F16" s="1"><v>100.00</v></c>'}
        result = self.pair(fmt='xlsx', alteration=change)
        self.assertEqual(result['status'], 'matched')
        self.assertEqual(result['sources'][0]['sheet'], 'Data')
        self.assertTrue(result['sources'][0]['records'][0]['memberId'].endswith(':Data:16'))

    def test_formula_unused_open_detected(self):
        change = {'cell': 'H16', 'xml': '<c r="H16"><f>1-1</f><v>0</v></c>'}
        result = self.pair(fmt='xlsx', alteration=change)
        self.assertReject(result, 'formula-cell')
        self.assertEqual(result['sources'][0]['inventory'][15]['rawCells'][7], '0')

    def test_native_hidden_text_custom_format_rejected(self):
        styles = '<styleSheet xmlns="%s"><numFmts count="1"><numFmt numFmtId="164" formatCode=";;;"/></numFmts><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>' % oracle.NS['m']
        change = {'cell': 'B8', 'xml': '<c r="B8" t="inlineStr" s="1"><is><t>Customer 01</t></is></c>', 'styles': styles}
        result = self.pair(fmt='xlsx', alteration=change)
        self.assertReject(result, 'unsupported-number-format')
        self.assertEqual(result['sources'][0]['inventory'][7]['rawCells'][1], 'Customer 01')

    def test_native_zero_width_open_column_rejected(self):
        change = {'extra': '<cols><col min="8" max="8" width="0" customWidth="1"/></cols>'}
        result = self.pair(fmt='xlsx', alteration=change)
        self.assertReject(result, 'hidden-column')
        self.assertIn('hidden-cell', result['requiredIssueCategories'])
        self.assertEqual(result['sources'][0]['inventory'][15]['rawCells'][7], '17.00')

    def test_native_zero_height_movement_row_rejected(self):
        result = self.pair(fmt='xlsx', alteration={'zeroHeightRow': 16})
        self.assertReject(result, 'hidden-row')
        self.assertEqual(result['sources'][0]['inventory'][15]['rawCells'][5], '100.00')

    def test_blank_formula_not_discarded(self):
        left = source_rows(0)
        left.insert(16, [''])
        change = {'cell': 'A17', 'xml': '<c r="A17" t="str"><f>""</f><v></v></c>'}
        result = self.pair(left=left, fmt='xlsx', alteration=change)
        self.assertReject(result, 'formula-cell')
        self.assertEqual(result['sources'][0]['inventory'][16]['classification'], 'invalid-movement')

    def test_amount_limit_inclusive(self):
        self.assertEqual(oracle.money('1000000000000', 'SAR'), 10 ** 14)
        with self.assertRaisesRegex(ValueError, 'amount-bound'):
            oracle.money('1000000000000.01', 'SAR')

    def test_total_limit(self):
        records = [{'posting': 'p1', 'own': 'a', 'amount': '1000000000000'}, {'posting': 'p2', 'own': 'b', 'amount': '0.01'}]
        self.assertReject(self.pair(source_rows(0, records), source_rows(1, records)), 'total-bound')

    def test_currency_precision_exact(self):
        self.assertEqual(oracle.money('123', 'JPY'), 123)
        self.assertEqual(oracle.money('1.234', 'KWD'), 1234)
        self.assertEqual(oracle.money('١۲٣٫٤٥', 'SAR'), 12345)
        self.assertEqual(oracle.money('\u061c\u200e−۱۲٫۳۴\u200f', 'SAR'), -1234)

    def test_identity_utf16_bound(self):
        self.assertEqual(oracle.identity('😀' * 100), '😀' * 100)
        with self.assertRaisesRegex(ValueError, 'invalid-identity'):
            oracle.identity('😀' * 101)

    def test_detail_limit_includes_invalid_rows(self):
        records = [{'posting': 'p%d' % i, 'own': 'd%d' % i, 'amount': '0'} for i in range(20001)]
        result = self.pair(left=source_rows(0, records))
        self.assertReject(result, 'detail-row-bound')
        self.assertEqual(len(result['sources'][0]['inventory']), 20017)
        self.assertEqual(len([r for r in result['sources'][0]['inventory'] if r['classification'] == 'invalid-movement']), 20001)

    def test_reader_limit_headers_and_blanks_count(self):
        left = source_rows(0) + [[] for _ in range(20014)]
        self.assertReject(self.pair(left=left), 'reader-row-bound')

    def test_reading_confirmation_required(self):
        self.assertReject(self.pair(options={'readingConfirmed': [False, True]}), 'reading-unconfirmed')

    def test_external_scope_confirmation_required(self):
        scope = {**SCOPE, 'confirmed': False}
        self.assertReject(self.pair(options={'scope': scope}), 'scope-unconfirmed')

    def test_native_selection_required(self):
        self.assertReject(self.pair(fmt='xlsx', options={'sheets': [None, 0]}), 'sheet-selection-required')

    def test_outer_zip_uncompressed_bound_inclusive(self):
        base = xlsx_bytes(source_rows(0))
        with zipfile.ZipFile(io.BytesIO(base)) as archive:
            existing = sum(info.file_size for info in archive.infolist())
        padding = b'x' * (32 * 1024 * 1024 - existing)
        exact = extend_workbook(base, extra_parts=[('padding.bin', padding)])
        self.assertLess(len(exact), oracle.MAX_BYTES)
        self.assertEqual(oracle.read_xlsx(exact, 0)[0], 'Data')
        over = extend_workbook(base, extra_parts=[('padding.bin', padding + b'x')])
        with self.assertRaisesRegex(ValueError, 'xlsx-package-bound'):
            oracle.read_xlsx(over, 0)

    def test_outer_zip_entry_bound_inclusive(self):
        base = xlsx_bytes(source_rows(0))
        with zipfile.ZipFile(io.BytesIO(base)) as archive:
            remaining = 1000 - len(archive.infolist())
        parts = [('unused/%d' % n, b'') for n in range(remaining)]
        self.assertEqual(oracle.read_xlsx(extend_workbook(base, extra_parts=parts), 0)[0], 'Data')
        with self.assertRaisesRegex(ValueError, 'xlsx-package-bound'):
            oracle.read_xlsx(extend_workbook(base, extra_parts=parts + [('one-more', b'')]), 0)

    def test_outer_worksheet_bound_inclusive(self):
        base = xlsx_bytes(source_rows(0))
        sheets = [sparse_sheet(2)] * 39
        self.assertEqual(oracle.read_xlsx(extend_workbook(base, extra_sheets=sheets), 0)[0], 'Data')
        with self.assertRaisesRegex(ValueError, 'worksheet-count-bound'):
            oracle.read_xlsx(extend_workbook(base, extra_sheets=sheets + [sparse_sheet(2)]), 0)

    def test_outer_column_bound_native_inclusive(self):
        base = xlsx_bytes(source_rows(0))
        self.assertEqual(oracle.read_xlsx(extend_workbook(base, extra_sheets=[sparse_sheet(2, 100)]), 0)[0], 'Data')
        with self.assertRaisesRegex(ValueError, 'reader-column-bound'):
            oracle.read_xlsx(extend_workbook(base, extra_sheets=[sparse_sheet(2, 101)]), 0)

    def test_outer_column_bound_csv_inclusive(self):
        self.assertEqual(len(oracle.read_csv(csv_bytes([[''] * 100]))[1][0]['rawCells']), 100)
        with self.assertRaisesRegex(ValueError, 'reader-column-bound'):
            oracle.read_csv(csv_bytes([[''] * 101]))

    def test_outer_workbook_area_bound_inclusive(self):
        base = xlsx_bytes(source_rows(0))
        # Selected shape: 17 physical rows × 9 physical columns = 153.
        exact = extend_workbook(base, extra_sheets=[sparse_sheet(1000000 - 153)])
        self.assertEqual(oracle.read_xlsx(exact, 0)[0], 'Data')
        with self.assertRaisesRegex(ValueError, 'workbook-cell-area-bound'):
            oracle.read_xlsx(extend_workbook(base, extra_sheets=[sparse_sheet(1000000 - 152)]), 0)

    def test_outer_selected_row_bound_inclusive(self):
        # XML sparse addressing does not allow a compacted derived row count.
        base = xlsx_bytes([['x']])
        exact = extend_workbook(base, extra_sheets=[sparse_sheet(20030)])
        self.assertEqual(len(oracle.read_xlsx(exact, 1)[1]), 20030)
        with self.assertRaisesRegex(ValueError, 'reader-row-bound'):
            oracle.read_xlsx(extend_workbook(base, extra_sheets=[sparse_sheet(20031)]), 1)

    def test_outer_declared_dimension_is_not_authority(self):
        # Only actual raw rows/cells determine bounding area, not declared dimension.
        data = xlsx_bytes(source_rows(0), {'extra': '<dimension ref="A1:XFD1048576"/>'})
        self.assertEqual(oracle.read_xlsx(data, 0)[0], 'Data')


def install_negative_tests():
    # Each generated method is a separately counted concrete rejection control.
    controls = {
        'negative_zero': ({'amount': '-0.00'}, 'zero-amount'),
        'positive_zero': ({'amount': '+0'}, 'zero-amount'),
        'fraction_excess': ({'amount': '1.001'}, 'amount-precision'),
        'scientific': ({'amount': '1e2'}, 'invalid-amount'),
        'thousands': ({'amount': '1,000'}, 'invalid-amount'),
        'parentheses': ({'amount': '(100)'}, 'invalid-amount'),
        'missing_amount': ({'amount': ' '}, 'invalid-amount'),
        'invoice_negative': ({'amount': '-1'}, 'amount-sign'),
        'receipt_positive': ({'type': 'receipt'}, 'amount-sign'),
        'credit_positive': ({'type': 'credit-note'}, 'amount-sign'),
        'bad_type': ({'type': 'fee'}, 'invalid-document-type'),
        'missing_parent': ({'parent': ''}, 'missing-identity'),
        'foreign_parent': ({'parent': 'other'}, 'parent-scope-mismatch'),
        'missing_own': ({'own': '', 'related': '001'}, 'missing-identity'),
        'identity_cf': ({'own': 'A\u200f'}, 'invalid-identity'),
        'identity_prefix': ({'posting': '=A1'}, 'invalid-identity'),
        'excel_error_identity': ({'own': '#N/A'}, 'invalid-identity'),
        'bad_calendar': ({'date': '2026-02-30'}, 'invalid-date'),
        'serial_date': ({'date': '46000'}, 'invalid-date'),
        'outside_date': ({'date': '2025-12-31'}, 'date-outside-period'),
        'cell_bound': ({'open': 'x' * 4097}, 'cell-length')}
    for label, (record, code) in controls.items():
        def test(self, record=record, code=code):
            self.assertReject(self.pair(left=source_rows(0, [record])), code)
        setattr(OracleTests, 'test_reject_' + label, test)
    structures = {
        'role': (lambda r: r[2].__setitem__(1, 'buyer'), 'scope-header-mismatch'),
        'perspective': (lambda r: r[3].__setitem__(1, 'buyer-payable'), 'scope-header-mismatch'),
        'basis': (lambda r: r[4].__setitem__(1, 'open-balance'), 'scope-header-mismatch'),
        'scope': (lambda r: r[5].__setitem__(1, 'other'), 'scope-header-mismatch'),
        'duplicate_key': (lambda r: r.insert(4, list(r[3])), 'duplicate-scope-key'),
        'missing_key': (lambda r: r.pop(5), 'missing-scope-key'),
        'unknown_key': (lambda r: r.insert(3, ['Something', 'raw']), 'unknown-scope-key'),
        'generic_own': (lambda r: r[14].__setitem__(3, 'Document number'), 'unknown-detail-column'),
        'duplicate_column': (lambda r: r[14].append('Open balance'), 'duplicate-detail-column'),
        'missing_end': (lambda r: r.pop(), 'missing-end-details'),
        'past_end': (lambda r: r.append(list(r[15])), 'data-after-end'),
        'second_scope': (lambda r: r.insert(16, ['AR_SCOPE', '1']), 'repeated-or-late-header')}
    for label, (change, code) in structures.items():
        def test(self, change=change, code=code):
            left = source_rows(0)
            change(left)
            self.assertReject(self.pair(left=left), code)
        setattr(OracleTests, 'test_structure_' + label, test)
    native = {
        'error': ({'cell': 'H16', 'xml': '<c r="H16" t="e"><v>#VALUE!</v></c>'}, 'error-cell'),
        'hidden_row': ({'hiddenRow': 16}, 'hidden-row'),
        'hidden_column': ({'extra': '<cols><col min="8" max="8" hidden="1"/></cols>'}, 'hidden-column'),
        'hidden_sheet': ({'hiddenSheet': True}, 'hidden-sheet'),
        'merge': ({'extra': '<mergeCells count="1"><mergeCell ref="A16:B16"/></mergeCells>'}, 'merged-cells'),
        'numeric_exponent': ({'cell': 'F16', 'xml': '<c r="F16"><v>1e2</v></c>'}, 'unsupported-numeric-lexeme'),
        'bad_style': ({'cell': 'F16', 'xml': '<c r="F16" s="99"><v>100</v></c>'}, 'invalid-cell-style')}
    for label, (change, code) in native.items():
        def test(self, change=change, code=code):
            self.assertReject(self.pair(fmt='xlsx', alteration=change), code)
        setattr(OracleTests, 'test_native_reject_' + label, test)
    for label, value in [('false_text', 'false'), ('true_text', 'true'), ('one', 1),
                         ('object', {'value': False}), ('list', [True]), ('null', None), ('float', 1.0)]:
        def test_scope(self, value=value):
            self.assertReject(self.pair(options={'scope': {**SCOPE, 'confirmed': value}}), 'scope-unconfirmed')
        def test_reading(self, value=value):
            self.assertReject(self.pair(options={'readingConfirmed': [value, True]}), 'reading-unconfirmed')
        setattr(OracleTests, 'test_scope_confirmation_exact_boolean_' + label, test_scope)
        setattr(OracleTests, 'test_reading_confirmation_exact_boolean_' + label, test_reading)
    for field, value in [('entity', 42), ('ledger', True), ('customer', []), ('account', None),
                         ('currency', {}), ('start', 1.5), ('end', {'date': '2026-12-31'})]:
        def test(self, field=field, value=value):
            result = self.pair(options={'scope': {**SCOPE, field: value}})
            self.assertReject(result, 'invalid-scope-shape')
            self.assertEqual(result['validRowCounts'], [0, 0])
            self.assertEqual(result['totalsMinor'], [None, None])
        setattr(OracleTests, 'test_scope_field_requires_string_' + field, test)
    for label, value in [('null', None), ('list', []), ('text', 'scope'), ('integer', 42), ('empty_object', {})]:
        def test(self, value=value):
            self.assertReject(self.pair(options={'scope': value}), 'invalid-scope-shape')
        setattr(OracleTests, 'test_scope_shape_bounded_error_' + label, test)


install_negative_tests()

if __name__ == '__main__':
    unittest.main(verbosity=2)
