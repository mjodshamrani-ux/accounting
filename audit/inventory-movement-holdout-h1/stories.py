"""INV-2 holdout H1 stories: movement registers and GL summaries under the
proposed inventory-movement-bridge-1 contract (audit/inventory-movement-
foundation/contract.json), written after the engine and before any product
run on them. Nothing here is imported from the foundation's stories; the
story model below is retyped for this lineage.

A pharmaceutical wholesaler in UAE dirhams, with Bahraini dinars (three
decimals) in one story; stores, lots and a cold-chain account as dimensions
and accounts, some with spaces and Arabic; transfers chained across stores
and between lots, returns of receipts posted in April, revaluations,
back-orders and rounding residues, and GL summaries in other column orders,
padded with spaces or in Arabic-Indic digits. Each story's intent is written
by hand from the contract: the status and codes of every position and
account, the excluded and dated lines, the unseen origins, the repeated
headers, the unplaced rows and the run codes. The components, the account
sides and the totals come from the story's own model of the lines it wrote.
All names, identifiers, quantities and values are invented.

  python3 -B audit/inventory-movement-holdout-h1/stories.py > frozen/stories.json
"""
import json
import random
import sys

RUN = {'Entity': 'Synthetic Pharma Distribution LLC', 'Currency': 'AED', 'Period start': '2027-05-01',
       'Period end': '2027-05-31', 'Negative balances': 'not allowed'}
COLUMNS = ['Movement ID', 'Item ID', 'Item dimensions', 'Kind', 'Quantity', 'Unit', 'Value', 'Movement date',
           'Posting date', 'GL account', 'Transfer ID', 'Origin ID']
GL_COLUMNS = ['GL account', 'Opening', 'Debit', 'Credit', 'Closing']
INFLOWS = ['receipt', 'transfer-in', 'adjustment-in', 'return-in']
OUTFLOWS = ['issue', 'transfer-out', 'adjustment-out', 'return-out']
MOVES = ['receipt', 'issue', 'transfer-in', 'transfer-out', 'adjustment-in', 'adjustment-out', 'return-in',
         'return-out']
DECIMALS = {'AED': 2, 'BHD': 3}
# Dirham unit costs are in fils; a dinar story values the same items at ten
# times the fils as fils of a dinar, three decimals.
COST_SCALE = {'AED': 1, 'BHD': 10}
WRITERS = {'php', 'java', 'go', 'perl', 'calc'}
DAYS = [2, 4, 6, 8, 11, 13, 15, 18, 20, 22, 25, 27, 29]
ARABIC = str.maketrans('0123456789.', '\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669\u066b')
COST = {'AMX-500': 4250, 'AMX-250': 2480, 'PCM-1G': 375, 'INS-10ML': 9600, 'GLV-M': 11840, 'SAL-500': 620,
        'MSK-N95': 235, 'DXT-BULK': 1840}
UNITS = {'AMX-500': 'box', 'AMX-250': 'box', 'PCM-1G': 'strip', 'INS-10ML': 'vial', 'GLV-M': 'carton',
         'SAL-500': 'bag', 'MSK-N95': 'pcs', 'DXT-BULK': 'kg'}


def U(units):
    """Whole units to thousandths."""
    return units * 1000


def Q(units):
    """Whole units (int) or a decimal text such as '18.75' to thousandths."""
    if isinstance(units, int):
        return U(units)
    whole, _, frac = units.partition('.')
    return int(whole) * 1000 + int(frac.ljust(3, '0') or 0)


def qty_text(q):
    sign = '-' if q < 0 else ''
    q = abs(q)
    whole, frac = divmod(q, 1000)
    return sign + (str(whole) if not frac else f'{whole}.{frac:03d}'.rstrip('0'))


def money(minor, decimals):
    sign = '-' if minor < 0 else ''
    s = str(abs(minor)).rjust(decimals + 1, '0')
    return sign + (f'{s[:-decimals]}.{s[-decimals:]}' if decimals else s)


def cost(item, q, unit_cost=None, scale=1):
    c = COST[item] * scale if unit_cost is None else unit_cost
    assert (q * c) % 1000 == 0, (item, q)
    return q * c // 1000


