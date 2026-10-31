"""Pre-seal check of a holdout's XLSX cashbook, read as the product reads it
(G16), without the product (DEV-61).

The product reads a cashbook in three steps: lib/reconciliation/
xlsx-namespaces.ts prepares the workbook for ExcelJS, lib/reconciliation/io.ts
reads every cell and records what Excel would not show as stored, and
readBankCashbookTable in lib/reconciliation/bank-statement-match.ts reads the
six declared columns and refuses what G16 made it refuse. This module reads
the ZIP and XML itself and applies the same rules, in the same order, so the
first refusal it reports is the product's first refusal. README.ar.md lists
each rule, where it is copied from, and the rules not covered.

check(path) returns {'refused': None or {'code', 'row', 'detail'}, 'entries':
[...], 'exercised': {...}, 'notes': {...}}. The two keyword switches restore
earlier product rules for the retro measurement: typed_amounts=False is the
reader before G8 (an amount only as text with its decimals), renamed_core=
False is before G15 (core properties under another prefix refused).
"""
import math
import re
import zipfile
from decimal import Decimal
from xml.dom import minidom
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCES = {
    'match': ROOT / 'lib/reconciliation/bank-statement-match.ts',
    'io': ROOT / 'lib/reconciliation/io.ts',
    'display': ROOT / 'lib/reconciliation/xlsx-display.ts',
    'namespaces': ROOT / 'lib/reconciliation/xlsx-namespaces.ts',
}
HEADERS = ['Date', 'Voucher', 'Description', 'Reference', 'Receipts', 'Payments']
DECIMALS = {'SAR': 2, 'USD': 2, 'EUR': 2, 'GBP': 2, 'AED': 2, 'QAR': 2, 'EGP': 2,
            'KWD': 3, 'BHD': 3, 'OMR': 3, 'JPY': 0}
MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
OFFICE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
CORE = 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties'
DC = 'http://purl.org/dc/elements/1.1/'
DCTERMS = 'http://purl.org/dc/terms/'
# The core properties ECMA-376 Part 2 defines, each by the literal name ExcelJS
# matches (xlsx-namespaces.ts, coreProperties).
CORE_LITERAL = {(CORE, 'coreProperties'): 'cp:coreProperties'}
CORE_LITERAL.update({(DC, n): f'dc:{n}' for n in
                     ('creator', 'title', 'subject', 'description', 'identifier', 'language')})
CORE_LITERAL.update({(CORE, n): f'cp:{n}' for n in
                     ('keywords', 'category', 'lastModifiedBy', 'lastPrinted', 'revision', 'version',
                      'contentStatus', 'contentType')})
CORE_LITERAL.update({(DCTERMS, n): f'dcterms:{n}' for n in ('created', 'modified')})
# The number formats xlsx-display.ts knows by id; any other id is unsupported.
DISPLAY_FORMATS = {0: 'General', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%',
                   10: '0.00%', 11: '0.00E+00', 12: '# ?/?', 13: '# ??/??',
                   37: '#,##0 ;(#,##0)', 38: '#,##0 ;[Red](#,##0)', 39: '#,##0.00 ;(#,##0.00)',
                   40: '#,##0.00 ;[Red](#,##0.00)', 49: '@'}
# ExcelJS's built-in formats (lib/xlsx/defaultnumformats.js), which decide
# whether it reads a number as a date.
EXCELJS_FORMATS = dict(DISPLAY_FORMATS)
EXCELJS_FORMATS.update({14: 'mm-dd-yy', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy',
                        18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM', 20: 'h:mm', 21: 'h:mm:ss',
                        22: 'm/d/yy "h":mm', 45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mmss.0',
                        48: '##0.0E+0'})
THEME_SLOTS = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4',
               'accent5', 'accent6', 'hlink', 'folHlink']
INDEXED = ['000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
           '000000', 'FFFFFF']
MAX_FILE = 8 * 1024 * 1024
MAX_TEXT = 4096
PRECISION_NOTE = 'precision'


