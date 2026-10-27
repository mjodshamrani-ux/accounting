"""The MAP-1 oracle agrees with every hand-written intent, reads neither the
recipe nor the intent, settles a mapped cashbook as the sealed ROLL-1 oracle
settles its declared twin, reads a twin as the bank statement foundation's
own cashbook reader reads it, compares labels in their normal form and
nothing looser, and checks a map file as JavaScript reads it.

  python3 -B -m unittest discover -s audit/bank-map-foundation -p test_oracle.py -v
ORACLE=<path> runs the same tests on another copy of oracle.py (mutate_oracle.py).
"""
import copy
import csv
import importlib.util
import io
import json
import os
import re
import unicodedata
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
FROZEN = HERE / 'frozen'
AUDIT = HERE.parent


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


oracle = load('map_oracle', os.environ.get('ORACLE', HERE / 'oracle.py'))
roll = load('map_test_roll', AUDIT / 'bank-roll-foundation' / 'oracle.py')
FACTS = json.loads((FROZEN / 'stories.json').read_text(encoding='utf-8'))
WINDOW = json.loads((roll.BANK / 'contract.json').read_text())['matching']['dateWindowDays']


def judged(story):
    return oracle.judge(copy.deepcopy(story), FROZEN, WINDOW)


def twin_period(action):
    """The period as the sealed ROLL-1 oracle settles the declared twin."""
    source = AUDIT / action['source'] / 'frozen'
    cash = (source / f"{action['period']}-cashbook.csv").read_bytes()
    statement = (source / f"{action['period']}-statement.pdf").read_bytes()
    facts = json.loads((source / 'stories.json').read_text(encoding='utf-8'))
    period = next(p for s in facts['stories'] for p in s['periods'] if p['id'] == action['period'])
    r = roll.period_result(period, cash, roll.sha(statement), roll.sha(cash), [], WINDOW)
    return {'held': r['held'],
            'cases': [{k: c[k] for k in ('id', 'kind', 'reason', 'statement', 'cashbook', 'status')} for c in r['cases']],
            'outstanding': [list(o) for o in r['outstanding']]}


def problems_of(fit):
    out = []
    for p in fit['problems']:
        out.append(p['kind'] if p['kind'] != 'column' else (p['role'], p['found'], p['elsewhere']))
    return out


def disagreements(story, outcomes):
    """Where the judged story differs from its intent, action by action."""
    out = []
    assert len(outcomes) == len(story['intent']) == len(story['actions'])
    for k, (action, intent, got) in enumerate(zip(story['actions'], story['intent'], outcomes)):
        where = f"{story['id']}#{k + 1}"
        if 'store' in intent and got['store'] != sorted(intent['store']):
            out.append(f'{where} store')
        if action['do'] == 'import':
            if got['accepted'] != intent['accepted'] or got.get('code') != intent.get('code'):
                out.append(f'{where} import')
            continue
        if action['do'] == 'export':
            expected = json.loads((FROZEN / intent['equals']).read_text(encoding='utf-8'))
            if got['map'] != expected:
                out.append(f'{where} export')
            continue
        if 'invalid' in intent:
            if got.get('invalid') != intent['invalid'] or 'reading' in got:
                out.append(f'{where} invalid')
            continue
        if 'fits' in intent:
            fit = got.get('fit')
            if fit is None or fit['fits'] != intent['fits']:
                out.append(f'{where} fits')
                continue
            if not intent['fits']:
                want = intent['problems']
                have = problems_of(fit)
                if want and isinstance(want[0], (list, tuple)):
                    if [tuple(p) if isinstance(p, tuple) else p for p in have] != \
                            [(p[0], p[1], list(p[2])) for p in want]:
                        out.append(f'{where} problems')
                elif [p if isinstance(p, str) else p[0] for p in have] != want:
                    out.append(f'{where} problems')
                if 'reading' in got:
                    out.append(f'{where} read a misfit')
                continue
        reading = got.get('reading')
        if reading is None:
            out.append(f'{where} not read')
            continue
        refused = reading['refused'] and (reading['refused']['code'], reading['refused']['row'])
        if refused != (tuple(intent['refused']) if intent.get('refused') else None):
            out.append(f'{where} refused')
            continue
        if 'above' in intent and reading['above'] != intent['above']:
            out.append(f'{where} above')
        if 'unread' in intent and [u['label'] for u in reading['unread']] != intent['unread']:
            out.append(f'{where} unread')
        if refused:
            if 'period' in got:
                out.append(f'{where} settled a refused reading')
            continue
        cases = intent.get('cases')
        if cases == 'twin':
            if got['period'] != twin_period(action):
                out.append(f'{where} not the twin period')
        elif cases is not None:
            review = {}
            for c in got['period']['cases']:
                if c['kind'] != 'automatic':
                    review[c['reason']] = review.get(c['reason'], 0) + 1
            automatic = sum(c['kind'] == 'automatic' for c in got['period']['cases'])
            if automatic != cases['automatic'] or review != cases['review']:
                out.append(f'{where} cases')
    return out


