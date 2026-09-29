# Explicit P2 evaluator capability

The initial P2 unit run failed on G046-016 because the historical 046 group
oracle classifies every N:M group as out of scope before inspecting its fields.
The unchanged failure is retained in `original-unit-first.log`, and a focused
reproduction with the original spec is in
`original-G046-016-legacy-evaluation.json`. Its FALSE_MATCH and EXPORT_VALIDATION
failures remain recorded; they have not been relabelled as a historical pass.

G046-016 visibly states Payment, SAR, AP-482, 2026-07-15 and bank identity
BNK-480208 on every member. Supplier amounts are -111.01 and -325.94; ledger
amounts are -146.95, -170.00 and -120.00. Both complete signed totals are -436.95.
The components have distinct amounts within each side, and no other row carries
the identity. These facts support equivalence of the complete payment groups.
They do not establish individual row pairings or payment-to-invoice allocation.
Hidden economic-event IDs are not part of this proof.

`explicit-payment-whole-groups-p2-v1` is an explicit opt-in group-oracle
capability, supplied as `groupCapability` to `generateFocusedCase`, or
`capability` to `classifyVisibleGroup`. Omitting it preserves the original 046
spec and expectations exactly. Unknown capability names throw. Invoice N:M
remains out of scope. This bounded oracle requires one valid event date,
distinct component amounts per side, signed scope consistency, complete visible
bank/receipt evidence and no overlapping competing membership. It is not a
general oracle for every group supported by the production engine.

The existing 20 development fixtures now run with this explicit option: nine
required groups instead of eight, with all previous negative expectations
retained. The new tests separately require the legacy G046-016 rejection,
unchanged source facts, P2 completion, rejection of unsupported variations, and
failure when the engine abstains from the newly required group. The evaluator
and independent workbook verifier themselves were not changed.

`migration-summary.json` records the original and migrated outcomes, unchanged
default-spec/source checks, and artifact hashes. `targeted-tests.log` records
10 passing targeted tests. These are known development/regression fixtures,
not a fresh independent test or a completed release gate. The engine was an
unfrozen P2 working candidate based on main 302c834 when these records were
captured; release validation remains separate. No archived historical result
file was changed.
