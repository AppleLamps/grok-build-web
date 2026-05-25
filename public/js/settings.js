// Settings panel: launch-time grok flags (effort, sandbox, rules, etc.).
// Changing any of these respawns the agent child process.

import { getSettings, setSettings, getSpawnOpts, postRespawn, cliModels } from './api.js';
import { setBusy } from './composer.js';
import { setStatus, addError } from './chat.js';
import { toast } from './toast.js';
import { refreshIdentity } from './identity.js';
import { mergeModelIds } from './model-ids.js';

let panel = null;
let current = {};
let bridgeCurrent = {};
let settingsPreviousFocus = null;

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const FIELDS = [
  { key: 'effort', label: 'Effort', type: 'select',
    options: ['', 'low', 'medium', 'high', 'xhigh', 'max'],
    hint: 'Overall reasoning + exploration budget.' },
  { key: 'reasoningEffort', label: 'Reasoning effort', type: 'select',
    options: ['', 'low', 'medium', 'high', 'xhigh', 'max'],
    hint: 'Specific to reasoning models.' },
  { key: 'maxTurns', label: 'Max turns', type: 'number',
    hint: 'Cap how many tool/think cycles per prompt.' },
  { key: 'sandbox', label: 'Sandbox profile', type: 'text',
    hint: 'Filesystem/network sandbox profile name.' },
  { key: 'model', label: 'Model', type: 'model-select',
    hint: 'Model ID. Leave blank to let grok pick its default.' },
  { key: 'rules', label: 'Extra rules', type: 'textarea',
    hint: 'Appended to the system prompt.' },
  { key: 'systemPromptOverride', label: 'System prompt override', type: 'textarea',
    hint: 'Replaces the default system prompt entirely.' },
  { key: 'allow', label: 'Allow rules (one per line)', type: 'lines',
    hint: 'Permission allow rules. Repeats --allow.' },
  { key: 'deny', label: 'Deny rules (one per line)', type: 'lines',
    hint: 'Permission deny rules. Repeats --deny.' },
  { key: 'tools', label: 'Tools allow-list (comma)', type: 'text',
    hint: 'Built-in tools to allow.' },
  { key: 'disallowedTools', label: 'Tools deny-list (comma)', type: 'text',
    hint: 'Built-in tools to remove.' },
  { key: 'disableWebSearch', label: 'Disable web search', type: 'checkbox' },
  { key: 'noSubagents', label: 'No subagents', type: 'checkbox' },
  { key: 'noPlan', label: 'No plan mode', type: 'checkbox' },
  { key: 'noMemory', label: 'No cross-session memory', type: 'checkbox' },
  { key: 'restoreCode', label: 'Restore code on session load', type: 'checkbox',
    hint: 'Check out the original commit when resuming a session.' },
  { key: 'alwaysApprove', label: 'Always approve at launch', type: 'checkbox',
    hint: 'Starts the agent with --always-approve when this CLI supports it.' },
  { key: 'noLeader', label: 'Start without shared leader', type: 'checkbox',
    hint: 'Starts the agent with --no-leader when this CLI supports it.' },
  { key: 'permissionMode', label: 'Permission mode', type: 'select',
    options: ['', 'auto', 'manual', 'yolo'],
    requiresCapability: 'permissionMode',
    hint: 'Launch-time --permission-mode. Disabled unless the installed grok CLI advertises it.' },
  { key: 'ignoreApiKey', label: 'Use grok.com subscription (ignore XAI_API_KEY)', type: 'checkbox',
    hint: 'ON by default. Strips XAI_API_KEY from the agent\'s env so it falls back to your grok.com login (~/.grok/auth.json) — billed against your subscription, not your API team. Uncheck to use the API key instead. Override at launch with GROK_WEB_USE_API_KEY=1.' },
];

const BRIDGE_FIELDS = [
  { key: 'displayName', label: 'Display name', type: 'text',
    hint: 'Shown in the sidebar footer. Leave blank to use your OS username.' },
];

