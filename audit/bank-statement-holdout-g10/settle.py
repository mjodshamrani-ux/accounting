"""Fixed bytes for the G10 PDFs, written after each writer has run.

FOP stamps the clock in its XMP metadata date and file identifier; OpenPDF
in its document dates and file identifier, and it draws a random six-letter
prefix for each embedded font subset. `settle` writes the fixed date
2026-10-23 into every date, prefixes taken from each font's name, and an
identifier hashed from the file's bytes before its trailer, each the same
length as what it replaces, so the cross-reference offsets stand and the
same facts give the same bytes.
"""
import hashlib
import re

PDF_DATE = b'D:20261023000000Z'
XMP_DATE = b'2026-10-23T00:00:00Z'


def settle(path, prefixes=False):
    data = path.read_bytes()
    data = re.sub(rb'D:\d{14}Z', PDF_DATE, data)
    data = re.sub(rb'(<xmp:(?:MetadataDate|ModifyDate|CreateDate)>)\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ',
                  rb'\g<1>' + XMP_DATE, data)
    if prefixes:
        def prefix(m):
            letters = ''.join(chr(ord('A') + int(c, 16)) for c in hashlib.sha256(m.group(1)).hexdigest()[:6])
            return b'/' + letters.encode() + b'+' + m.group(1)
        data = re.sub(rb'/[A-Z]{6}\+([A-Za-z0-9-]+)', prefix, data)
    found = re.search(rb'/ID ?\[ ?<([0-9A-Fa-f]+)> ?<([0-9A-Fa-f]+)> ?\]', data)
    if not found:
        raise ValueError(f'{path.name}: no file identifier')
    digest = hashlib.md5(data[:found.start()]).hexdigest()  # noqa: S324 - an identifier, not a security hash
    if found.group(1).isupper():
        digest = digest.upper()
    digest = digest.encode()
    data = data[:found.start(1)] + digest + data[found.end(1):found.start(2)] + digest + data[found.end(2):]
    path.write_bytes(data)
