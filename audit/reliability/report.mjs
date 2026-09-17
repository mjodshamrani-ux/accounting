// Reporting is separate from acceptance. Never sum amounts across currencies.
export function aggregate(records) {
  const count = (key) => records.reduce((n, r) => n + (r[key] ?? 0), 0);
  const falseMatchMinorByCurrency = {};
  for (const r of records)
    if (r.falseMatches)
      falseMatchMinorByCurrency[r.currency] = String(
        BigInt(falseMatchMinorByCurrency[r.currency] ?? 0) +
          BigInt(r.falseMatchValueMinor),
      );
  return {
    cases: records.length,
    passed: records.filter((r) => r.pass).length,
    safetyPassed: records.filter((r) => r.safetyPass).length,
    permittedMatches: count('permittedMatches'),
    expectedMatches: count('expectedMatches'),
    correctRequiredMatches: count('correctRequiredMatches'),
    correctMatches: count('correctMatches'),
    permittedGroups: count('permittedGroups'),
    acceptedGroups: count('acceptedGroups'),
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
    confirmations: records
      .flatMap((r) => r.confirmations)
      .reduce((out, c) => ((out[c] = (out[c] ?? 0) + 1), out), {}),
    failures: records
      .flatMap((r) => r.failures)
      .reduce((out, f) => ((out[f.code] = (out[f.code] ?? 0) + 1), out), {}),
  };
}
