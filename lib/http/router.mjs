import { MUTATING_METHODS } from './security.mjs';
import * as staticRoutes from './routes/static.mjs';
import * as streamRoutes from './routes/stream.mjs';
import * as agentRoutes from './routes/agent.mjs';
import * as tabRoutes from './routes/tab.mjs';
import * as sessionRoutes from './routes/session.mjs';
import * as cliRoutes from './routes/cli.mjs';

const ROUTES = [
  staticRoutes,
  streamRoutes,
  agentRoutes,
  tabRoutes,
  sessionRoutes,
  cliRoutes,
];

export function createRouter(deps) {
  const ctx = { ...deps };

  return async function router(req, res) {
    const url = new URL(req.url, 'http://localhost');
    ctx.req = req;
    ctx.res = res;
    ctx.url = url;

    deps.setSecurityHeaders(res);
    if (!deps.isAllowedHost(req)) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }).end('bad host');
      return;
    }
    if (MUTATING_METHODS.has(req.method) && !deps.isAllowedOrigin(req)) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }).end('bad origin');
      return;
    }

    for (const route of ROUTES) {
      if (!route.match(req.method, url.pathname)) continue;
      const handled = await route.handle(ctx);
      if (handled) return;
    }

    res.writeHead(404).end('not found');
  };
}
