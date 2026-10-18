// Known, classified failures of the living hard-case measurement (EVAL-1).
// The gate (gate.mjs) accepts a non-passing verdict only when an entry here
// names it: template|variant (or '*'), assistance mode, verdict and, when
// given, the source formats it applies to. An entry never
// excuses a false approval, a wrong member, a silent misread, a lost row or a
// crash; those fail the gate whatever this file says. An entry whose failure
// no longer reproduces fails the gate too, so the register cannot go stale.
//
//   class  product-gap      the product falls short of the contract, safely
//                           (no approval it should not make); owned by a plan
//          assistance-gap   unaided reading needs a declared correction that
//                           the product does not yet infer on its own
//          harness-defect   the generator or evaluator is wrong; fix it, do
//                           not list it here for long
// A contract the product outgrew is not triaged: it gets a new version in
// scenarios.mjs (CONTRACT_HISTORY) with counter-cases.
export const TRIAGE = [
  {
    keys: [
      'G01-payment-1n|missing-identity',
      'G02-payment-n1|missing-identity',
      'G08-two-dates|missing-identity',
    ],
    assist: ['declared', 'none'],
    verdicts: ['fail-outcome'],
    class: 'product-gap',
    plan: 'SUP-2 (docs/roadmap/supplier.ar.md)',
    evidence:
      'Parts of one payment without a shared bank reference stay unmatched with a visible difference instead of being shown for review with the missing-identity reason: the bank reference is the payment’s primary identity, so the single row and its parts fall into different reference groups. Seen in V1, V1.1 and on 0.4.57; no approval is made.',
  },
  {
    keys: [
      'R01-voucher-and-reference|voucher-differs',
      'R01-voucher-and-reference|voucher-shared-reference-differs',
      'C03-voucher-with-group|identity',
      'G09-equal-parts|distinct-entries',
      'G09-equal-parts|duplicate-line',
      'H03-document-no-vs-chosen-reference|agree',
      'H03-document-no-vs-chosen-reference|differ',
      'H05-order-number-as-document|order-number',
      'H06-kept-evidence-arabic|voucher-and-batch',
    ],
    assist: ['none'],
    verdicts: ['fail-missed', 'fail-controls-missed'],
    class: 'assistance-gap',
    plan: 'MAP-1 (docs/roadmap/workflow.ar.md); AI-1',
    evidence:
      'One mechanism in every case: unaided, the product chooses a different reference column when a Voucher No, Document No or Batch column sits beside Reference (productReading.wrongColumns = reference). The rows it should approve stay unapproved, and with them the background controls of some layouts. No false approval, no lost evidence; the declared column choice completes every case.',
  },
  {
    keys: [
      'N02-ambiguous-number|answered',
      'N05-precision|three-places',
      'N07-ambiguous-date|answered',
    ],
    assist: ['none'],
    verdicts: ['needs-assistance'],
    class: 'assistance-gap',
    plan: 'by design until a source proves the format (C-1)',
    evidence:
      'An ambiguous number or date format, or a three-place currency precision the file does not prove, stops for the accountant’s choice. The declared run supplies the choice and passes. Stopping is the intended unaided behaviour.',
  },
  {
    keys: ['*'],
    formats: ['pdf'],
    assist: ['none'],
    verdicts: ['needs-assistance', 'fail-not-isolated'],
    class: 'assistance-gap',
    plan: 'by design: a PDF extraction is confirmed by the accountant before comparison',
    evidence:
      'Unaided, every PDF source stops with “راجع الصفوف المستخرجة من PDF مع الملف الأصلي، ثم أكد اكتمال المراجعة” until the accountant confirms the extracted rows; the declared run records pdfReviewed (a simulated user decision) and passes. For N08 the stop comes before the impossible date is reached, so the isolate contract reads it as not isolated; after review the row is isolated and the case passes.',
  },
];
