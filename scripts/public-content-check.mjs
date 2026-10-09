// Publication is an exact, reviewed file inventory. Runtime proof outputs are
// local evidence; they must never be inferred to be safe from a directory name.
// The manifest binds an external provenance/content review of these exact bytes.
// Its labels are declarations, not an independent proof of synthetic origin or
// financial privacy. This guard never generates or approves its own allowlist.
import { readFile, readdir, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync, inflateSync, gunzipSync, crc32 } from 'node:zlib';

const LIMIT = 128 * 1024 * 1024;
const SHA = /^[a-f0-9]{64}$/;
const BINARY_TYPES = new Set(['synthetic', 'licensed-vendor', 'public-design']);
const decoder = new TextDecoder('utf-8', { fatal: true });
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const secretRules = [
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})\b/,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{40,}\b/,
];
// These match concrete home directories, not source code describing a regex.
// Public license email addresses and contributor attribution are allowed.
const homeRules = [
  /(?:\/|\\{1,2})(?:Users|home)(?:\/|\\{1,2})[\p{L}\p{N} _.-]+(?:\/|\\{1,2})/iu,
  /(?:\/private)?\/var\/folders\/[A-Za-z0-9_-]+\//,
  /file:\/\/(?:\/|[A-Za-z]:[\\/])(?:Users|home)[\\/][A-Za-z0-9_.-]+[\\/]/,
];

export function scanText(text) {
  const decoded = text.replaceAll('\\/', '/')
    .replace(/\\u([a-f0-9]{4})|\\x([a-f0-9]{2})/gi,
      (_, unicode, hex) => String.fromCharCode(Number.parseInt(unicode || hex, 16)))
    .replace(/(?:%[a-f0-9]{2})+/gi, token => {
      try { return decodeURIComponent(token); } catch { return token; }
    });
  if (secretRules.some(rule => rule.test(text) || rule.test(decoded))) throw Error('Secret credential material detected.');
  if (homeRules.some(rule => rule.test(text) || rule.test(decoded))) throw Error('Concrete personal machine path detected.');
}

function safePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0') ||
      value.startsWith('/') || /^[A-Za-z]:/.test(value) ||
      value.split('/').some(part => !part || part === '.' || part === '..'))
    throw Error('Manifest paths must be canonical repository-relative paths.');
  scanText(value);
  return value;
}

function textBytes(bytes) {
  try {
    const text = decoder.decode(bytes);
    for (const char of text) {
      const code = char.charCodeAt(0);
      if (code < 32 && ![9, 10, 13].includes(code) || code === 127) return null;
    }
    return text;
  } catch { return null; }
}

function signature(bytes) {
  if (bytes.subarray(0, 8).equals(PNG)) return 'png';
  if (bytes.length >= 4 && [0x04034b50, 0x06054b50, 0x08074b50].includes(bytes.readUInt32LE(0))) return 'zip';
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) return 'gzip';
  if (bytes.subarray(0, 5).toString('ascii') === '%PDF-') return 'pdf';
  if (bytes.length >= 262 && bytes.subarray(257, 262).toString('ascii') === 'ustar') return 'unsupported-archive';
  if (bytes.subarray(0, 6).equals(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) ||
      bytes.subarray(0, 4).toString('ascii') === 'Rar!') return 'unsupported-archive';
  return null;
}

function scanDecoded(bytes) {
  // Inspect visible metadata even in an approved image/font/container. UTF-16
  // catches Windows-origin metadata without changing the file being checked.
  // A pinned generated JS bundle may contain literal parser control bytes.
  // Its valid UTF-8 Unicode text must still receive the same privacy scan.
  let utf8;
  try { utf8 = decoder.decode(bytes); } catch { /* Binary may not be UTF-8. */ }
  if (utf8 !== undefined) scanText(utf8);
  scanText(bytes.toString('latin1'));
  scanText(bytes.toString('utf16le'));
  scanText(new TextDecoder('utf-16be').decode(bytes));
}

