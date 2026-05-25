import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = join(__dirname, '..');
export const PUBLIC_DIR = join(REPO_ROOT, 'public');

export const GROK_BIN = process.env.GROK_BIN ?? 'grok';
export const GROK_BIN_ARGS = (() => {
  const raw = process.env.GROK_BIN_ARGS;
  if (!raw) return [];
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (e) {
    throw new Error(`GROK_BIN_ARGS must be a JSON array of strings (got: ${raw}): ${e.message}`);
  }
  if (!Array.isArray(parsed) || !parsed.every((v) => typeof v === 'string')) {
    throw new Error(`GROK_BIN_ARGS must be a JSON array of strings (got: ${raw})`);
  }
  return parsed;
})();
export const PORT = Number(process.env.PORT ?? 0);
export const CWD = process.env.GROK_CWD ?? process.cwd();

export const SESSION_COOKIE = 'grok_web';
export const SESSION_COOKIE_MAX_AGE_SECONDS = 12 * 60 * 60;

export const HISTORY_LIMIT = 10000;
export const SESSIONS_CACHE_TTL_MS = Number(process.env.GROK_WEB_SESSIONS_CACHE_TTL_MS ?? 2000);
export const MAX_REQUEST_BODY_BYTES = Number(process.env.GROK_WEB_MAX_REQUEST_BODY_BYTES ?? 64 * 1024 * 1024);

export const AGENT_HELP_TIMEOUT_MS = 3000;
export const DEFAULT_RPC_TIMEOUT_MS = Number(process.env.GROK_WEB_RPC_TIMEOUT_MS ?? 2 * 60 * 1000);
export const PROMPT_RPC_TIMEOUT_MS = Number(process.env.GROK_WEB_PROMPT_TIMEOUT_MS ?? 30 * 60 * 1000);
export const CHILD_KILL_GRACE_MS = 500;
export const PERMISSION_REQUEST_TIMEOUT_MS = Number(process.env.GROK_WEB_PERMISSION_TIMEOUT_MS ?? 5 * 60 * 1000);
export const ELICITATION_TIMEOUT_MS = Number(process.env.GROK_WEB_ELICITATION_TIMEOUT_MS ?? 5 * 60 * 1000);

export const MAX_ACTIVE_AGENTS = Number(process.env.GROK_WEB_MAX_ACTIVE_AGENTS ?? 4);
export const AGENT_IDLE_MS = Number(process.env.GROK_WEB_AGENT_IDLE_MS ?? 30 * 60 * 1000);
export const AGENT_IDLE_SWEEP_MS = Number(process.env.GROK_WEB_AGENT_IDLE_SWEEP_MS ?? 60 * 1000);

export const CLI_TIMEOUT_DEFAULT_MS = 30000;
export const CLI_TIMEOUT_SHORT_MS = 10000;
export const CLI_TIMEOUT_UPDATE_CHECK_MS = 15000;
export const CLI_TIMEOUT_TRACE_MS = 60000;
export const CLI_TIMEOUT_ONESHOT_MS = 300000;
export const CLI_TIMEOUT_IMPORT_MS = 120000;

export const SESSIONS_ROOT = process.env.GROK_WEB_SESSIONS_ROOT
  ? resolve(process.env.GROK_WEB_SESSIONS_ROOT)
  : join(homedir(), '.grok', 'sessions');

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};
