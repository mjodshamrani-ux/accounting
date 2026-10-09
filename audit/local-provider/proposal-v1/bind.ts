// Development-only proposal boundary. No application imports this module.
import { createHash } from 'node:crypto';
import { readFile } from '../../../lib/reconciliation/io.ts';
import { prepareVerifiedSources } from '../../../lib/reconciliation/source-preparation.ts';
import { reconcileSupplierStatement } from '../../../lib/reconciliation/supplier-reconciliation.ts';
import { defaultMapping } from '../../../lib/reconciliation/types.ts';

export type InvoiceRow = {
  date: string;
  reference: string;
  amount: string;
  currency: 'SAR';
};
const digest = (text: string) =>
  createHash('sha256').update(text, 'utf8').digest('hex');
const dateValid = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  return (
    y >= 1 &&
    m >= 1 &&
    m <= 12 &&
    d >= 1 &&
    d <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
  );
};
const refusal = /^\s*\{\s*"refuse"\s*:\s*true\s*\}\s*$/;
export const explicitRefusal = (raw: unknown): boolean =>
  typeof raw === 'string' && raw.length <= 512 && refusal.test(raw);

/** Narrow, independently checked source family: one dated, positive invoice,
 * one literal INV identifier, one explicit SAR total. Additional numerical
 * assertions, cancellation, instructions and ambiguity are unsupported.
 * This is also the honest deterministic extraction baseline. */
export function literalInvoice(text: unknown): InvoiceRow | null {
  if (
    typeof text !== 'string' ||
    text.length > 400 ||
    /"/.test(text) ||
    Array.from(text).some((c) => c.charCodeAt(0) < 32)
  )
    return null;
  if (
    !/\binvoice\b|فاتورة|الفاتورة/iu.test(text) ||
    /payment|approve|ignore|cancel|tax|maybe|\bor\b|أو|ألغ|اعتمد|تجاهل|حول|ضريب/iu.test(
      text,
    )
  )
    return null;
  const dates = [...text.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)];
  const references = [...text.matchAll(/\bINV-\d{3}\b/g)];
  const amounts = [...text.matchAll(/\b\d+\.\d+\b/g)];
  const currencies = [...text.matchAll(/\bSAR\b|Saudi riyals|ريال سعودي/g)];
  if (
    dates.length !== 1 ||
    references.length !== 1 ||
    amounts.length !== 1 ||
    currencies.length !== 1 ||
    !dateValid(dates[0][0]) ||
    !/^(0|[1-9]\d{0,7})\.\d{2}$/.test(amounts[0][0]) ||
    /[-−+]\d+\.\d/.test(text)
  )
    return null;
  let remainder = text;
  for (const token of [dates[0][0], references[0][0], amounts[0][0]])
    remainder = remainder.replace(token, '');
  if (/\d/.test(remainder)) return null;
  return {
    date: dates[0][0],
    reference: references[0][0],
    amount: amounts[0][0],
    currency: 'SAR',
  };
}

/** Fixed field order/grammar rejects duplicate keys, extra properties,
 * escaped literals, prose, code fences, altered signs and invented amounts. */
export function bindInvoiceProposal(raw: unknown, text: unknown) {
  if (typeof raw !== 'string' || raw.length > 512 || typeof text !== 'string')
    return null;
  const m =
    /^\s*\{\s*"date"\s*:\s*"(\d{4}-\d{2}-\d{2})"\s*,\s*"reference"\s*:\s*"(INV-\d{3})"\s*,\s*"amount"\s*:\s*"((?:0|[1-9]\d{0,7})\.\d{2})"\s*,\s*"currency"\s*:\s*"SAR"\s*\}\s*$/.exec(
      raw,
    );
  const literal = literalInvoice(text);
  if (
    !m ||
    !literal ||
    m[1] !== literal.date ||
    m[2] !== literal.reference ||
    m[3] !== literal.amount
  )
    return null;
  const currency = /\bSAR\b|Saudi riyals|ريال سعودي/g.exec(text)!;
  const evidence = Object.fromEntries(
    Object.entries(literal).map(([field, value]) => {
      const original = field === 'currency' ? currency[0] : value;
      const start = text.indexOf(original);
      return [
        field,
        {
          startUtf16: start,
          endUtf16: start + original.length,
          literal: original,
        },
      ];
    }),
  );
  return {
    proposal: literal,
    evidence,
    originalText: text,
    originalSha256: digest(text),
    humanApproval: false as const,
    productEnabled: false as const,
  };
}

const scope = {
  supplier: 'Synthetic invoice supplier',
  entity: 'Synthetic entity',
  account: '2100',
  currency: 'SAR',
  decimals: 2,
  cutoff: '2026-09-30',
  dateWindow: 0,
  confirmed: true,
  coverageConfirmed: false,
};
const mapping = () => ({
  ...defaultMapping(),
  date: 0,
  reference: 1,
  amount: 2,
  currencyColumn: 3,
  description: 4,
});
const csv = (row: InvoiceRow | null, side: string) =>
  'Date,Reference,Amount,Currency,Description,Type\n' +
  (row
    ? `${row.date},${row.reference},${row.amount},SAR,${side} invoice,Invoice\n`
    : '');
