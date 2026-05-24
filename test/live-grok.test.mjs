import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const LIVE = process.env.GROK_WEB_LIVE_TESTS === '1';
const LONG_TIMEOUT = Number(process.env.GROK_WEB_LIVE_TIMEOUT_MS ?? 240000);
const READ_TIMEOUT = Number(process.env.GROK_WEB_LIVE_READ_TIMEOUT_MS ?? 90000);
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const liveOnly = LIVE ? false : 'set GROK_WEB_LIVE_TESTS=1 or run npm run test:live';
const optionalX = process.env.GROK_WEB_LIVE_X_SEARCH === '1' ? false : 'set GROK_WEB_LIVE_X_SEARCH=1 to require real X search';
const optionalPlugin = process.env.GROK_WEB_LIVE_PLUGIN_MCP_NAME
  ? false
  : 'set GROK_WEB_LIVE_PLUGIN_MCP_NAME to require a specific plugin MCP server';

test('live bridge bootstraps auth, SSE, sessions, settings, models, and MCP', { skip: liveOnly, timeout: LONG_TIMEOUT }, async () => {
  await withLiveServer(async ({ base, cookie, events, stderr }) => {
    await waitForEvent(events, e => e.kind === 'agent_ready', 'agent_ready');

    const home = await fetch(new URL('/', base), { headers: { cookie } });
    assert.equal(home.status, 200);
    assert.match(await home.text(), /grok web/i);

    const sessions = await getJson(base, cookie, '/sessions');
    assert.ok(Array.isArray(sessions.sessions), 'sessions endpoint returns an array');

    const opts = await getJson(base, cookie, '/spawn-opts');
    assert.equal(opts._capabilities?.alwaysApprove, true);
    assert.equal(opts._capabilities?.noLeader, true);
    assert.equal(opts._capabilities?.permissionMode, false);

    const models = await getText(base, cookie, '/cli/models');
    assert.match(models, /grok/i);

    const mcp = await getText(base, cookie, '/cli/mcp');
    assert.ok(mcp.trim().length > 0, 'mcp output is nonempty');

    assert.doesNotMatch(stderr(), /Unexpected end of JSON input/);
  });
});

test('live web search streams a real search tool update', { skip: liveOnly, timeout: LONG_TIMEOUT }, async () => {
  await withLiveServer(async ({ base, cookie, events }) => {
    const before = events.length;
    await postPrompt(base, cookie, [
      'Use the web search tool exactly once.',
      'Search for the current xAI homepage.',
      'After the tool result, answer in one short sentence.',
    ].join(' '));
    await waitForEvent(events, e => e.kind === 'turn_complete', 'turn_complete');
    const newEvents = events.slice(before);
    assert.ok(newEvents.some(e => isToolTitle(e, /web[_ -]?search|search_web|websearch/i)), 'web search tool update streamed');
  });
});

test('live read_file streams multimodal file tool updates for image, PDF, and PPTX fixtures', { skip: liveOnly, timeout: Math.max(LONG_TIMEOUT, READ_TIMEOUT * 5) }, async () => {
  await withTempWorkspace(async (cwd) => {
    await writeMediaFixtures(cwd);
    for (const fileName of ['live.png', 'live.jpg', 'live.pdf', 'live.pptx']) {
      await withLiveServer(async ({ base, cookie, events }) => {
        const before = events.length;
        await postPrompt(base, cookie, `Use read_file on ${fileName} in the current working directory. Stop after reading it.`);
        await waitForReadFile(events, before, fileName);
        await postCancel(base, cookie);
      }, { cwd });
    }
  });
});

