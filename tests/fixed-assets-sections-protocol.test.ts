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
} from '../lib/reconciliation/fixed-assets-sections.ts';
import {
  replayAssetSections,
  type AssetSectionsReplayInput,
} from '../lib/reconciliation/fixed-assets-sections-io.ts';
import { validateWorkerValue } from '../lib/reconciliation/protocol.ts';

// A small synthetic workshop register in euros, unrelated to the FA-1
// stories.
const SCOPE = {
  entity: 'SYN-PROTOCOL-WORKS',
  assetLedger: 'FAR-P',
  glLedger: 'GL-P',
  currency: 'EUR',
  asOf: '2028-09-30',
  confirmed: true as const,
};
const CLASS = {
  cost: 'fixed-asset-cost',
  depreciation: 'accumulated-depreciation',
  impairment: 'accumulated-impairment',
} as const;
const ACCOUNT = { cost: '1510', depreciation: '1519', impairment: '1518' };
const head = [
  ['Section', 'S-1'],
  ['Entity', SCOPE.entity],
  ['Asset ledger', SCOPE.assetLedger],
  ['Currency', SCOPE.currency],
  ['As of', SCOPE.asOf],
  ['Location', 'Workshop'],
  ['Category', 'Tools'],
  [...FA_SECTIONS_COLUMNS],
];
const register = (cost = '800.00') => [
  ...head,
  ['TL-1', 'BENCH', 'cost', cost, 'VR-T'],
  ['TL-1', 'BENCH', 'depreciation', '300.00', 'VR-T'],
  ['TL-1', 'BENCH', 'impairment', '0.00', 'VR-T'],
  ['TL-1', 'BENCH', 'carrying', '500.00', 'VR-T'],
  ['End section', 'S-1'],
];
const map = () => [
  [...FA_SECTIONS_MAP_HEADER],
  ...(['cost', 'depreciation', 'impairment'] as const).map((c) => [
    'Tools',
    c,
    ACCOUNT[c],
    'W-1',
    CLASS[c],
    '2020-01-01',
    '9999-12-31',
  ]),
];
const gl = (dep = '300.00') => [
  [...FA_SECTIONS_GL_HEADER],
  ...(
    [
      ['cost', '800.00', '0.00'],
      ['depreciation', '0.00', dep],
      ['impairment', '0.00', '0.00'],
    ] as const
  ).map(([c, debit, credit]) => [
    ACCOUNT[c],
    'W-1',
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
const refused = (value: unknown, payload: unknown) =>
  assert.throws(
    () => validateWorkerValue('fixed-assets-sections-review', value, payload),
    /غير مكتملة/,
  );

void test('asset sections worker: the page installs only a review it can compute again for the files it sent', async () => {
  const payload = request();
  const value = await replayAssetSections(payload);
  assert.deepEqual(
    value.result.accounts.map((a) => [a.account, a.status]),
    [
      ['1510', 'consistent'],
      ['1518', 'consistent'],
      ['1519', 'consistent'],
    ],
  );
  validateWorkerValue('fixed-assets-sections-review', value, payload);
  const status = structuredClone(value);
  status.result.accounts[0].status = 'difference';
  refused(status, payload);
  const sections = structuredClone(value);
  sections.result.sections = [];
  refused(sections, payload);
  // A review of other files is not this request's review.
  refused(await replayAssetSections(request('800.01')), payload);
  // Nor of these files under another scope or reading.
  refused(value, { ...payload, scope: { ...SCOPE, glLedger: 'OTHER' } });
  refused(value, {
    ...payload,
    readings: [...payload.readings].reverse(),
  });
  // The bytes it carries must be the bytes sent, file by file.
  const bytes = structuredClone(value);
  new Uint8Array(bytes.state.files[2].original!)[0] ^= 1;
  refused(bytes, payload);
  const swapped = structuredClone(value);
  swapped.state.files.reverse();
  refused(swapped, payload);
  // The same bytes under another name are not the file sent.
  const renamed = structuredClone(value);
  renamed.state.files[1].name = 'other-map.csv';
  refused(renamed, payload);
  refused({ ...value, extra: true }, payload);
  // Sheets and review forged together agree with each other: the protocol
  // cannot tell, and the page's replay of its own bytes refuses them (the
  // binding test).
  const agreeing = structuredClone(value);
  agreeing.state.files[2].sheets[0].rows[2][4] = '290.00';
  agreeing.result = reviewAssetSections(agreeing.state);
  assert.deepEqual(
    agreeing.result.accounts.map((a) => a.status),
    ['consistent', 'consistent', 'difference'],
  );
  validateWorkerValue('fixed-assets-sections-review', agreeing, payload);
  refused(
    {
      ...value,
      result: {
        ...value.result,
        version: 'fixed-assets-long-components-gl-1',
      },
    },
    payload,
  );
});

void test('asset sections worker: refusals carry the family code, and an empty file is SOURCE', async () => {
  const payload = request();
  await assert.rejects(
    replayAssetSections({
      ...payload,
      scope: { ...SCOPE, confirmed: false as unknown as true },
    }),
    /^Error: FA_SECTIONS_SCOPE$/,
  );
  await assert.rejects(
    replayAssetSections({
      ...payload,
      files: payload.files.map((f, i) =>
        i === 1 ? { ...f, name: 'category-map.xlsx' } : f,
      ),
    }),
    /^Error: FA_SECTIONS_SOURCE$/,
  );
  await assert.rejects(
    replayAssetSections({
      ...payload,
      files: payload.files.map((f, i) =>
        i === 0 ? { ...f, sha256: '0'.repeat(64) } : f,
      ),
    }),
    /^Error: FA_SECTIONS_SOURCE_HASH$/,
  );
  const empty = new ArrayBuffer(0);
  await assert.rejects(
    replayAssetSections({
      ...payload,
      files: payload.files.map((f, i) =>
        i === 2
          ? {
              name: 'gl-balances.csv',
              original: empty,
              sha256: createHash('sha256').digest('hex'),
            }
          : f,
      ),
    }),
    /^Error: FA_SECTIONS_SOURCE$/,
  );
});
