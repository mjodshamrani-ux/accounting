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

export function AccountingAssistant({
  result,
  selectedId,
}: {
  result: Comparison;
  selectedId?: string;
}) {
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
  const [history, setHistory] = useState<
    { question: string; answer: EvidenceAnswer }[]
  >([]);
  const [snapshot, setSnapshot] = useState(result);
  // Clear previous explanations synchronously when a reviewed decision changes the result.
  if (snapshot !== result) {
    setSnapshot(result);
    setHistory([]);
  }
  const ask = async (q: string, id?: string) => {
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
          { question: q, answer: enhanced ?? local },
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
        مساعد فهم النتيجة
      </CollapsibleTrigger>
      <CollapsibleContent className="stack" aria-label="شرح نتيجة التسوية">
        <div>
          <h2>اسأل عن النتيجة</h2>
          <p className="muted">
            يشرح المساعد النتيجة من أرقام المحرك وأدلته، ولا يغيّر المطابقات أو
            يرسل بياناتك. إذا لم يفهم صياغة السؤال، يمكنه الاستعانة بنموذج على
            جهازك إذا كان جاهزًا ويدعم لغة السؤال. لا ينزّل نموذجًا ولا يتصل بخدمة
            خارجية.
          </p>
        </div>
        <div className="actions">
          {[
            'لماذا يوجد فرق في الأرصدة؟',
            'ما الذي لم يتم التأكد منه؟',
            'ماذا أراجع الآن؟',
          ].map((q) => (
            <Button
              key={q}
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void ask(q)}
            >
              {q}
            </Button>
          ))}
          {selectedId && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void ask('اشرح هذه الحركة', selectedId)}
            >
              اشرح هذه الحركة
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
              <strong>{entry.question}</strong>
              <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {entry.answer.text}
              </p>
              {!!entry.answer.sourceIds.length && (
                <details>
                  <summary>
                    معرّفات الصفوف التي استند إليها الشرح (
                    {entry.answer.sourceIds.length})
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
            aria-label="سؤالك عن التسوية"
            placeholder="اكتب سؤالك عن الفرق أو مرجع الفاتورة"
            maxLength={500}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            style={{ flex: '1 1 220px' }}
          />
          <Button type="submit" disabled={busy || !question.trim()}>
            {busy ? 'نجهّز الإجابة على جهازك' : 'اسأل'}
          </Button>
          {!!history.length && (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => setHistory([])}
            >
              مسح المحادثة
            </Button>
          )}
        </form>
      </CollapsibleContent>
    </Collapsible>
  );
}
