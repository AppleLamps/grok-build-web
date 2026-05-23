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

test('api postTabNew includes current tab session id for cwd inheritance', async () => {
  const calls = [];
  installDomStubs({
    storage: { 'grokweb.tabSessionId': 'tab-123' },
    fetchImpl: async (url, opts) => {
      calls.push({ url: String(url), body: JSON.parse(opts.body) });
      return new Response(JSON.stringify({ sessionId: 'tab-new', cwd: 'C:\\Users\\lucas\\project' }), { status: 200 });
    },
  });

  const api = await importFresh('public/js/api.js');
  await api.postTabNew();
  await api.postTabNew('C:\\Users\\lucas\\other');

  assert.deepEqual(calls, [
    { url: '/tab/new', body: { sessionId: 'tab-123' } },
    { url: '/tab/new', body: { sessionId: 'tab-123', cwd: 'C:\\Users\\lucas\\other' } },
  ]);
});

test('api getSettings includes current tab session id', async () => {
  const calls = [];
  installDomStubs({
    storage: { 'grokweb.tabSessionId': 'tab-123' },
    fetchImpl: async (url) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ autoApprove: false }), { status: 200 });
    },
  });

  const api = await importFresh('public/js/api.js');
  assert.deepEqual(await api.getSettings(), { autoApprove: false });
  assert.deepEqual(calls, ['/settings?sessionId=tab-123']);
});
