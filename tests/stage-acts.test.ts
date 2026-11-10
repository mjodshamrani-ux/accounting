import assert from 'node:assert/strict';
import test from 'node:test';
import { ar } from '../lib/i18n/locales/ar.ts';
import { en } from '../lib/i18n/locales/en.ts';
import { stageActNames, stageActsCopy } from '../lib/i18n/stage-acts.ts';
import { typeStageRoles } from '../lib/i18n/type-stage.ts';
import { reconciliationDirectoryCopy } from '../lib/i18n/reconciliation-directory.ts';
import {
  inferMapping,
  normalizeReference,
} from '../lib/reconciliation/core.ts';

// The honesty test of the stage (UX-7 record, section 6): what the acts say
// is what the supplier engine does with the records drawn, in both languages.
const forbidden = {
  ar: [/تلقائي/, /آلي/, /مؤكد/, /بثقة/, /مضمون/, /100\s*%/, /طوبق/, /اعتُ?مد/],
  en: [
    /automatic/i,
    /confirmed/i,
    /guarantee/i,
    /confiden/i,
    /certain/i,
    /100\s*%/,
    /matched/i,
    /approved/i,
  ],
};
const required = {
  ar: { mark: 'رسم توضيحي', synthetic: 'اصطناعية', review: 'للمراجعة' },
  en: { mark: 'Illustration', synthetic: 'Synthetic', review: 'for review' },
};
// Words that would name a source the supplier workspace does not name.
const otherSources = {
  ar: [/دفتر/, /كشف (?!المورد)/, /سجل/, /شركة/],
  en: [/ledger/i, /\bbooks?\b/i, /register/i, /company/i, /your /i],
};

const texts = (lang: 'ar' | 'en') => {
  const copy = stageActsCopy[lang];
  return [
    copy.title,
    copy.mark,
    copy.group,
    copy.relation,
    ...copy.acts.flatMap((act) => [
      act.title,
      act.state,
      act.reason ?? '',
      act.line,
    ]),
  ];
};

void test('no act claims more than the engine does', () => {
  for (const lang of ['ar', 'en'] as const)
    for (const text of texts(lang))
      for (const word of forbidden[lang])
        assert.doesNotMatch(text, word, `${lang}: «${text}»`);
});

void test('the acts are marked as an illustration of supplier reconciliation, two of them for review', () => {
  for (const lang of ['ar', 'en'] as const) {
    const copy = stageActsCopy[lang];
    // The caption under every type says it is an illustration; the acts add
    // that their records are synthetic.
    assert.equal(
      (lang === 'ar' ? ar : en).scene.illustration,
      required[lang].mark,
      lang,
    );
    assert.ok(
      copy.mark.includes(required[lang].synthetic),
      `${lang}: the acts' records are marked synthetic`,
    );
    assert.ok(
      copy.title
        .toLowerCase()
        .includes(
          reconciliationDirectoryCopy[lang].supplierTitle.toLowerCase(),
        ),
      `${lang}: the title names the type as the type list does`,
    );
    assert.deepEqual(
      copy.acts.map((act) => act.id),
      ['names', 'lines', 'payments'],
    );
    const [names, lines, payments] = copy.acts;
    assert.doesNotMatch(
      names.state + names.line,
      new RegExp(required[lang].review),
      `${lang}: the first act states no review`,
    );
    for (const act of [lines, payments]) {
      assert.equal(act.state, required[lang].review, `${lang} ${act.id}`);
      assert.ok(
        act.line.includes(required[lang].review),
        `${lang} ${act.id}: its line says so`,
      );
    }
    assert.ok(
      payments.reason &&
        payments.line.toLowerCase().includes(payments.reason.toLowerCase()),
      `${lang}: the reason is written in the line`,
    );
  }
});

void test('the lines name the sources as the supplier workspace names its inputs', () => {
  for (const lang of ['ar', 'en'] as const) {
    const [statement, report] = typeStageRoles[lang].supplier.map((role) =>
      role.name.toLowerCase(),
    );
    for (const act of stageActsCopy[lang].acts) {
      const line = act.line.toLowerCase();
      assert.ok(
        line.includes(statement) && line.includes(report),
        `${lang} ${act.id}: both sources by name`,
      );
      const rest = line.replaceAll(statement, '').replaceAll(report, '');
      for (const word of otherSources[lang])
        assert.doesNotMatch(rest, word, `${lang} ${act.id}`);
    }
  }
});

void test('the first act is what the reader does: both headers are the reference, both references one', () => {
  // The records the papers draw, read as the supplier workspace reads a file.
  const { statement, report } = stageActNames;
  const file = {
    name: 'synthetic.csv',
    sheets: [
      {
        name: 'Sheet1',
        rows: [
          [statement.head, 'Amount'],
          [statement.reference, '100'],
        ],
      },
    ],
  };
  const arabic = {
    name: 'synthetic.csv',
    sheets: [
      {
        name: 'Sheet1',
        rows: [
          [report.head, 'المبلغ'],
          [report.reference, '100'],
        ],
      },
    ],
  };
  assert.equal(inferMapping(file as never).reference, 0);
  assert.equal(inferMapping(arabic as never).reference, 0);
  assert.equal(
    normalizeReference(statement.reference),
    normalizeReference(report.reference),
  );
  // The two references are written differently: the act shows a real
  // difference that the reader resolves, not one string twice.
  assert.notEqual(statement.reference, report.reference);
  assert.notEqual(statement.head, report.head);
});
