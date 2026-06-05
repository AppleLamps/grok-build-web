import assert from 'node:assert/strict';
import test from 'node:test';
import { request as httpRequest } from 'node:http';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  bootstrap,
  delay,
  makeUrl,
  readEvents,
  seedSessions,
  startFakeServer,
  waitForEvent,
  openTestTab,
  withTempDir,
} from './helpers.mjs';

test('bridge handles auth, SSE, prompt events, cancel JSON, and capabilities', async () => {
  await withTempDir('grok-web-bridge-', async (temp) => {
    const sessionsRoot = join(temp, 'sessions');
    await seedSessions(sessionsRoot);
    const server = await startFakeServer({
      sessionsRoot,
      env: { XAI_API_KEY: 'fake-xai-key', GROK_API_KEY: 'fake-grok-key' },
    });
    try {
      const { base, cookie } = await bootstrap(server);

      const unauthorized = await fetch(makeUrl(base, '/sessions'));
      assert.equal(unauthorized.status, 401);
      assert.equal(unauthorized.headers.get('content-type'), 'application/json');
      assert.equal((await unauthorized.json()).error, 'missing or bad session');

      const home = await fetch(makeUrl(base, '/'), { headers: { cookie } });
      assert.equal(home.status, 200);
      assert.match(await home.text(), /grok web/);

      const staticUnauthed = await fetch(makeUrl(base, '/static/js/api.js'));
      assert.equal(staticUnauthed.status, 401);

      const staticJs = await fetch(makeUrl(base, '/static/js/api.js'), { headers: { cookie } });
      assert.equal(staticJs.status, 200);
      assert.match(await staticJs.text(), /export async function listSessions/);
      for (const path of ['/static/%5c..%5cserver.mjs', '/static/..%5cserver.mjs', '/static/%2e%2e/server.mjs']) {
        const r = await fetch(makeUrl(base, path), { headers: { cookie } });
        const text = await r.text();
        assert.notEqual(r.status, 200, `${path} should not serve repo files`);
        assert.doesNotMatch(text, /grok-web: HTTP\+SSE bridge/);
      }

      const events = [];
      const abort = new AbortController();
      const stream = readEvents(makeUrl(base, '/stream'), cookie, events, abort.signal).catch(() => {});
      const tab = await openTestTab(base, cookie, events);

      const sessions = await fetch(makeUrl(base, '/sessions'), { headers: { cookie } }).then((r) => r.json());
      assert.equal(sessions.sessions.length, 2);
      assert.ok(
        sessions.sessions.some((s) => s.numMessages === 0),
        'empty session summary is returned for client filtering',
      );

      const prompt = await fetch(makeUrl(base, '/prompt'), {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'run fake smoke', sessionId: tab.sessionId }),
      });
      assert.equal(prompt.status, 202);
      await waitForEvent(events, (e) => e.kind === 'turn_complete', 'turn_complete');
      assert.ok(
        events.some((e) => e.kind === 'permission_auto_allowed'),
        'permission request was handled',
      );
      assert.ok(
        events.some((e) => e.kind === 'elicitation_request'),
        'elicitation request was surfaced',
      );
      assert.ok(
        events.some((e) => e.kind === 'meta' && e.method === 'fake/unknown_client_request'),
        'unknown request was surfaced as meta',
      );
      assert.ok(
        events.some((e) => e.kind === 'update' && e.update?.title === 'x_search_posts'),
        'x search update streamed',
      );
      assert.ok(
        events.some((e) => e.kind === 'update' && e.update?.title === 'imagine_video'),
        'video update streamed',
      );

      const cancel = await fetch(makeUrl(base, '/cancel'), {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: tab.sessionId }),
      });
      assert.equal(cancel.status, 202);
      assert.equal(cancel.headers.get('content-type'), 'application/json');
      assert.equal((await cancel.json()).ok, true);

      const opts = await fetch(makeUrl(base, '/spawn-opts'), { headers: { cookie } }).then((r) => r.json());
      assert.equal(opts.alwaysApprove, true);
      assert.equal(opts._capabilities.noLeader, true);
      assert.equal(opts._capabilities.permissionMode, true);
      assert.equal(opts._capabilities.todoGate, true);

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
        '--effort',
        'future-effort',
        '--best-of-n',
        '3',
        '--max-turns',
        '4',
        '--always-approve',
        '--output-format',
        'json',
        '-p',
        oneshotText,
      ]);
      assert.equal(fakeResult.prompt, oneshotText);
      assert.equal(fakeResult.XAI_API_KEY_set, false);
      assert.equal(fakeResult.GROK_API_KEY_set, false);

      const headlessText = 'resume this run';
      const headless = await fetch(makeUrl(base, '/cli/headless'), {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          text: headlessText,
          outputFormat: 'streaming-json',
          sessionMode: 'resume',
          resumeId: 'resume-session',
          cwd: temp,
          model: 'grok-4.3',
          effort: 'high',
          maxTurns: '2',
          alwaysApprove: false,
        }),
      });
      assert.equal(headless.status, 200);
      const headlessData = await headless.json();
      const headlessResult = JSON.parse(headlessData.stdout);
      assert.deepEqual(headlessData.args, [
        '--model',
        'grok-4.3',
        '--effort',
        'high',
        '--max-turns',
        '2',
        '--resume',
        'resume-session',
        '--output-format',
        'streaming-json',
        '-p',
        headlessText,
      ]);
      assert.deepEqual(headlessResult.args, headlessData.args);
      assert.equal(headlessResult.prompt, headlessText);
      assert.equal(headlessResult.cwd, temp);

      const apiKeyMode = await fetch(makeUrl(base, '/session/respawn'), {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ ignoreApiKey: false }),
      });
      assert.equal(apiKeyMode.status, 200);

      const apiKeyOneshot = await fetch(makeUrl(base, '/cli/oneshot'), {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'api key mode' }),
      });
      assert.equal(apiKeyOneshot.status, 200);
      const apiKeyResult = JSON.parse((await apiKeyOneshot.json()).stdout);
      assert.equal(apiKeyResult.XAI_API_KEY_set, true);
      assert.equal(apiKeyResult.GROK_API_KEY_set, true);

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
      const tab = await openTestTab(base, cookie, events);

      const prompt = await fetch(makeUrl(base, '/prompt'), {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'permission empty probe', sessionId: tab.sessionId }),
      });
      assert.equal(prompt.status, 202);
      await waitForEvent(events, (e) => e.kind === 'turn_complete', 'turn_complete');

      assert.ok(events.some((e) => e.kind === 'permission_auto_cancelled' && e.reason === 'no_options'));
      const probe = events.find((e) => e.kind === 'update' && e.update?.toolCallId === 'permission-empty');
      assert.equal(probe?.update?.rawOutput?.permissionOutcome?.outcome, 'cancelled');
      assert.equal(probe?.update?.rawOutput?.permissionOutcome?.optionId, undefined);

      abort.abort();
      await stream;
    } finally {
      await server.stop();
    }
  });
});

