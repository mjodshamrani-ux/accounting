import { readFile as fsRead } from 'node:fs/promises';
import { readFile } from '../lib/reconciliation/io.ts';
import {
  BANK_VERSION,
  BANK_WD_FAMILY,
  BANK_ROLES,
  type BankInput,
} from '../lib/reconciliation/bank.ts';

export const wdRoot = new URL(
  '../audit/bank-withdrawal-deposit/',
  import.meta.url,
);
export type WDFacts = {
  id: string;
  scope: BankInput['scope'];
  families: ('wd' | 'canonical')[];
  perspective?: string;
  files: string[];
  canonicalControls?: string[];
  expected: {
    status: string;
    issue?: string;
    signedMinor?: number[][];
    netMinor?: number[];
    groups?: Record<string, string>;
    timingInvalid?: boolean;
  };
};
export async function wdFixture(
  name = '01-bank-wd-cash-canonical',
  supplemental = false,
) {
  const folder = new URL(
    `${supplemental ? 'supplemental' : 'frozen'}/${name}/`,
    wdRoot,
  );
  const facts: WDFacts = JSON.parse(
    await fsRead(new URL('facts.json', folder), 'utf8'),
  );
  const files = await Promise.all(
    facts.files.map(async (name) =>
      readFile(
        name,
        new Uint8Array(await fsRead(new URL(name, folder))).buffer,
      ),
    ),
  );
  const input: BankInput = {
    files: files as BankInput['files'],
    readings: BANK_ROLES.map((role, side) => ({
      role,
      sheet: 0,
      family: facts.families[side] === 'wd' ? BANK_WD_FAMILY : BANK_VERSION,
      perspective: facts.perspective ?? 'company-cash',
      confirmed: true,
    })) as BankInput['readings'],
    scope: facts.scope,
    events: [],
  };
  return { input, facts, folder };
}
export async function wdRows(
  input: BankInput,
  side: 0 | 1,
  edit: (rows: string[][]) => void,
) {
  const rows = structuredClone(input.files[side].sheets[0].rows);
  edit(rows);
  input.files[side] = await readFile(
    `edited-${side}.csv`,
    new TextEncoder().encode(rows.map((r) => r.join(',')).join('\n') + '\n')
      .buffer,
  );
}
