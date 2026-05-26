import { join } from 'node:path';
import { errorMessage, isWithinPath } from '../../util.mjs';
import { readBody, sendJson, sendJsonError, isRequestBodyTooLarge } from '../response.mjs';
import { UPLOAD_DIR_NAME } from './upload.mjs';

export function match(method, pathname) {
  return method === 'POST' && ['/prompt', '/cancel', '/permission', '/elicitation'].includes(pathname);
}

function sanitizeAttachments(raw, grok, sessionId) {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const cwd = grok.cwdForSession(sessionId);
  if (!cwd) return [];
  const root = join(cwd, UPLOAD_DIR_NAME);
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const path = typeof item.path === 'string' ? item.path : null;
    if (!path || !isWithinPath(root, path)) continue;
    const entry = { path };
    if (typeof item.filename === 'string') entry.filename = item.filename;
    if (typeof item.mediaUrl === 'string' && item.mediaUrl.startsWith('/upload-media?')) entry.mediaUrl = item.mediaUrl;
    if (typeof item.kind === 'string') entry.kind = item.kind;
    out.push(entry);
  }
  return out;
}

export async function handle(ctx) {
  const { req, res, url, requireApiAuth, grok, readBody: readReqBody = readBody, sendJson: sendJsonRes = sendJson, sendJsonError: sendJsonErr = sendJsonError } = ctx;
  const pathname = url.pathname;

  if (pathname === '/prompt') {
    if (!requireApiAuth(req, res)) return true;
    try {
      const body = JSON.parse(await readReqBody(req));
      const attachments = sanitizeAttachments(body.attachments, grok, grok.activeSessionId(body.sessionId));
      const hasText = typeof body.text === 'string' && body.text.trim();
      if (!hasText && attachments.length === 0) {
        sendJsonErr(res, 400, 'empty prompt'); return true;
      }
      const target = grok.activeSessionId(body.sessionId);
      const turn = grok.prompt(typeof body.text === 'string' ? body.text : '', target, { attachments });
      turn.promise.catch((e) =>
        grok.broadcast({ kind: 'error', error: errorMessage(e), sessionId: target })
      );
      sendJsonRes(res, 202, { ok: true, turnId: turn.turnId, queued: turn.queued });
    } catch (e) { sendJsonErr(res, 400, e); }
    return true;
  }

  if (pathname === '/cancel') {
    if (!requireApiAuth(req, res)) return true;
    let sessionId = null;
    if (req.headers['content-length'] && req.headers['content-length'] !== '0') {
      try { sessionId = JSON.parse(await readReqBody(req)).sessionId; }
      catch (e) {
        if (isRequestBodyTooLarge(e)) { sendJsonErr(res, 400, e); return true; }
      }
    }
    const cancelResult = grok.cancel(sessionId);
    sendJsonRes(res, 202, { ok: true, sessionId: grok.activeSessionId(sessionId), ...cancelResult });
    return true;
  }

  if (pathname === '/permission') {
    if (!requireApiAuth(req, res)) return true;
    try {
      const body = JSON.parse(await readReqBody(req));
      if (typeof body.rpcId !== 'number' || !body.optionId) {
        sendJsonErr(res, 400, 'rpcId + optionId required'); return true;
      }
      const ok = grok.respondToPermission(body.rpcId, body.optionId, body.sessionId ?? null);
      sendJsonRes(res, ok ? 200 : 410, { ok });
    } catch (e) { sendJsonErr(res, 400, e); }
    return true;
  }

  if (pathname === '/elicitation') {
    if (!requireApiAuth(req, res)) return true;
    try {
      const body = JSON.parse(await readReqBody(req));
      if (typeof body.rpcId !== 'number' || !body.action) {
        sendJsonErr(res, 400, 'rpcId + action required'); return true;
      }
      const ok = grok.respondToElicitation(body.rpcId, body.action, body.content, body.sessionId ?? null);
      if (!ok) {
        sendJsonErr(res, 404, 'elicitation request not found'); return true;
      }
      sendJsonRes(res, 200, { ok });
    } catch (e) { sendJsonErr(res, 400, e); }
    return true;
  }

  return false;
}
