import {
  buildImportProposalContext,
  verifyImportProposal,
} from './import-proposals.ts';
import type {
  ImportCellEvidence,
  ImportColumnEvidence,
  ImportProposalField,
  ImportProposalPatch,
} from './import-proposals.ts';
import type { Mapping, SourceFile } from './types.ts';

// AI-1b: one task, a column's role, asked of any provider through one
// envelope (docs/roadmap/ai-local-assistant.ar.md, section 6). A provider is
// a function; nothing here loads a model, downloads or opens a connection.
// The provider sees a frozen copy of the evidence window the product built;
// its reply is untrusted text. A reply that is malformed, foreign, late or
// bound to another reading is refused whole. Each named role is then checked
// on its own: the cells it cites must be in the window and in its column,
// and the import verifier must accept it. What passes is a proposal that
// needs review. Nothing is applied here, and no amount, sign, row or
// decision can be carried: the reply has no field for one.

export const COLUMN_ROLE_SCHEMA = 1;
export const COLUMN_ROLE_LIMITS = {
  replyChars: 32_000,
  evidence: 4,
  timeoutMs: 30_000,
} as const;
/** Why a provider names a column: its heading, or its heading and samples. */
export const PROPOSE_REASONS = [
  'heading-names-role',
  'heading-and-samples',
] as const;
/** Why it names none: nothing says, two columns could, or not this task. */
export const ABSTAIN_REASONS = [
  'no-evidence',
  'ambiguous',
  'outside-task',
] as const;
export type ProposeReason = (typeof PROPOSE_REASONS)[number];
export type AbstainReason = (typeof ABSTAIN_REASONS)[number];

export type ColumnRoleRequest = Readonly<{
  schemaVersion: typeof COLUMN_ROLE_SCHEMA;
  taskKind: 'column-role';
  requestId: string;
  contextRevision: string;
  sourceHash: string;
  sheet: number;
  header: number;
  allowed: readonly ImportProposalField[];
  columns: readonly ImportColumnEvidence[];
  // What the window leaves out, said by the product, not the provider.
  coverage: Readonly<{
    columns: number;
    samplesPerColumn: 3;
    truncatedCells: number;
    rowsWithIssues: number;
  }>;
}>;

export type ColumnRoleProvider = (
  request: ColumnRoleRequest,
  signal: AbortSignal,
) => Promise<unknown>;

export type ColumnRoleOutcome =
  | {
      field: ImportProposalField;
      status: 'proposed';
      column: number;
      reason: ProposeReason;
      evidence: ImportCellEvidence[];
    }
  | {
      field: ImportProposalField;
      status: 'abstained';
      reason: AbstainReason | 'not-answered';
    }
  | {
      field: ImportProposalField;
      status: 'rejected';
      code: string;
      column: number;
    };

export type ColumnRoleResult =
  | { status: 'unavailable' }
  | { status: 'refused'; code: string }
  | {
      status: 'answered';
      review: 'needs-review';
      requestId: string;
      fields: ColumnRoleOutcome[];
      patch: ImportProposalPatch;
    };

function plain(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (
    (prototype === Object.prototype || prototype === null) &&
    Reflect.ownKeys(value).every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      return (
        typeof key === 'string' &&
        descriptor.enumerable &&
        'value' in descriptor
      );
    })
  );
}

const exactKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));

function frozen<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) frozen((value as never)[key]);
    Object.freeze(value);
  }
  return value;
}

/** The request for the roles the panel leaves unset in the current mode, or
 * null when the product builds no context or nothing is left to ask. */
export function columnRoleRequest(
  file: SourceFile,
  mapping: Mapping,
  requestId: string,
): ColumnRoleRequest | null {
  if (typeof requestId !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(requestId))
    return null;
  const context = buildImportProposalContext(file, mapping);
  if (!context) return null;
  const allowed = context.unresolvedFields.filter((field) =>
    mapping.mode === 'signed'
      ? field !== 'debit' && field !== 'credit'
      : field !== 'amount',
  );
  if (!allowed.length) return null;
  const cells = context.columns.flatMap((c) => [c.header, ...c.samples]);
  return frozen(
    structuredClone({
      schemaVersion: COLUMN_ROLE_SCHEMA,
      taskKind: 'column-role' as const,
      requestId,
      contextRevision: context.baseline,
      sourceHash: context.sourceHash,
      sheet: context.sheet,
      header: context.header,
      allowed,
      columns: context.columns,
      coverage: {
        columns: context.columns.length,
        samplesPerColumn: 3 as const,
        truncatedCells: cells.filter((cell) => cell.truncated).length,
        rowsWithIssues: Math.max(
          0,
          ...context.columns.map((c) => c.issueCount),
        ),
      },
    }),
  );
}

