import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readFile as fsRead,
  mkdir,
  mkdtemp,
  writeFile,
} from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readFile } from '../lib/reconciliation/io.ts';
import {
  suggestArScopeReading,
  type ArInput,
} from '../lib/reconciliation/ar.ts';
import { replayAr, saveAr, exportAr } from '../lib/reconciliation/ar-io.ts';
import { restoreAr } from '../lib/reconciliation/ar-io.ts';
import {
  createWorkerClient,
  type WorkerPort,
} from '../lib/reconciliation/worker-client.ts';

const fixtures = new URL(
  '../audit/ar-scope-details/fixtures/',
  import.meta.url,
);
async function fixture(id: string): Promise<ArInput> {
  const folder = new URL(`${id}/`, fixtures);
  const bundle = JSON.parse(
    await fsRead(new URL('bundle.json', folder), 'utf8'),
  );
  const files = await Promise.all(
    bundle.files.map(async (name: string) =>
      readFile(
        name,
        Uint8Array.from(await fsRead(new URL(name, folder))).buffer,
      ),
    ),
  );
  return {
    files: files as ArInput['files'],
    readings: files.map((file, side) => ({
      ...suggestArScopeReading(file, side as 0 | 1),
      confirmed: true,
    })) as ArInput['readings'],
    scope: bundle.scope,
    events: [],
  };
}

void test('mutation witness: context binds parent identity and nonfinancial open bytes', async () => {
  const original = await fixture('one-invoice-open-differs');
  const baseline = (await replayAr(original)).result;
  for (const field of ['parent', 'open'] as const) {
    const changed = structuredClone(original);
    const text = new TextDecoder().decode(changed.files[0].original);
    const changedText =
      field === 'parent'
        ? text.replaceAll('SCOPE-LEFT', 'NEW-PARENT')
        : text.replace(',100,,40,', ',100,,39,');
    assert.notEqual(changedText, text, `${field}: raw witness changed`);
    changed.files[0] = await readFile(
      changed.files[0].name,
      new TextEncoder().encode(changedText).buffer,
    );
    const result = (await replayAr(changed)).result;
    assert.equal(result.status, 'matched', field);
    assert.deepEqual(result.totals, [10000, 10000], field);
    assert.notEqual(
      result.context,
      baseline.context,
      `${field}: changed source invalidates decision context`,
    );
    changed.events = [
      {
        context: baseline.context,
        ids: baseline.cases[0].ids,
        action: 'reopen',
        note: 'Synthetic prior correspondence reviewed',
        at: '2026-10-11T00:00:00.000Z',
      },
    ];
    await assert.rejects(() => replayAr(changed), /AR_DECISION/, field);
  }
});

void test('mutation witness: receipt own identity never comes from the related invoice', async () => {
  const input = await fixture('invoice-v-receipt-reference');
  const { result } = await replayAr(input);
  assert.equal(
    result.cases.some((item) => item.status === 'matched'),
    false,
    'a receipt reference is not an invoice match',
  );
  const receipt = result.rows.find((row) => row.kind === 'receipt')!;
  assert.ok(receipt, 'sealed adversarial fixture retains its receipt');
  const reading = input.readings[receipt.side];
  const record =
    input.files[receipt.side].sheets[reading.sheet].rows[receipt.row - 1];
  assert.notEqual(
    record[reading.document],
    record[reading.related],
    'own and related identities differ in raw witness',
  );
  assert.equal(
    receipt.document,
    record[reading.document],
    'receipt keeps its own document number',
  );
  assert.equal(
    receipt.related,
    record[reading.related],
    'related invoice remains descriptive evidence',
  );
});

void test('mutation witness: request captures bytes and choices before the factory runs', async () => {
  const input = await fixture('one-invoice-open-differs'),
    submitted = structuredClone(input);
  let captured: ArInput | undefined;
  const port: WorkerPort = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage(value: unknown) {
      captured = (value as { payload: ArInput }).payload;
    },
    terminate() {},
  };
  const client = createWorkerClient(() => {
    new Uint8Array(input.files[0].original!).fill(0);
    input.scope.customer = 'FOREIGN';
    input.readings[0].description = -1;
    return port;
  });
  const controller = new AbortController();
  const pending = client.request('ar-reconcile', input, controller.signal);
  controller.abort();
  await pending.catch(() => undefined);
  assert.ok(captured, 'a complete captured request reached the port');
  assert.deepEqual(
    captured.scope,
    submitted.scope,
    'scope captured before factory',
  );
  assert.deepEqual(
    captured.readings,
    submitted.readings,
    'readings captured before factory',
  );
  assert.deepEqual(
    new Uint8Array(captured.files[0].original!),
    new Uint8Array(submitted.files[0].original!),
    'original bytes captured before factory',
  );
});

