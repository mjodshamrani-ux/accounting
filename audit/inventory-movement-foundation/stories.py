"""INV-2 foundation stories: a movement register, one line per opening,
movement and closing of each item and dimensions, and a GL summary of the
inventory accounts, as the proposed inventory-movement-bridge-1 contract
(contract.json) reads them.

Each story names its two files, their CSV writers, the period scope the
accountant confirms, and its intent: the status and codes of every position
(Item ID|Item dimensions) and every GL account, the excluded lines, the lines
dated outside the period, the origins not in the register, the repeated
headers, the unplaced rows and the run codes, written by hand from the
contract before any oracle ran. The components of every position that is not
held, the register and GL sides of every account compared, and the entity
totals come from the story's own model of the lines it wrote. All
identifiers, quantities and values are invented.

  python3 -B audit/inventory-movement-foundation/stories.py > frozen/stories.json
"""
import json
import random
import sys

RUN = {'Entity': 'Synthetic Building Supplies Co', 'Currency': 'SAR', 'Period start': '2026-10-01',
       'Period end': '2026-10-31', 'Negative balances': 'not allowed'}
COLUMNS = ['Movement ID', 'Item ID', 'Item dimensions', 'Kind', 'Quantity', 'Unit', 'Value', 'Movement date',
           'Posting date', 'GL account', 'Transfer ID', 'Origin ID']
GL_COLUMNS = ['GL account', 'Opening', 'Debit', 'Credit', 'Closing']
INFLOWS = ['receipt', 'transfer-in', 'adjustment-in', 'return-in']
OUTFLOWS = ['issue', 'transfer-out', 'adjustment-out', 'return-out']
MOVES = ['receipt', 'issue', 'transfer-in', 'transfer-out', 'adjustment-in', 'adjustment-out', 'return-in',
         'return-out']
DECIMALS = {'SAR': 2, 'KWD': 3, 'JPY': 0}
WRITERS = {'py', 'py-pad', 'node', 'raw', 'cp1256'}
DAYS = [3, 5, 7, 9, 12, 14, 16, 19, 21, 23, 26, 28, 30]
ARABIC = str.maketrans('0123456789.', '\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669\u066b')
# Unit costs in halalas, as the stock system valued each item; the stories
# only use them to write plausible values, the contract never derives them.
COST = {'CEM-50': 1850, 'RB-12': 295000, 'PNT-20': 14500, 'TIL-60': 3875, 'PIP-110': 6240, 'GYP-12': 2730,
        'SND': 8500}


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


def cost(item, q, unit_cost=None):
    c = COST[item] if unit_cost is None else unit_cost
    assert (q * c) % 1000 == 0, (item, q)
    return q * c // 1000


class Story:
    def __init__(self, sid, title, writer, gl_writer, currency='SAR', negative='not allowed', run=None):
        assert writer in WRITERS and gl_writer in WRITERS
        self.id, self.title, self.writer, self.gl_writer = sid, title, writer, gl_writer
        self.run = dict(RUN, Currency=currency)
        self.run['Negative balances'] = negative
        self.run.update(run or {})
        self.d = DECIMALS[currency]
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
             after=(), unreadable=False):
        """One register line. q and v are what the stock system meant; cells
        overrides what the line shows instead. unreadable marks a line whose
        Item ID or Item dimensions the contract cannot read."""
        if mid is None:
            self.n += 1
            mid = f'MV-{self.n:04d}'
        if kind == 'opening':
            md, pd = md or self.start, pd or self.start
        elif kind == 'closing':
            md, pd = md or self.end, pd or self.end
        else:
            if md is None:
                md = f'2026-10-{DAYS[self.k % len(DAYS)]:02d}'
                self.k += 1
            pd = pd or md
        ln = {'Movement ID': mid, 'Item ID': item, 'Item dimensions': dims, 'Kind': kind, 'Quantity': qty_text(q),
              'Unit': unit, 'Value': self.m(v), 'Movement date': md, 'Posting date': pd, 'GL account': account,
              'Transfer ID': tid, 'Origin ID': oid,
              'kind': kind, 'q': q, 'v': v, 'after': list(after), 'unreadable': unreadable}
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
                v = cost(item, q)
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
        unit = unit or {'CEM-50': 'bag', 'RB-12': 'ton', 'PNT-20': 'can', 'TIL-60': 'm2', 'PIP-110': 'pcs',
                        'GYP-12': 'sheet', 'SND': 'm3'}[item]
        q0 = Q(opening_units)
        return self.pos(item, dims, unit, account, (q0, cost(item, q0)),
                        [(m[0], Q(m[1]), None, *m[2:]) for m in moves], **kw)

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
        sign = 1 if column == 'Debit' else -1
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
                         if ln['kind'] in MOVES and not self.in_period(ln)}
        assert set(excluded) == out_of_period, (self.id, set(excluded) ^ out_of_period)
        outside = {ln['Movement ID'] for ln in self.lines if ln['kind'] in MOVES and self.in_period(ln)
                   and not self.start <= ln['Movement date'] <= self.end}
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
            'excluded': sorted([row_of(m), m] for m in excluded),
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


