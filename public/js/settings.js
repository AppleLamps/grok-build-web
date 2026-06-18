// Settings panel: launch-time grok flags (effort, sandbox, rules, etc.).
// Changing any of these respawns the agent child process.

import { cliModels, getSettings, getSpawnOpts, postRespawn, setSettings } from './api.js';
import { addError, setStatus } from './chat.js';
import { setBusy } from './composer.js';
import { refreshIdentity } from './identity.js';
import { mergeModelIds } from './model-ids.js';
import { toast } from './toast.js';
import { createPanel } from './ui/dialog.js';
import { clear, el } from './ui/dom.js';
import { getString, setString } from './ui/storage.js';

let panel = null;
let panelController = null;
let current = {};
let bridgeCurrent = {};

const FIELDS = [
  {
    key: 'effort',
    label: 'Effort',
    type: 'select',
    options: ['', 'low', 'medium', 'high', 'xhigh', 'max'],
    hint: 'Overall reasoning + exploration budget.',
  },
  {
    key: 'reasoningEffort',
    label: 'Reasoning effort',
    type: 'select',
    options: ['', 'low', 'medium', 'high', 'xhigh', 'max'],
    hint: 'Specific to reasoning models.',
  },
  { key: 'maxTurns', label: 'Max turns', type: 'number', hint: 'Cap how many tool/think cycles per prompt.' },
  { key: 'sandbox', label: 'Sandbox profile', type: 'text', hint: 'Filesystem/network sandbox profile name.' },
  { key: 'model', label: 'Model', type: 'model-select', hint: 'Model ID. Leave blank to let grok pick its default.' },
  {
    key: 'agent',
    label: 'Agent',
    type: 'text',
    requiresCapability: 'agent',
    hint: 'Agent name or agent definition file path. Repeats --agent.',
  },
  {
    key: 'agents',
    label: 'Subagent definitions JSON',
    type: 'textarea',
    requiresCapability: 'agents',
    hint: 'Inline subagent definitions passed through --agents. Must be valid JSON.',
  },
  { key: 'rules', label: 'Extra rules', type: 'textarea', hint: 'Appended to the system prompt.' },
  {
    key: 'systemPromptOverride',
    label: 'System prompt override',
    type: 'textarea',
    hint: 'Replaces the default system prompt entirely.',
  },
  {
    key: 'allow',
    label: 'Allow rules (one per line)',
    type: 'lines',
    hint: 'Permission allow rules. Repeats --allow.',
  },
  { key: 'deny', label: 'Deny rules (one per line)', type: 'lines', hint: 'Permission deny rules. Repeats --deny.' },
  { key: 'tools', label: 'Tools allow-list (comma)', type: 'text', hint: 'Built-in tools to allow.' },
  { key: 'disallowedTools', label: 'Tools deny-list (comma)', type: 'text', hint: 'Built-in tools to remove.' },
  { key: 'disableWebSearch', label: 'Disable web search', type: 'checkbox' },
  { key: 'noSubagents', label: 'No subagents', type: 'checkbox' },
  { key: 'noPlan', label: 'No plan mode', type: 'checkbox' },
  { key: 'noMemory', label: 'No cross-session memory', type: 'checkbox' },
  {
    key: 'todoGate',
    label: 'Todo gate',
    type: 'checkbox',
    requiresCapability: 'todoGate',
    hint: 'Requires completed todos before the agent finishes a turn.',
  },
  {
    key: 'restoreCode',
    label: 'Restore code on session load',
    type: 'checkbox',
    hint: 'Check out the original commit when resuming a session.',
  },
  {
    key: 'alwaysApprove',
    label: 'Always approve at launch',
    type: 'checkbox',
    hint: 'Starts the agent with --always-approve when this CLI supports it.',
  },
  {
    key: 'noLeader',
    label: 'Start without shared leader',
    type: 'checkbox',
    hint: 'Starts the agent with --no-leader when this CLI supports it.',
  },
  {
    key: 'permissionMode',
    label: 'Permission mode',
    type: 'select',
    options: ['', 'default', 'acceptEdits', 'auto', 'dontAsk', 'bypassPermissions', 'plan'],
    requiresCapability: 'permissionMode',
    hint: 'Launch-time --permission-mode. Disabled unless the installed grok CLI advertises it.',
  },
  {
    key: 'compactionMode',
    label: 'Compaction mode',
    type: 'select',
    options: ['', 'summary', 'transcript', 'segments'],
    requiresCapability: 'compactionMode',
    hint: 'Launch-time --compaction-mode. Summary is the CLI default; transcript and segments persist more context pointers.',
  },
  {
    key: 'compactionDetail',
    label: 'Compaction detail',
    type: 'select',
    options: ['', 'none', 'minimal', 'balanced', 'verbose'],
    requiresCapability: 'compactionDetail',
    hint: 'Launch-time --compaction-detail for segment compaction. The CLI default is verbose.',
  },
  {
    key: 'ignoreApiKey',
    label: 'Use grok.com subscription (ignore XAI_API_KEY)',
    type: 'checkbox',
    hint: "ON by default. Strips XAI_API_KEY from the agent's env so it falls back to your grok.com login (~/.grok/auth.json) — billed against your subscription, not your API team. Uncheck to use the API key instead. Override at launch with GROK_WEB_USE_API_KEY=1.",
  },
];

