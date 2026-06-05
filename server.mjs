#!/usr/bin/env node
// grok-web: HTTP+SSE bridge between a browser UI and `grok agent stdio` (ACP/JSON-RPC).
//
// Flow:
//   browser  ──POST /prompt──▶  bridge  ──stdin──▶  grok agent stdio (one child per tab session)
//   browser  ◀──SSE /stream──   bridge  ◀──stdout── grok agent stdio

import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { CWD, GRACEFUL_SHUTDOWN_TIMEOUT_MS, PORT, SESSION_COOKIE } from './lib/config.mjs';
import { defaultUsername } from './lib/util.mjs';
import { GrokBridge } from './lib/grok-bridge.mjs';
import { createCliRunner } from './lib/cli-runner.mjs';
import { ensureCurrentProjectTrusted } from './lib/project-trust.mjs';
import { createSecurity } from './lib/http/security.mjs';
import { createRouter } from './lib/http/router.mjs';
import { invalidateSessionsCache, watchSessionsRoot } from './lib/sessions-store.mjs';

const BOOTSTRAP_TOKEN = randomBytes(16).toString('hex');
const SESSION_TOKEN = randomBytes(32).toString('hex');

const bridgeSettings = {
  displayName: defaultUsername(),
};

const grok = new GrokBridge();
const runGrokCli = createCliRunner({
  defaultCwd: () => grok.cwd ?? CWD,
  defaultIgnoreApiKey: () => grok.spawnOpts.ignoreApiKey,
});

let server;
const security = createSecurity({
  sessionCookie: SESSION_COOKIE,
  sessionToken: SESSION_TOKEN,
  bootstrapToken: BOOTSTRAP_TOKEN,
  getServerPort: () => server?.address()?.port,
});

server = createServer(
  createRouter({
    grok,
    bridgeSettings,
    runGrokCli,
    ...security,
  }),
);

async function openBrowser(url) {
  const { spawn } = await import('node:child_process');
  if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  else if (process.platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
  else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
}

const stopSessionsWatcher = watchSessionsRoot(() => {
  invalidateSessionsCache();
  grok.broadcast({ kind: 'sessions_changed' });
});

(async () => {
  try {
    const trust = await ensureCurrentProjectTrusted(CWD);
    if (trust.changed) console.log(`[grok-web] trusted project for hooks: ${trust.entry}`);
    else if (trust.skipped) console.warn(`[grok-web] skipped project trust: ${trust.reason}`);
  } catch (e) {
    console.warn('[grok-web] failed to trust project for hooks:', e);
  }

  server.listen(PORT, '127.0.0.1', async () => {
    const port = server.address().port;
    const url = `http://127.0.0.1:${port}/?token=${BOOTSTRAP_TOKEN}`;
    console.log(`\n  grok-web running\n  ${url}\n  one-time local URL: do not share it\n  cwd: ${CWD}\n`);
    if (!process.env.GROK_WEB_NO_OPEN) await openBrowser(url);
  });
})();

let shuttingDown = false;
async function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    stopSessionsWatcher?.();
  } catch {}
  try {
    server?.close();
  } catch {}
  try {
    await grok.gracefulShutdown(GRACEFUL_SHUTDOWN_TIMEOUT_MS);
  } catch (e) {
    console.error('[grok-web] graceful shutdown error:', e);
  }
  try {
    server?.closeAllConnections?.();
  } catch {}
  process.exit(exitCode);
}

process.on('SIGINT', () => {
  shutdown(0);
});
process.on('SIGTERM', () => {
  shutdown(0);
});
process.on('uncaughtException', (e) => {
  console.error('[grok-web] uncaught exception:', e);
  shutdown(1);
});
process.on('unhandledRejection', (e) => {
  console.error('[grok-web] unhandled rejection:', e);
  shutdown(1);
});
