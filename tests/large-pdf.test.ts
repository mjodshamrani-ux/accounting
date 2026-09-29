import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { contracts, evaluateContract } from '../audit/large-statements/frozen/checks.mjs';

const engineRoot = fileURLToPath(new URL('..', import.meta.url));
for (const contract of contracts.cases) {
  test(`large native PDF ${contract.id}: ${contract.kind}`, async () => {
    const result = await evaluateContract(engineRoot, contract.id);
    assert.equal(result.pass, true, JSON.stringify(result.failures, null, 2));
  });
}
