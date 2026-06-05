import assert from 'node:assert/strict';
import test from 'node:test';
import { importFresh, installDomStubs } from './helpers.mjs';

test('bootstrap failure shows recovery banner and skips SSE until retry succeeds', async () => {
  let fetchCount = 0;
  const sources = [];
  installDomStubs({
    fetchImpl: async (url) => {
      fetchCount++;
      if (String(url).startsWith('/sessions')) {
        return new Response(JSON.stringify({ sessions: [] }), { status: 200 });
      }
      if (String(url).startsWith('/tab/new')) {
        return new Response(JSON.stringify({ error: 'bridge unavailable' }), { status: 500 });
      }
      return new Response('{}', { status: 200 });
    },
  });
  globalThis.EventSource = class TestEventSource {
    constructor(url) {
      this.url = url;
      sources.push(this);
    }
    close() {}
  };
  globalThis.location = new URL('http://127.0.0.1/');
  globalThis.window.location = globalThis.location;
  globalThis.window.__GROK_WEB_TEST__ = true;

  const main = await importFresh('public/js/main.js');
  await main.bootstrapApp();

  assert.equal(sources.length, 0, 'SSE should not start without a tab session');
  const banner = document.getElementById('recovery-slot');
  assert.equal(banner.hidden, false);
  assert.match(banner.innerHTML, /Session setup failed/);
  assert.match(banner.innerHTML, /Could not start a session/);
  assert.match(document.getElementById('status').textContent, /session setup failed/);

  fetchCount = 0;
  globalThis.fetch = async (url) => {
    fetchCount++;
    if (String(url).startsWith('/sessions')) {
      return new Response(JSON.stringify({ sessions: [] }), { status: 200 });
    }
    if (String(url).startsWith('/tab/new')) {
      return new Response(JSON.stringify({ sessionId: 'new-session', cwd: 'C:\\proj' }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  };

  await main.retryBootstrap();

  assert.equal(sources.length, 1, 'retry should start SSE after session creation');
  assert.match(sources[0].url, /sessionId=new-session/);
  assert.equal(banner.hidden, true);
  assert.equal(document.getElementById('send').disabled, false);
  assert.match(document.getElementById('status').textContent, /ready/);
  assert.match(document.getElementById('crumb').textContent, /proj/);
});
