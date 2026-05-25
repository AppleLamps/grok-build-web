import assert from 'node:assert/strict';
import test from 'node:test';
import { importFresh, installDomStubs } from './helpers.mjs';

test('agent_exit shows restart banner', async () => {
  installDomStubs();
  const dispatchMod = await importFresh('public/js/dispatch.js');
  dispatchMod.dispatch({ kind: 'agent_exit', code: 1 });

  const banner = document.getElementById('recovery-slot');
  assert.equal(banner.hidden, false);
  assert.match(banner.innerHTML, /Agent disconnected/);
  assert.match(banner.innerHTML, /Restart agent/);
  assert.match(document.getElementById('status').textContent, /agent exited/);
});
