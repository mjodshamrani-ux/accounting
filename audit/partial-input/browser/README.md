# Partial-input browser acceptance

Run from the repository root after building the frozen candidate:

```sh
node audit/partial-input/browser/run.mjs candidate-isolated isolated
python3 audit/partial-reconciliation/check_openxml.py --xlsx audit/partial-input/browser/candidate-isolated/partial.xlsx --browser-oracle audit/partial-input/browser/fixtures-isolated/oracle.json --require-reviewed --out audit/partial-input/browser/candidate-isolated/openxml.json
node audit/partial-input/browser/run.mjs candidate-original original
python3 audit/partial-reconciliation/check_openxml.py --xlsx audit/partial-input/browser/candidate-original/partial.xlsx --browser-oracle audit/partial-input/browser/fixtures/oracle.json --require-reviewed --out audit/partial-input/browser/candidate-original/openxml.json
```

The third argument selects the authored contract (`isolated` by default); both require two pairs, 13 retained issues, and 350.00 of processed transactions per side. `MIZAN_CHROMIUM` optionally selects an installed Chromium executable. `DIST` points to the exact built asset directory. `LIVE_URL` switches the same assertions to production; use the verified official CI artifact as `DIST` for that run. The harness checks loaded JS/CSS bytes, records requests and worker URLs, and rejects external/non-GET traffic and page errors. It hashes build and fixture files before and after execution.

The full flow verifies paginated Arabic/English issues, the partial banner in balance mode, assistant disclosure, reviewed-but-partial Excel output, original-source session restoration, and unresolved date ambiguity. Original CSVs are uploaded through the real interface; there are no engine imports or injected financial results. The independent Python verifier checks the XLSX against the authored CSV/oracle facts without ExcelJS or the engine.

`fixtures/` and its original oracle remain unchanged. They use invalid amounts `unread-1` through `unread-13`. Pre-freeze integration required two pairs but returned zero, recorded in `original-contract-miss.json`. A separate `fixtures-isolated/` contract using plain `unread` amounts was authored before browser execution; it does not replace or waive the original contract. The engine was then corrected to use structural/reference evidence and all original cells as negative collision evidence, rather than treating token shape alone as a source-wide blocker. Both unchanged contracts pass on source `84d4bdd9514df15b40c12dd269a1438ad3bcd110`; the original run closes the earlier completion miss. It does not claim that the original failed snapshot passed.

The first browser attempt `candidate-b4e8467-attempt1` failed a harness navigation race: after Confirm data, the app automatically opened the missing-currency panel, while the harness acted on the earlier collapsed state and closed it. The harness now waits for the automatically visible Currency field. The failed result and screenshot remain unchanged. Original log SHA256: `f0e80eb0f571da1466f9b3d5c9b7474b15e359a340bcd7ee228c382631460cb0`.

Results include `result.json`, screenshots, visible text, `partial.xlsx` and `partial-session.json`. All files are synthetic. Failed runs remain in their own output directory; a corrected harness or candidate uses a new name. The harness does not claim complete balance reconciliation or AI approval.

Final app `c1cd9d77bbaafac1fbf19d24e8ab8b00f20c709e` preserves engine source `84d4bdd` and fixes the new issue table's reason/value wrapping. Both final contracts pass in `candidate-c1cd9d7-{original,isolated}-attempt1/`; their cell-width assertions reject horizontal clipping. The final Arabic and English screenshots were visually inspected: full reasons and original values are readable, the warning remains visible in balance mode, and all 13 issues are reachable in 10+3 pages. Each run recorded 7 functional checks, 18 GET requests, six matching code-response hashes, and zero external requests, non-GET requests or page errors. See `candidate-c1cd9d7-summary.json`.
