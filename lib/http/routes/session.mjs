import { agentCapabilities } from '../../agent-help.mjs';
import { validateSpawnOptsPatch } from '../../spawn-opts.mjs';
import { listSessions, readSessionPlan } from '../../sessions-store.mjs';
import { defaultUsername } from '../../util.mjs';
import { readBody, sendJson, sendJsonError, isRequestBodyTooLarge } from '../response.mjs';

const SESSION_PATHS = new Set([
  '/sessions',
  '/session/plan',
  '/session/new',
  '/session/load',
  '/session/respawn',
  '/settings',
  '/identity',
  '/spawn-opts',
]);

export function match(method, pathname) {
  if (pathname === '/settings') return method === 'GET' || method === 'POST';
  if (SESSION_PATHS.has(pathname)) return method === 'GET' || method === 'POST';
  return false;
}

export async function handle(ctx) {
  const { req, res, url, requireApiAuth, grok, bridgeSettings } = ctx;
  const pathname = url.pathname;

  if (pathname === '/settings') {
    if (!requireApiAuth(req, res)) return true;
    if (req.method === 'GET') {
      const sessionId = url.searchParams.get('sessionId') || null;
      sendJson(res, 200, { autoApprove: grok.autoApproveFor(sessionId), ...bridgeSettings });
      return true;
    }
    if (req.method === 'POST') {
      try {
        const body = JSON.parse(await readBody(req));
        const sessionId = body.sessionId ?? null;
        if (typeof body.autoApprove === 'boolean') grok.setAutoApprove(body.autoApprove, sessionId);
        if (typeof body.displayName === 'string') {
          const displayName = body.displayName.trim();
          bridgeSettings.displayName = displayName || defaultUsername();
        }
        sendJson(res, 200, { autoApprove: grok.autoApproveFor(sessionId), ...bridgeSettings });
      } catch (e) { sendJsonError(res, 400, e); }
      return true;
    }
  }

  if (req.method === 'GET' && pathname === '/sessions') {
    if (!requireApiAuth(req, res)) return true;
    try {
      const sessions = await listSessions();
      const current = url.searchParams.get('sessionId') || grok.activeSessionId();
      sendJson(res, 200, { sessions, current });
    } catch (e) {
      if (isRequestBodyTooLarge(e)) { sendJsonError(res, 400, e); return true; }
      sendJsonError(res, e?.status ?? 500, e);
    }
    return true;
  }

  if (req.method === 'GET' && pathname === '/session/plan') {
    if (!requireApiAuth(req, res)) return true;
    try {
      const sessionId = url.searchParams.get('sessionId');
      const cwd = url.searchParams.get('cwd');
      sendJson(res, 200, await readSessionPlan(sessionId, cwd));
    } catch (e) {
      sendJsonError(res, e?.status ?? 500, e);
    }
    return true;
  }

  if (req.method === 'POST' && pathname === '/session/new') {
    if (!requireApiAuth(req, res)) return true;
    try {
      const body = req.headers['content-length'] && req.headers['content-length'] !== '0'
        ? JSON.parse(await readBody(req)) : {};
      await grok.newSession(body.cwd);
      sendJson(res, 200, { sessionId: grok.sessionId, cwd: grok.cwd });
    } catch (e) {
      if (isRequestBodyTooLarge(e)) { sendJsonError(res, 400, e); return true; }
      sendJsonError(res, e?.status ?? 500, e);
    }
    return true;
  }

  if (req.method === 'POST' && pathname === '/session/load') {
    if (!requireApiAuth(req, res)) return true;
    try {
      const body = JSON.parse(await readBody(req));
      if (!body.sessionId) { sendJsonError(res, 400, 'sessionId required'); return true; }
      await grok.loadSession(body.sessionId, body.cwd, { restoreCode: !!body.restoreCode });
      sendJson(res, 200, { sessionId: grok.sessionId, cwd: grok.cwd });
    } catch (e) {
      if (isRequestBodyTooLarge(e)) { sendJsonError(res, 400, e); return true; }
      sendJsonError(res, e?.status ?? 500, e);
    }
    return true;
  }

  if (req.method === 'POST' && pathname === '/session/respawn') {
    if (!requireApiAuth(req, res)) return true;
    try {
      const body = req.headers['content-length'] && req.headers['content-length'] !== '0'
        ? JSON.parse(await readBody(req)) : {};
      validateSpawnOptsPatch(body);
      await grok.respawn(body);
      sendJson(res, 200, { sessionId: grok.sessionId, spawnOpts: grok.spawnOpts });
    } catch (e) {
      if (isRequestBodyTooLarge(e)) { sendJsonError(res, 400, e); return true; }
      sendJsonError(res, e?.status ?? 500, e);
    }
    return true;
  }

  if (req.method === 'GET' && pathname === '/spawn-opts') {
    if (!requireApiAuth(req, res)) return true;
    sendJson(res, 200, {
      ...grok.spawnOpts,
      _capabilities: agentCapabilities(),
      _env: {
        XAI_API_KEY_set: !!process.env.XAI_API_KEY,
        GROK_OTEL_ENABLED_set: !!process.env.GROK_OTEL_ENABLED,
        OTEL_EXPORTER_OTLP_ENDPOINT_set: !!process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT_set: !!process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
        OTEL_EXPORTER_OTLP_METRICS_ENDPOINT_set: !!process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT,
        OTEL_SERVICE_NAME_set: !!process.env.OTEL_SERVICE_NAME,
      },
    });
    return true;
  }

  if (req.method === 'GET' && pathname === '/identity') {
    if (!requireApiAuth(req, res)) return true;
    const username = defaultUsername();
    sendJson(res, 200, {
      username,
      displayName: bridgeSettings.displayName || username,
    });
    return true;
  }

  return false;
}
