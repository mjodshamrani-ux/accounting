import { readFile as fsRead } from 'node:fs/promises';
import { readIntercompanyFile } from '../../lib/reconciliation/intercompany-source.ts';
import {
  IC_VERSION,
  IC_ROLES,
  reconcileIntercompany,
  type IntercompanyInput,
  type IntercompanyEntry,
  type IntercompanyEvent,
} from '../../lib/reconciliation/intercompany.ts';
type EntryTruth = Omit<IntercompanyEntry, 'source' | 'id'>;
export type IntercompanyTruth = {
  name: string;
  scope: Omit<IntercompanyInput['scope'], 'confirmed'>;
  complete: boolean;
  status: string;
  reject: string | null;
  actions: string[];
  files: { file: string; sha256: string }[];
  originalTables: { headers: string[]; rows: string[][] }[];
  financialFacts: null | {
    decimals: number;
    entries: EntryTruth[][];
    totals: { debit: number; credit: number; net: number }[];
    groups: {
      id: string;
      relationRow: number;
      left: EntryTruth | null;
      right: EntryTruth | null;
      residual: number | null;
      review: string;
      timing: {
        id: string;
        side: string;
        transactionId: string;
        counterpartyTransactionId: string;
        date: string;
        amount: number;
        row: number;
      }[];
    }[];
  };
};
export const intercompanyTruth = JSON.parse(
  await fsRead(new URL('./frozen/expected.json', import.meta.url), 'utf8'),
) as { cases: IntercompanyTruth[] };
export async function intercompanyFixture(
  name: string,
): Promise<IntercompanyInput> {
  const c = intercompanyTruth.cases.find((c) => c.name === name);
  if (!c) throw Error('Unknown frozen case');
  const files = await Promise.all(
    c.files.map(async (f) => {
      const bytes = await fsRead(
        new URL(`./frozen/${f.file}`, import.meta.url),
      );
      const file = await readIntercompanyFile(
        f.file,
        Uint8Array.from(bytes).buffer,
      );
      if (file.sha256 !== f.sha256)
        throw Error('Original frozen bytes changed');
      return file;
    }),
  );
  return {
    files: files as IntercompanyInput['files'],
    readings: IC_ROLES.map((role) => ({
      sheet: 0,
      role,
      family: IC_VERSION,
      confirmed: true,
    })) as IntercompanyInput['readings'],
    scope: { ...c.scope, confirmed: true },
    completeness: {
      confirmed: c.complete,
      reference: c.complete ? 'Independent supplied inventory attestation' : '',
      note: c.complete
        ? 'All supplied reciprocal transactions and relationships reviewed; synthetic fixture'
        : '',
    },
    events: [],
  };
}
export async function finishedIntercompany(name: string) {
  const c = intercompanyTruth.cases.find((c) => c.name === name)!;
  const state = await intercompanyFixture(name);
  let result = reconcileIntercompany(state);
  function decision(type: IntercompanyEvent['type'], relationId: string) {
    const proof = c.originalTables[2],
      row = proof.rows.find(
        (r) => r[proof.headers.indexOf('Relation ID')] === relationId,
      );
    if (!row) throw Error('Unknown original relation');
    const members: string[] = [];
    for (let source = 0; source < 2; source++) {
      const table = c.originalTables[source],
        id =
          row[
            proof.headers.indexOf(
              source === 0 ? 'Left transaction ID' : 'Right transaction ID',
            )
          ];
      table.rows.forEach((r, index) => {
        if (r[table.headers.indexOf('Transaction ID')] === id)
          members.push(
            JSON.stringify([
              IC_VERSION,
              source,
              state.files[source].sha256,
              0,
              index + 2,
            ]),
          );
      });
    }
    const event: IntercompanyEvent = {
      id: `E-${state.events.length + 1}`,
      type,
      relationId,
      memberIds: members,
      context: result.context,
      at: `2026-10-06T00:00:00.${String(state.events.length).padStart(3, '0')}Z`,
      reference: 'Frozen independent reciprocal relationship review',
      note: 'Whole original counterpart pair and scope checked; synthetic fixture',
    };
    state.events = [...state.events, event];
    result = reconcileIntercompany(state);
  }
  for (const action of c.actions) {
    const [type, target] = action.split(':');
    if (target === 'all') {
      const table = c.originalTables[2];
      for (const row of table.rows)
        if (row.some(Boolean))
          decision(
            type as IntercompanyEvent['type'],
            row[table.headers.indexOf('Relation ID')],
          );
    } else decision(type as IntercompanyEvent['type'], target);
  }
  return { state, result };
}
