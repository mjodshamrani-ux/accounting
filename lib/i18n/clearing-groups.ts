const en = {
  title: 'Clearing groups (CLR-1)',
  intro:
    'Proposed family clearing-groups-1, beside the clearing above and not instead of it. The same file, reading and scope. A group is every movement of one clearing reference, never a part of it; a movement without a reference is a group of its own. A faulty line holds only the groups it can touch when its own reading proves what it can touch: the reference is readable and is not a total, the line is not hidden, has no formula, no cell past the last heading and is not the headings again. Every cell of such a line is a possible reference. A faulty line that cannot be isolated holds every group, as the clearing above does.',
  limits:
    'Review only. No decision is taken here, and the clearing above keeps its own decisions, session and Excel. A posting number may repeat on different lines; lines equal in every selected cell hold their group and none is dropped. Cleared means cleared by an explicit clearing reference under this proposed contract, not an audit opinion.',
  check: 'Show the clearing groups',
  failed:
    'The clearing groups could not be computed. Review the file, the reading and the scope; nothing was shown.',
  refused: 'Refused: nothing was grouped',
  refusals: {
    SOURCE: 'The file could not be read as a CSV or XLSX extract',
    SOURCE_HASH: 'The file changed while it was read',
    ROWS: 'The sheet holds more lines than the reader admits',
    READING: 'The reading is incomplete',
    SCOPE: 'The scope is incomplete or not confirmed',
    COLUMNS: 'A selected column is missing, repeated or hidden',
    EVENTS: 'The request carries decisions',
    IDENTITY: 'The scope account is not a plain identity',
    TOTAL: 'The groups do not add up to the movements',
    OWNERSHIP: 'A movement is not in exactly one group',
  } as Record<string, string>,
  summary: (
    groups: number,
    cleared: number,
    faulty: number,
    isolated: number,
  ) =>
    `${groups} groups: ${cleared} cleared, ${groups - cleared} to review. ${faulty} faulty lines, ${isolated} of them isolated.`,
  byReason: 'Groups to review, by reason',
  groupsTitle: 'Groups',
  groupHeaders: ['Reference', 'Members', 'Net', 'Status', 'Reasons', 'Held by'],
  noReference: 'No reference',
  member: (row: number, posting: string) => `row ${row} · ${posting}`,
  heldBy: (row: number, code: string) => `row ${row} (${code})`,
  duplicates: (rows: number[]) => `rows ${rows.join(', ')} are equal`,
  status: { cleared: 'Cleared', review: 'To review' } as Record<string, string>,
  reasons: {
    UNISOLATED_ERROR:
      'A faulty line in the file cannot be isolated, so it may belong here',
    CONNECTED_ERROR:
      'A faulty line names this reference or a member posting number',
    DUPLICATE_MEMBER: 'Two members are equal in every selected cell',
    GROUP_LIMIT: 'More than 100 members',
    MISSING_REFERENCE: 'No clearing reference: one movement on its own',
    UNVERIFIED_REFERENCE_ROLE:
      'The reference column is not headed as a clearing reference',
    RESIDUAL: 'The net is not zero, or there is no debit or no credit',
  } as Record<string, string>,
  faultyTitle: 'Faulty lines',
  faultyHeaders: ['Row', 'Problem', 'Isolated', 'Cells'],
  isolated: { true: 'Isolated', false: 'Not isolated' } as Record<
    string,
    string
  >,
  codes: {
    CELL: 'Hidden, a formula or an unreadable cell',
    IDENTITY: 'An identity cell is not plain text',
    POSTING: 'No posting number',
    ROW_SCOPE: 'Another account or currency',
    DATE: 'The date is not a calendar date in YYYY-MM-DD',
    PERIOD: 'Outside the period',
    AMOUNT_FORMAT: 'The amount is not an exact plain number',
    SPLIT: 'Debit and credit together, or a negative side',
  } as Record<string, string>,
  noFaulty: 'No faulty line.',
  blank: (rows: number[]) => `Blank lines: ${rows.join(', ')}`,
};

