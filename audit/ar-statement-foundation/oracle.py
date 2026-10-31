"""Independent oracle for the AR-1 PDF foundation (proposed ar-statement-pdf-1).

Reads three things and nothing else: the printed statement lines in the
facts (`statement.pages`), each story's confirmed scope, and the ledger CSV
files in frozen/. It never reads `recipe`, `intent` or the ledger rows kept in
the facts, and imports nothing from the story generator or the product. The
vocabulary below is written here from the contract, not shared with
stories.py. Money is Decimal, then integer minor units.

  python3 -B audit/ar-statement-foundation/oracle.py [stories.json] [frozen] > EXPECTED.json
"""
import csv
import json
import re
import sys
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path

HERE = Path(__file__).resolve().parent
ARABIC = str.maketrans('٠١٢٣٤٥٦٧٨٩', '0123456789')
TITLES = {'Statement of account', 'كشف حساب'}
DOCUMENT = {'Issued by': 'entity', 'صادر عن': 'entity', 'Ledger': 'ledger', 'الدفتر': 'ledger'}
HEADER = {
    'Customer ID': 'customer', 'رقم العميل': 'customer',
    'Customer name': 'name', 'اسم العميل': 'name',
    'Account': 'account', 'الحساب': 'account',
    'Currency': 'currency', 'العملة': 'currency',
    'Period': 'period', 'الفترة': 'period',
}
TOTAL = {'Section total', 'إجمالي القسم'}
FOOTER = re.compile(r'^(?:Page (\d+) of (\d+)|صفحة (\d+) من (\d+))$')
HEADINGS = {
    'Date': 'date', 'التاريخ': 'date', 'Type': 'type', 'النوع': 'type',
    'Document No': 'document', 'رقم المستند': 'document',
    'Related invoice': 'related', 'الفاتورة المرتبطة': 'related',
    'Description': 'description', 'البيان': 'description',
    'Original amount': 'original', 'المبلغ الأصلي': 'original',
    'Open amount': 'open', 'المبلغ المفتوح': 'open',
    'Balance': 'balance', 'الرصيد': 'balance',
}
REQUIRED = {'date', 'type', 'document', 'original'}
KINDS = {'invoice': 'invoice', 'credit-note': 'credit-note', 'receipt': 'receipt',
         'فاتورة': 'invoice', 'إشعار دائن': 'credit-note', 'قبض': 'receipt'}
PRECISION = {'SAR': 2, 'USD': 2, 'EUR': 2, 'GBP': 2, 'AED': 2, 'QAR': 2, 'EGP': 2,
             'KWD': 3, 'BHD': 3, 'OMR': 3, 'JPY': 0}
LEDGER = ['Posting ID', 'Document type', 'Own document number', 'Posting date',
          'Original signed amount', 'Entity', 'Ledger', 'Customer', 'Account', 'Currency',
          'Related invoice', 'Description']
REASONS = ['source-errors', 'duplicate-document', 'missing-counterpart', 'amount-difference',
           'date-difference', 'related-conflict', 'exact-own-document']


class LineError(Exception):
    pass


def iso(text):
    text = text.translate(ARABIC).strip()
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', text):
        raise ValueError(text)
    y, m, d = map(int, text.split('-'))
    return date(y, m, d).isoformat()


def printed_money(text, places):
    """A printed amount: optional minus, groups of three after the first
    group when a separator is used, exactly `places` decimals."""
    t = text.translate(ARABIC).replace('٬', ',').replace('٫', '.').strip()
    frac = rf'\.\d{{{places}}}' if places else ''
    if not re.fullmatch(rf'-?(?:\d{{1,3}}(?:,\d{{3}})+|\d+){frac}', t):
        raise LineError('AR_AMOUNT')
    try:
        value = Decimal(t.replace(',', ''))
    except InvalidOperation as e:
        raise LineError('AR_AMOUNT') from e
    minor = int(value.scaleb(places))
    if minor == 0:
        raise LineError('AR_AMOUNT')
    return minor


