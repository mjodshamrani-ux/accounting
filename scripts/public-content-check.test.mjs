import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { deflateRawSync, deflateSync, crc32 } from 'node:zlib';
import { checkPublicContent, scanText, validateManifest } from './public-content-check.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const approved = (p, bytes, binary = false) => ({
  path: p, bytes: bytes.length, sha256: hash(bytes), kind: binary ? 'approved-binary' : 'text',
  ...(binary ? { provenance: { type: 'synthetic', description: 'Created from the explicit synthetic test input.' } } : {}),
});
async function fixture(t, files, distribution = []) {
  const root = await mkdtemp(path.join(tmpdir(), 'public-content-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifest = { version: 1, source: files.map(([p, data, binary]) => approved(p, data, binary)),
    distribution: distribution.map(([p, data, binary]) => approved(p, data, binary)) };
  for (const [p, data] of [...files, ...distribution.map(([p, ...rest]) => [`dist/${p}`, ...rest])]) {
    await mkdir(path.dirname(path.join(root, p)), { recursive: true });
    await writeFile(path.join(root, p), data);
  }
  await writeFile(path.join(root, 'public-safe-manifest.json'), JSON.stringify(manifest));
  return { root, manifest };
}
function zip(name, data, { compressed = true, descriptor = false } = {}) {
  const n = Buffer.from(name);
  const payload = compressed ? deflateRawSync(data) : data;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4);
  local.writeUInt16LE(descriptor ? 8 : 0, 6);
  local.writeUInt16LE(compressed ? 8 : 0, 8);
  local.writeUInt32LE(descriptor ? 0 : crc32(data), 14);
  local.writeUInt32LE(descriptor ? 0 : payload.length, 18);
  local.writeUInt32LE(descriptor ? 0 : data.length, 22); local.writeUInt16LE(n.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt16LE(descriptor ? 8 : 0, 8);
  central.writeUInt16LE(compressed ? 8 : 0, 10);
  central.writeUInt32LE(crc32(data), 16);
  central.writeUInt32LE(payload.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(n.length, 28);
  const end = Buffer.alloc(22);
  const trailer = Buffer.alloc(descriptor ? 16 : 0);
  if (descriptor) {
    trailer.writeUInt32LE(0x08074b50); trailer.writeUInt32LE(crc32(data), 4);
    trailer.writeUInt32LE(payload.length, 8); trailer.writeUInt32LE(data.length, 12);
  }
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + n.length, 12); end.writeUInt32LE(local.length + n.length + payload.length + trailer.length, 16);
  return Buffer.concat([local, n, payload, trailer, central, n, end]);
}
function png(chunks = []) {
  const chunk = (name, data) => {
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([Buffer.from(name), data])));
    return Buffer.concat([length, Buffer.from(name), data, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header),
    ...chunks.map(([name, data]) => chunk(name, data)), chunk('IDAT', deflateSync(Buffer.from([0, 0, 0, 0]))),
    chunk('IEND', Buffer.alloc(0))]);
}

void test('exact reviewed source preserves public attribution and static regex code', async t => {
  const code = Buffer.from("// Contributor <maintainer@example.org>\nconst homePattern = /\\/Users\\/[A-Za-z0-9]+\\//;\n");
  const f = await fixture(t, [['LICENSE.txt', code]]);
  assert.deepEqual(await checkPublicContent(f), { scope: 'source', files: 1, bytes: code.length });
});

void test('ignored private files and generated work are rejected by the clean source check', async t => {
  const f = await fixture(t, [['.gitignore', Buffer.from('.env*\nwork/\n')]]);
  await writeFile(path.join(f.root, '.env.local'), 'TOKEN=private-local-value');
  await assert.rejects(checkPublicContent(f), /inventory differs/);
  await rm(path.join(f.root, '.env.local'));
  await mkdir(path.join(f.root, 'work'));
  await writeFile(path.join(f.root, 'work', 'result.json'), '{"cells":[123]}');
  await assert.rejects(checkPublicContent(f), /inventory differs/);
});

void test('review pins both bytes and SHA so same-length changes fail', async t => {
  const f = await fixture(t, [['safe.txt', Buffer.from('safe')]]);
  await writeFile(path.join(f.root, 'safe.txt'), 'evil');
  await assert.rejects(checkPublicContent(f), /SHA-256 differs/);
  await writeFile(path.join(f.root, 'safe.txt'), 'longer');
  await assert.rejects(checkPublicContent(f), /bytes differ/);
});

