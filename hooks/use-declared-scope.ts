'use client';

import { useMemo, useState } from 'react';
import {
  applyDeclaredScope,
  originsOf,
  suggestDeclaredScope,
  type DeclaredScopeRule,
  type ScopeOrigin,
} from '@/lib/reconciliation/declared-scope';
import type { SourceFile } from '@/lib/reconciliation/types';

type Columns<K extends string> = readonly { field: K; header: string }[];
type Scope<K extends string> = Record<K, string> & { confirmed: boolean };

/** What the files say about the scope, from the sheet each source reads,
 *  each source named by its role in the screen's language. */
export function suggestFrom<K extends string>(
  sources: readonly (SourceFile | null)[],
  sheets: readonly number[],
  labels: readonly string[],
  columns: Columns<K>,
) {
  return suggestDeclaredScope(
    sources.flatMap((file, side) =>
      file ? [{ label: labels[side], file, sheet: sheets[side] }] : [],
    ),
    columns,
  );
}

/**
 * The scope of the card «ما فهمناه من ملفاتك» (UX-5(d)) and where each value
 * came from, kept as one state so a suggestion always reads the latest of
 * both. When what the files say changes (a file, a sheet), what they agree
 * on goes into the fields the accountant has not entered, while rendering
 * and on the latest state, so an entry typed just before is the
 * accountant's and stays; any value it changes drops the confirmation. A
 * value changes here only after a file or sheet changed, which the
 * workspace has already answered by clearing its result.
 */
export function useDeclaredScope<K extends string, S extends Scope<K>>({
  initial,
  rules,
  columns,
  files,
  sheets,
  labels,
}: {
  initial: () => { scope: S; origins: Record<K, ScopeOrigin> };
  rules: readonly DeclaredScopeRule<K>[];
  columns: Columns<K>;
  files: readonly (SourceFile | null)[];
  sheets: readonly number[];
  labels: readonly string[];
}) {
  const [draft, setDraft] = useState(initial);
  const sheetKey = sheets.join(',');
  const suggestions = useMemo(
    () => suggestFrom(files, sheetKey.split(',').map(Number), labels, columns),
    [files, sheetKey, labels, columns],
  );
  const [applied, setApplied] = useState(suggestions);
  if (applied !== suggestions) {
    setApplied(suggestions);
    setDraft((previous) => {
      const next = applyDeclaredScope(
        previous.scope,
        previous.origins,
        suggestions,
        rules,
      );
      if (!next.valuesChanged && !next.originsChanged) return previous;
      return {
        scope: next.valuesChanged
          ? { ...previous.scope, ...next.values, confirmed: false }
          : previous.scope,
        origins: next.origins,
      };
    });
  }
  return {
    scope: draft.scope,
    origins: draft.origins,
    suggestions,
    /** The accountant's entry: theirs from now on, and unconfirmed. */
    edit(key: K, value: string) {
      setDraft((previous) => ({
        scope: { ...previous.scope, [key]: value, confirmed: false },
        origins: { ...previous.origins, [key]: 'user' },
      }));
    },
    confirm(confirmed: boolean) {
      setDraft((previous) => ({
        ...previous,
        scope: { ...previous.scope, confirmed },
      }));
    },
    /** A scope the workspace did not type (an example, a restored
     *  session): a value the files agree on shows as theirs. */
    install(
      scope: S,
      sources: readonly (SourceFile | null)[],
      sourceSheets: readonly number[],
    ) {
      setDraft({
        scope,
        origins: originsOf(
          scope,
          suggestFrom(sources, sourceSheets, labels, columns),
          rules.map((r) => r.field),
        ),
      });
    },
    reset() {
      setDraft(initial());
    },
  };
}
