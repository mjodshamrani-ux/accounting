"""Independent check of WF-1 ROLL-1 workpapers (proposed bank-statement-roll-1).
Standard library only.

  python3 -B audit/bank-roll-foundation/check_export.py < request.json

  request: {"frozen": path, "selfTest": [story ids],
            "exports": [{"story", "path", "decided": bool}]}

Each workbook is read from its OOXML parts directly, never by the product, and
held against the sealed package, never against the product's own output:
- Sources: the statement, the cashbook and the previous session file
  reassemble from their chunks to the frozen files byte for byte;
- Previous period: accepted, or refused with the code, as EXPECTED.json says;
- Carried items: every field as EXPECTED.json has it, in order, each named
  <MONTH>:<id> by its period;
- Withheld: as EXPECTED.json;
- Cases of kind carried: reason, carried items and current members as
  EXPECTED.json, in order; status as the scenario decided them (undecided: all
  needs-review; decided: the two reasons the contract lets an accountant accept
  accepted, every other rejected), read from contract.json, not from here;
- At the period end: a carried item stays outstanding, one period older, only
  in no case or in a rejected one;
- No carried or withheld item is in an automatic case.

selfTest names stories whose parsed sheets are then altered in a dozen ways
(a byte of the previous file, a carried amount, age, origin, session or page,
a dropped carried item, a case reason, a carried member, the previous status,
a withheld item, a status, an outstanding flag); each alteration must be
caught wherever it applies, or the checker itself has failed.
"""
import base64
import copy
import hashlib
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
MONTHS = {'01': 'JAN', '02': 'FEB', '03': 'MAR', '04': 'APR', '05': 'MAY', '06': 'JUN', '07': 'JUL', '08': 'AUG',
          '09': 'SEP', '10': 'OCT', '11': 'NOV', '12': 'DEC'}
CARRIED_HEADER = ['Key', 'Side', 'ID', 'Period start', 'Period end', 'Page or row', 'Date', 'Direction',
                  'Amount minor units', 'Reference', 'Origin', 'Age', 'Source SHA256', 'Session SHA256',
                  'Outstanding at period end', 'Age at period end']


class CheckError(Exception):
    pass


def need(ok, what):
    if not ok:
        raise CheckError(what)


def xstring(text):
    """OOXML ST_Xstring: _xHHHH_ stands for that character."""
    return re.sub(r'_x([0-9A-Fa-f]{4})_', lambda m: chr(int(m.group(1), 16)), text)


def workbook(data):
    """Every worksheet by name, as rows of strings."""
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        book = ElementTree.fromstring(z.read('xl/workbook.xml'))
        rels = {r.get('Id'): r.get('Target') for r in
                ElementTree.fromstring(z.read('xl/_rels/workbook.xml.rels')).iter(f'{{{P}}}Relationship')}
        shared = []
        if 'xl/sharedStrings.xml' in z.namelist():
            for si in ElementTree.fromstring(z.read('xl/sharedStrings.xml')).findall(f'{{{M}}}si'):
                shared.append(xstring(''.join(t.text or '' for t in si.iter(f'{{{M}}}t'))))
        out = {}
        for s in book.find(f'{{{M}}}sheets').findall(f'{{{M}}}sheet'):
            target = rels[s.get(f'{{{R}}}id')].lstrip('/')
            sheet = ElementTree.fromstring(z.read(target if target.startswith('xl/') else f'xl/{target}'))
            rows = []
            for row in sheet.find(f'{{{M}}}sheetData').findall(f'{{{M}}}row'):
                need(int(row.get('r')) == len(rows) + 1, f"{s.get('name')}: a row is missing")
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
            out[s.get('name')] = rows
    return out


def body(sheets, name, header):
    need(name in sheets, f'no sheet {name}')
    rows = sheets[name]
    need(rows and rows[0] == header, f'{name}: header {rows[0] if rows else None}')
    return [r + [''] * (len(header) - len(r)) for r in rows[1:]]


def pairs(sheets, name):
    return {k: v for k, v in body(sheets, name, ['Property', 'Value'])}


def integer(text, what):
    need(re.fullmatch(r'-?\d+', text or '') is not None, f'{what}: {text!r} is not an integer')
    return int(text)


def acceptable_reasons(contract):
    """The carried reasons the contract lets an accountant accept."""
    found = {**contract['clearing']['byReference'], **contract['clearing']['byAmount']}
    return {reason for reason, text in found.items() if 'may accept it' in text}


