// The AI-1a measure, fixed before any product run on these statements.
// Pure: it imports nothing from the product, and its self-test feeds it
// readings written by hand.
//
//   node audit/ai-column-roles-foundation/score.mjs --self-test
//
// A story's review burden is the actions an accountant takes in the column
// panel, one each, before the statement's mapping is the true one:
// - header: choose the heading row, when the product chose another;
// - mode: switch between one amount column and debit and credit, when the
//   mapping's mode is not the truth's;
// - pick: each of the seven roles whose column is not the true one (choose
//   the column, or clear a column that holds no such role);
// - apply: applying a proposal, once per story where one is applied;
// - reject: each proposal that passes the product's check and is wrong, or
//   that names a column where the headings decide nothing (K5).
// The engine alone costs header + mode + picks. With proposals, the reviewer
// applies those that are right and rejects the others; an applied right
// proposal saves its pick. A proposal never chooses the heading row or the
// mode: the product's check binds the heading row and has no mode.
//
// Gates for a provider, over the sealed set (decided before measuring):
//   G1  burden with proposals <= half the engine's alone, over K1 to K5;
//   G2  the same within K3 alone, where a fixed list of headings cannot help;
//   G3  at most 2 wrong proposals in the set, and none for a money role
//       (amount, debit, credit);
//   G4  no proposal in a K0 control: the product asks for none;
//   G5  no unsafe run: with the final mapping, the sealed judge finds no
//       misread, lost row or wrong approval.
// A provider that fails any gate leaves AI-1 closed (CURRENT-PLAN row 6).

export const FIELDS = ['date', 'reference', 'description', 'amount', 'debit', 'credit', 'currencyColumn'];
export const MONEY = new Set(['amount', 'debit', 'credit']);
export const CLASSES = ['K0', 'K1', 'K2', 'K3', 'K4', 'K5'];
export const MEASURE_VERSION = 'tarasuf-ai1-columns-measure-1';

const norm = (s) => String(s).normalize('NFKC').trim().replace(/\s+/g, ' ');

/** The heading row and the column of every role, from the product's own
 * rows and the oracle's headings: the one row whose labels are exactly the
 * story's headings. null when the product did not read them as one row. */
export function truthOf(expected, rows) {
  const want = [...expected.headings].map(norm).sort();
  const at = [];
  rows.forEach((labels, i) => {
    const got = labels.map(norm).filter((l) => l).sort();
    if (got.length === want.length && got.every((l, k) => l === want[k])) at.push(i);
  });
  if (at.length !== 1) return null;
  const labels = rows[at[0]].map(norm);
  const columns = {};
  for (const field of FIELDS) {
    const heading = expected.roles[field];
    columns[field] = heading === undefined ? -1 : labels.indexOf(norm(heading));
  }
  return { header: at[0], columns, mode: columns.debit >= 0 && columns.credit >= 0 ? 'split' : 'signed' };
}

/** Actions the engine alone leaves. `mapping` is the product's; `after` is
 * what the panel infers once the accountant sets the true heading row (the
 * product's own mapping when its heading row is already right). */
export function alone(truth, mapping, after = mapping) {
  const header = mapping.header === truth.header ? 0 : 1;
  if (after.header !== truth.header) throw new Error('after: the heading row is not the true one');
  return { header, ...rest(truth, after) };
}

function rest(truth, after) {
  const mode = after.mode === truth.mode ? 0 : 1;
  const wrong = FIELDS.filter((f) => after[f] !== truth.columns[f]);
  return { mode, picks: wrong.length, wrong };
}

/** Actions with proposals. `after` is the mapping after the heading row is
 * right; `proposals` is {field: {column, passed}} for every role a provider
 * named, `passed` being the product's verdict on it; `decidable` is false in
 * K5, where no proposal can be right. */
