"""Second independent path: interpret source literals, not generator kinds or product output."""
from pathlib import Path
from decimal import Decimal
import collections,csv,datetime,hashlib,io,json,re,sys
ROOT=Path(__file__).resolve().parent;F=ROOT/'frozen'
H=['Date','Reference','Description','Debit','Credit'];ID=r'[A-Za-z0-9][A-Za-z0-9._/-]{0,63}'
class Refusal(Exception):
    def __init__(self,code):self.code=code
def fail(code):raise Refusal(code)
def money(s):
    if not s:fail('SPLIT_MISSING_SIDE')
    if not re.fullmatch(r'[0-9]+(?:\.[0-9]+)?',s):fail('SPLIT_MONEY_FORMAT')
    if '.' in s and len(s.split('.')[1])>2:fail('SPLIT_MONEY_PRECISION')
    n=Decimal(s)*100
    if n!=n.to_integral_value():fail('SPLIT_MONEY_PRECISION')
    if n>10**14:fail('SPLIT_MONEY_LIMIT')
    return int(n)
def stage(code):
    if code in ['SPLIT_DOUBLE_AMOUNT','SPLIT_MISSING_SIDE','SPLIT_MONEY_FORMAT','SPLIT_MONEY_PRECISION','SPLIT_MONEY_LIMIT','SPLIT_DATE']:return 'money'
    if code in ['SPLIT_SECTION_TOTAL','SPLIT_PAGE_TOTAL','SPLIT_GRAND_TOTAL','SPLIT_CARRY_TOTAL']:return 'aggregate'
    return 'structure'
def physical_pdf_page_count(source_bytes):
    """Bounded literal-PDF fixture page-tree check, not a general PDF parser."""
    objects = dict((int(n), body) for n, body in re.findall(rb'(\d+) 0 obj\s*(.*?)\s*endobj', source_bytes, re.S))
    roots = [body for body in objects.values() if re.search(rb'/Type\s*/Pages\b', body)]
    if len(roots) != 1: fail('SPLIT_PAGE_MAP')
    count = re.search(rb'/Count\s+(\d+)\b', roots[0])
    kids = re.search(rb'/Kids\s*\[([^]]*)\]', roots[0])
    if not count or not kids: fail('SPLIT_PAGE_MAP')
    children = [int(x) for x in re.findall(rb'(\d+) 0 R', kids[1])]
    if not children or len(set(children)) != len(children) or len(children) != int(count[1]): fail('SPLIT_PAGE_MAP')
    if any(not re.search(rb'/Type\s*/Page\b', objects.get(child, b'')) for child in children): fail('SPLIT_PAGE_MAP')
    if len([body for body in objects.values() if re.search(rb'/Type\s*/Page\b', body)]) != len(children): fail('SPLIT_PAGE_MAP')
    return len(children)

def validate_page_map(oracle, source_bytes=None):
    inventory = oracle.get('inventory')
    count = oracle.get('pageCount')
    if type(count) is not int or not 1 <= count <= 100 or not isinstance(inventory, list) or not inventory: fail('SPLIT_PAGE_MAP')
    if source_bytes is not None and physical_pdf_page_count(source_bytes) != count: fail('SPLIT_PAGE_MAP')
    pages = []
    for expected_row, entry in enumerate(inventory, 1):
        if not isinstance(entry, dict) or type(entry.get('row')) is not int or entry['row'] != expected_row: fail('SPLIT_PAGE_MAP')
        page = entry.get('page')
        if type(page) is not int or not 1 <= page <= count: fail('SPLIT_PAGE_MAP')
        if pages and page < pages[-1]: fail('SPLIT_PAGE_MAP')
        pages.append(page)
    if set(pages) != set(range(1, count + 1)): fail('SPLIT_PAGE_MAP')

