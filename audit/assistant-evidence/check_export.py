"""Independent literal source, answer and OOXML checks; no product imports."""
import argparse
import csv
import hashlib
import json
import re
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'export-design'))
from check_membership import Book, value, minor, require
ROOT = Path(__file__).resolve().parent
ENGINE = '0.3.26-experimental'

def frozen():
    contract = json.loads((ROOT / 'contract.json').read_text())
    manifest = json.loads((ROOT / 'source-manifest.json').read_text())
    for name, sha in manifest.items():
        require(hashlib.sha256((ROOT / 'frozen' / name).read_bytes()).hexdigest() == sha, 'frozen source changed: ' + name)
    return contract, manifest

def check(filename, expected_engine=ENGINE):
    contract, manifest = frozen()
    book = Book(filename)
    try:
        rows, _ = book.rows('Export Metadata', {'Field', 'Value'})
        meta = {value(r, 'Field'): value(r, 'Value') for r in rows}
        require(meta['Engine version'] == expected_engine, 'wrong engine')
        choices = [c for c in contract['cases'] if manifest[c['id'] + '-supplier.csv'] == meta['Supplier SHA-256'] and manifest[c['id'] + '-ledger.csv'] == meta['Ledger SHA-256']]
        require(len(choices) == 1, 'unknown source pair')
        c = choices[0]
        evidence, _ = book.rows('Match Evidence', {'Side', 'Source Row', 'Amount', 'Status', 'Retained Evidence', 'Document Type'})
        require(len(evidence) == 2, 'movement lost or duplicated')
        require({value(r, 'Side') for r in evidence} == {'supplier', 'ledger'}, 'wrong membership')
        for r in evidence:
            side = value(r, 'Side')
            require(value(r, 'Source Row') == '2', 'wrong physical movement row')
            require(minor(r, 'Amount') == c[side + 'Minor'], 'money changed')
            require(value(r, 'Status') == ('Matched' if c['approved'] else 'Needs Review'), 'unproved approval or lost match')
            if c.get('retainedField'):
                label = 'Credit Note No' if c['id'] == 'untyped-credit' else 'Reference'
                literal = c['retainedValue'] if c['id'] != 'untyped-credit' or side == 'supplier' else 'CN-799'
                require(c['retainedField'] + ' (' + label + '): ' + literal in value(r, 'Retained Evidence'), 'native audit cue lost')
            require(value(r, 'Document Type') == ('Unknown' if c['id'] == 'untyped-credit' else 'Invoice'), 'document type changed')
        matches, _ = book.rows('Matches', {'Supplier Amount', 'Ledger Amount', 'Supplier Source Rows', 'Ledger Source Rows'})
        require(len(matches) == c['approved'], 'wrong approved count')
        if matches:
            require(minor(matches[0], 'Supplier Amount') == c['supplierMinor'] and minor(matches[0], 'Ledger Amount') == c['ledgerMinor'], 'matched totals changed')
            require(value(matches[0], 'Supplier Source Rows') == value(matches[0], 'Ledger Source Rows') == '1', 'matched membership changed')
        for side in ['Supplier', 'Ledger']:
            with (ROOT / 'frozen' / (c['id'] + '-' + side.lower() + '.csv')).open(newline='') as f:
                original = list(csv.reader(f))
            fields = {'صف المصدر', *{'عمود ' + str(i) for i in range(1, len(original[0]) + 1)}}
            raw, _ = book.rows('Parsed ' + side + ' Source', fields)
            require([value(r, 'صف المصدر') for r in raw] == [str(i + 1) for i in range(len(original))], 'raw row fate changed')
            require([[value(r, 'عمود ' + str(i)) for i in range(1, len(original[0]) + 1)] for r in raw] == original, 'source cells changed')
        if c.get('partial'):
            issues, _ = book.rows('Reading Issues', {'Side', 'Source Row', 'Original Values', 'Issue Scope'})
            require(len(issues) == 1 and value(issues[0], 'Side') == 'supplier' and value(issues[0], 'Source Row') == '3' and value(issues[0], 'Issue Scope') == 'Row', 'partial source error lost')
            require(json.loads(value(issues[0], 'Original Values'))[2] == 'unread', 'original unreadable amount lost')
        settings, _ = book.rows('Run Settings', {'الحقل', 'القيمة'})
        scope = json.loads(next(value(r, 'القيمة') for r in settings if value(r, 'الحقل') == 'Scope'))
        require(scope['coverageConfirmed'] is False, 'full coverage invented')
        return {'verified': True, 'id': c['id'], 'approved': c['approved'], 'engine': expected_engine}
    finally:
        book.close()

