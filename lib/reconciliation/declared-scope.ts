import type { SourceFile } from './types.ts';

/**
 * What the files say about a declared scope (UX-5(d)). A family whose
 * contract writes its scope on every row (entity, ledger, account, currency,
 * period...) lets the screen suggest that scope from those columns alone,
 * with the evidence for each value. The engine still compares every row
 * with the scope the accountant confirms; nothing here confirms anything.
 *
 * The rules, from the accounting review in docs/audits/UX-5-START.ar.md:
 * - a value comes only from the column the family names for the field, read
 *   from the header row its reader uses; never from file or sheet names,
 *   dates of movements, or the engine's result;
 * - it is suggested only when every non-blank row of every source that has
 *   the column holds the same text, trimmed as the reader trims it; a blank
 *   cell is a value of its own, so it is never outvoted or skipped;
 * - otherwise the field stays a question, and each value is shown with the
 *   sources and the number of rows that hold it.
 */

export type DeclaredScopeSource = {
  /** How the screen names the source, by its role. */
  label: string;
  file: SourceFile;
  sheet: number;
};

export type DeclaredScopeValue = {
  value: string;
  sources: { label: string; rows: number }[];
};

export type DeclaredScopeField = {
  field: string;
  header: string;
  /** agreed: one value in every row; differs: more than one; blank: the
   *  column is there and empty in every row; absent: no source has it. */
  status: 'agreed' | 'differs' | 'blank' | 'absent';
  value?: string;
  values: DeclaredScopeValue[];
  /** Rows read, per source that has the column. */
  read: { label: string; rows: number }[];
};

function columnOf(header: string[], name: string) {
  const at = header
    .map((h) => h.trim())
    .flatMap((h, i) => (h === name ? [i] : []));
  // A header written twice is not a column the reader accepts.
  return at.length === 1 ? at[0] : -1;
}

export function suggestDeclaredScope(
  sources: readonly DeclaredScopeSource[],
  fields: readonly { field: string; header: string }[],
): Record<string, DeclaredScopeField> {
  const out: Record<string, DeclaredScopeField> = {};
  for (const { field, header } of fields) {
    const tally = new Map<string, Map<string, number>>();
    const read: { label: string; rows: number }[] = [];
    for (const source of sources) {
      const sheet = source.file.sheets[source.sheet];
      if (!sheet?.rows.length) continue;
      const column = columnOf(sheet.rows[0], header);
      if (column < 0) continue;
      let rows = 0;
      for (const row of sheet.rows.slice(1)) {
        if (!row.some((cell) => cell.trim())) continue;
        rows += 1;
        const value = (row[column] ?? '').trim();
        const bySource = tally.get(value) ?? new Map<string, number>();
        bySource.set(source.label, (bySource.get(source.label) ?? 0) + 1);
        tally.set(value, bySource);
      }
      read.push({ label: source.label, rows });
    }
    const values = [...tally.entries()].map(([value, bySource]) => ({
      value,
      sources: [...bySource.entries()].map(([label, rows]) => ({
        label,
        rows,
      })),
    }));
    const status: DeclaredScopeField['status'] = !read.length
      ? 'absent'
      : values.length === 1
        ? values[0].value
          ? 'agreed'
          : 'blank'
        : values.length === 0
          ? 'blank'
          : 'differs';
    out[field] = {
      field,
      header,
      status,
      ...(status === 'agreed' ? { value: values[0].value } : {}),
      values,
      read,
    };
  }
  return out;
}

/** Where a field's value came from, as the card says it: `handoff` is a
 *  value carried from the comparison the accountant came from, context that
 *  no one confirmed here. */
export type ScopeOrigin = 'file' | 'default' | 'user' | 'question' | 'handoff';

export type DeclaredScopeRule<K extends string> = {
  field: K;
  /** The value the workspace starts with when no file has the column. */
  fallback?: string;
  /** Whether the field's control can hold a value; one it cannot hold
   *  stays a question, shown with what the files say. */
  accepts?: (value: string) => boolean;
  /** A control with one option keeps it while the field is a question. */
  fixed?: boolean;
};

/**
 * Puts what the files agree on into the fields the accountant has not
 * entered (UX-5(d)). A field the accountant entered is never written over;
 * a field the files do not agree on is emptied and becomes a question. It
 * reports whether a value changed, so the workspace can drop the
 * confirmation; it never confirms anything itself.
 */
export function applyDeclaredScope<K extends string>(
  values: Record<K, string>,
  origins: Record<K, ScopeOrigin>,
  suggested: Record<string, DeclaredScopeField>,
  rules: readonly DeclaredScopeRule<K>[],
) {
  const next = { ...values },
    from = { ...origins };
  for (const { field, fallback, accepts, fixed } of rules) {
    // The accountant's entry and a value carried from another comparison
    // are never written over; the card compares the carried value with what
    // the files hold.
    if (origins[field] === 'user' || origins[field] === 'handoff') continue;
    const s = suggested[field];
    if (
      s?.status === 'agreed' &&
      s.value !== undefined &&
      (accepts?.(s.value) ?? true)
    ) {
      next[field] = s.value;
      from[field] = 'file';
    } else if ((!s || s.status === 'absent') && fallback !== undefined) {
      next[field] = fallback;
      from[field] = 'default';
    } else {
      if (!fixed) next[field] = '';
      from[field] = 'question';
    }
  }
  const keys = rules.map((r) => r.field);
  return {
    values: next,
    origins: from,
    valuesChanged: keys.some((k) => next[k] !== values[k]),
    originsChanged: keys.some((k) => from[k] !== origins[k]),
  };
}

/**
 * The origins of a scope the workspace did not type itself (an example or a
 * restored session): a value the files agree on is shown as from the file,
 * any other as the accountant's.
 */
export function originsOf<K extends string>(
  values: Record<K, string>,
  suggested: Record<string, DeclaredScopeField>,
  fields: readonly K[],
) {
  return Object.fromEntries(
    fields.map((k) => [
      k,
      suggested[k]?.status === 'agreed' && suggested[k].value === values[k]
        ? 'file'
        : 'user',
    ]),
  ) as Record<K, ScopeOrigin>;
}
