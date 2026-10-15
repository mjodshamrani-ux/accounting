import { deflateSync } from 'node:zlib';
// Synthetic Type1 ASCII test originals only. Rebuild lengths/xref after a test
// edit; a broken container must not masquerade as a literal/accounting test.
export function rewriteSyntheticPdf(
  original: ArrayBuffer,
  edit: (text: string) => string,
): ArrayBuffer {
  const source = new TextDecoder('ascii').decode(original);
  const entries = [...source.matchAll(/^(\d+) 0 obj\n([\s\S]*?)\nendobj\n/gm)];
  if (!entries.length) throw Error('Synthetic PDF objects missing');
  let text = source.slice(0, entries[0].index);
  const offsets = [0];
  for (const entry of entries) {
    const id = Number(entry[1]);
    if (id !== offsets.length) throw Error('Synthetic PDF object order');
    let body = edit(entry[2]);
    const stream = /^(<< \/Length \d+ >>)\nstream\n([\s\S]*)\nendstream$/.exec(
      body,
    );
    if (stream)
      body =
        '<< /Length ' +
        new TextEncoder().encode(stream[2]).length +
        ' >>\nstream\n' +
        stream[2] +
        '\nendstream';
    offsets.push(new TextEncoder().encode(text).length);
    text += id + ' 0 obj\n' + body + '\nendobj\n';
  }
  const xref = new TextEncoder().encode(text).length;
  text += 'xref\n0 ' + offsets.length + '\n0000000000 65535 f \n';
  for (const offset of offsets.slice(1))
    text += offset.toString().padStart(10, '0') + ' 00000 n \n';
  text +=
    'trailer\n<< /Size ' +
    offsets.length +
    ' /Root 1 0 R >>\nstartxref\n' +
    xref +
    '\n%%EOF\n';
  return new TextEncoder().encode(text).buffer;
}

/** Same tables, different serialized container. No layout-family claim. */
export function compressSyntheticPdf(original: ArrayBuffer): ArrayBuffer {
  const source = Buffer.from(original).toString('latin1');
  const entries = [...source.matchAll(/^(\d+) 0 obj\n([\s\S]*?)\nendobj\n/gm)];
  let text = source.slice(0, entries[0].index);
  const offsets = [0];
  for (const entry of entries) {
    let body = entry[2];
    const stream = /^<< \/Length \d+ >>\nstream\n([\s\S]*)\nendstream$/.exec(
      body,
    );
    if (stream) {
      const compressed = deflateSync(Buffer.from(stream[1], 'latin1'));
      body =
        '<< /Length ' +
        compressed.length +
        ' /Filter /FlateDecode >>\nstream\n' +
        compressed.toString('latin1') +
        '\nendstream';
    }
    offsets.push(text.length);
    text += entry[1] + ' 0 obj\n' + body + '\nendobj\n';
  }
  const xref = text.length;
  text += 'xref\n0 ' + offsets.length + '\n0000000000 65535 f \n';
  for (const offset of offsets.slice(1))
    text += offset.toString().padStart(10, '0') + ' 00000 n \n';
  text +=
    'trailer\n<< /Size ' +
    offsets.length +
    ' /Root 1 0 R >>\nstartxref\n' +
    xref +
    '\n%%EOF\n';
  return Uint8Array.from(Buffer.from(text, 'latin1')).buffer;
}
