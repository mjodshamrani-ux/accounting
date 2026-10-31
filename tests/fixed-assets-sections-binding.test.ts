import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  FA_SECTIONS_COLUMNS,
  FA_SECTIONS_GL_HEADER,
  FA_SECTIONS_MAP_HEADER,
  FA_SECTIONS_ROLES,
  FA_SECTIONS_VERSION,
  reviewAssetSections,
  type AssetSectionsInput,
  type AssetSectionsResult,
} from '../lib/reconciliation/fixed-assets-sections.ts';
import type { AssetSectionsReplayInput } from '../lib/reconciliation/fixed-assets-sections-io.ts';
import { createWorkerClient } from '../lib/reconciliation/worker-client.ts';
import { GlTbBindingPort } from './helpers/gl-tb-binding-port.ts';

type Envelope = { state: AssetSectionsInput; result: AssetSectionsResult };
// The real worker in a thread, behind the client binding the page uses. A
// laboratory register in Omani rials of its own.
const SCOPE = {
  entity: 'SYN-BINDING-LAB',
  assetLedger: 'FAR-B',
  glLedger: 'GL-B',
  currency: 'OMR',
  asOf: '2028-11-30',
  confirmed: true as const,
};
const CLASS = {
  cost: 'fixed-asset-cost',
  depreciation: 'accumulated-depreciation',
  impairment: 'accumulated-impairment',
} as const;
const ACCOUNT = { cost: '1610', depreciation: '1619', impairment: '1618' };
const head = [
  ['Section', 'S-1'],
  ['Entity', SCOPE.entity],
  ['Asset ledger', SCOPE.assetLedger],
  ['Currency', SCOPE.currency],
  ['As of', SCOPE.asOf],
  ['Location', 'Laboratory'],
  ['Category', 'Instruments'],
  [...FA_SECTIONS_COLUMNS],
];
const register = (cost = '800.000') => [
  ...head,
  ['IN-1', 'BAY', 'cost', cost, 'VR-I'],
  ['IN-1', 'BAY', 'depreciation', '300.000', 'VR-I'],
  ['IN-1', 'BAY', 'impairment', '0.000', 'VR-I'],
  ['IN-1', 'BAY', 'carrying', '500.000', 'VR-I'],
  ['End section', 'S-1'],
];
const map = () => [
  [...FA_SECTIONS_MAP_HEADER],
  ...(['cost', 'depreciation', 'impairment'] as const).map((c) => [
    'Instruments',
    c,
    ACCOUNT[c],
    'L-1',
    CLASS[c],
    '2020-01-01',
    '9999-12-31',
  ]),
];
const gl = (dep = '300.000') => [
  [...FA_SECTIONS_GL_HEADER],
  ...(
    [
      ['cost', '800.000', '0.000'],
      ['depreciation', '0.000', dep],
      ['impairment', '0.000', '0.000'],
    ] as const
  ).map(([c, debit, credit]) => [
    ACCOUNT[c],
    'L-1',
    CLASS[c],
    debit,
    credit,
    SCOPE.entity,
    SCOPE.glLedger,
    SCOPE.currency,
    SCOPE.asOf,
  ]),
];
function request(cost?: string): AssetSectionsReplayInput {
  return {
    files: [register(cost), map(), gl()].map((rows, side) => {
      const bytes = new TextEncoder().encode(
        rows.map((r) => r.join(',')).join('\n') + '\n',
      );
      return {
        name: `${FA_SECTIONS_ROLES[side]}.csv`,
        original: bytes.buffer as ArrayBuffer,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
    }),
    readings: FA_SECTIONS_ROLES.map((role) => ({
      sheet: 0 as const,
      role,
      family: FA_SECTIONS_VERSION,
      confirmed: true as const,
    })),
    scope: { ...SCOPE },
  };
}

async function forged(alter: (value: Envelope) => void) {
  const ports: GlTbBindingPort[] = [];
  const client = createWorkerClient(() => {
    const first = ports.length === 0;
    const port = new GlTbBindingPort((response, deliver) => {
      if (
        first &&
        response.ok &&
        response.action === 'fixed-assets-sections-review'
      )
        alter(response.value as Envelope);
      deliver(response);
    });
    ports.push(port);
    return port;
  });
  try {
    await assert.rejects(
      client.request('fixed-assets-sections-review', request()),
      /FA_SECTIONS_WORKER_BINDING/,
    );
    assert.equal(ports[0].terminated, true, 'rejected worker terminated');
    const clean = await client.request<Envelope>(
      'fixed-assets-sections-review',
      request(),
    );
    assert.deepEqual(
      clean.result.accounts.map((a) => [a.account, a.status]),
      [
        ['1610', 'consistent'],
        ['1618', 'consistent'],
        ['1619', 'consistent'],
      ],
    );
  } finally {
    ports.forEach((port) => port.terminate());
  }
}

void test('binding: the page installs the review it computes again from the bytes it sent', async () => {
  const port = new GlTbBindingPort();
  try {
    const value = await createWorkerClient(() => port).request<Envelope>(
      'fixed-assets-sections-review',
      request(),
    );
    assert.deepEqual(
      value.result.assets.map((a) => [a.assetId, a.status, a.codes]),
      [['IN-1', 'read', []]],
    );
    assert.equal(value.result.decimals, 3);
  } finally {
    port.terminate();
  }
});

void test('binding: a reply with another review, other sheets agreeing with it, or other bytes is refused and the worker replaced', async () => {
  await forged((value) => {
    value.result.accounts[0].status = 'difference';
  });
  // Sheets and review forged together agree with each other, so the
  // protocol's recomputation passes; only the page's replay of its own bytes
  // catches them.
  await forged((value) => {
    value.state.files[2].sheets[0].rows[2][4] = '290.000';
    value.result = reviewAssetSections(value.state);
  });
  await forged((value) => {
    new Uint8Array(value.state.files[0].original!)[0] ^= 1;
  });
  await forged((value) => {
    value.state.scope.glLedger = 'other';
  });
});