def drift():
    """What this module copies and the product's source no longer carries."""
    text = {k: p.read_text(encoding='utf-8') for k, p in SOURCES.items()}
    need = {
        'match': ["'Date',\n  'Voucher',\n  'Description',\n  'Reference',\n  'Receipts',\n  'Payments',",
                  "`^(\\\\d+)${decimals ? `\\\\.(\\\\d{${decimals}})` : ''}$`",
                  "`^(\\\\d+)${decimals ? `(?:\\\\.(\\\\d{1,${decimals}}))?` : ''}$`",
                  "name === 'Voucher' || name === 'Reference'",
                  "(name === 'Receipts' || name === 'Payments') &&",
                  'recorded(1);', 'recorded(at);',
                  "if (receipt > 0 === payment > 0)",
                  "if (!voucher || vouchers.has(voucher))"],
        'io': ["if (sections.length > 4) return false;",
               "return /^(?:#*0+|#{1,3},##0)(?:\\.[0#]+)?$/.test(section);",
               "if (/^0+$/.test(format) && Number.isInteger(value)) {",
               "if (sections.length < 4) return true;",
               "(!Number.isFinite(value) || Math.abs(value) >= 1e15)",
               "/^0{2,}$/.test(cell.numFmt) &&",
               "workbook.worksheets.length > MAX_SHEETS"],
        'display': ["(Math.max(fore, back) + 0.05) / (Math.min(fore, back) + 0.05) >= 3",
                    "info?.cellStyles.get(address) ??\n      info?.rowStyles.get(row) ??\n      info?.columnStyles.get(column) ??\n      0",
                    "if (fill.pattern !== 'none' && fill.pattern !== 'gray125') {",
                    "/\\[(Black|White|Blue|Cyan|Green|Magenta|Red|Yellow|Color\\d+)\\]/i"],
        'namespaces': ["if (decimalIdentity(raw) !== decimalIdentity(String(Number(raw))))",
                       "return known && renamed;"],
    }
    return [f'{k}: {s[:60]}' for k, snippets in need.items() for s in snippets if s not in text[k]]


# ---------------------------------------------------------------- numbers --

def js_number(x):
    """JavaScript's String(Number): ECMA-262 Number::toString, from the
    shortest digits that round-trip, which repr gives too."""
    if math.isnan(x):
        return 'NaN'
    if math.isinf(x):
        return 'Infinity' if x > 0 else '-Infinity'
    if x == 0:
        return '0'
    t = Decimal(repr(abs(x))).as_tuple()
    digits, exponent = ''.join(map(str, t.digits)), t.exponent
    while len(digits) > 1 and digits.endswith('0'):
        digits, exponent = digits[:-1], exponent + 1
    digits = digits.lstrip('0')
    k, n = len(digits), len(digits) + exponent
    sign = '-' if x < 0 else ''
    if k <= n <= 21:
        return sign + digits + '0' * (n - k)
    if 0 < n <= 21:
        return sign + digits[:n] + '.' + digits[n:]
    if -6 < n <= 0:
        return sign + '0.' + '0' * (-n) + digits
    e = n - 1
    head = digits[0] + ('.' + digits[1:] if k > 1 else '')
    return f"{sign}{head}e{'+' if e >= 0 else '-'}{abs(e)}"


def decimal_identity(text):
    """xlsx-namespaces.ts decimalIdentity."""
    negative = text.startswith('-')
    mantissa, _, power = re.sub(r'^[+-]', '', text).lower().partition('e')
    whole, _, fraction = mantissa.partition('.')
    digits = (whole + fraction).lstrip('0')
    if not digits:
        return '0'
    exponent = int(power or 0) - len(fraction)
    trimmed = digits.rstrip('0')
    exponent += len(digits) - len(trimmed)
    return f"{'-' if negative else ''}{trimmed}e{exponent}"


def transparent_numeric(fmt, value):
    """io.ts transparentNumericFormat."""
    if not fmt or re.fullmatch(r'general', fmt, re.I):
        return True
    sections = fmt.split(';')
    if len(sections) > 4:
        return False
    index = 1 if value < 0 and len(sections) > 1 else 2 if value == 0 and len(sections) > 2 else 0
    section = re.sub(r'_.|\*.', '', sections[index])
    currency = lambda s: re.fullmatch(  # noqa: E731
        r'(?:[$€£¥₹₩]|SAR|USD|EUR|GBP|AED|KWD|JPY|ر\.س\.?|د\.إ\.?|د\.ك\.?)',
        re.sub('[‎‏؜]', '', s).strip(), re.I) is not None
    understood = [True]

    def literal(m):
        lit = m.group(1)
        if not lit.strip():
            return ''
        if value == 0 and lit == '-':
            return '-'
        if not currency(lit):
            understood[0] = False
        return ''

    def tag(m):
        t = m.group(1)
        mm = re.fullmatch(r'(.*)-[0-9a-f]+', t, re.I)
        symbol = mm.group(1) if mm else t
        if symbol and not currency(symbol):
            understood[0] = False
        return ''
    section = re.sub(r'"([^"]*)"', literal, section)
    section = re.sub(r'\[\$([^\]]*)\]', tag, section)
    section = re.sub(r'\[(?:Black|Blue|Cyan|Green|Magenta|Red|Yellow)\]', '', section, flags=re.I)
    section = re.sub(r'\\([$€£¥() +-])', r'\1', section)
    section = re.sub(r'[$€£¥₹₩\s]', '', section)
    if not understood[0] or re.search(r'["\\\[\]%]', section):
        return False
    if re.fullmatch(r'general', section, re.I):
        return True
    if value == 0 and re.fullmatch(r'-\?*', section):
        return True
    if index == 1:
        if section.startswith('-'):
            section = section[1:]
        elif section.startswith('(') and section.endswith(')'):
            section = section[1:-1]
        else:
            return False
    return re.fullmatch(r'(?:#*0+|#{1,3},##0)(?:\.[0#]+)?', section) is not None


