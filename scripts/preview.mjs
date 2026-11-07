import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('out');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.woff2': 'font/woff2' };
let release = JSON.parse(await readFile(path.join(root, 'vercel.json'), 'utf8'));
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function responseHeaders(pathname) {
  const headers = {};
  for (const rule of release.headers) {
    const pattern = new RegExp('^' + rule.source.split('(.*)').map(escape).join('.*') + '$');
    if (pattern.test(pathname)) for (const item of rule.headers) headers[item.key] = item.value;
  }
  // Loopback preview is HTTP; production retains HTTPS upgrade enforcement.
  if (headers['Content-Security-Policy']) headers['Content-Security-Policy'] = headers['Content-Security-Policy'].replace('; upgrade-insecure-requests', '');
  return headers;
}
const server = http.createServer(async (request, response) => {
  try {
    release = JSON.parse(await readFile(path.join(root, 'vercel.json'), 'utf8'));
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    let file = path.resolve(root, '.' + pathname);
    if (file !== root && !file.startsWith(root + path.sep)) { response.writeHead(403); return response.end('Forbidden'); }
    if (!path.extname(file)) file = path.join(file, 'index.html');
    const contents = await readFile(file);
    response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', ...responseHeaders(pathname) });
    response.end(contents);
  } catch { response.writeHead(404, responseHeaders('/')); response.end('Not found'); }
});
server.listen(3000, '0.0.0.0', () => console.log('CampusPulse preview: http://127.0.0.1:3000 (LAN: http://<this-computer-ip>:3000)'));
