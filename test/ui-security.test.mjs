import assert from 'node:assert/strict';
import test from 'node:test';
import { importFresh, installDomStubs } from './helpers.mjs';

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
