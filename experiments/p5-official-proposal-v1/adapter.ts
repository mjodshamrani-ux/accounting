// Development-only, mock-only protocol harness. No runtime, network or engine Apply.
import {
  inspectMultilineSource,
  proposeMultilineSelection,
  type BoundSelection,
  type SourceSnapshot,
  type Field,
  type FieldSelection,
} from '../../audit/local-provider/multiline-source-v1/workflow.ts';

export type MockProvider = Readonly<{
  kind: 'mock';
  name: string;
  generate(request: Readonly<{
    originalText: string;
    originalSha256: string;
    extractionRevision: string;
    protocol: 'p5-official-experiment-v1';
  }>, signal: AbortSignal): Promise<unknown>;
}>;
type RoleCitation = Readonly<{ field: Field; startUtf16: number; endUtf16: number; literal: string }>;
export type Clarification = Readonly<{
  reason: 'missing-role' | 'competing-role';
  fields: readonly Field[];
  citations: readonly RoleCitation[];
}>;
export type ExperimentResult = Readonly<{
  providerKind: 'mock';
  realInferenceExecuted: false;
  productEnabled: false;
  humanApproval: false;
  engineInvoked: false;
}> & (
  | { kind: 'candidate'; candidate: BoundSelection }
  | { kind: 'clarify'; question: Clarification }
  | { kind: 'abstain' }
  | { kind: 'rejected'; reason: 'source-bound' | 'protocol' | 'evidence' | 'stale' | 'cancelled' | 'deadline' | 'provider-error' }
);
const flags = Object.freeze({ providerKind: 'mock' as const, realInferenceExecuted: false as const,
  productEnabled: false as const, humanApproval: false as const, engineInvoked: false as const });
const fields: Field[] = ['date', 'reference', 'amount', 'currency'];
const roleFields: Record<string, readonly Field[]> = {
  'Issue date': ['date'], 'تاريخ الإصدار': ['date'],
  'Invoice number': ['reference'], 'رقم الفاتورة': ['reference'],
  'Invoice total': ['amount', 'currency'], 'إجمالي الفاتورة': ['amount', 'currency'],
};
function questionFor(snapshot: SourceSnapshot): Clarification | null {
  if (snapshot.outcome !== 'question' ||
      (snapshot.reason !== 'missing-role' && snapshot.reason !== 'competing-role')) return null;
  // The independent source reader already validated every line/value. Only
  // role occurrence counts are used here; no missing value is synthesized.
  const text = new TextDecoder('utf-8', { fatal: true }).decode(snapshot.originalBytes);
  const roles: RoleCitation[] = [];
  let offset = 0;
  for (const line of text.split(/(?<=\n)/)) {
    const match = /^ *(.*?) *:/.exec(line);
    const label = match?.[1];
    if (label && Object.hasOwn(roleFields, label)) {
      const start = offset + line.indexOf(label);
      for (const field of roleFields[label]) roles.push(Object.freeze({
        field, startUtf16: start, endUtf16: start + label.length, literal: label,
      }));
    }
    offset += line.length;
  }
  const affected = fields.filter((field) => {
    const count = roles.filter((role) => role.field === field).length;
    return snapshot.reason === 'missing-role' ? count === 0 : count > 1;
  });
  if (!affected.length) return null;
  return Object.freeze({ reason: snapshot.reason, fields: Object.freeze(affected),
    citations: Object.freeze(snapshot.reason === 'missing-role' ? roles : roles.filter((role) => affected.includes(role.field))) });
}
function parse(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > 12000) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(value) !== raw) return null;
    return value as Record<string, unknown>;
  } catch { return null; }
}
function keys(value: Record<string, unknown>, expected: string[]) {
  return Object.keys(value).sort().join('|') === expected.slice().sort().join('|');
}

