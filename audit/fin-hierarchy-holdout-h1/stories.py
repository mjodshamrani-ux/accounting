"""FIN-1 holdout H1: new statement-of-financial-position stories on the FIN-1A
contract (audit/tb-financial-hierarchy/contract.json), written after the
review and before any FIN-1 product code. Nothing here imports FIN-1A's
generator, oracle or the product.

Each story is four CSV files (trial balance, proposed mapping, presentation
evidence, hierarchical statement) and the run scope the accountant confirms.
The intent is written by hand from the contract: the status and the codes the
story's defect requires. For an eligible story the facts come from the
story's own model (TB lines, mapped leaves, parents), not from any oracle.

  python3 -B audit/fin-hierarchy-holdout-h1/stories.py > frozen/stories.json
"""
import json

GENERATOR = 'fin1-h1-stories-1'
ROLES = ['trial-balance', 'proposed-mapping', 'presentation-evidence', 'financial-position']
SCOPE_HEADERS = ['Entity', 'Ledger', 'Currency', 'Currency basis', 'Posting status', 'Posting layer',
                 'Period start', 'Period end', 'As of', 'Chart version', 'Map version', 'Closing basis']
HEADERS = {
    'trial-balance': ['Account ID', 'Complete dimensions', 'Account label', 'Account class', 'Debit', 'Credit'],
    'proposed-mapping': ['Mapping ID', 'Account ID', 'Complete dimensions', 'Line ID', 'Sign', 'Evidence ID'],
    'presentation-evidence': ['Evidence ID', 'Account ID', 'Complete dimensions', 'Account class', 'Line ID',
                              'Line label', 'Line class', 'Sign', 'Valid from', 'Valid to', 'Evidence reference'],
    'financial-position': ['Node ID', 'Parent ID', 'Kind', 'Line label', 'Line class', 'Amount'],
}
CATEGORIES = ['current-asset', 'noncurrent-asset', 'current-liability', 'noncurrent-liability', 'equity']


def policy(cls):
    return 'debit-positive' if cls.endswith('asset') else 'credit-positive'


def money(minor):
    sign = '-' if minor < 0 else ''
    return f'{sign}{abs(minor) // 100}.{abs(minor) % 100:02d}'


def scope(entity, ledger, currency, start, end, chart, mapv):
    return {'Entity': entity, 'Ledger': ledger, 'Currency': currency, 'Currency basis': 'functional',
            'Posting status': 'posted', 'Posting layer': 'actual', 'Period start': start, 'Period end': end,
            'As of': end, 'Chart version': chart, 'Map version': mapv, 'Closing basis': 'post-closing'}


def build(sc, accounts, nodes, prefix, valid):
    """accounts: (account, dimensions, TB label, class, net minor, leaf).
    nodes: (id, parent, kind, label, class). Leaf amounts are the mapped
    contributions; parent amounts the sum of their children."""
    contribution = {}
    for _, _, _, cls, net, leaf in accounts:
        contribution[leaf] = contribution.get(leaf, 0) + (net if policy(cls) == 'debit-positive' else -net)
    kids = {}
    for nid, parent, kind, _, _ in nodes:
        kids.setdefault(parent, []).append(nid)
    kinds = {n[0]: n[2] for n in nodes}

    def amount(nid):
        return contribution.get(nid, 0) if kinds[nid] == 'leaf' else sum(amount(k) for k in kids.get(nid, []))
    labels = {n[0]: n[3] for n in nodes}
    tb, mapping, proof, statement = [], [], [], []
    for i, (acct, dims, label, cls, net, leaf) in enumerate(accounts, 1):
        tb.append({'Account ID': acct, 'Complete dimensions': dims, 'Account label': label, 'Account class': cls,
                   'Debit': money(max(net, 0)), 'Credit': money(max(-net, 0)), **sc})
        mapping.append({'Mapping ID': f'{prefix}-M{i:03d}', 'Account ID': acct, 'Complete dimensions': dims,
                        'Line ID': leaf, 'Sign': policy(cls), 'Evidence ID': f'{prefix}-E{i:03d}', **sc})
        proof.append({'Evidence ID': f'{prefix}-E{i:03d}', 'Account ID': acct, 'Complete dimensions': dims,
                      'Account class': cls, 'Line ID': leaf, 'Line label': labels[leaf], 'Line class': cls,
                      'Sign': policy(cls), 'Valid from': valid[0], 'Valid to': valid[1],
                      'Evidence reference': f'SYN-{prefix}-PACK-{i:03d}', **sc})
    for nid, parent, kind, label, cls in nodes:
        statement.append({'Node ID': nid, 'Parent ID': parent, 'Kind': kind, 'Line label': label,
                          'Line class': cls, 'Amount': '' if kind == 'title' else money(amount(nid)), **sc})
    return {'trial-balance': tb, 'proposed-mapping': mapping, 'presentation-evidence': proof,
            'financial-position': statement}


