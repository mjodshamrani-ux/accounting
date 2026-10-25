# Format hazards and where they are handled

Each hazard has a pointer to the code that handles it today and to an existing test. "Read" means seen in code at commit 16e7cd1; confirm before relying on it.

| Hazard | Expected behaviour | Code (read) | Existing tests |
| --- | --- | --- | --- |
| Hidden rows and columns | read and recorded as hidden; each domain decides refusal or review with a reason (for example `AR_HIDDEN_ROW`), never a silent drop | `io.ts` (`hiddenRows`, `hiddenColumns`), domain readers | `tests/ordinary-statements.test.ts`, `tests/simplicity-safety.test.ts` |
| Merged cells | a merged cell in a selected column is an issue for review, not spread silently; a merged title outside the table is allowed | `io.ts` (`isMerged`) | `tests/ordinary-statements.test.ts` |
| Formulas | formulas in transaction columns are refused for review; stored results are not trusted silently | `io.ts` (`formulaRows`, `formulaCells`) | `tests/xlsx-namespaces.test.ts` |
| XML namespaces and DTDs | prefixed SpreadsheetML accepted unchanged; foreign namespaces and DTDs refused | `xlsx-namespaces.ts` | `tests/xlsx-namespaces.test.ts` |
| Decimal and thousands separators, parentheses negatives, doubled signs | parsed only when unambiguous; integer minor units | `core.ts` (amount parsing) | `tests/core.test.ts`, `tests/format-inference.test.ts` |
| Arabic-Indic and Persian digits | converted to ASCII digits for the value; original text kept | `core.ts` | `tests/core.test.ts`, `tests/format-inference.test.ts` |
| Dates | a format is proven, ambiguous, invalid or unavailable; ambiguous is not guessed | `format-inference.ts` (`FormatStatus`) | `tests/format-inference.test.ts` |
| Leading zeros in references | reference kept as text | `core.ts`, `io.ts` | `tests/xlsx-namespaces.test.ts` (`000017`) |
| Native PDF text | text items with page and position; paint order, clipping, fonts and streams guarded | `pdf.ts`, `pdf-native-source.ts`, `pdf-paint-order.ts`, `pdf-font-integrity.ts`, `pdf-stream-integrity.ts` | `tests/pdf-adversarial.test.ts`, `tests/pdf-paint-order.test.ts` |
| PDF text layer versus drawn glyphs | an identity ToUnicode map can name a letter drawn as an empty box | eligibility tool only (DEV-63); the product reads the text layer | `audit/bank-statement-eligibility/` |
| Images | reviewed PNG path only, one table, bounded size | `visual-*.ts` | see [AI boundaries](../../../docs/reference/AI-AND-OCR.ar.md) |
| Export text | source text stays text: no formula, link or escape reinterpretation | `export-text.ts`, `case-workbook.ts` | `tests/ar-export-text.test.ts`, `tests/related-export-text.test.ts` |
