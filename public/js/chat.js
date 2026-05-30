// Chat content rendering: turns, user messages, assistant messages,
// thinking gutter, error lines. Plus the status line.
//
// Anything you want to ADD to the log eventually flows through here.

import { state, dom } from './state.js';
import { renderMarkdown, escapeHTML } from './markdown.js';
import { createMarkdownStreamRenderer } from './streaming-markdown.js';
import { resetAllToolState, resetTransientToolState } from './tool-state.js';

let assistantRenderPending = false;
let assistantRenderHandle = null;
let assistantRenderCancel = null;
let assistantRenderGeneration = 0;
let lastAssistantRenderAt = 0;
let thinkingRenderPending = false;
let thinkingRenderHandle = null;
let thinkingRenderCancel = null;
let thinkingRenderGeneration = 0;
let lastThinkingRenderAt = 0;
let assistantStreamRenderer = null;
const AUTO_SCROLL_NEAR_BOTTOM_PX = 120;
const ASSISTANT_RENDER_INTERVAL_MS = 32;
const THINKING_RENDER_INTERVAL_MS = 48;
const MAX_LOG_TURNS = 500;
const TRUNCATION_MARKER_CLASS = 'truncated-seam';

export function autoScroll() {
  const nearBottom = dom.log.scrollHeight - dom.log.scrollTop - dom.log.clientHeight < AUTO_SCROLL_NEAR_BOTTOM_PX;
  if (nearBottom) dom.log.scrollTop = dom.log.scrollHeight;
}

export function newTurn() {
  invalidateAssistantRender();
  invalidateThinkingRender();
  lastAssistantRenderAt = 0;
  lastThinkingRenderAt = 0;
  // First user prompt clears the welcome screen.
  if (dom.welcome && !dom.welcome.hidden) dom.welcome.hidden = true;
  state.turnEl = document.createElement('div');
  state.turnEl.className = 'turn';
  dom.logInner.appendChild(state.turnEl);
  enforceLogTurnLimit();
  state.thinkingEl = null;
  state.thinkingBuf = '';
  state.assistantEl = null;
  state.assistantBuf = '';
  assistantStreamRenderer = null;
  state.toolEls.clear();
  state.planCards.clear();
  // Reset subagent depth between turns so a failed use_tool can't leak
  // indentation forever.
  resetTransientToolState();
  return state.turnEl;
}

export function clearLog() {
  invalidateAssistantRender();
  invalidateThinkingRender();
  lastAssistantRenderAt = 0;
  lastThinkingRenderAt = 0;
  dom.logInner.innerHTML = '';
  // Restore the welcome screen so users see starter prompts in a fresh session.
  if (dom.welcome) {
    dom.welcome.hidden = false;
    dom.logInner.appendChild(dom.welcome);
  }
  dom.log.scrollTop = 0;
  document.querySelector('main')?.scrollTo?.(0, 0);
  state.turnEl = null;
  state.thinkingEl = null;
  state.thinkingBuf = '';
  state.assistantEl = null;
  state.assistantBuf = '';
  assistantStreamRenderer = null;
  state.toolEls.clear();
  state.planCards.clear();
  state.permCards.clear();
  state.hiddenTurnCount = 0;
  resetAllToolState();
}

function enforceLogTurnLimit(maxTurns = MAX_LOG_TURNS) {
  const turns = [...dom.logInner.querySelectorAll('.turn')];
  const completedTurns = turns.filter((turn) => turn !== state.turnEl);
  const overflow = completedTurns.length - maxTurns;
  if (overflow <= 0) return;

  for (const turn of completedTurns.slice(0, overflow)) turn.remove();
  state.hiddenTurnCount += overflow;
  renderTruncationMarker();
}

function renderTruncationMarker() {
  let marker = dom.logInner.querySelector(`.${TRUNCATION_MARKER_CLASS}`);
  if (!marker) {
    marker = document.createElement('div');
    marker.className = TRUNCATION_MARKER_CLASS;
    const firstTurn = dom.logInner.querySelector('.turn');
    if (firstTurn) firstTurn.before(marker);
    else dom.logInner.appendChild(marker);
  }
  const label = state.hiddenTurnCount === 1 ? '1 earlier turn hidden' : `${state.hiddenTurnCount} earlier turns hidden`;
  marker.textContent = `${label} to keep the chat responsive.`;
}

export function addUserItem(text, attachments = []) {
  newTurn();
  const row = ensureUserMessageRow(state.turnEl);
  if (text) {
    const div = createUserMessageBubble();
    div.textContent = text;
    row.appendChild(div);
  }
  appendAttachmentList(row, attachments);
  const crumb = text || (attachments[0]?.filename ?? 'attachment');
  dom.crumb.textContent = crumb.slice(0, 80);
  autoScroll();
}

