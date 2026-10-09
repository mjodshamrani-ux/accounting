"""Independent hand-authored original PDF/CSV truth; no product imports.

Draft frozen inputs for a subsequent branch. Existing freeze is immutable.
All economic rows and expected reference relations are authored below.
"""
from pathlib import Path
from decimal import Decimal
import csv,hashlib,io,json

ROOT=Path(__file__).parent/'frozen'
if ROOT.exists(): raise SystemExit('Refusing to regenerate an existing freeze.')
ROOT.mkdir(parents=True)
POLICY={'SAR':2,'JPY':0,'KWD':3}

def header(code): return ['Date','Reference','Description','Signed amount ('+code+')']
def parent(ref='INV-000271'): return ['Invoice No',ref,'','']
def continued(ref='INV-000271'): return ['Continued invoice',ref,'','']
def movement(amount,description='first line',ref='',date='2026-10-01'):
    return [date,ref,description,amount]

# Positive currency values and assignments are independent contract data.
values={'SAR':['-12.50','+2.05','0.00'],'JPY':['-12','+2','0'],'KWD':['-12.500','+2.005','0.000']}
cases=[]
for code,amounts in values.items():
    h=header(code)
    cases.append({'id':code.lower()+'-on-page','code':code,'pages':[[h,parent(),movement(amounts[0],'line, "one"'),movement(amounts[1],'second'),movement(amounts[2],'zero')]],'outcome':'derived','bindings':[(3,2),(4,2),(5,2)]})
    cases.append({'id':code.lower()+'-cross-page','code':code,'pages':[[h,parent(),movement(amounts[0])],[h,continued(),movement(amounts[1],'second',date='2026-10-02'),movement(amounts[2],'zero',date='2026-10-03')]],'outcome':'derived','bindings':[(3,2),(6,2),(7,2)]})
    cases.append({'id':code.lower()+'-own-reference','code':code,'pages':[[h,parent(),movement(amounts[0],ref='INV-000271'),movement(amounts[1],'second'),movement(amounts[2],'zero')]],'outcome':'derived','bindings':[(3,2),(4,2),(5,2)]})

def blocked(name,pages,reason,cuts=None):
    cases.append({'id':name,'pages':pages,'outcome':'blocked','reason':reason,**({'cuts':cuts} if cuts else {})})

H=header('SAR')
blocked('changed-page-currency',[[H,parent(),movement('-12.00')],[header('JPY'),continued(),movement('+2')]],'Original repeated currency header changes from SAR to JPY.')
blocked('missing-page-qualification',[[H,parent(),movement('-12.50')],[['Date','Reference','Description','Signed amount'],continued(),movement('+2.05')]],'Qualified original currency evidence is missing on continuation page.')
blocked('contradictory-currency-row',[[H,['Currency','JPY','',''],parent(),movement('-12.50')]],'Contradictory occupied source context cannot be dropped.')
blocked('double-currency-header',[[['Date','Reference','Description','Signed amount (SAR) (JPY)'],parent(),movement('-12.50')]],'Two original currency qualifiers are ambiguous and outside the finite family.')
blocked('unknown-currency-header',[[header('ZZZ'),parent(),movement('-12.50')]],'Unknown currency is not admitted by the frozen precision policy.')
blocked('lowercase-qualifier',[[header('sar'),parent(),movement('-12.50')]],'Literal lowercase qualifier is outside this exact uppercase family.')
blocked('symbol-qualifier',[[header('$'),parent(),movement('-12.50')]],'A symbol cannot supply a unique admitted original currency code.')
blocked('ambiguous-qualifier',[[header('SAR/JPY'),parent(),movement('-12.50')]],'Multiple currency spelling cannot supply unique original context.')
blocked('jpy-fractional',[[header('JPY'),parent(),movement('-12'),movement('+2.5','late fractional')]],'JPY fixed zero exponent cannot represent the late fractional amount.')
blocked('sar-excess-fraction',[[H,parent(),movement('-12.50'),movement('+2.001','late excessive precision')]],'SAR fixed two exponent must not round the late amount.')
blocked('kwd-excess-fraction',[[header('KWD'),parent(),movement('-12.500'),movement('+2.0001','late excessive precision')]],'KWD fixed three exponent must not round the late amount.')
blocked('late-corrupt-amount',[[H,parent(),movement('-12.50'),movement('BROKEN','late corrupt')]],'Readable early movement cannot authorize omission of a corrupt late amount.')
blocked('changed-page-reference-role',[[H,parent(),movement('-12.50')],[['Date','Purchase Order','Description','Signed amount (SAR)'],continued(),movement('+2.05')]],'A changed identity header is not a repeated qualifying section header.')
blocked('extra-balance-column',[[H+['Balance'],parent()+[''],movement('-12.50')+['100.00']]],'Fifth financial field is outside four-column family and must not be erased.',[25,45,70,87])
blocked('missing-continuation',[[H,parent(),movement('-12.50')],[H,movement('+2.05')]],'Same currency cannot create missing section continuation authority.')
blocked('late-unknown-row',[[H,parent(),movement('-12.50'),['','','unknown note',''],movement('+2.05')]],'An unresolved occupied original row cannot be silently dropped.')

