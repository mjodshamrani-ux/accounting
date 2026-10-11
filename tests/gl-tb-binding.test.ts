import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile as fsRead, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import ExcelJS from 'exceljs';
import { readFile } from '../lib/reconciliation/io.ts';
import {
  GL_TB_VERSION,
  reconcileGlTb,
  type GlTbInput,
} from '../lib/reconciliation/gl-tb.ts';
import { replayGlTb, saveGlTb } from '../lib/reconciliation/gl-tb-io.ts';
import {
  createWorkerClient,
  type WorkerPort,
} from '../lib/reconciliation/worker-client.ts';
import { GlTbBindingPort } from './helpers/gl-tb-binding-port.ts';
type Envelope = Awaited<ReturnType<typeof replayGlTb>>;
const frozen = new URL('../audit/gl-tb-binding/frozen/', import.meta.url);
const truth = JSON.parse(await fsRead(new URL('truth.json', frozen), 'utf8'));
async function fixture(formats = ['csv', 'csv']): Promise<GlTbInput> {
  const files = await Promise.all(
    ['gl', 'tb'].map(async (side, index) => {
      let bytes = new Uint8Array(await fsRead(new URL(`${side}.csv`, frozen)))
        .buffer;
      if (formats[index] === 'xlsx') {
        const book = new ExcelJS.Workbook();
        book.addWorksheet('Source').addRows(
          new TextDecoder()
            .decode(bytes)
            .trimEnd()
            .split('\n')
            .map((row) => row.split(',')),
        );
        const output = await book.xlsx.writeBuffer();
        bytes = new Uint8Array(output as unknown as ArrayBuffer).slice().buffer;
      }
      return readFile(`${side}.${formats[index]}`, bytes);
    }),
  );
  return {
    files: files as GlTbInput['files'],
    scope: structuredClone(truth.scope),
    readings: [
      { sheet: 0, role: 'gl-detail', family: GL_TB_VERSION, confirmed: true },
      {
        sheet: 0,
        role: 'trial-balance',
        family: GL_TB_VERSION,
        confirmed: true,
      },
    ],
  };
}
function check(value: Envelope) {
  assert.equal(value.result.status, truth.tb.status);
  for (const key of [
    'gl',
    'tb',
    'differences',
    'glBridge',
    'tbBridge',
  ] as const)
    assert.deepEqual(value.result[key], truth.tb[key], key);
  assert.equal(value.state.scope.account, '000781');
}
async function rejectAndRetry(
  action: string,
  input: unknown,
  alter: (value: Envelope) => void,
) {
  const ports: GlTbBindingPort[] = [];
  const client = createWorkerClient(() => {
    const first = ports.length === 0;
    const port = new GlTbBindingPort((response, deliver) => {
      if (first && response.ok && response.action === action)
        alter(response.value as Envelope);
      deliver(response);
    });
    ports.push(port);
    return port;
  });
  try {
    await assert.rejects(client.request(action, input), /GL_TB_WORKER_BINDING/);
    assert.equal(ports[0].terminated, true, 'rejected worker terminated');
    check(await client.request<Envelope>(action, input));
    assert.equal(ports.length, 2, 'retry uses clean worker');
  } finally {
    ports.forEach((port) => port.terminate());
  }
}
void test('binding: four CSV/XLSX pairs preserve independent six components, session and literal exports', async () => {
  const output = process.env.GL_TB_BINDING_REPORT_DIR;
  if (output) await mkdir(output, { recursive: true });
  const cases = [];
  for (const formats of [
    ['csv', 'csv'],
    ['xlsx', 'xlsx'],
    ['csv', 'xlsx'],
    ['xlsx', 'csv'],
  ]) {
    const input = await fixture(formats),
      port = new GlTbBindingPort();
    try {
      const client = createWorkerClient(() => port);
      const value = await client.request<Envelope>('gl-tb-reconcile', input);
      check(value);
      const session = await client.request<ArrayBuffer>('gl-tb-save', input);
      const restored = await client.request<Envelope>('gl-tb-restore', {
        buffer: session,
      });
      assert.deepEqual(restored, value);
      const id = formats.join('-');
      const exports: string[] = [];
      for (const [name, state] of [
        ['direct', value],
        ['restored', restored],
      ] as const) {
        const bytes = await client.request<ArrayBuffer>('gl-tb-export', {
          state: state.state,
          result: state.result,
        });
        assert.ok(bytes.byteLength > 0);
        if (output) {
          const file = `${id}-${name}.xlsx`;
          await writeFile(resolve(output, file), new Uint8Array(bytes));
          exports.push(file);
        }
      }
      if (output) {
        await writeFile(
          resolve(output, `${id}-session.json`),
          new Uint8Array(session),
        );
        for (const [i, file] of input.files.entries())
          await writeFile(
            resolve(output, `${id}-${i}.${formats[i]}`),
            new Uint8Array(file.original!),
          );
      }
      cases.push({ id, formats, exports, status: value.result.status });
    } finally {
      port.terminate();
    }
  }
  if (output)
    await writeFile(
      resolve(output, 'RESULTS.json'),
      JSON.stringify({ syntheticOnly: true, browser: false, cases }, null, 2) +
        '\n',
    );
});
void test('binding: coherent parsed-cache money substitution with unchanged originals is rejected and retry succeeds', async () => {
  const input = await fixture();
  await rejectAndRetry('gl-tb-reconcile', input, (value) => {
    for (const [i, file] of value.state.files.entries()) {
      const headers = file.sheets[0].rows[0];
      for (const row of file.sheets[0].rows.slice(1)) {
        const names = i
          ? ['Opening debit', 'Closing debit']
          : ['opening', 'closing'].includes(row[1])
            ? ['Debit']
            : [];
        for (const name of names) {
          const col = headers.indexOf(name);
          row[col] = (Number(row[col]) + 17).toFixed(2);
        }
      }
    }
    value.result = reconcileGlTb(value.state);
    assert.equal(value.result.gl!.openingDebit, 10807);
  });
});
void test('binding: requested session cannot be replaced by a coherent foreign session', async () => {
  const input = await fixture(),
    foreign = structuredClone(input);
  foreign.scope.account = '00782';
  foreign.files = (await Promise.all(
    input.files.map((file) =>
      readFile(
        file.name,
        new TextEncoder().encode(
          new TextDecoder().decode(file.original).replaceAll('000781', '00782'),
        ).buffer,
      ),
    ),
  )) as GlTbInput['files'];
  const value = await replayGlTb(foreign),
    session = await saveGlTb(input);
  await rejectAndRetry('gl-tb-restore', { buffer: session }, (returned) =>
    Object.assign(returned, value),
  );
});
void test('binding: each returned metadata field must match the request even with unchanged result', async () => {
  const changes: ((value: Envelope) => void)[] = [
    (value) => {
      value.state.scope.account = '00782';
    },
    (value) => {
      value.state.readings[0].confirmed = false;
    },
    (value) => {
      value.state.files[0].name = 'other.csv';
    },
    (value) => {
      value.state.files[0].sha256 = '0'.repeat(64);
    },
    (value) => {
      value.state.files[0].original = new ArrayBuffer(1);
    },
  ];
  for (const change of changes)
    await rejectAndRetry('gl-tb-reconcile', await fixture(), change);
});
void test('binding: altered result alone is rejected', async () => {
  await rejectAndRetry('gl-tb-reconcile', await fixture(), (value) => {
    value.result.gl!.openingDebit++;
  });
});
void test('binding: equal-length original-byte substitution is rejected despite unchanged metadata/result', async () => {
  await rejectAndRetry('gl-tb-reconcile', await fixture(), (value) => {
    new Uint8Array(value.state.files[0].original!)[0] ^= 1;
  });
});
void test('binding: harmless parsed-cache alteration never becomes installed source', async () => {
  const input = await fixture(),
    expected = await replayGlTb(input);
  const port = new GlTbBindingPort((response, deliver) => {
    if (response.ok && response.action === 'gl-tb-reconcile')
      (response.value as Envelope).state.files[0].sheets[0].rows[1][0] =
        'cache-only-edit';
    deliver(response);
  });
  try {
    assert.deepEqual(
      await createWorkerClient(() => port).request('gl-tb-reconcile', input),
      expected,
    );
  } finally {
    port.terminate();
  }
});
void test('binding: reconcile originals/scope and restore buffer are captured synchronously', async () => {
  const input = await fixture(),
    expected = structuredClone(await replayGlTb(input)),
    session = await saveGlTb(input),
    port = new GlTbBindingPort();
  try {
    const client = createWorkerClient(() => port),
      pending = client.request<Envelope>('gl-tb-reconcile', input);
    input.scope.account = 'caller-edit';
    new Uint8Array(input.files[0].original!).fill(0);
    input.files[1].sheets[0].rows = [];
    await assert.doesNotReject(async () => {
      assert.deepEqual(await pending, expected);
    });
    const restore = client.request<Envelope>('gl-tb-restore', {
      buffer: session,
    });
    const changedSession = JSON.parse(new TextDecoder().decode(session));
    changedSession.scope.account = '007782';
    const changedBytes = new TextEncoder().encode(
      JSON.stringify(changedSession),
    );
    assert.equal(changedBytes.byteLength, session.byteLength);
    new Uint8Array(session).set(changedBytes);
    await assert.doesNotReject(async () => {
      assert.deepEqual(await restore, expected);
    });
  } finally {
    port.terminate();
  }
});
void test('binding: cancellation during awaited response validation prevents installation and permits clean retry', async () => {
  const input = await fixture(),
    ports: GlTbBindingPort[] = [],
    control = new AbortController();
  let first = true,
    observed!: () => void;
  const reply = new Promise<void>((resolveReply) => {
    observed = resolveReply;
  });
  const client = createWorkerClient(() => {
    const port = new GlTbBindingPort((response, deliver) => {
      deliver(response);
      if (first && response.ok && response.action === 'gl-tb-reconcile') {
        first = false;
        control.abort();
        observed();
      }
    });
    ports.push(port);
    return port;
  });
  try {
    const pending = client.request('gl-tb-reconcile', input, control.signal);
    const rejected = assert.rejects(pending, /أُلغيت/);
    await reply;
    await rejected;
    assert.equal(ports[0].terminated, true);
    check(await client.request<Envelope>('gl-tb-reconcile', input));
  } finally {
    ports.forEach((port) => port.terminate());
  }
});
void test('binding: late cancelled reply cannot install or displace a new request', async () => {
  const input = await fixture(),
    value = await replayGlTb(input),
    workers: {
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
  });
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
  const next = client.request<Envelope>('gl-tb-reconcile', input);
  late.call(
    {} as Worker,
    { data: { ...workers[0].sent, ok: true, value } } as MessageEvent,
  );
  assert.equal(installed, false);
  assert.equal(workers.length, 2);
  workers[1].port.onmessage!.call(
    {} as Worker,
    { data: { ...workers[1].sent, ok: true, value } } as MessageEvent,
  );
  check(await next);
  assert.equal(installed, false);
});
void test('binding: corrupt requested originals and session are rejected; stale export never succeeds', async () => {
  const input = await fixture(),
    value = await replayGlTb(input),
    port = new GlTbBindingPort();
  try {
    const client = createWorkerClient(() => port),
      bad = structuredClone(input);
    new Uint8Array(bad.files[0].original!)[0] ^= 1;
    await assert.rejects(
      client.request('gl-tb-reconcile', bad),
      /GL_TB_SOURCE_HASH/,
    );
  } finally {
    port.terminate();
  }
  const freshPort = new GlTbBindingPort();
  try {
    const client = createWorkerClient(() => freshPort);
    await assert.rejects(
      client.request('gl-tb-restore', {
        buffer: new TextEncoder().encode('{}').buffer,
      }),
      /GL_TB_SESSION/,
    );
  } finally {
    freshPort.terminate();
  }
  const exportPort = new GlTbBindingPort();
  try {
    const changed = structuredClone(value.result);
    changed.gl!.openingDebit++;
    await assert.rejects(
      createWorkerClient(() => exportPort).request('gl-tb-export', {
        state: input,
        result: changed,
      }),
      /GL_TB_STALE_RESULT/,
    );
  } finally {
    exportPort.terminate();
  }
});
void test('binding: coherent foreign reconcile cannot replace the requested original pair', async () => {
  const input = await fixture(),
    foreign = structuredClone(input);
  foreign.scope.account = '00782';
  foreign.files = (await Promise.all(
    input.files.map((file) =>
      readFile(
        file.name,
        new TextEncoder().encode(
          new TextDecoder().decode(file.original).replaceAll('000781', '00782'),
        ).buffer,
      ),
    ),
  )) as GlTbInput['files'];
  const replacement = await replayGlTb(foreign);
  await rejectAndRetry('gl-tb-reconcile', input, (returned) =>
    Object.assign(returned, replacement),
  );
});