# Template A: a manufacturer with two levels of parents, contra assets, a
# contra liability, a zero line and one bank line fed by two cost centres.
A_SCOPE = scope('SYN-WADI-MFG', 'STAT-H1', 'USD', '2027-01-01', '2027-06-30', 'COA-2027', 'BSMAP-7')
A_NODES = [
    ('BS', '', 'title', 'قائمة المركز المالي (اصطناعية)', ''),
    ('NCA', '', 'parent', 'الأصول غير المتداولة', 'noncurrent-asset'),
    ('PPE', 'NCA', 'parent', 'الممتلكات والآلات والمعدات', 'noncurrent-asset'),
    ('PPE-COST', 'PPE', 'leaf', 'التكلفة', 'noncurrent-asset'),
    ('PPE-DEP', 'PPE', 'leaf', 'مجمع الإهلاك', 'noncurrent-asset'),
    ('INTANG', 'NCA', 'leaf', 'أصول غير ملموسة', 'noncurrent-asset'),
    ('CA', '', 'parent', 'الأصول المتداولة', 'current-asset'),
    ('CASH', 'CA', 'parent', 'النقد وما في حكمه', 'current-asset'),
    ('BANK', 'CASH', 'leaf', 'أرصدة البنوك', 'current-asset'),
    ('PETTY', 'CASH', 'leaf', 'صندوق المصروفات النثرية', 'current-asset'),
    ('REC', 'CA', 'parent', 'الذمم المدينة', 'current-asset'),
    ('AR', 'REC', 'leaf', 'ذمم العملاء', 'current-asset'),
    ('ALLOW', 'REC', 'leaf', 'مخصص الخسائر الائتمانية المتوقعة', 'current-asset'),
    ('INVENT', 'CA', 'leaf', 'المخزون', 'current-asset'),
    ('PREPAID', 'CA', 'leaf', 'مصروفات مدفوعة مقدمًا', 'current-asset'),
    ('NCL', '', 'parent', 'المطلوبات غير المتداولة', 'noncurrent-liability'),
    ('LOAN', 'NCL', 'leaf', 'قرض طويل الأجل', 'noncurrent-liability'),
    ('LOANDISC', 'NCL', 'leaf', 'خصم إصدار القرض غير المطفأ', 'noncurrent-liability'),
    ('CL', '', 'parent', 'المطلوبات المتداولة', 'current-liability'),
    ('AP', 'CL', 'leaf', 'ذمم الموردين', 'current-liability'),
    ('ACCR', 'CL', 'leaf', 'مصروفات مستحقة', 'current-liability'),
    ('VAT', 'CL', 'leaf', 'ضريبة القيمة المضافة المستحقة', 'current-liability'),
    ('EQ', '', 'parent', 'حقوق الملكية', 'equity'),
    ('CAP', 'EQ', 'leaf', 'رأس المال', 'equity'),
    ('RE', 'EQ', 'leaf', 'الأرباح المبقاة', 'equity'),
]
A_ACCOUNTS = [
    ('1210', 'cc=HQ', 'Machinery at cost', 'noncurrent-asset', 85000000, 'PPE-COST'),
    ('1219', 'cc=HQ', 'Accumulated depreciation', 'noncurrent-asset', -21050000, 'PPE-DEP'),
    ('1300', 'cc=HQ', 'Software licences', 'noncurrent-asset', 4500000, 'INTANG'),
    ('1101', 'cc=HQ', 'Bank current account', 'current-asset', 12035075, 'BANK'),
    ('1101', 'cc=BR', 'Bank current account', 'current-asset', 3000025, 'BANK'),
    ('1105', 'cc=BR', 'Petty cash', 'current-asset', 150000, 'PETTY'),
    ('1120', 'cc=HQ', 'Trade receivables', 'current-asset', 9876543, 'AR'),
    ('1129', 'cc=HQ', 'Loss allowance', 'current-asset', -493827, 'ALLOW'),
    ('1140', 'cc=HQ', 'Raw materials', 'current-asset', 21000000, 'INVENT'),
    ('1150', 'cc=HQ', 'Prepaid insurance', 'current-asset', 0, 'PREPAID'),
    ('2500', 'cc=HQ', 'Term loan', 'noncurrent-liability', -40000000, 'LOAN'),
    ('2509', 'cc=HQ', 'Unamortised issue discount', 'noncurrent-liability', 1200000, 'LOANDISC'),
    ('2100', 'cc=HQ', 'Trade payables', 'current-liability', -14532109, 'AP'),
    ('2110', 'cc=HQ', 'Accrued expenses', 'current-liability', -2345678, 'ACCR'),
    ('2120', 'cc=HQ', 'VAT payable', 'current-liability', -1740029, 'VAT'),
    ('3100', 'cc=HQ', 'Share capital', 'equity', -50000000, 'CAP'),
    ('3200', 'cc=HQ', 'Retained earnings', 'equity', -6600000, 'RE'),
]


