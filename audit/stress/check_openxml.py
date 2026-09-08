"""Independent Excel output verifier: stdlib ZIP/XML + Decimal, no ExcelJS or engine code."""
from pathlib import Path
from zipfile import ZipFile
import xml.etree.ElementTree as ET
from decimal import Decimal
import json
root=Path('audit/stress/workbooks');ns={'x':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
checks=0
cases=json.loads((root/'manifest.json').read_text())
for case in cases:
 with ZipFile(root/case['name']) as z:
  assert z.testzip() is None
  assert not any('externalLinks/' in name or 'vbaProject' in name for name in z.namelist())
  shared=ET.fromstring(z.read('xl/sharedStrings.xml'))
  strings=[''.join(el.itertext()) for el in shared]
  assert case['description'] in strings
  book=ET.fromstring(z.read('xl/workbook.xml'))
  rels=ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
  targets={r.attrib['Id']:r.attrib['Target'] for r in rels}
  styles=ET.fromstring(z.read('xl/styles.xml'))
  formats={int(f.attrib['numFmtId']):f.attrib['formatCode'] for f in styles.findall('x:numFmts/x:numFmt',ns)}
  formats.update({3:'#,##0',4:'#,##0.00'})
  cell_styles=styles.find('x:cellXfs',ns)
  observed=set()
  for sh in book.find('x:sheets',ns):
   target=targets[sh.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']]
   path=target.lstrip('/') if target.startswith('/') else 'xl/'+target
   tree=ET.fromstring(z.read(path));assert not tree.findall('.//x:f',ns)
   if sh.attrib['name'] not in case['expected']:continue
   observed.add(sh.attrib['name'])
   found={}
   for row in tree.findall('.//x:sheetData/x:row',ns)[1:]:
    cells={c.attrib['r'].rstrip('0123456789'):c for c in row}
    ident=strings[int(cells['A'].find('x:v',ns).text)]
    assert ident not in found, ('duplicate exported id',ident)
    amount=cells['H'];assert amount.attrib.get('t','n')=='n'
    format_id=int(cell_styles[int(amount.attrib.get('s','0'))].attrib['numFmtId'])
    assert formats[format_id]=='#,##0'+('.'+'0'*case['decimals'] if case['decimals'] else '')
    found[ident]=Decimal(amount.find('x:v',ns).text)*(Decimal(10)**case['decimals'])
   expected={r['id']:Decimal(r['minor']) for r in case['expected'][sh.attrib['name']]}
   assert found==expected,(case['name'],sh.attrib['name'],found,expected)
   checks+=len(found)
  assert observed==set(case['expected']), ('missing sheets',case['name'])
print(json.dumps({'workbooks':len(cases),'numeric_cells_verified_exactly':checks,'decimal_formats':'pass','formula_cells':0,'zip_crc':'pass','xml_parse':'pass','bilingual_text':'pass','verifier':'Python stdlib ZIP/XML/Decimal; independent of ExcelJS'},indent=2))
