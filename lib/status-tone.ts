import type { AdviceLine } from './reconciliation/allocation-advice.ts';
import type {
  AssetSectionsAccount,
  AssetSectionsAsset,
  AssetSectionsResult,
} from './reconciliation/fixed-assets-sections.ts';
import type { GlsAccount } from './reconciliation/gl-tb-sections.ts';
import type { IntercompanyBatchRelation } from './reconciliation/intercompany-batch.ts';
import type {
  ImbAccount,
  ImbPosition,
} from './reconciliation/inventory-movement-bridge.ts';
import type { GatewayBatch } from './reconciliation/payment-gateway-batches.ts';
import type { PlrEmployee } from './reconciliation/payroll-long-register.ts';

/** The tone of a status badge (UX-3): one language for the status a
 * workspace shows, read from the engine's own status, with no new status
 * layer. Only a status the engine, or a recorded human decision, settles as
 * agreeing takes the agreed tone; a status that waits for a person is
 * review. */
export type StatusTone =
  | 'agreed'
  | 'suggestion'
  | 'review'
  | 'difference'
  | 'held'
  | 'neutral';

export const STATUS_TONES: readonly StatusTone[] = [
  'agreed',
  'suggestion',
  'review',
  'difference',
  'held',
  'neutral',
];

/** Receivables: a document pair the engine matched, or a person confirmed. */
export const arCaseTone = (status: 'matched' | 'review'): StatusTone =>
  status === 'matched' ? 'agreed' : 'review';

/** Clearing: a group cleared by its explicit reference or a decision. */
export const clearingGroupTone = (status: 'cleared' | 'review'): StatusTone =>
  status === 'cleared' ? 'agreed' : 'review';

/** Bank: a whole case matched by explicit source identity or by a person;
 * a source error cannot be judged. */
export const bankCaseTone = {
  'matched-evidence': 'agreed',
  'matched-manual': 'agreed',
  'needs-review': 'review',
  'source-error': 'held',
} as const satisfies Record<string, StatusTone>;

/** Supplier: the word the review list shows for a case. A match, automatic
 * or confirmed by a person, is agreed; a suggested group is a suggestion;
 * an amount difference is a difference; every other case waits for review. */
export const supplierCaseTone = {
  auto: 'agreed',
  manual: 'agreed',
  amountVariance: 'difference',
  paymentCandidate: 'suggestion',
  rejected: 'review',
  needsReview: 'review',
  unmatched: 'review',
} as const satisfies Record<string, StatusTone>;

/* The review sections, one map per status column, each keyed by its
 * engine's statuses, so a status added to an engine has no tone until one
 * is chosen. */

/** Allocation advice (ALL-1): a line that fits waits for its approval, a
 * suggestion; a line already allocated in the snapshot is a fact. */
export const allocationAdviceTone = {
  fits: 'suggestion',
  review: 'review',
  allocated: 'neutral',
} as const satisfies Record<AdviceLine['status'], StatusTone>;

/** Gateway batches and payouts (PG-1): money in transit is a timing, not a
 * difference. Payouts take the statuses of batches; a payout status this
 * map lacks fails to compile where the payouts table reads it. */
export const gatewayBatchTone = {
  consistent: 'agreed',
  'in-transit': 'neutral',
  review: 'review',
} as const satisfies Record<GatewayBatch['status'], StatusTone>;

/** Intercompany relations (IC-1): a relation ready for review has no
 * difference left, but waits for the decision on the whole pair. */
export const intercompanyRelationTone = {
  ready: 'suggestion',
  difference: 'difference',
  blocked: 'held',
  missing: 'held',
} as const satisfies Record<IntercompanyBatchRelation['status'], StatusTone>;

/** GL and TB sections (GLT-1): a source that does not bridge is a measured
 * gap. */
export const glSectionTone = {
  consistent: 'agreed',
  difference: 'difference',
  inconsistent: 'difference',
  held: 'held',
  missing: 'held',
} as const satisfies Record<GlsAccount['status'], StatusTone>;

/** Asset register by section (FA-1): accounts, assets and sections; a
 * section read or excluded by its scope is a reading fact. */
export const assetSectionTone = {
  consistent: 'agreed',
  difference: 'difference',
  held: 'held',
  missing: 'held',
  read: 'neutral',
  excluded: 'neutral',
} as const satisfies Record<
  | AssetSectionsAccount['status']
  | AssetSectionsAsset['status']
  | AssetSectionsResult['sections'][number][5],
  StatusTone
>;

/** Inventory movement bridge (INV-2): positions and accounts. */
export const inventoryBridgeTone = {
  consistent: 'agreed',
  inconsistent: 'difference',
  difference: 'difference',
  held: 'held',
  missing: 'held',
} as const satisfies Record<
  ImbPosition['status'] | ImbAccount['status'],
  StatusTone
>;

/** Long payroll register (PAY-1): employees. */
export const payrollEmployeeTone = {
  consistent: 'agreed',
  inconsistent: 'difference',
  held: 'held',
  missing: 'held',
} as const satisfies Record<PlrEmployee['status'], StatusTone>;

/** A row's status and its tone from a map, for the status column of a
 * record table. */
export const toned = <S extends string>(
  map: Record<S, StatusTone>,
  status: S,
) => ({ tone: map[status], status });
