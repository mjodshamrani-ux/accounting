import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// A small, reproducible correction of the locked unpdf 1.8.1 / PDF.js 6.1.200
// bundle. Never edit shared dependencies, load remote code, or patch at runtime.
// Exact bytes and single-occurrence anchors make dependency drift fail closed.
const source = await readFile(
  fileURLToPath(import.meta.resolve('unpdf/pdfjs')),
);
const sha = createHash('sha256').update(source).digest('hex');
if (sha !== '6c826bd6198f20a1ac5c7bf99649cee30a0cc5d0a0730f15f238d5523dcd30b8')
  throw Error(
    'The audited native PDF dependency changed; review before building.',
  );
const changes = [
  // System font substitution is for rendering only. An explicit ToUnicode
  // map is source text, including entire multi-codepoint strings, not glyph IDs.
  [
    'this.toFontChar=r,this.toUnicode=new ToUnicodeMap(r)',
    'this.toFontChar=r,e.hasIncludedToUnicodeMap||(this.toUnicode=new ToUnicodeMap(r))',
  ],
  [
    'typeof c==`number`&&(c=String.fromCharCode(c))',
    'typeof c==`number`&&(c=String.fromCodePoint(c))',
  ],
  // Reject malformed UTF-16BE instead of padding odd bytes, treating low
  // surrogates as high ones, or manufacturing a scalar from an invalid pair.
  [
    't.length%2!=0&&(t=`\\0`+t);let r=[];for(let e=0;e<t.length;e+=2){let n=t.charCodeAt(e)<<8|t.charCodeAt(e+1);if((n&63488)!=55296){r.push(n);continue}e+=2;let i=t.charCodeAt(e)<<8|t.charCodeAt(e+1);r.push(((n&1023)<<10)+(i&1023)+65536)}',
    'if(t.length%2!==0)throw new FormatError$1(`Invalid ToUnicode UTF-16BE length`);let r=[];for(let e=0;e<t.length;e+=2){let n=t.charCodeAt(e)<<8|t.charCodeAt(e+1);if(n<55296||n>57343){r.push(n);continue}if(n>56319||e+3>=t.length)throw new FormatError$1(`Invalid ToUnicode surrogate`);e+=2;let i=t.charCodeAt(e)<<8|t.charCodeAt(e+1);if(i<56320||i>57343)throw new FormatError$1(`Invalid ToUnicode pair`);r.push(((n&1023)<<10)+(i&1023)+65536)}',
  ],
];
let bundle = source.toString('utf8');
for (const [before, after] of changes) {
  if (bundle.split(before).length !== 2)
    throw Error('Native PDF patch anchor drift.');
  bundle = bundle.replace(before, after);
}
await writeFile(
  new URL('../lib/reconciliation/pdfjs-native.generated.mjs', import.meta.url),
  bundle,
);
console.log(
  'Prepared audited local native PDF reader: explicit Unicode maps and strict UTF-16BE.',
);
