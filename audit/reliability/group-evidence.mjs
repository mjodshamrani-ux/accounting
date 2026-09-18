// Classify only visible business fields. Hidden event IDs cannot establish a group.
export function classifyVisibleGroup(spec, group) {
  const a = spec.sources[0].rows.filter((r) => group.aKeys.includes(r.key)),
    b = spec.sources[1].rows.filter((r) => group.bKeys.includes(r.key)),
    all = [...a, ...b];
  const answer = (classification, reason, businessTask) => ({
    ...group,
    classification,
    reason,
    businessTask,
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
  if (a.length > 1 && b.length > 1)
    return answer(
      'out-of-scope',
      'Many-to-many component attribution is not supported',
      'component-allocation',
    );
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
