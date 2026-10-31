"""Independent check of the closing reconciliation sheet in a bank statement
workbook (proposed bank-reconciliation-sheet-1). Standard library only.

  python3 -B audit/bank-sheet-foundation/check_export.py < request.json

  request: {"frozen": path, "selfTest": [story ids],
            "exports": [{"story", "path"}]}

The workbook is read from its OOXML parts directly, never by the product, and
held against the sealed package (EXPECTED.json, stories.json) and
contract.json, never against the product's own output. The first sheet must
be the reconciliation, named and laid out right to left for the story's
language, with no formula anywhere in it. Column A holds a fixed key per row.
For a sheet: the status, currency and period; the bank balance with its page
and the declared book balance with its note; each section in the contract's
order with its total and its items, every field as EXPECTED.json has it, the
period as the facts print it, each amount as an integer and as text in major
units with its sign; the adjusted balances and the difference, also
recomputed from the sheet's own cells; each sign-off with its name, date and
standing. For a refusal: its code and no item. Every label in column B is in
the story's language (Arabic script, or none of it).

selfTest names stories whose parsed sheets are then altered (an item's sign,
a dropped item, an origin, the difference, its text, the status, a sign-off's
standing, the note, the direction, the name, a formula, a label's language, a
refusal code, the bank page); each alteration must be caught wherever it
applies, and each must apply somewhere, or the checker itself has failed.
"""
import copy
import io
import json
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree

HERE = Path(__file__).resolve().parent
M = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
P = 'http://schemas.openxmlformats.org/package/2006/relationships'
FAMILY = 'bank-reconciliation-sheet-1'
NAMES = {'ar': 'التسوية', 'en': 'Reconciliation'}
ARABIC = re.compile('[\u0600-\u06ff]')
# ISO 4217 minor units of the currencies a sealed story may use.
DECIMALS = {'SAR': 2, 'USD': 2, 'EUR': 2, 'AED': 2, 'KWD': 3, 'BHD': 3, 'OMR': 3, 'JOD': 3}


class CheckError(Exception):
    pass


def need(ok, what):
    if not ok:
        raise CheckError(what)


def xstring(text):
    """OOXML ST_Xstring: _xHHHH_ stands for that character."""
    return re.sub(r'_x([0-9A-Fa-f]{4})_', lambda m: chr(int(m.group(1), 16)), text)


def first_sheet(data):
    """The workbook's first sheet: its name, whether it reads right to left,
    whether any cell holds a formula, and its rows of strings."""
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        book = ElementTree.fromstring(z.read('xl/workbook.xml'))
        rels = {r.get('Id'): r.get('Target') for r in
                ElementTree.fromstring(z.read('xl/_rels/workbook.xml.rels')).iter(f'{{{P}}}Relationship')}
        shared = []
        if 'xl/sharedStrings.xml' in z.namelist():
            for si in ElementTree.fromstring(z.read('xl/sharedStrings.xml')).findall(f'{{{M}}}si'):
                shared.append(xstring(''.join(t.text or '' for t in si.iter(f'{{{M}}}t'))))
        s = book.find(f'{{{M}}}sheets').findall(f'{{{M}}}sheet')[0]
        target = rels[s.get(f'{{{R}}}id')].lstrip('/')
        sheet = ElementTree.fromstring(z.read(target if target.startswith('xl/') else f'xl/{target}'))
        views = sheet.find(f'{{{M}}}sheetViews')
        rtl = views is not None and any(v.get('rightToLeft') in ('1', 'true') for v in views)
        rows = []
        for row in sheet.find(f'{{{M}}}sheetData').findall(f'{{{M}}}row'):
            need(int(row.get('r')) == len(rows) + 1, 'a row of the sheet is missing')
            cells = {}
            for c in row.findall(f'{{{M}}}c'):
                col = 0
                for ch in c.get('r'):
                    if ch.isalpha():
                        col = col * 26 + ord(ch.upper()) - 64
                kind, v = c.get('t'), c.find(f'{{{M}}}v')
                if kind == 's':
                    cells[col] = shared[int(v.text)]
                elif kind == 'inlineStr':
                    cells[col] = xstring(''.join(t.text or '' for t in c.iter(f'{{{M}}}t')))
                else:
                    cells[col] = v.text if v is not None and v.text is not None else ''
            rows.append([cells.get(i, '') for i in range(1, (max(cells) if cells else 0) + 1)])
        return {'name': s.get('name'), 'rtl': rtl, 'formula': sheet.find(f'.//{{{M}}}f') is not None, 'rows': rows}


def integer(text, what):
    need(re.fullmatch(r'-?\d+', text or '') is not None, f'{what}: {text!r} is not an integer')
    return int(text)


def major(minor, decimals):
    sign = '-' if minor < 0 else ''
    digits = str(abs(minor)).rjust(decimals + 1, '0')
    return f'{sign}{digits[:-decimals]}.{digits[-decimals:]}' if decimals else f'{sign}{digits}'


def cell(row, col):
    return row[col - 1] if len(row) >= col else ''


