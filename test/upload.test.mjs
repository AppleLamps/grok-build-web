import assert from 'node:assert/strict';
import test from 'node:test';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  bootstrap,
  makeUrl,
  openTestTab,
  readEvents,
  startFakeServer,
  waitForEvent,
  withTempDir,
  importFresh,
  installDomStubs,
} from './helpers.mjs';

const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

test('attachment helpers classify pasted screenshot files by MIME type', async () => {
  const nativeFetch = globalThis.fetch;
  const nativeCreateObjectURL = globalThis.URL.createObjectURL;
  installDomStubs({
    fetchImpl: async (requestUrl, opts = {}) => {
      const uploadUrl = new URL(requestUrl, 'http://127.0.0.1');
      assert.equal(uploadUrl.pathname, '/upload');
      assert.equal(uploadUrl.searchParams.get('filename'), 'pasted-image.png');
      assert.equal(opts.method, 'POST');
      assert.equal(opts.headers, undefined);
      assert.equal(typeof opts.body?.arrayBuffer, 'function');
      return new Response(
        JSON.stringify({
          ok: true,
          path: 'C:\\Users\\apple\\project\\.grok-web-uploads\\pasted-image.png',
          filename: uploadUrl.searchParams.get('filename'),
          mediaUrl: '/upload-media?sessionId=sid&name=pasted-image.png',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    },
  });
  globalThis.URL.createObjectURL = () => 'blob:test-image';
  try {
    const attachments = await importFresh('public/js/attachments.js');
    const file = {
      name: '',
      type: 'image/png',
      size: 3,
      async arrayBuffer() {
        return Uint8Array.from([1, 2, 3]).buffer;
      },
    };

    assert.equal(attachments.__test.kindForFile(file), 'image');
    assert.equal(attachments.__test.fallbackName(file, 'image'), 'pasted-image.png');
    assert.equal(attachments.__test.kindForFile({ name: 'clip.mp3', type: 'audio/mpeg' }), 'audio');
    assert.equal(attachments.__test.kindForFile({ name: 'movie.mp4', type: 'video/mp4' }), 'video');
    assert.equal(attachments.__test.kindForFile({ name: 'archive.zip', type: 'application/zip' }), 'binary');
    await attachments.__test.handleFiles([file]);

    const pending = attachments.getPendingAttachments();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].filename, 'pasted-image.png');
    assert.equal(pending[0].kind, 'image');
  } finally {
    globalThis.fetch = nativeFetch;
    globalThis.URL.createObjectURL = nativeCreateObjectURL;
  }
});

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

      const rawBytes = Uint8Array.from([0, 1, 2, 3, 254, 255]);
      const rawPng = await fetch(
        makeUrl(base, `/upload?sessionId=${encodeURIComponent(tab.sessionId)}&filename=raw.png`),
        {
          method: 'POST',
          headers: { cookie },
          body: rawBytes,
        },
      );
      assert.equal(rawPng.status, 200);
      const rawData = await rawPng.json();
      assert.equal(rawData.ok, true);
      assert.equal(rawData.filename, 'raw.png');
      const rawOnDisk = await readFile(rawData.path);
      assert.deepEqual([...rawOnDisk], [...rawBytes]);

      const binaryUpload = await fetch(makeUrl(base, '/upload'), {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: tab.sessionId, filename: 'archive.zip', dataBase64: TINY_PNG_B64 }),
      });
      assert.equal(binaryUpload.status, 200);
      const binaryData = await binaryUpload.json();
      assert.equal(binaryData.ok, true);
      assert.equal(binaryData.filename, 'archive.zip');
      assert.equal(binaryData.mediaUrl, undefined);
      const binaryOnDisk = await readFile(binaryData.path);
      assert.equal(binaryOnDisk.length, Buffer.from(TINY_PNG_B64, 'base64').length);

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

      const traversalMedia = await fetch(
        makeUrl(base, '/upload-media?sessionId=' + encodeURIComponent(tab.sessionId) + '&name=..%2Fsecret.png'),
        { headers: { cookie } },
      );
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
        (e) =>
          e.kind === 'meta' &&
          e.method === '_x.ai/fake_prompt_probe' &&
          e.params?.phase === 'start' &&
          /Attached files:/.test(e.params?.text ?? ''),
        'fake_prompt_probe with augmented prompt',
      );
      assert.match(probe.params.text, /what is in this image\?/);
      assert.match(
        probe.params.text,
        new RegExp(`Attached files:[\\s\\S]*${goodData.path.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}`),
      );

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

test('raw upload enforces size limit and removes temp file', async () => {
  await withTempDir('grok-web-upload-limit-', async (cwd) => {
    const server = await startFakeServer({
      cwd,
      env: { GROK_WEB_MAX_UPLOAD_BYTES: '3' },
    });
    try {
      const { base, cookie } = await bootstrap(server);
      const events = [];
      const abort = new AbortController();
      readEvents(makeUrl(base, '/stream'), cookie, events, abort.signal).catch(() => {});
      const tab = await openTestTab(base, cookie, events);

      const tooLarge = await fetch(
        makeUrl(base, `/upload?sessionId=${encodeURIComponent(tab.sessionId)}&filename=big.png`),
        {
          method: 'POST',
          headers: { cookie },
          body: Uint8Array.from([1, 2, 3, 4]),
        },
      );
      assert.equal(tooLarge.status, 413);
      const names = await uploadNames(cwd);
      assert.deepEqual(names, []);

      abort.abort();
    } finally {
      await server.stop();
    }
  });
});

async function uploadNames(cwd) {
  try {
    return await readdir(join(cwd, '.grok-web-uploads'));
  } catch {
    return [];
  }
}
