import assert from 'node:assert/strict';
import test from 'node:test';
import { importFresh, importPublic, installDomStubs } from './helpers.mjs';

async function flushAsync() {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
}

test('agent_respawn reconnects SSE without reloading the page', async () => {
  const sources = [];
  let reloadCalled = false;
  let resolveTabNew;
  installDomStubs({
    fetchImpl: async (url) => {
      if (String(url).startsWith('/tab/new')) {
        return new Promise((resolve) => {
          resolveTabNew = () =>
            resolve(new Response(JSON.stringify({ sessionId: 'tab-after-respawn', cwd: 'C:\\proj' }), { status: 200 }));
        });
      }
      return new Response('{}', { status: 200 });
    },
  });
  globalThis.location = new URL('http://127.0.0.1/?session=tab-before-respawn');
  globalThis.window.location = globalThis.location;
  globalThis.EventSource = class TestEventSource {
    constructor(url) {
      this.url = url;
      sources.push(this);
    }
    close() {}
  };
  globalThis.location.reload = () => { reloadCalled = true; };

  const sse = await importFresh('public/js/sse.js');
  sse.initSSE();
  assert.equal(sources.length, 1);

  const dispatchMod = await importFresh('public/js/dispatch.js');
  const stateMod = await importPublic('public/js/state.js');
  dispatchMod.dispatch({ kind: 'agent_respawn' });
  await flushAsync();

  assert.equal(stateMod.TAB_SESSION_ID, 'tab-before-respawn');
  assert.equal(sources.length, 1);

  resolveTabNew();
  await flushAsync();

  assert.equal(reloadCalled, false);
  assert.equal(sources.length, 2);
  assert.match(sources[1].url, /sessionId=tab-after-respawn/);
});
