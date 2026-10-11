import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile as fsRead } from 'node:fs/promises';
import { readFile } from '../lib/reconciliation/io.ts';
import {
  GL_TB_VERSION,
  GL_TB_VERTICAL_FAMILY,
  reconcileGlTb,
  type GlTbInput,
} from '../lib/reconciliation/gl-tb.ts';
import { replayGlTb, saveGlTb } from '../lib/reconciliation/gl-tb-io.ts';
import { AssetLongPort } from './helpers/fixed-assets-long-port.ts';
import { validateWorkerValue } from '../lib/reconciliation/protocol.ts';
import {
  createWorkerClient,
  type WorkerPort,
} from '../lib/reconciliation/worker-client.ts';

async function fixture() {
  const root = new URL(
    './fixtures/gl-tb-vertical/P01-two-sided-six-components/',
    import.meta.url,
  );
  const facts = JSON.parse(await fsRead(new URL('facts.json', root), 'utf8'));
  const files = await Promise.all(
    ['gl.csv', 'tb-vertical.csv'].map(async (name) =>
      readFile(name, Uint8Array.from(await fsRead(new URL(name, root))).buffer),
    ),
  );
  const input: GlTbInput = {
    files: files as GlTbInput['files'],
    scope: facts.scope,
    readings: [
      { sheet: 0, role: 'gl-detail', family: GL_TB_VERSION, confirmed: true },
      {
        sheet: 0,
        role: 'trial-balance',
        family: GL_TB_VERTICAL_FAMILY,
        confirmed: true,
      },
    ],
  };
  return { input, value: await replayGlTb(input) };
}

void test('vertical GL/TB worker envelope binds the supplied source, family, scope and six-cell result', async () => {
  const { input, value } = await fixture();
  validateWorkerValue('gl-tb-reconcile', value, input);
  validateWorkerValue('gl-tb-restore', value, {});
  for (const mutate of [
    (v: typeof value) => {
      v.result.tb!.periodDebit = 0;
    },
    (v: typeof value) => {
      v.result.components.find((c) => c.side === 1)!.cells[0].column++;
    },
    (v: typeof value) => {
      v.state.readings[1].family = GL_TB_VERSION;
    },
    (v: typeof value) => {
      v.state.scope.account = 'different';
    },
    (v: typeof value) => {
      v.state.files[1].name = 'other.csv';
      v.result.sources[1].name = 'other.csv';
    },
    (v: typeof value) => {
      new Uint8Array(v.state.files[1].original!)[0] ^= 1;
    },
  ]) {
    const changed = structuredClone(value);
    mutate(changed);
    assert.throws(
      () => validateWorkerValue('gl-tb-reconcile', changed, input),
      /GL_TB_ENVELOPE/,
    );
  }
  for (const action of ['gl-tb-save', 'gl-tb-export']) {
    validateWorkerValue(action, new ArrayBuffer(1), {});
    assert.throws(
      () => validateWorkerValue(action, { bytes: [1] }, {}),
      /GL_TB_ENVELOPE/,
    );
    assert.throws(
      () => validateWorkerValue(action, new ArrayBuffer(0), {}),
      /GL_TB_ENVELOPE/,
    );
  }
});

void test('actual GL/TB worker rejects coherently forged parsed sheets while original bytes remain unchanged', async () => {
  const { input } = await fixture();
  const port = new AssetLongPort((response, deliver) => {
    if (response.ok && response.action === 'gl-tb-reconcile') {
      const value = response.value as Awaited<ReturnType<typeof replayGlTb>>;
      value.state.files[0].sheets[0].rows[1][0] = 'forged source context';
      value.result = reconcileGlTb(value.state);
    }
    deliver(response);
  });
  try {
    const client = createWorkerClient(() => port);
    await assert.rejects(
      client.request('gl-tb-reconcile', input),
      /GL_TB_WORKER_BINDING/,
    );
  } finally {
    port.terminate();
  }
});

void test('actual GL/TB worker rejects a valid foreign-session restore', async () => {
  const { input } = await fixture();
  const session = await saveGlTb(input);
  const foreign = structuredClone(input);
  foreign.scope.account = 'other-account';
  const envelope = await replayGlTb(foreign);
  const port = new AssetLongPort((response, deliver) => {
    if (response.ok && response.action === 'gl-tb-restore')
      response.value = envelope;
    deliver(response);
  });
  try {
    const client = createWorkerClient(() => port);
    await assert.rejects(
      client.request('gl-tb-restore', { buffer: session }),
      /GL_TB_WORKER_BINDING/,
    );
  } finally {
    port.terminate();
  }
});

void test('GL/TB request captures originals and context synchronously for reconcile and restore', async () => {
  const { input, value } = await fixture();
  const session = await saveGlTb(input);
  const port = new AssetLongPort();
  try {
    const client = createWorkerClient(() => port);
    const pending = client.request<typeof value>('gl-tb-reconcile', input);
    input.scope.account = 'caller edit after request';
    new Uint8Array(input.files[0].original!)[0] ^= 1;
    assert.deepEqual(await pending, value);
    const restore = client.request<typeof value>('gl-tb-restore', {
      buffer: session,
    });
    new Uint8Array(session).fill(0);
    assert.deepEqual(await restore, value);
  } finally {
    port.terminate();
  }
});

void test('cancelled vertical requests terminate their worker and cannot install a late result; retry succeeds', async () => {
  const { input, value } = await fixture();
  const workers: {
    port: WorkerPort;
    sent: Record<string, unknown>;
    stopped: boolean;
  }[] = [];
  const client = createWorkerClient(() => {
    const entry = {
      port: {} as WorkerPort,
      sent: {} as Record<string, unknown>,
      stopped: false,
    };
    entry.port = {
      onmessage: null,
      onerror: null,
      onmessageerror: null,
      postMessage(message: Record<string, unknown>) {
        entry.sent = message;
      },
      terminate() {
        entry.stopped = true;
      },
    };
    workers.push(entry);
    return entry.port;
  }, 1000);
  const control = new AbortController();
  let installed = false;
  const pending = client
    .request('gl-tb-reconcile', input, control.signal)
    .then(() => {
      installed = true;
    });
  const late = workers[0].port.onmessage!;
  control.abort();
  await assert.rejects(pending);
  assert.equal(workers[0].stopped, true);
  late.call(
    {} as Worker,
    { data: { ...workers[0].sent, ok: true, value } } as MessageEvent,
  );
  assert.equal(installed, false);
  const next = client.request('gl-tb-reconcile', input);
  assert.equal(workers.length, 2);
  workers[1].port.onmessage!.call(
    {} as Worker,
    { data: { ...workers[1].sent, ok: true, value } } as MessageEvent,
  );
  assert.deepEqual(await next, value);
});
