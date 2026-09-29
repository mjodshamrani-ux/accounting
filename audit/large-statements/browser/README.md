# Large native-PDF browser acceptance

Run the actual built application with `MIZAN_CHROMIUM=/path/to/chromium node audit/large-statements/browser/run.mjs <run-name>`. `DIST` selects the build directory; optional `LIVE_URL` selects a deployed application and still requires every loaded JavaScript/CSS response to match `DIST`. The script records the complete build manifest before and after each run. No engine modules are imported and no financial responses are injected.

The browser observes real worker progress counters and visible status text. It exercises PDF uploads, page jumps, invalid page input, explicit review, reconciliation, Excel export, saved-session restoration, late-page failure, cancellation through the actual Cancel button, and recovery on a new worker. All inputs are frozen synthetic fixtures from `../frozen/fixtures/`. The observer retains only request identity, fixture names, counters, and failure metadata; it does not retain worker result tables.

## Frozen build 920ace2

`candidate-920ace2-attempt2/result.json` passed 12 recorded checks against the unchanged build. The source checkout had advanced to test-only follow-up `28b7801` while the frozen build remained `920ace2`. The actual loaded main bundle was `assets/index-B5xWBqVO.js`, SHA-256 `6498b5c5c0f4d350c7f1439af17b575fc67f0dfda189345159ac32d0b5bf6a83`.

- The 70-page upload produced 142 ordered reading/layout messages; the 100-page upload produced 202. Reading/layout text rendered in Arabic and English.
- Page jumps, previous-page navigation, and invalid 0/out-of-range/fractional/empty input preserved the correct page. Completion and navigation did not approve PDF review.
- The 70-page PDF and CSV produced 2,240 automatic cases, no manual matches, and no unmatched or unread rows. Excel contained exactly 4,480 source IDs from the frozen oracle and 40,779,520 minor units per side. The downloaded session retained the original PDF hash and restored 2,240 cases in a fresh browser context.
- A page-70 failure retained the previous CSV, cleared progress, and terminated the worker. Cancellation after real page progress did the same. A fresh worker then read all 100 pages.
- All 20 observed requests were GET requests to the local origin. No external requests or page errors occurred. All 27 build files remained unchanged; all six loaded JavaScript/CSS responses matched them.

Manual choices are explicit: the audit changed inferred boundaries `21.5,43.9667,62.4` to the contract boundaries `25,49,68`, entered SAR and the 2026-08-31 cutoff, and checked PDF review. This run does not claim that those choices were automatic.

## Final runtime source a0c2e4b

After upload guidance changed from a literal 20-page limit to `MAX_PDF_PAGES`, `candidate-a0c2e4b/result.json` passed the same 12 checks in 12.8 seconds. The report's SHA-256 is `f6216c1dffbc312e0f6ee83dceec4725d0adfb39e6d41e47f8f5bf964b5639b1`. All 20 requests were local GET requests; there were no page, external-request, or loaded-code integrity errors. The main bundle was `assets/index-D-UoY2Zj.js`, SHA-256 `78da389113199ef8af7795fb0030d261b073872601e34ef474e215987a97a5cd`.

The independent Python standard-library verifier also passed against this run's `native-70.xlsx`; see `../openxml-a0c2e4b.json`. It checked 2,240 original transactions on each side, 2,240 exact pairs, 4,480 evidence members, 2,450 PDF origins, all parsed original cells and explicit exclusions. It found no missing or false pairs. The retained closing-balance conflict remains disclosed: this verifies a transaction export, not balance completeness.

The added CI steps run the same browser script and independent verifier after the general browser suite, and preserve synthetic evidence even on failure. No extra service, API credential, system spreadsheet application, or Python package is required. The existing Playwright Chromium installation, Node dependencies and Python standard library suffice. The local focused run plus XML verification took approximately 14 seconds; the first CI run will establish Linux timing. Release-specific engine, frozen-source and layout assertions intentionally require maintenance when those contracts change.

