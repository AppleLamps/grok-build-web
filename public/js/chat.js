// Chat content rendering: turns, user messages, assistant messages,
// thinking gutter, error lines. Plus the status line.
//
// Anything you want to ADD to the log eventually flows through here.

import { state, dom } from './state.js';
import { renderMarkdown, escapeHTML } from './markdown.js';
import { resetTransientToolState } from './tool-state.js';

let assistantRenderPending = false;
let assistantRenderHandle = null;
let assistantRenderCancel = null;
let assistantRenderGeneration = 0;
const AUTO_SCROLL_NEAR_BOTTOM_PX = 120;

export function autoScroll() {
  const nearBottom = dom.log.scrollHeight - dom.log.scrollTop - dom.log.clientHeight < AUTO_SCROLL_NEAR_BOTTOM_PX;
  if (nearBottom) dom.log.scrollTop = dom.log.scrollHeight;
}

export function newTurn() {
  invalidateAssistantRender();
  // First user prompt clears the welcome screen.
  if (dom.welcome && !dom.welcome.hidden) dom.welcome.hidden = true;
  state.turnEl = document.createElement('div');
  state.turnEl.className = 'turn';
  dom.logInner.appendChild(state.turnEl);
  state.thinkingEl = null;
  state.assistantEl = null;
  state.assistantBuf = '';
  state.toolEls.clear();
  state.planCards.clear();
  // Reset subagent depth between turns so a failed use_tool can't leak
  // indentation forever.
  resetTransientToolState();
  return state.turnEl;
}

export function clearLog() {
  invalidateAssistantRender();
  dom.logInner.innerHTML = '';
  // Restore the welcome screen so users see starter prompts in a fresh session.
  if (dom.welcome) {
    dom.welcome.hidden = false;
    dom.logInner.appendChild(dom.welcome);
  }
  state.turnEl = null;
  state.thinkingEl = null;
  state.assistantEl = null;
  state.assistantBuf = '';
  state.toolEls.clear();
  state.planCards.clear();
  state.permCards.clear();
  resetTransientToolState();
}

export function addUserItem(text) {
  newTurn();
  const div = document.createElement('div');
  div.className = 'user-msg';
  div.textContent = text;
  state.turnEl.appendChild(div);
  dom.crumb.textContent = text.slice(0, 80);
  autoScroll();
}

export function appendThought(text) {
  if (!state.turnEl) newTurn();
  if (!state.thinkingEl) {
    state.thinkingEl = document.createElement('div');
    state.thinkingEl.className = 'thinking';
    state.thinkingEl.innerHTML = `
      <span class="label">
        <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
        Thinking
      </span>
      <span class="body"></span>
    `;
    state.thinkingEl.querySelector('.label').addEventListener('click', () => {
      state.thinkingEl.classList.toggle('collapsed');
    });
    state.turnEl.appendChild(state.thinkingEl);
  }
  state.thinkingEl.querySelector('.body').textContent += text;
  autoScroll();
}

// Auto-collapse the thinking block of the most recent turn when its turn ends.
export function collapseLastThinking() {
  if (!state.turnEl) return;
  const t = state.turnEl.querySelector('.thinking');
  if (t) t.classList.add('collapsed');
}

export function appendMessage(text) {
  if (!state.turnEl) newTurn();
  if (!state.assistantEl) {
    state.assistantEl = document.createElement('div');
    state.assistantEl.className = 'assistant streaming';
    state.turnEl.appendChild(state.assistantEl);
  }
  state.assistantBuf += text;
  scheduleAssistantRender();
}

function renderAssistantNow() {
  if (!state.assistantEl) return;
  state.assistantEl.innerHTML = renderMarkdown(state.assistantBuf);
  state.assistantEl.classList.add('streaming');
  autoScroll();
}

export function finishStreaming() {
  if (!state.assistantEl) return;
  cancelPendingAssistantRender();
  renderAssistantNow();
  state.assistantEl.classList.remove('streaming');
}

function scheduleAssistantRender() {
  if (assistantRenderPending) return;
  assistantRenderPending = true;
  const generation = assistantRenderGeneration;
  const run = () => {
    assistantRenderHandle = null;
    assistantRenderCancel = null;
    if (!assistantRenderPending || generation !== assistantRenderGeneration) return;
    assistantRenderPending = false;
    renderAssistantNow();
  };
  const raf = globalThis.requestAnimationFrame ?? globalThis.window?.requestAnimationFrame;
  const cancelRaf = globalThis.cancelAnimationFrame ?? globalThis.window?.cancelAnimationFrame;
  if (typeof raf === 'function') {
    assistantRenderCancel = typeof cancelRaf === 'function' ? cancelRaf : null;
    assistantRenderHandle = raf(run);
  } else {
    assistantRenderCancel = clearTimeout;
    assistantRenderHandle = setTimeout(run, 16);
  }
}

