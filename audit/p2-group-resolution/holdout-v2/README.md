# Second P2 synthetic holdout: first execution

This fresh set was authored independently during candidate-2 implementation
without reading that implementation or its new unit fixtures. Literal inputs,
oracle and runner were frozen before execution; individual details were withheld
from the implementer until candidate freeze. Explicit column mappings were
supplied. This is synthetic evidence, not field validation, unaided import
accuracy or UI/accounting completion.

`candidate-42d47ec.json` preserves the first execution against immutable commit
`42d47ece8a962aa4449b65677b148eb75adeb0c2`, engine
`0.3.19-experimental`. **8/8 contracts and 6/6 required member sets passed**.
There were zero false approved groups, zero falsely automatically consumed
source rows and zero production operation exceptions. All 56 library files
exactly matched the commit before and after. This set is now consumed; later
executions can provide regression evidence only.

The required positives establish bounded behavior for:

- A complete numeric receipt group alongside an unbalanced leading-zero decoy.
- Distinct receipt strings `9007199254740993` and `9007199254740992` across
  opposite group directions and differing book-local primary fields.
- Separate chosen-reference invoice groups under one Document No and one PO,
  with different AP Voucher IDs on every row.
- An unrelated complete bank group alongside an unresolved component with
  overlapping numeric receipt and bank identities.

The negatives forbid known conflicting document types, wrong invoice parts
with shared PO but different chosen Reference or Document No, duplicate invoice
postings, and invoice parts with different dates inside the general date window.
The mixed positive/negative case also verifies that blanket review cannot pass
the acceptance contract.

Frozen manifest SHA256:
`cdd14c59253e6132843b7870f097f218ca69c93da22bf5016955757a24a59a39`.
Result SHA256:
`b5352076e87f3ff562a0694fd6de8fa992d313886a3b58aefdde3a65a6877162`.
`candidate-42d47ec.provenance.json` contains the full library digest map,
remaining frozen artifact hashes and the definition of false automatic source
row consumption. Reproduction instructions are in `frozen/README.md`.

The earlier development and first-holdout failures remain in their original
directories. Their improved results on this candidate are regressions, separate
from this fresh result. These small exact contracts support only the behavior
they assert; they do not establish general accounting accuracy.
