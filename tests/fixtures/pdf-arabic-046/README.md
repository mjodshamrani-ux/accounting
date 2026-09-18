# Arabic text PDF fixtures — development set 0.4.6

These are small synthetic statements with manually specified expected dates,
references and integer minor-unit amounts in `manifest.json`. They are known
regression fixtures, not a held-out market sample. The test compares each PDF
against a separately written CSV ledger and checks the exported OOXML with the
independent XML reader.

Real producers used:

- ReportLab 4.4.9 with HarfBuzz 0.56.1 and embedded DejaVu Sans, shaped Arabic
  presentation forms with valid ToUnicode. Numeric/reference cells are drawn in
  their physical order. The helper rejects mixed Arabic/Latin text within a
  ReportLab cell because HarfBuzz alone is not a full bidi compositor.
- LibreOfficeDev 26.8.0.0.alpha0 (`2c87e51eeaa2b413ff4ae097b2705eea1995d8e5`),
  actual HTML → Writer/Web → PDF conversion. This producer exercises logical
  Arabic ToUnicode, within-cell Arabic/Latin text, fragment signs and a page clip.

All 12 pages of these 10 fixtures were rendered with Poppler and inspected.
The mixed-image fixture deliberately has a second raster page with an extra
invoice; no partial native extraction is allowed. Wrapped references and the
second account table remain unresolved with visible errors. Pure text import
requires the existing explicit PDF visual review; source scope/sign information
is supplied by the simulated accountant, not inferred from this fixture oracle.

Recreate using `node scripts/generate-arabic-pdf-fixtures-046.mjs`. Generation
needs Python with `reportlab==4.4.9`, `uharfbuzz==0.56.1`, Pillow, a DejaVu Sans
TTF and LibreOffice. Configure `TARASUF_PDF_PYTHON`, `TARASUF_PDF_FONT`,
`TARASUF_PDF_SOFFICE` and (if needed) `TARASUF_PDF_PYTHONPATH`. The helper defaults
to the local Codex bundled runtime. Regular tests consume the checked-in bytes
and do not require these generation tools. PDF metadata timestamps from
LibreOffice may vary; the semantic oracle is unchanged.

Run: `node --experimental-strip-types --test tests/reliability-arabic-pdf-046.test.ts`.
The software does not send any source data to a service.