class Story:
    def __init__(self, sid, title, writer, gl_writer, currency='AED', negative='not allowed', run=None):
        assert writer in WRITERS and gl_writer in WRITERS
        self.id, self.title, self.writer, self.gl_writer = sid, title, writer, gl_writer
        self.run = dict(RUN, Currency=currency)
        self.run['Negative balances'] = negative
        self.run.update(run or {})
        self.d = DECIMALS[currency]
        self.cost_scale = COST_SCALE[currency]
        self.start, self.end = RUN['Period start'], RUN['Period end']
        self.items, self.lines, self.n, self.k = [], [], 0, 0
        self.header = list(COLUMNS)
        self.gl_header = list(GL_COLUMNS)
        self.gl_rows = None
        self.gl_over, self.gl_drop, self.gl_extra, self.gl_cells = {}, set(), [], {}
        self.gl_repeat_after = None
        self.recipe = ''

    def m(self, v):
        return money(v, self.d)

    # -- the register ------------------------------------------------------
    def line(self, item, dims, kind, q, v, unit, account, md=None, pd=None, tid='', oid='', mid=None, cells=None,
             after=(), unreadable=False, faulty=False):
        """One register line. q and v are what the stock system meant; cells
        overrides what the line shows instead. unreadable marks a line whose
        Item ID or Item dimensions the contract cannot read, faulty one that
        does not read whole for another reason."""
        if mid is None:
            self.n += 1
            mid = f'PH{self.n:05d}'
        if kind == 'opening':
            md, pd = md or self.start, pd or self.start
        elif kind == 'closing':
            md, pd = md or self.end, pd or self.end
        else:
            if md is None:
                md = f'{self.start[:8]}{DAYS[self.k % len(DAYS)]:02d}'
                self.k += 1
            pd = pd or md
        ln = {'Movement ID': mid, 'Item ID': item, 'Item dimensions': dims, 'Kind': kind, 'Quantity': qty_text(q),
              'Unit': unit, 'Value': self.m(v), 'Movement date': md, 'Posting date': pd, 'GL account': account,
              'Transfer ID': tid, 'Origin ID': oid,
              'kind': kind, 'q': q, 'v': v, 'after': list(after), 'unreadable': unreadable,
              'faulty': faulty or unreadable}
        ln.update(cells or {})
        self.items.append(('line', ln))
        self.lines.append(ln)
        return ln

    def pos(self, item, dims, unit, account, opening, moves=(), closing='auto', cdelta=(0, 0), ocells=None,
            ccells=None):
        """A position: an opening (q, v) or None, its movements, and a closing
        computed from the opening and the movements posted in the period
        (moved by cdelta), given as (q, v), or None for no closing line. A
        movement is (kind, q, v) or (kind, q, v, options); v None costs it."""
        out = []
        if opening is not None:
            out.append(self.line(item, dims, 'opening', opening[0], opening[1], unit, account, cells=ocells))
        for mv in moves:
            kind, q, v = mv[:3]
            opts = dict(mv[3]) if len(mv) > 3 else {}
            if v is None:
                v = cost(item, q, scale=self.cost_scale)
            out.append(self.line(item, dims, kind, q, v, opts.pop('unit', unit), opts.pop('account', account),
                                 **opts))
        if closing == 'auto':
            q0, v0 = opening if opening is not None else (0, 0)
            for ln in out[1 if opening is not None else 0:]:
                if not self.in_period(ln) or ln['kind'] not in MOVES:
                    continue
                sign = 1 if ln['kind'] in INFLOWS else -1
                q0, v0 = q0 + sign * ln['q'], v0 + sign * ln['v']
            closing = (q0 + cdelta[0], v0 + cdelta[1])
        if closing is not None:
            out.append(self.line(item, dims, 'closing', closing[0], closing[1], unit, account, cells=ccells))
        return out

    def std(self, item, dims, account, opening_units, moves, unit=None, **kw):
        """A position in whole units costed at the item's unit cost."""
        unit = unit or UNITS[item]
        q0 = Q(opening_units)
        return self.pos(item, dims, unit, account, (q0, cost(item, q0, scale=self.cost_scale)),
                        [(m[0], Q(m[1]), cost(item, Q(m[1]), scale=self.cost_scale), *m[2:]) for m in moves], **kw)

    def repeat_header(self):
        self.items.append(('header', None))

    def in_period(self, ln):
        return self.start <= ln['Posting date'] <= self.end

    # -- the GL ------------------------------------------------------------
    def gl_default(self):
        """The GL the books would hold: per account, the openings, the
        in-period inflows as debits and outflows as credits, a transfer
        between two lines of one account in neither (I4)."""
        pairs = {}
        for ln in self.lines:
            if ln['kind'] in ('transfer-in', 'transfer-out') and self.in_period(ln) and ln['Transfer ID']:
                pairs.setdefault(ln['Transfer ID'], []).append(ln)
        internal = set()
        for group in pairs.values():
            kinds = sorted(x['kind'] for x in group)
            if kinds == ['transfer-in', 'transfer-out'] and group[0]['GL account'] == group[1]['GL account']:
                internal.update(id(x) for x in group)
        acc = {}
        for ln in self.lines:
            a = acc.setdefault(ln['GL account'], [0, 0, 0])
            if ln['kind'] == 'opening':
                a[0] += ln['v']
            elif ln['kind'] in MOVES and self.in_period(ln) and id(ln) not in internal:
                a[1 if ln['kind'] in INFLOWS else 2] += ln['v']
        return {k: [o, d, c, o + d - c] for k, (o, d, c) in acc.items()}

    def gl_set(self, account, values):
        self.gl_over[account] = list(values)

    def gl_shift(self, frm, to, column, amount):
        """Post amount of a component to another account: the GL total stays."""
        j = GL_COLUMNS.index(column) - 1
        sign = -1 if column == 'Credit' else 1
        for acct, delta in ((frm, -amount), (to, amount)):
            row = self.gl_over.setdefault(acct, list(self.gl_default()[acct]))
            row[j] += delta
            row[3] += sign * delta

    def gl_table(self):
        base = self.gl_default()
        base.update(self.gl_over)
        rows = [[a, *base[a]] for a in sorted(base) if a not in self.gl_drop] + [list(r) for r in self.gl_extra]
        return rows

    # -- files -------------------------------------------------------------
    def register_cells(self):
        cells, n = [list(self.header)], 1
        self.repeated = []
        for kind, ln in self.items:
            n += 1
            if kind == 'header':
                cells.append(list(self.header))
                self.repeated.append(['register', n])
                continue
            ln['row'] = n
            cells.append([ln[c] for c in self.header] + ln['after'])
        return cells

    def gl_file_cells(self):
        cells = [list(self.gl_header)]
        self.gl_truth = {}
        for i, r in enumerate(self.gl_table()):
            acct, *vals = r
            written = dict(zip(GL_COLUMNS, [acct] + [self.m(v) if isinstance(v, int) else v for v in vals]))
            written.update(self.gl_cells.get(acct, {}))
            cells.append([written[c] for c in self.gl_header] + self.gl_cells.get(acct, {}).get('after', []))
            self.gl_truth.setdefault(acct, []).append(dict(zip(('opening', 'debit', 'credit', 'closing'), vals)))
            if self.gl_repeat_after == i:
                cells.append(list(self.gl_header))
                self.repeated.append(['gl', len(cells)])
        return cells

    def shuffle(self, seed):
        """Interleave the lines as a report sorted by date would print them."""
        rng = random.Random(seed)
        lines = [x for x in self.items if x[0] == 'line']
        rng.shuffle(lines)
        self.items = lines

    # -- the expectation ---------------------------------------------------
    def done(self, positions, accounts, excluded=(), dated=(), unseen=(), unplaced=(), run=(), totals=True,
             recipe=''):
        """positions and accounts: {key: (status, [codes])} written by hand.
        excluded and dated list Movement IDs; unseen [Movement ID, Origin ID];
        unplaced [file, Movement ID or GL account, code]. The numbers come
        from the model."""
        self.recipe = recipe
        reg = self.register_cells()
        gl = self.gl_file_cells()
        by_mid = {}
        for ln in self.lines:
            by_mid.setdefault(ln['Movement ID'], ln)
        out_of_period = {ln['Movement ID'] for ln in self.lines
                         if ln['kind'] in MOVES and not self.in_period(ln) and not ln['faulty']}
        assert set(excluded) == out_of_period, (self.id, set(excluded) ^ out_of_period)
        outside = {ln['Movement ID'] for ln in self.lines if ln['kind'] in MOVES and self.in_period(ln)
                   and not self.start <= ln['Movement date'] <= self.end and not ln['faulty']}
        assert set(dated) == outside, (self.id, set(dated) ^ outside)
        mine = {}
        for ln in self.lines:
            if ln['unreadable'] or ln['Movement ID'] in excluded and ln['kind'] in MOVES and not self.in_period(ln):
                continue
            mine.setdefault(f"{ln['Item ID']}|{ln['Item dimensions']}", []).append(ln)
        assert set(mine) == set(positions), (self.id, set(mine) ^ set(positions))

        want_pos = {}
        for key in sorted(positions):
            status, codes = positions[key]
            own = mine[key]
            entry = {'status': status, 'codes': sorted(codes)}
            if status == 'held':
                entry.update({'unit': None, 'account': None, 'opening': None, 'closing': None, 'flows': None,
                              'computed': None, 'lines': None})
            else:
                entry.update(self.components(own))
            entry['rows'] = sorted(ln['row'] for ln in own)
            want_pos[key] = entry

        want_acc = {}
        for acct in sorted(accounts):
            status, codes = accounts[acct]
            reg_side = gl_side = diff = None
            if status in ('consistent', 'difference') or codes == ['GL_ABSENT']:
                reg_side = self.register_side(acct, mine, positions)
            if status in ('consistent', 'difference') or codes == ['REGISTER_ABSENT']:
                [gl_side] = self.gl_truth[acct]
            if status in ('consistent', 'difference'):
                diff = {k: reg_side[k] - gl_side[k] for k in reg_side}
                assert (status == 'consistent') == (not any(diff.values())), (self.id, acct, diff)
            want_acc[acct] = {'status': status, 'codes': sorted(codes), 'register': reg_side, 'gl': gl_side,
                              'difference': diff}

        want_totals = None
        if totals:
            want_totals = {'opening': 0, **{k: 0 for k in ('receipt', 'issue', 'adjustment-in', 'adjustment-out',
                                                            'return-in', 'return-out')},
                           'closing': 0, 'transferred': 0}
            for key, own in mine.items():
                for ln in own:
                    kind = ln['kind']
                    if kind in ('opening', 'closing'):
                        want_totals[kind] += ln['v']
                    elif kind == 'transfer-out':
                        want_totals['transferred'] += ln['v']
                    elif kind != 'transfer-in':
                        want_totals[kind] += ln['v']

        row_of = lambda mid: by_mid[mid]['row']
        gl_row = {}
        for i, r in enumerate(gl):
            gl_row.setdefault(r[self.gl_header.index('GL account')], i + 1)
        self.intent = {
            'positions': want_pos,
            'accounts': want_acc,
            'excluded': sorted([ln['row'], ln['Movement ID']] for ln in self.lines
                               if ln['Movement ID'] in excluded and ln['kind'] in MOVES and not self.in_period(ln)),
            'datedOutside': sorted([row_of(m), m] for m in dated),
            'unseenOrigins': sorted([row_of(m), m, o] for m, o in unseen),
            'repeatedHeaders': sorted(self.repeated),
            'unplaced': sorted([f, row_of(k) if f == 'register' else gl_row[k], c] for f, k, c in unplaced),
            'totals': want_totals,
            'run': sorted(run),
        }
        self.cells, self.gl_cells_out = reg, gl
        return self

    def refused(self, code, recipe=''):
        self.recipe = recipe
        self.cells = self.register_cells()
        self.gl_cells_out = self.gl_file_cells()
        self.intent = {'refused': code}
        return self

    def components(self, own):
        def pair(ln):
            return None if ln is None else {'quantity': ln['q'], 'value': ln['v']}
        opening = next((ln for ln in own if ln['Kind'] == 'opening'), None)
        closing = next((ln for ln in own if ln['Kind'] == 'closing'), None)
        flows = {k: {'quantity': sum(ln['q'] for ln in own if ln['Kind'] == k),
                     'value': sum(ln['v'] for ln in own if ln['Kind'] == k)} for k in MOVES}
        computed = None
        if opening is not None:
            computed = {'quantity': opening['q'], 'value': opening['v']}
            for k in MOVES:
                sign = 1 if k in INFLOWS else -1
                computed['quantity'] += sign * flows[k]['quantity']
                computed['value'] += sign * flows[k]['value']
        return {'unit': own[0]['Unit'], 'account': own[0]['GL account'], 'opening': pair(opening),
                'closing': pair(closing), 'flows': flows, 'computed': computed,
                'lines': sorted([ln['Movement ID'], ln['Kind'], ln['q'], ln['v']] for ln in own)}

    def register_side(self, acct, mine, positions):
        lines = [ln for key, own in mine.items() for ln in own if own[0]['GL account'] == acct]
        transfers = {}
        for ln in self.lines:
            if ln['kind'] in ('transfer-in', 'transfer-out') and self.in_period(ln):
                transfers.setdefault(ln['Transfer ID'], []).append(ln)
        side = {'opening': 0, 'debit': 0, 'credit': 0, 'closing': 0}
        for ln in lines:
            kind = ln['kind']
            if kind in ('opening', 'closing'):
                side[kind] += ln['v']
                continue
            if kind in ('transfer-in', 'transfer-out'):
                group = transfers[ln['Transfer ID']]
                if all(x['GL account'] == acct for x in group):
                    continue
            side['debit' if kind in INFLOWS else 'credit'] += ln['v']
        return side

    def file(self):
        return {'register': {'name': f'{self.id}-register.csv', 'writer': self.writer, 'cells': self.cells},
                'gl': {'name': f'{self.id}-gl.csv', 'writer': self.gl_writer, 'cells': self.gl_cells_out}}


