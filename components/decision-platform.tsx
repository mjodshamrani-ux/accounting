import { useEffect, useState, type ReactNode } from 'react';
import { Button } from './ui/button';
import { useI18n } from '@/lib/i18n/context';
import { decisionPlatformCopy } from '@/lib/i18n/decision-platform';
import {
  decisionHint,
  decisionOpen,
  NOTE_MINIMUM,
  noteReady,
  type DecisionInput,
  type DecisionReview,
  type DecisionType,
} from '@/lib/decision-platform';

/** After a decision, the pressed button is closed while the request runs, so
 * the focus would fall to the page. The platform takes it to what the
 * decision changed: the line that holds the state, or, for a decision on one
 * of many items, that item's heading. The workspace calls the returned
 * function with that element's id where it applies the reply, so a late
 * reply never moves the focus; a run, an example or a restored session goes
 * to the result heading instead (UX-2). */
export function useDecisionFocus() {
  const [target, setTarget] = useState<{ id: string } | null>(null);
  useEffect(() => {
    if (!target) return;
    const element = document.getElementById(target.id);
    element?.scrollIntoView({ block: 'nearest' });
    element?.focus({ preventScroll: true });
  }, [target]);
  return (id: string) => setTarget({ id });
}

/** The sentence under the decision buttons: which decisions are open and
 * why the others are closed, naming the fields the reader fills. Every
 * decision button and both fields are described by it. */
export function DecisionHint({
  id,
  input,
  labels,
}: {
  id: string;
  input: Omit<DecisionInput, 'review'> & {
    review: DecisionReview | 'each' | 'eachBlocked';
  };
  labels: { reference: string; reason: string };
}) {
  const { lang } = useI18n();
  const copy = decisionPlatformCopy[lang];
  const { key, accept } = decisionHint(input);
  const text =
    key === 'both'
      ? copy.both(labels.reference, labels.reason)
      : key === 'reference'
        ? copy.reference(labels.reference)
        : key === 'reason'
          ? copy.reason(labels.reason)
          : copy[key];
  return (
    <p
      id={id}
      className="decision-hint"
      data-decision-hint={key}
      data-decision-accept={accept ?? undefined}
    >
      {text}
      {accept && ` ${copy.accept[accept]}`}
    </p>
  );
}

/** Approve, reject and undo for one review, each open only as the hint says,
 * and each described by it (and by the item's heading, when it decides one
 * of many items, which `target` names as where the focus returns). */
export function DecisionButtons({
  input,
  labels,
  busy,
  describedBy,
  target,
  onDecide,
}: {
  input: DecisionInput;
  labels: Record<DecisionType, string>;
  busy: boolean;
  describedBy: string;
  target?: string;
  onDecide: (type: DecisionType) => void;
}) {
  const open = decisionOpen(input);
  return (
    <div className="gl-tb-actions">
      {(['accept', 'reject', 'undo'] as const).map((type) => (
        <Button
          key={type}
          variant="outline"
          data-decision-action={type}
          data-decision-target={target}
          aria-describedby={describedBy}
          disabled={busy || !open[type]}
          onClick={() => onDecide(type)}
        >
          {labels[type]}
        </Button>
      ))}
    </div>
  );
}

/** The sentence under the one note that opens the decisions on each of
 * many items (receivables, clearing): how long the note must be, as the
 * engine requires, and once it is, what each item takes (`children`). The
 * note and every decision button are described by it; `wait` marks what a
 * decision outside the items still waits for. */
export function NoteHint({
  id,
  note,
  label,
  wait,
  children,
}: {
  id: string;
  note: string;
  label: string;
  wait?: string;
  children: ReactNode;
}) {
  const { lang } = useI18n();
  const ready = noteReady(note);
  return (
    <p
      id={id}
      className="decision-hint"
      data-decision-hint={ready ? 'each' : 'note'}
      data-decision-wait={ready ? wait : undefined}
    >
      {ready ? children : decisionPlatformCopy[lang].note(label, NOTE_MINIMUM)}
    </p>
  );
}

/** Why a closed button that is not a decision is closed: what the reader
 * does to open it, shown under it while it is closed (UX-3). `step` names
 * the first thing missing where the button waits for several. */
export function ClosedReason({
  id,
  closed,
  waits,
  label,
  step = '',
}: {
  id: string;
  closed: boolean;
  waits: 'ask' | 'check' | 'example' | 'step';
  label: string;
  step?: string;
}) {
  const { lang } = useI18n();
  const copy = decisionPlatformCopy[lang].waits;
  return (
    <p
      id={id}
      className="decision-hint"
      data-closed-reason={waits}
      hidden={!closed}
    >
      {waits === 'step' ? copy.step(label, step) : copy[waits](label)}
    </p>
  );
}