def classify_and_calculate(oracle, source_bytes=None):
    validate_page_map(oracle, source_bytes)
    inventory=oracle['inventory'];pages=collections.defaultdict(list)
    for r in inventory:
        if len(r['values'])!=5:fail('SPLIT_COLUMNS')
        pages[r['page']].append((r['row'],r['values']))
    active=None;groups={};moves=[];pt=[];pending=None;grand=False;classified=[]
    for pn,rows in sorted(pages.items()):
        if rows[0][1]!=['SYNTHETIC ONLY','','','','']:fail('SPLIT_PAGE_HEADER')
        classified.append((rows[0][0],'synthetic'));offset=1
        if pn==1:
            if len(rows)<2 or rows[1][1]!=['Currency: SAR','','','','']:fail('SPLIT_CURRENCY')
            classified.append((rows[1][0],'currency'));offset=2
        if len(rows)<=offset:fail('SPLIT_PAGE_HEADER')
        if rows[offset][1]!=H:fail('SPLIT_HEADER')
        classified.append((rows[offset][0],'header'));body=rows[offset+1:];pd=pc=0;page_closed=False;carried=False
        if pn>1 and active is not None:
            if not body:fail('SPLIT_CONTINUATION')
            first=body[0][1][0]
            if first!='Continued invoice: '+active and not re.fullmatch('Invoice: '+ID,first):fail('SPLIT_CONTINUATION')
            if pending is not None and first!='Continued invoice: '+active:fail('SPLIT_CARRY_ORPHAN')
        for bi,(ri,v) in enumerate(body):
            text=v[0];kind=None
            if grand:fail('SPLIT_AFTER_GRAND_TOTAL')
            if page_closed and text!='Grand total':fail('SPLIT_AFTER_PAGE_TOTAL')
            if carried and text!='Page total':fail('SPLIT_CARRY_ORPHAN')
            if v==H:kind='header'
            elif text.startswith('Currency:'):
                if v!=['Currency: SAR','','','','']:fail('SPLIT_CURRENCY')
                kind='currency'
            elif any(x in H for x in v) and text=='Date':fail('SPLIT_HEADER')
            elif re.fullmatch('Invoice: '+ID,text):
                if any(v[1:]):fail('SPLIT_UNKNOWN_ROW')
                if pending is not None:fail('SPLIT_CARRY_ORPHAN')
                active=text[9:]
                if active in groups:fail('SPLIT_DUPLICATE_PARENT')
                groups[active]={'debitMinor':0,'creditMinor':0,'rows':[]};kind='parent'
            elif text.startswith('Continued invoice:'):
                if pn==1 or bi!=0 or active is None or text!='Continued invoice: '+active or any(v[1:]):fail('SPLIT_CONTINUATION')
                kind='continuation'
            elif text=='---' and not any(v[1:]):active=None;kind='separator'
            elif text in ['Opening balance','Closing balance','Running balance']:fail('SPLIT_BALANCE_UNSUPPORTED')
            elif text.startswith('Section total:') or text in ['Page total','Grand total','Carried forward','Brought forward']:
                if v[1] or v[2]:fail('SPLIT_UNKNOWN_ROW')
                d,c=money(v[3]),money(v[4])
                if text.startswith('Section total:'):
                    if active is None or text!='Section total: '+active:fail('SPLIT_SECTION_TOTAL')
                    g=groups[active]
                    if [d,c]!=[g['debitMinor'],g['creditMinor']]:fail('SPLIT_SECTION_TOTAL')
                    active=None;kind='section-total'
                elif text=='Page total':
                    if page_closed or [d,c]!=[pd,pc]:fail('SPLIT_PAGE_TOTAL')
                    page_closed=True;kind='page-total'
                elif text=='Grand total':
                    if pn!=oracle['pageCount']:fail('SPLIT_GRAND_TOTAL')
                    if [d,c]!=[sum(m['debitMinor'] for m in moves),sum(m['creditMinor'] for m in moves)]:fail('SPLIT_GRAND_TOTAL')
                    grand=True;kind='grand-total'
                elif text=='Carried forward':
                    if active is None or pn==oracle['pageCount'] or pending is not None:fail('SPLIT_CARRY_ORPHAN')
                    g=groups[active]
                    if [d,c]!=[g['debitMinor'],g['creditMinor']]:fail('SPLIT_CARRY_TOTAL')
                    pending=[d,c];carried=True;kind='carried'
                else:
                    if active is None or pending is None or bi!=1 or body[0][1][0]!='Continued invoice: '+active:fail('SPLIT_CARRY_ORPHAN')
                    if [d,c]!=pending:fail('SPLIT_CARRY_TOTAL')
                    pending=None;kind='brought'
            elif (text and text[0].isdigit()) or (not text and (v[3] or v[4])):
                if active is None:fail('SPLIT_NO_PARENT')
                if pending is not None:fail('SPLIT_CARRY_ORPHAN')
                if not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}',text):fail('SPLIT_DATE')
                if not 1900 <= int(text[:4]) <= 2100:fail('SPLIT_DATE')
                try:datetime.date.fromisoformat(text)
                except ValueError:fail('SPLIT_DATE')
                if v[1] and v[1]!=active:fail('SPLIT_REFERENCE_CONFLICT')
                d,c=money(v[3]),money(v[4])
                if d>0 and c>0:fail('SPLIT_DOUBLE_AMOUNT')
                pd+=d;pc+=c;g=groups[active];g['debitMinor']+=d;g['creditMinor']+=c;g['rows'].append(ri)
                if max(g['debitMinor'],g['creditMinor'],sum(x['debitMinor'] for x in groups.values()),sum(x['creditMinor'] for x in groups.values()))>10**14:fail('SPLIT_MONEY_LIMIT')
                moves.append({'originalRow':ri,'page':pn,'section':active,'referenceOrigin':'explicit-source-cell' if v[1] else 'accepted-section-proposal','reference':active,'date':text,'description':v[2],'debitText':v[3],'creditText':v[4],'debitMinor':d,'creditMinor':c,'netMinor':d-c,'derivedRow':len(moves)+2});kind='movement'
            else:fail('SPLIT_UNKNOWN_ROW')
            classified.append((ri,kind))
        pt.append({'page':pn,'debitMinor':pd,'creditMinor':pc})
    if pending is not None:fail('SPLIT_CARRY_ORPHAN')
    if not moves:fail('SPLIT_NO_MOVEMENTS')
    out=io.StringIO(newline='');writer=csv.writer(out,lineterminator='\r\n');writer.writerow(H)
    for m in moves:writer.writerow([m['date'],m['reference'],m['description'],m['debitText'],m['creditText']])
    return {'movements':moves,'sections':groups,'pageTotals':pt,'totals':{'debitMinor':sum(m['debitMinor'] for m in moves),'creditMinor':sum(m['creditMinor'] for m in moves),'netMinor':sum(m['netMinor'] for m in moves)},'csv':out.getvalue().encode(),'classified':classified}


