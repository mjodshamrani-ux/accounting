import { mkdir, writeFile } from 'node:fs/promises';
import {
  pngFixture,
  draftFixture,
} from '../../tests/visual-evidence-fixture.ts';
import {
  createVisualReview,
  editVisualCell,
  confirmVisualCell,
  saveVisualReview,
} from '../../lib/reconciliation/visual-review.ts';
const output = process.argv[2] ?? 'work/p6-oracle';
await mkdir(output, { recursive: true });
const original = pngFixture();
let record = await createVisualReview(
  draftFixture(original.bytes),
  original.bytes,
);
for (const [wordId, role, literal] of record.draft.pages[0].words.map((w) => [
  w.id,
  w.text === '-250.00' ? 'amount' : 'reference',
  w.text,
])) {
  record = editVisualCell(record, wordId, role, literal);
  record = await confirmVisualCell(record, wordId, '2026-10-01T09:00:00.000Z');
}
await writeFile(`${output}/source.png`, original.bytes);
await writeFile(`${output}/record.json`, await saveVisualReview(record));