void test('reviewed source still cannot contain concrete machine paths or secret credentials', async t => {
  for (const text of [
    ['/', 'Users/', 'private-person/', 'work/file.xlsx'].join(''),
    ['C:', '\\', 'Users', '\\', 'private-person', '\\', 'work'].join(''),
    ['C:', '\\\\', 'Users', '\\\\', 'Private Person', '\\\\', 'work'].join(''),
    ['%2F', 'Users%2F', 'private-person%2F', 'work'].join(''),
    ['\\/', 'Users\\/', 'private-person\\/', 'work'].join(''),
    ['\\u002f', 'Users\\u002f', 'private-person\\u002f', 'work'].join(''),
    ['/', 'Users/', '\u65e5\u672c\u8a9e/', 'work'].join(''),
    ['ghp_', 'A'.repeat(36)].join(''),
    ['AKIA', 'A'.repeat(16)].join(''),
    ['-----BEGIN ', 'PRIVATE KEY-----'].join(''),
  ]) {
    const f = await fixture(t, [['safe.txt', Buffer.from(text)]]);
    await assert.rejects(checkPublicContent(f), /machine path|Secret credential/);
  }
});

void test('symlinked files and parent directories cannot reach private files', async t => {
  const f = await fixture(t, [['safe.txt', Buffer.from('safe')]]);
  await rm(path.join(f.root, 'safe.txt'));
  await symlink('public-safe-manifest.json', path.join(f.root, 'safe.txt'));
  await assert.rejects(checkPublicContent(f), /Symlinks/);
  const other = await fixture(t, [], [['assets/image.png', Buffer.from([0, 1, 2]), true]]);
  await rm(path.join(other.root, 'dist', 'assets'), { recursive: true });
  await symlink(other.root, path.join(other.root, 'dist', 'assets'));
  await assert.rejects(checkPublicContent({ ...other, mode: 'distribution' }), /Symlinks/);
});

void test('unknown binaries and archives fail closed, including files with text extensions', async t => {
  const zipped = zip('cells.xml', Buffer.from('<rows><synthetic>1</synthetic></rows>'));
  for (const [p, bytes] of [['hidden.txt', zipped], ['image.png', Buffer.from([0, 1, 2])]]) {
    const f = await fixture(t, [[p, bytes]]);
    await assert.rejects(checkPublicContent(f), /requires explicit|requires|Binary or archive/);
  }
  const f = await fixture(t, [['safe.txt', Buffer.from('safe')]]);
  await writeFile(path.join(f.root, 'original.zip'), zipped);
  await assert.rejects(checkPublicContent(f), /inventory differs/);
});

void test('binary approval requires safe provenance and exact canonical paths', () => {
  const entry = approved('fixture.xlsx', Buffer.from([0]), true);
  for (const changed of [{ ...entry, provenance: undefined }, { ...entry, path: '../raw.xlsx' },
    { ...entry, path: '/private.xlsx' }, { ...entry, path: 'fixtures\\raw.xlsx' },
    { ...entry, provenance: { type: 'unknown', description: 'Unknown original.' } },
    { ...entry, path: 'work/raw.xlsx' }])
    assert.throws(() => validateManifest({ version: 1, source: [changed], distribution: [] }));
});

void test('approved synthetic ZIP/XLSX is inspected beneath compression; nested archives fail', async t => {
  const good = zip('xl/worksheets/sheet1.xml', Buffer.from('<row><v>123</v></row>'));
  const f = await fixture(t, [['synthetic.xlsx', good, true]]);
  assert.equal((await checkPublicContent(f)).files, 1);
  const home = ['/', 'home/', 'private-person/', 'source.csv'].join('');
  for (const bytes of [zip('xl/worksheets/sheet1.xml', Buffer.from(home)), zip('nested.zip', good),
    zip('../private.xml', Buffer.from('private')), Buffer.concat([good, Buffer.from('hidden tail')])]) {
    const bad = await fixture(t, [['synthetic.xlsx', bytes, true]]);
    await assert.rejects(checkPublicContent(bad), /machine path|Nested archive|canonical|Malformed or appended/);
  }
});

