// Read-only panels backed by `/cli/*` endpoints: Inspect, MCP, Worktrees,
// Plugins, Hooks, Models. Wired to a "Tools" menu in the sidebar.

import {
  cliHeadless,
  cliInspect,
  cliMcp,
  cliWorktree,
  cliModels,
  cliTrace,
  cliMemoryList,
  cliMemoryRead,
  getSpawnOpts,
  getSettings,
} from './api.js';
import { modal } from './modal.js';
import { toast } from './toast.js';
import { state, TAB_SESSION_ID } from './state.js';
import { escapeHTML } from './markdown.js';
import { el } from './ui/dom.js';

async function showJsonPanel(title, fetcher) {
  const { body } = modal(title, panelMessage('div', 'panel-loading', 'Loading…'));
  try {
    const data = await fetcher();
    const pretty = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    body.innerHTML = '';
    body.appendChild(panelMessage('pre', 'panel-content', pretty));
  } catch (e) {
    body.innerHTML = '';
    body.appendChild(panelMessage('div', 'panel-error', String(e?.message ?? e)));
  }
}

function panelMessage(tag, className, text) {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = text;
  return el;
}

export function showInspect() {
  return showJsonPanel('Grok inspect (current cwd)', cliInspect);
}
export function showMcp() {
  return showJsonPanel('MCP servers', cliMcp);
}
export function showWorktrees() {
  return showJsonPanel('Worktrees', cliWorktree);
}
export function showModels() {
  return showJsonPanel('Available models', cliModels);
}

export function showHeadlessRun() {
  const result = el('pre', {
    className: 'panel-content headless-result',
    attrs: { hidden: true, 'aria-live': 'polite' },
  });
  const runButton = el('button', { className: 'headless-run', text: 'Run headless', attrs: { type: 'submit' } });
  const sessionMode = selectField('Session', 'sessionMode', [
    ['new', 'New one-shot'],
    ['session', 'Named session'],
    ['resume', 'Resume session'],
    ['continue', 'Continue latest'],
  ]);
  const sessionId = textField('Session ID', 'sessionId', 'name-or-id', 'Used with Named session.');
  const resumeId = textField('Resume ID', 'resumeId', 'optional session id', 'Leave blank to resume the latest session.');
  const form = el(
    'form',
    { className: 'headless-panel' },
    el(
      'div',
      { className: 'headless-grid' },
      selectField('Output', 'outputFormat', [
        ['plain', 'plain'],
        ['json', 'json'],
        ['streaming-json', 'streaming-json'],
      ]),
      sessionMode,
      sessionId,
      resumeId,
      textField('CWD', 'cwd', state.currentCwd || 'current server cwd', 'Optional working directory for this run.'),
      textField('Model', 'model', 'default model', 'Optional model ID.'),
      selectField('Effort', 'effort', [
        ['', '(default)'],
        ['low', 'low'],
        ['medium', 'medium'],
        ['high', 'high'],
        ['xhigh', 'xhigh'],
        ['max', 'max'],
      ]),
      numberField('Max turns', 'maxTurns', 'Optional turn limit.'),
    ),
    checkboxField('Always approve tool requests', 'alwaysApprove', true),
    textareaField('Prompt', 'text', 'Describe the headless task to run.'),
    el('div', { className: 'headless-actions' }, runButton),
    result,
  );
  const sessionSelect = sessionMode.querySelector('[name="sessionMode"]');
  const syncSessionFields = () => {
    const mode = sessionSelect.value;
    sessionId.hidden = mode !== 'session';
    resumeId.hidden = mode !== 'resume';
  };
  sessionSelect.addEventListener('change', syncSessionFields);
  syncSessionFields();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = collectHeadlessForm(form);
    runButton.disabled = true;
    runButton.textContent = 'Running...';
    result.hidden = false;
    result.textContent = 'Running headless command...';
    try {
      const data = await cliHeadless(body);
      result.textContent = formatHeadlessResult(data);
      if (data.ok) toast('Headless run complete');
    } catch (e) {
      result.textContent = String(e?.message ?? e);
    } finally {
      runButton.disabled = false;
      runButton.textContent = 'Run headless';
    }
  });

  modal('Headless run', form);
  return form;
}

