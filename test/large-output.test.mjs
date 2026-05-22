import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import {
  bootstrap,
  makeUrl,
  readEvents,
  startFakeServer,
  waitForEvent,
  withTempDir,
} from './helpers.mjs';

test('large output and malformed stdout do not crash the bridge', async () => {
  await withTempDir('grok-web-large-', async (temp) => {
    const server = await startFakeServer({ scenario: 'large', sessionsRoot: join(temp, 'sessions') });
    try {
      const { base, cookie } = await bootstrap(server);
      const events = [];
      const abort = new AbortController();
      const stream = readEvents(makeUrl(base, '/stream'), cookie, events, abort.signal).catch(() => {});
      await waitForEvent(events, e => e.kind === 'session_ready', 'session_ready');

      const prompt = await fetch(makeUrl(base, '/prompt'), {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'large output probe' }),
      });
      assert.equal(prompt.status, 202);

      const update = await waitForEvent(events, e =>
        e.kind === 'update' && e.update?.toolCallId === 'large-1',
      'large output update');
      assert.equal(update.update.rawOutput.truncated, true);
      assert.ok(update.update.rawOutput.output.length > 20000);
      assert.match(update.update.rawOutput.output_for_prompt, /^front/);
      assert.match(update.update.rawOutput.output_for_prompt, /back$/);
      await waitForEvent(events, e => e.kind === 'turn_complete', 'turn_complete');

      abort.abort();
      await stream;
      assert.doesNotMatch(server.stderr, /SyntaxError|TypeError/);
    } finally {
      await server.stop();
    }
  });
});
