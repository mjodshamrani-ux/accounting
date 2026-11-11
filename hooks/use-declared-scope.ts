'use client';

import { useMemo, useState } from 'react';
import {
  applyDeclaredScope,
  originsOf,
  suggestDeclaredScope,
  type DeclaredScopeRule,
  type DeclaredScopeSource,
  type ScopeOrigin,
} from '@/lib/reconciliation/declared-scope';
import type { SourceFile } from '@/lib/reconciliation/types';

type Columns<K extends string> = readonly { field: K; header: string }[];
/** Per source, the columns its family names for fields whose values it
 *  writes under another header (an intercompany ledger's "Entity"), and
 *  `null` for a field the source does not write (a receivables column the
 *  accountant left unmapped). */
type SourceHeaders<K extends string> = readonly (
  | Readonly<Partial<Record<K, string | null>>>
  | undefined
)[];
/** Per source, the scope its family writes once, in a block of its own, as
 *  its reader takes it (a structured or printed inventory register). */
type SourceBlocks<K extends string> = readonly (
  | Readonly<Partial<Record<K, string>>>
  | null
  | undefined
)[];
type Scope<K extends string> = Record<K, string> & { confirmed: boolean };

/** What the files say about the scope, from the sheet each source reads,
 *  each source named by its role in the screen's language. */
export function suggestFrom<K extends string>(
  sources: readonly (SourceFile | null)[],
  sheets: readonly number[],
  labels: readonly string[],
  columns: Columns<K>,
  headers?: SourceHeaders<K>,
  blocks?: SourceBlocks<K>,
) {
  return suggestDeclaredScope(
    sources.flatMap((file, side): DeclaredScopeSource[] => {
      const block = blocks?.[side];
      if (block) return [{ label: labels[side], sheet: sheets[side], block }];
      return file
        ? [
            {
              label: labels[side],
              file,
              sheet: sheets[side],
              headers: headers?.[side],
            },
          ]
        : [];
    }),
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
  headers,
  blocks,
}: {
  initial: () => { scope: S; origins: Record<K, ScopeOrigin> };
  rules: readonly DeclaredScopeRule<K>[];
  columns: Columns<K>;
  files: readonly (SourceFile | null)[];
  sheets: readonly number[];
  labels: readonly string[];
  /** Per source, the columns its family names for some fields. */
  headers?: SourceHeaders<K>;
  /** Per source, the scope block its family writes once, if any. */
  blocks?: SourceBlocks<K>;
}) {
  const [draft, setDraft] = useState(initial);
  const sheetKey = sheets.join(',');
  const suggestions = useMemo(
    () =>
      suggestFrom(
        files,
        sheetKey.split(',').map(Number),
        labels,
        columns,
        headers,
        blocks,
      ),
    [files, sheetKey, labels, columns, headers, blocks],
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
      /** The installed sources' own scope blocks, where they have them;
       *  those of the sources on screen until now do not apply. */
      sourceBlocks?: SourceBlocks<K>,
      /** The installed sources' own columns, where the workspace names
       *  them per reading (a receivables mapping); otherwise those above. */
      sourceHeaders?: SourceHeaders<K>,
    ) {
      setDraft({
        scope,
        origins: originsOf(
          scope,
          suggestFrom(
            sources,
            sourceSheets,
            labels,
            columns,
            sourceHeaders ?? headers,
            sourceBlocks,
          ),
          rules.map((r) => r.field),
        ),
      });
    },
    reset() {
      setDraft(initial());
    },
  };
}
