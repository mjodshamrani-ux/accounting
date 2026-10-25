"""The prepared PDF.js reading of a font's ToUnicode map, reproduced before
the seal.

The guarded reader takes a glyph's text from its font's ToUnicode map,
decoded by the UTF-16BE decoder that scripts/prepare-native-pdf.mjs writes
into PDF.js. PDF.js decodes every entry of the map as it loads the font,
when the page selects it (Tf), drawn or not:

  - an entry of odd length throws, the font becomes an ErrorFont, and the
    font guard refuses the page (pdf-font-integrity.ts);
  - a surrogate without its pair is U+FFFD (G14), and the reader refuses a
    page that shows U+FFFD (pdf.ts, layoutPdfPage); before G14 it threw as
    an odd length does (STRICT, kept to measure this module on G14).

The map is parsed as PDF.js parses it: bfchar and bfrange, a range's
destination raised by its last byte with the carry PDF.js makes, an array
range, and a hex string's lone last digit dropped. A malformed section is
skipped where PDF.js skips it. MuPDF and pdfminer read such maps their own
way, so verify.py cannot see a font PDF.js rejects (G14, DEV-62).

The codes a page draws are read from its content stream and those of the
forms it paints, by the font each Tf selects: two bytes for a Type0 font,
one for a simple font. Nothing is imported from the product; the decoder
and the refusal are checked against its source text (drift).
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
PREPARE = ROOT / 'scripts' / 'prepare-native-pdf.mjs'
PDF = ROOT / 'lib' / 'reconciliation' / 'pdf.ts'
REPLACEMENT = 0xFFFD
MAX_MAP_RANGE = 2 ** 24 - 1
# The decoder as prepare-native-pdf.mjs writes it since G14, and the reader's
# refusal of U+FFFD.
DECODER = ('if(t.length%2!==0)throw new FormatError$1(`Invalid ToUnicode UTF-16BE length`);let r=[];'
           'for(let e=0;e<t.length;e+=2){let n=t.charCodeAt(e)<<8|t.charCodeAt(e+1);if(n<55296||n>57343)'
           '{r.push(n);continue}let i=e+3<t.length?t.charCodeAt(e+2)<<8|t.charCodeAt(e+3):-1;'
           'if(n>56319||i<56320||i>57343){r.push(65533);continue}e+=2;r.push(((n&1023)<<10)+(i&1023)+65536)}')
REFUSAL = "t.text.includes('\\uFFFD')"
# Before G14 a surrogate without its pair threw as an odd length does.
STRICT = False

TOKEN = re.compile(rb'%[^\r\n]*|\((?:\\.|[^\\()]|\((?:\\.|[^\\()])*\))*\)|<<|>>|<[^<>]*>|\[|\]|\{|\}'
                   rb'|/[^\s()<>\[\]{}/%]*|[^\s()<>\[\]{}/%]+', re.S)
NUMBER = re.compile(rb'[+-]?(\d+\.?\d*|\.\d+)')
ESCAPES = {ord('n'): b'\n', ord('r'): b'\r', ord('t'): b'\t', ord('b'): b'\b', ord('f'): b'\f',
           ord('('): b'(', ord(')'): b')', ord('\\'): b'\\'}


class Unreadable(Exception):
    """An entry PDF.js's prepared decoder throws on: the font fails."""


def drift():
    """What this module copies from the product and its source no longer
    carries."""
    missing = []
    if DECODER not in PREPARE.read_text(encoding='utf-8'):
        missing.append('the ToUnicode decoder in prepare-native-pdf.mjs')
    if REFUSAL not in PDF.read_text(encoding='utf-8'):
        missing.append('the U+FFFD refusal in pdf.ts')
    return missing


def hex_bytes(token):
    """A hex string as PDF.js's lexer reads it: whitespace and stray
    characters skipped, a lone last digit dropped."""
    digits = [c for c in token[1:-1].decode('latin-1') if c in '0123456789abcdefABCDEF']
    return bytes(int(digits[i] + digits[i + 1], 16) for i in range(0, len(digits) - 1, 2))


