"""The G15 fonts, built from Fontsource npm packages (SIL Open Font License).

js/package.json installs the packages; this file reads each family's files
from <modules>/@fontsource/<family>/files, checks the installed version
against PACKAGES, and merges its subsets at weights 400 and 700 into one
TrueType file per weight (Latin, and Arabic for an Arabic family), dated as
the subsets are rather than by the clock, so the same packages give the same
bytes. Dompdf reads a file through @font-face and subsets it; go-pdf/fpdf
reads it with AddUTF8FontFromBytes and subsets it. Neither writer shapes
Arabic: the Go application draws presentation forms, which these fonts map.
The file is not changed beyond the merge.
"""
import hashlib
import json
from pathlib import Path

PACKAGES = {
    'source-sans-3': ('5.3.1', ['latin']),
    'pt-serif': ('5.3.0', ['latin']),
    'space-mono': ('5.3.0', ['latin']),
    'ibm-plex-sans': ('5.3.0', ['latin']),
    'barlow': ('5.3.0', ['latin']),
    'red-hat-mono': ('5.3.0', ['latin']),
    'noto-sans-arabic': ('5.3.0', ['latin', 'arabic']),
    'vazirmatn': ('5.3.0', ['latin', 'arabic']),
    'el-messiri': ('5.3.0', ['latin', 'arabic']),
}
WEIGHTS = ('400', '700')


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def subsets(files, family, weight, scripts):
    return [files / f'{family}-{script}-{weight}-normal.woff' for script in scripts]


def build(modules, out):
    """Writes <family>-<weight>.ttf into `out`; returns their provenance."""
    from fontTools.merge import Merger
    from fontTools.ttLib import TTFont
    modules, out = Path(modules), Path(out)
    (out / 'parts').mkdir(parents=True, exist_ok=True)
    made = {}
    for family, (version, scripts) in PACKAGES.items():
        package = modules / '@fontsource' / family
        installed = json.loads((package / 'package.json').read_text(encoding='utf-8'))['version']
        if installed != version:
            raise ValueError(f'@fontsource/{family} {installed} installed, {version} expected')
        files = package / 'files'
        for weight in WEIGHTS:
            parts, stamps = [], []
            for woff in subsets(files, family, weight, scripts):
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
            source = f"@fontsource/{family} {version}: {', '.join(p.name for p in subsets(files, family, weight, scripts))}"
            made[target.name] = {'source': source, 'recipe': 'merged by fontTools' if len(parts) > 1 else 'converted by fontTools',
                                 'sha256': sha(target)}
    return made
