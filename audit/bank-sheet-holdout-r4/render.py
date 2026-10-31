"""Renders the R4 holdout into its frozen assets and writes the input manifest.

Each period's statement is drawn by the HexaPDF statement service
(ruby/statements.rb, prepared by render_hexapdf.py) or by the pdf-lib
statement application (js/render_pdflib.mjs, prepared by render_pdflib.py),
as its story's `print` says; both are copied unchanged from the G23 holdout,
with their common.py and fonts.py. Each period's cashbook is CSV (UTF-8,
CRLF, common.cashbook_csv). The previous-period session file each story
brings is written here from the documented session format, never by the
product:
  bank-statement-lifecycle-1: {format, version, files: [statement, cashbook]
    as {name, sha256, data (base64)}, scope, decisions};
  bank-statement-roll-1 (proposed, audit/bank-roll-foundation/contract.json):
    the same, and `previous`: the previous session file as {name, sha256, data}.
A decision's context is the one bank-statement-lifecycle-1 documents: the
lifecycle version, the statement family, both file hashes, the statement
currency and printed period, the confirmed closing (null for a PDF) and how
completeness was proved ('printed'). No decision is recorded in a session of
the roll format: its context is not documented outside the product.

HexaPDF sets the modification date and the document identifier on writing
and stamps each subset font's head table from the clock, so a re-render is
not byte-equal: the committed files under frozen/ are the assets, sealed by
INPUT-MANIFEST.json. The facts are not stored: `python3 -B stories.py`
regenerates them byte for byte, and the manifest carries their hash.

  PYTHONPATH=<pymupdf, fontTools> python3 -B render.py --modules <js dir>/node_modules --gems <ruby dir> [--out dir] [--work dir]
"""
import argparse
import base64
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import fonts  # noqa: E402
import render_hexapdf  # noqa: E402
import render_pdflib  # noqa: E402
from common import cashbook_csv  # noqa: E402
from stories import VERSION, facts, facts_json, print_records  # noqa: E402

NODE_PACKAGES = ('pdf-lib', '@pdf-lib/fontkit', 'bidi-js')
GEMS = ('hexapdf',)
LIFECYCLE = 'bank-statement-lifecycle-1'
ROLL = 'bank-statement-roll-1'


def sha(b):
    return hashlib.sha256(b).hexdigest()


def page_count(path):
    import pymupdf
    with pymupdf.open(str(path)) as doc:
        return doc.page_count


def node_packages(modules):
    lock = json.loads((HERE / 'js' / 'package-lock.json').read_text(encoding='utf-8'))['packages']
    out = {}
    for name in NODE_PACKAGES:
        installed = json.loads((Path(modules) / name / 'package.json').read_text(encoding='utf-8'))['version']
        locked = lock[f'node_modules/{name}']['version']
        if installed != locked:
            raise ValueError(f'{name} {installed} installed, {locked} locked')
        out[name] = installed
    return out


def ruby(gems, *args):
    env = dict(os.environ, BUNDLE_GEMFILE=str(Path(gems) / 'Gemfile'))
    done = subprocess.run(['bundle', 'exec', 'ruby', *args], env=env, capture_output=True, text=True)
    if done.returncode:
        raise RuntimeError(f'ruby {args[0]} failed:\n{done.stderr}')
    return done.stdout


def gem_versions(gems):
    lock = (HERE / 'ruby' / 'Gemfile.lock').read_text(encoding='utf-8')
    if lock != (Path(gems) / 'Gemfile.lock').read_text(encoding='utf-8'):
        raise ValueError(f'{gems}/Gemfile.lock is not ruby/Gemfile.lock')
    loaded = json.loads(ruby(gems, '-e', 'require "json"; require "hexapdf"; '
                                       'puts JSON.dump(hexapdf: Gem.loaded_specs["hexapdf"].version.to_s, ruby: RUBY_VERSION)'))
    for name in GEMS:
        locked = re.search(rf'^    {re.escape(name)} \(([^)]+)\)$', lock, re.M).group(1)
        if loaded[name] != locked:
            raise ValueError(f'{name} {loaded[name]} loaded, {locked} locked')
    return loaded


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def session(statement, cashbook, period, decisions, previous):
    """A session file from originals, scope and decisions, in the documented
    format; `previous` makes it the proposed roll format."""
    files = [{'name': name, 'sha256': sha(data), 'data': base64.b64encode(data).decode('ascii')}
             for name, data in (statement, cashbook)]
    st = period['statement']
    context = compact([LIFECYCLE, 'bank-statement-native-1', [f['sha256'] for f in files], st['currency'],
                       {'start': st['period']['start'], 'end': st['period']['end']}, None, 'printed'])
    if previous and decisions:
        raise ValueError('no decision is recorded in a session of the roll format')
    body = {
        'format': 'tarasuf-bank-statement-session',
        'version': ROLL if previous else LIFECYCLE,
        'files': files,
        'scope': {'currency': None, 'period': None, 'confirmedClosing': None},
        'decisions': [{'id': f'D{i + 1}', 'type': d['type'], 'context': context, 'at': f'2028-01-02T10:0{i}:00.000Z',
                       'case': d['case'], 'statement': d['statement'], 'cashbook': d['cashbook'], 'note': d['note']}
                      for i, d in enumerate(decisions)],
    }
    if previous:
        name, data = previous
        body['previous'] = {'name': name, 'sha256': sha(data), 'data': base64.b64encode(data).decode('ascii')}
    return compact(body).encode('utf-8')