def template_a(sc=A_SCOPE, valid=('2026-01-01', '2027-12-31')):
    return build(sc, A_ACCOUNTS, A_NODES, 'WADI', valid)


# Template B: a trader whose statement has no parents at all, Arabic account
# IDs and dimensions, and owner drawings that reduce equity.
B_SCOPE = scope('SYN-NAKHEEL-TRADING', 'GL-AED', 'AED', '2027-04-01', '2027-09-30', 'دليل-٢٠٢٧', 'خريطة-٣')
B_NODES = [
    ('SOFP', '', 'title', 'Statement of financial position (synthetic)', ''),
    ('CASH-AED', '', 'leaf', 'Cash and bank', 'current-asset'),
    ('STOCK', '', 'leaf', 'Goods for resale', 'current-asset'),
    ('FIT-OUT', '', 'leaf', 'Shop fit-out', 'noncurrent-asset'),
    ('SUPPLIERS', '', 'leaf', 'Trade creditors', 'current-liability'),
    ('EOSB', '', 'leaf', 'End-of-service benefits', 'noncurrent-liability'),
    ('OWNER', '', 'leaf', "Owner's capital", 'equity'),
    ('DRAWINGS', '', 'leaf', "Owner's drawings", 'equity'),
    ('RESULT', '', 'leaf', 'Profit for the period', 'equity'),
]
B_ACCOUNTS = [
    ('ن-١٠١', 'فرع=دبي', 'نقد', 'current-asset', 4520000, 'CASH-AED'),
    ('ن-١٠١', 'فرع=الشارقة', 'نقد', 'current-asset', 1830050, 'CASH-AED'),
    ('م-٢٠٠', 'فرع=دبي', 'بضاعة', 'current-asset', 7700000, 'STOCK'),
    ('ث-٣٠٠', 'فرع=دبي', 'تجهيزات المعرض', 'noncurrent-asset', 2500000, 'FIT-OUT'),
    ('د-٤٠٠', 'فرع=دبي', 'موردون', 'current-liability', -3999950, 'SUPPLIERS'),
    ('د-٤١٠', 'فرع=دبي', 'مكافأة نهاية الخدمة', 'noncurrent-liability', -880000, 'EOSB'),
    ('ح-٥٠٠', 'فرع=دبي', 'رأس مال المالك', 'equity', -10000000, 'OWNER'),
    ('ح-٥١٠', 'فرع=دبي', 'مسحوبات المالك', 'equity', 1200000, 'DRAWINGS'),
    ('ح-٥٢٠', 'فرع=دبي', 'نتيجة الفترة', 'equity', -2870100, 'RESULT'),
]


def template_b(nodes=B_NODES, accounts=B_ACCOUNTS):
    return build(B_SCOPE, accounts, nodes, 'NKH', ('2027-01-01', '2027-12-31'))


# Template C: 160 accounts in four regions under 40 leaves, groups and
# subgroups; near the 200-row limit of the contract.
C_SCOPE = scope('SYN-SAHIL-GROUP', 'CONSOL-H1', 'EUR', '2026-07-01', '2027-06-30', 'GCOA-9', 'GMAP-14')
C_PLAN = [  # category, digit, groups as leaf counts
    ('current-asset', '1', [[2, 2], [4], [4]]),
    ('noncurrent-asset', '2', [[4], [4]]),
    ('current-liability', '3', [[4], [4]]),
    ('noncurrent-liability', '4', [[4]]),
    ('equity', '5', [[4], [4]]),
]


def template_c():
    nodes = [('GRP', '', 'title', 'Consolidated position (synthetic)', '')]
    accounts = []
    serial = 0
    for cls, digit, groups in C_PLAN:
        top = f'C{digit}'
        nodes.append((top, '', 'parent', f'{cls} total', cls))
        for g, subgroups in enumerate(groups, 1):
            group = f'{top}-G{g}'
            nodes.append((group, top, 'parent', f'{cls} group {g}', cls))
            for s, leaves in enumerate(subgroups, 1):
                holder = group
                if len(subgroups) > 1:
                    holder = f'{group}-S{s}'
                    nodes.append((holder, group, 'parent', f'{cls} group {g} part {s}', cls))
                for leaf_no in range(1, leaves + 1):
                    leaf = f'{holder}-L{leaf_no}'
                    nodes.append((leaf, holder, 'leaf', f'{cls} line {g}.{s}.{leaf_no}', cls))
                    for region in range(1, 5):
                        serial += 1
                        size = ((serial * 7919) % 97 + 3) * 12345 + serial
                        contra = cls.endswith('asset') and leaf_no == 4 and region == 4
                        net = size if cls.endswith('asset') else -size
                        if contra:
                            net = -size // 3
                        if cls == 'equity' and g == 2 and leaf_no == 3:
                            net = size // 2  # an accumulated deficit line
                        accounts.append((f'{digit}{g}{s}{leaf_no:02d}.{region}', f'region=R{region};cc=C{leaf_no % 3}',
                                         f'Account {serial}', cls, net, leaf))
    plug = -sum(a[4] for a in accounts)
    last = accounts[-1]
    accounts[-1] = (*last[:4], last[4] + plug, last[5])
    assert accounts[-1][4] < 0
    return build(C_SCOPE, accounts, nodes, 'SHL', ('2026-01-01', '2027-12-31'))


