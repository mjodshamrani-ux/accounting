// Runs one hard-case scenario through the production supplier path of a given
// engine tree and judges it against the contract the generator wrote before
// any engine ran. The engine is only observed: expected groups, amounts,
// outcomes, signals and rejection reasons come from the scenario.
//
// Two independences, kept apart (2.0.0):
// - the expected values are computed by the generator from its own integer
//   facts, never by engine functions (no compare, parseMoney or classifier);
// - the test source is not independent: the files are written by this
//   repository's own renderers (audit/reliability/renderers.mjs). A result
//   here is a synthetic, repository-held check, not an outside one.
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  headers as HEADER_LABELS,
  renderSource,
  sourceTable,
} from '../reliability/renderers.mjs';
export const HARD_EVALUATOR_VERSION = 'tarasuf-hard-evaluator-2.0.0';

/** Escape a catalogue key for a regular expression, with each `${…}`
 * placeholder standing for any text. */
const catalogPattern = (key) =>
  new RegExp(
    '^' +
      key
        .split('${…}')
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('[\\s\\S]*?') +
      '$',
  );

export async function loadHardEngine(root) {
  const load = (path) => import(pathToFileURL(resolve(root, path)).href);
  const names = [
    'io',
    'core',
    'import-selection',
    'format-inference',
    'input-readiness',
    'supplier-reconciliation',
    'types',
  ];
  const modules = await Promise.all(
    names.map((name) => load(`lib/reconciliation/${name}.ts`)),
  );
  // The product's own list of the messages it can show. A stop whose message
  // is not in it is an internal error, not an accounting refusal.
  const { engineCatalog } = await load('lib/i18n/engine-catalog.ts');
  const known = Object.keys(engineCatalog).map(catalogPattern);
  return Object.assign({}, ...modules, {
    knownMessage: (message) => {
      // Messages may carry a source-name prefix ("file.csv: ...") and join
      // several catalogue sentences; each sentence must be known.
      const text = String(message)
        .replace(/^[^:\n]{1,120}\.(?:csv|xlsx|pdf):\s*/i, '')
        .trim();
      if (known.some((p) => p.test(text))) return true;
      const parts = text.split(/(?<=[.。])\s+/).filter(Boolean);
      return (
        parts.length > 1 &&
        parts.every((part) => known.some((p) => p.test(part.trim())))
      );
    },
  });
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
  if (source.invalid === 'corrupt-file' || mode === 'file') {
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
      fields: table.fields,
      sheetIndex: 0,
      format: 'csv',
    },
  };
}

/** The reading the comparison runs with. Unaided: exactly what the product
 * proposes. Declared: the product's proposal, with every change a person
 * would have to make recorded as assistance. */
function reading(engine, file, source, rendered, assist, record) {
  const proposal = engine.selectImportMapping(file, source.side);
  const selected = proposal.mapping;
  const b = rendered.bindings;
  const truth = {
    sheet: rendered.sheetIndex ?? 0,
    header: rendered.headerRow,
    date: b.date,
    reference: b.reference,
    description: b.description,
    amount: b.amount,
    debit: b.debit,
    credit: b.credit,
    mode: b.mode,
  };
  const wrong = Object.keys(truth).filter((k) => selected[k] !== truth[k]);
  const dateFormat = source.metadata.dateFormat;
  const numberFormat =
    source.layout.style === 'comma-decimals' ? 'comma' : 'dot';
  record.productReading.push({
    side: source.side,
    kind: proposal.kind ?? null,
    wrongColumns: wrong,
    dateFormat: selected.dateFormat,
    numberFormat: selected.numberFormat,
  });
  if (assist === 'none') return { ...selected };
  const mapping = { ...selected };
  if (wrong.length) {
    Object.assign(mapping, truth);
    record.assistance.push({
      side: source.side,
      kind: 'columns',
      fields: wrong,
    });
  }
  for (const [field, value] of [
    ['dateFormat', dateFormat],
    ['numberFormat', numberFormat],
  ])
    if (mapping[field] !== value) {
      record.assistance.push({
        side: source.side,
        kind: field,
        from: mapping[field] ?? null,
        to: value,
      });
      mapping[field] = value;
    }
  if (file.pdf) {
    // A simulated decision of the accountant. It does not show that anyone
    // looked at the rendered page.
    mapping.pdfReviewed = true;
    record.assistance.push({
      side: source.side,
      kind: 'pdfReviewed',
      simulated: true,
    });
  }
  return mapping;
}

/** The header a role is written under in this source. */
const headerOf = (source, role) =>
  role === 'reference' && source.metadata.referenceHeader === 'Invoice No'
    ? 'Invoice No'
    : (HEADER_LABELS[source.layout.language] ?? HEADER_LABELS.en)[role];