export function appendThought(text) {
  if (!state.turnEl) newTurn();
  if (!state.thinkingEl) {
    state.thinkingEl = document.createElement('div');
    state.thinkingEl.className = 'thinking';
    state.thinkingEl.innerHTML = `
      <button class="label" type="button" aria-expanded="true" title="Toggle thinking trace">
        <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
        <span class="label-main">Thinking trace</span>
        <span class="label-state">live</span>
      </button>
      <div class="body"></div>
    `;
    state.thinkingEl.querySelector('.label').addEventListener('click', (e) => {
      const collapsed = state.thinkingEl.classList.toggle('collapsed');
      e.currentTarget.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    });
    state.turnEl.appendChild(state.thinkingEl);
  }
  state.thinkingBuf += text;
  scheduleThinkingRender();
}

// Auto-collapse the thinking block of the most recent turn when its turn ends.
export function collapseLastThinking() {
  if (!state.turnEl) return;
  finishThinkingRender();
  const t = state.turnEl.querySelector('.thinking');
  if (t) {
    t.classList.add('collapsed');
    t.querySelector('.label')?.setAttribute('aria-expanded', 'false');
    const stateLabel = t.querySelector('.label-state');
    if (stateLabel) stateLabel.textContent = 'done';
  }
}

export function appendMessage(text) {
  if (!state.turnEl) newTurn();
  if (!state.assistantEl) {
    state.assistantEl = document.createElement('div');
    state.assistantEl.className = 'assistant streaming';
    state.turnEl.appendChild(state.assistantEl);
    assistantStreamRenderer = createMarkdownStreamRenderer(state.assistantEl);
  }
  if (!assistantStreamRenderer) assistantStreamRenderer = createMarkdownStreamRenderer(state.assistantEl);
  state.assistantBuf += text;
  assistantStreamRenderer.append(text);
  scheduleAssistantRender();
}

function renderAssistantNow() {
  if (!state.assistantEl) return;
  if (!assistantStreamRenderer) assistantStreamRenderer = createMarkdownStreamRenderer(state.assistantEl);
  assistantStreamRenderer.render();
  state.assistantEl.classList.add('streaming');
  lastAssistantRenderAt = Date.now();
  autoScroll();
}

function renderThinkingNow() {
  if (!state.thinkingEl) return;
  const body = state.thinkingEl.querySelector('.body');
  if (!body) return;
  body.innerHTML = renderMarkdown(state.thinkingBuf);
  lastThinkingRenderAt = Date.now();
  autoScroll();
}

