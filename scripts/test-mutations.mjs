// Deliberate accounting faults must be caught by assertion failures in the real
// regression suite. Every mutant runs in a disposable copy; source is untouched.
import {
  cp,
  symlink,
  readFile,
  writeFile,
  rm,
  mkdir,
  readdir,
  lstat,
  rmdir,
} from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { completedSuccessfully, isAssertionKill, createPrivateTree, removePrivateTree } from './mutation-runner-support.mjs';

const root = resolve(import.meta.dirname, '..');
const tests = [
  'tests/bank.test.ts',
  'tests/ar.test.ts',
  'tests/gl-tb.test.ts',
  'tests/allocation.test.ts',
  'tests/clearing.test.ts',
  'tests/explanation-evidence.test.ts',
  'tests/unknown-credit-role.test.ts',
  'tests/related-invoice-roles.test.ts',
  'tests/typed-short-documents.test.ts',
  'tests/core.test.ts',
  'tests/pdf-stream-integrity.test.ts',
  'tests/visual-boundary.test.ts',
  'tests/visual-png.test.ts',
  'tests/visual-review.test.ts',
  'tests/visual-region.test.ts',
  'tests/visual-table.test.ts',
  'tests/visual-accounting-source.test.ts',
  'tests/visual-split-source.test.ts',
  'tests/review-effort.test.ts',
  'tests/reliability.test.ts',
  'tests/assistant-adversarial.test.ts',
  'tests/supplier-layouts.test.ts',
  'tests/excel-import-regression.test.ts',
  'tests/import-selection.test.ts',
  'tests/pdf-adversarial.test.ts',
  'tests/ordinary-statements.test.ts',
  'tests/simplicity-safety.test.ts',
  'tests/statement-direction.test.ts',
  'tests/xlsx-namespaces.test.ts',
  'tests/pdf-column-suggestions.test.ts',
  'tests/layout-inference-audit.test.ts',
  'tests/xlsx-diversity-audit.test.ts',
  'tests/pdf-diversity-audit.test.ts',
  'tests/matching-diversity-audit.test.ts',
  'tests/ai-evidence-boundary.test.ts',
  'tests/import-proposals.test.ts',
  'tests/local-ai-context.test.ts',
  'tests/reliability-import-045.test.ts',
  'tests/reliability-core-045.test.ts',
  'tests/reliability-scope-045.test.ts',
  'tests/reliability-groups-046.test.ts',
  'tests/template-session-046.test.ts',
  'tests/input-readiness-046.test.ts',
  'tests/format-choice-provenance-047.test.ts',
  'tests/ambiguity-gate-acceptance-047.test.ts',
  'tests/hard-cases.test.ts',
  'tests/same-source.test.ts',
  'tests/reference-interactions.test.ts',
  'tests/reference-resolution.test.ts',
  'tests/payment-components.test.ts',
  'tests/p2-group-lifecycle.test.ts',
  'tests/unmapped-reference.test.ts',
  'tests/pdf-composite.test.ts',
  'tests/pdf-paint-order.test.ts',
  'tests/pdf-capacity-guards.test.ts',
  'tests/partial-format.test.ts',
  'tests/localized-read-errors.test.ts',
  'tests/partial-result-lifecycle.test.ts',
  'tests/excluded-source-integrity.test.ts',
  'tests/layered-xlsx-headers.test.ts',
];
const mutations = [
{"name": "bank-ignore-scope", "file": "lib/reconciliation/bank.ts", "changes": [["if (get(h) !== input.scope[BANK_SCOPE_FIELDS[i]]) fail('ROW_SCOPE');", "if (false) fail('ROW_SCOPE');"]]},
{"name": "bank-wrong-cash-perspective", "file": "lib/reconciliation/bank.ts", "changes": [["reading.perspective !== 'company-cash' ||", "false ||"]]},
{"name": "bank-ignore-posting-status", "file": "lib/reconciliation/bank.ts", "changes": [["if (status !== (side ? 'posted' : 'booked')) fail('STATUS');", "if (false) fail('STATUS');"]]},
{"name": "bank-ignore-fee-parent", "file": "lib/reconciliation/bank.ts", "changes": [["parent.settlement !== r.settlement ||", "false ||"], ["parent.policy !== r.policy ||", "false ||"]]},
{"name": "bank-wrong-fee-sign", "file": "lib/reconciliation/bank.ts", "changes": [["(direction !== 'outflow' || !parent)", "(!parent)"], [": r.direction !== 'outflow'),", ": false),"]]},
{"name": "bank-ignore-policy", "file": "lib/reconciliation/bank.ts", "changes": [["[...bank, ...cash].some((r) => r.policy !== policy) ||", "false ||"]]},
{"name": "bank-extra-individual-members", "file": "lib/reconciliation/bank.ts", "changes": [["bank.length !== 1 ||\n      cash.length !== 1 ||", "false ||"]]},
{"name": "bank-ignore-reversal-members", "file": "lib/reconciliation/bank.ts", "changes": [["!sameIds(\n            originals.map((r) => r.id),\n            originalMembers.map((r) => r.id),\n          )", "false"]]},
{"name": "bank-exchange-reversal-origins", "file": "lib/reconciliation/bank.ts", "changes": [["originKeys.size !== 1", "false"], ["!sameIds(\n            originals.map((r) => r.id),\n            originalMembers.map((r) => r.id),\n          )", "false"]]},
{"name": "bank-reuse-reversed-origin", "file": "lib/reconciliation/bank.ts", "changes": [["for (const field of ['Record ID', 'Reverses record ID']) {", "for (const field of ['Record ID', 'Reverses record ID']) { if(field==='Reverses record ID')continue;"]]},
{"name": "bank-partial-reversal", "file": "lib/reconciliation/bank.ts", "changes": [["r.amount !== original.amount ||", "false ||"]]},
{"name": "bank-same-direction-reversal", "file": "lib/reconciliation/bank.ts", "changes": [["r.direction === original.direction ||", "false ||"]]},
{"name": "bank-earlier-reversal-booking", "file": "lib/reconciliation/bank.ts", "changes": [["r.movementDate < original.movementDate ||", "false ||"]]},
{"name": "bank-earlier-reversal-value", "file": "lib/reconciliation/bank.ts", "changes": [["r.valueDate < original.valueDate", "false"]]},
{"name": "bank-ignore-source-errors", "file": "lib/reconciliation/bank.ts", "changes": [["const sourceError = inventory.some((i) => i.kind === 'error');", "const sourceError = false;"]]},
{"name": "bank-erase-timing-items", "file": "lib/reconciliation/bank.ts", "changes": [["iso(valueDate) &&", "false &&"]]},
{"name": "bank-ignore-booking-timing", "file": "lib/reconciliation/bank.ts", "changes": [["new Set(members.map((r) => r.movementDate)).size !== 1 ||", "false ||"]]},
{"name": "bank-ignore-value-timing", "file": "lib/reconciliation/bank.ts", "changes": [["new Set(members.map((r) => r.valueDate)).size !== 1 ||", "false ||"]]},
{"name": "bank-erase-timing-after-accept", "file": "lib/reconciliation/bank.ts", "changes": [["found.status = 'matched-manual';", "found.status = 'matched-manual'; timingItems.length=0;"]]},
{"name": "bank-undo-reattaches", "file": "lib/reconciliation/bank.ts", "changes": [["found.status = 'needs-review';", "found.status = 'matched-evidence';"]]},
{"name": "bank-human-reference-override", "file": "lib/reconciliation/bank.ts", "changes": [["b.settlement ||\n        c.settlement ||", "false ||"]]},
{"name": "bank-stale-event", "file": "lib/reconciliation/bank.ts", "changes": [["e.context !== context ||", "false ||"]]},
{"name": "bank-human-without-reason", "file": "lib/reconciliation/bank.ts", "changes": [["visible(e.note, 2000);", "void 0;"]]},
{"name": "bank-trust-cache", "file": "lib/reconciliation/bank-io.ts", "changes": [["const file = await readFile(source.name, source.original);", "const file = source;"]]},
{"name": "bank-stale-export", "file": "lib/reconciliation/bank-io.ts", "changes": [["if (JSON.stringify(result) !== JSON.stringify(expected))", "if (false)"]]},
{"name": "bank-formula-money", "file": "lib/reconciliation/bank.ts", "changes": [["sheet.formulaCells?.[`${row}:${c + 1}`] ||", "false ||"], ["sheet.cellIssues?.[`${row}:${c + 1}`]?.length,", "sheet.cellIssues?.[`${row}:${c + 1}`]?.filter(issue=>!issue.includes('صيغة Excel')).length,"]]},
{"name": "bank-formula-header", "file": "lib/reconciliation/bank.ts", "changes": [["[sheet.cellIssues, sheet.referenceIssues].some((m)", "[{}, {}].some((m)"], ["Object.keys(sheet.formulaCells ?? {}).some((k) => k.startsWith('1:'))", "false"]]},
  {"name": "allocation-formula-money", "file": "lib/reconciliation/allocation.ts", "changes": [["s.formulaCells?.[`${row}:${c + 1}`] ||", "false ||"], ["s.cellIssues?.[`${row}:${c + 1}`]?.length,", "s.cellIssues?.[`${row}:${c + 1}`]?.filter(issue => !issue.includes('صيغة Excel')).length,"]]},
  {"name": "allocation-formula-header", "file": "lib/reconciliation/allocation.ts", "changes": [["[s.cellIssues, s.referenceIssues].some((m)", "[{}, {}].some((m)"], ["Object.keys(s.formulaCells ?? {}).some((k) => k.startsWith('1:'))", "false"]]},
  {"name": "allocation-overrun", "file": "lib/reconciliation/allocation.ts", "changes": [["if (total > item.available) fail('OVER_AVAILABLE');", "if (false) fail('OVER_AVAILABLE');"], ["b.remaining < 0 ||", "false ||"]]},
  {"name": "allocation-skip-payment-proof", "file": "lib/reconciliation/allocation.ts", "changes": [["p.payment !== pay.reference ||", "false ||"]]},
  {"name": "allocation-skip-invoice-proof", "file": "lib/reconciliation/allocation.ts", "changes": [["p.invoice !== inv.reference ||", "false ||"]]},
  {"name": "allocation-skip-amount-proof", "file": "lib/reconciliation/allocation.ts", "changes": [["p.amount !== l.amount ||", "false ||"]]},
  {"name": "allocation-reuse-proof", "file": "lib/reconciliation/allocation.ts", "changes": [["proofsUsed.has(p.id)", "false"]]},
  {"name": "allocation-human-without-reason", "file": "lib/reconciliation/allocation.ts", "changes": [["text(b.reason, 2000);", "void 0;"]]},
  {"name": "allocation-partial-batch", "file": "lib/reconciliation/allocation.ts", "changes": [["for (const l of e.links) {", "for (const l of e.links.slice(0,1)) {"], ["active.set(e.id, e.links);", "active.set(e.id, e.links.slice(0,1));"]]},
  {"name": "allocation-stale-event", "file": "lib/reconciliation/allocation.ts", "changes": [["e.context !== context ||", "false ||"]]},
  {"name": "allocation-broken-undo", "file": "lib/reconciliation/allocation.ts", "changes": [["active.delete(e.target);", "active.get(e.target)!.pop();"]]},
  {"name": "allocation-original-as-capacity", "file": "lib/reconciliation/allocation.ts", "changes": [["available,\n          traces:", "available: original,\n          traces:"]]},
  {"name": "allocation-ignore-global-errors", "file": "lib/reconciliation/allocation.ts", "changes": [["if (status === 'source-error' && input.events.length)", "if (false)"]]},
  {"name": "allocation-hide-scope-error", "file": "lib/reconciliation/allocation.ts", "changes": [["if (get(metadata[i]) !== input.scope[key]) fail('ROW_SCOPE');", "if (false) fail('ROW_SCOPE');"]]},
  {"name": "allocation-trust-cache", "file": "lib/reconciliation/allocation-io.ts", "changes": [["const file = await readFile(source.name, source.original);", "const file = source;"]]},
  {"name": "allocation-stale-export", "file": "lib/reconciliation/allocation-io.ts", "changes": [["if (JSON.stringify(result) !== JSON.stringify(expected))", "if (false)"]]},
  {"name": "gl-tb-allow-formula-money", "file": "lib/reconciliation/gl-tb.ts", "changes": [["sheet.formulaCells?.[`${row}:${c + 1}`] ||", "false ||"], ["sheet.cellIssues?.[`${row}:${c + 1}`]?.length,", "sheet.cellIssues?.[`${row}:${c + 1}`]?.filter(issue => !issue.includes('صيغة Excel')).length,"]]},
  {"name": "gl-tb-hide-identity-format-issues", "file": "lib/reconciliation/gl-tb.ts", "changes": [["referenceColumns.some(\n          (c) => sheet.referenceIssues?.[`${row}:${c + 1}`]?.length,\n        )", "false"]]},

  {"name": "gl-tb-net-only", "file": "lib/reconciliation/gl-tb.ts", "changes": [["BALANCE_FIELDS.some((f) => differences[f] !== 0)", "BALANCE_FIELDS.some((f) => !['periodDebit','periodCredit'].includes(f) && differences[f] !== 0) || differences!.periodDebit !== differences!.periodCredit"]]},
  {"name": "gl-tb-skip-gl-bridge", "file": "lib/reconciliation/gl-tb.ts", "changes": [["glBridge !== 0 || tbBridge !== 0", "tbBridge !== 0"]]},
  {"name": "gl-tb-skip-tb-bridge", "file": "lib/reconciliation/gl-tb.ts", "changes": [["glBridge !== 0 || tbBridge !== 0", "glBridge !== 0"]]},
  {"name": "gl-tb-hide-scope-errors", "file": "lib/reconciliation/gl-tb.ts", "changes": [["if (get(scopeHeaders[i]) !== scope[k]) fail('ROW_SCOPE');", "if (false) fail('ROW_SCOPE');"]]},
  {"name": "gl-tb-allow-duplicate-balances", "file": "lib/reconciliation/gl-tb.ts", "changes": [["(r.kind !== 'movement' && kinds.get(r.kind)! > 1)", "false"]]},
  {"name": "gl-tb-ignore-source-errors", "file": "lib/reconciliation/gl-tb.ts", "changes": [["inventory.some((i) => i.kind === 'error')", "false"]]},
  {"name": "gl-tb-hide-unreadable-header", "file": "lib/reconciliation/gl-tb.ts", "changes": [["badHeader(sheet)", "false"]]},
  {"name": "gl-tb-hide-formula-blank-row", "file": "lib/reconciliation/gl-tb.ts", "changes": [["    try {\n      if (", "    if (!values.some(v=>v.trim())) {inventory.push({side,row,kind:'blank',values});continue;}\n    try {\n      if ("]]},
  {"name": "gl-tb-trust-parsed-cache", "file": "lib/reconciliation/gl-tb-io.ts", "changes": [["const file = await readFile(source.name, source.original);", "const file = source;"]]},
  {"name": "gl-tb-accept-stale-export", "file": "lib/reconciliation/gl-tb-io.ts", "changes": [["if (JSON.stringify(result) !== JSON.stringify(expected))", "if (false)"]]},

  {"name": "ar-hide-unreadable-header", "file": "lib/reconciliation/ar.ts", "changes": [["cell.startsWith('1:') && issues.length > 0", "false"], ["Object.keys(sheet.formulaCells ?? {}).some((cell) =>\n        cell.startsWith('1:'),\n      )", "false"]]},
  {"name": "ar-hide-unselected-related-evidence", "file": "lib/reconciliation/ar.ts", "changes": [["const relatedConflict = relatedIds.size > 1;", "const relatedConflict = false;"]]},
  {"name": "ar-hide-alternate-identity-columns", "file": "lib/reconciliation/ar.ts", "changes": [["if (candidates.length !== 1 || candidates[0] !== r[key])", "if (false)"]]},
  {"name": "ar-hide-uncached-formula-row", "file": "lib/reconciliation/ar.ts", "changes": [["      try {\n        if (", "      if (!values.some(v=>v.trim())) {inventory.push({side,row,kind:'blank',values});continue;}\n      try {\n        if ("]]},
  {"name": "ar-ignore-seller-perspective", "file": "lib/reconciliation/ar.ts", "changes": [["r.perspective !== 'seller-receivable' ||", "false ||"]]},
  {"name": "ar-ignore-source-errors", "file": "lib/reconciliation/ar.ts", "changes": [["const reason: ArCase['reason'] = errors", "const reason: ArCase['reason'] = false"]]},
  {"name": "ar-ignore-document-role", "file": "lib/reconciliation/ar.ts", "changes": [[": !documentRole", ": false"]]},
  {"name": "ar-ignore-duplicate-documents", "file": "lib/reconciliation/ar.ts", "changes": [[": left.length > 1 || right.length > 1", ": false"]]},
  {"name": "ar-accept-stale-export", "file": "lib/reconciliation/ar-io.ts", "changes": [["if (JSON.stringify(result) !== JSON.stringify(expected))", "if (false)"]]},
  {"name": "ar-accept-stale-decisions", "file": "lib/reconciliation/ar.ts", "changes": [["event.context !== context ||", "false ||"]]},
  {"name": "ar-ignore-document-type", "file": "lib/reconciliation/ar.ts", "changes": [["JSON.stringify([row.kind, row.document])", "JSON.stringify([row.document])"]]},
  {
    name: 'clearing-hide-uncached-formulas-as-blank',
    file: 'lib/reconciliation/clearing.ts',
    changes: [
      [
        '    try {\n      if (',
        "    if (!values.some((v) => v.trim())) { inventory.push({ row, kind: 'blank', values }); continue; }\n    try {\n      if (",
      ],
    ],
  },
  {name:'clearing-ignore-reference-role',file:'lib/reconciliation/clearing.ts',changes:[['referenceRole &&','true &&']]},
  {name:'clearing-ignore-source-errors',file:'lib/reconciliation/clearing.ts',changes:[['!errors &&','true &&']]},
  {name:'clearing-accept-nonzero-group',file:'lib/reconciliation/clearing.ts',changes:[['net === 0 &&','true &&']]},
  {name:'clearing-accept-stale-export',file:'lib/reconciliation/clearing-io.ts',changes:[['if (JSON.stringify(result) !== JSON.stringify(expected))','if (false)']]},
  {name:'clearing-manual-partial-bucket',file:'lib/reconciliation/clearing.ts',changes:[["if (intersecting.some((c) => c.ids.some((id) => !selectedIds.has(id))))","if (false)"]]},
  {name:'p6-effort-include-paused-time',file:'lib/review-effort.ts',changes:[['if (paused) pausedMs[paused] += duration;', 'if (paused) firstMs[stage] += duration;']]},
  {name:'p6-effort-lose-rework-time',file:'lib/review-effort.ts',changes:[['else (rework ? reworkMs : firstMs)[stage] += duration;', 'else firstMs[stage] += duration;']]},
  {name:'p6-effort-ignore-idle-deadline',file:'lib/review-effort.ts',changes:[['if (!state.paused && atMs >= deadline)', 'if (false)']]},
  {name:'p6-split-accept-mixed-amount-basis',file:'lib/reconciliation/visual-table.ts',changes:[['!validAmountRoles(input.roles)','false']]},
  {name:'p6-split-ignore-table-version',file:'lib/reconciliation/visual-table.ts',changes:[['p.version !== current.version ||','false ||']]},
  {name:'p6-split-ignore-source-version',file:'lib/reconciliation/visual-accounting-source.ts',changes:[['if (p.version !== table.version) fail();','if (false) fail();']]},
  {
    name:'p6-source-ignore-excluded-facts',file:'lib/reconciliation/core.ts',
    changes:[["isolation: visualRowFactsRetained(file, i - 1)","isolation: true"]],
  },
  {
    name:'p6-source-certify-unproved-exclusion',file:'lib/reconciliation/core.ts',
    changes:[["const proven = visualNonMovementProven(file, i - 1, mapping);","const proven = true;"]],
  },

  {
    name: 'p6-source-ignore-bound-mapping',file:'lib/reconciliation/visual-accounting-source.ts',
    changes:[["if (mapping[k] !== expected[k]) fail();", "if (false) fail();"]],
  },
  {
    name: 'p6-source-ignore-interpretation-receipt',file:'lib/reconciliation/visual-accounting-source.ts',
    changes:[["if (p.review.fingerprint !== fresh.review.fingerprint) fail();", "if (false) fail();"]],
  },
  {
    name: 'p6-source-accept-missing-currency-proof',file:'lib/reconciliation/visual-accounting-source.ts',
    changes:[["if (!table.grid.roles.includes('currency') && currencyProof === null) fail();", "if (false) fail();"]],
  },
  {
    name: 'p6-source-ignore-replayed-sheet-literals',file:'lib/reconciliation/visual-accounting-source.ts',
    changes:[[" ||\n    JSON.stringify(file.sheets) !== JSON.stringify(fresh.sheets)", ""]],
  },
  {
    name: 'p6-source-hide-damaged-cell',file:'lib/reconciliation/visual-accounting-source.ts',
    changes:[["if (!readable) sheet.cellIssues!", "if (false) sheet.cellIssues!"]],
  },
  {
    name: 'p6-source-false-balance-certification',file:'lib/reconciliation/core.ts',
    changes:[["    result.balanceValid = false;\n    result.balanceArithmeticStatus = 'BALANCE_ROW_NOT_FOUND';", "    result.balanceValid = true;\n    result.balanceArithmeticStatus = 'BALANCE_ROW_NOT_FOUND';"]],
  },

  {
    name: 'p6-table-retain-coverage-after-row-edit',
    file: 'lib/reconciliation/visual-table.ts',
    changes: [['rows: value.rows.map((r, i) => (i === index ? row : r)),\n    coverage: null,', 'rows: value.rows.map((r, i) => (i === index ? row : r)),\n    coverage: value.coverage,']],
  },
  {
    name: 'p6-table-swap-neighboring-amount-and-balance',
    file: 'lib/reconciliation/visual-table.ts',
    changes: [['c.region.x0 >= value.grid.columnCuts[column] &&', 'true &&'], ['c.region.x1 <= value.grid.columnCuts[column + 1] &&', 'true &&']],
  },
  {
    name: 'p6-table-ignore-known-unassigned-crops',
    file: 'lib/reconciliation/visual-table.ts',
    changes: [['counts.unassignedCrops ||', 'false ||']],
  },
  {
    name: 'p6-table-skip-coverage-fingerprint',
    file: 'lib/reconciliation/visual-table.ts',
    changes: [['p.coverage.fingerprint !== (await coverageHash(current))', 'false']],
  },
  {
    name: 'p6-table-launder-table-inventory-into-accounting',
    file: 'lib/reconciliation/source-boundary.ts',
    changes: [["source.kind === 'visual-table'", 'false']],
  },
  {
    name: 'p6-retain-manual-region-review-after-edit',
    file: 'lib/reconciliation/visual-review.ts',
    changes: [['region: box,\n    review: null,', 'region: box,\n    review: visualRegions(value).find(r => r.id === id)?.review ?? null,']],
  },
  {
    name: 'p6-ignore-manual-region-observations',
    file: 'lib/reconciliation/visual-review.ts',
    changes: [['JSON.stringify(cell.observed) !== JSON.stringify(raw.observed)', 'false']],
  },
  {
    name: 'p6-skip-manual-region-fingerprint',
    file: 'lib/reconciliation/visual-review.ts',
    changes: [['raw.review.fingerprint !==\n            (await regionFingerprint(base.revision, cell))', 'false']],
  },
  {
    name: 'p6-accept-outside-image-manual-region',
    file: 'lib/reconciliation/visual-review.ts',
    changes: [['region.x1 > page.width ||', 'false ||']],
  },
  {
    name: 'p6-ignore-png-chunk-crc',
    file: 'lib/reconciliation/visual-png.ts',
    changes: [
      [
        'crc32(bytes.subarray(offset + 4, end - 4)) !== view.getUint32(end - 4)',
        'false',
      ],
    ],
  },
  {
    name: 'p6-trust-a-substituted-image-preview',
    file: 'lib/reconciliation/visual-review.ts',
    changes: [['native.pixelSha256 !== displayed.pixelSha256', 'false']],
  },
  {
    name: 'p6-retain-reviewed-status-after-value-edit',
    file: 'lib/reconciliation/visual-review.ts',
    changes: [
      [
        'region: { ...box },\n    review: null,',
        'region: { ...box },\n    review: value.cells.find(c => c.wordId === wordId)?.review ?? null,',
      ],
    ],
  },
  {
    name: 'p6-skip-cell-fingerprint-on-restore',
    file: 'lib/reconciliation/visual-review.ts',
    changes: [
      [
        'raw.review.fingerprint !== (await fingerprint(base.revision, cell))',
        'false',
      ],
    ],
  },
  {
    name: 'p6-launder-cell-review-into-accounting',
    file: 'lib/reconciliation/source-boundary.ts',
    changes: [["source.kind === 'visual-review'", 'false']],
  },
  {
    name: 'f02-discard-excluded-movement-membership',
    file: 'lib/reconciliation/localized-read-errors.ts',
    changes: [['...excludedKeys,', '/* Fault: drop excluded competitors. */']],
  },
  {
    name: 'f02-ignore-unknown-excluded-identity',
    file: 'lib/reconciliation/localized-read-errors.ts',
    changes: [
      ["row.kind === 'manual' && !validIsolation(row.isolation)", 'false'],
    ],
  },
  {
    name: 'f02-hide-compatible-currency-glyphs',
    file: 'lib/reconciliation/header-view.ts',
    changes: [
      ['...normalizeHeaderLabel(label).matchAll(', '...label.matchAll('],
    ],
  },
  {
    name: 'partial-drop-reading-issue-details-from-export',
    file: 'lib/reconciliation/io.ts',
    changes: [['if (readingIssues.length) {', 'if (false) {']],
  },
  {
    name: 'partial-treat-untrusted-cells-as-format-proof',
    file: 'lib/reconciliation/format-inference.ts',
    changes: [['if (!evidence.unsafe)', 'if (true)']],
  },
  {
    name: 'partial-accept-stale-format-selection',
    file: 'lib/reconciliation/input-readiness.ts',
    changes: [
      [
        "assessment.status === 'proven' &&",
        "false && assessment.status === 'proven' &&",
      ],
    ],
  },
  {
    name: 'partial-ignore-isolated-error-membership',
    file: 'lib/reconciliation/localized-read-errors.ts',
    changes: [['members.every((row) => !taintedIds.has(row.id))', 'true']],
  },
  {
    name: 'partial-drop-transitive-error-impact',
    file: 'lib/reconciliation/localized-read-errors.ts',
    changes: [
      [
        'queue.push(member);',
        '/* Fault: do not propagate the discovered identity edge. */',
      ],
    ],
  },
  {
    name: 'partial-drop-displaced-literal-identities',
    file: 'lib/reconciliation/localized-read-errors.ts',
    changes: [
      [
        '...row.flatMap((value) => referenceEnvelopeKeys({ reference: value })),',
        '/* Fault: discard identities displaced into non-reference cells. */',
      ],
    ],
  },
  {
    name: 'p4-silently-stop-after-twenty-pages',
    file: 'lib/reconciliation/pdf.ts',
    changes: [
      ['pageNo <= doc.numPages', 'pageNo <= Math.min(20, doc.numPages)'],
    ],
  },
  {
    name: 'p2-reject-explicit-numeric-payment-identities',
    file: 'lib/reconciliation/cases.ts',
    changes: [
      ['usableDiscriminator(claim.value) &&', 'strong(claim.value) &&'],
    ],
  },
  {
    name: 'p2-promote-placeholder-payment-identities',
    file: 'lib/reconciliation/cases.ts',
    changes: [['usableDiscriminator(claim.value) &&', 'true &&']],
  },
  {
    name: 'p2-waive-voucher-conflicts-without-a-certified-document-partition',
    file: 'lib/reconciliation/cases.ts',
    changes: [[/\(partition && sharedPO\)/, 'sharedPO']],
  },
  {
    name: 'p2-ignore-overlapping-payment-identity-memberships',
    file: 'lib/reconciliation/payment-components.ts',
    changes: [
      [
        /competing:\s*!!\(a.length && b.length\)/,
        'competing: false && !!(a.length && b.length)',
      ],
    ],
  },
  {
    name: 'p2-drop-primary-only-competing-members',
    file: 'lib/reconciliation/payment-components.ts',
    changes: [
      ['const related = primary.get(normalized) ?? [];', 'const related = [];'],
    ],
  },
  {
    name: 'p2-let-an-exact-payment-consume-a-group-member-first',
    file: 'lib/reconciliation/cases.ts',
    changes: [
      [
        /groupedPaymentRows\.has\(m\.supplierId\)\s*\|\|\s*groupedPaymentRows\.has\(m\.ledgerId\)/,
        'false',
      ],
    ],
  },
  {
    name: 'p2-accept-inferred-payment-role-as-explicit-proof',
    file: 'lib/reconciliation/cases.ts',
    changes: [
      [
        /t\.paymentIdentityFields\?\.includes\(claim\.field\)\s*&&\s*t\[claim\.field\] === claim\.value/,
        't[claim.field] === claim.value',
      ],
    ],
  },
  {
    name: 'p2-accept-duplicate-postings-in-nm-groups',
    file: 'lib/reconciliation/cases.ts',
    changes: [
      [
        /const duplicatePosting = \[a, b\]\.some\(\s*\(rows\) => new Set\(rows\.map\(postingIdentity\)\)\.size !== rows\.length,?\s*\);/,
        'const duplicatePosting = false;',
      ],
    ],
  },
  {
    name: 'p2-ignore-whole-group-date-span',
    file: 'lib/reconciliation/cases.ts',
    changes: [['!(span <= scope.dateWindow)', 'false']],
  },
  {
    name: 'p2-approve-groups-beyond-the-member-limit',
    file: 'lib/reconciliation/cases.ts',
    changes: [
      ['Math.max(a.length, b.length) > MAX_AUTOMATIC_GROUP_MEMBERS', 'false'],
    ],
  },
  {
    name: 'p2-ignore-group-member-rejection',
    file: 'lib/reconciliation/cases.ts',
    changes: [
      [
        /rejectedGroup\(a, b\)\s*\? \['رفض المراجع رابطًا داخل المجموعة؛ أُوقف اعتماد المجموعة كاملة.'\]/,
        "false ? ['رفض المراجع رابطًا داخل المجموعة؛ أُوقف اعتماد المجموعة كاملة.']",
      ],
    ],
  },
  {
    name: 'p1-accept-formula-or-spreadsheet-error-reference-text',
    file: 'lib/reconciliation/transaction-references.ts',
    changes: [
      [
        'export function isUnsafeReferenceText(value: string): boolean {',
        'export function isUnsafeReferenceText(value: string): boolean {\n  return false;',
      ],
    ],
  },
  {
    name: 'p1-accept-placeholder-category-or-zero-as-a-discriminator',
    file: 'lib/reconciliation/document-pairs.ts',
    changes: [['    usableDiscriminator(value) &&', '']],
  },
  {
    name: 'p1-reject-valid-contextual-numeric-or-alphabetic-discriminators',
    file: 'lib/reconciliation/document-pairs.ts',
    changes: [
      [
        '    usableDiscriminator(value) &&',
        '    value.length >= 4 && /\\p{L}/u.test(value) && /\\p{Nd}/u.test(value) &&',
      ],
    ],
  },
  {
    name: 'p1-disable-document-pair-resolution',
    file: 'lib/reconciliation/core.ts',
    changes: [
      [
        'const documentPairs = certifiedDocumentPairs(supplier, ledger);',
        'const documentPairs = [];',
      ],
    ],
  },
  {
    name: 'p1-grant-document-role-to-another-selected-column',
    file: 'lib/reconciliation/transaction-references.ts',
    changes: [
      [
        /headerMatches\(\s*statedReferencePattern,\s*headers\[mapping\.reference\] \?\? '',\s*\) &&\s*/,
        '',
      ],
    ],
  },
  {
    name: 'p1-choose-first-repeated-discriminator',
    file: 'lib/reconciliation/document-pairs.ts',
    changes: [
      [
        'if (candidates.length === 1 && counterparts?.length === 1)',
        'if (candidates.length && counterparts?.length)',
      ],
    ],
  },
  {
    name: 'p1-ignore-unsafe-discriminator-competitors',
    file: 'lib/reconciliation/document-pairs.ts',
    changes: [
      [
        'const a = index(supplier.transactions,',
        'const a = index(supplier.transactions.filter(strongDiscriminator),',
      ],
      [
        'const b = index(ledger.transactions,',
        'const b = index(ledger.transactions.filter(strongDiscriminator),',
      ],
    ],
  },
  {
    name: 'p1-use-normalized-document-identity',
    file: 'lib/reconciliation/document-pairs.ts',
    changes: [
      [
        '          t.documentReference === document &&\n          t.reference === document &&',
        '          true &&',
      ],
    ],
  },
  {
    name: 'p1-ignore-document-pair-amount-difference',
    file: 'lib/reconciliation/core.ts',
    changes: [
      [
        '      s.amount === 0 ||\n      s.amount !== l.amount ||',
        '      s.amount === 0 ||\n      false ||',
      ],
    ],
  },
  {
    name: 'p1-restore-a-rejected-document-pair',
    file: 'lib/reconciliation/core.ts',
    changes: [
      [
        '      usedB.has(l.id) ||\n      rejectedSet.has(`${s.id}|${l.id}`)',
        '      usedB.has(l.id) ||\n      false',
      ],
    ],
  },
  {
    // Removing the guard must not look like a passing candidate.
    name: '047-accept-unanswered-format-ambiguity',
    file: 'lib/reconciliation/input-readiness.ts',
    changes: [
      [
        "      if (\n        assessment.status === 'ambiguous' &&",
        "      if (\n        false &&\n        assessment.status === 'ambiguous' &&",
      ],
    ],
  },
  {
    // Nor must a guard that throws something other than its own refusal: an
    // unrelated fault is a defect, and must never be credited as protection.
    name: '047-ambiguity-guard-throws-unrelated-error',
    file: 'lib/reconciliation/input-readiness.ts',
    changes: [
      [
        '        throw new InputReadinessError(\n          `${file.name}: صيغة ${fieldLabel(field)} تحتمل',
        '        throw new TypeError(\n          `${file.name}: صيغة ${fieldLabel(field)} تحتمل',
      ],
    ],
  },
  {
    // A choice must stay bound to the reading it was given for.
    name: '047-reuse-format-choice-across-context',
    file: 'lib/reconciliation/input-readiness.ts',
    changes: [
      [
        "  if (!choice || typeof choice !== 'object') return false;",
        '  return true;',
      ],
    ],
  },
  {
    name: '046-disable-all-supported-groups',
    file: 'lib/reconciliation/cases.ts',
    changes: [
      [
        'const readErrors = localizedReadErrors(supplier, ledger);',
        'const readErrors = { ...localizedReadErrors(supplier, ledger), canMatch: () => false };',
      ],
    ],
  },
  {
    name: '046-accept-payment-groups-without-explicit-identity',
    file: 'lib/reconciliation/cases.ts',
    changes: [['? !!paymentIdentity', '? true']],
  },
  {
    name: 'hard-t01-read-any-label-ending-in-invoice',
    file: 'lib/reconciliation/transaction-references.ts',
    changes: [["new RegExp(`^${v}$`, 'i')", "new RegExp(`${v}$`, 'i')"]],
  },
  {
    name: 'v11-read-carried-forward-as-a-transaction',
    file: 'lib/reconciliation/row-labels.ts',
    changes: [
      [
        'balance carried forward|carried forward|brought forward|',
        'balance carried forward|',
      ],
    ],
  },
  {
    name: 'v11-refuse-black-text-grazed-by-a-table-rule',
    file: 'lib/reconciliation/pdf-paint-order.ts',
    changes: [
      ['if (thin && share <= 0.1 && (rules += share) <= 0.2) continue;', ''],
    ],
  },
  {
    name: 'v11-let-stripes-hide-text',
    file: 'lib/reconciliation/pdf-paint-order.ts',
    changes: [['(rules += share) <= 0.2', '(rules += share) <= 1']],
  },
  {
    name: 'v11-approve-a-source-compared-with-itself',
    file: 'lib/reconciliation/core.ts',
    changes: [['sameSource ? SAME_SOURCE_MESSAGE : undefined', 'undefined']],
  },
  {
    name: 'v11-take-a-renamed-copy-for-another-source',
    file: 'lib/reconciliation/core.ts',
    changes: [
      [
        'supplier.sourceOrigin === ledger.sourceOrigin &&',
        'supplier.sourceName === ledger.sourceName &&',
      ],
    ],
  },
  {
    name: 'hard-s01-drop-a-source-without-a-role',
    file: 'lib/reconciliation/source-preparation.ts',
    changes: [['files.length !== roles.length ||', '']],
  },
  {
    name: 'hard-r01-rank-own-voucher-before-chosen-reference',
    file: 'lib/reconciliation/transaction-references.ts',
    changes: [
      [
        /documentReference \|\|\s*mappedIdentity \|\|\s*voucherReference \|\|\s*poReference;/,
        'documentReference || voucherReference || mappedIdentity || poReference;',
      ],
    ],
  },
  {
    name: 'hard-r01-let-a-voucher-hide-a-po-only-identity',
    file: 'lib/reconciliation/transaction-references.ts',
    changes: [
      [
        'primaryReference === poReference &&\n    (!mapped || mapped === poReference)',
        'primaryReference === poReference &&\n    !voucherReference &&\n    (!mapped || mapped === poReference)',
      ],
    ],
  },
  {
    name: 'v11-take-a-document-number-equal-to-the-order-as-proof',
    file: 'lib/reconciliation/transaction-references.ts',
    changes: [
      [
        'primaryReference === poReference &&\n    (!mapped || mapped === poReference)',
        'primaryReference === poReference &&\n    !documentReference &&\n    (!mapped || mapped === poReference)',
      ],
    ],
  },
  {
    name: 'v11-approve-on-a-voucher-with-no-chosen-reference',
    file: 'lib/reconciliation/transaction-references.ts',
    changes: [
      [
        '(mapping.reference < 0 || mappedRelated) &&\n    !documentReference &&',
        'false &&',
      ],
    ],
  },
  {
    name: 'v11-take-a-batch-for-a-document',
    file: 'lib/reconciliation/transaction-references.ts',
    changes: [['if (mapped && batch && mapped === batch)', 'if (false)']],
  },
  {
    name: 'v11-let-a-document-number-outvote-the-chosen-references',
    file: 'lib/reconciliation/cases.ts',
    changes: [
      ['a.chosenReference.trim() !== b.chosenReference.trim()', 'false'],
    ],
  },
  {
    name: 'h03-let-a-document-number-outvote-unselected-references',
    file: 'lib/reconciliation/cases.ts',
    changes: [
      [
        '    a.statedReference.trim() !== b.statedReference.trim() &&',
        '    false &&',
      ],
    ],
  },
  {
    name: 'v11-read-only-bare-labels-in-descriptions',
    file: 'lib/reconciliation/cases.ts',
    changes: [
      [
        "new RegExp(`^${DOCUMENT_LABELS[role]}(?=\\\\s|[:：-]|$)`, 'i')",
        "new RegExp(`^${DOCUMENT_LABELS[role].replace(/\\(\\?:\\(\\?:[^)]*\\)\\?/, '(?:')}(?=\\\\s|[:：-]|$)`, 'i')",
      ],
    ],
  },
  {
    name: 'v11-leave-blocked-exact-pairs-as-unrelated-rows',
    file: 'lib/reconciliation/cases.ts',
    changes: [['unverified.length &&', 'false &&']],
  },
  {
    name: 'hard-g08-accept-payment-parts-beyond-the-date-window',
    file: 'lib/reconciliation/cases.ts',
    changes: [['groupSpan <= scope.dateWindow', 'true']],
  },
  {
    name: 'hard-g08-accept-any-group-across-dates',
    file: 'lib/reconciliation/cases.ts',
    changes: [['sameGroupDate ||', 'true ||']],
  },
  {
    name: '045-ignore-declared-aging-report',
    file: 'lib/reconciliation/report-scope.ts',
    changes: [[/if\s*\(title\)/, 'if (false)']],
  },
  {
    name: '045-skip-generic-account-scope-evidence',
    file: 'lib/reconciliation/report-scope.ts',
    changes: [
      [
        /export function collectGenericAccounts\([\s\S]*?\)\s*\{/,
        (match) =>
          `${match}\n  return; // deliberate loss of source account evidence`,
      ],
    ],
  },
  {
    name: '045-allow-a-second-sheetdata-to-drop-earlier-rows',
    file: 'lib/reconciliation/xlsx-namespaces.ts',
    changes: [['if (sheetDataSeen)', 'if (false)']],
  },
  {
    name: '045-concatenate-conflicting-xlsx-cell-payloads',
    file: 'lib/reconciliation/xlsx-namespaces.ts',
    changes: [
      [
        /if\s*\(\s*cell\.hasInline\s*\|\|\s*cell\.hasValue\s*\|\|\s*cell\.hasFormula\s*\|\|\s*cell\.type !== 'inlineStr'\s*\)/,
        'if (false)',
      ],
    ],
  },
  {
    name: 'accept-a-partial-pdf-operator-stream',
    file: 'lib/reconciliation/pdf.ts',
    changes: [
      [
        'await streamGuard.assertComplete();',
        '/* deliberately skip completeness */',
      ],
    ],
  },
  {
    name: 'allow-visual-drafts-into-accounting',
    file: 'lib/reconciliation/source-boundary.ts',
    changes: [["source.kind === 'visual-draft'", 'false']],
  },
  {
    name: 'reuse-an-ai-column-proposal-after-settings-change',
    file: 'lib/reconciliation/import-proposals.ts',
    changes: [['input.baseline !== context.baseline', 'false']],
  },
  {
    name: 'trust-stale-case-member-evidence',
    file: 'lib/reconciliation/assistant.ts',
    changes: [['!sameTransactionEvidence(t, member)', 'false']],
  },
  {
    name: 'allow-ai-proposals-outside-the-evidence-window',
    file: 'lib/reconciliation/local-ai.ts',
    changes: [
      ['suppliedIds && proposed.some((id) => !suppliedIds.has(id))', 'false'],
    ],
  },
  {
    name: 'skip-an-earlier-table-for-a-richer-later-header',
    file: 'lib/reconciliation/core.ts',
    changes: [
      [
        'const firstTable = headerRows.findIndex(',
        'const firstTable = -1; const ignoredFirstTable = headerRows.findIndex(',
      ],
    ],
  },
  {
    name: 'ignore-known-document-evidence-conflicts',
    file: 'lib/reconciliation/core.ts',
    changes: [
      [
        'if (automaticConflicts(s, l).length) continue;',
        'if (false) continue;',
      ],
    ],
  },
  {
    name: 'accept-duplicate-posting-lines-as-a-group',
    file: 'lib/reconciliation/cases.ts',
    changes: [['!duplicatePosting &&', 'true &&']],
  },
  {
    name: 'ignore-xlsx-overwritten-cell-addresses',
    file: 'lib/reconciliation/xlsx-namespaces.ts',
    changes: [['if (address && seenCells.has(address))', 'if (false)']],
  },
  {
    name: 'silently-round-original-xlsx-numeric-lexemes',
    file: 'lib/reconciliation/xlsx-namespaces.ts',
    changes: [[/if\s*\(inspected\.numericIssues\.length\)/, 'if (false)']],
  },
  {
    name: 'ignore-pdf-overlap-between-separate-baselines',
    file: 'lib/reconciliation/pdf.ts',
    changes: [['if (overlapRows.has(lineIndex))', 'if (false)']],
  },
  {
    name: 'reject-supported-multisheet-workpapers',
    file: 'lib/reconciliation/types.ts',
    changes: [
      ['export const MAX_SHEETS = 40;', 'export const MAX_SHEETS = 12;'],
    ],
  },
  {
    name: 'reject-unused-helper-formulas',
    file: 'lib/reconciliation/core.ts',
    changes: [
      [
        'if (!sheet.cellIssues && formulaRows.has(rn))',
        'if (formulaRows.has(rn))',
      ],
    ],
  },
  {
    name: 'treat-pdf-table-edges-as-filled-area',
    file: 'lib/reconciliation/pdf.ts',
    changes: [['if (overlaps === false) continue;', 'if (false) continue;']],
  },
  {
    name: 'count-total-rows-as-transactions',
    file: 'lib/reconciliation/core.ts',
    changes: [
      [
        'if (labelCell === first) return labelCell.value;',
        'if (labelCell === first) return undefined;',
      ],
    ],
  },
  {
    name: 'drop-classified-rows-without-a-reason',
    file: 'lib/reconciliation/core.ts',
    changes: [
      [
        `reason: \`صف إجمالي أو رصيد — استُبعد تلقائيًا («\${label.trim()}»)\`,`,
        "reason: '',",
      ],
    ],
  },
  {
    name: 'accept-a-timestamp-as-a-read-issue',
    file: 'lib/reconciliation/io.ts',
    changes: [
      [
        'const note = (row: number, column: number, message: string) => {\n      (cellNotes[`${row}:${column}`] ??= []).push(message);',
        'const note = (row: number, column: number, message: string) => {\n      (cellIssues[`${row}:${column}`] ??= []).push(message);',
      ],
    ],
  },
  {
    name: 'automatically-match-with-unread-potential-duplicates',
    file: 'lib/reconciliation/localized-read-errors.ts',
    changes: [
      [
        'canMatch: (_rows: readonly Transaction[]) => false',
        'canMatch: (_rows: readonly Transaction[]) => true',
      ],
    ],
  },
  {
    name: 'classify-any-summary-word-as-a-nontransaction',
    file: 'lib/reconciliation/core.ts',
    changes: [
      [
        /const label = structuralSummaryLabel\([\s\S]*?\);/,
        'const label = row.find(value => summaryLabel.test(value.trim()));',
      ],
    ],
  },
  {
    name: 'ignore-date-and-reference-in-reordered-summary-rows',
    file: 'lib/reconciliation/core.ts',
    changes: [
      [
        /if\s*\(\s*\(date && date !== labelCell\.value\)\s*\|\|\s*references\.some\(\(?value\)?\s*=>\s*value !== labelCell\.value\)\s*\)\s*return;/,
        'if (false) return;',
      ],
    ],
  },
  {
    name: 'prove-direction-from-a-single-movement',
    file: 'lib/reconciliation/statement-direction.ts',
    changes: [['nonzeroSteps < 2', 'nonzeroSteps < 1']],
  },
  {
    name: 'reverse-proven-ap-direction',
    file: 'lib/reconciliation/statement-direction.ts',
    changes: [['delta === -net ? -1', 'delta === -net ? 1']],
  },
  {
    name: 'ignore-contradictory-closing-footer-in-direction-proof',
    file: 'lib/reconciliation/statement-direction.ts',
    changes: [['footerAmounts[0] !== previousBalance', 'false']],
  },
  {
    name: 'reverse-source-sign',
    file: 'lib/reconciliation/core.ts',
    changes: [
      ['amount *= mapping.multiplier;', 'amount *= -mapping.multiplier;'],
    ],
  },
  {
    name: 'fuzzy-reference-auto-match',
    file: 'lib/reconciliation/core.ts',
    changes: [
      [
        'if (s.reference.trim() !== l.reference.trim()) continue;',
        'if (false) continue;',
      ],
    ],
  },
  {
    name: 'ignore-date-window',
    file: 'lib/reconciliation/core.ts',
    changes: [['if (days <= scope.dateWindow)', 'if (true)']],
  },
  {
    name: 'ignore-reference-duplicates',
    file: 'lib/reconciliation/core.ts',
    changes: [
      ['refA.get(s.normalizedReference)?.length !== 1', 'false'],
      ['refB.get(s.normalizedReference)?.length !== 1', 'false'],
    ],
  },
  {
    name: 'allow-unconfirmed-coverage',
    file: 'lib/reconciliation/core.ts',
    changes: [
      [
        'scope.coverageConfirmed &&\n    !unverifiedExclusions(result).length',
        'true &&\n    !unverifiedExclusions(result).length',
      ],
    ],
  },
  {
    name: 'promote-ai-hypothesis',
    file: 'lib/reconciliation/assistant.ts',
    changes: [
      ["status: 'needs-review' as const", "status: 'confirmed' as const"],
    ],
  },
  {
    name: 'typed-short-disable-required-positive-proof',
    file: 'lib/reconciliation/transaction-references.ts',
    changes: [['    ref.length <= 3 &&', '    ref.length < 2 &&']],
  },
  {
    name: 'typed-short-infer-type-without-explicit-label',
    file: 'lib/reconciliation/transaction-references.ts',
    changes: [
      [
        "    (t.documentType === 'Invoice' || t.documentType === 'Credit Note') &&\n    t.documentReference",
        '    true &&\n    t.documentReference',
      ],
    ],
  },
  {
    name: 'typed-short-grant-document-number-role-to-generic-reference',
    file: 'lib/reconciliation/transaction-references.ts',
    changes: [
      ['    numberRole &&\n', ''],
      [
        '    t.documentReference === t.reference &&\n    t.primaryReference === t.documentReference &&\n    (!t.chosenReference ||\n      t.chosenReference === t.documentReference ||\n      chosenRelatedInvoice(t)) &&\n',
        '',
      ],
    ],
  },
  {
    name: 'typed-short-ignore-canonical-type-sign',
    file: 'lib/reconciliation/transaction-references.ts',
    changes: [
      [
        "    (t.documentType === 'Invoice' ? t.amount > 0 : t.amount < 0) &&",
        '    t.amount !== 0 &&',
      ],
    ],
  },
  {
    name: 'typed-short-allow-neighbouring-dates',
    file: 'lib/reconciliation/transaction-references.ts',
    changes: [['    a.date === b.date', '    true']],
  },
  {
    name: 'typed-short-ignore-selected-reference-conflict',
    file: 'lib/reconciliation/transaction-references.ts',
    changes: [
      [
        '    (!t.chosenReference ||\n      t.chosenReference === t.documentReference ||\n      chosenRelatedInvoice(t)) &&\n',
        '',
      ],
    ],
  },
  {
    name: 'typed-short-use-original-invoice-number-as-credit-note-number',
    file: 'lib/reconciliation/transaction-references.ts',
    changes: [
      [
        "  const invoiceIsRelated = ['Credit Note', 'Payment', 'Journal'].includes(\n    documentType,\n  );",
        '  const invoiceIsRelated = false;',
      ],
    ],
  },
  {
    name: 'f03-ignore-related-credit-invoice-conflict',
    file: 'lib/reconciliation/cases.ts',
    changes: [
      ['a.relatedInvoiceReference !== b.relatedInvoiceReference', 'false'],
    ],
  },
  {
    name: 'f03-drop-own-credit-note-header',
    file: 'lib/reconciliation/transaction-references.ts',
    changes: [
      [
        "...(documentType === 'Credit Note' ? [creditNumberPattern.source] : []),",
        '/* Fault: omit explicit own credit-note number. */',
      ],
    ],
  },
  {
    name: 'f03-promote-related-invoice-discriminator',
    file: 'lib/reconciliation/document-pairs.ts',
    changes: [
      [
        "t.chosenReferenceEvidence?.role === 'document-reference'",
        '!!t.chosenReferenceEvidence',
      ],
    ],
  },
  {
    name: 'f03-ai-ignore-related-invoice-contradiction',
    file: 'lib/reconciliation/assistant.ts',
    changes: [['if (relatedCreditInvoices.size > 1)', 'if (false)']],
  },
  {
    name: 'f03-drop-exported-related-invoice',
    file: 'lib/reconciliation/io.ts',
    changes: [["        t.relatedInvoiceReference ?? '',", "        '',"]],
  },
  {
    name: 'f03-silent-unmatched-unverified-identity',
    file: 'lib/reconciliation/cases.ts',
    changes: [
      [
        "s.referenceEvidenceIssues?.length ? 'Needs Review' : 'Unmatched'",
        "'Unmatched'",
      ],
    ],
  },
  {
    name: 'unknown-credit-remove-role-review-gate',
    file: 'lib/reconciliation/transaction-references.ts',
    changes: [['  if (unverifiedCreditNumber)\n', '  if (false)\n']],
  },
  {
    name: 'unknown-credit-drop-native-audit-cue',
    file: 'lib/reconciliation/transaction-references.ts',
    changes: [['    ...(unverifiedCreditNumber\n', '    ...(false\n']],
  },
  {
    name: 'p5-bypass-canonical-explanation-check',
    file: 'lib/reconciliation/assistant.ts',
    changes: [
      [
        '    const { canonical } = proposalEvidence(result, true);',
        '    if (result) return true;\n    const { canonical } = proposalEvidence(result, true);',
      ],
    ],
  },
  {
    name: 'p5-drop-audit-identifier-lookup',
    file: 'lib/reconciliation/assistant.ts',
    changes: [
      [
        "      ...(t.retainedEvidence ?? [])\n        .filter((e) => e.field !== 'documentTypeLabel')\n        .map((e) => e.value),",
        '      /* Fault: lose audit-only lookup cues. */',
      ],
    ],
  },
  {
    name: 'p5-drop-native-cues-from-model-context',
    file: 'lib/reconciliation/local-ai.ts',
    changes: [
      [
        '      retainedEvidence: t.retainedEvidence,',
        '      retainedEvidence: undefined,',
      ],
    ],
  },
  {
    name: 'p5-disable-utf8-evidence-budget',
    file: 'lib/reconciliation/local-ai.ts',
    changes: [
      ['if (new TextEncoder().encode(data).byteLength > 32768)', 'if (false)'],
    ],
  },
  {
    name: 'p5-invent-model-case-total',
    file: 'lib/reconciliation/local-ai.ts',
    changes: [
      [
        '        supplierTotalMinor: c.supplierTotal,',
        '        supplierTotalMinor: c.supplierTotal + 1,',
      ],
    ],
  },
  {
    name: 'p5-ignore-bridge-delta-drift',
    file: 'lib/reconciliation/assistant.ts',
    changes: [
      ['        b.delta !== safeSum([s.closing!, -l.closing!]) ||\n', ''],
    ],
  },
  {
    name: 'corrupt-exported-amount',
    file: 'lib/reconciliation/io.ts',
    changes: [['t.amount / 10 ** dp,', '(t.amount + 1) / 10 ** dp,']],
  },
];

const args = process.argv.slice(2);
let filter = '';
let listOnly = false;
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--list' && !listOnly) {
    listOnly = true;
    continue;
  }
  if (arg === '--filter' && !filter) filter = args[++i] ?? '';
  else if (arg.startsWith('--filter=') && !filter)
    filter = arg.slice('--filter='.length);
  else
    throw Error(
      'Usage: node scripts/test-mutations.mjs [--filter name-substring] [--list]',
    );
  if (!filter || filter.startsWith('--'))
    throw Error('Mutation filter must not be empty or another option');
}
if (new Set(mutations.map(({ name }) => name)).size !== mutations.length)
  throw Error('Mutation names must be unique');

