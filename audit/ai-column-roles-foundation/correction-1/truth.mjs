// Correction 1 to the sealed truth rule (score.mjs truthOf), after the first
// run (results/baseline-1.json, kept as it came).
//
// The sealed rule takes the heading row as the one row whose labels are
// exactly the story's headings, and gives null when there are two. A
// statement of two pages prints its headings again at the top of the
// second, so N04, A03 and D04 had none: the rule refused the very thing a
// multi-page statement is. The scratch statements tried before the seal
// were all one page. Here the heading row is the first such row when every
// other is the same row printed again, label for label in the same order;
// two rows in another order, or a row of other labels, still give null.
// Nothing else in score.mjs changes: the actions, the gates and their
// thresholds are the sealed ones.
//
//   node audit/ai-column-roles-foundation/correction-1/truth.mjs --self-test
import { FIELDS, truthOf as sealedTruthOf } from '../score.mjs';

const norm = (s) => String(s).normalize('NFKC').trim().replace(/\s+/g, ' ');

export function truthOf(expected, rows) {
  const want = [...expected.headings].map(norm).sort();
  const at = [];
  rows.forEach((labels, i) => {
    const got = labels.map(norm).filter((l) => l).sort();
    if (got.length === want.length && got.every((l, k) => l === want[k])) at.push(i);
  });
  if (!at.length) return null;
  const first = rows[at[0]].map(norm);
  if (at.some((i) => rows[i].map(norm).join('\u0000') !== first.join('\u0000'))) return null;
  const columns = {};
  for (const field of FIELDS) {
    const heading = expected.roles[field];
    columns[field] = heading === undefined ? -1 : first.indexOf(norm(heading));
  }
  return { header: at[0], columns, mode: columns.debit >= 0 && columns.credit >= 0 ? 'split' : 'signed' };
}

export function selfTest() {
  const failures = [];
  const eq = (label, got, want) => {
    if (JSON.stringify(got) !== JSON.stringify(want))
      failures.push(`${label}: ${JSON.stringify(got)} != ${JSON.stringify(want)}`);
  };
  const expected = {
    headings: ['Bill Date', 'Bill No', 'Memo', 'Dr Amount', 'Cr Amount', 'Running Bal.'],
    roles: { date: 'Bill Date', reference: 'Bill No', description: 'Memo', debit: 'Dr Amount', credit: 'Cr Amount' },
  };
  const head = ['Bill Date', 'Bill No', 'Memo', 'Dr Amount', 'Cr Amount', 'Running Bal.'];
  const body = ['2027-03-02', 'INV-1', 'x', '1.00', '', '2.00'];
  const two = [['Meridian'], head, body, ['Page 1 of 2'], head, body];
  const want = {
    header: 1,
    columns: { date: 0, reference: 1, description: 2, amount: -1, debit: 3, credit: 4, currencyColumn: -1 },
    mode: 'split',
  };
  eq('two pages, the heading row repeated', truthOf(expected, two), want);
  eq('the sealed rule refuses it', sealedTruthOf(expected, two), null);
  eq('one page, as the sealed rule', truthOf(expected, two.slice(0, 4)), sealedTruthOf(expected, two.slice(0, 4)));
  const swapped = [...head];
  [swapped[3], swapped[4]] = [swapped[4], swapped[3]];
  eq('a second heading row in another order', truthOf(expected, [head, body, swapped, body]), null);
  eq('the debit and credit headings merged into one cell',
    truthOf(expected, [['Bill Date', 'Bill No', 'Memo', 'Dr Amount Cr Amount', '', 'Running Bal.']]), null);
  eq('no heading row', truthOf(expected, [body, body]), null);
  return failures;
}

if (process.argv.includes('--self-test')) {
  const failures = selfTest();
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
  }
  console.log('truth correction self-test: a repeated heading row is the first; any other second row is refused');
}