export function assisted(truth, mapping, after, proposals, decidable) {
  const header = mapping.header === truth.header ? 0 : 1;
  if (after.header !== truth.header) throw new Error('after: the heading row is not the true one');
  const base = rest(truth, after);
  let saved = 0;
  let wrong = 0;
  let money = 0;
  let unverifiedRight = 0;
  for (const [field, p] of Object.entries(proposals)) {
    if (!FIELDS.includes(field)) throw new Error(`no such role: ${field}`);
    if (!p.passed) {
      if (decidable && p.column === truth.columns[field]) unverifiedRight++;
      continue;
    }
    if (decidable && p.column === truth.columns[field] && after[field] !== truth.columns[field]) saved++;
    else {
      wrong++;
      if (MONEY.has(field)) money++;
    }
  }
  const apply = saved > 0 ? 1 : 0;
  return {
    header,
    mode: base.mode,
    picks: base.picks - saved,
    apply,
    reject: wrong,
    saved,
    wrongProposals: wrong,
    moneyWrong: money,
    rightButRefused: unverifiedRight,
  };
}

export const total = (b) => b.header + b.mode + b.picks + (b.apply ?? 0) + (b.reject ?? 0);

/** The gates over per-story records {id, class, alone, assisted, asked,
 * unsafe}. `assisted` is null where no provider ran (the engine alone). */
export function gates(records) {
  const sum = (rs, k) => rs.reduce((n, r) => n + total(r[k]), 0);
  const scored = records.filter((r) => r.class !== 'K0');
  const k3 = records.filter((r) => r.class === 'K3');
  const withP = records.every((r) => r.assisted);
  const g = {
    burdenAlone: sum(scored, 'alone'),
    burdenAloneK3: sum(k3, 'alone'),
    burdenAssisted: withP ? sum(scored, 'assisted') : null,
    burdenAssistedK3: withP ? sum(k3, 'assisted') : null,
    wrongProposals: withP ? records.reduce((n, r) => n + r.assisted.wrongProposals, 0) : null,
    moneyWrong: withP ? records.reduce((n, r) => n + r.assisted.moneyWrong, 0) : null,
    controlsAsked: records.filter((r) => r.class === 'K0' && r.asked).length,
    unsafe: records.filter((r) => r.unsafe).length,
  };
  g.G1 = withP && 2 * g.burdenAssisted <= g.burdenAlone;
  g.G2 = withP && 2 * g.burdenAssistedK3 <= g.burdenAloneK3;
  g.G3 = withP && g.wrongProposals <= 2 && g.moneyWrong === 0;
  g.G4 = g.controlsAsked === 0;
  g.G5 = g.unsafe === 0;
  g.pass = g.G1 && g.G2 && g.G3 && g.G4 && g.G5;
  return g;
}

