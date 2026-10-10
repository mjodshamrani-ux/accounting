These two additional synthetic capacity regressions are separate from the
independently frozen 55-case family oracle. Input PDF and financial CSV bytes were
generated from fixed literal source facts before the regression harness imported
the product; INPUTS.json pins both hashes. No field acceptance is claimed.

Each page contains a unique section with 30 movements of debit 0.01 and credit
0.00. Section and page totals are 0.30 and 0.00. The grand total is page count
multiplied by 0.30. Every description is "Synthetic capacity movement".

The 19-page case has 570 movements and a 33101-byte CSV: the whole file exceeds a
32767-unit Excel cell limit but each source/evidence cell remains within it. The
full owned-receipt apply, save, restore and workbook export must succeed.

The 60-page case has 1800 movements. Native classification still verifies the
financial facts. Its duplicated artifact evidence exceeds the existing aggregate
plain-data allocation limit of ten million text units, so apply must refuse with
resource-limit before returning an artifact. Its receipt must be consumed. This
does not increase any resource budget or financial acceptance rule.
