"""Write the story files into frozen/ with each story's CSV writer: py (Python
csv, minimal quoting, LF, each row as wide as its cells), py-pad (Python csv,
byte-order mark, CRLF, every row padded with empty cells to the widest row of
its file, as spreadsheet exports do) and node (render.mjs: every field quoted,
CRLF). Each story's confirmed run scope goes to <story>-scope.json.

  python3 -B audit/gl-tb-sections-foundation/stories.py > frozen/stories.json
  python3 -B audit/gl-tb-sections-foundation/render.py frozen
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
    node = []
    for story in facts['stories']:
        (folder / f"{story['id']}-scope.json").write_text(
            json.dumps(story['runScope'], ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
        for f in story['files']:
            path = folder / f['name']
            if f['writer'] == 'py':
                with path.open('w', encoding='utf-8', newline='') as out:
                    csv.writer(out, lineterminator='\n').writerows(f['cells'])
            elif f['writer'] == 'py-pad':
                width = max(len(r) for r in f['cells'])
                with path.open('w', encoding='utf-8-sig', newline='') as out:
                    csv.writer(out, lineterminator='\r\n').writerows(r + [''] * (width - len(r)) for r in f['cells'])
            else:
                node.append({'path': str(path), 'cells': f['cells']})
    subprocess.run(['node', str(HERE / 'render.mjs')], input=json.dumps(node).encode(), check=True)


if __name__ == '__main__':
    main(sys.argv[1])
