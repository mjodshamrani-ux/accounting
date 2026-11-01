import type { Ref } from 'react';
import { useI18n } from '@/lib/i18n/context';
import { sectionResultCopy } from '@/lib/i18n/section-result';

/** The heading of a review section's result (UX-3). It names the section,
 * stands over a result or a refusal, and takes the focus after the section's
 * own run, as a workspace's result heading does (UX-2); a decision inside the
 * result does not move it. */
export function SectionResultHeading({
  title,
  heading,
}: {
  title: string;
  heading: Ref<HTMLHeadingElement>;
}) {
  const { lang } = useI18n();
  return (
    <h3 ref={heading} tabIndex={-1} data-result-heading="section">
      {sectionResultCopy[lang].heading(title)}
    </h3>
  );
}
