const en = {
  title: 'Remittance advice review (ALL-1)',
  intro:
    'Proposed review allocation-advice-review-1, beside the allocation above and not instead of it. The same three files, readings, scope and decisions. For every advice line: whether a decision already allocated it, whether it alone exceeds what is left on its payment or its invoice, whether the open lines on its payment or invoice together exceed what is left there and which lines it competes with, and which lines are its twins: the same payment, invoice and amount under another line ID.',
  limits:
    'Review only. No line is chosen, dropped or merged, and no decision is taken here; the allocation above keeps its decisions, session and Excel. A line that fits can be approved without taking what another open line was advised to take. A source error anywhere refuses the review, as the allocation above refuses every decision.',
  check: 'Review the advice lines',
  refused: 'Refused: nothing was reviewed',
  refusals: {
    SOURCE_ERRORS:
      'A row of a file cannot be read; the allocation refuses every decision',
    SOURCE: 'A file could not be read as a CSV or XLSX snapshot',
    SOURCE_HASH: 'A file changed while it was read',
    ROWS: 'A sheet holds more lines than the reader admits',
    READING: 'A reading is incomplete',
    SCOPE: 'The scope is incomplete or not confirmed',
    COLUMNS: 'A file does not have the family columns',
    EVENT: 'A decision does not belong to these files',
    OVER_AVAILABLE: 'A decision takes more than a payment or an invoice holds',
    PROOF: 'A decision uses an advice line it cannot use',
  } as Record<string, string>,
  summary: (lines: number, fits: number, review: number, allocated: number) =>
    `${lines} advice lines: ${fits} fit, ${review} to review, ${allocated} already allocated.`,
  byReason: 'Lines to review, by reason',
  linesTitle: 'Advice lines',
  lineHeaders: [
    'Row',
    'Line',
    'Payment → invoice',
    'Amount',
    'Status',
    'Reasons',
    'Competes with',
    'Twins',
  ],
  itemsTitle: 'Payments and invoices',
  itemHeaders: [
    'Kind',
    'Reference',
    'Available',
    'Allocated',
    'Left',
    'Open advice',
    'Excess',
  ],
  sides: ['Payment', 'Invoice'],
  rows: (rows: number[]) =>
    rows.length > 10
      ? `${rows.length} lines: rows ${rows.slice(0, 10).join(', ')}, …`
      : rows.length
        ? `rows ${rows.join(', ')}`
        : '—',
  status: {
    allocated: 'Allocated',
    fits: 'Fits',
    review: 'To review',
  } as Record<string, string>,
  reasons: {
    OVER_PAYMENT: 'Exceeds what is left on its payment',
    OVER_INVOICE: 'Exceeds what is left on its invoice',
    COMPETES_PAYMENT:
      'Fits its payment alone, but the open lines on the payment exceed what is left',
    COMPETES_INVOICE:
      'Fits its invoice alone, but the open lines on the invoice exceed what is left',
    TWIN: 'Another line has the same payment, invoice and amount',
  } as Record<string, string>,
};

const ar: typeof en = {
  title: 'مراجعة أسطر الحوالة (ALL-1)',
  intro:
    'مراجعة مقترحة allocation-advice-review-1، بجانب التخصيص أعلاه لا بدلًا منه، بالملفات الثلاثة وقراءاتها ونطاقها وقراراتها أنفسها. لكل سطر حوالة: هل خصصه قرار، وهل يتجاوز وحده ما بقي في دفعته أو فاتورته، وهل تتجاوز الأسطر المفتوحة على دفعته أو فاتورته معًا ما بقي فيها ومع أي أسطر يتنافس، وما توائمه: الدفعة والفاتورة والمبلغ أنفسها برقم سطر آخر.',
  limits:
    'للمراجعة فقط. لا يُختار سطر ولا يُحذف ولا يُدمج، ولا يُتخذ هنا قرار؛ والتخصيص أعلاه يحتفظ بقراراته وجلسته وExcel. والسطر الذي يسع يُعتمد دون أن يأخذ ما نُصح به سطر مفتوح آخر. وخطأ مصدر في أي مكان يرفض المراجعة، كما يرفض التخصيص أعلاه كل قرار.',
  check: 'راجع أسطر الحوالة',
  refused: 'مرفوضة: لم يُراجع شيء',
  refusals: {
    SOURCE_ERRORS: 'صف في أحد الملفات لا يُقرأ، والتخصيص يرفض كل قرار',
    SOURCE: 'تعذرت قراءة ملف لقطة CSV أو XLSX',
    SOURCE_HASH: 'تغير ملف أثناء قراءته',
    ROWS: 'في ورقة أسطر أكثر مما يقبله القارئ',
    READING: 'قراءة غير مكتملة',
    SCOPE: 'النطاق غير مكتمل أو غير مؤكد',
    COLUMNS: 'ملف بلا أعمدة العائلة',
    EVENT: 'قرار لا ينتمي إلى هذه الملفات',
    OVER_AVAILABLE: 'قرار يأخذ أكثر مما في دفعة أو فاتورة',
    PROOF: 'قرار يستعمل سطر حوالة لا يجوز له',
  },
  summary: (lines, fits, review, allocated) =>
    `${lines} سطر حوالة: ${fits} تسع، و${review} للمراجعة، و${allocated} مخصصة.`,
  byReason: 'الأسطر التي للمراجعة حسب السبب',
  linesTitle: 'أسطر الحوالة',
  lineHeaders: [
    'الصف',
    'السطر',
    'الدفعة ← الفاتورة',
    'المبلغ',
    'الحالة',
    'الأسباب',
    'يتنافس مع',
    'التوائم',
  ],
  itemsTitle: 'الدفعات والفواتير',
  itemHeaders: [
    'النوع',
    'المرجع',
    'المتاح',
    'المخصص',
    'الباقي',
    'المنصوح به',
    'الزيادة',
  ],
  sides: ['دفعة', 'فاتورة'],
  rows: (rows) =>
    rows.length > 10
      ? `${rows.length} سطرًا: الصفوف ${rows.slice(0, 10).join('، ')}، …`
      : rows.length
        ? `الصفوف ${rows.join('، ')}`
        : '—',
  status: { allocated: 'مخصص', fits: 'يسع', review: 'للمراجعة' },
  reasons: {
    OVER_PAYMENT: 'يتجاوز ما بقي في دفعته',
    OVER_INVOICE: 'يتجاوز ما بقي في فاتورته',
    COMPETES_PAYMENT:
      'يسع دفعته وحده، لكن الأسطر المفتوحة على الدفعة تتجاوز ما بقي فيها',
    COMPETES_INVOICE:
      'يسع فاتورته وحده، لكن الأسطر المفتوحة على الفاتورة تتجاوز ما بقي فيها',
    TWIN: 'سطر آخر بالدفعة والفاتورة والمبلغ أنفسها',
  },
};

export const allocationAdviceCopy = { en, ar };
