import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const child = spawn(process.execPath, ['--test', 'test/live-grok.test.mjs'], {
  cwd: repoRoot,
  env: { ...process.env, GROK_WEB_LIVE_TESTS: '1' },
  stdio: 'inherit',
  windowsHide: true,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
