import { Fragment, type ReactNode } from 'react';
import { recordTableCopy } from '@/lib/i18n/record-table';
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
}: {
  sections: readonly EvidenceSection[];
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
