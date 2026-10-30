// The FA-1 reader against the sealed oracle's tokenizer, input by input.
//
// assetSectionsCSV (the product) and tokenize in
// audit/fixed-assets-sections-foundation/oracle.py (sealed, read as it is)
// read the same bytes: seeded CSV files built cell by cell, the same files
// with one fault planted in their text or bytes, and fixed inputs at every
// limit of the contract. Each must give the same records, or the same
// refusal code. A crash on either side is a difference.
//
// The comparison is tested before it is believed: the reader is copied with
// one plausible fault at a time, and every faulty copy must differ from the
// oracle on at least one input; the copy without a fault must not.
//
//   node --experimental-strip-types scripts/fixed-assets-sections-reader-differential.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const ORACLE = 'audit/fixed-assets-sections-foundation';
const CSV = 'lib/reconciliation/fixed-assets-csv.ts';
const IO = 'lib/reconciliation/fixed-assets-sections-io.ts';
const SEED = 20261030;
const COUNT = 3000;
const GENERATOR = 'fa-sections-reader-differential/1';
const MIB8 = 8 * 1024 * 1024;

// A small deterministic generator (mulberry32).
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ASTRAL = '\u{1D538}';
const FRAGMENTS = [
  '',
  'a',
  'Asset ID',
  'KIT/0001',
  '12,500.000',
  '-0.010',
  ' lead',
  'trail ',
  '\t',
  ' ',
  '\u0639\u0631\u0628\u064a',
  ASTRAL,
  '"',
  'x"y',
  '""',
  'line\nbreak',
  'cr\ronly',
  'crlf\r\nin',
  '\ufeff',
  '\u2028',
  '\u0085',
  '\u00a0',
  '=SUM(A1)',
];
const FORBIDDEN = [
  '\u0000',
  '\u0001',
  '\u0008',
  '\u000b',
  '\u000c',
  '\u000e',
  '\u001f',
  '\ufffe',
  '\uffff',
];
const BAD_BYTES = [
  [0xff],
  [0x80],
  [0xc0, 0x80],
  [0xed, 0xa0, 0x80],
  [0xe2, 0x82],
  [0xf4, 0x90, 0x80, 0x80],
];
const encode = (text) => Buffer.from(text, 'utf8');

