// The decision platform (UX-3): which of approve, reject and undo a review
// offers, and why the others are closed. The rules are the ones each
// workspace applied to its own buttons, written once; the engine's
// lifecycle still refuses any decision it does not allow, so a screen can
// only ever offer less than the engine accepts, never more.

export type DecisionType = 'accept' | 'reject' | 'undo';

/** The review state a decision acts on, as the engines name it. */
export type DecisionReview =
  | 'needs-review'
  | 'accepted'
  | 'rejected'
  | 'blocked';

/** Why approval alone is closed while the other decisions may be open: the
 * completeness of the sources is not confirmed, the result carries a source
 * error, missing evidence, an inconsistency or a difference, or, where a
 * workspace approves one pair only when every pair is ready, a pair is not. */
export type AcceptBlock =
  | 'unconfirmed'
  | 'source-error'
  | 'missing'
  | 'inconsistent'
  | 'difference'
  | 'pairs';

/** What closes every decision before the state is even read. */
export type DecisionNeed = 'both' | 'reference' | 'reason' | 'members';

export type DecisionInput = {
  reference: string;
  reason: string;
  /** Members the decision would bind; omitted where none are counted. */
  members?: number;
  review: DecisionReview;
  acceptBlock: AcceptBlock | null;
};

/** What the fields and the members still need, or null when they are set. */
export function decisionNeed(d: DecisionInput): DecisionNeed | null {
  const reference = !!d.reference.trim(),
    reason = !!d.reason.trim();
  if (!reference && !reason) return 'both';
  if (!reference) return 'reference';
  if (!reason) return 'reason';
  if (d.members !== undefined && d.members < 1) return 'members';
  return null;
}

/** Which decisions are open: approve and reject while the review needs it,
 * undo once it is decided, nothing on a blocked review, and approval only
 * without an acceptance block. */
export function decisionOpen(d: DecisionInput): Record<DecisionType, boolean> {
  const free = decisionNeed(d) === null && d.review !== 'blocked',
    pending = d.review === 'needs-review';
  return {
    accept: free && pending && d.acceptBlock === null,
    reject: free && pending,
    undo: free && !pending,
  };
}

/** What the sentence under the buttons says: the first thing that closes
 * every decision, or else the state; and, while the review is open, the
 * block on approval if there is one. `each` is for a platform whose buttons
 * sit with each of many items: it states the rule, and each item's heading
 * states its own state. */
export type DecisionHintKey =
  | DecisionNeed
  | 'blocked'
  | 'pending'
  | 'decided'
  | 'each'
  | 'eachBlocked';

export function decisionHint(
  d: Omit<DecisionInput, 'review'> & {
    review: DecisionReview | 'each' | 'eachBlocked';
  },
): { key: DecisionHintKey; accept: AcceptBlock | null } {
  const need = decisionNeed({ ...d, review: 'needs-review' });
  if (need) return { key: need, accept: null };
  if (d.review === 'each' || d.review === 'eachBlocked')
    return { key: d.review, accept: d.acceptBlock };
  if (d.review === 'blocked') return { key: 'blocked', accept: null };
  if (d.review === 'needs-review')
    return { key: 'pending', accept: d.acceptBlock };
  return { key: 'decided', accept: null };
}