type Entry =
  | {
      field: ImportProposalField;
      column: number;
      reason: ProposeReason;
      evidence: { row: number; column: number }[];
    }
  | { field: ImportProposalField; reason: AbstainReason };

/** The reply's envelope, checked whole: one bad entry refuses it all. */
function envelope(
  request: ColumnRoleRequest,
  reply: unknown,
): { ok: true; entries: Entry[] } | { ok: false; code: string } {
  const fail = (code: string) => ({ ok: false as const, code });
  if (
    !plain(reply) ||
    !exactKeys(reply, [
      'schemaVersion',
      'taskKind',
      'requestId',
      'contextRevision',
      'proposals',
    ]) ||
    reply.schemaVersion !== COLUMN_ROLE_SCHEMA ||
    reply.taskKind !== 'column-role' ||
    !Array.isArray(reply.proposals)
  )
    return fail('invalid-schema');
  if (reply.requestId !== request.requestId) return fail('foreign-request');
  if (reply.contextRevision !== request.contextRevision)
    return fail('stale-context');
  if (reply.proposals.length > request.allowed.length)
    return fail('invalid-schema');
  const seen = new Set<string>();
  const entries: Entry[] = [];
  for (const item of reply.proposals) {
    if (!plain(item) || typeof item.field !== 'string')
      return fail('invalid-schema');
    const field = item.field as ImportProposalField;
    if (!request.allowed.includes(field) || seen.has(field))
      return fail('invalid-schema');
    seen.add(field);
    if (exactKeys(item, ['field', 'reason'])) {
      if (!ABSTAIN_REASONS.includes(item.reason as AbstainReason))
        return fail('invalid-schema');
      entries.push({ field, reason: item.reason as AbstainReason });
      continue;
    }
    if (
      !exactKeys(item, ['field', 'column', 'reason', 'evidence']) ||
      !Number.isInteger(item.column) ||
      !PROPOSE_REASONS.includes(item.reason as ProposeReason) ||
      !Array.isArray(item.evidence) ||
      !item.evidence.length ||
      item.evidence.length > COLUMN_ROLE_LIMITS.evidence ||
      !item.evidence.every(
        (cell) =>
          plain(cell) &&
          exactKeys(cell, ['row', 'column']) &&
          Number.isInteger(cell.row) &&
          Number.isInteger(cell.column),
      )
    )
      return fail('invalid-schema');
    entries.push({
      field,
      column: item.column as number,
      reason: item.reason as ProposeReason,
      evidence: (item.evidence as { row: number; column: number }[]).map(
        (cell) => ({ row: cell.row, column: cell.column }),
      ),
    });
  }
  return { ok: true, entries };
}

/** One named role, checked against the window and the import verifier. */
function checked(
  file: SourceFile,
  mapping: Mapping,
  request: ColumnRoleRequest,
  entry: Extract<Entry, { column: number }>,
): ColumnRoleOutcome {
  const { field, column } = entry;
  const reject = (code: string): ColumnRoleOutcome => ({
    field,
    status: 'rejected',
    code,
    column,
  });
  const window = request.columns[column];
  if (!window) return reject('invalid-column-index');
  const cited: ImportCellEvidence[] = [];
  for (const cell of entry.evidence) {
    const owner = request.columns.find((c) => c.header.column === cell.column);
    const found = owner
      ? [owner.header, ...owner.samples].find((e) => e.row === cell.row)
      : undefined;
    if (!found) return reject('evidence-outside-window');
    if (cell.column !== column + 1) return reject('evidence-elsewhere');
    if (!cited.includes(found)) cited.push(found);
  }
  if (!cited.includes(window.header)) return reject('heading-not-cited');
  if (
    entry.reason === 'heading-and-samples' &&
    !cited.some((cell) => cell !== window.header)
  )
    return reject('samples-not-cited');
  const verdict = verifyImportProposal(file, mapping, {
    sourceHash: request.sourceHash,
    sheet: request.sheet,
    header: request.header,
    baseline: request.contextRevision,
    columns: { [field]: column },
  });
  if (!verdict.ok) return reject(verdict.code);
  return {
    field,
    status: 'proposed',
    column,
    reason: entry.reason,
    evidence: structuredClone(cited),
  };
}

