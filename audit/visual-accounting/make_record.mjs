// Build only a known, manually supplied review fixture. The source OCR record
// is preserved; this script does not infer headers, roles or numeric truth.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import {
  restoreVisualTable,
  createVisualTable,
  editVisualTableRow,
  confirmVisualTableExclusion,
  confirmVisualTableCoverage,
} from '../../lib/reconciliation/visual-table.ts';
import {
  editVisualRegion,
  confirmVisualRegion,
} from '../../lib/reconciliation/visual-review.ts';
import {
  createVisualAccountingRecord,
  saveVisualAccountingRecord,
} from '../../lib/reconciliation/visual-accounting-source.ts';
const at = '2026-10-04T09:00:00.000Z';
export async function knownVisualSource(
  input = 'audit/visual-table/baseline/reviewed.json',
  changes = {},
) {
  const baseline = await restoreVisualTable(
    new Uint8Array(await readFile(input)),
  );
  const contract = JSON.parse(
    await readFile('audit/visual-accounting/contract.json', 'utf8'),
  );
  let image = baseline.image;
  if (changes.amount1 !== undefined) {
    image = editVisualRegion(
      image,
      'region:3',
      'amount',
      changes.amount1,
      image.regions.find((r) => r.id === 'region:3').region,
    );
    image = await confirmVisualRegion(image, 'region:3', at);
  }
  const headers = contract.headers.map((value, i) => ({
    id: `region:${i + 5}`,
    role: 'reference',
    value,
    region: {
      x0: baseline.grid.columnCuts[i] + 8,
      x1: baseline.grid.columnCuts[i + 1] - 8,
      y0: 170,
      y1: 215,
    },
  }));
  const additional = [
    ...headers,
    {
      id: 'region:9',
      role: 'reference',
      value: changes.reference2 ?? 'INV-002',
      region: { x0: 88, x1: 342, y0: 360, y1: 440 },
    },
    {
      id: 'region:10',
      role: 'date',
      value: '2026-07-02',
      region: { x0: 358, x1: 612, y0: 360, y1: 440 },
    },
    ...(changes.amount2 === undefined
      ? []
      : [
          {
            id: 'region:12',
            role: 'amount',
            value: changes.amount2,
            region: { x0: 628, x1: 842, y0: 360, y1: 440 },
          },
        ]),
  ];
  const sar = image.draft.pages[0].words.find((w) => w.text === 'SAR');
  additional.push({
    id: 'region:11',
    role: 'currency',
    value: changes.currencyLiteral ?? 'SAR',
    region: {
      x0: Math.floor(sar.bbox.x0) - 2,
      x1: Math.ceil(sar.bbox.x1) + 2,
      y0: Math.floor(sar.bbox.y0) - 2,
      y1: Math.ceil(sar.bbox.y1) + 2,
    },
  });
  for (const c of additional) {
    image = editVisualRegion(image, c.id, c.role, c.value, c.region);
    image = await confirmVisualRegion(image, c.id, at);
  }
  let table = await createVisualTable(image, baseline.grid);
  table = editVisualTableRow(table, 0, {
    disposition: 'movement',
    note: '',
    cells: ['region:1', 'region:2', 'region:3', 'region:4'],
  });
  table = editVisualTableRow(table, 1, {
    disposition: 'movement',
    note: '',
    cells: [
      'region:9',
      'region:10',
      changes.amount2 === undefined ? null : 'region:12',
      null,
    ],
  });
  table = editVisualTableRow(table, 2, {
    disposition: 'non-movement',
    note: contract.excluded,
    cells: [null, null, null, null],
  });
  table = await confirmVisualTableExclusion(table, 2, at);
  table = await confirmVisualTableCoverage(table, at);
  const context = { ...contract.context, ...changes.context };
  const selected = headers.map((c) => c.id);
  const currencyProof = 'region:11';
  const record = await createVisualAccountingRecord(
    table,
    selected,
    context,
    at,
    currencyProof,
  );
  return {
    table,
    headers: selected,
    context,
    currencyProof,
    record,
    bytes: await saveVisualAccountingRecord(record),
    contract,
  };
}
if (process.argv[1]?.endsWith('/make_record.mjs')) {
  const out = process.argv[2] ?? 'work/visual-accounting';
  const input = process.argv[3] ?? 'audit/visual-table/baseline/reviewed.json';
  const f = await knownVisualSource(input);
  await mkdir(out, { recursive: true });
  await writeFile(`${out}/statement.tarasuf-reviewed.json`, f.bytes);
  const csv = f.contract.ledger
    .map((r) => r.map((s) => '"' + s.replaceAll('"', '""') + '"').join(','))
    .join('\n');
  await writeFile(`${out}/ledger.csv`, csv);
  console.log(
    JSON.stringify({
      out,
      sourceBytes: f.bytes.length,
      kind: f.record.kind,
      manual: true,
      training: false,
    }),
  );
}
