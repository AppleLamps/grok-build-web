import assert from 'node:assert/strict';
import test from 'node:test';
import { importFresh, installDomStubs } from './helpers.mjs';

test('SSE reconnect keeps only one pending reconnect timer', async () => {
  installDomStubs();
  const originalEventSource = globalThis.EventSource;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const sources = [];
  const timers = [];
  globalThis.EventSource = class TestEventSource {
    constructor(url) {
      this.url = url;
      this.closed = false;
      sources.push(this);
    }
    close() {
      this.closed = true;
    }
  };
  globalThis.setTimeout = (fn, ms) => {
    const timer = { fn, ms, cleared: false };
    timers.push(timer);
    return timer;
  };
  globalThis.clearTimeout = (timer) => {
    timer.cleared = true;
  };

  try {
    const sse = await importFresh('public/js/sse.js');
    sse.initSSE();
    assert.equal(sources.length, 1);
    assert.doesNotMatch(sources[0].url, /since=/);
    sources[0].onmessage({ data: '{"kind":"noop"}', lastEventId: '42' });
    assert.equal(sse.__testLastEventId(), '42');

    sources[0].onerror();
    sources[0].onerror();
    assert.equal(timers.length, 1);
    assert.equal(timers[0].cleared, false);

    sse.__testConnect();
    assert.equal(timers[0].cleared, true);
    assert.equal(sources[0].closed, true);
    assert.equal(sources.length, 2);

    sources[1].onerror();
    assert.equal(timers.length, 2);
    timers[1].fn();
    assert.equal(sources.length, 3);
    assert.match(sources[2].url, /since=42/);

    sse.reconnectSSE();
    assert.equal(sources[2].closed, true);
    assert.equal(sources.length, 4);
    assert.match(sources[3].url, /since=42/);
  } finally {
    globalThis.EventSource = originalEventSource;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});
