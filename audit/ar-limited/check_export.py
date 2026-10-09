"""Independent native AR source and OpenXML membership oracle; no product imports."""
import argparse
import base64
import csv
from datetime import datetime
from decimal import Decimal
import hashlib
import io
import json
from pathlib import Path
import zipfile
import xml.etree.ElementTree as ET

NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'


def sheets(path):
    result = {}
    with zipfile.ZipFile(path) as archive:
        strings = []
        if 'xl/sharedStrings.xml' in archive.namelist():
            strings = [''.join(n.itertext()) for n in ET.fromstring(archive.read('xl/sharedStrings.xml')).findall('s:si', NS)]
        relations = {node.attrib['Id']: node.attrib['Target'].lstrip('/') for node in ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))}
        for sheet in ET.fromstring(archive.read('xl/workbook.xml')).findall('s:sheets/s:sheet', NS):
            target = relations[sheet.attrib[R]]
            if not target.startswith('xl/'):
                target = 'xl/' + target
            rows = []
            for row in ET.fromstring(archive.read(target)).findall('s:sheetData/s:row', NS):
                cells = {}
                for cell in row.findall('s:c', NS):
                    assert cell.find('s:f', NS) is None, 'unexpected executable formula'
                    index = 0
                    for char in ''.join(c for c in cell.attrib['r'] if c.isalpha()):
                        index = index * 26 + ord(char) - 64
                    value = cell.find('s:v', NS)
                    raw = value.text if value is not None else ''
                    cells[index-1] = strings[int(raw)] if cell.get('t') == 's' else raw
                rows.append([cells.get(i, '') for i in range(max(cells, default=-1)+1)])
            result[sheet.attrib['name']] = rows
    return result


