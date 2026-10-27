"""Independent check of a bank statement workbook whose cashbook was read
with columns (bank-cashbook-map-1, proposed), or with the declared ones.
Standard library only.

  python3 -B audit/bank-map-foundation/check_export.py < request.json

  request: {"frozen": path, "selfTest": [labels],
            "exports": [{"label", "story", "action", "path", "cashbook"}]}

The columns each workbook must name are derived here from the sealed facts:
a choice by hand from the action, with the header labels its own file holds
(read by the reader of the package's own sealed verify.py: this
foundation's, or a holdout's); a saved map from the story's earlier save or
imported map file.

Each workbook is read from its OOXML parts directly, never by the product,
and held against the sealed package (EXPECTED.json, the frozen and sealed
files), never against the product's own output:

- the Cashbook columns sheet is present exactly when the action reads with
  columns, and holds the header row, each role's column letter and label,
  the rows above the header and every labelled column not read, as the
  oracle states them;
- the Cashbook sheet holds the oracle's entries, row by row: voucher, source
  row, date, description, reference, direction and amount;
- the Cases sheet holds the oracle's cases for the period, with their kind,
  reason, status and exact members;
- the cashbook reassembled from the Sources sheet is the file the action
  read, byte for byte.

selfTest names exports whose parsed sheets are then altered (a label, a
column letter, the columns sheet dropped, an entry's amount or row, a case
member, a status, a source byte); each alteration must be caught wherever
it applies, and each must apply somewhere, or the checker itself has failed.
"""
import base64
import copy
import importlib.util
import hashlib
import io
import json
import re
import sys
import unicodedata
import zipfile
from pathlib import Path
from xml.etree import ElementTree

M = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
P = 'http://schemas.openxmlformats.org/package/2006/relationships'
ROLES = ['date', 'voucher', 'description', 'reference', 'receipts', 'payments']
# The product names two statuses as the sealed ROLL-1 oracle does not.
STATUS = {'matched-automatic': 'matched', 'matched-accepted': 'accepted'}
NAMES = ['Cashbook', 'Cashbook columns', 'Cases', 'Sources']
HERE = Path(__file__).resolve().parent
_readers = {}