test('ask_user_question is surfaced as elicitation and replies with outcome', async () => {
  await withTempDir('grok-web-ask-question-', async (temp) => {
    const server = await startFakeServer({ scenario: 'ask-question', sessionsRoot: join(temp, 'sessions') });
    try {
      const { base, cookie } = await bootstrap(server);
      const events = [];
      const abort = new AbortController();
      const stream = readEvents(makeUrl(base, '/stream'), cookie, events, abort.signal).catch(() => {});
      const tab = await openTestTab(base, cookie, events);

      const prompt = await fetch(makeUrl(base, '/prompt'), {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'ask question probe', sessionId: tab.sessionId }),
      });
      assert.equal(prompt.status, 202);

      const request = await waitForEvent(
        events,
        (e) => e.kind === 'elicitation_request' && e.request?.mode === 'question',
        'question request',
      );
      assert.equal(request.request.questions[0].question, 'Which UI improvement should be prioritized?');

      const answer = await fetch(makeUrl(base, '/elicitation'), {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ rpcId: request.rpcId, action: 'accept', content: ['mobile'] }),
      });
      assert.equal(answer.status, 200);

      await waitForEvent(events, (e) => e.kind === 'turn_complete', 'turn_complete');
      const probe = events.find(
        (e) => e.kind === 'update' && e.update?.toolCallId === 'ask-question-1' && e.update?.status === 'completed',
      );
      assert.equal(probe?.update?.rawOutput?.questionOutcome?.outcome, 'accepted');
      assert.deepEqual(probe?.update?.rawOutput?.questionOutcome?.answers, ['mobile']);
      assert.equal(probe?.update?.rawOutput?.questionOutcome?.partial_answers, false);

      abort.abort();
      await stream;
    } finally {
      await server.stop();
    }
  });
});

