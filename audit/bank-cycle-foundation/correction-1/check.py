"""Correction 1 holds: the sealed package is intact, oracle.py here
reproduces EXPECTED.json, that expectation differs from the sealed one in
cashbook rows and in nothing else, and every cashbook item a sheet cites is
on the row it is cited at in the ledger whose fingerprint it carries. The
ledgers are read here with a reader of their own (zipfile and ElementTree),
neither the product's nor the MAP-1 oracle's. The rows the sealed
expectation cites that hold another entry are counted, as the defect this
corrects.

  python3 -B audit/bank-cycle-foundation/correction-1/check.py
"""
import copy
import hashlib
import importlib.util
import json
import posixpath
import re
import subprocess
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree

HERE = Path(__file__).resolve().parent
PACKAGE = HERE.parent
FROZEN = PACKAGE / 'frozen'
MAIN = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
RELS = '{http://schemas.openxmlformats.org/package/2006/relationships}'
OFFICE = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def texts(path):
    """{row: [cell text, ...]} of the first sheet of a workbook."""
    with zipfile.ZipFile(path) as z:
        book = ElementTree.fromstring(z.read('xl/workbook.xml'))
        first = book.find(f'{MAIN}sheets/{MAIN}sheet').get(f'{OFFICE}id')
        rels = ElementTree.fromstring(z.read('xl/_rels/workbook.xml.rels'))
        target = next(r.get('Target') for r in rels.findall(f'{RELS}Relationship') if r.get('Id') == first)
        target = target.lstrip('/') if target.startswith('/') else posixpath.join('xl', target)
        shared = []
        if 'xl/sharedStrings.xml' in z.namelist():
            for si in ElementTree.fromstring(z.read('xl/sharedStrings.xml')).findall(f'{MAIN}si'):
                shared.append(''.join(t.text or '' for t in si.iter(f'{MAIN}t')))
        sheet = ElementTree.fromstring(z.read(target))
    rows = {}
    for row in sheet.iter(f'{MAIN}row'):
        at = int(row.get('r'))
        for c in row.findall(f'{MAIN}c'):
            kind = c.get('t')
            if kind == 's':
                value = shared[int(c.find(f'{MAIN}v').text)]
            elif kind == 'inlineStr':
                value = ''.join(t.text or '' for t in c.iter(f'{MAIN}t'))
            else:
                v = c.find(f'{MAIN}v')
                value = v.text if v is not None else ''
            rows.setdefault(at, []).append(value)
    return rows


def leaves(a, b, path=()):
    """The paths where two JSON values differ."""
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            yield from leaves(a.get(k), b.get(k), path + (k,))
    elif isinstance(a, list) and isinstance(b, list) and len(a) == len(b):
        for i, (x, y) in enumerate(zip(a, b)):
            yield from leaves(x, y, path + (i,))
    elif a != b:
        yield path


def at(value, path):
    for k in path:
        value = value[k]
    return value


def judged(sealed, corrected, ledgers, read, manifest, record):
    """What the corrected expectation gets wrong, how many cashbook items its
    sheets cite, and how many of the sealed rows it changes did not hold
    their entry."""
    out = []
    changed = list(leaves(sealed['stories'], corrected['stories']))
    for path in changed:
        item = at(corrected['stories'], path[:-1])
        if path[-1] != 'row' or item.get('side') != 'cashbook':
            out.append(f'a change other than a cashbook row: {".".join(map(str, path))}')
    if len(changed) != record['rows']:
        out.append(f'{len(changed)} rows changed, CORRECTION.json says {record["rows"]}')
    cited = wrong = 0
    for story, months in ledgers.items():
        for save, snapshot in corrected['stories'][story].items():
            sheet = snapshot.get('sheet') or {}
            for name, section in (sheet.get('sections') or {}).items():
                for k, item in enumerate(section['items']):
                    if item['side'] != 'cashbook':
                        continue
                    cited += 1
                    ledger, voucher = months[item['period']], item['id']
                    if item['source'] != manifest[ledger]['sha256']:
                        out.append(f'{save} {voucher}: not the ledger fingerprint')
                    holding = [r for r, cells in read[ledger].items() if voucher in cells]
                    if holding != [item['row']]:
                        out.append(f'{save} {voucher}: row {item["row"]}, the ledger holds it on {holding}')
                    before = sealed['stories'][story][save]['sheet']['sections'][name]['items'][k]
                    if before['row'] != item['row'] and voucher not in read[ledger].get(before['row'], []):
                        wrong += 1
    return out, cited, wrong


