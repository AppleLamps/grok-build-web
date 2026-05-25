import { readBody, sendJson, sendJsonError, isRequestBodyTooLarge } from '../response.mjs';

export function match(method, pathname) {
  return method === 'POST' && (pathname === '/tab/new' || pathname === '/tab/load');
}

export async function handle(ctx) {
  const { req, res, url, requireApiAuth, grok } = ctx;
  const pathname = url.pathname;

  if (pathname === '/tab/load') {
    if (!requireApiAuth(req, res)) return true;
    try {
      const body = JSON.parse(await readBody(req));
      if (!body.sessionId) { sendJsonError(res, 400, 'sessionId required'); return true; }
      const tab = await grok.loadTabSession(body.sessionId, body.cwd);
      sendJson(res, 200, tab);
    } catch (e) {
      if (isRequestBodyTooLarge(e)) { sendJsonError(res, 400, e); return true; }
      sendJsonError(res, 500, e);
    }
    return true;
  }

  if (pathname === '/tab/new') {
    if (!requireApiAuth(req, res)) return true;
    try {
      let cwd = null;
      let sessionId = null;
      if (req.headers['content-length'] && req.headers['content-length'] !== '0') {
        try {
          const body = JSON.parse(await readBody(req));
          cwd = body.cwd;
          sessionId = body.sessionId;
        }
        catch (e) {
          if (isRequestBodyTooLarge(e)) { sendJsonError(res, 400, e); return true; }
        }
      }
      const tab = await grok.createTabSession(cwd, sessionId);
      sendJson(res, 200, tab);
    } catch (e) {
      if (isRequestBodyTooLarge(e)) { sendJsonError(res, 400, e); return true; }
      sendJsonError(res, 500, e);
    }
    return true;
  }

  return false;
}
