// The words of the decision platform (UX-3): the sentence under the
// decision buttons that says which decisions are open, and why the others
// are closed, naming the fields the reader fills.
const en = {
  both: (reference: string, reason: string) =>
    `Write the “${reference}” and the “${reason}” to open the decisions.`,
  reference: (reference: string) =>
    `Write the “${reference}” to open the decisions.`,
  reason: (reason: string) => `Write the “${reason}” to open the decisions.`,
  members: 'There are no members to decide on, so no decision is open.',
  blocked: 'It is blocked, so no decision is open on it.',
  pending:
    'It needs review: approve and reject are open; undo opens once it is decided.',
  decided: 'It is decided: undo is open; approve and reject are for a review.',
  each: 'Approve and reject are open on what needs review, undo on what is decided.',
  eachBlocked:
    'Approve and reject are open on what needs review, undo on what is decided; a blocked line takes no decision.',
  accept: {
    unconfirmed:
      'Approval waits for the confirmation that the sources are complete.',
    'source-error':
      'Approval stays closed while a source has an error; correct it in its original file.',
    missing: 'Approval stays closed while evidence is missing.',
    inconsistent: 'Approval stays closed while the sources disagree.',
    difference: 'Approval stays closed while a difference remains.',
    pairs: 'Approval waits until every pair is ready.',
  },
  // One note opens the decisions on each of many items, as the receivables
  // and clearing engines require: how long it must be, then what each item
  // takes.
  note: (note: string, minimum: number) =>
    `Write at least ${minimum} characters in the “${note}” to open the decisions.`,
  receivables:
    'Reopen is open on each matched pair, and recording a human confirmation on each pair whose document role is unverified or that was reopened; the other pairs stay for review, and no decision closes them.',
  clearing: {
    reopen: 'Reopen is open on each cleared group.',
    select:
      'To clear by hand, select members that net to zero, with a debit and a credit.',
    net: 'The selected members do not net to zero with a debit and a credit, so they are not cleared by hand.',
    limit: 'At most 100 members are cleared by hand at once.',
    ready: 'Clearing by hand is open for the selected members.',
    errors:
      'Clearing by hand stays closed while the source has reading errors; correct them in the original file.',
  },
  // Allocation: one reason opens the decisions; each approval then waits for
  // its own evidence.
  allocation: {
    advice: 'Approving advice waits for a selected advice line.',
    human: (reference: string) =>
      `Approving a human allocation waits for the “${reference}” and a payment, an invoice and an amount on every link.`,
    ready: 'Both approvals are open, and undo on each active decision.',
    blocked:
      'Decisions stay closed while a source has an error; correct it in its original file.',
    links: 'A decision holds at most 100 links.',
  },
  // A closed button that is not a decision says what opens it.
  waits: {
    ask: (ask: string) => `“${ask}” opens once a question is written.`,
    check: (check: string) =>
      `“${check}” opens once the section's files are chosen and their reading and scope confirmed.`,
    example: (example: string) =>
      `“${example}” opens only before a file is chosen, so it never replaces your file.`,
    step: (label: string, step: string) => `“${label}” opens once ${step}.`,
  },
};

const ar: typeof en = {
  both: (reference, reason) =>
    `اكتب «${reference}» و«${reason}» لتُفتح القرارات.`,
  reference: (reference) => `اكتب «${reference}» لتُفتح القرارات.`,
  reason: (reason) => `اكتب «${reason}» لتُفتح القرارات.`,
  members: 'لا أعضاء يقع عليهم القرار، فلا قرار مفتوح.',
  blocked: 'هو محجوز، فلا قرار مفتوح عليه.',
  pending: 'يحتاج مراجعة: الاعتماد والرفض مفتوحان، والتراجع يُفتح بعد القرار.',
  decided: 'قُرر: التراجع مفتوح، والاعتماد والرفض لما يحتاج مراجعة.',
  each: 'الاعتماد والرفض مفتوحان على ما يحتاج مراجعة، والتراجع على ما قُرر.',
  eachBlocked:
    'الاعتماد والرفض مفتوحان على ما يحتاج مراجعة، والتراجع على ما قُرر؛ والسطر المحجوز لا قرار عليه.',
  accept: {
    unconfirmed: 'الاعتماد ينتظر تأكيد اكتمال المصادر.',
    'source-error': 'الاعتماد مغلق ما دام في مصدر خطأ؛ صحّحه في ملفه الأصلي.',
    missing: 'الاعتماد مغلق ما دام دليل ناقصًا.',
    inconsistent: 'الاعتماد مغلق ما دامت المصادر متعارضة.',
    difference: 'الاعتماد مغلق ما دام فرق باقيًا.',
    pairs: 'الاعتماد ينتظر أن يجهز كل زوج.',
  },
  note: (note, minimum) =>
    `اكتب ${minimum} أحرف على الأقل في «${note}» لتُفتح القرارات.`,
  receivables:
    'إعادة الفتح متاحة على كل زوج مطابق، وتسجيل التأكيد البشري على كل زوج لم يثبت دور مستنده أو أُعيد فتحه؛ وتبقى الأزواج الأخرى للمراجعة، لا يغلقها قرار.',
  clearing: {
    reopen: 'إعادة الفتح متاحة على كل مجموعة مُقاصّة.',
    select: 'للمقاصة اليدوية اختر أعضاء صافيهم صفر، فيهم مدين ودائن.',
    net: 'صافي الأعضاء المختارين ليس صفرًا بمدين ودائن، فلا تُقاص يدويًا.',
    limit: 'تُقاص يدويًا 100 عضو على الأكثر في المرة.',
    ready: 'المقاصة اليدوية متاحة للأعضاء المختارين.',
    errors:
      'المقاصة اليدوية مغلقة ما دام في المصدر أخطاء قراءة؛ صحّحها في الملف الأصلي.',
  },
  allocation: {
    advice: 'اعتماد الإشعار ينتظر اختيار سطر إشعار.',
    human: (reference) =>
      `اعتماد التخصيص البشري ينتظر «${reference}» ودفعة وفاتورة ومبلغًا في كل رابط.`,
    ready: 'الاعتمادان متاحان، والتراجع على كل قرار نافذ.',
    blocked: 'القرارات مغلقة ما دام في مصدر خطأ؛ صحّحه في ملفه الأصلي.',
    links: 'يحمل القرار 100 رابط على الأكثر.',
  },
  waits: {
    ask: (ask) => `يُفتح «${ask}» بعد كتابة سؤال.`,
    check: (check) =>
      `يُفتح «${check}» بعد اختيار ملفات القسم وتأكيد قراءتها ونطاقها.`,
    example: (example) =>
      `يُفتح «${example}» قبل اختيار ملف فقط، فلا يحل محل ملفك.`,
    step: (label, step) => `يُفتح «${label}» بعد ${step}.`,
  },
};

export const decisionPlatformCopy = { en, ar };
