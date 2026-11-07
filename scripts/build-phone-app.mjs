import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseEnv } from 'node:util';
import { permissionsPolicy, securityHeaders } from '../lib/security-headers.mjs';

const root = path.resolve('out');
// Offline resources and worker behavior change the cache generation automatically.
const workerSource = await fs.readFile('public/software/sw.js', 'utf8');
const publicResources = ['/software/offline.html','/software/offline.css','/software/icons/icon-192.png','/software/icons/icon-512.png','/software/icons/maskable-512.png'];
const generation = createHash('sha256').update(workerSource);
for (const resource of publicResources) generation.update(resource).update(await fs.readFile(path.join(root, resource)));
const publicVersion = generation.digest('hex').slice(0, 16);
await fs.writeFile(path.join(root, 'software/sw.js'), workerSource.replace(/const CACHE_NAME = CACHE_PREFIX \+ "[^"]+";/, `const CACHE_NAME = CACHE_PREFIX + "${publicVersion}";`));
const local = await fs.readFile('.env.local', 'utf8').then(parseEnv).catch(() => ({}));
const api = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || local.NEXT_PUBLIC_SUPABASE_URL || '');
if (api.protocol !== 'https:' || api.username || api.password || api.search || api.pathname !== '/') throw new Error('The release must use an HTTPS Supabase origin.');
async function files(dir) { const entries = await fs.readdir(dir, { withFileTypes: true }); return (await Promise.all(entries.map(e => e.isDirectory() ? files(path.join(dir,e.name)) : [path.join(dir,e.name)]))).flat(); }
const hashes = new Set(); let htmlCount = 0;
for (const file of await files(root)) {
  if (!/\.(html|js|json|txt|webmanifest)$/.test(file)) continue;
  const text = await fs.readFile(file, 'utf8');
  if (/sb_secret_[A-Za-z0-9_-]{20,}/.test(text)) throw new Error('A secret API key was found in public output.');
  for (const match of text.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g)) {
    try { if (JSON.parse(Buffer.from(match[0].split('.')[1],'base64url').toString()).role === 'service_role') throw new Error('Privileged JWT in public output'); }
    catch (e) { if (e.message === 'Privileged JWT in public output') throw e; }
  }
  if (!file.endsWith('.html')) continue; htmlCount++;
  for (const script of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/\bsrc\s*=/i.test(script[1]) && script[2]) hashes.add(createHash('sha256').update(script[2]).digest('base64'));
  }
}
const headers = securityHeaders([...hashes].sort(), api.origin);
const config = {
  $schema: 'https://openapi.vercel.sh/vercel.json', trailingSlash: true,
  redirects: [
    { source: '/software/preview', destination: '/software/', permanent: false },
    { source: '/software/preview/', destination: '/software/', permanent: false },
  ],
  headers: [
    { source: '/(.*)', headers },
    { source: '/software/', headers: [{ key: 'Permissions-Policy', value: permissionsPolicy }] },
    { source: '/software/index.html', headers: [{ key: 'Permissions-Policy', value: permissionsPolicy }] },
    { source: '/software/(.*)', headers: [{ key: 'Cache-Control', value: 'private, no-store, max-age=0' }] },
    { source: '/software/sw.js', headers: [{ key: 'Content-Type', value: 'application/javascript; charset=utf-8' }, { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }, { key: 'Service-Worker-Allowed', value: '/software/' }] },
    { source: '/software/manifest.webmanifest', headers: [{ key: 'Content-Type', value: 'application/manifest+json' }, { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }] },
    { source: '/software/icons/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=86400' }] },
  ],
};
await fs.writeFile(path.join(root, 'vercel.json'), JSON.stringify(config, null, 2)+'\n');
await fs.mkdir('.pilot-test', {recursive:true});
await fs.writeFile('.pilot-test/phone-build-security.json',JSON.stringify({html_pages:htmlCount,inline_script_hashes:hashes.size,csp_bytes:headers[0].value.length,offline_cache_generation:publicVersion,private_key_scan:'passed',permissions:'microphone self only in workspace; unrelated features denied'},null,2));
console.log(`Phone app release policy generated: ${htmlCount} public HTML pages, ${hashes.size} allowed inline-script hashes; private-key scan passed.`);
