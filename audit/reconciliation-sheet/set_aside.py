"""The reconciliation sheet set aside before an evidence reader reads a workpaper.

UX-6: the workpaper the page downloads opens on one reconciliation sheet,
named in the interface's language, its cell formats appended after the
evidence's. An evidence reader holds the evidence sheets after it to its
own unchanged rules; this sets the sheet aside and says which cell formats
the evidence sheets name, so that the reader holds its display profile on
those, and the sheet's own (its fonts, borders, number formats, and cell
formats after the evidence's) are left to check_sheet.py beside this file,
which checks that sheet. A sheet out of place, hidden, alone, or with a cell
format among the evidence's is refused here.

ZIP and XML only: no product imports. Used by the inventory family readers
(audit/inventory-*/check_export.py and inventory-pdf-foundation's
check_control.py), which share one OpenXML reader.
"""
import posixpath
from xml.etree import ElementTree as ET

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
REL = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
# The sheet's name in each interface language.
NAMES = ('ورقة التسوية', 'Reconciliation sheet')


def _xml(archive, name):
    raw = archive.read(name)
    assert b'<!DOCTYPE' not in raw and b'<!ENTITY' not in raw, 'XML_DTD'
    return ET.fromstring(raw)


def _refs(root):
    """Every cell format a sheet part names: its cells, rows and columns."""
    found = set()
    for node in root.iter():
        tag = node.tag.rsplit('}', 1)[-1]
        if tag in ('c', 'row', 'col'):
            value = node.get('style' if tag == 'col' else 's', '0')
            assert value.isdigit(), 'OUTPUT_DISPLAY_STYLE_INDEX'
            found.add(int(value))
    return found


def set_aside(archive):
    """(first, held): whether the workbook opens on the reconciliation sheet,
    and the cell formats its evidence sheets name (None without the sheet:
    every format is then held, as before)."""
    sheets = _xml(archive, 'xl/workbook.xml').findall(NS + 'sheets/' + NS + 'sheet')
    first = bool(sheets) and sheets[0].get('name') in NAMES
    assert not any(s.get('name') in NAMES for s in sheets[1 if first else 0:]), 'RECONCILIATION_SHEET_ORDER'
    if not first:
        return False, None
    assert sheets[0].get('state') in (None, 'visible'), 'RECONCILIATION_SHEET_VISIBILITY'
    assert len(sheets) > 1, 'RECONCILIATION_SHEET_ALONE'
    links = {e.get('Id'): e.get('Target', '') for e in _xml(archive, 'xl/_rels/workbook.xml.rels')}

    def part(sheet):
        target = links.get(sheet.get(REL + 'id'))
        assert target, 'SHEET_RELATIONSHIP'
        return target[1:] if target.startswith('/') else posixpath.normpath(posixpath.join('xl', target))

    held = {0}.union(*(_refs(_xml(archive, part(s))) for s in sheets[1:]))
    own = _refs(_xml(archive, part(sheets[0]))) - {0}
    assert not own or max(held) < min(own), 'RECONCILIATION_SHEET_STYLES'
    return True, held
