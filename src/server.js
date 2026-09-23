/**
 * Minimal static viewer for generated reports, so a voter can click one link
 * instead of reading a terminal. Localhost only, read-only, no uploads, no
 * dependencies.
 */

import { createServer } from 'node:http';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, extname } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

/**
 * Resolve a request path inside `dir`, refusing anything that escapes it.
 * @param {string} dir
 * @param {string} urlPath
 * @returns {string|null}
 */
export function safeResolve(dir, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;

  const root = resolve(dir);
  // Resolve the request relative to the root, then prove the result is still
  // inside it. No path rewriting, no stripping - traversal simply fails.
  const candidate = resolve(root, decoded.replace(/^[/\\]+/, ''));
  const separator = process.platform === 'win32' ? '\\' : '/';
  return candidate === root || candidate.startsWith(root + separator) ? candidate : null;
}

/** @param {string} dir */
export function renderIndex(dir) {
  const reports = readdirSync(dir)
    .filter((name) => name.endsWith('.html'))
    .sort();
  const items = reports
    .map((name) => `<li><a href="/${encodeURIComponent(name)}">@${name.replace(/\.html$/, '')}</a></li>`)
    .join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Called It — reports</title>
<style>:root{color-scheme:light dark}body{font:16px/1.6 ui-sans-serif,system-ui,sans-serif;max-width:640px;margin:8vh auto;padding:0 20px}
h1{letter-spacing:-.02em}li{margin:.4em 0}a{color:#3a2fd6}@media(prefers-color-scheme:dark){a{color:#8d86ff}}</style>
</head><body><h1>Called It</h1><p>Generated report cards:</p>
<ul>${items || '<li>none yet — run <code>node src/cli.js report &lt;handle&gt;</code></li>'}</ul></body></html>`;
}

/**
 * @param {{port:number, dir:string}} options
 */
export function startServer({ port, dir }) {
  const server = createServer((request, response) => {
    if (request.method !== 'GET') {
      response.writeHead(405).end('method not allowed');
      return;
    }
    const urlPath = request.url ?? '/';
    if (urlPath === '/' || urlPath.startsWith('/?')) {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(renderIndex(dir));
      return;
    }
    const filePath = safeResolve(dir, urlPath);
    if (!filePath) {
      response.writeHead(403).end('forbidden');
      return;
    }
    try {
      if (!statSync(filePath).isFile()) throw new Error('not a file');
      response
        .writeHead(200, { 'content-type': TYPES[extname(filePath)] ?? 'application/octet-stream' })
        .end(readFileSync(filePath));
    } catch {
      response.writeHead(404).end('not found');
    }
  });

  return new Promise((resolvePromise) => {
    server.listen(port, '127.0.0.1', () => {
      console.log(`Called It reports on http://127.0.0.1:${port}  (ctrl-c to stop)`);
      resolvePromise(server);
    });
  });
}
