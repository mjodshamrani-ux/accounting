// Runs one hard-case scenario through the production supplier path of a given
// engine tree and scores it against the generator's own facts. The engine is
// only observed: expected groups, amounts and outcomes come from the scenario.
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderSource, sourceTable } from '../reliability/renderers.mjs';
export const HARD_EVALUATOR_VERSION = 'tarasuf-hard-evaluator-1.0.0';

export async function loadHardEngine(root) {
  const load = (name) =>
    import(
      pathToFileURL(resolve(root, 'lib/reconciliation', `${name}.ts`)).href
    );
  const [io, core, selection, formats, readiness, supplier, types] =
    await Promise.all(
      [
        'io',
        'core',
        'import-selection',
        'format-inference',
        'input-readiness',
        'supplier-reconciliation',
        'types',
      ].map(load),
    );
  return {
    ...io,
    ...core,
    ...selection,
    ...formats,
    ...readiness,
    ...supplier,
    ...types,
  };
}

const toArrayBuffer = (bytes) =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const inPeriod = (row, meta) =>
  /^\d{4}-\d{2}-\d{2}$/.test(row.date) &&
  !Number.isNaN(Date.parse(row.date)) &&
  new Date(row.date).toISOString().slice(0, 10) === row.date &&
  row.date >= meta.periodStart &&
  row.date <= meta.cutoff;

/** A source as the engine will see it: file bytes through the real reader,
 * or (logical mode) the rendered table handed over as a sheet. */
async function prepareSource(engine, source, mode) {
  if (
    source.invalid === 'corrupt-file' ||
    mode === 'file' ||
    (source.format === 'pdf' && mode === 'file')
  ) {
    const rendered = await renderSource(source);
    const file = await engine.readFile(
      rendered.name,
      toArrayBuffer(rendered.bytes),
      undefined,
      true,
    );
    return { file, rendered };
  }
  const table = sourceTable(source);
  const text = table.rows.map((r) => r.join('\t')).join('\n');
  const file = {
    name: source.name.replace(/\.\w+$/, '.csv'),
    sha256: createHash('sha256').update(text).digest('hex'),
    sheets: [
      {
        name: 'CSV',
        rows: table.rows.map((r) => r.map(String)),
        formulaRows: [],
        hiddenRows: [],
      },
    ],
  };
  return {
    file,
    rendered: {
      headerRow: table.headerRow,
      bindings: table.bindings,
      expectedRows: table.expectedRows,
      sheetIndex: 0,
      format: 'csv',
    },
  };
}

/** The accountant's reading: the product's own column selection, corrected
 * from the known layout only where it chose wrongly (counted as a correction). */
function reading(engine, file, source, rendered, confirmations) {
  const selected = engine.selectImportMapping(file, source.side).mapping;
  const b = rendered.bindings;
  const expected = {
    sheet: rendered.sheetIndex ?? 0,
    header: rendered.headerRow,
    date: b.date,
    reference: b.reference,
    description: b.description,
    amount: b.amount,
    debit: b.debit,
    credit: b.credit,
    currencyColumn: b.currency ?? -1,
    mode: b.mode,
  };
  let mapping = { ...selected };
  const differs = Object.entries(expected).some(
    ([k, v]) => k !== 'currencyColumn' && selected[k] !== v,
  );
  if (differs) {
    confirmations.push(`${source.side}: columns set by the accountant`);
    mapping = { ...selected, ...expected };
  }
  mapping.dateFormat = source.metadata.dateFormat;
  mapping.numberFormat =
    source.layout.style === 'comma-decimals' ? 'comma' : 'dot';
  if (file.pdf) {
    mapping.pdfReviewed = true;
    confirmations.push(`${source.side}: PDF reviewed against the original`);
  }
  return mapping;
}

