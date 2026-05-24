import assert from 'node:assert/strict';
import test from 'node:test';
import { importFresh, installDomStubs } from './helpers.mjs';

test('main bootstrap creates one tab session when none is configured', async () => {
  const calls = [];
  installDomStubs({
    storage: {},
    fetchImpl: async (url, opts = {}) => {
      calls.push({ url: String(url), body: opts.body ? JSON.parse(opts.body) : null });
      if (String(url).startsWith('/sessions')) {
        return new Response(JSON.stringify({ sessions: [] }), { status: 200 });
      }
      if (String(url).startsWith('/tab/new')) {
        return new Response(JSON.stringify({ sessionId: 'new-session', cwd: 'C:\\proj' }), { status: 200 });
      }
      if (String(url).startsWith('/session/plan')) {
        return new Response(JSON.stringify({ sessionId: 'new-session', todos: [] }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    },
  });
  globalThis.location = new URL('http://127.0.0.1/');
  globalThis.window.location = globalThis.location;
  globalThis.window.__GROK_WEB_TEST__ = true;

  const main = await importFresh('public/js/main.js');
  await main.__testEnsureTabSession();

  const tabNewCalls = calls.filter(c => String(c.url).startsWith('/tab/new'));
  assert.equal(tabNewCalls.length, 1, 'only one tab session should be created');
  assert.deepEqual(tabNewCalls[0].body, {});
});
