import test from 'node:test';
import assert from 'node:assert/strict';
import {
  intercompanyTruth,
  finishedIntercompany,
  intercompanyFixture,
} from '../audit/intercompany/fixtures.ts';
import {
  reconcileIntercompany,
  type IntercompanyEntry,
} from '../lib/reconciliation/intercompany.ts';
const fact = (v: IntercompanyEntry | null) =>
  v
    ? {
        transactionId: v.transactionId,
        counterpartyTransactionId: v.counterpartyTransactionId,
        account: v.account,
        dimensions: v.dimensions,
        date: v.date,
        debit: v.debit,
        credit: v.credit,
        net: v.net,
        row: v.row,
      }
    : null;
void test('Intercompany: all85 pre-engine CSV/Decimal contracts preserve reciprocal entity/identity/period/dimensions/signed gross/whole events and UTF16 bounds', async () => {
  for (const c of intercompanyTruth.cases) {
    if (c.reject) {
      await assert.rejects(
        () => finishedIntercompany(c.name),
        new RegExp(`IC_${c.reject}`),
        c.name,
      );
      continue;
    }
    const { result: r } = await finishedIntercompany(c.name);
    assert.equal(r.status, c.status, c.name);
    for (let source = 0; source < 4; source++)
      assert.deepEqual(
        r.inventory
          .filter((row) => row.source === source)
          .map((row) => row.values),
        [c.originalTables[source].headers, ...c.originalTables[source].rows],
        c.name,
      );
    const f = c.financialFacts;
    if (!f) {
      assert.equal(r.totals, null, c.name);
      assert.ok(
        r.pairs.every((p) => p.residual === null && p.status === 'blocked'),
        c.name,
      );
      continue;
    }
    assert.equal(r.decimals, f.decimals, c.name);
    assert.deepEqual([r.left.map(fact), r.right.map(fact)], f.entries, c.name);
    assert.deepEqual(r.totals, f.totals, c.name);
    assert.deepEqual(
      r.pairs.map((p) => ({
        id: p.relationId,
        relationRow: r.relations.find((v) => v.id === p.relationRecord)!.row,
        left: fact(p.left),
        right: fact(p.right),
        residual: p.residual,
        review: p.review,
        timing: p.timing.map((t) => ({
          id: t.evidenceId,
          side: t.side,
          transactionId: t.transactionId,
          counterpartyTransactionId: t.counterpartyTransactionId,
          date: t.date,
          amount: t.amount,
          row: t.row,
        })),
      })),
      f.groups,
      c.name,
    );
  }
});
void test('Intercompany: gross cancellation never approves differences and timing never fabricates or accepts an absent leg', async () => {
  const { state, result } = await finishedIntercompany(
    'gross-differences-cancel',
  );
  assert.equal(result.totals![0].net + result.totals![1].net, 0);
  assert.equal(result.status, 'difference');
  assert.equal(result.pairs.filter((p) => p.residual !== 0).length, 2);
  state.events = [
    {
      id: 'MANUAL',
      type: 'accept',
      relationId: result.pairs[0].relationId,
      memberIds: [result.pairs[0].left!.id, result.pairs[0].right!.id],
      context: result.context,
      at: '2026-10-06T00:00:00.000Z',
      reference: 'Independent review',
      note: 'Whole pair',
    },
  ];
  assert.throws(() => reconcileIntercompany(state), /IC_EVENT_FINANCIAL/);
  const t = await finishedIntercompany('future-left-timing-evidence');
  assert.equal(t.result.right.length, 2);
  assert.equal(t.result.pairs[0].right, null);
  assert.equal(t.result.pairs[0].status, 'timing-evidence');
  assert.equal(t.result.pairs[0].residual, null);
});
void test('Intercompany: whole physical pair members, context, UTC, evidence and decision identity bind every event', async () => {
  const base = await finishedIntercompany('reciprocal-three-including-zero');
  for (const [name, edit, code] of [
    [
      'partial',
      () => {
        base.state.events[0].memberIds.pop();
      },
      'MEMBERS',
    ],
    [
      'context',
      () => {
        base.state.events[0].context = 'old';
      },
      'CONTEXT',
    ],
    [
      'UTC',
      () => {
        base.state.events[0].at = '2026-02-30T00:00:00.000Z';
      },
      'DATE',
    ],
    [
      'ID',
      () => {
        base.state.events[1].id = base.state.events[0].id;
      },
      'ID',
    ],
  ] as const) {
    const events = structuredClone(base.state.events);
    edit();
    assert.throws(
      () => reconcileIntercompany(base.state),
      new RegExp(`IC_EVENT_${code}`),
      name,
    );
    base.state.events = events;
  }
});
void test('Intercompany: one sheet, four independent originals and total source rows include blanks', async () => {
  const s = await intercompanyFixture('pending');
  s.files[0].sheets.push(structuredClone(s.files[0].sheets[0]));
  assert.throws(() => reconcileIntercompany(s), /IC_SOURCE_SHEETS/);
  s.files[0].sheets.pop();
  s.files[1].sha256 = s.files[0].sha256;
  assert.throws(() => reconcileIntercompany(s), /IC_INDEPENDENT_SOURCES/);
  const cap = await intercompanyFixture('pending');
  const sheet = cap.files[0].sheets[0];
  for (let i = 0; i < 19991; i++)
    sheet.rows.push(Array.from({ length: 19 }, () => ''));
  assert.equal(reconcileIntercompany(cap).inventory.length, 20004);
  sheet.rows.push(Array.from({ length: 19 }, () => ''));
  assert.throws(() => reconcileIntercompany(cap), /IC_ROWS/);
});
void test('Intercompany: declared source cell capacity preserves long raw evidence while legacy readers keep4096', async () => {
  const { readFile } = await import('../lib/reconciliation/io.ts');
  const { readIntercompanyFile } =
    await import('../lib/reconciliation/intercompany-source.ts');
  const s = await intercompanyFixture('raw-cell-inclusive-32767');
  assert.equal(s.files[2].sheets[0].rows[1][11].length, 32767);
  await assert.rejects(
    () => readFile(s.files[2].name, s.files[2].original!),
    /نص إحدى الخلايا/,
  );
  const fresh = await readIntercompanyFile(
    s.files[2].name,
    s.files[2].original!,
  );
  assert.equal(fresh.sha256, s.files[2].sha256);
  const v = await intercompanyFixture('reference-astral-inclusive-2000');
  assert.equal(v.files[2].sheets[0].rows[1][11].length, 2000);
});

