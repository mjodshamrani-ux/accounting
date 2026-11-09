#!/usr/bin/env python3
"""Targeted corruption controls for the independent lifecycle evidence checker.

Run against an explicit completed attempt, or the proof folder whose
LAST-ATTEMPT.json names one (as check-evidence.py reads it). Every mutation
refreshes the local artifact digest so the semantic test cannot pass merely
through a hash mismatch.
"""
import copy
import importlib.util
import json
from pathlib import Path
import re
import shutil
import sys
import tempfile
import unittest
import zipfile
import xml.etree.ElementTree as ET

spec = importlib.util.spec_from_file_location('asset_evidence_checker', Path(__file__).with_name('check-evidence.py'))
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)
ATTEMPT = Path(sys.argv.pop(1)).resolve()
if not (ATTEMPT / 'REPORT.json').exists():
    POINTER = checker.read_json(ATTEMPT / 'LAST-ATTEMPT.json')
    checker.require(isinstance(POINTER.get('attempt'),str) and POINTER['attempt'].startswith('attempt-') and Path(POINTER['attempt']).name == POINTER['attempt'], 'Explicit attempt pointer')
    ATTEMPT = ATTEMPT / POINTER['attempt']
    checker.require(POINTER.get('passed') is True and checker.sha((ATTEMPT/'REPORT.json').read_bytes()) == POINTER.get('reportSha256'), 'Pointer binds exact successful current report')
REPORT = checker.read_json(ATTEMPT / 'REPORT.json')
ENGINE = checker.oracle()

