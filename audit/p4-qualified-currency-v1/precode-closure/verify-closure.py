from pathlib import Path
import json,hashlib
from decimal import Decimal
HERE=Path(__file__).resolve().parent
ROOT=HERE.parent/'next-contracts'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
load=lambda p:json.loads(p.read_text())
inputs={
'p4-qualified-currency-v1':'83c0ce2ccafa08bfff3f20bfa0831eae145434c98ba779cada4c421d38afda79',
'p4-qualified-currency-format-addendum-v1':'1056e5b2a6bf558766475ef53f1c44eee0865528517474b2444df33b044a7852',
'p4-qualified-currency-boundary-clarification-v1':'7d045f9fd964e07c78ceda6e6e46143927375815f291f08d27abb9898a724499',
'p4-qualified-currency-browser-v1':'94dffd30f325de9e0c755204c22b7a8dfa800f7a69715da58abeccf690518c0d',
'p4-qualified-currency-browser-clarification-v1':'5aca126df4fdd033b1773751e7c8f98a7a92e34f674ff92b1ba53dc02bc06a1c'}
checked=[]
for name,pin in inputs.items():
    root=ROOT/name;m=load(root/'MANIFEST.json')
    assert sha(root/'MANIFEST.json')==pin
    actual={str(p.relative_to(root)) for p in root.rglob('*') if p.is_file()}-{'MANIFEST.json'}
    paths=[p['path'] for p in m['files']]
    assert len(paths)==len(set(paths)) and actual==set(paths)
    for p in m['files']:
        path=root/p['path'];assert sha(path)==p['sha256'] and path.stat().st_size==p['bytes']
    checked.append({'path':str(root),'manifestSha256':pin,'payloadFiles':len(paths)})
proofs={'precode-qualified-currency-review':'f4083b3236d61b971b5359298a6b901cc23aac6cb690a538c1cfe372c59cf561','precode-qualified-currency-addenda-review':'2d1ee525fe4803e7fc8476ccfec542bd4aa4f7c888b2d57827b43077909020da'}
for name,pin in proofs.items():
    root=HERE.parent/name;assert sha(root/'MANIFEST.json')==pin
    for p in load(root/'MANIFEST.json')['files']:
        path=root/p['path'];assert sha(path)==p['sha256'] and path.stat().st_size==p['bytes']
negative=ROOT/'p4-qualified-currency-browser-clarification-v1'
t=load(negative/'manual-negative-choice-binding.json');c=load(negative/'clarification.json')
assert sha(negative/'manual-negative-choice-binding.json')=='aeb1c72e15285efe761555ece8bb33809e2c0d52c7d1f56c875b6d553ecadd23'
frozen=ROOT/'p4-qualified-currency-v1/frozen';e=load(frozen/'kwd-excess-fraction.expected.json')
assert t['originalSha256']==sha(frozen/'kwd-excess-fraction.pdf')==e['originalSha256']
assert t['originalByteLength']==(frozen/'kwd-excess-fraction.pdf').stat().st_size==1312
assert t['frozenExpectedSha256']==sha(frozen/'kwd-excess-fraction.expected.json')
assert t['sourceCase']=='kwd-excess-fraction' and t['languages']==['ar','en']
for original,snapshot in [('kwd-excess-fraction.pdf','kwd-excess-fraction.pdf'),('kwd-excess-fraction.expected.json','kwd-excess-fraction.expected.json'),('freeze.json','freeze.json')]:
    assert (frozen/original).read_bytes()==(negative/'source-snapshot'/snapshot).read_bytes()
assert (ROOT/'p4-qualified-currency-browser-v1/MANIFEST.json').read_bytes()==(negative/'source-snapshot/browser-v1-MANIFEST.json').read_bytes()
native=load(HERE.parent/'precode-qualified-currency-addenda-review/native-format-context.json')
n=next(item for item in native['cases'] if item['id']=='kwd-excess-fraction')
assert n['originalSha256']==t['originalSha256']
assert n['originalFormat']['numberFormat']['status']=='ambiguous'
assert n['originalFormat']['numberFormat']['candidates']==['dot','comma']
assert t['originalNumberFormatChoice']==n['originalChoice']
assert t['acknowledgement']=={'originalDotInterpretationReviewed':True}
header=e['inventory'][0];late=e['inventory'][3]
assert header=={'row':1,'page':1,'values':['Date','Reference','Description','Signed amount (KWD)']}
assert t['ownOriginalHeaderEvidence']=={'sourceHash':t['originalSha256'],'sheet':1,'row':1,'page':1,'column':4,'literal':header['values'][3]}
assert late['row']==4 and late['page']==1 and late['values'][3]=='+2.0001'
scaled=Decimal(late['values'][3])*Decimal(10)**3
assert str(scaled)==t['lateRefusalCell']['fixedPolicyScaledExactDecimal']=='2000.1000'
assert scaled!=scaled.to_integral_value() and t['lateRefusalCell']['integralMinorUnits']==t['lateRefusalCell']['roundingAllowed']==False
assert int(Decimal(e['inventory'][2]['values'][3])*1000)==-12500
assert int(Decimal(e['inventory'][2]['values'][3].replace('.',''))*1000)==-12500000
for name,pin in t['wrongCopiedPositiveChoices']['originalSourceHashes'].items():
    assert pin==sha(frozen/(name+'.pdf')) and pin!=t['originalSha256']
