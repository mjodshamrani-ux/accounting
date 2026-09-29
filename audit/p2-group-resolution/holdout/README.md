# First execution of the P2 synthetic holdout

This set was authored independently during implementation without reading the
candidate code or its new unit fixtures. Its inputs, literal oracle and runner
were frozen before any execution; individual cases were withheld from the
implementer until candidate freeze. It is synthetic evidence with explicit
mappings, not field validation or unaided import/UI completion.

The first execution is preserved in `candidate-9bf8775.json`, against immutable
commit `9bf8775416852cd4a691023647d06473c094eb69`, engine
`0.3.19-experimental`. All 56 library files matched that commit before and after
execution. This set is now consumed; any later run is regression evidence.

| Measure | First candidate |
| --- | ---: |
| Complete contracts passed | 8 / 10 |
| Required automatic member sets satisfied | 4 / 7 |
| Forbidden automatic member sets approved | 0 |
| Production operation exceptions | 0 |

Two positive contracts failed, with three required member sets missed:

- P2H02: receipt `000840` requires supplier rows 2,3 against ledger rows 2,3,4
  for -100; separate receipt `00840` requires supplier rows 4,5 against ledger
  row 5 for -30. Neither whole group was approved.
- P2H04: selected Arabic Reference `شرق`, Document No `INV-774` and shared PO
  `PO-EAST` require supplier rows 2,3 against ledger row 3 for 310 + 490 = 800.
  This group was missed. The separate `غرب` 260 ordinary pair passed.

The different-primary-fields receipt case P2H01 passed. P2H03's two invoice
groups, with distinct selected references `057` and `57` and shared group
vouchers, passed. All six negative contracts passed, covering overlapping
identities with unknown/excluded competitors, an unknown group member,
conflicting PO, an unsafe chosen-reference sibling and a duplicate posting.
The positive misses are capability gaps, not successful review outcomes.

Frozen manifest SHA256:
`c9264375293d7c7080d971b6d3f19c15fed7a844b198784568d6a2b8d95c186d`.
Original result SHA256:
`293697137ca146a823eed52d32ba46a69d85ba4a7acc173fd3ac7e8f41919c0e`.
`candidate-9bf8775.provenance.json` contains the remaining frozen hashes and
complete library digest map. Reproduction instructions are in `frozen/README.md`.
Use a new output path and preserve all original bytes and outcomes.

## Second P2 candidate regression

`candidate-42d47ec.json` records one regression run against immutable commit
`42d47ece8a962aa4449b65677b148eb75adeb0c2`: **10/10 contracts and 7/7 required
member sets passed**, with zero false approved groups, zero falsely automatically
consumed source rows and zero operation exceptions. All 56 library files matched
the commit before and after. The original P2H02/P2H04 misses now pass; their first
failed results remain unchanged. This execution is regression evidence from the
consumed set, not a second fresh holdout result.

Result SHA256:
`201d3bca30ec8030677399eb00c50d40c299c87283402ade33670141765bd83e`.
Full provenance is in `candidate-42d47ec.provenance.json`.
