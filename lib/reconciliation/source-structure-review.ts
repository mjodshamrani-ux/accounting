import { readFile } from './io.ts';
import { prepareVerifiedSources } from './source-preparation.ts';
import {
  invoiceGroupSourcesFromVerifiedReading,
  searchInvoiceGroups,
} from './invoice-group-search.ts';
import type { InvoiceGroupSearchResult } from './invoice-group-search.ts';
import { inspectSectionContinuation } from './section-continuation.ts';
import type { SectionContinuationReview } from './section-continuation.ts';
import type { Mapping, Scope, SourceFile, SourceResult } from './types.ts';

export type SourceStructureReviewInput = {
  files: [SourceFile | null, SourceFile | null];
  mappings: [Mapping, Mapping];
  scope: Scope;
  extractionRevision: string;
};
export type SourceStructureReviewResult = {
  groups: InvoiceGroupSearchResult | null;
  groupError: string | null;
  sections: {
    side: 'supplier' | 'ledger';
    review: SectionContinuationReview | null;
    error: string | null;
    applicable: boolean;
  }[];
};
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
/** Fresh original replay; edited cached cells or hashes are never positive evidence. */
export async function inspectSourceStructure(
  input: SourceStructureReviewInput,
): Promise<SourceStructureReviewResult> {
  const snapshot = structuredClone(input);
  const output: SourceStructureReviewResult = {
    groups: null,
    groupError: null,
    sections: [],
  };
  const fresh: SourceFile[] = [];
  try {
    for (const file of snapshot.files) {
      if (
        !file?.original ||
        !/\.(csv|xlsx|pdf)$/i.test(file.name) ||
        file.kind ||
        file.visual
      )
        throw new Error('Original CSV, XLSX or native PDF bytes are required.');
      const replay = await readFile(
        file.name,
        file.original,
        file.pdf?.cuts,
        !!file.pdf?.autoColumns,
      );
      if (
        replay.sha256 !== file.sha256 ||
        JSON.stringify(replay.sheets) !== JSON.stringify(file.sheets) ||
        JSON.stringify(replay.pdf) !== JSON.stringify(file.pdf)
      )
        throw new Error(
          'Source bytes, hash or extraction changed. Reread the original source.',
        );
      fresh.push(replay);
    }
    const prepared = prepareVerifiedSources(
      fresh,
      snapshot.mappings,
      snapshot.scope,
      ['supplier', 'ledger'],
    );
    output.groups = searchInvoiceGroups({
      sources: invoiceGroupSourcesFromVerifiedReading(
        fresh as [SourceFile, SourceFile],
        prepared.mappings as [Mapping, Mapping],
        prepared.sources as [SourceResult, SourceResult],
        snapshot.scope,
      ),
      scope: snapshot.scope,
    });
  } catch (error) {
    output.groupError = message(error);
  }
  for (const [i, file] of snapshot.files.entries()) {
    const section: SourceStructureReviewResult['sections'][number] = {
      side: i === 0 ? 'supplier' : 'ledger',
      review: null,
      error: null,
      applicable: !!file?.pdf,
    };
    if (section.applicable && file) {
      try {
        section.review = await inspectSectionContinuation(
          file,
          snapshot.mappings[i],
          snapshot.extractionRevision,
          snapshot.scope.decimals,
        );
      } catch (error) {
        section.error = message(error);
      }
    }
    output.sections.push(section);
  }
  return output;
}
/** Cancellation invalidates publication. Parser promises own their snapshots;
 * no cancelled work can publish into a newer source/revision. */
export class SourceStructureReviewController {
  private generation = 0;
  result: SourceStructureReviewResult | null = null;
  busy = false;
  private readonly inspect: typeof inspectSourceStructure;
  constructor(inspect = inspectSourceStructure) {
    this.inspect = inspect;
  }
  clear() {
    this.generation++;
    this.result = null;
    this.busy = false;
  }
  async run(input: SourceStructureReviewInput) {
    const owned = structuredClone(input);
    const ticket = ++this.generation;
    this.result = null;
    this.busy = true;
    try {
      const result = await this.inspect(owned);
      if (ticket !== this.generation) return false;
      this.result = result;
      return true;
    } catch (error) {
      if (ticket !== this.generation) return false;
      this.result = { groups: null, groupError: message(error), sections: [] };
      return true;
    } finally {
      if (ticket === this.generation) this.busy = false;
    }
  }
}