for name,description in [('bare-existing-family','plain original family'),('description-code-only','SAR appears only in description')]:
    cases.append({'id':name,'pages':[[['Date','Reference','Description','Amount'],parent(),movement('-12.50',description)]],'outcome':'outside-new-family','reason':'No original qualified amount header; preserve the previous bare-family contract and mint no new currency context.'})

def pdf(pages):
    objects=['<< /Type /Catalog /Pages 2 0 R >>','','<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>']
    kids=[]
    for rows in pages:
        number=len(objects)+1;kids.append(number);commands=[]
        for row_index,row in enumerate(rows):
            for col,text in enumerate(row):
                literal=text.replace('\\','\\\\').replace('(','\\(').replace(')','\\)')
                commands.append(f'BT /F1 5 Tf 1 0 0 1 {[40,170,300,440,540][col]} {750-row_index*20} Tm ({literal}) Tj ET')
        stream='\n'.join(commands)+'\n'
        objects.extend([f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 3 0 R >> >> /Contents {number+1} 0 R >>',f'<< /Length {len(stream.encode("ascii"))} >>\nstream\n{stream}endstream'])
    objects[1]=f'<< /Type /Pages /Kids [{" ".join(str(n)+" 0 R" for n in kids)}] /Count {len(kids)} >>'
    result='%PDF-1.7\n';offsets=[]
    for i,obj in enumerate(objects): offsets.append(len(result.encode('ascii')));result+=f'{i+1} 0 obj\n{obj}\nendobj\n'
    start=len(result.encode('ascii'))
    result+=f'xref\n0 {len(objects)+1}\n0000000000 65535 f \n'+''.join(f'{offset:010} 00000 n \n' for offset in offsets)+f'trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n'
    return result.encode('ascii')

def write_json(name,value):
    (ROOT/name).write_text(json.dumps(value,ensure_ascii=True,indent=2)+'\n')

catalogue=[]
for spec in cases:
    name=spec['id'];blob=pdf(spec['pages']);(ROOT/(name+'.pdf')).write_bytes(blob)
    inventory=[{'row':i+1,'page':page,'values':values} for i,(page,values) in enumerate((page,row) for page,rows in enumerate(spec['pages'],1) for row in rows)]
    truth={'id':name,'outcome':spec['outcome'],'synthetic':True,'expectedFromProduct':False,'financialApproval':False,'originalSha256':hashlib.sha256(blob).hexdigest(),'originalByteLength':len(blob),'cuts':spec.get('cuts',[25,45,70]),'inventory':inventory,'links':[],'currencyEvidence':[]}
    if spec['outcome']=='derived':
        code=spec['code'];decimals=POLICY[code];bindings=dict(spec['bindings'])
        csv_rows=[header(code)];minor=[]
        truth['currencyContext']={'currency':code,'decimals':decimals,'precisionOrigin':'finite-contract-policy','precisionPolicy':POLICY}
        truth['headerRows']=[item['row'] for item in inventory if item['values']==header(code)]
        for rn in truth['headerRows']:
            original=inventory[rn-1]
            truth['currencyEvidence'].append({'sourceHash':truth['originalSha256'],'row':rn,'page':original['page'],'column':4,'literal':original['values'][3]})
        for original in inventory:
            rn=original['row']
            if rn not in bindings: continue
            row=original['values'];ref=row[1] or inventory[bindings[rn]-1]['values'][1]
            csv_rows.append([row[0],ref,row[2],row[3]])
            amount=Decimal(row[3])*(Decimal(10)**decimals)
            assert amount==amount.to_integral_value()
            minor.append(int(amount))
            truth['links'].append({'originalRow':rn,'page':original['page'],'derivedRow':len(csv_rows),'reference':ref,'referenceOrigin':'explicit-source-cell' if row[1] else 'accepted-section-proposal','referenceParentRow':bindings[rn],'amountLiteral':row[3]})
        output=io.StringIO(newline='');csv.writer(output,lineterminator='\r\n').writerows(csv_rows);payload=output.getvalue().encode('utf-8');(ROOT/(name+'.csv')).write_bytes(payload)
        truth.update({'csvRows':csv_rows,'csvSha256':hashlib.sha256(payload).hexdigest(),'signedAmounts':[row[3] for row in csv_rows[1:]],'amountMinor':minor,'totalMinor':sum(minor),'positiveObligation':'all movements, qualified header and exact currency context must be preserved after explicit review'})
    else: truth.update({'reason':spec['reason'],'newCurrencyReceipt':False,'derivedCurrencyArtifact':False,'partialArtifact':False})
    write_json(name+'.expected.json',truth)
    catalogue.append({'id':name,'original':name+'.pdf','expected':name+'.expected.json','outcome':spec['outcome']})

actions=[
    {'id':'sar-wrong-zero-exponent','source':'sar-on-page','change':{'selectedDecimals':0}},
    {'id':'sar-wrong-three-exponent','source':'sar-on-page','change':{'selectedDecimals':3}},
    {'id':'jpy-wrong-two-exponent','source':'jpy-on-page','change':{'selectedDecimals':2}},
    {'id':'kwd-wrong-two-exponent','source':'kwd-on-page','change':{'selectedDecimals':2}},
    {'id':'cached-qualified-header-tamper','source':'sar-cross-page','change':{'row':4,'column':4,'literal':'Signed amount (JPY)'}},
    {'id':'original-qualified-header-tamper','source':'sar-cross-page','change':'change original qualifier bytes without the reviewed original hash'},
    {'id':'currency-citation-literal-tamper','source':'sar-cross-page','change':'change currency evidence literal after review'},
    {'id':'currency-citation-coordinate-tamper','source':'sar-cross-page','change':'change physical row/page/column of currency evidence'},
    {'id':'omit-second-header-evidence','source':'sar-cross-page','change':'remove original page2 currency evidence'},
    {'id':'source-swap-after-review','source':'sar-on-page','change':'replace original SAR source with original JPY source after owned receipt'},
    {'id':'precision-swap-after-review','source':'kwd-on-page','change':'change selectedDecimals from3 to2 after owned receipt'},
    {'id':'revision-swap-after-review','source':'sar-on-page','change':'change extractionRevision after owned receipt'},
    {'id':'copied-currency-receipt','source':'sar-on-page','change':'copy or deserialize owned receipt'},
    {'id':'sidecar-currency-tamper','source':'sar-on-page','change':'replace sidecar currency SAR withJPY before validation/import'},
    {'id':'sidecar-precision-tamper','source':'sar-on-page','change':'replace sidecar decimals2 with0 before validation/import'},
    {'id':'source-swap-during-replay','source':'sar-cross-page','change':'replace source during awaited original replay'},
    {'id':'cancellation-during-replay','source':'sar-cross-page','change':'cancel at first native PDF page before next-page publication'},
    {'id':'incomplete-selected-movements','source':'sar-on-page','change':'leave one missing-reference movement proposal unselected'},
]
for action in actions: action.update({'outcome':'refused','partialArtifact':False,'financialApproval':False})
write_json('actions.json',{'version':'P4_QUALIFIED_CURRENCY_ACTIONS_V1','actions':actions})
write_json('contract.json',{'version':'P4_QUALIFIED_CURRENCY_DRAFT_V1','status':'independent-precode-draft-not-native-accepted','synthetic':True,'expectedFromProduct':False,'productImports':False,'fieldAcceptance':False,'financialApproval':False,'precisionPolicy':POLICY,'exactAmountHeaders':[header(code)[3] for code in POLICY],'mapping':{'sheet':0,'header':0,'date':0,'reference':1,'description':2,'amount':3,'mode':'signed','multiplier':1,'currencyColumn':-1,'debit':-1,'credit':-1,'numberFormat':'dot','dateFormat':'ymd','pdfReviewed':True},'cuts':[25,45,70],'nativeRowCoordinates':'one-based','derivedHeaderPolicy':'retain exact original qualified header','precisionOrigin':'finite-contract-policy; not an original exponent cell','cases':catalogue,'actions':'actions.json','counts':{'derived':9,'blocked':16,'outsideNewFamilyControls':2,'actions':18}})
manifest={p.name:{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(ROOT.iterdir())}
write_json('freeze.json',{'version':'P4_QUALIFIED_CURRENCY_FREEZE_DRAFT_V1','expectedFromProduct':False,'productImports':False,'nativeAccepted':False,'files':manifest})
print(json.dumps({'files':len(manifest),'cases':len(cases),'positiveCases':9,'blockedCases':16,'outsideNewFamilyControls':2,'actions':len(actions),'freezeSha256':hashlib.sha256((ROOT/'freeze.json').read_bytes()).hexdigest()},indent=2))
