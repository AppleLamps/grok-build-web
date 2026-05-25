import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { bootstrap, makeUrl, startFakeServer, withTempDir } from './helpers.mjs';

async function postJson(base, cookie, path, body) {
  const r = await fetch(makeUrl(base, path), {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  assert.equal(r.status, 200, `${path} failed: ${text}`);
  return JSON.parse(text);
}

test('tab load retries with bridge cwd when the original session cwd is missing', async () => {
  await withTempDir('grok-web-missing-cwd-', async (temp) => {
    const deletedCwd = join(temp, 'deleted');
    const server = await startFakeServer({ scenario: 'missing-cwd', cwd: temp });
    try {
      const { base, cookie } = await bootstrap(server);
      const tab = await postJson(base, cookie, '/tab/load', {
        sessionId: 'saved-session',
        cwd: deletedCwd,
      });
      assert.equal(tab.sessionId, 'saved-session');
      assert.equal(tab.cwd, temp);
    } finally {
      await server.stop();
    }
  });
});