test('ask_user_question timeout resolves with empty outcome', async () => {
  await withTempDir('grok-web-ask-question-timeout-', async (temp) => {
    const server = await startFakeServer({
      scenario: 'ask-question',
      sessionsRoot: join(temp, 'sessions'),
      env: { GROK_WEB_ELICITATION_TIMEOUT_MS: '20' },
    });
    try {
      const { base, cookie } = await bootstrap(server);
      const events = [];
      const abort = new AbortController();
      const stream = readEvents(makeUrl(base, '/stream'), cookie, events, abort.signal).catch(() => {});
      const tab = await openTestTab(base, cookie, events);

      const prompt = await fetch(makeUrl(base, '/prompt'), {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'ask question timeout probe', sessionId: tab.sessionId }),
      });
      assert.equal(prompt.status, 202);

      await waitForEvent(
        events,
        (e) => e.kind === 'elicitation_timeout' || e.kind === 'elicitation_resolved',
        'question timeout',
      );
      await waitForEvent(events, (e) => e.kind === 'turn_complete', 'turn_complete');
      const probe = events.find(
        (e) => e.kind === 'update' && e.update?.toolCallId === 'ask-question-1' && e.update?.status === 'completed',
      );
      assert.equal(probe?.update?.rawOutput?.questionOutcome?.outcome, 'cancelled');

      abort.abort();
      await stream;
    } finally {
      await server.stop();
    }
  });
});

test('unknown x.ai client requests return JSON-RPC errors and diagnostic meta', async () => {
  await withTempDir('grok-web-unknown-x-', async (temp) => {
    const server = await startFakeServer({ scenario: 'unknown-x-request', sessionsRoot: join(temp, 'sessions') });
    try {
      const { base, cookie } = await bootstrap(server);
      const events = [];
      const abort = new AbortController();
      const stream = readEvents(makeUrl(base, '/stream'), cookie, events, abort.signal).catch(() => {});
      const tab = await openTestTab(base, cookie, events);

      const prompt = await fetch(makeUrl(base, '/prompt'), {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'unknown x request probe', sessionId: tab.sessionId }),
      });
      assert.equal(prompt.status, 202);
      await waitForEvent(events, (e) => e.kind === 'turn_complete', 'turn_complete');

      assert.ok(events.some((e) => e.kind === 'meta' && e.method === '_x.ai/future_method' && e.unsupported === true));
      const probe = events.find((e) => e.kind === 'update' && e.update?.toolCallId === 'unknown-x-1');
      assert.equal(probe?.update?.rawOutput?.response?.error?.code, -32601);

      abort.abort();
      await stream;
    } finally {
      await server.stop();
    }
  });
});

