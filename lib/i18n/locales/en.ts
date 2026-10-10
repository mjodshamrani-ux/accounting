import type { Messages } from '../messages';

// English interface copy. Typed against the Arabic catalogue, so a missing or
// extra key does not compile. Written as English, not translated word by word:
// same meaning, same warnings, same level of certainty.
// The two sources: as a label, and as they read inside a sentence.
const sides = ['Supplier statement', 'Accounts payable report'];
const inSentence = ['the supplier statement', 'the AP report'];
const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

export const en: Messages = {
  bank: {
    sourceFields: {
      'Record ID': 'Record ID',
      'Settlement ID': 'Settlement ID',
      'Movement date': 'Movement date',
      'Value date': 'Value date',
      'Cash direction': 'Cash direction',
      Role: 'Role',
      'Parent payment ID': 'Parent payment ID',
      'Reverses record ID': 'Reverses record ID',
      Policy: 'Policy',
      Status: 'Status',
      Entity: 'Entity',
      Ledger: 'Ledger',
      'Bank account': 'Bank account',
      Currency: 'Currency',
      'Period start': 'Period start',
      'Period end': 'Period end',
      Amount: 'Amount',
    },
    entry: 'Bank movements',
    title: 'Bank and cashbook movements',
    back: 'Supplier reconciliation',
    intro:
      'Compare one bank account in one currency and period with the owner’s cashbook. Local source identities and explicit financial roles are required.',
    claim:
      'This compares movements only. Opening and closing balances, a balance bridge, source authenticity and period completeness remain separate. Matching a movement keeps its outside-period value-date item.',
    limits:
      'First family: CSV/XLSX with the exact English role headers in the synthetic example. Inflow and outflow use the company’s cash perspective on both sides. Bank rows are booked; cashbook rows are posted. No inferred fees or tax rates, currency conversion, partial reversal or subset of a source settlement.',
    sample: 'Open synthetic bank movement example',
    restore: 'Restore bank movement session',
    save: 'Save bank movement session',
    export: 'Download bank movement workpaper',
    sides: ['Bank statement', 'Cashbook'],
    sheet: 'Sheet',
    sourceConfirm:
      'I reviewed this table’s source roles, company cash directions, booked or posted status, settlement identities and fee or reversal evidence.',
    scopeConfirm:
      'I reviewed the common entity, ledger, bank account, currency and period. This is a movement comparison; it does not close balances.',
    compare: 'Compare bank movements',
    cancel: 'Cancel operation',
    failed:
      'Operation rejected. Review source and evidence; the previous state was retained.',
    displayFailed:
      'The original Excel display cannot be accepted: hidden content, unreadable formatting or a format outside the supported bank family. Review the original file and provide a visible, supported table; no movement from the rejected source was approved.',
    fields: {
      entity: 'Entity',
      ledger: 'Ledger',
      account: 'Bank account',
      currency: 'Currency',
      start: 'Period start',
      end: 'Period end',
    },
    status: {
      empty: 'No valid movements',
      'movements-consistent':
        'Supplied movements matched; balance closure remains separate',
      'needs-review': 'Movement cases need review',
      'source-error': 'Source errors block all approval',
    },
    caseStatus: {
      'matched-evidence': 'Matched by explicit source identity',
      'matched-manual': 'Matched by documented human review',
      'needs-review': 'Needs review',
      'source-error': 'Source error',
    },
    reasons: {
      'explicit-identity': 'Explicit complete source identity',
      'human-review': 'Documented human review',
      undone: 'Undone; requires review',
      'source-error': 'Source errors block approval',
      'missing-identity': 'No settlement identity',
      'missing-counterpart': 'Missing counterpart',
      'member-limit': 'Complete group exceeds member limit',
      'policy-members': 'Policy or complete member roles conflict',
      'reversal-origin-conflict': 'Reversal origins name different settlements',
      'incomplete-reversal': 'Original group reversal membership is incomplete',
      'amount-difference': 'Amount difference',
      'timing-review': 'Movement or value dates require review',
    },
    roles: {
      principal: 'Principal',
      settlement: 'Settlement',
      fee: 'Fee',
      'fee-tax': 'Fee tax',
      'periodic-fee': 'Periodic fee',
      reversal: 'Reversal',
    },
    policies: {
      individual: 'Individual',
      'outgoing-inclusive': 'Outgoing including fees',
      'incoming-net': 'Incoming net of fees',
      reversal: 'Full reversal',
    },
    directions: {
      inflow: 'Cash inflow',
      outflow: 'Cash outflow',
    },
    caseKinds: {
      reference: 'Explicit settlement identity',
      missing: 'Missing identity',
      human: 'Human one-to-one pairing',
    },
    groups: 'Whole movement cases',
    movements: 'Original movements',
    timing: 'Value dates outside the period',
    inventory: 'Every original source row',
    events: 'Dated decisions',
    evidence: 'Source cell evidence',
    reviewCells: 'Review source cells',
    reference: 'Evidence reference',
    reason: 'Decision or undo reason',
    approve: 'Approve complete eligible case',
    undo: 'Undo complete movement case',
    manual: 'Documented one-to-one pairing without source identities',
    selectBank: 'Bank movement for human review',
    selectCash: 'Cashbook movement for human review',
    choose: 'Choose',
    approveManual: 'Approve documented one-to-one pairing',
    own: 'Own record',
    settlement: 'Settlement identity',
    side: 'Side',
    row: 'Source row',
    date: 'Movement date',
    valueDate: 'Value date',
    direction: 'Cash direction',
    role: 'Role',
    policy: 'Source policy',
    parent: 'Parent payment',
    reverses: 'Reverses original',
    amount: 'Amount',
    bankTotal: 'Bank cash amount',
    cashTotal: 'Cashbook cash amount',
    difference: 'Bank minus cashbook',
    kind: 'Kind',
    eligible: 'Financially eligible',
    yes: 'Yes',
    no: 'No',
    validMovement: 'Valid movement',
    members: 'Complete members',
    field: 'Field',
    column: 'Source column',
    original: 'Original text',
    deviceTime: 'Device UTC',
    eventType: {
      accept: 'Accept',
      undo: 'Undo',
    },
    rowErrors: {
      BANK_ROW_SCOPE: 'Row differs from the confirmed comparison scope.',
      BANK_CELL: 'Hidden cell or row, formula, or unsupported cell format.',
      BANK_COLUMNS: 'Source columns differ from the contract.',
      BANK_TEXT: 'Text is invisible or invalid.',
      BANK_IDENTITY: 'Movement reference is invalid.',
      BANK_DATE: 'Date is invalid.',
      BANK_AMOUNT: 'Amount or precision is invalid.',
      BANK_PERIOD: 'Movement date is outside the period.',
      BANK_DIRECTION: 'Cash direction is invalid.',
      BANK_STATUS: 'Posting status is not accepted.',
      BANK_POLICY: 'Settlement policy is unsupported.',
      BANK_ROLE:
        'Movement role, fee parent or reversal reference is inconsistent.',
      BANK_DUPLICATE_ID: 'Movement reference is duplicated in the source.',
      BANK_DUPLICATE_REVERSAL: 'Original movement is reversed more than once.',
      BANK_PARENT: 'Fee has no valid principal in the same group.',
      BANK_REVERSAL: 'Reversal has no valid original movement.',
      BANK_ROW: 'Row could not be read; review its original cells.',
    },
    inventoryKinds: {
      header: 'Header',
      blank: 'Blank',
      movement: 'Movement',
      error: 'Error',
    },
    previous: 'Previous',
    next: 'Next',
    retainedTiming:
      'Value dates outside the period stay visible after approval and undo; they are inputs to a later balance reconciliation.',
  },
  allocation: {
    entry: 'Payment allocation',
    sides: ['Available payments', 'Open invoices', 'Proposed remittance'],
    fields: [
      'Entity',
      'Ledger',
      'Supplier',
      'Payable account',
      'Currency',
      'Snapshot date',
      'Snapshot basis',
    ],
    eventTypes: {
      allocate: 'allocate',
      undo: 'undo',
    },
    basisTypes: {
      remittance: 'remittance',
      'external-confirmation': 'external confirmation',
      'accountant-review': 'accountant review',
    },
    backToSuppliers: 'Back to suppliers',
    paymentAllocation: 'Payment allocation',
    intro:
      'Allocate available value to invoices with explicit evidence or human review. Allocated + remaining = available for each side.',
    limits:
      'Use a snapshot before the proposed allocations; exclude advice already applied to these capacities. No accounting-system posting. Changing a source or scope clears this session’s decisions.',
    openSyntheticAllocationExample: 'Open synthetic allocation example',
    restoreAllocationSession: 'Restore allocation session',
    sheet: 'Sheet',
    sourceConfirm:
      'I reviewed the table roles, available capacity and advice timing',
    scopeConfirm:
      'I reviewed the entity, ledger, supplier, account, currency and snapshot before these allocations.',
    readValueLedger: 'Read value ledger',
    failure:
      'Operation rejected. Review source, evidence, amount and capacity; the previous state was retained.',
    valueLedger: 'Value ledger',
    ready: 'Ready for review; no automatic allocation',
    sourceError: 'Source errors block allocation',
    saveAllocationSession: 'Save allocation session',
    downloadAllocationWorkpaper: 'Download allocation workpaper',
    side: 'Side',
    ownReference: 'Own reference',
    original: 'Original',
    available: 'Available',
    allocated: 'Allocated',
    remaining: 'Remaining',
    cellEvidence: 'Cell evidence',
    decisionOrUndoReason: 'Decision or undo reason',
    adviceLinesForReview: 'Advice lines for review',
    used: ' — used',
    approveAdvice: 'Approve selected advice atomically',
    documentedHumanAllocation: 'Documented human allocation',
    decisionBasis: 'Decision basis',
    accountantReview: 'Accountant review',
    externalConfirmation: 'External confirmation',
    humanEvidenceReference: 'Human evidence reference',
    choose: 'Choose',
    allocationAmount: 'Allocation amount',
    removeLink: 'Remove link',
    addAllocationLink: 'Add allocation link',
    approveHuman: 'Approve human allocation atomically',
    datedDecisions: 'Dated decisions',
    undoDecision: 'Undo decision',
    activeAllocations: 'Active allocations',
    inventoryOfEverySourceRow: 'Inventory of every source row',
    previous: 'Previous',
    next: 'Next',
  },
  glTb: {
    functionalLabel: 'Functional',
    postedLabel: 'Posted',
    entry: 'GL / Trial balance',
    title: 'GL and trial balance consistency',
    back: 'Supplier reconciliation',
    intro:
      'Verify one account in a declared scope. Opening balances, period debit and credit, and closing balances remain separate in each source. Files stay local.',
    limits:
      'First source family: CSV/XLSX with the exact English role headers shown by the synthetic example. GL has opening, movement and closing records; TB has six balance columns. First row is the header. ISO dates, explicit nonnegative decimals, written zeros, functional currency and posted records only. No unknown columns, net-only amounts or balances borrowed from the other source.',
    claim:
      'This verifies internal consistency of the supplied details and summary. It does not establish source authenticity, period completeness or fair presentation of financial statements.',
    sample: 'Open synthetic GL/TB example',
    sides: ['GL detail and balances', 'Trial balance source'],
    sheet: 'Sheet',
    sourceConfirm:
      'I reviewed this table: all balance roles and complete financial dimensions, posted scope, posting layer and functional currency are explicit.',
    fields: {
      entity: 'Entity',
      ledger: 'Ledger',
      account: 'Account',
      dimensions: 'Complete dimensions',
      currency: 'Currency',
      currencyBasis: 'Currency basis',
      postingStatus: 'Posting status',
      postingLayer: 'Posting layer',
      start: 'Period start',
      end: 'Period end',
    },
    scopeConfirm:
      'I reviewed the common entity, ledger, account, complete dimensions, functional currency, posted scope, layer and period. Blank amounts are not zeros.',
    compare: 'Verify GL/TB consistency',
    result: 'GL/TB result',
    save: 'Save GL/TB session',
    restore: 'Restore GL/TB session',
    export: 'Download GL/TB workpaper',
    status: {
      consistent: 'Consistent in the declared scope',
      difference: 'Separate component differences',
      inconsistent: 'Independent balance bridge is inconsistent',
      missing: 'Required balance evidence is missing',
      'source-error': 'Source errors block approval',
    },
    components: {
      openingDebit: 'Opening debit',
      openingCredit: 'Opening credit',
      periodDebit: 'Period debit',
      periodCredit: 'Period credit',
      closingDebit: 'Closing debit',
      closingCredit: 'Closing credit',
    },
    component: 'Component',
    gl: 'GL',
    tb: 'Trial balance',
    difference: 'GL minus TB',
    glBridge: 'GL closing minus opening and period net',
    tbBridge: 'TB closing minus opening and period net',
    missing: 'Missing',
    missingLabels: {
      'gl-opening': 'GL opening balance',
      'gl-closing': 'GL closing balance',
      'tb-balance': 'Trial balance account',
    },
    inventory: 'Original row inventory',
    row: 'Source row',
    kind: 'Role',
    original: 'Original cells',
    record: 'Record ID',
    cellEvidence: 'Amount cell evidence',
    column: 'Source column',
    minor: 'Amount in minor units',
    kinds: {
      header: 'Header',
      blank: 'Blank',
      opening: 'Opening balance',
      movement: 'Period movement',
      closing: 'Closing balance',
      balance: 'Balance source row',
      error: 'Reading error',
    },
    rowErrors: {
      GL_TB_CELL: 'Hidden, formula or unreadable cell',
      GL_TB_ROW_SCOPE: 'Row differs from confirmed scope',
      GL_TB_DUPLICATE: 'Repeated record ID or balance role',
      GL_TB_AMOUNT: 'Missing or invalid nonnegative amount',
      GL_TB_DATE: 'Invalid or out-of-period date',
      GL_TB_KIND: 'Unknown record role',
      GL_TB_IDENTITY: 'Invalid record identity',
      GL_TB_COLUMNS: 'Unexpected extra data',
    },
    failure:
      'Cannot complete this operation under the GL/TB source policy. Check native source roles, readable headers, explicit amounts and the confirmed scope. The previous source remains available if upload fails.',
    error: 'Reason',
    previous: 'Previous rows',
    next: 'Next rows',
  },
  arDocuments: {
    title: 'Customer AR documents',
    entry: 'Customer AR reconciliation',
    back: 'Supplier reconciliation',
    intro:
      'Compare a company AR ledger with its company-issued customer statement in the seller receivable perspective. Files stay local; no postings or payment allocations are created.',
    limits:
      'Two CSV/XLSX tables with a header in the first row. Compare original signed movements, not open balances. Invoice is positive; receipt and credit note are negative. ISO dates and plain decimals without thousands separators. One entity, ledger, customer, account, currency and period. Buyer-side AP statements are outside this policy. This first source family requires one matching role header for each field shown below; a related invoice or generic reference is not an own document number.',
    sides: ['Company AR ledger', 'Company-issued customer statement'],
    sample: 'Open synthetic AR example',
    restore: 'Restore AR session',
    sheet: 'Sheet',
    column: 'Choose a column',
    optional: 'Not used',
    fields: {
      posting: 'Unique posting ID',
      kind: 'Document type',
      document: 'Own document number',
      date: 'Posting date',
      amount: 'Original signed amount',
      entity: 'Entity',
      ledger: 'Ledger',
      customer: 'Customer ID',
      account: 'Account',
      currency: 'Currency',
      related: 'Related invoice',
      description: 'Description',
    },
    readingConfirm:
      'I reviewed this source: seller receivable perspective, original movements, and the selected column meanings. Related invoice is not the own document number.',
    scopeConfirm:
      'I reviewed the common entity, ledger, customer, account, currency and period. The source rows must agree with this scope.',
    start: 'Period start',
    end: 'Period end',
    run: 'Compare AR documents',
    cancel: 'Cancel processing',
    working: 'Verifying locally',
    results: 'AR document comparison result',
    valid: 'Valid movements',
    matched: 'Matched document pairs',
    errors: 'Reading errors',
    ledgerTotal: 'Ledger readable total',
    statementTotal: 'Statement readable total',
    note: 'Document review reason',
    reopen: 'Reopen document pair',
    accept: 'Record human confirmation',
    save: 'Save AR session',
    export: 'Download AR workpaper',
    prev: 'Previous',
    next: 'Next',
    row: 'Row',
    inventory: 'Original source inventory',
    review: 'Needs review',
    automatic: 'Exact own document',
    human: 'Human confirmation',
    none: 'No approval evidence',
    coverage:
      'Matching documents does not settle receipts against invoices, prove period completeness or reconcile opening and closing balances. Errors remain visible and block approval. Explicit related-invoice evidence remains checked even when its optional field is not mapped.',
    error:
      'AR processing could not complete. Review the source, column meanings, scope and decision. The retained sources and decisions were preserved.',
    kind: {
      invoice: 'Invoice',
      'credit-note': 'Credit note',
      receipt: 'Receipt',
    },
    inventoryKind: {
      header: 'Table header',
      blank: 'Blank row',
      movement: 'Movement',
      error: 'Reading error',
    },
    reason: {
      'exact-own-document':
        'Unique own document, type, date and signed amount agree',
      'source-errors': 'Reading errors block approval',
      'duplicate-document': 'Document identity has competing movements',
      'missing-counterpart':
        'No counterpart with the same own document and type',
      'amount-difference': 'Original signed amounts differ',
      'date-difference': 'Posting dates differ',
      'related-conflict': 'Related invoice evidence conflicts',
      'unverified-document-role':
        'Selected header does not establish the own document role',
      reopened: 'Approval cancelled; document pair remains for review',
      'human-confirmation':
        'Exact correspondence with recorded human confirmation',
    },
    readingIssue:
      'This original row does not satisfy the source reading contract.',
  },
  clearing: {
    title: 'Single-account clearing',
    back: 'Supplier reconciliation',
    intro:
      'Clear offsetting movements using an explicit clearing reference or a recorded review decision. Files stay local; no postings are created.',
    limits:
      'One CSV or XLSX movement table. ISO dates and plain decimal amounts without thousands separators. Unique posting IDs and an account and currency on every row. This checks movements; it does not prove period completeness.',
    upload: 'Clearing movements file',
    sample: 'Open synthetic clearing example',
    restore: 'Restore clearing session',
    sheet: 'Sheet',
    header: 'Header row',
    column: 'Choose a column',
    mode: 'Amount layout',
    signed: 'Signed amount',
    split: 'Debit and credit',
    posting: 'Unique posting ID',
    reference: 'Clearing reference',
    date: 'Movement date',
    amount: 'Signed amount',
    debit: 'Debit',
    credit: 'Credit',
    account: 'Account',
    currency: 'Currency',
    description: 'Description',
    entity: 'Entity',
    ledger: 'Ledger',
    start: 'Period start',
    end: 'Period end',
    confirm:
      'I reviewed the column meanings and scope: movements belong to one entity, ledger and account; debit is positive and credit is negative.',
    run: 'Check clearing',
    cancel: 'Cancel processing',
    working: 'Verifying locally',
    results: 'Clearing result',
    valid: 'Valid movements',
    cleared: 'Cleared movements',
    errors: 'Reading errors',
    total: 'Net of readable movements',
    row: 'Row',
    status: 'Status',
    basis: 'Evidence',
    net: 'Net',
    members: 'Members',
    note: 'Review decision reason',
    manual: 'Record human clearing for selected members',
    reopen: 'Reopen cleared group',
    save: 'Save clearing session',
    export: 'Download clearing workpaper',
    review: 'Needs review',
    automatic: 'Whole explicit reference',
    human: 'Human decision',
    none: 'No approval evidence',
    prev: 'Previous',
    next: 'Next',
    source: 'Original source',
    missing: 'No clearing reference',
    error:
      'Clearing could not complete. Check the source settings, values and decision; the previous decision was preserved.',
    inventory: {
      header: 'Table header',
      blank: 'Blank row',
      movement: 'Movement',
      error: 'Reading error',
    },
    readingIssue:
      'The value or its scope does not satisfy the reading contract; review the original row and its columns.',
    coverage:
      'Declared scope is not independent proof of period completeness. A zero net does not mean that all movements are cleared.',
    reason: {
      'reference-zero': 'Whole reference offsets to zero',
      residual: 'Reference bucket does not offset; no subset is selected',
      'unverified-reference-role':
        'Column header does not establish a clearing-reference role; a human decision is needed',
      'missing-reference':
        'Relationship evidence is missing; amount alone is insufficient',
      'source-errors': 'Source errors block approval',
      'group-limit': 'Group exceeds 100 members',
      'human-decision': 'Offsetting members with a recorded human decision',
      reopened: 'Approval cancelled; group remains for review',
    },
    entry: 'Single-account clearing',
    navigation: 'Reconciliation type',
  },
  reviewEffort: {
    title: 'Measure image review effort',
    intro:
      'Optional local measurement from the moment you start. Select the stage and mark rework when correcting an earlier review. This record grants no accounting authority.',
    limits:
      'Measures activity in this window, not attention. Pauses after 30 seconds without a click or field change within the review, on leaving the window, or while processing. Resume explicitly. Long silent reading requires resuming; its later time stays outside activity. Export before changing the image, restoring another record or closing the page; nothing is saved automatically or sent.',
    sample: 'Measurement case type',
    choose: 'Choose case type',
    development: 'Known or synthetic development case',
    field: 'Field case declared by reviewer; not independently verified',
    start: 'Start effort measurement',
    pause: 'Pause effort measurement',
    resume: 'Resume effort measurement',
    finish: 'Finish effort measurement',
    export: 'Export effort record',
    newMeasurement:
      'Start a new record and discard the previous measurement from this window',
    stage: 'Effort measurement stage',
    stages: {
      values: 'Values and crops',
      table: 'Table and rows',
      context: 'Headers, context and transfer',
    },
    rework: 'Reworking an earlier review',
    running: 'Measurement running',
    finished: 'Measurement finished',
    paused: {
      manual: 'Measurement paused manually',
      idle: 'Measurement paused for inactivity',
      hidden: 'Measurement paused on leaving the window',
      processing: 'Measurement paused during processing',
    },
    active: (n: number) => `Active time: ${n} seconds`,
    reworked: (n: number) => `Including rework: ${n} seconds`,
    stopped: (n: number) => `Paused time: ${n} seconds`,
    actions: (c: number, e: number, r: number) =>
      `Review clicks: ${c}; field changes: ${e}; resumes: ${r}`,
    limit:
      'Measurement stopped at the event limit. The finished record retains earlier events; export it and start a new record.',
    failed:
      'Could not continue effort measurement. Do not rely on this measurement. Source review remains available.',
  },
  document: {
    title: 'Tarasuf — Local Accounting Reconciliation',
    description:
      'Choose an accounting reconciliation workflow and review its sources and limits before comparing. Tarasuf processes files in your browser and preserves result and export evidence.',
  },
  language: {
    group: 'Interface language',
  },
  brand: {
    name: 'Tarasuf',
    headings: {
      heroLine1: 'Between the records,',
      heroLine2: 'we find clarity',
      upload: 'Start with the two files',
      confirm: 'Check the data before comparing',
      review: 'Review the differences between the two records',
      export: 'Your workpaper is ready for review',
      process: 'From files to workpaper',
      privacy: 'Your files stay on your device',
      cta: 'Start a new reconciliation',
    },
  },
  upload: {
    waitForRead:
      'Wait for the current read to finish, or cancel it, before adding another file.',
    readerLoading:
      'The reader is still loading. Wait a moment, then add the file.',
    multipleFiles:
      'You added more than one file. Add one file to each slot. Your current files have not changed.',
    origin: ['From the supplier', 'From your system'],
    description: [
      'The statement you received from the supplier',
      'The report exported from your accounting system',
    ],
    processing: 'Processing on your device',
    preparing: 'Preparing the reader',
    readDone: 'File read. Review its data in the next step.',
    dropHere: 'Drop the file here',
    dragOrChoose: 'Drag the file here or choose it from your device',
    replace: 'Replace file',
    choose: 'Choose file',
  },
  importAssistant: {
    fields: {
      date: 'Date',
      reference: 'Reference',
      description: 'Description',
      amount: 'Transaction amount',
      debit: 'Debit',
      credit: 'Credit',
      currencyColumn: 'Currency',
    },
    noProposal:
      'The assistant could not offer a usable suggestion. Choose the columns manually from the available options. Your data has not changed.',
    searching: 'Looking for the right columns on your device',
    suggest: 'Suggest columns',
    cancel: 'Cancel',
    proposalLabel: 'Suggested columns for review',
    proposalNote:
      'This is a suggestion from the AI assistant on your device. Check what each column means against the sample rows before using it. No amounts or matches have been accepted.',
    columnOf: (n: number) => `: column ${n} “`,
    closeQuote: '” —',
    untitled: 'untitled',
    row: (n: number) => `row ${n}:`,
    engineNotes: (n: number) => ` (notes for the engine to check: ${n})`,
    apply: 'Apply these columns after review',
  },
  assistant: {
    trigger: 'Result assistant',
    region: 'Explanation of the reconciliation result',
    heading: 'Ask about the result',
    intro:
      'The assistant explains the result from the engine’s figures and evidence. It does not change any match or send your data anywhere. If it does not understand a question, it can use a model on your device when one is ready and supports the question’s language. It never downloads a model or connects to an outside service.',
    presets: {
      balances: 'Why is there a difference in the balances?',
      unverified: 'What checks were not completed?',
      next: 'What should I review next?',
      explain: 'Explain this transaction',
    },
    sources: (n: number) => `Source row IDs behind this explanation (${n})`,
    inputLabel: 'Your question about the reconciliation',
    placeholder: 'Ask about a difference or an invoice reference',
    thinking: 'Preparing the answer on your device',
    ask: 'Ask',
    clear: 'Clear conversation',
  },
  transactionReview: {
    region: 'Transaction review',
    heading: 'Review transaction',
    row: (n: number) => `Row ${n}`,
    close: 'Close review',
    originalAmount: 'Amount in the source file: ',
    rowId: ' · Row ID:',
    pdfPage: (n: number) => ` · PDF page: ${n}`,
    candidatesNote:
      'Up to 50 results from the other file are shown. A transaction listed here is not a match, and a link cannot be confirmed when the amounts differ.',
    searchLabel: 'Search for a counterpart transaction',
    searchPlaceholder:
      'Search the other file by reference, description, or row number',
    counterpartLabel: 'Counterpart transaction',
    counterpartPlaceholder: 'Choose a transaction from the other file',
    noReference: 'No reference',
    candidateRow: (n: number) => ` · row ${n}`,
    amountsEqual:
      'The amounts are equal. Confirming the link needs accounting evidence.',
    amountsDiffer:
      'The amounts differ, so the two transactions cannot be linked.',
    noteLabel: 'Reason for the decision',
    notePlaceholder:
      'Record the evidence for the link, or the reason for the review or unlink',
    unlink: 'Unlink and return to review',
    link: 'Confirm link manually',
    reviewOnly: 'Record review without a match',
  },
  common: {
    listSeparator: '; ',
    cancel: 'Cancel',
    close: 'Close',
  },
  pdfReview: {
    heading: 'PDF review',
    pages: (n: number) => `${n} ${n === 1 ? 'page' : 'pages'}.`,
    singleColumn:
      'The file was read as a single column. If it contains a table, set the column boundaries below.',
    autoColumns: (n: number) =>
      `${n} columns inferred from the gaps in the table. Check them against the original.`,
    chosenColumns: (n: number) => `${n} columns from the boundaries you set.`,
    flaggedRows: (n: number) =>
      ` ${n} ${n === 1 ? 'row needs' : 'rows need'} your review.`,
    noFlaggedRows:
      ' No row reading problems were detected. Check the rows against the original before you continue.',
    openOriginal: 'Open the original PDF',
    tableSummary: 'Table read from the file',
    rowColumn: 'Row',
    column: (n: number) => `Column ${n}`,
    noteColumn: 'Note',
    beforeTable: 'Before the table',
    headerRow: 'Header row',
    previousPage: 'Previous page',
    nextPage: 'Next page',
    jumpPage: 'Page number',
    goToPage: 'Go to page',
    pageOf: (page: number, pages: number) => `Page ${page} of ${pages}`,
    previousRows: 'Previous rows',
    nextRows: 'Next rows',
    rangeOf: (from: number, to: number, total: number) =>
      `${from}–${to} of ${total}`,
    hideCuts: 'Hide column boundaries',
    editCuts: 'Edit column boundaries',
    cutsField:
      'Column boundary positions, as a percentage from the left edge of the page',
    cutsLabel: 'PDF column boundaries',
    cutsHint:
      'Measure from the left edge of the page. 25, 45, 65 splits it into four columns. Place each boundary in the gap between two columns, or leave the field empty to read the page as one column.',
    applyCuts: 'Apply boundaries and re-read',
    undoCuts: 'Undo the change',
    cutsInvalid:
      'Enter numbers separated by commas or spaces, such as 25, 45, 65.',
    cutsPending:
      'The new boundaries are not in use yet. Apply them to re-read the table.',
    reviewed:
      'I have reviewed the table on every page and confirmed it matches the original. The review must be repeated after any re-read.',
  },
  visualReader: {
    preparing: 'Preparing image reading on your device',
    tooLarge: 'The file is larger than 8 MB. Choose a smaller file.',
    pageOrder:
      'The page order or page count could not be verified. Try another file with no more than 5 pages.',
    readingPage: (page: number, total: number) =>
      `Reading page ${page} of ${total} on your device`,
    overLimits:
      'The document exceeds the limits of experimental reading. Try a smaller version or fewer pages.',
    failed:
      'The file could not be read. Use Excel or a text-based PDF to complete the reconciliation.',
    summary: 'Experimental image reading assistant',
    intro:
      'Extracts Arabic and English words from PNG and JPEG images and scanned PDFs, and shows where each word appears in the original. Reading runs on your device.',
    caution:
      'The output is an unverified draft. Its figures are not used in matches or in the Excel file, and a word’s recognition score does not mean the figure is correct for accounting purposes. To complete the reconciliation, use Excel or a text-based PDF. Recognition of Arabic-Indic digits such as ١٢٣ is still unreliable, so check all of them against the original image.',
    choose: 'Choose an image or PDF',
    chooseLabel: 'Image or PDF for experimental reading',
    tryCandidate: 'Try reading the file as an image',
    cancel: 'Cancel image reading',
    clear: 'Clear image draft',
    limits:
      'Limit: 8 MB per file and 5 pages per PDF. On first use, the reading tools may take a moment to load from this site, but your file’s content stays on your device. Some PDF types are not supported yet.',
    draftLead: 'Unverified draft from images: ',
    draftStats: (pages: number, words: number) =>
      ` · Pages: ${pages} · Words: ${words}. Its data has not been added to the reconciliation.`,
    page: 'Page',
    pageLabel: 'Image draft page',
    confidence: (score: number | null) =>
      `Word recognition score: ${score === null ? 'not available' : `${score}%`}. This score does not confirm that the data is correct for accounting purposes.`,
    originalImage: (page: number) => `Original image of page ${page}`,
    words: 'Extracted words',
    wordsHint:
      'Select a word to see where it appears in the image. Check figures, their signs, and their separators against the original.',
    firstWords: (total: number) =>
      `Showing the first 1,000 of ${total} words. This preview does not cover the full page.`,
    noWords:
      'No words could be read on this page. It may contain text the reader did not recognize, so check the original image.',
    details: 'File and reader details',
  },
  visualTable: {
    title: 'Table row inventory',
    intro:
      'An experimental step for delimiting one table in a PNG image and accounting for its rows. Link values to reviewed crops, and identify totals and unreadable rows. This record does not enter reconciliation yet.',
    choose: 'Select the entire table body without headers',
    rowCuts: 'Vertical row boundaries in pixels',
    columnCuts: 'Horizontal column boundaries in pixels',
    cutsHint:
      'Enter increasing coordinates separated by English commas, including both frame edges. Coordinates appear below the image. Manual boundaries alone do not prove file completeness.',
    roles: 'Column roles from left to right',
    create: 'Create row inventory',
    replace: 'Create a new inventory and discard previous table reviews',
    roleNames: {
      reference: 'Reference',
      date: 'Date',
      amount: 'Transaction amount',
      balance: 'Balance',
      currency: 'Currency',
      debit: 'Debit',
      credit: 'Credit',
    },
    row: (n: number) => `Row ${n}`,
    disposition: 'Row type',
    dispositions: {
      unclassified: 'Unclassified',
      movement: 'Transaction',
      'non-movement': 'Total or non-transaction row',
      unreadable: 'Unreadable row',
    },
    note: 'Exclusion reason or reading issue',
    applyRow: 'Save row classification',
    noCell: 'No reviewed value linked',
    cropHint:
      'Only reviewed crops inside the cell with the corresponding role are listed. Review a new crop above when needed.',
    confirmExcluded: 'I checked this row and it is not a transaction',
    exclusionChecked: 'Exclusion checked against the source',
    coverage:
      'I checked the full page and included the entire table and every row',
    coverageHint:
      'This reviews the range and row inventory only. It neither confirms unreviewed values nor resolves unreadable rows. Changing a row, value or frame cancels it.',
    covered: 'Range review recorded',
    pending: 'Range review not recorded',
    unassigned: (n: number) =>
      `Reviewed crops inside the range not linked to a row or reviewed exclusion: ${n}`,
    counts: (
      movements: number,
      excluded: number,
      unreadable: number,
      unclassified: number,
      missing: number,
    ) =>
      `Transactions: ${movements} · Excluded: ${excluded} · Unreadable: ${unreadable} · Unclassified: ${unclassified} · Values not linked: ${missing}`,
    save: 'Save table record',
    saving: 'Verifying table record',
    failed:
      'The change could not be accepted. Check boundaries, crops and row classifications.',
    onlyEvidence:
      'Evidence record only, even when every review is complete. It is not an accounting source or proof of a completed reconciliation.',
    limits:
      'One rectangular table, up to 200 rows and 8 columns within the supported PNG limits. Table boundaries are not extracted automatically at this stage.',
  },
  visualAccounting: {
    title: 'Use the table for transaction comparison',
    intro:
      'An experimental path for one PNG with manually reviewed values and rows. Each value is checked again; unreadable cells remain for review.',
    splitHint:
      'Review debit and credit as printed. A printed zero is a value; a blank or unreadable cell stays for review and is never inferred as zero.',
    exclusionHint:
      'An exclusion note does not prove a total row. Review its printed label in a crop and assign it to that row’s reference cell. Unproven exclusions remain for review.',
    headerHint:
      'Review separate header crops above the table using the reference role, and the currency code using the currency role. Choosing a column name alone is not source evidence.',
    header: (role: string) => `${role} header evidence`,
    chooseHeader: 'Choose a reviewed source crop',
    currencyProof: 'Currency code evidence in the image',
    side: 'Use this image as',
    supplier: 'Supplier in the image',
    entity: 'Comparison entity',
    account: 'Account if specified',
    currency: 'Image currency',
    decimals: 'Currency decimal places',
    start: 'Image period start',
    cutoff: 'Image comparison date',
    direction: 'Image amount direction',
    sameSign: 'Positive increases payable to the supplier',
    reverseSign: 'Negative increases payable to the supplier',
    numberFormat: 'Image amount separators',
    dateFormat: 'Image date order',
    choose: 'Choose the source interpretation',
    confirm:
      'I checked the column meanings, currency, signs and scope of this image',
    use: 'Use reviewed values in comparison',
    busy: 'Verifying the reviewed source',
    failed:
      'The source could not be verified. Check header and currency evidence, period and formats.',
    limits:
      'Up to 200 rows in one table in an opaque PNG. Values and reviews are manual, not verified automatic extraction or a full balance reconciliation.',
    locked:
      'This image interpretation is bound to its review. Return to the image and create a new reviewed source to change it.',
    loaded: 'Manually reviewed image source',
    details: 'Reviewed values and source evidence',
  },
  visualReview: {
    title: 'Value review record',
    intro:
      'Select a word, choose its role and check it against the crop. Editing a value clears its previous review. This record saves your checks only; it does not approve transactions or matches.',
    family:
      'Saved value reviews currently support a single opaque PNG page up to 2 MB. Other formats remain reading drafts.',
    cellLabel: 'Review an image value',
    cellTitle: 'Check this value',
    addCrop: 'Select a value from the image',
    changeCrop: 'Change the selected crop',
    useCrop: 'Use this crop',
    cancelCrop: 'Cancel selection',
    removeCrop: 'Remove this value',
    selectSurface: 'Select a crop from the original image',
    selectHelp:
      'Drag around the value, including its sign and separators. Use arrow keys to move the frame or Shift with arrows to resize it, then Enter. Escape returns to the preview without changes.',
    regionLabel: 'Review a selected image value',
    regionTitle: 'Value from the crop',
    manualHint:
      'Enter the value as shown in the crop. This is manual entry, not a verified reader result.',
    partialWord: 'word clipped by crop',
    noObservation: 'No reader words intersect this crop',
    regionsTitle: 'Values selected from the image',
    regionItem: (index: number) => `Selected value ${index}`,
    crop: 'Value crop from the original image',
    observed: 'Reader output',
    role: 'Value role',
    chooseRole: 'Choose a role',
    roles: {
      amount: 'Amount',
      date: 'Date',
      reference: 'Reference',
      currency: 'Currency',
    },
    value: 'Value as shown in the original',
    valueHint:
      'Keep the sign and separators as shown. No calculations are performed on this value here.',
    reviewed: 'This value was checked against the crop',
    pending: 'This value has not been reviewed',
    confirm: 'Confirm this value review',
    count: (reviewed: number, total: number) =>
      `${reviewed} reviewed values out of ${total} recorded — this does not confirm complete page coverage`,
    save: 'Save review record',
    restore: 'Open saved review record',
    restoreLabel: 'Image review record in JSON format',
    saving: 'Checking the image and values before saving',
    restoring: 'Checking the review record and original image',
    confirming: 'Recording this value review',
    errors: {
      format:
        'This image is outside the supported PNG review family or its bytes are damaged. You can still view the reading draft.',
      limit: 'The image or record exceeds the current value review limits.',
      pixels:
        'The complete image data could not be decoded. No value review record was linked.',
      source:
        'The preview does not match the original image bytes. The review record was not accepted.',
      record:
        'The review record structure is invalid or its reader settings differ from this version.',
      stale:
        'The image or a value changed after review. Use the original record or read and review it again.',
      cell: 'The value, its location or its review receipt could not be verified.',
    },
    failed:
      'The review record could not be opened or saved. No values were added to reconciliation.',
  },
  scene: {
    supplierPaper: 'Supplier statement',
    ledgerPaper: 'AP ledger',
    caption: 'Illustration — supplier reconciliation example',
    motionReducedLabel:
      'Animation is off because of your reduced-motion setting',
    playLabel: 'Play the illustration animation',
    pauseLabel: 'Pause the illustration animation',
    motionReduced: 'Animation off',
    play: 'Play animation',
    pause: 'Pause animation',
  },
  landing: {
    eyebrow: 'Local accounting reconciliation',
    descriptionLine1: 'Choose a reconciliation type and review its sources,',
    descriptionLine2:
      'from movements and balances to result evidence and workpapers, within each workflow’s limits.',
    start: 'Choose a reconciliation type',
    howItWorks: 'How to use Tarasuf',
    privacyNote: 'Processing happens on your device. No account needed.',
    bottomline: [
      'From data to clarity',
      'Designed to make accountants’ work easier',
    ],
    benefits: {
      kicker: 'What Tarasuf offers',
      title: 'Easier reconciliation, results you understand',
      intro:
        'Your files stay on your device and the source of every result is in front of you, with clear steps and an assistant that explains what happened.',
      local: {
        label: 'Privacy first',
        title: 'Your files stay on your device',
        text: 'We read and compare the files in your browser, without sending them to a processing server or saving transactions automatically between sessions.',
        link: 'Learn about the privacy limits',
        seal: 'Processed on your device',
      },
      evidence: {
        label: 'Reviewable results',
        title: 'Know the reason for every match',
        text: 'Review each transaction’s source and why it was matched. If the engine does not find enough evidence for a match, it leaves it for you to review.',
        note: 'Transaction source and match reason',
      },
      flow: {
        label: 'Straightforward steps',
        title: 'Review both files in one place',
        text: 'Upload the files and review the data, then compare transactions and download the result. The engine shows you what needs your review.',
        note: 'No account or technical setup needed',
      },
      assistant: {
        label: 'Help with explanation and review',
        title: 'Ask the assistant about the result',
        text: 'Ask about the difference, an unmatched transaction, or the next step. The assistant explains what the engine’s results confirm without changing any matches.',
        note: 'Based on the engine’s results and runs on your device',
      },
    },
    process: {
      intro:
        'Supplier reconciliation example: upload the two files, review the differences, then save the results in a workpaper. Sources and steps vary with the reconciliation type selected above.',
      steps: [
        {
          number: '1',
          title: 'Upload the two files',
          text: 'Upload the supplier statement and your AP report. The engine reads the data and shows you what needs confirmation or correction.',
          detail: 'Start with the data you have',
        },
        {
          number: '2',
          title: 'Review matches and differences',
          text: 'You see matched transactions, differences, and cases that need your decision, with the source of every transaction.',
          detail: 'The source beside each result',
        },
        {
          number: '3',
          title: 'Download the workpaper',
          text: 'Download an Excel file that brings together the results, sources, and your notes, ready to review with your team.',
          detail: 'Keep the results and details',
        },
      ],
      supplier: 'Supplier statement',
      ledger: 'AP ledger',
      confirmed: 'Supported match',
      difference: 'Identified difference',
      review: 'Needs Review',
      workpaper: 'Workpaper',
      workpaperParts: 'Results · Sources · Notes',
    },
    privacy: {
      kicker: 'Privacy from the start',
      text: 'Your financial files contain details of your business, so we read them, compare them, and prepare the export in your browser. We do not send the files or reconciliation data to a processing server.',
      assurances: [
        'We do not save transactions automatically',
        'We do not use tracking tools in the app',
      ],
      link: 'Read the privacy limits in detail',
      browser: 'In your browser',
      files: 'Your files',
      results: 'Your results',
      steps: 'Read · Compare · Export',
      boundary: 'Reconciliation data stays on your device',
    },
    limits: {
      kicker: 'What happens to your files',
      title: 'Privacy limits',
      intro:
        'Know what we process in the browser and what you choose to save or share.',
      items: [
        {
          question: 'Where files are processed',
          answer:
            'We read your files, their names, and their transactions, and we compare the data and prepare the export in the browser. We do not send reconciliation data to a processing server or an external AI service, and we do not use tools to analyze or track your usage.',
        },
        {
          question: 'What we save',
          answer:
            'We do not save reconciliation transactions automatically between sessions. If you choose to save a column template, we save the column numbers and reading preferences in your browser, and you can clear them from the privacy panel at the top of the page. Workpaper and session files you download stay on your device until you delete them, and you choose where to save them and who to share them with.',
        },
        {
          question: 'When you need the internet',
          answer:
            'You need the internet to open the site and load its tools. After that, you can use the tools that have finished loading without a connection, though you may need to connect to load a tool you use for the first time. This version does not support reopening the site without an internet connection.',
        },
        {
          question: 'Limits of the site’s protection',
          answer:
            'The site’s hosting service may log visit data under its own policy, but it does not receive reconciliation files from the app. We cannot guarantee the security of your device or your browser extensions, or control files you download or share outside the app.',
        },
      ],
    },
  },
  app: {
    sides,
    sideShort: { supplier: 'Supplier', ledger: 'AP ledger' },
    scopeFields: {
      supplier: 'Supplier',
      entity: 'Legal entity',
      account: 'Account',
      currency: 'Currency',
      cutoff: 'Cut-off date',
    },
    dateFormats: {
      ymd: 'Year / Month / Day',
      dmy: 'Day / Month / Year',
      mdy: 'Month / Day / Year',
    },
    blocked: {
      addFiles: 'Add both files first.',
      pdfDraft: 'Apply or undo the PDF column changes before comparing.',
      sheet:
        'Choose the Excel sheet that contains the transactions in the file card.',
      columns:
        'Select the date column and the amount column in the file card above.',
      cutoff:
        'Set the cut-off date under “Advanced options” in the scope card.',
      currency:
        'Set the currency of both files under “Advanced options” in the scope card.',
      precision:
        'Set the currency’s decimal places under “Advanced options” in the reconciliation scope.',
      conflicts:
        'Choose the correct value for the conflicting fields under “Advanced options”.',
      invalidFormats:
        'The date or amount format could not be verified. Correct how the indicated columns or rows are read before comparing.',
      direction:
        'The balances were not enough to determine the debit and credit direction. Choose the direction in the file card.',
      formats:
        'Some dates or amounts can be read in more than one way. Choose the correct format in the file card.',
      pdfReview:
        'Review the data extracted from the PDF, then confirm the review in the file card.',
      balances:
        'To reconcile balances, add the party names and confirm that both reports cover the same period.',
      preparing: 'Updating the reading settings…',
    },
    readingIssues: {
      partial: 'Partial result — some issues need review',
      partialHint:
        'Readable transactions were processed. Affected data remains for review; the figures cover processed transactions only and do not establish a complete reconciliation.',
      counts: (processed: number, unread: number) =>
        `Processed transactions: ${processed} · Rows needing reading review: ${unread}`,
      balanceCount: (count: number) =>
        `Balance reading issues: ${count}. This is not a complete balance reconciliation.`,
      sourceCount: (count: number) =>
        `Source reading or scope issues: ${count}. Review their reasons below.`,
      show: (count: number) => `Show all reading issues (${count})`,
      table: 'Reading issue details',
      source: 'Source',
      location: 'Location',
      reason: 'Reason',
      original: 'Original values',
      sourceWide: 'Source or scope',
      balance: 'Entered balances',
      row: (row: number) => `Row ${row}`,
      page: (page: number) => `PDF page ${page}`,
      noOriginal: 'Not associated with a data row',
      previous: 'Previous issues',
      next: 'Next issues',
      range: (from: number, to: number, total: number) =>
        `${from}–${to} of ${total}`,
    },
    processing: {
      preparingRead: 'Preparing to read the PDF pages on your device',
      preparingLayout: 'Preparing to check the PDF page layout',
      readingPage: (page: number, total: number) =>
        `Reading page ${page} of ${total}`,
      layoutPage: (page: number, total: number) =>
        `Checking page layout ${page} of ${total}`,
    },
    tasks: {
      read: 'Reading the file on your device',
      rereadPdf: 'Re-reading the PDF columns on your device',
      reconcile: 'Checking the data and matching transactions',
      saveSession: 'Preparing the session file',
      restoreSession: 'Verifying and recalculating the session',
      export: 'Preparing the workpaper on your device',
    },
    errors: {
      operationFailed: 'The operation could not be completed.',
      fileTooLarge: 'The file is larger than 8 MB. Choose a smaller file.',
      filesMissing:
        'Add the supplier statement and the AP report before comparing.',
      preparing:
        'The reading settings are being updated. Wait for the update to finish, then try again.',
      precision:
        'This currency is not listed. Set its number of decimal places before comparing.',
      formats:
        'Choose the correct format for dates or amounts that can be read in more than one way.',
      conflicts:
        'Some comparison details differ between the two files. Choose the correct values first.',
      rowsNeedCorrection:
        'Some rows need correcting. Review the reading details below.',
      sessionTooLarge:
        'The session file is larger than 30 MB. Choose a smaller session file.',
      engineLoad: 'The local engine could not be loaded. Try again.',
      engineRestart:
        'The comparison tool could not start. Refresh the browser, then try again.',
      templatesUnavailable:
        'Saved templates could not be accessed. Check that the browser allows local storage.',
      reviewerRequired:
        'Enter the reviewer’s name before confirming the review.',
      templateSave: 'The template could not be saved in this browser.',
      noTemplate: 'There is no valid template for this file.',
      excludeInvalid: 'Enter a valid data row and the reason for excluding it.',
    },
    notices: {
      cancelled: 'The operation was cancelled.',
      demo: 'This is a sample for trying Tarasuf. Review the amount direction and comparison settings before you start.',
      sessionSaved:
        'The session file contains the sources and notes without encryption. Save it in a private location on your device.',
      sessionRestored:
        'The session was restored and its results were recalculated from the sources. Review the result before confirming it.',
      workpaperReady:
        'The workpaper is ready. Save it on your device and check that it appears in your downloads.',
      templatesCleared: 'Column templates were cleared from this browser.',
      reviewRecorded:
        'Your review of the case was recorded. Matches and differences are unchanged.',
      templateSaved:
        'The column settings were saved on your device, without any financial data.',
      templateRestored:
        'Only the column positions were restored. The amount direction and format are checked against the current file.',
    },
    shell: {
      skipLink: 'Skip to the workspace',
      brandHome: 'Tarasuf — accounting reconciliation workflows',
      mainNav: 'Main navigation',
      navHow: 'How it works',
      navPrivacy: 'Privacy',
      localPill: 'Processed on your device',
      navStart: 'Choose type',
      resetTitle: 'Start a new reconciliation',
      resetDescription:
        'The current session’s work will be cleared from the browser. Download the workpaper before you start if you want to keep the results. Files you have already downloaded stay on your device.',
      resetCancel: 'Continue session',
      resetConfirm: 'Clear session and start over',
      privacyTitle: 'Privacy limits',
      privacyClose: 'Close privacy limits',
      privacyProcessing:
        'Your files are read, their transactions compared, and the results exported in your browser. We do not send the files, their names, or their data to a processing server, and we do not use tracking tools in the app. The hosting company may log visits to the site under its own policy. Protecting your device and your browser extensions is outside the app’s scope.',
      privacyStorage:
        'We do not save your transactions automatically between sessions. You can save column templates and reading settings, without any financial data. Once the tools have loaded, you can complete the loaded steps offline. You need the internet to open the site again.',
      clearTemplates: 'Clear saved templates',
      eyebrow: 'Workspace / Supplier reconciliation',
      stepIntro: [
        'Add the supplier statement and your AP report to compare transactions and review the differences.',
        'Review the data extracted from both files and complete anything that needs your confirmation.',
        'Review the transactions and their sources, and check the reason for each match.',
        'Download an Excel file with the results, their sources, and the review notes.',
      ],
      beta: 'Beta',
      newReconciliation: 'New reconciliation',
      stepsNav: 'Reconciliation steps',
      steps: ['Add files', 'Confirm data', 'Review differences', 'Workpaper'],
      stepDone: ' — completed',
      stepCurrent: ' — current step',
      stepLater: ' — upcoming',
      demoBanner:
        'You are using a sample for trying Tarasuf, not company data or real transactions.',
      restartEngine: 'Restart the engine',
      engineLoading: 'Preparing the comparison tool…',
      footnote:
        'The results support your review and are not an accounting approval. Save the session or download the workpaper before closing if you want to keep them.',
      footnotePrivacy: 'Privacy and version limits',
      tagline: 'Clarity that supports your review',
      footerPrivacy: 'Privacy limits',
    },
    importStop: {
      at: (page: number, total: number) =>
        `Reading stopped at page ${page} of ${total}: `,
      mixed: 'The page contains both text and images.',
      imageOnly:
        'The page contains images and no text that can be read directly.',
      nativeText: 'The page contains readable text.',
      unknown:
        'No readable text was found, and the page content could not be determined.',
      advice:
        'This prevents incomplete data from entering the comparison. Try an Excel version or a text-based PDF. The image assistant below lets you try reading the file, but its output is a draft that is not used in the reconciliation.',
    },
    upload: {
      heading: 'Add the two reconciliation files',
      constraints: 'One supplier · One entity · One currency',
      pdfBefore: 'text-based ',
      pdfAfter: ' without images',
      upTo: 'Up to ',
      perFile: ' per file · ',
      pagesPer: ' pages per ',
      imageHint:
        'If the file is an image, try the image assistant below. Its results are an unverified draft.',
      noServer: 'Files are not sent to a server.',
      next: 'Confirm data',
      demoTitle: 'Try a ready-made sample',
      demoText:
        'Learn the steps with sample invoices, payments, and differences ready for review.',
      demoButton: 'Try the sample',
      resume: 'Resume a session saved on your device',
      resumeLabel: 'Resume a local session',
      resumeNote:
        'We read the session file on your device and rerun the comparison from its sources before restoring your work.',
    },
    scope: {
      heading: 'Reconciliation scope',
      until: 'Up to',
      setDate: 'Set the date',
      setCurrency: 'Set the currency',
      dateWindow: (days: number) =>
        `· Allowed date difference: ${plural(days, 'day', 'days')}`,
      edit: 'Edit reconciliation scope',
      close: 'Close',
      advanced: 'Advanced options',
      needBoth:
        'We could not determine the cut-off date or the currency. Add them under “Advanced options”.',
      needCutoff:
        'We could not determine the cut-off date. Add it under “Advanced options”.',
      needCurrency:
        'We could not determine the currency. Choose it under “Advanced options”.',
      needPrecision:
        'Set the currency’s decimal places under “Advanced options” so that amounts are read accurately.',
      conflict: (fields: string[]) =>
        `The two files show different values for the ${fields.map((field) => field.toLowerCase()).join(', ')}. Choose the correct value under “Advanced options”.`,
      cutoffField: 'Reconcile up to',
      cutoffFrom: (side: number, row: number) =>
        `Taken from ${inSentence[side]}, row ${row}.`,
      cutoffLatest:
        'We used the latest date in the two files. Transactions after the selected date are not included in the comparison.',
      cutoffNote:
        'Transactions after the selected date are not included in the comparison.',
      cutoffLabel: 'Cut-off date',
      currencyField: 'Currency of both files',
      currencyRead:
        'We read the currency from a clear heading or from the currency column.',
      currencyHint: 'Enter its three-letter code, such as SAR.',
      currencyLabel: 'Currency',
      decimals: 'Currency decimal places',
      decimalsChoose: 'Choose the currency’s decimal places',
      decimalsZero: 'No decimal places',
      decimalsTwo: 'Two — e.g. SAR',
      decimalsThree: 'Three — e.g. KWD',
      dateWindowField: 'Allowed date difference for matching',
      days: (days: number) => plural(days, 'day', 'days'),
      balanceMode: 'Also reconcile balances',
      supplierField: 'Supplier name',
      supplierLabel: 'Supplier',
      entityField: 'Legal entity',
      entityLabel: 'Legal entity',
      accountField: 'Account or branches covered',
      accountLabel: 'Account scope',
      sources: 'Sources of the suggested values',
      conflictMark: ' — conflict',
      evidenceSeparator: ', ',
      evidenceRow: ', row ',
    },
    compare: {
      pdfPending:
        'Review the data extracted from the PDF, then confirm the review in the file card above.',
      coverage:
        'I have checked that both reports cover the same period and verified the balances I entered. This confirmation is required only when reconciling balances.',
      run: 'Check and compare',
      backToFiles: 'Back to files',
      attestation:
        'By starting the comparison, you confirm that both files relate to the same supplier, entity, account, and currency, and that the amount direction shown is correct.',
    },
    results: {
      saveSession: 'Save session to continue later',
      sessionWarning:
        'The session file contains your data without encryption. Save it in a private location on your device.',
      autoMatches: 'Automatic matches',
      autoMatchesHint: 'Cases the engine matched automatically',
      manualMatches: 'Manual confirmations',
      manualMatchesHint: 'Matches confirmed by the reviewer',
      unmatchedCases: 'Unmatched cases',
      unmatchedRows: (rows: number) => `Transactions from both files: ${rows}`,
      balanceDifference: 'Balance difference',
      balancesUnverified: 'Balances not verified',
      skippedRows: 'Rows not read',
      skippedRowsHint:
        'The comparison is incomplete until these rows are reviewed',
      noSkippedRows:
        'No reading errors remain, and excluded rows are documented',
      skippedAdvice:
        'You can continue with the partial result for verified transactions outside the affected scope. Review the affected rows below; their details and original values are preserved in Reading Issues and Diagnostics when you export. Correcting the source rechecks its reading.',
      transactionsOnly:
        'This is a comparison of transactions only. We did not verify the balances or the shared period coverage, so the result is not a complete balance reconciliation.',
      workspace: 'Review workspace',
      workspaceIntro:
        '“Unmatched” means we did not find the transaction in the other file. It may exist in the system but not be included in the report.',
      editSettings: 'Edit settings',
      filter: 'Filter results',
      tabUnmatched: 'Unmatched',
      tabMatched: 'Matched',
      tabReview: (cases: number) => `Needs Review (${cases})`,
      search: 'Search results',
      searchPlaceholder: 'Ref., description, row',
      columns: [
        'Source / Row',
        'Date',
        'Reference',
        'Amount',
        'Status',
        'Review',
      ],
      noReference: 'No reference',
      caseMembers: ' transactions in this case',
      status: {
        auto: 'Automatic match',
        manual: 'Manual confirmation',
        amountVariance: 'Amount difference',
        paymentCandidate: 'Suggested group for matching',
        rejected: 'Rejected suggestion',
        needsReview: 'Needs Review',
        unmatched: 'Unmatched',
      },
      caseDetails: 'Case details',
      reviewedStillOpen: 'Reviewed, still unmatched',
      empty: 'There are no transactions in this list.',
      pageSummary: (cases: number, page: number, pages: number) =>
        `Cases: ${cases} · Page ${page} of ${pages}`,
      pagination: 'Pagination',
      previousPage: 'Previous page',
      nextPage: 'Next page',
      prepareWorkpaper: 'Prepare the workpaper',
    },
    finish: {
      balancesHeading: 'Balances and reconciliation status',
      supplierBalance: 'Supplier balance',
      ledgerBalance: 'AP ledger balance',
      notAvailable: 'Not available',
      balanceCheck: 'Balance check',
      consistentConfirmed:
        'The balances are arithmetically consistent and period coverage is confirmed',
      consistentUnconfirmed:
        'The balances are arithmetically consistent; period coverage needs your confirmation',
      notProven: 'We could not establish that the balances are consistent',
      openingAdjustment: 'Opening difference with no established cause',
      itemAdjustment: 'Net effect of reconciling items',
      adjusted: 'Arithmetically adjusted balance',
      residual: 'Remaining arithmetic difference',
      bridgeLead:
        'A remaining difference of zero does not establish the causes of the differences or the validity of the documents. Transactions still unmatched:',
      bridgeTrail:
        '— all documented in the workpaper. This view shows the effect of the transactions on the balances and does not propose journal entries.',
      noBalances:
        'The workpaper includes the transaction comparison and the cases that need follow-up. You did not choose to reconcile balances in this session.',
      notesHeading: 'Review notes and download',
      reviewerField: 'Reviewer name (optional for a draft)',
      reviewerLabel: 'Reviewer name',
      notesField: 'Your notes and follow-up items',
      notesLabel: 'Review notes',
      attestation:
        'I have reviewed the workpaper and the remaining cases. This records my personal confirmation of the review; it is not an approval by the site.',
      contents:
        'The Excel file includes the results, sources, review decisions, open cases, and excluded rows, along with the matching rules and the engine version. You can download a draft before confirming the review.',
      download: 'Download workpaper',
      downloadDraft: 'Download Excel draft',
      downloadPartial: 'Download partial workpaper',
      backToReview: 'Back to review',
    },
    source: {
      unset: 'Not selected',
      untitled: 'Untitled',
      column: (n: number) => `Column ${n}`,
      sheetField: 'Sheet containing the transactions',
      sheetChoose: 'Choose a sheet',
      date: 'Date',
      amount: 'Amount',
      debit: 'Debit',
      credit: 'Credit',
      reference: 'Reference',
      positiveIncreases:
        'A positive amount increases the amount owed to the supplier',
      negativeIncreases:
        'A negative amount increases the amount owed to the supplier',
      debitIncreases:
        'Debits increase the amount owed to the supplier and credits reduce it',
      creditIncreases:
        'Credits increase the amount owed to the supplier and debits reduce it',
      sentence: (statement: string) => `${statement}.`,
      flipDirection: 'Reverse amount direction',
      edit: (side: number) => `Edit ${inSentence[side]}`,
      directionField: 'Which column increases the amount owed to the supplier?',
      directionChoose: 'Choose the direction for this report',
      directionDebit: 'Debit increases the amount owed',
      directionCredit: 'Credit increases the amount owed',
      noReferenceColumn:
        'No reference column was identified. Only transactions with a document number, bank reference or receipt number in an explicit column can be matched automatically. If there is a reference column, select it under “Advanced options”.',
      chosenFormat: 'The format you chose. ',
      dateFormatIn: (side: number) => `Date format in ${inSentence[side]}`,
      numberFormatIn: (side: number) => `Amount format in ${inSentence[side]}`,
      interpretationChoose: 'Choose the correct interpretation',
      unreadRows: (rows: number) =>
        `${plural(rows, 'row', 'rows')} could not be read and remain for review. Verified transactions outside their affected scope can continue; the result stays partial until the reading issues are resolved.`,
      row: (row: number) => `Row ${row}: `,
      moreInDiagnostics:
        'All reading issues and their original values are preserved when you export the Excel file.',
      missingColumns:
        'We need your help identifying some columns. Choose the missing columns below, and open “Advanced options” if you want to change the other settings.',
      dateColumn: 'Date column',
      amountColumn: 'Amount column',
      debitColumn: 'Debit column',
      creditColumn: 'Credit column',
      referenceColumn: 'Reference column',
      descriptionColumn: 'Description column (optional)',
      currencyColumn: 'Currency column (if any)',
      missingHint:
        'Select the date column and the amount column (or the debit and credit columns) so the file can be read.',
      sheet: 'Sheet',
      headerRow: 'Header row number',
      headerRowLabel: (side: number) => `Header row ${side}`,
      amountMode: 'How amounts are shown',
      signed: 'One amount column, positive or negative',
      split: 'Separate debit and credit columns',
      preview: 'Preview of the start of the table',
      previewRow: 'Row',
      readingSettings: 'Reading settings and report type',
      reportType: 'Report type',
      transactions: 'Transactions for a period',
      openItems: 'Open items as of the cut-off date',
      direction: 'Amount direction',
      numberFormat: 'Number format in the source',
      decimalPoint: '1,234.56 — decimal point',
      decimalComma: '1.234,56 — decimal comma',
      dateFormat: 'Text date format',
      saveTemplate: 'Save as template',
      restoreTemplate: 'Restore template',
      exclude: 'Exclude a row with a reason',
      readingNotes: (notes: number) =>
        ` — ${plural(notes, 'reading note', 'reading notes')}`,
      issueAt: (row: number, column?: number) =>
        `Row ${row}${column ? `, column ${column}` : ''}: `,
      counts: (read: number, excluded: number, unread: number) =>
        `Transactions read: ${read} · Rows excluded: ${excluded} · Rows not read: ${unread}`,
      rowNumber: 'Row number',
      rowNumberLabel: (side: number) => `Row to exclude ${side}`,
      reason: 'Reason for exclusion',
      reasonLabel: (side: number) => `Reason for exclusion ${side}`,
      excludeRow: 'Exclude row',
      reinclude: 'Include again',
      balances: 'Balances and period coverage',
      periodStart: 'Start of the transaction period',
      periodStartLabel: (side: number) => `Period start ${side}`,
      opening: 'Opening balance (positive if owed to the supplier)',
      openingLabel: (side: number) => `Opening balance ${side}`,
      closing: 'Closing balance at the cut-off date',
      closingLabel: (side: number) => `Closing balance ${side}`,
      manualBalances:
        'You entered these balances manually. Their arithmetic consistency does not prove that the file includes every transaction.',
    },
  },
  financial: {
    trialBalanceDebitsCreditsResidual:
      'Trial balance debit / credit / residual',
    amount: 'Amount in minor units',
    categories: {
      'current-asset': 'Current assets',
      'noncurrent-asset': 'Noncurrent assets',
      'current-liability': 'Current liabilities',
      'noncurrent-liability': 'Noncurrent liabilities',
      equity: 'Equity',
    },
    scopeFieldPrefix: 'Financial scope:',
    basis: 'Basis',
    decision: 'Decision',
    fileExceeds8MB: 'File exceeds 8 MB.',
    back: 'Back',
    trialBalanceAndFinancialPosition: 'Trial balance and financial position',
    reviewAccountsDimensionsMappingSignsPeriodAndCurrency:
      'Review accounts, dimensions, mapping, signs, period and currency against four separate originals. Equal totals alone do not prove classification.',
    theResultIsConsistencyWithSuppliedPresentationEvidence:
      'The result is consistency with supplied presentation evidence only; it does not establish source authenticity, ledger completeness, fair presentation or accounting standards compliance.',
    currentFamilyWholePostClosingTrialBalanceOne:
      'Current family: whole post-closing trial balance, one functional currency, one sheet per original, with no reclassification. Up to 8 MB per original and 20,000 rows total. Native Excel monetary cells require the two-decimal format.',
    syntheticExample: 'Synthetic example',
    restoreSession: 'Restore session',
    cancelOperation: 'Cancel operation',
    noOriginalUploaded: 'No original uploaded',
    iReviewedThisOriginalAndConfirmItsRole:
      'I reviewed this original and confirm its role, family and sole sheet',
    confirmedComparisonScope: 'Confirmed comparison scope',
    iConfirmTheScopeAgreesAcrossAllFour:
      'I confirm the scope agrees across all four originals',
    suppliedInventoryAttestation: 'Supplied inventory attestation',
    iReviewedCompletenessOfSuppliedAccountsDimensionsMappings:
      'I reviewed completeness of supplied accounts, dimensions, mappings, evidence and statement lines',
    attestationReference: 'Attestation reference',
    attestationReason: 'Attestation reason',
    checkMappingAndAmounts: 'Check mapping and amounts',
    saveSession: 'Save session',
    exportEvidence: 'Export evidence',
    theOperationCouldNotCompleteReviewTheSource:
      'The operation could not complete. Review the source scope, family, formats, evidence and whole decision membership. A failed restore preserves the previous review.',
    accounts: 'Accounts',
    statementLines: 'Statement lines',
    preservedSourceRows: 'Preserved source rows',
    allAmountsBelowAreIntegerMinorUnitsDecimals:
      'All amounts below are integer minor units; decimals',
    basisLabels: {
      calculated: 'calculated',
      reported: 'reported',
    },
    assets: 'Assets',
    liabilities: 'Liabilities',
    equity: 'Equity',
    positionEquation: 'Position equation',
    reviewDecisionEvidence: 'Review decision evidence',
    decisionReference: 'Decision reference',
    decisionReason: 'Decision reason',
    calculatedReportedDifference: 'Calculated / Reported / Difference',
    allMappingMembersAndEvidence: 'All mapping members and evidence',
    mapping: 'Mapping',
    account: 'Account',
    dimensions: 'Dimensions',
    evidence: 'Evidence',
    contribution: 'Contribution',
    previousLines: 'Previous lines',
    nextLines: 'Next lines',
    sourceInventoryAndErrors: 'Source inventory and errors',
    source: 'Source',
    row: 'Row',
    state: 'State',
    errors: 'Errors',
    originalCells: 'Original cells',
    missingEvidence: 'Missing evidence',
    kind: 'Kind',
    key: 'Key',
    presentationAndPeriodEvidence: 'Presentation and period evidence',
    line: 'Line',
    class: 'Class',
    sign: 'Sign',
    from: 'From',
    to: 'To',
    reference: 'Reference',
    decisionHistory: 'Decision history',
    decisionLabels: {
      accept: 'Accept whole line',
      reject: 'Reject whole line',
      undo: 'Undo decision',
    },
    members: 'Members',
    time: 'Time',
    reason: 'Reason',
    roles: [
      'Trial balance',
      'Proposed mapping',
      'Independent presentation evidence',
      'Financial position',
    ],
    scope: [
      'Entity',
      'Ledger',
      'Currency',
      'Currency basis',
      'Posting status',
      'Posting layer',
      'Period start',
      'Period end',
      'As of',
      'Chart version',
      'Map version',
      'Closing basis',
    ],
    status: {
      'source-error': 'source-error',
      missing: 'missing',
      inconsistent: 'inconsistent',
      difference: 'difference',
      'needs-review': 'needs-review',
      'consistent-with-evidence': 'consistent-with-evidence',
      blocked: 'blocked',
      accepted: 'accepted',
      rejected: 'rejected',
    },
    previous: 'Previous',
    next: 'Next',
  },
};
