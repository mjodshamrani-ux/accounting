// UX-6: one mutant for each guard the reconciliation sheet adds, as the
// design record declares them (docs/audits/UX-6-RECONCILIATION-SHEET.ar.md,
// section 7), GL/TB in 6(a), the case workspaces in 6(b), and the trial balance and financial position and intercompany in 6(c). Each mutant changes one product file at one anchor in a private
// copy of the tree; it is killed only when a test fails by an assertion
// (DEV-22), never by a syntax error, a crash or a timeout.
//
//   node scripts/test-reconciliation-sheet-mutations.mjs
//
// CI runs the catalogue in shards, as it runs the accounting gate:
// RECONCILIATION_SHEET_MUTATION_SHARD=i/N takes every Nth mutant by its
// place in the list, from the i-th, so across the N shards each mutant runs
// once; without it every mutant runs.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  completedSuccessfully,
  createPrivateTree,
  isAssertionKill,
  removePrivateTree,
} from './mutation-runner-support.mjs';

const root = resolve(import.meta.dirname, '..'),
  output = resolve(
    process.env.RECONCILIATION_SHEET_MUTATION_DIR ??
      'work/reconciliation-sheet-mutations',
  );
await mkdir(output, { recursive: true });

const mutations = [
  // The sheet takes an evidence sheet's part instead of a new one.
  [
    'takes-evidence-part',
    'lib/reconciliation/reconciliation-sheet.ts',
    'const part = `sheet${Math.max(',
    'const part = `sheet${0 * Math.max(',
  ],
  // The sheet is added last, not first.
  [
    'sheet-not-first',
    'lib/reconciliation/reconciliation-sheet.ts',
    "'<sheets>',\n        `<sheets><sheet name=",
    "'</sheets>',\n        `</sheets><sheet name=",
  ],
  // A style is put before the evidence's instead of after them.
  [
    'styles-before-evidence',
    'lib/reconciliation/reconciliation-sheet.ts',
    '    styles.slice(list.at + list.open.length, list.close) +\n    add.join(\'\') +',
    "    add.join('') +\n    styles.slice(list.at + list.open.length, list.close) +",
  ],
  // A list's count is left as it was after entries are added.
  [
    'style-count-kept',
    'lib/reconciliation/reconciliation-sheet.ts',
    'count="${list.entries + add.length}"',
    'count="${list.entries}"',
  ],
  // A list whose count disagrees with its entries is extended anyway.
  [
    'style-count-unchecked',
    'lib/reconciliation/reconciliation-sheet.ts',
    "if (entries !== Number(count![1])) fail('STYLES');",
    'void entries;',
  ],
  // The selected tab is not refused.
  [
    'tab-selected-allowed',
    'lib/reconciliation/reconciliation-sheet.ts',
    "if (/tabSelected=\"1\"/.test(await read(name))) fail('TAB_SELECTED');",
    'await read(name);',
  ],
  // A name another sheet has is used.
  [
    'name-taken-allowed',
    'lib/reconciliation/reconciliation-sheet.ts',
    "if (taken.some((t) => t.toLowerCase() === name.toLowerCase()))\n    fail('NAME_TAKEN');",
    'void taken;',
  ],
  // A name longer than Excel allows is used.
  [
    'name-length-allowed',
    'lib/reconciliation/reconciliation-sheet.ts',
    'name.length > 31 ||',
    'name.length > 310 ||',
  ],
  // A name tied to a sheet's position is left pointing at the sheet before.
  [
    'local-sheet-kept',
    'lib/reconciliation/reconciliation-sheet.ts',
    '`localSheetId="${Number(n) + 1}"`',
    '`localSheetId="${Number(n)}"`',
  ],
  // The cells are not checked before anything is built from them.
  [
    'cells-unchecked',
    'lib/reconciliation/reconciliation-sheet.ts',
    '  checkCells(sheet);\n',
    '',
  ],
  // A text is not checked as every exported text is.
  [
    'text-unchecked',
    'lib/reconciliation/reconciliation-sheet.ts',
    "        validateExportText(cell.text, 'RECONCILIATION_SHEET_TEXT');",
    '        void cell.text;',
  ],
  // A number reads right to left in an Arabic sheet («50.00-»).
  [
    'number-right-to-left',
    'lib/reconciliation/reconciliation-sheet.ts',
    "readingOrder=\"1\"/>`;",
    "readingOrder=\"${rtl ? 2 : 1}\"/>`;",
  ],
  // An empty section is written with its heading.
  [
    'empty-section-written',
    'lib/reconciliation/reconciliation-sheet.ts',
    "    if (section.kind === 'pairs') {\n      if (!section.rows.length) continue;",
    "    if (section.kind === 'pairs') {",
  ],
  // The gap is written with its sign turned.
  [
    'gap-sign-flipped',
    'lib/reconciliation/reconciliation-sheet.ts',
    'minor: cell.value.minor,',
    'minor: -cell.value.minor,',
  ],
  // A source's fingerprint is the other source's.
  [
    'source-swapped',
    'lib/reconciliation/gl-tb-sheet.ts',
    'hash: s.hash,',
    'hash: result.sources[1 - side].hash,',
  ],
  // A missing balance is written as zero.
  [
    'missing-as-zero',
    'lib/reconciliation/gl-tb-sheet.ts',
    "    minor === null || minor === undefined\n      ? { text: t.missing, style: 'value' }\n      : { minor, decimals: result.decimals };",
    '    ({ minor: minor ?? 0, decimals: result.decimals });',
  ],
  // The scope's fixed values are written as the engine's codes.
  [
    'scope-code-written',
    'lib/reconciliation/gl-tb-sheet.ts',
    "    return key === 'currencyBasis' && value === 'functional'",
    "    return key === 'currencyBasis' && value === 'not-functional'",
  ],
  // The sheet is written in English whatever the language asked.
  [
    'language-not-followed',
    'lib/reconciliation/gl-tb-sheet.ts',
    'glTbSheet(result, language));',
    "glTbSheet(result, 'en'));",
  ],
  // Any language is taken as English.
  [
    'language-unchecked',
    'lib/reconciliation/reconciliation-sheet.ts',
    "  if (value === 'ar' || value === 'en') return value;\n  throw new Error('RECONCILIATION_SHEET_LANGUAGE');",
    "  return value === 'ar' ? 'ar' : 'en';",
  ],
  // The worker ignores the language the page sends.
  [
    'worker-language-ignored',
    'lib/reconciliation/worker.ts',
    'exportGlTbWorkpaper(\n        payload.state,\n        payload.result,\n        payload.lang,',
    "exportGlTbWorkpaper(\n        payload.state,\n        payload.result,\n        'ar',",
  ],
  // UX-6(b), clearing. The worker ignores the language for clearing.
  [
    'clearing-worker-language-ignored',
    'lib/reconciliation/worker.ts',
    'exportClearingWorkpaper(\n        payload.state,\n        payload.result,\n        payload.lang,',
    "exportClearingWorkpaper(\n        payload.state,\n        payload.result,\n        'ar',",
  ],
  // The clearing sheet is written in English whatever the language asked.
  [
    'clearing-language-not-followed',
    'lib/reconciliation/clearing-sheet.ts',
    'clearingSheet(state, result, language),',
    "clearingSheet(state, result, 'en'),",
  ],
  // A decision is written without the reason the reviewer gave.
  [
    'decision-reason-dropped',
    'lib/reconciliation/clearing-sheet.ts',
    "{ text: event.note, style: 'value' },",
    "{ text: t.note, style: 'value' },",
  ],
  // A reopen is said as a clear.
  [
    'decision-action-swapped',
    'lib/reconciliation/clearing-sheet.ts',
    "event.action === 'clear' ? 'human-decision' : 'reopened',",
    "event.action === 'clear' ? 'human-decision' : 'human-decision',",
  ],
  // Members are written as the engine's row ids, not the postings.
  [
    'members-as-ids',
    'lib/reconciliation/clearing-sheet.ts',
    'ids.map((id) => posting.get(id) ?? id)',
    'ids.map((id) => id)',
  ],
  // Every group is listed for review, cleared ones too.
  [
    'cleared-listed-for-review',
    'lib/reconciliation/clearing-sheet.ts',
    "          .filter((c) => c.status === 'review')\n          .map((c) => [",
    "          .filter((c) => c.status !== '')\n          .map((c) => [",
  ],
  // A group with no reference is written with an empty reference.
  [
    'no-reference-unsaid',
    'lib/reconciliation/clearing-sheet.ts',
    '{ text: c.reference || t.missing, style: \'value\' },',
    '{ text: c.reference || t.reference, style: \'value\' },',
  ],
  // A group's reason is written as the engine's code.
  [
    'reason-as-code',
    'lib/reconciliation/clearing-sheet.ts',
    "            { text: reason(c.reason), style: 'value' },",
    "            { text: c.reason, style: 'value' },",
  ],
  // Cleared movements are counted as groups.
  [
    'cleared-counted-as-groups',
    'lib/reconciliation/clearing-sheet.ts',
    '.reduce((n, c) => n + c.ids.length, 0),',
    '.reduce((n) => n + 1, 0),',
  ],
  // Reading errors are not counted.
  [
    'errors-uncounted',
    'lib/reconciliation/clearing-sheet.ts',
    "count: result.inventory.filter((r) => r.kind === 'error')",
    "count: result.inventory.filter((r) => r.kind === 'none')",
  ],
  // A text longer than its room is not wrapped.
  [
    'wrap-dropped',
    'lib/reconciliation/reconciliation-sheet.ts',
    '      wrapped.add(`${r}:${c}`);',
    '      void r;',
  ],
  // A wrapped text's row is not given its height.
  [
    'row-height-dropped',
    'lib/reconciliation/reconciliation-sheet.ts',
    "`<row r=\"${r + 1}\"${height ? ` ht=\"${height}\" customHeight=\"1\"` : ''}>",
    "`<row r=\"${r + 1}\"${height ? '' : ''}>",
  ],
  // A wrapped text's row is given one line's height.
  [
    'row-one-line',
    'lib/reconciliation/reconciliation-sheet.ts',
    'lineCount(cell.text, capacity) * LINE[cell.style] + 2,',
    'LINE[cell.style] + 2,',
  ],
  // A text's room runs on past a cell that holds a value.
  [
    'room-past-value',
    'lib/reconciliation/reconciliation-sheet.ts',
    "        (!cells[next] ||\n          ('text' in cells[next]! && !(cells[next] as { text: string }).text));",
    '        true;',
  ],
  // UX-6(b), receivables. The worker ignores the language for AR.
  [
    'ar-worker-language-ignored',
    'lib/reconciliation/worker.ts',
    'exportArWorkpaper(\n        payload.state,\n        payload.result,\n        payload.lang,',
    "exportArWorkpaper(\n        payload.state,\n        payload.result,\n        'ar',",
  ],
  // The AR binding lets any language through to the worker.
  [
    'ar-binding-language-unchecked',
    'lib/reconciliation/ar-worker-binding.ts',
    "(payload.lang !== 'ar' && payload.lang !== 'en')",
    'false',
  ],
  // The page checks the worker's reply against the evidence alone.
  [
    'ar-binding-expects-evidence-only',
    'lib/reconciliation/ar-worker-binding.ts',
    'const expected = await sheet.exportArWorkpaper(\n      payload.state as ArInput,\n      payload.result as ArResult,\n      payload.lang,\n    );',
    'void sheet;\n    const expected = await io.exportAr(\n      payload.state as ArInput,\n      payload.result as ArResult,\n    );',
  ],
  // The AR sheet is written in English whatever the language asked.
  [
    'ar-language-not-followed',
    'lib/reconciliation/ar-sheet.ts',
    'arSheet(state, result, language)',
    "arSheet(state, result, 'en')",
  ],
  // A decision is written without the reason the reviewer gave.
  [
    'ar-decision-reason-dropped',
    'lib/reconciliation/ar-sheet.ts',
    '            value(event.note),',
    '            value(t.note),',
  ],
  // A reopen is said as a confirmation.
  [
    'ar-decision-action-swapped',
    'lib/reconciliation/ar-sheet.ts',
    "event.action === 'accept' ? 'human-confirmation' : 'reopened',",
    "event.action === 'accept' ? 'human-confirmation' : 'human-confirmation',",
  ],
  // A movement is attributed to the other record.
  [
    'ar-member-side-swapped',
    'lib/reconciliation/ar-sheet.ts',
    '                value(t.sides[r.side]),',
    '                value(t.sides[1 - r.side]),',
  ],
  // Matched documents are listed for review too.
  [
    'ar-matched-listed',
    'lib/reconciliation/ar-sheet.ts',
    "const review = result.cases.filter((c) => c.status === 'review');",
    "const review = result.cases.filter((c) => c.status !== '');",
  ],
  // A record without a total is written as zero.
  [
    'ar-missing-total-as-zero',
    'lib/reconciliation/ar-sheet.ts',
    '      ? value(t.unavailableTotal)',
    '      ? { minor: 0, decimals: result.decimals }',
  ],
  // Each record is given the other's total.
  [
    'ar-totals-swapped',
    'lib/reconciliation/ar-sheet.ts',
    '          value: total(minor),',
    '          value: total(result.totals[1 - side]),',
  ],
  // Reading errors are not counted.
  [
    'ar-errors-uncounted',
    'lib/reconciliation/ar-sheet.ts',
    "count: result.inventory.filter((i) => i.kind === 'error').length,",
    "count: result.inventory.filter((i) => i.kind === 'none').length,",
  ],
  // A movement's date is not the one it carries.
  [
    'ar-member-date-dropped',
    'lib/reconciliation/ar-sheet.ts',
    '                value(r.date),',
    '                value(result.scope.start),',
  ],
  // The source is named by its fingerprint's file but given another hash.
  [
    'clearing-source-hash',
    'lib/reconciliation/clearing-sheet.ts',
    'hash: result.sourceHash',
    'hash: result.context',
  ],
  // UX-6(b), printing. The page is never broken by hand.
  [
    'print-never-broken',
    'lib/reconciliation/reconciliation-sheet.ts',
    'if (tall.reduce((a, b) => a + b, 0) <= ONE_PAGE) return [];',
    'return [];',
  ],
  // A break one row below a group's first row, inside it.
  [
    'print-break-inside',
    'lib/reconciliation/reconciliation-sheet.ts',
    'breaks.push(r);',
    'breaks.push(r + 1);',
  ],
  // A group taller than a page is sent to a page of its own.
  [
    'print-tall-group-alone',
    'lib/reconciliation/reconciliation-sheet.ts',
    'if (used + group > PAGE && group <= PAGE) {',
    'if (used + group > PAGE) {',
  ],
  // The planner forgets what the page already holds.
  [
    'print-page-not-counted',
    'lib/reconciliation/reconciliation-sheet.ts',
    'used = used + height > PAGE ? height : used + height;',
    'used = 0;',
  ],
  // The groups are not handed to the writer.
  [
    'print-groups-dropped',
    'lib/reconciliation/reconciliation-sheet.ts',
    'return { name: w.name, language, widths: WIDTHS, rows, keep };',
    'return { name: w.name, language, widths: WIDTHS, rows };',
  ],
  // The sign-off is not kept whole.
  [
    'print-sign-off-split',
    'lib/reconciliation/reconciliation-sheet.ts',
    "          { line: true },\n        ]);\n      whole();",
    "          { line: true },\n        ]);",
  ],
  // An AR document is not kept with its movements.
  [
    'print-ar-document-split',
    'lib/reconciliation/ar-sheet.ts',
    '        blocks: review.map((c) => 1 + c.ids.length),\n',
    '',
  ],
  // UX-6(b), bank movements. The worker ignores the language for bank.
  [
    'bank-worker-language-ignored',
    'lib/reconciliation/worker.ts',
    'exportBankWorkpaper(\n        payload.state,\n        payload.result,\n        payload.lang,',
    "exportBankWorkpaper(\n        payload.state,\n        payload.result,\n        'ar',",
  ],
  // The bank sheet is written in English whatever the language asked.
  [
    'bank-language-not-followed',
    'lib/reconciliation/bank-movements-sheet.ts',
    'bankMovementsSheet(state, result, language)',
    "bankMovementsSheet(state, result, 'en')",
  ],
  // Matched cases are listed for review too.
  [
    'bank-matched-listed',
    'lib/reconciliation/bank-movements-sheet.ts',
    "(c) => c.status === 'needs-review' || c.status === 'source-error',",
    "(c) => c.status !== '',",
  ],
  // A case a source error holds is not listed as waiting.
  [
    'bank-source-error-not-listed',
    'lib/reconciliation/bank-movements-sheet.ts',
    "(c) => c.status === 'needs-review' || c.status === 'source-error',",
    "(c) => c.status === 'needs-review',",
  ],
  // The bank side's total stands where the difference does.
  [
    'bank-difference-of-bank',
    'lib/reconciliation/bank-movements-sheet.ts',
    '{ minor: c.deltaMinor, decimals: result.decimals }',
    '{ minor: c.bankMinor, decimals: result.decimals }',
  ],
  // A member's amount without its sign.
  [
    'bank-member-unsigned',
    'lib/reconciliation/bank-movements-sheet.ts',
    '{ minor: r.signed, decimals: result.decimals }',
    '{ minor: r.amount, decimals: result.decimals }',
  ],
  // A case without a settlement identity is given its internal key.
  [
    'bank-identity-for-every-kind',
    'lib/reconciliation/bank-movements-sheet.ts',
    "c.kind === 'reference' ? value(c.key) : null",
    'value(c.key)',
  ],
  // A case's members out of the order the evidence lists them.
  [
    'bank-members-out-of-order',
    'lib/reconciliation/bank-movements-sheet.ts',
    '...c.cashIds.map(member),',
    '...c.cashIds.map(member).reverse(),',
  ],
  // A decision without the reason the reviewer gave.
  [
    'bank-decision-reason-dropped',
    'lib/reconciliation/bank-movements-sheet.ts',
    '          value(event.note),\n',
    '          null,\n',
  ],
  // An undo said as the approval.
  [
    'bank-undo-said-as-accept',
    'lib/reconciliation/bank-movements-sheet.ts',
    "event.type === 'accept' ? 'human-review' : 'undone'",
    "'human-review'",
  ],
  // A word of the sheet that is not the screen's.
  [
    'bank-word-off-screen',
    'lib/i18n/reconciliation-sheet.ts',
    "difference: 'Bank minus cashbook',",
    "difference: 'Bank less cashbook',",
  ],
  // UX-6(b), payment allocation. The worker ignores the language.
  [
    'allocation-worker-language-ignored',
    'lib/reconciliation/worker.ts',
    'exportAllocationWorkpaper(\n        payload.state,\n        payload.result,\n        payload.lang,',
    "exportAllocationWorkpaper(\n        payload.state,\n        payload.result,\n        'ar',",
  ],
  // The sheet is written in English whatever the language asked.
  [
    'allocation-language-not-followed',
    'lib/reconciliation/allocation-sheet.ts',
    'allocationSheet(result, language)',
    "allocationSheet(result, 'en')",
  ],
  // The strip says the result ready even when a source error holds it.
  [
    'allocation-state-not-followed',
    'lib/reconciliation/allocation-sheet.ts',
    "state: result.status === 'ready' ? t.ready : t.sourceError,",
    'state: t.ready,',
  ],
  // An item's original amount stands where what is available does.
  [
    'allocation-original-for-available',
    'lib/reconciliation/allocation-sheet.ts',
    'money(b.available),\n          money(b.allocated),',
    'money(b.original),\n          money(b.allocated),',
  ],
  // What is available stands where what remains does.
  [
    'allocation-available-for-remaining',
    'lib/reconciliation/allocation-sheet.ts',
    'money(b.remaining),',
    'money(b.available),',
  ],
  // Each side's ledger lists the other side's items.
  [
    'allocation-ledger-sides-swapped',
    'lib/reconciliation/allocation-sheet.ts',
    '.filter((i) => i.side === side)',
    '.filter((i) => i.side !== side && i.side !== 2)',
  ],
  // The allocations an undo took back are listed as active.
  [
    'allocation-undone-listed',
    'lib/reconciliation/allocation-sheet.ts',
    'blocks: result.links.map(() => 3),\n        rows: result.links.flatMap((l) => [',
    "blocks: result.events\n          .flatMap((e) => (e.type === 'allocate' ? e.links : []))\n          .map(() => 3),\n        rows: result.events\n          .flatMap((e) => (e.type === 'allocate' ? e.links : []))\n          .flatMap((l) => [",
  ],
  // An allocation without the reason its basis gives.
  [
    'allocation-link-reason-dropped',
    'lib/reconciliation/allocation-sheet.ts',
    'value(l.basis.reason),',
    'null,',
  ],
  // An allocation's basis named by its proof line, not its reference.
  [
    'allocation-link-reference-of-proof',
    'lib/reconciliation/allocation-sheet.ts',
    'value(l.basis.reference),',
    'value(l.basis.proofId),',
  ],
  // The invoice an allocation joins named as its payment.
  [
    'allocation-invoice-as-payment',
    'lib/reconciliation/allocation-sheet.ts',
    'value(item.get(l.invoiceId)!.reference),',
    'value(item.get(l.paymentId)!.reference),',
  ],
  // A decision without the reason given.
  [
    'allocation-decision-reason-dropped',
    'lib/reconciliation/allocation-sheet.ts',
    '            value(e.note),\n',
    '            null,\n',
  ],
  // An undo without the decision it undoes.
  [
    'allocation-undo-target-dropped',
    'lib/reconciliation/allocation-sheet.ts',
    "e.type === 'undo' ? value(`→ ${e.target}`) : null,",
    'null,',
  ],
  // An undo said as an allocation.
  [
    'allocation-undo-said-as-allocate',
    'lib/reconciliation/allocation-sheet.ts',
    '[value(t.eventTypes[e.type]), value(e.id), value(e.at)],',
    '[value(t.eventTypes.allocate), value(e.id), value(e.at)],',
  ],
  // A word of the sheet that is not the screen's.
  [
    'allocation-word-off-screen',
    'lib/i18n/reconciliation-sheet.ts',
    "activeAllocations: 'Active allocations',",
    "activeAllocations: 'Allocations in force',",
  ],
  // UX-6(b), suppliers. The worker ignores the language.
  [
    'supplier-worker-language-ignored',
    'lib/reconciliation/worker.ts',
    'const lang = sheetLanguage(payload.lang);',
    "const lang = sheetLanguage('ar');",
  ],
  // The sheet is written in English whatever the language asked.
  [
    'supplier-language-not-followed',
    'lib/reconciliation/supplier-sheet.ts',
    'supplierSheet(result, files, review, language),',
    "supplierSheet(result, files, review, 'en'),",
  ],
  // A field the evidence leaves empty is written, empty.
  [
    'supplier-empty-scope-written',
    'lib/reconciliation/supplier-sheet.ts',
    ').filter(([, text]) => text);',
    ').filter(() => true);',
  ],
  // A source with no original file is written with no word for it.
  [
    'supplier-no-original-unsaid',
    'lib/reconciliation/supplier-sheet.ts',
    'hash: files[side].sha256 ?? t.noOriginal,',
    "hash: files[side].sha256 ?? '',",
  ],
  // The balances are written only where the engine computed a bridge.
  [
    'supplier-balances-only-with-bridge',
    'lib/reconciliation/supplier-sheet.ts',
    'result.scope.coverageConfirmed || bridge',
    'bridge',
  ],
  // The balance check never says the coverage is confirmed.
  [
    'supplier-balance-check-unconfirmed',
    'lib/reconciliation/supplier-sheet.ts',
    '? b.consistentConfirmed',
    '? b.consistentUnconfirmed',
  ],
  // The residual stands where the adjusted balance does.
  [
    'supplier-residual-for-adjusted',
    'lib/reconciliation/supplier-sheet.ts',
    'value: amount(bridge.adjusted, true),',
    'value: amount(bridge.residual, true),',
  ],
  // The review tab's rejected suggestions are left out.
  [
    'supplier-rejected-left-out',
    'lib/reconciliation/supplier-sheet.ts',
    "(c) => c.status === 'Needs Review' || c.status === 'Rejected',",
    "(c) => c.status === 'Needs Review',",
  ],
  // A rejected suggestion said as a case that needs review.
  [
    'supplier-rejected-said-as-review',
    'lib/reconciliation/supplier-sheet.ts',
    "? 'rejected'",
    "? 'needsReview'",
  ],
  // A member's amount without its sign.
  [
    'supplier-member-unsigned',
    'lib/reconciliation/supplier-sheet.ts',
    'value(t.sideShort[tx.side]),\n              amount(tx.amount),',
    'value(t.sideShort[tx.side]),\n              amount(Math.abs(tx.amount)),',
  ],
  // A member named by its normalized reference, not the one it reads.
  [
    'supplier-reference-normalized',
    'lib/reconciliation/supplier-sheet.ts',
    'tx.reference || t.noReference',
    'tx.normalizedReference || t.noReference',
  ],
  // An unmatched ledger case written with the supplier side's total.
  [
    'supplier-unmatched-supplier-total',
    'lib/reconciliation/supplier-sheet.ts',
    'amount(c.supplierMembers.length ? c.supplierTotal : c.ledgerTotal),',
    'amount(c.supplierTotal),',
  ],
  // Every decision said as a manual link.
  [
    'supplier-decision-said-as-link',
    'lib/reconciliation/supplier-sheet.ts',
    'value(decided[event.action]),',
    'value(decided.link),',
  ],
  // A decision with only its first member.
  [
    'supplier-decision-first-member',
    'lib/reconciliation/supplier-sheet.ts',
    '                    event.ids\n',
    '                    event.ids.slice(0, 1)\n',
  ],
  // A decision without the reason given.
  [
    'supplier-decision-reason-dropped',
    'lib/reconciliation/supplier-sheet.ts',
    '                  value(event.note),\n',
    '                  null,\n',
  ],
  // A partial snapshot claimed as a verified one.
  [
    'supplier-partial-claimed-verified',
    'lib/reconciliation/supplier-sheet.ts',
    'text: reading.partial ? t.claim.partial : t.claim.verified,',
    'text: t.claim.verified,',
  ],
  // A word of the sheet that is not the screen's, and one not the evidence's.
  [
    'supplier-word-off-screen',
    'lib/i18n/reconciliation-sheet.ts',
    "reviewedStillOpen: 'Reviewed, still unmatched',",
    "reviewedStillOpen: 'Reviewed, not matched',",
  ],
  [
    'supplier-word-off-evidence',
    'lib/i18n/reconciliation-sheet.ts',
    "noOriginal: 'No original file',",
    "noOriginal: 'No original source',",
  ],
  // UX-6(c), trial balance and financial position. The worker writes the
  // sheet in Arabic whatever the page asked.
  [
    'financial-worker-language-ignored',
    'lib/reconciliation/worker.ts',
    "        payload.result,\n        payload.lang,\n      );\n    else if (action === 'gl-tb-reconcile')",
    "        payload.result,\n        'ar',\n      );\n    else if (action === 'gl-tb-reconcile')",
  ],
  // The sheet is written in English whatever the language asked.
  [
    'financial-language-not-followed',
    'lib/reconciliation/financial-sheet.ts',
    'financialSheet(result, language));',
    "financialSheet(result, 'en'));",
  ],
  // A one-option scope field written as the engine's code.
  [
    'financial-scope-code-written',
    'lib/reconciliation/financial-sheet.ts',
    '? t.only[key as keyof typeof ONLY]\n      : v;',
    '? v\n      : v;',
  ],
  // Each source under another's role.
  [
    'financial-sources-swapped',
    'lib/reconciliation/financial-sheet.ts',
    'role: t.roles[i],',
    'role: t.roles[3 - i],',
  ],
  // The attestation written though it was never given.
  [
    'financial-attestation-unconfirmed-written',
    'lib/reconciliation/financial-sheet.ts',
    'rows: result.completeness.confirmed\n',
    'rows: result.completeness\n',
  ],
  // The attestation's reference written where its reason stands.
  [
    'financial-attestation-reason-dropped',
    'lib/reconciliation/financial-sheet.ts',
    'value: value(result.completeness.note),',
    'value: value(result.completeness.reference),',
  ],
  // The residual written where the trial balance's credit stands.
  [
    'financial-residual-for-credit',
    'lib/reconciliation/financial-sheet.ts',
    '[result.tb.debit, result.tb.credit, result.tb.residual]',
    '[result.tb.debit, result.tb.residual, result.tb.residual]',
  ],
  // The calculated and reported figures of the position swapped.
  [
    'financial-bases-swapped',
    'lib/reconciliation/financial-sheet.ts',
    'money(position.calculated[key]),\n        money(position.reported[key]),',
    'money(position.reported[key]),\n        money(position.calculated[key]),',
  ],
  // The position equation left out.
  [
    'financial-equation-dropped',
    'lib/reconciliation/financial-sheet.ts',
    "['equation', t.positionEquation],",
    '',
  ],
  // The position by basis left to break between its figures.
  [
    'financial-position-split',
    'lib/reconciliation/financial-sheet.ts',
    '...(figures.length ? { blocks: [figures.length] } : {}),',
    '',
  ],
  // Each line given the result's state instead of its own.
  [
    'financial-line-state-of-result',
    'lib/reconciliation/financial-sheet.ts',
    'value(t.status[l.review]),',
    'value(t.status[result.status]),',
  ],
  // A line's class written as the engine's code.
  [
    'financial-line-class-as-code',
    'lib/reconciliation/financial-sheet.ts',
    'value(t.categories[l.category]),',
    'value(l.category),',
  ],
  // A difference the engine does not compute written as nil.
  [
    'financial-missing-difference-as-zero',
    'lib/reconciliation/financial-sheet.ts',
    "minor === null ? value('—') : money(minor);",
    'money(minor ?? 0);',
  ],
  // The reported figure written where the difference stands.
  [
    'financial-difference-of-reported',
    'lib/reconciliation/financial-sheet.ts',
    'difference(l.difference),',
    'difference(l.reported),',
  ],
  // A decision written without the reason the reviewer gave.
  [
    'financial-decision-reason-dropped',
    'lib/reconciliation/financial-sheet.ts',
    '[null, value(e.reference), value(e.note)],',
    '[null, value(e.reference), null],',
  ],
  // Every decision said as an acceptance.
  [
    'financial-decision-said-as-accept',
    'lib/reconciliation/financial-sheet.ts',
    'value(t.decisionLabels[e.type])',
    'value(t.decisionLabels.accept)',
  ],
  // A decision named by its own number instead of its line's.
  [
    'financial-decision-line-dropped',
    'lib/reconciliation/financial-sheet.ts',
    'value(e.lineId), value(e.at)]',
    'value(e.id), value(e.at)]',
  ],
  // The strip says the result's state as the engine's code.
  [
    'financial-strip-state-as-code',
    'lib/reconciliation/financial-sheet.ts',
    'state: t.status[result.status],',
    'state: result.status,',
  ],
  // A word of the sheet that is not the screen's, and a claim that is not
  // the evidence's.
  [
    'financial-word-off-screen',
    'lib/i18n/reconciliation-sheet.ts',
    "positionEquation: 'Position equation',",
    "positionEquation: 'Equation',",
  ],
  [
    'financial-claim-off-evidence',
    'lib/i18n/reconciliation-sheet.ts',
    "'Consistency with supplied confirmed presentation evidence only;",
    "'Consistency with supplied presentation evidence only;",
  ],
  // The result's state left out from under the strip in the bank and the
  // financial position sheets, whose headings write it; and the bank's said
  // as the engine's code.
  [
    'bank-state-dropped',
    'lib/reconciliation/bank-movements-sheet.ts',
    'more: [\n          {\n            label: alignmentStripCopy[language].state,\n            value: t.status[result.status],\n          },\n        ],',
    'more: [],',
  ],
  [
    'bank-state-as-code',
    'lib/reconciliation/bank-movements-sheet.ts',
    'value: t.status[result.status],',
    'value: result.status,',
  ],
  [
    'financial-state-dropped',
    'lib/reconciliation/financial-sheet.ts',
    'more: [\n          {\n            label: alignmentStripCopy[language].state,\n            value: t.status[result.status],\n          },\n        ],',
    'more: [],',
  ],
  // UX-6(c), intercompany. The worker writes the sheet in Arabic whatever
  // the page asked.
  [
    'intercompany-worker-language-ignored',
    'lib/reconciliation/worker.ts',
    'exportIntercompanyWorkpaper(payload.state, payload.result, payload.lang)',
    "exportIntercompanyWorkpaper(payload.state, payload.result, 'ar')",
  ],
  // The sheet is written in English whatever the language asked.
  [
    'intercompany-language-not-followed',
    'lib/reconciliation/intercompany-sheet.ts',
    'intercompanySheet(result, language));',
    "intercompanySheet(result, 'en'));",
  ],
  // A one-option scope field written as the engine's code.
  [
    'intercompany-scope-code-written',
    'lib/reconciliation/intercompany-sheet.ts',
    '? t.only[key as keyof typeof ONLY]\n      : v;',
    '? v\n      : v;',
  ],
  // Each source under another's role.
  [
    'intercompany-sources-swapped',
    'lib/reconciliation/intercompany-sheet.ts',
    'role: t.roles[i],',
    'role: t.roles[3 - i],',
  ],
  // The attestation written though it was never given.
  [
    'intercompany-attestation-unconfirmed-written',
    'lib/reconciliation/intercompany-sheet.ts',
    'rows: result.completeness.confirmed\n',
    'rows: result.completeness\n',
  ],
  // The attestation's reference written where its explanation stands.
  [
    'intercompany-attestation-note-dropped',
    'lib/reconciliation/intercompany-sheet.ts',
    'value: value(result.completeness.note),',
    'value: value(result.completeness.reference),',
  ],
  // Each side's totals under the other side's name.
  [
    'intercompany-sides-swapped',
    'lib/reconciliation/intercompany-sheet.ts',
    "{ text: t.roles[i], style: 'label' },",
    "{ text: t.roles[1 - i], style: 'label' },",
  ],
  // A side's net written where its credit stands.
  [
    'intercompany-net-for-credit',
    'lib/reconciliation/intercompany-sheet.ts',
    'money(s.credit),',
    'money(s.net),',
  ],
  // The totals by side left to break between the two sides.
  [
    'intercompany-totals-split',
    'lib/reconciliation/intercompany-sheet.ts',
    '...(sides.length ? { blocks: [sides.length] } : {}),',
    '',
  ],
  // A pair printed apart from its figures.
  [
    'intercompany-pair-split',
    'lib/reconciliation/intercompany-sheet.ts',
    'blocks: result.pairs.map(() => 4),',
    'blocks: result.pairs.flatMap(() => [1, 3]),',
  ],
  // Each pair given the result's state instead of its own.
  [
    'intercompany-pair-state-of-result',
    'lib/reconciliation/intercompany-sheet.ts',
    'value(status(p.status)),',
    'value(status(result.status)),',
  ],
  // A pair's review written as the engine's code.
  [
    'intercompany-pair-review-as-code',
    'lib/reconciliation/intercompany-sheet.ts',
    'value(status(p.review)),',
    'value(p.review),',
  ],
  // A figure the engine does not compute written as nil.
  [
    'intercompany-missing-figure-as-zero',
    'lib/reconciliation/intercompany-sheet.ts',
    "minor === null || minor === undefined ? value('—') : money(minor);",
    'money(minor ?? 0);',
  ],
  // The left net written where the right net stands, and where the residual
  // stands.
  [
    'intercompany-right-net-of-left',
    'lib/reconciliation/intercompany-sheet.ts',
    'figure(p.right?.net)]',
    'figure(p.left?.net)]',
  ],
  [
    'intercompany-residual-of-left',
    'lib/reconciliation/intercompany-sheet.ts',
    'figure(p.residual)]',
    'figure(p.left?.net)]',
  ],
  // The result's state left out from under the strip.
  [
    'intercompany-state-dropped',
    'lib/reconciliation/intercompany-sheet.ts',
    'more: [\n          {\n            label: alignmentStripCopy[language].state,\n            value: status(result.status),\n          },\n        ],',
    'more: [],',
  ],
  // The strip's main reason as the engine's code.
  [
    'intercompany-strip-reason-as-code',
    'lib/reconciliation/intercompany-sheet.ts',
    '{ reason: status, state: status(result.status) },',
    '{ state: status(result.status) },',
  ],
  // A decision written without the explanation the reviewer gave.
  [
    'intercompany-decision-reason-dropped',
    'lib/reconciliation/intercompany-sheet.ts',
    '[null, value(e.reference), value(e.note)],',
    '[null, value(e.reference), null],',
  ],
  // Every decision said as an approval.
  [
    'intercompany-decision-said-as-accept',
    'lib/reconciliation/intercompany-sheet.ts',
    'value(t[e.type])',
    'value(t.accept)',
  ],
  // A decision named by its own number instead of its pair's.
  [
    'intercompany-decision-pair-dropped',
    'lib/reconciliation/intercompany-sheet.ts',
    'value(e.relationId), value(e.at)]',
    'value(e.id), value(e.at)]',
  ],
  // A word of the sheet that is not the screen's, and a claim that is not
  // the evidence's.
  [
    'intercompany-word-off-screen',
    'lib/i18n/reconciliation-sheet.ts',
    "pairs: 'Counterpart pairs',",
    "pairs: 'Pairs',",
  ],
  [
    'intercompany-claim-off-evidence',
    'lib/i18n/reconciliation-sheet.ts',
    "'Consistency of supplied reciprocal ledger transactions with confirmed relationship evidence only;",
    "'Consistency of supplied reciprocal ledger transactions only;",
  ],
];

