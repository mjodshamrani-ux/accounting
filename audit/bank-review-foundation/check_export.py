"""Independent check of the review decisions in a bank statement workbook,
for the REVIEW-1 stories (proposed bank-review-queue-1). Standard library
only.

  python3 -B audit/bank-review-foundation/check_export.py < request.json

  request: {"frozen": path, "selfTest": [story ids],
            "exports": [{"story", "path", "cashbook"}]}

The workbook is read from its OOXML parts directly, never by the product, and
held against the sealed package (EXPECTED.json and the frozen files), never
against the product's own output. A group decision is the single decisions
it stands for (Q3), so the workbook must hold exactly the decisions the
oracle records for the story, in order, by type and case; each with the
context the Summary names and the exact members of its case; and every
review case with the status the oracle gives it. The originals reassembled
from the Sources sheet must be the frozen statement and the cashbook the
story ends with, byte for byte.

selfTest names stories whose parsed sheets are then altered (a status, a
dropped decision, a decision's case, a decision's type, a member, a context,
a source byte); each alteration must be caught wherever it applies, and each
must apply somewhere, or the checker itself has failed.
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

M = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
P = 'http://schemas.openxmlformats.org/package/2006/relationships'
STATUS = {'matched-accepted': 'accepted', 'rejected': 'rejected', 'needs-review': 'needs-review'}


class CheckError(Exception):
    pass


def need(ok, what):
    if not ok:
        raise CheckError(what)


def xstring(text):
    """OOXML ST_Xstring: _xHHHH_ stands for that character."""
    return re.sub(r'_x([0-9A-Fa-f]{4})_', lambda m: chr(int(m.group(1), 16)), text)


def sheets(data, names):
    """The named sheets of the workbook, each as rows of strings keyed by its
    header row."""
    out = {}
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        book = ElementTree.fromstring(z.read('xl/workbook.xml'))
        rels = {r.get('Id'): r.get('Target') for r in
                ElementTree.fromstring(z.read('xl/_rels/workbook.xml.rels')).iter(f'{{{P}}}Relationship')}
        shared = []
        if 'xl/sharedStrings.xml' in z.namelist():
            for si in ElementTree.fromstring(z.read('xl/sharedStrings.xml')).findall(f'{{{M}}}si'):
                shared.append(xstring(''.join(t.text or '' for t in si.iter(f'{{{M}}}t'))))
        for s in book.find(f'{{{M}}}sheets').findall(f'{{{M}}}sheet'):
            if s.get('name') not in names:
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
    need(set(out) == set(names), f'missing sheets {sorted(set(names) - set(out))}')
    return out


def parse(data):
    return sheets(data, {'Summary', 'Sources', 'Cases', 'Decisions', 'Decision members'})


def check(parsed, case, want, frozen):
    summary = {r['Property']: r['Value'] for r in parsed['Summary']}
    need(summary.get('Lifecycle') == 'bank-statement-lifecycle-1',
         f"the session format changed: {summary.get('Lifecycle')}")
    context = summary.get('Context')
    need(bool(context), 'no context in the Summary')

    # The originals, byte for byte.
    sources = {}
    for r in parsed['Sources']:
        sources.setdefault((r['Role'], r['Name'], r['SHA256']), []).append((int(r['Chunk index']), r['Base64']))
    period = next(iter(want['periods']))
    names = {'statement': f'{period}-statement.pdf', 'cashbook': case['cashbook']}
    need(sorted(role for role, _, _ in sources) == ['cashbook', 'statement'], 'not one statement and one cashbook')
    for (role, name, digest), chunks in sources.items():
        data = base64.b64decode(''.join(b for _, b in sorted(chunks)))
        need(name == names[role], f'{role}: {name} is not {names[role]}')
        need(hashlib.sha256(data).hexdigest() == digest, f'{role}: the original does not match its fingerprint')
        need(data == (frozen / names[role]).read_bytes(), f'{role}: the original is not the frozen file')

    # The decisions: exactly the oracle's, in order.
    decisions = [(r['Type'], r['Case']) for r in parsed['Decisions']]
    need(decisions == [tuple(d) for d in want['decisions']], f'decisions {decisions} != {want["decisions"]}')
    need(all(r['Context'] == context for r in parsed['Decisions']), 'a decision outside the context')
    cases = {r['Case ID']: r for r in parsed['Cases']}
    members = {}
    for r in parsed['Decision members']:
        members.setdefault(r['Decision'], {'statement': [], 'cashbook': []})[r['Side']].append(r['Member ID'])
    for r in parsed['Decisions']:
        c = cases.get(r['Case'])
        need(c is not None, f"{r['Decision']}: no case {r['Case']}")
        got = members.get(r['Decision'], {'statement': [], 'cashbook': []})
        need(got['statement'] == c['Statement IDs'].split() and got['cashbook'] == c['Cashbook IDs'].split(),
             f"{r['Decision']}: members are not those of {r['Case']}")

    # Every review case with the oracle's status.
    statuses = {k: STATUS.get(r['Status'], r['Status']) for k, r in cases.items() if r['Kind'] == 'review'}
    need(statuses == want['statuses'], f'statuses {statuses} != {want["statuses"]}')


def alterations():
    def status(p):
        for r in p['Cases']:
            if r['Kind'] == 'review' and r['Status'] != 'rejected':
                r['Status'] = 'rejected'
                return True
        return False

    def drop(p):
        if not p['Decisions']:
            return False
        p['Decisions'].pop()
        return True

    def recase(p):
        review = [r['Case ID'] for r in p['Cases'] if r['Kind'] == 'review']
        for r in p['Decisions']:
            other = next((k for k in review if k != r['Case']), None)
            if other:
                r['Case'] = other
                return True
        return False

    def retype(p):
        for r in p['Decisions']:
            if r['Type'] in ('accept', 'reject'):
                r['Type'] = 'reject' if r['Type'] == 'accept' else 'accept'
                return True
        return False

    def member(p):
        for r in p['Decision members']:
            r['Member ID'] = r['Member ID'] + 'X'
            return True
        return False

    def context(p):
        for r in p['Decisions']:
            r['Context'] = r['Context'] + ' '
            return True
        return False

    def source(p):
        for r in p['Sources']:
            if r['Role'] == 'cashbook':
                raw = bytearray(base64.b64decode(r['Base64']))
                raw[-2] ^= 1
                r['Base64'] = base64.b64encode(bytes(raw)).decode()
                return True
        return False

    return {'status': status, 'drop-decision': drop, 'decision-case': recase, 'decision-type': retype,
            'decision-member': member, 'context': context, 'source-byte': source}


def main():
    request = json.load(sys.stdin)
    frozen = Path(request['frozen'])
    expected = json.loads((frozen / 'EXPECTED.json').read_text(encoding='utf-8'))['stories']
    facts = {s['id']: s for s in json.loads((frozen / 'stories.json').read_text(encoding='utf-8'))['stories']}
    parsed = {}
    for case in request['exports']:
        want = dict(expected[case['story']], periods=[p['id'] for p in facts[case['story']]['periods']])
        need(want.get('refusal') is None, f"{case['story']}: the oracle refuses this story's session")
        sheet = parse(Path(case['path']).read_bytes())
        check(sheet, case, want, frozen)
        parsed[case['path']] = (case, sheet, want)
    report = {'checked': len(parsed), 'selfTest': {}}
    for story_id in request.get('selfTest', []):
        case, sheet, want = next(x for x in parsed.values() if x[0]['story'] == story_id)
        for name, change in alterations().items():
            altered = copy.deepcopy(sheet)
            if not change(altered):
                continue
            try:
                check(altered, case, want, frozen)
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
