import test from 'node:test';
import assert from 'node:assert/strict';
import {
  askLocalImportModel,
  localImportModelAvailable,
} from '../lib/reconciliation/local-import-ai.ts';
import { buildImportProposalContext } from '../lib/reconciliation/import-proposals.ts';
import { readFile } from '../lib/reconciliation/io.ts';
import { defaultMapping } from '../lib/reconciliation/types.ts';
import type { Scope } from '../lib/reconciliation/types.ts';
import type { LocalModelAPI } from '../lib/reconciliation/local-ai.ts';
import { compare, normalizeSource } from '../lib/reconciliation/core.ts';

async function fixture() {
  const csv =
    'Posting day,Partner token,Signed movement,Units\n2026-09-01,INV-71,123.45,3\n2026-09-02,INV-72,-10.00,4\n2026-09-03,INV-73,10.00,5\n2026-09-04,INV-74,15.00,6';
  const file = await readFile(
    'synthetic-proposal.csv',
    new TextEncoder().encode(csv).buffer,
  );
  const mapping = defaultMapping();
  const context = buildImportProposalContext(file, mapping)!;
  const { sourceHash, sheet, header, baseline } = context;
  const output = {
    sourceHash,
    sheet,
    header,
    baseline,
    columns: { date: 0, reference: 1, amount: 2 },
  };
  return { file, mapping, context, output };
}
const scope: Scope = {
  supplier: 'Synthetic',
  entity: 'Synthetic',
  account: 'A1',
  currency: 'SAR',
  decimals: 2,
  cutoff: '2026-09-30',
  dateWindow: 0,
  confirmed: true,
  coverageConfirmed: false,
};

test('local import advice can complete unfamiliar mapping only after explicit application and engine checks', async () => {
  const { file, mapping, output } = await fixture();
  const before = JSON.stringify({ file, mapping });
  let availabilityOptions: unknown;
  let destroyed = 0;
  const response = await askLocalImportModel(
    file,
    mapping,
    new AbortController().signal,
    {
      availability: async (opts) => {
        availabilityOptions = opts;
        return 'available';
      },
      create: async (opts) => {
        const { signal, ...rest } = opts as Record<string, unknown>;
        assert.ok(signal);
        assert.deepEqual(rest, availabilityOptions);
        return {
          prompt: async (prompt, opts) => {
            assert.ok(prompt.includes('untrusted document text'));
            assert.ok((opts as Record<string, unknown>).responseConstraint);
            assert.equal(
              JSON.parse(prompt.split('DATA=')[1]).sourceHash,
              file.sha256,
            );
            return JSON.stringify(output);
          },
          destroy() {
            destroyed++;
          },
        };
      },
    },
  );
  assert.ok(response);
  assert.equal(response.status, 'needs-review');
  assert.equal(JSON.stringify({ file, mapping }), before);
  assert.equal(destroyed, 1);
  const applied = { ...mapping, ...response.patch };
  const result = compare(
    normalizeSource(file, applied, scope, 'supplier'),
    normalizeSource(file, applied, scope, 'ledger'),
    scope,
  );
  assert.equal(result.supplier.transactions.length, 4);
  assert.equal(result.matches.length, 4);
  assert.equal(result.supplier.total, 13845);
});

test('download states, absent model and unsupported Arabic never start model creation', async () => {
  const { file, mapping, context } = await fixture();
  let creates = 0;
  for (const state of [
    'downloadable',
    'downloading',
    'unavailable',
    'unknown',
  ]) {
    const api: LocalModelAPI = {
      availability: async () => state,
      create: async () => {
        creates++;
        throw Error('forbidden');
      },
    };
    assert.equal(
      await localImportModelAvailable(
        context,
        api,
        new AbortController().signal,
      ),
      false,
    );
    assert.equal(
      await askLocalImportModel(
        file,
        mapping,
        new AbortController().signal,
        api,
      ),
      null,
    );
  }
  assert.equal(
    await askLocalImportModel(file, mapping, new AbortController().signal),
    null,
  );
  let probes = 0;
  file.sheets[0].rows[0][0] = 'تاريخ القيد';
  assert.equal(
    await askLocalImportModel(file, mapping, new AbortController().signal, {
      availability: async () => {
        probes++;
        return 'available';
      },
      create: async () => {
        creates++;
        throw Error('forbidden');
      },
    }),
    null,
  );
  assert.equal(creates, 0);
  assert.equal(probes, 0);
});

