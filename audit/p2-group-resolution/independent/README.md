# P2 synthetic development contracts

This corpus contains 19 independently authored synthetic contracts with explicit
column mappings. It is development evidence, not an unseen acceptance holdout,
field validation, or a measure of unaided import or UI completion.

**Timing correction:** the contracts were authored without observing the P2
implementation, but engine edits were already in progress when their manifest
was frozen. The statement in the original frozen README that this preceded
engine edits is inaccurate. This correction supersedes that statement; the
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