def ledger_money(text, places):
    t = text.strip()
    if not re.fullmatch(rf'-?\d+(?:\.\d{{1,{places}}})?' if places else r'-?\d+', t):
        raise LineError('AR_AMOUNT')
    minor = int(Decimal(t).scaleb(places))
    if minor == 0:
        raise LineError('AR_AMOUNT')
    return minor


def direction(kind, minor):
    if (minor > 0) != (kind == 'invoice'):
        raise LineError('AR_DIRECTION')


def labelled(text, labels):
    for label, role in labels.items():
        if text.startswith(label + ':'):
            return role, text[len(label) + 1:].strip()
    return None


def header_scope(fields):
    """The scope a section header proves, or None with the reason."""
    if any(k not in fields for k in ('customer', 'account', 'currency', 'period')):
        return None
    customer, account, currency = fields['customer'], fields['account'].translate(ARABIC), fields['currency']
    m = re.fullmatch(r'(\S+)\s+(?:to|إلى)\s+(\S+)', fields['period'])
    if not customer or not account or currency not in PRECISION or not m:
        return None
    try:
        start, end = iso(m.group(1)), iso(m.group(2))
    except ValueError:
        return None
    if start > end:
        return None
    return {'customer': customer, 'account': account, 'currency': currency, 'start': start, 'end': end}


def read_statement(pages):
    """Walk the printed lines in order. Returns the document header, the
    sections with their lines, the inventory and the errors."""
    doc = {}
    sections, inventory, errors = [], [], []
    pending, section, columns = None, None, None

    def error(code, where):
        errors.append({'side': 'statement', 'code': code, 'where': where})

    for p, page in enumerate(pages, 1):
        for n, line in enumerate(page, 1):
            where = [p, n]
            if 'text' in line:
                text = line['text']
                if text in TITLES:
                    inventory.append({'where': where, 'kind': 'document-header'})
                    continue
                hit = labelled(text, DOCUMENT)
                if hit:
                    role, value = hit
                    if role in doc and doc[role] != value:
                        error('AR_PDF_DOCUMENT_HEADER', where)
                    doc.setdefault(role, value)
                    inventory.append({'where': where, 'kind': 'document-header'})
                    continue
                hit = labelled(text, HEADER)
                if hit:
                    role, value = hit
                    if role == 'customer' or pending is None:
                        pending = {'fields': {}, 'where': where}
                    if role in pending['fields']:
                        pending['bad'] = True
                    pending['fields'][role] = value
                    inventory.append({'where': where, 'kind': 'section-header'})
                    continue
                hit = labelled(text, {t: 'total' for t in TOTAL})
                if hit:
                    inventory.append({'where': where, 'kind': 'section-total', 'section': section})
                    continue
                if FOOTER.fullmatch(text.translate(ARABIC)):
                    inventory.append({'where': where, 'kind': 'page-footer'})
                    continue
                raise SystemExit(f'oracle: unclassified printed text at {where}: {text!r}')
            if 'headings' in line:
                roles = [HEADINGS.get(h) for h in line['headings']]
                columns = dict(zip(line['headings'], roles))
                if None in roles or not REQUIRED <= set(roles) or len(set(roles)) != len(roles):
                    error('AR_PDF_COLUMNS', where)
                    columns = None
                inventory.append({'where': where, 'kind': 'column-headings'})
                if pending is not None:
                    fields = pending['fields']
                    scope = None if pending.get('bad') else header_scope(fields)
                    if scope is None:
                        error('AR_PDF_HEADER', pending['where'])
                    key = json.dumps([fields.get(k) for k in ('customer', 'name', 'account', 'currency', 'period')])
                    if section is not None and sections[section]['key'] == key and scope is not None:
                        sections[section]['pages'].append(p)
                    else:
                        sections.append({'key': key, 'scope': scope, 'pages': [p], 'lines': []})
                        section = len(sections) - 1
                    pending = None
                continue
            if 'cells' in line:
                if section is None:
                    error('AR_PDF_ORPHAN_LINE', where)
                    inventory.append({'where': where, 'kind': 'error', 'code': 'AR_PDF_ORPHAN_LINE'})
                    continue
                s = sections[section]
                try:
                    if columns is None or s['scope'] is None:
                        raise LineError('AR_PDF_HEADER' if s['scope'] is None else 'AR_PDF_COLUMNS')
                    values = {columns[h]: v for h, v in line['cells']}
                    kind = KINDS.get(values.get('type', '').strip())
                    if not kind:
                        raise LineError('AR_KIND')
                    document = values.get('document', '').strip()
                    if not document:
                        raise LineError('AR_DOCUMENT')
                    try:
                        when = iso(values.get('date', ''))
                    except ValueError as e:
                        raise LineError('AR_DATE') from e
                    if not s['scope']['start'] <= when <= s['scope']['end']:
                        raise LineError('AR_PERIOD')
                    if not values.get('original', '').strip():
                        raise LineError('AR_ORIGINAL_MISSING' if values.get('open', '').strip() else 'AR_AMOUNT')
                    minor = printed_money(values['original'], PRECISION[s['scope']['currency']])
                    direction(kind, minor)
                    row = {'where': where, 'kind': kind, 'document': document, 'date': when,
                           'amount': minor, 'related': values.get('related', '').strip()}
                    s['lines'].append(row)
                    inventory.append({'where': where, 'kind': 'detail', 'section': section})
                except LineError as e:
                    code = str(e)
                    if code not in ('AR_PDF_HEADER', 'AR_PDF_COLUMNS'):
                        error(code, where)
                    inventory.append({'where': where, 'kind': 'error', 'code': code, 'section': section})
                continue
            raise SystemExit(f'oracle: unknown printed line at {where}')
    if pending is not None:
        error('AR_PDF_HEADER', pending['where'])
    return doc, sections, inventory, errors