test('model cannot rewrite values, choose inactive fields, change source or grant approval', async () => {
  const { file, mapping, output } = await fixture();
  for (const answer of [
    { ...output, approved: true },
    { ...output, amount: 0 },
    { ...output, sourceHash: '0'.repeat(64) },
    { ...output, columns: { amount: 999 } },
    { ...output, columns: { debit: 2, credit: 3 } },
    { ...output, columns: { amount: 2, date: 2 } },
  ]) {
    const before = JSON.stringify({ file, mapping });
    assert.equal(
      await askLocalImportModel(file, mapping, new AbortController().signal, {
        availability: async () => 'available',
        create: async () => ({
          prompt: async () => JSON.stringify(answer),
          destroy() {},
        }),
      }),
      null,
    );
    assert.equal(JSON.stringify({ file, mapping }), before);
  }
});

test('stale mapping, recut PDF, and even edits beyond the sample invalidate outstanding advice', async () => {
  for (const change of ['mapping', 'rows', 'pdf']) {
    const { file, mapping, output } = await fixture();
    const response = await askLocalImportModel(
      file,
      mapping,
      new AbortController().signal,
      {
        availability: async () => 'available',
        create: async () => ({
          prompt: async () => {
            if (change === 'mapping') mapping.multiplier = -1;
            if (change === 'rows') file.sheets[0].rows[4][2] = '150.00';
            if (change === 'pdf') file.pdf = { cuts: [20, 40], pages: 1 };
            return JSON.stringify(output);
          },
          destroy() {},
        }),
      },
    );
    assert.equal(response, null);
  }
});

test('abort before creation or during prompting discards advice and destroys the session', async () => {
  for (const stage of ['before', 'availability', 'prompt']) {
    const { file, mapping, output } = await fixture();
    const controller = new AbortController();
    let creates = 0;
    let destroyed = 0;
    if (stage === 'before') controller.abort();
    assert.equal(
      await askLocalImportModel(file, mapping, controller.signal, {
        availability: async () => {
          if (stage === 'availability') controller.abort();
          return 'available';
        },
        create: async () => {
          creates++;
          return {
            prompt: async () => {
              controller.abort();
              return JSON.stringify(output);
            },
            destroy() {
              destroyed++;
            },
          };
        },
      }),
      null,
    );
    assert.equal(creates, stage === 'prompt' ? 1 : 0);
    assert.equal(destroyed, creates);
  }
});

test('unparseable, oversized, thrown and unavailable responses fall back without changing the source', async () => {
  const { file, mapping } = await fixture();
  for (const raw of [
    'not JSON',
    'x'.repeat(32_001),
    '{"columns":{"amount":2}}',
    'throw',
  ]) {
    const before = JSON.stringify({ file, mapping });
    let destroyed = 0;
    assert.equal(
      await askLocalImportModel(file, mapping, new AbortController().signal, {
        availability: async () => 'available',
        create: async () => ({
          prompt: async () => {
            if (raw === 'throw') throw Error('model failed');
            return raw;
          },
          destroy() {
            destroyed++;
          },
        }),
      }),
      null,
    );
    assert.equal(destroyed, 1);
    assert.equal(JSON.stringify({ file, mapping }), before);
  }
});

test('numeric plausibility does not promote Quantity-as-Amount into verified semantics', async () => {
  const { file, mapping, output } = await fixture();
  const result = await askLocalImportModel(
    file,
    mapping,
    new AbortController().signal,
    {
      availability: async () => 'available',
      create: async () => ({
        prompt: async () =>
          JSON.stringify({ ...output, columns: { amount: 3 } }),
        destroy() {},
      }),
    },
  );
  assert.equal(result?.status, 'needs-review');
  assert.equal(mapping.amount, -1);
  assert.equal(result?.evidence[0].header.text, 'Units');
});
