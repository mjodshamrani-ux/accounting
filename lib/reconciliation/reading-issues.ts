import type { SourceFile, SourceResult } from './types.ts';

/** Presentation facts only: none of these records is a matchable transaction. */
export function readingStatus(sources: readonly SourceResult[]) {
  return {
    partial: sources.some((source) => source.errors.length > 0),
    processedRows: sources.reduce(
      (sum, source) => sum + source.transactions.length,
      0,
    ),
    unreadRows: sources.reduce(
      (sum, source) =>
        sum +
        new Set(
          source.errors
            .filter((error) => error.row > 0)
            .map((error) => error.row),
        ).size,
      0,
    ),
    balanceIssues: sources.reduce(
      (sum, source) =>
        sum +
        source.errors.filter(
          (error) => error.row === 0 && error.scope === 'balance',
        ).length,
      0,
    ),
    sourceIssues: sources.reduce(
      (sum, source) =>
        sum +
        source.errors.filter(
          (error) => error.row === 0 && error.scope !== 'balance',
        ).length,
      0,
    ),
  };
}

export function sourceReadingIssues(
  source: SourceResult,
  file: SourceFile,
  side: 'supplier' | 'ledger',
) {
  const sheet = file.sheets[source.mapping.sheet];
  return source.errors.map((error) => ({
    side,
    file: file.name,
    sheet: sheet?.name ?? '',
    kind:
      error.row > 0
        ? ('row' as const)
        : error.scope === 'balance'
          ? ('balance' as const)
          : ('source' as const),
    row: error.row > 0 ? error.row : null,
    page:
      error.row > 0
        ? (error.sourcePage ?? sheet?.rowPages?.[String(error.row)] ?? null)
        : null,
    reason: error.message,
    // Keep original strings, including an invalid amount. No parsed amount/date
    // or invented transaction ID is attached to an unread row.
    values:
      error.row > 0
        ? [...(sheet?.rows[error.row - 1] ?? [])]
        : error.scope === 'balance'
          ? [source.mapping.opening ?? '', source.mapping.closing ?? '']
          : [],
  }));
}
