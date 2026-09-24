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
    for (const args of [[1, 1, 1], [['#1', '#2']], ['#1']])
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

test('English has exactly the Arabic keys, lists and message parameters', () => {
  assert.deepEqual(
    [...shape(en, '', new Map())].sort(([a], [b]) => a.localeCompare(b)),
    [...shape(ar, '', new Map())].sort(([a], [b]) => a.localeCompare(b)),
  );
});

test('English interface copy contains no Arabic', () => {
  const allowed = [
    'العربية', // the Arabic option, named in Arabic in both languages
    '١٢٣', // an example of the Arabic-Indic digits the image reader struggles with
  ];
  for (const [at, text] of strings(en)) {
    const rest = allowed.reduce((value, word) => value.split(word).join(''), text);
    assert.doesNotMatch(rest, ARABIC, `${at}: ${text}`);
  }
});

test('Arabic interface copy has no stray English words', () => {
  // File formats, units, currency codes and names that stay in Latin script.
  const latin = new Set(
    'PDF Excel CSV XLSX PNG JPEG MB SAR KWD Diagnostics AR EN English UTF Unicode OCR URL'.split(
      ' ',
    ),
  );
  for (const [at, text] of strings(ar))
    for (const word of text.match(/[A-Za-z]{2,}/g) ?? [])
      assert.ok(latin.has(word), `${at}: "${word}" in ${text}`);
});

test('the interface source has no Arabic outside the catalogues', () => {
  const left = sourceLiterals(uiFiles).filter(
    (literal) => !notShown.has(literal.key),
  );
  assert.deepEqual(
    left.map((literal) => `${literal.file}:${literal.line} ${literal.key}`),
    [],
  );
});

test('every engine message has English, and every entry is still used', () => {
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

test('every catalogue entry uses each of its slots, and only those', () => {
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

test('each engine message is recognised and presented with its own values', () => {
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

test('every user-data slot keeps Arabic data verbatim, even engine words', () => {
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

test('user data inside an engine message is never translated', () => {
  // A column heading that happens to be an engine word stays as written.
  assert.equal(
    localizeEngineText(
      'تنسيق النص في المورد قد يخفي محتوى الخلية أو يغيّر عرضه. استخدم نصًا ظاهرًا بتنسيق عام.',
      'en',
    ),
    'The text format in المورد may hide the cell’s content or change how it is displayed. Use visible text with the General format.',
  );
});

test('Arabic engine text is shown exactly as the engine wrote it', () => {
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

test('the assistant gives the same answer to the Arabic and English presets', () => {
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

test('real engine output reads fully in English apart from user data', () => {
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
