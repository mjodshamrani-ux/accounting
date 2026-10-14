import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {
  PG_VERSION,
  PG_SIGNED_VERSION,
  PG_ROLES,
  reconcileGateway,
  type GatewayInput,
  type GatewayEvent,
  type GatewayResult,
} from '../lib/reconciliation/payment-gateway.ts';
import { readGatewayFile } from '../lib/reconciliation/payment-gateway-source.ts';
import { assertGatewayNative } from '../lib/reconciliation/payment-gateway-native.ts';
import {
  replayGateway,
  saveGateway,
  restoreGateway,
  exportGateway,
} from '../lib/reconciliation/payment-gateway-io.ts';
import {
  gatewayFixture,
  finishedGateway,
} from '../audit/payment-gateway/fixtures.ts';

const corpus = new URL('../audit/payment-gateway-signed/', import.meta.url);
type Truth = {
  financial: GatewayResult['financial'];
  totalsMinor: number[] | null;
  residualsMinor: number[] | null;
  issueCodes?: string[];
  requiredIssueCodes?: string[];
  missing?: string[];
};
const truths: Record<string, Truth> = JSON.parse(
  await readFile(new URL('handcrafted_truths.json', corpus), 'utf8'),
);
type Bundle = {
  scope: GatewayInput['scope'];
  readings: string[];
  files: string[];
  suppliedParsedGrids?: string[][][];
};
async function fixture(name: string): Promise<GatewayInput> {
  const base = new URL(`fixtures/${name}/`, corpus);
  const bundle: Bundle = JSON.parse(
    await readFile(new URL('bundle.json', base), 'utf8'),
  );
  const files = [];
  for (const name of bundle.files)
    files.push(
      await readGatewayFile(
        name,
        Uint8Array.from(await readFile(new URL(name, base))).buffer,
      ),
    );
  return {
    files: files as GatewayInput['files'],
    readings: bundle.readings.map((family, i) => ({
      sheet: 0,
      role: PG_ROLES[i],
      family,
      confirmed: true,
    })) as GatewayInput['readings'],
    scope: { ...bundle.scope, confirmed: true },
    completeness: { confirmed: false, reference: '', note: '' },
    events: [],
  } satisfies GatewayInput;
}
// Serialize independently read CSV cells into actual native originals accepted
// by the existing bank display guard. Financial expectations stay handwritten.
async function supportedNativeFixture(
  name = 'sar-mixed',
  inline = false,
  serialDates = false,
): Promise<GatewayInput> {
  const independent = oracle(name);
  const state = await fixture(name);
  const originals = [];
  for (let source = 0; source < 4; source++) {
    const rawRows: string[][] = independent.inventory
      .filter((r: { source: number }) => r.source === source)
      .map((r: { rawCells: string[] }) => r.rawCells);
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('Synthetic native original');
    for (const row of rawRows) sheet.addRow(row);
    const head = rawRows[0];
    const money =
      source === 0
        ? ['Signed amount']
        : source === 1
          ? ['Amount']
          : source === 2
            ? ['Gross sales', 'Refunds', 'Fees', 'Net']
            : ['Credit'];
    for (let row = 2; row <= rawRows.length; row++)
      for (let column = 1; column <= head.length; column++) {
        if (!rawRows[row - 1].length) continue;
        const cell = sheet.getCell(row, column);
        if (money.includes(head[column - 1])) {
          cell.value = Number(rawRows[row - 1][column - 1]);
          cell.numFmt = '0.00';
        }
        if (
          serialDates &&
          /date$|^Period start$|^Period end$|^As of$|^Valid from$|^Valid to$/.test(
            head[column - 1],
          )
        ) {
          cell.value = new Date(rawRows[row - 1][column - 1] + 'T00:00:00Z');
          cell.numFmt = 'mm-dd-yy';
        }
      }
    const zip = await JSZip.loadAsync(await book.xlsx.writeBuffer());
    let xml = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    if (source === 0) {
      const column = head.indexOf('Signed amount') + 1;
      const addressColumn = sheet.getCell(1, column).address.replace(/1$/, '');
      for (let row = 2; row <= rawRows.length; row++) {
        if (!rawRows[row - 1].length) continue;
        const address = addressColumn + row;
        xml = xml.replace(
          new RegExp(`(<c\\b[^>]*\\br="${address}"[^>]*><v>)[^<]*(</v></c>)`),
          (_, start, end) => start + rawRows[row - 1][column - 1] + end,
        );
      }
    }
    if (inline && zip.file('xl/sharedStrings.xml')) {
      const shared = await zip.file('xl/sharedStrings.xml')!.async('string');
      const strings = [
        ...shared.matchAll(/<si><t(?: [^>]*)?>([\s\S]*?)<\/t><\/si>/g),
      ].map((m) => m[1]);
      xml = xml.replace(
        /<c([^>]*)t="s"([^>]*)><v>([0-9]+)<\/v><\/c>/g,
        (_, a, b, index) =>
          `<c${a}t="inlineStr"${b}><is><t>${strings[Number(index)]}</t></is></c>`,
      );
    }
    zip.file('xl/worksheets/sheet1.xml', xml);
    originals.push(
      await readGatewayFile(
        `supported-${source}.xlsx`,
        await zip.generateAsync({ type: 'arraybuffer' }),
      ),
    );
  }
  state.files = originals as GatewayInput['files'];
  return state;
}
function oracle(name: string) {
  return JSON.parse(
    execFileSync(
      process.env.PYTHON_BINARY ?? 'python3',
      [
        '-B',
        fileURLToPath(new URL('oracle.py', corpus)),
        fileURLToPath(new URL(`fixtures/${name}/bundle.json`, corpus)),
      ],
      { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
    ),
  );
}
function event(
  r: GatewayResult,
  type: GatewayEvent['type'],
  id = type,
): GatewayEvent {
  return {
    id,
    type,
    batchId: r.scope.batchId,
    memberIds: [...r.memberIds],
    context: r.context,
    at: '2026-10-11T00:00:00.000Z',
    reference: 'Synthetic independent review reference',
    note: 'Synthetic complete batch review',
  };
}
const semanticIssue: Record<string, string[]> = {
  AMOUNT_PRECISION: ['AMOUNT'],
  AMOUNT_BOUND: ['AMOUNT'],
  READING: ['COLUMNS'],
};

void test('Signed gateway: 58 independent synthetic bundles exercise CSV financial truths and strict native boundaries; narrower precode native controls are not product acceptance', async (t) => {
  assert.equal(Object.keys(truths).length, 58);
  for (const [name, truth] of Object.entries(truths))
    await t.test(name, async () => {
      const independent = oracle(name);
      assert.equal(
        independent.financial,
        truth.financial,
        'oracle agrees with separately declared truth',
      );
      assert.deepEqual(independent.totalsMinor, truth.totalsMinor);
      assert.deepEqual(independent.residualsMinor, truth.residualsMinor);
      if (
        name === 'negative-native-cache-mismatch' ||
        name.startsWith('format-sar-')
      ) {
        // The generic reader now resolves original.xml instead of losing its
        // worksheet. These unchanged precode originals still have a minimal font
        // outside the native display contract, so the existing domain guard must
        // reject them. The first full run failed the old no-sheets expectation;
        // this is a rejection-stage correction, not native financial acceptance.
        await assert.rejects(() => fixture(name), {
          message: /^BANK_NATIVE_DISPLAY$/,
        });
        const original = Uint8Array.from(
          await readFile(new URL(`fixtures/${name}/0.xlsx`, corpus)),
        ).buffer;
        await assert.rejects(
          () =>
            assertGatewayNative({
              name: '0.xlsx',
              original,
              sheets: [
                {
                  name: 'Synthetic original',
                  rows: [],
                  formulaRows: [],
                  hiddenRows: [],
                },
              ],
            }),
          /BANK_NATIVE_DISPLAY/,
        );
        return;
      }
      let state: GatewayInput;
      try {
        state = await fixture(name);
      } catch (error) {
        assert.equal(
          truth.financial,
          'source-error',
          'valid sources must be readable',
        );
        assert.ok(error instanceof Error);
        if (name === 'negative-cell-astral-32768-units')
          assert.match(error.message, /PG_CELL_LIMIT/);
        else if (name.startsWith('negative-native-'))
          assert.match(
            error.message,
            /PG_NATIVE_DISPLAY|رابط|روابط|Excel|XML|مساحة|namespace/i,
          );
        else throw error;
        return;
      }
      let r: GatewayResult;
      try {
        r = reconcileGateway(state);
      } catch (error) {
        assert.equal(name, 'negative-unsupported-currency');
        assert.ok(error instanceof Error);
        assert.match(error.message, /PG_CURRENCY/);
        return;
      }
      assert.equal(r.financial, truth.financial, name);
      assert.deepEqual(r.totals, truth.totalsMinor, name);
      assert.deepEqual(r.residuals, truth.residualsMinor, name);
      for (const code of truth.requiredIssueCodes ?? [])
        assert.ok(
          r.issues.some((issue) =>
            (semanticIssue[code] ?? [code]).includes(issue.code),
          ),
          `required semantic issue ${code}`,
        );
      if (truth.missing) assert.deepEqual(r.missing, truth.missing);
      if (truth.issueCodes)
        assert.deepEqual(
          r.issues.map((i) => i.code),
          truth.issueCodes,
        );
      if (name === 'negative-signed-header-canonical-reading')
        assert.equal(
          r.memberIds.length,
          7,
          'product inventories invalid headers while the narrow oracle aborts at reading',
        );
      else
        assert.deepEqual(
          r.memberIds,
          independent.memberIds,
          'including zero and invalid rows, physical record IDs',
        );
      assert.deepEqual(
        r.records[0]
          .filter((r) => r.signedAmount)
          .map((r) => ({
            source: r.source,
            physicalRow: r.row,
            transactionId: r.values[0],
            kind: r.values[1],
            rawLexeme: r.signedAmount!.raw,
            normalizedLexeme: r.signedAmount!.normalized,
            originalSign: r.signedAmount!.sign,
            signedMinor: r.signedAmount!.signedMinor,
            canonicalMagnitudeMinor: r.signedAmount!.magnitude,
          })),
        independent.signedProvenance,
      );
      if (truth.financial !== 'source-error')
        assert.equal(
          r.status,
          truth.financial === 'ready' ? 'needs-review' : truth.financial,
        );
    });
});

void test('Signed gateway: explicit family is transactions-only and cannot reinterpret canonical unsigned originals', async () => {
  const signed = await fixture('sar-mixed');
  for (const source of [1, 2, 3]) {
    const changed = structuredClone(signed);
    changed.readings[source].family = PG_SIGNED_VERSION as never;
    assert.throws(() => reconcileGateway(changed), /PG_READING/);
  }
  const canonical = await gatewayFixture('pending');
  canonical.readings[0].family = PG_SIGNED_VERSION;
  assert.equal(reconcileGateway(canonical).financial, 'source-error');
  signed.readings[0].family = PG_VERSION;
  assert.equal(reconcileGateway(signed).financial, 'source-error');
  for (const family of [
    'payment-gateway-unknown',
    'payment-gateway-signed-kind-2',
  ]) {
    signed.readings[0].family = family as never;
    assert.throws(() => reconcileGateway(signed), /PG_READING/);
  }
});

void test('Signed gateway: blank and negative zero never coerce to zero; lexical zero keeps the explicit kind and physical CSV record', async () => {
  for (const raw of [
    '',
    '-0',
    '-00.00',
    '-٠٫٠٠',
    '-۰٫۰۰',
    ' +0',
    '+0 ',
    '0e0',
    '−0',
    '0.000',
  ]) {
    const state = await fixture('sar-mixed');
    const text = new TextDecoder()
      .decode(state.files[0].original!)
      .replace('+100.00', raw);
    state.files[0] = await readGatewayFile(
      'bad-zero.csv',
      new TextEncoder().encode(text).buffer,
    );
    const r = reconcileGateway(state);
    assert.equal(r.financial, 'source-error', JSON.stringify(raw));
    assert.equal(r.totals, null);
    assert.equal(r.residuals, null);
    assert.equal(r.memberIds.length, 7);
    assert.ok(
      r.issues.some(
        (i) =>
          i.row === 2 &&
          i.code === (raw.startsWith('-') ? 'NEGATIVE_ZERO' : 'AMOUNT'),
      ),
      JSON.stringify(raw),
    );
    assert.equal(
      r.cells.find(
        (c) => c.source === 0 && c.row === 2 && c.field === 'Signed amount',
      )!.text,
      raw,
    );
  }
  for (const raw of ['0', '+0', '+00.00', '+٠٫٠٠', '۰٫۰۰']) {
    const state = await fixture('sar-mixed');
    const text = new TextDecoder()
      .decode(state.files[0].original!)
      .replace('-20.00', raw);
    state.files[0] = await readGatewayFile(
      'refund-zero.csv',
      new TextEncoder().encode(text).buffer,
    );
    const r = reconcileGateway(state);
    assert.equal(r.financial, 'difference');
    assert.deepEqual(r.totals, [15000, 0, 300, 14700]);
    assert.deepEqual(r.residuals, [0, -2000, 0, 2000, 0]);
    assert.equal(r.records[0][1].values[1], 'refund');
    assert.equal(r.records[0][1].signedAmount!.raw, raw);
    assert.equal(r.records[0][1].signedAmount!.signedMinor, 0);
    assert.equal(r.memberIds.length, 7);
  }
  const state = await fixture('sar-mixed');
  const text = new TextDecoder()
    .decode(state.files[0].original!)
    .replace(
      'Synthetic transaction S1',
      '"Synthetic transaction S1\ncontinued"',
    );
  state.files[0] = await readGatewayFile(
    'quoted-multiline.csv',
    new TextEncoder().encode(text).buffer,
  );
  const r = reconcileGateway(state);
  assert.equal(r.financial, 'source-error');
  assert.equal(r.memberIds.length, 7);
  assert.deepEqual(
    r.memberIds.slice(0, 3).map((id) => JSON.parse(id)[4]),
    [2, 3, 4],
  );
  assert.equal(
    r.cells.find(
      (c) => c.source === 0 && c.row === 2 && c.field === 'Reference',
    )!.text,
    'Synthetic transaction S1\ncontinued',
  );
});

void test('Signed gateway: review accept/reject/undo binds full zero/invalid membership, context and completeness', async () => {
  const state = await fixture('sar-zero-kinds');
  let r = reconcileGateway(state);
  assert.equal(r.memberIds.length, 7);
  assert.equal(r.records[0].length, 4);
  state.events = [event(r, 'accept')];
  assert.throws(() => reconcileGateway(state), /PG_EVENT_FINANCIAL/);
  state.events = [];
  state.completeness = {
    confirmed: true,
    reference: 'Synthetic whole-source attestation',
    note: 'Four originals retained including all explicit zeros',
  };
  r = reconcileGateway(state);
  state.events = [event(r, 'accept')];
  assert.equal(reconcileGateway(state).status, 'consistent-with-evidence');
  state.events.push(event(r, 'undo'));
  assert.equal(reconcileGateway(state).review, 'needs-review');
  state.events.push(event(r, 'reject'));
  assert.equal(reconcileGateway(state).review, 'rejected');
  const saved = await saveGateway(state);
  assert.deepEqual(
    (await restoreGateway(saved)).result,
    reconcileGateway(state),
  );
  for (const mutate of [
    (x: GatewayInput) => {
      x.events[0].memberIds.pop();
    },
    (x: GatewayInput) => {
      x.events[0].memberIds[1] = x.events[0].memberIds[0];
    },
    (x: GatewayInput) => {
      x.readings[0].family = PG_VERSION;
    },
    (x: GatewayInput) => {
      x.completeness.note += ' changed';
    },
  ]) {
    const changed = structuredClone(state);
    mutate(changed);
    assert.throws(
      () => reconcileGateway(changed),
      /PG_EVENT_MEMBERS|PG_EVENT_CONTEXT/,
    );
  }
  const invalid = await fixture('negative-duplicate-transaction-even-invalid');
  r = reconcileGateway(invalid);
  assert.equal(r.memberIds.length, 8);
  invalid.events = [event(r, 'reject')];
  assert.equal(reconcileGateway(invalid).review, 'rejected');
  assert.deepEqual(
    (await restoreGateway(await saveGateway(invalid))).result,
    reconcileGateway(invalid),
  );
  for (const name of [
    'sar-component-cancellation',
    'missing-positive-fee-detail',
    'sar-refund-only-difference',
  ]) {
    const bad = await fixture(name);
    bad.completeness = { ...state.completeness };
    const result = reconcileGateway(bad);
    bad.events = [event(result, 'accept')];
    assert.throws(() => reconcileGateway(bad), /PG_EVENT_FINANCIAL/);
  }
});

void test('Signed gateway: original replay snapshots all four bytes, family and events before digest; cached signed amount is ignored', async () => {
  const state = await fixture('sar-mixed');
  const expected = reconcileGateway(state);
  state.files[0].sheets[0].rows[1][3] = '+999.00';
  assert.equal(reconcileGateway(state).totals![0], 104900);
  assert.deepEqual((await replayGateway(state)).result, expected);
  const subtle = crypto.subtle;
  // oxlint-disable-next-line typescript/unbound-method -- Restored unchanged; invoked with the original receiver.
  const digest = subtle.digest;
  let count = 0;
  subtle.digest = function (...args: Parameters<typeof digest>) {
    const pending = digest.apply(subtle, args);
    if (++count === 1) {
      new Uint8Array(state.files[3].original!).fill(0);
      state.readings[0].family = PG_VERSION;
      state.scope.batchId = 'different';
      state.completeness.confirmed = true;
      state.events = [event(expected, 'reject')];
    }
    return pending;
  };
  try {
    assert.deepEqual((await replayGateway(state)).result, expected);
  } finally {
    subtle.digest = digest;
  }
});

void test('Signed gateway: session originals, family, amount sign, hash and stale review context fail closed', async () => {
  const state = await fixture('sar-mixed');
  state.completeness = {
    confirmed: true,
    reference: 'Synthetic session attestation',
    note: 'Synthetic whole population',
  };
  const r = reconcileGateway(state);
  state.events = [event(r, 'accept')];
  const data = await saveGateway(state);
  const parsed = JSON.parse(new TextDecoder().decode(data));
  assert.equal(parsed.version, PG_VERSION);
  assert.equal(parsed.readings[0].family, PG_SIGNED_VERSION);
  const session = (p: unknown) =>
    new TextEncoder().encode(JSON.stringify(p)).buffer;
  for (const mutate of [
    (p: typeof parsed) => {
      p.readings[0].family = PG_VERSION;
    },
    (p: typeof parsed) => {
      p.readings[0].family = 'unrecognized';
    },
    (p: typeof parsed) => {
      p.readings[1].family = PG_SIGNED_VERSION;
    },
    (p: typeof parsed) => {
      p.extra = 'unsupported';
    },
    (p: typeof parsed) => {
      p.files[0].data = p.files[0].data.slice(4);
    },
    (p: typeof parsed) => {
      p.files[1] = p.files[0];
    },
  ]) {
    const p = structuredClone(parsed);
    mutate(p);
    await assert.rejects(
      () => restoreGateway(session(p)),
      /PG_EVENT_CONTEXT|PG_READING|PG_SESSION|PG_SOURCE_HASH|PG_INDEPENDENT_SOURCES/,
    );
  }
  const altered = structuredClone(parsed);
  const original = Buffer.from(altered.files[0].data, 'base64');
  const text = original.toString('utf8').replace('+100.00', '-100.00');
  altered.files[0].data = Buffer.from(text).toString('base64');
  await assert.rejects(
    () => restoreGateway(session(altered)),
    /PG_SOURCE_HASH/,
  );
  const updatedBytes = new TextEncoder().encode(text);
  altered.files[0].sha256 = Buffer.from(
    await crypto.subtle.digest('SHA-256', updatedBytes),
  ).toString('hex');
  await assert.rejects(
    () => restoreGateway(session(altered)),
    /PG_EVENT_CONTEXT/,
  );
  assert.deepEqual(
    (await restoreGateway(data)).result,
    reconcileGateway(state),
  );
  const old = await finishedGateway('accepted');
  assert.deepEqual(
    (await restoreGateway(await saveGateway(old.state))).result,
    old.result,
  );
  assert.ok(old.result.records[0].every((r) => r.signedAmount === undefined));
});

void test('Signed gateway: native original XML sign, dates and display guard regressions stay strict', async () => {
  const state = await supportedNativeFixture();
  assert.equal(state.files[0].sheets[0].rows[1][3], '+100.00');
  assert.deepEqual(
    reconcileGateway(state).records[0].map((r) => r.signedAmount!.signedMinor),
    [10000, -2000, 5000],
  );
  const modify = async (
    transform: (xml: string) => string,
    style?: (xml: string) => string,
  ) => {
    const zip = await JSZip.loadAsync(state.files[0].original!);
    const sheet = 'xl/worksheets/sheet1.xml';
    zip.file(sheet, transform(await zip.file(sheet)!.async('string')));
    if (style)
      zip.file(
        'xl/styles.xml',
        style(await zip.file('xl/styles.xml')!.async('string')),
      );
    return zip.generateAsync({ type: 'arraybuffer' });
  };
  const control = await modify((s) => s);
  assert.equal(
    (await readGatewayFile('control.xlsx', control)).sheets[0].rows[1][3],
    '+100.00',
  );
  for (const [name, transform] of [
    [
      'money-General',
      (s: string) => s.replace('<c r="D2" s="1">', '<c r="D2" s="0">'),
    ],
    [
      'hidden-row',
      (s: string) => s.replace('<row r="2"', '<row r="2" hidden="1"'),
    ],
    [
      'hidden-column',
      (s: string) =>
        s.replace(
          '<sheetData>',
          '<cols><col min="4" max="4" hidden="1"/></cols><sheetData>',
        ),
    ],
    [
      'merged-money',
      (s: string) =>
        s.replace(
          '</sheetData>',
          '</sheetData><mergeCells count="1"><mergeCell ref="D2:E2"/></mergeCells>',
        ),
    ],
    [
      'money-text',
      (s: string) =>
        s.replace(
          '<c r="D2" s="1"><v>+100.00</v></c>',
          '<c r="D2" s="1" t="inlineStr"><is><t>+100.00</t></is></c>',
        ),
    ],
    [
      'negative-zero',
      (s: string) => s.replace('<v>+100.00</v>', '<v>-0.00</v>'),
    ],
    [
      'native-arabic',
      (s: string) => s.replace('<v>+100.00</v>', '<v>+١٠٠٫٠٠</v>'),
    ],
    ['exponent', (s: string) => s.replace('<v>+100.00</v>', '<v>1e2</v>')],
    ['precision', (s: string) => s.replace('<v>+100.00</v>', '<v>100.001</v>')],
    [
      'sign-conflict',
      (s: string) => s.replace('<v>-20.00</v>', '<v>+20.00</v>'),
    ],
    [
      'cached-formula',
      (s: string) => s.replace('<v>+100.00</v>', '<f>1+99</f><v>100</v>'),
    ],
  ] as const) {
    const bytes = await modify(transform);
    assert.notDeepEqual(new Uint8Array(bytes), new Uint8Array(control), name);
    await assert.rejects(
      () => readGatewayFile(name + '.xlsx', bytes),
      /PG_NATIVE_DISPLAY|BANK_NATIVE_DISPLAY|قيمة رقمية غير صالحة في XML/,
      name,
    );
  }
  const mask = await modify(
    (s) => s,
    (s) =>
      s
        .replace('numFmtId="2"', 'numFmtId="164"')
        .replace('<styleSheet ', '<styleSheet ')
        .replace(
          '<fonts ',
          '<numFmts count="1"><numFmt numFmtId="164" formatCode="0.00;0.00;0.00"/></numFmts><fonts ',
        ),
  );
  await assert.rejects(
    () => readGatewayFile('mask-sign-zero.xlsx', mask),
    /BANK_NATIVE_DISPLAY/,
  );
  for (const inline of [false, true])
    for (const serial of [false, true]) {
      const native = await supportedNativeFixture(
        'sar-zero-kinds',
        inline,
        serial,
      );
      const replayed = await replayGateway(native);
      assert.deepEqual(
        replayed.result.totals,
        truths['sar-zero-kinds'].totalsMinor,
      );
      assert.equal(replayed.result.records[0].length, 4);
      assert.deepEqual(
        replayed.result.records[0].map((r) => r.signedAmount!.raw),
        ['0', '+0.00', '+00.0', '00'],
      );
      assert.equal(replayed.result.records[0][0].values[2], '2026-10-02');
      const forgery = structuredClone(native);
      forgery.files[0].sheets[0].rows[1][3] = '+999.00';
      await assert.rejects(
        () => assertGatewayNative(forgery.files[0]),
        /PG_NATIVE_DISPLAY/,
      );
      assert.deepEqual((await replayGateway(forgery)).result, replayed.result);
    }
  const dateControl = await supportedNativeFixture('sar-mixed', false, true);
  const dateZip = await JSZip.loadAsync(dateControl.files[0].original!);
  const dateXML = await dateZip
    .file('xl/worksheets/sheet1.xml')!
    .async('string');
  const fractional = dateXML.replace(
    /(<c r="C2"[^>]*><v>)([0-9]+)(<\/v><\/c>)/,
    (_, a, n, b) => a + n + '.5' + b,
  );
  assert.notEqual(fractional, dateXML);
  dateZip.file('xl/worksheets/sheet1.xml', fractional);
  await assert.rejects(
    async () =>
      readGatewayFile(
        'fractional-date.xlsx',
        await dateZip.generateAsync({ type: 'arraybuffer' }),
      ),
    /PG_NATIVE_DISPLAY/,
  );
});

void test('Signed gateway: other native roles keep unsigned raw XML grammar within a signed batch, while canonical reader behavior stays unchanged', async () => {
  const signed = await supportedNativeFixture();
  const old = await gatewayFixture('pending');
  for (let i = 0; i < 4; i++)
    old.files[i] = await readGatewayFile(
      `old-${i}.xlsx`,
      Uint8Array.from(
        await readFile(
          new URL(
            `../audit/payment-gateway/native/source-${i}.xlsx`,
            import.meta.url,
          ),
        ),
      ).buffer,
    );
  const baseline = (await replayGateway(old)).result;
  const alter = async (
    original: ArrayBuffer,
    cell: string,
    kind: 'plus' | 'exponent' | 'negative-zero',
  ) => {
    const zip = await JSZip.loadAsync(original);
    const path = 'xl/worksheets/sheet1.xml';
    const xml = await zip.file(path)!.async('string');
    const changed = xml.replace(
      new RegExp(`(<c r="${cell}"[^>]*><v>)([^<]+)(</v></c>)`),
      (_, a, n, b) =>
        a +
        (kind === 'plus' ? '+' + n : kind === 'exponent' ? n + 'e0' : '-0.00') +
        b,
    );
    assert.notEqual(changed, xml);
    zip.file(path, changed);
    return zip.generateAsync({ type: 'arraybuffer' });
  };
  for (const kind of ['plus', 'exponent'] as const) {
    const canonical = structuredClone(old);
    canonical.files[1] = await readGatewayFile(
      'canonical-fee.xlsx',
      await alter(old.files[1].original!, 'C2', kind),
    );
    assert.deepEqual(
      (await replayGateway(canonical)).result.totals,
      baseline.totals,
    );
  }
  for (const [source, cell] of [
    [1, 'C2'],
    [2, 'F2'],
    [3, 'C2'],
  ] as const)
    for (const kind of ['plus', 'exponent', 'negative-zero'] as const) {
      const changed = structuredClone(signed);
      const bytes = await alter(signed.files[source].original!, cell, kind);
      changed.files[source] = await readGatewayFile(
        `other-role-${source}.xlsx`,
        bytes,
      );
      await assert.rejects(() => replayGateway(changed), /PG_NATIVE_DISPLAY/);
    }
});

void test('Signed gateway: export separates raw signed lexemes and canonical magnitudes, retains every zero and all four source bytes', async () => {
  const artifacts: {
    workbook: string;
    session: string;
    case: string;
    phase: string;
  }[] = [];
  const directory = new URL(
    '../work/payment-gateway-signed/exports/',
    import.meta.url,
  );
  for (const name of [
    'sar-mixed',
    'sar-zero-kinds',
    'sar-arabic-persian',
    'supported-native-shared',
    'supported-native-inline-date14',
  ]) {
    const state = name.startsWith('supported-native-')
      ? await supportedNativeFixture(
          name.endsWith('date14') ? 'sar-blank-row-permutation' : 'sar-mixed',
          name.endsWith('date14'),
          name.endsWith('date14'),
        )
      : await fixture(name);
    if (name === 'sar-zero-kinds') {
      state.completeness = {
        confirmed: true,
        reference: 'Synthetic export attestation',
        note: 'All explicit zero members retained',
      };
      state.events = [event(reconcileGateway(state), 'accept')];
    }
    const fresh = await replayGateway(state);
    const session = await saveGateway(fresh.state);
    const restored = await restoreGateway(session);
    assert.deepEqual(restored.result, fresh.result);
    const data = await exportGateway(restored.state, restored.result);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(data as never);
    const transactions = book.getWorksheet('Transactions')!;
    assert.deepEqual((transactions.getRow(1).values as unknown[]).slice(1), [
      'Record ID',
      'Source',
      'Source row',
      'Transaction ID',
      'Kind',
      'Posting date',
      'Signed amount',
      'Reference',
      'Signed minor units',
      'Canonical magnitude minor units',
      'Original sign',
      'Normalized signed amount',
      'Representation',
    ]);
    assert.equal(transactions.rowCount - 1, restored.result.records[0].length);
    restored.result.records[0].forEach((r, i) => {
      assert.equal(
        transactions.getRow(i + 2).getCell(7).value,
        r.signedAmount!.raw,
      );
      assert.equal(
        transactions.getRow(i + 2).getCell(9).value,
        r.signedAmount!.signedMinor,
      );
      assert.equal(
        transactions.getRow(i + 2).getCell(10).value,
        r.signedAmount!.magnitude,
      );
      assert.equal(
        transactions.getRow(i + 2).getCell(3).value,
        r.signedAmount!.physicalRow,
      );
    });
    const sources = book.getWorksheet('Sources')!;
    for (let source = 0; source < 4; source++) {
      const chunks: string[] = [];
      sources.eachRow((row, i) => {
        if (i > 1 && row.getCell(1).value === source) {
          assert.equal(
            row.getCell(3).value,
            restored.state.files[source].sha256,
          );
          const chunk = row.getCell(5).value;
          assert.ok(typeof chunk === 'string');
          chunks[Number(row.getCell(4).value)] = chunk;
        }
      });
      assert.deepEqual(
        new Uint8Array(Buffer.from(chunks.join(''), 'base64')),
        new Uint8Array(restored.state.files[source].original!),
      );
    }
    assert.equal(
      book.getWorksheet('Event members')!.rowCount - 1,
      restored.result.events.reduce((n, e) => n + e.memberIds.length, 0),
    );
    assert.equal(
      book.getWorksheet('Inventory')!.rowCount - 1,
      restored.result.inventory.length,
    );
    await mkdir(directory, { recursive: true });
    await writeFile(new URL(name + '.xlsx', directory), new Uint8Array(data));
    await writeFile(
      new URL(name + '.json', directory),
      new Uint8Array(session),
    );
    artifacts.push({
      workbook: name + '.xlsx',
      session: name + '.json',
      case:
        name === 'supported-native-shared'
          ? 'sar-mixed'
          : name === 'supported-native-inline-date14'
            ? 'sar-blank-row-permutation'
            : name,
      phase: 'restored',
    });
    await assert.rejects(
      () =>
        exportGateway(fresh.state, {
          ...fresh.result,
          readings: fresh.result.readings.map((r, i) =>
            i === 0 ? { ...r, family: PG_VERSION } : r,
          ) as GatewayInput['readings'],
        }),
      /PG_STALE_EXPORT/,
    );
  }
  await writeFile(
    new URL('index.json', directory),
    JSON.stringify({ synthetic: true, artifacts }, null, 2) + '\n',
  );
});
