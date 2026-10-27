"""Independent check of an AR-1 PDF workpaper (ar-statement-pdf-1).

Reads an exported workbook with the standard library only, and judges it
against three things: the sealed files in frozen/ (the original bytes must
be in the workbook, byte for byte), the sealed EXPECTED.json written by the
independent oracle, and the oracle's own reading of the printed lines. It
never imports the product, its tests or the proof that produced the file.

What it requires of the workbook:
- the two original sources, byte for byte, with their hashes and roles;
- the confirmed scope and the statement family;
- every printed line of the statement once, in printed order, with its page
  and line, and every detail line outside the compared section marked out of
  scope;
- the sections with their scope, pages, detail lines and which is compared;
- every case with its reason and its members on both sides, members found
  through the movements by posting ID or printed place;
- the error codes of the source issues;
- the decisions, when the run recorded any, and their effect on the cases.

  python3 -B audit/ar-statement-foundation/check_export.py STORY WORKBOOK.xlsx [--reopened DOC ...]
      [--frozen DIR]   another sealed package of this family, such as the A5 holdout's frozen/
"""
import argparse
import base64
import hashlib
import json
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree

HERE = Path(__file__).resolve().parent
FROZEN = HERE / 'frozen'
sys.path.insert(0, str(HERE))
import oracle  # noqa: E402  the sealed independent oracle, beside this file

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
REL = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'
FAMILY = 'ar-statement-pdf-1'
ROLES = ['company-ar-ledger', 'company-issued-customer-statement']


class CheckFailure(AssertionError):
    pass


def require(condition, message):
    if not condition:
        raise CheckFailure(message)


def equal(actual, expected, message):
    require(actual == expected, f'{message}: actual={actual!r} expected={expected!r}')


def column_index(ref):
    letters = re.match(r'[A-Z]+', ref).group(0)
    n = 0
    for c in letters:
        n = n * 26 + ord(c) - 64
    return n - 1


def read_workbook(path):
    """Every sheet as a list of rows of cell values (str, int, float, bool or None)."""
    with zipfile.ZipFile(path) as z:
        names = set(z.namelist())
        shared = []
        if 'xl/sharedStrings.xml' in names:
            for si in ElementTree.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', NS):
                shared.append(''.join(t.text or '' for t in si.iter(f'{{{NS["m"]}}}t')))
        book = ElementTree.fromstring(z.read('xl/workbook.xml'))
        rels = ElementTree.fromstring(z.read('xl/_rels/workbook.xml.rels'))
        target = {r.get('Id'): r.get('Target') for r in rels}
        sheets = {}
        for sheet in book.find('m:sheets', NS):
            part = target[sheet.get(REL)].lstrip('/')
            part = part if part.startswith('xl/') else f'xl/{part}'
            rows = []
            for row in ElementTree.fromstring(z.read(part)).iter(f'{{{NS["m"]}}}row'):
                values = {}
                for cell in row.findall('m:c', NS):
                    kind, v = cell.get('t'), cell.find('m:v', NS)
                    if kind == 's':
                        value = shared[int(v.text)]
                    elif kind == 'inlineStr':
                        value = ''.join(t.text or '' for t in cell.iter(f'{{{NS["m"]}}}t'))
                    elif kind in ('str', 'e'):
                        value = v.text if v is not None else ''
                    elif kind == 'b':
                        value = v.text == '1'
                    elif v is None:
                        value = None
                    else:
                        number = float(v.text)
                        value = int(number) if number.is_integer() else number
                    values[column_index(cell.get('r'))] = value
                width = max(values) + 1 if values else 0
                rows.append([values.get(i) for i in range(width)])
            sheets[sheet.get('name')] = rows
    return sheets


def table(sheets, name):
    require(name in sheets, f'sheet {name}')
    rows = sheets[name]
    header = rows[0]
    return [dict(zip(header, r + [None] * (len(header) - len(r)))) for r in rows[1:]]


def text(value):
    return '' if value is None else str(value)