function generated(next) {
  const int = (a, b) => a + Math.floor(next() * (b - a + 1));
  const pick = (list) => list[int(0, list.length - 1)];
  const cell = () => {
    let text = '';
    for (let k = int(0, 3); k > 0; k--) text += pick(FRAGMENTS);
    const must = /[",\r\n]/.test(text);
    return must || next() < 0.25 ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const ends = ['\n', '\r\n', '\r'];
  const style = next() < 0.2 ? null : pick(ends);
  let text = next() < 0.2 ? '\ufeff' : '';
  const records = int(0, 12);
  for (let r = 0; r < records; r++) {
    if (next() < 0.1) text += '';
    else {
      const width = int(1, 8);
      text += Array.from({ length: width }, cell).join(',');
    }
    if (r < records - 1 || next() < 0.7) text += style ?? pick(ends);
  }
  if (next() < 0.5) return encode(text);
  // One planted fault, in the text or in the bytes.
  const at = (n) => int(0, n);
  switch (int(0, 7)) {
    case 0: {
      const i = at(text.length);
      return encode(text.slice(0, i) + '"' + text.slice(i));
    }
    case 1: {
      const quotes = [...text.matchAll(/"/g)].map((m) => m.index);
      if (!quotes.length) return encode(text + '"');
      const i = pick(quotes);
      return encode(text.slice(0, i) + text.slice(i + 1));
    }
    case 2: {
      const i = at(text.length);
      return encode(text.slice(0, i) + pick(FORBIDDEN) + text.slice(i));
    }
    case 3: {
      const bytes = encode(text);
      const i = at(bytes.length);
      return Buffer.concat([
        bytes.subarray(0, i),
        Buffer.from(pick(BAD_BYTES)),
        bytes.subarray(i),
      ]);
    }
    case 4: {
      const closes = [...text.matchAll(/"(?=[,\r\n]|$)/g)].map((m) => m.index);
      if (!closes.length) return encode(text + 'x');
      const i = pick(closes) + 1;
      return encode(text.slice(0, i) + 'x' + text.slice(i));
    }
    case 5: {
      const bytes = encode(text);
      return bytes.subarray(0, at(bytes.length));
    }
    case 6: {
      const bytes = Buffer.from(encode(text));
      if (bytes.length) bytes[at(bytes.length - 1)] = int(0, 255);
      return bytes;
    }
    default:
      return encode('\ufeff' + text);
  }
}

// The limits of the contract, each just inside and just outside.
function limits() {
  const out = [];
  const add = (name, bytes) => out.push([name, bytes]);
  add('empty', Buffer.alloc(0));
  for (const t of ['a', '\n', '\r', '\r\n', '""', '"', 'a"', '"a"b', '\ufeff'])
    add(`small ${JSON.stringify(t)}`, encode(t));
  add('bom and line end', encode('\ufeff\n'));
  add('two bom', encode('\ufeff\ufeffa'));
  add('cell 32767', encode('a'.repeat(32767)));
  add('cell 32768', encode('a'.repeat(32768)));
  add('cell 32765 and astral', encode('a'.repeat(32765) + ASTRAL));
  add('cell 32766 and astral', encode('a'.repeat(32766) + ASTRAL));
  add('quoted cell 32767', encode(`"${'""'.repeat(32767)}"`));
  add('quoted cell 32768', encode(`"${'""'.repeat(32768)}"`));
  add('cells 100', encode(','.repeat(99) + '\n'));
  add('cells 101', encode(','.repeat(100) + '\n'));
  add('records 20001', encode('a\n'.repeat(20001)));
  add('records 20002', encode('a\n'.repeat(20002)));
  add('blank records 20001', encode('\n'.repeat(20001)));
  add('blank records 20002', encode('\n'.repeat(20002)));
  add('records 20001 no end', encode('a\n'.repeat(20000) + 'a'));
  add('records 20002 no end', encode('a\n'.repeat(20001) + 'a'));
  // Exactly 8 MiB that the contract reads, then one byte more.
  const line = 'a'.repeat(418) + '\n';
  const body = line.repeat(20000);
  const last = 'a'.repeat(MIB8 - body.length - 1) + '\n';
  add('bytes 8 MiB', encode(body + last));
  add('bytes 8 MiB and one', encode(body + 'a' + last));
  assert.equal(out.at(-2)[1].length, MIB8);
  return out;
}

function oracle(inputs) {
  const dir = mkdtempSync(join(tmpdir(), 'fa-reader-'));
  try {
    const frames = join(dir, 'inputs.bin');
    writeFileSync(
      frames,
      Buffer.concat(
        inputs.flatMap(([, bytes]) => {
          const size = Buffer.alloc(4);
          size.writeUInt32BE(bytes.length);
          return [size, bytes];
        }),
      ),
    );
    const code = [
      'import json, struct, sys',
      'sys.path.insert(0, sys.argv[1])',
      'from oracle import tokenize, Refused',
      'data, i, out = open(sys.argv[2], "rb").read(), 0, []',
      'while i < len(data):',
      '    n = struct.unpack(">I", data[i:i + 4])[0]',
      '    raw, i = data[i + 4:i + 4 + n], i + 4 + n',
      '    try:',
      '        out.append(["ok", tokenize(raw)])',
      '    except Refused as e:',
      '        out.append(["refused", str(e)])',
      'sys.stdout.write(json.dumps(out))',
    ].join('\n');
    const run = spawnSync(
      'python3',
      ['-B', '-I', '-c', code, join(root, ORACLE), frames],
      { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
    );
    assert.equal(run.status, 0, run.stderr);
    return JSON.parse(run.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function product(reader, inputs) {
  return inputs.map(([, bytes]) => {
    const copy = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    );
    try {
      return ['ok', reader(copy)];
    } catch (error) {
      const message = String(error?.message ?? error);
      return message.startsWith('FA_SECTIONS_')
        ? ['refused', message.slice('FA_SECTIONS_'.length)]
        : ['crash', message.slice(0, 120)];
    }
  });
}

const same = (a, b) =>
  a.length === b.length &&
  a.every(
    (row, r) =>
      Array.isArray(b[r]) &&
      row.length === b[r].length &&
      row.every((cell, c) => cell === b[r][c]),
  );
function differences(mine, theirs, inputs) {
  const out = [];
  for (let i = 0; i < inputs.length; i++) {
    const [kind, value] = mine[i];
    const [want, expected] = theirs[i];
    const equal =
      kind === want &&
      (kind === 'ok' ? same(value, expected) : value === expected);
    if (!equal)
      out.push({
        input: inputs[i][0],
        product:
          kind === 'ok' ? `ok ${value.length} records` : `${kind} ${value}`,
        oracle:
          want === 'ok'
            ? `ok ${expected.length} records`
            : `${want} ${expected}`,
      });
  }
  return out;
}

// Plausible faults of the reader, each a copy of the product with one edit.
const mutations = [
  [
    'lone-cr-not-a-line-end',
    CSV,
    "if (c === '\\r' || c === '\\n') {",
    "if (c === '\\n') {",
  ],
  [
    'crlf-two-records',
    CSV,
    "if (c === '\\r' && input[i + 1] === '\\n') i++;",
    '',
  ],
  ['doubled-quote-kept', CSV, "append('\"');", 'append(\'""\');'],
  [
    'quote-inside-plain-cell',
    CSV,
    "if (cell || closed) throw Error('ASSET_CSV');",
    "if (closed) throw Error('ASSET_CSV');",
  ],
  [
    'text-after-closing-quote',
    CSV,
    "if (closed) throw Error('ASSET_CSV');\n    append(c);",
    'append(c);',
  ],
  [
    'blank-record-one-cell',
    CSV,
    'rows.push(touched ? [...row, cell] : []);',
    'rows.push([...row, cell]);',
  ],
  [
    'cell-limit-one-more',
    CSV,
    'cell.length + character.length > 32767',
    'cell.length + character.length > 32768',
  ],
  [
    'record-limit-one-more',
    CSV,
    'rows.length === MAX_ROWS + 1',
    'rows.length === MAX_ROWS + 2',
  ],
  ['cells-limit-one-more', CSV, 'row.length === 99', 'row.length === 100'],
  [
    'bytes-limit-one-less',
    CSV,
    'original.byteLength > 8 * 1024 * 1024',
    'original.byteLength >= 8 * 1024 * 1024',
  ],
  [
    'lossy-decoding',
    CSV,
    "new TextDecoder('utf-8', { fatal: true })",
    "new TextDecoder('utf-8', { fatal: false })",
  ],
  [
    'byte-order-mark-kept',
    CSV,
    "new TextDecoder('utf-8', { fatal: true })",
    "new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })",
  ],
  ['forbidden-code-points-kept', CSV, 'validateCellText(input);', ''],
  [
    'unclosed-quote-accepted',
    CSV,
    "if (quoted) throw Error('ASSET_CSV');\n  if (touched) finish();",
    'if (touched) finish();',
  ],
  [
    'last-record-without-line-end-dropped',
    CSV,
    'if (touched) finish();\n  return rows;',
    'return rows;',
  ],
  [
    'cell-limit-read-as-source',
    IO,
    "message === 'ASSET_CELL_LIMIT' ||",
    "message === 'ASSET_CELL_LIMIT-' ||",
  ],
];

// A private copy of the reader and its caller, every other import pointing
// back at the repository, with at most one edit.
async function copiedReader(dir, edit) {
  const lib = join(root, 'lib/reconciliation');
  const text = {
    [CSV]: readFileSync(join(root, CSV), 'utf8'),
    [IO]: readFileSync(join(root, IO), 'utf8'),
  };
  if (edit) {
    const [, file, find, replacement] = edit;
    assert.equal(text[file].split(find).length, 2, `${edit[0]}: one anchor`);
    text[file] = text[file].replace(find, () => replacement);
  }
  const relink = (source) =>
    source.replace(/from '\.\/([\w.-]+\.ts)'/g, (all, name) =>
      name === 'fixed-assets-csv.ts'
        ? all
        : `from '${pathToFileURL(join(lib, name)).href}'`,
    );
  writeFileSync(join(dir, 'fixed-assets-csv.ts'), relink(text[CSV]));
  writeFileSync(join(dir, 'fixed-assets-sections-io.ts'), relink(text[IO]));
  return (
    await import(pathToFileURL(join(dir, 'fixed-assets-sections-io.ts')).href)
  ).assetSectionsCSV;
}

const next = random(SEED);
const inputs = [
  ...Array.from({ length: COUNT }, (_, i) => [
    `seed ${SEED} #${i}`,
    generated(next),
  ]),
  ...limits(),
];
const expected = oracle(inputs);
const { assetSectionsCSV } = await import(pathToFileURL(join(root, IO)).href);
const found = differences(product(assetSectionsCSV, inputs), expected, inputs);

const tally = {};
for (const [kind, value] of expected) {
  const key = kind === 'ok' ? 'ok' : value;
  tally[key] = (tally[key] ?? 0) + 1;
}
const faults = [];
const scratch = mkdtempSync(join(tmpdir(), 'fa-reader-copies-'));
try {
  for (const edit of [null, ...mutations]) {
    const name = edit ? edit[0] : 'copy-without-a-fault';
    const dir = mkdtempSync(join(scratch, 'copy-'));
    const reader = await copiedReader(dir, edit);
    const n = differences(product(reader, inputs), expected, inputs).length;
    faults.push({
      fault: name,
      differences: n,
      detected: edit ? n > 0 : n === 0,
    });
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

const report = {
  generator: GENERATOR,
  seed: SEED,
  inputs: inputs.length,
  oracle: `${ORACLE}/oracle.py`,
  results: tally,
  differences: found.slice(0, 20),
  differenceCount: found.length,
  faults,
};
console.log(JSON.stringify(report, null, 1));
assert.equal(found.length, 0, 'the product and the oracle differ');
for (const f of faults)
  assert.ok(f.detected, `${f.fault}: ${f.differences} differences`);