## Published 0.4.12

`live-0_4_12/result.json` passed all 12 unchanged checks against `https://mjodshamrani-ux.github.io/accounting/?v=0.4.12` after successful deployment of `7f1278a27dbd90c8c84b6f13e49df9fd447f4e0d`. Its SHA-256 is `9fc177b9e818f19ca6886ce2ce8bdb3dc78a56130586a53685b94d606183ea51`. The authoritative comparison directory came from official Pages artifact `11031665421`, workflow run `36563695576`; its archive SHA-256 was verified as `7bb0cca629073aa43947333e7e0da56f65577f3bdade1955e122cc27efdea08f` by the coordinating release task.

The live run independently matched the extracted artifact's complete manifest and every JavaScript/CSS response actually loaded. Production served `assets/index-CpSrr1xn.js` with SHA-256 `83aa8234ebef4f9ced5752a4d5ebeb5b7a233e0e6a9182ad83e3e3072864cd56` and `assets/index-DVOU_KzH.css` with SHA-256 `48cef0d0a3f6a3d0728f240ff20ab81c83df81ffb62638fe69f51ab44303d623`. All 20 requests were same-origin GET requests; there were no page errors. Unrequested production assets were not fetched.

`../openxml-live-0_4_12.json` independently passed the live workbook's exact 2,240 pairs, 4,480 source evidence members, 2,450 PDF row origins, original cells, source hashes and exclusions. The 100-page recovery and navigation checks also passed. `live-0_4_12/provenance.json` links the official artifact, loaded hashes, browser report and XML report. The same manual boundaries, scope and PDF review choices described above apply.

The first focused attempt, `candidate-920ace2/result.json`, is preserved. Its immediate assertion read the page-number draft before React's effect synchronized it after Previous; the captured screenshot already shows page 69 in both the table label and input. The harness now waits for the input to synchronize before asserting its value. No application changes were made for that harness correction.

## General browser harness regression

The original general run stopped at the automatic-column PDF scenario in `scripts/browser-test.mjs`: Confirm data remained disabled because the ledger had not been loaded. Its wait watched the disappearance of the generic Arabic loading text. Real PDF progress replaces that text before reading finishes, so Playwright submitted the next input while the application was still busy. The application correctly ignored that input. The failure screenshot shows the completed supplier PDF and an empty ledger slot.

All 17 existing file-read/re-read waits in that script now wait for the `.notice.loading` region to disappear. Existing filename conditions and every review, source, matching, export, and privacy assertion remain in place. This corrects test synchronization without changing the application's busy guard or review requirements.

Original failure log: `../../work/p4-browser-general.log` (outside the repository, retained in the shared workspace). Its SHA-256 and the preserved screenshot hash are recorded below. The screenshot is `work/qa/general-pdf-progress-race-before.png` in the ignored repository work directory. These paths are evidence locations, not deployed assets.

| Evidence | SHA-256 |
| --- | --- |
| Original general failure log | `91ae573791fc8a1e8c5db256529d33a32e03d524eca87cc213c21d1060668cfd` |
| Preserved general failure screenshot | `c6a9928c49cdcf62900e32cf2247ea751a583a5b9b03cbbaeb108765d8350eac` |
| First focused attempt report | `accb44d145fb14301cb2370e85956a185e54347a20cc69fbeaba19ac4324056a` |
| Passing focused report | `5ea18d62d35af5488ca455f3aac7bbbf0cc4dd755e19ef7bde3ac3e96fd9de6d` |
| Corrected general browser pass log | `44619bfacdbc0fb899ec9759dad6d0904fc395fe375bf0e22788d042895c694e` |

The corrected general run completed successfully (process exit 0) against the same frozen build. Its log is `../../work/p4-browser-general-progress-fixed.log`. Focused reports are immutable and remain separate from the general run. A later application-copy correction requires its own final-build verification.