export class MockProposalExperiment {
  #bytes: Uint8Array;
  #revision: string;
  #provider: MockProvider;
  #generation = 0;
  #active: AbortController | null = null;
  #deadlineMs: number;
  constructor(bytes: Uint8Array, revision: string, provider: MockProvider, deadlineMs = 20000) {
    if (provider.kind !== 'mock' || !/^[A-Za-z0-9._:-]{1,80}$/.test(provider.name) ||
        !Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 20000)
      throw Error('This phase permits an explicit mock provider and a bounded deadline only');
    this.#bytes = new Uint8Array(bytes);
    this.#revision = revision;
    // Capture the provider function: later mutation cannot swap the active provider.
    this.#provider = Object.freeze({ kind: provider.kind, name: provider.name, generate: provider.generate.bind(provider) });
    this.#deadlineMs = deadlineMs;
  }
  replaceSource(bytes: Uint8Array, revision: string): void {
    this.cancel();
    this.#bytes = new Uint8Array(bytes);
    this.#revision = revision;
  }
  cancel(): void {
    this.#generation++;
    this.#active?.abort();
    this.#active = null;
  }
  async run(): Promise<ExperimentResult> {
    this.cancel();
    const generation = this.#generation;
    const controller = new AbortController();
    this.#active = controller;
    const bytes = new Uint8Array(this.#bytes);
    const revision = this.#revision;
    const reject = (reason: Extract<ExperimentResult, { kind: 'rejected' }>['reason']): ExperimentResult =>
      Object.freeze({ ...flags, kind: 'rejected', reason });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let aborted: (() => void) | undefined;
    let expired = false;
    const fresh = () => generation === this.#generation && this.#active === controller && !controller.signal.aborted;
    try {
      const snapshot = await inspectMultilineSource(bytes, revision);
      if (!fresh()) return reject('stale');
      if (snapshot.reason === 'source-bound' || snapshot.reason === 'invalid-encoding') return reject('source-bound');
      const interruption = new Promise<never>((_, rejectWait) => {
        aborted = () => rejectWait(Error('interrupted'));
        controller.signal.addEventListener('abort', aborted, { once: true });
        timer = setTimeout(() => { expired = true; controller.abort(); }, this.#deadlineMs);
      });
      // Generate inside the race so synchronous provider exceptions are handled.
      const raw = await Promise.race([Promise.resolve().then(() => this.#provider.generate(Object.freeze({
        originalText: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
        originalSha256: snapshot.originalSha256, extractionRevision: revision,
        protocol: 'p5-official-experiment-v1' as const,
      }), controller.signal)), interruption]);
      if (!fresh()) return reject('stale');
      const reply = parse(raw);
      if (!reply) return reject('protocol');
      if (reply.kind === 'abstain' && keys(reply, ['kind']))
        return Object.freeze({ ...flags, kind: 'abstain' });
      if (reply.kind === 'clarify' && keys(reply, ['kind', 'sourceSha256', 'extractionRevision', 'question'])) {
        const question = questionFor(snapshot);
        if (!question || reply.sourceSha256 !== snapshot.originalSha256 || reply.extractionRevision !== revision ||
            JSON.stringify(reply.question) !== JSON.stringify(question)) return reject('evidence');
        return Object.freeze({ ...flags, kind: 'clarify', question });
      }
      if (reply.kind !== 'extract' || !keys(reply, ['kind', 'spans'])) return reject('protocol');
      // Compact output: field + value/role UTF-16 ranges, never model amounts.
      // Reconstruct literals/UTF-8 ranges from the owned original, then require
      // exact equality with the independent reader's role-bearing proof.
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (!Array.isArray(reply.spans) || reply.spans.length !== 4) return reject('evidence');
      const selections: FieldSelection[] = [];
      for (const item of reply.spans as unknown[]) {
        if (!Array.isArray(item) || item.length !== 5 || !fields.includes(item[0] as Field) ||
            !item.slice(1).every((position: unknown) => typeof position === 'number' &&
              Number.isSafeInteger(position) && position >= 0 && position <= text.length) ||
            item[1] >= item[2] || item[3] >= item[4]) return reject('evidence');
        const citation = (startUtf16: number, endUtf16: number) => ({ startUtf16, endUtf16,
          startByte: new TextEncoder().encode(text.slice(0, startUtf16)).length,
          endByte: new TextEncoder().encode(text.slice(0, endUtf16)).length,
          literal: text.slice(startUtf16, endUtf16) });
        selections.push({ field: item[0] as Field, value: citation(item[1] as number, item[2] as number),
          role: citation(item[3] as number, item[4] as number),
          sourceSha256: snapshot.originalSha256, extractionRevision: revision });
      }
      const candidate = await proposeMultilineSelection(snapshot, selections);
      if (!fresh()) return reject('stale');
      if (!candidate) return reject('evidence');
      return Object.freeze({ ...flags, kind: 'candidate', candidate });
    } catch {
      if (expired) return reject('deadline');
      if (controller.signal.aborted) return reject('cancelled');
      return reject('provider-error');
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (aborted) controller.signal.removeEventListener('abort', aborted);
      if (this.#active === controller) this.#active = null;
    }
  }
}
