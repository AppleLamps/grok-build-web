// Read-only panels backed by `/cli/*` endpoints: Inspect, MCP, Worktrees,
// Plugins, Hooks, Models. Wired to a "Tools" menu in the sidebar.

import { cliInspect, cliMcp, cliWorktree, cliModels, cliTrace } from './api.js';
import { modal } from './modal.js';
import { toast } from './toast.js';
import { state } from './state.js';

async function showJsonPanel(title, fetcher) {
  const { body } = modal(title, '<div class="panel-loading">Loading…</div>');
  try {
    const data = await fetcher();
    const pretty = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    body.innerHTML = `<pre class="panel-content">${escapeForHtml(pretty)}</pre>`;
  } catch (e) {
    body.innerHTML = `<div class="panel-error">${escapeForHtml(String(e?.message ?? e))}</div>`;
  }
}

function escapeForHtml(s) {
  return s.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
}

export function showInspect()   { return showJsonPanel('Grok inspect (current cwd)', cliInspect); }
export function showMcp()       { return showJsonPanel('MCP servers', cliMcp); }
export function showWorktrees() { return showJsonPanel('Worktrees', cliWorktree); }
export function showModels()    { return showJsonPanel('Available models', cliModels); }

// Hooks / Plugins are triggered via slash commands. Open the input pre-filled.
export function showHooks() {
  const lines = [
    '<p>Hooks management is via slash commands. Type:</p>',
    '<ul>',
    '<li><code>/hooks-list</code> — list configured hooks</li>',
    '<li><code>/hooks-trust</code> — trust current project for hooks</li>',
    '<li><code>/hooks-untrust</code> — remove trust</li>',
    '<li><code>/hooks-add &lt;path&gt;</code> — add a hook file or dir</li>',
    '<li><code>/hooks-remove &lt;path&gt;</code> — remove a hook</li>',
    '</ul>',
  ].join('');
  modal('Hooks', lines);
}

export function showPlugins() {
  const lines = [
    '<p>Plugins management is via slash commands. Type:</p>',
    '<ul>',
    '<li><code>/plugins list</code> — installed plugins</li>',
    '<li><code>/plugins trust &lt;path&gt;</code> — trust a plugin path</li>',
    '<li><code>/plugins add &lt;path&gt;</code> — add a plugin</li>',
    '<li><code>/plugins remove &lt;path&gt;</code> — remove</li>',
    '<li><code>/reload-plugins</code> — reload plugins from disk</li>',
    '</ul>',
  ].join('');
  modal('Plugins', lines);
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
