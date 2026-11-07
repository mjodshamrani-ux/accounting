import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ar } from '../lib/i18n/locales/ar.ts';
import { en } from '../lib/i18n/locales/en.ts';
import { engineCatalog } from '../lib/i18n/engine-catalog.ts';
import { localizeEngineText } from '../lib/i18n/engine.ts';
import { explainResult } from '../lib/reconciliation/assistant.ts';
import { compare, normalizeSource } from '../lib/reconciliation/core.ts';
import { demoFiles, demoMappings, demoScope } from '../lib/reconciliation/demo.ts';
import { ARABIC, SLOT, sourceLiterals } from './helpers/i18n-source-scan.ts';
import { NOT_SHOWN } from './helpers/i18n-not-shown.ts';

const engineFiles = fs
  .readdirSync('lib/reconciliation')
  .filter((file) => file.endsWith('.ts'))
  .map((file) => `lib/reconciliation/${file}`);
const uiFiles = [
  'app/page.tsx',
  'main.tsx',
  ...fs
    .readdirSync('components', { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.tsx'))
    .map((file) => path.join('components', file)),
];
const notShown = new Set(Object.values(NOT_SHOWN).flat());

type Tree = { [key: string]: unknown };
function shape(value: unknown, at: string, out: Map<string, string>) {
  if (typeof value === 'function') out.set(at, `function/${value.length}`);
  else if (Array.isArray(value)) {
    out.set(at, `array/${value.length}`);
    value.forEach((item, i) => shape(item, `${at}[${i}]`, out));
  } else if (value && typeof value === 'object')
    for (const [key, item] of Object.entries(value as Tree))
      shape(item, at ? `${at}.${key}` : key, out);
  else out.set(at, typeof value);
  return out;
}
function strings(value: unknown, at = ''): [string, string][] {
  if (typeof value === 'string') return [[at, value]];
  if (typeof value === 'function') {
    // Call with sample arguments so parameterised messages are checked too:
    // numbers for counts and rows, then a list or a word where one is expected.
    const call = value as (...args: unknown[]) => unknown;
    let text: unknown;
    for (const args of [Array(Math.max(3, value.length)).fill(1), [['#1', '#2']], ['#1']])
      try {
        text = call(...args);
        break;
      } catch {
        // Try the next kind of argument.
      }
    return strings(Array.isArray(text) ? text.join(' ') : text, `${at}()`);
  }
  if (value && typeof value === 'object')
    return Object.entries(value as Tree).flatMap(([key, item]) =>
      strings(item, at ? `${at}.${key}` : key),
    );
  return [];
}

void test('English has exactly the Arabic keys, lists and message parameters', () => {
  assert.deepEqual(
    [...shape(en, '', new Map())].sort(([a], [b]) => a.localeCompare(b)),
    [...shape(ar, '', new Map())].sort(([a], [b]) => a.localeCompare(b)),
  );
});

// Every command reads as an imperative in Arabic, «افتح» and «استعد», as the
// English already does (UX-5): a string whose English begins with the verb of
// a command must not begin, in Arabic, with the noun of that action («فتح»،
// «استعادة»). Every catalogue is read, the shared one and each workspace's.
// A sentence, which ends with a full stop, and a text of more than fourteen
// words are not commands. «تحقق» and «فك» read as either form and are not
// counted. Names that are not commands are listed with why, and each must
// still name something.
const COMMAND =
  /^(?:Open|Restore|Save|Export|Check|Compare|Verify|Read|Approve|Reject|Cancel|Undo|Download|Add|Reopen|Run|Try|Resume|Show|Hide|Clear|Remove|Use|Confirm|Apply|Load|Create|Start|Reset|Choose|Select|Accept|Decline|Mark|Record|Copy|Print|Ask|Review|Continue|Go|Edit|Set|Insert|Fix|Expand|Collapse|Switch|Return|Back|Delete|Discard|Keep|Include|Exclude|Enable|Disable|Upload|Attach|Replace|Retry|Close|Measure|Calculate|Match|Link|Unlink|Split|Merge|Assign|Allocate|Reconcile|Find|Search|Filter|Sort|Move|Next|Previous|Done|Finish|Submit|Send|Share|Generate|Build|Request|Inspect|Explain|Play|Pause|Skip|Restart|Suggest|Prepare|Change|Reverse)\b/u;
const VERBAL_NOUN =
  /^(?:فتح|استعادة|حفظ|فحص|تصدير|تنزيل|إعادة|اعتماد|رفض|إلغاء|التراجع|مقارنة|قراءة|إضافة|عرض|إخفاء|إظهار|مسح|إزالة|حذف|استخدام|تأكيد|تطبيق|تحميل|إنشاء|بدء|اختيار|تحديد|قبول|تسجيل|نسخ|طباعة|تشغيل|تجربة|استئناف|متابعة|مراجعة|تعديل|إغلاق|العودة|عودة|الرجوع|انتقال|الانتقال|استبدال|إنهاء|إتمام|تفعيل|تعطيل|توسيع|طي|تحرير|ضبط|تعيين|إدراج|تصحيح|إرفاق|حساب|قياس|مطابقة|ربط|تقسيم|دمج|إسناد|تخصيص|تسوية|بحث|البحث|تصفية|ترتيب|مشاركة|توليد|طلب|شرح|تفسير|إيقاف|اقتراح|إعداد|استبعاد|تغيير|عكس)(?:\s|$)/u;
const NOT_COMMANDS: [RegExp, string][] = [
  [/\.(?:actions|eventTypes?|decisionTypes)\./u, 'a decision as the history records it'],
  [/\.codes\./u, 'a reader message'],
  [/^resultIndexCopy\.parts\./u, 'the name of a part of the result'],
  [/^runningBalanceCopy\.selection$/u, 'a heading'],
  [/^locales\.transactionReview\.heading$/u, 'a heading'],
  [/^locales\.transactionReview\.searchLabel$/u, 'the name of a search field'],
  [/^locales\.app\.results\.(?:filter|search)$/u, 'the names of a tab list and a search field'],
  [/^locales\.visualAccounting\.title$/u, 'the title of a section'],
  [/^locales\.visualReview\.(?:cellLabel|regionLabel)$/u, 'the name of a region'],
  [/^locales\.reviewEffort\.title$/u, 'the title of a section'],
  [/^locales\.landing\.privacy\.steps$/u, 'the steps of the work, named'],
  [/^locales\.app\.shell\.(?:resetTitle|steps\[\d\])$/u, 'a dialog title and the steps of the work'],
  [/^locales\.app\.source\.exclude$/u, 'the name of a disclosure holding the exclusion form'],
];
function sample(value: (...args: unknown[]) => unknown) {
  for (const args of [Array(Math.max(3, value.length)).fill(1), [['#1', '#2']], ['#1']])
    try {
      return value(...args);
    } catch {
      // Try the next kind of argument.
    }
  return undefined;
}
function paired(english: unknown, arabic: unknown, at: string, out: [string, string, string][]) {
  if (typeof english === 'function' && typeof arabic === 'function') {
    const [e, a] = [sample(english as never), sample(arabic as never)];
    if (typeof e === 'string' && typeof a === 'string') out.push([`${at}()`, e, a]);
  } else if (typeof english === 'string' && typeof arabic === 'string') out.push([at, english, arabic]);
  else if (Array.isArray(english) && Array.isArray(arabic))
    english.forEach((item, i) => paired(item, arabic[i], `${at}[${i}]`, out));
  else if (english && arabic && typeof english === 'object' && typeof arabic === 'object')
    for (const key of Object.keys(english))
      paired((english as Tree)[key], (arabic as Tree)[key], at ? `${at}.${key}` : key, out);
}
function catalogues(value: unknown, at: string, out: [string, string, string][], seen: Set<unknown>) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  const tree = value as Tree;
  if (tree.ar && tree.en && typeof tree.ar === 'object') paired(tree.en, tree.ar, at, out);
  else for (const key of Object.keys(tree)) catalogues(tree[key], `${at}.${key}`, out, seen);
}

void test('every command reads as an imperative in Arabic', async () => {
  const pairs: [string, string, string][] = [];
  paired(en, ar, 'locales', pairs);
  const seen = new Set<unknown>();
  for (const file of fs.readdirSync('lib/i18n').filter((f) => f.endsWith('.ts')).sort()) {
    // text.ts holds a class, not copy, and is not loadable without a build.
    if (file === 'text.ts') continue;
    for (const [name, value] of Object.entries(
      (await import(`../lib/i18n/${file}`)) as Tree,
    ))
      catalogues(value, name, pairs, seen);
  }
  assert.ok(pairs.length > 3000, `${pairs.length} pairs read`);
  const used = new Set<string>();
  const nouns = pairs.filter(([at, english, arabic]) => {
    const text = english.trim();
    if (!COMMAND.test(text) || text.endsWith('.') || text.split(/\s+/u).length > 14) return false;
    if (!VERBAL_NOUN.test(arabic.trim())) return false;
    const reason = NOT_COMMANDS.find(([pattern]) => pattern.test(at));
    if (reason) used.add(reason[1] + reason[0].source);
    return !reason;
  });
  assert.deepEqual(
    nouns.map(([at, english, arabic]) => `${at}: ${english} → ${arabic}`),
    [],
  );
  assert.deepEqual(
    NOT_COMMANDS.filter(([pattern, why]) => !used.has(why + pattern.source)).map(
      ([pattern]) => pattern.source,
    ),
    [],
    'every listed name still names something',
  );
});

// Each workspace's intro reads in two lines at a phone's width (UX-5): the
// browser census counts any that runs longer (`longIntro`); this bounds its
// length, from the longest that measured two lines at 390 px in each
// language, and requires what was moved out of it to be in the scope details
// in both languages.
void test('each workspace intro is short, and its detail is kept', async () => {
  const catalogues = {
    ar: [ar.bank, ar.allocation, ar.glTb, ar.arDocuments, ar.clearing],
    en: [en.bank, en.allocation, en.glTb, en.arDocuments, en.clearing],
  };
  const domain = (await Promise.all(
    ['intercompany', 'payment-gateway', 'inventory-register', 'fixed-assets', 'payroll'].map(
      (file) => import(`../lib/i18n/${file}.ts`),
    ),
  )) as Tree[];
  const intros: [string, string, string][] = [];
  for (const language of ['ar', 'en'] as const) {
    for (const copy of catalogues[language]) intros.push([language, copy.intro, copy.introDetail]);
    const financial = language === 'ar' ? ar.financial : en.financial;
    intros.push([
      language,
      financial.reviewAccountsDimensionsMappingSignsPeriodAndCurrency,
      financial.introDetail,
    ]);
    for (const exported of domain) {
      const copy = (Object.values(exported)[0] as Tree)[language] as Tree;
      intros.push([language, copy.intro as string, copy.introDetail as string]);
    }
  }
  assert.equal(intros.length, 22);
  for (const [language, intro, detail] of intros) {
    assert.ok(intro.length <= (language === 'ar' ? 80 : 92), `${language} intro: ${intro}`);
    assert.ok(detail && detail.trim().length > 0, `${language} detail for: ${intro}`);
  }
});

void test('English interface copy contains no Arabic', () => {
  const allowed = [
    'العربية', // the Arabic option, named in Arabic in both languages
    '١٢٣', // an example of the Arabic-Indic digits the image reader struggles with
  ];
  for (const [at, text] of strings(en)) {
    const rest = allowed.reduce((value, word) => value.split(word).join(''), text);
    assert.doesNotMatch(rest, ARABIC, `${at}: ${text}`);
  }
});

// Digits are Western in both languages: a figure reads the same in Arabic
// and English, and copied numbers stay the numbers the engine wrote. The one
// exception names the Arabic-Indic digits the image reader struggles with.
void test('interface copy and source write numbers in Western digits only', () => {
  const indic = /[\u0660-\u0669\u06F0-\u06F9]/u;
  const files = [
    ...fs
      .readdirSync('lib/i18n', { recursive: true, encoding: 'utf8' })
      .filter((file) => file.endsWith('.ts'))
      .map((file) => path.join('lib/i18n', file)),
    ...uiFiles,
  ];
  const found = files.flatMap((file) =>
    fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((line, i) =>
        indic.test(line.split('١٢٣').join(''))
          ? [`${file}:${i + 1}: ${line.trim()}`]
          : [],
      ),
  );
  assert.deepEqual(found, []);
});

void test('Arabic interface copy has no stray English words', () => {
  // File formats, units, currency codes and names that stay in Latin script.
  const latin = new Set(
    'PDF Excel CSV XLSX PNG JPEG MB SAR KWD Diagnostics AR EN English Shift Enter Escape UTF Unicode OCR URL'.split(
      ' ',
    ),
  );
  for (const [at, text] of strings(ar))
    for (const word of text.match(/[A-Za-z]{2,}/g) ?? [])
      assert.ok(latin.has(word), `${at}: "${word}" in ${text}`);
});

void test('the interface source has no Arabic outside the catalogues', () => {
  const left = sourceLiterals(uiFiles).filter(
    (literal) => !notShown.has(literal.key),
  );
  assert.deepEqual(
    left.map((literal) => `${literal.file}:${literal.line} ${literal.key}`),
    [],
  );
});

void test('every engine message has English, and every entry is still used', () => {
  const literals = sourceLiterals(engineFiles);
  const keys = new Set(literals.map((literal) => literal.key));
  const missing = literals.filter(
    (literal) => !(literal.key in engineCatalog) && !notShown.has(literal.key),
  );
  assert.deepEqual(
    missing.map((literal) => `${literal.file}:${literal.line} ${literal.key}`),
    [],
    'engine messages without English in lib/i18n/engine-catalog.ts',
  );
  const pageKeys = new Set(sourceLiterals(['app/page.tsx']).map((l) => l.key));
  assert.deepEqual(
    Object.keys(engineCatalog).filter((key) => !keys.has(key)),
    [],
    'catalogue entries that no longer exist in the engine',
  );
  assert.deepEqual(
    [...notShown].filter((key) => !keys.has(key) && !pageKeys.has(key)),
    [],
    'exclusions that no longer exist in the source',
  );
});

void test('every catalogue entry uses each of its slots, and only those', () => {
  for (const [arabic, english] of Object.entries(engineCatalog)) {
    const slots = arabic.split(SLOT).length - 1;
    const used = [...english.matchAll(/\{[et]?(\d+)\}/g)].map((m) => Number(m[1]));
    assert.deepEqual(
      [...new Set(used)].sort((a, b) => a - b),
      Array.from({ length: slots }, (_, i) => i),
      arabic,
    );
    assert.doesNotMatch(english.replace(/\{[et]?\d+\}/g, ''), ARABIC, arabic);
  }
});

void test('each engine message is recognised and presented with its own values', () => {
  for (const [arabic, english] of Object.entries(engineCatalog)) {
    const parts = arabic.split(SLOT);
    // Latin sample values are user data: they must come through unchanged.
    let arabicText = parts[0];
    for (let i = 1; i < parts.length; i++) arabicText += `V${i - 1}` + parts[i];
    // Slots written back to back are captured together.
    const merged = english.replace(/\{[et]?(\d+)\}/g, (_, i) => `V${i}`);
    assert.equal(localizeEngineText(arabicText, 'en'), merged, arabic);
  }
});

void test('every user-data slot keeps Arabic data verbatim, even engine words', () => {
  // Data that is itself an engine word is the hardest case: it must still
  // be shown exactly as written wherever the slot holds user data.
  const words = ['المورد', 'بلا مرجع', 'فارغ', 'التاريخ'];
  for (const [arabic, english] of Object.entries(engineCatalog)) {
    const parts = arabic.split(SLOT);
    if (parts.length === 1) continue;
    const modes = new Map(
      [...english.matchAll(/\{([et]?)(\d+)\}/g)].map((m) => [Number(m[2]), m[1]]),
    );
    // Only slots that stand alone can be checked value by value.
    if (parts.slice(1, -1).some((part) => part === '')) continue;
    const values = parts.slice(1).map((_, i) =>
      modes.get(i) === '' ? words[i % words.length] : `V${i}`,
    );
    let text = parts[0];
    values.forEach((value, i) => (text += value + parts[i + 1]));
    const expected = english.replace(
      /\{[et]?(\d+)\}/g,
      (_, i) => values[Number(i)],
    );
    assert.equal(localizeEngineText(text, 'en'), expected, arabic);
  }
});

void test('user data inside an engine message is never translated', () => {
  // A column heading that happens to be an engine word stays as written.
  assert.equal(
    localizeEngineText(
      'تنسيق النص في المورد قد يخفي محتوى الخلية أو يغيّر عرضه. استخدم نصًا ظاهرًا بتنسيق عام.',
      'en',
    ),
    'The text format in المورد may hide the cell’s content or change how it is displayed. Use visible text with the General format.',
  );
});

void test('Arabic engine text is shown exactly as the engine wrote it', () => {
  for (const arabic of Object.keys(engineCatalog))
    assert.equal(localizeEngineText(arabic, 'ar'), arabic);
});

const scope = { ...demoScope, confirmed: true };
const demoResult = () =>
  compare(
    normalizeSource(demoFiles[0], demoMappings[0], scope, 'supplier'),
    normalizeSource(demoFiles[1], demoMappings[1], scope, 'ledger'),
    scope,
    [],
    [],
  );

void test('the assistant gives the same answer to the Arabic and English presets', () => {
  const result = demoResult();
  const id = result.cases.find((c) => c.status !== 'Matched')!.supplierMembers[0]
    ?.id;
  for (const preset of ['balances', 'unverified', 'next', 'explain'] as const) {
    const selected = preset === 'explain' ? id : undefined;
    const arabic = explainResult(result, ar.assistant.presets[preset], selected);
    const english = explainResult(result, en.assistant.presets[preset], selected);
    assert.notEqual(arabic.kind, 'unsupported', preset);
    assert.deepEqual(english, arabic, preset);
  }
});

void test('real engine output reads fully in English apart from user data', () => {
  const result = demoResult();
  const texts = [
    ...result.diagnostics.map((d) => d.message),
    ...result.cases.flatMap((c) => c.evidence),
    ...result.matches.map((m) => m.reason),
    ...(['balances', 'unverified', 'next'] as const).map(
      (preset) => explainResult(result, en.assistant.presets[preset]).text,
    ),
    ...[...result.supplier.transactions, ...result.ledger.transactions].map(
      (t) => explainResult(result, en.assistant.presets.explain, t.id).text,
    ),
  ];
  const userData = demoFiles
    .flatMap((file) => file.sheets.flatMap((sheet) => [sheet.name, ...sheet.rows.flat()]))
    .filter((value) => ARABIC.test(value))
    .sort((a, b) => b.length - a.length);
  for (const text of texts) {
    let english = localizeEngineText(text, 'en');
    for (const value of userData) english = english.split(value).join('');
    assert.doesNotMatch(english, ARABIC, text);
  }
});