def read_ledger(path, scope):
    rows, errors = [], []
    with open(path, newline='', encoding='utf-8') as f:
        table = list(csv.reader(f))
    if not table or table[0] != LEDGER:
        return rows, [{'side': 'ledger', 'code': 'AR_COLUMNS', 'where': 1}]
    places = PRECISION[scope['currency']]
    seen = {}
    for number, values in enumerate(table[1:], 2):
        if not any(v.strip() for v in values):
            continue
        r = dict(zip(LEDGER, values))
        try:
            kind = KINDS.get(r['Document type'].strip().lower())
            if not kind:
                raise LineError('AR_KIND')
            if not r['Posting ID'].strip() or not r['Own document number'].strip():
                raise LineError('AR_DOCUMENT')
            for column, key in (('Entity', 'entity'), ('Ledger', 'ledger'), ('Customer', 'customer'),
                                ('Account', 'account'), ('Currency', 'currency')):
                if r[column].strip() != scope[key]:
                    raise LineError('AR_ROW_SCOPE')
            try:
                when = iso(r['Posting date'])
            except ValueError as e:
                raise LineError('AR_DATE') from e
            if not scope['start'] <= when <= scope['end']:
                raise LineError('AR_PERIOD')
            minor = ledger_money(r['Original signed amount'], places)
            direction(kind, minor)
            posting = r['Posting ID'].strip()
            seen.setdefault(posting, []).append(number)
            rows.append({'posting': posting, 'row': number, 'kind': kind,
                         'document': r['Own document number'].strip(), 'date': when,
                         'amount': minor, 'related': r['Related invoice'].strip()})
        except LineError as e:
            errors.append({'side': 'ledger', 'code': str(e), 'where': number})
    for posting, numbers in seen.items():
        if len(numbers) > 1:
            errors.extend({'side': 'ledger', 'code': 'AR_DUPLICATE_POSTING', 'where': n} for n in numbers)
            rows = [r for r in rows if r['posting'] != posting]
    return rows, errors