def money(row, what, minor, decimals):
    """Columns C (text) and D (integer) of a row hold this amount."""
    need(integer(cell(row, 4), what) == minor, f'{what}: {cell(row, 4)} != {minor}')
    need(cell(row, 3) == major(minor, decimals), f'{what}: text {cell(row, 3)!r} != {major(minor, decimals)!r}')


def check(parsed, case, expected, story, contract):
    want = expected['stories'][case['story']]
    language = story['language']
    need(parsed['name'] == NAMES[language], f"first sheet {parsed['name']!r}, not the {language} reconciliation")
    need(parsed['rtl'] == (language == 'ar'), f"right to left is {parsed['rtl']} for {language}")
    need(not parsed['formula'], 'a formula in the reconciliation sheet')
    rows = parsed['rows']
    keys = [cell(r, 1) for r in rows]
    for r in rows:
        label = cell(r, 2)
        if label and cell(r, 1) not in ('headers',):
            need(bool(ARABIC.search(label)) == (language == 'ar'), f'label {label!r} is not in {language}')
    by = {}
    for r in rows:
        by.setdefault(cell(r, 1), []).append(r)
    need(keys[0] == 'family' and cell(rows[0], 3) == FAMILY, 'the sheet does not name its family first')
    need(keys.count('claim') == 1, 'no claim row')
    signed = {k: by.get(k, []) for k in ('prepared', 'reviewed')}
    if want['refusal']:
        need(len(by.get('refusal', [])) == 1 and cell(by['refusal'][0], 4) == want['refusal'],
             f"refusal {[cell(r, 4) for r in by.get('refusal', [])]} != {want['refusal']}")
        need('item' not in by and 'status' not in by, 'a refused sheet lists a status or items')
        return
    need('refusal' not in by, 'a sheet with a refusal row')
    periods = {p['id'].split('-')[1]: p['statement']['period'] for p in story['periods']}
    decimals = DECIMALS[want['currency']]
    one = lambda key: (need(len(by.get(key, [])) == 1, f'{key} rows: {len(by.get(key, []))}'), by[key][0])[1]  # noqa: E731
    need(cell(one('status'), 4) == want['status'], f"status {cell(one('status'), 4)} != {want['status']}")
    need(cell(one('currency'), 3) == want['currency'], 'currency')
    need([cell(one('period'), 3), cell(one('period'), 4)] == [want['period']['start'], want['period']['end']], 'period')
    money(one('bank'), 'bank', want['bank']['balance'], decimals)
    need(re.search(rf"(?<!\d){want['bank']['page']}(?!\d)", cell(one('bank'), 5)) is not None, 'bank page')
    money(one('book'), 'book', want['book']['balance'], decimals)
    need(cell(one('note'), 3) == want['book']['note'], f"note {cell(one('note'), 3)!r}")
    # Sections in the contract's order, each followed by its items.
    order = list(contract['sheet']['sections'])[:4]
    section_rows = [i for i, k in enumerate(keys) if k == 'section']
    need([cell(rows[i], 5) for i in section_rows] == order, f"sections {[cell(rows[i], 5) for i in section_rows]}")
    totals = {}
    for n, i in enumerate(section_rows):
        name = order[n]
        end = section_rows[n + 1] if n + 1 < len(section_rows) else keys.index('adjustedBank')
        items = rows[i + 1:end]
        need(all(cell(r, 1) == 'item' for r in items), f'{name}: a row that is not an item')
        listed = want['sections'][name]['items']
        need(len(items) == len(listed), f'{name}: {len(items)} items, {len(listed)} expected')
        for r, w in zip(items, listed):
            what = f"{name} {w['item']}"
            p = periods[w['period']]
            need(cell(r, 3) == w['id'], f'{what}: id {cell(r, 3)}')
            need(cell(r, 4) == f"{p['start']}/{p['end']}", f'{what}: period {cell(r, 4)}')
            need(integer(cell(r, 5), what) == (w['page'] if w['side'] == 'statement' else w['row']), f'{what}: place')
            need(cell(r, 6) == w['date'], f'{what}: date')
            need(cell(r, 7) == w['reference'], f'{what}: reference {cell(r, 7)!r}')
            need(integer(cell(r, 9), what) == w['amount'], f'{what}: amount {cell(r, 9)}')
            need(cell(r, 8) == major(w['amount'], decimals), f'{what}: amount text {cell(r, 8)!r}')
            need(cell(r, 11) == w['origin'], f'{what}: origin {cell(r, 11)}')
            need(bool(cell(r, 12)) == (w['reason'] is not None), f'{what}: case')
            need(cell(r, 13) == (w['reason'] or ''), f'{what}: reason {cell(r, 13)}')
            need(cell(r, 14) == ('' if w['age'] is None else str(w['age'])), f'{what}: age {cell(r, 14)}')
            need(cell(r, 15) == w['source'], f'{what}: source')
        money(rows[i], f'{name} total', want['sections'][name]['total'], decimals)
        totals[name] = sum(integer(cell(r, 9), name) for r in items)
        need(totals[name] == want['sections'][name]['total'], f'{name}: items do not add to the total')
    for key in ('adjustedBank', 'adjustedBook', 'difference'):
        money(one(key), key, want[key], decimals)
    # The sheet's own cells, recomputed.
    bank = integer(cell(one('bank'), 4), 'bank')
    book = integer(cell(one('book'), 4), 'book')
    adjusted_bank = bank + totals[order[0]] - totals[order[1]]
    adjusted_book = book + totals[order[2]] - totals[order[3]]
    need(integer(cell(one('adjustedBank'), 4), 'adjusted') == adjusted_bank, 'adjusted bank does not add up')
    need(integer(cell(one('adjustedBook'), 4), 'adjusted') == adjusted_book, 'adjusted book does not add up')
    need(integer(cell(one('difference'), 4), 'difference') == adjusted_bank - adjusted_book, 'difference does not add up')
    for kind, rows_of in signed.items():
        w = want['signoffs'][kind]
        if w is None:
            need(not rows_of, f'{kind}: a sign-off row without a sign-off')
            continue
        need(len(rows_of) == 1, f'{kind}: {len(rows_of)} rows')
        r = rows_of[0]
        need([cell(r, 3), cell(r, 4)] == [w['name'], w['date']], f'{kind}: name or date')
        need(cell(r, 6) == ('valid' if w['valid'] else 'void'), f"{kind}: standing {cell(r, 6)}")


