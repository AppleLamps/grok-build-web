import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import {
  bootstrap,
  makeUrl,
  readEvents,
  seedSessions,
  startFakeServer,
  waitForEvent,
  withTempDir,
} from './helpers.mjs';

test('bridge handles auth, SSE, prompt events, cancel JSON, and capabilities', async () => {
  await withTempDir('grok-web-bridge-', async (temp) => {
    const sessionsRoot = join(temp, 'sessions');
    await seedSessions(sessionsRoot);
    const server = await startFakeServer({ sessionsRoot });
    try {
      const { base, cookie } = await bootstrap(server);

      const unauthorized = await fetch(makeUrl(base, '/sessions'));
      assert.equal(unauthorized.status, 401);
      assert.equal(unauthorized.headers.get('content-type'), 'application/json');
      assert.equal((await unauthorized.json()).error, 'missing or bad session');

      const home = await fetch(makeUrl(base, '/'), { headers: { cookie } });
      assert.equal(home.status, 200);
      assert.match(await home.text(), /grok web/);

      const events = [];
      const abort = new AbortController();
      const stream = readEvents(makeUrl(base, '/stream'), cookie, events, abort.signal).catch(() => {});
      await waitForEvent(events, e => e.kind === 'session_ready', 'session_ready');

      const sessions = await fetch(makeUrl(base, '/sessions'), { headers: { cookie } }).then(r => r.json());
      assert.equal(sessions.sessions.length, 2);
      assert.ok(sessions.sessions.some(s => s.numMessages === 0), 'empty session summary is returned for client filtering');

      const prompt = await fetch(makeUrl(base, '/prompt'), {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'run fake smoke' }),
      });
      assert.equal(prompt.status, 202);
      await waitForEvent(events, e => e.kind === 'turn_complete', 'turn_complete');
      assert.ok(events.some(e => e.kind === 'permission_auto_allowed'), 'permission request was handled');
      assert.ok(events.some(e => e.kind === 'elicitation_request'), 'elicitation request was surfaced');
      assert.ok(events.some(e => e.kind === 'meta' && e.method === 'fake/unknown_client_request'), 'unknown request was surfaced as meta');
      assert.ok(events.some(e => e.kind === 'update' && e.update?.title === 'x_search_posts'), 'x search update streamed');
      assert.ok(events.some(e => e.kind === 'update' && e.update?.title === 'imagine_video'), 'video update streamed');

      const cancel = await fetch(makeUrl(base, '/cancel'), {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      assert.equal(cancel.status, 202);
      assert.equal(cancel.headers.get('content-type'), 'application/json');
      assert.equal((await cancel.json()).ok, true);

      const opts = await fetch(makeUrl(base, '/spawn-opts'), { headers: { cookie } }).then(r => r.json());
      assert.equal(opts.alwaysApprove, true);
      assert.equal(opts._capabilities.noLeader, true);
      assert.equal(opts._capabilities.permissionMode, false);

      abort.abort();
      await stream;
      assert.doesNotMatch(server.stderr, /TypeError|SyntaxError/);
    } finally {
      await server.stop();
    }
  });
});