# Template D: a chain of nested parents to a single cash leaf.
D_SCOPE = scope('SYN-QIMMA-HOLDING', 'HOLD-1', 'SAR', '2027-01-01', '2027-03-31', 'HCOA-1', 'HMAP-1')


def template_d(depth):
    """The chain from its root parent to its leaf holds `depth` nodes."""
    nodes = [('ROOT-TITLE', '', 'title', 'Holding position (synthetic)', '')]
    parent = ''
    for level in range(1, depth):
        nid = f'LV{level:02d}'
        nodes.append((nid, parent, 'parent', f'Level {level}', 'current-asset'))
        parent = nid
    nodes += [('DEEP-CASH', parent, 'leaf', 'Cash held through nested entities', 'current-asset'),
              ('LOAN-HOLD', '', 'leaf', 'Shareholder loan', 'noncurrent-liability'),
              ('CAP-HOLD', '', 'leaf', 'Capital', 'equity')]
    accounts = [('10-01', 'unit=HOLD', 'Cash', 'current-asset', 7500000000, 'DEEP-CASH'),
                ('40-01', 'unit=HOLD', 'Shareholder loan', 'noncurrent-liability', -2500000000, 'LOAN-HOLD'),
                ('50-01', 'unit=HOLD', 'Capital', 'equity', -5000000000, 'CAP-HOLD')]
    return build(D_SCOPE, accounts, nodes, 'QIM', ('2027-01-01', '2027-03-31'))


# Template E: amounts at the contract's aggregate limit, 1e14 minor units.
E_SCOPE = scope('SYN-JABAL-SOVEREIGN', 'SOV-1', 'SAR', '2027-01-01', '2027-12-31', 'SCOA-1', 'SMAP-1')


def template_e(over=0):
    """At the limit the investments parent holds 1e14 itself; one unit above,
    the statement has no parent, so only the TB totals pass the limit."""
    holder = '' if over else 'E-ASSETS'
    nodes = [('E-TITLE', '', 'title', 'Position at the limit (synthetic)', ''),
             *([] if over else [('E-ASSETS', '', 'parent', 'Investments', 'noncurrent-asset')]),
             ('E-INV-1', holder, 'leaf', 'Investment portfolio one', 'noncurrent-asset'),
             ('E-INV-2', holder, 'leaf', 'Investment portfolio two', 'noncurrent-asset'),
             ('E-BONDS', '', 'leaf', 'Bonds issued', 'noncurrent-liability'),
             ('E-EQUITY', '', 'leaf', 'Endowment', 'equity')]
    accounts = [('9001', 'fund=ONE', 'Portfolio one', 'noncurrent-asset', 60000000000000 + over, 'E-INV-1'),
                ('9002', 'fund=TWO', 'Portfolio two', 'noncurrent-asset', 40000000000000, 'E-INV-2'),
                ('9501', 'fund=ONE', 'Bonds issued', 'noncurrent-liability', -30000000000000, 'E-BONDS'),
                ('9901', 'fund=ONE', 'Endowment', 'equity', -70000000000000 - over, 'E-EQUITY')]
    return build(E_SCOPE, accounts, nodes, 'JBL', ('2027-01-01', '2027-12-31'))


# ---- edits on the built tables -------------------------------------------

def find(tables, role, **match):
    hits = [r for r in tables[role] if all(r[k.replace('_', ' ')] == v for k, v in match.items())]
    assert len(hits) == 1, (role, match, len(hits))
    return hits[0]


def account(tables, role, acct, dims):
    hits = [r for r in tables[role] if r['Account ID'] == acct and r['Complete dimensions'] == dims]
    assert len(hits) == 1, (role, acct, dims, len(hits))
    return hits[0]


def node(tables, nid):
    hits = [r for r in tables['financial-position'] if r['Node ID'] == nid]
    assert len(hits) == 1, (nid, len(hits))
    return hits[0]


