import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
export async function checkHierarchyExportControls(out, sources) {
  const input = path.join(out, 'INV1D-P01-pending-direct.xlsx'),
    checker = path.resolve(
      import.meta.dirname,
      '../audit/inventory-hierarchy-sections/check_export.py',
    ),
    folder = path.join(sources, 'INV1D-P01');
  const run = (p) =>
    spawnSync(
      process.env.PYTHON ?? 'python3',
      ['-B', checker, '--workbook', p, '--case-dir', folder],
      { encoding: 'utf8', timeout: 30000 },
    );
  const mutations = [
    [
      'quantity-same-money',
      (b) => {
        b.getWorksheet('Register').getCell('F2').value = 126;
      },
    ],
    [
      'money-swap-same-total',
      (b) => {
        const s = b.getWorksheet('Register'),
          a = s.getCell('I2').value;
        s.getCell('I2').value = s.getCell('I3').value;
        s.getCell('I3').value = a;
      },
    ],
    [
      'wrong-dimension-same-money',
      (b) => {
        b.getWorksheet('Register').getCell('E2').value =
          'warehouse=W2;batch=B7';
      },
    ],
    [
      'foreign-parent-citation',
      (b) => {
        const s = b.getWorksheet('Hierarchy citations');
        for (let r = 2; r <= s.rowCount; r++)
          if (
            s.getCell(r, 8).value === 'warehouse' &&
            s.getCell(r, 10).value === 'dimension-value'
          ) {
            s.getCell(r, 6).value = 25;
            s.getCell(r, 9).value = 'W2';
            break;
          }
      },
    ],
    [
      'substituted-source',
      (b) => {
        const s = b.getWorksheet('Sources');
        s.getCell('H2').value = 'eA==';
      },
    ],
  ];
  const reports = [];
  for (const [name, edit] of [
    ['positive-rewrite-control', null],
    ...mutations,
  ]) {
    const b = new ExcelJS.Workbook();
    await b.xlsx.load(await readFile(input));
    if (edit) edit(b);
    const p = path.join(out, name + '.xlsx');
    await writeFile(p, Buffer.from(await b.xlsx.writeBuffer()));
    const r = run(p);
    assert.equal(r.signal, null, name);
    assert.ok(!r.error, name);
    if (edit) {
      assert.notEqual(r.status, 0, name);
      assert.match(r.stderr, /AssertionError/, name);
    } else assert.equal(r.status, 0, r.stderr);
    reports.push({ name, expectedPass: !edit, matched: true });
  }
  await writeFile(
    path.join(out, 'EXPORT-CONTROLS.json'),
    JSON.stringify(reports, null, 2) + '\n',
  );
  return reports;
}
