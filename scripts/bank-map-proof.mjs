// WF-1 MAP-1 M1: the column map library (bank-cashbook-map.ts) and the mapped
// cashbook reading (readMappedBankCashbook) on the sealed foundation
// (audit/bank-map-foundation), against EXPECTED.json field by field. Each
// story starts with no saved map and its actions are applied in order as the
// accountant would: a map file imported, a saved map exported, a cashbook
// read with the declared columns, by hand (the choice checked, its labels
// read from the file, then saved under a name if the story says so), or by a
// saved map (its fit decided first). Compared with the oracle's: the import's
// code, the exported map, the refused choice, every fit problem with its
// column, label, what the file holds and where the label is found, the
// reading's refusal and row or every entry, the rows above the header, the
// columns not read, and the saved names.
//   node --experimental-strip-types scripts/bank-map-proof.mjs
// MAP_PROOF_FROZEN names another sealed package with the same form.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const frozen =
  process.env.MAP_PROOF_FROZEN ??
  path.join(root, 'audit/bank-map-foundation/frozen');
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
const sha = (b) => createHash('sha256').update(new Uint8Array(b)).digest('hex');
const io = await import(path.join(root, 'lib/reconciliation/io.ts'));
const match = await import(
  path.join(root, 'lib/reconciliation/bank-statement-match.ts')
);
const map = await import(
  path.join(root, 'lib/reconciliation/bank-cashbook-map.ts')
);

const manifest = await json(path.join(frozen, 'INPUT-MANIFEST.json'));
for (const [name, entry] of Object.entries(manifest.files))
  assert.equal(
    sha(await readFile(path.join(frozen, name))),
    entry.sha256,
    name,
  );
for (const [name, digest] of Object.entries(manifest.external ?? {}))
  assert.equal(
    sha(await readFile(path.join(root, 'audit', name))),
    digest,
    name,
  );
const facts = await json(path.join(frozen, 'stories.json'));
const expected = (await json(path.join(frozen, 'EXPECTED.json'))).stories;
const plain = (x) => JSON.parse(JSON.stringify(x));

const currencies = new Map();
async function currency(action) {
  if (!currencies.has(action.source)) {
    const source = await json(
      path.join(root, 'audit', action.source, 'frozen', 'stories.json'),
    );
    for (const s of source.stories)
      for (const p of s.periods)
        currencies.set(`${action.source}/${p.id}`, p.statement.currency);
    currencies.set(action.source, true);
  }
  return currencies.get(`${action.source}/${action.period}`);
}

/** The reading as the oracle states it. */
function reading(file, columns, read) {
  const shape = columns
    ? map.cashbookColumnsUnread(file, columns)
    : { above: 0, unread: [] };
  const out = {
    header: columns?.header ?? 1,
    above: shape.above,
    unread: shape.unread,
    refused: null,
    entries: [],
  };
  try {
    out.entries = read().map((e) => ({
      voucher: e.id,
      row: e.row,
      date: e.date,
      description: e.description,
      reference: e.reference,
      direction: e.direction,
      amount: e.amount,
    }));
  } catch (error) {
    if (!(error instanceof match.CashbookReadError)) throw error;
    out.refused = { code: error.code, row: error.row };
  }
  return out;
}

const checks = {
  stories: 0,
  actions: 0,
  imports: 0,
  exports: 0,
  reads: 0,
  fits: 0,
  misfits: 0,
  invalid: 0,
  entries: 0,
  refused: 0,
};
for (const story of facts.stories) {
  checks.stories++;
  let store = [];
  for (const [k, action] of story.actions.entries()) {
    const want = expected[story.id][k];
    const where = `${story.id}#${k + 1}`;
    checks.actions++;
    if (action.do === 'import') {
      checks.imports++;
      const data = await readFile(path.join(frozen, action.file));
      try {
        const parsed = map.parseCashbookMap(data);
        store = map.withCashbookMap(store, parsed);
        assert.equal(want.accepted, true, where);
        // A valid file as its exporter would write it.
        assert.equal(
          map.serializeCashbookMap(parsed),
          data.toString('utf8'),
          `${where} round trip`,
        );
      } catch (error) {
        if (!(error instanceof map.CashbookMapError)) throw error;
        assert.deepEqual(
          { accepted: false, code: error.code },
          { accepted: want.accepted, code: want.code },
          where,
        );
      }
    } else if (action.do === 'export') {
      checks.exports++;
      const saved = store.find((m) => m.name === action.map);
      assert.deepEqual(
        saved ? JSON.parse(map.serializeCashbookMap(saved)) : null,
        want.map,
        where,
      );
    } else {
      checks.reads++;
      const bytes = Uint8Array.from(
        await readFile(
          action.twin
            ? path.join(root, 'audit', action.source, 'frozen', action.file)
            : path.join(frozen, action.file),
        ),
      ).buffer;
      const file = await io.readFile(action.file, bytes);
      const cur = await currency(action);
      if (action.by === 'declared') {
        assert.deepEqual(
          plain(
            reading(file, null, () => match.readBankCashbookTable(file, cur)),
          ),
          want.reading,
          where,
        );
      } else {
        let columns = null;
        try {
          if (action.by === 'hand') {
            const chosen = map.chooseCashbookColumns(file, {
              header: action.header,
              columns: action.columns,
            });
            if ('problems' in chosen) {
              assert.deepEqual(
                plain(chosen.problems),
                want.fit?.problems,
                `${where} file problems`,
              );
              assert.equal(want.fit.fits, false, where);
              checks.misfits++;
            } else columns = chosen.columns;
          } else {
            const saved = store.find((m) => m.name === action.map);
            assert.ok(saved, `${where} map ${action.map}`);
            const problems = map.cashbookMapProblems(
              file,
              map.mapColumns(saved),
            );
            assert.deepEqual(
              plain(problems),
              want.fit.fits ? [] : want.fit.problems,
              `${where} fit`,
            );
            if (problems.length) checks.misfits++;
            else columns = map.mapColumns(saved);
          }
        } catch (error) {
          if (!(error instanceof map.CashbookMapError)) throw error;
          assert.equal(error.code, want.invalid, `${where} choice`);
          checks.invalid++;
        }
        if (columns) {
          checks.fits++;
          assert.equal(want.fit?.fits, true, `${where} fits`);
          const got = plain(
            reading(file, columns, () =>
              match.readMappedBankCashbook(file, cur, columns),
            ),
          );
          assert.deepEqual(got, want.reading, `${where} reading`);
          checks.entries += got.entries.length;
          if (got.refused) checks.refused++;
          if (action.by === 'hand' && action.save) {
            store = map.withCashbookMap(
              store,
              map.namedCashbookMap(action.save, columns),
            );
            assert.equal(want.saved, action.save, where);
          }
        } else assert.equal(want.reading, undefined, `${where} read a misfit`);
      }
    }
    assert.deepEqual(
      store.map((m) => m.name).sort(),
      want.store,
      `${where} store`,
    );
  }
}
console.log(JSON.stringify(checks));
