"""What a reader can prove from each AI-1a statement and ledger: the oracle.

Derived from the story facts alone (stories.py), never from the product:

- movements: every statement line that moves the balance, as (date,
  document number, signed minor units); a line in another currency is
  listed apart, since it is not an amount in riyals;
- pairs: a statement document and a ledger posting that share the document
  number, the amount and the currency, within two days, where the number
  appears once on each side. Such a pair is the same document by its own
  number; nothing else in these files proves a pair;
- approve: the pairs a positive story requires approved; a reserved story
  requires none, but allows its pairs (allow);
- every approval outside approve and allow is a wrong approval: a number
  that appears twice, a near number, another amount or another currency
  proves nothing;
- balances: the opening and closing balances the statement prints;
- roles: for each column role a reconciliation reads, the heading printed
  over the column that holds it (roles.py), and whether the headings let a
  reader decide it: in K5 they do not, and the right answer is to abstain;
- headings: every heading the table prints, in reading order, and the
  headings that hold no role.

Copied from the S3 holdout; roles and headings are AI-1a's.

    python3 -B expected.py > expected.json
"""
import json
from collections import Counter
from datetime import date

from roles import DECIDABLE, ROLE_OF_KEY, roles
from stories import STORIES

WINDOW = 2


def lines_of(story):
    return [line for page in story['pages'] for line in page]


def pairs_of(story):
    lines = lines_of(story)
    on_statement = Counter(line['ref'] for line in lines)
    in_ledger = Counter(e['ref'] for e in story['ledger'])
    out = []
    for line in lines:
        if line.get('currency', 'SAR') != 'SAR' or on_statement[line['ref']] != 1 or in_ledger[line['ref']] != 1:
            continue
        e = next(e for e in story['ledger'] if e['ref'] == line['ref'])
        days = abs((date.fromisoformat(e['date']) - date.fromisoformat(line['date'])).days)
        if e['minor'] == line['minor'] and days <= WINDOW:
            out.append([line['ref'], e['ref']])
    return out


def expected(story):
    lines = lines_of(story)
    pairs = pairs_of(story)
    positive = story['kind'] == 'positive'
    return {
        'id': story['id'],
        'kind': story['kind'],
        'contract': story['contract'],
        'class': story['class'],
        'language': story['language'],
        'producer': story['producer'],
        'headings': [h for _, h in story['columns']],
        'roles': roles(story),
        'noRole': [h for k, h in story['columns'] if k not in ROLE_OF_KEY],
        'decidable': story['class'] in DECIDABLE,
        'intent': story['intent'],
        'movements': [[line['date'], line['ref'], line['minor']] for line in lines
                      if line.get('currency', 'SAR') == 'SAR'],
        'otherCurrency': [[line['date'], line['ref'], line['minor'], line['currency']] for line in lines
                          if line.get('currency', 'SAR') != 'SAR'],
        'ledger': [[e['date'], e['ref'], e['minor']] for e in story['ledger']],
        'approve': pairs if positive else [],
        'allow': [] if positive else pairs,
        'balances': {'opening': story['opening'], 'closing': story['closing'], 'currency': 'SAR'},
        'scope': {'supplier': story['supplier'], 'entity': story['customer'], 'account': story['account'],
                  'currency': story['currency'], 'decimals': 2, 'cutoff': story['period']['end'],
                  'periodStart': story['period']['start'], 'dateWindow': WINDOW},
    }


if __name__ == '__main__':
    print(json.dumps({'version': 'tarasuf-ai1-columns-oracle-1', 'stories': [expected(s) for s in STORIES]},
                     ensure_ascii=False, indent=1))
