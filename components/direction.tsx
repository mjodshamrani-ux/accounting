import {
  ArrowDownLeft,
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  type LucideProps,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';

// Arrows that mean "next" or "back" follow the reading direction: forward
// points left in Arabic and right in English. Icons that point at something
// on screen are not direction-dependent and are used as they are.
export function ForwardArrow(props: LucideProps) {
  const { dir } = useI18n();
  const Icon = dir === 'rtl' ? ArrowLeft : ArrowRight;
  return <Icon {...props} />;
}

export function BackArrow(props: LucideProps) {
  const { dir } = useI18n();
  const Icon = dir === 'rtl' ? ArrowRight : ArrowLeft;
  return <Icon {...props} />;
}

/** "Further down this page", continuing in the reading direction. */
export function ForwardDownArrow(props: LucideProps) {
  const { dir } = useI18n();
  const Icon = dir === 'rtl' ? ArrowDownLeft : ArrowDownRight;
  return <Icon {...props} />;
}