def judge(story, frozen):
    scope = story['scope']
    doc, sections, inventory, errors = read_statement(story['statement']['pages'])
    ledger, ledger_errors = read_ledger(frozen / f"{story['id']}-ledger.csv", scope)
    errors += ledger_errors
    wanted = {k: scope[k] for k in ('customer', 'account', 'currency', 'start', 'end')}
    headers_known = all(s['scope'] is not None for s in sections)
    same_document = doc.get('entity') == scope['entity'] and doc.get('ledger') == scope['ledger']
    chosen = [i for i, s in enumerate(sections) if same_document and s['scope'] == wanted]
    if len(chosen) > 1:
        errors.append({'side': 'statement', 'code': 'AR_PDF_SCOPE_REPEATED',
                       'where': [sections[i]['pages'][0] for i in chosen]})
    elif not chosen and headers_known and not any(e['code'] == 'AR_PDF_DOCUMENT_HEADER' for e in errors):
        errors.append({'side': 'statement', 'code': 'AR_PDF_SCOPE_NOT_FOUND', 'where': None})
    statement = sections[chosen[0]]['lines'] if len(chosen) == 1 else []
    out_of_scope = sum(1 for i in inventory
                       if i['kind'] == 'detail' and (len(chosen) != 1 or i['section'] != chosen[0]))
    blocked = bool(errors)
    buckets = {}
    for side, rows in (('statement', statement), ('ledger', ledger)):
        for r in rows:
            buckets.setdefault((r['kind'], r['document']), {'statement': [], 'ledger': []})[side].append(r)
    cases = []
    for (kind, document), b in buckets.items():
        s, l = b['statement'], b['ledger']
        related = {r['related'] for r in s + l if r['related']}
        if blocked:
            reason = 'source-errors'
        elif len(s) > 1 or len(l) > 1:
            reason = 'duplicate-document'
        elif not s or not l:
            reason = 'missing-counterpart'
        elif s[0]['amount'] != l[0]['amount']:
            reason = 'amount-difference'
        elif s[0]['date'] != l[0]['date']:
            reason = 'date-difference'
        elif len(related) > 1:
            reason = 'related-conflict'
        else:
            reason = 'exact-own-document'
        cases.append({'kind': kind, 'document': document, 'reason': reason,
                      'statement': [r['where'] for r in s], 'ledger': [r['posting'] for r in l]})
    cases.sort(key=lambda c: (c['kind'], c['document']))
    matched = sum(c['reason'] == 'exact-own-document' for c in cases)
    review = {}
    for c in cases:
        if c['reason'] not in ('exact-own-document', 'source-errors'):
            review[c['reason']] = review.get(c['reason'], 0) + 1
    status = 'source-error' if blocked else ('matched' if matched == len(cases) and cases else 'review')
    return {
        'status': status,
        'errors': errors,
        'errorCodes': sorted({e['code'] for e in errors}),
        'sections': [{'scope': s['scope'], 'pages': s['pages'], 'lines': len(s['lines']),
                      'compared': len(chosen) == 1 and i == chosen[0]} for i, s in enumerate(sections)],
        'outOfScopeLines': out_of_scope,
        'cases': cases,
        'matched': matched,
        'review': review,
    }


def run(facts, frozen):
    return {'version': 'ar-statement-foundation-oracle-1', 'stories': {
        s['id']: judge(s, frozen) for s in facts['stories']}}


def main():
    facts_path = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / 'frozen' / 'stories.json'
    frozen = Path(sys.argv[2]) if len(sys.argv) > 2 else HERE / 'frozen'
    facts = json.loads(facts_path.read_text(encoding='utf-8'))
    print(json.dumps(run(facts, frozen), ensure_ascii=False, indent=1, sort_keys=True))


if __name__ == '__main__':
    main()
