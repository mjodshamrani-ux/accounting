// Classify only visible business fields. Hidden event IDs cannot establish a group.
export const P2_GROUP_CAPABILITY = 'explicit-payment-whole-groups-p2-v1';

// A separately opted-in capability, not a revision of the historical 046
// oracle. This proves whole-group equivalence from the rendered business
// fields; it does not attribute individual components or allocate invoices.
function classifyP2PaymentGroup(spec, group, a, b, answer) {
  const all = [...a, ...b];
  const review = (reason) =>
    answer('review', reason, 'payment-group-equivalence');
  if (all.some((r) => r.kind !== 'Payment'))
    return answer(
      'out-of-scope',
      'P2 does not authorize invoice N:M or mixed document roles',
      'component-allocation',
    );
  if (
    spec.sources.some((s) => s.invalid) ||
    new Set([...group.aKeys, ...group.bKeys]).size !== all.length ||
    a.length !== group.aKeys.length ||
    b.length !== group.bKeys.length
  )
    return review('Unread or duplicated source membership');
  if (Math.max(a.length, b.length) > 100)
    return review('The bounded whole-group capability is exceeded');
  if (
    all.some(
      (r) =>
        !Number.isSafeInteger(r.minor) ||
        !r.minor ||
        Math.sign(r.minor) !== Math.sign(all[0].minor) ||
        r.currency !== all[0].currency ||
        r.account !== all[0].account,
    )
  )
    return review('Invalid amount, scope or sign');
  // This independent fixture contract is deliberately limited to one valid
  // event date. Wider engine date-window support is tested separately.
  if (
    all.some((r) => !Number.isFinite(Date.parse(r.date))) ||
    new Set(all.map((r) => r.date)).size !== 1
  )
    return review('A common valid event date is not documented');
  if (
    [a, b].some(
      (rows) => new Set(rows.map((r) => r.minor)).size !== rows.length,
    )
  )
    return review('Equal component amounts have no distinct posting identity');
  if (
    a.reduce((s, r) => s + BigInt(r.minor), 0n) !==
    b.reduce((s, r) => s + BigInt(r.minor), 0n)
  )
    return review('The complete signed group totals differ');
  const members = new Set(all.map((r) => r.key));
  const fields = ['bankReference', 'receiptReference'];
  const visible = spec.sources.flatMap((s) =>
    s.rows.map((row) => ({
      row,
      side: s.side,
      fields: s.layout.fields ?? [],
    })),
  );
  const claims = new Map();
  for (const { row, side, fields: shown } of visible)
    for (const field of fields) {
      const value = shown.includes(field) ? row[field] : '';
      if (!value) continue;
      const key = JSON.stringify([field, value]);
      const claim = claims.get(key) ?? { field, value, rows: [] };
      claim.rows.push({ row, side });
      claims.set(key, claim);
    }
  for (const claim of claims.values()) {
    const inside = claim.rows.filter(({ row }) => members.has(row.key));
    if (!inside.length) continue;
    if (
      inside.length !== claim.rows.length ||
      (new Set(inside.map(({ side }) => side)).size > 1 &&
        inside.length !== all.length)
    )
      return review(
        'Another visible identity has different overlapping membership',
      );
  }
  for (const field of fields)
    if (
      new Set(
        visible
          .filter(
            ({ row, fields: shown }) =>
              members.has(row.key) && shown.includes(field),
          )
          .map(({ row }) => row[field])
          .filter(Boolean),
      ).size > 1
    )
      return review(
        'Explicit identity values conflict within the proposed group',
      );
  const identity = [...claims.values()].find(
    (claim) =>
      claim.rows.length === all.length &&
      claim.rows.every(({ row }) => members.has(row.key)) &&
      /\p{L}/u.test(claim.value) &&
      /\p{Nd}/u.test(claim.value) &&
      claim.value.length >= 4,
  );
  if (!identity)
    return review('No explicit complete shared bank or receipt identity');
  const unsafe = (value) =>
    /^[=+\-−@#]/u.test(
      String(value ?? '')
        .normalize('NFKC')
        .trim(),
    );
  if (
    visible
      .filter(({ row }) => members.has(row.key))
      .some(({ row, fields: shown }) =>
        ['reference', ...fields, 'poReference'].some(
          (field) => shown.includes(field) && unsafe(row[field]),
        ),
      )
  )
    return review('Formula-like or error-like visible reference evidence');
  const collisionKey = (value) =>
    String(value ?? '')
      .normalize('NFKC')
      .toUpperCase()
      .replace(/[^\p{L}\p{Nd}]/gu, '');
  if (
    visible.some(
      ({ row, fields: shown }) =>
        !members.has(row.key) &&
        shown.includes('reference') &&
        collisionKey(row.reference) === collisionKey(identity.value),
    )
  )
    return review('An outside primary reference may identify another member');
  return answer(
    'required',
    'Complete explicit payment identity, distinct signed components and no competing visible membership',
    'payment-group-equivalence',
  );
}

