from pathlib import Path
import json,re
from decimal import Decimal
HERE=Path(__file__).resolve().parent
F=HERE.parent/'next-contracts/p4-qualified-currency-v1/frozen'
read=lambda name:json.loads((F/(name+'.expected.json')).read_text())
rows=lambda name:[x['values'] for x in read(name)['inventory']]
assert rows('changed-page-currency')[0][3]=='Signed amount (SAR)' and rows('changed-page-currency')[3][3]=='Signed amount (JPY)'
assert rows('missing-page-qualification')[3][3]=='Signed amount'
assert ['Currency','JPY','',''] in rows('contradictory-currency-row')
invalid_headers={'double-currency-header':'Signed amount (SAR) (JPY)','unknown-currency-header':'Signed amount (ZZZ)','lowercase-qualifier':'Signed amount (sar)','symbol-qualifier':'Signed amount ($)','ambiguous-qualifier':'Signed amount (SAR/JPY)'}
for name,literal in invalid_headers.items():
    assert rows(name)[0][3]==literal
    assert literal not in {'Signed amount (SAR)','Signed amount (JPY)','Signed amount (KWD)'}
for name,precision in [('jpy-fractional',0),('sar-excess-fraction',2),('kwd-excess-fraction',3)]:
    movements=[r for r in rows(name) if re.fullmatch(r'\d{4}-\d{2}-\d{2}',r[0])]
    assert Decimal(movements[0][3])*Decimal(10)**precision == (Decimal(movements[0][3])*Decimal(10)**precision).to_integral_value()
    last=Decimal(movements[-1][3])*Decimal(10)**precision
    assert last!=last.to_integral_value()
assert rows('late-corrupt-amount')[-1][3]=='BROKEN'
assert rows('changed-page-reference-role')[3][1]=='Purchase Order'
assert rows('extra-balance-column')[0]==['Date','Reference','Description','Signed amount (SAR)','Balance']
assert rows('extra-balance-column')[-1][-1]=='100.00'
missing=read('missing-continuation')['inventory']
assert len({r['page'] for r in missing})==2 and all(r['values'][0]!='Continued invoice' for r in missing)
assert ['','','unknown note',''] in rows('late-unknown-row')
assert rows('bare-existing-family')[0][3]=='Amount'
assert rows('description-code-only')[0][3]=='Amount' and 'SAR' in rows('description-code-only')[-1][2]
actions=json.loads((F/'actions.json').read_text())['actions']
for a in actions:
    source=read(a['source'])
    assert source['outcome']=='derived'
    if isinstance(a['change'],dict) and 'selectedDecimals' in a['change']:
        assert a['change']['selectedDecimals']!=source['currencyContext']['decimals']
    if a['id']=='cached-qualified-header-tamper':
        original=source['inventory'][a['change']['row']-1]
        assert original['page']==2 and original['values'][a['change']['column']-1]!=a['change']['literal']
required={'sar-wrong-zero-exponent','sar-wrong-three-exponent','jpy-wrong-two-exponent','kwd-wrong-two-exponent','cached-qualified-header-tamper','original-qualified-header-tamper','currency-citation-literal-tamper','currency-citation-coordinate-tamper','omit-second-header-evidence','source-swap-after-review','precision-swap-after-review','revision-swap-after-review','copied-currency-receipt','sidecar-currency-tamper','sidecar-precision-tamper','source-swap-during-replay','cancellation-during-replay','incomplete-selected-movements'}
assert {a['id'] for a in actions}==required
output={'outcome':'PASS','manualBlockedCaseFacts':16,'bareControls':2,'actionDefinitionsReviewed':18,'claims':'Original row facts independently establish specified refusal triggers. Future action execution remains pending implementation.'}
(HERE/'refusals-results.json').write_text(json.dumps(output,indent=2)+'\n')
print(json.dumps(output))
