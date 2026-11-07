// The words of the result index (UX-4): its name, the button that opens it
// on a narrow screen, and the name of each part of a result as the index
// lists it. A part keeps its own title where it is; the index names it in a
// word or two.
const en = {
  name: 'Sections of the result',
  open: 'Sections',
  parts: {
    summary: 'Summary',
    explain: 'Explain',
    figures: 'Figures',
    cases: 'Cases',
    pairs: 'Pairs',
    lines: 'Lines',
    links: 'Links',
    groups: 'Groups',
    movements: 'Movements',
    allocations: 'Allocations',
    decision: 'Decision',
    evidence: 'Evidence',
  },
};

const ar: typeof en = {
  name: 'أقسام النتيجة',
  open: 'الأقسام',
  parts: {
    summary: 'الخلاصة',
    explain: 'شرح الأدلة',
    figures: 'الأرقام',
    cases: 'الحالات',
    pairs: 'الأزواج',
    lines: 'البنود',
    links: 'الروابط',
    groups: 'المجموعات',
    movements: 'الحركات',
    allocations: 'التخصيصات',
    decision: 'القرار',
    evidence: 'الأدلة',
  },
};

export const resultIndexCopy = { en, ar };
export type ResultPart = keyof typeof en.parts;