export async function evaluateHardCase(spec, engine, mode = 'logical') {
  const started = performance.now();
  const record = {
    id: spec.id,
    template: spec.template,
    family: spec.family,
    variant: spec.variant,
    split: spec.split,
    seed: spec.seed,
    mode,
    formats: spec.sources.map((s) => s.format),
    expect: spec.oracle.expect,
    outcome: null,
    stopped: null,
    confirmations: [],
    counts: {
      rowsExpected: 0,
      rowsRead: 0,
      rowsErrored: 0,
      rowsLost: 0,
      silentMisreads: 0,
      evidenceLost: 0,
      approvedExpected: 0,
      approvedAchieved: 0,
      controlsExpected: 0,
      controlsAchieved: 0,
      falseApprovals: 0,
      wrongMemberGroups: 0,
    },
    findings: [],
  };
  const c = record.counts;
  const files = [],
    mappings = [],
    rendered = [];
  const scope = {
    supplier: spec.sources[0].metadata.supplier,
    entity: spec.sources[0].metadata.entity,
    account: spec.sources[0].metadata.account,
    currency: spec.sources[0].metadata.currency,
    decimals: spec.sources[0].metadata.decimals,
    cutoff: spec.sources[0].metadata.cutoff,
    dateWindow: 2,
    confirmed: true,
    coverageConfirmed: false,
  };
  let result;
  try {
    for (const source of spec.sources) {
      const prepared = await prepareSource(engine, source, mode);
      files.push(prepared.file);
      rendered.push(prepared.rendered);
      const mapping = reading(
        engine,
        prepared.file,
        source,
        prepared.rendered,
        record.confirmations,
      );
      // An ambiguous format is answered as the accountant would, unless the
      // scenario withholds the answer to test the stop.
      const formats = engine.suggestFormats(
        prepared.file,
        mapping,
        scope.decimals,
      );
      for (const field of ['numberFormat', 'dateFormat'])
        if (
          formats[field].status === 'ambiguous' &&
          !spec.oracle.withholdFormat
        ) {
          mapping.formatChoice = {
            ...mapping.formatChoice,
            [field]: engine.formatChoice(
              prepared.file,
              mapping,
              field,
              mapping[field],
              formats[field].candidates,
              scope.decimals,
            ),
          };
          record.confirmations.push(`${source.side}: ${field} answered`);
        }
      mappings.push(mapping);
    }
    result = engine.reconcileSupplierStatement({
      files,
      mappings,
      scope,
    }).result;
  } catch (error) {
    record.stopped = {
      message: String(error?.message ?? error).slice(0, 300),
      code: error?.readiness?.code ?? null,
      kind:
        error instanceof TypeError || error instanceof RangeError
          ? 'crash'
          : 'refusal',
    };
  }
  // Map the engine's rows back to the generator's keys by content, preferring
  // the rendered row position.
  const keyOf = new Map();
  if (result)
    for (const [i, side] of [
      [0, result.supplier],
      [1, result.ledger],
    ]) {
      const spec_ = spec.sources[i];
      const positions = new Map(
        (rendered[i].expectedRows ?? []).map((e) => [e.key, e.row]),
      );
      const oracleRows = spec_.rows.filter((r) => inPeriod(r, spec_.metadata));
      c.rowsExpected += oracleRows.length;
      c.rowsErrored += side.errors.filter((e) => e.row > 0).length;
      const used = new Set();
      for (const t of side.transactions) {
        // The engine's reference is one of the row's written identities (for a
        // payment its bank reference, for example); any other value is a misread.
        const identities = (r) =>
          [
            r.reference,
            r.bankReference,
            r.receiptReference,
            r.voucherReference,
            r.poReference,
          ]
            .filter(Boolean)
            .map((v) => String(v).trim());
        const same = oracleRows.filter(
          (r) =>
            !used.has(r.key) &&
            r.minor === t.amount &&
            r.date === t.date &&
            (t.reference.trim() === ''
              ? !identities(r).length || !r.reference
              : identities(r).includes(t.reference.trim())),
        );
        const row = same.find((r) => positions.get(r.key) === t.row) ?? same[0];
        if (!row) {
          // Read differently from what the file says, with no issue raised.
          if (!t.referenceEvidenceIssues?.length) c.silentMisreads++;
          record.findings.push(
            `unmapped ${t.id} ${t.reference} ${t.date} ${t.amount}`,
          );
          continue;
        }
        used.add(row.key);
        keyOf.set(t.id, row.key);
        c.rowsRead++;
        for (const field of [
          'batch',
          'voucherReference',
          'bankReference',
          'poReference',
        ])
          if (
            row[field] &&
            spec_.layout.fields.includes(field) &&
            !Object.values(t).includes(row[field])
          ) {
            c.evidenceLost++;
            record.findings.push(`evidence lost: ${row.key} ${field}`);
          }
        if (
          row.reference &&
          !Object.values(t).includes(row.reference) &&
          !Object.values(t).some(
            (v) =>
              Array.isArray(v) && v.some((e) => e?.value === row.reference),
          )
        ) {
          c.evidenceLost++;
          record.findings.push(`evidence lost: ${row.key} mapped reference`);
        }
      }
      c.rowsLost += Math.max(
        0,
        oracleRows.length -
          used.size -
          side.errors.filter((e) => e.row > 0).length,
      );
    }
  // Approved groups against the engine's matched cases.
  const matched = result
    ? result.cases
        .filter((x) => x.status === 'Matched')
        .map((x) => ({
          a: x.supplierMembers.map((t) => keyOf.get(t.id) ?? t.id).sort(),
          b: x.ledgerMembers.map((t) => keyOf.get(t.id) ?? t.id).sort(),
        }))
    : [];
  const same = (g, m) =>
    JSON.stringify([[...g.a].sort(), [...g.b].sort()]) ===
    JSON.stringify([m.a, m.b]);
  const overlaps = (g, m) =>
    g.a.some((k) => m.a.includes(k)) || g.b.some((k) => m.b.includes(k));
  for (const g of spec.oracle.approved) {
    if (g.control) c.controlsExpected++;
    else c.approvedExpected++;
    if (matched.some((m) => same(g, m)))
      g.control ? c.controlsAchieved++ : c.approvedAchieved++;
  }
  for (const m of matched)
    if (!spec.oracle.approved.some((g) => same(g, m))) {
      if (spec.oracle.approved.some((g) => overlaps(g, m)))
        c.wrongMemberGroups++;
      else c.falseApprovals++;
      record.findings.push(
        `unexpected approval ${m.a.join('+')} | ${m.b.join('+')}`,
      );
    }
  // Where the rows under test ended up.
  const targets = new Set(spec.oracle.targetKeys);
  const statusOf = new Map();
  if (result)
    for (const x of result.cases)
      for (const t of [...x.supplierMembers, ...x.ledgerMembers]) {
        const key = keyOf.get(t.id);
        if (key && targets.has(key)) statusOf.set(key, x.status);
      }
  record.outcome = record.stopped
    ? 'stopped'
    : !targets.size
      ? 'no-target-rows'
      : [...targets].every((k) => statusOf.get(k) === 'Matched')
        ? 'auto'
        : [...targets].some((k) => statusOf.get(k) === 'Needs Review')
          ? 'review'
          : 'unmatched';
  // Verdict against the expectation fixed by the generator.
  const safe =
    !c.falseApprovals &&
    !c.wrongMemberGroups &&
    !c.silentMisreads &&
    !c.rowsLost;
  const expect = spec.oracle.expect;
  const everyApproved =
    c.approvedAchieved === c.approvedExpected &&
    c.controlsAchieved === c.controlsExpected;
  let verdict;
  if (record.stopped?.kind === 'crash') verdict = 'fail-crash';
  else if (!safe) verdict = 'fail-unsafe';
  else if (expect === 'auto')
    verdict = everyApproved
      ? 'pass'
      : record.stopped
        ? 'fail-unnecessary-stop'
        : 'fail-missed';
  else if (expect === 'external')
    verdict =
      record.stopped?.code === 'FORMAT_AMBIGUOUS_UNRESOLVED'
        ? 'pass'
        : 'fail-no-stop';
  else if (expect === 'invalid')
    verdict =
      record.stopped ||
      c.rowsErrored > 0 ||
      result?.supplier.errors.length ||
      result?.ledger.errors.length
        ? 'pass'
        : 'fail-invalid-accepted';
  else
    verdict = record.stopped
      ? 'fail-unnecessary-stop'
      : c.controlsAchieved === c.controlsExpected
        ? 'pass'
        : 'fail-controls-missed';
  record.verdict = verdict;
  record.ms = Math.round(performance.now() - started);
  return record;
}
