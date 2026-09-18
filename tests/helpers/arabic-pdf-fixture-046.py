"""Real text PDF producer for the targeted Arabic corpus, not production code.
Requires ReportLab 4.4.9, uharfbuzz 0.56.1 and an installed DejaVuSans TTF.
For independent LibreOffice output use --producer libreoffice plus --soffice.
Input JSON pages contain visible cells only; no oracle/financial links consumed.
"""
import argparse, json, os, sys, html, tempfile, subprocess
from pathlib import Path
parser = argparse.ArgumentParser()
parser.add_argument('--input', required=True)
parser.add_argument('--output', required=True)
parser.add_argument('--font', required=True)
parser.add_argument('--producer', default='reportlab')
parser.add_argument('--soffice')
args = parser.parse_args()
spec = json.loads(Path(args.input).read_text())
if args.producer == 'libreoffice':
    chunks=[]
    for p, page in enumerate(spec['pages']):
        chunks.append('<div style="page-break-before:%s">' % ('always' if p else 'auto'))
        chunks.append('<table width="100%%" cellpadding="10" dir="ltr">')
        for row in page['rows']:
            chunks.append('<tr>')
            for value in row:
                direction = 'rtl' if any('\u0621' <= c <= '\u064a' for c in value) else 'ltr'
                chunks.append('<td width="%d%%" align="left" dir="%s">%s</td>' % (100/len(row), direction, html.escape(value).replace('\n','<br>')))
            chunks.append('</tr>')
        chunks.append('</table></div>')
    with tempfile.TemporaryDirectory(prefix='tarasuf-lo-') as tmp:
        source = Path(tmp)/'fixture.html'
        source.write_text('<!doctype html><html><meta charset="utf-8"><style>@page{size:A4;margin:15mm}body{font-family:"DejaVu Sans";font-size:10pt}td{vertical-align:top}</style>'+''.join(chunks))
        subprocess.run([args.soffice, '-env:UserInstallation='+Path(tmp,'profile').as_uri(), '--headless','--convert-to','pdf','--outdir',tmp,str(source)],check=True,stdout=subprocess.DEVNULL)
        Path(args.output).write_bytes(Path(tmp,'fixture.pdf').read_bytes())
else:
    from reportlab.pdfgen import canvas
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont, shapeStr
    import uharfbuzz
    pdfmetrics.registerFont(TTFont('ArabicFixture',args.font))
    c=canvas.Canvas(args.output,pagesize=(595,842),pageCompression=1,invariant=1)
    for page in spec['pages']:
        if page.get('raster'):
            from PIL import Image, ImageDraw
            from reportlab.lib.utils import ImageReader
            image = Image.new('RGB',(600,100),'white')
            ImageDraw.Draw(image).text((10,30),'UNREAD TEXT: INV-LOST 999.00',fill='black',font_size=25)
            c.drawImage(ImageReader(image),30,650,width=500,height=83)
            c.showPage()
            continue
        size=page.get('fontSize',11)
        c.setFont('ArabicFixture',size)
        positions=page.get('positions',[30,170,310,450])
        y=page.get('top',760)
        for row in page['rows']:
            height=max(len(s.split('\n')) for s in row)
            for x,value in zip(positions,row):
                for line,s in enumerate(value.split('\n')):
                    # HarfBuzz shapes Arabic words. Never shape numeric/reference
                    # cells: glyph order is then their actual physical order.
                    has_arabic = any('\u0621' <= a <= '\u064a' for a in s)
                    if has_arabic and any(a.isascii() and a.isalnum() for a in s):
                        raise ValueError('Use LibreOffice for Arabic + Latin/digits within one cell; HarfBuzz alone is not a full bidi compositor')
                    value=shapeStr(s,'ArabicFixture',size) if has_arabic else s
                    c.drawString(x,y-line*14,value)
            y-=max(page.get('leading',30),height*14+12)
        c.showPage()
    c.save()
