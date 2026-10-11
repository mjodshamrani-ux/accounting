import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import {
  assetLongFixture,
  assetLongRoot,
  editAssetLongRows,
} from './helpers/fixed-assets-long-fixtures.ts';
import {
  replayAsset,
  saveAsset,
  restoreAsset,
  exportAsset,
} from '../lib/reconciliation/fixed-assets-io.ts';
import {
  ASSET_VERSION,
  type AssetEvent,
} from '../lib/reconciliation/fixed-assets.ts';
const oracle = JSON.parse(
  await readFile(
    new URL('accepted-oracle-results.json', assetLongRoot),
    'utf8',
  ),
);
const diagnostics = JSON.parse(
  await readFile(new URL('diagnostic-assertions.json', assetLongRoot), 'utf8'),
);
async function book(buffer: ArrayBuffer) {
  const b = new ExcelJS.Workbook();
  await b.xlsx.load(buffer);
  return b;
}
function event(type: AssetEvent['type'], id: string): AssetEvent {
  return {
    id,
    type,
    context: '',
    memberIds: [],
    at: '2026-10-10T00:00:00.000Z',
    reference: 'SYN-REVIEW',
    note: 'Synthetic full physical scope',
  };
}
void test('54 accepted independent CSV truths retain original bytes, totals, presence and physical membership in direct and restored exports', async () => {
  for (const truth of oracle.cases) {
    const state = await assetLongFixture(truth.case),
      fresh = await replayAsset(state);
    assert.equal(fresh.result.financial, truth.result.financial, truth.case);
    assert.deepEqual(fresh.result.totals, truth.result.totals, truth.case);
    assert.equal(
      fresh.result.memberIds.length,
      truth.result.physicalMembers.length,
      truth.case,
    );
    const diagnostic = diagnostics.cases[truth.case];
    if (diagnostic)
      assert.deepEqual(
        fresh.result.comparisons.map(
          ({ account, dimensions, component, register, gl, difference }) => ({
            account,
            dimensions,
            component,
            register,
            gl,
            difference,
          }),
        ),
        diagnostic.comparisons,
        truth.case,
      );
    const restored = await restoreAsset(await saveAsset(state));
    assert.deepEqual(restored.result, fresh.result, truth.case);
    assert.deepEqual(
      restored.state.files.map((f) => f.original),
      state.files.map((f) => f.original),
      truth.case,
    );
    for (const input of [fresh, restored]) {
      const b = await book(await exportAsset(input.state, input.result));
      assert.equal(b.worksheets.length, 17);
      assert.equal(
        b.getWorksheet('Assets')!.getCell('A1').value,
        'First physical member ID',
      );
      assert.equal(
        b.getWorksheet('Original register rows')!.rowCount,
        state.files[0].sheets[0].rows.length,
      );
      const sheet = b.getWorksheet('Long component evidence')!;
      assert.equal(
        sheet.rowCount,
        (fresh.result.componentEvidence?.length ?? 0) + 1,
      );
      for (const [i, e] of (input.result.componentEvidence ?? []).entries()) {
        const raw = state.files[0].sheets[0].rows[e.row - 1];
        assert.equal(e.present, e.column <= raw.length);
        assert.equal(e.text, e.present ? raw[e.column - 1] : null);
        if (!e.present) assert.equal(e.minor, null);
        assert.equal(sheet.getCell(i + 2, 9).value, String(e.present));
        assert.equal(sheet.getCell(i + 2, 10).value ?? null, e.text);
        assert.equal(sheet.getCell(i + 2, 11).value ?? null, e.minor);
      }
      for (const a of input.result.records[0]) {
        assert.equal(a.memberIds!.length, 4);
        assert.equal(a.memberId, a.componentEvidence![0].memberId);
        assert.ok(
          a.memberIds!.every((id) => input.result.memberIds.includes(id)),
        );
      }
    }
  }
});
void test('long originals and every review choice are captured before hashing; forged parsed caches never control replay', async () => {
  const native: typeof crypto.subtle.digest = Reflect.get(
    crypto.subtle,
    'digest',
  );
  for (const action of ['replay', 'save', 'export'] as const) {
    const state = await assetLongFixture();
    state.completeness = {
      confirmed: true,
      reference: 'SYN-COMPLETE',
      note: 'Synthetic selected scope',
    };
    const base = await replayAsset(state);
    state.events = [
      {
        ...event('accept', 'SYN-A'),
        context: base.result.context,
        memberIds: [...base.result.memberIds],
      },
    ];
    const expected = await replayAsset(state);
    state.files[0].sheets[0].rows[1][3] = 'INVALID-CACHE';
    let release = () => {},
      calls = 0;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    crypto.subtle.digest = async function (algorithm, data) {
      if (++calls === 1) await gate;
      return native.call(this, algorithm, data);
    };
    try {
      const pending =
        action === 'replay'
          ? replayAsset(state)
          : action === 'save'
            ? saveAsset(state)
            : exportAsset(state, expected.result);
      assert.equal(calls, 1);
      for (const f of state.files) {
        new Uint8Array(f.original!).fill(0);
        f.name = 'other.csv';
        f.sha256 = '0'.repeat(64);
      }
      state.readings[0].family = ASSET_VERSION;
      state.scope.entity = 'OTHER';
      state.completeness.confirmed = false;
      state.events[0].context = 'OTHER';
      release();
      const value = await pending;
      if (action === 'replay')
        assert.deepEqual(
          (value as Awaited<ReturnType<typeof replayAsset>>).result,
          expected.result,
        );
      if (action === 'save')
        assert.deepEqual(
          (await restoreAsset(value as ArrayBuffer)).result,
          expected.result,
        );
      if (action === 'export')
        assert.equal(
          (await book(value as ArrayBuffer))
            .getWorksheet('Summary')!
            .getCell('B6').value,
          'accepted',
        );
    } finally {
      release();
      crypto.subtle.digest = native;
    }
  }
});
void test('long decisions require all physical members, current context, four intact originals and ready complete scope', async () => {
  const state = await assetLongFixture();
  state.completeness = {
    confirmed: true,
    reference: 'SYN-COMPLETE',
    note: 'Synthetic selected scope',
  };
  let r = (await replayAsset(state)).result;
  for (const [type, id, review] of [
    ['accept', 'SYN-A', 'accepted'],
    ['undo', 'SYN-U', 'needs-review'],
    ['reject', 'SYN-R', 'rejected'],
  ] as const) {
    state.events.push({
      ...event(type, id),
      context: r.context,
      memberIds: [...r.memberIds],
    });
    r = (await restoreAsset(await saveAsset(state))).result;
    assert.equal(r.review, review);
  }
  const stale = structuredClone(state);
  stale.readings[0].family = ASSET_VERSION;
  await assert.rejects(replayAsset(stale), /EVENT/);
  const changed = structuredClone(state);
  editAssetLongRows(changed, 0, (rows) => {
    rows[1][0] = 'OTHER';
  });
  await assert.rejects(replayAsset(changed), /EVENT/);
  const tampered = structuredClone(state);
  tampered.events[0].memberIds.pop();
  await assert.rejects(replayAsset(tampered), /EVENT_MEMBERS/);
  const hash = structuredClone(state);
  hash.files[3].sha256 = '0'.repeat(64);
  await assert.rejects(replayAsset(hash), /SOURCE_HASH/);
  const invented = structuredClone(r);
  invented.totals!.register.cost++;
  await assert.rejects(exportAsset(state, invented), /STALE_EXPORT/);
  for (const name of [
    '29-missing-zero-mapping',
    '42-malformed-last-row-width',
    '39-net-equal-component-differences',
  ]) {
    const blocked = await assetLongFixture(name);
    blocked.completeness = state.completeness;
    const b = (await replayAsset(blocked)).result;
    blocked.events = [
      {
        ...event('accept', 'SYN-B'),
        context: b.context,
        memberIds: [...b.memberIds],
      },
    ];
    await assert.rejects(replayAsset(blocked), /EVENT_ACCEPT/);
    blocked.events[0].type = 'reject';
    assert.equal(
      (await restoreAsset(await saveAsset(blocked))).result.review,
      'rejected',
    );
  }
});
