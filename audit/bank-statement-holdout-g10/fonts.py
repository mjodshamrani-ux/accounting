"""The G10 fonts, built from Fontsource npm packages (SIL Open Font License),
and DejaVu Sans, a system font here, recorded by its hash.

`npm pack @fontsource/<family>@<version>` and unpack each tarball into its own
folder `fontsource-<family>-<version>/package`; this file merges each family's
Latin and, where it has one, Arabic subset at weights 400 and 700 into one
TrueType file per weight, dated as the subsets are rather than by the clock,
so the same packages give the same bytes.

A standard ligature (fi, fl, ffi) loses its letters in both writers' text
layers: FOP writes it as a private-use character, and OpenPDF maps it, and
the glyphs after it, to the wrong letters ("Office Furniture" read as "Ofce
eurniture"). The Latin fonts given to both have the `liga` feature taken out
of every script and language; the glyphs and every other feature are the
family's. OpenPDF shapes Arabic from presentation forms, not from the font's
features, and gets Amiri unchanged.
"""
import hashlib
from pathlib import Path

PACKAGES = {
    'almarai': '5.3.0', 'amiri': '5.3.0', 'courier-prime': '5.3.0', 'markazi-text': '5.3.0', 'open-sans': '5.3.0',
}
WEIGHTS = ('400', '700')


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def subsets(files, family, weight):
    return [p for p in sorted(files.iterdir())
            if p.name in (f'{family}-latin-{weight}-normal.woff', f'{family}-arabic-{weight}-normal.woff')]


def without_ligatures(font):
    if 'GSUB' not in font:
        return font
    gsub = font['GSUB'].table
    liga = {i for i, r in enumerate(gsub.FeatureList.FeatureRecord) if r.FeatureTag == 'liga'}
    for record in gsub.ScriptList.ScriptRecord:
        script = record.Script
        for system in [script.DefaultLangSys] + [r.LangSys for r in script.LangSysRecord]:
            if system is None:
                continue
            if system.ReqFeatureIndex in liga:
                system.ReqFeatureIndex = 0xFFFF
            system.FeatureIndex = [i for i in system.FeatureIndex if i not in liga]
            system.FeatureCount = len(system.FeatureIndex)
    return font


def build(packages, out):
    """Writes <family>-<weight>.ttf and <family>-nl-<weight>.ttf into `out`;
    returns their provenance."""
    from fontTools.merge import Merger
    from fontTools.ttLib import TTFont
    packages, out = Path(packages), Path(out)
    (out / 'parts').mkdir(parents=True, exist_ok=True)
    made = {}
    for family, version in PACKAGES.items():
        files = packages / f'fontsource-{family}-{version}' / 'package' / 'files'
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
            plain = TTFont(str(target), recalcTimestamp=False)
            bare = out / f'{family}-nl-{weight}.ttf'
            without_ligatures(plain).save(str(bare))
            source = f"@fontsource/{family} {version}: {', '.join(p.name for p in subsets(files, family, weight))}"
            made[target.name] = {'source': source, 'recipe': 'merged by fontTools', 'sha256': sha(target)}
            made[bare.name] = {'source': source, 'recipe': 'merged by fontTools, liga removed', 'sha256': sha(bare)}
    return made
