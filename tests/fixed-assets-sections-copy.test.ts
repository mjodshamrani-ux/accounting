import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fixedAssetsSectionsCopy as copy } from '../lib/i18n/fixed-assets-sections.ts';

// The section's words in both languages, against the sealed FA-1 contract:
// every code the contract can give has words in English and in Arabic, the
// two languages have the same keys, and each stays in its own script.
const contract = JSON.parse(
  readFileSync(
    new URL(
      '../audit/fixed-assets-sections-foundation/contract.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as { codes: Record<string, string[]> };
const ARABIC = /[\u0600-\u06ff]/u;
// Leaves that are the same in both languages by intent.
const SHARED = new Map([
  ['accountHeaders.4', 'GL'],
  ['none', '\u2014'],
]);

type Leaf = [string, unknown];
const leaves = (value: object, prefix = ''): Leaf[] =>
  Object.entries(value).flatMap(([key, v]): Leaf[] =>
    v && typeof v === 'object'
      ? leaves(v as object, `${prefix}${key}.`)
      : [[`${prefix}${key}`, v]],
  );

void test('every code of the contract has its words in English and in Arabic', () => {
  const { refused, ...rest } = contract.codes;
  const codes = Object.values(rest).flat();
  assert.ok(codes.length > 30, 'the contract lists its codes');
  for (const language of ['en', 'ar'] as const) {
    const words = copy[language];
    for (const code of codes)
      assert.ok(
        typeof words.codes[code] === 'string' && words.codes[code].trim(),
        `${language}: ${code}`,
      );
    // SOURCE_HASH is the engine's refusal beyond the contract (FA-1b).
    for (const code of [...refused, 'SOURCE_HASH'])
      assert.ok(
        typeof words.refusals[code] === 'string' && words.refusals[code].trim(),
        `${language}: refusal ${code}`,
      );
    assert.deepEqual(
      Object.keys(words.codes).sort(),
      [...codes].sort(),
      `${language}: no word for a code the contract does not have`,
    );
  }
});

void test('both languages have the same keys, and each stays in its own script', () => {
  const en = leaves(copy.en);
  const ar = new Map(leaves(copy.ar));
  assert.deepEqual(en.map(([key]) => key).sort(), [...ar.keys()].sort());
  for (const [key, english] of en) {
    const arabic = ar.get(key);
    if (typeof english === 'function') {
      assert.equal(typeof arabic, 'function', key);
      assert.equal((arabic as () => string).length, english.length, key);
      continue;
    }
    assert.equal(typeof english, 'string', key);
    assert.equal(typeof arabic, 'string', key);
    if (SHARED.has(key)) {
      assert.equal(english, SHARED.get(key), key);
      assert.equal(arabic, SHARED.get(key), key);
      continue;
    }
    assert.ok(!ARABIC.test(english as string), `en ${key}`);
    assert.ok(ARABIC.test(arabic as string), `ar ${key}`);
    assert.notEqual(arabic, english, key);
  }
  // The counts read as words in each language.
  assert.match(copy.ar.summary(3, 1, 1, 1, 0, 2, 5), ARABIC);
  assert.doesNotMatch(copy.en.summary(3, 1, 1, 1, 0, 2, 5), ARABIC);
});
