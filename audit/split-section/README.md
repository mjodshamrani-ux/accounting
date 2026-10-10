# Canonical P4 split-section audit inputs

The 55 effective cases follow the final independent ACCEPT decision. The canonical
inputs were frozen before implementation imports; `INPUT-MANIFEST.json` seals all
123 files under `frozen/`. Its SHA-256 is
`ebb1f9678384fa35ff23c28d636c240c6d1488ac483006ae85a20b019e2bc16c`.

The five metadata MAP negatives retain their original mutated inventories, page
counts, expected reasons, and financial truth. Only their source hash, source byte
count and cuts were rebound to the corrected MAP v4 source: SHA-256
`60cb222e4f2307eb086474a8aa591ea410fb8b505d78161ca07e59c0c245a8d6`,
2758 bytes, cuts `[22,36,69,83]`. Historical preparations remain unchanged.

From the repository root, run:

```sh
python3 -B audit/split-section/verify_inputs.py
python3 -B audit/split-section/check_oracle.py
python3 -B audit/split-section/generate_sources.py NEW_OUTPUT_DIRECTORY NEW_REPORT_FILE
```

`verify_inputs.py` checks the fixed manifest digest, exact file set, byte counts,
SHA-256 values and relative public fixture paths. `check_oracle.py` uses only the
Python standard library. It reads the synthetic literal PDF paints and physical
page tree, classifies literal cells independently of generator kind tags,
calculates gross debit/credit/net and memberships, compares exact CSV bytes for
positives, and checks exact refusal code/stage for negatives. Metadata mutations
are checked against the corrected complete source while their mutated inventory
is tested as supplied. The bounded PDF reader supports this synthetic fixture
format; it is not a general PDF parser.

`SOURCE-FACTS.json` contains sanitized literal source recipes transcribed from
accepted preparatory inventories. `generate_sources.py` reproduces the original
preparatory PDF writer and the approved geometry corrections. It rebuilds all 55
PDFs byte for byte into a new directory, refusing to overwrite canonical inputs.
It generates source PDFs only; the frozen financial oracle and expected CSV are
kept separate. The first regeneration matched all 55 canonical source files.

Before-import provenance and first results are kept outside this product checkout
in the implementation evidence directory: `INPUT-FREEZE.json`,
`PYTHON-ORACLE-FIRST.json`, `SOURCE-REGENERATION-FIRST.json`, and
`INPUT-TOOLS-PROVENANCE.json`. The latter records original generator/checker hashes
and verification that all 325 approved preparatory materials remain unchanged.
No tool here imports product code or executes financial lifecycle actions.