const BRIDGE_FIELDS = [
  {
    key: 'displayName',
    label: 'Display name',
    type: 'text',
    hint: 'Shown in the sidebar footer. Leave blank to use your OS username.',
  },
];

const LAUNCH_SECTIONS = [
  {
    title: 'Model',
    description: 'Model choice and reasoning budget.',
    keys: ['model', 'effort', 'reasoningEffort', 'maxTurns'],
  },
  {
    title: 'Permissions',
    description: 'Approval behavior and filesystem guardrails.',
    keys: ['alwaysApprove', 'permissionMode', 'allow', 'deny', 'sandbox', 'ignoreApiKey'],
  },
  {
    title: 'Tools',
    description: 'Tool availability for the next agent process.',
    keys: ['tools', 'disallowedTools', 'disableWebSearch', 'noPlan'],
  },
  {
    title: 'Agents',
    description: 'Primary agent and inline subagent configuration.',
    keys: ['agent', 'agents', 'noSubagents'],
  },
  {
    title: 'Runtime',
    description: 'Session restore, memory, leader, and prompt overrides.',
    keys: [
      'noMemory',
      'todoGate',
      'restoreCode',
      'noLeader',
      'compactionMode',
      'compactionDetail',
      'rules',
      'systemPromptOverride',
    ],
  },
];

const FIELD_BY_KEY = new Map([...BRIDGE_FIELDS, ...FIELDS].map((field) => [field.key, field]));

function dispatchModeEl() {
  const wrap = document.createElement('div');
  wrap.className = 'setting-field';
  const lab = document.createElement('label');
  lab.htmlFor = 'setting-dispatch-mode';
  lab.textContent = 'Dispatch mode';
  const input = document.createElement('select');
  input.id = 'setting-dispatch-mode';
  input.className = 'settings-dispatch-mode';
  const composerSendMode = document.getElementById('send-mode');
  const sourceOptions = Array.from(
    composerSendMode?.options ?? [
      { value: 'agent', textContent: 'Interactive' },
      { value: 'check', textContent: '+ self-check (headless)' },
      { value: 'best3', textContent: 'Best of 3 (headless)' },
      { value: 'best5', textContent: 'Best of 5 (headless)' },
    ],
  );
  for (const opt of sourceOptions) {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.textContent;
    input.appendChild(o);
  }
  input.value = composerSendMode?.value ?? getString('grokweb.sendMode', 'agent');
  input.addEventListener('change', () => {
    if (composerSendMode) composerSendMode.value = input.value;
    setString('grokweb.sendMode', input.value);
    composerSendMode?.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const h = document.createElement('div');
  h.className = 'setting-hint';
  h.textContent = 'Controls how the next composer prompt is sent.';
  wrap.append(lab, input, h);
  return wrap;
}

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
      o.value = opt;
      o.textContent = opt || '(default)';
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
    input.type = 'number';
    input.min = 1;
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
    opt.value = value ?? '';
    opt.textContent = '(loading models…)';
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
    h.className = 'setting-hint';
    h.textContent = f.hint;
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
    else if (t === 'lines')
      opts[k] = el.value
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
    else opts[k] = el.value || null;
  }
  return opts;
}

function changedFieldLabels(values) {
  const changed = [];
  if (!sameValue(values.displayName ?? null, bridgeCurrent.displayName ?? null, 'text')) {
    changed.push('Display name');
  }
  for (const f of FIELDS) {
    if (sameValue(values[f.key], current[f.key], f.type)) continue;
    changed.push(f.label);
  }
  return changed;
}

function renderChangeSummary() {
  if (!panel) return;
  const summary = panel.querySelector('.settings-change-summary');
  if (!summary) return;
  const labels = changedFieldLabels(collectValues());
  if (!labels.length) {
    summary.textContent = 'No pending changes.';
    summary.classList.add('empty');
    return;
  }
  const shown = labels.slice(0, 4).join(', ');
  const extra = labels.length > 4 ? ` +${labels.length - 4} more` : '';
  summary.textContent = `Pending changes: ${shown}${extra}`;
  summary.classList.remove('empty');
}

