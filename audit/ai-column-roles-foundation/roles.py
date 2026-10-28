"""Which printed columns a supplier reconciliation reads, by key.

The product's mapping names seven column roles. A story column whose key is
not here (type, due, balance, qty, order, vat) is printed for the reader but
holds no role: proposing any role for it is wrong. Nothing is imported from
the product; the field names are the mapping's own, written out.
"""
FIELDS = ('date', 'reference', 'description', 'amount', 'debit', 'credit', 'currencyColumn')
ROLE_OF_KEY = {'date': 'date', 'ref': 'reference', 'desc': 'description', 'amount': 'amount',
               'debit': 'debit', 'credit': 'credit', 'currency': 'currencyColumn'}
# The roles a comparison cannot start without: a date, and an amount or a
# debit and credit pair. A reference is what pairs documents here.
REQUIRED = ('date', 'reference')
DECIDABLE = ('K0', 'K1', 'K2', 'K3', 'K4')


def roles(story):
    """{field: heading} for every role the story's columns hold."""
    out = {}
    for key, heading in story['columns']:
        field = ROLE_OF_KEY.get(key)
        if field:
            if field in out:
                raise ValueError(f"{story['id']}: two columns hold {field}")
            out[field] = heading
    return out
