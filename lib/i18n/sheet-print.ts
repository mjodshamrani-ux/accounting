// The words of the reconciliation sheet on paper (UX-6(d)): the command,
// beside each workspace's export, that prints the sheet the export writes
// first. Its name is the sheet's own (`./reconciliation-sheet.ts`).
const en = {
  print: 'Print the reconciliation sheet',
  // Suppliers: with an accepted overlap group the group review writes the
  // workpaper, and it has no reconciliation sheet.
  heldOverlap:
    'With an accepted group, the group review writes the workpaper without a reconciliation sheet, so there is no sheet to print.',
};

const ar: typeof en = {
  print: 'اطبع ورقة التسوية',
  heldOverlap:
    'مع مجموعة مقبولة تكتب مراجعة المجموعات ورقة العمل بلا ورقة تسوية، فلا ورقة تُطبع.',
};

export const sheetPrintCopy = { ar, en };
