from pathlib import Path
import hashlib,json

HERE=Path(__file__).parent
ROOT=HERE.parent
expected={'p4-qualified-currency-v1':'83c0ce2ccafa08bfff3f20bfa0831eae145434c98ba779cada4c421d38afda79','p4-qualified-currency-format-addendum-v1':'1056e5b2a6bf558766475ef53f1c44eee0865528517474b2444df33b044a7852'}
checks=[]
for name,sha in expected.items():
    p=ROOT/name;raw=(p/'MANIFEST.json').read_bytes()
    assert hashlib.sha256(raw).hexdigest()==sha
    manifest=json.loads(raw)
    for item in manifest['files']:
        f=p/item['path'];data=f.read_bytes()
        assert len(data)==item['bytes'] and hashlib.sha256(data).hexdigest()==item['sha256']
    checks.append({'bundle':name,'manifestSha256':sha,'unchangedPayloadFiles':len(manifest['files'])})
actions=json.loads((HERE/'boundary-actions.json').read_text())
source_ids={'original-draft':{a['id'] for a in json.loads((ROOT/'p4-qualified-currency-v1/frozen/actions.json').read_text())['actions']},'format-addendum':{a['id'] for a in json.loads((ROOT/'p4-qualified-currency-format-addendum-v1/actions-addendum.json').read_text())['actions']}}
assert len(actions['actions'])==12 and len({(a['contract'],a['id']) for a in actions['actions']})==12
for action in actions['actions']: assert action['id'] in source_ids[action['contract']]
assert actions['productSidecarImportApi'] is False and actions['expectedFromProduct'] is False
assert actions['receiptTiming']['applyConsumesReceiptBeforeAwait'] is True and actions['receiptTiming']['newUniversalFinancialDryRunBeforeMint'] is False
controls=json.loads((HERE/'ownership-controls.json').read_text())
assert controls['frozenMoneyUnchanged'] is True and controls['financialApproval'] is False
assert len(controls['successfulControls'])==3 and len(controls['generationRefusals'])==2
assert len({a['id'] for a in controls['successfulControls']+controls['generationRefusals']})==5
print(json.dumps({'passed':True,'scope':'independent action-boundary and ownership clarification consistency; no implementation or native execution claim','priorSeals':checks,'clarifiedActionIds':12,'successfulOwnershipControls':3,'explicitGenerationRefusalControls':2,'productSidecarImportApi':False,'lateApplyValidationPreserved':True},indent=2))
