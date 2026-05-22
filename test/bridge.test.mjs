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

      const staticJs = await fetch(makeUrl(base, '/static/js/api.js'));
      assert.equal(staticJs.status, 200);
      assert.match(await staticJs.text(), /export async function listSessions/);
      for (const path of ['/static/%5c..%5cserver.mjs', '/static/..%5cserver.mjs', '/static/%2e%2e/server.mjs']) {
        const r = await fetch(makeUrl(base, path));
        const text = await r.text();
        assert.notEqual(r.status, 200, `${path} should not serve repo files`);
        assert.doesNotMatch(text, /grok-web: HTTP\+SSE bridge/);
      }

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

      const oneshotText = 'line 1\n--not-a-flag\n<script>x</script>';
      const oneshot = await fetch(makeUrl(base, '/cli/oneshot'), {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ effort: 'future-effort', bestOfN: 3, maxTurns: '4', text: oneshotText }),
      });
      assert.equal(oneshot.status, 200);
      const oneshotData = await oneshot.json();
      const fakeResult = JSON.parse(oneshotData.stdout);
      assert.deepEqual(fakeResult.args, [
        '--effort', 'future-effort',
        '--best-of-n', '3',
        '--max-turns', '4',
        '--always-approve',
        '--output-format', 'json',
        '-p', oneshotText,
      ]);
      assert.equal(fakeResult.prompt, oneshotText);

      for (const body of [{ bestOfN: 0 }, { bestOfN: 1.2 }, { bestOfN: true }, { maxTurns: 'abc' }]) {
        const bad = await fetch(makeUrl(base, '/cli/oneshot'), {
          method: 'POST',
          headers: { cookie, 'content-type': 'application/json' },
          body: JSON.stringify({ text: 'x', ...body }),
        });
        assert.equal(bad.status, 400);
        assert.match((await bad.json()).error, /positive integer/);
      }

      abort.abort();
      await stream;
      assert.doesNotMatch(server.stderr, /TypeError|SyntaxError/);
      assert.match(server.stdout, /one-time local URL: do not share it/);
    } finally {
      await server.stop();
    }
  });
});

test('auto-approve cancels permission requests that have no options', async () => {
  await withTempDir('grok-web-permission-empty-', async (temp) => {
    const server = await startFakeServer({ scenario: 'permission-empty', sessionsRoot: join(temp, 'sessions') });
    try {
      const { base, cookie } = await bootstrap(server);
      const events = [];
      const abort = new AbortController();
      const stream = readEvents(makeUrl(base, '/stream'), cookie, events, abort.signal).catch(() => {});
      await waitForEvent(events, e => e.kind === 'session_ready', 'session_ready');

      const prompt = await fetch(makeUrl(base, '/prompt'), {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'permission empty probe' }),
      });
      assert.equal(prompt.status, 202);
      await waitForEvent(events, e => e.kind === 'turn_complete', 'turn_complete');

      assert.ok(events.some(e => e.kind === 'permission_auto_cancelled' && e.reason === 'no_options'));
      const probe = events.find(e => e.kind === 'update' && e.update?.toolCallId === 'permission-empty');
      assert.equal(probe?.update?.rawOutput?.permissionOutcome?.outcome, 'cancelled');
      assert.equal(probe?.update?.rawOutput?.permissionOutcome?.optionId, undefined);

      abort.abort();
      await stream;
    } finally {
      await server.stop();
    }
  });
});

test('API bad requests return JSON error bodies', async () => {
  await withTempDir('grok-web-json-errors-', async (temp) => {
    const server = await startFakeServer({ sessionsRoot: join(temp, 'sessions') });
    try {
      const { base, cookie } = await bootstrap(server);

      await assertJsonError(base, cookie, '/prompt', { text: '' }, 400, /empty prompt/);
      await assertJsonError(base, cookie, '/permission', {}, 400, /rpcId \+ optionId required/);
      await assertJsonError(base, cookie, '/elicitation', {}, 400, /rpcId \+ action required/);
      await assertJsonError(base, cookie, '/session/load', {}, 400, /sessionId required/);
      await assertJsonError(base, cookie, '/cli/oneshot', { text: 'x', bestOfN: 0 }, 400, /positive integer/);

      const unauthorized = await fetch(makeUrl(base, '/prompt'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'x' }),
      });
      assert.equal(unauthorized.status, 401);
      assert.equal(unauthorized.headers.get('content-type'), 'application/json');
      assert.match((await unauthorized.json()).error, /missing or bad session/);
    } finally {
      await server.stop();
    }
  });
});

test('request body limit rejects oversized JSON and can be disabled', async () => {
  await withTempDir('grok-web-body-limit-', async (temp) => {
    const limited = await startFakeServer({
      sessionsRoot: join(temp, 'limited-sessions'),
      env: { GROK_WEB_MAX_REQUEST_BODY_BYTES: '80' },
    });
    try {
      const { base, cookie } = await bootstrap(limited);
      const tooLarge = await fetch(makeUrl(base, '/prompt'), {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'x'.repeat(200) }),
      });
      assert.equal(tooLarge.status, 400);
      assert.equal(tooLarge.headers.get('content-type'), 'application/json');
      assert.match((await tooLarge.json()).error, /request body exceeds 80 byte limit/);

      const small = await fetch(makeUrl(base, '/prompt'), {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'small' }),
      });
      assert.equal(small.status, 202);
    } finally {
      await limited.stop();
    }

    const disabled = await startFakeServer({
      sessionsRoot: join(temp, 'disabled-sessions'),
      env: { GROK_WEB_MAX_REQUEST_BODY_BYTES: '0' },
    });
    try {
      const { base, cookie } = await bootstrap(disabled);
      const accepted = await fetch(makeUrl(base, '/prompt'), {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'x'.repeat(200) }),
      });
      assert.equal(accepted.status, 202);
    } finally {
      await disabled.stop();
    }
  });
});

async function assertJsonError(base, cookie, path, body, status, pattern) {
  const response = await fetch(makeUrl(base, path), {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, status);
  assert.equal(response.headers.get('content-type'), 'application/json');
  assert.match((await response.json()).error, pattern);
}
