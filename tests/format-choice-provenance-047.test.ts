import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertInputFormats,
  formatChoice,
  formatChoiceColumns,
} from '../lib/reconciliation/input-readiness.ts';
import { inferMapping } from '../lib/reconciliation/core.ts';
import { suggestFormats } from '../lib/reconciliation/format-inference.ts';
import { templatePatch } from '../lib/reconciliation/mapping-template.ts';
import { saveSession, restoreSession } from '../lib/reconciliation/session.ts';
import { readFile } from '../lib/reconciliation/io.ts';
import { defaultMapping } from '../lib/reconciliation/types.ts';
import type {
  Mapping,
  Scope,
  SourceFile,
} from '../lib/reconciliation/types.ts';

// 0.4.7: an ambiguity the document cannot settle needs the accountant's answer,
// and that answer has to travel with the document it was given for. A value
// sitting in a mapping proves nothing about who put it there.
const scope: Scope = {
  supplier: 'Synthetic vendor',
  entity: 'Synthetic buyer',
  account: 'AP-047',
  currency: 'KWD',
  decimals: 3,
  cutoff: '2026-07-31',
  dateWindow: 2,
  confirmed: true,
  coverageConfirmed: false,
};
const rows = [
  ['Date', 'Reference', 'Amount'],
  ['2026-07-01', 'INV-1', '54.321'],
  ['2026-07-02', 'INV-2', '12.500'],
];
const fixture = (
  name = 'ambiguous.csv',
  hash = 'a'.repeat(64),
): SourceFile => ({
  name,
  sha256: hash,
  sheets: [
    {
      name: 'Data',
      rows: rows.map((r) => [...r]),
      formulaRows: [],
      hiddenRows: [],
    },
  ],
});
/** 54.321 reads as 54 dinars 321 fils, or as 54,321 dinars. Both parse the whole
 * column and they differ by a thousand, so the document cannot settle it. */
const prepared = (file: SourceFile, value: 'dot' | 'comma' = 'dot') => {
  const bare: Mapping = { ...inferMapping(file), numberFormat: value };
  const assessment = suggestFormats(file, bare, scope.decimals);
  return { bare, assessment };
};

test('047 an ambiguous amount format needs a recorded choice, not a value in the mapping', () => {
  const file = fixture();
  const { bare, assessment } = prepared(file);
  assert.equal(assessment.numberFormat.status, 'ambiguous');
  assert.deepEqual(assessment.numberFormat.candidates, ['dot', 'comma']);
  assert.throws(
    () => assertInputFormats([file], [bare], scope),
    /تحتمل أكثر من قراءة/,
  );
  const chosen: Mapping = {
    ...bare,
    formatChoice: {
      numberFormat: formatChoice(
        file,
        bare,
        'numberFormat',
        'dot',
        assessment.numberFormat.candidates,
        scope.decimals,
      ),
    },
  };
  assert.doesNotThrow(() => assertInputFormats([file], [chosen], scope));
});

test('047 a recorded choice does not travel to another document or another reading', () => {
  const file = fixture();
  const { bare, assessment } = prepared(file);
  const choice = formatChoice(
    file,
    bare,
    'numberFormat',
    'dot',
    assessment.numberFormat.candidates,
    scope.decimals,
  );
  const other = fixture('other.csv', 'b'.repeat(64));
  for (const [reason, file2, mapping] of [
    [
      'another source file',
      other,
      {
        ...inferMapping(other),
        numberFormat: 'dot' as const,
        formatChoice: { numberFormat: choice },
      },
    ],
    [
      'a different amount column',
      file,
      {
        ...bare,
        amount: 1,
        reference: 2,
        formatChoice: { numberFormat: choice },
      },
    ],
    [
      'a different header row',
      file,
      {
        ...bare,
        header: bare.header + 1,
        formatChoice: { numberFormat: choice },
      },
    ],
    [
      'a different value than the one chosen',
      file,
      {
        ...bare,
        numberFormat: 'comma' as const,
        formatChoice: { numberFormat: choice },
      },
    ],
    [
      'a candidate the document does not allow',
      file,
      {
        ...bare,
        formatChoice: {
          numberFormat: { ...choice, candidates: ['dot'], value: 'mdy' },
        },
      },
    ],
  ] as const)
    assert.throws(
      () => assertInputFormats([file2], [mapping as Mapping], scope),
      new RegExp('تحتمل أكثر من قراءة|تعذر التحقق'),
      reason,
    );
});

