import { realpath, stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { SESSIONS_ROOT } from './config.mjs';
import { hasPathTraversal, isWithinPath } from './util.mjs';

const SESSION_MEDIA_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogg': 'video/ogg',
};

export function mediaPathError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function resolveSessionMediaCandidate(rawPath) {
  const raw = String(rawPath ?? '').trim();
  if (!raw) throw mediaPathError(400, 'path required');
  const ext = extname(raw).toLowerCase();
  if (!SESSION_MEDIA_MIME[ext]) throw mediaPathError(415, 'unsupported media type');

  const normalized = raw.replace(/\\/g, '/');
  const lower = normalized.toLowerCase();
  const prefixes = ['~/.grok/sessions/', '.grok/sessions/'];
  for (const prefix of prefixes) {
    if (lower.startsWith(prefix)) {
      const rel = normalized.slice(prefix.length);
      if (!rel || hasPathTraversal(rel)) throw mediaPathError(403, 'path outside sessions root');
      return resolve(SESSIONS_ROOT, rel);
    }
  }

  const embedded = '/.grok/sessions/';
  const idx = lower.indexOf(embedded);
  if (idx >= 0) {
    const rel = normalized.slice(idx + embedded.length);
    if (!rel || hasPathTraversal(rel)) throw mediaPathError(403, 'path outside sessions root');
    return resolve(SESSIONS_ROOT, rel);
  }

  if (hasPathTraversal(normalized)) throw mediaPathError(403, 'path outside sessions root');
  return resolve(SESSIONS_ROOT, raw);
}

export async function resolveSessionMediaFile(rawPath) {
  const candidate = resolveSessionMediaCandidate(rawPath);
  if (!isWithinPath(SESSIONS_ROOT, candidate)) throw mediaPathError(403, 'path outside sessions root');

  let rootReal;
  try {
    rootReal = await realpath(SESSIONS_ROOT);
  } catch {
    throw mediaPathError(404, 'sessions root not found');
  }

  let fileReal;
  try {
    fileReal = await realpath(candidate);
  } catch (e) {
    if (e?.code === 'ENOENT' || e?.code === 'ENOTDIR') throw mediaPathError(404, 'media not found');
    throw e;
  }
  if (!isWithinPath(rootReal, fileReal)) throw mediaPathError(403, 'path outside sessions root');

  const st = await stat(fileReal);
  if (!st.isFile()) throw mediaPathError(403, 'not a file');

  const ext = extname(candidate).toLowerCase();
  const contentType = SESSION_MEDIA_MIME[ext];
  if (!contentType) throw mediaPathError(415, 'unsupported media type');
  return { file: fileReal, contentType };
}
