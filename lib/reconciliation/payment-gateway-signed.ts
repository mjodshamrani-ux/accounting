// Exact signed money is validated before a refund becomes an unsigned magnitude.
// XLSX callers retain ASCII XML v lexemes; normalization belongs to CSV only.
export type GatewaySignedAmount = {
  raw: string;
  normalized: string;
  sign: '+' | '-' | 'unsigned';
  signedMinor: number;
  magnitude: number;
  physicalRow: number;
  representation: 'csv' | 'xlsx';
};
export function signedGatewayMoney(
  raw: string,
  decimals: number,
  kind: string,
  normalize = true,
): Omit<GatewaySignedAmount, 'physicalRow' | 'representation'> {
  const normalized = normalize
    ? raw
        .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 1632))
        .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 1776))
        .replace(/٫/g, '.')
    : raw;
  if (
    !/^[+-]?[0-9]+(?:\.[0-9]+)?$/.test(normalized) ||
    (normalized.split('.')[1]?.length ?? 0) > decimals
  )
    throw Error('PG_AMOUNT');
  const sign = normalized.startsWith('-')
    ? '-'
    : normalized.startsWith('+')
      ? '+'
      : 'unsigned';
  const zero = /^[+-]?0+(?:\.0+)?$/.test(normalized);
  if (sign === '-' && zero) throw Error('PG_NEGATIVE_ZERO');
  if (kind !== 'sale' && kind !== 'refund') throw Error('PG_KIND');
  if (
    (kind === 'sale' && sign === '-') ||
    (kind === 'refund' && sign !== '-' && !zero)
  )
    throw Error('PG_SIGN_KIND');
  // Sign/kind and lexical negative zero are settled before any numeric value,
  // including the canonical nonnegative magnitude, is constructed.
  const [whole, fraction = ''] = normalized.replace(/^[+-]/, '').split('.');
  const magnitude =
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, '0') || '0');
  if (magnitude > 100000000000000n) throw Error('PG_AMOUNT');
  return {
    raw,
    normalized,
    sign,
    signedMinor: Number(sign === '-' ? -magnitude : magnitude),
    magnitude: Number(magnitude),
  };
}