def literal_bytes(token):
    body, out, i = token[1:-1], bytearray(), 0
    while i < len(body):
        c = body[i]
        if c != 0x5C:
            out.append(c)
            i += 1
            continue
        i += 1
        if i >= len(body):
            break
        c = body[i]
        if c in ESCAPES:
            out += ESCAPES[c]
            i += 1
        elif 0x30 <= c <= 0x37:
            octal = re.match(rb'[0-7]{1,3}', body[i:i + 3]).group()
            out.append(int(octal, 8) & 0xFF)
            i += len(octal)
        elif c in (0x0D, 0x0A):
            i += 2 if body[i:i + 2] == b'\r\n' else 1
        else:
            out.append(c)
            i += 1
    return bytes(out)


def objects(data):
    """The CMap's objects: ('str', bytes), ('int', n), ('cmd', name), ('name', n)."""
    for m in TOKEN.finditer(data):
        t = m.group()
        if t.startswith(b'%'):
            continue
        if t.startswith(b'<') and t not in (b'<<', b'>>'):
            yield 'str', hex_bytes(t)
        elif t.startswith(b'('):
            yield 'str', literal_bytes(t)
        elif t.startswith(b'/'):
            yield 'name', t[1:].decode('latin-1')
        elif NUMBER.fullmatch(t):
            yield ('int', int(t)) if re.fullmatch(rb'[+-]?\d+', t) else ('num', float(t))
        else:
            yield 'cmd', t.decode('latin-1')


def number(s):
    return int.from_bytes(s, 'big')


class Malformed(Exception):
    pass


def parse(data):
    """{code: destination} as PDF.js's CMap parser makes it, the destination
    a tuple of char codes, or an int where the map gives one."""
    found = {}
    stream = objects(data)

    def need(kind):
        obj = next(stream, None)
        if obj is None:
            return None
        if obj[0] != kind:
            raise Malformed(f'expected {kind}, got {obj}')
        return obj[1]

    def bfchar():
        while True:
            obj = next(stream, None)
            if obj is None or obj == ('cmd', 'endbfchar'):
                return
            if obj[0] != 'str':
                raise Malformed(f'bfchar {obj}')
            dst = need('str')
            if dst is None:
                return
            found[number(obj[1])] = tuple(dst)

    def bfrange():
        while True:
            obj = next(stream, None)
            if obj is None or obj == ('cmd', 'endbfrange'):
                return
            if obj[0] != 'str':
                raise Malformed(f'bfrange {obj}')
            low, high = number(obj[1]), number(need('str') or b'')
            dst = next(stream, None)
            if dst is None:
                return
            if dst[0] in ('int', 'str'):
                if high - low > MAX_MAP_RANGE:
                    raise Malformed('range above MAX_MAP_RANGE')
                # Char codes, as PDF.js keeps a string: one past 255 is kept.
                value = [dst[1]] if dst[0] == 'int' else list(dst[1])
                last = len(value) - 1
                while low <= high:
                    found[low] = tuple(value)
                    low += 1
                    # PDF.js raises the last code, and past 255 the one before
                    # it, setting the last to zero.
                    if value[last] + 1 > 255:
                        value = value[:max(last - 1, 0)] + [value[last - 1] + 1 if last else 0, 0]
                        continue
                    value = value[:last] + [value[last] + 1]
            elif dst == ('cmd', '['):
                array = []
                obj = next(stream, None)
                while obj is not None and obj != ('cmd', ']'):
                    array.append(obj)
                    obj = next(stream, None)
                if high - low > MAX_MAP_RANGE:
                    raise Malformed('range above MAX_MAP_RANGE')
                for kind, value in array:
                    if low > high:
                        break
                    found[low] = value if kind == 'int' else tuple(value) if kind == 'str' else ()
                    low += 1
            else:
                raise Malformed('invalid bf range')

    def skip(end):
        for obj in stream:
            if obj == ('cmd', end):
                return

    while True:
        obj = next(stream, None)
        if obj is None or obj == ('cmd', 'endcmap'):
            break
        try:
            if obj == ('cmd', 'beginbfchar'):
                bfchar()
            elif obj == ('cmd', 'beginbfrange'):
                bfrange()
            elif obj in (('cmd', 'begincidchar'), ('cmd', 'begincidrange'), ('cmd', 'begincodespacerange')):
                skip('end' + obj[1][len('begin'):])
        except Malformed:
            continue
    return found


