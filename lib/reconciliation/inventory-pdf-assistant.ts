import { evidenceQuestionKind } from '../i18n/domain-evidence.ts';
import type {
  DomainEvidenceAnswer,
  DomainEvidenceFact,
} from './domain-assistant.ts';
import { replayStockPdfOriginals } from './inventory-register.ts';
import {
  snapshotStockPdfRequest,
  sameStockPdfData,
  type StockPdfAskRequest,
} from './inventory-pdf-request.ts';
/** A read-only deterministic explanation. No model, network or approval path. */
export async function askStockPdf(
  payload: StockPdfAskRequest,
): Promise<DomainEvidenceAnswer> {
  const captured = snapshotStockPdfRequest(
    'stock-pdf-ask',
    payload,
  ) as StockPdfAskRequest;
  let kind: Exclude<DomainEvidenceAnswer['kind'], 'stale'> =
    evidenceQuestionKind(captured.question);
  const q = captured.question.trim().toLowerCase();
  if (
    kind === 'unsupported' &&
    /^(?:لماذا يوجد فرق|ليش فيه فرق|why is there a difference)(?:\s+[0-9٠-٩.,٬٫ ]+)?[?؟]?$/.test(
      q,
    )
  )
    kind = 'amounts';
  if (
    kind === 'unsupported' &&
    /^(?:ماذا أراجع الآن|ما الذي لم يتم التأكد منه|what should i review now|what remains unverified)[?؟]?$/.test(
      q,
    )
  )
    kind = 'next';
  const empty = (kind: 'stale' | 'unsupported'): DomainEvidenceAnswer => ({
    kind,
    facts: [],
    sources: [],
    currency: '',
    decimals: 0,
  });
  if (kind === 'unsupported') return empty(kind);
  const fresh = await replayStockPdfOriginals(captured.state);
  if (!sameStockPdfData(captured.result, fresh.result)) return empty('stale');
  const r = fresh.result;
  const facts: DomainEvidenceFact[] =
    kind === 'amounts'
      ? [
          {
            label: 'supportedRegister',
            subject: 'register',
            value: r.totals?.registerMinor ?? null,
            money: true,
          },
          {
            label: 'carrying',
            subject: 'gl',
            value: r.totals?.glMinor ?? null,
            money: true,
          },
          ...r.comparisons.map((c) => ({
            label: 'difference' as const,
            value: c.differenceMinor,
            money: true as const,
            detail: c.account + ' · ' + c.dimensions,
          })),
        ]
      : kind === 'sources'
        ? []
        : [
            { label: 'status', value: r.status },
            { label: 'financial', value: r.financial },
            { label: 'review', value: r.review },
            { label: 'diagnostics', value: r.issues.length },
            { label: 'missing', value: r.missing.length },
            { label: 'members', value: r.memberIds.length },
            { label: 'completeness', value: r.completeness.confirmed },
          ];
  return {
    kind,
    facts,
    context: r.context,
    currency: r.scope.currency,
    decimals: r.decimals,
    sources: fresh.state.files.map((f, i) => ({
      name: f.name,
      hash: f.sha256,
      sheet: i ? 'CSV' : 'PDF',
    })),
    citations: r.pdfEvidence!.records.flatMap((v) =>
      Object.entries(v.raw).map(([field, raw]) => ({
        hash: fresh.state.files[0].sha256,
        page: v.page,
        line: v.line,
        field,
        text: raw,
        recordId: v.id,
      })),
    ),
  };
}
