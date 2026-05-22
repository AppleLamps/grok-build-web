import assert from 'node:assert/strict';
import test from 'node:test';
import { delay, importPublic, installDomStubs } from './helpers.mjs';

const requests = [];
const fieldDefaults = {
  effort: null,
  reasoningEffort: null,
  maxTurns: null,
  sandbox: null,
  model: null,
  rules: null,
  systemPromptOverride: null,
  allow: [],
  deny: [],
  tools: null,
  disallowedTools: null,
  disableWebSearch: false,
  noSubagents: false,
  noPlan: false,
  noMemory: false,
  restoreCode: false,
  alwaysApprove: false,
  noLeader: false,
  permissionMode: null,
  ignoreApiKey: false,
};

installDomStubs({
  fetchImpl: async (url, opts = {}) => {
    const path = String(url);
    requests.push({ url: path, body: opts.body ? JSON.parse(opts.body) : null });
    if (path === '/spawn-opts') {
      return json({ ...fieldDefaults, _capabilities: { permissionMode: false }, _env: { XAI_API_KEY_set: false } });
    }
    if (path === '/settings') {
      if (opts.method === 'POST') return json({ displayName: opts.body ? JSON.parse(opts.body).displayName : 'Lucas' });
      return json({ displayName: 'Lucas' });
    }
    if (path === '/identity') return json({ displayName: 'Private' });
    if (path === '/cli/models') return new Response('grok-build\ngrok-4.3\ngrok/custom-beta', { status: 200 });
    if (path === '/session/respawn') return json({ ok: true });
    return json({});
  },
});

const settings = await importPublic('public/js/settings.js');
const modelpicker = await importPublic('public/js/modelpicker.js');

test('settings display-name-only changes avoid respawn and skip unsupported permissionMode', async () => {
  requests.length = 0;
  const panel = await settings.__testOpenSettings();
  panel.querySelector('[data-key]').value = 'Private';

  await settings.__testApplySettings();
  await delay(0);

  const settingsPost = requests.find(r => r.url === '/settings' && r.body);
  assert.deepEqual(settingsPost.body, { displayName: 'Private' });
  assert.equal(requests.some(r => r.url === '/session/respawn'), false);
});

test('settings launch changes respawn without unsupported permissionMode', async () => {
  requests.length = 0;
  const panel = await settings.__testOpenSettings();
  const modelInput = panel.querySelector('[data-key]');
  modelInput.value = 'Private';
  const sandbox = panel.querySelectorAll('[data-key]').find(el => el.dataset.key === 'sandbox');
  sandbox.value = 'workspace-write';

  await settings.__testApplySettings();
  await delay(0);

  const respawn = requests.find(r => r.url === '/session/respawn');
  assert.equal(respawn.body.sandbox, 'workspace-write');
  assert.equal(Object.hasOwn(respawn.body, 'permissionMode'), false);
});

test('model picker parses CLI IDs and respawns with a custom model', async () => {
  requests.length = 0;
  assert.deepEqual(modelpicker.__testParseModelIds('grok-build\nxai/grok-next\nother'), ['grok-build', 'grok-next']);

  const { wrap } = await modelpicker.__testOpenModelPicker();
  wrap.querySelector('[name="customModel"]').value = 'grok-custom-private';
  wrap.dispatchEvent({ type: 'submit', preventDefault() {} });
  await delay(0);

  const respawn = requests.find(r => r.url === '/session/respawn');
  assert.deepEqual(respawn.body, { model: 'grok-custom-private' });
});

function json(value) {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
}