void test('mutation witness: legacy sessions preserve family, decisions and original context', async () => {
  const input = await fixture('one-invoice-open-differs');
  for (const side of [0, 1] as const) {
    const record = input.files[side].sheets[0].rows[15];
    const rows = [
      [
        'Posting ID',
        'Document type',
        'Own document number',
        'Posting date',
        'Original signed amount',
        'Entity',
        'Ledger',
        'Customer',
        'Account',
        'Currency',
        'Related invoice',
        'Description',
      ],
      [
        record[1],
        record[2],
        record[3],
        record[4],
        record[5],
        input.scope.entity,
        input.scope.ledger,
        input.scope.customer,
        input.scope.account,
        input.scope.currency,
        record[6],
        record[8],
      ],
    ];
    input.files[side] = await readFile(
      `legacy-${side}.csv`,
      new TextEncoder().encode(
        rows.map((row) => row.join(',')).join('\n') + '\n',
      ).buffer,
    );
    input.readings[side] = {
      sheet: 0,
      header: 0,
      posting: 0,
      kind: 1,
      document: 2,
      date: 3,
      amount: 4,
      entity: 5,
      ledger: 6,
      customer: 7,
      account: 8,
      currency: 9,
      related: 10,
      description: 11,
      role: side ? 'company-issued-customer-statement' : 'company-ar-ledger',
      perspective: 'seller-receivable',
      basis: 'original-movement',
      confirmed: true,
    };
  }
  const result = (await replayAr(input)).result;
  assert.equal(
    result.version,
    'ar-limited-1',
    'legacy family cannot silently change',
  );
  input.events = [
    {
      context: result.context,
      ids: result.cases[0].ids,
      action: 'reopen',
      note: 'Synthetic legacy correspondence reviewed',
      at: '2026-10-11T00:00:00.000Z',
    },
  ];
  await assert.doesNotReject(async () => {
    const restored = await restoreAr(await saveAr(input));
    assert.equal(restored.result.version, 'ar-limited-1');
    assert.equal(restored.result.context, result.context);
    assert.equal(restored.result.cases[0].reason, 'reopened');
    assert.deepEqual(restored.state.events, input.events);
  }, 'legacy session must restore its decision and unchanged context');
});

// The export checker reads raw sources, session and Excel itself. It does not
// import reconciliation code or accept product totals as its expectations.
for (const id of [
  'one-invoice-open-differs',
  'blanks-and-multiline-description',
  'late-invalid-competitor',
  'zero-original',
]) {
  void test(`mutation witness: independent export audit ${id}`, async () => {
    const output =
      process.env.AR_MUTATION_WITNESS_OUTPUT ||
      (await mkdtemp(path.join(tmpdir(), 'ar-export-witness-')));
    const checker =
      process.env.AR_MUTATION_EXPORT_CHECKER ||
      fileURLToPath(
        new URL(
          '../audit/ar-scope-details/checker/check_export.py',
          import.meta.url,
        ),
      );
    const prep =
      process.env.AR_MUTATION_PREP ||
      fileURLToPath(new URL('../audit/ar-scope-details/', import.meta.url));
    const folder = path.join(output, id);
    await mkdir(folder, { recursive: true });
    const input = await fixture(id),
      { state, result } = await replayAr(input);
    const workbook = path.join(folder, 'actual-export.xlsx'),
      session = path.join(folder, 'actual-session.json');
    await writeFile(workbook, Buffer.from(await exportAr(state, result)));
    await writeFile(session, Buffer.from(await saveAr(state)));
    const checked = spawnSync(
      process.env.AR_MUTATION_PYTHON || 'python3',
      [
        '-B',
        checker,
        workbook,
        '--prep',
        prep,
        '--bundle',
        path.join(prep, 'fixtures', id, 'bundle.json'),
        '--session',
        session,
        '--output',
        path.join(folder, 'checker.json'),
      ],
      { encoding: 'utf8', timeout: 60000 },
    );
    await writeFile(
      path.join(folder, 'checker.log'),
      (checked.stdout ?? '') + (checked.stderr ?? ''),
    );
    assert.equal(
      checked.error,
      undefined,
      `${id}: checker execution completed`,
    );
    assert.equal(checked.signal, null, `${id}: checker was not interrupted`);
    assert.equal(
      checked.status,
      0,
      `${id}: independent raw source, inventory, membership and provenance audit\n${checked.stdout}${checked.stderr}`,
    );
    const receipt = JSON.parse(
      await fsRead(path.join(folder, 'checker.json'), 'utf8'),
    );
    assert.equal(receipt.passed, true, `${id}: checker passed`);
  });
}
