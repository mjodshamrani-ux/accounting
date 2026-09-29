# Partial reconciliation: independent development evidence

The frozen corpus contains sixteen bounded synthetic contracts with **14 exact
positive pairs and one complete 2:2 payment group** required. Full literal sources,
expected members, policy, provenance and reproduction are in `frozen/README.md`.
This is synthetic development evidence. PR08/PR09 explicitly reuse known source
integrity hazards as regression controls; the other fixtures are newly authored.

Freeze time: 2026-09-29T12:14:33.536578Z, before any candidate execution.
No upcoming engine implementation or new unit fixtures were inspected during
authoring. This is not a claim that all implementation edits began after freeze.

Manifest SHA-256:
`0b10b982659d984e9298082c0a76bb183fcd6d30abb8c34a5be520fed9a57e7e`.
Contracts SHA-256:
`bfd08fb1c316666b65fd5be45888233c44af67200bb91b11366723b3b0a5d956`.
Runner SHA-256:
`4bf5a897a7d35fc8f92d405a3b97e0aa9cbb01035658227a6aa1942c1695d593`.

## Preserved baseline b9917ce

`baseline-b9917ce.json` records one contract execution against an immutable
`git archive` of `b9917ce16040d082ef4e437cfb3689bab5074978`, engine0.3.20.
All57 library files matched the commit before and after, with frozen inputs unchanged.

- 4/16 contracts passed: the three expected source/format refusals (PR08, PR09,
  PR16), plus PR13's unaffected pair beside an excluded payment competitor.
- 1/14 required exact pairs completed; 0/1 required whole payment groups completed.
- Zero observed false automatic approvals.
- Twelve other contracts threw unexpected production operation exceptions,
  preventing their required partial results. No required completion is credited
  for a safe refusal. PR01 could not reach its session/export phase.

The preceding archive-setup attempt failed because the local Python version
does not support `tarfile.extractall(filter=...)`. The runner then stopped at
missing-library startup before any engine import or contract execution. Recovery
used system tar on the still-empty archive directory; the setup issue is recorded
separately in `baseline-b9917ce.provenance.json` and is not counted as an engine run.

Retain all failed results, exact frozen bytes, and before/after hashes. Do not
revise required financial pairs or classifications after seeing an output. Any
necessary evaluator correction must be separately versioned with its reason and
the original outcome preserved.

## Candidate results: original expectations unchanged

| Immutable engine snapshot | Contracts | Required exact pairs | Required whole groups | False automatic sets | Unexpected operation exceptions |
| --- | ---: | ---: | ---: | ---: | ---: |
| b9917ce baseline | 4/16 | 1/14 | 0/1 | 0 | 12 |
| b4e8467 first candidate | 15/16 | 12/14 | 1/1 | 0 | 0 |
| 84d4bdd second candidate | 16/16 | 14/14 | 1/1 | 0 | 0 |

The first candidate's only failed contract was PR01. The original amount
`12x.34` was retained as invalid, but a conservative letters-plus-digits guard
treated its influence as unknown and withheld both required disjoint pairs.
Its session/restore/export operations completed and preserved that same missed
completion; it was not a pass. The original result is
`candidate-b4e8467.json`, with source provenance alongside it.

`candidate-84d4bdd.json` records the second immutable candidate against the
**same known contracts**, with no fixture, financial expectation or frozen
runner changes. It is regression/development evidence, not a fresh holdout.
All59 library files exactly matched their respective commits before and after
each run. The source-level format, unsafe-extraction and page-read refusals
remain required; 16/16 does not mean sixteen fully reconciled statements.

## Independent OpenXML and recorded review

`export_partial.mjs` captures PR01 separately on each frozen engine with reviewer
confirmation, period coverage confirmation, opening balances0 and closing
balances85.50/97.84. These manually supplied values equal the literal readable
subtotals; they must not turn the unread original supplier amount into complete
balance evidence. No original CSV or frozen contract is changed by this
supplemental review variant.

The Python standard-library checker imports neither engine code nor ExcelJS.
It verifies original cells, five readable source rows, the one invalid row and
its raw `12x.34` text/reason/provenance, exact pair membership, original source
hashes, processed-only totals, recorded review, and incomplete balance status.
Reading Issues expresses identity through Side/Source File/Source Sheet/Source
Row; the checker reconstructs the literal contract ID for the selected CSV
sheet0. It does not claim the workbook contains a dedicated opaque-ID column.

- `openxml-b4e8467-reviewed-v2.json` preserves a financial **failure**: zero of
  two required pairs. Source/error preservation and the partial-summary review
  checks passed, without turning the overall outcome into success.
- `openxml-84d4bdd-reviewed.json` **passed** using the same checker bytes:
  both original required pairs, four matched members, five readable rows and
  the invalid row preserved. Readable subtotals are8550/9784 minor units.
  Despite review/coverage confirmation and supplied balances, the report says
  Partial, the bridge remains incomplete, residual is empty and sign-off does
  not declare approval.

The first schema attempt assumed Reading Issues had a Source Row ID column.
That original checker is preserved as `check_openxml.schema-draft.py`; its
failed output and every intermediate adapter result remain. Schema adapters
were corrected for the separate source-trace columns, recorded-review wording,
and generated Summary counter caches. Original/evidence cells still cannot
contain formulas. Cached counters are compared to directly inspected worksheet
membership; Excel formulas are not executed or recalculated. Named status and
processed-total fields are asserted explicitly. No positive pair or monetary
expectation was relaxed. See `openxml-schema-adapter-history.json` for hashes,
attempts, and exact correction scope.

The checker also accepts the separately pinned browser original and isolated
oracles under `../partial-input/browser/`. They have distinct contract IDs and
retain their own required pairs; a pass on plain `unread` cannot rewrite a miss
on the original `unread-1`..`unread-13` input.

Both browser contracts passed independent OpenXML verification separately on
84d4bdd and again on the final UI build c1cd9d7 (unchanged engine library):
`../partial-input/browser/openxml-c1cd9d7-original.json` and
`../partial-input/browser/openxml-c1cd9d7-isolated.json`. Each preserves all13
invalid rows, four valid rows and two exact pairs, with35000 minor units per
side and a partial/non-approved result after review. The original numeric-suffix
contract therefore meets its original completion expectation on the corrected
engine; its prior failed observation remains preserved separately.
