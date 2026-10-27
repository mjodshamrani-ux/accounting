// AR-1 PDF A1: the product reads each sealed customer statement PDF exactly
// as the independent oracle reads the printed facts. The oracle is run in
// Python on the facts (stories.json), never on the PDF; the product reads
// only the PDF bytes. Compared line by line: what every line is, the
// document header, the sections with their scope and pages, every detail
// line's document, type, date and amount, and every error with its place.
//   node --experimental-strip-types scripts/ar-statement-reading-proof.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const suite = path.join(root, 'audit/ar-statement-foundation');
const frozen = path.join(suite, 'frozen');
const { readNativePdfWordSource } = await import(
  path.join(root, 'lib/reconciliation/pdf.ts')
);
const { readArStatementPdf } = await import(
  path.join(root, 'lib/reconciliation/ar-statement-pdf.ts')
);

const oracleReading = JSON.parse(
  execFileSync(
    'python3',
    [
      '-B',
      '-c',
      `import json, sys
sys.path.insert(0, ${JSON.stringify(suite)})
import oracle
facts = json.load(open(${JSON.stringify(path.join(frozen, 'stories.json'))}, encoding='utf-8'))
out = {}
for s in facts['stories']:
    doc, sections, inventory, errors = oracle.read_statement(s['statement']['pages'])
    out[s['id']] = {'document': doc, 'sections': sections, 'inventory': inventory, 'errors': errors}
print(json.dumps(out, ensure_ascii=False))`,
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  ),
);

const summary = [];
for (const [id, want] of Object.entries(oracleReading)) {
  const bytes = await readFile(path.join(frozen, `${id}-statement.pdf`));
  const got = readArStatementPdf(
    await readNativePdfWordSource(Uint8Array.from(bytes).buffer),
  );
  const where = (l) => [l.page, l.line];
  assert.deepEqual(got.document, want.document, `${id} document header`);
  assert.deepEqual(
    got.lines.map((l) => [...where(l), l.kind, l.code ?? null]),
    want.inventory.map((i) => [...i.where, i.kind, i.code ?? null]),
    `${id} line kinds`,
  );
  assert.deepEqual(
    got.sections.map((s) => ({ scope: s.scope, pages: s.pages })),
    want.sections.map((s) => ({ scope: s.scope, pages: s.pages })),
    `${id} sections`,
  );
  for (const [k, s] of want.sections.entries())
    assert.deepEqual(
      got.lines
        .filter((l) => l.kind === 'detail' && l.section === k)
        .map((l) => ({
          where: where(l),
          kind: l.detail.kind,
          document: l.detail.document,
          date: l.detail.date,
          amount: l.detail.amount,
          related: l.detail.related,
        })),
      s.lines,
      `${id} section ${k + 1} details`,
    );
  assert.deepEqual(
    got.errors.map((e) => [e.code, e.page, e.line]),
    want.errors.map((e) => [e.code, ...e.where]),
    `${id} errors`,
  );
  summary.push({
    id,
    lines: got.lines.length,
    sections: got.sections.length,
    details: got.lines.filter((l) => l.kind === 'detail').length,
    errors: got.errors.map((e) => e.code),
  });
}
console.log(
  JSON.stringify({
    statements: summary.length,
    lines: summary.reduce((n, s) => n + s.lines, 0),
    details: summary.reduce((n, s) => n + s.details, 0),
    stories: summary,
  }),
);