class Intent(unittest.TestCase):
    def test_every_story_agrees_with_its_intent(self):
        found = {}
        for story in FACTS['stories']:
            # Each story is judged alone: an oracle that cannot judge one
            # fails this assertion with that story named.
            try:
                d = disagreements(story, judged(story))
            except Exception as e:  # noqa: BLE001
                d = [f"{story['id']} {type(e).__name__}"]
            if d:
                found[story['id']] = d
        self.assertEqual(found, {})

    def test_the_oracle_reads_neither_recipe_nor_intent(self):
        for story in FACTS['stories']:
            bare = {k: v for k, v in story.items() if k not in ('recipe', 'intent')}
            self.assertEqual(oracle.judge(bare, FROZEN, WINDOW), judged(story), story['id'])

    def test_the_oracle_imports_neither_the_generator_nor_the_product(self):
        text = Path(oracle.__file__).read_text(encoding='utf-8')
        loaded = re.findall(r"load\('[^']+', ([^)]+)\)", text)
        self.assertEqual(loaded, ["ELIGIBILITY / 'cashbook.py'", "ROLL / 'oracle.py'"])
        self.assertIsNone(re.search(r'^\s*(import|from)\s+(stories|subprocess)\b', text, re.M))

    def test_every_misfit_and_refusal_reads_and_settles_nothing(self):
        for story in FACTS['stories']:
            for got in judged(story):
                if got.get('fit') and not got['fit']['fits'] or 'invalid' in got:
                    self.assertNotIn('reading', got, story['id'])
                if got.get('reading') and got['reading']['refused']:
                    self.assertEqual(got['reading']['entries'], [], story['id'])
                    self.assertNotIn('period', got, story['id'])


class Twins(unittest.TestCase):
    """The declared reading of every twin the stories use is the bank
    statement foundation's own cashbook reading."""

    def test_declared_reading_of_each_twin(self):
        seen = set()
        for story in FACTS['stories']:
            for action in story['actions']:
                if 'period' not in action or action['period'] in seen:
                    continue
                seen.add(action['period'])
                path = AUDIT / action['source'] / 'frozen' / f"{action['period']}-cashbook.csv"
                mine = oracle.declared_reading(oracle.read_table(path), 2)
                theirs = roll.bank.cashbook(list(csv.reader(io.StringIO(path.read_bytes().decode('utf-8')))))
                self.assertIsNone(mine['refused'], path.name)
                self.assertEqual([(e['voucher'], e['date'], e['reference'], e['direction'], e['amount'])
                                  for e in mine['entries']],
                                 [(e['voucher'], e['date'], e['reference'], e['direction'], roll.cents(e['amount']))
                                  for e in theirs], path.name)
        self.assertGreaterEqual(len(seen), 20)

    def test_a_mapped_reading_has_the_twin_entries(self):
        """Every cashbook read whole holds its twin's entries, with references
        only where its map reads a reference column."""
        for story in FACTS['stories']:
            for action, got in zip(story['actions'], judged(story)):
                reading = got.get('reading')
                if not reading or reading['refused'] or action.get('twin'):
                    continue
                path = AUDIT / action['source'] / 'frozen' / f"{action['period']}-cashbook.csv"
                twin = oracle.declared_reading(oracle.read_table(path), 2)['entries']
                strip = action['by'] == 'hand' and action['columns']['reference'] is None
                self.assertEqual([(e['voucher'], e['date'], e['description'], '' if strip else e['reference'],
                                   e['direction'], e['amount']) for e in twin],
                                 [(e['voucher'], e['date'], e['description'], e['reference'], e['direction'],
                                   e['amount']) for e in reading['entries']], f"{story['id']} {action['file']}")


