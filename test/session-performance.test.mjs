import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  bootstrap,
  delay,
  makeUrl,
  readEvents,
  seedSessions,
  startFakeServer,
  waitForEvent,
  withTempDir,
} from './helpers.mjs';

test('sessions endpoint caches summaries briefly and refreshes after TTL', async () => {
  await withTempDir('grok-web-session-cache-', async (temp) => {
    const sessionsRoot = join(temp, 'sessions');
    await seedSessions(sessionsRoot);
    const server = await startFakeServer({
      sessionsRoot,
      env: { GROK_WEB_SESSIONS_CACHE_TTL_MS: '200' },
    });
    try {
      const { base, cookie } = await bootstrap(server);
      const first = await getJson(base, cookie, '/sessions');
      assert.equal(first.sessions.find((s) => s.id === 'active-session')?.title, 'Active session');

      await writeFile(
        join(sessionsRoot, 'cwd', 'active', 'summary.json'),
        JSON.stringify({
          info: { id: 'active-session', cwd: 'C:\\Users\\apple\\project' },
          generated_title: 'Updated session',
          last_active_at: '2026-05-22T01:01:00Z',
          num_chat_messages: 7,
        }),
        'utf8',
      );
      await mkdir(join(sessionsRoot, 'cwd', 'bad'), { recursive: true });
      await writeFile(join(sessionsRoot, 'cwd', 'bad', 'summary.json'), '{', 'utf8');

      const cached = await getJson(base, cookie, '/sessions');
      assert.equal(cached.sessions.find((s) => s.id === 'active-session')?.title, 'Active session');

      await delay(250);
      const refreshed = await getJson(base, cookie, '/sessions');
      const updated = refreshed.sessions.find((s) => s.id === 'active-session');
      assert.equal(updated?.title, 'Updated session');
      assert.equal(updated?.numMessages, 7);
      assert.equal(
        refreshed.sessions.some((s) => s.id === 'bad'),
        false,
      );
    } finally {
      await server.stop();
    }
  });
});

test('SSE replay is cursor-based and explicit full replay remains filtered', async () => {
  await withTempDir('grok-web-sse-replay-', async (temp) => {
    const server = await startFakeServer({ sessionsRoot: join(temp, 'sessions') });
    try {
      const { base, cookie } = await bootstrap(server);
      const liveEvents = [];
      const liveAbort = new AbortController();
      const liveStream = readEvents(makeUrl(base, '/stream'), cookie, liveEvents, liveAbort.signal).catch(() => {});

      const tabA = await postJson(base, cookie, '/tab/new', {});
      const tabB = await postJson(base, cookie, '/tab/new', {});
      await waitForEvent(
        liveEvents,
        (e) => e.kind === 'session_ready' && e.sessionId === tabA.sessionId,
        'tab A ready',
      );
      await waitForEvent(
        liveEvents,
        (e) => e.kind === 'session_ready' && e.sessionId === tabB.sessionId,
        'tab B ready',
      );

      await postJson(base, cookie, '/prompt', { sessionId: tabA.sessionId, text: 'prompt A' }, 202);
      await waitForEvent(
        liveEvents,
        (e) => e.kind === 'turn_complete' && e.sessionId === tabA.sessionId,
        'tab A complete',
      );
      await postJson(base, cookie, '/prompt', { sessionId: tabB.sessionId, text: 'prompt B' }, 202);
      await waitForEvent(
        liveEvents,
        (e) => e.kind === 'turn_complete' && e.sessionId === tabB.sessionId,
        'tab B complete',
      );

      liveAbort.abort();
      await liveStream;

      const noReplayA = await collectForDuration(
        base,
        cookie,
        `/stream?sessionId=${encodeURIComponent(tabA.sessionId)}`,
        100,
      );
      assert.equal(
        noReplayA.some((e) => e.kind === 'user_prompt' && e.sessionId === tabA.sessionId && e.text === 'prompt A'),
        false,
      );
      assert.equal(
        noReplayA.some((e) => e.kind === 'turn_complete' && e.sessionId === tabA.sessionId),
        false,
      );

      const cursorReplayA = await collectReplay(
        base,
        cookie,
        `/stream?sessionId=${encodeURIComponent(tabA.sessionId)}&since=0`,
        (e) => e.kind === 'turn_complete' && e.sessionId === tabA.sessionId,
      );
      assert.ok(
        cursorReplayA.some((e) => e.kind === 'user_prompt' && e.sessionId === tabA.sessionId && e.text === 'prompt A'),
      );
      assert.equal(
        cursorReplayA.some((e) => e.sessionId === tabB.sessionId),
        false,
      );

      const replayA = await collectReplay(
        base,
        cookie,
        `/stream?sessionId=${encodeURIComponent(tabA.sessionId)}&replay=all`,
        (e) => e.kind === 'turn_complete' && e.sessionId === tabA.sessionId,
      );
      assert.ok(
        replayA.some((e) => e.kind === 'user_prompt' && e.sessionId === tabA.sessionId && e.text === 'prompt A'),
      );
      assert.equal(
        replayA.some((e) => e.sessionId === tabB.sessionId),
        false,
      );

      const replayAll = await collectReplay(
        base,
        cookie,
        '/stream?replay=all',
        (e) => e.kind === 'turn_complete' && e.sessionId === tabB.sessionId,
      );
      assert.ok(replayAll.some((e) => e.kind === 'turn_complete' && e.sessionId === tabA.sessionId));
      assert.ok(replayAll.some((e) => e.kind === 'turn_complete' && e.sessionId === tabB.sessionId));

      await postJson(base, cookie, '/session/load', { sessionId: tabA.sessionId, cwd: tabA.cwd });
      const replayAfterClear = await collectReplay(
        base,
        cookie,
        `/stream?sessionId=${encodeURIComponent(tabA.sessionId)}&replay=all`,
        (e) => e.kind === 'session_replaced' && e.sessionId === tabA.sessionId,
      );
      assert.equal(
        replayAfterClear.some((e) => e.kind === 'user_prompt' && e.text === 'prompt A'),
        false,
      );
      assert.equal(
        replayAfterClear.some((e) => e.kind === 'turn_complete' && e.sessionId === tabA.sessionId),
        false,
      );
      assert.ok(replayAfterClear.some((e) => e.kind === 'session_replaced' && e.sessionId === tabA.sessionId));
    } finally {
      await server.stop();
    }
  });
});