def numeric_reference(fmt, value):
    """io.ts numericReference."""
    if not fmt or re.fullmatch(r'general', fmt, re.I):
        return js_number(value)
    if re.fullmatch(r'0+', fmt) and float(value).is_integer():
        if value >= 0:
            return js_number(value).rjust(len(fmt), '0')
        if fmt == '0':
            return js_number(value)
    return None


def transparent_text(fmt):
    """io.ts transparentTextFormat."""
    sections = fmt.split(';')
    if len(sections) < 4:
        return True
    if len(sections) != 4:
        return False
    s = re.sub(r'_.|\*.', '', sections[3])
    return re.sub(r'\[(?:Black|Blue|Cyan|Green|Magenta|Red|Yellow)\]', '', s, flags=re.I).strip() == '@'


def date_format(fmt):
    """ExcelJS utils.isDateFmt."""
    if not fmt:
        return False
    fmt = re.sub(r'\[[^\]]*]', '', fmt)
    fmt = re.sub(r'"[^"]*"', '', fmt)
    return re.search(r'[ymdhMsb]+', fmt) is not None


def excel_date(v, date1904):
    """ExcelJS utils.excelToDate, then io.ts's ISO day and time note."""
    ms = math.floor((v - 25569 + (1462 if date1904 else 0)) * 86400000 + 0.5)
    when = datetime(1970, 1, 1, tzinfo=timezone.utc) + timedelta(milliseconds=ms)
    return when.strftime('%Y-%m-%d'), bool(ms % 86400000)


# ------------------------------------------------------------------ parts --

def column_number(letters):
    n = 0
    for ch in letters:
        n = n * 26 + ord(ch) - 64
    return n


def address(ref):
    m = re.fullmatch(r'([A-Z]+)([1-9]\d*)', ref or '')
    return (int(m.group(2)), column_number(m.group(1))) if m else None


def local(tag):
    return tag.rsplit('}', 1)[-1]


def ns(tag):
    return tag[1:].split('}', 1)[0] if tag.startswith('{') else ''


def attrs(el):
    return {local(k): v for k, v in el.attrib.items()}


class Refused(Exception):
    def __init__(self, code, row, detail):
        super().__init__(f'{code} row {row}: {detail}')
        self.code, self.row, self.detail = code, row, detail


def core_properties(xml, renamed_core):
    """xlsx-namespaces.ts renamedCoreProperties leaves out a well formed part
    that holds only core properties, some under another prefix. Any other
    part goes to ExcelJS, which reads it leniently and refuses a start tag it
    does not know by its literal name (a malformed part with literal names
    reads; measured, cashbook-vs-reader-g16.json)."""
    if renamed_core:
        try:
            root = minidom.parseString(xml).documentElement
            known, renamed, stack = True, False, [root]
            while stack:
                el = stack.pop()
                literal = CORE_LITERAL.get((el.namespaceURI or '', el.localName))
                known = known and literal is not None
                renamed = renamed or (literal is not None and literal != el.tagName)
                stack.extend(c for c in el.childNodes if c.nodeType == c.ELEMENT_NODE)
            if known and renamed:
                return 'left out'
        except Exception:
            pass
    names = re.findall(r'<([A-Za-z_][\w.:-]*)', xml.decode('utf-8', 'replace'))
    unknown = sorted(set(names) - set(CORE_LITERAL.values()))
    if unknown:
        raise Refused('XLSX', 0, f'core properties ExcelJS does not read: {", ".join(unknown)[:80]}')
    return 'literal'