def consistent(*keys):
    return {k: ('consistent', []) for k in keys}


A, B, C = 'store=DXB-A', 'store=AUH-B', 'store=SHJ-C'
ACCT = {A: '14100', B: '14200', C: '14300'}


def stories():
    out = []

    s = Story('H01', 'Three stores and a cold-chain account in a clean May', 'php', 'java')
    s.std('AMX-500', A, '14100', 120, [('receipt', 80), ('issue', 95), ('issue', 30)])
    s.std('PCM-1G', A, '14100', 2400, [('receipt', 1200), ('issue', 1850)])
    s.std('INS-10ML', A, 'INV-COLD', 60, [('receipt', 40), ('issue', 52)])
    s.std('GLV-M', B, '14200', 35, [('receipt', 20), ('issue', 28), ('adjustment-out', 1)])
    s.std('SAL-500', C, '14300', 900, [('receipt', 600), ('issue', 1120)])
    out.append(s.done(consistent(f'AMX-500|{A}', f'PCM-1G|{A}', f'INS-10ML|{A}', f'GLV-M|{B}', f'SAL-500|{C}'),
                      consistent('14100', '14200', '14300', 'INV-COLD'),
                      recipe='Every bridge closes; each store account and the cold-chain account equal the GL.'))

    s = Story('H02', 'A chain transfer from Dubai to Abu Dhabi to Sharjah', 'go', 'php')
    s.std('AMX-500', A, '14100', 200, [('transfer-out', 60, {'tid': 'TRF-0501'}), ('issue', 40)])
    s.std('AMX-500', B, '14200', 10, [('transfer-in', 60, {'tid': 'TRF-0501'}),
                                       ('transfer-out', 25, {'tid': 'TRF-0502'}), ('issue', 30)])
    s.std('AMX-500', C, '14300', 5, [('transfer-in', 25, {'tid': 'TRF-0502'}), ('issue', 12)])
    s.shuffle(52)
    out.append(s.done(consistent(f'AMX-500|{A}', f'AMX-500|{B}', f'AMX-500|{C}'),
                      consistent('14100', '14200', '14300'),
                      recipe='Sixty boxes go to Abu Dhabi and twenty-five of them on to Sharjah; neither is a receipt.'))

    l1, l2 = 'store=DXB-A;lot=L2309', 'store=DXB-A;lot=L2311'
    s = Story('H03', 'A transfer between two lots in one store and one account', 'perl', 'go')
    s.std('INS-10ML', l1, 'INV-COLD', 80, [('transfer-out', 30, {'tid': 'LOT-77'}), ('issue', 20)])
    s.std('INS-10ML', l2, 'INV-COLD', 0, [('transfer-in', 30, {'tid': 'LOT-77'}), ('issue', 12)])
    out.append(s.done(consistent(f'INS-10ML|{l1}', f'INS-10ML|{l2}'), consistent('INV-COLD'),
                      recipe='Both lots sit in the cold-chain account: the transfer is neither its debit nor credit.'))

    s = Story('H04', 'The GL posts the same lot transfer gross', 'calc', 'perl')
    s.std('INS-10ML', l1, 'INV-COLD', 80, [('transfer-out', 30, {'tid': 'LOT-78'}), ('issue', 20)])
    s.std('INS-10ML', l2, 'INV-COLD', 0, [('transfer-in', 30, {'tid': 'LOT-78'}), ('issue', 12)])
    o, d, c, cl = s.gl_default()['INV-COLD']
    moved = cost('INS-10ML', U(30))
    s.gl_set('INV-COLD', [o, d + moved, c + moved, cl])
    out.append(s.done(consistent(f'INS-10ML|{l1}', f'INS-10ML|{l2}'),
                      {'INV-COLD': ('difference', ['CREDIT_DIFF', 'DEBIT_DIFF'])},
                      recipe='The ledger posts the lot transfer as a debit and a credit: the closing agrees, the '
                             'components do not (I4).'))

    s = Story('H05', 'A transfer sent in April and received in May', 'java', 'calc')
    a = s.std('AMX-500', A, '14100', 140, [('transfer-out', 45, {'tid': 'TRF-0430', 'md': '2027-04-29',
                                                                  'pd': '2027-04-29'}), ('issue', 35)])
    s.std('AMX-500', B, '14200', 20, [('transfer-in', 45, {'tid': 'TRF-0430', 'md': '2027-05-02'}), ('issue', 25)])
    out.append(s.done({f'AMX-500|{A}': ('consistent', []), f'AMX-500|{B}': ('held', ['TRANSFER_UNPAIRED'])},
                      {'14100': ('consistent', []), '14200': ('held', ['POSITION'])},
                      excluded=[a[1]['Movement ID']], totals=False,
                      recipe='The April transfer-out belongs to April; May holds a transfer-in with no pair.'))

    s = Story('H06', 'A transfer received under another item code', 'go', 'java')
    s.std('AMX-500', A, '14100', 90, [('transfer-out', 20, {'tid': 'TRF-0511'}), ('issue', 15)])
    s.pos('AMX-250', B, 'box', '14200', (U(30), cost('AMX-250', U(30))),
          [('transfer-in', U(20), cost('AMX-500', U(20)), {'tid': 'TRF-0511'}),
           ('issue', U(10), cost('AMX-250', U(10)))])
    out.append(s.done({f'AMX-500|{A}': ('held', ['TRANSFER_MISMATCH']), f'AMX-250|{B}': ('held', ['TRANSFER_MISMATCH'])},
                      {'14100': ('held', ['POSITION']), '14200': ('held', ['POSITION'])}, totals=False,
                      recipe='Twenty boxes of 500 mg left and arrived booked as 250 mg.'))

    s = Story('H07', 'Box and box with a capital', 'php', 'perl')
    s.std('AMX-500', A, '14100', 60, [('receipt', 24, {'unit': 'Box'}), ('issue', 30)])
    s.std('PCM-1G', B, '14200', 800, [('issue', 260)])
    out.append(s.done({f'AMX-500|{A}': ('held', ['UNIT_CONFLICT']), f'PCM-1G|{B}': ('consistent', [])},
                      {'14100': ('held', ['POSITION']), '14200': ('consistent', [])}, totals=False,
                      recipe='Units are compared as written (I1).'))

    s = Story('H08', 'Bulk dextrose in kilograms with three decimals', 'go', 'java')
    s.std('DXT-BULK', B, '14200', '250.5', [('receipt', '120.125'), ('issue', '80.375'),
                                             ('adjustment-out', '0.25')])
    s.std('SAL-500', B, '14200', 400, [('receipt', 300), ('issue', 450)])
    out.append(s.done(consistent(f'DXT-BULK|{B}', f'SAL-500|{B}'), consistent('14200'),
                      recipe='Quantities to the gram; 250 grams spilled.'))

    s = Story('H09', 'A return of an April receipt that is in the file', 'php', 'go')
    rec = s.line('GLV-M', A, 'receipt', U(50), cost('GLV-M', U(50)), 'carton', '14100', md='2027-04-28',
                 pd='2027-04-28')
    s.std('GLV-M', A, '14100', 70, [('return-out', 6, {'oid': rec['Movement ID']}), ('issue', 40)])
    out.append(s.done(consistent(f'GLV-M|{A}'), consistent('14100'), excluded=[rec['Movement ID']],
                      recipe='The receipt is April\'s and is excluded, but it is in the register: a valid origin.'))

    s = Story('H10', 'A customer return of a whole issue', 'perl', 'php')
    iss = s.std('AMX-500', C, '14300', 100, [('issue', 40)])
    s.lines.pop(), s.items.pop()
    s.line('AMX-500', C, 'return-in', U(40), cost('AMX-500', U(40)), 'box', '14300', oid=iss[1]['Movement ID'])
    s.line('AMX-500', C, 'closing', U(100), cost('AMX-500', U(100)), 'box', '14300')
    out.append(s.done(consistent(f'AMX-500|{C}'), consistent('14300'),
                      recipe='Forty boxes issued and all forty returned: exactly at capacity.'))

    s = Story('H11', 'Two returns on two receipts of one item', 'java', 'perl')
    p = s.std('PCM-1G', B, '14200', 500, [('receipt', 600), ('receipt', 400), ('issue', 700)])
    s.lines.pop(), s.items.pop()
    s.line('PCM-1G', B, 'return-out', U(50), cost('PCM-1G', U(50)), 'strip', '14200', oid=p[1]['Movement ID'])
    s.line('PCM-1G', B, 'return-out', U(80), cost('PCM-1G', U(80)), 'strip', '14200', oid=p[2]['Movement ID'])
    s.line('PCM-1G', B, 'closing', U(670), cost('PCM-1G', U(670)), 'strip', '14200')
    out.append(s.done(consistent(f'PCM-1G|{B}'), consistent('14200'),
                      recipe='Each return names its own receipt and stays within it.'))

    s = Story('H12', 'A return beyond its receipt in value only', 'calc', 'java')
    p = s.std('AMX-500', A, '14100', 50, [('receipt', 50), ('issue', 20)])
    s.lines.pop(), s.items.pop()
    s.line('AMX-500', A, 'return-out', U(10), 220000, 'box', '14100', oid=p[1]['Movement ID'])
    s.line('AMX-500', A, 'closing', U(70), cost('AMX-500', U(100)) - cost('AMX-500', U(20)) - 220000, 'box',
           '14100')
    s.std('SAL-500', C, '14300', 300, [('issue', 120)])
    out.append(s.done({f'AMX-500|{A}': ('held', ['RETURN_CAPACITY']), f'SAL-500|{C}': ('consistent', [])},
                      {'14100': ('held', ['POSITION']), '14300': ('consistent', [])}, totals=False,
                      recipe='Ten boxes back at 2,200.00 against a receipt of fifty at 2,125.00.'))

    s = Story('H13', 'A return to the supplier citing a transfer-in', 'go', 'calc')
    s.std('AMX-500', A, '14100', 150, [('transfer-out', 30, {'tid': 'TRF-0520'}), ('issue', 50)])
    b = s.std('AMX-500', B, '14200', 10, [('transfer-in', 30, {'tid': 'TRF-0520'})])
    s.lines.pop(), s.items.pop()
    s.line('AMX-500', B, 'return-out', U(5), cost('AMX-500', U(5)), 'box', '14200', oid=b[1]['Movement ID'])
    s.line('AMX-500', B, 'closing', U(35), cost('AMX-500', U(35)), 'box', '14200')
    out.append(s.done({f'AMX-500|{A}': ('consistent', []), f'AMX-500|{B}': ('held', ['RETURN_ORIGIN'])},
                      {'14100': ('consistent', []), '14200': ('held', ['POSITION'])}, totals=False,
                      recipe='Goods returned to the supplier must name a receipt, not a transfer (I5).'))

    def backorder(sid, title, allowed):
        s = Story(sid, title, 'calc', 'java', negative='allowed' if allowed else 'not allowed')
        s.std('MSK-N95', C, '14300', -200, [('receipt', 500), ('issue', 100)])
        s.std('SAL-500', C, '14300', 250, [('issue', 90)])
        return s

    s = backorder('H14', 'A back-order opening where negative balances are allowed', True)
    out.append(s.done(consistent(f'MSK-N95|{C}', f'SAL-500|{C}'), consistent('14300'),
                      recipe='Two hundred masks were owed at the start of May; the scope allows it (I6).'))

    s = backorder('H15', 'The same files where negative balances are not allowed', False)
    out.append(s.done({f'MSK-N95|{C}': ('held', ['NEGATIVE_BALANCE']), f'SAL-500|{C}': ('consistent', [])},
                      {'14300': ('held', ['POSITION'])}, totals=False,
                      recipe='The same bytes as H14 under the other scope.'))

    s = Story('H16', 'A rounding residue of minus fifty fils', 'go', 'calc')
    s.pos('AMX-500', A, 'box', '14100', (U(10), 42500), [('issue', U(10), 42550)])
    s.std('PCM-1G', A, '14100', 300, [('issue', 120)])
    out.append(s.done({f'AMX-500|{A}': ('held', ['NEGATIVE_BALANCE']), f'PCM-1G|{A}': ('consistent', [])},
                      {'14100': ('held', ['POSITION'])}, totals=False,
                      recipe='Nothing left in quantity and 0.50 below zero in value.'))

    s = Story('H17', 'A revaluation up with no quantity', 'php', 'php')
    s.pos('GLV-M', B, 'carton', '14200', (U(40), cost('GLV-M', U(40))),
          [('adjustment-in', 0, 15000), ('issue', U(12), cost('GLV-M', U(12)))])
    out.append(s.done(consistent(f'GLV-M|{B}'), consistent('14200'),
                      recipe='Gloves revalued by 150.00 with a zero quantity.'))

    s = Story('H18', 'An issue posted in June and one that happened in April', 'java', 'go')
    p = s.std('SAL-500', B, '14200', 600, [('issue', 200, {'md': '2027-05-31', 'pd': '2027-06-01'}),
                                            ('issue', 150, {'md': '2027-04-30', 'pd': '2027-05-02'}),
                                            ('receipt', 300)])
    out.append(s.done(consistent(f'SAL-500|{B}'), consistent('14200'), excluded=[p[1]['Movement ID']],
                      dated=[p[2]['Movement ID']], recipe='The posting date decides (I2).'))

    s = Story('H19', 'The closing still counts the June issue', 'perl', 'java')
    p = s.std('SAL-500', B, '14200', 600, [('issue', 200, {'md': '2027-05-31', 'pd': '2027-06-01'}),
                                            ('receipt', 300)], cdelta=(U(-200), -cost('SAL-500', U(200))))
    s.std('PCM-1G', B, '14200', 400, [('issue', 90)])
    out.append(s.done({f'SAL-500|{B}': ('inconsistent', ['QUANTITY_BRIDGE', 'VALUE_BRIDGE']),
                       f'PCM-1G|{B}': ('consistent', [])},
                      {'14200': ('held', ['POSITION'])}, excluded=[p[1]['Movement ID']],
                      recipe='The stock system closed May after the June issue.'))

    s = Story('H20', 'A movement dated 30 February', 'calc', 'go')
    s.std('PCM-1G', A, '14100', 900, [('issue', 300, {'md': '2027-02-30', 'pd': '2027-05-12', 'faulty': True})])
    s.std('PCM-1G', B, '14200', 200, [('issue', 50)])
    out.append(s.done({f'PCM-1G|{A}': ('held', ['DATE']), f'PCM-1G|{B}': ('consistent', [])},
                      {'14100': ('held', ['POSITION']), '14200': ('consistent', [])}, totals=False,
                      recipe='A date that is not a date.'))

    s = Story('H21', 'A unit left blank', 'php', 'calc')
    s.std('GLV-M', C, '14300', 25, [('receipt', 15, {'cells': {'Unit': ''}, 'faulty': True}), ('issue', 10)])
    s.std('SAL-500', C, '14300', 180, [('issue', 60)])
    out.append(s.done({f'GLV-M|{C}': ('held', ['IDENTITY']), f'SAL-500|{C}': ('consistent', [])},
                      {'14300': ('held', ['POSITION'])}, totals=False, recipe='No unit on one receipt.'))

    s = Story('H22', 'A Movement ID shared with a June line', 'java', 'php')
    p = s.std('INS-10ML', A, 'INV-COLD', 30, [('receipt', 20, {'mid': 'PH-RX-0105'}), ('issue', 18)])
    june = s.line('PCM-1G', A, 'issue', U(100), cost('PCM-1G', U(100)), 'strip', '14100', md='2027-06-02',
                  pd='2027-06-02', mid='PH-RX-0105')
    s.std('PCM-1G', A, '14100', 700, [('issue', 210)])
    out.append(s.done({f'INS-10ML|{A}': ('held', ['DUPLICATE_MOVEMENT']), f'PCM-1G|{A}': ('consistent', [])},
                      {'INV-COLD': ('held', ['POSITION']), '14100': ('consistent', [])}, excluded=['PH-RX-0105'],
                      totals=False, recipe='The June line is excluded, but its Movement ID still counts.'))

    s = Story('H23', 'An opening misposted between two GL accounts', 'perl', 'java')
    s.std('AMX-500', A, '14100', 110, [('receipt', 30), ('issue', 45)])
    s.std('AMX-500', B, '14200', 60, [('issue', 20)])
    s.gl_shift('14100', '14200', 'Opening', 85000)
    out.append(s.done(consistent(f'AMX-500|{A}', f'AMX-500|{B}'),
                      {'14100': ('difference', ['CLOSING_DIFF', 'OPENING_DIFF']),
                       '14200': ('difference', ['CLOSING_DIFF', 'OPENING_DIFF'])},
                      recipe='The GL carried 850.00 of Dubai\'s opening in Abu Dhabi.'))

    s = Story('H24', 'Credits swapped between two GL accounts', 'go', 'perl')
    s.std('SAL-500', A, '14100', 500, [('issue', 210)])
    s.std('SAL-500', C, '14300', 300, [('issue', 140)])
    s.gl_shift('14100', '14300', 'Credit', cost('SAL-500', U(40)))
    out.append(s.done(consistent(f'SAL-500|{A}', f'SAL-500|{C}'),
                      {'14100': ('difference', ['CLOSING_DIFF', 'CREDIT_DIFF']),
                       '14300': ('difference', ['CLOSING_DIFF', 'CREDIT_DIFF'])},
                      recipe='Forty bags issued in Dubai credited to Sharjah; the GL total is right.'))

    s = Story('H25', 'A GL in another column order with padded values and an idle account', 'calc', 'php')
    s.gl_header = ['GL account', 'Closing', 'Opening', 'Credit', 'Debit']
    s.std('PCM-1G', A, '14100', 1000, [('receipt', 400), ('issue', 620)])
    s.std('PCM-1G', C, '14300', 300, [('issue', 75)])
    s.gl_extra.append(['14900', 0, 0, 0, 0])
    for acct, (o, d, c, cl) in s.gl_default().items():
        s.gl_cells[acct] = {'Opening': f' {s.m(o)} ', 'Closing': f' {s.m(cl)}'}
    out.append(s.done(consistent(f'PCM-1G|{A}', f'PCM-1G|{C}'),
                      {'14100': ('consistent', []), '14300': ('consistent', []),
                       '14900': ('missing', ['REGISTER_ABSENT'])},
                      recipe='Ordinary spaces around a value are not part of it; an idle account is still listed.'))

    s = Story('H26', 'A GL summary whose last column is Balance', 'java', 'go')
    s.gl_header = ['GL account', 'Opening', 'Debit', 'Credit', 'Balance']
    s.std('AMX-500', A, '14100', 80, [('receipt', 40), ('issue', 50)])
    s.std('PCM-1G', B, '14200', 300, [('issue', 90)])
    for acct, (o, d, c, cl) in s.gl_default().items():
        s.gl_cells[acct] = {'Balance': s.m(cl)}
    out.append(s.done(consistent(f'AMX-500|{A}', f'PCM-1G|{B}'),
                      {'14100': ('held', ['GL_FILE']), '14200': ('held', ['GL_FILE'])}, run=['GL_FILE'],
                      recipe='Not the GL columns: the accounts wait, the bridges do not (I10).'))

    ain, dub = 'مخزن=العين', 'مخزن=دبي المركزي'
    s = Story('H27', 'Arabic store names and a GL in Arabic-Indic digits', 'php', 'perl')
    s.std('PCM-1G', ain, '14400', 600, [('receipt', 300), ('issue', 420)])
    s.std('SAL-500', dub, '14400', 220, [('issue', 75)])
    for acct, vals in s.gl_default().items():
        s.gl_cells[acct] = dict(zip(GL_COLUMNS[1:], [s.m(v).translate(ARABIC) for v in vals]))
    out.append(s.done(consistent(f'PCM-1G|{ain}', f'SAL-500|{dub}'), consistent('14400'),
                      recipe='Arabic-Indic digits and the Arabic decimal separator read as Latin.'))

    s = Story('H28', 'Bahraini dinars with three decimals', 'go', 'java', currency='BHD')
    s.std('AMX-500', 'store=MNM-1', '14500', 70, [('receipt', 30), ('issue', 41)])
    s.pos('GLV-M', 'store=MNM-1', 'carton', '14500', (U(12), 1420800), [('issue', U(3), 355200),
                                                                         ('adjustment-out', 0, 125)])
    out.append(s.done(consistent(f'AMX-500|store=MNM-1', f'GLV-M|store=MNM-1'), consistent('14500'),
                      recipe='Fils of a dinar to the third decimal; a write-down of 0.125.'))

    s = Story('H29', 'A paged register in another column order', 'calc', 'perl')
    s.header = ['Posting date', 'Movement date', 'Kind', 'Item ID', 'Item dimensions', 'Quantity', 'Unit', 'Value',
                'GL account', 'Movement ID', 'Origin ID', 'Transfer ID']
    for item, dims, acct, o, mv in (('PCM-1G', A, '14100', 1500, [('receipt', 500), ('issue', 700), ('issue', 300)]),
                                    ('SAL-500', A, '14100', 400, [('receipt', 200), ('issue', 260)]),
                                    ('GLV-M', B, '14200', 30, [('receipt', 10), ('issue', 22)])):
        s.std(item, dims, acct, o, mv)
    lines = list(s.items)
    s.items = lines[:6] + [('header', None)] + lines[6:12] + [('header', None)] + lines[12:]
    out.append(s.done(consistent(f'PCM-1G|{A}', f'SAL-500|{A}', f'GLV-M|{B}'), consistent('14100', '14200'),
                      recipe='Each page repeats the column row: listed and skipped (I10).'))

    s = Story('H30', 'Dimensions with a non-breaking space', 'perl', 'go')
    s.std('AMX-500', A, '14100', 90, [('issue', 30, {'cells': {'Item dimensions': 'store=DXB\u00a0A'},
                                                     'unreadable': True})])
    bad = [ln for ln in s.lines if ln['unreadable']][0]
    s.std('PCM-1G', B, '14200', 500, [('issue', 100)])
    out.append(s.done({f'AMX-500|{A}': ('held', ['LINE_UNREADABLE']), f'PCM-1G|{B}': ('held', ['LINE_UNREADABLE'])},
                      {'14100': ('held', ['LINE_UNREADABLE', 'POSITION']),
                       '14200': ('held', ['LINE_UNREADABLE', 'POSITION'])},
                      unplaced=[['register', bad['Movement ID'], 'LINE_UNREADABLE']], run=['LINE_UNREADABLE'],
                      totals=False, recipe='A space that is not an ordinary space makes the store unreadable (I8).'))

    out.append(eighty())

    s = Story('H32', 'A closing booked to another store account', 'java', 'php')
    s.std('PCM-1G', A, '14100', 400, [('issue', 120)])
    s.lines[-1]['GL account'] = '14200'
    s.std('PCM-1G', B, '14200', 150, [('receipt', 50), ('issue', 60)])
    out.append(s.done({f'PCM-1G|{A}': ('held', ['ACCOUNT_CONFLICT']), f'PCM-1G|{B}': ('consistent', [])},
                      {'14100': ('held', ['POSITION']), '14200': ('held', ['POSITION'])}, totals=False,
                      recipe='Dubai\'s closing line names the Abu Dhabi account.'))
    return out


