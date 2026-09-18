import type { Mapping, SheetData, Transaction } from './types.ts';
import { headerMatches } from './header-labels.ts';

// Secondary evidence is read only from explicit, unique headers and safe cells.
// The original parsed row remains available even when a field is not usable.
export function transactionReferences(
  sheet: SheetData,
  mapping: Mapping,
  row: string[],
  rn: number,
) {
  const headers = sheet.rows[mapping.header].map((h) =>
    h.trim().toLowerCase().replace(/[._]/g, '').replace(/\s+/g, ' '),
  );
  const referenceEvidenceIssues: string[] = [];
  const field = (pattern: RegExp) => {
    const columns = headers.flatMap((h, i) =>
      headerMatches(pattern, h) ? [i] : [],
    );
    if (columns.length !== 1) {
      if (columns.length > 1)
        referenceEvidenceIssues.push(
          'عنوان دليل مرجعي مكرر: ' +
            columns.map((c) => headers[c]).join(' / '),
        );
      return '';
    }
    const col = columns[0],
      key = `${rn}:${col + 1}`,
      headerKey = `${mapping.header + 1}:${col + 1}`;
    if (
      sheet.cellIssues?.[key]?.length ||
      sheet.referenceIssues?.[key]?.length ||
      sheet.cellIssues?.[headerKey]?.length ||
      sheet.referenceIssues?.[headerKey]?.length ||
      sheet.hiddenRows.includes(rn)
    ) {
      referenceEvidenceIssues.push(
        `دليل غير مقروء بثقة: ${headers[col]}، صف ${rn}`,
      );
      return '';
    }
    return (row[col] ?? '').trim();
  };
  const rawType = field(
    /^(?:type|doc type|document type|transaction type|نوع المستند|نوع الحركة|النوع)$/i,
  );
  // PDF fonts may emit Arabic presentation forms. Normalize the category label
  // only; never rewrite references, source cells or financial tokens.
  const categoryType = rawType.normalize('NFKC');
  const documentType: NonNullable<Transaction['documentType']> =
    /^(?:(?:ap )?(?:invoice|invoice line)|فاتورة|فاتوره)$/i.test(categoryType)
      ? 'Invoice'
      : /^(?:(?:ap )?(?:credit note|credit memo)|إشعار دائن|اشعار دائن)$/i.test(
            categoryType,
          )
        ? 'Credit Note'
        : /^(?:payment|receipt|supplier payment|دفعة|سداد|دفع|قبض)$/i.test(
              categoryType,
            )
          ? 'Payment'
          : /^(?:journal|adjustment|journal entry|قيد|تسوية)$/i.test(
                categoryType,
              )
            ? 'Journal'
            : 'Unknown';
  if (rawType && documentType === 'Unknown')
    referenceEvidenceIssues.push(`نوع مستند غير متحقق: ${rawType}`);
  const documentReference = field(
    /^(?:supplier ref(?:erence)?|document (?:no|number|ref(?:erence)?)|invoice (?:no|number|ref(?:erence)?)|رقم المستند|مرجع المورد|رقم الفاتورة)$/i,
  );
  const voucherReference = field(
    /^(?:(?:ap |payment )?voucher(?: (?:no|number|ref(?:erence)?))?|رقم القيد|مرجع القيد|سند)$/i,
  );
  const combined = field(/^(?:po \/ bank ref|po\/bank ref)$/i);
  const customerReference = field(/^customer ref \/ po$/i);
  const poReference =
    field(
      /^(?:po|po (?:no|number|ref(?:erence)?)|purchase order|أمر الشراء|امر الشراء)$/i,
    ) || (documentType !== 'Payment' ? combined || customerReference : '');
  const explicitBankReference = field(
    /^(?:bank ref(?:erence)?|مرجع البنك|المرجع البنكي)$/i,
  );
  const bankReference =
    explicitBankReference ||
    (documentType === 'Payment' ? combined || customerReference : '');
  const explicitReceiptReference = field(
    /^(?:receipt(?: (?:no|number|ref(?:erence)?))?|رقم الإيصال|رقم الايصال)$/i,
  );
  const receiptReference =
    explicitReceiptReference ||
    (documentType === 'Payment' &&
    /(?:^|[- /])(?:RCPT|RECEIPT|PAY|PYM)(?:[- /]|$)/i.test(documentReference)
      ? documentReference
      : '');
  const batch = field(
    /^(?:batch(?: ref(?:erence)?| number| no)?|مرجع الدفعة)$/i,
  );
  const mapped =
    mapping.reference < 0 ? '' : (row[mapping.reference] ?? '').trim();
  const primaryReference =
    documentType === 'Payment'
      ? bankReference ||
        receiptReference ||
        voucherReference ||
        documentReference ||
        mapped
      : documentType === 'Journal'
        ? voucherReference || batch || documentReference || mapped
        : documentReference || voucherReference || mapped || poReference;
  // An order can legitimately have several invoices of the same amount. Keep
  // an order-only identity visible, but never present it as proof of a document.
  if (
    poReference &&
    primaryReference === poReference &&
    !documentReference &&
    !voucherReference &&
    (!mapped || mapped === poReference)
  )
    referenceEvidenceIssues.push('أمر الشراء وحده لا يثبت هوية الفاتورة');
  return {
    primaryReference,
    documentReference,
    voucherReference,
    poReference,
    bankReference,
    receiptReference,
    paymentIdentityFields: [
      ...(explicitBankReference ? ['bankReference' as const] : []),
      ...(explicitReceiptReference ? ['receiptReference' as const] : []),
    ],
    documentType,
    referenceEvidenceIssues: [...new Set(referenceEvidenceIssues)],
  };
}