assert.equal(
  new Set(mutations.map(([name]) => name)).size,
  mutations.length,
  'every mutant has its own name',
);
const shardValue = process.env.RECONCILIATION_SHEET_MUTATION_SHARD;
let shard;
if (shardValue !== undefined) {
  const match = /^([1-9]\d*)\/([1-9]\d*)$/.exec(shardValue);
  assert.ok(
    match,
    'RECONCILIATION_SHEET_MUTATION_SHARD must be a one-based index/count',
  );
  shard = { index: Number(match[1]), count: Number(match[2]) };
  assert.ok(
    shard.index <= shard.count && shard.count <= mutations.length,
    'RECONCILIATION_SHEET_MUTATION_SHARD requires 1 <= index <= count <= mutants',
  );
}
const selected = mutations.filter(
  (_, i) => !shard || i % shard.count === shard.index - 1,
);

const sha = (s) => createHash('sha256').update(s).digest('hex'),
  temp = await createPrivateTree();
try {
  for (const name of ['lib', 'tests', 'audit', 'package.json'])
    await cp(join(root, name), join(temp, name), { recursive: true });
  await symlink(join(root, 'node_modules'), join(temp, 'node_modules'), 'dir');
  const run = () =>
    spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        '--test',
        '--test-reporter=tap',
        'tests/reconciliation-sheet.test.ts',
        'tests/alignment-strip-view.test.ts',
      ],
      // Room for a failing test's whole report: a byte-for-byte comparison
      // prints every byte, and output past the buffer would end the run as
      // an error rather than as the assertion that killed the mutant.
      {
        cwd: temp,
        encoding: 'utf8',
        timeout: 180000,
        maxBuffer: 256 * 1024 * 1024,
      },
    );
  const baseline = run();
  await writeFile(join(output, 'baseline.log'), baseline.stdout + baseline.stderr);
  assert.ok(completedSuccessfully(baseline), 'baseline');
  const results = [];
  for (const [name, target, find, replacement] of selected) {
    const file = join(temp, target),
      source = await readFile(file, 'utf8');
    assert.equal(source.split(find).length, 2, `${name}: unique anchor`);
    const changed = source.replace(find, () => replacement);
    await writeFile(file, changed);
    const syntax = spawnSync(
      process.execPath,
      ['--experimental-strip-types', '--check', file],
      { encoding: 'utf8' },
    );
    assert.ok(completedSuccessfully(syntax), `${name}: syntax`);
    const actual = run();
    await writeFile(join(output, `${name}.log`), actual.stdout + actual.stderr);
    const detected = isAssertionKill(actual);
    await writeFile(file, source);
    assert.equal(await readFile(file, 'utf8'), source, `${name}: restored`);
    results.push({
      name,
      file: target,
      detected,
      status: actual.status,
      signal: actual.signal,
      mutantSha256: sha(changed),
    });
    console.log(name, detected ? 'ASSERTION_KILL' : 'SURVIVED');
  }
  await writeFile(
    join(output, 'RESULTS.json'),
    JSON.stringify(
      {
        baselinePassed: true,
        available: mutations.length,
        ...(shard ? { shard } : {}),
        mutations: results,
        passed: results.every((r) => r.detected),
      },
      null,
      2,
    ) + '\n',
  );
  const survivors = results.filter((r) => !r.detected).map((r) => r.name);
  assert.deepEqual(survivors, [], 'every mutant is killed by an assertion');
  console.log(
    `${results.length}/${selected.length} mutants killed by an assertion` +
      (shard ? ` (shard ${shard.index}/${shard.count} of ${mutations.length})` : ''),
  );
} finally {
  await removePrivateTree(temp);
}