class EvidenceControls(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='asset-long-checker-')
        self.addCleanup(self.temp.cleanup)

    def fixture(self, name='01-two-assets-separated'):
        entry = copy.deepcopy(next(e for e in REPORT['entries'] if e['folder'] == name))
        folder = Path(self.temp.name) / name
        shutil.copytree(ATTEMPT / name, folder)
        return folder, entry

    def refresh(self, folder, entry, filename):
        content = (folder / filename).read_bytes()
        entry['artifacts'][filename] = {'bytes':len(content),'sha256':checker.sha(content)}

    def mutate_json(self, folder, entry, filename, action):
        value = checker.read_json(folder / filename)
        action(value)
        (folder / filename).write_text(json.dumps(value,ensure_ascii=False)+'\n',encoding='utf-8')
        self.refresh(folder,entry,filename)

    def mutate_xlsx(self, folder, entry, sheet_name, address, value=None, formula=False):
        filename = 'direct.xlsx'
        with zipfile.ZipFile(folder / filename) as z:
            contents = {n:z.read(n) for n in z.namelist()}
        relationships = {e.attrib['Id']:e.attrib['Target'].lstrip('/') for e in ET.fromstring(contents['xl/_rels/workbook.xml.rels'])}
        sheet = next(s for s in ET.fromstring(contents['xl/workbook.xml']).find('s:sheets',checker.NS) if s.attrib['name'] == sheet_name)
        target = relationships[sheet.attrib['{'+checker.NS['r']+'}id']]
        target = target if target.startswith('xl/') else 'xl/'+target
        root = ET.fromstring(contents[target])
        cell = next(c for c in root.findall('s:sheetData/s:row/s:c',checker.NS) if c.attrib['r'] == address)
        for child in list(cell): cell.remove(child)
        cell.attrib['t'] = 'n'
        if formula: ET.SubElement(cell,'{'+checker.NS['s']+'}f').text = '1+1'
        ET.SubElement(cell,'{'+checker.NS['s']+'}v').text = str(value)
        contents[target] = ET.tostring(root,encoding='utf-8',xml_declaration=True)
        with zipfile.ZipFile(folder / filename,'w',zipfile.ZIP_DEFLATED) as z:
            for name, content in contents.items(): z.writestr(name,content)
        self.refresh(folder,entry,filename)

    def rewrite_book(self, folder, entry, edit, filename='direct.xlsx'):
        with zipfile.ZipFile(folder / filename) as z:
            contents = {n:z.read(n) for n in z.namelist()}
        contents['xl/workbook.xml'] = edit(contents['xl/workbook.xml'].decode()).encode()
        with zipfile.ZipFile(folder / filename,'w',zipfile.ZIP_DEFLATED) as z:
            for name, content in contents.items(): z.writestr(name,content)
        self.refresh(folder,entry,filename)

    def test_the_reconciliation_sheet_is_set_aside_in_either_language(self):
        # UX-6(c): the page's workpaper opens on the reconciliation sheet, in
        # English on the direct export and in Arabic on the restored one; the
        # seventeen evidence sheets after it are read as before.
        folder, entry = self.fixture()
        names = []
        for filename in ('direct.xlsx','restored.xlsx'):
            with zipfile.ZipFile(folder / filename) as z:
                names.append(ET.fromstring(z.read('xl/workbook.xml')).find('s:sheets',checker.NS)[0].attrib['name'])
            book = checker.workbook(folder / filename)
            self.assertEqual((len(book), list(book)[0]), (17, 'Summary'), filename)
        self.assertEqual(names, ['Reconciliation sheet', 'ورقة التسوية'])

    def test_a_sheet_out_of_place_or_hidden_is_refused(self):
        def second(text):
            first, summary = re.findall(r'<sheet [^>]*/>', text)[:2]
            return text.replace(first + summary, summary + first, 1)
        folder, entry = self.fixture()
        self.rewrite_book(folder,entry,second)
        with self.assertRaisesRegex(AssertionError,'RECONCILIATION_SHEET_ORDER'): checker.verify(folder,entry,ENGINE)
        folder, entry = self.fixture('10-all-zero-members-retained')
        self.rewrite_book(folder,entry,lambda text: text.replace('<sheet name="Reconciliation sheet"','<sheet state="hidden" name="Reconciliation sheet"',1))
        with self.assertRaisesRegex(AssertionError,'RECONCILIATION_SHEET_VISIBILITY'): checker.verify(folder,entry,ENGINE)

    def test_the_evidence_after_the_sheet_keeps_native_integers(self):
        folder, entry = self.fixture()
        self.mutate_xlsx(folder,entry,'GL balances','G2','1.5')
        with self.assertRaisesRegex(AssertionError,'nonintegral native number'): checker.verify(folder,entry,ENGINE)

    def test_real_evidence_passes(self):
        folder, entry = self.fixture()
        self.assertEqual(checker.verify(folder,entry,ENGINE)['comparisons'],3)

    def test_forged_signed_difference_native_cell(self):
        folder, entry = self.fixture()
        self.mutate_xlsx(folder,entry,'Component comparisons','F2',1)
        with self.assertRaisesRegex(AssertionError,'every separate signed native comparison'): checker.verify(folder,entry,ENGINE)

    def test_forged_gl_native_amount(self):
        folder, entry = self.fixture()
        self.mutate_xlsx(folder,entry,'GL balances','G2',1)
        with self.assertRaisesRegex(AssertionError,'every GL amount'): checker.verify(folder,entry,ENGINE)

    def test_formula_cannot_masquerade_as_native_amount(self):
        folder, entry = self.fixture()
        self.mutate_xlsx(folder,entry,'Component comparisons','F2',0,formula=True)
        with self.assertRaisesRegex(AssertionError,'formula'): checker.verify(folder,entry,ENGINE)

    def test_absent_amount_cannot_be_claimed_as_original_blank(self):
        folder, entry = self.fixture('42-malformed-last-row-width')
        def action(result):
            e = next(e for e in result['componentEvidence'] if not e['present'])
            e['present'], e['text'] = True, ''
        for filename in ('direct-result.json','restored-result.json'): self.mutate_json(folder,entry,filename,action)
        with self.assertRaisesRegex(AssertionError,'Amount evidence'): checker.verify(folder,entry,ENGINE)

    def test_original_blank_cannot_be_claimed_absent(self):
        folder, entry = self.fixture('20-blank-amount-not-zero')
        def action(result):
            e = next(e for e in result['componentEvidence'] if e['text'] == '')
            e['present'], e['text'] = False, None
        for filename in ('direct-result.json','restored-result.json'): self.mutate_json(folder,entry,filename,action)
        with self.assertRaisesRegex(AssertionError,'Amount evidence'): checker.verify(folder,entry,ENGINE)

    def test_session_original_bytes_cannot_change(self):
        folder, entry = self.fixture()
        self.mutate_json(folder,entry,'session.json',lambda session: session['files'][0].__setitem__('data','QQ=='))
        with self.assertRaisesRegex(AssertionError,'Session original bytes'): checker.verify(folder,entry,ENGINE)

    def test_recomputed_minor_cannot_be_replaced_in_both_results(self):
        folder, entry = self.fixture()
        def action(result): result['comparisons'][0]['register'] += 1
        for filename in ('direct-result.json','restored-result.json'): self.mutate_json(folder,entry,filename,action)
        with self.assertRaisesRegex(AssertionError,'Every independent signed difference'): checker.verify(folder,entry,ENGINE)

    def test_context_requires_original_families_hashes_and_scope(self):
        folder, entry = self.fixture()
        entry['context'] = 'FORGED'
        with self.assertRaisesRegex(AssertionError,'Independent original-context'): checker.verify(folder,entry,ENGINE)

if __name__ == '__main__': unittest.main()