export async function showSessionInfo() {
  const { body } = modal('Session info', panelMessage('div', 'panel-loading', 'Loading…'));
  const sid = state.currentSessionId ?? TAB_SESSION_ID ?? null;
  const cwd = state.currentCwd ?? null;
  const titleRecord = state.recentsCache.find((s) => s.id === sid);
  const usage = state.lastUsage;
  let spawnOpts = {};
  let settings = {};
  try {
    [spawnOpts, settings] = await Promise.all([getSpawnOpts().catch(() => ({})), getSettings().catch(() => ({}))]);
  } catch {}

  body.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'session-info-grid';
  const rows = [
    ['Session ID', sid || '(none)'],
    ['Title', titleRecord?.title || '(no recent metadata)'],
    ['CWD', cwd || '(not yet known)'],
    ['Model', spawnOpts.model || '(default)'],
    ['Agent', spawnOpts.agent || '(default)'],
    ['Subagent definitions', spawnOpts.agents ? 'configured' : '(none)'],
    ['Effort', spawnOpts.effort ?? '(default)'],
    ['Reasoning effort', spawnOpts.reasoningEffort ?? '(default)'],
    ['Max turns', spawnOpts.maxTurns ?? '(unlimited)'],
    ['Always approve', String(settings.autoApprove ?? spawnOpts.alwaysApprove ?? false)],
    ['Permission mode', spawnOpts.permissionMode ?? '(default)'],
    ['Sandbox', spawnOpts.sandbox ?? '(none)'],
    ['Compaction mode', spawnOpts.compactionMode ?? '(default)'],
    ['Compaction detail', spawnOpts.compactionDetail ?? '(default)'],
    ['Memory flag', flagSummary(spawnOpts)],
    ['Telemetry active', telemetrySummary(spawnOpts._env)],
    ['Telemetry config', telemetryConfigSummary(spawnOpts._env)],
    ['Turns this tab', String(state.turnCount)],
    ['Last total tokens', usage ? formatTokens(usage.totalTokens) : '(none yet)'],
    ['Context window', usage ? formatTokens(usage.contextTokens) : '(unknown)'],
    ['Context usage', usage ? `${usage.percent.toFixed(1)}%` : '(none yet)'],
    ['Last compaction', compactionSummary(state.lastCompaction)],
    ['Messages in session', titleRecord?.numMessages != null ? String(titleRecord.numMessages) : '(unknown)'],
    ['Last activity', titleRecord?.lastActive ? new Date(titleRecord.lastActive).toLocaleString() : '(unknown)'],
  ];
  for (const [label, value] of rows) {
    const dt = document.createElement('div');
    dt.className = 'session-info-key';
    dt.textContent = label;
    const dd = document.createElement('div');
    dd.className = 'session-info-val';
    dd.textContent = String(value);
    grid.appendChild(dt);
    grid.appendChild(dd);
  }
  body.appendChild(grid);
}

function flagSummary(opts) {
  const flags = [];
  if (opts.experimentalMemory) flags.push('experimental-memory');
  if (opts.noMemory) flags.push('no-memory');
  if (opts.todoGate) flags.push('todo-gate');
  if (opts.noSubagents) flags.push('no-subagents');
  if (opts.restoreCode) flags.push('restore-code');
  return flags.length ? flags.join(', ') : '(none)';
}

function telemetrySummary(env = {}) {
  return hasTelemetryEnv(env) ? 'yes' : 'no';
}

function telemetryConfigSummary(env = {}) {
  const names = [];
  if (env?.GROK_OTEL_ENABLED_set) names.push('GROK_OTEL_ENABLED');
  if (env?.OTEL_EXPORTER_OTLP_ENDPOINT_set) names.push('OTEL_EXPORTER_OTLP_ENDPOINT');
  if (env?.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT_set) names.push('OTEL_EXPORTER_OTLP_TRACES_ENDPOINT');
  if (env?.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT_set) names.push('OTEL_EXPORTER_OTLP_METRICS_ENDPOINT');
  if (env?.OTEL_SERVICE_NAME_set) names.push('OTEL_SERVICE_NAME');
  return names.length ? names.join(', ') : '(none)';
}

function hasTelemetryEnv(env = {}) {
  return !!(
    env?.GROK_OTEL_ENABLED_set ||
    env?.OTEL_EXPORTER_OTLP_ENDPOINT_set ||
    env?.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT_set ||
    env?.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT_set
  );
}

