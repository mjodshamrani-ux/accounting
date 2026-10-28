// The node writer for INV-3 focused stories: reads [{path, rows}] on stdin and
// quotes any field with a character outside [A-Za-z0-9._-], CRLF line ends.
import { writeFileSync } from 'node:fs';

const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const jobs = JSON.parse(Buffer.concat(chunks).toString('utf8'));
const field = (v) =>
  /^[A-Za-z0-9._-]*$/.test(v) ? v : '"' + v.replaceAll('"', '""') + '"';
for (const { path, rows } of jobs)
  writeFileSync(
    path,
    rows.map((r) => r.map(field).join(',')).join('\r\n') + '\r\n',
  );