function fieldEl(f, value) {
  const wrap = document.createElement('div');
  wrap.className = 'setting-field';
  const unsupported = f.requiresCapability && current?._capabilities?.[f.requiresCapability] === false;
  if (unsupported) wrap.classList.add('unsupported');
  const lab = document.createElement('label');
  const inputId = `setting-${f.key}`;
  lab.htmlFor = inputId;
  lab.textContent = f.label;
  wrap.appendChild(lab);
  let input;
  if (f.type === 'select') {
    input = document.createElement('select');
    for (const opt of f.options) {
      const o = document.createElement('option');
      o.value = opt; o.textContent = opt || '(default)';
      input.appendChild(o);
    }
    input.value = value ?? '';
  } else if (f.type === 'checkbox') {
    input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!value;
  } else if (f.type === 'textarea') {
    input = document.createElement('textarea');
    input.rows = 3;
    input.value = value ?? '';
  } else if (f.type === 'number') {
    input = document.createElement('input');
    input.type = 'number'; input.min = 1;
    input.value = value ?? '';
  } else if (f.type === 'lines') {
    input = document.createElement('textarea');
    input.rows = 3;
    input.value = Array.isArray(value) ? value.join('\n') : (value ?? '');
  } else if (f.type === 'model-select') {
    // Populated dynamically from `grok models`. Starts as one option ("(loading…)")
    // and is rebuilt once the CLI returns.
    input = document.createElement('select');
    const opt = document.createElement('option');
    opt.value = value ?? ''; opt.textContent = '(loading models…)';
    input.appendChild(opt);
    input.dataset.currentValue = value ?? '';
    populateModelSelect(input);
  } else {
    input = document.createElement('input');
    input.type = 'text';
    input.value = value ?? '';
  }
  input.id = inputId;
  input.dataset.key = f.key;
  input.dataset.type = f.type;
  if (unsupported) {
    input.disabled = true;
    input.dataset.unsupported = '1';
  }
  wrap.appendChild(input);
  if (f.hint) {
    const h = document.createElement('div');
    h.className = 'setting-hint'; h.textContent = f.hint;
    wrap.appendChild(h);
  }
  if (unsupported) {
    const h = document.createElement('div');
    h.className = 'setting-hint warn';
    h.textContent = 'Unsupported by the installed grok CLI.';
    wrap.appendChild(h);
  }
  return wrap;
}

function collectValues() {
  const opts = {};
  for (const el of panel.querySelectorAll('[data-key]')) {
    if (el.dataset.unsupported === '1') continue;
    const k = el.dataset.key;
    const t = el.dataset.type;
    if (t === 'checkbox') opts[k] = el.checked;
    else if (t === 'number') opts[k] = el.value ? Number(el.value) : null;
    else if (t === 'lines') opts[k] = el.value.split('\n').map(s => s.trim()).filter(Boolean);
    else opts[k] = el.value || null;
  }
  return opts;
}

async function populateModelSelect(selectEl) {
  let raw = '';
  try { raw = await cliModels(); } catch { /* fall through */ }
  const current = selectEl.dataset.currentValue ?? '';
  const ids = mergeModelIds(raw, current);
  selectEl.innerHTML = '';
  const opts = ['', ...ids];
  for (const id of opts) {
    const o = document.createElement('option');
    o.value = id; o.textContent = id || '(default)';
    if (id === current) o.selected = true;
    selectEl.appendChild(o);
  }
}

