// AR-1 PDF holdout: the product on a sealed holdout package of the
// ar-statement-pdf-1 family (A5), sealed before this script first ran on it.
// Nothing stops at the first difference: every statement is measured layer by
// layer and the outcome recorded as it comes.
//   1. reading: the product's reading of the PDF bytes against the sealed
//      oracle's reading of the printed facts: what every line is, with its
//      place and code; the document header; the sections with their scope and
//      pages; every detail line's type, number, date, amount and related
//      invoice; every error with its place;
//   2. result: the AR engine on the ledger and the PDF against EXPECTED.json:
//      status, error codes and places, sections, lines out of scope, every
//      case with its reason and members, matched and review counts;
//   3. workpaper: the replay from the two original files equals the engine;
//      save and restore give the same result; the exported workpaper is
//      judged by the independent checker against the sealed files;
//   4. over all statements: automatic matches the expectations do not have,
//      and expected matches the product did not make.
// With --assert=<results file> it fails unless the outcome equals the
// recorded one, so that a recorded failure stays visible and a change in
// either direction is noticed.
//   node --experimental-strip-types scripts/ar-statement-holdout.mjs --suite=<package under audit/> [--assert=<results file>]
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const option = (name) =>
  process.argv
    .find((a) => a.startsWith(`--${name}=`))
    ?.slice(name.length + 3);
