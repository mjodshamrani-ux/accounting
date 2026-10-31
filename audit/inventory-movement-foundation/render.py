"""Write each story's movement register and GL summary into frozen/ with
their CSV writers: py (Python csv, minimal quoting, LF, each row as wide as
its cells), py-pad (Python csv, byte-order mark, CRLF, every row padded with
empty cells to the widest row of the file, as spreadsheet exports do), node
(render.mjs: every field quoted, CRLF), raw (cells joined by commas with no
quoting at all, LF, as a hand-rolled export does) and cp1256 (Python csv,
minimal quoting, CRLF, encoded as Windows Arabic). Each story's confirmed
period scope goes to <story>-scope.json.

  python3 -B audit/inventory-movement-foundation/stories.py > frozen/stories.json
  python3 -B audit/inventory-movement-foundation/render.py frozen
"""
import csv
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def write(path, writer, cells, node):
    if writer == 'py':
        with path.open('w', encoding='utf-8', newline='') as out:
            csv.writer(out, lineterminator='\n').writerows(cells)
    elif writer == 'py-pad':
        width = max(len(r) for r in cells)
        with path.open('w', encoding='utf-8-sig', newline='') as out:
            csv.writer(out, lineterminator='\r\n').writerows(r + [''] * (width - len(r)) for r in cells)
    elif writer == 'cp1256':
        with path.open('w', encoding='cp1256', newline='') as out:
            csv.writer(out, lineterminator='\r\n').writerows(cells)
    elif writer == 'raw':
        path.write_text(''.join(','.join(r) + '\n' for r in cells), encoding='utf-8')
    else:
        node.append({'path': str(path), 'cells': cells})


def main(folder):
    folder = Path(folder)
    facts = json.loads((folder / 'stories.json').read_text(encoding='utf-8'))
    node = []
    for story in facts['stories']:
        (folder / f"{story['id']}-scope.json").write_text(
            json.dumps(story['runScope'], ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
        for f in story['files'].values():
            write(folder / f['name'], f['writer'], f['cells'], node)
    subprocess.run(['node', str(HERE / 'render.mjs')], input=json.dumps(node).encode(), check=True)


if __name__ == '__main__':
    main(sys.argv[1])
