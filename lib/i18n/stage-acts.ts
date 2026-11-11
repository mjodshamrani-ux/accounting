import { typeStageRoles } from './type-stage.ts';

/**
 * Three obstacles of supplier reconciliation, acted on the two papers of the
 * intro when the chosen type is suppliers (UX-7(c)). Each act has three
 * moments: the obstacle as the accountant meets it, the movement that shows
 * the relation, and the state Tarasuf actually shows. Every sentence describes
 * what the supplier engine does with the synthetic records drawn, and the
 * honesty test holds the words: no "automatic", no "confirmed", "for review"
 * on the two acts the engine leaves for review, and the sources named as the
 * supplier workspace names its inputs.
 */
export type StageActId = 'names' | 'lines' | 'payments';
export type StageAct = {
  id: StageActId;
  /** The button's words, read together as the three obstacles. */
  title: string;
  /** What the stage shows at the end of the act. */
  state: string;
  /** The engine's own reason, where it writes one. */
  reason?: string;
  /** The live sentence under the stage. */
  line: string;
};

/** The records of the first act as the two papers draw them: each paper's
 * header for the reference and its reference. They are data in the papers'
 * own words, the same in both languages; the honesty test reads them back
 * through the supplier engine's reader. */
export const stageActNames = {
  statement: { head: 'Invoice No', reference: 'INV-001' },
  report: { head: 'رقم الفاتورة', reference: 'INV001' },
} as const;
const { statement, report } = stageActNames;

const [arStatement, arReport] = typeStageRoles.ar.supplier.map(
  (role) => role.name,
);
const [enStatement, enReport] = typeStageRoles.en.supplier.map(
  (role) => role.name,
);

export const stageActsCopy = {
  ar: {
    title: 'ثلاثة عوائق من تسوية الموردين',
    mark: 'سجلات اصطناعية',
    group: 'عوائق تسوية الموردين',
    relation: 'المرجع',
    acts: [
      {
        id: 'names',
        title: 'مسميان لمرجع واحد',
        state: 'بمصدر كل سطر',
        line: `${statement.head} في ${arStatement} و${report.head} في ${arReport}، و${statement.reference} هنا و${report.reference} هناك: يقترح تراصف أنهما عمود المرجع فتؤكد ذلك، ويقرأ المرجعين مرجعًا واحدًا، ويعرض السطرين متقابلين بمصدر كل منهما.`,
      },
      {
        id: 'lines',
        title: 'فاتورة وأسطرها',
        state: 'للمراجعة',
        line: `فاتورة واحدة في ${arReport} يقسمها ${arStatement} ثلاثة أسطر بالمرجع نفسه: يجمعها تراصف تحتها ويعرضها مجموعة بأدلتها. والمجموع المتساوي وحده لا يثبت أعضاءها، فتبقى للمراجعة.`,
      },
      {
        id: 'payments',
        title: 'حوالة ودفعاتها',
        state: 'للمراجعة',
        reason: 'لم تثبت هوية دفعة واحدة',
        line: `حوالة واحدة في ${arStatement} وثلاث دفعات في ${arReport}: تلتقي عندها وتظهر معًا للمراجعة، وسببها مكتوب: لم تثبت هوية دفعة واحدة.`,
      },
    ] satisfies StageAct[],
  },
  en: {
    title: 'Three obstacles in supplier reconciliation',
    mark: 'Synthetic records',
    group: 'Obstacles in supplier reconciliation',
    relation: 'Reference',
    acts: [
      {
        id: 'names',
        title: 'Two names for one reference',
        state: "with each line's source",
        line: `${statement.head} in the ${enStatement.toLowerCase()} and ${report.head} in the ${enReport.toLowerCase()}, ${statement.reference} here and ${report.reference} there: Tarasuf proposes both as the reference column for you to confirm, reads the two references as one, and shows the two lines side by side, each with its source.`,
      },
      {
        id: 'lines',
        title: 'One invoice and its lines',
        state: 'for review',
        line: `One invoice in the ${enReport.toLowerCase()} that the ${enStatement.toLowerCase()} splits into three lines with the same reference: Tarasuf gathers them under it and shows them as one group with its evidence. An equal total alone does not prove its members, so it stays for review.`,
      },
      {
        id: 'payments',
        title: 'One transfer and its payments',
        state: 'for review',
        reason: 'No single payment identity is established',
        line: `One transfer in the ${enStatement.toLowerCase()} and three payments in the ${enReport.toLowerCase()}: they meet at the transfer and appear together for review, with the reason written: no single payment identity is established.`,
      },
    ] satisfies StageAct[],
  },
} as const;
