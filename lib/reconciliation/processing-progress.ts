import { MAX_PDF_PAGES } from './types.ts';

/** Counters only. Progress is never a source table or a financial result. */
export type ProcessingProgress = {
  stage: 'pdf-read' | 'pdf-layout';
  completed: number;
  total: number;
};

export function isProcessingProgress(
  value: unknown,
): value is ProcessingProgress {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const progress = value as Record<string, unknown>;
  return (
    Object.keys(progress).length === 3 &&
    Object.keys(progress).every((key) =>
      ['stage', 'completed', 'total'].includes(key),
    ) &&
    (progress.stage === 'pdf-read' || progress.stage === 'pdf-layout') &&
    Number.isSafeInteger(progress.completed) &&
    Number.isSafeInteger(progress.total) &&
    (progress.total as number) >= 1 &&
    (progress.total as number) <= MAX_PDF_PAGES &&
    (progress.completed as number) >= 0 &&
    (progress.completed as number) <= (progress.total as number)
  );
}

export function isNextProcessingProgress(
  previous: ProcessingProgress | undefined,
  value: unknown,
): value is ProcessingProgress {
  if (!isProcessingProgress(value)) return false;
  if (!previous) return value.stage === 'pdf-read';
  if (previous.total !== value.total) return false;
  if (previous.stage === value.stage)
    return value.completed >= previous.completed;
  return (
    previous.stage === 'pdf-read' &&
    previous.completed === previous.total &&
    value.stage === 'pdf-layout'
  );
}
