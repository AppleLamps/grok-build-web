// Topbar wiring: share button + update-available banner.

import { cliShare, cliUpdateCheck } from './api.js';
import { toast } from './toast.js';
import { escapeHTML } from './markdown.js';
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
      <input type="text" name="cwd" value="${escapeHTML(current)}" placeholder="C:\\Users\\lucas\\project" />
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

export function initTopbar() {
  const workspaceBtn = document.getElementById('workspace-btn');
  if (workspaceBtn) workspaceBtn.addEventListener('click', openWorkspacePicker);

  // Share button
  const shareBtn = document.querySelector('.topbar .actions button[title="Share"]');
  if (shareBtn) {
    shareBtn.addEventListener('click', async () => {
      shareBtn.disabled = true;
      try {
        const r = await cliShare(state.currentSessionId);
        if (r.url) {
          // r.url comes from a regex over grok stdout — escape before injecting.
          // Validate it's actually an http(s) URL too, in case the regex over-matched.
          let safeUrl = r.url;
          try { const u = new URL(r.url); if (!/^https?:$/.test(u.protocol)) safeUrl = ''; }
          catch { safeUrl = ''; }
          if (safeUrl) {
            await navigator.clipboard?.writeText(safeUrl).catch(() => {});
            const e = escapeHTML(safeUrl);
            toast(`Share link copied: <a href="${e}" target="_blank" rel="noopener">${e}</a>`, { html: true, duration: 8000 });
          } else {
            toast('Share returned an unrecognized URL — check the output');
          }
        } else if (r.ok) {
          toast(r.output?.trim() || 'Share completed');
        } else {
          toast(`Share failed: ${r.error ?? '(unknown)'}`);
        }
      } catch (e) {
        toast(`Share failed: ${e.message}`);
      } finally { shareBtn.disabled = false; }
    });
  }

  // Update banner — non-blocking, fail silently if grok update isn't available.
  cliUpdateCheck().then((data) => {
    // Schema: { update_available: bool, current: "0.1.x", latest: "0.1.y", ... }
    // Some grok versions may return different keys; we read defensively.
    const available = data?.update_available ?? data?.updateAvailable ?? false;
    const latest = data?.latest ?? data?.latest_version;
    const current = data?.current ?? data?.current_version;
    if (!available) return;
    const banner = document.createElement('div');
    banner.className = 'update-banner';
    banner.innerHTML = `
      <span>grok ${latest} available (you have ${current}).</span>
      <a href="https://x.ai" target="_blank">See release notes</a>
      <span>· Run <code>grok update</code> to install.</span>
      <span class="close" title="Dismiss">×</span>
    `;
    banner.querySelector('.close').addEventListener('click', () => banner.remove());
    document.body.insertBefore(banner, document.querySelector('main'));
  }).catch(() => {});
}
