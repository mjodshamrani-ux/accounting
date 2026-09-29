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
import { useI18n } from '@/lib/i18n/context';
import { engineText, uiText, type UiText } from '@/lib/i18n/text';
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
  const { t, say } = useI18n();
  const context = useMemo(
    () => buildImportProposalContext(file, mapping),
    [file, mapping],
  );
  const current = useRef({ file, mapping });
  const active = useRef<AbortController | null>(null);
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<LocalImportProposal | null>(null);
  const [message, setMessage] = useState<UiText | null>(null);
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
    setMessage(null);
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
      if (!result) setMessage(uiText((m) => m.importAssistant.noProposal));
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
          {busy ? t.importAssistant.searching : t.importAssistant.suggest}
        </Button>
        {busy && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => active.current?.abort()}
          >
            {t.importAssistant.cancel}
          </Button>
        )}
      </div>
      {message && <output className="hint">{say(message)}</output>}
      {proposal && (
        <div
          className="panel stack"
          aria-label={t.importAssistant.proposalLabel}
        >
          <p className="hint">{t.importAssistant.proposalNote}</p>
          <ul>
            {proposal.evidence.map((e) => (
              <li key={e.field}>
                <strong>{t.importAssistant.fields[e.field]}</strong>
                {t.importAssistant.columnOf(e.index + 1)}
                <bdi>{e.header.text || t.importAssistant.untitled}</bdi>
                {t.importAssistant.closeQuote}{' '}
                {e.samples.map((sample) => (
                  <span key={sample.row}>
                    {t.importAssistant.row(sample.row)}{' '}
                    <bdi>
                      {sample.text}
                      {sample.truncated ? '…' : ''}
                    </bdi>
                    {' · '}
                  </span>
                ))}
                {e.issueCount > 0 && (
                  <span>{t.importAssistant.engineNotes(e.issueCount)}</span>
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
                setMessage(engineText(fresh.message));
                return;
              }
              setProposal(null);
              onApply(fresh.patch);
            }}
          >
            {t.importAssistant.apply}
          </Button>
        </div>
      )}
    </div>
  );
}
