"""Static independent source/context/arithmetic check, not native acceptance."""
from pathlib import Path
from decimal import Decimal
import hashlib
import json
root=Path(__file__).resolve().parent
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
truth=json.loads((root/'manual-negative-choice-binding.json').read_text())
clarification=json.loads((root/'clarification.json').read_text())
snapshot=root/'source-snapshot'
expected=json.loads((snapshot/'kwd-excess-fraction.expected.json').read_text())
freeze=json.loads((snapshot/'freeze.json').read_text())
for name in ['kwd-excess-fraction.pdf','kwd-excess-fraction.expected.json']:
    assert sha(snapshot/name)==freeze['files'][name]['sha256']
    assert (snapshot/name).stat().st_size==freeze['files'][name]['bytes']
assert sha(snapshot/'kwd-excess-fraction.pdf')==expected['originalSha256']==truth['originalSha256']
assert truth['originalSha256']=='f0a46630f96660883c23ae3b5dbbfc9acaec4ba2fc7522037d5da885c7bca3cf'
assert truth['frozenExpectedSha256']==sha(snapshot/'kwd-excess-fraction.expected.json')
assert truth['originalByteLength']==1312
assert expected['outcome']=='blocked' and expected['partialArtifact'] is False
assert truth['originalNumberFormatChoice']=={
    'value':'dot','sheet':0,'header':0,'columns':[3],'decimals':3,
    'candidates':['dot','comma'],'excludedRows':[],'balanceInputs':['',''],
    'sourceHash':expected['originalSha256'],'cuts':[25,45,70]}
assert truth['acknowledgement']=={'originalDotInterpretationReviewed':True}
cell=truth['lateRefusalCell']
row=next(r for r in expected['inventory'] if r['row']==cell['row'] and r['page']==cell['page'])
assert row['values'][cell['column']-1]==cell['literal']=='+2.0001'
scaled=Decimal(cell['literal'])*Decimal(1000)
assert scaled==Decimal('2000.1000') and scaled!=scaled.to_integral_value()
assert cell['fixedPolicyScaledExactDecimal']=='2000.1000' and cell['roundingAllowed'] is False
assert len(truth['wrongCopiedPositiveChoices']['originalSourceHashes'])==3
assert all(h!=truth['originalSha256'] for h in truth['wrongCopiedPositiveChoices']['originalSourceHashes'].values())
assert clarification['affectedPrimaryCaseKeys']==['ar-kwd-excess-fraction-original','en-kwd-excess-fraction-original']
assert clarification['primaryCasesRemain']==30 and clarification['primaryWidthMeasurementsRemain']==132
assert truth['derivedChoiceOrOutputTruth'] is None
for field in ['productImports','expectedFromProduct','nativeAccepted','runtimeAcceptance','financialApproval']:
    assert truth[field] is False and clarification[field] is False
assert sha(snapshot/'browser-v1-MANIFEST.json')==clarification['originalBrowserManifestSha256']=='94dffd30f325de9e0c755204c22b7a8dfa800f7a69715da58abeccf690518c0d'
original=root.parent/'p4-qualified-currency-browser-v1'
assert sha(original/'MANIFEST.json')==clarification['originalBrowserManifestSha256']
manifest=json.loads((original/'MANIFEST.json').read_text())
for entry in manifest['files']:
    p=original/entry['path'];assert p.stat().st_size==entry['bytes'] and sha(p)==entry['sha256']
print(json.dumps({'staticClarificationConsistent':True,'sealedBrowser94PayloadsUnchanged':len(manifest['files'])==94,
                  'frozenNegativeOriginalAndExpectedUnchanged':True,'ownNegativeChoiceBound':True,
                  'lateAmountNonintegralMinorUnits':str(scaled),'bothLanguageCasePrerequisitesExplicit':True,
                  'productImports':False,'nativeAccepted':False,'runtimeAcceptance':False},indent=2))