void test('streaming ZIP descriptors are supported and unlisted local payloads fail closed', async t => {
  const streaming = zip('xl/worksheets/sheet1.xml', Buffer.from('<row><v>123</v></row>'), { descriptor: true });
  const f = await fixture(t, [['synthetic.xlsx', streaming, true]]);
  assert.equal((await checkPublicContent(f)).files, 1);
  const base = zip('sheet.xml', Buffer.from('<row>123</row>'));
  const end = base.length - 22;
  const central = base.readUInt32LE(end + 16);
  const secretPayload = zip('unlisted.xml', Buffer.from('unlisted archive content'));
  const hidden = Buffer.concat([base.subarray(0, central), secretPayload, base.subarray(central)]);
  hidden.writeUInt32LE(central + secretPayload.length, hidden.length - 22 + 16);
  const bad = await fixture(t, [['synthetic.xlsx', hidden, true]]);
  await assert.rejects(checkPublicContent(bad), /Unlisted or hidden/);
});

void test('ZIP decoded payload checksum must match the reviewed archive declarations', async t => {
  const wrong = zip('cells.xml', Buffer.from('safe'), { compressed: false });
  wrong[30 + Buffer.byteLength('cells.xml')] = 'x'.charCodeAt(0);
  const f = await fixture(t, [['synthetic.xlsx', wrong, true]]);
  await assert.rejects(checkPublicContent(f), /checksum differs/);
});

