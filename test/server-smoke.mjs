import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(new URL('..', import.meta.url)));
const temp = await mkdtemp(join(tmpdir(), 'grok-web-smoke-'));
const sessionsRoot = join(temp, 'sessions');
const fake = resolve(repo, 'test', 'fake-grok.mjs');
const node = process.execPath;

try {
  await seedSessions(sessionsRoot);

  const child = spawn(node, ['server.mjs'], {
    cwd: repo,
    env: {
      ...process.env,
      GROK_BIN: node,
      GROK_BIN_ARGS: JSON.stringify([fake]),
      GROK_WEB_NO_OPEN: '1',
      GROK_WEB_SESSIONS_ROOT: sessionsRoot,
      PORT: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', c => { stdout += c.toString(); });
  child.stderr.on('data', c => { stderr += c.toString(); });

  const launchUrl = await waitForUrl(() => stdout, () => stderr, child);
  const first = await fetch(launchUrl, { redirect: 'manual' });
  assert.equal(first.status, 302);
  const cookie = first.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie, 'bootstrap cookie is set');
  const cleanPath = first.headers.get('location');
  assert.equal(cleanPath, '/');

  const base = new URL(launchUrl);
  const home = await fetch(new URL(cleanPath, base), { headers: { cookie } });
  assert.equal(home.status, 200);
  assert.match(await home.text(), /grok web/);

  const streamAbort = new AbortController();
  const events = [];
  const streamPromise = readEvents(new URL('/stream', base), cookie, events, streamAbort.signal);
  await waitForEvent(events, e => e.kind === 'session_ready');

  const sessions = await fetch(new URL('/sessions', base), { headers: { cookie } }).then(r => r.json());
  assert.equal(sessions.sessions.length, 2);
  assert.ok(sessions.sessions.some(s => s.numMessages === 0), 'empty session summary is exposed for client filtering');

  const prompt = await fetch(new URL('/prompt', base), {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'run fake smoke' }),
  });
  assert.equal(prompt.status, 202);
  await waitForEvent(events, e => e.kind === 'turn_complete');
  assert.ok(events.some(e => e.kind === 'permission_auto_allowed'), 'permission request was handled');
  assert.ok(events.some(e => e.kind === 'elicitation_request'), 'elicitation request was surfaced');
  assert.ok(events.some(e => e.kind === 'meta' && e.method === 'fake/unknown_client_request'), 'unknown request was surfaced as meta');
  assert.ok(events.some(e => e.kind === 'update' && e.update?.title === 'x_search_posts'), 'x search update streamed');
  assert.ok(events.some(e => e.kind === 'update' && e.update?.title === 'imagine_video'), 'video update streamed');

  const cancel = await fetch(new URL('/cancel', base), {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(cancel.status, 202);
  assert.equal((await cancel.json()).ok, true);

  const opts = await fetch(new URL('/spawn-opts', base), { headers: { cookie } }).then(r => r.json());
  assert.equal(opts.alwaysApprove, true);
  assert.equal(opts._capabilities.noLeader, true);
  assert.equal(opts._capabilities.permissionMode, false);

  streamAbort.abort();
  await streamPromise.catch(() => {});
  child.kill();
  await new Promise(resolve => child.once('exit', resolve));

  assert.doesNotMatch(stderr, /ERR|TypeError|SyntaxError/);
  console.log('server smoke ok');
} finally {
  await rm(temp, { recursive: true, force: true });
}

async function seedSessions(root) {
  const cwdBucket = join(root, 'cwd');
  const active = join(cwdBucket, 'active');
  const empty = join(cwdBucket, 'empty');
  await mkdir(active, { recursive: true });
  await mkdir(empty, { recursive: true });
  await writeFile(join(active, 'summary.json'), JSON.stringify({
    info: { id: 'active-session', cwd: 'C:\\Users\\lucas\\project' },
    generated_title: 'Active session',
    last_active_at: '2026-05-22T01:00:00Z',
    num_chat_messages: 6,
  }), 'utf8');
  await writeFile(join(empty, 'summary.json'), JSON.stringify({
    info: { id: 'empty-session', cwd: 'C:\\Users\\lucas\\project' },
    generated_title: 'Empty session',
    last_active_at: '2026-05-22T00:59:00Z',
    num_chat_messages: 0,
  }), 'utf8');
}

async function waitForUrl(readStdout, readStderr, child) {
  const started = Date.now();
  while (Date.now() - started < 10000) {
    const match = readStdout().match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[a-f0-9]+/);
    if (match) return match[0];
    if (child.exitCode !== null) {
      throw new Error(`server exited before launch URL\nstdout:\n${readStdout()}\nstderr:\n${readStderr()}`);
    }
    await delay(50);
  }
  throw new Error(`server did not print launch URL\nstdout:\n${readStdout()}\nstderr:\n${readStderr()}`);
}

async function readEvents(url, cookie, events, signal) {
  const r = await fetch(url, { headers: { cookie }, signal });
  assert.equal(r.status, 200);
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        events.push(JSON.parse(line.slice(6)));
      }
    }
  }
}

async function waitForEvent(events, predicate) {
  const started = Date.now();
  while (Date.now() - started < 10000) {
    const found = events.find(predicate);
    if (found) return found;
    await delay(50);
  }
  throw new Error('timed out waiting for event');
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
