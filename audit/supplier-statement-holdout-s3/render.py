"""Renders the S3 holdout into its frozen assets and writes the input manifest.

Statements are written by the HexaPDF statement service (ruby/statements.rb)
or by the pdf-lib statement application (js/render_pdflib.mjs) as each story
says; this file prepares each writer's jobs from the facts. Ledgers are CSV
(UTF-8, CRLF). The committed files under frozen/ are the assets, sealed by
INPUT-MANIFEST.json; this file is their recipe. The facts are not stored:
`python3 -B stories.py` regenerates them byte for byte, and the manifest
carries their hash, the oracle's, the writers' versions and the font files.

The Ruby service runs against the gems Bundler installs from
ruby/Gemfile.lock, the Node application against the packages npm installs
from js/package-lock.json, which also carries the fonts. Both are G23's
locks. A statement whose page count differs from the facts' is an error
here, and so is any text wider than its cell. HexaPDF sets the modification
date and document identifier on writing, and stamps each subset font, from
the clock: its statements differ between renders in those bytes alone.

  cp ruby/Gemfile ruby/Gemfile.lock <ruby dir> && (cd <ruby dir> && bundle config set --local path vendor/bundle && bundle install)
  cp js/package.json js/package-lock.json <js dir> && npm ci --prefix <js dir> --ignore-scripts
  PYTHONPATH=<pymupdf, fontTools> python3 -B render.py --modules <js dir>/node_modules --gems <ruby dir> [--out dir] [--work dir]
"""
import argparse
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
from common import AMOUNT_KEYS, columns, control_cells, footer, ledger_csv, movement_cells, preamble  # noqa: E402
from expected import expected  # noqa: E402
from stories import STORIES  # noqa: E402

VERSION = 'tarasuf-supplier-s3-1'
NODE_PACKAGES = ('pdf-lib', '@pdf-lib/fontkit', 'bidi-js')
COLOURS = {'Work Sans': '6B4226', 'Merriweather': '2F2F2F', 'Space Mono': '333333', 'Fira Sans': '3E3A5C',
           'Lemonada': '2B4C7E', 'Tajawal': '1F5C5C', 'Alexandria': '5C5C5C', 'Readex Pro': '3F4E5E',
           'Rubik': '333333'}
# Smaller type where the widest cell would not fit at 7.2 points.
SIZES = {'Space Mono': 6.4, 'Merriweather': 7.0, 'Lemonada': 6.6}


def sha(b):
    return hashlib.sha256(b).hexdigest()


def facts_json():
    return json.dumps(STORIES, ensure_ascii=False, indent=1) + '\n'


def oracle_json():
    return json.dumps({'version': 'tarasuf-supplier-s3-oracle-1', 'stories': [expected(s) for s in STORIES]},
                      ensure_ascii=False, indent=1) + '\n'


def page_rows(story):
    """Each page's printed rows: an opening or brought-forward line, the
    movements, a carried-forward line or, on the last page, the total (where
    the story prints one) and the closing balance."""
    keys = [k for k, _, _ in columns(story)]
    pages, out = story['pages'], []
    before = story['opening']
    for n, lines in enumerate(pages):
        rows = [control(story, keys, {'kind': 'opening' if n == 0 else 'brought-forward', 'balance': before})]
        rows += [{'kind': 'movement', 'cells': movement_cells(story, line)} for line in lines]
        after = lines[-1]['balance']
        if n < len(pages) - 1:
            rows.append(control(story, keys, {'kind': 'carried-forward', 'balance': after}))
        else:
            if story['total']:
                sar = [line for p in pages for line in p if line.get('currency', 'SAR') == 'SAR']
                rows.append(control(story, keys, {'kind': 'total',
                                                  'debit': sum(m['minor'] for m in sar if m['minor'] > 0),
                                                  'credit': -sum(m['minor'] for m in sar if m['minor'] < 0)}))
            rows.append(control(story, keys, {'kind': 'closing', 'balance': story['closing']}))
        out.append({'footer': footer(story, n + 1, len(pages)), 'rows': rows})
        before = after
    return out


def control(story, keys, line):
    label, values = control_cells(story, line)
    return {'kind': 'control', 'label': label, 'values': {str(keys.index(k)): v for k, v in values.items()}}