def first(stories, side):
    """The first sheet item of a side, in story and save order."""
    for saves in stories.values():
        for snapshot in saves.values():
            for section in ((snapshot.get('sheet') or {}).get('sections') or {}).values():
                for item in section['items']:
                    if item['side'] == side:
                        return item
    raise AssertionError(f'no {side} item')


PLANTS = {
    'a cashbook row moved by one': lambda s: first(s, 'cashbook').update(row=first(s, 'cashbook')['row'] + 1),
    'a cashbook row put back as the sealed one': lambda s: s['Y01']['Y01-JUL']['sheet']['sections'][
        'bookPaymentsNotOnStatement']['items'][0].update(row=11),
    'a cashbook amount changed': lambda s: first(s, 'cashbook').update(amount=first(s, 'cashbook')['amount'] + 1),
    'a statement page changed': lambda s: first(s, 'statement').update(page=2),
    'a cashbook fingerprint changed': lambda s: first(s, 'cashbook').update(source='0' * 64),
    'a status changed': lambda s: s['Y01']['Y01-JUL']['sheet'].update(status='reconciled'),
}


def problems():
    out = []
    seal = subprocess.run([sys.executable, '-B', str(PACKAGE / 'check_seal.py')], capture_output=True, text=True)
    if seal.returncode != 0:
        return [f'the sealed package: {seal.stdout[-1500:]}{seal.stderr[-1500:]}']
    record = json.loads((HERE / 'CORRECTION.json').read_text(encoding='utf-8'))
    for name, digest in record['pins'].items():
        if sha(HERE / name) != digest:
            out.append(f'{name} differs from CORRECTION.json')
    if record['corrects'] != sha(FROZEN / 'EXPECTED.json'):
        out.append('the sealed expectation is not the one corrected')
    spec = importlib.util.spec_from_file_location('cycle_correction_1', HERE / 'oracle.py')
    oracle = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(oracle)
    corrected = json.loads((HERE / 'EXPECTED.json').read_text(encoding='utf-8'))
    if corrected != json.loads(json.dumps(oracle.run(FROZEN, FROZEN / 'stories.json'))):
        out.append('oracle.py no longer reproduces EXPECTED.json')
    sealed = json.loads((FROZEN / 'EXPECTED.json').read_text(encoding='utf-8'))
    facts = json.loads((FROZEN / 'stories.json').read_text(encoding='utf-8'))
    manifest = json.loads((FROZEN / 'INPUT-MANIFEST.json').read_text(encoding='utf-8'))['files']
    ledgers = {s['id']: {p['id'].split('-')[1]: s['ledgers'][p['id']]['file'] for p in s['periods']}
               for s in facts['stories']}
    read = {f: texts(FROZEN / f) for months in ledgers.values() for f in months.values()}
    found, cited, wrong = judged(sealed, corrected, ledgers, read, manifest, record)
    out += found
    if cited != record['cited'] or wrong != record['rows']:
        out.append(f'{cited} cited, {wrong} sealed rows not holding their entry; '
                   f'CORRECTION.json says {record["cited"]} and {record["rows"]}')
    # The check itself: each planted fault in the corrected expectation is found.
    for name, plant in PLANTS.items():
        planted = copy.deepcopy(corrected)
        plant(planted['stories'])
        if not judged(sealed, planted, ledgers, read, manifest, record)[0]:
            out.append(f'the check does not find a planted fault: {name}')
    if not re.fullmatch(r'[0-9a-f]{7,40}', record['foundBy']['commit']):
        out.append('CORRECTION.json does not name the commit of the run that found it')
    return out


def main():
    found = problems()
    print(json.dumps({'correctionHolds': not found, 'plantedFaults': len(PLANTS), 'problems': found}, indent=1))
    if found:
        sys.exit(1)


if __name__ == '__main__':
    main()
