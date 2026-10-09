"""Independent financial/source/evidence ZIP tamper regressions; no product imports."""
import unittest,copy,tempfile,zipfile,json
from pathlib import Path
from check_export import verify,sheets,NS
import xml.etree.ElementTree as ET
ROOT=Path(__file__).parent;EXPORT=Path('work/bank/exports')
class BankOracle(unittest.TestCase):
    def altered(self,file,edit):
        temp=Path(tempfile.mkdtemp())/'tampered.xlsx'
        with zipfile.ZipFile(EXPORT/file) as original,zipfile.ZipFile(temp,'w') as changed:
            for name in original.namelist():changed.writestr(name,edit(name,original.read(name)))
        return temp
    def replace(self,file,sheet,row,column,value,contract=None):
        index=list(sheets(EXPORT/file)).index(sheet)+1
        def edit(name,data):
            if name==f'xl/worksheets/sheet{index}.xml':
                xml=ET.fromstring(data);cell=xml.find(f"s:sheetData/s:row[@r='{row}']/s:c[@r='{column}{row}']/s:v",NS);self.assertIsNotNone(cell);cell.text=str(value);return ET.tostring(xml)
            return data
        return self.altered(file,edit)
    def test_all_frozen_csv_and_native_workbooks(self):
        cases=json.loads((ROOT/'frozen/expected.json').read_text())['cases'];checked=0
        for c in cases:
            for suffix in ['', '-restored']:
                self.assertTrue(verify(EXPORT/f"{c['name']}{suffix}.xlsx",c['name'])['passed']);checked+=1
        for name in ['outgoing-fees','timing-after-cutoff']:
            for suffix in ['', '-restored']:
                self.assertTrue(verify(EXPORT/f'{name}-native{suffix}.xlsx',name,[EXPORT/f'{name}-source-{i}.xlsx' for i in [0,1]])['passed']);checked+=1
        self.assertEqual(checked,110)
    def test_amount_sign_and_group_sum_tampering(self):
        for sheet,col in [('Movements','N'),('Movements','O'),('Groups','H'),('Groups','J')]:
            with self.assertRaises(AssertionError):verify(self.replace('outgoing-fees.xlsx',sheet,2,col,999),'outgoing-fees')
    def test_member_cell_trace_and_row_identity_tampering(self):
        for sheet,row,col in [('Movements',2,'C'),('Group members',2,'B'),('Cell evidence',2,'E'),('Inventory',2,'C')]:
            with self.assertRaises(AssertionError):verify(self.replace('outgoing-fees.xlsx',sheet,row,col,99),'outgoing-fees')
    def test_timing_persists_after_undo_and_native_restore(self):
        for name in ['timing-after-cutoff','reversal-previous-period']:
            with self.assertRaises(AssertionError):verify(self.replace(f'{name}.xlsx','Timing items',2,'C',99),name)
    def test_invisible_decision_reason_actual_zip(self):
        def edit(name,data):
            if name=='xl/sharedStrings.xml':
                xml=ET.fromstring(data)
                for n in xml.findall('s:si',NS):
                    if n[0].text=='Synthetic bank movement review only':n[0].text='\u200b'
                return ET.tostring(xml)
            return data
        with self.assertRaises(AssertionError):verify(self.altered('individual.xlsx',edit),'individual')
    def test_source_reading_context_and_history_tampering(self):
        for sheet,row,col in [('Sources',2,'D'),('Reading',2,'B'),('Events',2,'A')]:
            file='individual.xlsx' if sheet=='Events' else 'outgoing-fees.xlsx';contract='individual' if sheet=='Events' else 'outgoing-fees'
            with self.assertRaises(AssertionError):verify(self.replace(file,sheet,row,col,99),contract)
    def test_visible_utf16_and_utc_bounds(self):
        from check_export import visible
        self.assertTrue(visible('😀'*1000,2000))
        for v in ['😀'*1001,'\u200b','review\u0000',' review ']:
            with self.assertRaises(AssertionError):visible(v,2000)
    def test_export_formula_hidden_rows_and_sheets_rejected(self):
        def formula(name,data):
            if name=='xl/worksheets/sheet2.xml':
                xml=ET.fromstring(data);cell=xml.find("s:sheetData/s:row[@r='2']/s:c[@r='N2']",NS);ET.SubElement(cell,'{'+NS['s']+'}f').text='101725';return ET.tostring(xml)
            return data
        with self.assertRaises(AssertionError):verify(self.altered('outgoing-fees.xlsx',formula))
        def hidden(name,data):
            if name=='xl/workbook.xml':
                xml=ET.fromstring(data);xml.find('s:sheets/s:sheet',NS).set('state','hidden');return ET.tostring(xml)
            return data
        with self.assertRaises(AssertionError):verify(self.altered('outgoing-fees.xlsx',hidden))
    def test_original_independent_hidden_amount_zip_rejected(self):
        # Public regression: author the hidden display format on a fresh export
        # from the independently frozen synthetic bank CSV. Legacy originals
        # remain local evidence and are never an input to this generated case.
        def hidden_format(name,data):
            if name=='xl/styles.xml':
                xml=ET.fromstring(data)
                formats=ET.SubElement(xml,'{'+NS['s']+'}numFmts',{'count':'1'})
                ET.SubElement(formats,'{'+NS['s']+'}numFmt',{'numFmtId':'164','formatCode':';;;'})
                xfs=xml.find('s:cellXfs',NS);style=copy.deepcopy(xfs[0]);style.set('numFmtId','164');style.set('applyNumberFormat','1');xfs.append(style);xfs.set('count',str(len(xfs)))
                return ET.tostring(xml)
            if name=='xl/worksheets/sheet2.xml':
                xml=ET.fromstring(data);xml.find("s:sheetData/s:row[@r='2']/s:c[@r='N2']",NS).set('s','2');return ET.tostring(xml)
            return data
        original=self.altered('outgoing-fees.xlsx',hidden_format)
        self.assertTrue(original.is_file())
        with self.assertRaisesRegex(AssertionError,'display format'):verify(original)
    def test_actual_zip_number_format_visibility_and_scale(self):
        for code in [';;;','0;;','"0"','0%','0,','[=101725]"0";General','[White]0']:
            def edit(name,data):
                xml=ET.fromstring(data) if name in ['xl/styles.xml','xl/worksheets/sheet2.xml'] else None
                if name=='xl/styles.xml':
                    formats=ET.SubElement(xml,'{'+NS['s']+'}numFmts',{'count':'1'})
                    ET.SubElement(formats,'{'+NS['s']+'}numFmt',{'numFmtId':'164','formatCode':code})
                    xfs=xml.find('s:cellXfs',NS);style=copy.deepcopy(xfs[0]);style.set('numFmtId','164');style.set('applyNumberFormat','1');xfs.append(style);xfs.set('count',str(len(xfs)))
                elif name=='xl/worksheets/sheet2.xml':xml.find("s:sheetData/s:row[@r='2']/s:c[@r='N2']",NS).set('s','2')
                return ET.tostring(xml) if xml is not None else data
            with self.subTest(format=code),self.assertRaises(AssertionError):verify(self.altered('outgoing-fees.xlsx',edit))
    def test_actual_zip_font_theme_alignment_and_conditional_display(self):
        for variant in ['font-white','font-zero','fill-white','theme-white','alignment','conditional','row-zero','column-zero','default-zero','overlay','tiny-row','tiny-column','tiny-default-row','tiny-default-column','hidden-zero','tiny-zoom']:
            def edit(name,data):
                if name=='xl/styles.xml' and variant in ['font-white','font-zero','fill-white','alignment']:
                    xml=ET.fromstring(data)
                    if variant=='font-white':xml.find('s:fonts/s:font/s:color',NS).attrib={'rgb':'FFFFFFFF'}
                    elif variant=='font-zero':xml.find('s:fonts/s:font/s:sz',NS).set('val','0')
                    elif variant=='fill-white':xml.find('s:fills/s:fill/s:patternFill',NS).set('patternType','solid')
                    else:ET.SubElement(xml.find('s:cellXfs/s:xf',NS),'{'+NS['s']+'}alignment',{'textRotation':'90','shrinkToFit':'1'})
                    return ET.tostring(xml)
                if name=='xl/theme/theme1.xml' and variant=='theme-white':
                    xml=ET.fromstring(data);n={'a':'http://schemas.openxmlformats.org/drawingml/2006/main'};xml.find('a:themeElements/a:clrScheme/a:dk1/a:sysClr',n).set('lastClr','FFFFFF');return ET.tostring(xml)
                if name=='xl/worksheets/sheet2.xml':
                    xml=ET.fromstring(data)
                    if variant=='conditional':ET.SubElement(xml,'{'+NS['s']+'}conditionalFormatting',{'sqref':'N2'})
                    elif variant=='row-zero':xml.find("s:sheetData/s:row[@r='2']",NS).set('ht','0')
                    elif variant=='column-zero':xml.find('s:cols/s:col',NS).set('width','0')
                    elif variant=='default-zero':xml.find('s:sheetFormatPr',NS).set('zeroHeight','1')
                    elif variant=='tiny-row':xml.find("s:sheetData/s:row[@r='2']",NS).set('ht','0.1')
                    elif variant=='tiny-column':xml.find('s:cols/s:col',NS).set('width','0.1')
                    elif variant=='tiny-default-row':xml.find('s:sheetFormatPr',NS).set('defaultRowHeight','0.1')
                    elif variant=='tiny-default-column':xml.find('s:sheetFormatPr',NS).set('defaultColWidth','0.1')
                    elif variant=='hidden-zero':xml.find('s:sheetViews/s:sheetView',NS).set('showZeros','0')
                    elif variant=='tiny-zoom':xml.find('s:sheetViews/s:sheetView',NS).set('zoomScale','10')
                    elif variant=='overlay':ET.SubElement(xml,'{'+NS['s']+'}drawing',{'id':'conceal'})
                    return ET.tostring(xml)
                return data
            with self.subTest(display=variant),self.assertRaises(AssertionError):verify(self.altered('outgoing-fees.xlsx',edit))
    def test_native_column_meaning_is_required(self):
        for fmt in ['14','0']:
            def edit(name,data):
                if name=='xl/styles.xml':
                    xml=ET.fromstring(data);xml.find('s:cellXfs',NS)[1].set('numFmtId',fmt);return ET.tostring(xml)
                return data
            with self.subTest(format=fmt),self.assertRaises(AssertionError):sheets(self.altered('outgoing-fees-source-0.xlsx',edit),native=True)
        def date_as_general(name,data):
            if name=='xl/styles.xml':
                xml=ET.fromstring(data);xml.find('s:cellXfs',NS)[2].set('numFmtId','0');return ET.tostring(xml)
            return data
        with self.assertRaises(AssertionError):sheets(self.altered('outgoing-fees-source-0.xlsx',date_as_general),native=True)
    def test_actual_zip_displayed_cell_type_matches_value(self):
        for kind in ['b','inlineStr','str','e']:
            def edit(name,data):
                if name=='xl/worksheets/sheet2.xml':
                    xml=ET.fromstring(data);xml.find("s:sheetData/s:row[@r='2']/s:c[@r='N2']",NS).set('t',kind);return ET.tostring(xml)
                return data
            with self.subTest(cellType=kind),self.assertRaises(AssertionError):verify(self.altered('outgoing-fees.xlsx',edit))
    def test_actual_zip_native_date_system_is_explicit(self):
        for flag in ['1','true','unknown','False']:
            def edit(name,data):
                if name=='xl/workbook.xml':
                    xml=ET.fromstring(data);properties=xml.find('s:workbookPr',NS)
                    if properties is None:properties=ET.SubElement(xml,'{'+NS['s']+'}workbookPr')
                    properties.set('date1904',flag);return ET.tostring(xml)
                return data
            with self.subTest(dateSystem=flag),self.assertRaises(AssertionError):sheets(self.altered('outgoing-fees-source-0.xlsx',edit),native=True)
    def test_native_supported_formats_remain_bounded(self):
        for fmt in ['9','164']:
            def edit(name,data):
                if name=='xl/styles.xml':
                    xml=ET.fromstring(data);xml.find('s:cellXfs',NS)[1].set('numFmtId',fmt);return ET.tostring(xml)
                return data
            with self.subTest(format=fmt),self.assertRaises(AssertionError):sheets(self.altered('outgoing-fees-source-0.xlsx',edit),native=True)
    def test_shared_string_indices_are_unsigned_and_in_range(self):
        for file,target in [('outgoing-fees.xlsx','xl/worksheets/sheet2.xml'),('outgoing-fees-source-0.xlsx','xl/worksheets/sheet1.xml')]:
            for replacement in ['negative','999999','+1','bogus']:
                with zipfile.ZipFile(EXPORT/file) as archive:count=len(ET.fromstring(archive.read('xl/sharedStrings.xml')).findall('s:si',NS))
                def edit(name,data):
                    if name==target:
                        xml=ET.fromstring(data);v=xml.find("s:sheetData/s:row[@r='2']/s:c[@r='A2']/s:v",NS);v.text=str(int(v.text)-count) if replacement=='negative' else replacement;return ET.tostring(xml)
                    return data
                with self.subTest(file=file,index=replacement),self.assertRaises(AssertionError):sheets(self.altered(file,edit),native='source' in file)
if __name__=='__main__':unittest.main(verbosity=2)