def stories():
    out = []
    R, J, D = 'wh=RIY-1', 'wh=JED-2', 'wh=DMM-3'

    s = Story('M01', 'A clean month in two warehouses', 'py', 'py')
    s.std('CEM-50', R, '1310', 1200, [('receipt', 800), ('issue', 650), ('issue', 120)])
    s.std('CEM-50', J, '1320', 400, [('receipt', 300), ('issue', 350)])
    s.std('RB-12', R, '1310', '12.5', [('receipt', 20), ('issue', '18.75')])
    s.std('PNT-20', J, '1320', 60, [('issue', 24), ('adjustment-out', 2)])
    out.append(s.done(consistent(f'CEM-50|{R}', f'CEM-50|{J}', f'RB-12|{R}', f'PNT-20|{J}'),
                      consistent('1310', '1320'),
                      recipe='Every bridge closes in quantity and value, and each account equals the GL.'))

    s = Story('M02', 'A transfer between warehouses on two accounts', 'node', 'py')
    s.std('CEM-50', R, '1310', 1500, [('receipt', 600), ('transfer-out', 300, {'tid': 'TR-2001'}), ('issue', 400)])
    s.std('CEM-50', J, '1320', 200, [('transfer-in', 300, {'tid': 'TR-2001'}), ('issue', 250)])
    s.std('GYP-12', J, '1320', 900, [('receipt', 300), ('issue', 520)])
    s.shuffle(202)
    out.append(s.done(consistent(f'CEM-50|{R}', f'CEM-50|{J}', f'GYP-12|{J}'), consistent('1310', '1320'),
                      recipe='The transfer is a credit of 1310 and a debit of 1320, and no entity receipt.'))

    s = Story('M03', 'A transfer within one account', 'py-pad', 'raw')
    s.std('CEM-50', R, '1311', 1000, [('transfer-out', 250, {'tid': 'TR-3001'}), ('issue', 300), ('receipt', 500)])
    s.std('CEM-50', D, '1311', 100, [('transfer-in', 250, {'tid': 'TR-3001'}), ('issue', 200)])
    s.std('GYP-12', D, '1314', 500, [('issue', 120)])
    out.append(s.done(consistent(f'CEM-50|{R}', f'CEM-50|{D}', f'GYP-12|{D}'), consistent('1311', '1314'),
                      recipe='Both sides of the transfer name 1311, so it is neither its debit nor its credit (I4).'))

    s = Story('M04', 'A transfer whose receiving side never arrived', 'py', 'node')
    s.std('CEM-50', R, '1310', 800, [('transfer-out', 200, {'tid': 'TR-4001'}), ('issue', 150)])
    s.std('CEM-50', J, '1320', 300, [('receipt', 100), ('issue', 120)])
    out.append(s.done({f'CEM-50|{R}': ('held', ['TRANSFER_UNPAIRED']), f'CEM-50|{J}': ('consistent', [])},
                      {'1310': ('held', ['POSITION']), '1320': ('consistent', [])}, totals=False,
                      recipe='Riyadh closes on its own lines, but a transfer-out with no transfer-in is not proven.'))

    s = Story('M05', 'The receiving side posted in November', 'node', 'py-pad')
    s.std('CEM-50', R, '1310', 900, [('transfer-out', 300, {'tid': 'TR-5001', 'md': '2026-10-30'}), ('issue', 200)])
    lines = s.std('CEM-50', J, '1320', 150, [('transfer-in', 300, {'tid': 'TR-5001', 'md': '2026-10-31',
                                                                    'pd': '2026-11-02'}), ('issue', 100)])
    out.append(s.done({f'CEM-50|{R}': ('held', ['TRANSFER_UNPAIRED']), f'CEM-50|{J}': ('consistent', [])},
                      {'1310': ('held', ['POSITION']), '1320': ('consistent', [])},
                      excluded=[lines[1]['Movement ID']], totals=False,
                      recipe='The goods arrived on 31 October but were posted on 2 November: excluded, so the '
                             'October transfer-out has no pair.'))

    s = Story('M06', 'A transfer received short and one at another value', 'raw', 'py')
    s.pos('TIL-60', R, 'm2', '1310', (U(2000), cost('TIL-60', U(2000))),
          [('transfer-out', U(500), 1937500, {'tid': 'TR-6001'}), ('transfer-out', U(300), 1162500, {'tid': 'TR-6002'}),
           ('issue', U(400), None)])
    s.pos('TIL-60', J, 'm2', '1320', (U(100), cost('TIL-60', U(100))),
          [('transfer-in', U(498), 1929750, {'tid': 'TR-6001'}), ('issue', U(50), None)])
    s.pos('TIL-60', D, 'm2', '1330', (U(50), cost('TIL-60', U(50))),
          [('transfer-in', U(300), 1170000, {'tid': 'TR-6002'}), ('issue', U(80), None)])
    out.append(s.done({f'TIL-60|{R}': ('held', ['TRANSFER_MISMATCH']), f'TIL-60|{J}': ('held', ['TRANSFER_MISMATCH']),
                       f'TIL-60|{D}': ('held', ['TRANSFER_MISMATCH'])},
                      {a: ('held', ['POSITION']) for a in ('1310', '1320', '1330')}, totals=False,
                      recipe='Two square metres short on one transfer, 75 riyals more on the other: each bridge '
                             'closes on its own lines, but neither transfer is proven.'))

    s = Story('M07', 'A transfer in boxes received in pieces', 'py', 'node')
    s.pos('TIL-60', R, 'box', '1310', (U(300), 13950000),
          [('transfer-out', U(20), 930000, {'tid': 'TR-7001'}), ('issue', U(40), 1860000)])
    s.pos('TIL-60', J, 'pcs', '1320', (U(600), 2325000),
          [('transfer-in', U(240), 930000, {'tid': 'TR-7001'}), ('issue', U(100), 387500)])
    out.append(s.done({f'TIL-60|{R}': ('held', ['TRANSFER_MISMATCH']), f'TIL-60|{J}': ('held', ['TRANSFER_MISMATCH'])},
                      {'1310': ('held', ['POSITION']), '1320': ('held', ['POSITION'])}, totals=False,
                      recipe='Twenty boxes left and 240 pieces arrived at the same value: no unit is converted (I1).'))

    s = Story('M08', 'One Transfer ID on two transfers', 'py-pad', 'py')
    s.std('PIP-110', R, '1310', 500, [('transfer-out', 100, {'tid': 'TR-8001'}), ('transfer-out', 80, {'tid': 'TR-8001'})])
    s.std('PIP-110', J, '1320', 50, [('transfer-in', 100, {'tid': 'TR-8001'})])
    s.std('PIP-110', D, '1330', 20, [('transfer-in', 80, {'tid': 'TR-8001'})])
    s.std('SND', R, '1340', 60, [('receipt', 40), ('issue', 35)])
    out.append(s.done({f'PIP-110|{R}': ('held', ['TRANSFER_REPEATED']), f'PIP-110|{J}': ('held', ['TRANSFER_REPEATED']),
                       f'PIP-110|{D}': ('held', ['TRANSFER_REPEATED']), f'SND|{R}': ('consistent', [])},
                      {'1310': ('held', ['POSITION']), '1320': ('held', ['POSITION']), '1330': ('held', ['POSITION']),
                       '1340': ('consistent', [])}, totals=False,
                      recipe='Two transfers printed under one Transfer ID: which out went where is not proven.'))

    def negative(sid, title, allowed):
        s = Story(sid, title, 'node', 'raw', negative='allowed' if allowed else 'not allowed')
        s.std('CEM-50', R, '1310', 40, [('issue', 55)])
        s.std('CEM-50', J, '1320', 300, [('receipt', 200), ('issue', 260)])
        return s

    s = negative('M09', 'A negative closing the scope does not allow', False)
    out.append(s.done({f'CEM-50|{R}': ('held', ['NEGATIVE_BALANCE']), f'CEM-50|{J}': ('consistent', [])},
                      {'1310': ('held', ['POSITION']), '1320': ('consistent', [])}, totals=False,
                      recipe='Fifty-five bags issued from forty: the closing is minus fifteen bags.'))

    s = negative('M10', 'The same register where negative balances are allowed', True)
    out.append(s.done(consistent(f'CEM-50|{R}', f'CEM-50|{J}'), consistent('1310', '1320'),
                      recipe='The same bytes as M09; the confirmed scope allows negative balances (I6).'))

    s = Story('M11', 'A receipt written with a minus sign', 'py', 'py')
    s.pos('PNT-20', J, 'can', '1320', (U(80), 1160000),
          [('receipt', U(-12), -174000, {'cells': {'Quantity': '-12', 'Value': '-1740.00'}}), ('issue', U(30), 435000)],
          closing=(U(38), 551000))
    s.std('PNT-20', R, '1310', 40, [('receipt', 20), ('issue', 25)])
    s.gl_set('1320', [1160000, 0, 609000, 551000])
    out.append(s.done({f'PNT-20|{J}': ('held', ['QUANTITY', 'VALUE']), f'PNT-20|{R}': ('consistent', [])},
                      {'1320': ('held', ['POSITION']), '1310': ('consistent', [])}, totals=False,
                      recipe='A return to the supplier written as a negative receipt: a movement carries no sign (I6).'))

    s = Story('M12', 'Boxes and pieces, and m3 and M3, in one position', 'raw', 'node')
    s.pos('TIL-60', R, 'box', '1310', (U(120), 5580000),
          [('receipt', U(36), 139500, {'unit': 'pcs'}), ('issue', U(30), 1395000)])
    s.std('SND', D, '1330', 40, [('receipt', 25, {'unit': 'M3'}), ('issue', 30)])
    s.std('GYP-12', J, '1320', 700, [('receipt', 150), ('issue', 610)])
    out.append(s.done({f'TIL-60|{R}': ('held', ['UNIT_CONFLICT']), f'SND|{D}': ('held', ['UNIT_CONFLICT']),
                       f'GYP-12|{J}': ('consistent', [])},
                      {'1310': ('held', ['POSITION']), '1330': ('held', ['POSITION']), '1320': ('consistent', [])},
                      totals=False, recipe='Units are compared as written: box and pcs, m3 and M3 (I1).'))

    s = Story('M13', 'A receipt posted in November', 'py', 'py')
    lines = s.std('CEM-50', R, '1310', 700, [('receipt', 400, {'md': '2026-10-30', 'pd': '2026-11-01'}),
                                              ('issue', 300)])
    s.std('RB-12', R, '1310', 8, [('receipt', 10), ('issue', '6.5')])
    out.append(s.done(consistent(f'CEM-50|{R}', f'RB-12|{R}'), consistent('1310'),
                      excluded=[lines[1]['Movement ID']],
                      recipe='Received on 30 October, posted on 1 November: not in this bridge, and the printed '
                             'closing leaves it out (I2).'))

    s = Story('M14', 'September movements posted in October', 'node', 'py-pad')
    a = s.std('CEM-50', J, '1320', 250, [('receipt', 500, {'md': '2026-09-29', 'pd': '2026-10-02'}), ('issue', 420)])
    b = s.std('PIP-110', J, '1320', 120, [('adjustment-in', 6, {'md': '2026-09-30', 'pd': '2026-10-01'}),
                                           ('issue', 35)])
    out.append(s.done(consistent(f'CEM-50|{J}', f'PIP-110|{J}'), consistent('1320'),
                      dated=[a[1]['Movement ID'], b[1]['Movement ID']],
                      recipe='Posted in October, so in the bridge, and listed because they happened in September.'))

    s = Story('M15', 'The closing counts a receipt posted in November', 'py-pad', 'node')
    lines = s.std('CEM-50', R, '1310', 700, [('receipt', 400, {'md': '2026-10-30', 'pd': '2026-11-01'}),
                                              ('issue', 300)], cdelta=(U(400), 740000))
    s.std('CEM-50', J, '1320', 220, [('receipt', 80), ('issue', 150)])
    out.append(s.done({f'CEM-50|{R}': ('inconsistent', ['QUANTITY_BRIDGE', 'VALUE_BRIDGE']),
                       f'CEM-50|{J}': ('consistent', [])},
                      {'1310': ('held', ['POSITION']), '1320': ('consistent', [])},
                      excluded=[lines[1]['Movement ID']],
                      recipe='The stock system closed October with the November receipt in it.'))

    s = Story('M16', 'A return to the supplier of its receipt', 'py', 'py')
    a = s.std('GYP-12', R, '1310', 400, [('receipt', 300)])
    s.lines.pop(), s.items.pop()
    ret = s.line('GYP-12', R, 'return-out', U(25), cost('GYP-12', U(25)), 'sheet', '1310', oid=a[1]['Movement ID'])
    iss = s.line('GYP-12', R, 'issue', U(210), cost('GYP-12', U(210)), 'sheet', '1310')
    s.line('GYP-12', R, 'closing', U(465), cost('GYP-12', U(465)), 'sheet', '1310')
    s.std('GYP-12', J, '1320', 180, [('receipt', 60), ('issue', 90)])
    out.append(s.done(consistent(f'GYP-12|{R}', f'GYP-12|{J}'), consistent('1310', '1320'),
                      recipe='Twenty-five sheets of a 300-sheet receipt go back to the supplier.'))

    s = Story('M17', 'A return citing a receipt of another item', 'node', 'py')
    g = s.std('GYP-12', R, '1310', 400, [('receipt', 300), ('issue', 200)])
    s.std('CEM-50', R, '1310', 600, [('receipt', 200), ('return-out', 20, {'oid': g[1]['Movement ID']}),
                                      ('issue', 150)])
    out.append(s.done({f'GYP-12|{R}': ('consistent', []), f'CEM-50|{R}': ('held', ['RETURN_ORIGIN'])},
                      {'1310': ('held', ['POSITION'])}, totals=False,
                      recipe='Twenty bags of cement returned against a gypsum board receipt.'))

    s = Story('M18', 'A return citing an issue', 'py-pad', 'raw')
    p = s.std('PNT-20', J, '1320', 90, [('issue', 40)])
    s.lines.pop(), s.items.pop()
    s.line('PNT-20', J, 'return-out', U(5), cost('PNT-20', U(5)), 'can', '1320', oid=p[1]['Movement ID'])
    s.line('PNT-20', J, 'receipt', U(30), cost('PNT-20', U(30)), 'can', '1320')
    s.line('PNT-20', J, 'closing', U(75), cost('PNT-20', U(75)), 'can', '1320')
    s.std('PNT-20', R, '1310', 45, [('receipt', 15), ('issue', 22)])
    out.append(s.done({f'PNT-20|{J}': ('held', ['RETURN_ORIGIN']), f'PNT-20|{R}': ('consistent', [])},
                      {'1320': ('held', ['POSITION']), '1310': ('consistent', [])}, totals=False,
                      recipe='A return to the supplier must name a receipt, not an issue (I5).'))

    s = Story('M19', 'A customer return to another warehouse', 'raw', 'node')
    s.header = ['Item ID', 'Item dimensions', 'Kind', 'Movement ID', 'Posting date', 'Movement date', 'Quantity',
                'Unit', 'Value', 'GL account', 'Origin ID', 'Transfer ID']
    p = s.std('PIP-110', R, '1310', 400, [('issue', 150), ('receipt', 100)])
    s.std('PIP-110', J, '1320', 60, [('return-in', 12, {'oid': p[1]['Movement ID']}), ('issue', 30)])
    s.shuffle(1919)
    out.append(s.done(consistent(f'PIP-110|{R}', f'PIP-110|{J}'), consistent('1310', '1320'),
                      recipe='A customer brings back twelve pipes issued from Riyadh to Jeddah; the warehouse may '
                             'differ (I5). The columns are printed in another order.'))

    s = Story('M20', 'Two returns beyond their receipt', 'py', 'py-pad')
    p = s.std('CEM-50', R, '1310', 500, [('receipt', 100), ('issue', 200)])
    s.lines.pop(), s.items.pop()
    s.line('CEM-50', R, 'return-out', U(60), cost('CEM-50', U(60)), 'bag', '1310', oid=p[1]['Movement ID'])
    s.line('CEM-50', R, 'closing', U(340), cost('CEM-50', U(340)), 'bag', '1310')
    s.std('CEM-50', J, '1320', 300, [('return-out', 50, {'oid': p[1]['Movement ID']}), ('issue', 100)])
    s.std('GYP-12', D, '1330', 250, [('receipt', 50), ('issue', 75)])
    out.append(s.done({f'CEM-50|{R}': ('held', ['RETURN_CAPACITY']), f'CEM-50|{J}': ('held', ['RETURN_CAPACITY']),
                       f'GYP-12|{D}': ('consistent', [])},
                      {'1310': ('held', ['POSITION']), '1320': ('held', ['POSITION']), '1330': ('consistent', [])},
                      totals=False, recipe='Sixty and fifty bags returned against a receipt of one hundred.'))

    s = Story('M21', 'A return of a September receipt', 'node', 'py')
    p = s.std('CEM-50', R, '1310', 900, [('return-out', 30, {'oid': 'MV-0911'}), ('receipt', 200), ('issue', 380)])
    out.append(s.done(consistent(f'CEM-50|{R}'), consistent('1310'), unseen=[[p[1]['Movement ID'], 'MV-0911']],
                      recipe='The receipt returned is in September\'s register: listed, not held (I5).'))

    s = Story('M22', 'The same GL total with two accounts swapped', 'py-pad', 'py')
    s.std('CEM-50', R, '1311', 1000, [('receipt', 600), ('issue', 500)])
    s.std('RB-12', R, '1312', 10, [('receipt', 4), ('issue', 5)])
    s.gl_shift('1311', '1312', 'Debit', cost('CEM-50', U(600)))
    out.append(s.done(consistent(f'CEM-50|{R}', f'RB-12|{R}'),
                      {'1311': ('difference', ['CLOSING_DIFF', 'DEBIT_DIFF']),
                       '1312': ('difference', ['CLOSING_DIFF', 'DEBIT_DIFF'])},
                      recipe='The GL posted the cement receipt to the steel account: the totals agree, the '
                             'accounts do not (I9).'))

    s = Story('M23', 'An account missing from the GL and one the register never names', 'raw', 'py')
    s.gl_header = ['GL account', 'Debit', 'Credit', 'Opening', 'Closing']
    s.std('CEM-50', R, '1310', 500, [('receipt', 120), ('issue', 260)])
    s.std('CEM-50', J, '1320', 140, [('receipt', 90), ('issue', 75)])
    s.gl_drop.add('1320')
    s.gl_extra.append(['1390', 0, 450000, 0, 450000])
    out.append(s.done(consistent(f'CEM-50|{R}', f'CEM-50|{J}'),
                      {'1310': ('consistent', []), '1320': ('missing', ['GL_ABSENT']),
                       '1390': ('missing', ['REGISTER_ABSENT'])},
                      recipe='The GL file leaves out Jeddah and holds a goods-in-transit account no line names.'))

    s = Story('M24', 'A closing value one riyal off', 'node', 'node')
    s.std('PNT-20', R, '1310', 70, [('receipt', 50), ('issue', 64)], cdelta=(0, 100))
    s.std('PNT-20', J, '1320', 35, [('receipt', 20), ('issue', 18)])
    out.append(s.done({f'PNT-20|{R}': ('inconsistent', ['VALUE_BRIDGE']), f'PNT-20|{J}': ('consistent', [])},
                      {'1310': ('held', ['POSITION']), '1320': ('consistent', [])},
                      recipe='The quantities close; the printed closing value is 1.00 more than the bridge.'))

    s = Story('M25', 'A closing quantity one bag off', 'py', 'raw')
    s.std('CEM-50', D, '1330', 300, [('receipt', 200), ('issue', 260)], cdelta=(U(-1), 0))
    s.std('GYP-12', D, '1330', 120, [('receipt', 40), ('issue', 55)])
    s.std('CEM-50', R, '1310', 410, [('receipt', 90), ('issue', 300)])
    out.append(s.done({f'CEM-50|{D}': ('inconsistent', ['QUANTITY_BRIDGE']), f'GYP-12|{D}': ('consistent', []),
                       f'CEM-50|{R}': ('consistent', [])},
                      {'1330': ('held', ['POSITION']), '1310': ('consistent', [])},
                      recipe='The values close; the printed closing is one bag short.'))

    s = Story('M26', 'A new item without an opening and a position without its closing', 'py-pad', 'py')
    s.pos('SND', R, 'm3', '1310', None, [('receipt', U(30), None), ('issue', U(12), None)])
    s.std('CEM-50', R, '1310', 600, [('receipt', 100), ('issue', 220)], closing=None)
    s.std('CEM-50', J, '1320', 260, [('receipt', 40), ('issue', 90)])
    out.append(s.done({f'SND|{R}': ('missing', ['OPENING_ABSENT']), f'CEM-50|{R}': ('missing', ['CLOSING_ABSENT']),
                       f'CEM-50|{J}': ('consistent', [])},
                      {'1310': ('held', ['POSITION']), '1320': ('consistent', [])}, totals=False,
                      recipe='Sand was first received this month and has no opening line; cement in Riyadh has no '
                             'closing line. Neither is taken as zero (I7).'))

    s = Story('M27', 'Two opening lines for one position', 'node', 'py')
    p = s.std('PIP-110', J, '1320', 100, [('receipt', 50), ('issue', 40)])
    s.items.insert(1, ('line', s.line('PIP-110', J, 'opening', U(95), cost('PIP-110', U(95)), 'pcs', '1320')))
    s.items.pop()
    s.std('PIP-110', R, '1310', 220, [('issue', 70)])
    out.append(s.done({f'PIP-110|{J}': ('held', ['BALANCE_REPEATED']), f'PIP-110|{R}': ('consistent', [])},
                      {'1320': ('held', ['POSITION']), '1310': ('consistent', [])}, totals=False,
                      recipe='One hundred and ninety-five pieces both printed as the opening.'))

    s = Story('M28', 'An opening dated in September', 'raw', 'py')
    s.std('GYP-12', J, '1320', 300, [('receipt', 100), ('issue', 160)])
    s.lines[0]['Movement date'] = s.lines[0]['Posting date'] = '2026-09-30'
    s.std('GYP-12', R, '1310', 140, [('receipt', 60), ('issue', 75)])
    out.append(s.done({f'GYP-12|{J}': ('held', ['BALANCE_DATE']), f'GYP-12|{R}': ('consistent', [])},
                      {'1320': ('held', ['POSITION']), '1310': ('consistent', [])}, totals=False,
                      recipe='The opening is dated 30 September, not 1 October.'))

    s = Story('M29', 'One Movement ID on two lines', 'py', 'node')
    s.std('CEM-50', R, '1310', 500, [('issue', 120, {'mid': 'MV-7001'}), ('receipt', 80)])
    s.std('CEM-50', J, '1320', 200, [('receipt', 150, {'mid': 'MV-7001'}), ('issue', 90)])
    s.std('RB-12', R, '1310', 6, [('receipt', 3), ('issue', 4)])
    s.std('GYP-12', D, '1330', 90, [('receipt', 30), ('issue', 45)])
    out.append(s.done({f'CEM-50|{R}': ('held', ['DUPLICATE_MOVEMENT']), f'CEM-50|{J}': ('held', ['DUPLICATE_MOVEMENT']),
                       f'RB-12|{R}': ('consistent', []), f'GYP-12|{D}': ('consistent', [])},
                      {'1310': ('held', ['POSITION']), '1320': ('held', ['POSITION']), '1330': ('consistent', [])},
                      totals=False, recipe='An issue in Riyadh and a receipt in Jeddah carry one Movement ID.'))

    s = Story('M30', 'One position on two accounts', 'node', 'py-pad')
    s.std('PNT-20', R, '1310', 50, [('receipt', 40, {'account': '1320'}), ('issue', 35)])
    s.std('PNT-20', J, '1320', 30, [('issue', 10)])
    out.append(s.done({f'PNT-20|{R}': ('held', ['ACCOUNT_CONFLICT']), f'PNT-20|{J}': ('consistent', [])},
                      {'1310': ('held', ['POSITION']), '1320': ('held', ['POSITION'])}, totals=False,
                      recipe='A Riyadh receipt posted to the Jeddah account: both accounts wait.'))

    s = Story('M31', 'An Item ID that reads as a formula', 'py', 'py')
    s.std('CEM-50', R, '1310', 600, [('receipt', 200), ('issue', 150, {'cells': {'Item ID': '=CEM-50'},
                                                                        'unreadable': True})])
    bad = [ln for ln in s.lines if ln['unreadable']][0]
    s.std('CEM-50', J, '1320', 180, [('receipt', 40), ('issue', 60)])
    out.append(s.done({f'CEM-50|{R}': ('held', ['LINE_UNREADABLE']), f'CEM-50|{J}': ('held', ['LINE_UNREADABLE'])},
                      {'1310': ('held', ['LINE_UNREADABLE', 'POSITION']),
                       '1320': ('held', ['LINE_UNREADABLE', 'POSITION'])},
                      unplaced=[['register', bad['Movement ID'], 'LINE_UNREADABLE']], run=['LINE_UNREADABLE'],
                      totals=False, recipe='An issue line whose item cannot be read could be any position\'s (I8).'))

    s = Story('M32', 'A write-down in Kuwaiti dinars', 'py-pad', 'node', currency='KWD')
    k1, k2 = 'wh=KWI-1', 'wh=AHM-2'
    s.pos('CEM-50', k1, 'bag', '1310', (U(2000), 2300000),
          [('receipt', U(500), 575000), ('issue', U(900), 1035000), ('adjustment-out', 0, 125500)])
    s.pos('CEM-50', k2, 'bag', '1320', (U(300), 345000), [('issue', U(120), 138000)])
    out.append(s.done(consistent(f'CEM-50|{k1}', f'CEM-50|{k2}'), consistent('1310', '1320'),
                      recipe='A value adjustment of 125.500 dinars with a zero quantity, in three decimals.'))

    s = Story('M33', 'Yen with a fraction', 'node', 'py', currency='JPY')
    o1, o2 = 'wh=OSA-1', 'wh=KOB-2'
    s.pos('PNT-20', o1, 'can', '1310', (U(30), 64500),
          [('receipt', U(20), 43000, {'cells': {'Value': '43000.5'}}), ('issue', U(10), 21500)])
    s.pos('PNT-20', o2, 'can', '1320', (U(15), 32250), [('receipt', U(5), 10750), ('issue', U(8), 17200)])
    out.append(s.done({f'PNT-20|{o1}': ('held', ['VALUE']), f'PNT-20|{o2}': ('consistent', [])},
                      {'1310': ('held', ['POSITION']), '1320': ('consistent', [])}, totals=False,
                      recipe='The yen has no decimals: 43000.5 does not read.'))

    s = Story('M34', 'A paged export repeating its headers', 'py-pad', 'py-pad')
    for item, dims, acct, o, mv in (('CEM-50', R, '1310', 900, [('receipt', 300), ('issue', 250), ('issue', 180)]),
                                    ('GYP-12', R, '1310', 400, [('receipt', 120), ('issue', 90), ('issue', 60)]),
                                    ('CEM-50', J, '1320', 300, [('receipt', 200), ('issue', 150)]),
                                    ('PIP-110', J, '1320', 210, [('receipt', 50), ('issue', 75), ('issue', 30)])):
        s.std(item, dims, acct, o, mv)
    lines = [x for x in s.items]
    s.items = lines[:8] + [('header', None)] + lines[8:16] + [('header', None)] + lines[16:]
    s.gl_repeat_after = 0
    out.append(s.done(consistent(f'CEM-50|{R}', f'GYP-12|{R}', f'CEM-50|{J}', f'PIP-110|{J}'),
                      consistent('1310', '1320'),
                      recipe='Every page repeats the column row, in both files: listed and skipped (I10).'))

    s = Story('M35', 'One GL account on two lines', 'raw', 'py')
    s.std('CEM-50', R, '1310', 300, [('receipt', 100), ('issue', 120)])
    s.std('CEM-50', J, '1320', 260, [('receipt', 90), ('issue', 110)])
    s.gl_extra.append(['1320', 0, 0, 0, 0])
    out.append(s.done(consistent(f'CEM-50|{R}', f'CEM-50|{J}'),
                      {'1310': ('consistent', []), '1320': ('held', ['GL_DUPLICATE'])},
                      recipe='The GL summary prints 1320 twice, once with zeros.'))

    s = Story('M36', 'A GL file that does not parse', 'py', 'raw')
    s.std('CEM-50', R, '1310', 300, [('receipt', 100), ('issue', 120)])
    s.std('GYP-12', J, '1320', 150, [('receipt', 45), ('issue', 60)])
    s.gl_cells['1320'] = {'GL account': '"1320'}
    out.append(s.done(consistent(f'CEM-50|{R}', f'GYP-12|{J}'),
                      {'1310': ('held', ['GL_FILE']), '1320': ('held', ['GL_FILE'])}, run=['GL_FILE'],
                      recipe='An unclosed quote in the GL summary: every account waits, the bridges do not (I10).'))

    s = Story('M37', 'A register not in UTF-8', 'cp1256', 'py')
    s.std('CEM-50', 'مستودع=الرياض', '1310', 300, [('receipt', 100), ('issue', 120)])
    out.append(s.refused('ENCODING', recipe='Saved as Windows Arabic: refused, nothing judged.'))

    s = Story('M38', 'A register without its Unit column', 'py', 'py')
    s.header = [c for c in COLUMNS if c != 'Unit']
    s.std('CEM-50', R, '1310', 300, [('receipt', 100), ('issue', 120)])
    out.append(s.refused('HEADER', recipe='Eleven columns: the register is not the contract\'s.'))

    s = Story('M39', 'A period that ends before it starts', 'node', 'node',
              run={'Period start': '2026-10-31', 'Period end': '2026-10-01'})
    s.start, s.end = '2026-10-01', '2026-10-31'
    s.std('CEM-50', R, '1310', 300, [('receipt', 100), ('issue', 120)])
    out.append(s.refused('SCOPE', recipe='The confirmed period runs backwards: refused, nothing judged.'))

    s = Story('M40', 'Arabic dimensions and Arabic-Indic digits', 'py', 'py')
    ar1, ar2 = 'مستودع=الرياض', 'مستودع=جدة'
    for ln in s.std('CEM-50', ar1, '1310', 1200, [('receipt', 400), ('issue', 520)]):
        ln['Quantity'] = ln['Quantity'].translate(ARABIC)
        ln['Value'] = ln['Value'].translate(ARABIC)
    s.std('CEM-50', ar2, '1320', 300, [('receipt', 100), ('issue', 140)])
    out.append(s.done(consistent(f'CEM-50|{ar1}', f'CEM-50|{ar2}'), consistent('1310', '1320'),
                      recipe='Arabic-Indic digits and the Arabic decimal separator read as Latin.'))

    out.append(sixty())

    s = Story('M42', 'Kinds the contract does not know', 'raw', 'py')
    s.std('GYP-12', R, '1310', 300, [('receipt', 80, {'cells': {'Kind': 'Receipt'}}), ('issue', 100)])
    s.std('GYP-12', J, '1320', 120, [('issue', 30, {'cells': {'Kind': 'transfer'}})])
    s.std('PIP-110', D, '1330', 90, [('receipt', 10), ('issue', 25)])
    out.append(s.done({f'GYP-12|{R}': ('held', ['KIND']), f'GYP-12|{J}': ('held', ['KIND']),
                       f'PIP-110|{D}': ('consistent', [])},
                      {'1310': ('held', ['POSITION']), '1320': ('held', ['POSITION']), '1330': ('consistent', [])},
                      totals=False, recipe='Receipt with a capital letter and transfer without a direction.'))

    s = Story('M43', 'Links on the wrong lines', 'py', 'py-pad')
    s.std('CEM-50', R, '1310', 400, [('receipt', 150, {'oid': 'PO-5521'}), ('issue', 200)])
    s.std('CEM-50', J, '1320', 300, [('transfer-out', 60), ('issue', 100)])
    s.std('GYP-12', D, '1330', 210, [('receipt', 30), ('issue', 85)])
    out.append(s.done({f'CEM-50|{R}': ('held', ['LINK']), f'CEM-50|{J}': ('held', ['LINK']),
                       f'GYP-12|{D}': ('consistent', [])},
                      {'1310': ('held', ['POSITION']), '1320': ('held', ['POSITION']), '1330': ('consistent', [])},
                      totals=False, recipe='A purchase order in the Origin ID of a receipt; a transfer-out without '
                                           'its Transfer ID.'))

    s = Story('M44', 'A position with no movement, and 0420 beside 420', 'node', 'py')
    s.pos('0420', R, 'pcs', '1310', (0, 0), [])
    s.pos('420', R, 'pcs', '1310', (U(10), 62400), [('issue', U(4), 24960)])
    s.std('PIP-110', J, '1320', 75, [('receipt', 25), ('issue', 40)])
    out.append(s.done(consistent(f'0420|{R}', f'420|{R}', f'PIP-110|{J}'), consistent('1310', '1320'),
                      recipe='A written zero opening and closing is a position; leading zeros are kept (I1).'))

    s = Story('M45', 'A cell beyond the twelve columns', 'py-pad', 'py')
    s.std('PNT-20', R, '1310', 60, [('receipt', 20, {'after': ['urgent delivery']}), ('issue', 30)])
    s.std('PNT-20', J, '1320', 40, [('receipt', 10), ('issue', 15)])
    out.append(s.done({f'PNT-20|{R}': ('held', ['LINE_WIDTH']), f'PNT-20|{J}': ('consistent', [])},
                      {'1310': ('held', ['POSITION']), '1320': ('consistent', [])}, totals=False,
                      recipe='A note printed in a thirteenth column.'))

    s = Story('M46', 'A GL account that cannot be read', 'py-pad', 'py')
    s.std('CEM-50', R, '1310', 300, [('receipt', 100), ('issue', 120)])
    s.std('CEM-50', J, '1320', 260, [('receipt', 90), ('issue', 110)])
    s.gl_extra.append(['#REF!', 0, 125000, 0, 125000])
    out.append(s.done(consistent(f'CEM-50|{R}', f'CEM-50|{J}'),
                      {'1310': ('held', ['GL_UNREADABLE']), '1320': ('held', ['GL_UNREADABLE'])},
                      unplaced=[['gl', '#REF!', 'GL_UNREADABLE']], run=['GL_UNREADABLE'],
                      recipe='A GL line whose account is an Excel error could be any account\'s.'))

    s = Story('M47', 'A GL amount with a thousands separator and a wide GL line', 'node', 'node')
    s.std('CEM-50', R, '1310', 900, [('receipt', 700), ('issue', 300)])
    s.std('CEM-50', J, '1320', 260, [('receipt', 90), ('issue', 110)])
    s.std('GYP-12', D, '1330', 150, [('receipt', 50), ('issue', 40)])
    s.gl_cells['1310'] = {'Debit': '12,950.00'}
    s.gl_cells['1320'] = {'after': ['checked']}
    out.append(s.done(consistent(f'CEM-50|{R}', f'CEM-50|{J}', f'GYP-12|{D}'),
                      {'1310': ('held', ['GL_AMOUNT']), '1320': ('held', ['GL_WIDTH']), '1330': ('consistent', [])},
                      recipe='12,950.00 has a thousands separator; a reviewer\'s mark sits in a sixth column.'))
    return out


