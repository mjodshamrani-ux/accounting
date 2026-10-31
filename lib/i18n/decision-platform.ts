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
  // A closed button that is not a decision says what opens it.
  waits: {
    ask: (ask: string) => `“${ask}” opens once a question is written.`,
    check: (check: string) =>
      `“${check}” opens once the section's files are chosen and their reading and scope confirmed.`,
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
  waits: {
    ask: (ask) => `يُفتح «${ask}» بعد كتابة سؤال.`,
    check: (check) =>
      `يُفتح «${check}» بعد اختيار ملفات القسم وتأكيد قراءتها ونطاقها.`,
  },
};

export const decisionPlatformCopy = { en, ar };