class Display:
    """xlsx-display.ts xlsxDisplayContext: styles, theme, sheet display facts."""

    def __init__(self, z):
        self.theme, self.indexed, self.fonts, self.fills = {}, [], [], []
        self.xfs, self.bases, self.formats = [], [], dict(DISPLAY_FORMATS)
        self.dxfs = []
        names = set(z.namelist())
        if 'xl/theme/theme1.xml' not in names:
            self.theme = {0: 'FFFFFF', 1: '000000'}
        else:
            root = ET.fromstring(z.read('xl/theme/theme1.xml'))
            for scheme in root.iter():
                if local(scheme.tag) != 'clrScheme':
                    continue
                for slot in scheme:
                    if local(slot.tag) in THEME_SLOTS:
                        for c in slot:
                            if local(c.tag) in ('srgbClr', 'sysClr'):
                                a = attrs(c)
                                self.theme[THEME_SLOTS.index(local(slot.tag))] = (
                                    a.get('lastClr') if local(c.tag) == 'sysClr' else a.get('val'))
        self.styled = 'xl/styles.xml' in names
        if self.styled:
            root = ET.fromstring(z.read('xl/styles.xml'))
            for child in root:
                name = local(child.tag)
                if name == 'fonts':
                    for f in child:
                        font = {}
                        for p in f:
                            if local(p.tag) == 'color':
                                font['color'] = attrs(p)
                            if local(p.tag) == 'sz':
                                font['size'] = float(attrs(p).get('val', 'nan'))
                        self.fonts.append(font)
                if name == 'fills':
                    for f in child:
                        fill = {'type': 'pattern', 'pattern': 'none'}
                        for p in f:
                            if local(p.tag) == 'patternFill':
                                fill['pattern'] = attrs(p).get('patternType', 'none')
                                for q in p:
                                    if local(q.tag) == 'fgColor':
                                        fill['fgColor'] = attrs(q)
                            if local(p.tag) == 'gradientFill':
                                fill = {'type': 'gradient'}
                        self.fills.append(fill)
                if name == 'cellXfs':
                    self.xfs = [attrs(x) for x in child if local(x.tag) == 'xf']
                if name == 'cellStyleXfs':
                    self.bases = [attrs(x) for x in child if local(x.tag) == 'xf']
                if name == 'numFmts':
                    for x in child:
                        a = attrs(x)
                        self.formats[int(a['numFmtId'])] = a.get('formatCode')
                if name == 'colors':
                    for x in child.iter():
                        if local(x.tag) == 'rgbColor':
                            self.indexed.append(attrs(x).get('rgb'))
                if name == 'dxfs':
                    self.dxfs = list(child)
        self.styles = [self._raw(xf) for xf in self.xfs]

    def _raw(self, xf):
        base = self.bases[int(xf.get('xfId', 0))] if int(xf.get('xfId', 0)) < len(self.bases) else None
        off = lambda k: xf.get(k) in ('0', 'false')  # noqa: E731
        font_id = int((base or {}).get('fontId', 0)) if off('applyFont') else int(xf.get('fontId', (base or {}).get('fontId', 0)))
        fill_id = int((base or {}).get('fillId', 0)) if off('applyFill') else int(xf.get('fillId', (base or {}).get('fillId', 0)))
        fmt_id = int((base or {}).get('numFmtId', 0)) if off('applyNumberFormat') else int(xf.get('numFmtId', (base or {}).get('numFmtId', 0)))
        font = self.fonts[font_id] if font_id < len(self.fonts) else None
        fill = self.fills[fill_id] if fill_id < len(self.fills) else None
        fmt = self.formats.get(fmt_id, '[unsupported]')
        any_off = off('applyFont') or off('applyFill') or off('applyNumberFormat')
        return {'font': font, 'fill': fill, 'format': fmt,
                'valid': font is not None and fill is not None and (not any_off or base is not None)}

    def effective(self, sheet, row, column, ref):
        index = sheet['cellStyles'].get(ref, sheet['rowStyles'].get(row, sheet['columnStyles'].get(column, 0)))
        if not self.styled:
            return {'font': None, 'fill': None, 'format': None, 'valid': True}
        return self.styles[index] if index < len(self.styles) else \
            {'font': None, 'fill': None, 'format': None, 'valid': False}

    def rgb(self, color, fallback):
        if color is None:
            return fallback
        if color.get('rgb') is not None:
            return color['rgb']
        if color.get('theme') is not None:
            base = self.theme.get(int(color['theme']))
            tint = color.get('tint')
            if tint is None or float(tint) == 0:
                return base
            tint = float(tint)
            if not base or not math.isfinite(tint) or tint < -1 or tint > 1:
                return None
            out = ''
            for i in (0, 2, 4):
                ch = int(base[-6:][i:i + 2], 16)
                v = ch * (1 + tint) if tint < 0 else ch * (1 - tint) + 255 * tint
                out += format(math.floor(v + 0.5), '02x')
            return out
        if color.get('indexed') is not None:
            i = int(color['indexed'])
            if self.indexed:
                return self.indexed[i][-6:] if i < len(self.indexed) and self.indexed[i] else None
            return INDEXED[i] if i < len(INDEXED) else '000000' if i == 64 else 'FFFFFF' if i == 65 else None
        if color.get('auto') in ('1', 'true'):
            return fallback
        return None

    @staticmethod
    def luminance(value):
        if not value or not re.fullmatch(r'(?:FF)?[0-9A-F]{6}', value, re.I):
            return None
        channels = []
        for i in (0, 2, 4):
            n = int(value[-6:][i:i + 2], 16) / 255
            channels.append(n / 12.92 if n <= 0.04045 else ((n + 0.055) / 1.055) ** 2.4)
        return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]

    def visible(self, font, fill):
        if font and 'size' in font and (not math.isfinite(font['size']) or font['size'] <= 0):
            return False
        background = 'FFFFFF'
        if fill:
            if fill.get('type') != 'pattern':
                return False
            if fill['pattern'] not in ('none', 'gray125'):
                if fill['pattern'] != 'solid':
                    return False
                color = self.rgb(fill.get('fgColor'), background)
                if not color:
                    return False
                background = color
        fore = self.luminance(self.rgb((font or {}).get('color'), '000000'))
        back = self.luminance(background)
        if fore is None or back is None:
            return False
        return (max(fore, back) + 0.05) / (min(fore, back) + 0.05) >= 3

    @staticmethod
    def format_font(font, fmt, value):
        sections = (fmt or '').split(';')
        if isinstance(value, float):
            i = 1 if value < 0 and len(sections) > 1 else 2 if value == 0 and len(sections) > 2 else 0
            section = sections[i]
        else:
            section = sections[0] if len(sections) == 1 and '@' in sections[0] else (
                sections[3] if len(sections) > 3 else None)
        m = re.search(r'\[(Black|White|Blue|Cyan|Green|Magenta|Red|Yellow|Color\d+)\]', section or '', re.I)
        if not m:
            return font
        names = {'black': '000000', 'white': 'FFFFFF', 'blue': '0000FF', 'cyan': '00FFFF',
                 'green': '00FF00', 'magenta': 'FF00FF', 'red': 'FF0000', 'yellow': 'FFFF00'}
        name = names.get(m.group(1).lower())
        return {**(font or {}), 'color': {'rgb': f'FF{name}' if name else '[unsupported]'}}