def sessions(f, out):
    """The previous-period session each story brings; a chain's sessions
    each carry the one before."""
    written = []
    for s in f['stories']:
        if not s['previous']:
            continue
        by_month = {p['id'].split('-')[1]: p for p in s['periods']}
        previous = None
        holds = s['previous']['holds']
        for k, month in enumerate(holds):
            p = by_month[month]
            statement = (f"{p['id']}-statement.pdf", (out / f"{p['id']}-statement.pdf").read_bytes())
            cashbook = (f"{p['id']}-cashbook.csv", (out / f"{p['id']}-cashbook.csv").read_bytes())
            last = k == len(holds) - 1
            data = session(statement, cashbook, p, s['previous']['decisions'] if last else [], previous)
            previous = (f"{s['id']}-{month}-session.json", data)
        data = previous[1]
        if s['previous'].get('tamper') == 'version':
            edited = data.replace(b'"version":"bank-statement-lifecycle-1"', b'"version":"bank-statement-lifecycle-2"', 1)
            if edited == data:
                raise ValueError(f"{s['id']}: nothing to tamper")
            data = edited
        elif s['previous'].get('tamper'):
            raise ValueError(f"{s['id']}: unknown tamper {s['previous']['tamper']}")
        path = out / f"{s['id']}-previous-session.json"
        path.write_bytes(data)
        written.append(path)
    return written


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', default=str(HERE / 'frozen'))
    parser.add_argument('--work', default=None)
    parser.add_argument('--modules', required=True)
    parser.add_argument('--gems', required=True)
    args = parser.parse_args()
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    modules, gems = Path(args.modules).resolve(), Path(args.gems).resolve()
    node = node_packages(modules)
    loaded = gem_versions(gems)
    text = facts_json()
    f = facts()
    records = print_records(f)
    written = []
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(args.work or tmp).resolve()
        work.mkdir(parents=True, exist_ok=True)
        for r in records:
            path = out / f"{r['id']}-cashbook.csv"
            path.write_bytes(cashbook_csv(r).encode('utf-8'))
            written.append(path)
        drawn = render_hexapdf.prepare(records, work / 'hexapdf', modules, out)
        ruby(gems, str(HERE / 'ruby' / 'statements.rb'), str(work / 'hexapdf' / 'statements.json'))
        drawn += render_pdflib.prepare(records, work / 'pdflib', modules, out)
        subprocess.run(['node', str(HERE / 'js' / 'render_pdflib.mjs'), str(modules),
                        str(work / 'pdflib' / 'statements.json')], check=True)
        for r, path in drawn:
            if page_count(path) != len(r['statement']['pages']):
                raise ValueError(f"{r['id']}: {page_count(path)} pages drawn for {len(r['statement']['pages'])}")
            written.append(path)
        if len(drawn) != len(records):
            raise ValueError('a statement has no writer')
    written += sessions(f, out)
    node_version = subprocess.run(['node', '--version'], check=True, capture_output=True, text=True).stdout.strip()
    manifest = {
        'version': VERSION,
        'producers': {
            'hexapdf': loaded['hexapdf'], 'ruby': loaded['ruby'],
            'pdf-lib': node['pdf-lib'], '@pdf-lib/fontkit': node['@pdf-lib/fontkit'], 'bidi-js': node['bidi-js'],
            'node': node_version.lstrip('v'),
            'cashbookCsv': 'Python csv, UTF-8, CRLF',
            'sessions': 'render.py, from the documented session format',
        },
        'fonts': fonts.provenance(modules, {r['font'] for r in records}),
        'facts': {'file': 'stories.json', 'stored': False, 'recipe': 'python3 -B audit/bank-sheet-holdout-r4/stories.py',
                  'sha256': sha(text.encode('utf-8')), 'bytes': len(text.encode('utf-8'))},
        'files': {p.name: {'sha256': sha(p.read_bytes()), 'bytes': p.stat().st_size}
                  for p in sorted(written, key=lambda p: p.name)},
    }
    (out / 'INPUT-MANIFEST.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(json.dumps({'files': len(manifest['files']), 'producers': manifest['producers']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
