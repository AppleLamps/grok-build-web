// Topbar wiring: share button + update-available banner.

import { cliShare, cliUpdateCheck } from './api.js';
import { toast, toastLink } from './toast.js';
import { escapeAttr, escapeHTML, safeHttpUrl } from './markdown.js';
import { modal } from './modal.js';
import { state } from './state.js';
import { newSessionAction } from './sidebar.js';
import { setStatus, addError } from './chat.js';
import { setBusy } from './composer.js';

function openWorkspacePicker() {
  const current = state.currentCwd ?? '';
  const wrap = document.createElement('form');
  wrap.className = 'workspace-form';
  wrap.innerHTML = `
    <label>
      <span>Workspace path</span>
      <input type="text" name="cwd" value="${escapeHTML(current)}" placeholder="C:\\path\\to\\project" />
    </label>
    <div class="workspace-actions">
      <button class="apply" type="submit">Start session</button>
      <button class="cancel" type="button">Cancel</button>
    </div>
  `;
  const { close } = modal('Change workspace', wrap);
  wrap.querySelector('.cancel').addEventListener('click', close);
  wrap.addEventListener('submit', async (e) => {
    e.preventDefault();
    const cwd = new FormData(wrap).get('cwd')?.toString().trim();
    if (!cwd) return;
    close();
    setBusy(true);
    setStatus('starting workspace…', 'busy');
    try {
      await newSessionAction(cwd);
    } catch (err) {
      addError(`workspace change failed: ${err.message}`);
      setBusy(false);
    }
  });
  wrap.querySelector('input')?.focus();
}

async function copyShareUrl(url) {
  if (!navigator.clipboard?.writeText) return false;
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    return false;
  }
}

function showShareFallback(url) {
  const wrap = document.createElement('div');
  wrap.className = 'share-fallback';
  wrap.innerHTML = `
    <p>Copy this share link:</p>
    <input type="text" readonly value="${escapeAttr(url)}" />
    <div class="workspace-actions">
      <button class="apply" type="button">Copy</button>
      <button class="cancel" type="button">Close</button>
    </div>
  `;
  const { close } = modal('Share link', wrap);
  const input = wrap.querySelector('input');
  wrap.querySelector('.cancel').addEventListener('click', close);
  wrap.querySelector('.apply').addEventListener('click', async () => {
    input.select();
    const copied = await copyShareUrl(url);
    if (!copied) document.execCommand?.('copy');
    toast('Share link copied');
  });
  input.focus();
  input.select();
}

const MAX_TOOL_IO = 2000;

function formatToolIO(val) {
  if (val == null) return '';
  const s = typeof val === 'string' ? val : JSON.stringify(val, null, 2);
  if (s.length <= MAX_TOOL_IO) return s;
  return s.slice(0, MAX_TOOL_IO) + '\n… (truncated)';
}

function formatExportMarkdown() {
  const turns = state.exportTurns;
  if (!turns.length) return null;
  const folder = (state.currentCwd ?? '').split(/[\\/]/).filter(Boolean).pop() ?? 'session';
  const now = new Date().toLocaleString();
  let md = `# Chat Export\n\n`;
  md += `**Project:** ${state.currentCwd ?? folder}\n`;
  md += `**Session:** ${state.currentSessionId ?? 'unknown'}\n`;
  md += `**Exported:** ${now}\n\n---\n`;
  let turnNum = 0;
  for (const turn of turns) {
    turnNum++;
    md += `\n`;
    if (turn.user) {
      md += `## User\n\n${turn.user}\n\n`;
    }
    if (turn.thinking) {
      md += `## Thinking\n\n${turn.thinking}\n\n`;
    }
    if (turn.tools.length) {
      md += `## Tool Calls\n\n`;
      for (const tool of turn.tools) {
        const icon = tool.status === 'completed' ? '+' : tool.status === 'failed' ? 'x' : '~';
        md += `### [${icon}] ${tool.title}`;
        if (tool.kind) md += ` (${tool.kind})`;
        md += `\n\n`;
        if (tool.input) {
          md += `**Input:**\n\`\`\`\n${formatToolIO(tool.input)}\n\`\`\`\n\n`;
        }
        if (tool.output) {
          md += `**Output:**\n\`\`\`\n${formatToolIO(tool.output)}\n\`\`\`\n\n`;
        }
      }
    }
    if (turn.assistant) {
      md += `## Assistant\n\n${turn.assistant}\n\n`;
    }
    if (turn.hooks.length) {
      for (const hook of turn.hooks) {
        const ms = hook.elapsedMs != null ? ` (${hook.elapsedMs}ms)` : '';
        md += `> hook ${hook.event} → ${hook.name}: ${hook.status}${ms}\n`;
      }
      md += `\n`;
    }
    md += `---\n`;
  }
  return md;
}

