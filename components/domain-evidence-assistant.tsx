import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useI18n } from '@/lib/i18n/context';
import {
  domainEvidenceCopy,
  type EvidenceQuestion,
} from '@/lib/i18n/domain-evidence';
import {
  askDomainEvidence,
  askVerifiedSpecializedEvidence,
  isSpecializedEvidenceSnapshot,
  type SpecializedEvidenceSnapshot,
  type DomainEvidenceSnapshot,
  type DomainEvidenceAnswer,
} from '@/lib/reconciliation/domain-assistant';
import { money } from '@/lib/reconciliation/core';

export function DomainEvidenceAssistant({
  result,
  snapshot,
  busy,
  replay,
}: {
  result: DomainEvidenceSnapshot['result'];
  snapshot: () => DomainEvidenceSnapshot;
  busy: boolean;
  replay?: (
    snapshot: SpecializedEvidenceSnapshot,
  ) => Promise<SpecializedEvidenceSnapshot>;
}) {
  const { lang } = useI18n();
  const t = domainEvidenceCopy(lang);
  const [answer, setAnswer] = useState<DomainEvidenceAnswer | null>(null);
  const [question, setQuestion] = useState('');
  const [previous, setPrevious] = useState(result);
  const [checking, setChecking] = useState(false);
  const request = useRef(0);
  const currentResult = useRef(result);
  useLayoutEffect(() => {
    currentResult.current = result;
    request.current++;
  }, [result]);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  if (previous !== result) {
    setChecking(false);
    setPrevious(result);
    setAnswer(null);
    setQuestion('');
  }
  async function ask(q: string) {
    if (busy || checking) return;
    const id = ++request.current;
    const displayed = result;
    setAnswer(null);
    setChecking(true);
    let next: DomainEvidenceAnswer;
    try {
      const captured = snapshot();
      next = isSpecializedEvidenceSnapshot(captured)
        ? await askVerifiedSpecializedEvidence(
            captured,
            q,
            replay ??
              (async () => {
                throw Error('REPLAY_REQUIRED');
              }),
          )
        : askDomainEvidence(captured, q);
    } catch {
      next = {
        kind: 'stale',
        facts: [],
        sources: [],
        currency: '',
        decimals: 0,
      };
    }
    if (id === request.current && currentResult.current === displayed) {
      setAnswer(next);
      setChecking(false);
    }
  }
  return (
    <section
      className="surface pad stack"
      data-domain-evidence-assistant
      aria-busy={checking}
    >
      <h3>{t.title}</h3>
      <p className="muted">{t.intro}</p>
      <div className="actions">
        {(['status', 'amounts', 'sources', 'next'] as EvidenceQuestion[]).map(
          (k) => (
            <Button
              key={k}
              variant="outline"
              disabled={busy || checking}
              data-evidence-question={k}
              onClick={() => void ask(t.questions[k])}
            >
              {t.questions[k]}
            </Button>
          ),
        )}
      </div>
      <form
        className="actions"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
      >
        <Input
          aria-label={t.question}
          value={question}
          maxLength={2000}
          disabled={busy || checking}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <Button type="submit" disabled={busy || checking || !question.trim()}>
          {t.ask}
        </Button>
      </form>
      {checking && <output>{t.checking}</output>}
      {answer && (
        <div
          aria-live="polite"
          data-evidence-answer={answer.kind}
          className="stack"
        >
          {answer.kind === 'stale' || answer.kind === 'unsupported' ? (
            <p>{t[answer.kind]}</p>
          ) : (
            <>
              <h4>{t.questions[answer.kind]}</h4>
              {answer.kind === 'next' && <p>{t.next}</p>}
              {answer.individualAmounts && <p>{t.individual}</p>}
              {!!answer.facts.length && (
                <dl>
                  {answer.facts.map((f, i) => (
                    <div key={i} className="stack" style={{ marginBlock: 8 }}>
                      <dt>
                        {f.subject ? `${t.labels[f.subject]} · ` : ''}
                        {t.labels[f.label]}
                      </dt>
                      <dd
                        style={{
                          marginInlineStart: 0,
                          overflowWrap: 'anywhere',
                        }}
                        data-evidence-fact={f.label}
                      >
                        {f.value === null
                          ? t.null
                          : f.money && typeof f.value === 'number'
                            ? `${money(f.value, answer.decimals)} ${answer.currency}`
                            : typeof f.value === 'boolean'
                              ? f.value
                                ? t.yes
                                : t.no
                              : ['status', 'financial', 'review'].includes(
                                    f.label,
                                  )
                                ? t.status(String(f.value))
                                : f.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              <p className="muted">
                {answer.context ? t.verifiedLimit : t.limit}
              </p>
              {answer.context && (
                <details>
                  <summary>{t.context}</summary>
                  <p
                    className="mono"
                    data-evidence-context
                    style={{ overflowWrap: 'anywhere' }}
                  >
                    {answer.context}
                  </p>
                </details>
              )}
              <details open={answer.kind === 'sources'}>
                <summary>{t.questions.sources}</summary>
                {answer.sources.map((s, i) => (
                  <dl key={i} style={{ overflowWrap: 'anywhere' }}>
                    <dt>{t.file}</dt>
                    <dd>{s.name}</dd>
                    <dt>{t.sheet}</dt>
                    <dd>{s.sheet}</dd>
                    <dt>{t.hash}</dt>
                    <dd className="mono" data-evidence-hash>
                      {s.hash}
                    </dd>
                  </dl>
                ))}
              </details>
            </>
          )}
        </div>
      )}
    </section>
  );
}
