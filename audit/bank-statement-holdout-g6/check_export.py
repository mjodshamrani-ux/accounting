"""Independent check of export workbooks made from the G6 holdout.

  python3 -B audit/bank-statement-holdout-g6/check_export.py < request.json

The request is the foundation checker's (audit/bank-statement-foundation/
check_export.py), whose rules are used unchanged: originals reassembled byte
for byte, every statement line against the sealed facts, the cashbook parsed
here, case membership against EXPECTED.json, citations. The only difference
is the period: the foundation's facts have one, each holdout statement has its
own, so each export is checked against its story's period. The facts must
match this holdout's seal. A typed XLSX cashbook (H01) is not checked here:
the foundation's parser reads cell text, and a typed cell holds a day serial.
"""
import hashlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'bank-statement-foundation'))
import check_export as foundation  # noqa: E402


def main():
    request = json.load(sys.stdin)
    facts_text = Path(request['facts']).read_bytes()
    frozen = Path(request['frozen'])
    manifest = json.loads((frozen / 'INPUT-MANIFEST.json').read_text(encoding='utf-8'))
    foundation.need(hashlib.sha256(facts_text).hexdigest() == manifest['facts']['sha256'], 'facts differ from the seal')
    facts = json.loads(facts_text)
    expected = json.loads((frozen / 'EXPECTED.json').read_text(encoding='utf-8'))
    report = {'exports': [], 'selfTest': None}
    for case in request['exports']:
        story = next(s for s in facts['stories'] if s['id'] == case['story'])
        one = dict(facts, period=story['statement']['period'])
        sheets = foundation.workbook(Path(case['path']).read_bytes())
        try:
            report['exports'].append(foundation.check(sheets, case, one, expected, manifest, frozen))
        except foundation.CheckError as e:
            raise foundation.CheckError(f"{case['name']}: {e}") from None
        if case['name'] == request.get('selfTest'):
            caught = []
            for name, alter in foundation.alterations(sheets):
                try:
                    foundation.check(alter(sheets), case, one, expected, manifest, frozen)
                except foundation.CheckError:
                    caught.append(name)
                    continue
                raise foundation.CheckError(f'self-test: the checker accepted an altered workbook ({name})')
            report['selfTest'] = {'export': case['name'], 'alterations': len(caught), 'caught': caught}
    foundation.need(request.get('selfTest') is None or report['selfTest'] is not None, 'self-test export not found')
    json.dump(report, sys.stdout)


if __name__ == '__main__':
    try:
        main()
    except foundation.CheckError as e:
        print(f'CHECK FAILED: {e}', file=sys.stderr)
        sys.exit(1)
