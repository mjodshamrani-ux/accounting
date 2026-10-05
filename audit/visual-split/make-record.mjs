// Known synthetic manual reviews, not inferred or automatically approved OCR.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createVisualDraft } from '../../lib/reconciliation/visual-draft.ts';
import { VISUAL_ENGINE } from '../../lib/reconciliation/visual-assets.ts';
import {
  createVisualReview,
  editVisualRegion,
  confirmVisualRegion,
} from '../../lib/reconciliation/visual-review.ts';
import {
  createVisualTable,
  editVisualTableRow,
  confirmVisualTableExclusion,
  confirmVisualTableCoverage,
} from '../../lib/reconciliation/visual-table.ts';
import {
  createVisualAccountingRecord,
  saveVisualAccountingRecord,
} from '../../lib/reconciliation/visual-accounting-source.ts';
const at = '2026-10-04T10:00:00.000Z';
export const splitLiteral = (value, lang) =>
  value === null
    ? null
    : lang === 'ar'
      ? String(value)
          .replace('Total', 'الإجمالي')
          .replaceAll('.', '٫')
          .replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)])
      : value;
export async function knownSplitSource(lang = 'en', changes = {}) {
  const contract = JSON.parse(
    await readFile('audit/visual-split/contract.json', 'utf8'),
  );
  if (lang === 'ar')
    contract.ledger = contract.ledger.map((row, i) =>
      i ? [splitLiteral(row[0], lang), ...row.slice(1)] : row,
    );
  const original = new Uint8Array(
    await readFile(`audit/visual-split/fixtures/${lang}.png`),
  );
  const blocks = JSON.parse(
    await readFile(`audit/visual-split/fixtures/${lang}-ocr.json`, 'utf8'),
  );
  const draft = createVisualDraft(
    {
      source: {
        name: `${lang}-split.png`,
        sha256: createHash('sha256').update(original).digest('hex'),
      },
      expectedPages: 1,
      engine: VISUAL_ENGINE,
      pages: [
        {
          page: 1,
          width: 1400,
          height: 860,
          imageDataUrl:
            'data:image/png;base64,' + Buffer.from(original).toString('base64'),
          blocks,
        },
      ],
    },
    createHash('sha256').update(original).digest('hex'),
  );
  let image = await createVisualReview(draft, original);
  const headers = [],
    cells = [];
  let serial = 0;
  async function add(role, value, region) {
    const id = `region:${++serial}`;
    image = editVisualRegion(image, id, role, value, region);
    image = await confirmVisualRegion(image, id, at);
    return id;
  }
  for (const [i, value] of contract.headers[lang].entries())
    headers.push(
      await add('reference', value, {
        x0: contract.grid.columnCuts[i] + 8,
        x1: contract.grid.columnCuts[i + 1] - 8,
        y0: contract.headerY[0],
        y1: contract.headerY[1],
      }),
    );
  const currencyProof = await add('currency', 'SAR', contract.currencyRegion);
  for (const [i, row] of contract.rows.entries()) {
    const ids = [];
    for (const [col, originalValue] of row.entries()) {
      const value = Object.hasOwn(changes.cells ?? {}, `${i}:${col}`)
        ? changes.cells[`${i}:${col}`]
        : splitLiteral(originalValue, lang);
      ids.push(
        value === null || value === ''
          ? null
          : await add(col < 2 ? contract.roles[col] : 'amount', value, {
              x0: contract.grid.columnCuts[col] + 8,
              x1: contract.grid.columnCuts[col + 1] - 8,
              y0: contract.grid.rowCuts[i] + 8,
              y1: contract.grid.rowCuts[i + 1] - 8,
            }),
      );
    }
    cells.push(ids);
  }
  let table = await createVisualTable(image, {
    ...contract.grid,
    roles: changes.roles ?? contract.roles,
  });
  for (const [i, ids] of cells.entries())
    table = editVisualTableRow(table, i, {
      disposition: i === cells.length - 1 ? 'non-movement' : 'movement',
      note:
        i === cells.length - 1 ? 'Printed total row, retained for audit' : '',
      cells: ids,
    });
  table = await confirmVisualTableExclusion(table, cells.length - 1, at);
  table = await confirmVisualTableCoverage(table, at);
  const context = { ...contract.context, ...changes.context };
  const record = await createVisualAccountingRecord(
    table,
    headers,
    context,
    at,
    currencyProof,
  );
  return {
    contract,
    original,
    lang,
    table,
    context,
    headers,
    currencyProof,
    record,
    bytes: await saveVisualAccountingRecord(record),
  };
}
if (process.argv[1]?.endsWith('/make-record.mjs')) {
  const out = process.argv[2] ?? 'work/visual-split';
  await mkdir(out, { recursive: true });
  for (const lang of ['en', 'ar']) {
    const f = await knownSplitSource(lang);
    await writeFile(`${out}/${lang}.tarasuf-reviewed.json`, f.bytes);
  }
  const { contract } = await knownSplitSource();
  await writeFile(
    `${out}/ledger.csv`,
    contract.ledger.map((r) => r.join(',')).join('\n'),
  );
}
