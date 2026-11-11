import type { ReactNode } from 'react';
import {
  Ban,
  Check,
  CircleAlert,
  CircleDot,
  Minus,
  TriangleAlert,
} from 'lucide-react';
import type { StatusTone } from '@/lib/status-tone';

const ICON = {
  agreed: Check,
  suggestion: CircleDot,
  review: CircleAlert,
  difference: TriangleAlert,
  held: Ban,
  neutral: Minus,
} as const;

/** A status as the workspace words it, with its tone in colour and an icon
 * (UX-3): the word carries the meaning, the icon is hidden from assistive
 * technology, and the engine's status stays in `data-status`. */
export function StatusBadge({
  tone,
  status,
  children,
}: {
  tone: StatusTone;
  status: string;
  children: ReactNode;
}) {
  const Icon = ICON[tone];
  return (
    <span className="status-badge" data-tone={tone} data-status={status}>
      <Icon aria-hidden="true" className="status-badge__icon" />
      <span>{children}</span>
    </span>
  );
}
