import { spawn } from 'node:child_process';
import {
  CLI_TIMEOUT_DEFAULT_MS,
  CWD,
  GROK_BIN,
  GROK_BIN_ARGS,
} from './config.mjs';
import { buildGrokEnv } from './grok-env.mjs';
import { errorMessage } from './util.mjs';

export function createCliRunner({ grokBin = GROK_BIN, grokBinArgs = GROK_BIN_ARGS, defaultCwd, buildEnv = buildGrokEnv } = {}) {
  const resolveCwd = typeof defaultCwd === 'function' ? defaultCwd : () => defaultCwd ?? CWD;
  return function runGrokCli(args, { timeout = CLI_TIMEOUT_DEFAULT_MS, cwd } = {}) {
    return new Promise((resolve) => {
      const child = spawn(grokBin, [...grokBinArgs, ...args], {
        cwd: cwd ?? resolveCwd(),
        env: buildEnv(),
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        try { child.kill(); } catch {}
      }, timeout);
      child.stdout.on('data', (c) => { stdout += c.toString(); });
      child.stderr.on('data', (c) => { stderr += c.toString(); });
      child.on('error', (e) => {
        clearTimeout(timer);
        resolve({ code: -1, stdout, stderr: stderr || errorMessage(e), timedOut });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({
          code: timedOut ? -1 : code,
          stdout,
          stderr: timedOut ? `${stderr}${stderr ? '\n' : ''}timed out after ${Math.round(timeout / 1000)}s` : stderr,
          timedOut,
        });
      });
    });
  };
}
