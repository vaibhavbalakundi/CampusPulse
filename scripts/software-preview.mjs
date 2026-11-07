import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// The software preview is local-only. The existing LAN hardware preview is separate.
const root = path.resolve('out');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    let file = path.resolve(root, '.' + pathname);
    if (file !== root && !file.startsWith(root + path.sep)) { response.writeHead(403); response.end('Forbidden'); return; }
    if (!path.extname(file)) file = path.join(file, 'index.html');
    const contents = await readFile(file);
    response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    response.end(contents);
  } catch { response.writeHead(404); response.end('Not found'); }
}).listen(3000, '127.0.0.1', () => console.log('CampusPulse local preview: http://127.0.0.1:3000/software/'));