function scanPng(bytes) {
  const known = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'cHRM', 'gAMA', 'iCCP', 'sBIT', 'sRGB',
    'bKGD', 'hIST', 'tRNS', 'pHYs', 'sPLT', 'tIME', 'tEXt', 'zTXt', 'iTXt', 'eXIf', 'acTL', 'fcTL', 'fdAT']);
  let at = 8;
  let imageData = false;
  let expanded = 0;
  let chunks = 0;
  while (at < bytes.length) {
    if (at + 12 > bytes.length) throw Error('Malformed PNG chunk.');
    const length = bytes.readUInt32BE(at);
    const type = bytes.subarray(at + 4, at + 8).toString('ascii');
    const end = at + 12 + length;
    if (length > LIMIT || end > bytes.length || !known.has(type)) throw Error('Unknown or out-of-bounds PNG chunk.');
    const payload = bytes.subarray(at + 8, at + 8 + length);
    if (crc32(bytes.subarray(at + 4, at + 8 + length)) !== bytes.readUInt32BE(at + 8 + length))
      throw Error('PNG chunk checksum differs from its payload.');
    if ((chunks === 0 && (type !== 'IHDR' || length !== 13)) || (chunks > 0 && type === 'IHDR'))
      throw Error('PNG must begin with exactly one valid header.');
    if (type === 'IDAT') imageData = true;
    // Image pixels require external provenance review. Text/profile/EXIF
    // metadata, including compressed international text, is checked here.
    if (!['IDAT', 'fdAT'].includes(type)) scanDecoded(payload);
    if (['zTXt', 'iTXt', 'iCCP', 'tEXt'].includes(type)) {
      const keyword = payload.indexOf(0);
      if (keyword < 1 || keyword > 79) throw Error('Malformed PNG metadata keyword.');
      let content = payload.subarray(keyword + 1);
      let compressed = false;
      if (type === 'zTXt' || type === 'iCCP') {
        if (content[0] !== 0) throw Error('Unsupported PNG metadata compression.');
        compressed = true; content = content.subarray(1);
      } else if (type === 'iTXt') {
        if (![0, 1].includes(content[0]) || content[1] !== 0) throw Error('Malformed PNG international text compression.');
        compressed = content[0] === 1; content = content.subarray(2);
        for (let field = 0; field < 2; field += 1) {
          const endField = content.indexOf(0);
          if (endField < 0) throw Error('Malformed PNG international text metadata.');
          content = content.subarray(endField + 1);
        }
      }
      const output = compressed ? inflateSync(content, { maxOutputLength: LIMIT }) : content;
      expanded += output.length;
      if (expanded > LIMIT) throw Error('PNG metadata expanded size exceeds review limit.');
      if (signature(output)) throw Error('Nested binary or archive is forbidden in PNG metadata.');
      scanDecoded(output);
    }
    chunks += 1;
    if (type === 'IEND') {
      if (length || !imageData || end !== bytes.length) throw Error('Malformed PNG end or appended content.');
      return;
    }
    at = end;
  }
  throw Error('PNG has no complete end marker.');
}

function scanZipExtras(bytes, name) {
  let at = 0;
  while (at < bytes.length) {
    if (at + 4 > bytes.length) throw Error('Malformed ZIP extra field.');
    const id = bytes.readUInt16LE(at);
    const size = bytes.readUInt16LE(at + 2);
    if (at + 4 + size > bytes.length || ![0x5455, 0x000a, 0x7075, 0x6375].includes(id))
      throw Error('Unsupported ZIP extra field.');
    const content = bytes.subarray(at + 4, at + 4 + size);
    if (id === 0x5455 && (size < 1 || size > 13) || id === 0x000a && size !== 32 ||
        [0x7075, 0x6375].includes(id) && (size < 5 || content[0] !== 1))
      throw Error('Malformed ZIP metadata field.');
    if (id === 0x7075) {
      let unicodeName;
      try { unicodeName = decoder.decode(content.subarray(5)); } catch { throw Error('Non-UTF-8 ZIP Unicode name.'); }
      if (unicodeName !== name) throw Error('ZIP Unicode name differs from the reviewed directory entry.');
    }
    scanDecoded(content);
    at += 4 + size;
  }
}

