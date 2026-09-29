import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible';
import { askLocalModel } from '@/lib/reconciliation/local-ai';
import type { LocalModelAPI } from '@/lib/reconciliation/local-ai';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { explainResult } from '@/lib/reconciliation/assistant';
import type { EvidenceAnswer } from '@/lib/reconciliation/assistant';
import type { Comparison } from '@/lib/reconciliation/types';
import { useI18n } from '@/lib/i18n/context';

type Preset = 'balances' | 'unverified' | 'next' | 'explain';

export function AccountingAssistant({
  result,
  selectedId,
}: {
  result: Comparison;
  selectedId?: string;
}) {
  const { t, engineText } = useI18n();
  const [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null);
  const currentResult = useRef(result);
  currentResult.current = result;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      active.current?.abort();
    };
  }, [result]);
  const [question, setQuestion] = useState('');
  // A preset is kept by name, so the question reads in the current language;
  // a typed question is the accountant's own words and is kept as typed.
  const [history, setHistory] = useState<
    { question: string; preset?: Preset; answer: EvidenceAnswer }[]
  >([]);
  const [snapshot, setSnapshot] = useState(result);
  // Clear previous explanations synchronously when a reviewed decision changes the result.
  if (snapshot !== result) {
    setSnapshot(result);
    setHistory([]);
  }
  const ask = async (q: string, id?: string, preset?: Preset) => {
    if (!q.trim() || active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const api = (
        globalThis as typeof globalThis & { LanguageModel?: LocalModelAPI }
      ).LanguageModel;
      const local = explainResult(result, q, id);
      // Deterministic questions do not need model inference. Only use a ready local model for unknown wording.
      const enhanced =
        local.kind === 'unsupported' && !id
          ? await Promise.race([
              askLocalModel(result, q, controller.signal, api),
              new Promise<null>((resolve) =>
                controller.signal.addEventListener(
                  'abort',
                  () => resolve(null),
                  { once: true },
                ),
              ),
            ])
          : null;
      if (mounted.current && currentResult.current === result) {
        setHistory((h) => [
          ...h.slice(-9),
          { question: q, preset, answer: enhanced ?? local },
        ]);
        setQuestion('');
      }
    } finally {
      clearTimeout(timer);
      active.current = null;
      setBusy(false);
    }
  };
  return (
    <Collapsible className="surface pad stack">
      <CollapsibleTrigger
        render={
          <Button variant="ghost" style={{ justifyContent: 'space-between' }} />
        }
      >
        {t.assistant.trigger}
      </CollapsibleTrigger>
      <CollapsibleContent className="stack" aria-label={t.assistant.region}>
        <div>
          <h2>{t.assistant.heading}</h2>
          <p className="muted">{t.assistant.intro}</p>
        </div>
        <div className="actions">
          {(['balances', 'unverified', 'next'] as const).map((preset) => (
            <Button
              key={preset}
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() =>
                void ask(t.assistant.presets[preset], undefined, preset)
              }
            >
              {t.assistant.presets[preset]}
            </Button>
          ))}
          {selectedId && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() =>
                void ask(t.assistant.presets.explain, selectedId, 'explain')
              }
            >
              {t.assistant.presets.explain}
            </Button>
          )}
        </div>
        <div
          aria-live="polite"
          aria-relevant="additions"
          style={{ maxHeight: 430, overflowY: 'auto' }}
        >
          {history.map((entry, i) => (
            <article
              key={i}
              className="stack"
              style={{
                padding: '16px 0',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <strong>
                {entry.preset ? t.assistant.presets[entry.preset] : entry.question}
              </strong>
              <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {engineText(entry.answer.text)}
              </p>
              {!!entry.answer.sourceIds.length && (
                <details>
                  <summary>
                    {t.assistant.sources(entry.answer.sourceIds.length)}
                  </summary>
                  <p className="mono" style={{ overflowWrap: 'anywhere' }}>
                    {entry.answer.sourceIds.join(' · ')}
                  </p>
                </details>
              )}
            </article>
          ))}
        </div>
        <form
          className="actions"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(question);
          }}
        >
          <Input
            aria-label={t.assistant.inputLabel}
            placeholder={t.assistant.placeholder}
            maxLength={500}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            style={{ flex: '1 1 220px' }}
          />
          <Button type="submit" disabled={busy || !question.trim()}>
            {busy ? t.assistant.thinking : t.assistant.ask}
          </Button>
          {!!history.length && (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => setHistory([])}
            >
              {t.assistant.clear}
            </Button>
          )}
        </form>
      </CollapsibleContent>
    </Collapsible>
  );
}