def alterations():
    def rows_with(key):
        return lambda p: [r for r in p['rows'] if cell(r, 1) == key]

    def at(key, col, change):
        def apply(p):
            found = rows_with(key)(p)
            if not found or len(found[0]) < col:
                return False
            found[0][col - 1] = change(found[0][col - 1])
            return True
        return apply

    def drop_item(p):
        for i, r in enumerate(p['rows']):
            if cell(r, 1) == 'item':
                del p['rows'][i]
                return True
        return False

    def flip(key):
        def apply(p):
            p[key] = not p[key]
            return True
        return apply

    def relabel(p):
        for r in p['rows']:
            if cell(r, 1) == 'status' and len(r) >= 2:
                r[1] = 'Status' if ARABIC.search(r[1]) else 'الحالة'
                return True
        return False
    return {
        'item-sign': at('item', 9, lambda v: str(-int(v)) if v not in ('', '0') else '1'),
        'item-dropped': drop_item,
        'item-origin': at('item', 11, lambda v: 'carried' if v != 'carried' else 'unmatched'),
        'item-reference': at('item', 7, lambda v: v + 'X'),
        'difference': at('difference', 4, lambda v: str(int(v) + 1)),
        'difference-text': at('difference', 3, lambda v: v[1:] if v.startswith('-') else '-' + v),
        'status': at('status', 4, lambda v: 'reconciled' if v != 'reconciled' else 'difference'),
        'signoff-standing': at('prepared', 6, lambda v: 'void' if v == 'valid' else 'valid'),
        'book-note': at('note', 3, lambda v: v + ' (edited)'),
        'direction': flip('rtl'),
        'formula': lambda p: (p.__setitem__('formula', True), True)[1],
        'name': lambda p: (p.__setitem__('name', 'Summary'), True)[1],
        'label-language': relabel,
        'refusal-code': at('refusal', 4, lambda v: 'SHEET_NO_BOOK_BALANCE' if v != 'SHEET_NO_BOOK_BALANCE' else 'SHEET_STATEMENT_HELD'),
        'bank-page': at('bank', 5, lambda v: re.sub(r'\d+', lambda m: str(int(m.group()) + 1), v)),
    }


def main():
    request = json.load(sys.stdin)
    frozen = Path(request['frozen'])
    expected = json.loads((frozen / 'EXPECTED.json').read_text(encoding='utf-8'))
    facts = json.loads((frozen / 'stories.json').read_text(encoding='utf-8'))
    contract = json.loads((HERE / 'contract.json').read_text(encoding='utf-8'))
    stories = {s['id']: s for s in facts['stories']}
    parsed = {}
    for case in request['exports']:
        sheet = first_sheet(Path(case['path']).read_bytes())
        check(sheet, case, expected, stories[case['story']], contract)
        parsed[case['path']] = (case, sheet)
    report = {'checked': len(parsed), 'selfTest': {}}
    for story_id in request.get('selfTest', []):
        case, sheet = next((c, s) for c, s in parsed.values() if c['story'] == story_id)
        for name, change in alterations().items():
            altered = copy.deepcopy(sheet)
            if not change(altered):
                continue
            try:
                check(altered, case, expected, stories[story_id], contract)
            except CheckError:
                report['selfTest'].setdefault(name, []).append(story_id)
                continue
            raise SystemExit(f'self-test: {name} on {story_id} was not caught')
    missing = set(alterations()) - set(report['selfTest'])
    if request.get('selfTest') and missing:
        raise SystemExit(f'self-test: never applied {sorted(missing)}')
    print(json.dumps(report, sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except CheckError as error:
        raise SystemExit(f'check failed: {error}')