const ar: typeof en = {
  title: 'مجموعات المقاصة (CLR-1)',
  intro:
    'عائلة مقترحة clearing-groups-1، بجانب المقاصة أعلاه لا بدلًا منها، بالملف والقراءة والنطاق أنفسها. المجموعة كل حركات مرجع المقاصة الواحد، لا جزء منها؛ والحركة بلا مرجع مجموعة وحدها. والسطر المعيب لا يوقف إلا المجموعات التي يمسها حين تثبت قراءته ما يمسه: مرجعه مقروء وليس مجموعًا، والسطر غير مخفي، بلا صيغة ولا خلية بعد آخر عنوان، وليس العناوين نفسها. وكل خلية في هذا السطر مرجع محتمل. والسطر المعيب الذي لا يُعزل يوقف كل مجموعة، كما تفعل المقاصة أعلاه.',
  limits:
    'للقراءة والمراجعة فقط. لا قرار هنا، وللمقاصة أعلاه قراراتها وجلستها وExcel. يجوز أن يتكرر رقم القيد على أسطر مختلفة؛ والأسطر المتساوية في كل خلية مختارة توقف مجموعتها ولا يُحذف منها شيء. وتُصفّى تعني تُصفّى بمرجع مقاصة صريح في هذا العقد المقترح، لا رأي مراجعة.',
  check: 'اعرض مجموعات المقاصة',
  failed:
    'تعذر حساب مجموعات المقاصة. راجع الملف والقراءة والنطاق؛ لم يُعرض شيء.',
  refused: 'مرفوض: لم يُجمع شيء',
  refusals: {
    SOURCE: 'تعذرت قراءة الملف مستخرجًا CSV أو XLSX',
    SOURCE_HASH: 'تغير الملف أثناء قراءته',
    ROWS: 'في الورقة أسطر أكثر مما يقبله القارئ',
    READING: 'القراءة ناقصة',
    SCOPE: 'النطاق ناقص أو غير مؤكد',
    COLUMNS: 'عمود مختار غائب أو مكرر أو مخفي',
    EVENTS: 'الطلب يحمل قرارات',
    IDENTITY: 'حساب النطاق ليس هوية نصية صريحة',
    TOTAL: 'المجموعات لا تساوي مجموع الحركات',
    OWNERSHIP: 'حركة ليست في مجموعة واحدة بالضبط',
  },
  summary: (groups, cleared, faulty, isolated) =>
    `${groups} مجموعة: ${cleared} تُصفّى، و${groups - cleared} للمراجعة. ${faulty} سطرًا معيبًا، ${isolated} منها معزولة.`,
  byReason: 'المجموعات التي للمراجعة، حسب السبب',
  groupsTitle: 'المجموعات',
  groupHeaders: ['المرجع', 'الأعضاء', 'الصافي', 'الحالة', 'الأسباب', 'يوقفها'],
  noReference: 'بلا مرجع',
  member: (row, posting) => `الصف ${row} · ${posting}`,
  heldBy: (row, code) => `الصف ${row} (${code})`,
  duplicates: (rows) => `الصفوف ${rows.join('، ')} متساوية`,
  status: { cleared: 'تُصفّى', review: 'للمراجعة' },
  reasons: {
    UNISOLATED_ERROR: 'في الملف سطر معيب لا يُعزل، فقد يكون منها',
    CONNECTED_ERROR: 'سطر معيب يسمي هذا المرجع أو رقم قيد عضو فيها',
    DUPLICATE_MEMBER: 'عضوان متساويان في كل خلية مختارة',
    GROUP_LIMIT: 'أكثر من مئة عضو',
    MISSING_REFERENCE: 'بلا مرجع مقاصة: حركة وحدها',
    UNVERIFIED_REFERENCE_ROLE: 'عنوان عمود المرجع ليس عنوان مرجع مقاصة',
    RESIDUAL: 'الصافي ليس صفرًا، أو لا مدين فيها أو لا دائن',
  },
  faultyTitle: 'الأسطر المعيبة',
  faultyHeaders: ['الصف', 'المشكلة', 'معزول', 'الخلايا'],
  isolated: { true: 'معزول', false: 'غير معزول' },
  codes: {
    CELL: 'مخفي أو فيه صيغة أو خلية لا تُقرأ',
    IDENTITY: 'خلية هوية ليست نصًا صريحًا',
    POSTING: 'بلا رقم قيد',
    ROW_SCOPE: 'حساب أو عملة أخرى',
    DATE: 'التاريخ ليس تاريخًا في التقويم بصيغة YYYY-MM-DD',
    PERIOD: 'خارج الفترة',
    AMOUNT_FORMAT: 'المبلغ ليس رقمًا صريحًا دقيقًا',
    SPLIT: 'مدين ودائن معًا، أو جانب سالب',
  },
  noFaulty: 'لا سطر معيب.',
  blank: (rows) => `أسطر فارغة: ${rows.join('، ')}`,
};

export const clearingGroupsCopy = { en, ar };
