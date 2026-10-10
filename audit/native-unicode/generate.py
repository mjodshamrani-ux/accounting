"""Synthetic source facts, authored before extraction; no product imports."""
from pathlib import Path
import hashlib,json,zlib,csv,io
ROOT=Path(__file__).parent/'frozen'

def make(rows, special, compressed=False, ranged=False, mixed=False):
    # Assign a CID to each source character; one deliberately maps to a sequence.
    chars=sorted(set(''.join(''.join(row) for row in rows)));ids={c:i+1 for i,c in enumerate(chars)}
    mapping={c:c.encode('utf-16-be').hex().upper() for c in chars}
    mapping.update(special)
    cm=['/CIDInit /ProcSet findresource begin 12 dict begin begincmap','/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def','/CMapName /SyntheticUnicode def /CMapType 2 def','1 begincodespacerange <0000> <FFFF> endcodespacerange']
    if ranged:
        cm += [f'{len(chars)} beginbfrange']+[f'<{ids[c]:04X}> <{ids[c]:04X}> [<{mapping[c]}>]' for c in chars]+['endbfrange']
    else:
        cm += [f'{len(chars)} beginbfchar']+[f'<{ids[c]:04X}> <{mapping[c]}>' for c in chars]+['endbfchar']
    cm += ['endcmap CMapName currentdict /CMap defineresource pop end end']
    def stream(b, compress=False):
        b=b.encode() if isinstance(b,str) else b
        if compress:b=zlib.compress(b)
        return b'<< /Length '+str(len(b)).encode()+(b' /Filter /FlateDecode' if compress else b'')+b' >>\nstream\n'+b+b'\nendstream'
    txt=[]
    for ri,row in enumerate(rows):
        for ci,s in enumerate(row):
            if s:
                font='F1' if not mixed or (ri==4 and ci==2) else 'F2'
                value=''.join(f'{ids[c]:04X}' for c in s) if font=='F1' else s.encode('ascii').hex().upper()
                txt.append(f'BT /{font} 1 Tf 1 0 0 1 {[20,420,820,1420,1720][ci]} {1190-ri*5} Tm <{value}> Tj ET')
    obj=[b'<< /Type /Catalog /Pages 2 0 R >>',b'<< /Type /Pages /Kids [8 0 R] /Count 1 >>',b'<< /Type /Font /Subtype /Type0 /BaseFont /Helvetica /Encoding /Identity-H /DescendantFonts [4 0 R] /ToUnicode 6 0 R >>',b'<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Helvetica /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 5 0 R /DW 500 >>',b'<< /Type /FontDescriptor /FontName /Helvetica /Flags 32 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 >>',stream('\n'.join(cm),compressed),stream('\n'.join(txt)),b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 2000 1200] /Resources << /Font << /F1 3 0 R >> >> /Contents 7 0 R >>']
    if mixed:
        obj[7]=obj[7].replace(b'/F1 3 0 R',b'/F1 3 0 R /F2 9 0 R')
        obj.append(b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
    out=b'%PDF-1.7\n% synthetic-native-unicode\n';offsets=[]
    for i,b in enumerate(obj,1):offsets.append(len(out));out+=f'{i} 0 obj\n'.encode()+b+b'\nendobj\n'
    xref=len(out);out+=f'xref\n0 {len(obj)+1}\n0000000000 65535 f \n'.encode()+b''.join(f'{p:010d} 00000 n \n'.encode() for p in offsets)+f'trailer << /Size {len(obj)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode()
    return out

def save(name,rows,special={},**kw):
    data=make(rows,special,**kw);(ROOT/(name+'.pdf')).write_bytes(data)
    facts={'synthetic':True,'name':name,'sourceSha256':hashlib.sha256(data).hexdigest(),'cuts':[20,40,70,85],'rows':rows,'accepted':not name.startswith('invalid-')}
    if name=='multi-map':facts['rows'][4][2]='multi 𐐀A😀 value'
    if not name.startswith('invalid-'):
        out=io.StringIO(newline='');writer=csv.writer(out,lineterminator='\r\n');writer.writerows([facts['rows'][2]]+facts['rows'][4:]);(ROOT/(name+'.csv')).write_bytes(out.getvalue().encode('utf8'))
    (ROOT/(name+'.json')).write_text(json.dumps(facts,ensure_ascii=False,indent=2)+'\n')

def rows(desc,ref='UNI-41'):
    return [['SYNTHETIC ONLY','','','',''],['Currency: SAR','','','',''],['Date','Reference','Description','Debit','Credit'],['Invoice: UNI-41','','','',''],['2026-10-08',ref,desc,'12.34','0'],['2026-10-09',ref,'credit 𐐨 𝒜 𠀀','0','0.56']]
for name,desc in [('letters','letters 𐐀 𝐀 𠀀 😀'),('private-use','literal \uf600 \ue000 𐐀'),('compressed','compressed 𐐀 𝐀 𠀀'),('ranged','ranged 𐐀 𝐀 𠀀')]:save(name,rows(desc),compressed=name=='compressed',ranged=name=='ranged')
save('multi-map',rows('multi § value'),{'§':'D801DC000041D83DDE00'})
save('unicode-reference',rows('reference 𐐀','REF-𐐀-𝐀-𠀀'))
for name,code in [('high-only','D801'),('low-only','DC00'),('high-ascii','D8010041'),('reversed','DC00D801'),('double-high','D801D801'),('odd-byte','D801DC')]:save('invalid-'+name,rows('invalid § value'),{'§':code})
print('Generated independent synthetic native source bytes and facts; no product extraction.')

mixed_rows=rows('invalid § value');mixed_rows[-1][2]='credit good';save('invalid-mixed-font',mixed_rows,{'§':'D8010041'},mixed=True)
