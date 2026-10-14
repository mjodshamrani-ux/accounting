"""Check the independent instrument before evaluating a product candidate."""
import base64
import copy
import csv
import hashlib
import json
import shutil
import tempfile
import unittest
from pathlib import Path
from xml.sax.saxutils import escape
from zipfile import ZipFile

from oracle import Document, FIELDS, SCOPE, TRUTH, check_case, verify_citations, verify_truth, money
from check_export import check, VERSION, SECTION_FAMILY, REGISTER_BASIS, ROLES, SCOPE_KEYS
from generate import produce


def id_at(source, row):
    return json.dumps([VERSION, source['role'], source['sha256'], 0, row], separators=(',', ':'))


def reference_tables(folder):
    """Instrument control, not a product fixture or financial oracle.

Build a visibly separate synthetic workbook from independently checked source
facts; subsequent faults target hand-selected financial/evidence invariants.
"""
    observation = check_case(folder)
    verify_truth(observation)
    sources = observation['sources']
    scope = dict(zip(SCOPE_KEYS, [sources[0]['records'][0]['scope'][key] for key in SCOPE]))
    readings = [{'sheet':0, 'role':role, 'family':SECTION_FAMILY if index == 0 else VERSION, 'confirmed':True} for index, role in enumerate(ROLES)]
    context = [VERSION, [s['sha256'] for s in sources], readings, dict(scope, confirmed=True), {'confirmed':False, 'reference':'', 'note':''}]
    tables = {'Summary': [['Field','Value']] + [[key, value] for key, value in {
        'Version':VERSION, 'Financial':'ready', 'Review':'needs-review', 'Status':'needs-review',
        'Context':json.dumps(context, separators=(',', ':')), 'Decimals':2,
        **scope, 'Scope confirmed':'true', 'Completeness confirmed':'false',
        'Completeness reference':'', 'Completeness note':'', 'Register minor':150000, 'GL minor':150000,
        'Register minor basis':REGISTER_BASIS,
    }.items()]}
    units = {'Quantity':'Quantity scaled integer', 'Posted value':'Posted value minor', 'Debit':'Debit minor', 'Credit':'Credit minor'}
    cells, inventory, embedded = [], [], []
    for source in sources:
        role = source['role']
        rows = []
        for record in source['records']:
            values = []
            for field in FIELDS[role]:
                raw = record['raw'][field]
                values.append(record['quantityUnits'] if field == 'Quantity' else record['postedValueMinor'] if field == 'Posted value' else money(raw) if field in ['Debit','Credit'] else int(raw) if field == 'Quantity precision' else raw)
            rows.append([id_at(source, record['sourceRow']), role, record['sourceRow']] + values)
        tables[['Register','Mapping','Policy evidence','GL balances'][role]] = [['Record ID','Source','Source row'] + [units.get(field, field) for field in FIELDS[role]]] + rows
        width = max(len(r['cells']) for r in source['inventory']) if source['name'].endswith('.xlsx') else None
        headers = [c['raw'] for c in source['inventory'][0]['cells']]
        for row in source['inventory']:
            inventory.append([role, row['row'], row['fate']])
            raw = [c['raw'] for c in row['cells']]
            values = raw + [''] * (width - len(raw)) if width is not None else raw
            field = raw[1] if raw and raw[0] == 'Scope' else raw[0] if raw else ''
            cells += [[role, row['row'], c + 1, field if role == 0 else headers[c], value] for c, value in enumerate(values)]
        embedded.append([role,ROLES[role],source['name'],source['sheetName'],source['sha256'],1,1,base64.b64encode((folder/source['name']).read_bytes()).decode()])
    tables.update({
        'Account comparisons': [['GL account','GL dimensions','Register minor','Debit minor','Credit minor','GL minor','Difference minor'], ['INV-1','branch=01',100000,100000,0,100000,0], ['INV-1','branch=02',50000,50000,0,50000,0]],
        'Missing': [['Missing']], 'Issues': [['Source','Source row','Code']],
        'Cell evidence': [['Source','Source row','Column','Field','Text']] + cells,
        'Inventory': [['Source','Source row','Kind']] + inventory,
        'Reading': [['Source','Role','Family','Sheet','Confirmed']] + [[n,role,SECTION_FAMILY if n == 0 else VERSION,0,'true'] for n,role in enumerate(ROLES)],
        'Events': [['Event ID','Type','Context','At','Reference','Note','Member count']],
        'Event members': [['Event ID','Member ID']],
        'Sources': [['Source','Role','Name','Sheet','SHA256','Part','Parts','Base64']] + embedded,
    })
    def citation(record_id, cite, field, kind, end=''):
        return [record_id,0,sources[0]['sha256'],0,sources[0]['sheetName'],cite['row'],cite['column'],field,cite['raw'],kind,end]
    citations = [citation('', sources[0]['inventory'][0]['cells'][1], 'Format', 'format')]
    first = sources[0]['records'][0]
    citations += [citation('',first['scopeCitations'][label],key,'scope') for key,label in zip(SCOPE_KEYS,SCOPE)]
    for record in sources[0]['records']:
        identity = id_at(sources[0], record['sourceRow'])
        citations += [citation(identity,record['citations'][field],field,'value',record['endRow']) for field in FIELDS[0]]
        citations += [citation(identity,record['boundaries'][field],field,'boundary',record['endRow']) for field in ['Section','End section']]
        for row in sources[0]['inventory'][record['sourceRow']:record['endRow'] - 1]:
            if row['cells'] and row['cells'][0]['raw'] == 'Section subtotal':
                citations.append(citation(identity,row['cells'][1],'Section subtotal','control',record['endRow']))
    for row in sources[0]['inventory']:
        if row['cells'] and row['cells'][0]['raw'] == 'Report total':
            citations.append(citation('',row['cells'][1],'Report total','control',0))
    tables['Section citations'] = [['Record ID','Source','SHA256','Sheet index','Sheet','Source row','Column','Field','Text','Kind','Section end row']] + citations
    return tables


