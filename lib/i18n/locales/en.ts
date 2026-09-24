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
  document: {
    title: 'Tarasuf — Supplier Account Reconciliation',
    description:
      'Compare a supplier statement with your accounts payable report and review every difference against its source. Tarasuf processes the files in your browser and prepares an Excel workpaper.',
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
    readerLoading: 'The reader is still loading. Wait a moment, then add the file.',
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
    searchPlaceholder: 'Search the other file by reference, description, or row number',
    counterpartLabel: 'Counterpart transaction',
    counterpartPlaceholder: 'Choose a transaction from the other file',
    noReference: 'No reference',
    candidateRow: (n: number) => ` · row ${n}`,
    amountsEqual: 'The amounts are equal. Confirming the link needs accounting evidence.',
    amountsDiffer: 'The amounts differ, so the two transactions cannot be linked.',
    noteLabel: 'Reason for the decision',
    notePlaceholder: 'Record the evidence for the link, or the reason for the review or unlink',
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
    pageOf: (page: number, pages: number) => `Page ${page} of ${pages}`,
    previousRows: 'Previous rows',
    nextRows: 'Next rows',
    rangeOf: (from: number, to: number, total: number) =>
      `${from}–${to} of ${total}`,
    hideCuts: 'Hide column boundaries',
    editCuts: 'Edit column boundaries',
    cutsField: 'Column boundary positions, as a percentage from the left edge of the page',
    cutsLabel: 'PDF column boundaries',
    cutsHint:
      'Measure from the left edge of the page. 25, 45, 65 splits it into four columns. Place each boundary in the gap between two columns, or leave the field empty to read the page as one column.',
    applyCuts: 'Apply boundaries and re-read',
    undoCuts: 'Undo the change',
    cutsInvalid: 'Enter numbers separated by commas or spaces, such as 25, 45, 65.',
    cutsPending: 'The new boundaries are not in use yet. Apply them to re-read the table.',
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
  scene: {
    supplierPaper: 'Supplier statement',
    ledgerPaper: 'AP ledger',
    caption: 'Illustration',
    motionReducedLabel: 'Animation is off because of your reduced-motion setting',
    playLabel: 'Play the illustration animation',
    pauseLabel: 'Pause the illustration animation',
    motionReduced: 'Animation off',
    play: 'Play animation',
    pause: 'Pause animation',
  },
  landing: {
    eyebrow: 'Supplier account reconciliation',
    descriptionLine1: 'Upload the supplier statement and your AP report,',
    descriptionLine2:
      'then compare transactions and understand each difference with its source.',
    start: 'Start reconciling',
    howItWorks: 'How to use Tarasuf',
    privacyNote: 'Processing happens on your device. No account needed.',
    bottomline: ['From data to clarity', 'Designed to make accountants’ work easier'],
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
        'Upload the two files, review the differences, then save the results in a workpaper.',
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
      text: 'Supplier files contain details of your business, so we read them, compare them, and prepare the export in your browser. We do not send the files or reconciliation data to a processing server.',
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
      columns: 'Select the date column and the amount column in the file card above.',
      cutoff: 'Set the cut-off date under “Advanced options” in the scope card.',
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
      reviewerRequired: 'Enter the reviewer’s name before confirming the review.',
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
      brandHome: 'Tarasuf — supplier reconciliation workspace',
      mainNav: 'Main navigation',
      navHow: 'How it works',
      navPrivacy: 'Privacy',
      localPill: 'Processed on your device',
      navStart: 'Start',
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
      imageOnly: 'The page contains images and no text that can be read directly.',
      nativeText: 'The page contains readable text.',
      unknown: 'No readable text was found, and the page content could not be determined.',
      advice:
        'Reading stopped so that incomplete data does not enter the comparison. Try an Excel version or a text-based PDF. The image assistant below lets you try reading the file, but its output is a draft that is not used in the reconciliation.',
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
      currencyRead: 'We read the currency from a clear heading or from the currency column.',
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
      evidenceFrom: (side: number) => ` — ${sides[side]}, `,
      evidenceRow: (row: number) => `, row ${row}`,
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
      skippedRowsHint: 'The comparison is incomplete until these rows are reviewed',
      noSkippedRows: 'No reading errors remain, and excluded rows are documented',
      skippedAdvice:
        'Under “Edit settings”, correct the source data or exclude the row with a reason. Details of the reading errors are in the Diagnostics sheet when you export.',
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
      columns: ['Source / Row', 'Date', 'Reference', 'Amount', 'Status', 'Review'],
      noReference: 'No reference',
      caseMembers: (supplier: number, ledger: number) =>
        `${supplier}:${ledger} transactions in this case`,
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
      bridgeNote: (open: number) =>
        `A remaining difference of zero does not establish the causes of the differences or the validity of the documents. Transactions still unmatched: ${open}, all documented in the workpaper. This view shows the effect of the transactions on the balances and does not propose journal entries.`,
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
      positiveIncreases: 'A positive amount increases the amount owed to the supplier',
      negativeIncreases: 'A negative amount increases the amount owed to the supplier',
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
        'No reference column was identified, so no automatic matches will be accepted. If there is one, select it under “Advanced options”.',
      chosenFormat: 'The format you chose. ',
      dateFormatIn: (side: number) => `Date format in ${inSentence[side]}`,
      numberFormatIn: (side: number) => `Amount format in ${inSentence[side]}`,
      interpretationChoose: 'Choose the correct interpretation',
      unreadRows: (rows: number) =>
        `${plural(rows, 'row', 'rows')} could not be read and ${rows === 1 ? 'was' : 'were'} not included in the comparison. Correct the data or exclude ${rows === 1 ? 'it' : 'them'} with a reason.`,
      row: (row: number) => `Row ${row}: `,
      moreInDiagnostics:
        'Details of the remaining rows appear in the Diagnostics sheet when you download the Excel file.',
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
};