function compactionSummary(meta) {
  if (!meta) return '(none yet)';
  const parts = [];
  if (meta.status) parts.push(meta.status);
  if (meta.beforeTokens != null && meta.afterTokens != null) {
    parts.push(`${formatTokens(meta.beforeTokens)} -> ${formatTokens(meta.afterTokens)}`);
  }
  if (meta.reductionPercent != null) parts.push(`${Number(meta.reductionPercent).toFixed(1).replace(/\.0$/, '')}%`);
  if (meta.transcriptPath) parts.push(`transcript: ${meta.transcriptPath}`);
  if (meta.segmentsPath) parts.push(`segments: ${meta.segmentsPath}`);
  if (meta.summaryQuality != null) parts.push(`quality: ${meta.summaryQuality}`);
  if (meta.error) parts.push(`error: ${meta.error}`);
  return parts.join(' | ') || 'metadata received';
}

function textField(label, name, placeholder = '', hint = '') {
  return fieldWrap(
    label,
    name,
    el('input', {
      attrs: { name, type: 'text', placeholder },
      props: { type: 'text' },
    }),
    hint,
  );
}

function numberField(label, name, hint = '') {
  return fieldWrap(
    label,
    name,
    el('input', {
      attrs: { name, type: 'number', min: '1', placeholder: 'optional' },
      props: { type: 'number' },
    }),
    hint,
  );
}

function textareaField(label, name, placeholder = '') {
  return fieldWrap(
    label,
    name,
    el('textarea', {
      attrs: { name, rows: '7', placeholder },
    }),
  );
}

function selectField(label, name, options) {
  const select = el('select', { attrs: { name } });
  for (const [value, text] of options) {
    select.appendChild(el('option', { text, attrs: { value } }));
  }
  return fieldWrap(label, name, select);
}

function checkboxField(label, name, checked = false) {
  return el(
    'label',
    { className: 'headless-check' },
    el('input', {
      attrs: { name, type: 'checkbox' },
      props: { type: 'checkbox', checked },
    }),
    el('span', { text: label }),
  );
}

function fieldWrap(label, name, input, hint = '') {
  return el(
    'label',
    { className: 'headless-field' },
    el('span', { text: label }),
    input,
    hint ? el('small', { text: hint }) : null,
  );
}

function collectHeadlessForm(form) {
  const value = (name) => form.querySelector(`[name="${name}"]`)?.value?.trim() ?? '';
  const body = {
    text: value('text'),
    outputFormat: value('outputFormat') || 'plain',
    sessionMode: value('sessionMode') || 'new',
    cwd: value('cwd') || null,
    model: value('model') || null,
    effort: value('effort') || null,
    maxTurns: value('maxTurns') || null,
    alwaysApprove: !!form.querySelector('[name="alwaysApprove"]')?.checked,
  };
  if (body.sessionMode === 'session') body.sessionId = value('sessionId');
  if (body.sessionMode === 'resume') body.resumeId = value('resumeId');
  return body;
}

function formatHeadlessResult(data) {
  const args = Array.isArray(data.args) ? data.args : [];
  const lines = [
    `status: ${data.ok ? 'ok' : 'failed'}`,
    `cwd: ${data.cwd || '(server default)'}`,
    `command: grok ${args.map(quoteArg).join(' ')}`,
    '',
    'stdout:',
    data.stdout || '(empty)',
  ];
  if (data.stderr) lines.push('', 'stderr:', data.stderr);
  return lines.join('\n');
}

