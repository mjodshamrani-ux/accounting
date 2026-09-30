"""Independent literal CSV writer for assistant evidence contracts."""
import csv
import hashlib
import io
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parent
dest=ROOT/'frozen';dest.mkdir(exist_ok=True)
specs={
 'untyped-credit':(['Date','Credit Note No','Invoice No','Amount','Type','Source Book'],[['2026-07-17','CN-701','INV-401','-50.00','','supplier']],[['2026-07-17','CN-799','INV-401','-50.00','','ledger']]),
 'unselected-reference':(['Date','Document No','Reference','Amount','Type','Source Book'],[['2026-07-17','INV-P5-714','EXT-777','100.00','Invoice','supplier']],[['2026-07-17','INV-P5-714','EXT-777','100.00','Invoice','ledger']]),
 'balanced-variance':(['Date','Document No','Amount','Type','Source Book'],[['2026-07-17','INV-P5-730','100.00','Invoice','supplier']],[['2026-07-17','INV-P5-730','90.00','Invoice','ledger']]),
 'partial-source':(['Date','Document No','Amount','Type','Source Book'],[['2026-07-17','INV-P5-740','100.00','Invoice','supplier'],['2026-07-17','INV-P5-741','unread','Invoice','supplier']],[['2026-07-17','INV-P5-740','100.00','Invoice','ledger']]),
}
for name,(headers,a,b) in specs.items():
 for side,rows in [('supplier',a),('ledger',b)]:
  buf=io.StringIO(newline='');csv.writer(buf,lineterminator='\r\n').writerows([headers]+rows)
  (dest/(name+'-'+side+'.csv')).write_bytes(buf.getvalue().encode())
(ROOT/'source-manifest.json').write_text(json.dumps({p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(dest.iterdir())},indent=2)+'\n')