def decode(dst, made=None):
    """The code points PDF.js's prepared decoder makes of a destination, or
    Unreadable; each U+FFFD it makes of a surrogate is noted in `made`."""
    if isinstance(dst, int):
        return [dst]
    if len(dst) % 2:
        raise Unreadable('odd length')
    units = [dst[i] << 8 | dst[i + 1] for i in range(0, len(dst), 2)]
    out, i = [], 0
    while i < len(units):
        n = units[i]
        if n < 0xD800 or n > 0xDFFF:
            out.append(n)
            i += 1
            continue
        pair = units[i + 1] if i + 1 < len(units) else -1
        if n > 0xDBFF or not 0xDC00 <= pair <= 0xDFFF:
            if STRICT:
                raise Unreadable('surrogate without its pair')
            out.append(REPLACEMENT)
            if made is not None:
                made.append(n)
            i += 1
            continue
        out.append(((n & 0x3FF) << 10) + (pair & 0x3FF) + 0x10000)
        i += 2
    return out


def font_map(doc, xref):
    """The font's map {code: ([code points], made)}, `made` true where the
    decoder made a U+FFFD of a surrogate; Unreadable; None without one."""
    kind, value = doc.xref_get_key(xref, 'ToUnicode')
    if kind != 'xref':
        return None
    out = {}
    for code, dst in parse(doc.xref_stream(int(value.split()[0]))).items():
        made = []
        out[code] = (decode(dst, made), bool(made))
    return out


def code_width(doc, xref):
    """Bytes per code: two for a Type0 font with an Identity encoding (or one
    whose CMap PDF.js would read so), one for a simple font."""
    return 2 if doc.xref_get_key(xref, 'Subtype')[1] == '/Type0' else 1


def string_bytes(token):
    if token.startswith(b'<'):
        return hex_bytes(token)
    return literal_bytes(token)


def drawn(doc, page):
    """[(font xref, code)] for every code the page's text shows, and the font
    xrefs it selects, its forms' included."""
    names = {}
    for xref, _, _, _, name, _, *referencer in page.get_fonts(full=True):
        names[(referencer[0] if referencer else 0, name)] = xref
    forms = {name: xref for xref, name, *_ in page.get_xobjects()}
    shown, selected = [], set()

    def walk(data, owner, depth=0):
        font, width, operands = None, 1, []
        for m in TOKEN.finditer(data):
            t = m.group()
            if t.startswith(b'%'):
                continue
            if t.startswith((b'(', b'<', b'/', b'[', b']')) and t not in (b'<<', b'>>') or NUMBER.fullmatch(t):
                operands.append(t)
                continue
            if t == b'Tf':
                name = next((o[1:].decode('latin-1') for o in reversed(operands) if o.startswith(b'/')), None)
                font = names.get((owner, name), names.get((0, name)))
                if font is not None:
                    selected.add(font)
                    width = code_width(doc, font)
            elif t in (b'Tj', b'TJ', b"'", b'"') and font is not None:
                for o in operands:
                    if o.startswith((b'(', b'<')) and o not in (b'<<', b'>>'):
                        s = string_bytes(o)
                        shown.extend((font, int.from_bytes(s[i:i + width], 'big'))
                                     for i in range(0, len(s) - width + 1, width))
            elif t == b'Do' and depth < 8:
                name = next((o[1:].decode('latin-1') for o in reversed(operands) if o.startswith(b'/')), None)
                if name in forms and doc.xref_get_key(forms[name], 'Subtype')[1] == '/Form':
                    walk(doc.xref_stream(forms[name]), forms[name], depth + 1)
            operands = []
    walk(b'\n'.join(doc.xref_stream(x) for x in page.get_contents()), 0)
    return shown, selected


def check_page(doc, pno, lone=None):
    """What the reader would refuse on the page for its fonts' maps; and, in
    the set `lone`, each font that loads only because a surrogate without its
    pair is read as U+FFFD, no glyph showing one (G14)."""
    lone = set() if lone is None else lone
    found = []
    shown, selected = drawn(doc, doc[pno])
    for xref in sorted(selected):
        name = doc.xref_get_key(xref, 'BaseFont')[1].lstrip('/').split('+')[-1]
        try:
            points = font_map(doc, xref)
        except Unreadable as reason:
            found.append({'font': name, 'unreadable': str(reason)})
            continue
        if points is None:
            continue
        replaced = {code for code, (p, _) in points.items() if REPLACEMENT in p}
        bad = sorted(replaced & {code for font, code in shown if font == xref})
        if bad:
            found.append({'font': name, 'shows': f'{bad[0]:04X}', 'as': 'U+FFFD'})
        elif any(made for _, made in points.values()):
            lone.add(name)
    return found
