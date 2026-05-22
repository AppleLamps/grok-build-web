import assert from 'node:assert/strict';
import test from 'node:test';
import { importPublic, installDomStubs } from './helpers.mjs';

installDomStubs();
const { state, dom } = await importPublic('public/js/state.js');
const { paintTool, resetTransientToolState } = await importPublic('public/js/tools.js');
const { clearLog } = await importPublic('public/js/chat.js');

test('tool groups expand, collapse, and keep their header', async () => {
  resetDomState();

  for (const id of ['one', 'two', 'three']) {
    paintTool({
      sessionUpdate: 'tool_call_update',
      toolCallId: id,
      title: 'web_search',
      kind: 'search',
      status: 'completed',
      rawInput: { query: id },
      rawOutput: { results: [{ title: id, url: `https://example.com/${id}`, snippet: id }] },
    });
  }

  const group = state.turnEl.children[0];
  const summary = group.querySelector('.tool-group-summary');
  assert.ok(summary, 'group header exists');
  assert.equal(group.classList.contains('is-grouped'), true);
  assert.equal(group.classList.contains('open'), false);

  summary.click();
  assert.equal(group.classList.contains('open'), true);
  assert.ok(group.querySelector('.tool-group-summary'), 'group header still exists while open');

  const firstTool = group.querySelector('.tool');
  firstTool.querySelector('.summary').click();
  assert.equal(firstTool.classList.contains('open'), true);

  summary.click();
  assert.equal(group.classList.contains('open'), false);
  assert.ok(group.querySelector('.tool-group-summary'), 'group header still exists after collapse');
});

test('background and subagent statuses include cancelled and failed states', async () => {
  resetDomState();

  paintTool({
    sessionUpdate: 'tool_call',
    toolCallId: 'bg-1',
    title: 'run_terminal_command',
    kind: 'execute',
    status: 'in_progress',
    rawInput: { command: 'sleep 60', is_background: true },
  });
  paintTool({
    sessionUpdate: 'tool_call_update',
    toolCallId: 'bg-1',
    title: 'run_terminal_command',
    kind: 'execute',
    status: 'cancelled',
    rawInput: { command: 'sleep 60', is_background: true },
    rawOutput: { status: 'cancelled' },
  });
  assert.equal(dom.bgPanel.hidden, false);
  assert.equal(dom.bgList.querySelector('.todo-item').title, 'cancelled');

  paintTool({
    sessionUpdate: 'tool_call',
    toolCallId: 'sub-1',
    title: 'use_tool',
    kind: 'execute',
    status: 'in_progress',
    rawInput: { tool: 'subagent' },
  });
  paintTool({
    sessionUpdate: 'tool_call_update',
    toolCallId: 'sub-1',
    title: 'use_tool',
    kind: 'execute',
    status: 'failed',
    rawInput: { tool: 'subagent' },
    rawOutput: { error: 'failed' },
  });
  const subTool = [...dom.logInner.children[0].querySelector('.tool-group-items').children]
    .find(el => el.querySelector('.target')?.textContent === 'subagent');
  assert.equal(subTool.classList.contains('failed'), true);
});

test('clearLog resets transient tool state synchronously', async () => {
  resetDomState();

  paintTool({
    sessionUpdate: 'tool_call',
    toolCallId: 'bg-reset',
    title: 'run_terminal_command',
    kind: 'execute',
    status: 'in_progress',
    rawInput: { command: 'sleep 60', is_background: true },
  });
  paintTool({
    sessionUpdate: 'tool_call_update',
    toolCallId: 'bg-reset',
    title: 'run_terminal_command',
    kind: 'execute',
    status: 'in_progress',
    rawInput: { command: 'sleep 60', is_background: true },
    rawOutput: { status: 'running' },
  });
  assert.equal(dom.bgPanel.hidden, false);

  paintTool({
    sessionUpdate: 'tool_call',
    toolCallId: 'sub-reset',
    title: 'use_tool',
    kind: 'execute',
    status: 'in_progress',
    rawInput: { tool: 'subagent' },
  });

  clearLog();
  assert.equal(dom.bgPanel.hidden, true);

  paintTool({
    sessionUpdate: 'tool_call',
    toolCallId: 'after-reset',
    title: 'web_search',
    kind: 'search',
    status: 'in_progress',
    rawInput: { query: 'reset' },
  });
  const tool = state.turnEl.querySelector('.tool');
  assert.equal(tool.classList.contains('subagent-child'), false);
});

function resetDomState() {
  dom.logInner.children = [];
  dom.bgList.children = [];
  dom.bgPanel.hidden = true;
  state.turnEl = null;
  state.thinkingEl = null;
  state.assistantEl = null;
  state.assistantBuf = '';
  state.toolEls.clear();
  state.planCards.clear();
  resetTransientToolState();
}
