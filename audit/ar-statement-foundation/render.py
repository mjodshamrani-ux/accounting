"""Print the AR-1 foundation stories: statement PDFs with ReportLab, ledgers
as CSV, and the facts, into one folder.

Every printed line of the facts is drawn on its page and nothing else. Text
lines sit at the margin; a heading line lays out its columns left to right
(right to left in Arabic), and each value is drawn under its heading, amounts
aligned to the column end. English statements use the standard Helvetica
(not embedded); the Arabic statement embeds DejaVu Sans, shaped with
arabic-reshaper and put in visual order with python-bidi, as ReportLab
systems do. `invariant=1` fixes ReportLab's dates and identifiers.

  PYTHONPATH=<reportlab, arabic-reshaper, python-bidi> \
    python3 -B audit/ar-statement-foundation/render.py <out dir>
"""
import csv
import io
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
WIDTHS = {'date': 58, 'type': 60, 'document': 66, 'related': 66, 'description': 112,
          'original': 72, 'open': 66, 'balance': 72}
ROLES = {
    'Date': 'date', 'التاريخ': 'date', 'Type': 'type', 'النوع': 'type',
    'Document No': 'document', 'رقم المستند': 'document',
    'Related invoice': 'related', 'الفاتورة المرتبطة': 'related',
    'Description': 'description', 'البيان': 'description',
    'Original amount': 'original', 'المبلغ الأصلي': 'original',
    'Open amount': 'open', 'المبلغ المفتوح': 'open', 'Balance': 'balance', 'الرصيد': 'balance',
}
AMOUNTS = {'original', 'open', 'balance'}
LEDGER = ['Posting ID', 'Document type', 'Own document number', 'Posting date',
          'Original signed amount', 'Entity', 'Ledger', 'Customer', 'Account', 'Currency',
          'Related invoice', 'Description']


def facts():
    out = subprocess.run([sys.executable, '-B', str(HERE / 'stories.py')], check=True,
                         capture_output=True, text=True).stdout
    return json.loads(out)


def render_pdf(story, target):
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.pdfgen import canvas

    rtl = story['layout'] == 'ar'
    if rtl:
        import arabic_reshaper
        try:
            from bidi import get_display
        except ImportError:
            from bidi.algorithm import get_display
        for alias, path in (('DejaVuSans', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'),
                            ('DejaVuSans-Bold', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf')):
            if alias not in pdfmetrics.getRegisteredFontNames():
                pdfmetrics.registerFont(TTFont(alias, path))
        regular, bold = 'DejaVuSans', 'DejaVuSans-Bold'

        def visual(t):
            return get_display(arabic_reshaper.reshape(t)) if t else t
    else:
        regular, bold = 'Helvetica', 'Helvetica-Bold'

        def visual(t):
            return t
    width, height = A4
    margin = 36
    c = canvas.Canvas(str(target), pagesize=A4, invariant=1)
    c.setTitle('Statement of account')
    c.setCreator('ReportLab synthetic customer statement writer (AR-1 foundation)')
    for page in story['statement']['pages']:
        y = height - margin - 12
        spans = {}
        first = True
        for line in page:
            if 'text' in line:
                if line['align'] == 'center':
                    c.setFont(regular, 8)
                    c.drawCentredString(width / 2, margin - 8, visual(line['text']))
                    continue
                size = 12 if first else 9
                c.setFont(bold if first else regular, size)
                (c.drawRightString(width - margin, y, visual(line['text'])) if rtl
                 else c.drawString(margin, y, line['text']))
                y -= 16 if first else 12
                first = False
            elif 'headings' in line:
                y -= 6
                spans, x = {}, margin
                for h in line['headings']:
                    w = WIDTHS.get(ROLES.get(h, ''), 60)
                    a, b = (width - x - w, width - x) if rtl else (x, x + w)
                    spans[h] = (a, b, ROLES.get(h) in AMOUNTS)
                    x += w
                c.setFont(bold, 8)
                for h, (a, b, end) in spans.items():
                    put(c, visual(h), a, b, end, rtl, y)
                c.setLineWidth(0.5)
                c.line(margin, y - 3, width - margin, y - 3)
                y -= 13
            else:
                c.setFont(regular, 8)
                for h, value in line['cells']:
                    a, b, end = spans[h]
                    put(c, visual(value), a, b, end, rtl, y)
                y -= 11
        c.showPage()
    c.save()


def put(c, text, a, b, end, rtl, y):
    if end != rtl:
        c.drawRightString(b - 3, y, text)
    else:
        c.drawString(a + 3, y, text)


def ledger_csv(rows):
    buffer = io.StringIO()
    w = csv.writer(buffer, lineterminator='\r\n')
    w.writerow(LEDGER)
    for r in rows:
        w.writerow([r[k] for k in LEDGER])
    return buffer.getvalue().encode('utf-8')


def main(out):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    data = facts()
    (out / 'stories.json').write_text(
        json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    for story in data['stories']:
        render_pdf(story, out / f"{story['id']}-statement.pdf")
        (out / f"{story['id']}-ledger.csv").write_bytes(ledger_csv(story['ledger']))
    import reportlab
    print(json.dumps({'stories': len(data['stories']), 'reportlab': reportlab.Version}))


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else HERE / 'frozen')