export function classifyVisibleGroup(spec, group, { capability } = {}) {
  if (capability !== undefined && capability !== P2_GROUP_CAPABILITY)
    throw Error(`Unknown group oracle capability: ${capability}`);
  const a = spec.sources[0].rows.filter((r) => group.aKeys.includes(r.key)),
    b = spec.sources[1].rows.filter((r) => group.bKeys.includes(r.key)),
    all = [...a, ...b];
  const answer = (classification, reason, businessTask) => ({
    ...group,
    classification,
    reason,
    businessTask,
    ...(capability ? { oracleCapability: capability } : {}),
    sourceProof: spec.sources.map((s) => ({
      side: s.side,
      file: s.name,
      format: s.format,
      layout: s.layout.family,
      referenceHeader: s.metadata.referenceHeader ?? 'Reference',
      typedPaymentEvidence:
        s.layout.fields?.filter((f) =>
          ['bankReference', 'receiptReference'].includes(f),
        ) ?? [],
      typeEvidence:
        s.format === 'pdf' ? 'description text' : 'Document Type column',
    })),
    visibleEvidence: all.map(
      ({
        key,
        reference,
        kind,
        date,
        minor,
        currency,
        account,
        bankReference,
        receiptReference,
        poReference,
        amountBasis,
      }) => ({
        key,
        reference,
        kind,
        date,
        minor,
        currency,
        account,
        bankReference,
        receiptReference,
        poReference,
        amountBasis,
      }),
    ),
  });
  if (a.length > 1 && b.length > 1) {
    if (capability === P2_GROUP_CAPABILITY)
      return classifyP2PaymentGroup(spec, group, a, b, answer);
    return answer(
      'out-of-scope',
      'Many-to-many component attribution is not supported',
      'component-allocation',
    );
  }
  if (!a.length || !b.length)
    return answer('review', 'A side is absent', 'unknown');
  const kind = all[0].kind;
  if (all.some((r) => r.kind !== kind))
    return answer(
      'review',
      'Document types conflict',
      'payment-to-invoice-allocation',
    );
  if (
    all.some(
      (r) =>
        r.currency !== all[0].currency ||
        r.account !== all[0].account ||
        Math.sign(r.minor) !== Math.sign(all[0].minor),
    )
  )
    return answer(
      'review',
      'Scope or sign conflict',
      kind === 'Payment' ? 'payment-matching' : 'document-lines',
    );
  const many = a.length > 1 ? a : b;
  if (new Set(many.map((r) => r.minor)).size !== many.length)
    return answer(
      'review',
      'Equal component amounts have no distinct posting identity',
      'possible-duplicate',
    );
  if (new Set(many.map((r) => r.date)).size !== 1)
    return answer(
      'review',
      'Components do not share one event date',
      'component-identity',
    );
  if (
    a.reduce((s, r) => s + BigInt(r.minor), 0n) !==
    b.reduce((s, r) => s + BigInt(r.minor), 0n)
  )
    return answer(
      'review',
      'Component total differs from the single movement',
      'incomplete-group',
    );
  if (kind === 'Payment') {
    for (const field of ['bankReference', 'receiptReference']) {
      if (!spec.sources.every((s) => s.layout.fields?.includes(field)))
        continue;
      const identity = all[0][field];
      if (!identity || all.some((r) => r[field] !== identity)) continue;
      const observed = spec.sources
        .flatMap((s) => s.rows)
        .filter((r) => r[field] === identity);
      if (observed.length !== all.length)
        return answer(
          'review',
          'The explicit identity is also present outside the proposed group',
          'payment-matching',
        );
      return answer(
        'required',
        'Shared explicit bank/receipt identity with distinct complete components',
        'payment-matching',
      );
    }
    return answer(
      'review',
      'A generic payment reference does not document the component relationship',
      'payment-matching',
    );
  }
  if (
    ['Invoice', 'Credit Note'].includes(kind) &&
    spec.sources.every((s) => s.metadata.referenceHeader === 'Invoice No')
  ) {
    const reference = all[0].reference,
      po = all[0].poReference;
    if (
      reference &&
      po &&
      all.every((r) => r.reference === reference && r.poReference === po) &&
      spec.sources.every((s) => s.layout.fields?.includes('poReference'))
    )
      return answer(
        'required',
        'Explicit document number and purchase-order evidence identify its distinct lines',
        'document-lines',
      );
  }
  return answer(
    'review',
    'No explicit shared document identity and line relationship',
    'document-lines',
  );
}