/** Asks a provider for the unset roles and returns what may be reviewed.
 * Advisory only: the mapping and the source are not changed. */
export async function askColumnRoles(
  file: SourceFile,
  mapping: Mapping,
  provider: ColumnRoleProvider,
  options: { requestId: string; signal?: AbortSignal; timeoutMs?: number },
): Promise<ColumnRoleResult> {
  const request = columnRoleRequest(file, mapping, options.requestId);
  if (!request) return { status: 'unavailable' };
  if (options.signal?.aborted) return { status: 'refused', code: 'cancelled' };
  const reading = JSON.stringify({
    sheets: file.sheets,
    pdf: file.pdf,
    mapping,
  });
  const controller = new AbortController();
  const stop = () => controller.abort();
  options.signal?.addEventListener('abort', stop, { once: true });
  const timeout = Math.min(
    options.timeoutMs ?? COLUMN_ROLE_LIMITS.timeoutMs,
    COLUMN_ROLE_LIMITS.timeoutMs,
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reply: unknown;
  try {
    const late = new Promise<'late'>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve('late');
      }, timeout);
      controller.signal.addEventListener('abort', () => resolve('late'), {
        once: true,
      });
    });
    const answer = Promise.resolve()
      .then(() => provider(request, controller.signal))
      .then(
        (value) => ({ value }),
        () => 'error' as const,
      );
    const first = await Promise.race([answer, late]);
    if (first === 'late' || controller.signal.aborted)
      return {
        status: 'refused',
        code: options.signal?.aborted ? 'cancelled' : 'timeout',
      };
    if (first === 'error') return { status: 'refused', code: 'provider-error' };
    reply = first.value;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', stop);
  }
  // The reading may have changed while the provider ran.
  if (
    JSON.stringify({ sheets: file.sheets, pdf: file.pdf, mapping }) !== reading
  )
    return { status: 'refused', code: 'source-changed' };
  const now = columnRoleRequest(file, mapping, options.requestId);
  if (!now || JSON.stringify(now) !== JSON.stringify(request))
    return { status: 'refused', code: 'stale-context' };
  if (typeof reply === 'string') {
    if (reply.length > COLUMN_ROLE_LIMITS.replyChars)
      return { status: 'refused', code: 'invalid-schema' };
    try {
      reply = JSON.parse(reply);
    } catch {
      return { status: 'refused', code: 'invalid-schema' };
    }
  }
  const parsed = envelope(request, reply);
  if (!parsed.ok) return { status: 'refused', code: parsed.code };
  const fields: ColumnRoleOutcome[] = request.allowed.map((field) => {
    const entry = parsed.entries.find((e) => e.field === field);
    if (!entry) return { field, status: 'abstained', reason: 'not-answered' };
    if (!('column' in entry))
      return { field, status: 'abstained', reason: entry.reason };
    return checked(file, mapping, request, entry);
  });
  // Two roles on one column cannot both stand; neither is offered.
  const proposed = fields.filter((f) => f.status === 'proposed');
  for (const [i, outcome] of fields.entries())
    if (
      outcome.status === 'proposed' &&
      proposed.some(
        (other) =>
          other !== outcome &&
          other.status === 'proposed' &&
          other.column === outcome.column,
      )
    )
      fields[i] = {
        field: outcome.field,
        status: 'rejected',
        code: 'duplicate-columns',
        column: outcome.column,
      };
  const patch: ImportProposalPatch = {};
  for (const outcome of fields)
    if (outcome.status === 'proposed') patch[outcome.field] = outcome.column;
  if (Object.keys(patch).length) {
    const together = verifyImportProposal(file, mapping, {
      sourceHash: request.sourceHash,
      sheet: request.sheet,
      header: request.header,
      baseline: request.contextRevision,
      columns: patch,
    });
    if (!together.ok) return { status: 'refused', code: together.code };
  }
  return {
    status: 'answered',
    review: 'needs-review',
    requestId: request.requestId,
    fields,
    patch,
  };
}
