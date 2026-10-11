import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile as fsRead } from 'node:fs/promises';
import { readFile } from '../lib/reconciliation/io.ts';
import { GL_TB_VERSION, type GlTbInput } from '../lib/reconciliation/gl-tb.ts';
import { replayGlTb, saveGlTb } from '../lib/reconciliation/gl-tb-io.ts';
import { createWorkerClient } from '../lib/reconciliation/worker-client.ts';
import { MAX_FILE_BYTES } from '../lib/reconciliation/types.ts';
import { GlTbBindingPort } from './helpers/gl-tb-binding-port.ts';

type Envelope = Awaited<ReturnType<typeof replayGlTb>>;
const frozen = new URL('../audit/gl-tb-binding/frozen/', import.meta.url);
const truth = JSON.parse(await fsRead(new URL('truth.json', frozen), 'utf8'));
async function fixture(): Promise<GlTbInput> {
  const files = await Promise.all(
    ['gl', 'tb'].map(async (side) =>
      readFile(
        `${side}.csv`,
        new Uint8Array(await fsRead(new URL(`${side}.csv`, frozen))).buffer,
      ),
    ),
  );
  return {
    files: files as GlTbInput['files'],
    scope: truth.scope,
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
void test('binding: authoritative reread accepts a disposable returned cache', async () => {
  const input = await fixture();
  const expected = await replayGlTb(input);
  const port = new GlTbBindingPort((response, deliver) => {
    if (response.ok && response.action === 'gl-tb-reconcile')
      (response.value as Envelope).state.files[0].sheets[0].rows[1][0] =
        'cache-only-edit';
    deliver(response);
  });
  try {
    await assert.doesNotReject(async () => {
      assert.deepEqual(
        await createWorkerClient(() => port).request('gl-tb-reconcile', input),
        expected,
      );
    }, 'valid originals must remain available through authoritative reread');
  } finally {
    port.terminate();
  }
});
const invalid: [string, (value: Envelope) => unknown][] = [
  [
    'same-byte typed array',
    (v) => ({
      ...v,
      state: {
        ...v.state,
        files: [
          {
            ...v.state.files[0],
            original: new Uint8Array(v.state.files[0].original!),
          },
          v.state.files[1],
        ],
      },
    }),
  ],
  [
    'missing original',
    (v) => ({
      ...v,
      state: {
        ...v.state,
        files: [{ ...v.state.files[0], original: undefined }, v.state.files[1]],
      },
    }),
  ],
  [
    'empty original',
    (v) => ({
      ...v,
      state: {
        ...v.state,
        files: [
          { ...v.state.files[0], original: new ArrayBuffer(0) },
          v.state.files[1],
        ],
      },
    }),
  ],
  [
    'oversized original',
    (v) => ({
      ...v,
      state: {
        ...v.state,
        files: [
          {
            ...v.state.files[0],
            original: new ArrayBuffer(MAX_FILE_BYTES + 1),
          },
          v.state.files[1],
        ],
      },
    }),
  ],
  [
    'missing file',
    (v) => ({ ...v, state: { ...v.state, files: [v.state.files[0]] } }),
  ],
  [
    'non-record file',
    (v) => ({ ...v, state: { ...v.state, files: [null, v.state.files[1]] } }),
  ],
  ['non-array files', (v) => ({ ...v, state: { ...v.state, files: {} } })],
  ['non-record result', (v) => ({ ...v, result: null })],
  ['non-record state', (v) => ({ ...v, state: null })],
  ['non-record envelope', () => null],
];
for (const action of ['gl-tb-reconcile', 'gl-tb-restore']) {
  void test(`binding raw envelope: ${action} rejects transport violations and permits clean retry`, async (t) => {
    const input = await fixture();
    const expected = await replayGlTb(input);
    const payload = action.endsWith('-restore')
      ? { buffer: await saveGlTb(input) }
      : input;
    for (const [name, alter] of invalid) {
      await t.test(name, async () => {
        const ports: GlTbBindingPort[] = [];
        const client = createWorkerClient(() => {
          const first = ports.length === 0;
          const port = new GlTbBindingPort((response, deliver) => {
            if (first && response.ok && response.action === action)
              response.value = alter(response.value as Envelope);
            deliver(response);
          });
          ports.push(port);
          return port;
        });
        try {
          await assert.rejects(
            client.request(action, payload),
            /GL_TB_WORKER_BINDING/,
          );
          assert.equal(ports[0].terminated, true);
          assert.deepEqual(await client.request(action, payload), expected);
          assert.equal(ports.length, 2);
        } finally {
          ports.forEach((port) => port.terminate());
        }
      });
    }
  });
}
