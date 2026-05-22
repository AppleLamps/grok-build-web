import assert from 'node:assert/strict';
import test from 'node:test';
import { importFresh, installDomStubs } from './helpers.mjs';

test('api listSessions includes tab session id and reports precise JSON failures', async () => {
  const calls = [];
  installDomStubs({
    storage: { 'grokweb.tabSessionId': 'tab-123' },
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (calls.length === 1) return new Response(JSON.stringify({ sessions: [] }), { status: 200 });
      if (calls.length === 2) return new Response('', { status: 401 });
      if (calls.length === 3) return new Response('', { status: 200 });
      return new Response('{', { status: 200 });
    },
  });

  const api = await importFresh('public/js/api.js');
  assert.deepEqual(await api.listSessions(), { sessions: [] });
  assert.equal(calls[0], '/sessions?sessionId=tab-123');

  await assert.rejects(() => api.listSessions(), /sessions request failed: 401/);
  await assert.rejects(() => api.listSessions(), /sessions returned empty response/);
  await assert.rejects(() => api.listSessions(), /sessions returned invalid JSON/);
});

test('api postRespawn surfaces server error bodies', async () => {
  installDomStubs({
    fetchImpl: async (url, opts) => {
      assert.equal(url, '/session/respawn');
      assert.equal(opts.method, 'POST');
      return new Response(JSON.stringify({ error: 'bad launch flag' }), { status: 500 });
    },
  });

  const api = await importFresh('public/js/api.js');
  await assert.rejects(() => api.postRespawn({ model: 'grok-build' }), /bad launch flag/);
});