test('047 a choice made at another currency precision is not reused', () => {
  const file = fixture();
  const { bare, assessment } = prepared(file);
  const choice = formatChoice(
    file,
    bare,
    'numberFormat',
    'dot',
    assessment.numberFormat.candidates,
    2,
  );
  assert.throws(() =>
    assertInputFormats(
      [file],
      [{ ...bare, formatChoice: { numberFormat: choice } }],
      scope,
    ),
  );
});

test('047 a column template never carries a document-specific choice', () => {
  const file = fixture();
  const { bare, assessment } = prepared(file);
  const chosen: Mapping = {
    ...bare,
    formatChoice: {
      numberFormat: formatChoice(
        file,
        bare,
        'numberFormat',
        'dot',
        assessment.numberFormat.candidates,
        scope.decimals,
      ),
    },
  };
  const patch = templatePatch({
    format: 'tarasuf-column-template',
    version: 2,
    columns: {
      sheet: chosen.sheet,
      header: chosen.header,
      date: chosen.date,
      reference: chosen.reference,
      description: chosen.description,
      amount: chosen.amount,
      debit: chosen.debit,
      credit: chosen.credit,
      currencyColumn: chosen.currencyColumn,
      mode: chosen.mode,
    },
  });
  assert.equal(patch.formatChoice, undefined);
  assert.equal(patch.pdfReviewed, false);
  assert.throws(() =>
    assertInputFormats([file], [{ ...chosen, ...patch } as Mapping], scope),
  );
});

test('047 formatChoiceColumns follows the mapped amount columns in either mode', () => {
  const signed = {
    ...defaultMapping(),
    date: 0,
    amount: 2,
    mode: 'signed' as const,
  };
  assert.deepEqual(formatChoiceColumns(signed, 'numberFormat'), [2]);
  assert.deepEqual(formatChoiceColumns(signed, 'dateFormat'), [0]);
  const split = {
    ...defaultMapping(),
    date: 0,
    debit: 3,
    credit: 4,
    mode: 'split' as const,
  };
  assert.deepEqual(formatChoiceColumns(split, 'numberFormat'), [3, 4]);
});

test('047 a saved session is re-checked on restore and cannot assert its own approval', async () => {
  const csv = new TextEncoder().encode(rows.map((r) => r.join(',')).join('\n'))
    .buffer as ArrayBuffer;
  const supplier = await readFile('supplier.csv', csv);
  const ledger = await readFile('ledger.csv', csv.slice(0));
  const bare = (file: SourceFile): Mapping => ({
    ...inferMapping(file),
    numberFormat: 'dot',
  });
  const mappings: [Mapping, Mapping] = [bare(supplier), bare(ledger)];
  const state = {
    files: [supplier, ledger] as [SourceFile, SourceFile],
    mappings,
    scope,
    decisions: [],
    rejected: [],
    events: [],
    review: { name: '', notes: '', checked: false },
  };
  // Without the recorded choice the session cannot even be written, because
  // saveSession proves the session restores before handing it to the user.
  await assert.rejects(() => saveSession(state), /تحتمل أكثر من قراءة/);
  const withChoice = mappings.map((mapping, i) => ({
    ...mapping,
    formatChoice: {
      numberFormat: formatChoice(
        state.files[i],
        mapping,
        'numberFormat',
        'dot',
        suggestFormats(state.files[i], mapping, scope.decimals).numberFormat
          .candidates,
        scope.decimals,
      ),
    },
  })) as [Mapping, Mapping];
  const bytes = await saveSession({ ...state, mappings: withChoice });
  const restored = await restoreSession(bytes);
  assert.equal(restored.mappings[0].numberFormat, 'dot');
  assert.equal(restored.result.supplier.transactions.length, 2);

  // Editing the saved file to claim a choice for a source it was not made for
  // is rejected: the guard re-derives the candidates from the document itself.
  const text = new TextDecoder().decode(bytes);
  const tampered = JSON.parse(text);
  tampered.mappings[0].formatChoice.numberFormat.sourceHash = 'c'.repeat(64);
  await assert.rejects(
    () =>
      restoreSession(
        new TextEncoder().encode(JSON.stringify(tampered))
          .buffer as ArrayBuffer,
      ),
    /تحتمل أكثر من قراءة/,
  );
});