// CI divides the complete catalogue by its original position. Filtering never
// changes shard membership, and omitting MUTATION_SHARD still runs every fault.
const shardValue = process.env.MUTATION_SHARD;
let shard;
if (shardValue !== undefined) {
  const match = /^([1-9]\d*)\/([1-9]\d*)$/.exec(shardValue);
  if (!match) throw Error('MUTATION_SHARD must be a one-based index/count');
  const index = Number(match[1]);
  const count = Number(match[2]);
  if (
    !Number.isSafeInteger(index) ||
    !Number.isSafeInteger(count) ||
    index > count ||
    count > mutations.length
  )
    throw Error('MUTATION_SHARD requires 1 <= index <= count <= mutations');
  shard = { index, count };
}
const selectedMutations = mutations.filter(
  (mutation, index) =>
    (!shard || index % shard.count === shard.index - 1) &&
    mutation.name.includes(filter),
);
if (!selectedMutations.length)
  throw Error(
    `No mutation matches: ${filter}${shard ? ` in ${shardValue}` : ''}`,
  );
const selection = {
  total: selectedMutations.length,
  available: mutations.length,
  ...(filter ? { filter } : {}),
  ...(shard ? { shard } : {}),
};
// Dry inspection does not run the baseline, copy files or modify a source.
if (listOnly) {
  console.log(
    JSON.stringify(
      { ...selection, mutations: selectedMutations.map(({ name }) => name) },
      null,
      2,
    ),
  );
  process.exit(0);
}

