# Large native statement acceptance evidence

This is independently authored synthetic development evidence for a bounded
increase to 100 native-PDF pages. It is not field validation, unaided document
inference, bank-fee interpretation or an assurance for every 100-page PDF.

The frozen corpus contains seven contracts: 70/100-page required positive
statements and five distinct boundary/late-page failures. The literal oracles
require 2,240 and 2,800 exact positive pairs, signed money and full page/row
provenance. The 100-page contract includes session save/restore and workbook
export. Original source data and summaries remain accounted for. Full contract
details and the reproduction command are in `frozen/README.md`.

## Preserved baseline

`baseline-dec739e.json` was executed once against a `git archive` of
`dec739e5a039bb810cf51c083eefc62906de29a5`. All 56 library files exactly
matched that commit and were unchanged. None of the seven new contracts passed:
every read stopped at the old 20-page limit. That is an explicit unsupported
input refusal, not an accepted partial source or evidence that late-page errors
were inspected. The original failures are preserved.

Manifest SHA256:
`97b9454ad63b2f26b64d742b90072230b7da3f36b6bb197aa0e5da1b2ec4c7a2`.
Full baseline hashes are in `baseline-dec739e.provenance.json`.

Performance numbers in later reports separate read, normalization/comparison,
session roundtrip and export. Process peak RSS is cumulative across the run,
not an isolated case peak. Rendering the UI, user review time and unrelated
background workload are outside this Node timing measurement.

No application or reconciliation-engine files are owned by this audit. Keep all
candidate outcomes and frozen bytes intact, including any failures.
