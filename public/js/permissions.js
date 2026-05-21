// Permission request cards.
// Active only when the composer pill is in "Manual approval" mode —
// otherwise the bridge auto-approves and we never see these events.

import { state } from './state.js';
import { newTurn, autoScroll, addError } from './chat.js';
import { postPermission } from './api.js';

function summarize(toolCall) {
  if (!toolCall) return { title: '(unknown tool)', detail: '' };
  const raw = toolCall.rawInput ?? {};
  const title = toolCall.title ?? toolCall.toolCallId ?? '(unnamed)';
  let detail = '';
  if (raw.command) detail = raw.command;
  else if (raw.path || raw.file_path) detail = raw.path ?? raw.file_path;
  else if (raw.url) detail = raw.url;
  else if (raw.pattern) detail = raw.pattern;
  else detail = JSON.stringify(raw, null, 2).slice(0, 800);
  return { title, detail };
}

export function addPermissionCard(rpcId, request) {
  if (!state.turnEl) newTurn();
  const card = document.createElement('div');
  card.className = 'perm-card';
  const { title, detail } = summarize(request.toolCall);
  const options = request.options ?? [];
  card.innerHTML = `
    <div class="perm-head">Permission requested</div>
    <div class="perm-tool"></div>
    <div class="perm-detail"></div>
    <div class="perm-actions"></div>
    <div class="resolution"></div>
  `;
  card.querySelector('.perm-tool').textContent = title;
  card.querySelector('.perm-detail').textContent = detail || '(no input)';
  const actions = card.querySelector('.perm-actions');
  for (const opt of options) {
    const btn = document.createElement('button');
    btn.textContent = opt.name ?? opt.optionId;
    const lower = (opt.optionId + ' ' + (opt.name ?? '')).toLowerCase();
    if (/once|single/.test(lower)) btn.className = 'allow-once';
    else if (/deny|reject|cancel|no/.test(lower)) btn.className = 'deny';
    else btn.className = 'allow';
    btn.addEventListener('click', () => respond(rpcId, opt.optionId));
    actions.appendChild(btn);
  }
  if (!options.length) {
    const allow = document.createElement('button');
    allow.className = 'allow'; allow.textContent = 'Allow';
    allow.addEventListener('click', () => respond(rpcId, 'allow'));
    const deny = document.createElement('button');
    deny.className = 'deny'; deny.textContent = 'Deny';
    deny.addEventListener('click', () => respond(rpcId, '__cancel__'));
    actions.append(allow, deny);
  }
  state.turnEl.appendChild(card);
  state.permCards.set(rpcId, card);
  autoScroll();
}

export function resolvePermissionCard(rpcId, optionId) {
  const card = state.permCards.get(rpcId);
  if (!card) return;
  card.classList.add('resolved');
  card.querySelector('.resolution').textContent = `→ ${optionId}`;
  state.permCards.delete(rpcId);
}

async function respond(rpcId, optionId) {
  const card = state.permCards.get(rpcId);
  if (card) card.querySelectorAll('button').forEach(b => b.disabled = true);
  try {
    await postPermission(rpcId, optionId);
  } catch (e) {
    addError(`permission response failed: ${e.message}`);
    if (card) card.querySelectorAll('button').forEach(b => b.disabled = false);
  }
}