function execute(cwd) {
  return spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--test',
      '--test-reporter=tap',
      ...(testConcurrency ? [`--test-concurrency=${testConcurrency}`] : []),
      // A wall-clock budget cannot prove that an accounting fault was caught.
      // This unchanged performance test still runs in the full unit gate.
      '--test-skip-pattern=^20k rows compare without quadratic candidate search$',
      ...tests,
    ],
    {
      cwd,
      encoding: 'utf8',
      timeout: 45000,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
}
// Resource controls affect scheduling and evidence retention only. They do not
// filter assertions, weaken accounting checks or change catalogue membership.
const concurrencyValue = process.env.MUTATION_TEST_CONCURRENCY;
const testConcurrency = concurrencyValue === undefined ? undefined : Number(concurrencyValue);
if (testConcurrency !== undefined &&
    (!Number.isSafeInteger(testConcurrency) || testConcurrency < 1 || testConcurrency > 4))
  throw Error('MUTATION_TEST_CONCURRENCY must be an integer from 1 to 4');
const output = process.env.MUTATION_OUTPUT_DIR
  ? resolve(process.env.MUTATION_OUTPUT_DIR)
  : undefined;
const reusePrivate = process.env.MUTATION_REUSE_PRIVATE_TREE === '1';
if (process.env.MUTATION_REUSE_PRIVATE_TREE !== undefined &&
    !['0', '1'].includes(process.env.MUTATION_REUSE_PRIVATE_TREE))
  throw Error('MUTATION_REUSE_PRIVATE_TREE must be 0 or 1');