test('live cancel recovers from a running background-style task', { skip: liveOnly, timeout: LONG_TIMEOUT }, async () => {
  await withLiveServer(async ({ base, cookie, events }) => {
    const before = events.length;
    await postPrompt(base, cookie, [
      'Run a terminal command that waits for 60 seconds.',
      'Use a background-capable command if available.',
      'Do not do anything else until the command is running.',
    ].join(' '));
    await delay(2000);
    const cancel = await fetch(new URL('/cancel', base), {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(cancel.status, 202);
    assert.equal((await cancel.json()).ok, true);
    await waitForEvent(events, e => e.kind === 'turn_complete' || isCancelledToolEvent(e), 'cancelled turn');
    const newEvents = events.slice(before);
    assert.ok(newEvents.some(e => e.kind === 'turn_complete' || isCancelledToolEvent(e)), 'cancel state streamed');
  });
});

test('live X search streams an X-specific search tool update', { skip: liveOnly || optionalX, timeout: LONG_TIMEOUT }, async () => {
  await withLiveServer(async ({ base, cookie, events }) => {
    const before = events.length;
    await postPrompt(base, cookie, [
      'Use X search exactly once.',
      'Search X for recent posts from skcd42 about Grok Build.',
      'After the tool result, answer in one short sentence.',
    ].join(' '));
    await waitForEvent(events, e => e.kind === 'turn_complete', 'turn_complete');
    const newEvents = events.slice(before);
    assert.ok(newEvents.some(e => isToolTitle(e, /x[_ -]?search|twitter[_ -]?search|search_x|x_search_posts/i)), 'X search tool update streamed');
  });
});

test('live plugin MCP list contains the configured auth-backed server', { skip: liveOnly || optionalPlugin, timeout: LONG_TIMEOUT }, async () => {
  await withLiveServer(async ({ base, cookie }) => {
    const name = process.env.GROK_WEB_LIVE_PLUGIN_MCP_NAME;
    const mcp = await getText(base, cookie, '/cli/mcp');
    assert.match(mcp, new RegExp(escapeRegExp(name), 'i'));
    assert.doesNotMatch(mcp, /auth.*failed|unauthorized|forbidden/i);
  });
});

async function withLiveServer(fn, { cwd = null } = {}) {
  const server = await startLiveServer({ cwd });
  const abort = new AbortController();
  const events = [];
  const stream = readEvents(new URL('/stream', server.base), server.cookie, events, abort.signal).catch((e) => {
    if (!abort.signal.aborted) throw e;
  });
  try {
    await fn({ ...server, events });
  } finally {
    abort.abort();
    await stream.catch(() => {});
    await server.stop();
  }
}

async function startLiveServer({ cwd = null } = {}) {
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      GROK_WEB_NO_OPEN: '1',
      PORT: '0',
      ...(cwd ? { GROK_CWD: cwd } : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', c => { stdout += c.toString(); });
  child.stderr.on('data', c => { stderr += c.toString(); });
  const launchUrl = await waitForLaunchUrl(() => stdout, () => stderr, child);
  const first = await fetch(launchUrl, { redirect: 'manual' });
  assert.equal(first.status, 302);
  const cookie = first.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie, 'live bootstrap cookie is set');
  return {
    child,
    base: new URL(launchUrl),
    cookie,
    stderr: () => stderr,
    async stop() {
      if (child.exitCode !== null) return;
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        child.kill();
      }
      await Promise.race([
        new Promise(resolve => child.once('exit', resolve)),
        delay(5000),
      ]);
    },
  };
}

async function waitForLaunchUrl(readStdout, readStderr, child) {
  const started = Date.now();
  while (Date.now() - started < 30000) {
    const match = readStdout().match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[a-f0-9]+/);
    if (match) return match[0];
    if (child.exitCode !== null) {
      throw new Error(`live server exited before launch URL\nstdout:\n${readStdout()}\nstderr:\n${readStderr()}`);
    }
    await delay(100);
  }
  throw new Error(`live server did not print launch URL\nstdout:\n${readStdout()}\nstderr:\n${readStderr()}`);
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
        if (line.startsWith('data: ')) events.push(JSON.parse(line.slice(6)));
      }
    }
  }
}

