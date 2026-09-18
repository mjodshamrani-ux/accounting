// Simulated review of visible document text. No oracle, generator metadata or engine imports.
// Values absent from the displayed source remain absent; locale is never guessed here.
export const INPUT_EVIDENCE_VERSION = 'tarasuf-visible-inputs-1.0.0';
export function visibleInputEvidence(lines, sourceName) {
  const entries = lines.flatMap((line, index) => ({
    text: String(line.text ?? line),
    page: line.page ?? 1,
    row: line.row ?? index + 1,
  }));
  const facts = {},
    proof = {};
  const set = (field, value, line, label) => {
    if (value === undefined || value === null || value === '') return;
    if (facts[field] !== undefined && facts[field] !== value) return;
    facts[field] = value;
    proof[field] = {
      origin: 'visible-source-text',
      sourceName,
      page: line.page,
      row: line.row,
      label,
      rawText: line.text,
      value,
    };
  };
  for (const line of entries) {
    const text = line.text;
    let match =
      /^(.+?)\s+-\s+(Transaction statement|Open items report|Aging report)$/.exec(
        text,
      );
    if (match) {
      set('supplier', match[1], line, 'statement issuer');
      set(
        'reportType',
        match[2] === 'Transaction statement'
          ? 'transactions'
          : match[2] === 'Open items report'
            ? 'open-items'
            : 'aging',
        line,
        'report title',
      );
    }
    for (const [field, label, pattern] of [
      ['supplier', 'Supplier', /(?:^|\|\s*)Supplier:\s*([^|]+)/i],
      [
        'entity',
        'Entity',
        /(?:^|\|\s*|\s{2,})Entity:\s*(.+?)(?=\s+(?:Account|Currency):|\s*\||$)/i,
      ],
      [
        'account',
        'Account',
        /(?:^|\|\s*|\s+)Account:\s*([^|]+?)(?=\s+(?:Currency|Entity):|\s*\||$)/i,
      ],
      ['currency', 'Currency', /(?:^|\|\s*|\s+)Currency:\s*([A-Z]{3})\b/],
    ]) {
      match = pattern.exec(text);
      if (match) set(field, match[1].trim(), line, label);
    }
    match =
      /^Period:\s*(\d{4}-\d{2}-\d{2})\s+(?:to|through)\s+(\d{4}-\d{2}-\d{2})/.exec(
        text,
      );
    if (match) {
      set('periodStart', match[1], line, 'Period');
      set('cutoff', match[2], line, 'Period end');
      set('periodDeclared', true, line, 'Period');
    }
    match = /^As of:\s*(\d{4}-\d{2}-\d{2})/.exec(text);
    if (match) set('cutoff', match[1], line, 'As of');
    if (
      /^Positive amount increases (?:the )?payable to (?:the )?supplier\.?$/i.test(
        text,
      )
    )
      set('multiplier', 1, line, 'declared sign convention');
    if (
      /^Positive amount decreases (?:the )?payable to (?:the )?supplier\.?$/i.test(
        text,
      )
    )
      set('multiplier', -1, line, 'declared sign convention');
  }
  return { version: INPUT_EVIDENCE_VERSION, facts, proof };
}
export const INTERVENTION_ORDER = [
  'automatic',
  'limited-confirmation',
  'manual-correction',
  'human-external',
];
export function interventionLevel(actions) {
  return INTERVENTION_ORDER[
    Math.max(
      0,
      ...actions.map((action) => INTERVENTION_ORDER.indexOf(action.level)),
    )
  ];
}
export function currencyDecimals(currency) {
  return (
    { JPY: 0, SAR: 2, USD: 2, EUR: 2, KWD: 3, BHD: 3, OMR: 3 }[currency] ?? null
  );
}
