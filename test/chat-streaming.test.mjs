import assert from 'node:assert/strict';
import test from 'node:test';
import { importPublic, installDomStubs } from './helpers.mjs';

installDomStubs();

const rafQueue = [];
let nextRafId = 1;

function requestFrame(cb) {
  const id = nextRafId++;
  rafQueue.push({ id, cb, cancelled: false });
  return id;
}

function cancelFrame(id) {
  const item = rafQueue.find(entry => entry.id === id);
  if (item) item.cancelled = true;
}

globalThis.requestAnimationFrame = requestFrame;
globalThis.cancelAnimationFrame = cancelFrame;
globalThis.window.requestAnimationFrame = requestFrame;
globalThis.window.cancelAnimationFrame = cancelFrame;

const { state, dom } = await importPublic('public/js/state.js');
const { renderMarkdown } = await importPublic('public/js/markdown.js');
const {
  appendMessage,
  appendThought,
  clearLog,
  finishStreaming,
  __testAssistantStreamStats,
} = await importPublic('public/js/chat.js');

test('appendMessage batches markdown rendering to one frame', () => {
  resetDomState();

  appendMessage('a');
  appendMessage('b');
  appendMessage('c');

  assert.equal(activeFrameCount(), 1);
  assert.equal(state.assistantEl.innerHTML, '');

  flushFrames();

  assert.equal(activeFrameCount(), 0);
  assert.match(state.assistantEl.querySelector('.markdown-live-tail').innerHTML, /abc/);
  assert.equal(state.assistantEl.classList.contains('streaming'), true);
  assert.equal(__testAssistantStreamStats().fullRenderCount, 0);
});

test('finishStreaming renders pending content synchronously', () => {
  resetDomState();

  appendMessage('abc');
  assert.equal(activeFrameCount(), 1);

  finishStreaming();

  assert.equal(activeFrameCount(), 0);
  assert.match(state.assistantEl.innerHTML, /abc/);
  assert.equal(state.assistantEl.classList.contains('streaming'), false);

  flushFrames({ includeCancelled: true });
  assert.match(state.assistantEl.innerHTML, /abc/);
  assert.equal(state.assistantEl.classList.contains('streaming'), false);
  assert.equal(__testAssistantStreamStats().fullRenderCount, 1);
});

test('appendMessage commits stable markdown blocks and renders only the live tail', () => {
  resetDomState();
  const source = '## One\n\nSecond paragraph with [link](https://example.com)';

  for (const ch of source) appendMessage(ch);
  flushFrames();

  const stats = __testAssistantStreamStats();
  assert.equal(stats.fullRenderCount, 0);
  assert.equal(stats.committedBlockCount, 1);
  assert.ok(stats.maxLiveSourceLength < source.length);
  assert.match(state.assistantEl.querySelector('.markdown-live-tail').innerHTML, /Second paragraph/);
});

test('appendMessage streams large open code fences without full-buffer markdown rendering', () => {
  resetDomState();
  const code = '```js\n' + 'console.log("x");\n'.repeat(300);

  appendMessage(code);
  flushFrames();

  const stats = __testAssistantStreamStats();
  assert.equal(stats.fullRenderCount, 0);
  assert.match(state.assistantEl.querySelector('.markdown-live-tail').innerHTML, /code-block/);
  assert.match(state.assistantEl.querySelector('.markdown-live-tail').innerHTML, /console\.log/);
});

test('finishStreaming final assistant HTML matches canonical markdown renderer', () => {
  resetDomState();
  const source = [
    '# Heading',
    '',
    '1. First',
    '1. Second',
    '',
    '> quoted **text**',
    '',
    '| A | B |',
    '| --- | --- |',
    '| [x](https://example.com) | `code` |',
    '',
    '```js',
    '<unsafe>',
    '```',
  ].join('\n');

  appendMessage(source);
  flushFrames();
  finishStreaming();

  assert.equal(state.assistantEl.innerHTML, renderMarkdown(source));
});

test('appendThought batches markdown rendering to one frame', () => {
  resetDomState();

  appendThought('Thinking with ');
  appendThought('**structure**');
  appendThought('\n- one');

  assert.equal(activeFrameCount(), 1);
  assert.equal(state.thinkingBuf, 'Thinking with **structure**\n- one');
  assert.equal(state.thinkingEl.querySelector('.body').innerHTML, '');

  flushFrames();

  const html = state.thinkingEl.querySelector('.body').innerHTML;
  assert.equal(activeFrameCount(), 0);
  assert.match(html, /<strong>structure<\/strong>/);
  assert.match(html, /<ul><li>one<\/li><\/ul>/);
});

test('finishStreaming renders pending thinking without assistant output', () => {
  resetDomState();

  appendThought('<unsafe> **safe**');
  assert.equal(activeFrameCount(), 1);

  finishStreaming();

  assert.equal(activeFrameCount(), 0);
  const html = state.thinkingEl.querySelector('.body').innerHTML;
  assert.match(html, /&lt;unsafe&gt;/);
  assert.match(html, /<strong>safe<\/strong>/);
  assert.equal(state.assistantEl, null);
});

test('clearLog prevents stale scheduled assistant renders', () => {
  resetDomState();

  appendMessage('stale text');
  assert.equal(activeFrameCount(), 1);

  clearLog();
  flushFrames({ includeCancelled: true });

  assert.equal(state.assistantEl, null);
  assert.doesNotMatch(dom.logInner.innerHTML, /stale text/);
});

function resetDomState() {
  rafQueue.length = 0;
  dom.logInner.innerHTML = '';
  dom.logInner.children = [];
  if (dom.welcome) {
    dom.welcome.hidden = true;
    dom.welcome.parentElement = null;
  }
  state.turnEl = null;
  state.thinkingEl = null;
  state.thinkingBuf = '';
  state.assistantEl = null;
  state.assistantBuf = '';
  state.toolEls.clear();
  state.planCards.clear();
  state.permCards.clear();
}

function activeFrameCount() {
  return rafQueue.filter(entry => !entry.cancelled).length;
}

function flushFrames({ includeCancelled = false } = {}) {
  while (rafQueue.length) {
    const entry = rafQueue.shift();
    if (!entry.cancelled || includeCancelled) entry.cb();
  }
}