test('sessions watcher polling invalidates cache when fs.watch is disabled', async () => {
  await withTempDir('grok-web-session-poll-watch-', async (temp) => {
    const sessionsRoot = join(temp, 'sessions');
    await seedSessions(sessionsRoot);
    const server = await startFakeServer({
      sessionsRoot,
      env: {
        GROK_WEB_DISABLE_FS_WATCH: '1',
        GROK_WEB_SESSIONS_CACHE_TTL_MS: '60000',
        GROK_WEB_SESSIONS_WATCH_DEBOUNCE_MS: '10',
        GROK_WEB_SESSIONS_WATCH_POLL_MS: '50',
      },
    });
    try {
      const { base, cookie } = await bootstrap(server);
      const events = [];
      const abort = new AbortController();
      const stream = readEvents(makeUrl(base, '/stream'), cookie, events, abort.signal).catch(() => {});
      const first = await getJson(base, cookie, '/sessions');
      assert.equal(first.sessions.find((s) => s.id === 'active-session')?.title, 'Active session');

      await delay(100);
      await writeFile(
        join(sessionsRoot, 'cwd', 'active', 'summary.json'),
        JSON.stringify({
          info: { id: 'active-session', cwd: 'C:\\Users\\apple\\project' },
          generated_title: 'Polled session update',
          last_active_at: '2026-05-22T01:02:00Z',
          num_chat_messages: 8,
        }),
        'utf8',
      );

      await waitForEvent(events, (e) => e.kind === 'sessions_changed', 'sessions_changed from poll watcher');
      const refreshed = await getJson(base, cookie, '/sessions');
      assert.equal(refreshed.sessions.find((s) => s.id === 'active-session')?.title, 'Polled session update');

      abort.abort();
      await stream;
    } finally {
      await server.stop();
    }
  });
});

async function getJson(base, cookie, path) {
  const r = await fetch(makeUrl(base, path), { headers: { cookie } });
  assert.equal(r.status, 200);
  return r.json();
}

async function postJson(base, cookie, path, body, expectedStatus = 200) {
  const r = await fetch(makeUrl(base, path), {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal(r.status, expectedStatus);
  return r.json();
}

async function collectReplay(base, cookie, path, predicate) {
  const events = [];
  const abort = new AbortController();
  const stream = readEvents(makeUrl(base, path), cookie, events, abort.signal).catch(() => {});
  await waitForEvent(events, predicate, `replay ${path}`);
  await delay(50);
  abort.abort();
  await stream;
  return events;
}

async function collectForDuration(base, cookie, path, ms) {
  const events = [];
  const abort = new AbortController();
  const stream = readEvents(makeUrl(base, path), cookie, events, abort.signal).catch(() => {});
  await delay(ms);
  abort.abort();
  await stream;
  return events;
}
