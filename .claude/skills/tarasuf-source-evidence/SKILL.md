---
name: tarasuf-source-evidence
description: Keep every Tarasuf value tied to its source and trace it end to end. Covers CSV, Excel and native PDF reading as actually supported; hidden rows and columns, merged cells, formulas versus stored values, separators, dates, Arabic and Persian digits; preserving original bytes and documenting each transform; no silent drop or correction; file, sheet, row, page and position for each value; and the trace through matching, user decisions, session save and restore, and Excel export completeness. Use when changing or reviewing a reader, a source family, provenance fields, session restore or export evidence. قراءة المصدر، أثر القيمة، الخلايا المخفية والمدمجة، الصيغ، الأرقام العربية، الجلسة والتصدير. Not for the accounting meaning of a match.
---

# Tarasuf source evidence

A SHA-256 fingerprint ties content to one exact copy of the bytes. It does not prove the document is genuine or that it was interpreted correctly.

## When to use

- A change to reading, interpretation, provenance fields, session save or restore, or export evidence.
- A user file is refused, or a value differs between the screen, the session and Excel.

## When not to use

- Whether a matched group is accounting-correct: `tarasuf-accounting-review`.
- Network, storage and untrusted-file security as such: `tarasuf-privacy-security`.

## Inputs

- Readers: `lib/reconciliation/io.ts` (CSV and XLSX), `xlsx-namespaces.ts`, `xlsx-display.ts`, `pdf.ts` and `pdf-native-source.ts` (native PDF), `format-inference.ts`, `import-diagnostics.ts`, `localized-read-errors.ts`.
- Trace: `source-boundary.ts`, `protocol.ts`, `session.ts` and the domain `*-session.ts` or `*-lifecycle.ts`, `case-workbook.ts`, `export-text.ts`.
- [Architecture integration rules](../../../docs/reference/ARCHITECTURE.ar.md#قواعد-التكامل), the PDF source contract in the same file, [the accounting contract on reading](../../../docs/reference/ACCOUNTING-CONTRACT.ar.md#قراءة-ومعنى-المال), and the format notes in [formats.md](formats.md).

## Steps

1. State what the format support actually is today, from the code and the domain plan. Do not extend support by accepting a file that merely parses.
2. Capture the original bytes and their SHA-256 before any await, and read from that capture. Never substitute a mutable cache of sheets for the original.
3. For each value keep: file and fingerprint; sheet, row and cell, or page and position; the original text; the interpreted value; and the reason for any transform. Keep refused and summary rows with their role and reason.
4. Walk the format hazards in [formats.md](formats.md) that apply. Each hazard needs a normal case that stays accepted and a near case that must be refused or reviewed.
5. Never drop or correct silently. A transform that changes meaning (sign, date order, digit set, decimal separator) is either proven from the source or refused with a reason the user sees.
6. Trace one value through matching, a user decision, session save, restore and Excel. After restore the engine re-reads and recomputes; a saved decision does not regain authority because it exists. A changed source, scope or reading invalidates dependent decisions.
7. Check export completeness: every source row appears with its status, summary and detail agree, text stays text, and an independent reader (an OpenXML or oracle check in `scripts/check-*.py` or the domain proof) confirms it.

## Outputs and evidence

- For each changed path: the provenance fields kept, the hazards tested, and the trace from source to Excel with the command and result.
- Refusals with their reasons and positions, and the near cases that stayed accepted.

## Acceptance, failure and escalation

- Accept when every value in the change can be traced to file and position, every transform is recorded, and the round trip through session and Excel reproduces it.
- Fail on any silent loss, silent correction, value without position, or decision that survives a changed source. Escalate when a format feature is outside current support and the user needs it.

## Limits and related skills

- Passing on synthetic files shows support for those structures, not for every producer (see [source diversity](../../../docs/roadmap/source-diversity.ar.md)).
- `tarasuf-adversarial-testing` builds the near cases; `tarasuf-engine-development` makes the change; `tarasuf-product-workflow` checks what the user sees.

## Example

An XLSX has a hidden row holding a reversal and a merged label cell over two amount rows. Expect: the hidden row is read and shown as hidden, not dropped; the merged label applies only where the contract allows; both amounts keep their own cells. Save, restore and export, then confirm with the independent workbook check that the hidden row and both cells appear with their positions.
