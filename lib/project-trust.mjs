import { spawn } from 'node:child_process';
import { appendFile, mkdir, readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { CWD } from './config.mjs';
import { ensureGrokHomeEnv } from './grok-env.mjs';

function runGitRoot(cwd) {
  return new Promise((resolve) => {
    const child = spawn('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], {
      windowsHide: true,
    });
    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.on('error', () => resolve(null));
    child.on('close', (code) => {
      resolve(code === 0 ? stdout.trim() || null : null);
    });
  });
}

function grokTrustPath(canonicalPath) {
  if (process.platform !== 'win32') return canonicalPath;
  if (canonicalPath.startsWith('\\\\?\\')) return canonicalPath.replace(/[\\/]+$/, '');
  return `\\\\?\\${canonicalPath.replace(/[\\/]+$/, '')}`;
}

async function readTrustFile(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (e) {
    if (e?.code === 'ENOENT') return '';
    throw e;
  }
}

export async function ensureCurrentProjectTrusted(cwd = CWD) {
  const env = ensureGrokHomeEnv();
  const grokHome = env.GROK_HOME || (env.HOME ? join(env.HOME, '.grok') : null);
  if (!grokHome) return { changed: false, skipped: true, reason: 'missing Grok home' };

  const projectRoot = (await runGitRoot(cwd)) || cwd;
  const canonicalRoot = await realpath(projectRoot);
  const entry = grokTrustPath(canonicalRoot);
  const trustFile = join(grokHome, 'trusted-hook-projects');

  await mkdir(grokHome, { recursive: true });
  const content = await readTrustFile(trustFile);
  const trusted = content.split(/\r?\n/).some((line) => line.trim() === entry);
  if (trusted) return { changed: false, entry, trustFile };

  const prefix = content.length && !content.endsWith('\n') ? '\n' : '';
  await appendFile(trustFile, `${prefix}${entry}\n`, 'utf8');
  return { changed: true, entry, trustFile };
}
