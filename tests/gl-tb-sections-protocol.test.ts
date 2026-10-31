import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from '../lib/reconciliation/io.ts';
import {
  GLS_VERSION,
  type GlsInput,
} from '../lib/reconciliation/gl-tb-sections.ts';
import { replayGlTbSections } from '../lib/reconciliation/gl-tb-sections-io.ts';
import { validateWorkerValue } from '../lib/reconciliation/protocol.ts';

// Synthetic sections and pages, unrelated to the sealed GLT-1 foundation.
const LABELS = [
  ['Entity', 'Test Trading Co'],
  ['Ledger', 'Group book'],
  ['Currency', 'USD'],
  ['Currency basis', 'functional'],
  ['Posting status', 'posted'],
  ['Posting layer', 'actual'],
  ['Period start', '2026-11-01'],
  ['Period end', '2026-11-30'],
];
const section = (id: string, account: string, closing: string) => [
  `Section,${id}`,
  ...LABELS.map((l) => l.join(',')),
  `Account,${account}`,
  'Complete dimensions,unit=a',
  'Record ID,Record kind,Posting date,Debit,Credit',
  `${id}-o,opening,2026-11-01,10.00,0.00`,
  `${id}-m,movement,2026-11-09,${closing === '15.00' ? '5.00' : '6.00'},0.00`,
  `${id}-c,closing,2026-11-30,${closing},0.00`,
  `End section,${id}`,
  '',
];
const GL = [
  ...section('S-1', '8100', '15.00'),
  ...section('S-2', '8200', '16.00'),
].join('\n');
const TB = [
  'Page,P-1',
  ...LABELS.map((l) => l.join(',')),
  'Account,Complete dimensions,Row type,Parent account,Opening debit,Opening credit,Period debit,Period credit,Closing debit,Closing credit',
  '8100,unit=a,account,,10.00,0.00,5.00,0.00,15.00,0.00',
  '8200,unit=a,account,,10.00,0.00,5.00,0.00,15.00,0.00',
  'End page,P-1',
].join('\n');
const bytes = (text: string) => new TextEncoder().encode(text + '\n').buffer;

async function request(gl = GL, tb = TB): Promise<GlsInput> {
  return {
    files: [
      await readFile('gl.csv', bytes(gl)),
      await readFile('tb.csv', bytes(tb)),
    ] as GlsInput['files'],
    readings: [
      { sheet: 0, role: 'gl-sections', family: GLS_VERSION, confirmed: true },
      { sheet: 0, role: 'tb-pages', family: GLS_VERSION, confirmed: true },
    ],
    scope: {
      entity: 'Test Trading Co',
      ledger: 'Group book',
      currency: 'USD',
      currencyBasis: 'functional',
      postingStatus: 'posted',
      postingLayer: 'actual',
      start: '2026-11-01',
      end: '2026-11-30',
      confirmed: true,
    },
  };
}

void test('GLS worker: the page installs only a result it can recompute from the sources it sent', async () => {
  const payload = await request();
  const value = await replayGlTbSections(payload);
  assert.deepEqual(
    value.result.accounts.map((a) => [a.key, a.status, a.codes]),
    [
      ['8100|unit=a', 'consistent', []],
      ['8200|unit=a', 'difference', ['closingDebit', 'periodDebit']],
    ],
  );
  assert.doesNotThrow(() =>
    validateWorkerValue('gl-tb-sections-reconcile', value, payload),
  );
  const edits: ((v: typeof value) => void)[] = [
    (v) => {
      v.result.accounts[1].status = 'consistent';
    },
    (v) => {
      v.result.accounts[1].codes = [];
    },
    (v) => {
      v.result.accounts.pop();
    },
    (v) => {
      v.result.run.push('STRAY_ROW');
    },
    (v) => {
      v.result.unplaced.length = 0;
      v.result.excludedSections.push({ id: 'S-2', row: 18 });
    },
    (v) => {
      v.state.scope.end = '2026-11-29';
    },
    (v) => {
      v.state.files.reverse();
    },
  ];
  for (const edit of edits) {
    const copy = structuredClone(value);
    edit(copy);
    assert.throws(() =>
      validateWorkerValue('gl-tb-sections-reconcile', copy, payload),
    );
  }
});

void test('GLS worker: a consistent result for other sources is not this request’s result', async () => {
  const payload = await request();
  const corrected = TB.replace(
    '8200,unit=a,account,,10.00,0.00,5.00,0.00,15.00,0.00',
    '8200,unit=a,account,,10.00,0.00,6.00,0.00,16.00,0.00',
  );
  const other = await replayGlTbSections(await request(GL, corrected));
  assert.deepEqual(
    other.result.accounts.map((a) => a.status),
    ['consistent', 'consistent'],
  );
  assert.throws(() =>
    validateWorkerValue('gl-tb-sections-reconcile', other, payload),
  );
  const forged = await request();
  forged.files[1].sheets[0].rows = [['Page', 'forged']];
  const replayed = await replayGlTbSections(forged);
  assert.deepEqual(
    replayed.result.accounts.map((a) => a.status),
    ['consistent', 'difference'],
  );
});
