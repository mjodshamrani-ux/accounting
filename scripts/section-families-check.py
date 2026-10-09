"""Independent downloaded-file checks against pre-authored truth. No product imports."""
import csv
import hashlib
import io
import json
from decimal import Decimal
from pathlib import Path
import sys

proof = Path(sys.argv[1])
report = json.loads((proof / 'observations.json').read_text())
contract_bytes = Path('audit/p4-section-families-browser-v1/contract.json').read_bytes()
# Public projection changes only the portable generator/freeze identity; native case truth is pinned below.
assert hashlib.sha256(contract_bytes).hexdigest() == 'ed9d25c9eb458a19b5c01cf6fc2a67bc872258ead3983dfbb7c217b428e31517', 'exact accepted UI contract'
contract = json.loads(contract_bytes)
assert report.get('passed') is True, 'native observations must explicitly pass before independent acceptance'
assert report.get('version') == contract['version'] and report.get('synthetic') is True
assert report.get('fieldAcceptance') is False and report.get('financialMatching') is False
assert report.get('expectedFromProduct') is False
expected_cases = {(lang, spec['family'], spec['id']): outcome
                  for lang in contract['languages']
                  for specs, outcome in [(contract['positiveCases'], 'derived'), (contract['negativeCases'], 'blocked')]
                  for spec in specs}
cases = report.get('cases')
assert isinstance(cases, list) and len(cases) == len(expected_cases), 'exact native contract case count'
seen = set()
for case in cases:
    assert isinstance(case, dict), 'case object'
    identity = (case.get('lang'), case.get('family'), case.get('id'))
    assert identity in expected_cases and identity not in seen, 'no missing, extra or duplicate native case'
    seen.add(identity)
    assert case.get('key') == case['lang'] + '-' + case['id']
    assert case.get('outcome') == expected_cases[identity], 'exact frozen manual outcome'
    assert case.get('pageErrors') == [], 'no native page errors'
    frozen = Path('audit') / case['family'] / 'frozen'
    freeze_bytes = (frozen / 'freeze.json').read_bytes()
    assert hashlib.sha256(freeze_bytes).hexdigest() == contract['familyFreezeSha256'][case['family']]
    family_freeze = json.loads(freeze_bytes)
    for filename in ['contract.json', case['id'] + '.pdf', case['id'] + '.expected.json']:
        assert hashlib.sha256((frozen / filename).read_bytes()).hexdigest() == family_freeze['files'][filename]
    truth = json.loads((frozen / (case['id'] + '.expected.json')).read_text())
    assert truth['outcome'] == expected_cases[identity] and case.get('originalSha256') == truth['originalSha256']
assert seen == set(expected_cases), 'all Arabic/English native contract groups'
checks = []
digits = str.maketrans('٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹−٫٬', '01234567890123456789-.\x00')
for case in report['cases']:
    if case['outcome'] != 'derived':
        continue
    frozen = Path('audit') / case['family'] / 'frozen'
    expected = json.loads((frozen / (case['id'] + '.expected.json')).read_text())
    family_freeze = json.loads((frozen / 'freeze.json').read_text())
    assert hashlib.sha256((frozen / (case['id'] + '.csv')).read_bytes()).hexdigest() == family_freeze['files'][case['id'] + '.csv']
    payload = (proof / case['downloads']['csv']).read_bytes()
    truth = (frozen / (case['id'] + '.csv')).read_bytes()
    assert payload == truth, case['key'] + ': byte-exact independently serialized CSV'
    assert hashlib.sha256(payload).hexdigest() == expected['csvSha256']
    rows = list(csv.reader(io.StringIO(payload.decode('utf-8-sig'), newline='')))
    assert rows == expected['csvRows'], case['key'] + ': all exact Unicode fields'
    literal = [row[3] for row in rows[1:]]
    assert literal == expected['signedAmounts'], case['key'] + ': signs/literals'
    minor = []
    for amount in literal:
        value = Decimal(amount.translate(digits).replace('\x00', '')) * 100
        assert value == value.to_integral_value(), case['key'] + ': integral cents'
        minor.append(int(value))
    assert minor == expected['amountMinor'], case['key'] + ': independent signed arithmetic'
    original = (proof / case['downloads']['original']).read_bytes()
    assert original == (frozen / (case['id'] + '.pdf')).read_bytes()
    assert hashlib.sha256(original).hexdigest() == expected['originalSha256']
    provenance = json.loads((proof / case['downloads']['provenance']).read_text())
    assert provenance['financialApproval'] is False
    inventory = [{'row': r['originalRow'], 'page': r['page'], 'values': r['values']} for r in provenance['inventory']]
    assert inventory == expected['inventory'], case['key'] + ': complete physical inventory'
    expected_links = [dict(link) for link in expected['links']]
    if case['family'] == 'p4-raw-signed-header-v2' and case['id'] == 'own-reference':
        alias_path = Path('audit/p4-raw-signed-header-v2/vocabulary-alias.json')
        alias_bytes = alias_path.read_bytes()
        assert hashlib.sha256(alias_bytes).hexdigest() == 'f1b9776a87521145bf00b43cd6f998389a3f37070f8575c99e567c63fb1dd4c5'
        alias = json.loads(alias_bytes)
        assert hashlib.sha256((frozen / 'freeze.json').read_bytes()).hexdigest() == alias['frozenManifestSha256']
        assert hashlib.sha256((frozen / 'own-reference.expected.json').read_bytes()).hexdigest() == alias['expectedSha256']
        assert expected['originalSha256'] == alias['originalSha256']
        assert expected['csvSha256'] == alias['csvSha256']
        assert alias['singleAlias'] == {'expectedPath': 'links[0].referenceOrigin', 'originalRow': 4, 'page': 1,
            'originalColumn': 2, 'originalLiteral': 'INV-271', 'derivedRow': 2,
            'conceptualFrozenValue': 'explicit-original-cell', 'acceptedPublicValue': 'explicit-source-cell'}
        assert expected_links[0] == {'originalRow': 4, 'page': 1, 'derivedRow': 2,
            'reference': 'INV-271', 'referenceOrigin': 'explicit-original-cell'}
        cell = provenance['links'][0]['referenceEvidence']
        assert {key: cell[key] for key in ['sheet', 'row', 'page', 'column', 'literal', 'sourceHash']} == {
            'sheet': 1, 'row': 4, 'page': 1, 'column': 2, 'literal': 'INV-271', 'sourceHash': alias['originalSha256']}
        assert sum(link['referenceOrigin'] == 'explicit-original-cell' for link in expected_links) == 1
        expected_links[0]['referenceOrigin'] = 'explicit-source-cell'
    links = [{key: link[key] for key in ['originalRow', 'page', 'derivedRow', 'reference', 'referenceOrigin']}
             for link in provenance['links']]
    assert links == expected_links, case['key'] + ': every original-to-derived link'
    checks.append({'key': case['key'], 'csvSha256': hashlib.sha256(payload).hexdigest(),
                   'rows': len(rows), 'signedLiterals': literal, 'amountMinor': minor,
                   'originalSha256': hashlib.sha256(original).hexdigest()})
result = {'version': 'p4-section-independent-csv-check-v1', 'productImports': False,
          'expectedFromProduct': False, 'passed': True, 'checks': checks}
(proof / 'independent-python.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(result, ensure_ascii=False))
