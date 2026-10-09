from pathlib import Path
import json,hashlib,csv,io
from decimal import Decimal
HERE=Path(__file__).resolve().parent
ROOT=HERE.parent/'next-contracts'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
load=lambda p:json.loads(p.read_text())
names=['p4-qualified-currency-v1','p4-qualified-currency-format-addendum-v1','p4-qualified-currency-boundary-clarification-v1','p4-qualified-currency-browser-v1']
pins=['83c0ce2ccafa08bfff3f20bfa0831eae145434c98ba779cada4c421d38afda79','1056e5b2a6bf558766475ef53f1c44eee0865528517474b2444df33b044a7852','7d045f9fd964e07c78ceda6e6e46143927375815f291f08d27abb9898a724499','94dffd30f325de9e0c755204c22b7a8dfa800f7a69715da58abeccf690518c0d']
checked={}
for name,pin in zip(names,pins):
    root=ROOT/name;manifest=load(root/'MANIFEST.json')
    assert sha(root/'MANIFEST.json')==pin
    entries=manifest['files'];paths=[p['path'] for p in entries]
    assert len(paths)==len(set(paths))
    actual={str(p.relative_to(root)) for p in root.rglob('*') if p.is_file()}-{'MANIFEST.json'}
    assert actual==set(paths),name
    for p in entries:
        path=root/p['path'];assert path.stat().st_size==p['bytes'] and sha(path)==p['sha256'],str(path)
    checked[name]={'manifestSha256':sha(root/'MANIFEST.json'),'files':len(entries)}
browser=ROOT/names[-1];m=load(browser/'acceptance-matrix.json')
for source in load(browser/'source-pins.json')['sources']:
    original=ROOT/source['directory'];snapshot=browser/'source-snapshot'/source['directory']
    assert sha(original/'MANIFEST.json')==source['authorManifestSha256']==source['snapshotManifestSha256']==sha(snapshot/'MANIFEST.json')
    for p in original.rglob('*'):
        if p.is_file(): assert p.read_bytes()==(snapshot/p.relative_to(original)).read_bytes()
truth_root=ROOT/names[0]/'frozen';contract=load(truth_root/'contract.json')
positives=[c for c in contract['cases'] if c['outcome']=='derived'];truths={c['id']:load(truth_root/c['expected']) for c in contract['cases']}
format_truth=load(ROOT/names[1]/'manual-number-format-truth.json')['cases']
formats={c['id']:c for c in format_truth}
for c in format_truth:
    e=truths[c['id']]
    assert c['originalSha256']==e['originalSha256'] and c['derivedCsvSha256']==e['csvSha256']
    assert c['signedAmounts']==e['signedAmounts']
    assert c['numericInterpretations']['dotDecimalMinor']==[int(Decimal(v)*1000) for v in e['signedAmounts']]
    assert c['numericInterpretations']['dotGroupingMinor']==[int(Decimal(v.replace('.',''))*1000) for v in e['signedAmounts']]
    assert c['acknowledgement']=={'originalDotInterpretationReviewed':True}
assert len(m['positiveCases'])==18
assert {(c['lang'],c['id']) for c in m['positiveCases']}=={(l,c['id']) for l in ['ar','en'] for c in positives}
for c in m['positiveCases']:
    e=truths[c['id']]
    assert c['key']==c['lang']+'-'+c['id']
    for field in c['exactEconomicTruth']: assert c['exactEconomicTruth'][field]==e[field],(c['key'],field)
    for kind in ['expected','original','csv']:
        assert sha(browser/c[kind+'Path'])==c[kind+'Sha256']
    assert c['originalDotReviewRequired']==c['id'].startswith('kwd')
    assert c['originalAndDerivedChoiceTruth']==formats.get(c['id'])
    assert all(c[f] is False for f in ['financialApproval','scopeConfirmed','nativeReplayConfirmedFinancialScope'])
    assert c['reviewSurfaceWidths']==[320,390]
    assert c['requiredSurfaceStates']==['original-source-review','derivative-review','artifact']
    assert c['pendingLifecycleProbe']==('cross-page' in c['id'])
    assert c['freshReloadRemountProbe']==('on-page' in c['id'])
    csv_bytes=(browser/c['csvPath']).read_bytes();csv_rows=list(csv.reader(io.StringIO(csv_bytes.decode(),newline='')))
    assert csv_rows==e['csvRows']
    assert [int(Decimal(r[3])*Decimal(10)**e['currencyContext']['decimals']) for r in csv_rows[1:]]==e['amountMinor']
