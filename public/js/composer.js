// Composer: textarea + send/stop + mode pill.
// Also owns the global "busy" UI state (send hidden / stop shown).

import { state, dom } from './state.js';
import { postPrompt, postCancel, getSettings, setSettings, cliOneshot } from './api.js';
import { addError, setStatus, appendMessage, addUserItem } from './chat.js';
import { getPendingAttachments, clearAttachments, hasPendingAttachments } from './attachments.js';
import { getString, setString } from './ui/storage.js';

let busyState = false;
let sessionReady = false;

export function setBusy(busy) {
  busyState = !!busy;
  renderComposerAvailability();
}

export function setSessionReady(ready) {
  sessionReady = !!ready;
  renderComposerAvailability();
}

function renderComposerAvailability() {
  dom.sendBtn.disabled = busyState || !sessionReady;
  dom.sendBtn.style.display = busyState ? 'none' : '';
  dom.stopBtn.style.display = busyState ? '' : 'none';
  const wrap = dom.input.closest?.('.input-wrap');
  wrap?.classList.toggle('session-pending', !sessionReady);
  wrap?.setAttribute('data-session-state', sessionReady ? 'ready' : 'starting');
  dom.form?.classList.toggle('session-pending', !sessionReady);
  if (!sessionReady) {
    dom.sendBtn.title = 'Waiting for the local Grok session to finish starting';
    dom.sendBtn.setAttribute('aria-disabled', 'true');
  } else {
    dom.sendBtn.toggleAttribute?.('aria-disabled', false);
  }
}

export function renderModePill() {
  if (state.autoApprove) {
    dom.modePill.textContent = 'Auto-approve';
    dom.modePill.className = 'mode-pill auto';
  } else {
    dom.modePill.textContent = 'Manual approval';
    dom.modePill.className = 'mode-pill manual';
  }
  dom.modePill?.setAttribute('aria-pressed', String(!!state.autoApprove));
}

function autoSize() {
  const wrap = dom.input.closest?.('.input-wrap');
  dom.input.style.height = 'auto';
  const nextHeight = Math.min(220, dom.input.scrollHeight || 26);
  dom.input.style.height = `${nextHeight}px`;
  wrap?.classList.toggle('multiline', nextHeight > 38 || dom.input.value.includes('\n'));
  updateEmptyCaret();
}

function updateEmptyCaret() {
  const wrap = dom.input.closest?.('.input-wrap');
  const show = document.activeElement === dom.input && dom.input.value.length === 0;
  wrap?.classList.toggle('empty-focused', show);
}

