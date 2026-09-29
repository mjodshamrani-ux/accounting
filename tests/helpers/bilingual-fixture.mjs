import ExcelJS from 'exceljs';
// Supplier: Arabic sheet, headings and descriptions (user data); day/month
// dates that could be month/day; three-decimal KWD amounts that could be
// read with a comma decimal.
// Built once: ExcelJS stamps creation times, and every run must upload the
// same bytes so that fingerprints in the workpaper can be compared.
let supplierBytes;
export async function supplierXlsx() {
  supplierBytes ??= await buildSupplierXlsx();
  return supplierBytes;
}
async function buildSupplierXlsx() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('كشف المورد — أبريل');
  sheet.addRow(['التاريخ', 'رقم المستند', 'البيان', 'المبلغ', 'العملة']);
  for (const row of [
    ['03/04/2026', 'INV-A101', 'فاتورة توريد مواد', '1.250', 'KWD'],
    ['05/04/2026', 'INV-A102', 'فاتورة خدمات صيانة', '2.500', 'KWD'],
    ['07/04/2026', 'PAY-A201', 'دفعة بتحويل بنكي', '-1.250', 'KWD'],
    ['09/04/2026', 'INV-A103', 'فاتورة غير مسجلة لدينا', '0.750', 'KWD'],
    ['11/04/2026', 'INV-A104', 'فاتورة مطابقة', '3.125', 'KWD'],
  ])
    sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
// Ledger: English headings; the reference heading is not one the engine
// recognises, so the column is chosen by hand.
export const ledgerCsv = Buffer.from(
  [
    'Posted,Voucher key,Narrative,Value,Currency',
    '03/04/2026,INV-A101,supply,1.250,KWD',
    '05/04/2026,INV-A102,maintenance,2.600,KWD',
    '07/04/2026,PAY-A201,payment,-1.250,KWD',
    '10/04/2026,CN-A301,credit note,-0.100,KWD',
    '11/04/2026,INV-A104,matched invoice,3.125,KWD',
  ].join('\n'),
);
export const userData = [
  'كشف المورد — أبريل',
  'التاريخ',
  'رقم المستند',
  'البيان',
  'المبلغ',
  'العملة',
  'فاتورة توريد مواد',
  'فاتورة خدمات صيانة',
  'دفعة بتحويل بنكي',
  'فاتورة غير مسجلة لدينا',
  'فاتورة مطابقة',
  'supplier-april.xlsx',
  'ledger-april.csv',
];
