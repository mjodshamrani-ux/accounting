"""Independent check of the composite PDFs (V1.1), with pdfminer.six rather
than the pdf.js reader the product uses. Prints, for each file, the text of
every page. The caller decides what must be there.

    PYTHONPATH=work/pyvendor python3 audit/hard-cases/pdf_verify.py a.pdf b.pdf
"""
import json
import sys

from pdfminer.high_level import extract_pages
from pdfminer.layout import LTTextContainer

out = {}
for path in sys.argv[1:]:
    pages = []
    for layout in extract_pages(path):
        pages.append(
            "\n".join(
                element.get_text()
                for element in layout
                if isinstance(element, LTTextContainer)
            )
        )
    out[path] = {"pages": pages}
print(json.dumps(out, ensure_ascii=False))
