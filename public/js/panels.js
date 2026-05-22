// Read-only panels backed by `/cli/*` endpoints: Inspect, MCP, Worktrees,
// Plugins, Hooks, Models. Wired to a "Tools" menu in the sidebar.

import { cliInspect, cliMcp, cliWorktree, cliModels, cliTrace } from './api.js';
import { modal } from './modal.js';
import { toast } from './toast.js';
import { state } from './state.js';

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

export function showInspect()   { return showJsonPanel('Grok inspect (current cwd)', cliInspect); }
export function showMcp()       { return showJsonPanel('MCP servers', cliMcp); }
export function showWorktrees() { return showJsonPanel('Worktrees', cliWorktree); }
export function showModels()    { return showJsonPanel('Available models', cliModels); }

// Hooks / Plugins are triggered via slash commands. Open the input pre-filled.
export function showHooks() {
  modal('Hooks', commandHelp('Hooks management is via slash commands. Type:', [
    ['/hooks-list', 'list configured hooks'],
    ['/hooks-trust', 'trust current project for hooks'],
    ['/hooks-untrust', 'remove trust'],
    ['/hooks-add <path>', 'add a hook file or dir'],
    ['/hooks-remove <path>', 'remove a hook'],
  ]));
}

export function showPlugins() {
  modal('Plugins', commandHelp('Plugins management is via slash commands. Type:', [
    ['/plugins list', 'installed plugins'],
    ['/plugins trust <path>', 'trust a plugin path'],
    ['/plugins add <path>', 'add a plugin'],
    ['/plugins remove <path>', 'remove'],
    ['/reload-plugins', 'reload plugins from disk'],
  ]));
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
  if (!sid) { toast('No active session'); return; }
  toast('Exporting trace…');
  try {
    const data = await cliTrace(sid);
    const tracePath = data.output_path ?? data.outputPath ?? data.path;
    if (tracePath) toast(`Trace saved to ${tracePath}`, { duration: 9000 });
    else if (data.ok) toast('Trace exported (check ~/.grok/trace-exports/)');
    else toast(`Trace failed: ${data.error ?? 'unknown'}`);
  } catch (e) { toast(`Trace failed: ${e.message}`); }
}
