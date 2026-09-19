import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const SITE_URL = 'https://mjodshamrani-ux.github.io/accounting/';

/** Check the raw built document, as a social crawler sees it without JavaScript. */
export async function verifySocialMetadata(html, root) {
  const tags = [...html.matchAll(/<meta\b[^>]*>/gi)].map(([tag]) => {
    const attrs = Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value]));
    return attrs;
  });
  const meta = (key) => {
    const matches = tags.filter((tag) => (tag.property || tag.name) === key);
    assert.equal(matches.length, 1, `one static ${key} tag`);
    assert.ok(matches[0].content, `${key} is not empty`);
    return matches[0].content;
  };
  assert.equal(meta('og:type'), 'website');
  assert.equal(meta('og:url'), SITE_URL);
  assert.equal(meta('og:locale'), 'ar_SA');
  assert.equal(meta('og:site_name'), 'تراصف');
  assert.equal(meta('twitter:card'), 'summary_large_image');
  for (const field of ['title', 'description', 'image', 'image:alt']) {
    assert.equal(meta(`og:${field}`), meta(`twitter:${field}`), `consistent ${field}`);
  }
  const image = new URL(meta('og:image'));
  assert.equal(image.href, meta('og:image:secure_url'));
  assert.ok(image.href.startsWith(`${SITE_URL}brand/`), 'share artwork is on our own origin and project path');
  assert.equal(image.search, '');
  assert.equal(meta('og:image:type'), 'image/png');
  const png = await readFile(path.join(root, image.pathname.slice(new URL(SITE_URL).pathname.length)));
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
  assert.equal(meta('og:image:width'), '1200');
  assert.equal(meta('og:image:height'), '630');
  assert.ok(png.length < 300_000, 'share image stays below 300 KB');
  console.log(`Static social metadata verified: local PNG, 1200 × 630, ${png.length} bytes, no JavaScript required.`);
}
