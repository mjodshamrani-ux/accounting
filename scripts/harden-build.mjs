import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { SITE_URL, verifySocialMetadata } from './verify-social-metadata.mjs';
const root = 'dist';
const p = path.join(root, 'index.html');
let html = await readFile(p, 'utf8');
// No inline scripts; the worker bundle is self-contained. GitHub Pages cannot set custom HTTP headers.
const policy =
  "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src blob:; connect-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none';";
html = html.replace(
  '<head>',
  `<head>\n<meta http-equiv="Content-Security-Policy" content="${policy}" />`,
);
if (/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/i.test(html))
  throw new Error('Unexpected inline script');
// A canonical URL is inert crawler metadata, not an external resource request.
// Exempt exactly our own canonical link; active resource URLs remain forbidden.
const canonical = `<link rel="canonical" href="${SITE_URL}" />`;
if (html.split(canonical).length !== 2) throw new Error('Missing or duplicate canonical URL');
if (/(?:src|href)=["']https?:\/\//i.test(html.replace(canonical, '')))
  throw new Error('External resource in HTML');
await verifySocialMetadata(html, root);
await writeFile(p, html);
await writeFile(path.join(root, '.nojekyll'), '');
const assets = await readdir(path.join(root, 'assets'));
const code = (await Promise.all(assets.filter(n => n.endsWith('.js')).map(n => readFile(path.join(root, 'assets', n), 'utf8')))).join('');
if (!code.includes('createObjectURL') || !code.includes('base64')) throw new Error('Missing bundled Blob worker');
console.log(
  'Static build hardened: local scripts/worker, no app data connections, relative paths.',
);