function scanZip(bytes) {
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at -= 1) {
    if (bytes.readUInt32LE(at) === 0x06054b50 && at + 22 + bytes.readUInt16LE(at + 20) === bytes.length) {
      end = at; break;
    }
  }
  if (end < 0) throw Error('Malformed or appended ZIP archive.');
  const count = bytes.readUInt16LE(end + 10);
  const centralSize = bytes.readUInt32LE(end + 12);
  let at = bytes.readUInt32LE(end + 16);
  if (bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6) ||
      bytes.readUInt16LE(end + 8) !== count || count === 0xffff || count > 4096 ||
      at + centralSize !== end) throw Error('Unsupported ZIP structure.');
  const centralEnd = at + centralSize;
  const names = new Set();
  let expanded = 0;
  const ranges = [];
  for (let i = 0; i < count; i += 1) {
    if (at + 46 > centralEnd || bytes.readUInt32LE(at) !== 0x02014b50) throw Error('Malformed ZIP entry.');
    const flags = bytes.readUInt16LE(at + 8);
    const method = bytes.readUInt16LE(at + 10);
    const crc = bytes.readUInt32LE(at + 16);
    const compressed = bytes.readUInt32LE(at + 20);
    const size = bytes.readUInt32LE(at + 24);
    const nameLength = bytes.readUInt16LE(at + 28);
    const extraLength = bytes.readUInt16LE(at + 30);
    const commentLength = bytes.readUInt16LE(at + 32);
    const local = bytes.readUInt32LE(at + 42);
    const next = at + 46 + nameLength + extraLength + commentLength;
    if (next > centralEnd || flags & 65 || ![0, 8].includes(method) || size > LIMIT || compressed > LIMIT ||
        local + 30 > bytes.length || bytes.readUInt32LE(local) !== 0x04034b50)
      throw Error('Encrypted, malformed or unsupported ZIP entry.');
    const rawName = bytes.subarray(at + 46, at + 46 + nameLength);
    let name;
    try { name = decoder.decode(rawName); } catch { throw Error('Non-UTF-8 ZIP entry name.'); }
    const directory = name.endsWith('/');
    safePath(directory ? name.slice(0, -1) : name);
    if (names.has(name) || ((bytes.readUInt32LE(at + 38) >>> 16) & 0xf000) === 0xa000)
      throw Error('Duplicate or symbolic-link ZIP entry.');
    names.add(name);
    const localNameLength = bytes.readUInt16LE(local + 26);
    const localExtraLength = bytes.readUInt16LE(local + 28);
    if (bytes.readUInt16LE(local + 6) !== flags || bytes.readUInt16LE(local + 8) !== method ||
        !bytes.subarray(local + 30, local + 30 + localNameLength).equals(rawName))
      throw Error('ZIP local entry differs from its directory.');
    scanZipExtras(bytes.subarray(at + 46 + nameLength, at + 46 + nameLength + extraLength), name);
    scanZipExtras(bytes.subarray(local + 30 + localNameLength, local + 30 + localNameLength + localExtraLength), name);
    const start = local + 30 + localNameLength + localExtraLength;
    const finish = start + compressed;
    let localEnd = finish;
    if (flags & 8) {
      if (localEnd + 12 > bytes.readUInt32LE(end + 16)) throw Error('Malformed ZIP data descriptor.');
      const descriptor = bytes.readUInt32LE(localEnd) === 0x08074b50 ? localEnd + 4 : localEnd;
      if (descriptor + 12 > bytes.readUInt32LE(end + 16) || bytes.readUInt32LE(descriptor) !== crc ||
          bytes.readUInt32LE(descriptor + 4) !== compressed || bytes.readUInt32LE(descriptor + 8) !== size)
        throw Error('ZIP data descriptor differs from its directory.');
      localEnd = descriptor + 12;
    } else if (bytes.readUInt32LE(local + 14) !== crc || bytes.readUInt32LE(local + 18) !== compressed ||
        bytes.readUInt32LE(local + 22) !== size) throw Error('ZIP local sizes differ from its directory.');
    if (localEnd > bytes.readUInt32LE(end + 16) || ranges.some(([a, b]) => local < b && localEnd > a))
      throw Error('Overlapping or out-of-bounds ZIP entry.');
    ranges.push([local, localEnd]);
    const payload = method === 0 ? bytes.subarray(start, finish)
      : inflateRawSync(bytes.subarray(start, finish), { maxOutputLength: LIMIT });
    expanded += payload.length;
    if (payload.length !== size || expanded > LIMIT) throw Error('ZIP expanded size is invalid or exceeds review limit.');
    if (crc32(payload) !== crc) throw Error('ZIP checksum differs from its decoded payload.');
    if (['zip', 'gzip', 'unsupported-archive'].includes(signature(payload)) || /\.(?:zip|gz|tgz|tar|7z|rar|xlsx|docx|pptx)$/i.test(name))
      throw Error('Nested archive is forbidden in a public container.');
    scanDecoded(payload);
    if (signature(payload) === 'pdf') scanPdf(payload);
    if (signature(payload) === 'png') scanPng(payload);
    at = next;
  }
  if (at !== centralEnd) throw Error('Unexpected ZIP directory content.');
  ranges.sort((a, b) => a[0] - b[0]);
  let covered = 0;
  for (const [start, finish] of ranges) {
    if (start !== covered) throw Error('Unlisted or hidden ZIP local content.');
    covered = finish;
  }
  if (covered !== bytes.readUInt32LE(end + 16)) throw Error('Unlisted or hidden ZIP local content.');
}

