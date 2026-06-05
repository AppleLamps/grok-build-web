// Wire the sidebar "Tools" buttons + Sign-in + Import.

import {
  showInspect,
  showMcp,
  showWorktrees,
  showModels,
  showHeadlessRun,
  showHooks,
  showPlugins,
  downloadTrace,
  showMemory,
  showSessionInfo,
} from './panels.js';
import { showRoutines } from './routines.js';
import { modal } from './modal.js';
import { toast } from './toast.js';
import { loadRecents } from './sidebar.js';

const wire = (id, fn) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', fn);
};

const LOGIN_STATUS_INTERVAL_MS = 2000;
const LOGIN_CLOSE_DELAY_MS = 900;

async function showLogin({ pollMs = LOGIN_STATUS_INTERVAL_MS, closeDelayMs = LOGIN_CLOSE_DELAY_MS } = {}) {
  const loading = document.createElement('div');
  loading.className = 'panel-loading';
  loading.textContent = 'Starting device-auth flow...';
  const { body, close, el: dialog } = modal('Sign in to Grok', loading);
  let closed = false;
  let pollTimer = null;
  let closeTimer = null;
  const isClosed = () => closed || !dialog.parentElement;
  const scheduleClose = () => {
    clearInterval(pollTimer);
    clearTimeout(closeTimer);
    closeTimer = setTimeout(closeModal, closeDelayMs);
  };
  function closeModal() {
    closed = true;
    clearInterval(pollTimer);
    clearTimeout(closeTimer);
    close();
  }
  pollTimer = setInterval(() => {
    if (isClosed()) {
      closeModal();
      return;
    }
    pollLoginStatus(body, scheduleClose);
  }, pollMs);
  try {
    const r = await fetch('/cli/login', { method: 'POST' });
    const text = await r.text();
    if (isClosed()) return;
    body.innerHTML = '';
    const pre = document.createElement('pre');
    pre.className = 'panel-content';
    pre.textContent = text;
    const status = document.createElement('div');
    status.className = 'panel-loading login-status';
    status.textContent = 'Waiting for OAuth confirmation...';
    body.appendChild(pre);
    body.appendChild(status);
    await pollLoginStatus(body, scheduleClose);
  } catch (e) {
    if (isClosed()) return;
    clearInterval(pollTimer);
    body.innerHTML = '';
    const error = document.createElement('div');
    error.className = 'panel-error';
    error.textContent = e.message;
    body.appendChild(error);
  }
}

async function pollLoginStatus(body, scheduleClose) {
  try {
    const r = await fetch('/cli/login/status');
    if (!r.ok) return;
    const data = await r.json();
    if (!data.authenticated) return;
    let status = body.querySelector('.login-status');
    if (!status) {
      status = document.createElement('div');
      status.className = 'panel-loading login-status';
      body.appendChild(status);
    }
    status.textContent = 'Signed in to Grok.';
    scheduleClose();
  } catch {
    // Keep the device-auth prompt visible if the local status check is temporarily unavailable.
  }
}

async function showImport() {
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <p>Paste session IDs or .jsonl paths, one per line. Empty = import all available.</p>
    <textarea class="import-targets" rows="6" style="width:100%;font-family:ui-monospace,monospace;font-size:12.5px"></textarea>
    <div style="margin-top:10px;display:flex;gap:8px;justify-content:flex-end">
      <button class="import-cancel">Cancel</button>
      <button class="import-go" style="background:var(--accent);color:white;border:0;padding:7px 14px;border-radius:7px">Import</button>
    </div>
  `;
  const { close } = modal('Import sessions', wrap);
  wrap.querySelector('.import-cancel').addEventListener('click', close);
  wrap.querySelector('.import-go').addEventListener('click', async () => {
    const lines = wrap.querySelector('.import-targets').value.split('\n').map(s => s.trim()).filter(Boolean);
    const r = await fetch('/cli/import', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targets: lines }),
    });
    const data = await r.json();
    if (data.ok) { toast('Import complete'); loadRecents(); close(); }
    else toast(`Import failed: ${data.error ?? 'unknown'}`);
  });
}

export function initToolsMenu() {
  const toolsWrap = document.querySelector('.sidebar-tools');
  const toolsToggle = document.getElementById('tools-toggle');
  const toolsNav = document.getElementById('tools-nav');
  if (toolsWrap && toolsToggle && toolsNav) {
    toolsToggle.addEventListener('click', () => {
      const expanded = toolsToggle.getAttribute('aria-expanded') === 'true';
      toolsToggle.setAttribute('aria-expanded', String(!expanded));
      toolsWrap.classList.toggle('collapsed', expanded);
      toolsNav.hidden = expanded;
    });
  }

  wire('tool-inspect',   showInspect);
  wire('tool-mcp',       showMcp);
  wire('tool-worktrees', showWorktrees);
  wire('tool-models',    showModels);
  wire('tool-headless',  showHeadlessRun);
  wire('tool-routines',  showRoutines);
  wire('tool-memory',    showMemory);
  wire('tool-session-info', showSessionInfo);
  wire('usage',             showSessionInfo);
  wire('tool-hooks',     showHooks);
  wire('tool-plugins',   showPlugins);
  wire('tool-trace',     downloadTrace);
  wire('tool-import',    showImport);
  wire('login-btn',      showLogin);
}

export const __testShowLogin = showLogin;