# ------------------------------------------------------------------ check --

def read_workbook(path, renamed_core=True):
    """The one-sheet grid the product reads, with what io.ts records per cell."""
    data = Path(path).read_bytes()
    if len(data) > MAX_FILE:
        raise Refused('XLSX', 0, 'over 8 MB')
    z = zipfile.ZipFile(path)
    infos = z.infolist()
    if len(infos) > 1000 or sum(i.file_size for i in infos) > 32 * 1024 * 1024:
        raise Refused('XLSX', 0, 'archive over the supported size')
    if any(re.search(r'vbaProject|externalLinks', i.filename, re.I) for i in infos):
        raise Refused('XLSX', 0, 'macros or external links')
    for i in infos:
        if i.filename.endswith(('.xml', '.rels')) and b'<!DOCTYPE' in z.read(i.filename):
            raise Refused('XLSX', 0, f'DTD in {i.filename}')
    exercised = {}
    if 'docProps/core.xml' in z.namelist():
        exercised['coreProperties'] = core_properties(z.read('docProps/core.xml'), renamed_core)
    workbook = ET.fromstring(z.read('xl/workbook.xml'))
    if ns(workbook.tag) != MAIN:
        raise Refused('XLSX', 0, 'workbook outside SpreadsheetML')
    date1904 = any(local(e.tag) == 'workbookPr' and attrs(e).get('date1904') in ('1', 'true')
                   for e in workbook.iter())
    sheets = [attrs(e) for e in workbook.iter() if local(e.tag) == 'sheet']
    rels = {attrs(e).get('Id'): attrs(e).get('Target') for e in ET.fromstring(
        z.read('xl/_rels/workbook.xml.rels')).iter() if local(e.tag) == 'Relationship'}
    shared = []
    if 'xl/sharedStrings.xml' in z.namelist():
        for si in ET.fromstring(z.read('xl/sharedStrings.xml')):
            runs = [r for r in si if local(r.tag) == 'r']
            if runs:
                shared.append({'rich': [(''.join(t.text or '' for t in r if local(t.tag) == 't'),
                                         next((attrs(c) for p in r if local(p.tag) == 'rPr'
                                               for c in p if local(c.tag) == 'color'), None))
                                        for r in runs]})
            else:
                shared.append(''.join(t.text or '' for t in si if local(t.tag) == 't'))
    display = Display(z)
    if len(sheets) != 1:
        return {'sheets': len(sheets), 'exercised': exercised}
    target = rels[sheets[0].get('id')]
    part = target.lstrip('/') if target.startswith('/') else 'xl/' + target
    root = ET.fromstring(z.read(part))
    sheet = {'hidden': sheets[0].get('state', 'visible') != 'visible', 'cellStyles': {}, 'rowStyles': {},
             'columnStyles': {}, 'hiddenColumns': set(), 'zeroColumns': set(), 'positiveColumns': set(),
             'zeroDefaultColumns': False, 'hideZeros': False, 'hiddenRows': [], 'merges': [],
             'conditional': []}
    cells, row_count, column_count = {}, 0, 0
    for e in root.iter():
        name, a = local(e.tag), attrs(e)
        if name == 'sheetFormatPr':
            sheet['zeroDefaultColumns'] = a.get('defaultColWidth') is not None and float(a['defaultColWidth']) == 0
        if name == 'sheetView' and a.get('showZeros') is not None and a['showZeros'] not in ('1', 'true'):
            sheet['hideZeros'] = True
        if name == 'col':
            for c in range(max(1, int(a['min'])), min(100, int(a['max'])) + 1):
                if a.get('style') is not None:
                    sheet['columnStyles'][c] = int(a['style'])
                if a.get('width') is not None and float(a['width']) == 0:
                    sheet['zeroColumns'].add(c)
                elif a.get('width') is not None and float(a['width']) > 0:
                    sheet['positiveColumns'].add(c)
                    sheet['zeroColumns'].discard(c)
                if a.get('hidden') in ('1', 'true'):
                    sheet['hiddenColumns'].add(c)
        if name == 'row':
            r = int(a['r'])
            row_count = max(row_count, r)
            if a.get('s') is not None:
                sheet['rowStyles'][r] = int(a['s'])
            if a.get('hidden') in ('1', 'true'):
                sheet['hiddenRows'].append(r)
        if name == 'c':
            r, c = address(a.get('r'))
            column_count, row_count = max(column_count, c), max(row_count, r)
            if a.get('s') is not None:
                sheet['cellStyles'][a['r']] = int(a['s'])
            v = next((x.text for x in e if local(x.tag) == 'v'), None)
            f = next((x for x in e if local(x.tag) == 'f'), None)
            inline = next((x for x in e if local(x.tag) == 'is'), None)
            cells[(r, c)] = {'t': a.get('t', 'n'), 'v': v, 'f': f is not None, 'is': inline, 's': a.get('s')}
        if name == 'mergeCell':
            first, _, last = a['ref'].partition(':')
            sheet['merges'].append((address(first), address(last or first)))
        if name == 'conditionalFormatting':
            sheet['conditional'].append(a.get('sqref', ''))
    return {'sheets': 1, 'z': z, 'display': display, 'sheet': sheet, 'cells': cells, 'shared': shared,
            'rows': row_count, 'columns': column_count, 'date1904': date1904, 'exercised': exercised}