def minor(text):
    whole, _, frac = text.lstrip('-').partition('.')
    value = int(whole) * 100 + int((frac + '00')[:2])
    return -value if text.startswith('-') else value


def resum(tables, *parents):
    """Set each parent's amount to the sum of its current children, in order."""
    for pid in parents:
        kids = [r for r in tables['financial-position'] if r['Parent ID'] == pid]
        node(tables, pid)['Amount'] = money(sum(minor(r['Amount']) for r in kids))


def drop(tables, role, rows):
    for r in rows:
        tables[role].remove(r)


# ---- stories ----------------------------------------------------------------

def h04(t):
    drop(t, 'financial-position', [node(t, n) for n in ('REC', 'AR', 'ALLOW')])
    resum(t, 'CA')


def h05(t):
    drop(t, 'financial-position', [node(t, 'PREPAID')])
    drop(t, 'proposed-mapping', [account(t, 'proposed-mapping', '1150', 'cc=HQ')])
    drop(t, 'presentation-evidence', [account(t, 'presentation-evidence', '1150', 'cc=HQ')])


def h06(t):
    st = t['financial-position']
    second = dict(node(t, 'BANK'), **{'Parent ID': 'REC'})
    st.insert(st.index(node(t, 'ALLOW')) + 1, second)
    node(t, 'REC')['Amount'] = money(minor(node(t, 'REC')['Amount']) + minor(second['Amount']))
    resum(t, 'CA')


def h07(t):
    node(t, 'CA')['Parent ID'] = 'REC'
    node(t, 'REC')['Parent ID'] = 'CASH'


def h08(t):
    for role in ('proposed-mapping', 'presentation-evidence'):
        account(t, role, '1101', 'cc=BR')['Complete dimensions'] = 'CC=BR'


def h09(t):
    for role in ('proposed-mapping', 'presentation-evidence'):
        account(t, role, '2509', 'cc=HQ')['Sign'] = 'debit-positive'
    node(t, 'LOANDISC')['Amount'] = '12000.00'
    resum(t, 'NCL')


def h10(t):
    proofs = t['presentation-evidence']
    new = account(t, 'presentation-evidence', '1219', 'cc=HQ')
    old = dict(new, **{'Evidence ID': 'WADI-E002-OLD', 'Valid from': '2026-01-01', 'Valid to': '2027-03-31',
                       'Evidence reference': 'SYN-WADI-PACK-002-SUPERSEDED'})
    new['Valid from'] = '2027-04-01'
    proofs.insert(proofs.index(new), old)


def h11(t):
    for r in t['presentation-evidence']:
        r['Valid from'], r['Valid to'] = r['Period start'], r['Period end']
    for r in t['trial-balance']:
        for f in ('Debit', 'Credit'):
            r[f] = short(r[f])
    for r in t['financial-position']:
        if r['Amount']:
            r['Amount'] = short(r['Amount'])


def short(text):
    """The same amount without the zeros a writer may drop: 500.00 -> 500, 12.50 -> 12.5."""
    if text.endswith('.00'):
        return text[:-3]
    if text.endswith('0'):
        return text[:-1]
    return text


def h12(t):
    for role in ('proposed-mapping', 'presentation-evidence'):
        account(t, role, '1105', 'cc=BR')['Sign'] = 'credit-positive'
    account(t, 'presentation-evidence', '1105', 'cc=BR')['Line class'] = 'current-liability'
    petty = node(t, 'PETTY')
    t['financial-position'].remove(petty)
    petty.update({'Parent ID': 'CL', 'Line class': 'current-liability', 'Amount': '-1500.00'})
    st = t['financial-position']
    st.insert(st.index(node(t, 'VAT')) + 1, petty)
    resum(t, 'CASH', 'CA', 'CL')


def h13(t):
    account(t, 'proposed-mapping', '1300', 'cc=HQ')['Evidence ID'] = 'AI-SUGGESTED-1300'
    drop(t, 'presentation-evidence', [account(t, 'presentation-evidence', '1300', 'cc=HQ')])
    account(t, 'presentation-evidence', '2110', 'cc=HQ')['Evidence reference'] = ''


def h14_tables():
    nodes = [B_NODES[0], ('LIQ', '', 'parent', 'Liquid assets', 'current-asset'),
             ('LIQ-CASH', 'LIQ', 'parent', 'Cash only', 'current-asset'),
             ('CASH-AED', 'LIQ-CASH', 'leaf', 'Cash and bank', 'current-asset'),
             *B_NODES[2:6],
             ('RESERVES', '', 'parent', 'Reserves', 'equity'),
             ('RESERVE', 'RESERVES', 'leaf', 'Statutory reserve', 'equity'),
             *B_NODES[6:]]
    accounts = [*B_ACCOUNTS, ('ح-٥٣٠', 'فرع=دبي', 'احتياطي نظامي', 'equity', 0, 'RESERVE')]
    return template_b(nodes, accounts)