/** Hand-written readings that the measure must count as written here. */
export function selfTest() {
  const failures = [];
  const eq = (label, got, want) => {
    if (JSON.stringify(got) !== JSON.stringify(want))
      failures.push(`${label}: ${JSON.stringify(got)} != ${JSON.stringify(want)}`);
  };
  const expected = {
    headings: ['Txn Date', 'Doc #', 'Narrative', 'Total SAR'],
    roles: { date: 'Txn Date', reference: 'Doc #', description: 'Narrative', amount: 'Total SAR' },
  };
  const rows = [['Northwind', '', '', ''], ['Txn Date', 'Doc #', 'Narrative', 'Total SAR'], ['x', 'y', 'z', 'w']];
  const truth = truthOf(expected, rows);
  eq('truth', truth, {
    header: 1,
    columns: { date: 0, reference: 1, description: 2, amount: 3, debit: -1, credit: -1, currencyColumn: -1 },
    mode: 'signed',
  });
  eq('truth, headings split over two rows', truthOf(expected, [['Txn', 'Doc', '', ''], ['Date', '#', 'Narrative', 'Total SAR']]), null);
  eq('truth, a repeated heading row', truthOf(expected, [rows[1], rows[1]]), null);
  const none = { header: 0, mode: 'signed', date: -1, reference: -1, description: -1, amount: -1, debit: -1, credit: -1, currencyColumn: -1 };
  const after = { ...none, header: 1 };
  eq('alone, wrong heading row', alone(truth, none, after), { header: 1, mode: 0, picks: 4, wrong: ['date', 'reference', 'description', 'amount'] });
  const split = { ...after, description: 2 };
  eq('alone, one role named, mode wrong', alone({ ...truth, mode: 'split' }, split), { header: 0, mode: 1, picks: 3, wrong: ['date', 'reference', 'amount'] });
  let threw = false;
  try {
    alone(truth, none);
  } catch {
    threw = true;
  }
  eq('alone, an after mapping on the wrong heading row is refused', threw, true);
  eq('alone, right heading row', alone(truth, after), { header: 0, mode: 0, picks: 4, wrong: ['date', 'reference', 'description', 'amount'] });
  const right = { date: { column: 0, passed: true }, reference: { column: 1, passed: true }, amount: { column: 3, passed: true } };
  const a = assisted(truth, none, after, right, true);
  eq('assisted, three right', [a.picks, a.apply, a.reject, total(a)], [1, 1, 0, 3]);
  const decoy = { amount: { column: 2, passed: true } };
  const b = assisted(truth, after, after, decoy, true);
  eq('assisted, a wrong money proposal', [b.picks, b.reject, b.moneyWrong, total(b)], [4, 1, 1, 5]);
  const refused = { amount: { column: 3, passed: false } };
  const c = assisted(truth, after, after, refused, true);
  eq('assisted, a right proposal the check refused', [c.picks, c.apply, c.rightButRefused, total(c)], [4, 0, 1, 4]);
  const k5 = assisted(truth, after, after, right, false);
  eq('assisted, anything named in K5 is wrong', [k5.saved, k5.reject, k5.moneyWrong, total(k5)], [0, 3, 1, 7]);
  const solved = { ...after, date: 0, reference: 1, description: 2, amount: 3 };
  const d = assisted(truth, solved, solved, right, true);
  eq('assisted, a proposal for a role already right saves nothing', [d.saved, d.reject, total(d)], [0, 3, 3]);
  const rec = (cls, al, as, extra = {}) => ({ class: cls, alone: al, assisted: as, asked: false, unsafe: false, ...extra });
  const z = { header: 0, mode: 0, picks: 0, apply: 0, reject: 0, wrongProposals: 0, moneyWrong: 0 };
  const g = gates([
    rec('K0', z, z),
    rec('K1', { header: 1, mode: 1, picks: 4 }, { ...z, header: 1, mode: 1, picks: 0, apply: 1 }),
    rec('K3', { header: 0, mode: 0, picks: 4 }, { ...z, picks: 1, apply: 1 }),
  ]);
  eq('gates, a provider that halves the burden', [g.burdenAlone, g.burdenAssisted, g.G1, g.G2, g.G3, g.pass], [10, 5, true, true, true, true]);
  const h = gates([rec('K3', { header: 0, mode: 0, picks: 2 }, { ...z, picks: 1, apply: 1 })]);
  eq('gates, one pick saved of two is no gain', [h.G1, h.G2, h.pass], [false, false, false]);
  const m = gates([rec('K1', { header: 0, mode: 0, picks: 8 }, { ...z, picks: 0, apply: 1, reject: 1, wrongProposals: 1, moneyWrong: 1 })]);
  eq('gates, a wrong money proposal fails G3 whatever the gain', [m.G1, m.G3, m.pass], [true, false, false]);
  const c0 = gates([rec('K0', z, z, { asked: true })]);
  eq('gates, a control asked for proposals', [c0.G4, c0.pass], [false, false]);
  const u = gates([rec('K1', { header: 0, mode: 0, picks: 8 }, { ...z, apply: 1 }, { unsafe: true })]);
  eq('gates, an unsafe run', [u.G5, u.pass], [false, false]);
  const e = gates([rec('K1', { header: 0, mode: 0, picks: 8 }, null)]);
  eq('gates, the engine alone passes nothing', [e.G1, e.G2, e.G3, e.pass], [false, false, false, false]);
  return failures;
}

if (process.argv.includes('--self-test')) {
  const failures = selfTest();
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
  }
  console.log('score self-test: every hand-written reading counted as written');
}
