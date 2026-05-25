// Wire the sidebar "Tools" buttons + Sign-in + Import.

import { showInspect, showMcp, showWorktrees, showModels, showHooks, showPlugins, downloadTrace } from './panels.js';
import { showRoutines } from './routines.js';
import { modal } from './modal.js';
import { toast } from './toast.js';
import { loadRecents } from './sidebar.js';

const wire = (id, fn) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', fn);
};

async function showLogin() {
  const loading = document.createElement('div');
  loading.className = 'panel-loading';
  loading.textContent = 'Starting device-auth flow…';
  const { body } = modal('Sign in to Grok', loading);
  try {
    const r = await fetch('/cli/login', { method: 'POST' });
    const text = await r.text();
    body.innerHTML = '';
    const pre = document.createElement('pre');
    pre.className = 'panel-content';
    pre.textContent = text;
    body.appendChild(pre);
  } catch (e) {
    body.innerHTML = '';
    const error = document.createElement('div');
    error.className = 'panel-error';
    error.textContent = e.message;
    body.appendChild(error);
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
  wire('tool-routines',  showRoutines);
  wire('tool-hooks',     showHooks);
  wire('tool-plugins',   showPlugins);
  wire('tool-trace',     downloadTrace);
  wire('tool-import',    showImport);
  wire('login-btn',      showLogin);
}