refusal_ids={'sar-selected-exponent-mismatch','jpy-selected-exponent-mismatch','kwd-selected-exponent-and-missing-dot-review','sar-changed-continuation-qualification','jpy-fractional-original','kwd-excess-fraction-original'}
assert len(m['targetedRefusalCases'])==12
assert {(c['lang'],c['id']) for c in m['targetedRefusalCases']}=={(l,i) for l in ['ar','en'] for i in refusal_ids}
actions={a['id']:a for a in load(truth_root/'actions.json')['actions']}
for c in m['targetedRefusalCases']:
    e=truths[c['source']]
    assert sha(browser/c['expectedTruthPath'])==c['expectedTruthSha256']
    assert c['originalSha256']==e['originalSha256'] and c['financialApproval']==False
    assert c['widths']==[320,390]
    assert c['policyDecimals']=={'SAR':2,'JPY':0,'KWD':3}[c['currency']]
    if c['wrongSelectedDecimals'] is not None:
        assert c['wrongSelectedDecimals']!=c['policyDecimals']
        a=actions[c['existingActionId']]
        assert a['source']==c['source'] and a['change']['selectedDecimals']==c['wrongSelectedDecimals']
assert len({c['key'] for c in m['positiveCases']+m['targetedRefusalCases']})==30
measurements=sum(len(c['reviewSurfaceWidths'])*len(c['requiredSurfaceStates']) for c in m['positiveCases'])+sum(len(c['widths']) for c in m['targetedRefusalCases'])
assert measurements==132 and m['surfaceEvidence']['totalPrimaryMeasurements']==132
assert set(m['allOtherBlockedOriginalsRemainMandatoryInSeparateNativeEngineGate'])=={c['id'] for c in contract['cases'] if c['outcome']=='blocked'}
assert {c['id'] for c in m['bareControls']}=={c['id'] for c in contract['cases'] if c['outcome']=='outside-new-family'}
for c in m['bareControls']:
    e=truths[c['id']];assert c['newCurrencyReceipt']==c['derivedCurrencyArtifact']==False
    assert c['oldBareBehaviorUnchanged']==True and c['languages']==['ar','en']
    assert sha(browser/c['expectedPath'])==c['expectedSha256']
boundary=load(ROOT/names[2]/'boundary-actions.json')
assert boundary['productSidecarImportApi']==boundary['receiptTiming']['newUniversalFinancialDryRunBeforeMint']==False
assert boundary['receiptTiming']['applyConsumesReceiptBeforeAwait']==True
assert len(boundary['actions'])==12
own=load(ROOT/names[2]/'ownership-controls.json')
assert len(own['successfulControls'])==3 and len(own['generationRefusals'])==2
all_format=load(ROOT/names[1]/'actions-addendum.json')['actions']
assert len(all_format)==27 and len({a['id'] for a in all_format})==27
all_ids={'original-draft':set(actions),'format-addendum':{a['id'] for a in all_format}}
for a in boundary['actions']: assert a['id'] in all_ids[a['contract']]
out={'outcome':'PASS-PINS-MANUAL-MATRIX','sealedInputs':checked,'positiveLanguageCases':18,'targetedRefusalLanguageCases':12,'primaryWidths':measurements,'sourceSnapshotsByteExact':True,'formatRefusalActions':27,'boundaryReinterpretations':12,'ownershipSuccessfulControls':3,'generationRefusals':2,'separateNativeFormatFinding':'KWD excess-precision fixture is ambiguous and needs explicit acknowledged original dot choice before intended late Apply refusal.'}
(HERE/'pins-matrix-results-second.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps(out,indent=2))
