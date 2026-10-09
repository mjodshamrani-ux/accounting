import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useI18n } from '@/lib/i18n/context';
import {
  multilineSourceReviewCopy,
  multilineSourceReviewDemo,
} from '@/lib/i18n/multiline-source-review';
import { MultilineSourceReviewController } from '@/lib/reconciliation/multiline-source-review';
import type {
  Field,
  InvoiceCandidate,
} from '../audit/local-provider/multiline-source-v1/workflow.ts';

const reviewButtonStyle: CSSProperties = {
  whiteSpace: 'normal',
  overflowWrap: 'anywhere',
  maxWidth: '100%',
  minWidth: 0,
  height: 'auto',
  minHeight: 36,
};

function highlightedOriginal(
  text: string,
  proposal: InvoiceCandidate | null,
): ReactNode[] {
  const spans = new Map<
    string,
    { start: number; end: number; kind: 'value' | 'role'; fields: Field[] }
  >();
  for (const selection of proposal?.selections ?? []) {
    for (const kind of ['value', 'role'] as const) {
      const span = selection[kind];
      const key = `${span.startUtf16}:${span.endUtf16}:${kind}`;
      const prior = spans.get(key);
      if (prior) prior.fields.push(selection.field);
      else
        spans.set(key, {
          start: span.startUtf16,
          end: span.endUtf16,
          kind,
          fields: [selection.field],
        });
    }
  }
  const nodes: ReactNode[] = [];
  let offset = 0;
  for (const span of [...spans.values()].sort((a, b) => a.start - b.start)) {
    nodes.push(text.slice(offset, span.start));
    nodes.push(
      <mark
        key={`${span.start}:${span.kind}`}
        data-source-span={span.kind}
        data-source-fields={span.fields.join(' ')}
        data-start-utf16={span.start}
        data-end-utf16={span.end}
        style={{
          background: span.kind === 'value' ? '#fff0b3' : '#d4eef9',
          color: '#172033',
          borderRadius: 3,
        }}
      >
        {text.slice(span.start, span.end)}
      </mark>,
    );
    offset = span.end;
  }
  nodes.push(text.slice(offset));
  return nodes;
}

