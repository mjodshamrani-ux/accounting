"""G5b: strict label-only normalization, independent OpenXML/original oracle.
The frozen Arabic labels are presentation expectations, never financial truth.
"""
import argparse
import copy
import importlib.util
import json
import re
import hashlib
from datetime import datetime
from pathlib import Path
from zipfile import ZipFile
import xml.etree.ElementTree as ET
BASE=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('g5b_export',BASE/'inventory-pdf-workbook/check_export.py')
g5=importlib.util.module_from_spec(spec);spec.loader.exec_module(g5)
AR=json.loads(Path(__file__).with_name('labels.ar.json').read_text())
assert len(set(AR.values()))==len(AR), 'LABEL_COLLISION'
REVERSE={v:k for k,v in AR.items()}

def read(book, language):
    tables=g5.reader.read_workbook(book)
    with ZipFile(book) as z:
        for name in z.namelist():
            if name.startswith('xl/worksheets/sheet') and name.endswith('.xml'):
                root=ET.fromstring(z.read(name));views=root.findall(g5.reader.NS+'sheetViews/'+g5.reader.NS+'sheetView')
                if language=='ar':
                    assert views and all(v.get('rightToLeft') in ['1','true'] for v in views), 'LANGUAGE_DIRECTION'
                else:
                    assert all(v.get('rightToLeft') not in ['1','true'] for v in views), 'LANGUAGE_DIRECTION'
    if language=='en':return tables
    normalized={}
    for name,rows in tables.items():
        assert name in REVERSE,'AR_SHEET_LABEL'
        key=REVERSE[name];assert key not in normalized,'AR_DUPLICATE_SHEET'
        assert rows and all(h in REVERSE for h in rows[0]),'AR_HEADER_LABEL'
        values=copy.deepcopy(rows);values[0]=[REVERSE[h] for h in rows[0]]
        if key=='Summary':
            for row in values[1:]:
                assert row[0] in REVERSE,'AR_SUMMARY_LABEL'
                row[0]=REVERSE[row[0]]
                if row[0] in ['Claim','Register minor basis','Status','Financial','Review','Scope confirmed','Completeness confirmed']:
                    assert len(row)==2 and row[1] in REVERSE,'AR_SUMMARY_VALUE'
                    row[1]=REVERSE[row[1]]
        normalized[key]=values
    return normalized

def check(books,sources,report,ui=False):
    # Full phase/source/quantity/GL/decision verification from unchanged G5a/G3.
    required={'INV1F-'+v for v in g5.g3.CONTRACT['ready']+g5.g3.CONTRACT['difference']+g5.g3.CONTRACT['missing']+list(g5.g3.CONTRACT['sourceErrors'])}
    assert set(report)==required,'CASE_SET'
    baseline={};count=0
    for name,phases in report.items():
        expected=['unreviewed','complete','accepted','undone','rejected','reopened'] if name[6:] in g5.g3.CONTRACT['ready'] else ['unreviewed']
        assert list(phases)==expected,'PHASE_SET'
        baseline[name]=phases['unreviewed']
        for phase,r in phases.items():
            assert type(r['decimals']) is int and r['decimals']==3 and r['version']=='inventory-posted-register-gl-1','VERSION_DECIMALS'
            assert g5.g3.same_value(r['scope'],g5.g4.SCOPE) and g5.g3.same_value(r['readings'],g5.g4.READINGS),'SCOPE_READINGS'
            complete=phase!='unreviewed'
            assert g5.g3.same_value(r['completeness'],dict(confirmed=complete,reference='Synthetic completeness review' if complete else '',note='All original pages reviewed' if complete else '')),'COMPLETENESS'
            context=['inventory-pdf-lifecycle-1',[hashlib.sha256((sources/name/f).read_bytes()).hexdigest() for f in g5.NAMES],g5.g4.READINGS,g5.g4.SCOPE,r['completeness']]
            assert g5.g3.same_value(json.loads(r['context']),context),'CONTEXT'
            types={'unreviewed':[],'complete':[],'accepted':['accept'],'undone':['accept','undo'],'rejected':['accept','undo','reject'],'reopened':['accept','undo','reject','undo']}[phase]
            assert [e['type'] for e in r['events']]==types and len({e['id'] for e in r['events']})==len(types),'DECISION_TYPES'
            for i,e in enumerate(r['events']):
                assert e.keys()=={'id','type','context','at','reference','note','memberIds'} and e['context']==r['context'] and e['memberIds']==baseline[name]['memberIds'],'DECISION_MEMBERS'
                assert e['reference']=='Synthetic source review' and e['note']=='All supplied scope reviewed','DECISION_REFERENCE'
                if ui:
                    assert re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}',e['id']),'DECISION_ID'
                    assert re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z',e['at']),'DECISION_DATE'
                    datetime.fromisoformat(e['at'].replace('Z','+00:00'))
                else: assert e['id']=='decision-'+str(i) and e['at']=='2026-10-16T09:00:00.000Z','DECISION_ID_DATE'
            assert r['review']==('accepted' if phase=='accepted' else 'rejected' if phase=='rejected' else 'needs-review'),'REVIEW'
            assert r['status']==(r['financial'] if r['financial']!='ready' else 'consistent-with-evidence' if phase=='accepted' else 'needs-review'),'STATUS'
            normalized=copy.deepcopy(r);normalized.update(context=baseline[name]['context'],events=[],completeness=baseline[name]['completeness'],review='needs-review',status=baseline[name]['status'])
            assert g5.g3.same_value(normalized,baseline[name]),'FINANCIAL_PHASE_PARITY'
            # The English checker validates every phase and its original scope
            # below; both language workbooks must have identical underlying data.
            canonical=None
            for lang in ['en','ar']:
                f=books/(name+'-'+phase+('-ar' if lang=='ar' else '')+'.xlsx')
                tables=read(f,lang)
                g5.check_tables(tables,sources/name,r)
                if canonical is None:canonical=tables
                else: assert g5.g3.same_value(tables,canonical),'BILINGUAL_DATA_PARITY'
                count+=1
    # Reuses original G5a phase verification, not a product-derived oracle.
    original_check=g5.g3.check(sources,baseline) if ui else g5.check(sources,report,books)
    return dict(passed=True,workbooks=count,cases=len(report),original=original_check)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--books',type=Path,required=True);p.add_argument('--sources',type=Path,required=True);p.add_argument('--result',type=Path,required=True);p.add_argument('--single',type=Path);p.add_argument('--case');p.add_argument('--phase',default='unreviewed');p.add_argument('--language',choices=['ar','en'],default='en');p.add_argument('--ui',action='store_true');a=p.parse_args();r=json.loads(a.result.read_text())
    result=g5.check_tables(read(a.single,a.language),a.sources/a.case,r[a.case][a.phase]) if a.single else check(a.books,a.sources,r,a.ui)
    print(json.dumps(result,ensure_ascii=False))
