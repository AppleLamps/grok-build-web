import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  bootstrap,
  makeUrl,
  openTestTab,
  readEvents,
  startFakeServer,
  waitForEvent,
  withTempDir,
} from './helpers.mjs';

const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

test('upload route stores files in session cwd and serves them back via /upload-media', async () => {
  await withTempDir('grok-web-upload-', async (cwd) => {
    const server = await startFakeServer({ cwd });
    try {
      const { base, cookie } = await bootstrap(server);
      const events = [];
      const abort = new AbortController();
      readEvents(makeUrl(base, '/stream'), cookie, events, abort.signal).catch(() => {});
      const tab = await openTestTab(base, cookie, events);

      const goodPng = await fetch(makeUrl(base, '/upload'), {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: tab.sessionId, filename: 'hello.png', dataBase64: TINY_PNG_B64 }),
      });
      assert.equal(goodPng.status, 200);
      const goodData = await goodPng.json();
      assert.equal(goodData.ok, true);
      assert.match(goodData.path, /\.grok-web-uploads/);
      assert.match(goodData.path, /hello\.png$/);
      assert.match(goodData.mediaUrl, /^\/upload-media\?sessionId=/);
      const onDisk = await readFile(goodData.path);
      assert.equal(onDisk.length, Buffer.from(TINY_PNG_B64, 'base64').length);

      const exeReject = await fetch(makeUrl(base, '/upload'), {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: tab.sessionId, filename: 'evil.exe', dataBase64: TINY_PNG_B64 }),
      });
      assert.equal(exeReject.status, 415);

      const empty = await fetch(makeUrl(base, '/upload'), {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: tab.sessionId, filename: 'empty.png', dataBase64: '' }),
      });
      assert.equal(empty.status, 400);

      // Filename traversal is sanitized: ../etc/passwd.png becomes a safe basename.
      const traversal = await fetch(makeUrl(base, '/upload'), {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: tab.sessionId, filename: '../etc/passwd.png', dataBase64: TINY_PNG_B64 }),
      });
      assert.equal(traversal.status, 200);
      const traversalData = await traversal.json();
      assert.ok(traversalData.path.startsWith(join(cwd, '.grok-web-uploads')), 'traversed name stays under cwd');
      assert.doesNotMatch(traversalData.path, /\.\./);

      const media = await fetch(makeUrl(base, goodData.mediaUrl), { headers: { cookie } });
      assert.equal(media.status, 200);
      assert.equal(media.headers.get('content-type'), 'image/png');
      const bytes = new Uint8Array(await media.arrayBuffer());
      assert.equal(bytes.length, onDisk.length);

      const traversalMedia = await fetch(makeUrl(base, '/upload-media?sessionId=' + encodeURIComponent(tab.sessionId) + '&name=..%2Fsecret.png'), { headers: { cookie } });
      assert.equal(traversalMedia.status, 400);

      const prompt = await fetch(makeUrl(base, '/prompt'), {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: tab.sessionId,
          text: 'what is in this image?',
          attachments: [{ path: goodData.path, filename: 'hello.png', kind: 'image', mediaUrl: goodData.mediaUrl }],
        }),
      });
      assert.equal(prompt.status, 202);

      const userPrompt = await waitForEvent(
        events,
        (e) => e.kind === 'user_prompt' && e.text === 'what is in this image?',
        'user_prompt with attachments',
      );
      assert.ok(Array.isArray(userPrompt.attachments), 'user_prompt carries attachments array');
      assert.equal(userPrompt.attachments.length, 1);
      assert.equal(userPrompt.attachments[0].kind, 'image');
      assert.equal(userPrompt.attachments[0].path, goodData.path);

      const probe = await waitForEvent(
        events,
        (e) => e.kind === 'meta' && e.method === '_x.ai/fake_prompt_probe' && e.params?.phase === 'start' && /Attached files:/.test(e.params?.text ?? ''),
        'fake_prompt_probe with augmented prompt',
      );
      assert.match(probe.params.text, /what is in this image\?/);
      assert.match(probe.params.text, new RegExp(`Attached files:[\\s\\S]*${goodData.path.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}`));

      // Attachments whose path is outside the session uploads dir are silently dropped.
      const outsidePrompt = await fetch(makeUrl(base, '/prompt'), {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: tab.sessionId,
          text: 'sneak path through',
          attachments: [{ path: 'C:\\Windows\\System32\\notepad.exe', filename: 'notepad.exe', kind: 'binary' }],
        }),
      });
      assert.equal(outsidePrompt.status, 202);
      const outsideEvent = await waitForEvent(
        events,
        (e) => e.kind === 'user_prompt' && e.text === 'sneak path through',
        'user_prompt without sanitized attachments',
      );
      assert.deepEqual(outsideEvent.attachments, [], 'out-of-cwd attachments are stripped');

      abort.abort();
    } finally {
      await server.stop();
    }
  });
});