def check(sheets, case, frozen, expected, story, contract):
    want = expected['stories'][case['story']]
    current = story['periods'][-1]['id']
    now = current.split('-')[1]

    # Sources: the three originals, byte for byte.
    files = {}
    for role, name, digest, index, data in body(sheets, 'Sources', ['Role', 'Name', 'SHA256', 'Chunk index', 'Base64']):
        f = files.setdefault(role, {'name': name, 'sha256': digest, 'chunks': []})
        need(f['name'] == name and f['sha256'] == digest, f'Sources: {role} named twice')
        need(integer(index, 'chunk') == len(f['chunks']), f'Sources: {role} chunk order')
        f['chunks'].append(data)
    need(sorted(files) == ['cashbook', 'previous', 'statement'], f'Sources: roles {sorted(files)}')
    originals = {'statement': f'{current}-statement.pdf', 'cashbook': f'{current}-cashbook.csv',
                 'previous': f"{case['story']}-previous-session.json"}
    for role, name in originals.items():
        raw = base64.b64decode(''.join(files[role]['chunks']), validate=True)
        need(raw == (frozen / name).read_bytes(), f'Sources: {role} is not {name}')
        need(hashlib.sha256(raw).hexdigest() == files[role]['sha256'], f'Sources: {role} fingerprint')

    summary = pairs(sheets, 'Summary')
    need(summary.get('Lifecycle') == 'bank-statement-roll-1', 'Summary: lifecycle')

    previous = pairs(sheets, 'Previous period')
    need(previous.get('SHA256') == files['previous']['sha256'], 'Previous period: fingerprint')
    status = previous.get('Code') if previous.get('Status') == 'refused' else previous.get('Status')
    need(status == want['previous'], f"Previous period: {status} != {want['previous']}")

    # Carried items, every field.
    carried = body(sheets, 'Carried items', CARRIED_HEADER)
    name_of, got = {}, []
    for (key, side, ident, start, end, place, when, direction, amount, reference, origin, age, source,
         session, left, age_end) in carried:
        month = MONTHS.get(start[5:7], '?')
        name_of[key] = f'{month}:{ident}'
        need(key == f"{'S' if side == 'statement' else 'C'}:{ident}@{end}", f'Carried items: key {key}')
        item = {'item': f'{month}:{ident}', 'period': month, 'side': side, 'id': ident,
                ('page' if side == 'statement' else 'row'): integer(place, 'place'), 'date': when,
                'direction': direction, 'amount': integer(amount, 'amount'), 'reference': reference,
                'origin': origin, 'age': integer(age, 'age'), 'source': source, 'session': session}
        got.append((item, left, age_end))
    need([g[0] for g in got] == want['carried'], 'Carried items differ from EXPECTED.json')

    withheld = body(sheets, 'Withheld', ['Side', 'ID'])
    need(sorted(f'{now}:{i}' for _, i in withheld) == want['withheld'], 'Withheld differs from EXPECTED.json')

    # Carried cases.
    cases = body(sheets, 'Cases', ['Case ID', 'Kind', 'Reason', 'Reference', 'Status', 'Decision',
                                   'Statement IDs', 'Cashbook IDs'])
    members = {}
    for case_id, key in body(sheets, 'Carried case members', ['Case ID', 'Carried key']):
        members.setdefault(case_id, []).append(name_of.get(key, f'unknown {key}'))
    acceptable = acceptable_reasons(contract)
    rows = [c for c in cases if c[1] == 'carried']
    need(len(rows) == len(want['cases']), f'Cases: {len(rows)} carried cases')
    live = set()
    for row, expect in zip(rows, want['cases']):
        case_id, _, reason, _, status, _, statement, cashbook = row
        need(reason == expect['reason'], f'Cases: {case_id} reason {reason}')
        need(members.get(case_id) == expect['carried'], f'Cases: {case_id} carried members')
        need([f'{now}:{i}' for i in (statement.split() + cashbook.split())] == expect['current'],
             f'Cases: {case_id} current members')
        if not case['decided']:
            need(status == 'needs-review', f'Cases: {case_id} status {status}')
        else:
            need(status == ('matched-accepted' if reason in acceptable else 'rejected'), f'Cases: {case_id} status {status}')
        if status != 'rejected':
            live.update(expect['carried'])
    need(set(members) == {r[0] for r in rows}, 'Carried case members name a case that is not carried')

    # At the period end.
    for item, left, age_end in got:
        stays = item['item'] not in live
        need(left == ('yes' if stays else 'no'), f"Carried items: {item['item']} outstanding {left}")
        need(age_end == (str(item['age'] + 1) if stays else ''), f"Carried items: {item['item']} age at end")
    if not case['decided']:
        need([{'item': g[0]['item'], 'age': g[0]['age'] + 1} for g in got if g[1] == 'yes'] == want['stillCarried'],
             'Carried items: still carried differs from EXPECTED.json')

    # Nothing carried or withheld is paired automatically.
    automatic = {i for c in cases if c[1] == 'automatic' for i in c[6].split() + c[7].split()}
    need(not automatic & {i for _, i in withheld}, 'a withheld item is in an automatic case')
    need(not automatic & {i for r in rows for i in r[6].split() + r[7].split()},
         'a carried case member is in an automatic case')


