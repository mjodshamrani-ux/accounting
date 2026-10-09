import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile as fsRead } from 'node:fs/promises';
import {
  gatewayTruth,
  gatewayFixture,
  finishedGateway,
} from '../audit/payment-gateway/fixtures.ts';
import {
  reconcileGateway,
  type GatewayInput,
  type GatewayEvent,
} from '../lib/reconciliation/payment-gateway.ts';
import { readGatewayFile } from '../lib/reconciliation/payment-gateway-source.ts';
void test('Gateway: 43 independent pre-engine CSV/Decimal truths preserve all gross/net/fee/scope/duplicate/missing/raw evidence', async () => {
  for (const c of gatewayTruth.cases) {
    if (c.status.startsWith('throws:')) {
      await assert.rejects(
        () => finishedGateway(c.name),
        new RegExp('PG_' + c.status.split(':')[1]),
        c.name,
      );
      continue;
    }
    const { result: r } = await finishedGateway(c.name);
    assert.equal(r.status, c.status, c.name);
    const expected = c.expected!;
    assert.deepEqual(
      {
        records: r.records,
        issues: r.issues,
        missing: r.missing,
        cells: r.cells,
        inventory: r.inventory,
        totals: r.totals,
        residuals: r.residuals,
        financial: r.financial,
      },
      expected,
      c.name,
    );
  }
});
void test('Gateway: independent whole-decision corpus preserves malformed members and rejects partial/stale/repeated events', async () => {
  const j = JSON.parse(
    await fsRead(
      new URL('../audit/payment-gateway/event-contracts.json', import.meta.url),
      'utf8',
    ),
  ) as {
    cases: {
      name: string;
      case: string;
      complete: GatewayInput['completeness'];
      events: GatewayEvent[];
      error: string | null;
      expected: {
        review: string;
        status: string;
        context: string;
        memberIds: string[];
      };
    }[];
  };
  for (const c of j.cases) {
    const state = await gatewayFixture(c.case);
    state.completeness = c.complete;
    state.events = c.events;
    if (c.error) {
      assert.throws(
        () => reconcileGateway(state),
        new RegExp('PG_' + c.error),
        c.name,
      );
    } else {
      const r = reconcileGateway(state);
      assert.deepEqual(
        {
          review: r.review,
          status: r.status,
          context: r.context,
          memberIds: r.memberIds,
        },
        c.expected,
        c.name,
      );
    }
  }
});
void test('Gateway: invalid scope is rejected even when every original and SHA consistently repeats it', async () => {
  const j = JSON.parse(
    await fsRead(
      new URL(
        '../audit/payment-gateway/scope-invalid/expected.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ) as {
    cases: {
      name: string;
      scope: GatewayInput['scope'];
      error: string;
      files: { file: string; sha256: string }[];
    }[];
  };
  for (const c of j.cases) {
    const state = await gatewayFixture('pending');
    state.scope = { ...c.scope, confirmed: true };
    for (let i = 0; i < 4; i++) {
      const b = await fsRead(
        new URL('../audit/payment-gateway/' + c.files[i].file, import.meta.url),
      );
      state.files[i] = await readGatewayFile(
        c.files[i].file.split('/').at(-1)!,
        Uint8Array.from(b).buffer,
      );
      assert.equal(state.files[i].sha256, c.files[i].sha256);
    }
    assert.throws(
      () => reconcileGateway(state),
      new RegExp('PG_' + c.error),
      c.name,
    );
  }
});
void test('Gateway: component equality cannot hide two offsetting gross errors or invent an unexplained fee', async () => {
  for (const name of ['gross-errors-net-cancels', 'do-not-invent-fee']) {
    const { state, result } = await finishedGateway(name);
    assert.equal(result.status, 'difference');
    const good = await finishedGateway('accepted');
    state.events = [
      {
        ...good.state.events[0],
        context: result.context,
        memberIds: result.memberIds,
      },
    ];
    assert.throws(() => reconcileGateway(state), /PG_EVENT_FINANCIAL/);
  }
  const zero = await finishedGateway('zero');
  assert.equal(zero.result.memberIds.length, 3);
  assert.deepEqual(zero.result.totals, [0, 0, 0, 0]);
});

void test('Gateway: all role, scope and attestation preconditions bind decisions despite a consistently replaced context', async () => {
  const corpus = JSON.parse(
    await fsRead(
      new URL(
        '../audit/payment-gateway/metadata-contracts.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ) as {
    cases: {
      name: string;
      scopeConfirmed: boolean;
      readings: GatewayInput['readings'];
      complete: GatewayInput['completeness'];
      events: GatewayEvent[];
      error: string | null;
      expected: {
        review: string;
        status: string;
        context: string;
        memberIds: string[];
      };
    }[];
  };
  for (const c of corpus.cases) {
    const state = await gatewayFixture('pending');
    state.scope.confirmed = c.scopeConfirmed;
    state.readings = c.readings;
    state.completeness = c.complete;
    state.events = c.events;
    if (c.error)
      assert.throws(
        () => reconcileGateway(state),
        new RegExp('PG_' + c.error),
        c.name,
      );
    else {
      const r = reconcileGateway(state);
      assert.deepEqual(
        {
          review: r.review,
          status: r.status,
          context: r.context,
          memberIds: r.memberIds,
        },
        c.expected,
        c.name,
      );
    }
  }
});
void test('Gateway: declared JPY and KWD precision retains exact independent units and unsupported currencies remain explicit', async () => {
  const corpus = JSON.parse(
    await fsRead(
      new URL(
        '../audit/payment-gateway/currency-contracts/expected.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ) as {
    cases: {
      name: string;
      scope: GatewayInput['scope'];
      files: { file: string; sha256: string }[];
      error: string | null;
      expected: (typeof gatewayTruth.cases)[number]['expected'];
    }[];
  };
  for (const c of corpus.cases) {
    const state = await gatewayFixture('pending');
    state.scope = { ...c.scope, confirmed: true };
    for (let i = 0; i < 4; i++) {
      const b = await fsRead(
        new URL('../audit/payment-gateway/' + c.files[i].file, import.meta.url),
      );
      state.files[i] = await readGatewayFile(
        c.files[i].file.split('/').at(-1)!,
        Uint8Array.from(b).buffer,
      );
      assert.equal(state.files[i].sha256, c.files[i].sha256);
    }
    if (c.error)
      assert.throws(() => reconcileGateway(state), new RegExp('PG_' + c.error));
    else {
      const r = reconcileGateway(state);
      assert.deepEqual(
        {
          records: r.records,
          issues: r.issues,
          missing: r.missing,
          cells: r.cells,
          inventory: r.inventory,
          totals: r.totals,
          residuals: r.residuals,
          financial: r.financial,
        },
        c.expected,
        c.name,
      );
    }
  }
});