void test('Intercompany: invalid timing retains the missing counterpart inventory', async () => {
  for (const name of [
    'timing-wrong-amount',
    'timing-wrong-sign',
    'timing-missing-reference',
    'duplicate-timing',
  ]) {
    const { result } = await finishedIntercompany(name);
    assert.equal(result.status, 'source-error', name);
    assert.ok(
      result.missing.some(
        (m) => m.kind === 'right-transaction' && m.key === 'B-001',
      ),
      name,
    );
  }
  const invalidProof = await finishedIntercompany(
    'future-timing-beyond-proof-validity',
  );
  assert.ok(
    invalidProof.result.missing.some(
      (m) => m.kind === 'relationship-left' && m.key === 'A-001',
    ),
  );
  const { result } = await finishedIntercompany('future-left-timing-evidence');
  assert.ok(
    !result.missing.some(
      (m) => m.kind === 'right-transaction' && m.key === 'B-001',
    ),
  );
  assert.equal(result.pairs[0].right, null);
});
void test('Intercompany: the source reader rejects the reproducible synthetic white-font counterexample and preserves declared native originals', async () => {
  const { readFile: fsRead } = await import('node:fs/promises');
  const { createHash } = await import('node:crypto');
  const { readIntercompanyFile } =
    await import('../lib/reconciliation/intercompany-source.ts');
  const bad = await fsRead(
    new URL(
      '../audit/intercompany/regressions/native-white-font.xlsx',
      import.meta.url,
    ),
  );
  assert.equal(
    createHash('sha256').update(bad).digest('hex'),
    // Fresh synthetic source pinned independently of the held historical file.
    '50efb99c65c0171e52d5879c9701eabb891dc6ea16b3f56097d0437c1f328be4',
  );
  await assert.rejects(
    () => readIntercompanyFile('white.xlsx', Uint8Array.from(bad).buffer),
    /BANK_NATIVE_DISPLAY|IC_NATIVE_DISPLAY/,
  );
  for (let source = 0; source < 4; source++) {
    const bytes = await fsRead(
      new URL(
        `../audit/intercompany/native/source-${source}.xlsx`,
        import.meta.url,
      ),
    );
    const file = await readIntercompanyFile(
      `source-${source}.xlsx`,
      Uint8Array.from(bytes).buffer,
    );
    assert.equal(file.sha256, createHash('sha256').update(bytes).digest('hex'));
  }
});

void test('Intercompany: reproducible synthetic fractional native date serial cannot silently lose its time', async () => {
  const { readFile: fsRead } = await import('node:fs/promises');
  const { createHash } = await import('node:crypto');
  const { readIntercompanyFile } =
    await import('../lib/reconciliation/intercompany-source.ts');
  const bytes = await fsRead(
    new URL(
      '../audit/intercompany/regressions/native-fractional-date.xlsx',
      import.meta.url,
    ),
  );
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    // Fresh synthetic source; the reader must still reject its fractional date.
    'd18be24de7c26352038de68cee32d68c5ecfd8d18439a0ebdfe7e0c0219646c2',
  );
  await assert.rejects(
    () =>
      readIntercompanyFile('fractional.xlsx', Uint8Array.from(bytes).buffer),
    /IC_NATIVE_DISPLAY/,
  );
});
