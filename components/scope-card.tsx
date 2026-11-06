'use client';

import { Fragment, useId, useState, type ReactNode } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';
import { scopeCardCopy } from '@/lib/i18n/scope-card';
import './scope-card.css';
import type {
  DeclaredScopeField,
  ScopeOrigin,
} from '@/lib/reconciliation/declared-scope';

export type { ScopeOrigin };

export type ScopeCardRow = {
  key: string;
  label: string;
  origin: ScopeOrigin;
  /** The field's value now, to compare a carried value with the files. */
  value: string;
  /** The field takes one value only, so a question cannot be typed away. */
  fixed?: boolean;
  suggestion?: DeclaredScopeField;
  /** The field's own editable control, described by its origin line. */
  control: (describedBy: string) => ReactNode;
};

/** A sentence of copy parts and values; the caller isolates each value. */
export function Sentence({ parts }: { parts: ReactNode[] }) {
  return parts.map((part, i) => <Fragment key={i}>{part}</Fragment>);
}

/**
 * «ما فهمناه من ملفاتك» (UX-5(d)): a sentence saying the scope the files
 * declare, every field with where its value came from, and the workspace's
 * one confirmation. The card suggests and shows; only the accountant's
 * confirmation sets the engine's flags, and the workspace drops it whenever
 * a file, sheet or field changes.
 */
export function ScopeCard({
  summary,
  rows,
  confirm,
  hidden,
}: {
  summary: ReactNode;
  rows: ScopeCardRow[];
  confirm: ReactNode;
  hidden?: boolean;
}) {
  const { lang } = useI18n();
  const t = scopeCardCopy[lang];
  const id = useId();
  // A field asks the accountant when the files leave it open, or when any
  // row holds something other than the value carried from the comparison
  // the accountant came from; the files' values are then listed under it.
  const differs = (row: ScopeCardRow) =>
    !!row.suggestion?.values.some((v) => v.value !== row.value);
  const asks = (row: ScopeCardRow) =>
    row.origin === 'question' || (row.origin === 'handoff' && differs(row));
  // Before the files are loaded every field is unknown; that is not a
  // question yet, and the card is hidden.
  const questions = !hidden && rows.some(asks);
  // The fields open when a question appears and stay open until the
  // accountant folds them: answering the last one must not fold the field
  // being typed in.
  const [open, setOpen] = useState(questions),
    [asked, setAsked] = useState(questions);
  if (questions !== asked) {
    setAsked(questions);
    if (questions) setOpen(true);
  }
  const origin = (row: ScopeCardRow) => {
    const s = row.suggestion;
    if (row.origin === 'file' && s) return t.fromFile(s.header, s.read);
    if (row.origin === 'default') return t.byDefault;
    if (row.origin === 'user') return t.fromYou;
    if (row.origin === 'handoff')
      return differs(row)
        ? t.fromHandoffOther
        : s?.status === 'agreed'
          ? t.fromHandoffSame(s.header, s.read)
          : t.fromHandoff;
    if (row.fixed) return t.onlyShown;
    if (s?.status === 'agreed') return t.unusable(s.value ?? '');
    if (s?.status === 'differs') return t.differs;
    if (s?.status === 'blank') return t.blank;
    return t.absent;
  };
  return (
    <section
      className="workspace-scope scope-card"
      aria-labelledby={`${id}-title`}
      data-scope-card
      hidden={hidden}
    >
      <h2 id={`${id}-title`} className="workspace-group-title">
        <span className="workspace-group-title__icon">
          <SlidersHorizontal aria-hidden="true" />
        </span>
        {t.title}
        <span className="workspace-group-title__rule" aria-hidden="true" />
      </h2>
      <p className="scope-card__summary" data-scope-summary>
        {summary}
      </p>
      <details
        className="scope-card__fields"
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary>{t.fields}</summary>
        <div className="scope-card__grid">
          {rows.map((row) => (
            <div
              key={row.key}
              className="scope-card__field"
              data-scope-field={row.key}
              data-origin={row.origin}
            >
              <label>
                {row.label}
                {row.control(`${id}-${row.key}-origin`)}
              </label>
              <p
                id={`${id}-${row.key}-origin`}
                className={asks(row) ? 'hint warn' : 'hint'}
              >
                {origin(row)}
              </p>
              {asks(row) &&
                row.suggestion &&
                row.suggestion.values.length > 0 && (
                  <ul className="scope-card__values">
                    {row.suggestion.values.flatMap((v) =>
                      v.sources.map((s) => (
                        <li key={`${v.value}|${s.label}`}>
                          <bdi>{t.quote(v.value)}</bdi>{' '}
                          {t.valueIn(s.label, s.rows)}
                        </li>
                      )),
                    )}
                  </ul>
                )}
            </div>
          ))}
        </div>
      </details>
      {confirm}
    </section>
  );
}