async function native(row: InvoiceRow | null, side: string) {
  const text = csv(row, side);
  const bytes = new TextEncoder().encode(text);
  const source = await readFile(`proposal-derived-${side}.csv`, bytes.buffer);
  return { source, derivedCsv: text, derivedSha256: digest(text) };
}

/** Re-bind before await and then use the real native reader + shared financial
 * normalisation boundary. CSV is explicitly derived; TXT is retained apart.
 * This does not confer authenticity, reviewer approval or matching authority. */
export async function replayInvoiceProposal(raw: unknown, text: unknown) {
  const bound = bindInvoiceProposal(raw, text);
  if (!bound) return null;
  const derived = await native(bound.proposal, 'supplier');
  const reading = prepareVerifiedSources([derived.source], [mapping()], scope, [
    'supplier',
  ]).sources[0];
  if (
    reading.transactions.length !== 1 ||
    reading.errors.length ||
    reading.excluded.some((e) => e.row !== 1 || e.kind !== 'non-movement')
  )
    throw Error('Engine refused the derived proposal');
  const transaction = reading.transactions[0];
  return {
    ...bound,
    derivedCsv: derived.derivedCsv,
    derivedSha256: derived.derivedSha256,
    engine: {
      transactionCount: reading.transactions.length,
      date: transaction.date,
      reference: transaction.reference,
      originalAmount: transaction.originalAmount,
      amountMinor: String(transaction.amountMinor),
      errors: reading.errors,
      excluded: reading.excluded,
    },
  };
}

export type ChatInput = {
  question: string;
  supplier: Omit<InvoiceRow, 'currency'>;
  ledger: Omit<InvoiceRow, 'currency'> | null;
};
export async function verifiedChatFacts(input: ChatInput) {
  // Snapshot before IO; caller mutation cannot change this evidence pair.
  const snapshot = structuredClone(input);
  const [a, b] = await Promise.all([
    native({ ...snapshot.supplier, currency: 'SAR' }, 'supplier'),
    native(
      snapshot.ledger && { ...snapshot.ledger, currency: 'SAR' },
      'ledger',
    ),
  ]);
  const prepared = prepareVerifiedSources(
    [a.source, b.source],
    [mapping(), mapping()],
    scope,
    ['supplier', 'ledger'],
  );
  const reading = { a: prepared.sources[0], b: prepared.sources[1] };
  // An empty counterpart cannot establish scope in the native source boundary.
  // Never supply its proposed absence assertion to the model as verified.
  const comparison = reading.b.transactions.length
    ? reconcileSupplierStatement({
        files: [a.source, b.source],
        mappings: [mapping(), mapping()],
        scope,
      }).result
    : null;
  if (
    reading.a.errors.length ||
    reading.b.errors.length ||
    reading.a.excluded.some((e) => e.row !== 1 || e.kind !== 'non-movement') ||
    reading.b.excluded.some((e) => e.row !== 1 || e.kind !== 'non-movement') ||
    reading.a.transactions.length !== 1 ||
    reading.b.transactions.length !== (snapshot.ledger ? 1 : 0)
  )
    throw Error(
      'Invalid chat sources: ' +
        JSON.stringify({
          supplier: reading.a.errors,
          ledger: reading.b.errors,
        }),
    );
  const supplierMinor = String(reading.a.transactions[0].amountMinor);
  const ledgerMinor = snapshot.ledger
    ? String(reading.b.transactions[0].amountMinor)
    : null;
  const differenceMinor =
    ledgerMinor === null
      ? null
      : String(BigInt(supplierMinor) - BigInt(ledgerMinor));
  const reason =
    ledgerMinor === null
      ? 'missing-ledger'
      : differenceMinor === '0'
        ? 'matched'
        : 'amount-difference';
  return {
    question: snapshot.question,
    reason,
    supplierMinor,
    ledgerMinor,
    differenceMinor,
    evidence: ledgerMinor === null ? ['supplier'] : ['supplier', 'ledger'],
    sources: { supplier: a.derivedSha256, ledger: b.derivedSha256 },
    nativeCases: comparison?.caseCounts ?? null,
    comparisonAvailable: comparison !== null,
    absenceClaim:
      ledgerMinor === null
        ? 'only the supplied empty ledger; economic coverage unconfirmed'
        : null,
    productEnabled: false as const,
    humanApproval: false as const,
  };
}

/** Model chooses a constrained explanation; every reason/citation is checked
 * against fresh engine facts. It cannot supply numbers, prose or decisions. */
export function bindExplanation(
  raw: unknown,
  facts: Awaited<ReturnType<typeof verifiedChatFacts>>,
) {
  if (typeof raw !== 'string' || raw.length > 512) return null;
  const m =
    /^\s*\{\s*"reason"\s*:\s*"(matched|amount-difference|missing-ledger)"\s*,\s*"evidence"\s*:\s*\[\s*"supplier"\s*(,\s*"ledger"\s*)?\]\s*\}\s*$/.exec(
      raw,
    );
  if (
    !m ||
    m[1] !== facts.reason ||
    Boolean(m[2]) !== (facts.ledgerMinor !== null)
  )
    return null;
  return {
    reason: facts.reason,
    evidence: [...facts.evidence],
    supplierMinor: facts.supplierMinor,
    ledgerMinor: facts.ledgerMinor,
    differenceMinor: facts.differenceMinor,
    sources: { ...facts.sources },
    humanApproval: false as const,
    productEnabled: false as const,
  };
}
