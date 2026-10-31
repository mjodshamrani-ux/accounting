// Copy of the review queue (bank-review-queue-1, proposed) in the bank
// workspace. Arabic is the source; English has the same keys. The queue
// orders and groups cases; it never decides one, and a group decision is
// the single decisions it stands for.
const ar = {
  title: 'طابور المراجعة: الاستثناءات أولًا',
  intro:
    'الحالات التي تنتظر قرارك، مجموعةً بالسبب واتجاه الأعضاء وعددهم في كل جانب، وفي تباعد التاريخ بعدد الأيام. الاستثناءات التي لا تُقبل كما هي أولًا، ثم الاقتراحات، والأثر الأكبر أولًا في كل منهما.',
  bulkNote:
    'القرار الجماعي يسجل قرارًا عاديًا لكل حالة في المجموعة بأعضائها وسبب القرار نفسه، فيمكن التراجع عن أي حالة وحدها في جدول الحالات أدناه. ويبطل كل قرار إن تغير ملفه.',
  classes: { exception: 'استثناء', suggestion: 'اقتراح' },
  directions: {
    in: 'إيداع أو قبض',
    out: 'سحب أو دفع',
    'in+out': 'اتجاهان متعارضان',
  },
  shape: (statement: number, cashbook: number) =>
    `لكل حالة: حركات الكشف ${statement}، وقيود الدفتر ${cashbook}`,
  gap: (days: number) => `التباعد بالأيام: ${days}`,
  cases: (n: number) => `الحالات: ${n}`,
  impact: 'الأثر الأكبر',
  headers: ['الحالة', 'حركات الكشف', 'قيود الدفتر', 'الأثر'],
  acceptAll: (n: number) => `اقبل الحالات كلها (${n})`,
  rejectAll: (n: number) => `ارفض الحالات كلها (${n})`,
  single: 'حالة واحدة: قررها في جدول الحالات أدناه.',
  noBulkAccept: 'لا قبول جماعي لاستثناء؛ اقبل كل حالة أو ارفضها وحدها.',
  needsNote: 'اكتب سبب القرار أولًا.',
  empty: 'لا حالة تنتظر قرارك.',
};

const en: typeof ar = {
  title: 'Review queue: exceptions first',
  intro:
    'The cases awaiting your decision, grouped by reason, member directions and the number of members on each side, and for a date gap by its days. Exceptions that cannot be accepted as they stand come first, then suggestions, the largest impact first in each.',
  bulkNote:
    'A group decision records one ordinary decision for each case in the group, with its members and the same reason, so any case can be undone alone in the case table below. Every decision is void if its file changes.',
  classes: { exception: 'Exception', suggestion: 'Suggestion' },
  directions: {
    in: 'Deposit or receipt',
    out: 'Withdrawal or payment',
    'in+out': 'Opposing directions',
  },
  shape: (statement: number, cashbook: number) =>
    `Each case: statement movements ${statement}, cashbook entries ${cashbook}`,
  gap: (days: number) => `Gap in days: ${days}`,
  cases: (n: number) => `Cases: ${n}`,
  impact: 'Largest impact',
  headers: ['Case', 'Statement movements', 'Cashbook entries', 'Impact'],
  acceptAll: (n: number) => `Accept all ${n} cases`,
  rejectAll: (n: number) => `Reject all ${n} cases`,
  single: 'One case: decide it in the case table below.',
  noBulkAccept:
    'No group accept for an exception; accept or reject each case on its own.',
  needsNote: 'Write the reason for the decision first.',
  empty: 'No case awaits your decision.',
};

export const bankReviewCopy = { ar, en };
