// Settings panel: launch-time grok flags (effort, sandbox, rules, etc.).
// Changing any of these respawns the agent child process.

import { getSpawnOpts, postRespawn, cliModels } from './api.js';
import { setBusy } from './composer.js';
import { setStatus, addError } from './chat.js';
import { toast } from './toast.js';

let panel = null;
let current = {};

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
  { key: 'ignoreApiKey', label: 'Use grok.com subscription (ignore XAI_API_KEY)', type: 'checkbox',
    hint: 'ON by default. Strips XAI_API_KEY from the agent\'s env so it falls back to your grok.com login (~/.grok/auth.json) — billed against your subscription, not your API team. Uncheck to use the API key instead. Override at launch with GROK_WEB_USE_API_KEY=1.' },
];

function fieldEl(f, value) {
  const wrap = document.createElement('div');
  wrap.className = 'setting-field';
  const lab = document.createElement('label');
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
  input.dataset.key = f.key;
  input.dataset.type = f.type;
  wrap.appendChild(input);
  if (f.hint) {
    const h = document.createElement('div');
    h.className = 'setting-hint'; h.textContent = f.hint;
    wrap.appendChild(h);
  }
  return wrap;
}

function collectValues() {
  const opts = {};
  for (const el of panel.querySelectorAll('[data-key]')) {
    const k = el.dataset.key;
    const t = el.dataset.type;
    if (t === 'checkbox') opts[k] = el.checked;
    else if (t === 'number') opts[k] = el.value ? Number(el.value) : null;
    else if (t === 'lines') opts[k] = el.value.split('\n').map(s => s.trim()).filter(Boolean);
    else opts[k] = el.value || null;
  }
  return opts;
}

// Known xAI model IDs as a fallback. `grok models` only lists what your auth
// method exposes (often just `grok-build`), so we union with known IDs that
// the API itself accepts. Some require specific team entitlements — if the
// agent 404s on one, try another.
const KNOWN_MODEL_IDS = [
  'grok-build',
  'grok-build-0.1',
  'grok-4.3',
  'grok-4.20-0309-non-reasoning',
  'grok-4.20-0309-reasoning',
  'grok-4.20-multi-agent-0309',
  'grok-imagine-image',
  'grok-imagine-image-quality',
  'grok-imagine-video',
];

async function populateModelSelect(selectEl) {
  let raw = '';
  try { raw = await cliModels(); } catch { /* fall through */ }
  const cliIds = parseModelIds(raw);
  const ids = Array.from(new Set([...cliIds, ...KNOWN_MODEL_IDS]));
  const current = selectEl.dataset.currentValue ?? '';
  selectEl.innerHTML = '';
  const opts = ['', ...ids];
  if (current && !opts.includes(current)) opts.push(current);
  for (const id of opts) {
    const o = document.createElement('option');
    o.value = id; o.textContent = id || '(default)';
    if (id === current) o.selected = true;
    selectEl.appendChild(o);
  }
}

function parseModelIds(text) {
  if (!text) return [];
  const matches = text.match(/grok[-/][a-z0-9._-]+/gi) ?? [];
  return Array.from(new Set(matches));
}

async function open() {
  if (!panel) {
    panel = document.createElement('div');
    panel.className = 'settings-panel';
    document.body.appendChild(panel);
  }
  try { current = await getSpawnOpts(); } catch { current = {}; }
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
      <button class="close" title="Close">×</button>
    </div>
    ${envHint}
    <div class="settings-body"></div>
    <div class="settings-foot">
      <button class="apply">Apply &amp; restart agent</button>
      <button class="cancel">Cancel</button>
      <div class="settings-warn">Applying restarts the grok agent child. The current session ends; a new one starts.</div>
    </div>
  `;
  const body = panel.querySelector('.settings-body');
  for (const f of FIELDS) body.appendChild(fieldEl(f, current[f.key]));
  panel.querySelector('.close').addEventListener('click', close);
  panel.querySelector('.cancel').addEventListener('click', close);
  panel.querySelector('.apply').addEventListener('click', apply);
  panel.classList.add('open');
}

function close() { panel?.classList.remove('open'); }

async function apply() {
  const opts = collectValues();
  setBusy(true);
  setStatus('respawning agent…', 'busy');
  close();
  try {
    await postRespawn(opts);
    toast('Session restarted with new settings');
  } catch (e) {
    addError(`respawn failed: ${e.message}`);
    setBusy(false);
  }
}

export function initSettings() {
  const btn = document.getElementById('customize-btn');
  if (btn) btn.addEventListener('click', open);
}
