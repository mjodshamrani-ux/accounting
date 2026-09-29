# Frozen partial-reconciliation contracts

Sixteen bounded synthetic development contracts, independently authored from
visible source fields and the agreed isolation policy. Required completion is
**14 exact positive pairs and one complete 2:2 payment group** across the corpus.
Unknown/unsafe identity and incomplete reads must never be resolved by dropping
bad rows. Safe refusal alone does not satisfy the positive cases.

## Provenance and scope

Types, old public test conventions and the previous frozen harness API were read
at baseline `b9917ce16040d082ef4e437cfb3689bab5074978`. The upcoming engine
implementation and its new unit fixtures were not inspected. Original CSV cells,
expected member sets, signed cents, dates and row dispositions were written
independently. This is synthetic development evidence, not field validation or
an unbiased future holdout after the cases become known.

PR08 deliberately preserves the existing KWD geometry/format hazard from
`tests/input-readiness-046.test.ts`; its PDF bytes were made using the pre-existing
test PDF helper. PR09 copies the previously frozen long-PDF broken-stream source
as a source-completeness control. These two are labeled regression interactions,
not new independent layouts. All other cases are newly authored literal CSVs.
Fixture authoring was independent of implementation; no claim is made that its
freeze predates every implementation edit. The hashes predate candidate execution.

## Policy

- Invalid-under-every-format money/date rows with reliable isolated identities
  remain visible while provable disjoint pairs and whole groups complete.
- Same/colliding identity, explicit payment identities and transitive cross-role
  connectors retain their competitive effect before valid rows can be consumed.
  Manual exclusion cannot manufacture group uniqueness/completeness.
- Unknown or unsafe identity has unknown reach: return readable analysis and
  invalid rows, withhold automatic approvals, and expose the reason.
- Shared format ambiguity needs the existing bound user choice. Contradictory
  valid locales, structurally unsafe extraction, and incomplete source reads
  remain production/read gates. Never discard a competing valid interpretation
  to force a common locale or default amount scale.
- All original rows and error reasons remain accounted for. Partial work is not
  a verified source total, complete period or verified balance bridge.

PR15 checks the unresolved date gate first, then records a literal DMY choice and
requires the correct unaffected pair. Repeated local IDs in PR14 are business
text, not generated source IDs; required pairs preserve distinct leading zeros.
Duplicate internal source IDs are forbidden by source/case conservation in every
successful result. An adversarial fabricated-ID lifecycle test is a separate
future guard, not claimed by the physical CSV corpus.

## Reproduction

Run from the repository with Node24 and its installed dependencies. The selected
engine archive must contain a `node_modules` link; the runner imports production
read/reconciliation/session/export modules only from that explicit archive.

```sh
node audit/partial-reconciliation/frozen/run.mjs \
  --engine-root /absolute/path/to/immutable/archive \
  --out /absolute/path/to/new-result.json
```

The runner verifies every frozen hash before and after, hashes the entire library
before and after, uses physical file reads and the production supplier path, and
refuses to overwrite any result. PR01 also exercises session save/re-read/restore
and workbook export, preserving invalid originals/reasons and exact approvals.
Workbook reopening here uses ExcelJS, and is not an independent OpenXML check.

Preserve every baseline/candidate failure. Do not revise frozen expectations to
fit an engine outcome. A defect in the verifier must have a separate documented
version with the original result retained; do not silently edit this directory.
