# Long-component lifecycle evidence

The producer uses the actual Node worker dispatcher and worker client. It reads
four untouched accepted synthetic CSV originals, declares the long family only
for the register role, reconciles, saves, restores and exports direct/restored
native XLSX files. It covers all 54 frozen cases and 19 additional review and
invalidation states (73 entries, 146 workbooks). It records blocked acceptance
for missing evidence, malformed source, component differences and a blank amount,
and records decision invalidation after family, completeness, scope and hash
changes. A family change invalidation is a recorded rejected decision rather
than a new long-family artifact, because its reading is now horizontal.

```sh
ASSET_LONG_REPORT_DIR=work/fixed-assets-long-proof node --experimental-strip-types scripts/prove-fixed-assets-long.mjs
python3 -B audit/fixed-assets-long/check-evidence.py work/fixed-assets-long-proof
python3 -B audit/fixed-assets-long/test-evidence.py work/fixed-assets-long-proof
```

`pnpm test:fixed-assets-long:proof` runs all three in that order.

The producer creates a new immutable `attempt-<timestamp>` directory. Its stdout
identifies the exact directory. `LAST-ATTEMPT.json` points explicitly to that
attempt and binds its REPORT SHA256 and success state. The checker accepts either
that parent directory or the explicit attempt path. It never scans for a latest
successful attempt or falls back to an older one. `ASSET_LONG_PROOF_DIR` remains
an alias; the default directory is `work/fixed-assets-long-proof`.

Each entry contains four `source-N.csv` files, compute-only `case.json.scope`,
`session.json`, `direct-result.json`, `restored-result.json`, `direct.xlsx` and
`restored.xlsx`. REPORT records the frozen truth case, phase, physical member IDs,
context, decisions, statuses and SHA256/byte length of each artifact. Original
inputs are checked against the accepted frozen corpus, including the declared
single blank-row addition for source-hash invalidation.

The independent checker imports no TypeScript or product module. It recomputes
from those CSV bytes using the byte-exact accepted Python stdlib Decimal oracle
(`oracle.py`, SHA256 `5d5e9abd877b4e758663af40c28863ff5375252b039d784a415e6cc9fb3babd0`),
then separately reads the XLSX ZIP/XML and session JSON. Expected frozen values
are checked only after recomputation. It verifies every component comparison,
signed GL balance, raw cell, amount presence/text/minor, source coordinate,
physical member, aggregate anchor, quartet, original byte stream and review
membership. Its XML reader rejects formulas, hidden sheets/rows and fractional
native numbers. The twelve corruption controls refresh artifact hashes before
checking semantic failures, so a digest mismatch cannot substitute for a real
amount/provenance check.

**The reconciliation sheet (UX-6(c), integration amendment).** Reason: the
workpaper the page downloads now opens on one reconciliation sheet in the
interface's language, written from the replayed result after the evidence;
its amounts are at the currency's precision, so the reader's 17-sheet count
and integral-number rule would refuse it, though no evidence sheet changed.
The producer asks the export for that workpaper as the page does, the direct
one in English and the restored one in Arabic. The checker sets that one
first sheet aside with an independent helper
(`audit/reconciliation-sheet/set_aside.py`, ZIP and XML only) and holds the
17 evidence sheets after it to every rule above, unchanged; the sheet itself
is checked by `audit/reconciliation-sheet/check_sheet.py`. A sheet out of
place, hidden, alone or with a cell format among the evidence's is refused.
Three controls hold this: the sheet set aside in either language, a sheet
out of place or hidden refused, and a fractional native number in an
evidence sheet after it still refused. Frozen inputs, the accepted oracle,
expected values and the existing controls are unchanged.

Horizontal exports retain their existing 14 tables and session version. Long
exports add three tables:

- `Long component evidence`: every observable raw register Amount position,
  including malformed physical members; explicit `Present`, nullable `Text`
  and `Minor`, source hash and context. A missing field has `Present=false`
  and null text/minor; a physically blank field has `Present=true`, empty text
  and null minor. Expected positions require a valid header.
- `Asset component members`: four actual member IDs/rows and original component
  amounts for each valid logical asset. The `Assets` table explicitly labels
  its row/ID as the first physical member anchor and states its representation.
- `Original register rows`: each original data row with its actual cell count
  and separate literal cells, preserving blank rows and truncated row widths.

The worker client snapshots original bytes and every decision field before
posting, validates recomputed responses against the captured request, and checks
native workbook values against a fresh export. Tests exercise actual worker
cancellation, late/stale replies, wrong action, forged totals/context/cache/
original/family, foreign valid sessions and bogus binary responses. IO tests
exercise all 54 cases, snapshots during a suspended digest and complete event
membership/context rules. No browser or deployed build is claimed by this gate.
