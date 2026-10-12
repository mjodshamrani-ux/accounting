# Independent preparation oracle

This standard-library Python oracle evaluates original CSV bytes and selected-sheet raw OOXML against `CONTRACT.ar.md`. It is a PRE-PRODUCT preparation artifact. It neither imports nor reads product implementation, the root fixture generator, or literal expected truth. `BASELINE-PINS.json` identifies the baseline only; its product paths are not dependencies.

Run from the preparation folder:

```sh
python3 oracle/ar_oracle.py fixtures/CASE/bundle.json --output evidence/CASE.actual.json
python3 oracle/self_check.py
```

Python API: `ar_oracle.reconcile(bundle_dict, bundle_directory_path)`. Bundle keys are `files` and `families` (two entries), `scope` (`entity`, `ledger`, `customer`, `account`, `currency`, `start`, `end`, `confirmed`), `readingConfirmed` (two booleans), and `sheets` (two explicitly selected names or zero-based indices for XLSX). Optional `selectedAmountHeaders` defaults to two `Original signed amount` entries; choosing another role rejects the source pair. Extra informational bundle keys are ignored. Source family is explicit and never inferred from filename. XLSX selection is not inferred; CSV sheet provenance is `CSV`.

The oracle supports new `ar-scope-details-1` and the contract's old canonical/role-alias control `ar-limited-1`. It does not implement old generic-own-document role confirmation, arbitrary old reading configuration, product session/events/worker/export formats, or family migration. Generic old own-document headings produce `own-document-role-unconfirmed`.

## Stable output: `oracle-output-1`

| Key | Meaning |
| --- | --- |
| `status` | `source-error`, `review`, or `matched`; any source error blocks all pairs |
| `matchedPairCount` | Number of unique original-document 1:1 pairs |
| `totalsMinor` | Two exact integer original-movement sums; null for structural/read/total-bound failure |
| `totalBasis` | `diagnostic-valid-records` with source error, otherwise `original-movement` |
| `validRowCounts` | Valid records retained on each side; structural failures retain no authoritative records |
| `requiredIssueCategories` | Sorted unique union of exact source error codes and review case reasons |
| `sources` | Full source statuses, errors, inventories, valid records, scope headers, hashes and selected sheets |
| `pairs` | Unique original-document membership, type, own number, date and original amount |
| `cases` | Review reasons and original physical-member IDs on each side |
| `receiptAllocations` | Always empty: receipt pairs do not allocate to invoices |
| `financialCompletenessAsserted` | Always false: matching does not assert completeness |

Each source has `side`, `file`, `family`, `sha256`, `sheet`, `status` (`valid`/`source-error`), `errors`, `inventory`, `errorInventoryRefs`, `records`, `scopeHeader`, `totalMinor`, and `structuralError`. Errors preserve `code`, `row`, `column`, and `detail`. Record order and inventory order follow the source. Output JSON keys are sorted by the CLI; cases are ordered by normalized `(type, own document number)`, using reason priority duplicate-document, missing-counterpart, amount-difference, date-difference, related-conflict. Exact matches appear in `pairs` with reason `exact-own-document`. The source-error case precedes financial comparison and prevents any matches. Header-only sources produce `review`/`empty-source`.

Inventory entries preserve `rawCells`, `physicalRow`, `inventoryId`, `classification`, `errors`, and native `cellMeta`. CSV `physicalRow` is the original logical record ordinal including headers and blank records, while `lineSpan` is the inclusive original text line span. XLSX `physicalRow` is the original sheet row; absent rows up to the last represented row are inventoried as genuine blanks. Both valid financial `memberId` and evidence `inventoryId` use `side:sourceSha256:sheet:physicalRow`. Every inventory record has an evidence ID. `errorInventoryRefs` points to rejected/error physical rows, including malformed late competitors, without promoting them to eligible financial case members. Financial case membership remains valid-record-only. The source hash and physical row remain part of membership even when selected columns are reordered.

Valid records preserve `originalRaw` and exact `amountMinor`, `openBalanceRaw` (null if absent), `openBalanceRole: descriptive-unverified`, `relatedInvoiceRaw` and normalized negative evidence, description text, posting and own-document identities, date, parent identity/cell, and five `inheritedSourceCells`. Every inherited field includes source hash, sheet, original header key row, original value column, untouched raw text, local scope ID, detail row, and original parent cell. Parent IDs may differ across files and never participate in cross-source financial identity. Invalid movements remain in the raw inventory with their errors, including original/open cells; they are never silently used as valid records.