def jobs_of(stories, producer, modules, out):
    jobs = []
    for story in stories:
        if story['producer'] != producer:
            continue
        if producer == 'hexapdf':
            assert story['language'] == 'en', 'HexaPDF draws without shaping: English statements only'
        regular = fonts.files_of(modules, story['font'], '400')
        job = {
            'id': story['id'], 'out': str(Path(out) / f"{story['id']}-statement.pdf"), 'paper': story['paper'],
            'language': story['language'], 'regular': str(regular),
            'bold': str(fonts.files_of(modules, story['font'], '700')),
            'size': SIZES.get(story['font'], 7.2), 'style': story['style'], 'fill': COLOURS[story['font']],
            'preamble': preamble(story), 'account': story['account'],
            'columns': [{'key': k, 'heading': h, 'share': w, 'amount': k in AMOUNT_KEYS}
                        for k, h, w in columns(story)],
            'pages': page_rows(story),
        }
        if producer == 'hexapdf':
            ascent, line_height = fonts.metrics(regular)
            job['ascent'], job['lineHeight'] = round(ascent, 6), round(line_height, 6)
        fonts.check_covers(job)
        jobs.append(job)
    return jobs


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
                                       'puts JSON.dump(hexapdf: Gem.loaded_specs["hexapdf"].version.to_s, '
                                       'ruby: RUBY_VERSION)'))
    locked = re.search(r'^    hexapdf \(([^)]+)\)$', lock, re.M).group(1)
    if loaded['hexapdf'] != locked:
        raise ValueError(f"hexapdf {loaded['hexapdf']} loaded, {locked} locked")
    return loaded


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
    written = []
    for story in STORIES:
        path = out / f"{story['id']}-ledger.csv"
        path.write_bytes(ledger_csv(story).encode('utf-8'))
        written.append(path)
    oracle = oracle_json().encode('utf-8')
    (out / 'expected.json').write_bytes(oracle)
    written.append(out / 'expected.json')
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(args.work or tmp).resolve()
        work.mkdir(parents=True, exist_ok=True)
        hexapdf = jobs_of(STORIES, 'hexapdf', modules, out)
        (work / 'hexapdf.json').write_text(json.dumps({'statements': hexapdf}, ensure_ascii=False, indent=1),
                                           encoding='utf-8')
        ruby(gems, str(HERE / 'ruby' / 'statements.rb'), str(work / 'hexapdf.json'))
        pdflib = jobs_of(STORIES, 'pdflib', modules, out)
        (work / 'pdflib.json').write_text(json.dumps({'statements': pdflib}, ensure_ascii=False, indent=1),
                                          encoding='utf-8')
        subprocess.run(['node', str(HERE / 'js' / 'render_pdflib.mjs'), str(modules), str(work / 'pdflib.json')],
                       check=True)
        if len(hexapdf) + len(pdflib) != len(STORIES):
            raise ValueError('a story has no writer')
        for story in STORIES:
            path = out / f"{story['id']}-statement.pdf"
            if page_count(path) != len(story['pages']):
                raise ValueError(f"{story['id']}: {page_count(path)} pages drawn for {len(story['pages'])}")
            written.append(path)
    node_version = subprocess.run(['node', '--version'], check=True, capture_output=True, text=True).stdout.strip()
    facts = facts_json().encode('utf-8')
    manifest = {
        'version': VERSION,
        'producers': {'hexapdf': loaded['hexapdf'], 'ruby': loaded['ruby'], 'pdf-lib': node['pdf-lib'],
                      '@pdf-lib/fontkit': node['@pdf-lib/fontkit'], 'bidi-js': node['bidi-js'],
                      'node': node_version.lstrip('v'), 'ledgerCsv': 'Python csv, UTF-8, CRLF'},
        'fonts': fonts.provenance(modules, {s['font'] for s in STORIES}),
        'facts': {'file': 'stories.json', 'stored': False,
                  'recipe': 'python3 -B audit/supplier-statement-holdout-s3/stories.py',
                  'sha256': sha(facts), 'bytes': len(facts)},
        'files': [{'file': p.name, 'sha256': sha(p.read_bytes()), 'bytes': p.stat().st_size}
                  for p in sorted(written, key=lambda p: p.name)],
    }
    (out / 'INPUT-MANIFEST.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + '\n',
                                             encoding='utf-8')
    print(json.dumps({'files': len(manifest['files']), 'producers': manifest['producers']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