function wireChangeSummary() {
  panel?.querySelectorAll('[data-key]').forEach((el) => {
    el.addEventListener('input', renderChangeSummary);
    el.addEventListener('change', renderChangeSummary);
  });
  renderChangeSummary();
}

function settingsSection({ title, description, open = false }) {
  const details = el('details', { className: 'settings-section' });
  if (open) details.open = true;
  const summary = el(
    'summary',
    { className: 'settings-section-summary' },
    el('span', { className: 'settings-section-label', text: title }),
    el('span', { className: 'settings-section-description', text: description }),
  );
  const content = el('div', { className: 'settings-section-content' });
  details.append(summary, content);
  return { details, content };
}

async function populateModelSelect(selectEl) {
  let raw = '';
  try {
    raw = await cliModels();
  } catch {
    /* fall through */
  }
  const current = selectEl.dataset.currentValue ?? '';
  const ids = mergeModelIds(raw, current);
  clear(selectEl);
  const opts = ['', ...ids];
  for (const id of opts) {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = id || '(default)';
    if (id === current) o.selected = true;
    selectEl.appendChild(o);
  }
}

function envHintEl(apiKeyEnv, ignoring) {
  if (apiKeyEnv && ignoring) {
    return el(
      'div',
      { className: 'settings-env-hint' },
      el('strong', { text: 'Using grok.com subscription.' }),
      ' XAI_API_KEY is in your shell but grok-web is ignoring it by default. Uncheck ',
      el('em', { text: 'Use grok.com subscription' }),
      ' below to switch back to API-team billing.',
    );
  }
  if (apiKeyEnv && !ignoring) {
    return el(
      'div',
      { className: 'settings-env-hint warn' },
      el('strong', { text: 'Using XAI_API_KEY (API-team billing).' }),
      ' If you have a Grok SuperHeavy / SuperGrok subscription, check ',
      el('em', { text: 'Use grok.com subscription' }),
      ' below to use it instead.',
    );
  }
  if (!apiKeyEnv) {
    return el(
      'div',
      { className: 'settings-env-hint' },
      el('strong', { text: 'Using grok.com subscription.' }),
      ' No XAI_API_KEY in env; the agent uses your cached grok.com login from ',
      el('code', { text: '~/.grok/auth.json' }),
      '.',
    );
  }
  return null;
}

async function open() {
  if (!panelController) {
    panelController = createPanel({
      className: 'settings-panel',
      title: 'Session settings',
      closeLabel: 'Close settings',
      describedBy: 'settings-warn',
    });
    panel = panelController.panel;
    document.body.appendChild(panel);
  }
  const results = await Promise.allSettled([getSpawnOpts(), getSettings()]);
  current = results[0].status === 'fulfilled' ? results[0].value : {};
  bridgeCurrent = results[1].status === 'fulfilled' ? results[1].value : {};
  const apiKeyEnv = current?._env?.XAI_API_KEY_set;
  const ignoring = current?.ignoreApiKey;
  const hint = envHintEl(apiKeyEnv, ignoring);

  const body = panelController.body;
  const foot = panelController.foot;
  clear(body);
  clear(foot);
  if (hint) body.appendChild(hint);
  const profile = settingsSection({
    title: 'Profile',
    description: 'Local identity shown in the sidebar.',
    open: true,
  });
  for (const f of BRIDGE_FIELDS) profile.content.appendChild(fieldEl(f, bridgeCurrent[f.key]));
  body.appendChild(profile.details);

  const composer = settingsSection({
    title: 'Composer',
    description: 'How the next prompt is dispatched.',
    open: true,
  });
  composer.content.appendChild(dispatchModeEl());
  body.appendChild(composer.details);

  for (const section of LAUNCH_SECTIONS) {
    const part = settingsSection(section);
    for (const key of section.keys) {
      const field = FIELD_BY_KEY.get(key);
      if (field) part.content.appendChild(fieldEl(field, current[field.key]));
    }
    body.appendChild(part.details);
  }
  foot.append(
    el('div', {
      className: 'settings-change-summary empty',
      text: 'No pending changes.',
      attrs: { id: 'settings-change-summary' },
    }),
    el('button', { className: 'apply', text: 'Apply settings', attrs: { type: 'button' }, on: { click: apply } }),
    el('button', { className: 'cancel', text: 'Cancel', attrs: { type: 'button' }, on: { click: close } }),
    el('div', {
      className: 'settings-warn',
      text: 'Launch flag changes restart the grok agent child. Display name changes apply immediately.',
      attrs: { id: 'settings-warn' },
    }),
  );
  wireChangeSummary();
  panelController.open();
}

function close() {
  panelController?.close();
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
  if (type === 'checkbox') return !!a === !!b;
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