test('security headers and local request guards are enforced', async () => {
  await withTempDir('grok-web-security-headers-', async (temp) => {
    const server = await startFakeServer({ sessionsRoot: join(temp, 'sessions') });
    try {
      const { base, cookie } = await bootstrap(server);

      const home = await fetch(makeUrl(base, '/'), { headers: { cookie } });
      assert.equal(home.status, 200);
      assertSecurityHeaders(home.headers);
      assert.match(home.headers.get('content-security-policy'), /frame-ancestors 'none'/);

      const staticJs = await fetch(makeUrl(base, '/static/js/api.js'), { headers: { cookie } });
      assert.equal(staticJs.status, 200);
      assertSecurityHeaders(staticJs.headers);

      const api = await fetch(makeUrl(base, '/sessions'), { headers: { cookie } });
      assert.equal(api.status, 200);
      assertSecurityHeaders(api.headers);

      const badHost = await rawHttpRequest(makeUrl(base, '/static/js/api.js'), {
        headers: { host: 'example.test' },
      });
      assert.equal(badHost.statusCode, 403);
      assert.equal(badHost.body, 'bad host');
      assert.equal(badHost.headers['x-frame-options'], 'DENY');

      const badOrigin = await fetch(makeUrl(base, '/cancel'), {
        method: 'POST',
        headers: {
          cookie,
          origin: 'https://example.test',
          'content-type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      assert.equal(badOrigin.status, 403);
      assert.equal(await badOrigin.text(), 'bad origin');

      const sameOrigin = await fetch(makeUrl(base, '/cancel'), {
        method: 'POST',
        headers: {
          cookie,
          origin: base.origin,
          'content-type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      assert.equal(sameOrigin.status, 202);
    } finally {
      await server.stop();
    }
  });
});

test('respawn clears stale permission timers before reused RPC IDs can resolve new requests', async () => {
  await withTempDir('grok-web-permission-respawn-', async (temp) => {
    const server = await startFakeServer({
      sessionsRoot: join(temp, 'sessions'),
      env: { GROK_WEB_PERMISSION_TIMEOUT_MS: '1800' },
    });
    try {
      const { base, cookie } = await bootstrap(server);
      const events = [];
      const abort = new AbortController();
      const stream = readEvents(makeUrl(base, '/stream'), cookie, events, abort.signal).catch(() => {});
      const tab = await openTestTab(base, cookie, events);

      const settings = await fetch(makeUrl(base, '/settings'), {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ autoApprove: false, sessionId: tab.sessionId }),
      });
      assert.equal(settings.status, 200);

      const firstPrompt = await fetch(makeUrl(base, '/prompt'), {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'park first permission', sessionId: tab.sessionId }),
      });
      assert.equal(firstPrompt.status, 202);
      await waitForEvent(
        events,
        (e) => e.kind === 'permission_request' && e.rpcId === 1000,
        'first permission_request',
      );

      await delay(700);
      const respawn = await fetch(makeUrl(base, '/session/respawn'), {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: tab.sessionId }),
      });
      assert.equal(respawn.status, 200);
      await waitForEvent(events, (e) => e.kind === 'agent_respawn' && e.sessionId === tab.sessionId, 'agent_respawn');
      await waitForEvent(
        events,
        (e) => e.kind === 'agent_ready' && e.sessionId === tab.sessionId,
        'respawned agent_ready',
      );

      const secondPrompt = await fetch(makeUrl(base, '/prompt'), {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'park second permission', sessionId: tab.sessionId }),
      });
      assert.equal(secondPrompt.status, 202);
      await waitForEvent(
        events,
        () => events.filter((e) => e.kind === 'permission_request' && e.rpcId === 1000).length === 2,
        'second permission_request with reused rpcId',
      );

      await delay(1300);
      assert.equal(
        events.some((e) => e.kind === 'permission_timeout' && e.rpcId === 1000),
        false,
      );

      const answer = await fetch(makeUrl(base, '/permission'), {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ rpcId: 1000, optionId: 'allow' }),
      });
      assert.equal(answer.status, 200);
      assert.deepEqual(await answer.json(), { ok: true });

      abort.abort();
      await stream;
    } finally {
      await server.stop();
    }
  });
});

test('tab session load is serialized with concurrent respawns', async () => {
  await withTempDir('grok-web-tab-load-respawn-', async (temp) => {
    const server = await startFakeServer({
      sessionsRoot: join(temp, 'sessions'),
      env: { FAKE_GROK_DELAY_SESSION_LOAD_MS: '300' },
    });
    try {
      const { base, cookie } = await bootstrap(server);
      const events = [];
      const abort = new AbortController();
      const stream = readEvents(makeUrl(base, '/stream'), cookie, events, abort.signal).catch(() => {});

      const load = fetch(makeUrl(base, '/tab/load'), {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: 'slow-loaded-session', cwd: temp }),
      });
      await delay(50);
      const respawn = fetch(makeUrl(base, '/session/respawn'), {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'grok-4.3' }),
      });

      const loadResponse = await load;
      assert.equal(loadResponse.status, 200);
      assert.equal((await loadResponse.json()).sessionId, 'slow-loaded-session');

      const respawnResponse = await respawn;
      assert.equal(respawnResponse.status, 200);
      assert.equal((await respawnResponse.json()).spawnOpts.model, 'grok-4.3');

      await waitForEvent(events, (e) => e.kind === 'agent_respawn', 'agent_respawn');
      const loadedIndex = events.findIndex(
        (e) => e.kind === 'session_ready' && e.sessionId === 'slow-loaded-session' && e.loaded,
      );
      const respawnIndex = events.findIndex((e) => e.kind === 'agent_respawn');
      assert.notEqual(loadedIndex, -1, 'tab load completed');
      assert.notEqual(respawnIndex, -1, 'respawn event was emitted');
      assert.ok(loadedIndex < respawnIndex, 'tab load finished before queued respawn');

      abort.abort();
      await stream;
    } finally {
      await server.stop();
    }
  });
});

