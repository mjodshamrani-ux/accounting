// End-to-end evaluator. Expected facts come only from the independent generator.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { verifyWorkbook } from './verify-workbook.mjs';
import { currencyDecimals, interventionLevel } from './input-evidence.mjs';
export const EVALUATOR_VERSION = 'tarasuf-evaluator-2.1.0';

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
  let readiness = {};
  const readinessUrl = pathToFileURL(
    resolve(root, 'lib/reconciliation/input-readiness.ts'),
  ).href;
  try {
    readiness = await import(readinessUrl);
  } catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND' || error.url !== readinessUrl)
      throw error;
  }
  return {
    ...io,
    ...core,
    ...selection,
    ...formats,
    ...types,
    ...scope,
    ...readiness,
  };
}
/** Does the engine's own guard refuse this mapping while the ambiguity is
 * unanswered? Only the guard's declared refusal counts. A TypeError, a plain
 * Error or a missing guard is never protection, and each is reported as its own
 * outcome so an acceptance gate can reject it instead of reading it as a stop.
 */
function probeAmbiguityGate(engine, file, mapping, scope) {
  if (typeof engine.assertInputFormats !== 'function') return 'absent';
  try {
    engine.assertInputFormats([file], [mapping], scope);
    return 'accepted-without-choice';
  } catch (error) {
    if (typeof engine.isInputReadinessRejection !== 'function')
      // An older engine cannot state a code. Its refusal is recorded as
      // untyped rather than credited as a verified refusal.
      return error instanceof Error ? 'refused-untyped' : 'crashed';
    if (engine.isInputReadinessRejection(error, 'FORMAT_AMBIGUOUS_UNRESOLVED'))
      return 'refused';
    if (engine.isInputReadinessRejection(error)) return 'refused-wrong-code';
    return 'crashed';
  }
}
/** The other direction: once the accountant's answer is recorded for this exact
 * source and reading, the guard must let the case through. A guard that refuses
 * either way is not protection, it is a blanket block that costs real work.
 * The value used is one the document itself allows; this tests the gate, not the
 * accounting answer, so no oracle fact is consulted. */