def alterations(sheets):
    """One planted change per entry; each must be caught where it applies."""
    def at(name, row, col, f):
        def change(s):
            if len(s[name]) <= row or len(s[name][row]) <= col:
                return False
            s[name][row][col] = f(s[name][row][col])
            return True
        return change

    def drop(name, row):
        def change(s):
            if len(s[name]) <= row:
                return False
            del s[name][row]
            return True
        return change

    def previous_byte(s):
        for r in s['Sources'][1:]:
            if r[0] == 'previous':
                raw = bytearray(base64.b64decode(r[4]))
                raw[len(raw) // 2] ^= 1
                r[4] = base64.b64encode(bytes(raw)).decode()
                return True
        return False

    def carried_status(s):
        for r in s['Cases'][1:]:
            if r[1] == 'carried':
                r[4] = 'matched-accepted' if r[4] != 'matched-accepted' else 'rejected'
                return True
        return False

    def previous_status(s):
        for r in s['Previous period'][1:]:
            if r[0] == 'Status':
                r[1] = 'refused' if r[1] == 'accepted' else 'accepted'
                return True
        return False

    return {
        'previous-file-byte': previous_byte,
        'carried-amount': at('Carried items', 1, 8, lambda v: str(int(v) + 1)),
        'carried-age': at('Carried items', 1, 11, lambda v: str(int(v) + 1)),
        'carried-origin': at('Carried items', 1, 10, lambda v: 'C9' if v == 'unmatched' else 'unmatched'),
        'carried-session': at('Carried items', 1, 13, lambda v: '0' * 64),
        'carried-place': at('Carried items', 1, 5, lambda v: str(int(v) + 1)),
        'carried-item-dropped': drop('Carried items', 1),
        'case-reason': carried_reason,
        'carried-member': at('Carried case members', 1, 1, lambda v: v + 'x'),
        'previous-status': previous_status,
        'withheld-dropped': drop('Withheld', 1),
        'carried-status': carried_status,
        'outstanding-flag': at('Carried items', 1, 14, lambda v: 'no' if v == 'yes' else 'yes'),
    }


def carried_reason(s):
    for r in s['Cases'][1:]:
        if r[1] == 'carried':
            r[2] = 'carried-amount-difference' if r[2] != 'carried-amount-difference' else 'carried-reference'
            return True
    return False


def main():
    request = json.load(sys.stdin)
    frozen = Path(request['frozen'])
    expected = json.loads((frozen / 'EXPECTED.json').read_text(encoding='utf-8'))
    facts = json.loads((frozen / 'stories.json').read_text(encoding='utf-8'))
    contract = json.loads((HERE / 'contract.json').read_text(encoding='utf-8'))
    stories = {s['id']: s for s in facts['stories']}
    parsed = {}
    for case in request['exports']:
        sheets = workbook(Path(case['path']).read_bytes())
        check(sheets, case, frozen, expected, stories[case['story']], contract)
        parsed[case['path']] = (case, sheets)
    report = {'checked': len(parsed), 'selfTest': {}}
    for story_id in request.get('selfTest', []):
        case, sheets = next((c, s) for c, s in parsed.values() if c['story'] == story_id)
        for name, change in alterations(sheets).items():
            altered = copy.deepcopy(sheets)
            if not change(altered):
                continue
            try:
                check(altered, case, frozen, expected, stories[story_id], contract)
            except CheckError:
                report['selfTest'].setdefault(name, []).append(story_id)
                continue
            raise SystemExit(f'self-test: {name} on {story_id} was not caught')
    missing = set(alterations({}).keys()) - set(report['selfTest'])
    if request.get('selfTest') and missing:
        raise SystemExit(f'self-test: never applied {sorted(missing)}')
    print(json.dumps(report, sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except CheckError as error:
        raise SystemExit(f'check failed: {error}')