if (output) {
  await mkdir(output, { recursive: true });
  // A completed or failed attempt is immutable; callers choose a new directory.
  await writeFile(join(output, 'catalogue.json'), JSON.stringify({
    ...selection,
    testConcurrency: testConcurrency ?? 'node-default',
    privateTreeMode: reusePrivate ? 'reuse-with-content-guards' : 'fresh-per-fault',
    mutations: selectedMutations.map(({ name, file }) => ({ name, file })),
  }, null, 2) + '\n', { flag: 'wx' });
}
const baseline = execute(root);
if (output) {
  await writeFile(join(output, 'baseline.log'), baseline.stdout + baseline.stderr);
  await writeFile(join(output, 'baseline.json'), JSON.stringify({
    status: baseline.status, signal: baseline.signal,
    ...(baseline.error ? { error: baseline.error.message } : {}),
  }, null, 2) + '\n');
}
if (!completedSuccessfully(baseline)) {
  process.stderr.write(baseline.stdout + baseline.stderr);
  throw Error(
    `Mutation gate requires a passing unmodified baseline (status=${baseline.status}, signal=${baseline.signal}, error=${baseline.error?.message ?? 'none'})`,
  );
}

const report = [];
async function copyInputs(scratch) {
  await Promise.all(['lib', 'tests', 'audit', 'package.json'].map((name) =>
    cp(join(root, name), join(scratch, name), {
      recursive: true, mode: constants.COPYFILE_FICLONE,
      // This gitignored installed runtime is a dependency link, never an audit
      // source. All actual audit inputs stay private; other links are rejected.
      filter: (source) => source !== join(root, 'audit/local-provider/node_modules'),
    }),
  ));
  await symlink(join(root, 'node_modules'), join(scratch, 'node_modules'), 'dir');
}
// F02 regression tests write five named artifacts. They are outputs, never inputs.
// Remove only these documented private outputs; reject any other leaked state.
async function cleanGeneratedOutputs(scratch) {
  const work = join(scratch, 'work');
  let stat;
  try { stat = await lstat(work); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  if (!stat.isDirectory() || (await readdir(work)).some((name) => name !== 'layered-headers'))
    throw Error('Mutation left unexpected private work output');
  const directory = join(work, 'layered-headers');
  const outputs = [];
  if ((await readdir(work)).length) {
    if (!(await lstat(directory)).isDirectory()) throw Error('Mutation output directory is not private');
    for (const name of await readdir(directory)) {
      if (!['large-reading.json', 'f02-workpaper.xlsx', 'r13-excluded-competitor.xlsx',
        'r13-fixed-workpaper.xlsx', 'r13-observation.json'].includes(name) ||
          !(await lstat(join(directory, name))).isFile())
        throw Error(`Mutation left unexpected generated output: ${name}`);
      const bytes = await readFile(join(directory, name));
      outputs.push({ path: `work/layered-headers/${name}`, bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex') });
    }
    await rm(directory, { recursive: true });
  }
  await rmdir(work);
  return outputs;
}
// Reuse is opt-in and keeps a full PRIVATE tree. A fresh Node test process runs
// each fault. Every input file is content-hashed after restoration, so disk state
// cannot leak between faults; no shared/symlinked audit source can bypass a fault.
async function inputDigest(scratch) {
  const paths = [];
  const directories = ['lib', 'tests', 'audit'];
  const expectedTop = new Set(['lib', 'tests', 'audit', 'package.json', 'node_modules']);
  if ((await readdir(scratch)).some((name) => !expectedTop.has(name)))
    throw Error('Mutation test left unexpected private workspace state');
  async function walk(relative) {
    for (const file of await readdir(join(scratch, relative), { withFileTypes: true })) {
      const path = join(relative, file.name);
      if (file.isDirectory()) { directories.push(path); await walk(path); }
      else if (file.isFile()) paths.push(path);
      else throw Error(`Unsupported mutation input type: ${path}`);
    }
  }
  for (const directory of ['lib', 'tests', 'audit']) await walk(directory);
  paths.push('package.json');
  paths.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  directories.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  if (paths.some((path) => /[\r\n"]/.test(path)))
    throw Error('Unsupported mutation input path');
  const hashes = spawnSync('git', ['hash-object', '--stdin-paths'], {
    cwd: scratch, encoding: 'utf8', input: paths.join('\n') + '\n',
    timeout: 120000, maxBuffer: 16 * 1024 * 1024,
  });
  if (!completedSuccessfully(hashes)) throw Error(`Mutation input hashing failed: ${hashes.stderr}`);
  return {
    files: paths.length,
    directories: directories.length,
    sha256: createHash('sha256').update(directories.join('\n')).update('\0')
      .update(paths.join('\n')).update('\0').update(hashes.stdout).digest('hex'),
  };
}
const reusable = reusePrivate ? await createPrivateTree(true) : undefined;
let expectedInputs;
try {
if (reusable) {
  await copyInputs(reusable);
  expectedInputs = await inputDigest(reusable);
  if (output) await writeFile(join(output, 'private-inputs.json'), JSON.stringify(expectedInputs, null, 2) + '\n');
}
for (const mutation of selectedMutations) {
  const scratch = reusable ?? await createPrivateTree();
  let originalSource;
  let faultError;
  let restorationError;
  let faultFailed = false;
  let restorationFailed = false;
  try {
    if (!reusable) await copyInputs(scratch);
    const file = join(scratch, mutation.file);
    let source = await readFile(file, 'utf8');
    originalSource = source;
    for (const [before, after] of mutation.changes) {
      // Some accounting statements span multiple lines after formatting. Match
      // their syntax with a bounded regex while retaining exact uniqueness.
      const count =
        before instanceof RegExp
          ? [...source.matchAll(new RegExp(before.source, 'g'))].length
          : source.split(before).length - 1;
      if (count !== 1) {
        if (output) {
          await writeFile(join(output, `${mutation.name}.source`), source);
          await writeFile(join(output, `${mutation.name}.invalid.json`), JSON.stringify({
            mutation: mutation.name, detected: false, phase: 'anchor', count,
          }, null, 2) + '\n');
        }
        throw Error(`Stale or non-unique mutation anchor: ${mutation.name}`);
      }
      // Text is inserted literally: "$`" or "$'" in a mutant's text must not
      // act as a replacement pattern. A mutant that keeps the matched text
      // says so with a function of the match.
      source = source.replace(
        before,
        typeof after === 'function' ? after : () => after,
      );
    }
    await writeFile(file, source);
    if (output) await writeFile(join(output, `${mutation.name}.source`), source);
    // A parser error is an invalid mutant, not evidence that an accounting
    // assertion detected the intended fault. Check syntax before the test run.
    const syntax = spawnSync(
      process.execPath,
      ['--experimental-strip-types', '--check', file],
      {
        cwd: scratch,
        encoding: 'utf8',
        timeout: 10000,
      },
    );
    if (output) {
      await writeFile(join(output, `${mutation.name}.syntax.log`), syntax.stdout + syntax.stderr);
      await writeFile(join(output, `${mutation.name}.syntax.json`), JSON.stringify({
        status: syntax.status, signal: syntax.signal,
        ...(syntax.error ? { error: syntax.error.message } : {}),
      }, null, 2) + '\n');
    }
    if (!completedSuccessfully(syntax)) {
      if (output) await writeFile(join(output, `${mutation.name}.invalid.json`), JSON.stringify({
        mutation: mutation.name, detected: false, phase: 'syntax', status: syntax.status,
      }, null, 2) + '\n');
      throw Error(
        `Invalid mutation syntax: ${mutation.name}\n${syntax.stdout}${syntax.stderr}`,
      );
    }
    const result = execute(scratch);
    const assertionFailure = isAssertionKill(result);
    const record = { mutation: mutation.name, detected: assertionFailure,
      status: result.status, signal: result.signal,
      ...(result.error ? { error: result.error.message } : {}),
    };
    report.push(record);
    if (output) {
      await writeFile(join(output, `${mutation.name}.log`), result.stdout + result.stderr);
      await writeFile(join(output, `${mutation.name}.source`), source);
      await writeFile(join(output, 'results.json'), JSON.stringify({
        baselinePassed: true, ...selection, mutations: report,
      }, null, 2) + '\n');
    }
    if (!assertionFailure) {
      process.stderr.write(result.stdout + result.stderr);
      throw Error(
        `Fault survived or failed without an assertion: ${mutation.name}`,
      );
    }
    console.log(`Detected deliberate fault: ${mutation.name}`);
  } catch (error) {
    faultFailed = true;
    faultError = error;
  } finally {
    try {
    if (reusable) {
      if (originalSource !== undefined) await writeFile(join(scratch, mutation.file), originalSource);
      const outputs = await cleanGeneratedOutputs(scratch);
      if (output) await writeFile(join(output, `${mutation.name}.outputs.json`), JSON.stringify(outputs, null, 2) + '\n');
      const restored = await inputDigest(scratch);
      if (restored.sha256 !== expectedInputs.sha256 || restored.files !== expectedInputs.files) {
        restorationFailed = true;
        restorationError = Error(`Mutation changed private input state: ${mutation.name}`);
      } else if (output) await writeFile(join(output, `${mutation.name}.restored.json`), JSON.stringify(restored, null, 2) + '\n');
    } else await removePrivateTree(scratch);
    } catch (error) {
      restorationFailed = true;
      restorationError = error;
    }
  }
  if (faultFailed && restorationFailed) throw new AggregateError([faultError, restorationError], 'Mutation and private input restoration both failed');
  if (faultFailed) throw faultError;
  if (restorationFailed) throw restorationError;
}
} finally {
  if (reusable) await removePrivateTree(reusable);
}
console.log(
  JSON.stringify(
    {
      baselinePassed: true,
      detected: report.length,
      ...selection,
      mutations: report,
    },
    null,
    2,
  ),
);
