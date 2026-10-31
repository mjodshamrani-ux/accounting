"""Seal the AI-1a statements before any product run on them.

Run after render.py, verify.py and the eligibility check have written into
frozen/. SEAL.json pins, by hash, the judge, the measure and the runner
(judge.mjs, score.mjs, measure.mjs), which may not change after the seal,
and records the tools that made the files, which may.

  python3 -B audit/ai-column-roles-foundation/seal.py
"""
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
PINNED = ('judge.mjs', 'score.mjs', 'measure.mjs')
TOOLS = ('stories.py', 'roles.py', 'common.py', 'fonts.py', 'render.py', 'expected.py', 'verify.py', 'test_intent.py',
         'check_seal.py', 'ruby/statements.rb', 'ruby/Gemfile', 'ruby/Gemfile.lock', 'js/render_pdflib.mjs',
         'js/package.json', 'js/package-lock.json')


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    frozen = HERE / 'frozen'
    seal = {
        'version': 'tarasuf-ai1-columns-1',
        'pinned': {name: sha(HERE / name) for name in PINNED},
        'tools': {name: sha(HERE / name) for name in TOOLS},
        'manifestSha256': sha(frozen / 'INPUT-MANIFEST.json'),
        'verifySha256': sha(frozen / 'VERIFY.json'),
        'eligibilitySha256': sha(frozen / 'ELIGIBILITY.json'),
        'note': 'The judge, the measure and its runner as they stood before any product run on these files.',
    }
    (frozen / 'SEAL.json').write_text(json.dumps(seal, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(json.dumps({'pinned': seal['pinned'], 'manifest': seal['manifestSha256']}))


if __name__ == '__main__':
    main()
