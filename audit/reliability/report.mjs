const countAttestations = (records) =>
  records.reduce((n, r) => n + (r.explicitAttestations?.length ?? 0), 0);
// Reporting is separate from acceptance. Never sum amounts across currencies.
export function aggregate(records) {
  const count = (key) => records.reduce((n, r) => n + (r[key] ?? 0), 0);
  const distribution = (values) =>
    values.reduce(
      (out, value) => ((out[value] = (out[value] ?? 0) + 1), out),
      {},
    );
  const falseMatchMinorByCurrency = {};
  for (const r of records)
    if (r.falseMatches)
      falseMatchMinorByCurrency[r.currency] = String(
        BigInt(falseMatchMinorByCurrency[r.currency] ?? 0) +
          BigInt(r.falseMatchValueMinor),
      );
  const completed = records.filter((r) => r.completedComparison);
  return {
    cases: records.length,
    passed: records.filter((r) => r.pass).length,
    safetyPassed: records.filter((r) => r.safetyPass).length,
    resultsProduced: records.filter((r) => r.resultProduced).length,
    completeSourceReads: records.filter((r) => r.completeSourceRead).length,
    partialOrUnverifiedResults: records.filter(
      (r) => r.resultProduced && !r.completedComparison,
    ).length,
    sourceReadErrors: count('sourceReadErrors'),
    unprovenFormatDefaults: records.reduce(
      (n, r) => n + (r.unprovenFormatDefaults?.length ?? 0),
      0,
    ),
    casesWithUnprovenFormatDefaults: records.filter(
      (r) => r.unprovenFormatDefaults?.length,
    ).length,
    completedComparisons: completed.length,
    completedWithoutManualCorrection: completed.filter((r) =>
      ['automatic', 'limited-confirmation'].includes(r.interventionLevel),
    ).length,
    automaticallyDerivedInputs: records.filter(
      (r) => r.automaticInputDerivation,
    ).length,
    explicitAttestations: countAttestations(records),
    needsChosenInterpretation: records.filter(
      (r) => r.needsChosenInterpretation,
    ).length,
    suppliedExternalFacts: records.reduce(
      (n, r) => n + (r.externalFacts?.length ?? 0),
      0,
    ),
    conditionalRequiredMatches: count('conditionalRequiredMatches'),
    resolvedInputRequiredMatches: count('resolvedInputRequiredMatches'),
    completedAutomatically: completed.filter(
      (r) => r.interventionLevel === 'automatic',
    ).length,
    outcomes: distribution(
      records.map((r) => r.outcome ?? 'legacy-unspecified'),
    ),
    interventionLevels: distribution(
      records.map((r) => r.interventionLevel ?? 'legacy-unspecified'),
    ),
    requiredInterventionLevels: distribution(
      records.map((r) => r.requiredInterventionLevel ?? 'legacy-unspecified'),
    ),
    byIntervention: Object.fromEntries(
      [
        'automatic',
        'limited-confirmation',
        'manual-correction',
        'human-external',
      ].map((level) => [
        level,
        {
          cases: records.filter((r) => r.interventionLevel === level).length,
          completedComparisons: completed.filter(
            (r) => r.interventionLevel === level,
          ).length,
        },
      ]),
    ),
    // Whether the engine's own guard refuses an unanswered ambiguity, per field.
    // Observation of the product's behaviour; it never decides pass or fail.
    ambiguityGate: distribution(
      records.flatMap((r) => (r.ambiguityGate ?? []).map((v) => v.engine)),
    ),
    // The opposite direction: with the answer recorded, the same guard must let
    // the field through. A guard that refuses either way is a blanket block.
    ambiguityGateAnswered: distribution(
      records.flatMap((r) => (r.ambiguityGate ?? []).map((v) => v.answered)),
    ),
    unresolvedInputs: distribution(
      records.flatMap((r) => (r.unresolvedInputs ?? []).map((v) => v.field)),
    ),
    permittedMatches: count('permittedMatches'),
    expectedMatches: count('expectedMatches'),
    correctRequiredMatches: count('correctRequiredMatches'),
    correctMatches: count('correctMatches'),
    missedRequiredMatches: count('missedRequiredMatches'),
    permittedGroups: count('permittedGroups'),
    acceptedGroups: count('acceptedGroups'),
    requiredGroups: count('requiredGroups'),
    acceptedRequiredGroups: count('acceptedRequiredGroups'),
    missedRequiredGroups: count('missedRequiredGroups'),
    groupAssessmentClasses: distribution(
      records.flatMap((r) =>
        (r.groupAssessments ?? []).map((g) => g.classification),
      ),
    ),
    groupBusinessTasks: distribution(
      records.flatMap((r) =>
        (r.groupAssessments ?? []).map((g) => g.businessTask),
      ),
    ),
    falseMatches: count('falseMatches'),
    falseMatchMinorByCurrency,
    expectedRows: count('expectedRows'),
    validExpectedRows: count('validExpectedRows'),
    extractedRows: count('extractedRows'),
    excludedRows: count('excludedRows'),
    exportsChecked: records.filter((r) => r.exportChecked).length,
    bridgesChecked: records.filter((r) => r.bridgeChecked).length,
    automaticColumnSelection: records.filter((r) => r.mappingAutomatic).length,
    stopped: records.filter((r) => r.stopped).length,
    exceptionRows: count('exceptionRows'),
    handledExceptionRows: count('handledExceptionRows'),
    confirmations: distribution(records.flatMap((r) => r.confirmations)),
    failures: distribution(
      records.flatMap((r) => r.failures).map((f) => f.code),
    ),
    metricDefinitions: {
      resultProduced:
        'The engine returned a result object, including diagnostic partial results. This is not completed accounting work.',
      completedComparison:
        'A result was produced after both sources had no row errors or independently detected missing/changed rows and no unproven format default. Correctness and required-decision completion are separately reported.',
      unprovenFormatDefaults:
        'Diagnostic normalization used the product default after format inference returned invalid/unavailable. This is not a confirmed or automatically proved interpretation.',
      passed:
        'All evaluator assertions passed; a safe unresolved-input stop is NOT a completed reconciliation.',
      completedAutomatically:
        'Completed with no confirmation, manual mapping or external information. Ordinary Reconcile clicks do not count as interpretation. Actual scope/sign/PDF attestations do count.',
      expectedMatches:
        'Expected decisions conditional on resolving any ambiguous input convention; conditionalRequiredMatches are separated from resolvedInputRequiredMatches. Missed counts include cases stopped before comparison.',
      falseMatchDenominator:
        'Accepted decisions only; report alongside required completion and unresolved-input counts, never alone.',
      groupUnit:
        'One document-lines or whole-payment reconciliation decision, not individual source rows or payment-to-invoice allocation.',
    },
  };
}
