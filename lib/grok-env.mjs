import { join } from 'node:path';
import { homedir } from 'node:os';

export function ensureGrokHomeEnv(env = process.env) {
  if (process.platform === 'win32' && !String(env.HOME ?? '').trim()) {
    env.HOME = env.USERPROFILE || homedir();
  }
  if (process.platform === 'win32' && !String(env.GROK_HOME ?? '').trim() && String(env.HOME ?? '').trim()) {
    env.GROK_HOME = join(env.HOME, '.grok');
  }
  return env;
}

export function buildGrokEnv({ ignoreApiKey = false } = {}) {
  const env = ensureGrokHomeEnv({ ...process.env });
  if (ignoreApiKey) {
    delete env.XAI_API_KEY;
    delete env.GROK_API_KEY;
  }
  return env;
}

function resolveGrokHome(env = process.env) {
  const resolved = ensureGrokHomeEnv({ ...env });
  const grokHome = String(resolved.GROK_HOME ?? '').trim();
  if (grokHome) return grokHome;
  const home = String(resolved.HOME ?? '').trim() || homedir();
  return join(home, '.grok');
}

export function resolveGrokAuthFile(env = process.env) {
  return join(resolveGrokHome(env), 'auth.json');
}