async function open() {
  settingsPreviousFocus = document.activeElement;
  if (!panel) {
    panel = document.createElement('div');
    panel.className = 'settings-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Session settings');
    panel.setAttribute('aria-describedby', 'settings-warn');
    panel.setAttribute('tabindex', '-1');
    panel.addEventListener('keydown', onPanelKeydown);
    document.body.appendChild(panel);
  }
  const results = await Promise.allSettled([getSpawnOpts(), getSettings()]);
  current = results[0].status === 'fulfilled' ? results[0].value : {};
  bridgeCurrent = results[1].status === 'fulfilled' ? results[1].value : {};
  // Banner copy depends on (a) whether XAI_API_KEY is set in env, and
  // (b) whether the current spawn is ignoring it. Default is "ignore on".
  const apiKeyEnv = current?._env?.XAI_API_KEY_set;
  const ignoring = current?.ignoreApiKey;
  let envHint = '';
  if (apiKeyEnv && ignoring) {
    envHint = '<div class="settings-env-hint"><strong>Using grok.com subscription.</strong> XAI_API_KEY is in your shell but grok-web is ignoring it by default. Uncheck <em>Use grok.com subscription</em> below to switch back to API-team billing.</div>';
  } else if (apiKeyEnv && !ignoring) {
    envHint = '<div class="settings-env-hint warn"><strong>Using XAI_API_KEY (API-team billing).</strong> If you have a Grok SuperHeavy / SuperGrok subscription, check <em>Use grok.com subscription</em> below to use it instead.</div>';
  } else if (!apiKeyEnv) {
    envHint = '<div class="settings-env-hint"><strong>Using grok.com subscription.</strong> No XAI_API_KEY in env; the agent uses your cached grok.com login from <code>~/.grok/auth.json</code>.</div>';
  }
  panel.innerHTML = `
    <div class="settings-head">
      <strong>Session settings</strong>
      <button class="close" title="Close" aria-label="Close settings">×</button>
    </div>
    ${envHint}
    <div class="settings-body"></div>
    <div class="settings-foot">
      <button class="apply">Apply settings</button>
      <button class="cancel">Cancel</button>
      <div class="settings-warn" id="settings-warn">Launch flag changes restart the grok agent child. Display name changes apply immediately.</div>
    </div>
  `;
  const body = panel.querySelector('.settings-body');
  const profileHead = document.createElement('div');
  profileHead.className = 'settings-group-head';
  profileHead.textContent = 'Profile';
  body.appendChild(profileHead);
  for (const f of BRIDGE_FIELDS) body.appendChild(fieldEl(f, bridgeCurrent[f.key]));
  const launchHead = document.createElement('div');
  launchHead.className = 'settings-group-head';
  launchHead.textContent = 'Agent launch';
  body.appendChild(launchHead);
  for (const f of FIELDS) body.appendChild(fieldEl(f, current[f.key]));
  panel.querySelector('.close').addEventListener('click', close);
  panel.querySelector('.cancel').addEventListener('click', close);
  panel.querySelector('.apply').addEventListener('click', apply);
  panel.classList.add('open');
  panel.querySelector('.close')?.focus?.();
}

function onPanelKeydown(e) {
  if (e.key !== 'Tab') return;
  const focusable = Array.from(panel.querySelectorAll(FOCUSABLE_SELECTOR))
    .filter(el => !el.hidden && el.getAttribute('aria-hidden') !== 'true');
  if (!focusable.length) {
    e.preventDefault();
    panel.focus?.();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus?.();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus?.();
  }
}

function close() {
  panel?.classList.remove('open');
  settingsPreviousFocus?.focus?.();
}

async function apply() {
  const values = collectValues();
  const bridgeOpts = { displayName: values.displayName ?? null };
  const opts = {};
  for (const f of FIELDS) opts[f.key] = values[f.key];
  setBusy(true);
  setStatus('applying settings…', 'busy');
  close();
  try {
    await setSettings(bridgeOpts);
    await refreshIdentity();
    if (hasLaunchChanges(opts)) {
      setStatus('respawning agent…', 'busy');
      await postRespawn(opts);
      toast('Settings applied and agent restarted');
    } else {
      setBusy(false);
      setStatus('ready', 'ready');
      toast('Settings applied');
    }
  } catch (e) {
    addError(`settings apply failed: ${e.message}`);
    setBusy(false);
  }
}

function hasLaunchChanges(next) {
  return FIELDS.some((f) => !sameValue(next[f.key], current[f.key], f.type));
}

function sameValue(a, b, type) {
  if (type === 'lines') return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
  if (type === 'number') return (a ?? null) === (b ?? null);
  return (a ?? null) === (b ?? null);
}

export function initSettings() {
  const btn = document.getElementById('customize-btn');
  if (btn) btn.addEventListener('click', open);
}

export const __testFields = FIELDS;

export function __testFieldEl(field, value, currentState = {}) {
  const previous = current;
  current = currentState;
  try {
    return fieldEl(field, value);
  } finally {
    current = previous;
  }
}

export async function __testOpenSettings() {
  await open();
  return panel;
}

export async function __testApplySettings() {
  return apply();
}

export function __testCollectValues() {
  return collectValues();
}
