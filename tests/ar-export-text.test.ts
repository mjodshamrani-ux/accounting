import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile as fsRead, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile } from '../lib/reconciliation/io.ts';
import { reconcileAr, type ArInput } from '../lib/reconciliation/ar.ts';
import { arDemoReadings, arDemoScope } from '../lib/reconciliation/ar-demo.ts';
import { exportAr, saveAr, restoreAr } from '../lib/reconciliation/ar-io.ts';

async function fixture(note: string): Promise<ArInput> {
  const files = await Promise.all(
    ['ledger', 'statement'].map(async (side) =>
      readFile(
        `${side}.csv`,
        new Uint8Array(
          await fsRead(
            new URL(
              `../audit/ar-limited/frozen/positive-${side}.csv`,
              import.meta.url,
            ),
          ),
        ).buffer,
      ),
    ),
  );
  const input: ArInput = {
    files: files as ArInput['files'],
    readings: structuredClone(arDemoReadings),
    scope: { ...arDemoScope },
    events: [],
  };
  const result = reconcileAr(input);
  input.events.push({
    context: result.context,
    action: 'reopen',
    ids: result.cases.find((c) => c.status === 'matched')!.ids,
    at: '2026-10-06T00:00:00.000Z',
    note,
  });
  return input;
}

void test('AR export rejects invalid XML or Unicode notes without changing decisions, membership or money', async () => {
  for (const invalid of [
    '\u0001',
    '\u0000',
    '\u000b',
    '\ufffe',
    '\uffff',
    '\ud800',
    '\udfff',
  ]) {
    const input = await fixture('Synthetic review ' + invalid + ' note');
    const result = reconcileAr(input),
      before = structuredClone({ input, result });
    const restored = await restoreAr(await saveAr(input));
    assert.equal(restored.state.events[0].note, input.events[0].note);
    await assert.rejects(exportAr(input, result), /محارف|Unicode/);
    assert.deepEqual({ input, result }, before);
    assert.deepEqual(restored.result, result);
  }
  const long = await fixture('x'.repeat(201));
  assert.throws(() => reconcileAr(long), /AR_DECISION/);
});

void test('AR export validates source-name text that bypasses native cell validation', async () => {
  const input = await fixture('Synthetic source-name review');
  input.files[0].name = 'ledger\u0001.csv';
  const result = reconcileAr(input);
  await assert.rejects(exportAr(input, result), /محارف|Unicode/);
});

void test('AR Unicode, tabs, line breaks and formula-like notes survive sessions and independent OpenXML reading exactly', async () => {
  const note =
    '= ملاحظة عربية 🧾\tمراجعة\nUnicode e\u0301\r\nEnd _x0041_ _x000D_ _X0041_ _x005F_ \u007f';
  const input = await fixture(note),
    result = reconcileAr(input);
  const restored = await restoreAr(await saveAr(input));
  assert.equal(restored.state.events[0].note, note);
  assert.deepEqual(restored.result, result);
  const out = await mkdtemp(join(tmpdir(), 'tarasuf-ar-text-'));
  try {
    await writeFile(
      join(out, 'direct.xlsx'),
      new Uint8Array(await exportAr(input, result)),
    );
    await writeFile(
      join(out, 'restored.xlsx'),
      new Uint8Array(await exportAr(restored.state, restored.result)),
    );
    await writeFile(
      join(out, 'expected.json'),
      JSON.stringify({
        note,
        totals: result.totals,
        members: result.rows.length,
      }),
    );
    const checker = new URL(
      '../audit/ar-limited/check_export_text.py',
      import.meta.url,
    ).pathname;
    const observed = JSON.parse(
      execFileSync(
        'python3',
        [
          checker,
          join(out, 'expected.json'),
          join(out, 'direct.xlsx'),
          join(out, 'restored.xlsx'),
        ],
        { encoding: 'utf8' },
      ),
    ) as { verified: boolean; workbooks: number };
    assert.equal(observed.verified, true);
    assert.equal(observed.workbooks, 2);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

void test('AR overlapping and adjacent OOXML escapes remain literal through native session export', async () => {
  const notes = [
    '_x005F_x0041_',
    '_x005f_x0041_x000D_x007F_',
    '_x0041__x0042_ _x005F__x005F_',
    '_x005F_x005F_x0041_ _x0041_x0042_x0043_',
    '=SUM(A1:A2) عربي 🧾\t\r\n_x005F_x0041_',
    '+SUM(A1:A2) literal _x005F_x0041_',
    '-1+2 literal _x005F_x0041_',
    '@SUM(A1:A2) literal _x005F_x0041_',
  ];
  const out = await mkdtemp(join(tmpdir(), 'tarasuf-ar-overlap-'));
  try {
    for (const [index, note] of notes.entries()) {
      const input = await fixture(note),
        result = reconcileAr(input);
      const before = structuredClone({ input, result });
      const restored = await restoreAr(await saveAr(input));
      assert.equal(restored.state.events[0].note, note);
      assert.deepEqual(restored.result, result);
      const paths = [
        join(out, index + '-direct.xlsx'),
        join(out, index + '-restored.xlsx'),
      ];
      await writeFile(paths[0], new Uint8Array(await exportAr(input, result)));
      await writeFile(
        paths[1],
        new Uint8Array(await exportAr(restored.state, restored.result)),
      );
      const expected = join(out, index + '-expected.json');
      await writeFile(
        expected,
        JSON.stringify({
          note,
          totals: result.totals,
          members: result.rows.length,
        }),
      );
      const checked = JSON.parse(
        execFileSync(
          'python3',
          [
            new URL('../audit/ar-limited/check_export_text.py', import.meta.url)
              .pathname,
            expected,
            ...paths,
          ],
          { encoding: 'utf8' },
        ),
      );
      assert.equal(checked.verified, true);
      assert.deepEqual({ input, result }, before);
    }
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
