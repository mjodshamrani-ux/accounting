"""F03 native text PDF representations: explicit glyph positions, no product code."""
from pathlib import Path
ROOT=Path(__file__).resolve().parent/'frozen'
def pdf(own):
    rows=[['Date','Credit Note No','Invoice No','Amount','Type'],['2026-07-17',own,'INV-401','-50.00','Credit Note']]
    escape=lambda v:v.replace('\\','\\\\').replace('(','\\(').replace(')','\\)')
    stream='\n'.join(f'BT /F1 8 Tf 1 0 0 1 {x} {750-i*24} Tm ({escape(v)}) Tj ET' for i,row in enumerate(rows) for x,v in zip([30,132,260,380,485],row))
    objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [4 0 R] /Count 1 >>','<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>',f'<< /Length {len(stream)} >>\nstream\n{stream}\nendstream']
    output='%PDF-1.7\n'; offsets=[0]
    for i,obj in enumerate(objects,1):
        offsets.append(len(output));output+=f'{i} 0 obj\n{obj}\nendobj\n'
    xref=len(output)
    output+=f'xref\n0 {len(objects)+1}\n0000000000 65535 f \n'+''.join(f'{v:010d} 00000 n \n' for v in offsets[1:])+f'trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'
    return output.encode('ascii')
for name,own in [('own-credit-note','CN-701'),('short-own-credit-note','CN-3'),('different-credit-notes','CN-701')]:
    (ROOT/(name+'-supplier.pdf')).write_bytes(pdf(own))
