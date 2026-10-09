from pathlib import Path
from decimal import Decimal
import hashlib,json

HERE=Path(__file__).parent
ORIGINAL=HERE.parent/'p4-qualified-currency-v1'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
contract=json.loads((HERE/'contract-addendum.json').read_text())
assert sha(ORIGINAL/'MANIFEST.json')==contract['originalDraftManifestSha256']=='83c0ce2ccafa08bfff3f20bfa0831eae145434c98ba779cada4c421d38afda79'
assert sha(ORIGINAL/'frozen/freeze.json')==contract['originalFreezeSha256']=='1b9612a623e3055fe6fa369eb4b7b175da67ab04e07f0895e42b112fb251c7c4'
old_manifest=json.loads((ORIGINAL/'MANIFEST.json').read_text())
for item in old_manifest['files']:
    p=ORIGINAL/item['path']
    assert p.stat().st_size==item['bytes'] and sha(p)==item['sha256'],item['path']
manual=json.loads((HERE/'manual-number-format-truth.json').read_text())
assert manual['productImports'] is False and manual['expectedFromProduct'] is False
cases=manual['cases'];assert {c['id'] for c in cases}==set(contract['ambiguousMandatoryPositiveIds']) and len(cases)==3
for case in cases:
    source=ORIGINAL/'frozen'/(case['id']+'.pdf');derived=ORIGINAL/'frozen'/(case['id']+'.csv')
    truth=json.loads((ORIGINAL/'frozen'/(case['id']+'.expected.json')).read_text())
    assert case['originalSha256']==sha(source)==truth['originalSha256']
    assert case['derivedCsvSha256']==sha(derived)==truth['csvSha256']
    assert case['signedAmounts']==truth['signedAmounts']
    assert case['currency']=='KWD' and case['decimals']==3 and case['financialApproval'] is False
    interpretations=case['numericInterpretations']
    assert interpretations['dotDecimalMinor']==[int(Decimal(v)*1000) for v in case['signedAmounts']]==truth['amountMinor']
    assert interpretations['dotGroupingMinor']==[int(Decimal(v.replace('.',''))*1000) for v in case['signedAmounts']]
    assert interpretations['dotDecimalMinor']!=interpretations['dotGroupingMinor']
    assert case['acknowledgement']=={'originalDotInterpretationReviewed':True}
    original=case['originalNumberFormatChoice'];new=case['derivedNumberFormatChoice']
    assert original['sourceHash']==sha(source) and new['sourceHash']==sha(derived) and original['sourceHash']!=new['sourceHash']
    assert original['cuts']==[25,45,70] and new['cuts']==[]
    for choice in [original,new]:
        assert choice['value']=='dot' and choice['sheet']==0 and choice['header']==0 and choice['columns']==[3]
        assert choice['decimals']==3 and choice['candidates']==['dot','comma'] and choice['excludedRows']==[] and choice['balanceInputs']==['','']
actions=json.loads((HERE/'actions-addendum.json').read_text())['actions']
assert len(actions)==27 and len({a['id']for a in actions})==27
assert all(a['source']=='kwd-cross-page' and a['outcome']=='refused' and a['partialArtifact'] is False and a['financialApproval'] is False for a in actions)
assert contract['productImports'] is False and contract['expectedFromProduct'] is False and contract['implementationAccepted'] is False
print(json.dumps({'passed':True,'scope':'independent additive choice/Decimal consistency and original72payloadsunchanged; native acceptance/implementation separate','productImports':False,'originalPayloadsVerified':len(old_manifest['files']),'ambiguousPositiveCases':len(cases),'additionalRefusalActions':len(actions),'signedMoneyUnchanged':True,'originalAndDerivedSourceBindingsDistinct':True},indent=2))
