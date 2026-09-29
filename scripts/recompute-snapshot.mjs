// Records what every supplier reconciliation recompute path returns for the
// synthetic cases in tests/helpers/recompute-cases.ts: the worker's reconcile,
// compare, save-session, restore-session and export actions, a direct
// exportWorkbook call, and the tampered inputs each path must refuse.
//
// Run it on two engine trees and compare the files to show a refactor changed
// nothing but timings:
//   node --experimental-strip-types scripts/recompute-snapshot.mjs --root <tree> --out a.json
//   node --experimental-strip-types scripts/recompute-snapshot.mjs --out b.json
// Inputs are built by this tree; only the engine under test comes from --root.
// Everything stays in memory and on the local disk. No network.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import ExcelJS from 'exceljs';
import {
  coreResult,
  recomputeCases,
  productionWorker,
} from '../tests/helpers/recompute-cases.ts';
import {
  SOURCE_FAULTS,
  gateOrderSources,
  gateScope,
} from '../tests/helpers/gate-order-cases.ts';

const { values: args } = parseArgs({
  options: {
    root: { type: 'string', default: '.' },
    out: { type: 'string', default: 'work/recompute-snapshot.json' },
  },
});
const root = path.resolve(args.root);
const engine = (file) =>
  pathToFileURL(path.join(root, 'lib/reconciliation', file)).href;
const io = await import(engine('io.ts'));
const worker = await productionWorker(engine('worker.ts'));

const TIMESTAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g;
const bytes = (value) =>
  value instanceof ArrayBuffer ? new Uint8Array(value) : value;
/** Plain JSON, with byte buffers reduced to their hash. */
const canonical = (value) =>
  JSON.parse(
    JSON.stringify(value, (_, v) =>
      v instanceof ArrayBuffer || ArrayBuffer.isView(v)
        ? { sha256: createHash('sha256').update(bytes(v)).digest('hex') }
        : v,
    ),
  );
