import { spawn } from 'node:child_process';

export function forceKillCommand(pid, platform = process.platform) {
  if (!pid || platform !== 'win32') return null;
  return { command: 'taskkill', args: ['/PID', String(pid), '/T', '/F'] };
}

export async function terminateChildProcess(
  child,
  { graceMs = 500, platform = process.platform, spawnImpl = spawn } = {},
) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    child.kill();
  } catch {}
  if (await waitForExit(child, graceMs)) return;

  const force = forceKillCommand(child.pid, platform);
  if (force) {
    await runForceKill(force, spawnImpl);
  } else {
    try {
      child.kill('SIGKILL');
    } catch {}
  }
  await waitForExit(child, 1000);
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(
      () => {
        cleanup();
        resolve(false);
      },
      Math.max(0, timeoutMs),
    );
    const onExit = () => {
      cleanup();
      resolve(true);
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.off?.('exit', onExit);
    };
    child.once?.('exit', onExit);
  });
}

function runForceKill(force, spawnImpl) {
  return new Promise((resolve) => {
    const killer = spawnImpl(force.command, force.args, {
      stdio: 'ignore',
      windowsHide: true,
    });
    killer.on?.('error', resolve);
    killer.on?.('close', resolve);
  });
}
