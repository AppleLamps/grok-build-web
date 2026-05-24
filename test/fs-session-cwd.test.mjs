import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  bootstrap,
  makeUrl,
  readEvents,
  startFakeServer,
  waitForEvent,
  waitForAgentReady,
  withTempDir,
} from './helpers.mjs';

test('client fs requests resolve against the cwd for their sessionId', async () => {
  await withTempDir('grok-web-fs-', async (temp) => {
    const rootA = join(temp, 'a');
    const rootB = join(temp, 'b');
    const sessionsRoot = join(temp, 'sessions');
    await mkdir(rootA, { recursive: true });
    await mkdir(rootB, { recursive: true });
    await writeFile(join(rootA, 'note.txt'), 'alpha', 'utf8');
    await writeFile(join(rootB, 'note.txt'), 'beta', 'utf8');

    const server = await startFakeServer({ scenario: 'fs', sessionsRoot });
    try {
      const { base, cookie } = await bootstrap(server);
      const events = [];
      const abort = new AbortController();
      const stream = readEvents(makeUrl(base, '/stream'), cookie, events, abort.signal).catch(() => {});
      await waitForAgentReady(events, 'agent_ready');

      const tabA = await postJson(base, cookie, '/tab/new', { cwd: rootA });
      const tabB = await postJson(base, cookie, '/tab/new', { cwd: rootB });

      await postJson(base, cookie, '/prompt', { sessionId: tabA.sessionId, text: 'fs probe A' }, 202);
      const updateA = await waitForEvent(events, e =>
        e.kind === 'update' &&
        e.sessionId === tabA.sessionId &&
        e.update?.title === 'fs_session_cwd_probe',
      'fs update A');

      await postJson(base, cookie, '/prompt', { sessionId: tabB.sessionId, text: 'fs probe B' }, 202);
      const updateB = await waitForEvent(events, e =>
        e.kind === 'update' &&
        e.sessionId === tabB.sessionId &&
        e.update?.title === 'fs_session_cwd_probe',
      'fs update B');

      assert.equal(updateA.update.rawOutput.readContent, 'alpha');
      assert.equal(updateB.update.rawOutput.readContent, 'beta');
      assert.equal(updateA.update.rawOutput.writeOk, true);
      assert.equal(updateB.update.rawOutput.writeOk, true);
      assert.match(updateA.update.rawOutput.outsideError, /path outside session cwd/);
      assert.match(updateB.update.rawOutput.outsideError, /path outside session cwd/);
      assert.equal(await readFile(join(rootA, 'written.txt'), 'utf8'), 'written from fake grok');
      assert.equal(await readFile(join(rootB, 'written.txt'), 'utf8'), 'written from fake grok');

      abort.abort();
      await stream;
    } finally {
      await server.stop();
    }
  });
});

test('tab new without explicit cwd inherits from the current tab session only', async () => {
  await withTempDir('grok-web-tab-cwd-', async (temp) => {
    const rootA = join(temp, 'a');
    const rootB = join(temp, 'b');
    const sessionsRoot = join(temp, 'sessions');
    await mkdir(rootA, { recursive: true });
    await mkdir(rootB, { recursive: true });

    const server = await startFakeServer({ scenario: 'fs', sessionsRoot });
    try {
      const { base, cookie } = await bootstrap(server);

      const tabA = await postJson(base, cookie, '/tab/new', { cwd: rootA });
      const tabB = await postJson(base, cookie, '/tab/new', { cwd: rootB });
      const tabAChild = await postJson(base, cookie, '/tab/new', { sessionId: tabA.sessionId });

      assert.equal(tabA.cwd, rootA);
      assert.equal(tabB.cwd, rootB);
      assert.equal(tabAChild.cwd, rootA);
    } finally {
      await server.stop();
    }
  });
});

test('tab load without explicit cwd reuses the loaded session cwd', async () => {
  await withTempDir('grok-web-tab-load-cwd-', async (temp) => {
    const rootA = join(temp, 'a');
    const rootB = join(temp, 'b');
    const sessionsRoot = join(temp, 'sessions');
    await mkdir(rootA, { recursive: true });
    await mkdir(rootB, { recursive: true });

    const server = await startFakeServer({ scenario: 'fs', sessionsRoot });
    try {
      const { base, cookie } = await bootstrap(server);

      const tabA = await postJson(base, cookie, '/tab/new', { cwd: rootA });
      await postJson(base, cookie, '/tab/new', { cwd: rootB });
      const loadedA = await postJson(base, cookie, '/tab/load', { sessionId: tabA.sessionId });

      assert.equal(loadedA.cwd, rootA);
    } finally {
      await server.stop();
    }
  });
});

test('client fs requests reject symlink or junction escapes from session cwd', async (t) => {
  await withTempDir('grok-web-fs-link-', async (temp) => {
    const root = join(temp, 'root');
    const outside = join(temp, 'outside');
    const sessionsRoot = join(temp, 'sessions');
    await mkdir(root, { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, 'secret.txt'), 'outside secret', 'utf8');
    try {
      await symlink(outside, join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch (e) {
      t.skip(`symlink/junction unavailable: ${e.message}`);
      return;
    }

    const server = await startFakeServer({ scenario: 'fs-symlink', sessionsRoot });
    try {
      const { base, cookie } = await bootstrap(server);
      const events = [];
      const abort = new AbortController();
      const stream = readEvents(makeUrl(base, '/stream'), cookie, events, abort.signal).catch(() => {});
      await waitForAgentReady(events, 'agent_ready');

      const tab = await postJson(base, cookie, '/tab/new', { cwd: root });
      await postJson(base, cookie, '/prompt', { sessionId: tab.sessionId, text: 'fs symlink probe' }, 202);
      const update = await waitForEvent(events, e =>
        e.kind === 'update' &&
        e.sessionId === tab.sessionId &&
        e.update?.title === 'fs_symlink_probe',
      'fs symlink update');

      assert.match(update.update.rawOutput.readError, /path outside session cwd/);
      assert.match(update.update.rawOutput.writeError, /path outside session cwd/);
      await assert.rejects(() => readFile(join(outside, 'written.txt'), 'utf8'));

      abort.abort();
      await stream;
    } finally {
      await server.stop();
    }
  });
});

async function postJson(base, cookie, path, body, expectedStatus = 200) {
  const r = await fetch(makeUrl(base, path), {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal(r.status, expectedStatus);
  return r.json();
}
