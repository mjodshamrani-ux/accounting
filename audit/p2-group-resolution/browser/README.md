# P2 browser acceptance

`run.mjs` uploads synthetic CSVs through the actual browser interface. It does not import the engine, change application code, or publish anything. Run only after the candidate and its `dist` are frozen.

```sh
MIZAN_CHROMIUM=/path/to/chrome-headless-shell node audit/p2-group-resolution/browser/run.mjs candidate-name
```

For a later check of the published candidate, set `LIVE_URL=https://host/path/` and retain the same frozen `dist`. The audit verifies every loaded JavaScript/CSS response against that local build's asset hashes. A live run records this comparison explicitly; a version label alone is insufficient.

The audit covers:

- One complete N:M payment with supplier amounts −40/−60 and ledger amounts −25/−75, explicit shared `BANK-P2-441`, distinct local document/voucher values, and all four source members.
- Arabic and English explanations that distinguish equivalent payment groups from individual pairings or invoice allocation.
- Excel `N:M` classification, one match, four source rows, and exact group membership.
- Whole-group unlink through the UI, all four IDs in its audit event and Excel history, zero remaining automatic matches, and restoration of that rejected session.
- A fresh browser context restoring the original automatically matched session, independently of the rejected session.
- Four rows with competing bank/receipt memberships, retained together for review with zero automatic matches.
- Invoice subgroup A: 1000 = 400 + 600; sibling B: 500 = 500; and an unrelated C: 500 that must remain unmatched. These invoice rows have blank local voucher fields; differing local vouchers are covered by the independent campaign, not this fixture.

Each run preserves CSV inputs, screenshots, visible text, Excel files, sessions, and `result.json`. The report includes observed requests, loaded code hashes, blob-worker creation, source revision, session engine version, and all-file `dist` hashes verified before and after the flow. Requests must stay on the served application's origin, all requests must be GET, and no JavaScript page errors are allowed.

The audit reads formula caches as well as displayed workbook cells: ExcelJS omits cached numeric zero when reading a formula cell, so a missing cached result is accepted as zero only when the original worksheet XML contains `<v>0</v>` for that exact cell.

Use a fresh run name for each attempt. A failed attempt remains evidence, even when its cause is later identified as an audit harness issue. This targeted acceptance does not replace the independent adverse-case campaign or assert complete financial reconciliation.

## Candidate 1 observed result

`candidate-9bf8775-attempt3/result.json` passed the full audit against revision `9bf8775416852cd4a691023647d06473c094eb69`, app 0.4.11 / session engine `0.3.19-experimental`, on 2026-09-29 at 10:13:00 UTC.

All scenarios above completed, including original/rejected session restoration and the invoice subgroup. The run observed 30 requests, all GETs to the local application origin, zero page errors, five blob workers, and ten loaded JavaScript/CSS responses matching the frozen build. Every hash for the 27 files in `dist` (16,127,590 bytes) was unchanged at completion.

The first attempt is preserved in `candidate-9bf8775/`; it stopped on the ExcelJS cached-zero reading issue documented above. The second is preserved in `candidate-9bf8775-attempt2/`; all required group flows passed, then the optional invoice upload stopped because the audit used the wrong English edit-button label. Correcting it to the observed catalog label allowed the full third run to finish. Neither attempt established an application failure.

This browser fixture does not include numeric-only receipts or differing local vouchers within the invoice subgroup. Candidate 1's independently found completion misses for those inputs remain separate findings; this passing browser audit does not clear them.
