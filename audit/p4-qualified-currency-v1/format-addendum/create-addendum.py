"""Additive independent dot/grouping interpretation truth; no product imports.

Read-only original frozen inputs are referenced and never rewritten.
"""
from pathlib import Path
from decimal import Decimal
import hashlib,json

HERE=Path(__file__).parent
ORIGINAL=HERE.parent/'p4-qualified-currency-v1'
if (HERE/'contract-addendum.json').exists(): raise SystemExit('Refusing to regenerate existing addendum.')
SHA=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
assert SHA(ORIGINAL/'MANIFEST.json')=='83c0ce2ccafa08bfff3f20bfa0831eae145434c98ba779cada4c421d38afda79'
assert SHA(ORIGINAL/'frozen/freeze.json')=='1b9612a623e3055fe6fa369eb4b7b175da67ab04e07f0895e42b112fb251c7c4'

def write(name,value): (HERE/name).write_text(json.dumps(value,ensure_ascii=True,indent=2)+'\n')

manual=[]
for case_id in ['kwd-on-page','kwd-cross-page','kwd-own-reference']:
    truth=json.loads((ORIGINAL/'frozen'/(case_id+'.expected.json')).read_text())
    literal=truth['signedAmounts']
    assert literal==['-12.500','+2.005','0.000']
    dot=[int(Decimal(value)*1000) for value in literal]
    grouping=[int(Decimal(value.replace('.',''))*1000) for value in literal]
    assert dot==[-12500,2005,0] and grouping==[-12500000,2005000,0]
    common={'value':'dot','sheet':0,'header':0,'columns':[3],'decimals':3,'candidates':['dot','comma'],'excludedRows':[],'balanceInputs':['','']}
    manual.append({'id':case_id,'originalSha256':truth['originalSha256'],'derivedCsvSha256':truth['csvSha256'],'currency':'KWD','decimals':3,'signedAmounts':literal,'numericInterpretations':{'dotDecimalMinor':dot,'dotGroupingMinor':grouping},'acknowledgement':{'originalDotInterpretationReviewed':True},'originalNumberFormatChoice':{**common,'sourceHash':truth['originalSha256'],'cuts':[25,45,70]},'derivedNumberFormatChoice':{**common,'sourceHash':truth['csvSha256'],'cuts':[]},'originalExtractionBinding':{'required':['extractionHash','extractionRevision'],'valuesMustComeFrom':'fresh replay of the bound original PDF; this independent draft does not fabricate extraction output hashes'},'outcomeAfterExplicitReview':'derived-exact-original-csv','outcomeWithoutExplicitReview':'refused-no-currency-receipt-or-artifact','financialApproval':False})
write('manual-number-format-truth.json',{'version':'P4_QUALIFIED_CURRENCY_DOT_TRUTH_V1','expectedFromProduct':False,'productImports':False,'cases':manual})

base={'source':'kwd-cross-page','outcome':'refused','partialArtifact':False,'financialApproval':False}
actions=[]
for action_id,change in [
    ('missing-original-dot-acknowledgement','remove originalDotInterpretationReviewed acknowledgement'),
    ('false-original-dot-acknowledgement','set originalDotInterpretationReviewed false'),
    ('missing-original-choice','supply mapping.numberFormat dot without an original bound choice'),
    ('forged-choice-source-hash','replace original choice sourceHash with derived CSV SHA256'),
    ('choice-value-comma','replace original selected choice value with comma'),
    ('choice-amount-column','replace original choice columns[3] with[2]'),
    ('choice-header-row','replace original choice header0 with1'),
    ('choice-sheet','replace original choice sheet0 with1'),
    ('choice-exponent','replace original choice decimals3 with2'),
    ('choice-missing-candidate','replace original choice candidates[dot,comma] with[dot]'),
    ('choice-extra-candidate','append an unrecognized third candidate'),
    ('choice-duplicate-candidate','replace original choice candidates with[dot,dot]'),
    ('choice-cuts','replace original choice cuts[25,45,70] with[25,46,70]'),
    ('choice-exclusion','replace original choice excludedRows[] with[3]'),
    ('choice-balance-input','replace original choice empty balanceInputs with[0,empty]'),
    ('choice-extraction-revision','change original extractionRevision while preserving file SHA256'),
    ('choice-extraction-hash','change original extractionHash while preserving file SHA256'),
    ('choice-swap-during-replay','replace acknowledged dot choice with comma during original replay await'),
    ('acknowledgement-cleared-during-replay','clear originalDotInterpretationReviewed during original replay await'),
    ('derived-choice-original-hash-reuse','use original PDF sourceHash for derived CSV formatChoice'),
    ('derived-choice-precision','replace derived choice exponent3 with2'),
    ('derived-choice-amount-column','replace derived choice columns[3] with[2]'),
    ('derived-choice-candidate-tamper','remove comma from supplied derived candidates while fresh native candidate set is[dot,comma]'),
    ('derived-choice-pdf-cuts','retain original PDF cuts in new CSV choice instead of empty cuts'),
    ('provenance-without-original-review','supply sidecar claiming reviewed dot while live original review/choice is absent'),
    ('choice-getter','replace a new choice/context field with accessor descriptor; require zero getter reads before refusal'),
    ('choice-over-budget','supply over-budget new choice/candidate metadata; require refusal before copying'),
]: actions.append({'id':action_id,**base,'change':change})
write('actions-addendum.json',{'version':'P4_QUALIFIED_CURRENCY_DOT_ACTIONS_V1','actions':actions,'allActionsPreserveOriginalSources':True})
write('contract-addendum.json',{'version':'P4_QUALIFIED_CURRENCY_DOT_ADDENDUM_V1','status':'independent-precode-addendum-not-implementation-accepted','originalDraftManifestSha256':SHA(ORIGINAL/'MANIFEST.json'),'originalFreezeSha256':SHA(ORIGINAL/'frozen/freeze.json'),'productImports':False,'expectedFromProduct':False,'nativeExtractionAcceptanceIsSeparate':True,'implementationAccepted':False,'scope':'only explicit original dot review and new-source rebound numberFormat choice for the existing finite qualified-currency family','ambiguousMandatoryPositiveIds':['kwd-on-page','kwd-cross-page','kwd-own-reference'],'otherSixMandatoryPositiveIds':['sar-on-page','sar-cross-page','sar-own-reference','jpy-on-page','jpy-cross-page','jpy-own-reference'],'manualTruth':'manual-number-format-truth.json','actions':'actions-addendum.json','counts':{'reviewedAmbiguousPositives':3,'unchangedOtherPositives':6,'additionalRefusalActions':len(actions)},'financialApproval':False})
print(json.dumps({'files':['contract-addendum.json','manual-number-format-truth.json','actions-addendum.json'],'additionalRefusalActions':len(actions)},indent=2))