function cancelPendingAssistantRender() {
  if (!assistantRenderPending) return;
  assistantRenderPending = false;
  if (assistantRenderHandle != null && assistantRenderCancel) {
    try { assistantRenderCancel(assistantRenderHandle); } catch {}
  }
  assistantRenderHandle = null;
  assistantRenderCancel = null;
}

function invalidateAssistantRender() {
  assistantRenderGeneration++;
  cancelPendingAssistantRender();
}

// Replay marker (loaded sessions emit user_message_chunk to delimit turns).
export function appendUserChunk(text) {
  if (!state.turnEl || (state.assistantEl || state.thinkingEl || state.toolEls.size > 0)) newTurn();
  let userEl = state.turnEl.querySelector('.user-msg');
  if (!userEl) {
    userEl = document.createElement('div');
    userEl.className = 'user-msg';
    state.turnEl.appendChild(userEl);
  }
  userEl.textContent += text;
  autoScroll();
}

export function addError(msg) {
  if (!state.turnEl) newTurn();
  const div = document.createElement('div');
  div.className = 'error-line';
  div.innerHTML = `<span class="label">Error</span> ${escapeHTML(msg)}`;
  state.turnEl.appendChild(div);
  autoScroll();
}

export function setStatus(text, cls = '') {
  dom.statusEl.textContent = text;
  dom.statusEl.className = 'status ' + cls;
}

// Token-usage strip in the topbar. Called from dispatch on turn_complete.
const COPY_ICON = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const CHECK_ICON = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

export function updateUsage(meta) {
  if (!meta || !dom.usage) return;
  const total = meta.totalTokens ?? meta.total_tokens;
  // The model's currentModelId has a totalContextTokens in agentCapabilities;
  // without that we estimate from a typical 512K budget for grok-build.
  const ctx = meta.contextTokens ?? meta.context_tokens ?? 512000;
  if (total == null) return;
  const pct = Math.min(100, (total / ctx) * 100);
  dom.usageFill.style.width = pct.toFixed(1) + '%';
  dom.usageFill.dataset.warn = pct > 75 ? '1' : '';
  dom.usageNum.textContent = `${formatTokens(total)} / ${formatTokens(ctx)}`;
  dom.usage.hidden = false;
}

function formatTokens(n) {
  if (n < 1000) return String(n);
  if (n < 1000000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
}

// Event-delegated copy buttons on any <pre> inside the log. The button is
// injected on first hover so we don't add DOM weight to every code block.
dom.log?.addEventListener('mouseover', (e) => {
  const pre = e.target.closest?.('pre');
  if (!pre || pre.querySelector('.copy-btn')) return;
  if (pre.closest('.tool .details')) return; // tool detail blocks have their own
  const btn = document.createElement('button');
  btn.className = 'copy-btn';
  btn.title = 'Copy';
  btn.innerHTML = COPY_ICON;
  btn.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    const txt = pre.innerText;
    try { await navigator.clipboard.writeText(txt); btn.innerHTML = CHECK_ICON; btn.classList.add('copied'); }
    catch { btn.title = 'copy failed'; }
    setTimeout(() => { btn.innerHTML = COPY_ICON; btn.classList.remove('copied'); }, 1400);
  });
  pre.appendChild(btn);
});

const HOOK_ICONS = {
  success: '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  failed:  '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  other:   '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="1.5"/></svg>',
};

export function addHookLine(eventName, hookName, status, elapsedMs) {
  if (!state.turnEl) newTurn();
  const div = document.createElement('div');
  div.className = 'hook-line ' + (status === 'success' ? 'ok' : status === 'failed' ? 'fail' : '');
  const icon = HOOK_ICONS[status] ?? HOOK_ICONS.other;
  const ms = elapsedMs != null ? ` ${elapsedMs}ms` : '';
  div.innerHTML = `${icon}<span>hook ${escapeHTML(eventName ?? '')} → ${escapeHTML(hookName ?? '?')}${escapeHTML(ms)}</span>`;
  state.turnEl.appendChild(div);
  autoScroll();
}
