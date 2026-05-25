import { SESSION_COOKIE_MAX_AGE_SECONDS } from '../config.mjs';
import { sendJsonError } from './response.mjs';

export const SECURITY_HEADERS = {
  'content-security-policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "media-src 'self' data: blob: https:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; '),
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

export const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function parseCookies(header = '') {
  const cookies = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function parseHostHeader(host) {
  if (!host) return null;
  try {
    const parsed = new URL(`http://${String(host).trim()}`);
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return { hostname, port: parsed.port };
  } catch {
    return null;
  }
}

export function createSecurity({ sessionCookie, sessionToken, bootstrapToken, getServerPort }) {
  let bootstrapUsed = false;

  function auth(req) {
    return parseCookies(req.headers.cookie)[sessionCookie] === sessionToken;
  }

  function setSecurityHeaders(res) {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
  }

  function isAllowedHost(req) {
    const host = parseHostHeader(req.headers.host);
    if (!host) return false;
    if (!['127.0.0.1', 'localhost', '::1'].includes(host.hostname)) return false;
    const activePort = getServerPort();
    if (activePort && host.port && host.port !== String(activePort)) return false;
    return true;
  }

  function isAllowedOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return true;
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      return false;
    }
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (!['127.0.0.1', 'localhost', '::1'].includes(hostname)) return false;
    const activePort = getServerPort();
    if (activePort && parsed.port !== String(activePort)) return false;
    return true;
  }

  function redirectWithoutToken(res, url, headers = {}) {
    url.searchParams.delete('token');
    const location = url.pathname + url.search;
    res.writeHead(302, {
      ...headers,
      location,
      'cache-control': 'no-store',
    });
    res.end();
  }

  function bootstrap(req, res, url) {
    if (bootstrapUsed || url.searchParams.get('token') !== bootstrapToken) return false;
    bootstrapUsed = true;
    redirectWithoutToken(res, url, {
      'set-cookie': `${sessionCookie}=${encodeURIComponent(sessionToken)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_COOKIE_MAX_AGE_SECONDS}`,
    });
    return true;
  }

  function requireApiAuth(req, res) {
    if (auth(req)) return true;
    sendJsonError(res, 401, 'missing or bad session');
    return false;
  }

  return {
    auth,
    bootstrap,
    redirectWithoutToken,
    setSecurityHeaders,
    isAllowedHost,
    isAllowedOrigin,
    requireApiAuth,
  };
}
