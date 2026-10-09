// Development-only semantic routing candidate. Never imported by the product.
export const INTENT_LABELS = [
  'status',
  'amounts',
  'sources',
  'next',
  'refuse',
] as const;
export type SemanticIntent = (typeof INTENT_LABELS)[number];
export function bindSemanticIntent(raw: unknown): SemanticIntent | null {
  if (typeof raw !== 'string' || raw.length > 128) return null;
  // This exact finite grammar also rejects duplicate keys, extra fields,
  // financial numbers, markdown, prose and escaped look-alike keys.
  const match =
    /^\s*\{\s*"intent"\s*:\s*"(status|amounts|sources|next|refuse)"\s*\}\s*$/.exec(
      raw,
    );
  return match ? (match[1] as SemanticIntent) : null;
}
export const CANONICAL_QUESTIONS = {
  status: 'What is the result status?',
  amounts: 'What are the recorded amounts?',
  sources: 'What are the result sources?',
  next: 'What is the next step?',
} as const;
export function canonicalSemanticQuestion(raw: unknown): string | null {
  const intent = bindSemanticIntent(raw);
  return intent && intent !== 'refuse' ? CANONICAL_QUESTIONS[intent] : null;
}