def h18(t):
    for nid, delta in (('C1-G2-L3', 1), ('C5-G1-L2', 1)):
        node(t, nid)['Amount'] = money(minor(node(t, nid)['Amount']) + delta)
    resum(t, 'C1-G2', 'C1', 'C5-G1', 'C5')


def h22(t):
    pass  # the trial balance ends with a blank line; see the writer flag


def h23(t):
    node(t, 'INTANG')['Amount'] = '٤٥٠٠٠٫٠٠'
    node(t, 'NCA')['Amount'] = '684,500.00'


def h24(t):
    node(t, 'RE')['Parent ID'] = 'BS'
    resum(t, 'EQ')


def h25(t):
    st = t['financial-position']
    st.insert(st.index(node(t, 'LOANDISC')) + 1,
              dict(node(t, 'NCL'), **{'Node ID': 'DEFTAX', 'Parent ID': 'NCL', 'Line label': 'ضريبة مؤجلة',
                                      'Amount': '0.00'}))


def h26(t):
    row = account(t, 'trial-balance', '2100', 'cc=HQ')
    row['Debit'], row['Credit'] = '2000.00', '147321.09'


def h27(t):
    account(t, 'trial-balance', '1140', 'cc=HQ')['Debit'] = '210000.01'


def h28(t):
    account(t, 'proposed-mapping', '1300', 'cc=HQ')['Mapping ID'] = 'WADI-M002'


def h29(t):
    node(t, 'VAT')['Map version'] = 'BSMAP-6'


def h30(t):
    node(t, 'ACCR')['Kind'] = 'Leaf'


def h31(t):
    tb = t['trial-balance']
    first = account(t, 'trial-balance', '1101', 'cc=HQ')
    first['Debit'] = '100000.00'
    tb.insert(tb.index(first) + 1, dict(first, **{'Account label': 'Bank current account (sweep)',
                                                 'Debit': '20350.75'}))


def h32(t):
    for r in t['proposed-mapping']:
        r['Reviewer note'] = 'checked' if r['Account ID'] != '1150' else 'zero balance, kept'


