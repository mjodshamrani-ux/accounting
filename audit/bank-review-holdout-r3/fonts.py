"""The G23 fonts, as npm installs them from js/package-lock.json.

Each family is a file a developer would take as it is: the Google Fonts
TrueType files that the @expo-google-fonts packages carry, whole, the Arabic
families with their Latin letters and both kinds of digits in one file. No
file is converted, subset or merged here: HexaPDF and pdf-lib read the file
and subset it themselves. `files_of` names a family's file at a weight;
`metrics` gives the hhea ascent and the line height the HexaPDF service sets
its lines by; `provenance` checks each installed package's version against
PACKAGES and records each file's hash. Copied from G20's fonts.py with
G23's families.
"""
import hashlib
import json
from pathlib import Path

# family: (package, version, file at 400, file at 700)
PACKAGES = {
    'Work Sans': ('@expo-google-fonts/work-sans', '0.4.2', '400Regular/WorkSans_400Regular.ttf',
                  '700Bold/WorkSans_700Bold.ttf'),
    'Merriweather': ('@expo-google-fonts/merriweather', '0.4.2', '400Regular/Merriweather_400Regular.ttf',
                     '700Bold/Merriweather_700Bold.ttf'),
    'Space Mono': ('@expo-google-fonts/space-mono', '0.4.2', '400Regular/SpaceMono_400Regular.ttf',
                   '700Bold/SpaceMono_700Bold.ttf'),
    'Fira Sans': ('@expo-google-fonts/fira-sans', '0.4.1', '400Regular/FiraSans_400Regular.ttf',
                  '700Bold/FiraSans_700Bold.ttf'),
    'Lemonada': ('@expo-google-fonts/lemonada', '0.4.2', '400Regular/Lemonada_400Regular.ttf',
                 '700Bold/Lemonada_700Bold.ttf'),
    'Tajawal': ('@expo-google-fonts/tajawal', '0.4.1', '400Regular/Tajawal_400Regular.ttf',
                '700Bold/Tajawal_700Bold.ttf'),
    'Cairo': ('@expo-google-fonts/cairo', '0.4.2', '400Regular/Cairo_400Regular.ttf', '700Bold/Cairo_700Bold.ttf'),
    'Alexandria': ('@expo-google-fonts/alexandria', '0.4.2', '400Regular/Alexandria_400Regular.ttf',
                   '700Bold/Alexandria_700Bold.ttf'),
    'Readex Pro': ('@expo-google-fonts/readex-pro', '0.4.1', '400Regular/ReadexPro_400Regular.ttf',
                   '700Bold/ReadexPro_700Bold.ttf'),
    'Rubik': ('@expo-google-fonts/rubik', '0.4.2', '400Regular/Rubik_400Regular.ttf', '700Bold/Rubik_700Bold.ttf'),
}


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def files_of(modules, family, weight):
    """The installed file of a family at weight '400' or '700'."""
    package, _, regular, bold = PACKAGES[family]
    return Path(modules) / package / (regular if weight == '400' else bold)


def metrics(path):
    """(ascent, line height) in em, from the font's hhea table."""
    from fontTools.ttLib import TTFont
    font = TTFont(str(path), lazy=True)
    upem, hhea = font['head'].unitsPerEm, font['hhea']
    return hhea.ascent / upem, (hhea.ascent - hhea.descent + hhea.lineGap) / upem


def check_covers(job):
    """Raises unless both of a job's fonts map every character the job
    draws: a font without a glyph draws its .notdef box (Tajawal has no
    Arabic decimal or thousands separator)."""
    from fontTools.ttLib import TTFont
    texts = [job['bank'], job['title'], job['account'], *job['headers']]
    for page in job['pages']:
        texts.append(page['footer'])
        texts += [cell for row in page['rows'] for cell in row['cells']]
    wanted = {ch for text in texts for ch in text}
    for weight in ('regular', 'bold'):
        cmap = TTFont(job[weight]).getBestCmap()
        missing = {ch for ch in wanted if ord(ch) not in cmap}
        if missing:
            names = ', '.join(f'U+{ord(ch):04X}' for ch in sorted(missing))
            raise ValueError(f"{job['id']}: {Path(job[weight]).name} has no glyph for {names}")


def provenance(modules, families):
    """{file name: source and hash} for each family's two files, after
    checking each package's installed version."""
    made = {}
    for family in sorted(families):
        package, version, *_ = PACKAGES[family]
        installed = json.loads((Path(modules) / package / 'package.json').read_text(encoding='utf-8'))['version']
        if installed != version:
            raise ValueError(f'{package} {installed} installed, {version} expected')
        for weight in ('400', '700'):
            path = files_of(modules, family, weight)
            made[path.name] = {'source': f'{package} {version}: {path.relative_to(Path(modules) / package)}',
                               'sha256': sha(path)}
    return made
