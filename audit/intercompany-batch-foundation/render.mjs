// IC-1 foundation, the node writer: every field quoted, quotes doubled, CRLF
// after every row. Reads [{path, cells}] as JSON on stdin.
import { writeFileSync } from 'node:fs';

let input = '';
for await (const chunk of process.stdin) input += chunk;
for (const { path, cells } of JSON.parse(input))
  writeFileSync(
    path,
    cells
      .map(
        (row) =>
          row.map((v) => `"${v.replaceAll('"', '""')}"`).join(',') + '\r\n',
      )
      .join(''),
    'utf8',
  );