async function cells(buffer) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(buffer);
  const out = {};
  for (const sheet of book.worksheets)
    sheet.eachRow((row, r) =>
      row.eachCell((cell, c) => {
        const v =
          cell.value instanceof Date ? cell.value.toISOString() : cell.value;
        out[`${sheet.name}!${r}:${c}`] = JSON.stringify(v).replace(
          TIMESTAMP,
          '<time>',
        );
      }),
    );
  return out;
}
/** A reply without its durations; the stage names are kept. */
async function outcome(reply) {
  if (!reply) return null;
  const kept = {
    ok: reply.ok,
    timingStages: Object.keys(reply.timings ?? {}).sort(),
  };
  if (!reply.ok)
    return {
      ...kept,
      error: reply.error,
      ...(reply.readiness ? { readiness: canonical(reply.readiness) } : {}),
    };
  if (reply.action === 'export')
    return { ...kept, cells: await cells(reply.value) };
  if (reply.action === 'save-session')
    return {
      ...kept,
      session: JSON.parse(new TextDecoder().decode(reply.value)),
    };
  return { ...kept, value: canonical(reply.value) };
}
async function direct(run) {
  try {
    return { ok: true, cells: await cells(await run()) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}
const send = async (action, payload) => ({
  action,
  ...(await worker.send(action, payload)),
});
const review = { name: 'Synthetic reviewer', notes: '', checked: false };
const encode = (value) =>
  new TextEncoder().encode(JSON.stringify(value)).buffer;
const reconcileAll = async (c, mappings = c.mappings) => {
  const payload = {
    files: c.files,
    mappings,
    scope: c.scope,
    decisions: c.decisions,
    rejected: c.rejected,
  };
  return {
    reconcile: await send('reconcile', payload),
    compare: await send('compare', payload),
    save: await send('save-session', { ...payload, events: [], review }),
  };
};

const snapshot = { root: args.root, cases: {} };
for (const c of await recomputeCases()) {
  const paths = await reconcileAll(c);
  const restore = paths.save.ok
    ? await send('restore-session', { buffer: paths.save.value.slice(0) })
    : null;
  const exported = paths.reconcile.ok
    ? await send('export', {
        result: paths.reconcile.value.result,
        files: c.files,
        review,
      })
    : null;
  const exportedRestored = restore?.ok
    ? await send('export', {
        result: restore.value.result,
        files: restore.value.files,
        review,
      })
    : null;
  // The core result, sent to export without passing through the worker's
  // reconcile: this is how a caller could present an unchecked result.
  const core = coreResult(c);
  const record = {
    reconcile: await outcome(paths.reconcile),
    compare: await outcome(paths.compare),
    save: await outcome(paths.save),
    restore: await outcome(restore),
    export: await outcome(exported),
    exportRestored: await outcome(exportedRestored),
    workerExportOfCoreResult: await outcome(
      await send('export', { result: core, files: c.files, review }),
    ),
    directExportOfCoreResult: await direct(() =>
      io.exportWorkbook(core, c.files, review),
    ),
    tampered: {},
  };
  const result = paths.reconcile.ok ? paths.reconcile.value.result : null;
  if (result) {
    const amount = structuredClone(result);
    amount.supplier.transactions[0].amount += 1;
    record.tampered.amountBeforeExport = await outcome(
      await send('export', { result: amount, files: c.files, review }),
    );
    if (result.rejectedPairs.length) {
      const unrejected = { ...structuredClone(result), rejectedPairs: [] };
      record.tampered.rejectionDroppedBeforeExport = await outcome(
        await send('export', { result: unrejected, files: c.files, review }),
      );
    }
    // A malformed result, alone and with a second fault that stops the
    // reading. Only which refusal comes first can differ between engines.
    for (const [name, scope] of [
      ['malformedMatches', result.scope],
      ['malformedMatches.invalidScope', { ...result.scope, currency: 7 }],
    ]) {
      const malformed = { ...structuredClone(result), matches: null, scope };
      record.tampered[`${name}.workerExport`] = await outcome(
        await send('export', { result: malformed, files: c.files, review }),
      );
      record.tampered[`${name}.directExport`] = await direct(() =>
        io.exportWorkbook(malformed, c.files, review),
      );
    }
    const manual = result.matches.find((m) => m.kind === 'manual');
    if (manual) {
      const dropped = structuredClone(result);
      dropped.matches = dropped.matches.filter((m) => m.kind !== 'manual');
      record.tampered.manualDecisionDroppedBeforeExport = await outcome(
        await send('export', { result: dropped, files: c.files, review }),
      );
    }
  }
  const session = paths.save.ok
    ? JSON.parse(new TextDecoder().decode(paths.save.value))
    : null;
  const choice = c.mappings[0].formatChoice?.numberFormat;
  if (session && choice) {
    for (const [name, edit] of [
      ['sourceHash', (fc) => ({ ...fc, sourceHash: '0'.repeat(64) })],
      ['value', (fc) => ({ ...fc, value: 'comma' })],
      ['decimals', (fc) => ({ ...fc, decimals: 2 })],
    ]) {
      const corrupt = structuredClone(session);
      corrupt.mappings[0].formatChoice.numberFormat = edit(
        corrupt.mappings[0].formatChoice.numberFormat,
      );
      record.tampered[`savedFormatChoice.${name}.restore`] = await outcome(
        await send('restore-session', { buffer: encode(corrupt) }),
      );
      const mappings = [corrupt.mappings[0], c.mappings[1]];
      const other = await reconcileAll(c, mappings);
      record.tampered[`formatChoice.${name}.reconcile`] = await outcome(
        other.reconcile,
      );
      record.tampered[`formatChoice.${name}.compare`] = await outcome(
        other.compare,
      );
      // A result computed under the stale choice, sent straight to export.
      const stale = coreResult({ ...c, mappings });
      record.tampered[`formatChoice.${name}.workerExport`] = await outcome(
        await send('export', { result: stale, files: c.files, review }),
      );
      record.tampered[`formatChoice.${name}.directExport`] = await direct(() =>
        io.exportWorkbook(stale, c.files, review),
      );
    }
  }
  const evidence = c.mappings[1].directionEvidence;
  if (session && evidence) {
    for (const [name, mapping] of [
      [
        'checkedRows',
        {
          ...c.mappings[1],
          directionEvidence: {
            ...evidence,
            checkedRows: evidence.checkedRows + 1,
          },
        },
      ],
      [
        // The checked facts still hold; only the explanation was edited.
        'staleReason',
        {
          ...c.mappings[1],
          directionEvidence: {
            ...evidence,
            reason: `${evidence.reason} (edited)`,
          },
        },
      ],
      [
        'flippedSign',
        {
          ...c.mappings[1],
          multiplier: -c.mappings[1].multiplier,
          directionEvidence: {
            ...evidence,
            multiplier: -evidence.multiplier,
          },
        },
      ],
    ]) {
      const mappings = [c.mappings[0], mapping];
      const other = await reconcileAll(c, mappings);
      record.tampered[`direction.${name}.reconcile`] = await outcome(
        other.reconcile,
      );
      record.tampered[`direction.${name}.compare`] = await outcome(
        other.compare,
      );
      record.tampered[`direction.${name}.save`] = await outcome(other.save);
      const corrupt = structuredClone(session);
      corrupt.mappings[1] = mapping;
      record.tampered[`direction.${name}.restore`] = await outcome(
        await send('restore-session', { buffer: encode(corrupt) }),
      );
      if (other.reconcile.ok)
        record.tampered[`direction.${name}.export`] = await outcome(
          await send('export', {
            result: other.reconcile.value.result,
            files: c.files,
            review,
          }),
        );
      // The honest result with the conflicting claim attached to it.
      if (result) {
        const claimed = structuredClone(result);
        claimed.ledger.mapping = mapping;
        record.tampered[`direction.${name}.claimAddedBeforeExport`] =
          await outcome(
            await send('export', { result: claimed, files: c.files, review }),
          );
        record.tampered[`direction.${name}.directExport`] = await direct(() =>
          io.exportWorkbook(claimed, c.files, review),
        );
      }
      // Two faults at once: which refusal is reported first.
      const badScope = { ...c.scope, currency: 7 };
      for (const [label, ledger] of [
        ['provenClaim', c.mappings[1]],
        [name, mapping],
      ]) {
        const doubled = {
          files: c.files,
          mappings: [c.mappings[0], ledger],
          scope: badScope,
          decisions: c.decisions,
          rejected: c.rejected,
        };
        record.tampered[`direction.${label}.invalidScope.reconcile`] =
          await outcome(await send('reconcile', doubled));
        record.tampered[`direction.${label}.invalidScope.compare`] =
          await outcome(await send('compare', doubled));
      }
    }
  }
  snapshot.cases[c.name] = record;
}
// Which refusal comes first when the inputs carry more than one fault, on
// every path, for every combination across the two sources.
{
  const { files, proven, reading } = await gateOrderSources();
  const base = {
    files,
    scope: gateScope,
    decisions: [],
    rejected: [],
  };
  const saved = await send('save-session', {
    ...base,
    mappings: proven,
    events: [],
    review,
  });
  if (!saved.ok) throw new Error(`gate-order session: ${saved.error}`);
  const session = JSON.parse(new TextDecoder().decode(saved.value));
  const restoreWith = (mappings) =>
    send('restore-session', {
      buffer: encode({ ...session, mappings }),
    });
  snapshot.gateOrder = {};
  for (const supplierFault of SOURCE_FAULTS)
    for (const ledgerFault of SOURCE_FAULTS) {
      const mappings = [reading(0, supplierFault), reading(1, ledgerFault)];
      const payload = { ...base, mappings };
      const unchecked = coreResult({ name: '', ...payload });
      snapshot.gateOrder[`${supplierFault} | ${ledgerFault}`] = {
        reconcile: await outcome(await send('reconcile', payload)),
        compare: await outcome(await send('compare', payload)),
        restore: await outcome(await restoreWith(mappings)),
        workerExport: await outcome(
          await send('export', { result: unchecked, files, review }),
        ),
        directExport: await direct(() =>
          io.exportWorkbook(unchecked, files, review),
        ),
      };
    }
  // A reading that is not an object at all.
  const broken = [null, proven[1]];
  snapshot.gateOrder['no reading | ok'] = {
    reconcile: await outcome(
      await send('reconcile', { ...base, mappings: broken }),
    ),
    restore: await outcome(await restoreWith(broken)),
  };
}
worker.restore();
fs.mkdirSync(path.dirname(args.out), { recursive: true });
fs.writeFileSync(args.out, JSON.stringify(snapshot, null, 1));
for (const [key, paths] of Object.entries(snapshot.gateOrder))
  console.log(
    key.padEnd(34),
    Object.entries(paths)
      .map(
        ([k, v]) =>
          `${k}: ${v.ok ? 'ok' : (v.readiness?.code ?? v.error.slice(0, 18))}`,
      )
      .join(' · '),
  );
const summary = Object.fromEntries(
  Object.entries(snapshot.cases).map(([name, r]) => [
    name,
    Object.fromEntries(
      Object.entries({ ...r, ...r.tampered })
        .filter(([k]) => k !== 'tampered')
        .map(([k, v]) => [k, v === null ? '-' : v.ok ? 'ok' : 'refused']),
    ),
  ]),
);
if (process.env.SNAPSHOT_SUMMARY) console.log(JSON.stringify(summary, null, 1));
