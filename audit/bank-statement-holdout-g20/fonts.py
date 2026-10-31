"""The G20 fonts, as npm installs them from js/package-lock.json.

Each family is a file a developer would take as it is: the Google Fonts
TrueType files that the @expo-google-fonts packages carry, whole, the Arabic
families with their Latin letters and both kinds of digits in one file; and
Source Sans 3 as Adobe's OpenType CFF file from the source-sans package. No
file is converted, subset or merged here: iText and PDFKit read the file and
subset it themselves (iText embeds an OpenType CFF font in a simple encoding
whole). `files_of` names a family's file at a weight; `provenance` checks
each installed package's version against PACKAGES and records each file's
hash.
"""
import hashlib
import json
from pathlib import Path

# family: (package, version, file at 400, file at 700)
PACKAGES = {
    'Karla': ('@expo-google-fonts/karla', '0.4.2', '400Regular/Karla_400Regular.ttf', '700Bold/Karla_700Bold.ttf'),
    'Lora': ('@expo-google-fonts/lora', '0.4.2', '400Regular/Lora_400Regular.ttf', '700Bold/Lora_700Bold.ttf'),
    'Roboto Mono': ('@expo-google-fonts/roboto-mono', '0.4.2', '400Regular/RobotoMono_400Regular.ttf',
                    '700Bold/RobotoMono_700Bold.ttf'),
    'DM Sans': ('@expo-google-fonts/dm-sans', '0.4.2', '400Regular/DMSans_400Regular.ttf',
                '700Bold/DMSans_700Bold.ttf'),
    'Inconsolata': ('@expo-google-fonts/inconsolata', '0.4.2', '400Regular/Inconsolata_400Regular.ttf',
                    '700Bold/Inconsolata_700Bold.ttf'),
    'Changa': ('@expo-google-fonts/changa', '0.4.2', '400Regular/Changa_400Regular.ttf', '700Bold/Changa_700Bold.ttf'),
    'Kufam': ('@expo-google-fonts/kufam', '0.4.1', '400Regular/Kufam_400Regular.ttf', '700Bold/Kufam_700Bold.ttf'),
    'Baloo Bhaijaan 2': ('@expo-google-fonts/baloo-bhaijaan-2', '0.4.2', '400Regular/BalooBhaijaan2_400Regular.ttf',
                         '700Bold/BalooBhaijaan2_700Bold.ttf'),
    'Source Sans 3': ('source-sans', '3.52.0', 'OTF/SourceSans3-Regular.otf', 'OTF/SourceSans3-Bold.otf'),
}


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def files_of(modules, family, weight):
    """The installed file of a family at weight '400' or '700'."""
    package, _, regular, bold = PACKAGES[family]
    return Path(modules) / package / (regular if weight == '400' else bold)


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
