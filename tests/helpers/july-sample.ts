import { access, readFile as readBytes } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { readFile } from '../../lib/reconciliation/io.ts';
import { compare, normalizeSource } from '../../lib/reconciliation/core.ts';
import { selectImportMapping } from '../../lib/reconciliation/import-selection.ts';
import { suggestFormats } from '../../lib/reconciliation/format-inference.ts';
import { inferScopeSuggestions } from '../../lib/reconciliation/scope-inference.ts';
import { inferStatementDirection } from '../../lib/reconciliation/statement-direction.ts';
import type {
  Mapping,
  Scope,
  SourceFile,
} from '../../lib/reconciliation/types.ts';

// Original files stay outside the repository. CI skips the private sample unless
// it is explicitly supplied; an explicit, incomplete sample directory is an error.
export const sampleDirectory = process.env.MIZAN_SAMPLE_DIR || homedir();
const bases = ['supplier_statement_july_2026', 'company_ap_ledger_july_2026'];
export async function julySampleAvailable(): Promise<boolean> {
  try {
    await Promise.all(
      ['xlsx', 'pdf'].flatMap((extension) =>
        bases.map((base) =>
          access(path.join(sampleDirectory, `${base}.${extension}`)),
        ),
      ),
    );
    return true;
  } catch (error) {
    if (process.env.MIZAN_SAMPLE_DIR) throw error;
    return false;
  }
}

export async function loadJulySample(extension: 'xlsx' | 'pdf') {
  const files = (await Promise.all(
    bases.map(async (base) => {
      const name = `${base}.${extension}`;
      const bytes = await readBytes(path.join(sampleDirectory, name));
      return readFile(
        name,
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ),
        undefined,
        true,
      );
    }),
  )) as [SourceFile, SourceFile];
  const mappings = files.map((file, index) => {
    const mapping = selectImportMapping(
      file,
      index === 0 ? 'supplier' : 'ledger',
    ).mapping;
    Object.assign(mapping, suggestFormats(file, mapping, 2).patch);
    const proof = inferStatementDirection(file, mapping, 2);
    if (proof)
      Object.assign(mapping, {
        multiplier: proof.multiplier,
        directionEvidence: proof,
      });
    else {
      // These original Excel reports have formula running balances. This is the
      // same explicit direction choice the accountant makes in the UI, not an
      // inference from cached formulas or an assumed AP convention.
      mapping.multiplier = index === 0 ? 1 : -1;
    }
    mapping.pdfReviewed = extension === 'pdf';
    return mapping;
  }) as [Mapping, Mapping];
  const inferred = inferScopeSuggestions(files, mappings);
  const scope: Scope = {
    supplier: '',
    entity: '',
    account: '',
    currency: '',
    cutoff: '',
    ...inferred.values,
    decimals: 2,
    dateWindow: 3,
    confirmed: true,
    coverageConfirmed: false,
  };
  const supplier = normalizeSource(files[0], mappings[0], scope, 'supplier');
  const ledger = normalizeSource(files[1], mappings[1], scope, 'ledger');
  return { extension, files, result: compare(supplier, ledger, scope) };
}