def check(story_id, workbook, reopened=(), frozen=FROZEN):
    facts = json.loads((frozen / 'stories.json').read_text(encoding='utf-8'))
    story = next(s for s in facts['stories'] if s['id'] == story_id)
    want = json.loads((frozen / 'EXPECTED.json').read_text(encoding='utf-8'))['stories'][story_id]
    sheets = read_workbook(workbook)

    # The originals, byte for byte.
    sources = table(sheets, 'Sources')
    for side, name in enumerate([f'{story_id}-ledger.csv', f'{story_id}-statement.pdf']):
        chunks = sorted((r for r in sources if r['Side'] == side), key=lambda r: r['Chunk'])
        require(chunks, f'source {side}')
        data = base64.b64decode(''.join(text(r['Original bytes base64']) for r in chunks))
        original = (frozen / name).read_bytes()
        equal(hashlib.sha256(data).hexdigest(), hashlib.sha256(original).hexdigest(), f'source {side} bytes')
        equal({text(r['Source SHA-256']) for r in chunks}, {hashlib.sha256(original).hexdigest()}, f'source {side} hash')
        equal({text(r['Role']) for r in chunks}, {ROLES[side]}, f'source {side} role')

    # The family and the confirmed scope.
    summary = {text(r['Property']): r['Value'] for r in table(sheets, 'Summary')}
    equal(summary.get('Version'), FAMILY, 'family')
    for key in ('entity', 'ledger', 'customer', 'account', 'currency', 'start', 'end'):
        equal(summary.get(key), story['scope'][key], f'scope {key}')
    equal(summary.get('Out of scope lines'), want['outOfScopeLines'], 'lines out of scope')

    # Every printed line, in printed order, with its place.
    doc, sections, inventory, errors = oracle.read_statement(story['statement']['pages'])
    printed = table(sheets, 'Statement inventory')
    places = [json.loads(text(r['PDF place JSON'])) for r in printed]
    equal([[p['page'], p['line']] for p in places], [i['where'] for i in inventory], 'printed lines')
    compared = next((k for k, s in enumerate(want['sections']) if s['compared']), None)
    for row, item in zip(printed, inventory):
        if item['kind'] == 'detail':
            outside = compared is None or item['section'] != compared
            equal(text(row['Classification']) == 'out-of-scope', outside, f'line {item["where"]} out of scope')
            equal(text(row['Kind']), 'out-of-scope' if outside else 'movement', f'line {item["where"]} kind')
        if item['kind'] == 'error':
            equal(text(row['Kind']), 'error', f'line {item["where"]} error')
            require(item['code'] in json.loads(text(row['Errors JSON'])), f'line {item["where"]} code {item["code"]}')

    # The sections.
    got_sections = [
        {
            'compared': r['Compared'] is True or r['Compared'] == 'true',
            'lines': r['Detail lines'],
            'pages': json.loads(text(r['Pages JSON'])),
            'scope': None if not text(r['Customer ID']) else {
                'customer': text(r['Customer ID']),
                'account': text(r['Account']),
                'currency': text(r['Currency']),
                'start': text(r['Period start']),
                'end': text(r['Period end']),
            },
        }
        for r in table(sheets, 'Statement sections')
    ]
    equal(got_sections, want['sections'], 'sections')

    # The error codes.
    issues = json.loads(text(summary.get('Source issues JSON')))
    equal(sorted({i['code'] for i in issues}), want['errorCodes'], 'error codes')

    # Every case, its reason and its members.
    movements = {text(r['Movement ID']): r for r in table(sheets, 'Movements')}
    members = {}
    for r in table(sheets, 'Membership'):
        members.setdefault(text(r['Case ID']), []).append(movements[text(r['Movement ID'])])
    cases = []
    for r in table(sheets, 'Cases'):
        if text(r['Document type']) == 'scope':
            continue
        rows = members.get(text(r['Case ID']), [])
        cases.append({
            'document': text(r['Own document number']),
            'kind': text(r['Document type']),
            'ledger': [text(m['Posting ID']) for m in rows if m['Side'] == 0],
            'reason': text(r['Reason']),
            'statement': [
                [json.loads(text(m['PDF place JSON']))[k] for k in ('page', 'line')]
                for m in rows if m['Side'] == 1
            ],
            'status': text(r['Status']),
        })
    cases.sort(key=lambda c: (c['kind'], c['document']))
    expected = []
    for c in want['cases']:
        c = dict(c)
        if c['document'] in reopened:
            require(c['reason'] == 'exact-own-document', f'{c["document"]} was not matched')
            c['reason'], c['status'] = 'reopened', 'review'
        else:
            c['status'] = 'matched' if c['reason'] == 'exact-own-document' else 'review'
        expected.append(c)
    equal(cases, expected, 'cases')
    equal(summary.get('Matched document pairs'), sum(c['status'] == 'matched' for c in expected), 'matched pairs')

    decisions = table(sheets, 'Decisions')
    equal(len(decisions), len(reopened), 'decisions')
    for d in decisions:
        equal(text(d['Action']), 'reopen', 'decision action')
    return {'story': story_id, 'printedLines': len(printed), 'cases': len(cases),
            'matched': sum(c['status'] == 'matched' for c in cases), 'decisions': len(decisions)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('story')
    parser.add_argument('workbook')
    parser.add_argument('--reopened', nargs='*', default=[])
    parser.add_argument('--frozen', type=Path, default=FROZEN)
    args = parser.parse_args()
    try:
        print(json.dumps(check(args.story, args.workbook, tuple(args.reopened), args.frozen.resolve())))
    except CheckFailure as failure:
        print(f'check failed: {failure}', file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
