# P1 browser acceptance

`run.mjs` serves an existing `dist` build locally and uses Playwright to exercise the actual application. It does not import the engine or modify application code.

```sh
MIZAN_CHROMIUM=/path/to/chrome-headless-shell node audit/p1-reference-resolution/browser/run.mjs candidate-name
```

Each named directory preserves input CSVs, screenshots, visible explanation text, exported workbooks, saved sessions, and a `result.json` with source revision, build asset hashes, observed requests, assertions and session engine version. Use a new name for every attempt.

The fixture repeats `Document No = INV-8170` with `Reference = LINE-0011` and `LINE-0012`. The ledger rows are reversed. The browser explicitly selects column 3, checks two automatic pairs, checks both source-specific explanations in Arabic and English, then exports a workpaper and session. The workbook must prove supplier row 2 → ledger row 3 and supplier row 3 → ledger row 2 with `EXACT_DOCUMENT_CHOSEN_REFERENCE_UNIQUE_V1`. A fresh browser context restores the session and exports the same pair identities. Every context records network requests and JavaScript page errors.

## Candidate 1 observed result

- Source revision: `02f4f33fa8ac97ebd582883b61577412acda9bf8`.
- Built app: 0.4.10. Saved session engine: `0.3.18-experimental`.
- `candidate-02f4f33-attempt2/result.json`: passed. Both languages and restored English showed 2 automatic, 0 manual, 0 unmatched, and 0 unread rows. Original and restored workpapers proved both correct source pairs.
- 12 requests, all local GETs; zero external requests, non-GET requests or JavaScript page errors. Build code asset hashes were unchanged during the run.
- `candidate-02f4f33/` preserves the initial harness failure: exact-text matching expected the explanation to be a standalone element. The actual review paragraph contained the expected full explanation plus source details. The selector was corrected to check the substring inside the review-detail region; the expected content was not weakened.

This checks one synthetic positive scenario and its UI/export/session path. It does not replace the independent adverse-case campaign or prove general privacy behavior outside this observed flow. No approval decisions, production data, remote requests or publication were involved.
