// UX-10(c) interface mutations: each planted defect in the evidence thread
// (the drawer's place over the page, its side, width and height, its motion
// and reduced motion, Escape, its named region and focused heading, the way
// back that closes it on the movement's own page, the marked row, the way in
// that names its movement and says the drawer is open, what closes it, and
// what it says of the source) is built into a private copy of the
// application, and the evidence thread check
// (scripts/evidence-thread-browser.mjs, against that build) must fail with an
// assertion. It passes on the unmutated build first. A survivor is behaviour
// no browser check holds. UX-10(d) adds the fixed assets, the payroll and the
// inventory's register rows that do not link, the GL and TB balance
// components, the clearing cases, the receivables cases, the lines of the
// financial position, the intercompany pairs, the payment gateway's
// totals and residuals and the supplier's cases: whose row the drawer
// opens, the roles, the file, the heading or the figures, the way in that
// names its row, the marked row,
// card (its frame and the frame's motion) or section heading (its shade and
// its motion), the financial lines' and the pairs' way back to their own
// page, a decision that leaves the old evidence open, and the supplier's
// way back to the case's page and the list change or step that closes it.
//
// Not planted: the drawer's motion outside its reduced-motion guard. The
// page's own rule (app/globals.css) sets every animation to none under
// reduced motion, so that mutant draws the same page; it survived its first
// run as an equivalent mutant (docs/audits/UX-10-EVIDENCE-THREAD.ar.md §9).
// Nor the shared hook's return to the row's page: the comparison tables of
// the asset and payroll examples hold one page, so no check can see it there
// (the bank's own way back to its page is planted above). The clearing
// example's five cases hold one page too, so its own way back to the case's
// page is not planted either.
//   node scripts/test-evidence-thread-interface-mutations.mjs
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  createPrivateTree,
  removePrivateTree,
  completedSuccessfully,
  describeRun,
  isAssertionKill,
} from './mutation-runner-support.mjs';

const root = resolve(import.meta.dirname, '..');
const output =
  process.env.EVIDENCE_THREAD_MUTATION_DIR ??
  join(root, 'work/evidence-thread-interface-mutations');