test('tab prompts on different sessions run in parallel', async () => {
  await withTempDir('grok-web-prompt-queue-', async (temp) => {
    const server = await startFakeServer({
      scenario: 'quiet',
      sessionsRoot: join(temp, 'sessions'),
      env: { FAKE_GROK_DELAY_PROMPT_MS: '250' },
    });
    try {
      const { base, cookie } = await bootstrap(server);
      const events = [];
      const abort = new AbortController();
      const stream = readEvents(makeUrl(base, '/stream'), cookie, events, abort.signal).catch(() => {});

      const tabA = await postJson(base, cookie, '/tab/new', {});
      const tabB = await postJson(base, cookie, '/tab/new', {});
      await waitForEvent(events, (e) => e.kind === 'session_ready' && e.sessionId === tabA.sessionId, 'tab A ready');
      await waitForEvent(events, (e) => e.kind === 'session_ready' && e.sessionId === tabB.sessionId, 'tab B ready');

      const first = await postJson(base, cookie, '/prompt', { sessionId: tabA.sessionId, text: 'prompt A' }, 202);
      const second = await postJson(base, cookie, '/prompt', { sessionId: tabB.sessionId, text: 'prompt B' }, 202);
      assert.equal(first.queued, false);
      assert.equal(second.queued, false);
      assert.match(first.turnId, /^turn-/);
      assert.match(second.turnId, /^turn-/);

      const startedAt = Date.now();
      await Promise.all([
        waitForEvent(events, (e) => e.kind === 'turn_complete' && e.sessionId === tabA.sessionId, 'tab A complete'),
        waitForEvent(events, (e) => e.kind === 'turn_complete' && e.sessionId === tabB.sessionId, 'tab B complete'),
      ]);
      assert.ok(Date.now() - startedAt < 450, 'parallel prompts should finish faster than serial 500ms');

      const starts = events.filter(
        (e) => e.kind === 'meta' && e.method === '_x.ai/fake_prompt_probe' && e.params?.phase === 'start',
      );
      assert.deepEqual(starts.map((e) => e.sessionId).sort(), [tabA.sessionId, tabB.sessionId].sort());
      assert.equal(
        events.some((e) => e.kind === 'turn_queued' && e.sessionId === tabB.sessionId && e.turnId === second.turnId),
        false,
      );

      abort.abort();
      await stream;
    } finally {
      await server.stop();
    }
  });
});

test('cancel removes queued turns without sending them to the agent', async () => {
  await withTempDir('grok-web-prompt-cancel-', async (temp) => {
    const server = await startFakeServer({
      scenario: 'quiet',
      sessionsRoot: join(temp, 'sessions'),
      env: { FAKE_GROK_DELAY_PROMPT_MS: '350' },
    });
    try {
      const { base, cookie } = await bootstrap(server);
      const events = [];
      const abort = new AbortController();
      const stream = readEvents(makeUrl(base, '/stream'), cookie, events, abort.signal).catch(() => {});

      const tab = await postJson(base, cookie, '/tab/new', {});
      await waitForEvent(events, (e) => e.kind === 'session_ready' && e.sessionId === tab.sessionId, 'tab ready');

      await postJson(base, cookie, '/prompt', { sessionId: tab.sessionId, text: 'slow A' }, 202);
      const queued = await postJson(base, cookie, '/prompt', { sessionId: tab.sessionId, text: 'queued B' }, 202);
      assert.equal(queued.queued, true);

      const cancel = await postJson(base, cookie, '/cancel', { sessionId: tab.sessionId }, 202);
      assert.equal(cancel.queuedCancelled, 1);
      await waitForEvent(
        events,
        (e) => e.kind === 'turn_cancelled' && e.sessionId === tab.sessionId && e.turnId === queued.turnId,
        'queued turn cancelled',
      );
      await waitForEvent(events, (e) => e.kind === 'turn_complete' && e.sessionId === tab.sessionId, 'tab complete');
      await delay(500);

      const starts = events.filter(
        (e) => e.kind === 'meta' && e.method === '_x.ai/fake_prompt_probe' && e.params?.phase === 'start',
      );
      assert.deepEqual(
        starts.map((e) => e.sessionId),
        [tab.sessionId],
      );
      assert.equal(events.filter((e) => e.kind === 'turn_complete' && e.sessionId === tab.sessionId).length, 1);

      abort.abort();
      await stream;
    } finally {
      await server.stop();
    }
  });
});