function decodePdfAscii85(bytes) {
  const encoded = bytes.toString('latin1').replace(/[\t\n\f\r ]/g, '').replaceAll('\0', '');
  if (!encoded.endsWith('~>')) throw Error('Malformed PDF ASCII85 end marker.');
  const body = encoded.slice(0, -2);
  const output = Buffer.alloc(Math.min(LIMIT, bytes.length * 4));
  let at = 0;
  let digits = [];
  const group = (size) => {
    const value = digits.reduce((total, digit) => total * 85 + digit, 0);
    if (value > 0xffffffff || at + size > LIMIT) throw Error('PDF ASCII85 tuple exceeds review bounds.');
    for (let i = 0; i < size; i += 1) output[at++] = Math.floor(value / 256 ** (3 - i)) % 256;
    digits = [];
  };
  for (const char of body) {
    if (char === 'z') {
      if (digits.length) throw Error('Malformed PDF ASCII85 zero tuple.');
      digits = [0, 0, 0, 0, 0];
      group(4);
    } else {
      const code = char.charCodeAt(0);
      if (code < 33 || code > 117) throw Error('Malformed PDF ASCII85 character.');
      digits.push(code - 33);
      if (digits.length === 5) group(4);
    }
  }
  if (digits.length === 1) throw Error('Malformed PDF ASCII85 final tuple.');
  if (digits.length) {
    const size = digits.length - 1;
    while (digits.length < 5) digits.push(84);
    group(size);
  }
  return output.subarray(0, at);
}

function scanPdf(bytes) {
  // Synthetic PDFs may compress their text and document metadata.
  const input = bytes.toString('latin1');
  if (!/%%EOF\s*$/.test(input)) throw Error('Malformed PDF or appended content after its final marker.');
  if (/\/Encrypt\b/.test(input)) throw Error('Encrypted PDF cannot be independently inspected.');
  if (/\/(?:EmbeddedFiles?|Filespec)\b/.test(input)) throw Error('Embedded PDF files are forbidden in public fixtures.');
  const streams = /<<(.*?)>>\s*stream\r?\n/gms;
  let match;
  let expanded = 0;
  while ((match = streams.exec(input))) {
    const end = input.indexOf('endstream', streams.lastIndex);
    if (end < 0) throw Error('Malformed PDF stream.');
    const filters = match[1].match(/\/Filter\s*(\[[^\]]*\]|\/[A-Za-z0-9]+)/)?.[1];
    if ((match[1].match(/\/Filter\b/g)?.length || 0) > 1 || /\/Filter\b/.test(match[1]) && !filters)
      throw Error('Unsupported compressed PDF filter chain.');
    const ascii85Flate = !!filters && /^\[\s*\/ASCII85Decode\s+\/FlateDecode\s*\]$/.test(filters);
    if (filters && !ascii85Flate && !/^(?:\/FlateDecode|\[\s*\/FlateDecode\s*\])$/.test(filters))
      throw Error('Unsupported compressed PDF filter chain.');
    const encoded = bytes.subarray(streams.lastIndex, end);
    const packed = ascii85Flate ? decodePdfAscii85(encoded) : encoded;
    const output = filters ? inflateSync(packed, { maxOutputLength: LIMIT }) : packed;
    expanded += output.length;
    if (expanded > LIMIT) throw Error('PDF expanded size exceeds review limit.');
    if (signature(output) && signature(output) !== 'png') throw Error('Nested binary or archive is forbidden in a public PDF.');
    if (signature(output) === 'png') scanPng(output);
    scanDecoded(output);
  }
}

