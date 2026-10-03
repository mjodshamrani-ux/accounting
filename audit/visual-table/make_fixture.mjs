import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

// Frozen known development facts, specified before OCR or table review.
// This is not a field sample, training corpus or independent holdout.
const grid = { region: { x0: 80, y0: 220, x1: 1120, y1: 580 },
  rowCuts: [220, 340, 460, 580], columnCuts: [80, 350, 620, 850, 1120],
  roles: ['reference', 'date', 'amount', 'balance'] };
const expected = ['INV-001', '2026-07-01', '-\u0662\u0665\u0660\u066b\u0660\u0660', '\u0669\u066c\u0669\u0669\u0669\u066b\u0660\u0660'];
const out = process.argv[2] ?? 'audit/visual-table/fixtures';
try { await readFile(`${out}/contract.json`); throw new Error('Never overwrite a frozen fixture; choose a new directory.'); }
catch (e) { if (e.code !== 'ENOENT') throw e; }
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const png = await page.evaluate(({ grid, expected }) => {
    const c = document.createElement('canvas'); c.width = 1200; c.height = 760;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#111827'; ctx.font = '32px Arial'; ctx.fillText('SYNTHETIC SUPPLIER STATEMENT', 80, 75);
    ctx.font = '20px Arial'; ctx.fillText('Known development fixture / SAR / July 2026', 80, 125);
    ['Reference', 'Date', 'Movement', 'Balance'].forEach((s, i) => ctx.fillText(s, grid.columnCuts[i] + 12, 195));
    const rows = [expected, ['INV-002', '2026-07-02', '[damaged]', '9,800.00'], ['Closing total', '', '750.00', '9,999.00']];
    ctx.font = '28px Arial'; ctx.direction = 'ltr';
    rows.forEach((values, r) => values.forEach((s, col) => ctx.fillText(s, grid.columnCuts[col] + 12, grid.rowCuts[r] + 70)));
    ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1;
    grid.rowCuts.forEach(y => { ctx.beginPath(); ctx.moveTo(80, y); ctx.lineTo(1120, y); ctx.stroke(); });
    grid.columnCuts.forEach(x => { ctx.beginPath(); ctx.moveTo(x, 220); ctx.lineTo(x, 580); ctx.stroke(); });
    ctx.font = '20px Arial'; ctx.fillText('Damaged row is unresolved. The total is not a transaction.', 80, 665);
    return c.toDataURL('image/png').split(',')[1];
  }, { grid, expected });
  const bytes = Buffer.from(png, 'base64');
  const contract = { version: 1, classification: 'known synthetic development; manual geometry and literal input, not holdout or automatic extraction',
    source: { name: 'statement.png', width: 1200, height: 760, bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex') }, grid,
    rows: [
      { id: 'row:1', disposition: 'movement', expected,
        crops: grid.roles.map((role, i) => ({ role: role === 'balance' ? 'amount' : role,
          region: { x0: grid.columnCuts[i] + 8, x1: grid.columnCuts[i + 1] - 8, y0: 240, y1: 320 } })) },
      { id: 'row:2', disposition: 'unreadable', note: 'Damaged original amount; no guessed value' },
      { id: 'row:3', disposition: 'non-movement', note: 'Printed closing total, not a movement' },
    ], renderer: { browser: browser.version(), canvas: 'native Chromium 2D', font: 'Arial platform font' },
    required: { rows: 3, movements: 1, unreadable: 1, excluded: 1, reviewedValues: 4, financialPromotion: false } };
  await mkdir(out, { recursive: true });
  await writeFile(`${out}/statement.png`, bytes);
  await writeFile(`${out}/contract.json`, JSON.stringify(contract, null, 2) + '\n');
  console.log(JSON.stringify({ frozenBeforeOcr: true, source: contract.source }));
} finally { await browser.close(); }
