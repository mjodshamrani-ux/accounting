"""The G17 fonts, built from Fontsource npm packages (SIL Open Font License).

js/package.json installs the packages; this file reads each family's files
from <modules>/@fontsource/<family>/files, checks the installed version
against PACKAGES, and converts each subset at weights 400 and 700 to a
TrueType file of its own, dated as the subset is rather than by the clock,
so the same packages give the same bytes. Nothing is merged:

- Prawn reads the Latin file of its family and subsets it;
- the cairo application keeps the Arabic and the Latin file of a family
  apart, as fontconfig offers a GTK application the fonts that cover each
  run, and draws each run with the file whose cmap covers it, Arabic first
  for an Arabic family. HarfBuzz shapes Arabic by the font's own GSUB
  features (init, medi, fina, rlig); the fonts need no presentation forms.

The file is not changed beyond the conversion.
"""
import hashlib
import json
from pathlib import Path

PACKAGES = {
    'libre-franklin': ('5.3.0', ['latin']),
    'merriweather': ('5.3.0', ['latin']),
    'ubuntu-mono': ('5.3.0', ['latin']),
    'nunito-sans': ('5.3.0', ['latin']),
    'work-sans': ('5.3.0', ['latin']),
    'public-sans': ('5.3.0', ['latin']),
    'source-code-pro': ('5.3.1', ['latin']),
    'readex-pro': ('5.3.0', ['arabic', 'latin']),
    'rubik': ('5.3.0', ['arabic', 'latin']),
    'alexandria': ('5.3.0', ['arabic', 'latin']),
}
WEIGHTS = ('400', '700')


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def family_key(name):
    """'Readex Pro' -> 'readex-pro'."""
    return name.lower().replace(' ', '-')


def files_of(fonts, name, weight):
    """The built files of a family at a weight, in fallback order."""
    family = family_key(name)
    return [Path(fonts) / f'{family}-{script}-{weight}.ttf' for script in PACKAGES[family][1]]


def build(modules, out):
    """Writes <family>-<script>-<weight>.ttf into `out`; returns their
    provenance."""
    from fontTools.ttLib import TTFont
    modules, out = Path(modules), Path(out)
    out.mkdir(parents=True, exist_ok=True)
    made = {}
    for family, (version, scripts) in PACKAGES.items():
        package = modules / '@fontsource' / family
        installed = json.loads((package / 'package.json').read_text(encoding='utf-8'))['version']
        if installed != version:
            raise ValueError(f'@fontsource/{family} {installed} installed, {version} expected')
        for weight in WEIGHTS:
            for script in scripts:
                woff = package / 'files' / f'{family}-{script}-{weight}-normal.woff'
                font = TTFont(str(woff), recalcTimestamp=False)
                if 'glyf' not in font:
                    raise ValueError(f'{woff.name} has no TrueType outlines')
                font.flavor = None
                target = out / f'{family}-{script}-{weight}.ttf'
                font.save(str(target))
                made[target.name] = {'source': f'@fontsource/{family} {version}: {woff.name}',
                                     'recipe': 'converted by fontTools', 'sha256': sha(target)}
    return made
