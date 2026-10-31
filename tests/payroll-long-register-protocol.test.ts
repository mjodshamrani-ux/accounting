import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  PLR_ROLE,
  PLR_VERSION,
} from '../lib/reconciliation/payroll-long-register.ts';
import {
  replayLongRegister,
  type PlrReplayInput,
} from '../lib/reconciliation/payroll-long-register-io.ts';
import { validateWorkerValue } from '../lib/reconciliation/protocol.ts';

// A small synthetic register, unrelated to the PAY-1 stories.
const SCOPE = {
  Entity: 'SYN-PROTOCOL-CO',
  'Payroll run': 'R-1',
  Currency: 'EGP',
  'Period start': '2029-01-01',
  'Period end': '2029-01-31',
  'Payroll posting date': '2029-01-30',
  'Payment date': '2029-01-31',
};
function register(net = '90.00') {
  const head = Object.entries(SCOPE).map(([k, v]) => `${k},${v}`);
  return (
    [
      'Section,S1',
      ...head,
      'Line ID,Employee ID,Employee dimensions,Payee account,Component,Kind,Amount',
      'L1,E1,u=1,P1,Basic,earning,100.00',
      'L2,E1,u=1,P1,Insurance,deduction,10.00',
      `L3,E1,u=1,P1,Net pay,net,${net}`,
      'Total earnings,100.00',
      'Total deductions,10.00',
      'Total employer,0.00',
      `Total net,${net}`,
      'End section,S1',
      'Run totals,R-1',
      'Total earnings,100.00',
      'Total deductions,10.00',
      'Total employer,0.00',
      `Total net,${net}`,
      'End run totals,R-1',
    ].join('\n') + '\n'
  );
}
function request(net?: string): PlrReplayInput {
  const bytes = new TextEncoder().encode(register(net));
  return {
    files: [
      {
        name: 'register.csv',
        original: bytes.buffer,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
    ],
    readings: [{ role: PLR_ROLE, family: PLR_VERSION, confirmed: true }],
    scope: { confirmed: true, fields: { ...SCOPE } },
  };
}
const refused = (value: unknown, payload: unknown) =>
  assert.throws(
    () =>
      validateWorkerValue('payroll-long-register-reconcile', value, payload),
    /غير مكتملة/,
  );

void test('PLR worker: the page installs only a result it can compute again from the register it sent', async () => {
  const payload = request();
  const value = await replayLongRegister(payload);
  assert.equal(value.result.employees[0].status, 'consistent');
  validateWorkerValue('payroll-long-register-reconcile', value, payload);
  const changed = structuredClone(value);
  changed.result.employees[0].status = 'held';
  refused(changed, payload);
  const silent = structuredClone(value);
  silent.result.employees[0].net = '9001';
  refused(silent, payload);
  // A consistent result for another register is not this request's result.
  const other = await replayLongRegister(request('91.00'));
  refused(other, payload);
  const wrongScope = structuredClone(value);
  wrongScope.state.scope.fields = {
    ...wrongScope.state.scope.fields,
    Entity: 'SYN-OTHER',
  };
  refused(wrongScope, payload);
});

void test('PLR worker: bytes, a hash or a name the page did not send change nothing', async () => {
  const payload = request();
  const value = await replayLongRegister(payload);
  const bytes = structuredClone(value);
  new Uint8Array(bytes.state.files[0].original)[0] ^= 1;
  refused(bytes, payload);
  const hash = structuredClone(value);
  hash.state.files[0].sha256 = '0'.repeat(64);
  refused(hash, payload);
  const name = structuredClone(value);
  name.state.files[0].name = 'other.csv';
  refused(name, payload);
  refused({ ...value, extra: true }, payload);
});