test('auto-approve settings are scoped by tab session', async () => {
  await withTempDir('grok-web-session-approval-', async (temp) => {
    const server = await startFakeServer({ sessionsRoot: join(temp, 'sessions') });
    try {
      const { base, cookie } = await bootstrap(server);
      const events = [];
      const abort = new AbortController();
      const stream = readEvents(makeUrl(base, '/stream'), cookie, events, abort.signal).catch(() => {});

      const tabA = await postJson(base, cookie, '/tab/new', {});
      const tabB = await postJson(base, cookie, '/tab/new', {});
      await waitForEvent(events, (e) => e.kind === 'session_ready' && e.sessionId === tabA.sessionId, 'tab A ready');
      await waitForEvent(events, (e) => e.kind === 'session_ready' && e.sessionId === tabB.sessionId, 'tab B ready');

      const tabAManual = await postJson(base, cookie, '/settings', { sessionId: tabA.sessionId, autoApprove: false });
      const tabBAuto = await postJson(base, cookie, '/settings', { sessionId: tabB.sessionId, autoApprove: true });
      assert.equal(tabAManual.autoApprove, false);
      assert.equal(tabBAuto.autoApprove, true);

      const defaultSettings = await fetch(makeUrl(base, '/settings'), { headers: { cookie } }).then((r) => r.json());
      const settingsA = await fetch(makeUrl(base, `/settings?sessionId=${encodeURIComponent(tabA.sessionId)}`), {
        headers: { cookie },
      }).then((r) => r.json());
      const settingsB = await fetch(makeUrl(base, `/settings?sessionId=${encodeURIComponent(tabB.sessionId)}`), {
        headers: { cookie },
      }).then((r) => r.json());
      assert.equal(defaultSettings.autoApprove, true);
      assert.equal(settingsA.autoApprove, false);
      assert.equal(settingsB.autoApprove, true);

      await postJson(base, cookie, '/prompt', { sessionId: tabA.sessionId, text: 'manual approval A' }, 202);
      await waitForEvent(
        events,
        (e) => e.kind === 'permission_request' && e.sessionId === tabA.sessionId,
        'tab A manual permission',
      );
      await postJson(base, cookie, '/prompt', { sessionId: tabB.sessionId, text: 'auto approval B' }, 202);
      await waitForEvent(
        events,
        (e) => e.kind === 'permission_auto_allowed' && e.sessionId === tabB.sessionId,
        'tab B auto permission',
      );

      assert.equal(
        events.some((e) => e.kind === 'permission_auto_allowed' && e.sessionId === tabA.sessionId),
        false,
      );
      assert.equal(
        events.some((e) => e.kind === 'permission_request' && e.sessionId === tabB.sessionId),
        false,
      );

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
      await assertJsonError(base, cookie, '/elicitation', { rpcId: 404, action: 'accept' }, 404, /not found/);
      await assertJsonError(base, cookie, '/session/load', {}, 400, /sessionId required/);
      await assertJsonError(base, cookie, '/cli/oneshot', { text: 'x', bestOfN: 0 }, 400, /positive integer/);
      await assertJsonError(base, cookie, '/cli/headless', { text: 'x', outputFormat: 'xml' }, 400, /bad outputFormat/);
      await assertJsonError(base, cookie, '/cli/headless', { text: 'x', sessionMode: 'session' }, 400, /sessionId required/);

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
      const tab = await openTestTab(base, cookie);
      const tooLarge = await fetch(makeUrl(base, '/prompt'), {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'x'.repeat(200), sessionId: tab.sessionId }),
      });
      assert.equal(tooLarge.status, 400);
      assert.equal(tooLarge.headers.get('content-type'), 'application/json');
      assert.match((await tooLarge.json()).error, /request body exceeds 80 byte limit/);

      const small = await fetch(makeUrl(base, '/prompt'), {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'small', sessionId: tab.sessionId }),
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
      const tab = await openTestTab(base, cookie);
      const accepted = await fetch(makeUrl(base, '/prompt'), {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'x'.repeat(200), sessionId: tab.sessionId }),
      });
      assert.equal(accepted.status, 202);
    } finally {
      await disabled.stop();
    }
  });
});

