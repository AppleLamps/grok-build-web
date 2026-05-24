import assert from 'node:assert/strict';
import test from 'node:test';
import { importFresh, installDomStubs } from './helpers.mjs';

test('main bootstrap adopts explicit session URLs and loads cwd metadata', async () => {
  const calls = [];
  const { storage } = installDomStubs({
    fetchImpl: async (url, opts = {}) => {
      calls.push({ url: String(url), body: opts.body ? JSON.parse(opts.body) : null });
      if (String(url).startsWith('/sessions')) {
        return new Response(JSON.stringify({
          sessions: [{ id: 'session-2', cwd: 'C:\\Users\\lucas\\project' }],
        }), { status: 200 });
      }
      if (String(url) === '/tab/load') return new Response(JSON.stringify({ sessionId: 'session-2' }), { status: 200 });
      if (String(url).startsWith('/session/plan')) {
        return new Response(JSON.stringify({
          sessionId: 'session-2',
          todos: [{ id: '1', text: 'Hydrated task', status: 'in_progress' }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ sessionId: 'new-session' }), { status: 200 });
    },
  });
  globalThis.location = new URL('http://127.0.0.1/?session=session-2');
  globalThis.window.location = globalThis.location;
  globalThis.window.__GROK_WEB_TEST__ = true;

  const main = await importFresh('public/js/main.js');
  await main.__testEnsureTabSession();

  assert.equal(calls[0].url, '/sessions?sessionId=session-2');
  assert.deepEqual(calls[1], {
    url: '/tab/load',
    body: { sessionId: 'session-2', cwd: 'C:\\Users\\lucas\\project' },
  });
  assert.equal(calls[2].url, '/session/plan?sessionId=session-2&cwd=C%3A%5CUsers%5Clucas%5Cproject');
  assert.equal(storage['grokweb.tabSessionId'], 'session-2');
  assert.match(document.getElementById('todo-list').innerHTML, /Hydrated task/);
});
