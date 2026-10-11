// Actual original-source B1 replay/session/export against pre-product truth.
import assert from 'node:assert/strict';
import { readFile as fsRead, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from '../../lib/reconciliation/io.ts';
import {
  replayBank,
  saveBank,
  restoreBank,
  exportBank,
} from '../../lib/reconciliation/bank-io.ts';
import { BANK_VERSION, BANK_WD_FAMILY } from '../../lib/reconciliation/bank.ts';
import { copyFile, mkdtemp, readdir } from 'node:fs/promises';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const output = path.resolve(
  process.env.BANK_WD_PROOF_DIR ?? path.join(root, '../evidence/bank-wd-proof'),
);
await mkdir(output, { recursive: true });
const attempt = await mkdtemp(path.join(output, 'attempt-'));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const manifestBytes = await fsRead(
  path.join(here, 'frozen/INPUT-MANIFEST.json'),
);
assert.equal(
  sha(manifestBytes),
  '9ebd3eaf22bc90b021f7e65d82a1f4be3496b5976cfcef8076d5df641e669a95',
);
const manifest = JSON.parse(manifestBytes);
for (const f of manifest.files) {
  const b = await fsRead(path.join(here, 'frozen', f.path));
  assert.equal(b.length, f.bytes);
  assert.equal(sha(b), f.sha256);
}
const factsFiles = manifest.files
  .filter((f) => f.path.endsWith('/facts.json'))
  .map((f) => path.join(here, 'frozen', f.path));
factsFiles.push(
  path.join(here, 'supplemental/66-isolated-native-canonical-peer/facts.json'),
);
const receipts = [];
async function source(folder, name) {
  const bytes = await fsRead(path.join(folder, name));
  return readFile(name, Uint8Array.from(bytes).buffer);
}
async function cycle(folder, facts, legacy = false) {
  const files = await Promise.all(
    (legacy ? facts.canonicalControls : facts.files).map((name) =>
      source(folder, name),
    ),
  );
  const readings = ['bank-statement', 'cashbook'].map((role, i) => ({
    sheet: 0,
    role,
    family:
      legacy || facts.families[i] === 'canonical'
        ? BANK_VERSION
        : BANK_WD_FAMILY,
    perspective: facts.perspective ?? 'company-cash',
    confirmed: true,
  }));
  const input = { files, readings, scope: facts.scope, events: [] };
  let replay, error;
  try {
    replay = await replayBank(input);
  } catch (e) {
    error = e.message;
  }
  if (!legacy && facts.expected.status === 'structural-refusal') {
    assert.ok(error, `${facts.id} should refuse structurally`);
    return { id: facts.id, kind: 'structural-refusal', error };
  }
  assert.ok(!error, `${facts.id}: ${error}`);
  const { state, result } = replay;
  assert.equal(result.status, facts.expected.status, facts.id);
  if (facts.expected.signedMinor) {
    assert.deepEqual(
      [0, 1].map((side) =>
        result.records.filter((r) => r.side === side).map((r) => r.signed),
      ),
      facts.expected.signedMinor,
      facts.id,
    );
    assert.deepEqual(
      [0, 1].map((side) =>
        result.records
          .filter((r) => r.side === side)
          .reduce((s, r) => s + r.signed, 0),
      ),
      facts.expected.netMinor,
      facts.id,
    );
    for (const [key, status] of Object.entries(facts.expected.groups))
      assert.equal(
        result.cases.find((c) => c.key === key)?.status,
        status,
        `${facts.id}/${key}`,
      );
  }
  for (let side = 0; side < 2; side++) {
    assert.equal(
      result.inventory.filter((i) => i.side === side).length,
      files[side].sheets[0].rows.length,
    );
    for (const r of result.records.filter((r) => r.side === side)) {
      if (readings[side].family !== BANK_WD_FAMILY) continue;
      assert.ok(r.withdrawalDeposit);
      for (const [key, field] of [
        ['withdrawal', 'Withdrawal'],
        ['deposit', 'Deposit'],
      ]) {
        const cell = r.withdrawalDeposit[key];
        const raw =
          files[side].sheets[0].rows[r.row - 1][cell.column - 1] ?? '';
        assert.equal(cell.text, raw);
        assert.equal(files[side].sheets[0].rows[0][cell.column - 1], field);
        if (cell.state === 'blank-inactive') assert.equal(cell.minor, null);
        if (cell.state === 'explicit-zero-inactive')
          assert.equal(cell.minor, 0);
      }
    }
  }
  const name = facts.id + (legacy ? '-canonical-control' : '');
  const out = path.join(attempt, name);
  await mkdir(out);
  for (let i = 0; i < 2; i++)
    await copyFile(
      path.join(folder, (legacy ? facts.canonicalControls : facts.files)[i]),
      path.join(out, `source-${i}` + path.extname(files[i].name)),
    );
  const session = await saveBank(state);
  const restored = await restoreBank(session);
  assert.deepEqual(restored.result, result);
  const direct = await exportBank(state, result);
  const again = await exportBank(restored.state, restored.result);
  await writeFile(path.join(out, 'session.json'), new Uint8Array(session));
  await writeFile(path.join(out, 'direct.xlsx'), new Uint8Array(direct));
  await writeFile(path.join(out, 'restored.xlsx'), new Uint8Array(again));
  await writeFile(
    path.join(out, 'result.json'),
    JSON.stringify(result, null, 2) + '\n',
  );
  return {
    id: facts.id,
    kind: legacy ? 'canonical-control' : 'wd',
    status: result.status,
    records: result.records.length,
    inventory: result.inventory.length,
    sources: files.map((f) => ({ name: f.name, sha256: f.sha256 })),
    sessionReplay: true,
    directExportSha256: sha(new Uint8Array(direct)),
    restoredExportSha256: sha(new Uint8Array(again)),
    folder: name,
  };
}
for (const p of factsFiles) {
  const facts = JSON.parse(await fsRead(p));
  const folder = path.dirname(p);
  receipts.push(await cycle(folder, facts));
  if (facts.canonicalControls) receipts.push(await cycle(folder, facts, true));
}
const report = {
  passed: true,
  syntheticOnly: true,
  truthPrecedesProduct: true,
  inputManifestSha256: sha(manifestBytes),
  sourceCases: 66,
  canonicalControls: 20,
  receipts,
  browserRun: false,
};
await writeFile(
  path.join(attempt, 'RESULTS.json'),
  JSON.stringify(report, null, 2) + '\n',
);
const sealed = [];
async function collect(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) await collect(p);
    else {
      const b = await fsRead(p);
      sealed.push({
        path: path.relative(attempt, p),
        bytes: b.length,
        sha256: sha(b),
      });
    }
  }
}
await collect(attempt);
await writeFile(
  path.join(attempt, 'EVIDENCE-MANIFEST.json'),
  JSON.stringify({ files: sealed }, null, 2) + '\n',
);
console.log(
  JSON.stringify({
    passed: true,
    sourceCases: 66,
    canonicalControls: 20,
    cycles: receipts.filter((r) => r.folder).length,
    structuralRefusals: receipts.filter((r) => r.kind === 'structural-refusal')
      .length,
    attempt,
  }),
);
