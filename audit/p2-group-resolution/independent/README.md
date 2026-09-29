# P2 synthetic development contracts

This corpus contains 19 independently authored synthetic contracts with explicit
column mappings. It is development evidence, not an unseen acceptance holdout,
field validation, or a measure of unaided import or UI completion.

**Timing correction:** the contracts were authored without observing the P2
implementation, but engine edits were already in progress when their manifest
was frozen. The statements in the original frozen README and contract authorship
that this preceded engine edits are inaccurate. This correction supersedes them; the
original frozen bytes and their hash remain intact.

The oracle requires 11 automatic member sets across nine positive cases, and
permits one explicitly supplied manual pair in a separate case. All other
automatic member sets are forbidden. Required sets and signed totals come from
literal source rows, not engine outputs.

## Preserved baseline

`baseline-302c834.json` was produced once against a `git archive` of
`302c834ebba7e914e736c30ff7d92756038d9cae`, engine
`0.3.18-experimental`. All 55 library files matched that immutable commit before
and after execution. The archive was moved after execution to
`work/p2-group-resolution/baseline-302c834` outside the repository; provenance
records both the original execution directory and its persistent directory.

| Measure | Baseline |
| --- | ---: |
| Complete contracts passed | 11 / 19 |
| Required automatic member sets satisfied | 5 / 11 |
| Forbidden automatic member sets approved | 2 |
| Production operation exceptions | 0 |

Missed positive sets: P2D03, P2D04, P2D05, P2D06, P2D07 and P2D08.
The ordinary 1:1 controls inside P2D06 and P2D07 did pass. P2D09 and P2D10 each
falsely approved supplier row 4 with ledger row 4 despite overlapping bank and
receipt memberships; P2D10 retained its explicitly supplied manual pair as well.
All other contracts passed, including the inclusive 100-member and excess
101-member boundaries. Original failures are retained in the JSON.

The manifest SHA256 is
`2e26c81894873d7909df401cdbe52a154e95809932b93c5f3cb60cea5f165f68`.
The baseline result SHA256 is
`f83ca947e40799700a0a24f8045a315829d7dc1d33faa6b7844ffe5fd278cb92`.
`baseline-302c834.provenance.json` contains the full library digest map and
additional frozen artifact hashes.

## First P2 candidate

`candidate-9bf8775.json` records one run against immutable commit
`9bf8775416852cd4a691023647d06473c094eb69`, engine `0.3.19-experimental`.
All 56 library files matched that commit and stayed unchanged.

| Measure | Candidate |
| --- | ---: |
| Complete contracts passed | 17 / 19 |
| Required automatic member sets satisfied | 9 / 11 |
| Forbidden automatic member sets approved | 0 |
| Production operation exceptions | 0 |

P2D06 still misses supplier row 2 against ledger rows 3 and 4, the invoice
1000 = 400 + 600 with selected Reference INV-A and shared PO-A. P2D07 misses
the inverse relation. Their separate INV-B 500 pairs pass, and the INV-C 500
decoys remain unapproved. These are unmet positive contracts, not passing
conservative outcomes. The original baseline failures remain preserved.

Candidate result SHA256:
`ab9e5b75e032694c8de750832f4e8eabb594729a0b072fed46c9b84a6cc47189`.
Full hashes and timing clarification are in
`candidate-9bf8775.provenance.json`.

## Second P2 candidate regression

`candidate-42d47ec.json` records one regression run against immutable commit
`42d47ece8a962aa4449b65677b148eb75adeb0c2`, engine `0.3.19-experimental`:
**19/19 contracts and 11/11 required member sets passed**, with zero false
approved groups, zero falsely automatically consumed source rows and zero
operation exceptions. All 56 library files exactly matched the commit and
remained unchanged. The previously missed P2D06/P2D07 invoice groups now pass.
This is development regression evidence; earlier failures are still preserved.

Result SHA256:
`c2e15eee2789d79fb250a62550c0cd3c26ce7f1e7b2dc47a79e01476dff41806`.
Full library and frozen input digests are recorded in
`candidate-42d47ec.provenance.json`.

## Reproduction

From the repository root, with the desired immutable engine snapshot at
`ENGINE_SNAPSHOT` and the supported Node runtime available:

```sh
node --experimental-strip-types audit/p2-group-resolution/independent/frozen/run.mjs \
  --engine-root "$ENGINE_SNAPSHOT" \
  --out /tmp/p2-development-new-run.json
```

Use a new output path for every run. Never overwrite retained failures or alter
the frozen contracts to fit a candidate. A later fresh holdout must be separately
authored and must keep its details from implementation until candidate freeze.