def verify(path, contract='positive', reopened=False):
    root = Path(__file__).parent / 'frozen'
    expected = next(c for c in json.loads((root / 'expected.json').read_text())['cases'] if c['name'] == contract)
    originals = [list(csv.reader(io.StringIO((root / f['file']).read_text()))) for f in expected['files']]
    book = sheets(path)
    summary = dict(book['Summary'][1:])
    assert summary['Domain'] == 'customer-ar-document-comparison'
    assert summary['Version'] == 'ar-limited-1'
    assert summary['Perspective'] == 'seller-receivable'
    assert summary['Amount basis'] == 'original-movement'
    assert int(summary['Reading errors']) == 0
    assert {k:summary[k] for k in ['entity','ledger','customer','account','currency','start','end']} == {'entity':'Synthetic Seller','ledger':'AR Book','customer':'C0001','account':'1200','currency':'SAR','start':'2026-09-01','end':'2026-09-30'}
    assert [int(summary[k]) for k in ['Ledger total minor units','Statement total minor units']] == [sum(f['amountsMinor']) for f in expected['files']]
    columns = ['sheet','header','posting','kind','document','date','amount','entity','ledger','customer','account','currency','related','description']
    reading_keys = columns + ['role','perspective','basis','confirmed']
    roles = ['company-ar-ledger','company-issued-customer-statement']
    readings = [dict(zip(columns,[0,0,*range(12)]), role=role, perspective='seller-receivable', basis='original-movement', confirmed=True) for role in roles]
    reading_rows = book['Reading'][1:]
    assert len(reading_rows) == len(reading_keys)*2
    actual_readings = {(int(r[0]),r[1]):r[2] for r in reading_rows}
    assert len(actual_readings) == len(reading_rows)
    for side, reading in enumerate(readings):
        for key, value in reading.items():
            assert actual_readings[(side,key)] == ('true' if value is True else str(value))
    scope_keys = ['entity','ledger','customer','account','currency','start','end','confirmed']
    scope_values = [summary[k] for k in scope_keys[:-1]]+[True]
    context = json.dumps(['ar-limited-1',[f['sha256'] for f in expected['files']],[[r[k] for k in reading_keys] for r in readings],scope_values],ensure_ascii=False,separators=(',',':'))
    for side, file in enumerate(expected['files']):
        source_rows = [r for r in book['Sources'][1:] if int(r[0]) == side]
        assert source_rows and [int(r[5]) for r in source_rows] == list(range(1,len(source_rows)+1))
        original = base64.b64decode(''.join(r[6] for r in source_rows), validate=True)
        assert original == (root / file['file']).read_bytes()
        assert all(r[3] == hashlib.sha256(original).hexdigest() for r in source_rows)
        assert all(r[1] == ['company-ar-ledger','company-issued-customer-statement'][side] for r in source_rows)
        inventory = book[['Ledger inventory','Statement inventory'][side]][1:]
        assert len(inventory) == len(originals[side])
        assert [int(r[0]) for r in inventory] == list(range(1,len(inventory)+1))
        assert [r[1] for r in inventory] == ['header'] + ['movement']*(len(inventory)-1)
        for row, raw in zip(inventory, originals[side]):
            assert (row[3:]+['']*len(raw))[:len(raw)] == raw
    movements = book['Movements'][1:]
    assert len(movements) == sum(f['sourceRows'] for f in expected['files'])
    assert int(summary['Valid movements']) == len(movements)
    by_id = {r[0]:r for r in movements}
    assert len(by_id) == len(movements)
    for side in [0,1]:
        actual = [r for r in movements if int(r[1]) == side]
        assert [int(r[2]) for r in actual] == list(range(2,len(originals[side])+1))
        assert [int(r[7]) for r in actual] == expected['files'][side]['amountsMinor']
        for row, raw in zip(actual, originals[side][1:]):
            assert row[0] == f"{side}:{expected['files'][side]['sha256']}:0:{row[2]}"
            assert row[3:7] == [raw[0],raw[1],raw[2],raw[3]]
            assert row[8:10] == raw[10:12]
            assert json.loads(row[13]) == ([raw[10]] if raw[10] else [])
    membership = book['Membership'][1:]
    assert len(membership) == len(movements) and len({r[1] for r in membership}) == len(movements)
    assert {r[1] for r in membership} == set(by_id)
    cases = {r[0]:r for r in book['Cases'][1:]}
    assert len(cases) == len(book['Cases'])-1
    assert all(r[0] in cases for r in membership)
    assert all(r[2:4] == by_id[r[1]][1:3] for r in membership)
    decision_state = {}
    for index, event in enumerate(book['Decisions'][1:],1):
        assert len(event) == 6 and int(event[0]) == index and event[1] == context
        assert event[2] in ['accept','reopen'] and 8 <= len(event[4].strip()) <= 200
        assert datetime.strptime(event[5],'%Y-%m-%dT%H:%M:%S.%fZ').strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3]+'Z' == event[5]
        ids = json.loads(event[3])
        assert isinstance(ids,list) and len(ids) == 2 and len(set(ids)) == 2 and all(i in by_id for i in ids)
        owners = {by_id[i][10] for i in ids}
        assert len(owners) == 1
        owner = next(iter(owners))
        actual_ids = {r[1] for r in membership if r[0] == owner}
        assert set(ids) == actual_ids
        members = sorted([by_id[i] for i in ids],key=lambda r:int(r[1]))
        assert [int(r[1]) for r in members] == [0,1] and members[0][4:8] == members[1][4:8]
        prior = decision_state.get(owner, ('matched','',''))[0]
        assert (event[2] == 'reopen' and prior == 'matched') or (event[2] == 'accept' and prior == 'review')
        decision_state[owner] = ('review' if event[2] == 'reopen' else 'matched',event[2],event[4])
    pairs = []
    for key, case in cases.items():
        members = [by_id[r[1]] for r in membership if r[0] == key]
        assert len(members) == int(case[6]) and members
        assert all(r[10:13] == [key,case[3],case[4]] for r in members)
        assert all(r[4:6] == case[1:3] for r in members)
        if key in decision_state:
            status,action,note = decision_state[key]
            assert case[3] == status and case[7] == note
            assert case[4] == ('none' if action == 'reopen' else 'human-confirmation')
            assert case[5] == ('reopened' if action == 'reopen' else 'human-confirmation')
        else:
            assert case[4] != 'human-confirmation' and not case[7]
        if case[3] == 'matched':
            assert len(members) == 2 and {int(r[1]) for r in members} == {0,1}
            members.sort(key=lambda r:int(r[1]))
            assert members[0][4:8] == members[1][4:8]
            assert case[4] in ['own-document','human-confirmation']
            if case[4] == 'human-confirmation':
                assert len(case[7].strip()) >= 8 and any(r[2] == 'accept' for r in book['Decisions'][1:])
            pairs.append([int(r[2]) for r in members])
    required = expected['requiredPairs'][1:] if reopened else expected['requiredPairs']
    assert sorted(pairs) == sorted(required)
    assert int(summary['Matched document pairs']) == len(required)
    assert int(summary['Decimals']) == 2
    return {'file':str(path),'contract':contract,'reopened':reopened,'matchedPairs':pairs,'sourceRows':len(movements),'passed':True,'scope':'independent synthetic source facts, original bytes and exact document membership; not field accuracy'}

if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('files',nargs='+')
    parser.add_argument('--contract',default='positive')
    parser.add_argument('--reopened',action='store_true')
    args=parser.parse_args()
    print(json.dumps([verify(p,args.contract,args.reopened) for p in args.files],indent=2))