export function validateManifest(manifest) {
  if (!manifest || manifest.version !== 1 || !Array.isArray(manifest.source) || !Array.isArray(manifest.distribution) ||
      Object.keys(manifest).some(key => !['version', 'source', 'distribution'].includes(key)))
    throw Error('Expected public manifest version 1 with source and distribution inventories.');
  for (const scope of ['source', 'distribution']) {
    const seen = new Set();
    for (const entry of manifest[scope]) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw Error('Invalid public inventory entry.');
      const p = safePath(entry.path);
      if (seen.has(p) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > LIMIT ||
          !SHA.test(entry.sha256) || !['text', 'approved-binary'].includes(entry.kind) ||
          Object.keys(entry).some(key => !['path', 'bytes', 'sha256', 'kind', 'provenance'].includes(key)))
        throw Error('Invalid or duplicate public inventory entry.');
      if (scope === 'source' && ['.git', 'node_modules', 'dist', 'work', 'outputs'].includes(p.split('/')[0]))
        throw Error('Local execution directories cannot be source publication entries.');
      if ((entry.kind === 'approved-binary' || entry.provenance) && (!entry.provenance ||
          !BINARY_TYPES.has(entry.provenance.type) || typeof entry.provenance.description !== 'string' ||
          !entry.provenance.description.trim() || Object.keys(entry.provenance).some(key => !['type', 'description'].includes(key))))
        throw Error('Binary approval requires reviewed provenance and exact path, bytes and SHA-256.');
      if (entry.provenance) scanText(JSON.stringify(entry.provenance));
      seen.add(p);
    }
  }
  return manifest;
}

async function walk(root, source) {
  const files = [];
  const visit = async (dir, relative = '') => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (source && !relative && ['.git', 'node_modules'].includes(entry.name)) continue;
      const p = relative ? `${relative}/${entry.name}` : entry.name;
      safePath(p);
      if (entry.isSymbolicLink()) throw Error('Symlinks cannot be public files.');
      if (entry.isDirectory()) await visit(path.join(dir, entry.name), p);
      else if (entry.isFile()) files.push(p);
      else throw Error('Special files cannot be public files.');
    }
  };
  await visit(root);
  return files;
}

async function inspectFile(root, entry) {
  const target = path.join(root, entry.path);
  // Reject symlinked parent directories too, including the publication root.
  let parent = root;
  if ((await lstat(parent)).isSymbolicLink()) throw Error('Publication root cannot be a symlink.');
  for (const part of entry.path.split('/')) {
    parent = path.join(parent, part);
    if ((await lstat(parent)).isSymbolicLink()) throw Error('Symlinks cannot be public files.');
  }
  const stat = await lstat(target);
  if (!stat.isFile() || stat.size !== entry.bytes) throw Error('Public file type or bytes differ from review.');
  const bytes = await readFile(target);
  if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw Error('Public file SHA-256 differs from review.');
  const text = textBytes(bytes);
  const format = signature(bytes);
  if (entry.kind === 'text') {
    if (text === null || format || /\.(?:zip|gz|tgz|tar|7z|rar|xlsx|docx|pptx|pdf)$/i.test(entry.path))
      throw Error('Binary or archive content requires explicit reviewed binary approval.');
    scanText(text);
  } else {
    scanDecoded(bytes);
    if (format === 'png') scanPng(bytes);
    else if (/\.png$/i.test(entry.path)) throw Error('Reviewed PNG must have a valid PNG signature.');
    else if (format === 'zip') scanZip(bytes);
    else if (format === 'gzip') {
      const unpacked = gunzipSync(bytes, { maxOutputLength: LIMIT });
      if (signature(unpacked)) throw Error('Nested archive is forbidden in gzip.');
      scanDecoded(unpacked);
    } else if (format === 'pdf') scanPdf(bytes);
    else if (format === 'unsupported-archive' || /\.(?:zip|gz|tgz|tar|7z|rar|xlsx|docx|pptx)$/i.test(entry.path))
      throw Error('Unsupported or disguised public archive.');
  }
}

