"""The G14 fonts not shipped with a writer, built from Fontsource npm packages
(SIL Open Font License).

js/package.json installs the packages; this file reads each family's files
from <modules>/@fontsource/<family>/files, checks the installed version
against PACKAGES, and merges its Latin and Arabic subsets at weights 400
and 700 into one TrueType file per weight, dated as the subsets are rather
than by the clock, so the same packages give the same bytes. TCPDF converts
IBM Plex Sans Arabic with addTTFfont and writes Arabic in its presentation
forms, which the font maps; mPDF reads it and shapes it by its own OpenType
layout. The file is not changed beyond the merge.

DejaVu Sans, DejaVu Sans Mono, DejaVu Serif and FreeSans are the writers' own
fonts, in their packages; render.py records their hashes.
"""
import hashlib
import json
from pathlib import Path

PACKAGES = {'ibm-plex-sans-arabic': '5.3.0'}
WEIGHTS = ('400', '700')


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def subsets(files, family, weight):
    return [p for p in sorted(files.iterdir())
            if p.name in (f'{family}-latin-{weight}-normal.woff', f'{family}-arabic-{weight}-normal.woff')]


def build(modules, out):
    """Writes <family>-<weight>.ttf into `out`; returns their provenance."""
    from fontTools.merge import Merger
    from fontTools.ttLib import TTFont
    modules, out = Path(modules), Path(out)
    (out / 'parts').mkdir(parents=True, exist_ok=True)
    made = {}
    for family, version in PACKAGES.items():
        package = modules / '@fontsource' / family
        installed = json.loads((package / 'package.json').read_text(encoding='utf-8'))['version']
        if installed != version:
            raise ValueError(f'@fontsource/{family} {installed} installed, {version} expected')
        files = package / 'files'
        for weight in WEIGHTS:
            parts, stamps = [], []
            for woff in subsets(files, family, weight):
                font = TTFont(str(woff), recalcTimestamp=False)
                font.flavor = None
                part = out / 'parts' / woff.name.replace('.woff', '.ttf')
                font.save(str(part))
                parts.append(part)
                stamps.append((font['head'].created, font['head'].modified))
            merged = Merger().merge([str(p) for p in parts]) if len(parts) > 1 else TTFont(str(parts[0]))
            # The merger stamps the clock; the subsets' own dates keep the bytes the same.
            merged['head'].created = min(c for c, _ in stamps)
            merged['head'].modified = max(m for _, m in stamps)
            merged.recalcTimestamp = False
            target = out / f'{family}-{weight}.ttf'
            merged.save(str(target))
            source = f"@fontsource/{family} {version}: {', '.join(p.name for p in subsets(files, family, weight))}"
            made[target.name] = {'source': source, 'recipe': 'merged by fontTools', 'sha256': sha(target)}
    return made