test('session plan serves authenticated persisted todos under sessions root', async () => {
  await withTempDir('grok-web-session-plan-', async (temp) => {
    const sessionsRoot = join(temp, 'sessions');
    const sessionDir = join(sessionsRoot, 'cwd', 'session-id');
    const malformedDir = join(sessionsRoot, 'cwd', 'malformed-session');
    const symlinkDir = join(sessionsRoot, 'cwd', 'symlink-session');
    await mkdir(sessionDir, { recursive: true });
    await mkdir(malformedDir, { recursive: true });
    await mkdir(symlinkDir, { recursive: true });
    await writeFile(
      join(sessionDir, 'plan.json'),
      JSON.stringify({
        tasks: [
          { id: '1', content: 'Draft persisted plan', status: 'in_progress' },
          { id: '2', title: 'Verify hydration', state: 'pending' },
        ],
      }),
      'utf8',
    );
    await writeFile(join(malformedDir, 'plan.json'), '{', 'utf8');
    await writeFile(join(temp, 'outside-plan.json'), JSON.stringify([{ text: 'outside' }]), 'utf8');
    let symlinkCreated = false;
    try {
      await symlink(join(temp, 'outside-plan.json'), join(symlinkDir, 'plan.json'));
      symlinkCreated = true;
    } catch {
      symlinkCreated = false;
    }

    const server = await startFakeServer({ sessionsRoot });
    try {
      const { base, cookie } = await bootstrap(server);
      const planUrl = (sessionId) => makeUrl(base, `/session/plan?sessionId=${encodeURIComponent(sessionId)}`);

      const unauth = await fetch(planUrl('session-id'));
      assert.equal(unauth.status, 401);

      const ok = await fetch(planUrl('session-id'), { headers: { cookie } });
      assert.equal(ok.status, 200);
      assert.deepEqual(await ok.json(), {
        sessionId: 'session-id',
        todos: [
          { id: '1', text: 'Draft persisted plan', status: 'in_progress' },
          { id: '2', text: 'Verify hydration', status: 'pending' },
        ],
      });

      const missing = await fetch(planUrl('missing-plan'), { headers: { cookie } });
      assert.equal(missing.status, 200);
      assert.deepEqual(await missing.json(), { sessionId: 'missing-plan', todos: [] });

      const malformed = await fetch(planUrl('malformed-session'), { headers: { cookie } });
      assert.equal(malformed.status, 200);
      assert.deepEqual(await malformed.json(), { sessionId: 'malformed-session', todos: [] });

      const traversal = await fetch(makeUrl(base, '/session/plan?sessionId=..%2Foutside'), { headers: { cookie } });
      assert.equal(traversal.status, 403);

      if (symlinkCreated) {
        const escaped = await fetch(planUrl('symlink-session'), { headers: { cookie } });
        assert.equal(escaped.status, 403);
      }
    } finally {
      await server.stop();
    }
  });
});