async function postPrompt(base, cookie, text) {
  const r = await fetch(new URL('/prompt', base), {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  assert.equal(r.status, 202);
}

async function postCancel(base, cookie) {
  const r = await fetch(new URL('/cancel', base), {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(r.status, 202);
}

async function getJson(base, cookie, path) {
  const r = await fetch(new URL(path, base), { headers: { cookie } });
  assert.equal(r.status, 200);
  return r.json();
}

async function getText(base, cookie, path) {
  const r = await fetch(new URL(path, base), { headers: { cookie } });
  assert.equal(r.status, 200);
  return r.text();
}

async function waitForEvent(events, predicate, label) {
  const started = Date.now();
  while (Date.now() - started < LONG_TIMEOUT) {
    const found = events.find(predicate);
    if (found) return found;
    await delay(100);
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function waitForReadFile(events, before, fileName) {
  const started = Date.now();
  let toolCallId = null;
  let sawReadCall = false;
  while (Date.now() - started < READ_TIMEOUT) {
    for (const event of events.slice(before)) {
      if (event.kind !== 'update') continue;
      const update = event.update ?? {};
      const haystack = [
        update.title,
        update.toolName,
        update.name,
        update.kind,
        update.rawInput?.path,
        update.rawInput?.file_path,
      ].filter(Boolean).join(' ');
      if (new RegExp(`read|${escapeRegExp(fileName)}`, 'i').test(haystack)
          && new RegExp(escapeRegExp(fileName), 'i').test(haystack)) {
        sawReadCall = true;
        toolCallId = update.toolCallId ?? toolCallId;
      }
      const sameTool = !toolCallId || update.toolCallId === toolCallId;
      const hasPayload = update.status === 'completed'
        || update.content != null
        || update.rawOutput != null
        || update.output != null;
      if (sawReadCall && sameTool && hasPayload) return;
    }
    await delay(100);
  }
  const summary = events.slice(before).map(event => ({
    kind: event.kind,
    title: event.update?.title,
    status: event.update?.status,
    sessionUpdate: event.update?.sessionUpdate,
    toolCallId: event.update?.toolCallId,
  }));
  throw new Error(`timed out waiting for read_file ${fileName}: ${JSON.stringify(summary.slice(-20))}`);
}

function isToolTitle(event, pattern) {
  const update = event.update ?? {};
  return event.kind === 'update' && pattern.test(String(update.title ?? update.toolName ?? update.name ?? ''));
}

function isCancelledToolEvent(event) {
  const update = event.update ?? {};
  return event.kind === 'update' && /cancelled|canceled|killed/i.test(String(update.status ?? update.rawOutput?.status ?? ''));
}

async function withTempWorkspace(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'grok-web-live-fixtures-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeMediaFixtures(cwd) {
  await mkdir(cwd, { recursive: true });
  await writeFile(join(cwd, 'live.png'), Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
    'base64',
  ));
  await writeFile(join(cwd, 'live.jpg'), Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/ASP/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/ASP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Aqf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IV//2gAMAwEAAgADAAAAEP/EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QH//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QH//EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAT8QH//Z',
    'base64',
  ));
  await writeFile(join(cwd, 'live.pdf'), [
    '%PDF-1.4',
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >> endobj',
    '4 0 obj << /Length 44 >> stream',
    'BT /F1 12 Tf 20 100 Td (Live PDF fixture) Tj ET',
    'endstream endobj',
    'xref',
    '0 5',
    '0000000000 65535 f ',
    'trailer << /Root 1 0 R >>',
    '%%EOF',
  ].join('\n'), 'utf8');
  await writeFile(join(cwd, 'live.pptx'), makePptxFixture());
}

function makePptxFixture() {
  return makeZip({
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`,
    'ppt/presentation.xml': `<?xml version="1.0" encoding="UTF-8"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
</p:presentation>`,
    'ppt/_rels/presentation.xml.rels': `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
</Relationships>`,
    'ppt/slides/slide1.xml': `<?xml version="1.0" encoding="UTF-8"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Live PPTX fixture</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>`,
  });
}

function makeZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name);
    const data = Buffer.from(content);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const centralDir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralDir, end]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