def value_of(book, cell, numfmt):
    """ExcelJS's cell value: ('null'|'string'|'rich'|'number'|'date'|'bool'|'error'|'formula', value)."""
    t, v = cell['t'], cell['v']
    if cell['f']:
        return 'formula', v
    if t == 's' and v is not None:
        if not re.fullmatch(r'\d+', v.strip()) or int(v) >= len(book['shared']):
            raise Refused('XLSX', 0, f'shared string index {v!r}')
        item = book['shared'][int(v)]
        return ('rich', item['rich']) if isinstance(item, dict) else ('string', item)
    if t == 'inlineStr' and cell['is'] is not None:
        runs = [r for r in cell['is'] if local(r.tag) == 'r']
        if runs:
            return 'rich', [(''.join(x.text or '' for x in r if local(x.tag) == 't'), None) for r in runs]
        return 'string', ''.join(x.text or '' for x in cell['is'] if local(x.tag) == 't')
    if t == 'str':
        return 'string', v or ''
    if t == 'b':
        return 'bool', v in ('1', 'true')
    if t == 'e':
        return 'error', v
    if v is None:
        return 'null', None
    if len(v) > 4096 or not re.fullmatch(r'[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?', v, re.I) \
            or not math.isfinite(float(v)):
        raise Refused('XLSX', 0, f'number {v!r} the reader refuses')
    number = float(v)
    if date_format(numfmt):
        return 'date', number
    return 'number', number