def check_answers(filename):
    contract, manifest = frozen()
    report = json.loads(Path(filename).read_text())
    require(report['engine'] == ENGINE, 'wrong answer engine')
    require(report['contractSha256'] == hashlib.sha256((ROOT / 'contract.json').read_bytes()).hexdigest(), 'answer contract changed')
    observed = {o['id']: o for o in report['observations']}
    require(len(observed) == len(report['observations']) == len(contract['cases']), 'missing or duplicate answer')
    for c in contract['cases']:
        o = observed[c['id']]
        require(o['sourceHashes'] == [manifest[c['id'] + '-' + side + '.csv'] for side in ['supplier', 'ledger']], 'wrong answer source')
        require(o['approved'] == c['approved'], 'wrong answer approval')
        expected_lookup = [] if c['lookupCount'] == 0 else ['supplier:0:2'] if c['lookupCount'] == 1 else ['supplier:0:2', 'ledger:0:2']
        require(o['lookupIds'] == expected_lookup, 'wrong exact lookup')
        a = o['answer']
        require(a == o['restoredAnswer'], 'restored explanation changed')
        require(a['kind'] == c['answerKind'], 'wrong explanation kind')
        require(a['sourceIds'] == ['supplier:0:2', 'ledger:0:2'], 'wrong explanation members')
        if c.get('retainedValue'):
            require(c['retainedValue'] in a['text'] and 'حفظه للتدقيق لا يجعله وحده إثباتًا للمطابقة' in a['text'], 'native cue or audit-only limit lost')
        if c.get('partial'):
            require(a['text'].startswith('نتيجة جزئية:') and 'مراجعة القراءة 1' in a['text'], 'partial limit concealed')
        if c['id'] == 'balanced-variance':
            require('فرق الحركات 10.00 SAR' in a['text'] and 'فرق الأرصدة الفعلي (المورد ناقص الدفتر): 110.00 SAR' in a['text'], 'transaction and balance differences confused')
            require(len(o['probes']) == 4, 'missing drift probe')
            for p in o['probes']:
                require(p['answer']['kind'] == 'unsupported' and p['answer']['sourceIds'] == [], 'drift explained as fact')
    return {'answersVerified': len(observed), 'engine': ENGINE}

def check_browser(filename):
    contract, _ = frozen()
    report = json.loads(Path(filename).read_text())
    require(report['engine'] == ENGINE, 'wrong browser engine')
    expected = {c['id']: c for c in contract['cases'] if c['id'] in ['untyped-credit', 'partial-source']}
    require(len(report['cases']) == len(expected), 'missing browser case')
    require({c['id'] for c in report['cases']} == set(expected), 'wrong browser source cases')
    for o in report['cases']:
        c = expected[o['id']]
        require(o['approved'] == c['approved'], 'wrong browser approval')
        require(o['directAnswer'] == o['restoredAnswer'], 'browser replay changed explanation')
        for key in ['directAnswer', 'englishAnswer']:
            a = o[key]
            require(a['sourceIds'] == ['supplier:0:2', 'ledger:0:2'], 'wrong browser answer members')
            amount = '-50.00 SAR' if c['id'] == 'untyped-credit' else '100.00 SAR'
            require(amount in a['text'], 'native amount absent from browser answer')
            if c['id'] == 'untyped-credit':
                require('CN-701' in a['text'] and 'Credit Note No' in a['text'], 'native browser cue lost')
            else:
                require(a['text'].startswith('نتيجة جزئية:' if key == 'directAnswer' else 'Partial result:'), 'partial browser answer hidden')
        require(not re.search('[\u0600-\u06ff]', o['englishAnswer']['text'] + o['translated']), 'browser explanation translation incomplete')
        require(o['manualColumnMapping'] is False and o['modelUsed'] is False, 'browser assistance misreported')
    return {'browserAnswersVerified': len(expected), 'engine': ENGINE}

if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('workbooks', nargs='*', type=Path)
    p.add_argument('--answers', type=Path)
    p.add_argument('--browser', type=Path)
    a = p.parse_args()
    require(a.workbooks or a.answers or a.browser, 'no evidence supplied')
    print(json.dumps({'workbooks': [{'workbook': str(f), **check(f)} for f in a.workbooks], 'answers': check_answers(a.answers) if a.answers else None, 'browser': check_browser(a.browser) if a.browser else None}, indent=2))