assert t['derivedChoiceOrOutputTruth'] is None and t['frozenOutcome']=='blocked'
assert not (negative/'source-snapshot/kwd-excess-fraction.csv').exists()
matrix=load(ROOT/'p4-qualified-currency-browser-v1/acceptance-matrix.json')
affected=[item for item in matrix['targetedRefusalCases'] if item['source']=='kwd-excess-fraction']
assert len(affected)==2
assert set(c['affectedPrimaryCaseKeys'])=={item['key'] for item in affected}=={'ar-kwd-excess-fraction-original','en-kwd-excess-fraction-original'}
assert all(item['refusalTiming']=='late-apply-validation-preserved' for item in affected)
assert c['primaryCasesRemain']==len(matrix['positiveCases'])+len(matrix['targetedRefusalCases'])==30
assert c['primaryWidthMeasurementsRemain']==matrix['surfaceEvidence']['totalPrimaryMeasurements']==132
assert c['newMoneyOrPositiveCsv']==c['newSidecarImport']==c['existingSealedBrowserPayloadsChanged']==False
original=load(HERE.parent/'precode-qualified-currency-review/RESULT.json')
repo=HERE.parents[2]/'p5-browser-source-contract'
for name,pin in original['productPins'].items():assert sha(repo/name)==pin
out={'version':'QUALIFIED_CURRENCY_COMBINED_PRECODE_CLOSURE_V1','outcome':'PASS-COMBINED-PRECODE-CONTRACT','implementationAccepted':False,'runtimeAccepted':False,'fieldAcceptance':False,'financialApproval':False,'inputManifestPins':checked,'preservedReviewerManifestPins':proofs,'closedFinding':'KWD-EXCESS-AMBIGUITY-PREREQUISITE','closureEvidence':{'ownNegativeOriginalAndSnapshotExact':True,'negativeBoundChoiceEqualsFreshNativeObservedChoice':True,'freshAllowedCandidateSet':['dot','comma'],'explicitOriginalDotAcknowledgementRequired':True,'lateCell':{'sheet':1,'row':4,'page':1,'column':4,'literal':'+2.0001','scaledDecimal':str(scaled),'integral':False},'wrongCopiedPositiveSourceHashesRefuse':True,'affectedBrowserLanguageCases':sorted(c['affectedPrimaryCaseKeys']),'primaryCasesUnchanged':30,'primaryWidthMeasurementsUnchanged':132,'noNegativeCsvOrRoundedExpectedMoney':True,'productSourcePinsUnchanged':len(original['productPins'])},'acceptedBoundaries':['Every admitted ambiguous qualified original requires its own explicit acknowledged bound choice before currency receipt mint.','A valid negative original choice permits structural receipt; Apply consumes/invalidate receipt then rejects nonintegral row4, no partial artifact.','Late old-caller mutation after private entry snapshot preserves owned output; explicit session replaceSource/updateReviewer invalidates generation.','External sidecar tamper is checked only by independent download checker, never product import.','Opaque copied/deserialized receipt has no live session ownership; no new archive UI or financial authority.'],'implementationNotes':['ExtractionRevision must equal the current fresh declared revision in the bound source/extraction tuple; a legitimate shared revision label is not required to be globally unique. Positive source/extraction hashes cannot be substituted.','All27 format actions retain reviewed executable boundaries in the preserved reviewer evidence; extraction hash mismatch uses existing reviewer-decision binding, and generated derived-choice corruption uses isolated private-copy faults.'],'remainingBlockers':[],'futureAcceptanceStillRequired':['Qualified implementation review and all original/format refusal runtime gates.','Native mounted App downloads and AR/EN30case132width evidence.','Strict independent artifact checker and disposable sidecar/coverage tamper copies.','Current batch closure before separate qualified implementation branch.']}
(HERE/'RESULT.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps({'outcome':out['outcome'],'sealedInputBundlesChecked':len(checked),'ownNegativeChoiceExact':True,'lateScaledDecimal':str(scaled),'primaryCases':30,'widths':132,'productPinsUnchanged':len(original['productPins'])}))
