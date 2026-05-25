import { readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { MIME, PUBLIC_DIR } from '../../config.mjs';
import { errorMessage, isWithinPath } from '../../util.mjs';
import { resolveSessionMediaFile } from '../../session-media.mjs';

export function match(method, pathname) {
  return (method === 'GET' && (pathname === '/' || pathname.startsWith('/static/') || pathname === '/session-media'));
}

export async function handle(ctx) {
  const { req, res, url, auth, bootstrap, redirectWithoutToken } = ctx;

  if (req.method === 'GET' && url.pathname === '/') {
    if (auth(req) && url.searchParams.has('token')) {
      redirectWithoutToken(res, url);
      return true;
    }
    if (!auth(req)) {
      if (bootstrap(req, res, url)) return true;
      res.writeHead(401, { 'cache-control': 'no-store' }).end('missing or bad session');
      return true;
    }
    try {
      const html = await readFile(join(PUBLIC_DIR, 'index.html'), 'utf8');
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(html);
    } catch (e) { res.writeHead(500).end(errorMessage(e)); }
    return true;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/static/')) {
    let relPath;
    try {
      relPath = decodeURIComponent(url.pathname.slice('/static/'.length));
    } catch {
      res.writeHead(400).end('bad static path');
      return true;
    }
    const file = resolve(PUBLIC_DIR, relPath);
    if (!isWithinPath(PUBLIC_DIR, file)) { res.writeHead(403).end(); return true; }
    try {
      const data = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
      res.end(data);
    } catch { res.writeHead(404).end(); }
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/session-media') {
    if (!auth(req)) { res.writeHead(401).end(); return true; }
    try {
      const media = await resolveSessionMediaFile(url.searchParams.get('path'));
      res.writeHead(200, {
        'content-type': media.contentType,
        'cache-control': 'no-store',
      });
      const stream = createReadStream(media.file);
      stream.on('error', () => {
        if (!res.headersSent) res.writeHead(404);
        res.end();
      });
      stream.pipe(res);
    } catch (e) {
      const status = e?.status ?? 500;
      res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      res.end(status === 500 ? errorMessage(e) : e.message);
    }
    return true;
  }

  return false;
}