export function finishStreaming() {
  finishThinkingRender();
  if (!state.assistantEl) return;
  cancelPendingAssistantRender();
  if (!assistantStreamRenderer) assistantStreamRenderer = createMarkdownStreamRenderer(state.assistantEl);
  assistantStreamRenderer.finish(state.assistantBuf);
  lastAssistantRenderAt = Date.now();
  autoScroll();
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
  const delay = Math.max(0, ASSISTANT_RENDER_INTERVAL_MS - (Date.now() - lastAssistantRenderAt));
  if (delay > 0) {
    assistantRenderCancel = clearTimeout;
    assistantRenderHandle = setTimeout(run, delay);
    return;
  }
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

function scheduleThinkingRender() {
  if (thinkingRenderPending) return;
  thinkingRenderPending = true;
  const generation = thinkingRenderGeneration;
  const run = () => {
    thinkingRenderHandle = null;
    thinkingRenderCancel = null;
    if (!thinkingRenderPending || generation !== thinkingRenderGeneration) return;
    thinkingRenderPending = false;
    renderThinkingNow();
  };
  const delay = Math.max(0, THINKING_RENDER_INTERVAL_MS - (Date.now() - lastThinkingRenderAt));
  if (delay > 0) {
    thinkingRenderCancel = clearTimeout;
    thinkingRenderHandle = setTimeout(run, delay);
    return;
  }
  const raf = globalThis.requestAnimationFrame ?? globalThis.window?.requestAnimationFrame;
  const cancelRaf = globalThis.cancelAnimationFrame ?? globalThis.window?.cancelAnimationFrame;
  if (typeof raf === 'function') {
    thinkingRenderCancel = typeof cancelRaf === 'function' ? cancelRaf : null;
    thinkingRenderHandle = raf(run);
  } else {
    thinkingRenderCancel = clearTimeout;
    thinkingRenderHandle = setTimeout(run, 16);
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

export function __testAssistantStreamStats() {
  return assistantStreamRenderer?.stats ?? null;
}

function cancelPendingThinkingRender() {
  if (!thinkingRenderPending) return;
  thinkingRenderPending = false;
  if (thinkingRenderHandle != null && thinkingRenderCancel) {
    try { thinkingRenderCancel(thinkingRenderHandle); } catch {}
  }
  thinkingRenderHandle = null;
  thinkingRenderCancel = null;
}

function finishThinkingRender() {
  if (!state.thinkingEl) return;
  cancelPendingThinkingRender();
  renderThinkingNow();
}

function invalidateAssistantRender() {
  assistantRenderGeneration++;
  cancelPendingAssistantRender();
}

function invalidateThinkingRender() {
  thinkingRenderGeneration++;
  cancelPendingThinkingRender();
}

// Replay marker (loaded sessions emit user_message_chunk to delimit turns).
export function appendUserChunk(text) {
  if (!state.turnEl || (state.assistantEl || state.thinkingEl || state.toolEls.size > 0)) newTurn();
  const row = ensureUserMessageRow(state.turnEl);
  let userEl = row.querySelector('.user-msg');
  if (!userEl) {
    userEl = createUserMessageBubble();
    // Keep text bubble above any attachment list already appended.
    const firstAttach = row.querySelector('.user-attachments');
    if (firstAttach) row.insertBefore(userEl, firstAttach);
    else row.appendChild(userEl);
  }
  userEl.textContent += text;
  autoScroll();
}

function ensureUserMessageRow(turnEl) {
  let row = turnEl.querySelector('.user-msg-row');
  if (!row) {
    row = document.createElement('div');
    row.className = 'user-msg-row';
    turnEl.appendChild(row);
  }
  return row;
}

function createUserMessageBubble() {
  const div = document.createElement('div');
  div.className = 'user-msg';
  return div;
}

function appendAttachmentList(row, attachments) {
  if (!Array.isArray(attachments) || attachments.length === 0) return;
  const list = document.createElement('div');
  list.className = 'user-attachments';
  for (const a of attachments) {
    list.appendChild(renderAttachmentChip(a));
  }
  row.appendChild(list);
}

function renderAttachmentChip(a) {
  const kind = a?.kind ?? 'file';
  const filename = a?.filename ?? 'attachment';
  if (kind === 'image' && a?.mediaUrl) {
    const link = document.createElement('a');
    link.className = 'user-attach image';
    link.href = a.mediaUrl;
    link.target = '_blank';
    link.rel = 'noopener';
    link.title = filename;
    const img = document.createElement('img');
    img.src = a.mediaUrl;
    img.alt = filename;
    img.loading = 'lazy';
    link.appendChild(img);
    return link;
  }
  const chip = document.createElement(a?.mediaUrl ? 'a' : 'span');
  chip.className = `user-attach ${kind === 'pdf' ? 'pdf' : 'file'}`;
  if (a?.mediaUrl) {
    chip.href = a.mediaUrl;
    chip.target = '_blank';
    chip.rel = 'noopener';
  }
  const icon = document.createElement('span');
  icon.className = 'user-attach-icon';
  icon.textContent = kind === 'pdf' ? 'PDF' : 'FILE';
  chip.appendChild(icon);
  const label = document.createElement('span');
  label.className = 'user-attach-name';
  label.textContent = filename;
  chip.appendChild(label);
  return chip;
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
  // Make the disabled-Send state legible: surface "why" via the button's
  // tooltip so users aren't staring at a faded button with no explanation.
  if (dom.sendBtn) {
    if (cls === 'disconnected') {
      dom.sendBtn.title = `Disconnected — ${text}`;
    } else if (cls === 'busy') {
      dom.sendBtn.title = `Busy — ${text}`;
    } else if (cls === 'ready') {
      dom.sendBtn.title = 'Send prompt (Enter)';
    } else {
      dom.sendBtn.title = text || 'Send prompt';
    }
  }
}

// Token-usage strip in the topbar. Called from dispatch on turn_complete.
const COPY_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const CHECK_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';

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
  state.lastUsage = { totalTokens: total, contextTokens: ctx, percent: pct, raw: meta };
  state.turnCount += 1;
}

function formatTokens(n) {
  if (n < 1000) return String(n);
  if (n < 1000000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
}

export const __test = {
  enforceLogTurnLimit,
};

dom.log?.addEventListener('click', handleCodeCopyClick);

export async function handleCodeCopyClick(e) {
  const btn = e.target.closest?.('.code-block-copy');
  if (!btn) return;
  e.stopPropagation?.();
  const block = btn.closest('.code-block');
  const pre = block?.querySelector('pre');
  if (!pre) return;
  try {
    await navigator.clipboard.writeText(pre.innerText ?? pre.textContent ?? '');
    btn.innerHTML = `${CHECK_ICON}<span>Copied</span>`;
    btn.classList.add('copied');
  } catch {
    btn.textContent = 'Failed';
  }
  setTimeout(() => {
    btn.innerHTML = `${COPY_ICON}<span>Copy</span>`;
    btn.classList.remove('copied');
  }, 2000);
}

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