function probeAnsweredAmbiguity(
  engine,
  file,
  mapping,
  scope,
  field,
  candidates,
) {
  if (
    typeof engine.assertInputFormats !== 'function' ||
    typeof engine.formatChoice !== 'function' ||
    !candidates.length
  )
    return 'not-applicable';
  const value = candidates[0];
  const answered = {
    ...mapping,
    [field]: value,
    formatChoice: {
      ...mapping.formatChoice,
      [field]: engine.formatChoice(
        file,
        { ...mapping, [field]: value },
        field,
        value,
        candidates,
        scope.decimals,
      ),
    },
  };
  try {
    engine.assertInputFormats([file], [answered], scope);
    return 'accepted-with-choice';
  } catch (error) {
    if (
      typeof engine.isInputReadinessRejection !== 'function' ||
      !engine.isInputReadinessRejection(error)
    )
      return 'crashed';
    // The same source can also carry an unreadable second field. Refusing for
    // that reason is correct and is not this field's answer being ignored.
    return error.readiness.field === field &&
      error.readiness.code === 'FORMAT_AMBIGUOUS_UNRESOLVED'
      ? 'refused-despite-choice'
      : 'blocked-by-other-field';
  }
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
  { exports = true, externalInputs = {} } = {},
) {
  const start = performance.now();
  /** @type {Record<string,any>} */
  const record = {
    id: spec.id,
    evaluatorVersion: EVALUATOR_VERSION,
    interventionActions: [],
    unresolvedInputs: [],
    inputTrace: [],
    resultProduced: false,
    completeSourceRead: false,
    completedComparison: false,
    sourceReadErrors: 0,
    unprovenFormatDefaults: [],
    ambiguityGate: [],
    formatAssessments: [],
    groupAssessments: spec.oracle.groupAssessments ?? [],
    category: spec.category,
    split: spec.split,
    scenario: spec.scenario,
    novelty: spec.novelty ?? 'known-regression',
    fingerprint: spec.economicFingerprint,
    families: spec.sources.map((s) => s.layout.family),
    formats: rendered.files.map((f) => f.format),
    failures: [],
    warnings: [],
    confirmations: [],
    permittedMatches: spec.oracle.permittedAutoMatches.length,
    expectedMatches: spec.oracle.invalid
      ? 0
      : spec.oracle.permittedAutoMatches.filter((g) => g.required !== false)
          .length,
    correctMatches: 0,
    correctRequiredMatches: 0,
    permittedGroups: spec.oracle.permittedAutoMatches.filter(
      (g) => g.aKeys.length + g.bKeys.length > 2,
    ).length,
    acceptedGroups: 0,
    requiredGroups: spec.oracle.permittedAutoMatches.filter(
      (g) => g.required !== false && g.aKeys.length + g.bKeys.length > 2,
    ).length,
    acceptedRequiredGroups: 0,
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
  const action = (field, value, level, origin, ui, evidence) => {
    record.interventionActions.push({
      field,
      value,
      level,
      origin,
      ui,
      evidence,
    });
    record.inputTrace.push({ field, value, origin, ui, evidence });
  };
  const visible = rendered.files.map(
    (file) => file.confirmationEvidence ?? { facts: {}, proof: {} },
  );
  const first = visible[0].facts;
  const scope = {
    supplier: first.supplier ?? '',
    entity: first.entity ?? '',
    account: first.account ?? '',
    currency: first.currency ?? '',
    decimals: currencyDecimals(first.currency) ?? 2,
    cutoff: first.cutoff ?? '',
    dateWindow: 2,
    confirmed: true,
    coverageConfirmed: visible.every((v) => v.facts.periodDeclared === true),
  };
  // The two-day window is the product's general default (app/page.tsx), not case data.
  action(
    'dateWindow',
    2,
    'automatic',
    'product-default',
    'فرق الأيام المسموح للمطابقة',
  );
  action(
    'decimals',
    scope.decimals,
    'automatic',
    'currency-minor-unit-table',
    'المنازل العشرية للعملة',
    visible[0].proof.currency,
  );
  action(
    'confirmed',
    true,
    'automatic',
    'ordinary-reconcile-action',
    'تأكيد نطاق المقارنة',
  );
  action(
    'coverageConfirmed',
    scope.coverageConfirmed,
    'limited-confirmation',
    'review-of-printed-period',
    'تأكيد تغطية التقريرين للفترة',
    visible.map((v) => v.proof.periodDeclared).filter(Boolean),
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
        {
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
          action(
            `${source.side}.mapping`,
            {
              ...output.bindings,
              header: output.headerRow,
              sheet: output.sheetIndex ?? 0,
            },
            'manual-correction',
            'visible-column-positions',
            'تعيين الأعمدة من معاينة الملف',
          );
        }
      }
      const formats = engine.suggestFormats(file, mapping, scope.decimals);
      if (spec.oracle.requiresFormatReview?.includes(source.side)) {
        if (formats.numberFormat.status === 'proven')
          fail(
            'AMBIGUITY_NOT_RECOGNIZED',
            'A source with two valid monetary interpretations was treated as proven',
          );
      }
      mapping = { ...mapping, ...formats.patch };
      for (const field of ['numberFormat', 'dateFormat']) {
        const assessment = formats[field];
        record.formatAssessments.push({
          source: source.side,
          field,
          ...assessment,
        });
        if (assessment.status === 'proven')
          action(
            `${source.side}.${field}`,
            mapping[field],
            'automatic',
            'engine-format-proof',
            'صيغة القيم',
            assessment,
          );
        else if (assessment.status === 'ambiguous') {
          const supplied = externalInputs[`${source.side}.${field}`];
          if (
            supplied &&
            assessment.candidates.includes(supplied.value) &&
            supplied.source
          ) {
            mapping[field] = supplied.value;
            // Simulating the accountant answering the card means producing the
            // same evidence the card produces; the engine gate then judges it.
            // This is recorded as human-external below, never as automatic.
            if (typeof engine.formatChoice === 'function')
              mapping.formatChoice = {
                ...mapping.formatChoice,
                [field]: engine.formatChoice(
                  file,
                  mapping,
                  field,
                  supplied.value,
                  assessment.candidates,
                  scope.decimals,
                ),
              };
            action(
              `${source.side}.${field}`,
              supplied.value,
              'human-external',
              'explicit-external-input',
              'اختيار الصيغة بناء على معلومة خارج الملف',
              supplied,
            );
          } else {
            // Observation only, never a pass/fail: does the engine's own guard
            // refuse this mapping while the ambiguity is unanswered, or would it
            // let the worker, a restored session or an export through? The
            // evaluator routes the case either way, so counts cannot move.
            record.ambiguityGate.push({
              field: `${source.side}.${field}`,
              engine: probeAmbiguityGate(engine, file, mapping, scope),
              answered: probeAnsweredAmbiguity(
                engine,
                file,
                mapping,
                scope,
                field,
                assessment.candidates,
              ),
            });
            record.stopped = true;
            record.unresolvedInputs.push({
              field: `${source.side}.${field}`,
              reason: assessment.reason,
              candidates: assessment.candidates,
            });
            record.confirmations.push(
              `${source.side}: ${field} needs outside-document information; no oracle default supplied`,
            );
          }
        } else {
          // Exercise the real engine's default on malformed/unavailable input
          // for safety diagnostics; never report this as a proven convention.
          const entry = {
            field: `${source.side}.${field}`,
            value: mapping[field],
            status: assessment.status,
            reason: assessment.reason,
          };
          record.unprovenFormatDefaults.push(entry);
          action(
            entry.field,
            entry.value,
            'automatic',
            'unproven-engine-default',
            'صيغة افتراضية غير مثبتة في مسار تشخيص الأخطاء',
            assessment,
          );
        }
      }
      if (record.unresolvedInputs.length) break;
      const printedReport = visible[i].facts.reportType;
      if (printedReport === 'open-items') mapping.reportType = 'open-items';
      action(
        `${source.side}.reportType`,
        mapping.reportType,
        'limited-confirmation',
        'visible-report-title',
        'نوع التقرير',
        visible[i].proof.reportType,
      );
      if (visible[i].facts.multiplier !== undefined) {
        mapping.multiplier = visible[i].facts.multiplier;
        action(
          `${source.side}.multiplier`,
          mapping.multiplier,
          'limited-confirmation',
          'visible-sign-convention',
          'اتجاه المبالغ',
          visible[i].proof.multiplier,
        );
      }
      if (file.pdf) {
        mapping.pdfReviewed = true;
        record.confirmations.push(`${source.side}: PDF visual review required`);
        action(
          `${source.side}.pdfReviewed`,
          true,
          'limited-confirmation',
          'simulated-visual-review',
          'مراجعة صفحات PDF مع الأصل',
        );
      }
      mappings.push(mapping);
    }
    if (files.length === 2 && mappings.length === 2 && !record.stopped) {
      const suggestions = engine.inferScopeSuggestions(files, mappings);
      for (const field of [
        'supplier',
        'entity',
        'account',
        'currency',
        'cutoff',
      ]) {
        const value = scope[field],
          suggestion = suggestions.fields[field];
        if (!value) {
          record.stopped = true;
          record.unresolvedInputs.push({
            field,
            reason:
              'No value printed in source; explicit external input required',
          });
          continue;
        }
        action(
          field,
          value,
          suggestion.status === 'suggested' && suggestion.value === value
            ? 'limited-confirmation'
            : 'manual-correction',
          suggestion.status === 'suggested' && suggestion.value === value
            ? 'engine-visible-scope-proposal'
            : 'manual-reading-of-visible-text',
          'تأكيد أو إدخال النطاق من المستند',
          visible[0].proof[field],
        );
      }
      record.inputFormatGate =
        typeof engine.assertInputFormats === 'function'
          ? 'available'
          : 'legacy-absent';
      if (!record.stopped && typeof engine.assertInputFormats === 'function') {
        try {
          engine.assertInputFormats(files, mappings, scope);
          record.inputFormatGate = 'passed';
        } catch (e) {
          checkControlled(e);
          record.stopped = true;
          record.inputFormatGate = 'blocked';
          record.warnings.push(`input formats: ${compactError(e)}`);
          if (!spec.oracle.invalid && !spec.oracle.requiresScopeStop)
            fail('INPUT_FORMAT_CAPACITY_GAP', compactError(e), false);
        }
      }
      if (!record.stopped)
        for (let i = 0; i < 2; i++) {
          try {
            sources.push(
              engine.normalizeSource(
                files[i],
                mappings[i],
                scope,
                rendered.files[i].side,
              ),
            );
          } catch (e) {
            checkControlled(e);
            record.stopped = true;
            record.warnings.push(
              `normalize ${rendered.files[i].side}: ${compactError(e)}`,
            );
            if (!spec.oracle.invalid && !spec.oracle.requiresScopeStop)
              fail('NORMALIZE_VALID_SOURCE', compactError(e), false);
            break;
          }
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
        const primaryReference = (r) =>
          r.kind === 'Payment' && source.layout.fields
            ? r.bankReference || r.receiptReference || r.reference
            : r.reference;
        const candidates = source.rows.filter(
          (r) =>
            !used.has(r.key) &&
            primaryReference(r) === tx.reference &&
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
        if (
          source.layout.fields &&
          tx.primaryReference !== primaryReference(row)
        )
          fail('PRIMARY_REFERENCE_CHANGED', tx.id);
        for (const field of [
          'bankReference',
          'receiptReference',
          'poReference',
        ])
          if (
            source.layout.fields?.includes(field) &&
            (tx[field] ?? '') !== (row[field] ?? '')
          )
            fail('TYPED_REFERENCE_CHANGED', `${tx.id}:${field}`);
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
          output.bindings.reference >= 0 &&
          row.reference !== rawRow?.[output.bindings.reference]?.trim()
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
          reference: primaryReference(row),
          primaryReference: primaryReference(row),
          description,
          date: row.date,
          minor: row.minor,
          originalAmount: rawAmount,
          sourceReference: {
            column: output.bindings.reference,
            value: row.reference,
          },
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
      record.resultProduced = true;
      record.sourceReadErrors = sources.reduce(
        (n, s) => n + s.errors.length,
        0,
      );
      record.completeSourceRead =
        sources.length === 2 &&
        record.sourceReadErrors === 0 &&
        !record.failures.some((f) =>
          [
            'EXTRACTED_ROW_MISMATCH',
            'LOST_SOURCE_ROW',
            'UNACCOUNTED_PARSED_ROW',
            'EXTRACTION_INCOMPLETE',
            'DESCRIPTION_CHANGED',
            'CURRENCY_CHANGED',
            'SOURCE_TOTAL_CHANGED',
          ].includes(f.code),
        );
      record.completedComparison =
        record.completeSourceRead && record.unprovenFormatDefaults.length === 0;
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
            const oracleMatch = spec.oracle.permittedAutoMatches.find(
              (g) => groupKey(g.aKeys, g.bKeys) === groupKey(a, b),
            );
            if (oracleMatch?.required !== false && !spec.oracle.invalid)
              record.correctRequiredMatches++;
            if (a.length + b.length > 2) {
              record.acceptedGroups++;
              if (oracleMatch?.required !== false)
                record.acceptedRequiredGroups++;
            }
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
            pdfTextTransforms: files.flatMap((f, i) =>
              Object.entries(f.sheets[0]?.pdfTextTransforms ?? {}).flatMap(
                ([row, entries]) =>
                  entries.map((entry) => ({
                    side: i === 0 ? 'المورد' : 'الدفتر',
                    row: Number(row),
                    ...entry,
                  })),
              ),
            ),
            rows: expectedExport,
            permittedAcceptedGroups: spec.oracle.permittedAutoMatches.map(
              (g) => ({
                supplierIds: g.aKeys
                  .map((k) => byKey.get(k)?.id)
                  .filter(Boolean),
                ledgerIds: g.bKeys.map((k) => byKey.get(k)?.id).filter(Boolean),
              }),
            ),
            requiredAcceptedGroups: spec.oracle.permittedAutoMatches
              .filter((g) => g.required !== false && !spec.oracle.invalid)
              .map((g) => ({
                supplierIds: g.aKeys
                  .map((k) => byKey.get(k)?.id)
                  .filter(Boolean),
                ledgerIds: g.bKeys.map((k) => byKey.get(k)?.id).filter(Boolean),
              })),
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
    } else if (
      !spec.oracle.invalid &&
      !spec.oracle.requiresScopeStop &&
      !record.unresolvedInputs.length
    )
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
  record.automaticInputDerivation =
    record.unprovenFormatDefaults.length === 0 &&
    !record.interventionActions.some((a) =>
      ['manual-correction', 'human-external'].includes(a.level),
    );
  record.explicitAttestations = record.interventionActions.filter(
    (a) => a.level === 'limited-confirmation',
  );
  record.needsChosenInterpretation =
    record.unprovenFormatDefaults.length > 0 ||
    record.unresolvedInputs.some((a) => /Format$/.test(a.field)) ||
    record.interventionActions.some(
      (a) => a.origin === 'explicit-external-input' && /Format$/.test(a.field),
    );
  record.externalFacts = record.interventionActions.filter(
    (a) => a.level === 'human-external',
  );
  record.interventionLevel = interventionLevel(record.interventionActions);
  record.outcome = record.failures.some(
    (f) => f.code === 'UNCONTROLLED_FAILURE',
  )
    ? 'uncontrolled-failure'
    : record.unresolvedInputs.length
      ? 'external-information-required'
      : record.completedComparison
        ? 'completed-comparison'
        : record.resultProduced
          ? 'partial-or-unverified-result'
          : record.stopped
            ? 'controlled-stop'
            : 'not-completed';
  record.requiredInterventionLevel = record.unresolvedInputs.length
    ? 'human-external'
    : record.unprovenFormatDefaults.length
      ? 'manual-correction'
      : record.interventionLevel;
  record.conditionalRequiredMatches = record.unresolvedInputs.length
    ? record.expectedMatches
    : 0;
  record.resolvedInputRequiredMatches = record.unresolvedInputs.length
    ? 0
    : record.expectedMatches;
  record.missedRequiredGroups = Math.max(
    0,
    record.requiredGroups - record.acceptedRequiredGroups,
  );
  record.missedRequiredMatches = Math.max(
    0,
    record.expectedMatches - record.correctRequiredMatches,
  );
  record.ms = Number((performance.now() - start).toFixed(2));
  record.safetyPass = !record.failures.some((f) => f.safety);
  record.pass = record.failures.length === 0;
  return record;
}
