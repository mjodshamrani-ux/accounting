import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve('dist');
const server = createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost');
    let rel = decodeURIComponent(u.pathname).replace(/^\/mizan-test\//, '/');
    if (rel === '/') rel = '/index.html';
    const file = path.resolve(root, '.' + rel);
    if (!file.startsWith(root + path.sep)) throw new Error('Invalid path');
    const bytes = await readFile(file);
    const mime =
      {
        '.html': 'text/html; charset=utf-8',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
      }[path.extname(file)] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
    res.end(bytes);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
server.listen(4173, '127.0.0.1', () =>
  console.log('Production preview: http://127.0.0.1:4173/mizan-test/'),
);
