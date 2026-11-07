import { Fragment, type ReactNode } from 'react';
import { recordTableCopy } from '@/lib/i18n/record-table';
import { resultIndexCopy } from '@/lib/i18n/result-index';
import type { ResultAnchor } from '@/components/result-index';
import { useI18n } from '@/lib/i18n/context';

/**
 * One section of the evidence at the foot of a result: its name as its
 * title shows it, how many records it holds, and the section as the
 * workspace draws it. The key names what the section lists, the same in
 * both languages.
 */
export type EvidenceSection = {
  key: string;
  name: string;
  count: number;
  node: ReactNode;
};

/**
 * The evidence sections of a result (UX-4). A section with something in it
 * is drawn as the workspace draws it, in its place, with its count. A
 * section with nothing in it is not drawn on its own with a count of none:
 * the empty ones are named together on one quiet line after the others.
 * That a section is empty is news (no missing evidence, no source error),
 * so it is said once, in words.
 */
export function EvidenceSections({
  sections,
  anchor,
  level = 3,
}: {
  sections: readonly EvidenceSection[];
  /** The level of that heading, under the sections around it. */
  level?: 2 | 3;
  /** With the result index (UX-4): the part begins with its own heading,
   * where the index takes the reader. */
  anchor?: ResultAnchor;
}) {
  const { lang } = useI18n();
  const copy = recordTableCopy[lang];
  const empty = sections.filter((s) => s.count === 0);
  const names = empty.map((s, i) => (
    <Fragment key={s.key}>
      {i > 0 && ' · '}
      <span className="record-empty__name" data-empty-section={s.key}>
        {s.name}
      </span>
    </Fragment>
  ));
  return (
    <>
      {anchor &&
        (level === 2 ? (
          <h2 className="evidence-sections__title" {...anchor}>
            {resultIndexCopy[lang].parts.evidence}
          </h2>
        ) : (
          <h3 className="evidence-sections__title" {...anchor}>
            {resultIndexCopy[lang].parts.evidence}
          </h3>
        ))}
      {sections
        .filter((s) => s.count > 0)
        .map((s) => (
          <Fragment key={s.key}>{s.node}</Fragment>
        ))}
      {empty.length > 0 && (
        <p className="record-empty" data-empty-sections="">
          {empty.length === 1 ? (
            <>
              {names}: {copy.nothing}
            </>
          ) : (
            <>
              {copy.nothingIn}: {names}
            </>
          )}
        </p>
      )}
    </>
  );
}