void test('approved PDF compressed streams are scanned for private metadata', async t => {
  const privatePath = ['/', 'Users/', 'private-person/', 'statement.pdf'].join('');
  const stream = deflateSync(Buffer.from(privatePath));
  for (const filter of ['/FlateDecode', '[ /FlateDecode ]']) {
    const pdf = Buffer.concat([Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Filter ${filter} >>\nstream\n`),
      stream, Buffer.from('\nendstream\nendobj\n%%EOF\n')]);
    const f = await fixture(t, [['synthetic.pdf', pdf, true]]);
    await assert.rejects(checkPublicContent(f), /machine path/);
  }
});

void test('PDF unsupported filter chains fail closed even with a reviewed binary SHA', async t => {
  for (const filter of ['/ASCIIHexDecode', '/ASCII85Decode', '/LZWDecode', '[/FlateDecode /ASCII85Decode]',
    '[/ASCII85Decode /FlateDecode /FlateDecode]', '[/ASCII85Decode /ASCII85Decode /FlateDecode]',
    '[]', '[/FlateDecode /FlateDecode]']) {
    const pdf = Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Filter ${filter} >>\nstream\n00\nendstream\nendobj\n%%EOF\n`);
    const f = await fixture(t, [['synthetic.pdf', pdf, true]]);
    await assert.rejects(checkPublicContent(f), /Unsupported compressed PDF filter chain/);
  }
});

void test('ReportLab ASCII85 then Flate streams are fully decoded before privacy inspection', async t => {
  const encode = bytes => {
    let output = '';
    for (let at = 0; at < bytes.length; at += 4) {
      const group = Buffer.alloc(4);
      const size = Math.min(4, bytes.length - at);
      bytes.copy(group, 0, at, at + size);
      let value = group.readUInt32BE();
      const digits = [];
      for (let i = 0; i < 5; i += 1) {
        digits.unshift(String.fromCharCode(value % 85 + 33));
        value = Math.floor(value / 85);
      }
      output += digits.slice(0, size + 1).join('');
    }
    return Buffer.from(output + '~>');
  };
  const pdf = stream => Buffer.concat([
    Buffer.from('%PDF-1.4\n1 0 obj\n<< /Filter [/ASCII85Decode /FlateDecode] >>\nstream\n'),
    stream, Buffer.from('\nendstream\nendobj\n%%EOF\n'),
  ]);
  const safe = await fixture(t, [['synthetic.pdf', pdf(encode(deflateSync(Buffer.from('Synthetic public text')))), true]]);
  assert.equal((await checkPublicContent(safe)).files, 1);
  const privatePath = ['/', 'Users/', 'private-person/', 'statement.pdf'].join('');
  const bad = await fixture(t, [['synthetic.pdf', pdf(encode(deflateSync(Buffer.from(privatePath)))), true]]);
  await assert.rejects(checkPublicContent(bad), /machine path/);
  for (const invalid of ['!!!!!', '!~>', 'uuuuu~>', '!z!!!~>', '!!!!v~>', '!!~>tail']) {
    const malformed = await fixture(t, [['synthetic.pdf', pdf(Buffer.from(invalid)), true]]);
    await assert.rejects(checkPublicContent(malformed), /PDF ASCII85/);
  }
});

void test('a PDF with repeated Flate filters cannot conceal double-deflated private metadata', async t => {
  const privatePath = ['/', 'Users/', 'private-person/', 'statement.xlsx'].join('');
  const stream = deflateSync(deflateSync(Buffer.from(privatePath)));
  const pdf = Buffer.concat([
    Buffer.from('%PDF-1.4\n1 0 obj\n<< /Filter [/FlateDecode /FlateDecode] >>\nstream\n'),
    stream, Buffer.from('\nendstream\nendobj\n%%EOF\n'),
  ]);
  const f = await fixture(t, [['synthetic.pdf', pdf, true]]);
  await assert.rejects(checkPublicContent(f), /Unsupported compressed PDF filter chain/);
});

void test('PNG compressed text metadata is scanned; unknown chunks and broken CRC fail closed', async t => {
  const privatePath = ['/', 'Users/', 'private-person/', 'statement.xlsx'].join('');
  const cases = [
    png([['tEXt', Buffer.from(`Comment\0${privatePath}`)]]),
    png([['zTXt', Buffer.concat([Buffer.from('Comment\0\0'), deflateSync(Buffer.from(privatePath))])]]),
    png([['iTXt', Buffer.concat([Buffer.from('Comment\0\x01\0en\0Translation\0'), deflateSync(Buffer.from(privatePath))])]]),
    png([['iCCP', Buffer.concat([Buffer.from('Profile\0\0'), deflateSync(Buffer.from(privatePath))])]]),
  ];
  for (const image of cases) {
    const f = await fixture(t, [['synthetic.png', image, true]]);
    await assert.rejects(checkPublicContent(f), /machine path/);
  }
  const unknown = await fixture(t, [['synthetic.png', png([['raWd', Buffer.from('private archive')]]), true]]);
  await assert.rejects(checkPublicContent(unknown), /Unknown or out-of-bounds PNG chunk/);
  const bad = png(); bad[bad.length - 1] ^= 1;
  const broken = await fixture(t, [['synthetic.png', bad, true]]);
  await assert.rejects(checkPublicContent(broken), /checksum differs/);
});

void test('odd-length PNG metadata remains reviewable without native buffer overrun', async t => {
  // This payload starts at the odd PNG byte offset 41 and exceeds the native
  // decoder's stack buffer. It must retain its exact bytes and pass inspection.
  const image = png([['tEXt', Buffer.concat([Buffer.from('Comment\0'), Buffer.alloc(1025, 65)])]]);
  const f = await fixture(t, [['synthetic.png', image, true]]);
  assert.deepEqual(await checkPublicContent(f), { scope: 'source', files: 1, bytes: image.length });
});

void test('odd trailing bytes cannot hide complete UTF-16 privacy material in PNG metadata', async t => {
  const home = ['/', 'Users/', 'private-person/', 'source.csv'].join('');
  const secret = ['ghp_', 'A'.repeat(36)].join('');
  for (const text of [home, secret]) {
    const le = Buffer.from(' '.repeat(300) + text, 'utf16le');
    const be = Buffer.from(le).swap16();
    for (const encoded of [le, be]) {
      const payload = Buffer.concat([Buffer.from('Comment\0'), encoded, Buffer.from([0xff])]);
      const image = png([['tEXt', payload]]);
      const f = await fixture(t, [['synthetic.png', image, true]]);
      await assert.rejects(checkPublicContent(f), /machine path|Secret credential/);
    }
  }
  // The final ASCII byte completes the rule's minimum token length. It must
  // still be checked by the full-input UTF-8/Latin1 scans, even when LE omits
  // that incomplete code unit.
  const lastByteRequired = Buffer.from(' '.repeat(599) + ['ghp_', 'A'.repeat(30)].join(''));
  assert.equal(lastByteRequired.length % 2, 1);
  const finalByteImage = png([['tEXt', Buffer.concat([Buffer.from('Comment\0'), lastByteRequired])]]);
  const finalByte = await fixture(t, [['synthetic.png', finalByteImage, true]]);
  await assert.rejects(checkPublicContent(finalByte), /Secret credential/);
});

void test('distribution checks every file, hidden files and binary hashes before upload', async t => {
  const image = png();
  const f = await fixture(t, [], [['index.html', Buffer.from('<html></html>')], ['.nojekyll', Buffer.from('')],
    ['assets/image.png', image, true]]);
  assert.equal((await checkPublicContent({ ...f, mode: 'distribution' })).files, 3);
  await writeFile(path.join(f.root, 'dist', '.private'), 'private');
  await assert.rejects(checkPublicContent({ ...f, mode: 'distribution' }), /inventory differs/);
  await rm(path.join(f.root, 'dist', '.private'));
  const changed = Buffer.from(image); changed[changed.length - 1] ^= 1;
  await writeFile(path.join(f.root, 'dist', 'assets', 'image.png'), changed);
  await assert.rejects(checkPublicContent({ ...f, mode: 'distribution' }), /SHA-256 differs/);
});

void test('source export checks tracked inventory while generated runner evidence stays local', async t => {
  const f = await fixture(t, [['.gitignore', Buffer.from('work/\nnode_modules/\n')], ['safe.txt', Buffer.from('safe')]]);
  execFileSync('git', ['init', '--quiet'], { cwd: f.root });
  execFileSync('git', ['add', '.gitignore', 'safe.txt', 'public-safe-manifest.json'], { cwd: f.root });
  await mkdir(path.join(f.root, 'work'));
  await writeFile(path.join(f.root, 'work', 'native.json'), '{"cells":[1]}');
  assert.equal((await checkPublicContent({ ...f, mode: 'source-export' })).files, 2);
  await assert.rejects(checkPublicContent(f), /inventory differs/);
  execFileSync('git', ['add', '--force', 'work/native.json'], { cwd: f.root });
  await assert.rejects(checkPublicContent({ ...f, mode: 'source-export' }), /inventory differs/);
});

void test('only ignored untracked local node_modules can be excluded from source', async t => {
  const f = await fixture(t, [['.gitignore', Buffer.from('node_modules/\n')]]);
  execFileSync('git', ['init', '--quiet'], { cwd: f.root });
  await mkdir(path.join(f.root, 'node_modules'));
  await writeFile(path.join(f.root, 'node_modules', 'local.js'), 'local');
  assert.equal((await checkPublicContent(f)).files, 1);
  execFileSync('git', ['add', '--force', 'node_modules/local.js'], { cwd: f.root });
  await assert.rejects(checkPublicContent(f), /dependency directory/);
});

void test('license emails remain public while actual home paths are detected', () => {
  assert.doesNotThrow(() => scanText('Copyright Example Author <author@example.org>'));
  assert.doesNotThrow(() => scanText(String.raw`const r = /\/Users\/[A-Za-z0-9_.-]+\//;`));
});

void test('approved public design and licensed vendor binary files retain their exact bytes', async t => {
  const f = await fixture(t, [['icon.png', png(), true]]);
  for (const type of ['public-design', 'licensed-vendor']) {
    f.manifest.source[0].provenance = { type, description: 'Public asset with reviewed license and origin.' };
    await writeFile(path.join(f.root, 'public-safe-manifest.json'), JSON.stringify(f.manifest));
    assert.equal((await checkPublicContent(f)).files, 1);
  }
});

void test('reviewed generated control-byte bundles still scan actual UTF-8 Unicode text', async t => {
  const safeBytes = Buffer.from('const marker = "' + String.fromCharCode(3, 4) + '";');
  const safe = await fixture(t, [['assets/bundle.js', safeBytes, true]]);
  assert.equal((await checkPublicContent(safe)).files, 1);
  const ordinaryText = await fixture(t, [['assets/bundle.js', safeBytes]]);
  await assert.rejects(checkPublicContent(ordinaryText), /Binary or archive/);
  const home = ['', 'Users', String.fromCodePoint(0x674e, 0x751f), 'source.csv'].join('/');
  const unsafe = Buffer.concat([safeBytes, Buffer.from(home, 'utf8')]);
  const source = await fixture(t, [['assets/bundle.js', unsafe, true]]);
  await assert.rejects(checkPublicContent(source), /machine path/);
  const dist = await fixture(t, [], [['assets/bundle.js', unsafe, true]]);
  await assert.rejects(checkPublicContent({ ...dist, mode: 'distribution' }), /machine path/);
});