test('session-media serves only authenticated files under sessions root', async () => {
  await withTempDir('grok-web-session-media-', async (temp) => {
    const sessionsRoot = join(temp, 'sessions');
    const mediaDir = join(sessionsRoot, 'cwd', 'session-id', 'images');
    await mkdir(mediaDir, { recursive: true });
    await writeFile(join(mediaDir, '1.jpg'), 'fake image bytes');
    await writeFile(join(mediaDir, 'note.txt'), 'not media');
    await mkdir(join(mediaDir, 'folder.jpg'));
    await writeFile(join(temp, 'outside.jpg'), 'outside');
    let symlinkCreated = false;
    try {
      await symlink(join(temp, 'outside.jpg'), join(mediaDir, 'escape.jpg'));
      symlinkCreated = true;
    } catch {
      symlinkCreated = false;
    }

    const server = await startFakeServer({ sessionsRoot });
    try {
      const { base, cookie } = await bootstrap(server);
      const mediaUrl = (path) => makeUrl(base, `/session-media?path=${encodeURIComponent(path)}`);

      const unauth = await fetch(mediaUrl('cwd/session-id/images/1.jpg'));
      assert.equal(unauth.status, 401);

      const ok = await fetch(mediaUrl('cwd/session-id/images/1.jpg'), { headers: { cookie } });
      assert.equal(ok.status, 200);
      assert.equal(ok.headers.get('content-type'), 'image/jpeg');
      assert.equal(await ok.text(), 'fake image bytes');

      const dotGrok = await fetch(mediaUrl('.grok/sessions/cwd/session-id/images/1.jpg'), { headers: { cookie } });
      assert.equal(dotGrok.status, 200);

      const traversal = await fetch(mediaUrl('../outside.jpg'), { headers: { cookie } });
      assert.equal(traversal.status, 403);

      const unsupported = await fetch(mediaUrl('cwd/session-id/images/note.txt'), { headers: { cookie } });
      assert.equal(unsupported.status, 415);

      const directory = await fetch(mediaUrl('cwd/session-id/images/folder.jpg'), { headers: { cookie } });
      assert.equal(directory.status, 403);

      const missing = await fetch(mediaUrl('cwd/session-id/images/missing.jpg'), { headers: { cookie } });
      assert.equal(missing.status, 404);

      if (symlinkCreated) {
        const escaped = await fetch(mediaUrl('cwd/session-id/images/escape.jpg'), { headers: { cookie } });
        assert.equal(escaped.status, 403);
      }
    } finally {
      await server.stop();
    }
  });
});

test('cli worktree receives Windows HOME fallback when parent HOME is empty', async () => {
  await withTempDir('grok-web-worktree-home-', async (temp) => {
    const server = await startFakeServer({
      sessionsRoot: join(temp, 'sessions'),
      env: { HOME: '', USERPROFILE: temp, GROK_HOME: '' },
    });
    try {
      const { base, cookie } = await bootstrap(server);
      const response = await fetch(makeUrl(base, '/cli/worktree'), { headers: { cookie } });
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.doesNotMatch(text, /neither \$GROK_HOME nor \$HOME is set/);
      if (process.platform === 'win32') assert.match(text, new RegExp(`HOME=${escapeRegExp(temp)}`));
      assert.match(text, /main/);
    } finally {
      await server.stop();
    }
  });
});

test('cli login status reports cached auth without exposing local secrets', async () => {
  await withTempDir('grok-web-login-status-', async (temp) => {
    const grokHome = join(temp, 'grok-home');
    const server = await startFakeServer({
      sessionsRoot: join(temp, 'sessions'),
      env: { GROK_HOME: grokHome, HOME: join(temp, 'home') },
    });
    try {
      const { base, cookie } = await bootstrap(server);

      const login = await fetch(makeUrl(base, '/cli/login'), { method: 'POST', headers: { cookie } });
      assert.equal(login.status, 200);
      assert.match(await login.text(), /TEST-CODE/);

      const missing = await fetch(makeUrl(base, '/cli/login/status'), { headers: { cookie } });
      assert.equal(missing.status, 200);
      assert.deepEqual(await missing.json(), {
        authenticated: false,
        credential: '~/.grok/auth.json',
        updatedAt: null,
      });

      await mkdir(grokHome, { recursive: true });
      await writeFile(join(grokHome, 'auth.json'), '{"refreshToken":"secret-test-token"}', 'utf8');

      const present = await fetch(makeUrl(base, '/cli/login/status'), { headers: { cookie } });
      assert.equal(present.status, 200);
      const body = await present.json();
      assert.equal(body.authenticated, true);
      assert.equal(body.credential, '~/.grok/auth.json');
      assert.match(body.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
      assert.doesNotMatch(JSON.stringify(body), /secret-test-token/);
      assert.doesNotMatch(JSON.stringify(body), new RegExp(escapeRegExp(temp)));
    } finally {
      await server.stop();
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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function postJson(base, cookie, path, body, expectedStatus = 200) {
  const response = await fetch(makeUrl(base, path), {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, expectedStatus);
  return response.json();
}

function assertSecurityHeaders(headers) {
  assert.equal(headers.get('x-frame-options'), 'DENY');
  assert.equal(headers.get('x-content-type-options'), 'nosniff');
  assert.equal(headers.get('referrer-policy'), 'no-referrer');
  const csp = headers.get('content-security-policy');
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'none'/);
}

function rawHttpRequest(url, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
