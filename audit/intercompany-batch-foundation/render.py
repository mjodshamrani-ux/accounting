"""Write the story files into frozen/ with each story's CSV writer:
py (Python csv, minimal quoting, LF), py-crlf-bom (Python csv, byte-order
mark, CRLF), node (render.mjs: every field quoted, CRLF) and ruby (render.rb:
Ruby's CSV library, LF).

  python3 -B audit/intercompany-batch-foundation/stories.py > frozen/stories.json
  python3 -B audit/intercompany-batch-foundation/render.py frozen
"""
import csv
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def main(folder):
    folder = Path(folder)
    facts = json.loads((folder / 'stories.json').read_text(encoding='utf-8'))
    batches = {'node': [], 'ruby': []}
    for story in facts['stories']:
        for f in story['files']:
            path = folder / f['name']
            if f['writer'] in ('py', 'py-crlf-bom'):
                bom = f['writer'] == 'py-crlf-bom'
                with path.open('w', encoding='utf-8-sig' if bom else 'utf-8', newline='') as out:
                    csv.writer(out, lineterminator='\r\n' if bom else '\n').writerows(f['cells'])
            else:
                batches[f['writer']].append({'path': str(path), 'cells': f['cells']})
    subprocess.run(['node', str(HERE / 'render.mjs')], input=json.dumps(batches['node']).encode(), check=True)
    subprocess.run(['ruby', str(HERE / 'render.rb')], input=json.dumps(batches['ruby']).encode(), check=True)


if __name__ == '__main__':
    main(sys.argv[1])
