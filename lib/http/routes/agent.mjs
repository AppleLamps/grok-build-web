import { errorMessage } from '../../util.mjs';
import { readBody, sendJson, sendJsonError, isRequestBodyTooLarge } from '../response.mjs';

export function match(method, pathname) {
  return method === 'POST' && ['/prompt', '/cancel', '/permission', '/elicitation'].includes(pathname);
}

export async function handle(ctx) {
  const { req, res, url, requireApiAuth, grok, readBody: readReqBody = readBody, sendJson: sendJsonRes = sendJson, sendJsonError: sendJsonErr = sendJsonError } = ctx;
  const pathname = url.pathname;

  if (pathname === '/prompt') {
    if (!requireApiAuth(req, res)) return true;
    try {
      const body = JSON.parse(await readReqBody(req));
      if (typeof body.text !== 'string' || !body.text.trim()) {
        sendJsonErr(res, 400, 'empty prompt'); return true;
      }
      const target = grok.activeSessionId(body.sessionId);
      const turn = grok.prompt(body.text, target);
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