/** Whether the engine row keeps a written value in its own role. A value
 * sitting in a field of another role does not count. */
function keepsInRole(t, role, value, header) {
  const retained = (field) =>
    (t.retainedEvidence ?? []).some(
      (e) =>
        e.field === field &&
        e.value === value &&
        String(e.header).trim() === header,
    );
  switch (role) {
    case 'reference':
      return (
        t.reference === value ||
        t.primaryReference === value ||
        t.documentReference === value ||
        retained('mappedReference')
      );
    case 'batch':
      return retained('batch');
    default:
      return t[role] === value;
  }
}

export async function evaluateHardCase(
  spec,
  engine,
  mode = 'logical',
  { assist = 'declared' } = {},
) {
  const started = performance.now();
  const contract = spec.oracle.contract;
  const record = {
    id: spec.id,
    template: spec.template,
    family: spec.family,
    variant: spec.variant,
    split: spec.split,
    seed: spec.seed,
    mode,
    assist,
    contract: contract.kind,
    formats: spec.sources.map((s) => s.format),
    expect: spec.oracle.expect,
    outcome: null,
    stopped: null,
    productReading: [],
    assistance: [],
    counts: {
      rowsExpected: 0,
      rowsRead: 0,
      rowsErrored: 0,
      rowsLost: 0,
      silentMisreads: 0,
      declaredReferenceIssues: 0,
      evidenceRequired: 0,
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
        assist,
        record,
      );
      // An ambiguous format is answered as the accountant would, unless the
      // run is unaided or the scenario withholds the answer to test the stop.
      if (assist !== 'none' && !spec.oracle.withholdFormat) {
        const formats = engine.suggestFormats(
          prepared.file,
          mapping,
          scope.decimals,
        );
        for (const field of ['numberFormat', 'dateFormat'])
          if (formats[field].status === 'ambiguous') {
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
            record.assistance.push({
              side: source.side,
              kind: 'formatChoice',
              field,
            });
          }
      }
      mappings.push(mapping);
    }
    result = engine.reconcileSupplierStatement({
      files,
      mappings,
      scope,
    }).result;
  } catch (error) {
    const message = String(error?.message ?? error);
    const code = error?.readiness?.code ?? null;
    record.stopped = {
      message: message.slice(0, 300),
      code,
      field: error?.readiness?.field ?? null,
      kind:
        error instanceof TypeError ||
        error instanceof RangeError ||
        error instanceof ReferenceError ||
        error instanceof SyntaxError
          ? 'crash'
          : code || engine.knownMessage(message)
            ? 'refusal'
            : 'internal-error',
    };
  }
  // Map the engine's rows back to the generator's keys. Where the row's
  // position in the file is known (tables), the row at that position is the
  // one the engine read, and its amount and date must be the file's: a
  // reference warning does not excuse a wrong amount or date.
  const keyOf = new Map();
  const txOfKey = new Map();
  if (result)
    for (const [i, side] of [
      [0, result.supplier],
      [1, result.ledger],
    ]) {
      const source = spec.sources[i];
      const positional = source.format !== 'pdf' || mode === 'logical';
      const positions = new Map(
        (rendered[i].expectedRows ?? []).map((e) => [e.row, e.key]),
      );
      const oracleRows = source.rows.filter((r) =>
        inPeriod(r, source.metadata),
      );
      const byKey = new Map(oracleRows.map((r) => [r.key, r]));
      c.rowsExpected += oracleRows.length;
      c.rowsErrored += side.errors.filter((e) => e.row > 0).length;
      const used = new Set();
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
      const accept = (t, row) => {
        used.add(row.key);
        keyOf.set(t.id, row.key);
        txOfKey.set(row.key, t);
        c.rowsRead++;
        if (!identities(row).includes(t.reference.trim()) && t.reference) {
          if (t.referenceEvidenceIssues?.length) c.declaredReferenceIssues++;
          else {
            c.silentMisreads++;
            record.findings.push(
              `misread reference ${row.key}: ${t.reference}`,
            );
          }
        }
      };
      for (const t of side.transactions) {
        const atPosition = positional
          ? byKey.get(positions.get(t.row))
          : undefined;
        if (atPosition && !used.has(atPosition.key)) {
          if (t.amount !== atPosition.minor || t.date !== atPosition.date) {
            c.silentMisreads++;
            record.findings.push(
              `misread ${atPosition.key}: ${t.date} ${t.amount} for ${atPosition.date} ${atPosition.minor}` +
                (t.referenceEvidenceIssues?.length
                  ? ' (a reference warning does not excuse it)'
                  : ''),
            );
            used.add(atPosition.key);
            continue;
          }
          accept(t, atPosition);
          continue;
        }
        const candidates = oracleRows.filter(
          (r) => !used.has(r.key) && r.minor === t.amount && r.date === t.date,
        );
        const row =
          candidates.find((r) => identities(r).includes(t.reference.trim())) ??
          candidates[0];
        if (!row) {
          c.silentMisreads++;
          record.findings.push(
            `unmapped ${t.id} ${t.reference} ${t.date} ${t.amount}`,
          );
          continue;
        }
        accept(t, row);
      }
      c.rowsLost += Math.max(
        0,
        oracleRows.length -
          used.size -
          side.errors.filter((e) => e.row > 0).length,
      );
      // Required evidence: every evidence column this source writes comes
      // back in its own role, with its header where it is kept aside.
      const written = rendered[i].fields ?? source.layout.fields ?? [];
      for (const row of oracleRows) {
        const t = txOfKey.get(row.key);
        if (!t) continue;
        for (const role of spec.oracle.requiredEvidence ?? []) {
          const value = role === 'reference' ? row.reference : row[role];
          if (!value || !written.includes(role)) continue;
          c.evidenceRequired++;
          if (!keepsInRole(t, role, String(value), headerOf(source, role))) {
            c.evidenceLost++;
            record.findings.push(`evidence lost: ${row.key} ${role}`);
          }
        }
      }
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
  // Where the rows under test ended up, and what their cases say.
  const targets = new Set(spec.oracle.targetKeys);
  const statusOf = new Map();
  const targetCases = [];
  if (result)
    for (const x of result.cases) {
      const members = [...x.supplierMembers, ...x.ledgerMembers];
      if (members.some((t) => targets.has(keyOf.get(t.id))))
        targetCases.push(x);
      for (const t of members) {
        const key = keyOf.get(t.id);
        if (key && targets.has(key)) statusOf.set(key, x.status);
      }
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
  // Required signals: the text of the cases holding the rows under test
  // (their evidence and their members' reading issues), or the stop.
  const caseText = targetCases
    .flatMap((x) => [
      ...x.evidence,
      ...[...x.supplierMembers, ...x.ledgerMembers].flatMap(
        (t) => t.referenceEvidenceIssues ?? [],
      ),
    ])
    .join('\n');
  const missingSignals = (contract.signals ?? []).filter((signal) => {
    const pattern = new RegExp(signal.pattern);
    if (signal.scope === 'stop')
      return !pattern.test(record.stopped?.message ?? '');
    return !pattern.test(caseText);
  });
  for (const s of missingSignals)
    record.findings.push(`required signal missing: /${s.pattern}/`);
  // The declared reason of an expected rejection.
  const rejectionMatches = (reason) => {
    if (!reason) return false;
    const stop = record.stopped;
    if (reason.code)
      return (
        stop?.code === reason.code &&
        (!reason.field || stop.field === reason.field)
      );
    const pattern = new RegExp(reason.pattern);
    return (
      (stop && pattern.test(stop.message)) ||
      !!result?.supplier.errors.some((e) => pattern.test(e.message)) ||
      !!result?.ledger.errors.some((e) => pattern.test(e.message))
    );
  };
  // Verdict against the contract fixed by the generator.
  const safe =
    !c.falseApprovals &&
    !c.wrongMemberGroups &&
    !c.silentMisreads &&
    !c.rowsLost;
  const controlsMet = c.controlsAchieved === c.controlsExpected;
  const stoppedForHelp =
    record.stopped?.kind === 'refusal' && assist === 'none';
  let verdict;
  if (['crash', 'internal-error'].includes(record.stopped?.kind))
    verdict = 'fail-crash';
  else if (!safe) verdict = 'fail-unsafe';
  else if (contract.kind === 'external' || contract.kind === 'invalid')
    verdict = rejectionMatches(contract.rejection)
      ? 'pass'
      : record.stopped ||
          result?.supplier.errors.length ||
          result?.ledger.errors.length
        ? 'fail-wrong-reason'
        : contract.kind === 'external'
          ? 'fail-no-stop'
          : 'fail-invalid-accepted';
  else if (record.stopped)
    verdict = stoppedForHelp ? 'needs-assistance' : 'fail-unnecessary-stop';
  else if (c.evidenceLost) verdict = 'fail-evidence-lost';
  else if (contract.kind === 'solve' || contract.kind === 'read')
    verdict =
      c.approvedAchieved === c.approvedExpected && controlsMet
        ? 'pass'
        : 'fail-missed';
  else if (!controlsMet) verdict = 'fail-controls-missed';
  else if (!contract.outcomes.includes(record.outcome))
    verdict = 'fail-outcome';
  else if (missingSignals.length) verdict = 'fail-signal-missing';
  else verdict = 'pass';
  record.verdict = verdict;
  record.ms = Math.round(performance.now() - started);
  return record;
}
