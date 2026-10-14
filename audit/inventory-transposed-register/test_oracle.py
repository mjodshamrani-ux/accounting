"""Independent private instrument controls, executed before any candidate."""
import copy
import tempfile
import unittest
from pathlib import Path
from generate import produce
from oracle import check_case, verify_truth, verify_citations
from check_export import check
from export_control import reference_tables,event_reference_tables,write_workbook


class MatrixInstrument(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.root=Path(self.temp.name)/'sources'; produce(self.root)
    def tearDown(self): self.temp.cleanup()
    def observe(self,identity='INV1C-P01'): return check_case(self.root/'cases'/identity)
    def test_all_fourteen_serialized_sources_have_hand_fixed_outcomes(self):
        for folder in sorted((self.root/'cases').iterdir()): verify_truth(check_case(folder))
    def test_money_swap_keeps_global_and_account_totals_but_changes_dimension_truth(self):
        bad=self.observe('INV1C-N01')
        self.assertEqual(bad['financial'],'difference')
        self.assertEqual(bad['totals'],{'registerMinor':667134,'glMinor':667134})
        self.assertEqual([c['differenceMinor'] for c in bad['comparisons']],[86655,-86655,0,0])
        self.assertEqual(sum(c['registerMinor'] for c in bad['comparisons'][:2]),333567)
    def test_dimension_swap_cannot_use_same_global_money_to_rebind_original_references(self):
        bad=self.observe('INV1C-N02')
        self.assertEqual(bad['financial'],'missing')
        self.assertEqual(bad['totals'],{'registerMinor':333567,'glMinor':667134})
        self.assertEqual(sum(r['postedValueMinor'] for r in bad['sources'][0]['records']),667134)
        self.assertEqual(bad['missing'].count('POLICY_BINDING'),2)
    def test_three_number_lookalike_item_ids_and_both_quantity_units_remain_literal(self):
        for identity in ['INV1C-P01','INV1C-P02','INV1C-P04','INV1C-P06']:
            observed=self.observe(identity); verify_truth(observed)
            self.assertEqual({r['raw']['Item ID'] for r in observed['sources'][0]['records']},{'0014','014','14'})
            self.assertEqual({r['quantityUnits'] for r in observed['sources'][0]['records']},{125,250,3,0})
        numeric=self.observe('INV1C-N08'); self.assertEqual(numeric['financial'],'source-error')
        self.assertTrue(any(issue['code']=='NUMERIC_IDENTITY' for issue in numeric['issues']))
    def test_output_quantity_swap_fails_even_when_all_money_remains_correct(self):
        observation=self.observe(); records=observation['sources'][0]['records']
        records[0]['quantityUnits'],records[1]['quantityUnits']=records[1]['quantityUnits'],records[0]['quantityUnits']
        self.assertEqual(observation['totals'],{'registerMinor':667134,'glMinor':667134})
        with self.assertRaisesRegex(AssertionError,'ITEM_QUANTITY_VALUE_TRUTH'): verify_truth(observation)
    def test_correct_item_text_from_neighbouring_column_is_not_owned_evidence(self):
        observation=self.observe(); a,b=observation['sources'][0]['records'][:2]
        self.assertEqual(a['raw']['Item ID'],b['raw']['Item ID'])
        a['citations']['Item ID']=copy.deepcopy(b['citations']['Item ID'])
        with self.assertRaisesRegex(AssertionError,'CITATION_COLUMN_BAND'): verify_citations(observation)
    def test_repeated_axis_name_in_later_band_is_not_a_substitute_for_own_header(self):
        observation=self.observe('INV1C-P03'); a,_,b,_=observation['sources'][0]['records']
        self.assertEqual(a['axisKey'],b['axisKey'])
        a['axisCitation']=copy.deepcopy(b['axisCitation'])
        with self.assertRaisesRegex(AssertionError,'AXIS_OWNERSHIP'): verify_citations(observation)
    def test_missing_field_role_scope_and_axis_proof_cannot_pass(self):
        baseline=self.observe()
        for target,key,reason in [('citations','Quantity','CITATION_FIELD_SET'),('roleCitations','Quantity','CITATION_ROLE_SET'),('scopeCitations','Currency','CITATION_SCOPE_SET')]:
            with self.subTest(target=target):
                changed=copy.deepcopy(baseline); del changed['sources'][0]['records'][0][target][key]
                with self.assertRaisesRegex(AssertionError,reason): verify_citations(changed)
        changed=copy.deepcopy(baseline); del changed['sources'][0]['records'][0]['axisCitation']
        with self.assertRaisesRegex(AssertionError,'MATRIX_OWNERSHIP_SET'): verify_citations(changed)
    def test_wrong_role_label_and_foreign_boundary_fail(self):
        changed=self.observe(); record=changed['sources'][0]['records'][0]
        record['roleCitations']['Quantity']=copy.deepcopy(record['roleCitations']['Quantity precision'])
        with self.assertRaisesRegex(AssertionError,'CITATION_ROLE_LABEL'): verify_citations(changed)
        changed=self.observe('INV1C-P03'); a,_,b,_=changed['sources'][0]['records']
        a['boundary']=copy.deepcopy(b['boundary'])
        with self.assertRaisesRegex(AssertionError,'BOUNDARY_OWNERSHIP'): verify_citations(changed)
    def test_missing_explicit_zero_is_source_error_and_unknown_zero_is_not_a_blank(self):
        missing=self.observe('INV1C-N03'); self.assertEqual(missing['financial'],'source-error'); self.assertIsNone(missing['totals'])
        extra=self.observe('INV1C-N06'); self.assertEqual(extra['financial'],'source-error')
        self.assertTrue(any(i['code']=='UNNAMED_POPULATED_COLUMN' for i in extra['issues']))
        self.assertTrue(any(c['raw']=='0' for row in extra['sources'][0]['inventory'] for c in row['cells'] if c['column']==3))
    def test_global_item_duplicate_is_blocked_across_individually_valid_bands(self):
        duplicate=self.observe('INV1C-N05'); self.assertEqual(duplicate['financial'],'source-error')
        self.assertTrue(any(i['code']=='DUPLICATE_IDENTITY' for i in duplicate['issues']))
    def test_independent_control_exports_match_quantity_money_axes_roles_and_original_bytes(self):
        for identity in ['INV1C-P01','INV1C-P02','INV1C-P03','INV1C-P04','INV1C-P05','INV1C-P06','INV1C-N01','INV1C-N02']:
            folder=self.root/'cases'/identity; book=Path(self.temp.name)/'control.xlsx'; write_workbook(book,reference_tables(folder))
            self.assertTrue(check(book,folder)['pass'],identity)
    def test_export_faults_cannot_keep_correct_totals_and_wrong_quantity_dimension_or_citation(self):
        folder=self.root/'cases'/'INV1C-P01'; baseline=reference_tables(folder)
        faults=[('Quantity','Register',1,6,250,'RECORD_VALUE'),('Item dimension','Register',1,5,'plant=P2;batch=K2','RECORD_VALUE'),('Source column','Register',1,3,3,'RECORD_ANCHOR'),('Axis ownership','Matrix citations',20,10,99,'MATRIX_CITATIONS'),('Cited value column','Matrix citations',22,6,99,'MATRIX_CITATIONS'),('Source bytes','Sources',1,7,'AAAA','ORIGINAL_BYTES')]
        for name,table,row,col,value,reason in faults:
            with self.subTest(name=name):
                changed=copy.deepcopy(baseline); changed[table][row][col]=value; book=Path(self.temp.name)/'fault.xlsx'; write_workbook(book,changed)
                with self.assertRaisesRegex(AssertionError,reason): check(book,folder)
    def test_export_cannot_delete_a_role_citation_or_a_zero_original_member(self):
        folder=self.root/'cases'/'INV1C-P01'
        tables=reference_tables(folder); tables['Matrix citations'].pop(next(i for i,row in enumerate(tables['Matrix citations']) if len(row)>9 and row[9]=='role'))
        book=Path(self.temp.name)/'fault.xlsx'; write_workbook(book,tables)
        with self.assertRaisesRegex(AssertionError,'MATRIX_CITATIONS'): check(book,folder)
        tables=reference_tables(folder); tables['GL balances'].pop(); write_workbook(book,tables)
        with self.assertRaisesRegex(AssertionError,'RECORD_COUNT'): check(book,folder)

    def test_accepted_and_undone_controls_preserve_full_original_physical_member_order(self):
        for identity in ['INV1C-P01','INV1C-P04']:
            for undone in [False,True]:
                folder=self.root/'cases'/identity; tables=event_reference_tables(folder,undone=undone); book=Path(self.temp.name)/'event.xlsx'; write_workbook(book,tables)
                self.assertTrue(check(book,folder,accepted=not undone,undone=undone)['pass'])
    def test_money_ready_cannot_replace_whole_source_attestation_or_acceptance_context(self):
        folder=self.root/'cases'/'INV1C-P01'; baseline=event_reference_tables(folder)
        faults=[('Summary',next(i for i,row in enumerate(baseline['Summary']) if row[0]=='Completeness confirmed'),1,'false','SUMMARY:Completeness confirmed'),('Events',1,2,'[]','ACCEPT_EVENT'),('Events',1,6,16,'ACCEPT_EVENT'),('Event members',1,1,baseline['Register'][1][0],'ACCEPT_MEMBERSHIP')]
        for table,row,col,value,reason in faults:
            with self.subTest(reason=reason):
                changed=copy.deepcopy(baseline);changed[table][row][col]=value;book=Path(self.temp.name)/'event-fault.xlsx';write_workbook(book,changed)
                with self.assertRaisesRegex(AssertionError,reason):check(book,folder,accepted=True)
        changed=copy.deepcopy(baseline);changed['Event members'].reverse();book=Path(self.temp.name)/'event-fault.xlsx';write_workbook(book,changed)
        with self.assertRaisesRegex(AssertionError,'Event members:HEADERS'):check(book,folder,accepted=True)
    def test_ui_session_controls_only_allow_random_uuid_and_iso_time_variation(self):
        import json,base64
        folder=self.root/'cases'/'INV1C-P04'; identity='11111111-2222-4333-8444-555555555555'; at='2026-11-02T12:13:14.015Z'
        tables=event_reference_tables(folder,event_id=identity,event_at=at); context=json.loads(dict(tables['Summary'][1:])['Context']);observed=self.observe('INV1C-P04')
        members=[row[1] for row in tables['Event members'][1:]]
        session={'format':'tarasuf-inventory-register-session','version':context[0],'files':[{'name':s['name'],'sha256':s['sha256'],'data':base64.b64encode((folder/s['name']).read_bytes()).decode()} for s in observed['sources']],'readings':context[2],'scope':context[3],'completeness':context[4],'events':[{'id':identity,'type':'accept','memberIds':members,'context':json.dumps(context,separators=(',',':')),'at':at,'reference':'INV1C synthetic approval','note':'Synthetic matrix review only'}]}
        book=Path(self.temp.name)/'ui.xlsx';saved=Path(self.temp.name)/'ui.json';write_workbook(book,tables);saved.write_text(json.dumps(session));self.assertTrue(check(book,folder,accepted=True,session_path=saved)['pass'])
        for target,key,value,reason in [('event','memberIds',members[:-1],'UI_SESSION_EVENT_MEMBERS'),('event','id','INVALID','UI_SESSION_EVENT_ID'),('event','at','2026-11-31T12:13:14.015Z','UI_SESSION_EVENT_AT'),('file','data','AAAA','UI_SESSION_ORIGINAL'),('event','reference','Other','UI_SESSION_EVENT_CONTEXT')]:
            with self.subTest(key=key):
                changed=copy.deepcopy(session);changed['events' if target=='event' else 'files'][0][key]=value;saved.write_text(json.dumps(changed))
                with self.assertRaisesRegex(AssertionError,reason):check(book,folder,accepted=True,session_path=saved)


if __name__=='__main__': unittest.main()