def reader(frozen):
    """The sealed verification of the package under check, whose reader
    gives the header labels: frozen/../verify.py."""
    if frozen not in _readers:
        spec = importlib.util.spec_from_file_location(f'map_verify_{len(_readers)}', frozen.parent / 'verify.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        _readers[frozen] = module
    return _readers[frozen]


class CheckError(Exception):
    pass


def need(ok, what):
    if not ok:
        raise CheckError(what)


def xstring(text):
    """OOXML ST_Xstring: _xHHHH_ stands for that character."""
    return re.sub(r'_x([0-9A-Fa-f]{4})_', lambda m: chr(int(m.group(1), 16)), text)


def letters(column):
    s = ''
    while column:
        column, k = divmod(column - 1, 26)
        s = chr(65 + k) + s
    return s


def sheets(data):
    """The sheets this check reads, each as rows of strings keyed by its
    header row, and the names of every sheet."""
    out, names = {}, []
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        book = ElementTree.fromstring(z.read('xl/workbook.xml'))
        rels = {r.get('Id'): r.get('Target') for r in
                ElementTree.fromstring(z.read('xl/_rels/workbook.xml.rels')).iter(f'{{{P}}}Relationship')}
        shared = []
        if 'xl/sharedStrings.xml' in z.namelist():
            for si in ElementTree.fromstring(z.read('xl/sharedStrings.xml')).findall(f'{{{M}}}si'):
                shared.append(xstring(''.join(t.text or '' for t in si.iter(f'{{{M}}}t'))))
        for s in book.find(f'{{{M}}}sheets').findall(f'{{{M}}}sheet'):
            names.append(s.get('name'))
            if s.get('name') not in NAMES:
                continue
            target = rels[s.get(f'{{{R}}}id')].lstrip('/')
            sheet = ElementTree.fromstring(z.read(target if target.startswith('xl/') else f'xl/{target}'))
            need(sheet.find(f'.//{{{M}}}f') is None, f'{s.get("name")}: a formula')
            rows = []
            for row in sheet.find(f'{{{M}}}sheetData').findall(f'{{{M}}}row'):
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
            header, body = rows[0], rows[1:]
            out[s.get('name')] = [dict(zip(header, r + [''] * (len(header) - len(r)))) for r in body]
    return out, names


def normal(text):
    """A label's normal form, as the contract states it."""
    return ' '.join(unicodedata.normalize('NFC', text).replace('\u00a0', ' ').split())


def header_labels(frozen, name, header):
    """The normal form of each cell of the header row, read by the sealed
    verification's own reader."""
    verify, path = reader(frozen), frozen / name
    table = verify.xlsx_rows(path) if path.suffix == '.xlsx' else verify.csv_rows(path)
    return {c: normal(t) for c, t in table['rows'].get(header, {}).items()}


def columns_of(facts, expected, frozen, story, k):
    """The columns action k of a story reads with, from the sealed facts
    alone: a choice by hand with its labels from its own file, or a map the
    story saved or imported before it; None for the declared reading."""
    store = {}

    def by_hand(action):
        labels = header_labels(frozen, action['file'], action['header'])
        return {'header': action['header'],
                'columns': {r: None if action['columns'][r] is None else
                            {'column': action['columns'][r], 'label': labels[action['columns'][r]]} for r in ROLES}}
    for i, action in enumerate(facts[story]['actions'][:k + 1]):
        outcome = expected[story][i]
        if action['do'] == 'import' and outcome['accepted']:
            m = json.loads((frozen / action['file']).read_text(encoding='utf-8'))
            store[m['name']] = {'header': m['header'], 'columns': m['columns']}
        if action['do'] != 'read':
            continue
        if i == k:
            return None if action['by'] == 'declared' else by_hand(action) if action['by'] == 'hand' \
                else store[action['map']]
        if action['by'] == 'hand' and outcome.get('saved'):
            store[outcome['saved']] = by_hand(action)


def check_one(parsed, request, frozen, story, outcome, cashbook_bytes, columns_expected):
    """Every difference between one parsed workbook and the sealed package."""
    sheet = parsed['sheets']
    reading = outcome['reading']
    # The columns sheet: present exactly when the reading used columns.
    if columns_expected is None:
        need('Cashbook columns' not in parsed['names'], 'a columns sheet for the declared reading')
    else:
        need('Cashbook columns' in sheet, 'no Cashbook columns sheet')
        rows = [[r['Item'], r['Column'], r['Label']] for r in sheet['Cashbook columns']]
        want = [['header row', str(reading['header']), '']]
        want += [[role, letters(c['column']) if c else '', c['label'] if c else '']
                 for role, c in ((r, columns_expected['columns'][r]) for r in ROLES)]
        want += [['rows above the header', str(reading['above']), '']]
        want += [['not read', letters(u['column']), u['label']] for u in reading['unread']]
        need(rows == want, f'columns sheet {rows} != {want}')
    # The entries.
    got = [(r['Voucher'], r['Source row'], r['Date'], r['Description'], r['Reference'], r['Direction'],
            r['Amount minor units']) for r in sheet['Cashbook']]
    want = [(e['voucher'], str(e['row']), e['date'], e['description'], e['reference'], e['direction'],
             str(e['amount'])) for e in reading['entries']]
    need(got == want, 'cashbook entries differ')
    # The cases.
    cases = [(r['Case ID'], r['Kind'], r['Reason'], STATUS.get(r['Status'], r['Status']),
              r['Statement IDs'].split(), r['Cashbook IDs'].split()) for r in sheet['Cases']]
    want = [(c['id'], c['kind'], c['reason'], c['status'], c['statement'], c['cashbook'])
            for c in outcome['period']['cases']]
    need(cases == want, 'cases differ')
    # The cashbook original.
    chunks = sorted(((int(r['Chunk index']), r['Base64']) for r in sheet['Sources'] if r['Role'] == 'cashbook'))
    need([i for i, _ in chunks] == list(range(len(chunks))), 'cashbook chunks out of order')
    data = base64.b64decode(''.join(b for _, b in chunks))
    need(data == cashbook_bytes, 'the cashbook original differs')
    need(all(r['SHA256'] == hashlib.sha256(data).hexdigest() for r in sheet['Sources'] if r['Role'] == 'cashbook'),
         'the cashbook fingerprint differs')


ALTERATIONS = {
    'label': lambda p: p['sheets']['Cashbook columns'][1].update(Label='Date ') if len(
        p['sheets'].get('Cashbook columns', [])) > 1 else False,
    'column-letter': lambda p: p['sheets']['Cashbook columns'][4].update(Column='Z') if len(
        p['sheets'].get('Cashbook columns', [])) > 4 else False,
    'columns-dropped': lambda p: (p['sheets'].pop('Cashbook columns'), p['names'].remove('Cashbook columns'))
    if 'Cashbook columns' in p['sheets'] else False,
    'entry-amount': lambda p: p['sheets']['Cashbook'][0].update(
        **{'Amount minor units': str(int(p['sheets']['Cashbook'][0]['Amount minor units']) + 1)})
    if p['sheets']['Cashbook'] else False,
    'entry-row': lambda p: p['sheets']['Cashbook'][-1].update(
        **{'Source row': str(int(p['sheets']['Cashbook'][-1]['Source row']) + 1)}) if p['sheets']['Cashbook'] else False,
    'case-member': lambda p: p['sheets']['Cases'][0].update(**{'Cashbook IDs': ''}) if p['sheets']['Cases'] else False,
    'status': lambda p: p['sheets']['Cases'][0].update(Status='rejected') if p['sheets']['Cases'] else False,
    'source-byte': lambda p: next(r for r in p['sheets']['Sources'] if r['Role'] == 'cashbook').update(
        Base64=base64.b64encode(b'x' + base64.b64decode(
            next(r for r in p['sheets']['Sources'] if r['Role'] == 'cashbook')['Base64'])[1:]).decode()),
}


def main():
    request = json.load(sys.stdin)
    frozen = Path(request['frozen'])
    expected = json.loads((frozen / 'EXPECTED.json').read_text(encoding='utf-8'))['stories']
    facts = {s['id']: s for s in json.loads((frozen / 'stories.json').read_text(encoding='utf-8'))['stories']}
    results, parsed_all = [], {}
    for e in request['exports']:
        outcome = expected[e['story']][e['action']]
        action = facts[e['story']]['actions'][e['action']]
        parsed = dict(zip(('sheets', 'names'), sheets(Path(e['path']).read_bytes())))
        cashbook = Path(e['cashbook']).read_bytes()
        e['columns'] = columns_of(facts, expected, frozen, e['story'], e['action'])
        try:
            check_one(parsed, request, frozen, e['story'], outcome, cashbook, e['columns'])
            results.append({'label': e['label'], 'passed': True})
        except CheckError as error:
            results.append({'label': e['label'], 'passed': False, 'problem': str(error)})
        parsed_all[e['label']] = (parsed, outcome, cashbook, e)
    self_test = []
    for name, alter in ALTERATIONS.items():
        applied = caught = 0
        for label in request.get('selfTest', []):
            parsed, outcome, cashbook, e = parsed_all[label]
            copy_ = copy.deepcopy(parsed)
            if alter(copy_) is False:
                continue
            applied += 1
            try:
                check_one(copy_, request, frozen, e['story'], outcome, cashbook, e['columns'])
            except CheckError:
                caught += 1
        self_test.append({'alteration': name, 'applied': applied, 'caught': caught,
                          'rejected': applied > 0 and caught == applied})
    passed = all(r['passed'] for r in results) and all(t['rejected'] for t in self_test)
    print(json.dumps({'passed': passed, 'workbooks': len(results),
                      'failed': [r for r in results if not r['passed']], 'selfTest': self_test}, indent=1))
    sys.exit(0 if passed else 1)


if __name__ == '__main__':
    main()