assert.ok(option('suite'), 'Usage: --suite=<holdout package under audit/>');
const suite = path.resolve(root, option('suite'));
const frozen = path.join(suite, 'frozen');
const foundation = path.join(root, 'audit/ar-statement-foundation');
const outDir = path.join(
  process.env.AR_HOLDOUT_DIR ?? path.join(root, 'work/ar-statement-holdout'),
  path.basename(suite),
);
await mkdir(outDir, { recursive: true });
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
// Equal as data: object keys in any order (EXPECTED.json is written with
// sorted keys, the product's objects are not), arrays in order.
const canonical = (v) =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]))
      : v;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const sorted = (xs) => [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

// The seal first: inputs, facts, expectations, reading and eligibility.
const seal = spawnSync('python3', ['-B', path.join(suite, 'check_seal.py')], {
  encoding: 'utf8',
});
assert.equal(seal.status, 0, `the holdout is not sealed as committed: ${seal.stdout}${seal.stderr}`);

const lib = (name) => import(path.join(root, 'lib/reconciliation', name));
const { readNativePdfWordSource } = await lib('pdf.ts');
const { readArStatementPdf } = await lib('ar-statement-pdf.ts');
const { reconcileArStatement } = await lib('ar.ts');
const { readArFile } = await lib('ar-source.ts');
const { replayAr, saveAr, restoreAr, exportAr } = await lib('ar-io.ts');

const facts = await json(path.join(frozen, 'stories.json'));
const expected = (await json(path.join(frozen, 'EXPECTED.json'))).stories;
const holdout = await json(path.join(suite, 'holdout.json'));
const oracleReading = JSON.parse(
  execFileSync(
    'python3',
    [
      '-B',
      '-c',
      `import json, sys
sys.path.insert(0, ${JSON.stringify(foundation)})
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
const bytes = async (name) =>
  Uint8Array.from(await readFile(path.join(frozen, name))).buffer;
const sha = (buffer) =>
  createHash('sha256').update(new Uint8Array(buffer)).digest('hex');
const statementReading = {
  family: 'ar-statement-pdf-1',
  role: 'company-issued-customer-statement',
  perspective: 'seller-receivable',
  basis: 'original-movement',
  confirmed: true,
};
const ledgerReading = (header) => {
  const at = (name) => header.indexOf(name);
  return {
    sheet: 0,
    header: 0,
    posting: at('Posting ID'),
    kind: at('Document type'),
    document: at('Own document number'),
    date: at('Posting date'),
    amount: at('Original signed amount'),
    entity: at('Entity'),
    ledger: at('Ledger'),
    customer: at('Customer'),
    account: at('Account'),
    currency: at('Currency'),
    related: at('Related invoice'),
    description: at('Description'),
    role: 'company-ar-ledger',
    perspective: 'seller-receivable',
    basis: 'original-movement',
    confirmed: true,
  };
};

// Each difference by its name, with the first place it shows.
function compare(differences, name, got, want) {
  if (same(got, want)) return;
  if (Array.isArray(got) && Array.isArray(want)) {
    const at = got.findIndex((g, i) => !same(g, want[i]));
    const i = at === -1 ? Math.min(got.length, want.length) : at;
    differences.push({ name, at: i, got: got[i] ?? null, want: want[i] ?? null, lengths: [got.length, want.length] });
  } else differences.push({ name, got, want });
}

function readingOutcome(id, reading) {
  const want = oracleReading[id];
  const differences = [];
  const where = (l) => [l.page, l.line];
  compare(differences, 'document header', reading.document, want.document);
  compare(
    differences,
    'line kinds',
    reading.lines.map((l) => [...where(l), l.kind, l.code ?? null]),
    want.inventory.map((i) => [...i.where, i.kind, i.code ?? null]),
  );
  compare(
    differences,
    'sections',
    reading.sections.map((s) => ({ scope: s.scope, pages: s.pages })),
    want.sections.map((s) => ({ scope: s.scope, pages: s.pages })),
  );
  compare(
    differences,
    'details',
    want.sections.map((_, k) =>
      reading.lines
        .filter((l) => l.kind === 'detail' && l.section === k)
        .map((l) => ({
          where: where(l),
          kind: l.detail.kind,
          document: l.detail.document,
          date: l.detail.date,
          amount: l.detail.amount,
          related: l.detail.related,
        })),
    ),
    want.sections.map((s) => s.lines),
  );
  compare(
    differences,
    'errors',
    reading.errors.map((e) => [e.code, e.page, e.line]),
    want.errors.map((e) => [e.code, ...e.where]),
  );
  return {
    equal: differences.length === 0,
    lines: reading.lines.length,
    details: reading.lines.filter((l) => l.kind === 'detail').length,
    differences,
  };
}

function casesOf(got) {
  const rowById = new Map(got.rows.map((r) => [r.id, r]));
  return got.cases
    .filter((c) => c.kind !== 'scope')
    .map((c) => {
      const members = c.ids.map((m) => rowById.get(m));
      return {
        document: c.document,
        kind: c.kind,
        ledger: members.filter((r) => r.side === 0).map((r) => r.posting),
        reason: c.reason,
        statement: members
          .filter((r) => r.side === 1)
          .map((r) => [r.pdf.page, r.pdf.line]),
      };
    })
    .sort((a, b) =>
      a.kind === b.kind
        ? a.document < b.document
          ? -1
          : 1
        : a.kind < b.kind
          ? -1
          : 1,
    );
}

function resultOutcome(id, got) {
  const want = expected[id];
  const differences = [];
  compare(differences, 'status', got.status, want.status);
  compare(
    differences,
    'error codes',
    sorted(new Set(got.sourceIssues.map((i) => i.code))),
    want.errorCodes,
  );
  const placeOf = new Map(
    got.inventory.map((i) => [
      i.inventoryId,
      i.side === 1 ? [i.pdf.page, i.pdf.line] : i.row,
    ]),
  );
  for (const e of want.errors) {
    const places = got.sourceIssues
      .filter((i) => i.code === e.code)
      .flatMap((i) => i.inventoryIds.map((ref) => placeOf.get(ref)));
    // A repeated scope is placed on the first page of each section that
    // carries it, as in the A2 proof.
    const wantPlace =
      e.code === 'AR_PDF_SCOPE_REPEATED'
        ? same(places.map((p) => p[0]), e.where)
        : e.where === null
          ? places.length === 0
          : places.some((p) => Array.isArray(p) && p[0] === e.where[0] && p[1] === e.where[1]);
    if (!wantPlace) differences.push({ name: `${e.code} place`, got: places, want: e.where });
  }
  compare(
    differences,
    'sections',
    (got.statement?.sections ?? []).map((s) => ({
      compared: s.compared,
      lines: s.lines,
      pages: s.pages,
      scope: s.scope,
    })),
    want.sections,
  );
  compare(differences, 'lines out of scope', got.statement?.outOfScopeLines ?? null, want.outOfScopeLines);
  const cases = casesOf(got);
  compare(differences, 'cases', cases, want.cases);
  const matched = got.cases.filter((c) => c.status === 'matched').length;
  compare(differences, 'matched', matched, want.matched);
  const review = {};
  for (const c of got.cases)
    if (c.kind !== 'scope' && !['exact-own-document', 'source-errors'].includes(c.reason))
      review[c.reason] = (review[c.reason] ?? 0) + 1;
  compare(differences, 'review', review, want.review);
  const key = (c) => JSON.stringify(canonical(c));
  const wanted = new Set(want.cases.filter((c) => c.reason === 'exact-own-document').map(key));
  const approved = cases.filter((c) => c.reason === 'exact-own-document');
  return {
    equal: differences.length === 0,
    status: got.status,
    errorCodes: sorted(new Set(got.sourceIssues.map((i) => i.code))),
    matched,
    falseApprovals: approved.filter((c) => !wanted.has(key(c))).map((c) => `${c.kind} ${c.document}`),
    missedApprovals: [...wanted]
      .filter((k) => !approved.some((c) => key(c) === k))
      .map((k) => `${JSON.parse(k).kind} ${JSON.parse(k).document}`),
    differences,
  };
}

async function workpaperOutcome(story, direct) {
  const ledger = await bytes(`${story.id}-ledger.csv`);
  const statement = await bytes(`${story.id}-statement.pdf`);
  const header = (await readArFile(`${story.id}-ledger.csv`, ledger.slice(0))).sheets[0].rows[0];
  const input = {
    files: [
      { name: `${story.id}-ledger.csv`, sha256: sha(ledger), original: ledger },
      { name: `${story.id}-statement.pdf`, sha256: sha(statement), original: statement },
    ],
    readings: [ledgerReading(header), { ...statementReading }],
    scope: { ...story.scope, confirmed: true },
    events: [],
  };
  const { state, result } = await replayAr(input);
  const restored = await restoreAr(await saveAr(input));
  const file = path.join(outDir, `${story.id}.xlsx`);
  await writeFile(file, new Uint8Array(await exportAr(state, result)));
  const checker = spawnSync(
    'python3',
    ['-B', path.join(foundation, 'check_export.py'), story.id, file, '--frozen', frozen],
    { encoding: 'utf8' },
  );
  return {
    replayEqualsEngine: same(result, direct),
    restoreEqualsReplay: same(restored.result, result),
    checker: checker.status === 0 ? 'accepted' : checker.stderr.trim().replace(/^check failed: /, 'refused: '),
  };
}

const stories = {};
const engine = {};
const readings = {};
for (const story of facts.stories) {
  const id = story.id;
  const record = { positive: holdout.positives.includes(id) };
  let reading;
  try {
    reading = readArStatementPdf(await readNativePdfWordSource(await bytes(`${id}-statement.pdf`)));
  } catch (error) {
    record.reading = { refused: String(error?.code ?? error?.message ?? error) };
  }
  if (reading) {
    record.reading = readingOutcome(id, reading);
    readings[id] = reading;
    const ledger = await readArFile(`${id}-ledger.csv`, await bytes(`${id}-ledger.csv`));
    const direct = reconcileArStatement({
      files: [
        ledger,
        { kind: 'ar-statement-pdf', name: `${id}-statement.pdf`, sha256: reading.sha256, reading },
      ],
      readings: [ledgerReading(ledger.sheets[0].rows[0]), { ...statementReading }],
      scope: { ...story.scope, confirmed: true },
      events: [],
    });
    record.result = resultOutcome(id, direct);
    engine[id] = direct;
    record.workpaper = await workpaperOutcome(story, direct);
  }
  record.asSealed =
    !!record.reading?.equal &&
    !!record.result?.equal &&
    record.workpaper?.checker === 'accepted' &&
    record.workpaper.replayEqualsEngine &&
    record.workpaper.restoreEqualsReplay;
  stories[id] = record;
  console.error(id, record.asSealed ? 'as sealed' : JSON.stringify(record).slice(0, 400));
}

// The comparison itself: blind to the order of object keys, and not to a
// planted change in what the product read or decided. The first execution
// of this script compared serialised objects and reported every section as
// different for its key order alone; this keeps that from coming back.
function comparison() {
  const id = Object.keys(stories).find((k) => stories[k].positive && stories[k].reading?.equal && stories[k].result?.equal);
  assert.ok(id, 'a positive the product read and decided as sealed, to plant faults in');
  const reversed = (v) =>
    Array.isArray(v)
      ? v.map(reversed)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.keys(v).reverse().map((k) => [k, reversed(v[k])]))
        : v;
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const plants = {
    'keys in another order': [() => resultOutcome(id, reversed(engine[id])).equal, true],
    'reading keys in another order': [() => readingOutcome(id, reversed(readings[id])).equal, true],
    'a matched case given another reason': [() => {
      const got = clone(engine[id]);
      const c = got.cases.find((x) => x.reason === 'exact-own-document');
      Object.assign(c, { reason: 'amount-difference', status: 'review' });
      return resultOutcome(id, got).equal;
    }, false],
    'a statement member moved a line': [() => {
      const got = clone(engine[id]);
      got.rows.find((r) => r.side === 1).pdf.line += 1;
      return resultOutcome(id, got).equal;
    }, false],
    'another section compared': [() => {
      const got = clone(engine[id]);
      got.statement.sections[0].compared = !got.statement.sections[0].compared;
      return resultOutcome(id, got).equal;
    }, false],
    'a detail amount read one unit off': [() => {
      const read = clone(readings[id]);
      read.lines.find((l) => l.kind === 'detail').detail.amount += 1;
      return readingOutcome(id, read).equal;
    }, false],
    'a detail line read as an error': [() => {
      const read = clone(readings[id]);
      Object.assign(read.lines.find((l) => l.kind === 'detail'), { kind: 'error', code: 'AR_PDF_LINE' });
      return readingOutcome(id, read).equal;
    }, false],
  };
  const out = { story: id };
  for (const [name, [run, want]] of Object.entries(plants)) {
    assert.equal(run(), want, `comparison self-test: ${name}`);
    out[name] = want ? 'equal' : 'different';
  }
  return out;
}

const ids = Object.keys(stories);
const outcome = {
  schema: 'tarasuf-ar-pdf1-holdout-run/1',
  suite: path.relative(root, suite),
  inputManifestSha256: createHash('sha256')
    .update(await readFile(path.join(frozen, 'INPUT-MANIFEST.json')))
    .digest('hex'),
  summary: {
    statements: ids.length,
    positivesAsSealed: `${ids.filter((id) => stories[id].positive && stories[id].asSealed).length}/${ids.filter((id) => stories[id].positive).length}`,
    heldAsSealed: `${ids.filter((id) => !stories[id].positive && stories[id].asSealed).length}/${ids.filter((id) => !stories[id].positive).length}`,
    readingsEqual: ids.filter((id) => stories[id].reading?.equal).length,
    readingsRefused: ids.filter((id) => stories[id].reading?.refused).length,
    falseApprovals: ids.flatMap((id) => (stories[id].result?.falseApprovals ?? []).map((c) => `${id} ${c}`)),
    missedApprovals: ids.flatMap((id) => (stories[id].result?.missedApprovals ?? []).map((c) => `${id} ${c}`)),
  },
  comparison: comparison(),
  stories,
};
await writeFile(path.join(outDir, 'run.json'), JSON.stringify(outcome, null, 1) + '\n');
console.log(JSON.stringify(outcome.summary));
if (option('assert')) {
  const recorded = await json(path.resolve(root, option('assert')));
  const { run, ...rest } = recorded;
  assert.ok(run, 'the record names its run');
  assert.deepEqual(JSON.parse(JSON.stringify(outcome)), rest, 'the outcome differs from the record');
}