function triggerDownload(content, filename) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function initTopbar() {
  const workspaceBtn = document.getElementById('workspace-btn');
  if (workspaceBtn) workspaceBtn.addEventListener('click', openWorkspacePicker);

  const exportBtn = document.getElementById('export-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      const md = formatExportMarkdown();
      if (!md) {
        toast('No messages to export.');
        return;
      }
      const folder = (state.currentCwd ?? '').split(/[\\/]/).filter(Boolean).pop() ?? 'session';
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      triggerDownload(md, `${folder}-${ts}.md`);
      toast('Chat exported.');
    });
  }

  // Share button
  const shareBtn = document.getElementById('share-btn');
  if (shareBtn) {
    shareBtn.addEventListener('click', async () => {
      if (!state.currentSessionId) {
        toast('No active session to share.');
        return;
      }
      const prevTitle = shareBtn.title;
      shareBtn.disabled = true;
      shareBtn.title = 'Sharing...';
      try {
        const r = await cliShare(state.currentSessionId);
        if (r.url) {
          // r.url comes from a regex over grok stdout, so validate before use.
          // Validate it's actually an http(s) URL too, in case the regex over-matched.
          const safeUrl = safeHttpUrl(r.url);
          if (safeUrl) {
            const copied = await copyShareUrl(safeUrl);
            if (copied) {
              toastLink('Share link copied: ', safeUrl, { duration: 8000 });
            } else {
              showShareFallback(safeUrl);
            }
          } else {
            toast('Share returned an unrecognized URL. Check the output.');
          }
        } else if (r.ok) {
          toast(r.output?.trim() || 'Share completed');
        } else {
          toast(`Share failed: ${r.error ?? '(unknown)'}`);
        }
      } catch (e) {
        toast(`Share failed: ${e.message}`);
      } finally {
        shareBtn.disabled = false;
        shareBtn.title = prevTitle;
      }
    });
  }

  // Update banner: non-blocking, fail silently if grok update is unavailable.
  cliUpdateCheck().then((data) => {
    // Schema: { update_available: bool, current: "0.1.x", latest: "0.1.y", ... }
    // Some grok versions may return different keys; we read defensively.
    const available = data?.update_available ?? data?.updateAvailable ?? false;
    const latest = data?.latest ?? data?.latest_version ?? data?.latestVersion;
    const current = data?.current ?? data?.current_version ?? data?.currentVersion;
    const releaseUrl = safeHttpUrl(
      data?.release_notes_url ?? data?.releaseNotesUrl ?? data?.release_url ?? data?.releaseUrl ?? ''
    );
    if (!available || !latest || !current) return;
    const slot = document.getElementById('update-slot');
    if (!slot) return;
    const banner = document.createElement('div');
    banner.className = 'update-banner';
    const releaseLink = releaseUrl
      ? `<a href="${escapeAttr(releaseUrl)}" target="_blank" rel="noopener">Release notes</a>`
      : '';
    banner.innerHTML = `
      <span class="update-dot" aria-hidden="true"></span>
      <span class="update-copy"><strong>grok ${escapeHTML(latest)} is available</strong><span>You have ${escapeHTML(current)}. Run <code>grok update</code> to install.</span></span>
      ${releaseLink}
      <button class="close" type="button" title="Dismiss update notice" aria-label="Dismiss update notice">×</button>
    `;
    banner.querySelector('.close').addEventListener('click', () => {
      banner.remove();
      slot.hidden = true;
    });
    slot.replaceChildren(banner);
    slot.hidden = false;
  }).catch(() => {});
}