export function initComposer() {
  const savedSendMode = getString('grokweb.sendMode');
  const hasSavedSendMode = savedSendMode && Array.from(dom.sendMode?.options ?? []).some((opt) => opt.value === savedSendMode);
  if (hasSavedSendMode) {
    dom.sendMode.value = savedSendMode;
  }

  dom.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = dom.input.value.trim();
    if (!sessionReady) {
      setStatus('waiting for session…', 'busy');
      return;
    }
    if (dom.sendBtn.disabled) return;
    if (!text && !hasPendingAttachments()) return;
    const attachments = getPendingAttachments();
    dom.input.value = ''; autoSize();
    clearAttachments();
    setBusy(true);
    const mode = dom.sendMode?.value ?? 'agent';
    if (mode === 'agent') {
      try {
        const r = await postPrompt(text, attachments);
        if (!r.ok) { addError(`prompt failed: ${r.status} ${await r.text()}`); setBusy(false); }
      } catch (err) {
        addError(`network error: ${err.message}`); setBusy(false);
      }
    } else {
      // Headless one-shot via /cli/oneshot — used for --check and --best-of-n
      // which are unavailable through the interactive agent stdio connection.
      const body = { text };
      if (mode === 'check') body.check = true;
      if (mode === 'best3') body.bestOfN = 3;
      if (mode === 'best5') body.bestOfN = 5;
      if (state.currentCwd) body.cwd = state.currentCwd;
      addUserItem(text);
      setStatus(`running headless (${mode})…`, 'busy');
      try {
        const data = await cliOneshot(body);
        // Streaming-json output: parse each line. We accumulate `text` events,
        // surface any `error` events, and use the `end` summary if present.
        const lines = (data.stdout ?? '').split('\n').filter(Boolean);
        let combined = '';
        let saw = { text: 0, error: 0, end: false };
        const errors = [];
        for (const line of lines) {
          let ev;
          try { ev = JSON.parse(line); } catch { continue; }
          if (ev.type === 'text' && ev.data) { combined += ev.data; saw.text++; }
          else if (ev.type === 'error') { errors.push(ev.message ?? JSON.stringify(ev)); saw.error++; }
          else if (ev.type === 'end') { saw.end = true; if (ev.text) combined = ev.text; }
        }
        if (errors.length) addError(`headless errors:\n${errors.join('\n')}`);
        if (!data.ok && data.stderr) addError(`headless stderr:\n${data.stderr.slice(0, 1000)}`);
        if (combined) appendMessage(combined);
        else if (!errors.length) appendMessage('(no output — check ‘headless errors’ above or composer status)');
        setStatus(data.ok ? 'done · headless' : 'headless failed', data.ok ? 'ready' : 'disconnected');
      } catch (err) {
        addError(`headless run failed: ${err.message}`);
      }
      setBusy(false);
    }
  });

  dom.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); dom.form.requestSubmit(); }
  });
  dom.input.addEventListener('input', autoSize);
  dom.input.addEventListener('focus', updateEmptyCaret);
  dom.input.addEventListener('blur', updateEmptyCaret);
  dom.sendMode?.addEventListener('change', () => {
    setString('grokweb.sendMode', dom.sendMode.value);
  });
  dom.input.focus({ preventScroll: true });
  updateEmptyCaret();

  // Welcome-tile shortcuts: clicking a starter tile fills the composer and sends.
  document.querySelectorAll('.welcome-tile').forEach((tile) => {
    tile.addEventListener('click', () => {
      const text = tile.dataset.prompt;
      if (!text) return;
      dom.input.value = text;
      autoSize();
      dom.form.requestSubmit();
    });
  });

  const toggleMode = async () => {
    try {
      const data = await setSettings({ autoApprove: !state.autoApprove });
      state.autoApprove = data.autoApprove;
      renderModePill();
    } catch (e) { addError(`setting toggle failed: ${e.message}`); }
  };
  dom.modePill.addEventListener('click', toggleMode);

  dom.stopBtn.addEventListener('click', async () => {
    dom.stopBtn.disabled = true;
    setStatus('cancelling…', 'busy');
    try {
      const r = await postCancel();
      if (!r.ok) addError(`cancel failed: ${r.status} ${await r.text()}`);
      setStatus('cancelled', 'ready');
      setBusy(false);
    } catch (e) {
      addError(`cancel failed: ${e.message}`);
    } finally {
      dom.stopBtn.disabled = false;
    }
  });

  // Initial settings sync
  getSettings().then((d) => {
    state.autoApprove = d.autoApprove;
    renderModePill();
  }).catch(() => {});

  document.addEventListener('keydown', handleGlobalShortcut);
}

export function handleGlobalShortcut(e) {
  if (isEditableTarget(e.target)) return;
  if ((e.ctrlKey || e.metaKey) && e.key?.toLowerCase() === 'k') {
    e.preventDefault();
    dom.input.focus({ preventScroll: true });
    return;
  }
  if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    dom.input.value = '/';
    dom.input.focus({ preventScroll: true });
    try {
      dom.input.dispatchEvent(new Event('input', { bubbles: true }));
    } catch {
      dom.input.dispatchEvent({ type: 'input' });
    }
  }
}

function isEditableTarget(target) {
  const tag = target?.tagName?.toLowerCase?.();
  return target?.isContentEditable || tag === 'input' || tag === 'textarea' || tag === 'select';
}