def issues_of(book, r, c):
    """io.ts: the issues, reference issues and text it records for one cell."""
    display, sheet, cell = book['display'], book['sheet'], book['cells'].get((r, c))
    ref = f'{chr(64 + c)}{r}' if c <= 26 else None
    issues, reference = [], []
    style_index = int(cell['s']) if cell and cell['s'] is not None else None
    # ExcelJS's numFmt: the cell's own style, by the formats ExcelJS knows.
    numfmt = None
    if style_index is not None and style_index < len(display.xfs):
        fid = int(display.xfs[style_index].get('numFmtId', 0))
        numfmt = display.formats.get(fid) if fid in display.formats and fid not in DISPLAY_FORMATS \
            else EXCELJS_FORMATS.get(fid)
    kind, value = value_of(book, cell, numfmt) if cell else ('null', None)
    effective = display.effective(sheet, r, c, ref)
    fmt = effective['format'] if effective['format'] is not None else (numfmt or '')
    font = display.format_font(effective['font'], fmt, value if kind == 'number' else None)
    if kind != 'null':
        if c in sheet['zeroColumns'] or c in sheet['hiddenColumns'] or (
                sheet['zeroDefaultColumns'] and c not in sheet['positiveColumns']):
            issues.append('hidden column')
        if not effective['valid'] or not display.visible(font, effective['fill']):
            issues.append('unreadable font or fill')
        if kind == 'rich' and any(not display.visible({**(font or {}), **({'color': color} if color else {})},
                                                      effective['fill']) for _, color in value):
            issues.append('unreadable rich text')
        if sheet['hideZeros'] and kind == 'number' and value == 0:
            issues.append('zero hidden')
        if any(sheet['conditional']):
            # Conditional formats are not ported: any one on the sheet stops
            # the check, a stricter verdict than the product's (README).
            issues.append('conditional format (not ported)')
    plain = value if kind == 'string' else ''.join(t for t, _ in value) if kind == 'rich' else ''
    if plain and not transparent_text(fmt):
        issues.append('text format')
    for (r0, c0), (r1, c1) in sheet['merges']:
        if r0 <= r <= r1 and c0 <= c <= c1:
            issues.append('merged')
            break
    text = ''
    if kind == 'number':
        shown = numeric_reference(fmt, value)
        parsed = js_number(value).rjust(len(numfmt), '0') if (
            numfmt and re.fullmatch(r'0{2,}', numfmt) and value.is_integer() and value >= 0) else js_number(value)
        if shown is None or shown != parsed:
            reference.append('number format may rewrite an identifier')
        if not transparent_numeric(fmt, value):
            issues.append('number format')
        if not math.isfinite(value) or abs(value) >= 1e15:
            issues.append('number may lose digits')
        if cell['v'] and decimal_identity(cell['v']) != decimal_identity(js_number(float(cell['v']))):
            issues.append(PRECISION_NOTE)
        text = parsed
    elif kind == 'date':
        text, timed = excel_date(value, book['date1904'])
        if cell['v'] and decimal_identity(cell['v']) != decimal_identity(js_number(float(cell['v']))):
            issues.append(PRECISION_NOTE)
    elif kind == 'formula':
        issues.append('formula')
    elif kind == 'error':
        issues.append('Excel error')
        text = value or ''
    elif kind == 'rich':
        text = ''.join(t for t, _ in value)
    elif kind == 'string':
        text = value
    elif kind == 'bool':
        text = 'true' if value else 'false'
    if re.search('[\x00-\x08\x0b\x0c\x0e-\x1f￾￿]', text) or len(text) > MAX_TEXT:
        raise Refused('XLSX', r, 'cell text the reader refuses')
    return issues, reference, text, kind


