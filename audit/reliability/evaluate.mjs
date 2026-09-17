// End-to-end evaluator. Expected facts come only from the independent generator.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { verifyWorkbook } from './verify-workbook.mjs';

export async function loadEngine(root) {
  const load = (name) =>
    import(
      pathToFileURL(resolve(root, 'lib/reconciliation', name + '.ts')).href
    );
  const [io, core, selection, formats, types, scope] = await Promise.all(
    [
      'io',
      'core',
      'import-selection',
      'format-inference',
      'types',
      'scope-inference',
    ].map(load),
  );
  return { ...io, ...core, ...selection, ...formats, ...types, ...scope };
}
const groupKey = (a, b) => JSON.stringify([[...a].sort(), [...b].sort()]);
const sum = (values) => Number(values.reduce((a, b) => a + BigInt(b), 0n));
const arrayBuffer = (b) =>
  b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
const compactError = (e) => String(e?.message ?? e).slice(0, 900);

export async function evaluateCase(
  spec,
  rendered,
  engine,
  { exports = true } = {},
) {
  const start = performance.now();
  const record = {
    id: spec.id,
    category: spec.category,
    split: spec.split,
    scenario: spec.scenario,
    fingerprint: spec.economicFingerprint,
    families: spec.sources.map((s) => s.layout.family),
    formats: rendered.files.map((f) => f.format),
    failures: [],
    warnings: [],
    confirmations: [],
    permittedMatches: spec.oracle.permittedAutoMatches.length,
    expectedMatches: spec.oracle.invalid
      ? 0
      : spec.oracle.permittedAutoMatches.filter(
          (g) => g.aKeys.length === 1 && g.bKeys.length === 1,
        ).length,
    correctMatches: 0,
    correctRequiredMatches: 0,
    permittedGroups: spec.oracle.permittedAutoMatches.filter(
      (g) => g.aKeys.length + g.bKeys.length > 2,
    ).length,
    acceptedGroups: 0,
    falseMatches: 0,
    falseMatchValueMinor: '0',
    expectedRows: spec.oracle.rows.length,
    validExpectedRows: spec.oracle.activeRows.filter(
      (r) => !spec.oracle.unreadableKeys?.includes(r.key),
    ).length,
    currency: spec.sources[0].metadata.currency,
    extractedRows: 0,
    excludedRows: 0,
    exceptionRows: spec.oracle.expectedExceptions.length,
    handledExceptionRows: 0,
    mappingAutomatic: true,
    exportChecked: false,
    bridgeChecked: false,
    stopped: false,
  };
  const fail = (code, detail, safety = true) =>
    record.failures.push({
      code,
      detail: String(detail).slice(0, 900),
      safety,
    });
  const checkControlled = (e) => {
    if (
      !(e instanceof Error) ||
      [
        'TypeError',
        'ReferenceError',
        'RangeError',
        'SyntaxError',
        'AbortError',
        'TimeoutError',
        'EvalError',
        'URIError',
      ].includes(e.name)
    )
      fail('UNCONTROLLED_FAILURE', compactError(e));
  };
  const m = spec.sources[0].metadata;
  // These settings represent an accountant confirming facts printed in both sources.
  // They are NOT reported as automatic inference; hidden economic IDs never enter engine calls.
  const scope = {
    supplier: m.supplier,
    entity: m.entity,
    account: m.account,
    currency: m.currency,
    decimals: m.decimals,
    cutoff: m.cutoff,
    dateWindow: m.dateWindow,
    confirmed: true,
    coverageConfirmed: true,
  };
  record.confirmations.push(
    'scope and sign explicitly confirmed from printed source',
  );
  let result;
  const files = [],
    sources = [],
    mappings = [];
  try {
    for (let i = 0; i < 2; i++) {
      const output = rendered.files[i],
        source = spec.sources[i];
      let file;
      try {
        file = await engine.readFile(
          output.name,
          arrayBuffer(output.bytes),
          undefined,
          true,
        );
      } catch (e) {
        checkControlled(e);
        record.stopped = true;
        record.warnings.push(`read ${output.side}: ${compactError(e)}`);
        if (!source.invalid) fail('READ_VALID_SOURCE', compactError(e), false);
        break;
      }
      files.push(file);
      if (
        file.sha256 !== createHash('sha256').update(output.bytes).digest('hex')
      )
        fail('SOURCE_HASH_CHANGED', output.side);
      let mapping = engine.selectImportMapping(file, source.side).mapping;
      const selected = file.sheets[mapping.sheet];
      const required =
        mapping.date >= 0 &&
        (mapping.mode === 'signed'
          ? mapping.amount >= 0
          : mapping.debit >= 0 && mapping.credit >= 0);
      if (!selected || !required) {
        record.mappingAutomatic = false;
        record.warnings.push(`${source.side}: manual mapping required`);
        if (!source.invalid) {
          // Simulate the documented manual column-selection path, using visible writer bindings.
          mapping = {
            ...engine.defaultMapping(),
            sheet: output.sheetIndex ?? 0,
            header: output.headerRow,
            date: output.bindings.date,
            reference: output.bindings.reference,
            description: output.bindings.description,
            amount: output.bindings.amount,
            debit: output.bindings.debit,
            credit: output.bindings.credit,
            currencyColumn: output.bindings.currency,
            mode: output.bindings.mode,
          };
          record.confirmations.push(`${source.side}: manual columns`);
        }
      }
      const formats = engine.suggestFormats(file, mapping, scope.decimals);
      if (spec.oracle.requiresFormatReview?.includes(source.side)) {
        if (formats.numberFormat.status === 'proven')
          fail(
            'AMBIGUITY_NOT_RECOGNIZED',
            'A source with two valid monetary interpretations was treated as proven',
          );
        record.stopped = true;
        record.confirmations.push(
          `${source.side}: unresolved monetary ambiguity, no default supplied`,
        );
        record.warnings.push(formats.numberFormat.reason);
        break;
      }
      mapping = { ...mapping, ...formats.patch };
      if (formats.numberFormat.status !== 'proven') {
        mapping.numberFormat = source.metadata.numberFormat;
        record.confirmations.push(
          `${source.side}: number format ${formats.numberFormat.status}`,
        );
      }
      if (formats.dateFormat.status !== 'proven') {
        mapping.dateFormat = source.metadata.dateFormat;
        record.confirmations.push(
          `${source.side}: date format ${formats.dateFormat.status}`,
        );
      }
      // Explicit report classification is visible in the source title. Aging has no supported choice.
      if (source.metadata.reportType === 'open-items') {
        mapping.reportType = 'open-items';
        record.confirmations.push(`${source.side}: open-items report`);
      }
      if (file.pdf) {
        mapping.pdfReviewed = true;
        record.confirmations.push(`${source.side}: PDF visual review required`);
      }
      mappings.push(mapping);
      try {
        sources.push(engine.normalizeSource(file, mapping, scope, source.side));
      } catch (e) {
        checkControlled(e);
        record.stopped = true;
        record.warnings.push(`normalize ${source.side}: ${compactError(e)}`);
        if (!spec.oracle.invalid && !spec.oracle.requiresScopeStop)
          fail('NORMALIZE_VALID_SOURCE', compactError(e), false);
        break;
      }
    }
    if (sources.length === 2) {
      try {
        result = engine.compare(sources[0], sources[1], scope);
      } catch (e) {
        checkControlled(e);
        record.stopped = true;
        record.warnings.push(`compare: ${compactError(e)}`);
        if (!spec.oracle.requiresScopeStop && !spec.oracle.invalid)
          fail('COMPARE_VALID_SOURCE', compactError(e), false);
      }
    }
    const byId = new Map();
    const byKey = new Map();
    const expectedExport = [];
    for (let i = 0; i < sources.length; i++) {
      const actual = sources[i],
        source = spec.sources[i],
        output = rendered.files[i];
      record.warnings.push(
        ...actual.errors.map((e) => `${source.side}:${e.row}: ${e.message}`),
        ...actual.warnings,
      );
      const used = new Set();
      for (const tx of actual.transactions) {
        // Match canonical source tuples as a multiset; duplicate references are not row identifiers.
        const candidates = source.rows.filter(
          (r) =>
            !used.has(r.key) &&
            r.reference === tx.reference &&
            r.date === tx.date &&
            r.minor === tx.amount,
        );
        const exact = candidates.find((r) =>
          output.format === 'pdf'
            ? output.expectedRows.find((e) => e.key === r.key)?.page ===
              tx.sourcePage
            : output.expectedRows.find((e) => e.key === r.key)?.row === tx.row,
        );
        const row = exact;
        if (!row) {
          fail(
            'EXTRACTED_ROW_MISMATCH',
            `${source.side}:${tx.row} ${tx.reference} ${tx.date} ${tx.amount}`,
          );
          continue;
        }
        used.add(row.key);
        byId.set(tx.id, row);
        byKey.set(row.key, tx);
        record.extractedRows++;
        const renderedDescription = source.layout.multiline
          ? row.description.replace(' ', '\n')
          : row.description;
        const description = tx.description;
        if (
          tx.description.replace(/\s+/g, ' ').trim() !==
          renderedDescription.replace(/\s+/g, ' ').trim()
        )
          fail(
            'DESCRIPTION_CHANGED',
            `${source.side}:${tx.row} ${JSON.stringify(tx.description)} expected ${JSON.stringify(renderedDescription)}`,
          );
        if (tx.currency !== row.currency)
          fail(
            'CURRENCY_CHANGED',
            `${source.side}:${tx.row} ${tx.currency} expected ${row.currency}`,
          );
        if (!tx.originalAmount || !tx.id || !tx.sheet)
          fail('MISSING_PROVENANCE', tx.id);
        if (tx.sheet !== output.sheetName)
          fail(
            'SOURCE_SHEET_CHANGED',
            `${tx.sheet} expected ${output.sheetName}`,
          );
        const rawRow = files[i].sheets[actual.mapping.sheet].rows[tx.row - 1];
        const rawAmount =
          actual.mapping.mode === 'signed'
            ? rawRow?.[actual.mapping.amount]?.trim()
            : `${rawRow?.[actual.mapping.debit]?.trim() ?? ''} | ${rawRow?.[actual.mapping.credit]?.trim() ?? ''}`;
        if (tx.originalAmount !== rawAmount)
          fail('ORIGINAL_AMOUNT_CHANGED', tx.id);
        if (
          actual.mapping.reference >= 0 &&
          tx.reference !== rawRow?.[actual.mapping.reference]?.trim()
        )
          fail('SOURCE_REFERENCE_PROVENANCE', tx.id);
        expectedExport.push({
          id: tx.id,
          side: source.side,
          sheet: output.sheetName,
          row:
            output.format === 'pdf'
              ? tx.row
              : output.expectedRows.find((e) => e.key === row.key).row,
          page:
            output.format === 'pdf'
              ? output.expectedRows.find((e) => e.key === row.key)?.page
              : undefined,
          reference: row.reference,
          description,
          date: row.date,
          minor: row.minor,
          originalAmount: rawAmount,
        });
      }
      for (const row of source.rows) {
        if (used.has(row.key)) continue;
        const position = output.expectedRows.find((e) => e.key === row.key);
        if (!position) continue;
        const excluded = actual.excluded.find((e) =>
          output.format === 'pdf'
            ? e.values.includes(row.reference) && row.reference
            : e.row === position.row,
        );
        const error = actual.errors.some(
          (e) =>
            e.row === 0 ||
            e.row === (output.format === 'pdf' ? position.row : position.row),
        );
        const afterCutoff = spec.oracle.expectedExclusions.some(
          (e) => e.key === row.key,
        );
        if (afterCutoff && excluded) {
          record.excludedRows++;
          continue;
        }
        if (source.invalid || error) continue;
        // Any valid transaction missing without a permitted exclusion/error is silent loss.
        fail(
          'LOST_SOURCE_ROW',
          `${row.key} ${row.reference} (${source.side}, page ${position.page}, row ${position.row})`,
        );
      }
      if (
        actual.transactions.every((t) => byId.has(t.id)) &&
        actual.total !==
          sum(actual.transactions.map((t) => byId.get(t.id).minor))
      )
        fail('SOURCE_TOTAL_CHANGED', source.side);
      // Every physical parsed row must be represented or excluded with a reason, even when malformed.
      const represented = new Set([
        ...actual.transactions.map((t) => t.row),
        ...actual.excluded.map((e) => e.row),
        ...actual.errors.map((e) => e.row),
      ]);
      for (
        let ri = 1;
        ri <= files[i].sheets[actual.mapping.sheet]?.rows.length;
        ri++
      )
        if (!represented.has(ri))
          fail('UNACCOUNTED_PARSED_ROW', `${source.side}:${ri}`);
      if (
        !spec.oracle.invalid &&
        !spec.oracle.requiresScopeStop &&
        actual.transactions.length !==
          source.rows.filter((r) => r.date <= scope.cutoff).length
      )
        fail(
          'EXTRACTION_INCOMPLETE',
          `${source.side}: ${actual.transactions.length} of ${source.rows.length}`,
          false,
        );
    }
    if (result) {
      const permitted = new Set(
          spec.oracle.permittedAutoMatches.map((g) =>
            groupKey(g.aKeys, g.bKeys),
          ),
        ),
        matchedKeys = new Set(),
        allMembers = new Set();
      for (const c of result.cases) {
        const a = c.supplierMembers.map(
            (t) => byId.get(t.id)?.key ?? `UNKNOWN:${t.id}`,
          ),
          b = c.ledgerMembers.map(
            (t) => byId.get(t.id)?.key ?? `UNKNOWN:${t.id}`,
          );
        for (const t of [...c.supplierMembers, ...c.ledgerMembers]) {
          if (allMembers.has(t.id)) fail('REUSED_SOURCE', t.id);
          allMembers.add(t.id);
        }
        const av = sum(
            c.supplierMembers.map((t) => byId.get(t.id)?.minor ?? t.amount),
          ),
          bv = sum(
            c.ledgerMembers.map((t) => byId.get(t.id)?.minor ?? t.amount),
          );
        if (
          c.supplierTotal !== av ||
          c.ledgerTotal !== bv ||
          c.variance !== av - bv ||
          c.bridgeEffect !== bv - av
        )
          fail('CASE_ARITHMETIC', c.caseId);
        if (!c.matchingRule || !c.evidence.length)
          fail('MISSING_DECISION_EVIDENCE', c.caseId);
        if (c.status === 'Matched') {
          for (const key of [...a, ...b]) matchedKeys.add(key);
          if (permitted.has(groupKey(a, b))) {
            record.correctMatches++;
            if (a.length === 1 && b.length === 1 && !spec.oracle.invalid)
              record.correctRequiredMatches++;
            else if (a.length + b.length > 2) record.acceptedGroups++;
          } else {
            record.falseMatches++;
            record.falseMatchValueMinor = String(
              BigInt(record.falseMatchValueMinor) + BigInt(Math.abs(av)),
            );
            fail(
              'FALSE_MATCH',
              `${c.caseId}: ${groupKey(a, b)} rule ${c.matchingRule}`,
            );
          }
        }
      }
      if (
        allMembers.size !==
        sources.reduce((n, s) => n + s.transactions.length, 0)
      )
        fail('CASE_PARTITION', 'Not every source is represented exactly once');
      const fromCases = result.cases
        .filter((c) => c.status === 'Matched')
        .map((c) =>
          groupKey(
            c.supplierMembers.map((t) => t.id),
            c.ledgerMembers.map((t) => t.id),
          ),
        )
        .sort();
      const fromMatches = result.matches
        .map((match) =>
          groupKey(
            match.supplierIds ?? [match.supplierId],
            match.ledgerIds ?? [match.ledgerId],
          ),
        )
        .sort();
      if (JSON.stringify(fromCases) !== JSON.stringify(fromMatches))
        fail(
          'MATCH_CASE_DISAGREEMENT',
          'The match list differs from the case partition',
        );
      const counts = {
        autoMatchedCases: result.cases.filter((c) => c.status === 'Matched')
          .length,
        matchedSourceRows: result.cases
          .filter((c) => c.status === 'Matched')
          .reduce(
            (n, c) => n + c.supplierMembers.length + c.ledgerMembers.length,
            0,
          ),
      };
      for (const k of Object.keys(counts))
        if (result.caseCounts[k] !== counts[k]) fail('CASE_COUNTS', k);
      record.handledExceptionRows = spec.oracle.expectedExceptions.filter(
        (e) => !matchedKeys.has(e.key),
      ).length;
      const missing = record.expectedMatches - record.correctRequiredMatches;
      if (missing > 0)
        fail(
          'AUTO_COMPLETION_GAP',
          `${missing} permitted matches left for review`,
          false,
        );
      if (
        spec.oracle.requiresScopeStop &&
        (result.matches.length || result.balanceComparable || result.bridge)
      )
        fail(
          'SCOPE_NOT_STOPPED',
          'A conflicting/invalid source allowed an accepted result',
        );
      const balances = spec.oracle.balances;
      if (result.balanceComparable && (!balances.comparable || !result.bridge))
        fail(
          'UNPROVEN_BALANCE_STATUS',
          'A complete balance status requires source evidence and a verified bridge',
        );
      if (result.bridge) {
        record.bridgeChecked = true;
        if (!balances.comparable)
          fail(
            'UNPROVEN_BRIDGE',
            'The source evidence does not support a balance bridge',
          );
        const expected = {
          delta: balances.difference,
          openingAdjustment: balances.openingB - balances.openingA,
          itemAdjustment: balances.cutoffMovementB - balances.cutoffMovementA,
          adjusted: balances.closingB,
          residual: 0,
        };
        for (const [key, value] of Object.entries(expected))
          if (result.bridge[key] !== value)
            fail(
              'BRIDGE_ARITHMETIC',
              `${key}: ${result.bridge[key]} expected ${value}`,
            );
      } else if (balances.comparable && !sources.some((s) => s.errors.length))
        fail(
          'BALANCE_COVERAGE_GAP',
          'Complete printed period/balances did not yield a bridge',
          false,
        );
      if (
        spec.oracle.invalid === 'wrong-total' &&
        (sources[0].balanceValid || result.balanceComparable)
      )
        fail('WRONG_TOTAL_ACCEPTED', 'Incorrect closing balance was verified');
      if (
        spec.oracle.invalid &&
        result.matches.length === 0 &&
        (!result.bridge || !result.balanceComparable)
      )
        record.stopped = true;
      // Determinism ignores file serialization timestamps, not result evidence or row identity.
      assert.deepEqual(
        engine.compare(sources[0], sources[1], scope),
        result,
        'Identical inputs must produce identical decisions',
      );
      if (
        exports &&
        expectedExport.length ===
          sources.reduce((n, s) => n + s.transactions.length, 0)
      ) {
        try {
          const bytes = await engine.exportWorkbook(result, files, {
            checked: false,
            name: '',
            notes: '',
          });
          await verifyWorkbook(bytes, {
            decimals: scope.decimals,
            currency: scope.currency,
            rows: expectedExport,
            cases: result.cases.map((c) => ({
              id: c.caseId,
              status: c.status,
              ids: [...c.supplierMembers, ...c.ledgerMembers].map((t) => t.id),
            })),
            bridge: result.bridge
              ? {
                  openingAdjustment: balances.openingB - balances.openingA,
                  adjusted: balances.closingB,
                  residual: 0,
                }
              : null,
            balances: {
              supplierOpening:
                sources[0].opening === null ? null : balances.openingA,
              ledgerOpening:
                sources[1].opening === null ? null : balances.openingB,
              supplierClosing:
                sources[0].closing === null ? null : balances.closingA,
              ledgerClosing:
                sources[1].closing === null ? null : balances.closingB,
            },
          });
          record.exportChecked = true;
        } catch (e) {
          fail('EXPORT_VALIDATION', compactError(e));
        }
      }
    } else if (!spec.oracle.invalid && !spec.oracle.requiresScopeStop)
      fail('NO_COMPARISON', 'No result for valid supported source', false);
    if (
      spec.oracle.invalid &&
      !record.stopped &&
      !result?.supplier.errors.length &&
      !result?.ledger.errors.length &&
      spec.oracle.invalid !== 'wrong-total'
    )
      fail('INVALID_NOT_FLAGGED', spec.oracle.invalid);
  } catch (e) {
    fail('HARNESS_OR_ENGINE_EXCEPTION', e.stack ?? e);
  }
  if (record.stopped && record.falseMatches === 0)
    record.handledExceptionRows = record.exceptionRows;
  record.ms = Number((performance.now() - start).toFixed(2));
  record.safetyPass = !record.failures.some((f) => f.safety);
  record.pass = record.failures.length === 0;
  return record;
}
