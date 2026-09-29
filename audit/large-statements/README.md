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

## Candidate 920ace2: seven contracts passed

`candidate-920ace2.json` preserves one execution against immutable commit
`920ace2b2dbf337e75700554606eadaa1a01162e`, engine `0.3.20-experimental`.
All 57 library files exactly matched that commit before and after execution.
The frozen artifacts and earlier baseline remain unchanged.

| Contract | Observed outcome |
| --- | --- |
| Native 70 pages | 2,240/2,240 exact required pairs; 2,450 extracted rows, 210 documented exclusions; last movement on page70 retained |
| Native 100 pages | 2,800/2,800 exact required pairs; 3,100 extracted rows, 300 documented exclusions; last movement on page100 retained; save/restore/export passed |
| Page101 boundary | Whole source rejected with the explicit 100-page limit |
| Empty page70 | Whole source rejected with structured page70/70 diagnosis and `inspectedAllPages:false` |
| Covered text on page70 | Whole source rejected with page70 identified |
| Geometry drift on page100 | All 28 affected monetary rows remain visible with read errors; input-readiness refusal; zero automatic matches |
| Broken operator stream on page100 | Whole source rejected as `PdfOperatorStreamError`, retaining page100 and the original cause |

There were no missing required pairs or false automatic matches in these
contracts. The exact signed transaction totals are 40,779,520 and 50,974,400
minor units respectively. This does not reinterpret page totals or carried
balances as transactions, or claim that the full economic period is complete.

### Observational timing

One Apple M5 Node-process run, with the frozen synthetic PDF/CSV inputs and
explicit column boundaries/mappings:

| Operation | 70-page case | 100-page case |
| --- | ---: | ---: |
| PDF read | 169 ms | 374 ms |
| Normalize and compare | 123 ms | 338 ms |
| Save and restore, including original-source re-reads | Not requested | 1,861 ms |
| Workbook export, including original-source re-read | Not requested | 3,597 ms |
| Full contract, including independent expected-value assertions | 306 ms | 8,169 ms |

Workbook verification in this contract reopens the export through ExcelJS; it
checks every required source row, reference, signed amount and PDF page against
the literal oracle. It is not a separate OpenXML-parser verification.

The cumulative process peak across all seven sequential contracts was
620.8 MiB, including session/export and reopening the workbook for verification.
This is not the PDF reader's isolated peak or a per-case memory bound. These
PDFs are approximately 0.48 and 0.61 MB with 32 and 28 movements per page;
they do not benchmark the maximum text/operator density or the 8 MiB limit.
UI rendering, user review, cancellation and browser lifecycle are separate
checks. No performance improvement or cross-device SLA is inferred.

Result SHA256:
`b734bc6c4718b4befde16ac45435490cef56056fbff00aeddc2e7847109220fa`.
Full commit/tree, library, result and frozen input provenance is in
`candidate-920ace2.provenance.json`.

Performance numbers in later reports separate read, normalization/comparison,
session roundtrip and export. Process peak RSS is cumulative across the run,
not an isolated case peak. Rendering the UI, user review time and unrelated
background workload are outside this Node timing measurement.

No application or reconciliation-engine files are owned by this audit. Keep all
candidate outcomes and frozen bytes intact, including any failures.