class Labels(unittest.TestCase):
    def test_normal_form(self):
        self.assertEqual(oracle.normal(' Voucher \t No　'), 'Voucher No')
        self.assertEqual(oracle.normal(unicodedata.normalize('NFD', 'الإيضاح')), 'الإيضاح')
        self.assertNotEqual(oracle.normal('المرجـع'), 'المرجع')
        self.assertNotEqual(oracle.normal('CREDIT'), 'Credit')
        self.assertNotEqual(oracle.normal('Ref.'), 'Ref')
        # Only JavaScript's white space: a zero-width space is not one.
        self.assertEqual(oracle.normal('Ref​'), 'Ref​')

    def test_a_map_fits_by_position_and_label_only(self):
        table = oracle.read_table(FROZEN / 'M02-AUG-cashbook.xlsx')
        m = json.loads(json.dumps(oracle.by_hand(table, 4, {
            'date': 2, 'voucher': 1, 'description': 5, 'reference': 3, 'receipts': 6, 'payments': 7}, 'x')))
        self.assertEqual(oracle.fit(table, m), [])
        m['columns']['reference'] = {'column': 4, 'label': 'Reference'}
        self.assertEqual([p['role'] for p in oracle.fit(table, m)], ['reference'])
        m['header'] = 5
        self.assertEqual({p['role'] for p in oracle.fit(table, m)},
                         {'date', 'voucher', 'description', 'reference', 'receipts', 'payments'})


class MapFiles(unittest.TestCase):
    VALID = (FROZEN / 'M18-map.json').read_bytes()

    def code(self, data):
        try:
            oracle.parse_map(data)
            return None
        except oracle.MapRefused as e:
            return e.code

    def edit(self, f):
        m = json.loads(self.VALID)
        f(m)
        return json.dumps(m, ensure_ascii=False).encode('utf-8')

    def test_as_javascript_reads_json(self):
        self.assertIsNone(self.code(self.VALID))
        self.assertIsNone(self.code('﻿'.encode('utf-8') + self.VALID))
        self.assertIsNone(self.code(self.VALID.replace(b'"header": 1', b'"header": 1.0')))
        self.assertEqual(self.code(self.VALID.replace(b'"header": 1', b'"header": Infinity')), 'MAP_JSON')
        self.assertEqual(self.code(self.edit(lambda m: m.update(version=True))), 'MAP_FORMAT')
        self.assertEqual(self.code(self.edit(lambda m: m.update(header=True))), 'MAP_HEADER')
        self.assertEqual(self.code(self.edit(lambda m: m['columns']['date'].update(column='1'))), 'MAP_COLUMN')

    def test_the_first_failing_rule_names_the_code(self):
        self.assertEqual(self.code(self.edit(lambda m: m.update(format='x', currency='SAR'))), 'MAP_FORMAT')
        self.assertEqual(self.code(self.edit(lambda m: m.update(name='', header=0))), 'MAP_NAME')
        self.assertEqual(self.code(self.edit(lambda m: m.update(header=0, columns={**m['columns'], 'date': None}))),
                         'MAP_HEADER')
        self.assertEqual(self.code(self.edit(lambda m: m['columns'].update(date=None, reference=None))), 'MAP_COLUMN')

    def test_limits(self):
        self.assertIsNone(self.code(self.edit(lambda m: m.update(name='n' * 80))))
        self.assertEqual(self.code(self.edit(lambda m: m.update(name='n' * 81))), 'MAP_NAME')
        self.assertIsNone(self.code(self.edit(lambda m: m.update(header=30))))
        self.assertIsNone(self.code(self.edit(lambda m: m['columns']['payments'].update(column=100))))
        self.assertIsNone(self.code(self.edit(lambda m: m['columns']['reference'].update(label='r' * 120))))
        self.assertEqual(self.code(self.edit(lambda m: m['columns']['reference'].update(label='r' * 121))), 'MAP_LABEL')
        # 60 characters outside the basic plane are 120 UTF-16 code units.
        self.assertIsNone(self.code(self.edit(lambda m: m['columns']['reference'].update(label='\U0001d400' * 60))))
        self.assertEqual(self.code(self.edit(lambda m: m['columns']['reference'].update(label='\U0001d400' * 61))),
                         'MAP_LABEL')
        self.assertIsNone(self.code(self.edit(lambda m: m['columns'].update(description=None, reference=None))))


if __name__ == '__main__':
    unittest.main()
