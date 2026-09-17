/** Actual local timings; deliberately not a claim about browser/device performance. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import ExcelJS from 'exceljs';
import { readFile, exportWorkbook } from '../../lib/reconciliation/io.ts';
import { normalizeSource, compare } from '../../lib/reconciliation/core.ts';
import {
  defaultMapping,
  MAX_ROWS,
  MAX_FILE_BYTES,
  MAX_SHEETS,
} from '../../lib/reconciliation/types.ts';
import { MAX_AUTOMATIC_GROUP_MEMBERS } from '../../lib/reconciliation/cases.ts';
const args = process.argv.slice(2),
  arg = (name, fallback) =>
    args
      .find((value) => value.startsWith(name + '='))
      ?.slice(name.length + 1) ?? fallback;
const script = fileURLToPath(import.meta.url),
  repo = resolve(dirname(script), '../..');
const money = (minor) => {
  const digits = String(Math.abs(minor)).padStart(3, '0');
  return `${minor < 0 ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`;
};
const rounded = (value) => Number(value.toFixed(3));
async function childRun(size, format, includeExport) {
  const stages = {},
    rss = {},
    start = performance.now();
  const mark = (stage, from) => {
    stages[stage] = rounded(performance.now() - from);
    rss[stage] = process.memoryUsage().rss;
  };
  let t = performance.now();
  const rows = [
    ['Date', 'Reference', 'Document Type', 'Description', 'Amount', 'Currency'],
  ];
  const expected = [];
  let total = 0n;
  for (let i = 0; i < size; i++) {
    const kind =
      i % 7 === 0 ? 'Payment' : i % 11 === 0 ? 'Credit Note' : 'Invoice';
    const minor = (kind === 'Invoice' ? 1 : -1) * (10101 + ((i * 97) % 999999));
    const reference = `${kind === 'Invoice' ? 'INV' : kind === 'Payment' ? 'PAY' : 'CN'}-${String(100000 + i)}`;
    rows.push([
      `2026-07-${String(1 + (i % 28)).padStart(2, '0')}`,
      reference,
      kind,
      `${kind} commercial entry`,
      money(minor),
      'SAR',
    ]);
    expected.push({ minor, reference });
    total += BigInt(minor);
  }
  let bytes;
  if (format === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('Transactions');
    rows.forEach((row) => sheet.addRow(row));
    bytes = new Uint8Array(await wb.xlsx.writeBuffer());
  } else
    bytes = new TextEncoder().encode(
      rows.map((row) => row.join(',')).join('\r\n'),
    );
  mark('inputGenerationMs', t);
  const scope = {
    supplier: 'Performance supplier',
    entity: 'Performance buyer',
    account: 'AP-231',
    currency: 'SAR',
    decimals: 2,
    cutoff: '2026-07-31',
    dateWindow: 2,
    confirmed: true,
    coverageConfirmed: false,
  };
  t = performance.now();
  const files = await Promise.all(
    ['supplier', 'ledger'].map((side) =>
      readFile(`${side}.${format}`, new Uint8Array(bytes).buffer),
    ),
  );
  mark('readPairMs', t);
  t = performance.now();
  const mapping = {
    ...defaultMapping(),
    date: 0,
    reference: 1,
    description: 3,
    amount: 4,
    currencyColumn: 5,
  };
  const sources = files.map((file, i) =>
    normalizeSource(file, mapping, scope, i ? 'ledger' : 'supplier'),
  );
  for (const source of sources) {
    assert.deepEqual(source.errors, []);
    assert.equal(source.transactions.length, size);
    assert.equal(BigInt(source.total), total);
  }
  mark('normalizePairMs', t);
  t = performance.now();
  const result = compare(sources[0], sources[1], scope);
  mark('compareMs', t);
  assert.equal(result.matches.length, size);
  const members = result.cases.flatMap((c) => [
    ...c.supplierMembers,
    ...c.ledgerMembers,
  ]);
  assert.equal(members.length, size * 2);
  assert.equal(new Set(members.map((row) => row.id)).size, size * 2);
  let exportBytes = null;
  if (includeExport) {
    t = performance.now();
    const exported = await exportWorkbook(result, files, {
      checked: false,
      name: '',
      notes: '',
    });
    mark('exportMs', t);
    exportBytes = exported.byteLength;
    t = performance.now();
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(exported);
    for (const name of ['Supplier transactions', 'Ledger transactions']) {
      const sheet = book.getWorksheet(name);
      assert.ok(sheet);
      assert.equal(sheet.rowCount, size + 1);
      let exportedTotal = 0n;
      for (let i = 0; i < size; i++) {
        assert.equal(sheet.getCell(i + 2, 5).value, expected[i].reference);
        const amount = sheet.getCell(i + 2, 8).value;
        assert.equal(typeof amount, 'number');
        assert.equal(Math.round(amount * 100), expected[i].minor);
        exportedTotal += BigInt(Math.round(amount * 100));
      }
      assert.equal(exportedTotal, total);
    }
    mark('roundtripExportReadMs', t);
  }
  return {
    rowsPerSource: size,
    inputFormat: format,
    inputBytesPerFile: bytes.byteLength,
    exportBytes,
    stages,
    rssBytesAfterStage: rss,
    peakRssBytes: process.resourceUsage().maxRSS * 1024,
    totalMs: rounded(performance.now() - start),
    verifiedMatches: result.matches.length,
    exportRoundtripChecked: includeExport,
    pass: true,
  };
}
async function boundedChild(size, format, includeExport, timeoutMs) {
  return new Promise((resolveRun) => {
    const child = spawn(
      process.execPath,
      [
        '--experimental-strip-types',
        script,
        `--child=${size}`,
        `--format=${format}`,
        `--export=${includeExport ? 'yes' : 'no'}`,
      ],
      { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '',
      stderr = '',
      timedOut = false;
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        try {
          return resolveRun(JSON.parse(stdout));
        } catch {}
      }
      resolveRun({
        rowsPerSource: size,
        inputFormat: format,
        pass: false,
        timedOut,
        exitCode: code,
        error: stderr.slice(-2500),
        stdout: stdout.slice(-1200),
      });
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolveRun({
        rowsPerSource: size,
        inputFormat: format,
        pass: false,
        error: error.message,
      });
    });
  });
}
if (arg('--child', null) !== null) {
  try {
    console.log(
      JSON.stringify(
        await childRun(
          Number(arg('--child', '100')),
          arg('--format', 'csv'),
          arg('--export', 'yes') === 'yes',
        ),
      ),
    );
  } catch (error) {
    console.error(error.stack ?? error);
    process.exitCode = 1;
  }
} else {
  const sizes = arg('--sizes', '100,1000,5000').split(',').map(Number),
    formats = arg('--formats', 'csv,xlsx').split(','),
    timeoutMs = Number(arg('--timeout-ms', '60000')),
    maxExportRows = Number(arg('--max-export-rows', '5000'));
  assert.ok(
    sizes.every(
      (size) => Number.isSafeInteger(size) && size > 0 && size <= MAX_ROWS,
    ),
  );
  assert.ok(formats.every((format) => ['csv', 'xlsx'].includes(format)));
  assert.ok(timeoutMs > 0 && timeoutMs <= 60000);
  const records = [];
  for (const size of sizes)
    for (const format of formats) {
      const result = await boundedChild(
        size,
        format,
        size <= maxExportRows,
        timeoutMs,
      );
      records.push(result);
      console.log(JSON.stringify(result));
    }
  const report = {
    runAt: new Date().toISOString(),
    runtime: process.version,
    machine: {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      cpuModel: os.cpus()[0]?.model,
      logicalCpus: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
    },
    method:
      'Isolated Node process per size/format, two actual input files; explicit visible mapping; no running balance; invoice/payment/credit entries; no network; no browser responsiveness claim. Export is reopened with ExcelJS, the same library used by production; this is a roundtrip check, not an independent export implementation.',
    limits: {
      maxRows: MAX_ROWS,
      maxFileBytes: MAX_FILE_BYTES,
      maxSheets: MAX_SHEETS,
      maxAutomaticGroupMembers: MAX_AUTOMATIC_GROUP_MEMBERS,
      pdfPages: 20,
      pdfLimitEvidence:
        'lib/reconciliation/pdf.ts readPdf doc.numPages guard; existing tests/pdf.test.ts rejects 21 pages',
    },
    timeoutMsPerCase: timeoutMs,
    maxExportRows,
    records,
    pass: records.every((record) => record.pass),
  };
  const out = arg(
    '--out',
    resolve(repo, '../../work/reliability-performance-045.json'),
  );
  await fs.mkdir(dirname(out), { recursive: true });
  await fs.writeFile(out, JSON.stringify(report, null, 2) + '\n');
  console.log(`Saved ${out}`);
  if (!report.pass) process.exitCode = 1;
}
