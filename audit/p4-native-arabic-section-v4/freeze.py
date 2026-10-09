"""New pre-code physical instantiation; v3 is immutable failed native gate.

Reuse independently authored v3 truths and thirty exact originals explicitly.
Only the 64-character reference PDF has fresh landscape physical geometry.
No product imports, outputs, issue erasure, receipt or authority transfer.
"""
from pathlib import Path
import hashlib
import html
import json
import os
import re
import subprocess
import tempfile

ROOT = Path(__file__).parent / 'frozen'
BASE = Path(__file__).parent.parent / 'p4-native-arabic-section-v3' / 'frozen'
if (ROOT / 'freeze.json').exists():
    raise SystemExit('Existing freeze is immutable; use a new version.')
ROOT.mkdir(parents=True, exist_ok=True)
old_freeze=json.loads((BASE/'freeze.json').read_text())
for name,digest in old_freeze['files'].items():
    original=(BASE/name).read_bytes()
    if hashlib.sha256(original).hexdigest()!=digest:
        raise SystemExit('Independent baseline freeze changed: '+name)
    (ROOT/name).write_bytes(original)

def write(name,value):
    (ROOT/name).write_text(json.dumps(value,ensure_ascii=True,indent=2)+'\n')

case='arabic-reference-64'
input_data=json.loads((BASE/(case+'.input.json')).read_text())
chunks=['<!doctype html><html><meta charset="utf-8"><style>@page{size:A4 landscape;margin:15mm}body,td{font-family:"DejaVu Sans";font-size:8pt}td{vertical-align:top}</style>']
for page_index,rows in enumerate(input_data['pages']):
    if page_index: chunks.append('<br clear="all" style="page-break-before:always">')
    chunks.append('<table width="100%" cellpadding="10" dir="ltr">')
    for row in rows:
        chunks.append('<tr>')
        for width,value in zip([20,50,15,15],row):
            direction='rtl' if any('\u0621'<=char<='\u064a' for char in value) else 'ltr'
            chunks.append('<td width="%s%%" dir="%s" align="left">%s</td>'%(width,direction,html.escape(value)))
        chunks.append('</tr>')
    chunks.append('</table>')
chunks.append('</html>')
runtime=Path(os.environ.get('P4_NATIVE_ARABIC_RUNTIME',str(Path.home()/'.cache/codex-runtimes/codex-primary-runtime/dependencies')))
soffice=runtime/'bin/override/soffice'
if not soffice.is_file(): raise SystemExit('Existing local runtime required; no download/install.')
with tempfile.TemporaryDirectory(prefix='p4-native-arabic-v4-') as directory:
    temp=Path(directory); source=temp/(case+'.html'); source.write_text(''.join(chunks))
    subprocess.run([str(soffice),'-env:UserInstallation='+(temp/'profile').as_uri(),'--headless','--convert-to','pdf','--outdir',str(temp),str(source)],check=True,capture_output=True)
    original=(temp/(case+'.pdf')).read_bytes()
if not re.search(rb'/ToUnicode\s+\d+\s+0\s+R',original) or not re.search(rb'/FontFile2\s+\d+\s+0\s+R',original):
    raise SystemExit('Real embedded TrueType/ToUnicode required.')
(ROOT/(case+'.pdf')).write_bytes(original)
input_data.update({'physicalProducer':'LibreOffice landscape, embedded DejaVu Sans 8pt, column widths20/50/15/15 percent','cuts':[18,67,78],'baselineIdentity':'Manual v3 source rows/cells/pages/economics unchanged; fresh physical instantiation only'})
write(case+'.input.json',input_data)
expected=json.loads((BASE/(case+'.expected.json')).read_text())
expected.update({'originalSha256':hashlib.sha256(original).hexdigest(),'originalByteLength':len(original)})
write(case+'.expected.json',expected)
contract=json.loads((BASE/'contract.json').read_text())
contract.update({'version':'P4_NATIVE_ARABIC_SECTION_V4','revision':'p4-native-arabic-independent-v4','nativePrecodePositiveGate':'Exact full inventory/pages/hash/bytes AND no rowIssues/cellIssues/referenceIssues/cellNotes/other notes for every positive and resource; no metadata clearing','baselineOriginalIdentityReuse':'Thirty v3 originals byte exact. No receipt reuse/authority transfer. arabic-reference-64 freshly rendered at8pt in landscape wider reference cell.'})
for candidate in contract['cases']:
    if candidate['id']==case: candidate['cuts']=[18,67,78]
write('contract.json',contract)
files={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(ROOT.iterdir()) if p.name!='freeze.json'}
write('freeze.json',{'authorship':'Independent intended manual v3 rows/economics/citations reused before engine; fresh physical64-character native PDF geometry; zero product imports/outputs','generatorSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'baselineFreezeSha256':hashlib.sha256((BASE/'freeze.json').read_bytes()).hexdigest(),'identityReusedOriginals':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(BASE.glob('*.pdf')) if p.name!=case+'.pdf'},'files':files})
print('Frozen v4:',len(files),'payloads; thirty exact reused originals plus fresh landscape64-reference')
