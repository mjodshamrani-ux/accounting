import { writeFile, mkdir } from 'node:fs/promises';
import { knownSplitSource } from './make-record.mjs';
import { readFile, exportWorkbook } from '../../lib/reconciliation/io.ts';
import { defaultMapping } from '../../lib/reconciliation/types.ts';
import { visualAccountingMapping } from '../../lib/reconciliation/visual-accounting-source.ts';
import { reconcileSupplierStatement } from '../../lib/reconciliation/supplier-reconciliation.ts';
import {
  saveSession,
  restoreSession,
} from '../../lib/reconciliation/session.ts';
export async function splitCase(lang = 'en', changes = {}) {
  const f = await knownSplitSource(lang, changes);
  const file = await readFile(
    'split.tarasuf-reviewed.json',
    f.bytes.slice().buffer,
  );
  const ledger = await readFile(
    'ledger.csv',
    new TextEncoder().encode(
      f.contract.ledger.map((r) => r.join(',')).join('\n'),
    ).buffer,
  );
  const c = f.context;
  /** @type {import('../../lib/reconciliation/session.ts').SessionState} */
  const state = {
    files: [file, ledger],
    mappings: [
      visualAccountingMapping(file),
      {
        ...defaultMapping(),
        header: 0,
        date: 1,
        reference: 0,
        amount: 2,
        currencyColumn: 3,
        reportType: 'transactions',
        numberFormat: 'dot',
        dateFormat: 'ymd',
        periodStart: c.periodStart,
        multiplier: 1,
      },
    ],
    scope: {
      supplier: c.supplier,
      entity: c.entity,
      account: c.account,
      currency: c.currency,
      decimals: c.decimals,
      cutoff: c.cutoff,
      dateWindow: 3,
      confirmed: true,
      coverageConfirmed: false,
    },
    decisions: [],
    rejected: [],
    events: [],
    review: { checked: false, name: '', notes: '' },
  };
  return {
    f,
    file,
    ledger,
    state,
    result: reconcileSupplierStatement(state).result,
  };
}
if (process.argv[1]?.endsWith('/export-fixture.mjs')) {
  const out = process.argv[2] ?? 'work/visual-split';
  await mkdir(out, { recursive: true });
  for (const lang of ['en', 'ar']) {
    const { f, state, result } = await splitCase(lang);
    await writeFile(`${out}/${lang}.tarasuf-reviewed.json`, f.bytes);
    const session = await saveSession(state);
    await writeFile(`${out}/${lang}-session.json`, new Uint8Array(session));
    const restored = await restoreSession(session);
    for (const [label, r, files, review] of [
      ['direct', result, state.files, state.review],
      ['restored', restored.result, restored.files, restored.review],
    ])
      await writeFile(
        // oxlint-disable-next-line typescript/no-base-to-string, typescript/restrict-template-expressions -- This fixture tuple supplies only direct/restored literal labels; retain native template coercion.
        `${out}/${lang}-${label}.xlsx`,
        new Uint8Array(await exportWorkbook(r, files, review)),
      );
    await writeFile(
      `${out}/${lang}-observations.json`,
      JSON.stringify(
        {
          matches: result.matches,
          errors: result.supplier.errors,
          excluded: result.supplier.excluded,
          total: result.supplier.total,
          balanceValid: result.supplier.balanceValid,
        },
        null,
        2,
      ) + '\n',
    );
  }
}
