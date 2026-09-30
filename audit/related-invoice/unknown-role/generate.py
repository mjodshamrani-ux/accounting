"""Independent literal native sources for the untyped credit-number role gap."""
import csv
import hashlib
import io
import json
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent.parent / 'layered-statement'))
from generate import sheet, workbook, write_xlsx

def main():
    dest = ROOT / 'frozen'
    dest.mkdir(exist_ok=True)
    contract = json.loads((ROOT / 'contract.json').read_text())
    for c in contract['cases']:
        arabic = c['id'].startswith('arabic')
        headers = (['التاريخ','رقم الإشعار الدائن','رقم الفاتورة','المبلغ','نوع المستند','دفتر المصدر']
                   if arabic else ['Date','Credit Note No','Invoice No','Amount','Type','Source Book'])
        if c.get('chosenReference'): headers.append('Reference')
        for side in ['supplier','ledger']:
            money = '50.00' if c['amountMinor'] > 0 else '-50.00'
            row = ['2026-07-17',c[side+'Credit'],'INV-401',money,'',side]
            if c.get('chosenReference'): row.append('DOC-714')
            rows = [headers,row]
            buf = io.StringIO(newline='')
            csv.writer(buf,lineterminator='\r\n').writerows(rows)
            stem = c['id']+'-'+side
            (dest/(stem+'.csv')).write_bytes(buf.getvalue().encode())
            if side == 'supplier':
                write_xlsx(dest/(stem+'.xlsx'),workbook(sheet([
                    (i,[(chr(65+j)+str(i),v) for j,v in enumerate(values)])
                    for i,values in enumerate(rows,1)
                ])))
    manifest = {p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(dest.iterdir())}
    (ROOT/'source-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')

if __name__ == '__main__': main()