function quoteArg(value) {
  const text = String(value ?? '');
  if (!text) return '""';
  return /\s|["']/.test(text) ? JSON.stringify(text) : text;
}

function formatTokens(n) {
  if (n == null) return '?';
  if (n < 1000) return String(n);
  if (n < 1000000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return (n / 1000000).toFixed(2).replace(/\.00$/, '') + 'M';
}

export async function showMemory() {
  const wrap = document.createElement('div');
  wrap.className = 'memory-browser';
  wrap.innerHTML = `
    <div class="memory-list" id="memory-list"><div class="panel-loading">Loading…</div></div>
    <div class="memory-preview"><div class="panel-loading">Pick a file</div></div>
  `;
  modal('Memory', wrap);
  const listEl = wrap.querySelector('.memory-list');
  const previewEl = wrap.querySelector('.memory-preview');
  let activeBtn = null;

  async function selectFile(path, btn) {
    if (activeBtn) activeBtn.classList.remove('active');
    btn.classList.add('active');
    activeBtn = btn;
    previewEl.innerHTML = '<div class="panel-loading">Loading…</div>';
    try {
      const data = await cliMemoryRead(path);
      previewEl.innerHTML = '';
      const head = document.createElement('div');
      head.className = 'memory-preview-head';
      head.innerHTML = `<code></code><span class="memory-preview-meta"></span>`;
      head.querySelector('code').textContent = path;
      head.querySelector('.memory-preview-meta').textContent =
        `${(data.size / 1024).toFixed(1)} KB · ${new Date(data.mtime).toLocaleString()}`;
      previewEl.appendChild(head);
      const pre = document.createElement('pre');
      pre.className = 'panel-content';
      pre.textContent = data.content;
      previewEl.appendChild(pre);
    } catch (e) {
      previewEl.innerHTML = `<div class="panel-error">${escapeHTML(String(e?.message ?? e))}</div>`;
    }
  }

  function makeFileButton(path, label, sub = '') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'memory-file';
    btn.innerHTML = `<span class="memory-file-label"></span>${sub ? '<span class="memory-file-sub"></span>' : ''}`;
    btn.querySelector('.memory-file-label').textContent = label;
    if (sub) btn.querySelector('.memory-file-sub').textContent = sub;
    btn.addEventListener('click', () => selectFile(path, btn));
    return btn;
  }

  try {
    const tree = await cliMemoryList();
    listEl.innerHTML = '';
    if (!tree.global && !tree.workspaces?.length) {
      listEl.innerHTML = `<div class="empty">No memory files under ${escapeHTML(tree.root ?? '')}</div>`;
      return;
    }
    if (tree.global) {
      const head = sectionHead('Global');
      listEl.appendChild(head);
      listEl.appendChild(
        makeFileButton(tree.global.path, tree.global.name, `${(tree.global.size / 1024).toFixed(1)} KB`),
      );
    }
    for (const ws of tree.workspaces ?? []) {
      listEl.appendChild(sectionHead(ws.name));
      for (const f of ws.files) {
        listEl.appendChild(makeFileButton(f.path, f.name, `${(f.size / 1024).toFixed(1)} KB`));
      }
      if (ws.sessions.length) {
        listEl.appendChild(sectionHead(`${ws.name} · sessions`, 'sub'));
        for (const f of ws.sessions) {
          const date = new Date(f.mtime).toLocaleDateString();
          listEl.appendChild(makeFileButton(f.path, f.name, date));
        }
      }
    }
  } catch (e) {
    listEl.innerHTML = `<div class="panel-error">${escapeHTML(String(e?.message ?? e))}</div>`;
  }

  function sectionHead(label, variant = '') {
    const h = document.createElement('div');
    h.className = 'memory-section-head' + (variant ? ` ${variant}` : '');
    h.textContent = label;
    return h;
  }
}

// Hooks / Plugins are triggered via slash commands. Open the input pre-filled.
export function showHooks() {
  modal(
    'Hooks',
    commandHelp('Hooks management is via slash commands. Type:', [
      ['/hooks-list', 'list configured hooks'],
      ['/hooks-trust', 'trust current project for hooks'],
      ['/hooks-untrust', 'remove trust'],
      ['/hooks-add <path>', 'add a hook file or dir'],
      ['/hooks-remove <path>', 'remove a hook'],
    ]),
  );
}

export function showPlugins() {
  modal(
    'Plugins',
    commandHelp('Plugins management is via slash commands. Type:', [
      ['/plugins list', 'installed plugins'],
      ['/plugins trust <path>', 'trust a plugin path'],
      ['/plugins add <path>', 'add a plugin'],
      ['/plugins remove <path>', 'remove'],
      ['/reload-plugins', 'reload plugins from disk'],
    ]),
  );
}

function commandHelp(intro, commands) {
  const wrap = document.createElement('div');
  const p = document.createElement('p');
  p.textContent = intro;
  wrap.appendChild(p);
  const ul = document.createElement('ul');
  for (const [cmd, description] of commands) {
    const li = document.createElement('li');
    const code = document.createElement('code');
    code.textContent = cmd;
    li.appendChild(code);
    li.append(` — ${description}`);
    ul.appendChild(li);
  }
  wrap.appendChild(ul);
  return wrap;
}

export async function downloadTrace() {
  const sid = state.currentSessionId;
  if (!sid) {
    toast('No active session');
    return;
  }
  toast('Exporting trace…');
  try {
    const data = await cliTrace(sid);
    const tracePath = data.output_path ?? data.outputPath ?? data.path;
    if (tracePath) toast(`Trace saved to ${tracePath}`, { duration: 9000 });
    else if (data.ok) toast('Trace exported (check ~/.grok/trace-exports/)');
    else toast(`Trace failed: ${data.error ?? 'unknown'}`);
  } catch (e) {
    toast(`Trace failed: ${e.message}`);
  }
}

export const __testHeadless = {
  collectHeadlessForm,
  formatHeadlessResult,
};