/** Explicitly isolated source review: no financial-source or approval callback. */
export function MultilineSourceReview() {
  const { lang } = useI18n();
  const t = multilineSourceReviewCopy(lang);
  const controller = useMemo(() => new MultilineSourceReviewController(), []);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(controller.view);
  const [label, setLabel] = useState('');
  const [rationale, setRationale] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const mounted = useRef(true);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.clear();
    };
  }, [controller]);
  const refresh = () => {
    if (mounted.current) setView(controller.view);
  };
  const resetReviewer = () => {
    setLabel('');
    setRationale('');
    setAcknowledged(false);
  };
  async function run(action: Promise<unknown>) {
    refresh();
    await action;
    refresh();
  }
  function clear() {
    controller.clear();
    resetReviewer();
    if (fileInput.current) fileInput.current.value = '';
    refresh();
  }
  async function loadFile(file: File) {
    resetReviewer();
    const ticket = controller.beginSource(file.name);
    refresh();
    if (!/\.txt$/i.test(file.name)) controller.failSource(ticket, 'file-type');
    else if (file.size > 8192 || !file.size)
      controller.failSource(ticket, 'source-bound');
    else {
      try {
        await controller.finishSource(
          ticket,
          new Uint8Array(await file.arrayBuffer()),
        );
      } catch {
        controller.failSource(ticket, 'file-read');
      }
    }
    refresh();
  }
  function reviewerChanged() {
    void run(controller.invalidateReview());
  }
  const canReview =
    !!view.bound &&
    !['reading', 'applying', 'applied'].includes(view.phase) &&
    !!label.trim() &&
    !!rationale.trim();
  function decide(decision: 'accept' | 'reject') {
    controller.recordReview(label, rationale, acknowledged, decision);
    refresh();
  }
  function download() {
    if (!view.applied) return;
    const url = URL.createObjectURL(
      new Blob([view.applied.derived.csv], { type: 'text/csv;charset=utf-8' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = view.applied.derived.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  return (
    <section
      className="surface pad stack"
      data-multiline-source-review
      style={{ minWidth: 0, overflowWrap: 'anywhere' }}
    >
      <Button
        style={reviewButtonStyle}
        variant="outline"
        aria-expanded={open}
        aria-controls="multiline-source-review-panel"
        data-source-review-toggle
        onClick={() => {
          if (open) clear();
          setOpen(!open);
        }}
      >
        {t.toggle}
      </Button>
      {open && (
        <div
          id="multiline-source-review-panel"
          className="stack"
          style={{ minWidth: 0 }}
        >
          <h3>{t.toggle}</h3>
          <p>{t.intro}</p>
          <p className="muted" data-source-review-boundary>
            {t.boundary}
          </p>
          <p className="muted">{t.bounds}</p>
          <label className="field" style={{ minWidth: 0 }}>
            <span>{t.file}</span>
            <input
              ref={fileInput}
              type="file"
              accept=".txt,text/plain"
              aria-label={t.file}
              data-source-review-file
              style={{ width: '100%', minWidth: 0, maxWidth: '100%' }}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void loadFile(file);
              }}
            />
          </label>
          <div className="actions">
            <Button
              style={reviewButtonStyle}
              variant="outline"
              data-source-review-demo
              onClick={() => {
                resetReviewer();
                const ticket = controller.beginSource(
                  `synthetic-invoice-${lang}.txt`,
                  true,
                );
                void run(
                  controller.finishSource(
                    ticket,
                    new TextEncoder().encode(multilineSourceReviewDemo(lang)),
                  ),
                );
              }}
            >
              {t.demo}
            </Button>
            <Button
              style={reviewButtonStyle}
              variant="ghost"
              data-source-review-clear
              onClick={clear}
            >
              {t.clear}
            </Button>
            <Button
              style={reviewButtonStyle}
              variant="outline"
              data-source-review-reread
              disabled={!view.originalSha256}
              onClick={() => {
                resetReviewer();
                void run(controller.reread());
              }}
            >
              {t.reread}
            </Button>
          </div>
          {view.synthetic && <p data-source-review-synthetic>{t.synthetic}</p>}
          <output aria-live="polite" data-source-review-state={view.phase}>
            {t[view.phase]}
          </output>
          {view.reason && (
            <output data-source-review-reason={view.reason}>
              {t.reason(view.reason)}
            </output>
          )}
          {!!view.originalText && (
            <div className="stack">
              <h4>{t.original}</h4>
              <p className="muted">
                <mark style={{ background: '#fff0b3', color: '#172033' }}>
                  {t.value}
                </mark>{' '}
                ·{' '}
                <mark style={{ background: '#d4eef9', color: '#172033' }}>
                  {t.role}
                </mark>
              </p>
              <pre
                dir="auto"
                data-source-review-original
                style={{
                  margin: 0,
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'anywhere',
                  fontSize: 14,
                  lineHeight: 1.9,
                  padding: 12,
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  minWidth: 0,
                }}
              >
                {highlightedOriginal(view.originalText, view.proposal)}
              </pre>
            </div>
          )}
          {view.proposal && (
            <div className="stack">
              <h4>{t.fields}</h4>
              {view.proposal.selections.map((selection) => (
                <div
                  className="stack"
                  key={selection.field}
                  style={{
                    padding: 12,
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    minWidth: 0,
                  }}
                  data-source-review-field={selection.field}
                >
                  <label
                    style={{ display: 'flex', gap: 8, alignItems: 'center' }}
                  >
                    <input
                      type="checkbox"
                      aria-label={`${t.include}: ${t.field(selection.field)}`}
                      checked={view.selectedFields.includes(selection.field)}
                      data-source-review-include={selection.field}
                      onChange={(event) => {
                        setAcknowledged(false);
                        void run(
                          controller.select(
                            event.target.checked
                              ? [...view.selectedFields, selection.field]
                              : view.selectedFields.filter(
                                  (field) => field !== selection.field,
                                ),
                          ),
                        );
                      }}
                    />
                    <strong>{t.field(selection.field)}</strong>
                  </label>
                  <div style={{ overflowWrap: 'anywhere' }}>
                    <span>{t.value}: </span>
                    <bdi data-source-review-literal={selection.field}>
                      {selection.value.literal}
                    </bdi>
                  </div>
                  <div style={{ overflowWrap: 'anywhere' }}>
                    <span>{t.role}: </span>
                    <bdi>{selection.role.literal}</bdi>
                  </div>
                  <small className="muted">
                    {t.spans}:{' '}
                    <bdi>
                      {selection.value.startUtf16}–{selection.value.endUtf16} /{' '}
                      {selection.role.startUtf16}–{selection.role.endUtf16}
                    </bdi>
                  </small>
                </div>
              ))}
              {!view.bound && (
                <p data-source-review-incomplete>{t.incomplete}</p>
              )}
            </div>
          )}
          {view.originalSha256 && (
            <details>
              <summary>{t.evidence}</summary>
              <dl style={{ overflowWrap: 'anywhere' }}>
                <dt>{t.hash}</dt>
                <dd style={{ marginInlineStart: 0 }}>
                  <bdi data-source-review-hash>{view.originalSha256}</bdi>
                </dd>
                <dt>{t.revision}</dt>
                <dd style={{ marginInlineStart: 0 }}>
                  <bdi data-source-review-revision>
                    {view.extractionRevision}
                  </bdi>
                </dd>
              </dl>
            </details>
          )}
          {view.proposal && (
            <div className="stack">
              <p className="muted">{t.editInvalidation}</p>
              <label className="field">
                <span>{t.reviewer}</span>
                <Input
                  aria-label={t.reviewer}
                  data-source-review-reviewer
                  value={label}
                  maxLength={120}
                  onChange={(event) => {
                    setLabel(event.target.value);
                    reviewerChanged();
                  }}
                />
              </label>
              <label className="field">
                <span>{t.rationale}</span>
                <Textarea
                  aria-label={t.rationale}
                  data-source-review-rationale
                  value={rationale}
                  maxLength={1000}
                  onChange={(event) => {
                    setRationale(event.target.value);
                    reviewerChanged();
                  }}
                />
              </label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'start' }}>
                <input
                  type="checkbox"
                  data-source-review-acknowledge
                  checked={acknowledged}
                  onChange={(event) => {
                    setAcknowledged(event.target.checked);
                    reviewerChanged();
                  }}
                />
                <span>{t.acknowledge}</span>
              </label>
              <div className="actions">
                <Button
                  style={reviewButtonStyle}
                  data-source-review-accept
                  disabled={!canReview || !acknowledged}
                  onClick={() => decide('accept')}
                >
                  {t.accept}
                </Button>
                <Button
                  style={reviewButtonStyle}
                  variant="outline"
                  data-source-review-reject
                  disabled={!canReview}
                  onClick={() => decide('reject')}
                >
                  {t.reject}
                </Button>
                <Button
                  style={reviewButtonStyle}
                  data-source-review-apply
                  disabled={view.phase !== 'approved'}
                  onClick={() => void run(controller.apply())}
                >
                  {t.apply}
                </Button>
              </div>
              {view.reviewer && (
                <p
                  data-source-review-recorded-review
                  style={{ overflowWrap: 'anywhere' }}
                >
                  <bdi>{view.reviewer.label}</bdi> · {view.reviewer.rationale}
                </p>
              )}
            </div>
          )}
          {view.applied && (
            <div className="stack" data-source-review-derived>
              <h4>{t.result}</h4>
              <p>
                <bdi>{view.applied.engine.reference}</bdi> ·{' '}
                <bdi>{view.applied.engine.date}</bdi> ·{' '}
                <bdi>{view.applied.engine.originalAmount} SAR</bdi>
              </p>
              <p>
                {t.minor}:{' '}
                <bdi data-source-review-minor>
                  {view.applied.engine.amountMinor}
                </bdi>
              </p>
              <p className="muted">{t.boundary}</p>
              <Button
                style={reviewButtonStyle}
                variant="outline"
                data-source-review-download
                onClick={download}
              >
                {t.download}
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