await mkdir(output, { recursive: true });
const out = await mkdtemp(join(output, 'run-'));
const acceptance = 'scripts/evidence-thread-browser.mjs';
const DRAWER = 'components/evidence-drawer.tsx';
const STYLE = 'components/evidence-drawer.css';
const BANK = 'components/bank-workspace.tsx';
const ASSETS = 'components/fixed-assets-workspace.tsx';
const PAYROLL = 'components/payroll-workspace.tsx';
const STOCK = 'components/inventory-register-workspace.tsx';
const GLTB = 'components/gl-tb-workspace.tsx';
const CLEARING = 'components/clearing-workspace.tsx';
const AR = 'components/ar-workspace.tsx';
const FINANCIAL = 'components/tb-financial-workspace.tsx';
const INTERCOMPANY = 'components/intercompany-workspace.tsx';
const GATEWAY = 'components/payment-gateway-workspace.tsx';
const PAGE = 'app/page.tsx';
const HOOK = 'hooks/use-evidence-thread.ts';
const mutations = [
  [
    'drawer-in-the-page',
    STYLE,
    `  position: fixed;
  z-index: 35;`,
    `  position: static;
  z-index: 35;`,
  ],
  [
    'drawer-at-the-start',
    STYLE,
    `  inset-inline-end: 0;
  inline-size: 420px;`,
    `  inset-inline-start: 0;
  inline-size: 420px;`,
  ],
  ['drawer-too-wide', STYLE, 'inline-size: 420px;', 'inline-size: 640px;'],
  ['sheet-too-tall', STYLE, 'max-block-size: 70vh;', 'max-block-size: 90vh;'],
  [
    'sheet-covers-the-page',
    STYLE,
    '    scroll-padding-block-end: 70vh;',
    '    scroll-padding-block-end: 0;',
  ],
  [
    'motion-too-slow',
    STYLE,
    'animation: evidence-drawer-in 160ms ease-out;',
    'animation: evidence-drawer-in 600ms ease-out;',
  ],
  [
    'escape-ignored',
    DRAWER,
    `    element?.addEventListener('keydown', escape);
`,
    '',
  ],
  [
    'region-unnamed',
    DRAWER,
    `      aria-labelledby={\`\${id}-heading\`}
`,
    '',
  ],
  [
    'heading-not-focusable',
    DRAWER,
    'ref={headingRef} tabIndex={-1}',
    'ref={headingRef}',
  ],
  [
    'another-row-named',
    DRAWER,
    '<dd data-thread-row={s.place.row}>{s.place.row}</dd>',
    '<dd data-thread-row={s.place.row}>{s.place.row - 1}</dd>',
  ],
  [
    'header-for-text',
    DRAWER,
    `              c.column,
              c.text,`,
    `              c.column,
              c.field,`,
  ],
  [
    'focus-stays-on-the-row',
    BANK,
    `    setFocusRequest({ to: 'evidence', id: record });
`,
    '',
  ],
  [
    'way-back-keeps-it-open',
    BANK,
    `    setFocusRequest({ to: 'row', id: evidenceId });
    setEvidenceId('');`,
    `    setFocusRequest({ to: 'row', id: evidenceId });`,
  ],
  [
    'way-back-keeps-the-page',
    BANK,
    `    setPages((p) => ({ ...p, movements: pageOfRow(index) }));
    setFocusRequest({ to: 'row', id: evidenceId });`,
    `    setFocusRequest({ to: 'row', id: evidenceId });`,
  ],
  [
    'row-not-marked',
    BANK,
    "                      ? { 'data-thread-open': '' }",
    '                      ? undefined',
  ],
  [
    'way-in-unnamed',
    BANK,
    `                        {' · '}
                        {r.reference}`,
    '',
  ],
  [
    'open-not-said',
    BANK,
    `                      aria-expanded={evidenceId === r.id}
`,
    '',
  ],
  [
    'drawer-not-named',
    BANK,
    '                        evidenceId === r.id ? drawerId : undefined',
    '                        undefined',
  ],
  [
    'type-change-keeps-it',
    BANK,
    `    if (!movementsShown) setEvidenceId('');
`,
    '',
  ],
  [
    'new-result-keeps-it',
    BANK,
    `    setResult(v.result);
    setPages({});
    setBankId('');
    setCashId('');
    setEvidenceId('');`,
    `    setResult(v.result);
    setPages({});
    setBankId('');
    setCashId('');`,
  ],
  [
    'amount-left-out',
    BANK,
    `                    amount={amount(evidence.signed)}
`,
    '',
  ],
  [
    'thread-of-another-movement',
    BANK,
    'thread={bankThread(result, evidence.id)}',
    'thread={bankThread(result, result.records[0].id)}',
  ],
  // UX-10(d): the fixed assets and the payroll, through the shared hook.
  [
    'asset-thread-of-the-first-comparison',
    ASSETS,
    `                    opened.at,
`,
    `                    0,
`,
  ],
  [
    'asset-roles-all-register',
    ASSETS,
    'role={(s) => copy.roles[s.source]}',
    'role={() => copy.roles[0]}',
  ],
  [
    'asset-difference-figure-left-out',
    ASSETS,
    '[copy.comparisons[5], opened.row.difference],',
    '[copy.comparisons[5], opened.row.register],',
  ],
  [
    'payroll-bank-rows-left-out',
    PAYROLL,
    'thread={payrollBankThread(result, labels)}',
    'thread={[]}',
  ],
  [
    'payroll-thread-of-the-first-comparison',
    PAYROLL,
    'thread={payrollThread(result, labels, thread.open.at)}',
    'thread={payrollThread(result, labels, 0)}',
  ],
  // The inventory's register rows that do not link (UX-10(d)).
  [
    'stock-thread-of-the-table-row-not-its-link',
    STOCK,
    `                          opened.at,
`,
    `                          unlinkedLinks.indexOf(opened),
`,
  ],
  [
    'stock-way-opens-the-first-row',
    STOCK,
    "onClick={() => thread.show('unlinked', i)}",
    "onClick={() => thread.show('unlinked', 0)}",
  ],
  [
    'stock-roles-all-register',
    STOCK,
    'role={(s) => copy.roles[s.source]}',
    'role={() => copy.roles[0]}',
  ],
  [
    'stock-heading-without-dimensions',
    STOCK,
    'heading={`${words.heading} · ${opened.link.item} · ${opened.link.dimensions}`}',
    'heading={`${words.heading} · ${opened.link.item}`}',
  ],
  [
    'stock-way-does-not-name-its-row',
    STOCK,
    `                        <span className="sr-only">
                          {' · '}
                          {l.item} · {l.dimensions}
                        </span>
`,
    '',
  ],
  [
    'stock-row-not-marked',
    STOCK,
    "                      ...thread.mark('unlinked', i),\n",
    '',
  ],
  // The GL and TB balance components (UX-10(d)).
  [
    "gltb-thread-of-the-first-component",
    GLTB,
    "        ? BALANCE_FIELDS[thread.open.at]\n",
    "        ? BALANCE_FIELDS[0]\n",
  ],
  [
    "gltb-way-opens-the-first-row",
    GLTB,
    "onClick={() => thread.show('balances', i)}",
    "onClick={() => thread.show('balances', 0)}",
  ],
  [
    "gltb-roles-all-gl",
    GLTB,
    "role={(s) => t.sides[s.source]}",
    "role={() => t.sides[0]}",
  ],
  [
    "gltb-difference-figure-left-out",
    GLTB,
    "[t.difference, result.differences?.[opened]],",
    "[t.difference, result.gl?.[opened]],",
  ],
  [
    "gltb-way-does-not-name-its-row",
    GLTB,
    "                <span className=\"sr-only\">\n                  {' · '}\n                  {t.components[field]}\n                </span>\n",
    "",
  ],
  [
    "gltb-row-not-marked",
    GLTB,
    "            mark={(_, i) => thread.mark('balances', i)}\n",
    "",
  ],
  [
    'clearing-heading-of-the-first-case',
    CLEARING,
    '        ? { at: thread.open.at, case: result.cases[thread.open.at] }\n',
    '        ? { at: thread.open.at, case: result.cases[0] }\n',
  ],
  [
    'clearing-way-opens-the-first-case',
    CLEARING,
    "onClick={() => thread.show('cases', at)}",
    "onClick={() => thread.show('cases', 0)}",
  ],
  [
    'clearing-rows-of-the-next-case',
    CLEARING,
    "thread={clearingThread(result, file?.name ?? '', opened.at)}",
    "thread={clearingThread(result, file?.name ?? '', opened.at + 1)}",
  ],
  [
    'clearing-file-not-named',
    CLEARING,
    "thread={clearingThread(result, file?.name ?? '', opened.at)}",
    "thread={clearingThread(result, '', opened.at)}",
  ],
  [
    'clearing-net-of-the-account',
    CLEARING,
    'items={[[t.net, opened.case.net]]}',
    'items={[[t.net, result.total]]}',
  ],
  [
    'clearing-way-not-named',
    CLEARING,
    "                  <span className=\"sr-only\">\n                    {' · '}\n                    {c.ids.map((id) => owners.get(id)?.posting).join(', ')}\n                  </span>\n",
    '',
  ],
  [
    'clearing-case-not-marked',
    CLEARING,
    "                ...thread.mark('cases', at),\n",
    '',
  ],
  // The workspace tells the hook nothing that changes with the result, so a
  // decision leaves the old evidence open. Its first plant passed the file
  // instead, and survived as an equivalent mutant: each reply from the
  // worker installs a new file object with the new result
  // (docs/audits/UX-10-EVIDENCE-THREAD.ar.md §13).
  [
    'clearing-decision-keeps-it',
    CLEARING,
    '  const thread = useEvidenceThread(active, result),',
    '  const thread = useEvidenceThread(active, null),',
  ],
  [
    'ar-heading-of-the-first-case',
    AR,
    '        ? { at: thread.open.at, case: result.cases[thread.open.at] }\n',
    '        ? { at: thread.open.at, case: result.cases[0] }\n',
  ],
  [
    'ar-way-opens-the-first-case',
    AR,
    "onClick={() => thread.show('cases', casesShown.from + i)}",
    "onClick={() => thread.show('cases', 0)}",
  ],
  [
    'ar-movements-of-the-next-case',
    AR,
    'thread={arThread(result, opened.at)}',
    'thread={arThread(result, opened.at + 1)}',
  ],
  [
    'ar-every-movement-from-the-ledger',
    AR,
    'role={(s) => t.sides[s.source]}',
    'role={() => t.sides[0]}',
  ],
  [
    'ar-way-not-named',
    AR,
    "                    <span className=\"sr-only\">\n                      {' · '}\n                      {t.kind[c.kind]}: {c.document}\n                    </span>\n",
    '',
  ],
  [
    'ar-case-not-marked',
    AR,
    "                {...thread.mark('cases', casesShown.from + i)}\n",
    '',
  ],
  [
    'ar-decision-keeps-it',
    AR,
    '  const thread = useEvidenceThread(active, result),',
    '  const thread = useEvidenceThread(active, null),',
  ],
  [
    'card-not-framed',
    STYLE,
    `article[data-thread-open] {
  box-shadow: 0 0 0 2px var(--focus-ring);
}`,
    `article[data-thread-open] {
}`,
  ],
  [
    'card-frame-without-motion',
    STYLE,
    '    animation: evidence-card-in 160ms ease-out;\n',
    '',
  ],
  [
    "fin-no-way-in",
    FINANCIAL,
    "                <div className=\"gl-tb-actions\">\n                  <Button\n                    variant=\"outline\"\n                    {...thread.way('lines', linesShown.from + i)}\n                    onClick={() => thread.show('lines', linesShown.from + i)}\n                  >\n                    {words.way}\n                    <span className=\"sr-only\">\n                      {' · '}\n                      {l.lineId} · {l.label}\n                    </span>\n                  </Button>\n                </div>\n",
    "",
  ],
  [
    "fin-way-not-named",
    FINANCIAL,
    "                    <span className=\"sr-only\">\n                      {' · '}\n                      {l.lineId} · {l.label}\n                    </span>\n",
    "",
  ],
  [
    "fin-way-opens-the-first-line",
    FINANCIAL,
    "onClick={() => thread.show('lines', linesShown.from + i)}",
    "onClick={() => thread.show('lines', 0)}",
  ],
  [
    "fin-line-not-marked",
    FINANCIAL,
    "                {...thread.mark('lines', linesShown.from + i)}\n",
    "",
  ],
  [
    "fin-rows-of-the-next-line",
    FINANCIAL,
    "thread={financialThread(result, opened.at)}",
    "thread={financialThread(result, opened.at + 1)}",
  ],
  [
    "fin-every-row-from-the-trial-balance",
    FINANCIAL,
    "role={(s) => t.financial.roles[s.source]}",
    "role={() => t.financial.roles[0]}",
  ],
  [
    "fin-way-back-keeps-the-page",
    FINANCIAL,
    "                  setLinePage(pageOfRow(opened.at));\n",
    "",
  ],
  [
    "fin-figures-cut",
    FINANCIAL,
    "                      [t.financial.lineFigures[2], opened.line.difference],\n",
    "",
  ],
  [
    "fin-heading-without-label",
    FINANCIAL,
    "heading={`${words.heading} · ${opened.line.lineId} · ${opened.line.label}`}",
    "heading={`${words.heading} · ${opened.line.lineId}`}",
  ],
  [
    "fin-decision-keeps-it",
    FINANCIAL,
    "  const thread = useEvidenceThread(active, result),\n    words = evidenceThreadCopy[lang],\n    opened =\n      result && thread.open?.table === 'lines'",
    "  const thread = useEvidenceThread(active, null),\n    words = evidenceThreadCopy[lang],\n    opened =\n      result && thread.open?.table === 'lines'",
  ],
  [
    "line-heading-not-marked",
    STYLE,
    "tr[data-thread-open] > *,\nsection[data-thread-open] > h3 {\n  background",
    "tr[data-thread-open] > * {\n  background",
  ],
  [
    "line-mark-without-motion",
    STYLE,
    "  tr[data-thread-open] > *,\n  section[data-thread-open] > h3 {\n    animation",
    "  tr[data-thread-open] > * {\n    animation",
  ],
  [
    "ic-no-way-in",
    INTERCOMPANY,
    "                <div className=\"gl-tb-actions\">\n                  <Button\n                    variant=\"outline\"\n                    {...thread.way('pairs', pairsShown.from + i)}\n                    onClick={() => thread.show('pairs', pairsShown.from + i)}\n                  >\n                    {words.way}\n                    <span className=\"sr-only\">\n                      {' · '}\n                      {p.relationId}\n                    </span>\n                  </Button>\n                </div>\n",
    "",
  ],
  [
    "ic-way-not-named",
    INTERCOMPANY,
    "                    <span className=\"sr-only\">\n                      {' · '}\n                      {p.relationId}\n                    </span>\n",
    "",
  ],
  [
    "ic-way-opens-the-first-pair",
    INTERCOMPANY,
    "onClick={() => thread.show('pairs', pairsShown.from + i)}",
    "onClick={() => thread.show('pairs', 0)}",
  ],
  [
    "ic-pair-not-marked",
    INTERCOMPANY,
    "                {...thread.mark('pairs', pairsShown.from + i)}\n",
    "",
  ],
  [
    "ic-rows-of-the-next-pair",
    INTERCOMPANY,
    "thread={intercompanyThread(result, opened.at)}",
    "thread={intercompanyThread(result, opened.at + 1)}",
  ],
  [
    "ic-every-row-from-the-left-ledger",
    INTERCOMPANY,
    "role={(s) => copy.roles[s.source]}",
    "role={() => copy.roles[0]}",
  ],
  [
    "ic-way-back-keeps-the-page",
    INTERCOMPANY,
    "                  setPairPage(pageOfRow(opened.at));\n",
    "",
  ],
  [
    "ic-figures-cut",
    INTERCOMPANY,
    "                      [copy.residualFigures[2], opened.pair.residual],\n",
    "",
  ],
  [
    "ic-heading-without-pair",
    INTERCOMPANY,
    "heading={`${words.heading} · ${opened.pair.relationId}`}",
    "heading={words.heading}",
  ],
  [
    "ic-decision-keeps-it",
    INTERCOMPANY,
    "  const thread = useEvidenceThread(active, result),\n    words = evidenceThreadCopy[lang],\n    opened =\n      result && thread.open?.table === 'pairs'",
    "  const thread = useEvidenceThread(active, null),\n    words = evidenceThreadCopy[lang],\n    opened =\n      result && thread.open?.table === 'pairs'",
  ],
  [
    "gw-totals-no-way-in",
    GATEWAY,
    "? [[wayIn('totals'), ...amounts(result.totals)]]",
    "? [['', ...amounts(result.totals)]]",
  ],
  [
    "gw-residuals-no-way-in",
    GATEWAY,
    "? [[wayIn('residuals'), ...amounts(result.residuals)]]",
    "? [['', ...amounts(result.residuals)]]",
  ],
  [
    "gw-way-not-named",
    GATEWAY,
    "      <span className=\"sr-only\">\n        {' · '}\n        {result?.scope.batchId} · {copy.tableNames[table]}\n      </span>\n",
    "",
  ],
  [
    "gw-way-opens-the-totals",
    GATEWAY,
    "onClick={() => thread.show(table, 0)}",
    "onClick={() => thread.show('totals', 0)}",
  ],
  [
    "gw-row-not-marked",
    GATEWAY,
    "              marks={[thread.mark('residuals', 0)]}\n",
    "",
  ],
  [
    "gw-rows-of-the-totals",
    GATEWAY,
    "thread={gatewayThread(result, opened)}",
    "thread={gatewayThread(result, 'totals')}",
  ],
  [
    "gw-every-row-from-the-transactions",
    GATEWAY,
    "                  thread={gatewayThread(result, opened)}\n                  role={(s) => copy.roles[s.source]}",
    "                  thread={gatewayThread(result, opened)}\n                  role={() => copy.roles[0]}",
  ],
  [
    "gw-figures-of-the-totals",
    GATEWAY,
    "items={copy[opened].map((label, i) => [label, figures[i]])}",
    "items={copy.totals.map((label, i) => [label, result.totals?.[i]])}",
  ],
  [
    "gw-heading-without-batch",
    GATEWAY,
    "heading={`${words.heading} · ${result.scope.batchId} · ${copy.tableNames[opened]}`}",
    "heading={`${words.heading} · ${copy.tableNames[opened]}`}",
  ],
  [
    "gw-decision-keeps-it",
    GATEWAY,
    "  const thread = useEvidenceThread(active, result),\n    words = evidenceThreadCopy[lang],\n    opened = result && thread.open",
    "  const thread = useEvidenceThread(active, null),\n    words = evidenceThreadCopy[lang],\n    opened = result && thread.open",
  ],
  [
    "sup-list-not-headed",
    PAGE,
    "                                <TableHead>{threadWords.way}</TableHead>\n",
    "",
  ],
  [
    "sup-way-not-named",
    PAGE,
    "                                          <span className=\"sr-only\">\n                                            {' · '}\n                                            {t.app.sideShort[tx.side]} ·{' '}\n                                            {tx.row}\n                                          </span>\n",
    "",
  ],
  [
    "sup-way-opens-the-first-row",
    PAGE,
    "thread.show('transactions', at)",
    "thread.show('transactions', 0)",
  ],
  [
    "sup-row-not-marked",
    PAGE,
    "                                      {...thread.mark('transactions', at)}\n",
    "",
  ],
  [
    "sup-heading-without-row",
    PAGE,
    "heading={`${threadWords.heading} · ${t.app.sideShort[threadOpen.side]} · ${threadOpen.row}`}",
    "heading={`${threadWords.heading} · ${t.app.sideShort[threadOpen.side]}`}",
  ],
  [
    "sup-back-stays-on-the-page",
    PAGE,
    "                            if (shown >= 0) setPage(pageOfRow(shown, 30));\n",
    "",
  ],
  [
    "sup-amount-of-the-ledger",
    PAGE,
    "                                    threadCase.supplierMembers.length\n                                      ? threadCase.supplierTotal\n                                      : threadCase.ledgerTotal,",
    "                                    threadCase.ledgerTotal,",
  ],
  [
    "sup-trace-of-the-first-row",
    PAGE,
    "                              files,\n                              threadOpen.id,\n",
    "                              files,\n                              result.supplier.transactions[0].id,\n",
  ],
  [
    "sup-files-swapped",
    PAGE,
    "                            thread={supplierThread(\n                              result,\n                              files,\n",
    "                            thread={supplierThread(\n                              result,\n                              [files[1], files[0]],\n",
  ],
  [
    "sup-role-of-the-statement",
    PAGE,
    "                              t.app.sideShort[s.role as 'supplier' | 'ledger']",
    "                              t.app.sideShort.supplier",
  ],
  [
    "sup-tab-keeps-it",
    PAGE,
    "    () => ({ result, tab, query }),\n    [result, tab, query],",
    "    () => ({ result }),\n    [result],",
  ],
  [
    "sup-step-keeps-it",
    PAGE,
    "      domain === 'supplier' && step === 2,",
    "      domain === 'supplier',",
  ],
  [
    'hook-keeps-it-on-type-change',
    HOOK,
    `    setSeen({ shown, result });
    setOpen(null);`,
    `    setSeen({ shown, result });`,
  ],
  [
    'hook-way-back-keeps-it-open',
    HOOK,
    `      setFocus({ ...open, to: 'row' });
      setOpen(null);`,
    `      setFocus({ ...open, to: 'row' });`,
  ],
  [
    'hook-focus-stays',
    HOOK,
    '    element?.focus({ preventScroll: true });',
    '',
  ],
  [
    'hook-drawer-not-named',
    HOOK,
    "'aria-controls': isOpen(table, at) ? id : undefined,",
    "'aria-controls': undefined,",
  ],
  [
    'hook-row-not-marked',
    HOOK,
    "isOpen(table, at) ? { 'data-thread-open': '' } : undefined,",
    'undefined,',
  ],
];
const buildInputs = [
  'app',
  'components',
  'hooks',
  'lib',
  'public',
  'styles',
  'scripts',
  'index.html',
  'main.tsx',
  'package.json',
  'vite.config.ts',
  'tsconfig.json',
  'components.json',
];
// The application also bundles demonstration fixtures from audit/; copy the
// directories its source imports, found by reading that source.
const auditDirs = new Set();
for (const dir of ['app', 'components', 'hooks', 'lib'])
  for (const entry of await readdir(join(root, dir), {
    recursive: true,
    withFileTypes: true,
  }))
    if (entry.isFile() && /\.(tsx?|mjs)$/.test(entry.name))
      for (const m of (
        await readFile(join(entry.parentPath, entry.name), 'utf8')
      ).matchAll(/['"](?:\.\.\/)+audit\/([^/'"]+)\//g))
        auditDirs.add(`audit/${m[1]}`);
buildInputs.push(...[...auditDirs].sort((a, b) => a.localeCompare(b)));
const faults = mutations;
const files = [...new Set(faults.map(([, file]) => file)), acceptance];
const digest = (b) => createHash('sha256').update(b).digest('hex');
const before = Object.fromEntries(
  await Promise.all(
    files.map(async (p) => [p, digest(await readFile(join(root, p)))]),
  ),
);
const options = (cwd) => ({
  cwd,
  encoding: 'utf8',
  timeout: 600000,
  maxBuffer: 64 * 1024 * 1024,
});
function build(tree) {
  for (const step of [
    ['scripts/prepare-native-pdf.mjs'],
    ['scripts/prepare-ocr-assets.mjs'],
    ['node_modules/vite/bin/vite.js', 'build', '--configLoader', 'runner'],
    ['scripts/harden-build.mjs'],
  ]) {
    const r = spawnSync(process.execPath, step, options(tree));
    if (!completedSuccessfully(r)) return r;
  }
  return null;
}
const accept = (tree) =>
  spawnSync(process.execPath, [acceptance], {
    ...options(root),
    env: {
      ...process.env,
      EVIDENCE_THREAD_DIST: join(tree, 'dist'),
      EVIDENCE_THREAD_DIR: join(tree, 'work/evidence-thread'),
    },
  });
const run = (tree) => {
  const failed = build(tree);
  if (failed) return { ...failed, buildFailed: true };
  return accept(tree);
};
const log = (name, r) =>
  writeFile(join(out, name + '.log'), (r.stdout ?? '') + (r.stderr ?? ''));
async function privateTree() {
  const tree = await createPrivateTree();
  for (const name of buildInputs)
    await cp(join(root, name), join(tree, name), { recursive: true });
  await symlink(join(root, 'node_modules'), join(tree, 'node_modules'), 'dir');
  return tree;
}
const report = { baselinePassed: false, mutations: [], passed: false };
{
  const tree = await privateTree();
  try {
    const baseline = run(tree);
    await log('baseline', baseline);
    report.baselinePassed = completedSuccessfully(baseline);
    if (!report.baselinePassed)
      process.stderr.write(describeRun('baseline', baseline, 'failed'));
  } finally {
    await removePrivateTree(tree);
  }
}
if (report.baselinePassed)
  for (const [id, file, from, to] of faults) {
    const tree = await privateTree();
    try {
      const target = join(tree, file);
      const text = await readFile(target, 'utf8');
      if (text.split(from).length !== 2)
        throw Error('Mutation anchor drift: ' + id);
      await writeFile(target, text.replace(from, to));
      const result = run(tree);
      await log(id, result);
      // A mutant that does not build is not a caught behaviour.
      const killed = !result.buildFailed && isAssertionKill(result);
      if (!killed)
        process.stderr.write(describeRun(id, result, 'was not caught'));
      report.mutations.push({
        id,
        file,
        killed,
        buildFailed: !!result.buildFailed,
        exitCode: result.status,
        signal: result.signal,
        error: result.error?.message ?? null,
      });
    } catch (error) {
      process.stderr.write(`${id} did not run: ${error.stack}\n`);
      report.mutations.push({
        id,
        file,
        killed: false,
        infrastructureError: error.message,
      });
    } finally {
      await removePrivateTree(tree);
    }
  }
for (const [p, hash] of Object.entries(before))
  if (digest(await readFile(join(root, p))) !== hash)
    throw Error('Mutation touched source');
report.passed =
  report.baselinePassed &&
  report.mutations.length === mutations.length &&
  report.mutations.every((r) => r.killed);
await writeFile(join(out, 'checks.json'), JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    {
      out,
      baselinePassed: report.baselinePassed,
      killed: report.mutations.filter((r) => r.killed).length,
      total: mutations.length,
      survivors: report.mutations.filter((r) => !r.killed).map((r) => r.id),
    },
    null,
    2,
  ),
);
if (!report.passed) process.exitCode = 1;
