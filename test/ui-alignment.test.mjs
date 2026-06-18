import assert from 'node:assert/strict';
import test from 'node:test';
import { importPublic, installDomStubs, delay } from './helpers.mjs';

const requests = [];
const { body } = installDomStubs({
  fetchImpl: async (path, opts = {}) => {
    requests.push({ path: String(path), body: opts.body ? JSON.parse(opts.body) : null });
    if (String(path).includes('/prompt')) return new Response(JSON.stringify({ ok: true }), { status: 202 });
    if (String(path).includes('/settings')) return new Response(JSON.stringify({ autoApprove: true }), { status: 200 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  },
});

const { state, dom } = await importPublic('public/js/state.js');
const chat = await importPublic('public/js/chat.js');
const composer = await importPublic('public/js/composer.js');
const tools = await importPublic('public/js/tools.js');
const toolsMenu = await importPublic('public/js/tools-menu.js');
const { dispatch } = await importPublic('public/js/dispatch.js');
const { modal } = await importPublic('public/js/modal.js');

test('user messages render in right-aligned rows', () => {
  resetChatState();

  chat.addUserItem('hello');
  const row = state.turnEl.querySelector('.user-msg-row');
  const msg = row.querySelector('.user-msg');

  assert.ok(row, 'user row exists');
  assert.equal(msg.textContent, 'hello');

  resetChatState();
  chat.appendUserChunk('hel');
  chat.appendUserChunk('lo');
  const replayRow = state.turnEl.querySelector('.user-msg-row');
  assert.equal(replayRow.querySelector('.user-msg').textContent, 'hello');
});

test('empty replay chunks keep the welcome screen visible', () => {
  resetChatState();
  dom.welcome.hidden = false;
  dom.logInner.appendChild(dom.welcome);

  dispatch({ kind: 'update', update: { sessionUpdate: 'user_message_chunk', content: { text: '' } } });
  dispatch({ kind: 'update', update: { sessionUpdate: 'agent_thought_chunk', content: { text: '' } } });
  dispatch({ kind: 'update', update: { sessionUpdate: 'agent_message_chunk', content: { text: '' } } });

  assert.equal(dom.welcome.hidden, false);
  assert.equal(state.turnEl, null);
  assert.equal(dom.logInner.querySelectorAll('.turn').length, 0);
});

test('code block copy button copies from the matching block', async () => {
  let copied = '';
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { clipboard: { writeText: async (text) => { copied = text; } } },
  });

  const block = document.createElement('div');
  block.className = 'code-block';
  const btn = document.createElement('button');
  btn.className = 'code-block-copy';
  const pre = document.createElement('pre');
  pre.textContent = 'npm test';
  block.appendChild(btn);
  block.appendChild(pre);

  await chat.handleCodeCopyClick({ target: btn, stopPropagation() {} });

  assert.equal(copied, 'npm test');
  assert.match(btn.innerHTML, /Copied/);
});

test('Mermaid open button uses the matching rendered block', async () => {
  const block = document.createElement('div');
  block.className = 'code-block mermaid-code-block';
  block.dataset.mermaidState = 'ready';
  const btn = document.createElement('button');
  btn.className = 'code-block-mermaid-open';
  const preview = document.createElement('div');
  preview.className = 'mermaid-preview';
  const svg = document.createElement('svg');
  preview.appendChild(svg);
  block.appendChild(btn);
  block.appendChild(preview);
  body.appendChild(block);

  await chat.handleMermaidOpenClick({ target: btn, stopPropagation() {} });

  assert.ok(body.querySelector('.mermaid-modal'));
  assert.ok(body.querySelector('.mermaid-export-png'));
});

test('global shortcuts focus composer and open slash entry outside inputs', () => {
  dom.input.value = '';
  composer.handleGlobalShortcut({
    key: 'k',
    ctrlKey: true,
    target: body,
    preventDefault() { this.prevented = true; },
  });
  assert.equal(dom.input.focused, true);

  composer.handleGlobalShortcut({
    key: '/',
    target: body,
    preventDefault() { this.prevented = true; },
  });
  assert.equal(dom.input.value, '/');

  dom.input.value = 'keep';
  composer.handleGlobalShortcut({
    key: '/',
    target: dom.input,
    preventDefault() { this.prevented = true; },
  });
  assert.equal(dom.input.value, 'keep');
});

test('modal exposes dialog semantics and keeps hostile string bodies as text', () => {
  const { el, body: modalBody } = modal('Title', '<img src=x onerror=alert(1)>');

  assert.equal(el.getAttribute('role'), 'dialog');
  assert.equal(el.getAttribute('aria-modal'), 'true');
  assert.equal(el.getAttribute('aria-label'), 'Title');
  assert.equal(modalBody.textContent, '<img src=x onerror=alert(1)>');
  assert.equal(body.querySelectorAll('img').length, 0);
});

test('sidebar tools start collapsed and toggle open', () => {
  const wrap = document.createElement('div');
  wrap.className = 'sidebar-tools collapsed';
  const toggle = document.getElementById('tools-toggle');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'tools-nav');
  const nav = document.getElementById('tools-nav');
  nav.hidden = true;
  wrap.appendChild(toggle);
  wrap.appendChild(nav);
  document.body.appendChild(wrap);

  toolsMenu.initToolsMenu();
  assert.equal(nav.hidden, true);
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(wrap.classList.contains('collapsed'), true);

  toggle.click();
  assert.equal(nav.hidden, false);
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(wrap.classList.contains('collapsed'), false);

  toggle.click();
  assert.equal(nav.hidden, true);
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(wrap.classList.contains('collapsed'), true);
});

test('plan edit uses inline textarea and sends escaped user revision', async () => {
  resetChatState();
  requests.length = 0;

  tools.renderPlanCard({
    toolCallId: 'plan-1',
    title: 'enter_plan_mode',
    rawInput: { plan: 'Initial plan' },
  });
  const card = state.turnEl.querySelector('.plan-card');
  card.querySelector('.plan-edit').click();
  const wrap = card.querySelector('.plan-edit-wrap');
  const textarea = card.querySelector('.plan-edit-text');
  assert.equal(wrap.hidden, false);

  textarea.value = '<img src=x onerror=alert(1)>';
  card.querySelector('.plan-edit-submit').click();
  await delay(10);

  assert.equal(wrap.hidden, true);
  assert.equal(requests.at(-1).path, '/prompt');
  assert.equal(requests.at(-1).body.text, 'Revise the plan: <img src=x onerror=alert(1)>');
  assert.equal(body.querySelectorAll('img').length, 0);
});

function resetChatState() {
  dom.logInner.children = [];
  state.turnEl = null;
  state.thinkingEl = null;
  state.thinkingBuf = '';
  state.assistantEl = null;
  state.assistantBuf = '';
  state.toolEls.clear();
  state.planCards.clear();
}
