# Local-provider feasibility experiment

Development-only, opt-in experiment. No imports from the application and no production model installation. Synthetic fixtures only; model output is never a financial decision. The **activation decision is NO** for the tested model and settings. See [the decision and limits](../../docs/P5-LOCAL-PROVIDER-FEASIBILITY.ar.md).

The runtime is pinned separately from the website; weights (about 598 MiB for the selected files) are not committed. Explicitly prepare them from the repository root:

```sh
pnpm --dir audit/local-provider install --ignore-workspace
pnpm --dir audit/local-provider rebuild --pending
python3 audit/local-provider/prepare-assets.py
```

Every asset is bounded by bytes, repository revision and SHA-256. Loading/inference disables remote model access and `fetch`. Preparing assets is a separate GET-only download, with no document payloads. Do not treat the fetch counter as a packet capture.

Replay the corrected experiment with a **new** result directory. Do not overwrite historical results:

```sh
caffeinate -dims node audit/local-provider/replay.mjs 4 replay-v2
python3 audit/local-provider/check_results.py audit/local-provider/results/replay-v2
node --experimental-strip-types --test tests/local-provider-contract.test.ts
python3 -m unittest discover -s audit/local-provider -p 'test_*.py' -v
```

On macOS, the explicit offline smoke can run with OS-level network denial:

```sh
caffeinate -dims sandbox-exec -f audit/local-provider/no-network.sb node audit/local-provider/offline-smoke.mjs
```

The recorded smoke used one CPU thread on the same M5, not a separate weaker device, and its eight-token response was not semantically evaluated. The full quality run is Node CPU, not browser inference. Native Chrome only underwent availability probing; no `create` or download was requested.

`freeze.json` and `freeze-v2.json` preserve source/prompt/truth hashes. V1 results remain failures; V2 changes message roles and runtime controls without changing semantic truth. Its cases are previously observed development data, not a holdout. Historical runner formatting is intentionally unchanged. Do not reformat frozen files or regenerate failure logs to turn them into passes.