export async function checkPublicContent({ root, manifest, mode = 'source', manifestPath = 'public-safe-manifest.json' }) {
  root = path.resolve(root);
  safePath(manifestPath);
  validateManifest(manifest);
  if (!['source', 'source-export', 'distribution'].includes(mode)) throw Error('Unknown publication check mode.');
  const scope = mode === 'distribution' ? 'distribution' : 'source';
  const target = scope === 'distribution' ? path.join(root, 'dist') : root;
  if (!(await lstat(target)).isDirectory() || (await lstat(target)).isSymbolicLink())
    throw Error('Publication root must be a regular directory.');
  if (scope === 'source' && manifest.source.some(entry => entry.path === manifestPath))
    throw Error('The manifest cannot include its own circular hash.');
  let actual;
  if (mode === 'source-export') {
    // Generated test evidence is intentionally absent from a Git source export.
    // Every tracked file is still checked; ignore rules never authorize exports.
    const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: LIMIT });
    actual = tracked.split('\0').filter(Boolean);
  } else actual = await walk(target, scope === 'source');
  const expected = new Set(manifest[scope].map(entry => entry.path));
  if (scope === 'source') expected.add(manifestPath);
  if (actual.length !== expected.size || actual.some(p => !expected.has(p)))
    throw Error('Publication inventory differs from the exact reviewed allowlist (missing or unapproved file).');
  for (const p of actual) safePath(p);
  if (scope === 'source') {
    const manifestFile = path.join(root, manifestPath);
    if (!(await lstat(manifestFile)).isFile() || (await lstat(manifestFile)).isSymbolicLink())
      throw Error('The manifest must be a regular file.');
    const onDisk = await readFile(manifestFile, 'utf8');
    scanText(onDisk);
    if (JSON.stringify(JSON.parse(onDisk)) !== JSON.stringify(manifest)) throw Error('Manifest differs from the supplied review.');
    try {
      await lstat(path.join(root, 'node_modules'));
      execFileSync('git', ['check-ignore', '--quiet', 'node_modules'], { cwd: root, stdio: 'pipe' });
      const tracked = execFileSync('git', ['ls-files', '-z', '--', 'node_modules'], { cwd: root, encoding: 'utf8' });
      if (tracked) throw Error('Dependencies must be ignored and absent from source export.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw Error('Local dependency directory must be ignored and untracked.');
    }
  }
  for (const entry of manifest[scope]) await inspectFile(target, entry);
  return { scope: mode, files: manifest[scope].length, bytes: manifest[scope].reduce((sum, entry) => sum + entry.bytes, 0) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    let root = path.resolve(import.meta.dirname, '..');
    let manifestPath = 'public-safe-manifest.json';
    let mode;
    for (let at = 0; at < args.length; at += 1) {
      const arg = args[at];
      if (['--source', '--source-export', '--dist'].includes(arg) && !mode)
        mode = arg === '--dist' ? 'distribution' : arg.slice(2);
      else if (arg === '--root' && args[at + 1]) root = path.resolve(args[++at]);
      else if (arg === '--manifest' && args[at + 1]) manifestPath = safePath(args[++at]);
      else throw Error('Use --source, --source-export or --dist, with optional --root and --manifest.');
    }
    if (!mode) throw Error('Select a publication check mode.');
    const bytes = await readFile(path.join(root, manifestPath), 'utf8');
    scanText(bytes);
    const result = await checkPublicContent({ root, manifestPath, manifest: JSON.parse(bytes), mode });
    console.log(JSON.stringify({ publicContentCheck: 'passed', ...result }));
  } catch (error) {
    // Avoid printing raw content, injected filenames, machine paths or native
    // exception stacks into public CI logs.
    const message = error.code || error.name === 'SyntaxError' || error.name === 'RangeError'
      ? 'Publication input is missing, malformed or unsupported.' : error.message;
    console.error(`Public content check failed: ${message}`);
    process.exitCode = 1;
  }
}