ALL = 'contract'
STORIES = [
    # id, what, template, edit, writers by role, header order by role, row order by role, flags, intent
    ('H01', 'Template A as built, each file from another writer and header order', 'A', None,
     ['go', 'ruby', 'perl', 'libreoffice'], ['scope-first', 'reversed', 'interleaved', 'contract'], {}, {},
     ('eligible', [])),
    ('H02', 'Template A with children listed before their parents, rows shuffled, quote-all CRLF, a label with a comma and a line break',
     'A', 'label', ['rust'] * 4, ['interleaved'] * 4,
     {'trial-balance': 'reversed', 'presentation-evidence': 'odd-even', 'financial-position': 'reversed'}, {},
     ('eligible', [])),
    ('H03', 'Template B: no parents, Arabic account IDs and dimensions, drawings reduce equity', 'B', None,
     ['ruby'] * 4, ['contract', 'scope-first', 'reversed', 'interleaved'], {}, {}, ('eligible', [])),
    ('H04', 'A whole branch (receivables, its leaf and contra leaf) missing from the statement; the parent above it re-added to what is left',
     'A', h04, ['go'] * 4, ['contract'] * 4, {}, {}, ('blocked', ['MAPPING_TARGET', 'PROOF_LINE', 'STATEMENT_EQUATION'])),
    ('H05', 'A zero-balance account left out of the statement, the map and the evidence; every total still agrees',
     'A', h05, ['perl'] * 4, ['contract'] * 4, {}, {}, ('blocked', ['UNMAPPED_ACCOUNT'])),
    ('H06', 'One bank leaf listed under two parents; the second parent includes it in its control', 'A', h06,
     ['rust'] * 4, ['contract'] * 4, {}, {}, ('blocked', ['DUPLICATE_NODE'])),
    ('H07', 'Three parents in a cycle: current assets under receivables under cash under current assets', 'A', h07,
     ['libreoffice'] * 4, ['scope-first'] * 4, {}, {}, ('blocked', ['CYCLE', 'CONTROL_TOTAL'])),
    ('H08', 'The map and evidence name the branch dimension in capitals; the TB does not', 'A', h08,
     ['ruby'] * 4, ['contract'] * 4, {}, {},
     ('blocked', ['MAPPING_ACCOUNT', 'PROOF_ACCOUNT', 'UNMAPPED_ACCOUNT', 'LEAF_TOTAL'])),
    ('H09', 'The loan discount, a contra liability, shown as a positive liability under debit-positive', 'A', h09,
     ['go'] * 4, ['reversed'] * 4, {}, {}, ('blocked', ['SIGN_POLICY', 'STATEMENT_EQUATION'])),
    ('H10', 'The map changed mid-period: two evidence rows for one account, each covering part of the period', 'A', h10,
     ['perl'] * 4, ['contract'] * 4, {}, {}, ('blocked', ['DUPLICATE_PROOF_ACCOUNT', 'VALIDITY', 'UNUSED_PROOF'])),
    ('H11', 'Evidence valid exactly from the period start to the period end; amounts written without trailing zeros',
     'A', h11, ['libreoffice', 'go', 'ruby', 'perl'], ['contract'] * 4, {}, {}, ('eligible', [])),
    ('H12', 'Petty cash, an asset in the TB and the evidence, presented as a negative liability; both sides fall by the same amount',
     'A', h12, ['rust'] * 4, ['contract'] * 4, {}, {}, ('blocked', ['CLASSIFICATION', 'SIGN_POLICY'])),
    ('H13', 'A map line suggested without evidence, and an evidence row with no reference', 'A', h13,
     ['ruby'] * 4, ['contract'] * 4, {}, {}, ('blocked', ['MISSING_PROOF', 'PROOF_REFERENCE'])),
    ('H14', 'Template B with single-child parent chains and a zero reserve under its own parent', 'B14', None,
     ['go'] * 4, ['contract'] * 4, {'financial-position': 'leaves-first'}, {}, ('eligible', [])),
    ('H15', 'A chain of exactly twenty nodes from root parent to leaf', 'D20', None, ['perl'] * 4, ['contract'] * 4,
     {}, {}, ('eligible', [])),
    ('H16', 'A chain of twenty-one nodes', 'D21', None, ['rust'] * 4, ['contract'] * 4, {}, {}, ('blocked', ['DEPTH'])),
    ('H17', '160 accounts in four regions under 40 leaves, groups and subgroups', 'C', None,
     ['go', 'ruby', 'perl', 'libreoffice'], ['contract', 'interleaved', 'scope-first', 'reversed'],
     {'trial-balance': 'odd-even'}, {}, ('eligible', [])),
    ('H18', 'The 160-account statement with two leaves each one cent high and their parents re-added; the equation still holds',
     'C', h18, ['ruby'] * 4, ['contract'] * 4, {}, {}, ('blocked', ['LEAF_TOTAL'])),
    ('H19', 'Trial balance totals exactly at the aggregate limit', 'E0', None, ['ruby'] * 4, ['contract'] * 4, {}, {},
     ('eligible', [])),
    ('H20', 'One minor unit above the aggregate limit in the TB totals, still balanced; no parent', 'E1', None, ['perl'] * 4, ['contract'] * 4,
     {}, {}, ('blocked', ['SUM'])),
    ('H21', 'The statement file begins with a UTF-8 byte-order mark', 'A', None, ['go', 'go', 'go', 'rust'],
     ['contract'] * 4, {}, {'bom': ['financial-position']}, ('blocked', ['HEADERS'])),
    ('H22', 'The trial balance ends with a blank line', 'A', h22, ['perl'] * 4, ['contract'] * 4, {},
     {'trailingBlank': ['trial-balance']}, ('blocked', ['WIDTH'])),
    ('H23', 'Statement amounts in Arabic-Indic digits and with a thousands separator', 'A', h23,
     ['libreoffice'] * 4, ['contract'] * 4, {}, {}, ('blocked', ['MONEY'])),
    ('H24', 'Retained earnings placed directly under the report title', 'A', h24, ['ruby'] * 4, ['contract'] * 4,
     {}, {}, ('blocked', ['PARENT'])),
    ('H25', 'A deferred-tax heading with no lines under it, at zero', 'A', h25, ['go'] * 4, ['contract'] * 4, {}, {},
     ('blocked', ['EMPTY_PARENT'])),
    ('H26', 'Trade payables shown gross in the TB: a debit and a credit on one row, same net', 'A', h26,
     ['rust'] * 4, ['contract'] * 4, {}, {}, ('blocked', ['BOTH_SIDES'])),
    ('H27', 'The TB is one cent out; the statement balances', 'A', h27, ['libreoffice'] * 4, ['contract'] * 4, {}, {},
     ('blocked', ['TB_BALANCE', 'LEAF_TOTAL'])),
    ('H28', 'Two map lines share one Mapping ID', 'A', h28, ['perl'] * 4, ['contract'] * 4, {}, {},
     ('blocked', ['DUPLICATE_MAPPING_ID'])),
    ('H29', 'One statement row carries the previous map version', 'A', h29, ['ruby'] * 4, ['contract'] * 4, {}, {},
     ('blocked', ['SCOPE'])),
    ('H30', 'One statement leaf has its kind written as "Leaf"', 'A', h30, ['go'] * 4, ['contract'] * 4, {}, {},
     ('blocked', ['KIND'])),
    ('H31', 'One bank account split over two TB rows with the same account and dimensions', 'A', h31,
     ['rust'] * 4, ['contract'] * 4, {}, {}, ('blocked', ['DUPLICATE_ACCOUNT'])),
    ('H32', 'The map carries an extra reviewer-note column', 'A', h32, ['libreoffice'] * 4, ['contract'] * 4, {}, {},
     ('blocked', ['HEADERS'])),
]


