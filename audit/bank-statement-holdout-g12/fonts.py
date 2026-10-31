"""The G12 fonts, built from Fontsource npm packages (SIL Open Font License).

js/package.json installs the packages with the jsPDF writer; this file reads
each family's files from js/node_modules/@fontsource/<family>/files, checks
the installed version against PACKAGES, and merges its Latin and, where it
has one, Arabic subset at weights 400 and 700 into one TrueType file per
weight, dated as the subsets are rather than by the clock, so the same
packages give the same bytes. jsPDF applies none of a font's substitutions
and gets the merged fonts unchanged. Arabic is shaped into presentation
forms by jsPDF and, for PDFBox, by ICU4J.

PDFBox 3 applies a font's ccmp, liga and clig features itself when it
writes text in a font whose substitutions include Latin
(GsubWorkerForLatin), and writes a ligature's glyph with no text for its
letters: "insufficient" would read "insuf?cient". The copies given to PDFBox
(<family>-pdfbox-<weight>.ttf) have the liga and clig features taken out
of every script and language; the glyphs and every other feature are the
family's.

PDFBox also writes each glyph's text as the lowest code point the font maps
to it. Noto Naskh Arabic and Noto Kufi Arabic draw several letters with one
glyph: the final alef maksura is the Farsi yeh's final form (U+FEF0 and
U+FBFD), the initial and medial yeh the Farsi yeh's (U+FEF3, U+FEF4 and
U+FBFE, U+FBFF), the isolated heh the letter ae (U+FEE9 and U+06D5), so a
PDFBox statement in them would carry ی and ە in its text layer where it
prints ى, ي and ه. Their PDFBox copies also keep, for each such glyph,
only the code points that are the Arabic letters U+0621 to U+064A or their
presentation forms; every other mapping is the family's. jsPDF writes the
code points it was given.
"""
import hashlib
import json
import unicodedata
from pathlib import Path

PACKAGES = {
    'fira-sans': '5.3.0', 'jetbrains-mono': '5.3.0', 'noto-sans': '5.3.0',
    'noto-naskh-arabic': '5.3.0', 'noto-kufi-arabic': '5.3.0',
}
WEIGHTS = ('400', '700')
ARABIC_LETTERS = range(0x0621, 0x064B)
LIGATURES = {'liga', 'clig'}


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def subsets(files, family, weight):
    return [p for p in sorted(files.iterdir())
            if p.name in (f'{family}-latin-{weight}-normal.woff', f'{family}-arabic-{weight}-normal.woff')]


def without_ligatures(font):
    """Takes the liga and clig features out of every script and language."""
    if 'GSUB' not in font:
        return font
    gsub = font['GSUB'].table
    drop = {i for i, r in enumerate(gsub.FeatureList.FeatureRecord) if r.FeatureTag in LIGATURES}
    for record in gsub.ScriptList.ScriptRecord:
        script = record.Script
        for system in [script.DefaultLangSys] + [r.LangSys for r in script.LangSysRecord]:
            if system is None:
                continue
            if system.ReqFeatureIndex in drop:
                system.ReqFeatureIndex = 0xFFFF
            system.FeatureIndex = [i for i in system.FeatureIndex if i not in drop]
            system.FeatureCount = len(system.FeatureIndex)
    return font


def letter(code):
    """The letter a code point names after NFKC, or None for anything else."""
    text = unicodedata.normalize('NFKC', chr(code))
    return ord(text) if len(text) == 1 else None


def unaliased(font):
    """Drops the code points that share a glyph with an Arabic letter but name
    another letter; returns what was dropped."""
    by_glyph = {}
    for code, glyph in font.getBestCmap().items():
        by_glyph.setdefault(glyph, []).append(code)
    drop = set()
    for codes in by_glyph.values():
        letters = {letter(c) for c in codes}
        if len(letters) > 1 and letters & set(ARABIC_LETTERS):
            drop |= {c for c in codes if letter(c) not in ARABIC_LETTERS}
    for table in font['cmap'].tables:
        if table.isUnicode():
            table.cmap = {c: g for c, g in table.cmap.items() if c not in drop}
    return sorted(drop)


def build(modules, out):
    """Writes <family>-<weight>.ttf and <family>-pdfbox-<weight>.ttf into
    `out`; returns their provenance."""
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
            copy = without_ligatures(TTFont(str(target), recalcTimestamp=False))
            dropped = unaliased(copy)
            pdfbox = out / f'{family}-pdfbox-{weight}.ttf'
            copy.save(str(pdfbox))
            recipe = 'merged by fontTools, liga and clig removed'
            if dropped:
                recipe += '; code points dropped from cmap: ' + ' '.join(f'U+{c:04X}' for c in dropped)
            made[pdfbox.name] = {'source': source, 'recipe': recipe, 'sha256': sha(pdfbox)}
    return made