def write_workbook(path, tables):
    def col(number):
        text = ''
        while number:
            number, rem = divmod(number - 1, 26); text = chr(65 + rem) + text
        return text
    ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
    rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
    with ZipFile(path, 'w') as archive:
        names = list(tables)
        archive.writestr('xl/workbook.xml', f'<workbook xmlns="{ns}" xmlns:r="{rel}"><sheets>' + ''.join(f'<sheet name="{escape(name)}" sheetId="{n}" r:id="s{n}"/>' for n, name in enumerate(names, 1)) + '</sheets></workbook>')
        archive.writestr('xl/_rels/workbook.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + ''.join(f'<Relationship Id="s{n}" Type="{rel}/worksheet" Target="worksheets/sheet{n}.xml"/>' for n in range(1,len(names)+1)) + '</Relationships>')
        for number, rows in enumerate(tables.values(), 1):
            body = ''
            for r, row in enumerate(rows, 1):
                cells = ''
                for c, value in enumerate(row, 1):
                    address = f'{col(c)}{r}'
                    cells += f'<c r="{address}"><v>{value}</v></c>' if isinstance(value, (int, float)) else f'<c r="{address}" t="inlineStr"><is><t>{escape(value)}</t></is></c>'
                body += f'<row r="{r}">{cells}</row>'
            archive.writestr(f'xl/worksheets/sheet{number}.xml', f'<worksheet xmlns="{ns}"><sheetData>{body}</sheetData></worksheet>')


class IndependentInstrument(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / 'sources'
        produce(self.root)
    def tearDown(self): self.temp.cleanup()
    def folder(self, identity='INV1B-P04'): return self.root / 'cases' / identity

    def test_all_twelve_serialized_sources_have_fixed_expected_states(self):
        for folder in sorted((self.root / 'cases').iterdir()): verify_truth(check_case(folder))

    def test_numeric_xlsx_is_not_a_second_financial_story(self):
        observation = check_case(self.folder())
        self.assertEqual([r['raw']['Posted value'] for r in observation['sources'][0]['records']], ['600','400','500','0'])
        self.assertEqual(observation['totals'], {'registerMinor':150000,'glMinor':150000})

    def test_explicit_zero_cannot_borrow_precision_zero_citation(self):
        observation = check_case(self.folder('INV1B-P03'))
        zero = observation['sources'][0]['records'][3]
        zero['citations']['Quantity'] = copy.deepcopy(zero['citations']['Quantity precision'])
        with self.assertRaisesRegex(AssertionError, 'CITATION_ROLE_LABEL'): verify_citations(observation)

    def test_same_item_literal_cannot_borrow_other_section_identity(self):
        observation = check_case(self.folder())
        a, b = observation['sources'][0]['records'][:2]
        a['citations']['Item ID'] = copy.deepcopy(b['citations']['Item ID'])
        with self.assertRaisesRegex(AssertionError, 'CITATION_SECTION_MEMBERSHIP'): verify_citations(observation)

    def test_missing_field_scope_or_boundary_citation_cannot_pass(self):
        observation = check_case(self.folder())
        for target, key, reason in [('citations','Posted value','CITATION_FIELD_SET'), ('scopeCitations','Currency','CITATION_SCOPE_SET'), ('boundaries','End section','CITATION_BOUNDARY_SET')]:
            with self.subTest(target=target):
                changed = copy.deepcopy(observation)
                del changed['sources'][0]['records'][0][target][key]
                with self.assertRaisesRegex(AssertionError, reason): verify_truth(changed)

    def test_wrong_end_boundary_cannot_pass_even_with_same_item_text(self):
        observation = check_case(self.folder())
        first, second = observation['sources'][0]['records'][:2]
        first['boundaries']['End section'] = copy.deepcopy(second['boundaries']['End section'])
        with self.assertRaisesRegex(AssertionError, 'CITATION_BOUNDARY_OWNERSHIP'): verify_truth(observation)

    def test_source_white_theme_cannot_be_certified_by_the_instrument(self):
        path = self.folder('INV1B-P03') / 'register.xlsx'
        with ZipFile(path) as archive: parts = {name: archive.read(name) for name in archive.namelist()}
        parts['xl/styles.xml'] = parts['xl/styles.xml'].replace(b'<color theme="1"/>', b'<color theme="0"/>')
        with ZipFile(path, 'w') as archive:
            for name, data in parts.items(): archive.writestr(name, data)
        with self.assertRaisesRegex(ValueError, 'FIXTURE_FONT_COLOR'): check_case(path.parent)

    def test_source_theme_palette_cannot_turn_normal_text_white(self):
        path = self.folder('INV1B-P03') / 'register.xlsx'
        with ZipFile(path) as archive: parts = {name: archive.read(name) for name in archive.namelist()}
        parts['xl/theme/theme1.xml'] = parts['xl/theme/theme1.xml'].replace(b'lastClr="000000"', b'lastClr="FFFFFF"')
        with ZipFile(path, 'w') as archive:
            for name, data in parts.items(): archive.writestr(name, data)
        with self.assertRaisesRegex(ValueError, 'FIXTURE_THEME_TEXT'): check_case(path.parent)

    def test_equal_global_total_does_not_make_dimensions_correct(self):
        observation = check_case(self.folder('INV1B-N05'))
        self.assertEqual(observation['financial'], 'missing')
        self.assertEqual(sum(r['postedValueMinor'] for r in observation['sources'][0]['records']), 150000)
        self.assertEqual(observation['missing'].count('POLICY_BINDING'), 2)

    def test_item_money_swap_with_same_global_and_branch_totals_is_detected(self):
        folder = self.folder('INV1B-P02')
        path = folder / 'register.csv'
        rows = list(csv.reader(path.read_text().splitlines()))
        posted = [row for row in rows if row and row[0] == 'Posted value']
        posted[0][1], posted[1][1] = posted[1][1], posted[0][1]
        with path.open('w', newline='') as stream: csv.writer(stream, lineterminator='\n').writerows(rows)
        observation = check_case(folder)
        self.assertEqual(observation['financial'], 'ready')
        self.assertEqual(observation['totals'], {'registerMinor':150000,'glMinor':150000})
        with self.assertRaisesRegex(AssertionError, 'ITEM_TRUTH'): verify_truth(observation)

    def test_policy_boundary_is_inclusive_and_expired_policy_is_error(self):
        self.assertEqual(check_case(self.folder('INV1B-P05'))['financial'], 'ready')
        expired = check_case(self.folder('INV1B-N03'))
        self.assertEqual(expired['financial'], 'source-error')
        self.assertIsNone(expired['totals'])
        self.assertTrue(any(i['code'] == 'VALIDITY' for i in expired['issues']))

    def test_instrument_positive_export_checks_actual_original_bytes(self):
        book = Path(self.temp.name) / 'instrument.xlsx'
        write_workbook(book, reference_tables(self.folder()))
        report = check(book, self.folder())
        self.assertTrue(report['pass'])
        self.assertEqual(report['fieldCitations'], 54)
        self.assertEqual(report['logicalMembers'], 14)

    def test_instrument_detects_financial_dimension_scope_and_citation_faults(self):
        baseline = reference_tables(self.folder())
        faults = [
            ('Posted amount', 'Register', 1, 8, 59999, 'RECORD_VALUE'),
            ('Fractional amount', 'Register', 1, 8, 60000.001, 'NONINTEGER_NUMBER'),
            ('Item dimensions', 'Register', 1, 4, 'warehouse=W2;batch=B01', 'RECORD_VALUE'),
            ('Mapped branch', 'Mapping', 1, 7, 'branch=02', 'RECORD_VALUE'),
            ('Policy reference', 'Policy evidence', 1, 8, 'V-0007-W2-B01', 'RECORD_VALUE'),
            ('Citation row', 'Section citations', 15, 5, 999, 'SECTION_CITATIONS'),
            ('Citation raw', 'Section citations', 15, 8, 'different', 'SECTION_CITATIONS'),
            ('Citation hash', 'Section citations', 15, 2, '0' * 64, 'SECTION_CITATIONS'),
            ('Embedded source', 'Sources', 1, 7, 'AAAA', 'ORIGINAL_BYTES'),
        ]
        for name, table, row, col, value, reason in faults:
            with self.subTest(name=name):
                changed = copy.deepcopy(baseline); changed[table][row][col] = value
                book = Path(self.temp.name) / 'fault.xlsx'; write_workbook(book, changed)
                with self.assertRaisesRegex(AssertionError, reason): check(book, self.folder())
        altered_scope = copy.deepcopy(baseline)
        next(row for row in altered_scope['Summary'][1:] if row[0] == 'entity')[1] = 'Foreign entity'
        book = Path(self.temp.name) / 'scope-fault.xlsx'; write_workbook(book, altered_scope)
        with self.assertRaisesRegex(AssertionError, 'SUMMARY_SCOPE:entity'): check(book, self.folder())

    def test_instrument_rejects_truncated_physical_row_evidence(self):
        tables = reference_tables(self.folder()); tables['Inventory'].pop()
        book = Path(self.temp.name) / 'fault.xlsx'; write_workbook(book, tables)
        with self.assertRaisesRegex(AssertionError, 'PHYSICAL_INVENTORY'): check(book, self.folder())

    def test_export_cannot_omit_or_mislabel_supported_register_basis(self):
        for omitted in [True, False]:
            tables = reference_tables(self.folder())
            index = next(i for i, row in enumerate(tables['Summary']) if row[0] == 'Register minor basis')
            if omitted: tables['Summary'].pop(index)
            else: tables['Summary'][index][1] = 'Total original register balance'
            path = Path(self.temp.name)/'basis-fault.xlsx'; write_workbook(path,tables)
            with self.assertRaisesRegex(AssertionError,'REGISTER_MINOR_BASIS'): check(path,self.folder())

    def test_instrument_rejects_masked_number_format_and_hidden_output_column(self):
        baseline = reference_tables(self.folder())
        path = Path(self.temp.name) / 'display-control.xlsx'
        write_workbook(path, baseline)
        self.assertTrue(check(path, self.folder())['pass'])
        with ZipFile(path) as archive: original = {name: archive.read(name) for name in archive.namelist()}
        ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
        for label in ['hidden-column','masking-format']:
            parts = copy.deepcopy(original)
            if label == 'hidden-column':
                parts['xl/worksheets/sheet2.xml'] = parts['xl/worksheets/sheet2.xml'].replace(b'<sheetData>', b'<cols><col min="9" max="9" hidden="1" width="10"/></cols><sheetData>')
                reason = 'OUTPUT_DISPLAY_COLUMN'
            else:
                parts['xl/styles.xml'] = f'<styleSheet xmlns="{ns}"><numFmts count="1"><numFmt numFmtId="164" formatCode=";;;"/></numFmts><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>'.encode()
                parts['xl/worksheets/sheet2.xml'] = parts['xl/worksheets/sheet2.xml'].replace(b'<c r="I2">', b'<c r="I2" s="1">')
                reason = 'OUTPUT_DISPLAY_FORMAT'
            changed = Path(self.temp.name) / (label + '.xlsx')
            with ZipFile(changed, 'w') as archive:
                for name, data in parts.items(): archive.writestr(name, data)
            with self.assertRaisesRegex(AssertionError, reason): check(changed, self.folder())

    def test_ui_session_allows_only_random_event_id_time_with_strict_original_context(self):
        folder = self.folder()
        observation = check_case(folder); sources = observation['sources']
        tables = reference_tables(folder)
        summary = {row[0]:row for row in tables['Summary'][1:]}
        context = json.loads(summary['Context'][1])
        context[4] = {'confirmed':True,'reference':'INV1B synthetic whole scope','note':'Synthetic test attestation only'}
        for key, value in {'Context':json.dumps(context,separators=(',',':')), 'Review':'accepted','Status':'consistent-with-evidence','Completeness confirmed':'true','Completeness reference':'INV1B synthetic whole scope','Completeness note':'Synthetic test attestation only'}.items(): summary[key][1] = value
        members = [id_at(source, row['row']) for source in sources for row in source['inventory'][1:] if any(c['raw'] for c in row['cells'])]
        event = {'id':'12345678-1234-4abc-8123-123456789abc','type':'accept','memberIds':members,'context':summary['Context'][1],'at':'2026-10-14T10:05:06.789Z','reference':'INV1B synthetic approval','note':'Synthetic reviewed proof only'}
        tables['Events'].append([event['id'],'accept',event['context'],event['at'],event['reference'],event['note'],len(members)])
        tables['Event members'] += [[event['id'], member] for member in members]
        session = {'format':'tarasuf-inventory-register-session','version':VERSION,'files':[{'name':source['name'],'sha256':source['sha256'],'data':base64.b64encode((folder/source['name']).read_bytes()).decode()} for source in sources],'readings':context[2],'scope':context[3],'completeness':context[4],'events':[event]}
        workbook = Path(self.temp.name)/'ui-instrument.xlsx'; write_workbook(workbook,tables)
        session_path = Path(self.temp.name)/'ui-session.json'; session_path.write_text(json.dumps(session))
        self.assertTrue(check(workbook, folder, accepted=True, session_path=session_path)['pass'])
        mutants = []
        changed = copy.deepcopy(session); changed['files'][0]['data']='AAAA'; mutants.append((changed,'UI_SESSION_ORIGINAL'))
        changed = copy.deepcopy(session); changed['events'][0]['memberIds'].pop(); mutants.append((changed,'UI_SESSION_EVENT_MEMBERS'))
        changed = copy.deepcopy(session); changed['readings'][0]['family']=VERSION; mutants.append((changed,'UI_SESSION_CONTEXT'))
        changed = copy.deepcopy(session); changed['events'][0]['reference']='Unreviewed'; mutants.append((changed,'UI_SESSION_EVENT_CONTEXT'))
        changed = copy.deepcopy(session); changed['events'][0]['at']='2026-02-30T10:05:06.789Z'; mutants.append((changed,'UI_SESSION_EVENT_AT'))
        for changed, reason in mutants:
            with self.subTest(reason=reason):
                session_path.write_text(json.dumps(changed))
                with self.assertRaisesRegex(AssertionError,reason): check(workbook,folder,accepted=True,session_path=session_path)


if __name__ == '__main__': unittest.main()