def source_literal_inventory(source_bytes):
    """Read the bounded synthetic fixture's literal paints independently of product."""
    objects = dict((int(n), body) for n, body in re.findall(rb'(\d+) 0 obj\s*(.*?)\s*endobj', source_bytes, re.S))
    page_tree = next(body for body in objects.values() if re.search(rb'/Type\s*/Pages\b', body))
    kids = re.search(rb'/Kids\s*\[([^]]*)\]', page_tree)[1]
    pages = [int(x) for x in re.findall(rb'(\d+) 0 R', kids)]
    inventory = []
    for pn, pid in enumerate(pages, 1):
        body = objects[pid]
        cid = int(re.search(rb'/Contents\s+(\d+) 0 R', body)[1])
        stream = objects[cid].split(b'stream\n', 1)[1].rsplit(b'\nendstream', 1)[0]
        width = int(re.search(rb'/MediaBox \[0 0 (\d+) 820\]', body)[1])
        xs = [20,145,270,450,550,650] if width == 760 else [20,145,270,500,600]
        rows = {}
        pattern = rb'BT /F1 8 Tf 1 0 0 1 (\d+) (\d+) Tm \(((?:\\.|[^\\)])*)\) Tj ET'
        paints = list(re.finditer(pattern, stream))
        assert b'\n'.join(m[0] for m in paints) == stream, 'unrecognized fixture paint'
        for paint in paints:
            x,y = int(paint[1]),int(paint[2])
            if x == 165: col = 1
            else: col = xs.index(x)
            text = re.sub(rb'\\(.)', rb'\1', paint[3]).decode('ascii')
            row = rows.setdefault(y, [''] * len(xs))
            assert row[col] == '', 'duplicate paint cell'
            row[col] = text
        for y, values in sorted(rows.items(), reverse=True):
            inventory.append({'row':len(inventory)+1, 'page':pn, 'values':values})
    return inventory

