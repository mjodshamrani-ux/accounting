import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  buildImportProposalContext,
  verifyImportProposal,
} from '@/lib/reconciliation/import-proposals';
import {
  askLocalImportModel,
  localImportModelAvailable,
} from '@/lib/reconciliation/local-import-ai';
import type { LocalImportProposal } from '@/lib/reconciliation/local-import-ai';
import type { LocalModelAPI } from '@/lib/reconciliation/local-ai';
import type { Mapping, SourceFile } from '@/lib/reconciliation/types';

const labels = {
  date: 'التاريخ',
  reference: 'المرجع',
  description: 'الوصف',
  amount: 'مبلغ الحركة',
  debit: 'المدين',
  credit: 'الدائن',
  currencyColumn: 'العملة',
};
const model = () =>
  (globalThis as typeof globalThis & { LanguageModel?: LocalModelAPI })
    .LanguageModel;

export function ImportAssistant({
  file,
  mapping,
  onApply,
}: {
  file: SourceFile;
  mapping: Mapping;
  onApply: (patch: Partial<Mapping>) => void;
}) {
  const context = useMemo(
    () => buildImportProposalContext(file, mapping),
    [file, mapping],
  );
  const current = useRef({ file, mapping });
  const active = useRef<AbortController | null>(null);
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<LocalImportProposal | null>(null);
  const [message, setMessage] = useState('');
  useEffect(() => {
    current.current = { file, mapping };
    const controller = new AbortController();
    if (context)
      void localImportModelAvailable(context, model(), controller.signal).then(
        (ready) => {
          if (!controller.signal.aborted) setAvailable(ready);
        },
      );
    return () => {
      controller.abort();
      active.current?.abort();
      active.current = null;
    };
  }, [context, file, mapping]);

  async function suggest() {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setProposal(null);
    setMessage('');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        askLocalImportModel(file, mapping, controller.signal, model()),
        new Promise<null>((resolve) => {
          controller.signal.addEventListener('abort', () => resolve(null), {
            once: true,
          });
          timer = setTimeout(() => controller.abort(), 8000);
        }),
      ]);
      if (
        current.current.file !== file ||
        current.current.mapping !== mapping ||
        active.current !== controller
      )
        return;
      setProposal(result);
      if (!result)
        setMessage(
          'لم يستطع المساعد تقديم اقتراح يمكن استخدامه. اختر الأعمدة يدويًا من الخيارات المتاحة. لم تتغير بياناتك.',
        );
    } finally {
      clearTimeout(timer);
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  }
  // Unsupported devices keep exactly the existing manual mapping path. No
  // installation prompt or unavailable AI button is added to the accountant.
  if (!available) return null;
  return (
    <div className="stack">
      <div className="actions">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void suggest()}
        >
          {busy ? 'نبحث عن الأعمدة المناسبة على جهازك' : 'اقتراح الأعمدة'}
        </Button>
        {busy && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => active.current?.abort()}
          >
            إلغاء
          </Button>
        )}
      </div>
      {message && <output className="hint">{message}</output>}
      {proposal && (
        <div className="panel stack" aria-label="أعمدة مقترحة للمراجعة">
          <p className="hint">
            هذا اقتراح من مساعد الذكاء الاصطناعي على جهازك. راجع معنى كل عمود مع
            أمثلة الملف قبل استخدامه. لم تُعتمد أي أرقام أو مطابقات.
          </p>
          <ul>
            {proposal.evidence.map((e) => (
              <li key={e.field}>
                <strong>{labels[e.field]}</strong>: العمود {e.index + 1} «
                <bdi>{e.header.text || 'بدون عنوان'}</bdi>» —{' '}
                {e.samples.map((sample) => (
                  <span key={sample.row}>
                    صف {sample.row}:{' '}
                    <bdi>
                      {sample.text}
                      {sample.truncated ? '…' : ''}
                    </bdi>
                    {' · '}
                  </span>
                ))}
                {e.issueCount > 0 && (
                  <span> (ملاحظات تحتاج فحص المحرك: {e.issueCount})</span>
                )}
              </li>
            ))}
          </ul>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              const fresh = verifyImportProposal(
                file,
                mapping,
                proposal.proposal,
              );
              if (!fresh.ok) {
                setProposal(null);
                setMessage(fresh.message);
                return;
              }
              setProposal(null);
              onApply(fresh.patch);
            }}
          >
            تطبيق الأعمدة بعد مراجعتها
          </Button>
        </div>
      )}
    </div>
  );
}