def check(path, currency='SAR', typed_amounts=True, renamed_core=True):
    """The product's verdict on one cashbook, and what reading it needed."""
    out = {'refused': None, 'entries': [], 'exercised': {}, 'notes': {}}
    try:
        book = read_workbook(path, renamed_core)
        out['exercised'].update(book['exercised'])
        decimals = DECIMALS.get(currency)
        if decimals is None:
            raise Refused('SCOPE', 0, 'unknown currency')
        if book['sheets'] != 1 or book['columns'] != len(HEADERS):
            raise Refused('HEADER', 1, 'the first row must be the declared headers in order')
        grid = {}
        for r in range(1, book['rows'] + 1):
            for c in range(1, book['columns'] + 1):
                grid[(r, c)] = issues_of(book, r, c)
        if [grid[(1, c)][2].strip() for c in range(1, 7)] != HEADERS:
            raise Refused('HEADER', 1, 'the first row must be the declared headers in order')
        if book['sheet']['hiddenRows']:
            out['notes']['hiddenRows'] = sorted(book['sheet']['hiddenRows'])

        def recorded(at):
            if book['sheet']['hidden']:
                raise Refused('SHEET', at, 'hidden sheet')
            for k, name in enumerate(HEADERS):
                issues, reference, _, _ = grid[(at, k + 1)]
                found = issues + (reference if name in ('Voucher', 'Reference') else [])
                found = [i for i in found if not (name in ('Receipts', 'Payments') and i == PRECISION_NOTE)]
                if found:
                    raise Refused('CELL', at, f'{name}: {"; ".join(found)}')
        recorded(1)
        money = re.compile(rf'(\d+)\.(\d{{{decimals}}})' if decimals else r'(\d+)')
        typed = re.compile(rf'(\d+)(?:\.(\d{{1,{decimals}}}))?' if decimals else r'(\d+)')
        used = {'typedAmounts': 0, 'typedDates': 0, 'precisionNotes': 0}
        vouchers = set()
        for at in range(2, book['rows'] + 1):
            recorded(at)
            texts = [grid[(at, c)][2].strip() for c in range(1, 7)]
            if not any(texts):
                raise Refused('ROW', at, 'an empty row')

            def amount(c, name):
                s = texts[c - 1]
                if not s:
                    return 0
                numeric = grid[(at, c)][3] == 'number'
                if numeric:
                    used['typedAmounts'] += 1
                    used['precisionNotes'] += PRECISION_NOTE in grid[(at, c)][0]
                m = (typed if numeric and typed_amounts else money).fullmatch(s)
                if not m:
                    raise Refused('AMOUNT', at, f'{name} {s!r}')
                return int(m.group(1) + (m.group(2) or '').ljust(decimals, '0'))
            receipt, payment = amount(5, 'receipts'), amount(6, 'payments')
            if (receipt > 0) == (payment > 0):
                raise Refused('AMOUNT', at, 'one positive amount in Receipts or Payments')
            voucher = texts[1]
            if not voucher or voucher in vouchers:
                raise Refused('VOUCHER', at, 'a missing or repeated voucher')
            vouchers.add(voucher)
            used['typedDates'] += grid[(at, 1)][3] == 'date'
            m = re.fullmatch(r'(\d{4})-(\d{2})-(\d{2})', texts[0])
            try:
                ok = m is not None and datetime(int(m[1]), int(m[2]), int(m[3])).strftime('%Y-%m-%d') == texts[0]
            except ValueError:
                ok = False
            if not ok:
                raise Refused('DATE', at, repr(texts[0]))
            out['entries'].append({'id': voucher, 'row': at, 'date': texts[0], 'description': texts[2],
                                   'reference': texts[3], 'direction': 'in' if receipt else 'out',
                                   'amount': receipt or payment})
        out['exercised'].update({k: v for k, v in used.items() if v})
    except Refused as e:
        out['refused'] = {'code': e.code, 'row': e.row, 'detail': e.detail}
        out['entries'] = []
    return out


def main(argv=None):
    """python3 -B cashbook.py [--before-g8] [--before-g15] FILE.xlsx ... : JSON
    of each file's verdict, entries and exercised rules."""
    import argparse
    import json
    ap = argparse.ArgumentParser()
    ap.add_argument('files', nargs='+')
    ap.add_argument('--currency', default='SAR')
    ap.add_argument('--before-g8', action='store_true')
    ap.add_argument('--before-g15', action='store_true')
    a = ap.parse_args(argv)
    if drift():
        raise SystemExit(f'the product no longer carries what cashbook.py copies: {drift()}')
    print(json.dumps({f: check(f, a.currency, typed_amounts=not a.before_g8, renamed_core=not a.before_g15)
                      for f in a.files}, ensure_ascii=False))


if __name__ == '__main__':
    main()