def eighty():
    """Sixteen items in five stores, each store its own account. Six
    transfers between stores, two returns to the supplier and one customer
    return, a receipt from April posted in May, and one closing quantity one
    unit short with its value right. Lines shuffled."""
    rng = random.Random(5127)
    s = Story('H31', 'Eighty positions across five stores', 'php', 'go')
    stores = [(A, '14100'), (B, '14200'), (C, '14300'), ('store=RAK-D', '14400'), ('store=FUJ-E', '14500')]
    items = [(f'SKU-{2001 + i}', rng.choice(['box', 'strip', 'vial', 'pcs']), rng.randrange(150, 6000))
             for i in range(16)]
    transfers = {}
    for t in range(6):
        i = rng.randrange(16)
        a, b = rng.sample(range(5), 2)
        transfers.setdefault((i, a), []).append(('transfer-out', t))
        transfers.setdefault((i, b), []).append(('transfer-in', t))
    want, dated = {}, []
    for i, (item, unit, c) in enumerate(items):
        for w, (dims, acct) in enumerate(stores):
            q0 = U(rng.randrange(400, 1200))
            moves = [('receipt', U(rng.randrange(20, 300)), None), ('issue', U(rng.randrange(5, 60)), None)]
            for _ in range(rng.randrange(0, 4)):
                moves.append((rng.choice(['issue', 'receipt', 'adjustment-in', 'adjustment-out']),
                              U(rng.randrange(1, 30)), None))
            for kind, t in transfers.get((i, w), []):
                moves.append((kind, U(15 + t), None, {'tid': f'TRF-31{t:02d}'}))
            if (i, w) == (7, 2):
                moves.append(('receipt', U(40), None, {'md': '2027-04-29', 'pd': '2027-05-01'}))
            costed = [(m[0], m[1], m[1] * c // 1000, *(m[3:])) for m in moves]
            delta = (U(-1), 0) if (i, w) == (12, 4) else (0, 0)
            lines = s.pos(item, dims, unit, acct, (q0, q0 * c // 1000), costed, cdelta=delta)
            if (i, w) == (7, 2):
                dated.append(lines[-2]['Movement ID'])
            if (i, w) in ((2, 0), (10, 3), (5, 1)):
                kind, origin = ('return-in', lines[2]) if (i, w) == (5, 1) else ('return-out', lines[1])
                s.line(item, dims, kind, U(3), 3 * c, unit, acct, oid=origin['Movement ID'])
                cl = lines[-1]
                s.items.remove(('line', cl))
                s.lines.remove(cl)
                sign = 1 if kind == 'return-in' else -1
                s.line(item, dims, 'closing', cl['q'] + sign * U(3), cl['v'] + sign * 3 * c, unit, acct)
            key = f'{item}|{dims}'
            want[key] = ('inconsistent', ['QUANTITY_BRIDGE']) if delta != (0, 0) else ('consistent', [])
    s.shuffle(5128)
    accounts = {acct: ('consistent', []) for _, acct in stores}
    accounts['14500'] = ('held', ['POSITION'])
    return s.done(want, accounts, dated=dated,
                  recipe='Volume within the structure: one closing a unit short holds its account only.')


def main():
    out = []
    for s in stories():
        out.append({'id': s.id, 'title': s.title, 'recipe': s.recipe, 'runScope': s.run, 'intent': s.intent,
                    'files': s.file()})
    sys.stdout.write(json.dumps({'schema': 'tarasuf-inv2-movement-bridge-h1-stories/1', 'stories': out},
                                ensure_ascii=False, indent=1) + '\n')


if __name__ == '__main__':
    main()