def main():
    from verify_inputs import verify
    integrity = verify()
    results=[]; checks=integrity['checks']
    for c in json.loads((F/'CASES.json').read_text()):
        o=json.loads((F/c['oracle']).read_text());failures=[];actual=None
        try:
            b=(F/c['source']).read_bytes()
            assert len(b)==o['sourceBytes']; checks+=1
            assert hashlib.sha256(b).hexdigest()==o['sourceSha256']; checks+=1
            literal = source_literal_inventory(b)
            if c['metadataMutation']:
                complete=json.loads((F/'MAP-complete-three-pages/oracle.json').read_text())
                assert literal==[{k:r[k] for k in ['row','page','values']} for r in complete['inventory']]; checks+=1
                assert o['cuts']==complete['cuts']; checks+=1
            else:
                assert literal==[{k:r[k] for k in ['row','page','values']} for r in o['inventory']]; checks+=1
            try:
                actual=classify_and_calculate(o,b)
                assert o['accepted'],'Unexpected legal negative'
                for k in ['movements','sections','pageTotals','totals']:assert actual[k]==o[k],k;checks+=1
                assert actual['classified']==[(x['row'],x['kind']) for x in o['inventory']];checks+=1
                csvbytes=(F/c['id']/'expected.csv').read_bytes();assert csvbytes==actual['csv'];checks+=1
                assert hashlib.sha256(csvbytes).hexdigest()==o['expectedCsvSha256'];checks+=1
                assert not o['financialApproval'] and not o['scopeConfirmed'] and not o['newAuthorityBeforeApply'];checks+=1
            except Refusal as e:
                assert not o['accepted'],'Unexpected positive refusal: '+e.code
                assert e.code==o['expectedCode'],(e.code,o['expectedCode']);checks+=1
                assert stage(e.code)==o['expectedStage'];checks+=1
                assert o['totals'] is None and not o['movements'] and not o['csvAvailableAfterFutureExplicitApply'];checks+=1
                assert not (F/c['id']/'expected.csv').exists(); checks+=1
        except Exception as e:failures.append(repr(e))
        results.append({'id':c['id'],'passed':not failures,'failures':failures,'expectedCode':o['expectedCode'],'expectedStage':o['expectedStage']})
    report={'mode':'Independent literal-source and financial oracle check','productImports':False,'cases':len(results),'checks':checks,'passedCases':sum(x['passed'] for x in results),'failedCases':sum(not x['passed'] for x in results),'results':results,'actionsExecuted':False,'inputIntegrity':integrity}
    if len(sys.argv)>1:
        out=Path(sys.argv[1]);out.parent.mkdir(exist_ok=True,parents=True)
        if out.exists():raise SystemExit('Refuse to overwrite consistency result')
        out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k!='results'}))
    raise SystemExit(0 if not report['failedCases'] else 1)
if __name__=='__main__':main()
