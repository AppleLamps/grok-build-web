import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { readBody, sendJson, sendJsonError } from '../response.mjs';
import { isWithinPath } from '../../util.mjs';

export const UPLOAD_DIR_NAME = '.grok-web-uploads';
export const MAX_UPLOAD_BYTES = Number(process.env.GROK_WEB_MAX_UPLOAD_BYTES ?? 25 * 1024 * 1024);

const ALLOWED_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg',
  '.pdf',
]);

const MEDIA_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
};

function sanitizeFilename(raw) {
  const name = basename(String(raw ?? ''));
  return name.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '').slice(0, 80) || 'file';
}

export function match(method, pathname) {
  return (method === 'POST' && pathname === '/upload')
    || (method === 'GET' && pathname === '/upload-media');
}

export async function handle(ctx) {
  const { req, res, url, requireApiAuth, grok } = ctx;
  if (!requireApiAuth(req, res)) return true;
  if (req.method === 'POST' && url.pathname === '/upload') return handleUpload(ctx);
  if (req.method === 'GET' && url.pathname === '/upload-media') return handleMedia(ctx);
  return false;
}

async function handleUpload({ req, res, grok }) {
  const contentType = String(req.headers['content-type'] ?? '').toLowerCase();
  if (contentType.includes('application/json')) return handleJsonUpload({ req, res, grok });
  return handleRawUpload({ req, res, url: new URL(req.url, 'http://127.0.0.1'), grok });
}

async function handleJsonUpload({ req, res, grok }) {
  try {
    const body = JSON.parse(await readBody(req));
    const target = await uploadTarget({ res, grok, filename: body.filename, sessionId: body.sessionId });
    if (!target) return true;
    if (typeof body.dataBase64 !== 'string' || !body.dataBase64) {
      sendJsonError(res, 400, 'dataBase64 required');
      return true;
    }
    const buf = Buffer.from(body.dataBase64, 'base64');
    if (buf.length === 0) {
      sendJsonError(res, 400, 'empty file');
      return true;
    }
    if (buf.length > MAX_UPLOAD_BYTES) {
      sendJsonError(res, 413, `file exceeds ${MAX_UPLOAD_BYTES} byte limit`);
      return true;
    }
    await writeFile(target.fullPath, buf);
    sendUploadResult(res, target, buf.length);
  } catch (e) {
    sendJsonError(res, 400, e);
  }
  return true;
}

async function handleRawUpload({ req, res, url, grok }) {
  let target;
  let tempPath;
  try {
    target = await uploadTarget({
      res,
      grok,
      filename: url.searchParams.get('filename'),
      sessionId: url.searchParams.get('sessionId'),
    });
    if (!target) return true;
    tempPath = `${target.fullPath}.tmp-${randomBytes(4).toString('hex')}`;
    const size = await writeRawUpload(req, tempPath);
    await rename(tempPath, target.fullPath);
    sendUploadResult(res, target, size);
  } catch (e) {
    if (tempPath) await unlink(tempPath).catch(() => {});
    sendJsonError(res, e?.code === 'ERR_UPLOAD_TOO_LARGE' ? 413 : 400, e);
  }
  return true;
}

async function uploadTarget({ res, grok, filename: rawFilename, sessionId: rawSessionId }) {
  const filename = sanitizeFilename(rawFilename);
  const ext = extname(filename).toLowerCase();
  if (!ALLOWED_EXTS.has(ext)) {
    sendJsonError(res, 415, 'unsupported file type');
    return null;
  }
  const sessionId = grok.activeSessionId(rawSessionId);
  if (!sessionId) {
    sendJsonError(res, 400, 'no active session');
    return null;
  }
  const cwd = grok.cwdForSession(sessionId);
  if (!cwd) {
    sendJsonError(res, 400, 'session cwd unknown');
    return null;
  }
  const dir = join(cwd, UPLOAD_DIR_NAME);
  await mkdir(dir, { recursive: true });
  const stored = `${Date.now()}-${randomBytes(4).toString('hex')}-${filename}`;
  const fullPath = join(dir, stored);
  if (!isWithinPath(dir, fullPath)) {
    sendJsonError(res, 400, 'invalid path');
    return null;
  }
  return { filename, fullPath, sessionId, stored };
}

function sendUploadResult(res, target, size) {
  const mediaUrl = `/upload-media?sessionId=${encodeURIComponent(target.sessionId)}&name=${encodeURIComponent(target.stored)}`;
  sendJson(res, 200, {
    ok: true,
    path: target.fullPath,
    stored: target.stored,
    filename: target.filename,
    size,
    mediaUrl,
  });
}

function writeRawUpload(req, tempPath) {
  return new Promise((resolve, reject) => {
    const out = createWriteStream(tempPath, { flags: 'wx' });
    let total = 0;
    let tooLargeError = null;
    let settled = false;

    function done(fn, value) {
      if (settled) return;
      settled = true;
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      out.off('error', onError);
      out.off('finish', onFinish);
      fn(value);
    }

    function onError(error) {
      done(reject, error);
    }

    function onData(chunk) {
      total += chunk.length;
      if (total > MAX_UPLOAD_BYTES && !tooLargeError) {
        tooLargeError = new Error(`file exceeds ${MAX_UPLOAD_BYTES} byte limit`);
        tooLargeError.code = 'ERR_UPLOAD_TOO_LARGE';
        req.unpipe(out);
        out.destroy();
        req.resume();
      }
    }

    function onEnd() {
      if (tooLargeError) {
        done(reject, tooLargeError);
        return;
      }
      if (total === 0) {
        const error = new Error('empty file');
        out.destroy(error);
        done(reject, error);
      }
    }

    function onFinish() {
      done(resolve, total);
    }

    req.on('data', onData);
    req.once('end', onEnd);
    req.once('error', onError);
    out.once('error', onError);
    out.once('finish', onFinish);
    req.pipe(out);
  });
}

async function handleMedia({ res, url, grok }) {
  const sessionId = url.searchParams.get('sessionId');
  const name = url.searchParams.get('name');
  if (!sessionId || !name) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('missing params');
    return true;
  }
  if (name !== basename(name) || name.includes('\\') || name.includes('/')) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('bad name');
    return true;
  }
  const ext = extname(name).toLowerCase();
  const mime = MEDIA_MIME[ext];
  if (!mime) {
    res.writeHead(415).end();
    return true;
  }
  const cwd = grok.cwdForSession(sessionId);
  if (!cwd) {
    res.writeHead(404).end('unknown session');
    return true;
  }
  const dir = join(cwd, UPLOAD_DIR_NAME);
  const fullPath = join(dir, name);
  if (!isWithinPath(dir, fullPath)) {
    res.writeHead(400).end('bad path');
    return true;
  }
  try {
    const st = await stat(fullPath);
    res.writeHead(200, {
      'content-type': mime,
      'content-length': st.size,
      'cache-control': 'private, max-age=3600',
    });
    createReadStream(fullPath).pipe(res);
  } catch {
    res.writeHead(404).end('not found');
  }
  return true;
}
