import assert from 'node:assert/strict';
import test from 'node:test';
import { delay, importFresh, installDomStubs } from './helpers.mjs';

test('toast renders hostile markup as literal text', async () => {
  const { body } = installDomStubs();
  const { toast } = await importFresh('public/js/toast.js');

  const el = toast('<img src=x onerror=alert(1)>', { duration: 60000 });

  assert.equal(el.textContent, '<img src=x onerror=alert(1)>');
  assert.equal(body.querySelectorAll('img').length, 0);
});

test('toastLink creates anchors only for safe http URLs', async () => {
  const { body } = installDomStubs();
  const { toastLink } = await importFresh('public/js/toast.js');

  const safe = toastLink('Share: ', 'https://example.com/?q=<x>', { duration: 60000 });
  const link = safe.querySelector('a');
  assert.ok(link, 'safe URL rendered as an anchor');
  assert.equal(link.href, 'https://example.com/?q=%3Cx%3E');
  assert.equal(link.textContent, 'https://example.com/?q=%3Cx%3E');

  toastLink('Share: ', 'javascript:alert(1)', { duration: 60000 });
  assert.equal(body.querySelectorAll('a').length, 1, 'unsafe URL did not create another anchor');
});

test('modal string bodies render hostile markup as literal text', async () => {
  const { body } = installDomStubs();
  const { modal } = await importFresh('public/js/modal.js');

  const { body: modalBody } = modal('Title', '<img src=x onerror=alert(1)>');

  assert.equal(modalBody.textContent, '<img src=x onerror=alert(1)>');
  assert.equal(body.querySelectorAll('img').length, 0);
});

test('CLI panel output is inserted as text, not HTML', async () => {
  const { body } = installDomStubs({
    fetchImpl: async (url) => {
      assert.equal(url, '/cli/models');
      return new Response('<script>alert(1)</script><img src=x onerror=alert(1)>', { status: 200 });
    },
  });
  const { showModels } = await importFresh('public/js/panels.js');

  await showModels();

  const pre = body.querySelector('pre.panel-content');
  assert.ok(pre, 'panel content was rendered');
  assert.equal(pre.textContent, '<script>alert(1)</script><img src=x onerror=alert(1)>');
  assert.equal(body.querySelectorAll('script').length, 0);
  assert.equal(body.querySelectorAll('img').length, 0);
});

test('headless run output is inserted as text, not HTML', async () => {
  const { body } = installDomStubs({
    fetchImpl: async (url, opts = {}) => {
      assert.equal(String(url), '/cli/headless');
      const request = JSON.parse(opts.body);
      assert.equal(request.outputFormat, 'streaming-json');
      return json({
        ok: true,
        args: ['--output-format', 'streaming-json', '-p', request.text],
        cwd: 'C:\\Users\\apple\\grok-web',
        stdout: '<script>alert(1)</script><img src=x onerror=alert(1)>',
        stderr: '<svg onload=alert(1)>',
      });
    },
  });
  const { showHeadlessRun } = await importFresh('public/js/panels.js');

  const form = showHeadlessRun();
  form.querySelector('[name="outputFormat"]').value = 'streaming-json';
  form.querySelector('[name="text"]').value = '<b>prompt</b>';
  form.dispatchEvent({ type: 'submit', preventDefault() {} });
  await delay(0);

  const result = body.querySelector('.headless-result');
  assert.match(result.textContent, /<script>alert\(1\)<\/script>/);
  assert.match(result.textContent, /<svg onload=alert\(1\)>/);
  assert.equal(body.querySelectorAll('script').length, 0);
  assert.equal(body.querySelectorAll('img').length, 0);
});

test('login modal renders CLI prompt as text and closes after auth status is detected', async () => {
  let statusChecks = 0;
  const { body } = installDomStubs({
    fetchImpl: async (url) => {
      const path = String(url);
      if (path === '/cli/login') {
        return new Response('<script>alert(1)</script> Visit https://example.test/device', { status: 200 });
      }
      if (path === '/cli/login/status') {
        statusChecks++;
        return json({
          authenticated: statusChecks > 1,
          credential: '~/.grok/auth.json',
          updatedAt: '2026-06-04T00:00:00.000Z',
        });
      }
      return json({});
    },
  });
  const { __testShowLogin } = await importFresh('public/js/tools-menu.js');

  await __testShowLogin({ pollMs: 1, closeDelayMs: 1 });
  await waitForModalClose(body);

  assert.equal(statusChecks >= 2, true);
  assert.equal(body.querySelectorAll('script').length, 0);
  assert.equal(body.querySelector('.modal-backdrop'), null);
});

