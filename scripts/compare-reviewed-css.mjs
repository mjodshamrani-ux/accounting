// Read-only diagnosis of an unreviewed build; this never approves a distribution.
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const names = (await readdir('dist/assets')).filter(name => name.endsWith('.css'));
if (names.length !== 1) throw Error('Expected one CSS bundle for diagnosis');
const expected = await readFile('audit/build/reviewed.css', 'utf8');
const actual = await readFile(`dist/assets/${names[0]}`, 'utf8');
const sha = text => createHash('sha256').update(text).digest('hex');
console.log(JSON.stringify({ scope: 'CSS diagnosis only; publication guard still required', expectedSHA256: sha(expected), actualSHA256: sha(actual), expectedBytes: Buffer.byteLength(expected), actualBytes: Buffer.byteLength(actual) }));
if (actual !== expected) {
  let start = 0;
  while (start < Math.min(expected.length, actual.length) && expected[start] === actual[start]) start++;
  let suffix = 0;
  while (suffix < Math.min(expected.length, actual.length) - start && expected.at(-1 - suffix) === actual.at(-1 - suffix)) suffix++;
  console.log(JSON.stringify({ firstDifference: start, commonSuffix: suffix, expectedContext: expected.slice(Math.max(0, start - 100), start + 200), actualContext: actual.slice(Math.max(0, start - 100), start + 200) }));
}
