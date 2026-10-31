"""Pre-seal check that no FIN-1 H1 story falls into a rule the planned FIN-1
product adds beyond the FIN-1A contract, without running any product code
(DEV-61). Where the product would be stricter than the contract, the oracle's
expectation would not be the product's, so a story must stay clear of:

  E1  two files of one story with the same SHA-256 (the flat family refuses
      identical sources);
  E2  a control or format character (Unicode Cc or Cf) in an identity field:
      Account ID, Complete dimensions, Mapping ID, Evidence ID, Line ID,
      Node ID, Parent ID;
  E3  a run scope the product will not confirm: As of other than Period end,
      a basis other than functional, posted, actual and post-closing, an
      unknown or not two-decimal currency (lib/reconciliation/
      currency-precision.ts, copied), or a period that ends before it starts;
  E4  a quote inside a field that is not quoted (Python's csv reads it; the
      byte reader of lib/reconciliation/tb-financial-hierarchy-source.ts
      refuses the file).

  python3 -B audit/fin-hierarchy-holdout-h1/eligibility.py frozen
"""
import hashlib
import json
import sys
import unicodedata
from pathlib import Path

IDENTITY = ['Account ID', 'Complete dimensions', 'Mapping ID', 'Evidence ID', 'Line ID', 'Node ID', 'Parent ID']
TWO_DECIMALS = {'SAR', 'USD', 'EUR', 'GBP', 'AED', 'QAR', 'EGP'}


def unquoted_quote(data):
    """True when a quote appears inside a field that did not open with one."""
    text = data.decode('utf-8-sig')
    inside, start = False, True
    for i, c in enumerate(text):
        if inside:
            if c == '"':
                if text[i + 1:i + 2] == '"':
                    continue
                inside = False
        elif c == '"':
            if not start and text[i - 1:i] != '"':
                return True
            inside = True
        start = c in ',\r\n'
    return False


def scope_problems(scope):
    out = []
    if scope['As of'] != scope['Period end']:
        out.append('As of is not the period end')
    for field, value in [('Currency basis', 'functional'), ('Posting status', 'posted'),
                         ('Posting layer', 'actual'), ('Closing basis', 'post-closing')]:
        if scope[field] != value:
            out.append(f'{field} is not {value}')
    if scope['Currency'] not in TWO_DECIMALS:
        out.append('currency is not a known two-decimal currency')
    if scope['Period start'] > scope['Period end']:
        out.append('the period ends before it starts')
    return out


def main(folder):
    folder = Path(folder)
    facts = json.loads((folder / 'stories.json').read_text(encoding='utf-8'))
    report = {'rules': ['E1', 'E2', 'E3', 'E4'], 'stories': []}
    for story in facts['stories']:
        problems = []
        hashes = [hashlib.sha256((folder / f['name']).read_bytes()).hexdigest() for f in story['files']]
        if len(set(hashes)) != len(hashes):
            problems.append('E1 identical files')
        for f in story['files']:
            header = f['cells'][0]
            for row in f['cells'][1:]:
                for name, value in zip(header, row):
                    if name in IDENTITY and any(unicodedata.category(c) in ('Cc', 'Cf') for c in value):
                        problems.append(f"E2 {f['name']} {name} {value!r}")
            if unquoted_quote((folder / f['name']).read_bytes()):
                problems.append(f"E4 {f['name']}")
        problems += [f'E3 {p}' for p in scope_problems(story['runScope'])]
        report['stories'].append({'id': story['id'], 'clear': not problems, 'problems': problems})
    report['clear'] = all(s['clear'] for s in report['stories'])
    (folder / 'ELIGIBILITY.json').write_text(json.dumps(report, ensure_ascii=False, indent=1) + '\n',
                                             encoding='utf-8')
    print(json.dumps({'clear': report['clear'],
                      'problems': [(s['id'], s['problems']) for s in report['stories'] if not s['clear']]},
                     ensure_ascii=False))
    if not report['clear']:
        sys.exit(1)


if __name__ == '__main__':
    main(sys.argv[1])