test('model picker treats hostile model IDs as text', async () => {
  const { body } = installDomStubs({
    fetchImpl: async (url) => {
      const path = String(url);
      if (path === '/spawn-opts') return json({ model: '<img src=x onerror=alert(1)>' });
      if (path === '/cli/models') return new Response('<script>alert(1)</script>\ngrok-build', { status: 200 });
      return json({});
    },
  });
  const { __testOpenModelPicker } = await importFresh('public/js/modelpicker.js');

  const { wrap } = await __testOpenModelPicker();

  assert.equal(wrap.querySelector('.model-current-value').textContent, '<img src=x onerror=alert(1)>');
  assert.equal(body.querySelectorAll('img').length, 0);
  assert.equal(body.querySelectorAll('script').length, 0);
});

test('settings field labels and hints render hostile text literally', async () => {
  const { body } = installDomStubs();
  const settings = await importFresh('public/js/settings.js');

  const field = settings.__testFieldEl(
    {
      key: 'hostile',
      label: '<img src=x onerror=alert(1)>',
      type: 'text',
      hint: '<script>alert(1)</script>',
    },
    '<svg onload=alert(1)>',
  );

  assert.equal(field.querySelector('label').textContent, '<img src=x onerror=alert(1)>');
  assert.equal(field.querySelector('.setting-hint').textContent, '<script>alert(1)</script>');
  assert.equal(field.querySelector('input').value, '<svg onload=alert(1)>');
  assert.equal(body.querySelectorAll('img').length, 0);
  assert.equal(body.querySelectorAll('script').length, 0);
});

test('share fallback stores hostile URLs in input value only', async () => {
  const { body } = installDomStubs();
  const { __testShowShareFallback } = await importFresh('public/js/topbar.js');

  __testShowShareFallback('https://example.com/?q=<img src=x onerror=alert(1)>');

  const input = body.querySelector('.share-fallback').querySelector('input');
  assert.equal(input.value, 'https://example.com/?q=<img src=x onerror=alert(1)>');
  assert.equal(body.querySelectorAll('img').length, 0);
});

test('sidebar recents and global search results treat hostile strings as text', async () => {
  const { body } = installDomStubs({
    fetchImpl: async (url) => {
      if (String(url) === '/cli/sessions/search') {
        return json({
          results: [
            {
              id: 'result-1',
              title: '<img src=x onerror=alert(1)>',
              date: '<script>alert(1)</script>',
              snippet: '<svg onload=alert(1)>',
              score: 1,
            },
          ],
        });
      }
      return json({});
    },
  });
  const sidebar = await importFresh('public/js/sidebar.js');

  sidebar.__testSetRecentsState({
    currentSessionId: 'active',
    sessions: [
      {
        id: 'active',
        cwd: 'C:\\Users\\apple\\project',
        title: '<img src=x onerror=alert(1)>',
        lastActive: '2026-05-22T01:00:00Z',
        numMessages: 2,
      },
    ],
  });
  sidebar.__testSetShowEmptySessions(true);
  sidebar.renderRecents();
  assert.equal(sidebar.__testRecentsElement().querySelector('.title').textContent, '<img src=x onerror=alert(1)>');

  await sidebar.__testSearchAllSessionsModal('<b>private</b>');
  assert.equal(body.querySelector('.search-result-title').textContent, '<img src=x onerror=alert(1)>');
  assert.equal(body.querySelector('.search-result-meta').textContent, '<script>alert(1)</script>');
  assert.equal(body.querySelector('.search-result-snippet').textContent, '<svg onload=alert(1)>');
  assert.equal(body.querySelectorAll('img').length, 0);
  assert.equal(body.querySelectorAll('script').length, 0);
});

function json(value) {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
}

async function waitForModalClose(body) {
  for (let i = 0; i < 50; i++) {
    if (!body.querySelector('.modal-backdrop')) return;
    await delay(10);
  }
}
