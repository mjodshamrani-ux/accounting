// The Node writer for FA-1 focused stories: reads [{path, rows}] on stdin and
// writes each file with every field quoted, inner quotes doubled, CRLF after
// every record, and no byte order mark.
import { writeFileSync } from 'node:fs';

const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const jobs = JSON.parse(Buffer.concat(chunks).toString('utf8'));
for (const { path, rows } of jobs) {
  const text = rows
    .map(
      (row) =>
        row.map((v) => `"${v.replaceAll('"', '""')}"`).join(',') + '\r\n',
    )
    .join('');
  writeFileSync(path, text, 'utf8');
}
