import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  FINH_ROLES,
  FINH_VERSION,
} from '../lib/reconciliation/tb-financial-hierarchy.ts';
import {
  replayFinancialHierarchy,
  type FinHReplayInput,
} from '../lib/reconciliation/tb-financial-hierarchy-io.ts';
import { validateWorkerValue } from '../lib/reconciliation/protocol.ts';

// A small synthetic statement, unrelated to FIN-1A's cases and to H1.
const SCOPE = {
  Entity: 'SYN-PROTOCOL-CO',
  Ledger: 'P',
  Currency: 'EGP',
  'Currency basis': 'functional',
  'Posting status': 'posted',
  'Posting layer': 'actual',
  'Period start': '2029-01-01',
  'Period end': '2029-06-30',
  'As of': '2029-06-30',
  'Chart version': 'C1',
  'Map version': 'M1',
  'Closing basis': 'post-closing',
};
const tail = Object.values(SCOPE).join(',');
const head = Object.keys(SCOPE).join(',');
const sources = (cash = '70.00') => [
  [
    `Account ID,Complete dimensions,Account label,Account class,Debit,Credit,${head}`,
    `A1,u=1,Cash,current-asset,70.00,0.00,${tail}`,
    `Q1,u=1,Capital,equity,0.00,70.00,${tail}`,
  ],
  [
    `Mapping ID,Account ID,Complete dimensions,Line ID,Sign,Evidence ID,${head}`,
    `M1,A1,u=1,CASH,debit-positive,E1,${tail}`,
    `M2,Q1,u=1,CAP,credit-positive,E2,${tail}`,
  ],
  [
    `Evidence ID,Account ID,Complete dimensions,Account class,Line ID,Line label,Line class,Sign,Valid from,Valid to,Evidence reference,${head}`,
    `E1,A1,u=1,current-asset,CASH,Cash,current-asset,debit-positive,2029-01-01,2029-12-31,R1,${tail}`,
    `E2,Q1,u=1,equity,CAP,Capital,equity,credit-positive,2029-01-01,2029-12-31,R2,${tail}`,
  ],
  [
    `Node ID,Parent ID,Kind,Line label,Line class,Amount,${head}`,
    `T,,title,Position,,,${tail}`,
    `CA,,parent,Current,current-asset,${cash},${tail}`,
    `CASH,CA,leaf,Cash,current-asset,${cash},${tail}`,
    `CAP,,leaf,Capital,equity,70.00,${tail}`,
  ],
];
function request(cash?: string): FinHReplayInput {
  return {
    files: sources(cash).map((lines, i) => {
      const bytes = new TextEncoder().encode(lines.join('\n') + '\n');
      return {
        name: `${FINH_ROLES[i]}.csv`,
        original: bytes.buffer,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
    }) as FinHReplayInput['files'],
    readings: FINH_ROLES.map((role) => ({
      role,
      family: FINH_VERSION,
      confirmed: true,
    })) as FinHReplayInput['readings'],
    scope: { confirmed: true, fields: { ...SCOPE } },
  };
}
const refused = (value: unknown, payload: unknown) =>
  assert.throws(
    () =>
      validateWorkerValue('tb-financial-hierarchy-reconcile', value, payload),
    /غير مكتملة/,
  );

void test('FINH worker: the page installs only a result it can compute again from the files it sent', async () => {
  const payload = request();
  const value = await replayFinancialHierarchy(payload);
  assert.equal(value.result.status, 'eligible');
  validateWorkerValue('tb-financial-hierarchy-reconcile', value, payload);
  const changed = structuredClone(value);
  changed.result.status = 'blocked';
  refused(changed, payload);
  const silent = structuredClone(value);
  silent.result.lines[0].reported = 1;
  refused(silent, payload);
  // A consistent result for other files is not this request's result.
  const other = await replayFinancialHierarchy(request('71.00'));
  refused(other, payload);
  const wrongScope = structuredClone(value);
  wrongScope.state.scope.fields = {
    ...wrongScope.state.scope.fields,
    Entity: 'SYN-OTHER',
  };
  refused(wrongScope, payload);
});

void test('FINH worker: bytes or a hash the page did not send change nothing', async () => {
  const payload = request();
  const value = await replayFinancialHierarchy(payload);
  const bytes = structuredClone(value);
  new Uint8Array(bytes.state.files[3].original)[0] ^= 1;
  refused(bytes, payload);
  const hash = structuredClone(value);
  hash.state.files[0].sha256 = '0'.repeat(64);
  refused(hash, payload);
  const name = structuredClone(value);
  name.state.files[1].name = 'other.csv';
  refused(name, payload);
  refused({ ...value, extra: true }, payload);
});
