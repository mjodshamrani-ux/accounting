# Selecting checks by what changed

Run the rows that match the changed paths, focused column first. Every command here exists in `package.json` or under `scripts/` and `audit/`; `pnpm test:claude-skills` checks that this stays true.

| Changed paths | Focused first | Then wider | Release or CI-level |
| --- | --- | --- | --- |
| `docs/**`, `README.md`, `AGENTS.md`, `CLAUDE.md` | `node --experimental-strip-types --test tests/docs-status.test.ts` | `pnpm test:claude-skills` when skills or rules are linked | `node scripts/public-content-check.mjs --source-export` on a clean checkout |
| `.claude/**` | `pnpm test:claude-skills` | | `node scripts/public-content-check.mjs --source-export` |
| One engine `lib/reconciliation/<engine>.ts` | `node --experimental-strip-types --test tests/<engine>*.test.ts` | `pnpm typecheck`, `pnpm lint`, the domain's `pnpm test:<domain>` and `pnpm test:<domain>:mutations` scripts | `pnpm test`, the domain proof and browser scripts |
| Shared readers: `io.ts`, `xlsx-*.ts`, `pdf*.ts`, `core.ts`, `format-inference.ts` | the reader's tests (`tests/xlsx-namespaces.test.ts`, `tests/pdf-adversarial.test.ts`, `tests/format-inference.test.ts`, `tests/core.test.ts`) | `pnpm test`, `pnpm test:mutations`, `pnpm test:hard-cases`, the bank holdouts `pnpm test:bank-statement:g6-holdout` to `pnpm test:bank-statement:g15-holdout`, and `pnpm test:bank-statement:cashbook-check` (the pre-seal cashbook check copies `io.ts` and `xlsx-display.ts`) | browser holdouts, `pnpm build` and `node scripts/public-content-check.mjs --dist` |
| Group search: `invoice-group-search.ts`, `invoice-overlap-*.ts`, `payment-components.ts` | `node --experimental-strip-types --test tests/invoice-group-search.test.ts` | `pnpm test:hard-cases`, `pnpm test:reliability:quick` | `pnpm test:reliability` |
| Worker and trust boundary: `worker*.ts`, `protocol.ts`, `source-boundary.ts` | `node --experimental-strip-types --test tests/worker-client.test.ts` | `pnpm test` | `pnpm test:browser` |
| Sessions and export: `session.ts`, `*-session.ts`, `*-lifecycle.ts`, `case-workbook.ts`, `export-text.ts` | the domain session and export tests | the domain proof script and its independent export check | the domain browser script |
| Interface: `components/**`, `app/**`, `styles/**`, `lib/i18n/**` | `node --experimental-strip-types --test tests/i18n.test.ts` | `pnpm typecheck`, `pnpm lint`, `pnpm build` | `pnpm test:browser`, `pnpm test:browser:domain-navigation`, `pnpm test:browser:unified-workspace`, `pnpm test:bank-statement:interface-mutations` |
| Build, CSP, assets: `scripts/harden-build.mjs`, `vite.config.ts`, `public/**` | `pnpm build` | `node scripts/public-content-check.mjs --dist` | `pnpm test:browser` (records external requests) |
| `package.json`, `pnpm-lock.yaml` | `pnpm test:mutation-runner` (checks script entries) | `pnpm test:source-families:ci` | everything CI runs |
| Holdout tools `audit/bank-statement-*` | the package's `test_seal.py` or eligibility tests; `pnpm test:bank-statement:cashbook-check` for `cashbook.py`; for `items.py`, `mutate_items.py` and `measure_items.mjs --assert` (MuPDF, local) | `pnpm test:bank-statement:holdout-seal` | the holdout runs |

The full release list is in the [delivery guide](../../../docs/reference/DELIVERY.ar.md#الاختبارات); CI also runs the sharded mutations, oracles and specialized gates in `.github/workflows/pages.yml`.

## Environment notes

- Focused unit tests that read PDFs need the generated PDF.js module: run `node scripts/prepare-native-pdf.mjs` once (`pnpm test` does this).
- CI installs Chromium with `pnpm exec playwright install chromium`. In a container whose browser is preinstalled at another version, do not install a second one; scripts that read `MIZAN_CHROMIUM` take its path, and other scripts need their launch pointed at the installed browser. If no browser can start, the browser checks are "not run".
- Python checks need Python 3.12 or later, as in CI.
