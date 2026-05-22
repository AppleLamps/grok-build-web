import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  bootstrap,
  makeUrl,
  readEvents,
  startFakeServer,
  waitForEvent,
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
      await waitForEvent(events, e => e.kind === 'session_ready', 'initial session_ready');

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

async function postJson(base, cookie, path, body, expectedStatus = 200) {
  const r = await fetch(makeUrl(base, path), {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal(r.status, expectedStatus);
  return r.json();
}
