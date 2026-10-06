"""Independent OpenXML oracle for the frozen synthetic clearing table.

Reads no product parsers or clearing code. Rejects missing/duplicated ownership,
invented automatic relationships, changed amounts and lost source inventory.
"""
import argparse
import csv
import hashlib
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


def verify(path, cleared=5):
    root = Path(__file__).parent / 'frozen'
    expected = json.loads((root / 'expected.json').read_text())
    original = list(csv.reader((root / 'source.csv').read_text().splitlines()))
    book = sheets(path)
    summary = dict(book['Summary'][1:])
    assert summary['Domain'] == 'single-account-clearing'
    assert summary['Version'] == 'clearing-1'
    assert summary['Source SHA-256'] == hashlib.sha256((root / 'source.csv').read_bytes()).hexdigest()
    assert int(summary['Total minor units']) == expected['totalMinor']
    assert int(summary['Cleared movement count']) == cleared
    assert int(summary['Error count']) == 0
    movements = book['Movements'][1:]
    assert len(movements) == 9
    assert [int(row[5]) for row in movements] == expected['amountsMinor']
    assert [int(row[1]) for row in movements] == list(range(2, 11))
    assert [row[2] for row in movements] == [row[0] for row in original[1:]]
    assert [row[3] for row in movements] == [row[1] for row in original[1:]]
    assert [row[6] for row in movements] == [row[6] for row in original[1:]]
    by_id = {row[0]: row for row in movements}
    assert len(by_id) == 9
    membership = book['Membership'][1:]
    assert len(membership) == 9
    assert len({row[1] for row in membership}) == 9
    assert {row[1] for row in membership} == set(by_id)
    cases = {row[0]: row for row in book['Cases'][1:]}
    assert len(cases) == len(book['Cases'])-1
    assert sum(int(case[5]) for case in cases.values()) == expected['totalMinor']
    actual_cleared = 0
    for key, case in cases.items():
        members = [by_id[row[1]] for row in membership if row[0] == key]
        assert len(members) == int(case[6]) and members
        assert sum(int(row[5]) for row in members) == int(case[5])
        assert all(row[7] == key and row[8] == case[1] and row[9] == case[2] for row in members)
        if case[1] == 'cleared':
            actual_cleared += len(members)
            assert int(case[5]) == 0
            assert any(int(row[5]) > 0 for row in members) and any(int(row[5]) < 0 for row in members)
            source_rows = sorted(int(row[1]) for row in members)
            if case[2] == 'explicit-reference':
                assert source_rows in expected['automaticGroups']
                assert len({row[3] for row in members}) == 1 and members[0][3]
            else:
                assert case[2] == 'human-decision' and source_rows == [7, 8] and len(case[7].strip()) >= 8
    assert actual_cleared == cleared
    inventory = book['Source inventory'][1:]
    assert len(inventory) == len(original)
    for actual, source in zip(inventory, original):
        assert actual[3:] == source
    assert sum(row[1] == 'movement' for row in inventory) == 9
    return {'file': str(path), 'movements': 9, 'cleared': cleared, 'totalMinor': 1000, 'sample': expected['sample']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('files', nargs='+')
    parser.add_argument('--cleared', type=int, default=5)
    args = parser.parse_args()
    print(json.dumps([verify(path, args.cleared) for path in args.files], indent=2))
