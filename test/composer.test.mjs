import assert from 'node:assert/strict';
import test from 'node:test';
import { delay, importPublic, installDomStubs } from './helpers.mjs';

installDomStubs({
  fetchImpl: async (path) => {
    if (String(path).includes('/settings')) return jsonResponse({ autoApprove: true });
    if (String(path).includes('/cancel')) return jsonResponse({ ok: true, sessionId: 'fake' }, 202);
    return jsonResponse({});
  },
});
const { dom } = await importPublic('public/js/state.js');
const composer = await importPublic('public/js/composer.js');

test('stop button cancellation clears composer busy state', async () => {
  composer.initComposer();
  await delay(10);

  composer.setBusy(true);
  assert.equal(dom.sendBtn.style.display, 'none');
  assert.equal(dom.stopBtn.style.display, '');
  dom.stopBtn.click();
  await delay(10);
  assert.equal(dom.sendBtn.style.display, '');
  assert.equal(dom.stopBtn.style.display, 'none');
  assert.equal(dom.stopBtn.disabled, false);
});

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
