# Frozen independent P2 development contracts

19 literal CSV cases, authored before P2 engine edits from its approved bounded
scope. Nine cases require **11 automatic member-set relations**, including two
ordinary 1:1 controls inside invoice scenarios. One separate case supplies an
explicit manual pair and forbids remaining automatic matches. This is a synthetic
development corpus, not an unseen final holdout or field validation.

Payment scope is complete explicit Bank Reference or Receipt No groups in 1:N,
N:1 and N:M, up to 100 members on each side. Same membership under both identity
roles corroborates; overlapping memberships remain review, including invalid
competitors and manually consumed members. No subset-sum search is expected.
Invoice scope is explicit Document No plus safe chosen Reference, existing invoice
type/date/PO or group-voucher and duplicate safeguards, limited to 1:N or N:1.

The corpus covers positive bank/receipt groups, corroboration, the 1000/400+600
versus misleading 500+500 example, inverse groups, permutation, overlapping role
buckets, manual consumption, a duplicate posting, unknown type, an excluded
member, row currency error, mixed signs, date-window violation, absent payment
identity and the inclusive 100/excess 101 boundary.

Contracts list literal source-row memberships, signed integer totals and allowed
row dispositions. Any automatic member set not explicitly required is forbidden.
N:M is whole-group equivalence; the oracle does not invent individual pairwise
allocations. Original cell values and every transaction/error/exclusion must be
preserved and visible. Each imported transaction belongs to exactly one case.

The runner calls production `readFile`, `prepareVerifiedSources` (only to resolve
opaque IDs for the authored manual pair), and `reconcileSupplierStatement` for
the production validation/normalization/comparison path. It never asks the engine
to calculate expected relations or totals. Mappings are explicit; unaided import
inference, UI, save/restore and export lifecycle require separate checks.

```sh
node --experimental-strip-types audit/p2-group-resolution/independent/frozen/run.mjs \
  --engine-root "$PWD" \
  --out /tmp/p2-development-result.json
```

The runner verifies frozen hashes, records engine library hashes before and
after, and stores results outside `frozen/`. Preserve the baseline and every failed
candidate result. Changes to requirements require a separately versioned contract,
never rewriting these outcomes. Any later independent holdout must be separately
authored and kept from implementation until candidate freeze.