def sixty():
    """Fifteen items in four warehouses, each warehouse its own account. Two
    to six movements each, five transfers between warehouses, two returns to
    the supplier, a receipt from September posted in October, and one closing
    value one halala off. The lines are shuffled as a report sorted by date
    prints them."""
    rng = random.Random(4141)
    s = Story('M41', 'Sixty positions across four accounts', 'py', 'node')
    whs = [('wh=RIY-1', '1310'), ('wh=JED-2', '1320'), ('wh=DMM-3', '1330'), ('wh=MED-4', '1340')]
    items = [(f'SKU-{1001 + i}', rng.choice(['pcs', 'bag', 'm', 'can']), rng.randrange(500, 9000)) for i in range(15)]
    transfers = {}
    for t in range(5):
        i = rng.randrange(15)
        a, b = rng.sample(range(4), 2)
        transfers.setdefault((i, a), []).append(('transfer-out', t))
        transfers.setdefault((i, b), []).append(('transfer-in', t))
    want = {}
    dated = []
    for i, (item, unit, c) in enumerate(items):
        for w, (dims, acct) in enumerate(whs):
            q0 = U(rng.randrange(300, 900))
            moves = [('receipt', U(rng.randrange(10, 300)), None)]
            for _ in range(rng.randrange(1, 5)):
                moves.append((rng.choice(['issue', 'issue', 'receipt', 'adjustment-in', 'adjustment-out']),
                              U(rng.randrange(1, 40)), None))
            for kind, t in transfers.get((i, w), []):
                moves.append((kind, U(25 + t), None, {'tid': f'TR-41{t:02d}'}))
            if (i, w) == (3, 1):
                moves.append(('receipt', U(70), None, {'md': '2026-09-28', 'pd': '2026-10-01'}))
            costed = [(m[0], m[1], m[1] * c // 1000, *(m[3:])) for m in moves]
            delta = (0, 1) if (i, w) == (11, 2) else (0, 0)
            lines = s.pos(item, dims, unit, acct, (q0, q0 * c // 1000), costed, cdelta=delta)
            if (i, w) == (3, 1):
                dated.append(lines[-2]['Movement ID'])
            if (i, w) in ((5, 0), (9, 3)):
                rec = lines[1]
                ret = s.line(item, dims, 'return-out', U(5), 5 * c, unit, acct, oid=rec['Movement ID'])
                cl = lines[-1]
                s.items.remove(('line', cl))
                s.lines.remove(cl)
                s.line(item, dims, 'closing', cl['q'] - U(5), cl['v'] - 5 * c, unit, acct)
            key = f'{item}|{dims}'
            want[key] = ('inconsistent', ['VALUE_BRIDGE']) if delta != (0, 0) else ('consistent', [])
    s.shuffle(4242)
    accounts = {acct: ('consistent', []) for _, acct in whs}
    accounts['1330'] = ('held', ['POSITION'])
    return s.done(want, accounts, dated=dated,
                  recipe='Volume within the structure: one closing a halala off holds its account only.')


def main():
    out = []
    for s in stories():
        f = s.file()
        out.append({'id': s.id, 'title': s.title, 'recipe': s.recipe, 'runScope': s.run, 'intent': s.intent,
                    'files': f})
    sys.stdout.write(json.dumps({'schema': 'tarasuf-inv2-movement-bridge-stories/1', 'stories': out},
                                ensure_ascii=False, indent=1) + '\n')


if __name__ == '__main__':
    main()