def label_edit(t):
    """A label with a comma and a line break, the same in evidence and statement."""
    text = 'Cost, including installation\n(machinery)'
    node(t, 'PPE-COST')['Line label'] = text
    account(t, 'presentation-evidence', '1210', 'cc=HQ')['Line label'] = text


def tables_for(template):
    return {'A': template_a, 'B': template_b, 'B14': h14_tables, 'C': template_c,
            'D20': lambda: template_d(20), 'D21': lambda: template_d(21),
            'E0': lambda: template_e(0), 'E1': lambda: template_e(1)}[template]()


def header_order(role, order, extra=()):
    base = HEADERS[role] + SCOPE_HEADERS + list(extra)
    if order == 'contract':
        return base
    if order == 'scope-first':
        return SCOPE_HEADERS + HEADERS[role] + list(extra)
    if order == 'reversed':
        return base[::-1]
    if order == 'interleaved':
        return base[1::2] + base[0::2]
    raise ValueError(order)


def row_order(rows, order):
    if order == 'reversed':
        return rows[::-1]
    if order == 'odd-even':
        return rows[1::2] + rows[0::2]
    if order == 'leaves-first':
        return [r for r in rows if r['Kind'] == 'leaf'] + [r for r in rows if r['Kind'] != 'leaf']
    raise ValueError(order)


def facts(t):
    """What an eligible story's files say, from the story model: TB totals,
    leaf and parent amounts, members of each leaf, categories, equation and
    the parent of every node that is not a title."""
    tb = t['trial-balance']
    statement = t['financial-position']
    leaves = {r['Node ID']: minor(r['Amount']) for r in statement if r['Kind'] == 'leaf'}
    members = {}
    for r in t['proposed-mapping']:
        members.setdefault(r['Line ID'], []).append(f"{r['Account ID']}|{r['Complete dimensions']}")
    category = {c: sum(v for n, v in leaves.items() if node(t, n)['Line class'] == c) for c in CATEGORIES}
    return {
        'facts': {
            'debitMinor': sum(minor(r['Debit']) for r in tb),
            'creditMinor': sum(minor(r['Credit']) for r in tb),
            'leafMinor': leaves,
            'parentMinor': {r['Node ID']: minor(r['Amount']) for r in statement if r['Kind'] == 'parent'},
            'members': {k: sorted(v) for k, v in members.items()},
            'categoryMinor': category,
            'equationMinor': category['current-asset'] + category['noncurrent-asset'] - category['current-liability']
            - category['noncurrent-liability'] - category['equity'],
        },
        'ownership': {r['Node ID']: r['Parent ID'] for r in statement if r['Kind'] != 'title'},
    }


def stories():
    out = []
    for sid, what, template, edit, writers, orders, rows, flags, (status, codes) in STORIES:
        t = tables_for(template)
        if edit == 'label':
            label_edit(t)
        elif edit:
            edit(t)
        sc = t['trial-balance'][0]
        run_scope = {k: sc[k] for k in SCOPE_HEADERS}
        intent = {'status': status, 'codes': sorted(codes)}
        if status == 'eligible':
            intent.update(facts(t))
        files = []
        for role, writer, order in zip(ROLES, writers, orders):
            extra = ['Reviewer note'] if role == 'proposed-mapping' and sid == 'H32' else []
            columns = header_order(role, order, extra)
            body = row_order(t[role], rows[role]) if role in rows else t[role]
            cells = [columns] + [[r[c] for c in columns] for r in body]
            if role in flags.get('trailingBlank', []):
                cells.append([])
            files.append({'name': f'{sid}/{role}.csv', 'role': role, 'writer': writer,
                          'bom': role in flags.get('bom', []), 'cells': cells})
        out.append({'id': sid, 'what': what, 'template': template, 'runScope': run_scope, 'files': files,
                    'intent': intent})
    return out


def main():
    """One story per line, so a diff names the story it changes."""
    head = json.dumps({'generator': GENERATOR, 'synthetic': True, 'contract': 'FIN-1A-hierarchy-foundation-1'},
                      ensure_ascii=False)[:-1]
    lines = [json.dumps(s, ensure_ascii=False, separators=(',', ':')) for s in stories()]
    print(head + ', "stories": [\n' + ',\n'.join(lines) + '\n]}')


if __name__ == '__main__':
    main()