## Finite guard coverage and limits

The CSV parser checks UTF-8, genuine logical records, quoted multiline cells, strict CSV syntax, source bytes, reader records, and UTF-16 cell bounds. Source structure checks the exact marker/version, all unique scope keys, fixed role/perspective/amount basis/external scope, one bounded detail block, exact required and optional new-family headings, parent links, true blanks, and the end boundary. Movement checks include required identities, 200 UTF-16 identity limit/control/format/prefix/Excel-error guards, original amount sign/zero/exact precision/bounds, calendar and period, posting uniqueness including malformed late competitors, document uniqueness, missing members, amount/date difference, and explicit related conflict. Decimal arithmetic never uses floats. Currency/type/money normalization is solely the contract's clarified list. Literal open text receives only reader/source guards and has no financial authority.

Raw OOXML checks the selected workbook relationship/sheet, formulas (including blank cached formula cells), native error cells, hidden sheet/rows/columns/cells, merges, original cell references and row order, shared/inline strings, literal numeric lexical form, and the finite positive number-format shape `General`/`0.00`. That format restriction applies to every nonempty literal cell, including header identities and descriptive open text, so a text-concealing custom format cannot evade numeric-only checks. Zero or negative raw column widths and row heights are conservatively treated as hidden even without a hidden flag; exact Decimal geometry parsing has no financial role. Unknown styles/types are rejected. ISO date text is required by the date validator; serial-date support is not claimed. Hidden/merged defects anywhere in the selected sheet are conservatively rejected. The raw package is read without an XLSX repair library. Synthetic ZIP/XML tests are not product-native acceptance receipts.

Outer guards align with the verified baseline reader limits in the contract: 8 MiB per source, 1000 ZIP parts, 32 MiB total uncompressed bytes, 40 worksheets, 100 columns, 20030 selected-sheet rows, and sum of each worksheet's maximum physical row times maximum physical column at most 1,000,000 across the workbook. CSV records also observe the 100-column cap. Workbook area is checked from raw actual row/cell addresses, including sparse late addresses; declared dimension metadata is not authoritative. Explicit empty row XML contributes its physical row address conservatively. The positive financial shape remains limited to the declared AR columns; these outer checks do not claim complete equivalence with ExcelJS or native product acceptance. XML DTD/entities, invalid packages/parts, ambiguous selections, unsupported cell types/styles, malformed lexical CSV, and overbound reader sources are fatal. Hash/source error remains available for these failures; no partial inventory reconstruction is claimed when raw lexical/package parsing itself fails. No claim covers encrypted packages, macros/external links, every OOXML extension, or browser/CI/GitHub/publication.

The per-source detail cap counts every nonblank movement row, including rejected rows. Overall reader cap counts headers and blanks. Sums use valid rows only and remain diagnostic on source error; no invalid row or descriptive balance is filled forward or substituted. A structural error invalidates source-level authoritative records and returns null total while retaining all successfully parsed raw inventory rows.

## Self-check evidence

`test_oracle.py` constructs its own raw inputs without the root fixture generator. Its 109 controls include inclusive acceptance and one-step rejection checks for ZIP expansion/entry, worksheet, column, selected-row, and workbook-area caps, a declared-dimension non-authority control, exact-boolean confirmations, bounded malformed-scope errors, and three literal-format/geometry concealment checks. `self_check.py` records the full unittest log, current Python version, contract/pins hashes, implementation/test/runner/documentation hashes, and exact counts in `evidence/oracle-self-check/receipt.json`. It separately applies seventeen exact one-site changes in isolated in-memory copies of this oracle and verifies that actual semantic assertion failures detect each; runtime errors alone never count as detection. This is falsification of the preparation oracle only. Product tests run: zero; product mutants run: zero. It says nothing about an unimplemented product adapter, session, worker, or export. Prior receipts/logs are preserved under `evidence/oracle-self-check/attempt-before-scope-review-fix/` (80 controls/12 corruptions) and `attempt-before-native-review-fix/` (106 controls/14 corruptions).
