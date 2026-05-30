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
