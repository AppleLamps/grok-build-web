import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { bootstrap, makeUrl, startFakeServer, withTempDir } from './helpers.mjs';

test('sessions endpoint skips malformed summaries and preserves Unicode cwd metadata', async () => {
  await withTempDir('grok-web-sessions-edge-', async (temp) => {
    const sessionsRoot = join(temp, 'sessions');
    const valid = join(sessionsRoot, 'bucket-a', 'valid');
    const malformed = join(sessionsRoot, 'bucket-b', 'bad');
    const missing = join(sessionsRoot, 'bucket-c', 'missing');
    await mkdir(valid, { recursive: true });
    await mkdir(malformed, { recursive: true });
    await mkdir(missing, { recursive: true });
    await writeFile(join(valid, 'summary.json'), JSON.stringify({
      info: { id: 'unicode-session', cwd: 'C:\\Users\\lucas\\项目 空格' },
      generated_title: 'Unicode workspace',
      last_active_at: '2026-05-22T02:00:00Z',
      num_chat_messages: 3,
    }), 'utf8');
    await writeFile(join(malformed, 'summary.json'), '{', 'utf8');

    const server = await startFakeServer({ sessionsRoot });
    try {
      const { base, cookie } = await bootstrap(server);
      const r = await fetch(makeUrl(base, '/sessions'), { headers: { cookie } });
      assert.equal(r.status, 200);
      const data = await r.json();
      assert.equal(data.sessions.length, 1);
      assert.deepEqual(data.sessions[0], {
        id: 'unicode-session',
        cwd: 'C:\\Users\\lucas\\项目 空格',
        title: 'Unicode workspace',
        lastActive: '2026-05-22T02:00:00Z',
        numMessages: 3,
      });
    } finally {
      await server.stop();
    }
  });
});
