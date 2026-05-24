import assert from 'node:assert/strict';
import test from 'node:test';
import { importPublic, installDomStubs } from './helpers.mjs';

installDomStubs();
const { state, dom } = await importPublic('public/js/state.js');
const { paintTool, resetAllToolState } = await importPublic('public/js/tools.js');
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

test('plain terminal and subagent tools are not tracked as background tasks', async () => {
  resetDomState();

  paintTool({
    sessionUpdate: 'tool_call',
    toolCallId: 'fg-1',
    title: 'run_terminal_command',
    kind: 'execute',
    status: 'in_progress',
    rawInput: { command: 'echo foreground', is_background: false },
  });
  assert.equal(dom.bgPanel.hidden, true);

  paintTool({
    sessionUpdate: 'tool_call',
    toolCallId: 'sub-no-bg',
    title: 'use_tool',
    kind: 'execute',
    status: 'in_progress',
    rawInput: { tool: 'subagent' },
  });
  assert.equal(dom.bgPanel.hidden, true);
});

test('todo sidebar merges partial updates without losing task text', async () => {
  resetDomState();

  paintTool({
    sessionUpdate: 'tool_call',
    toolCallId: 'todo-1',
    title: 'todo_write',
    rawInput: {
      merge: true,
      todos: [
        { id: '1', content: 'Draft the page', status: 'in_progress' },
        { id: '2', content: 'Verify layout', status: 'pending' },
      ],
    },
  });
  assert.equal(dom.todoPanel.hidden, false);
  assert.match(dom.todoList.innerHTML, /Draft the page/);
  assert.match(dom.todoList.innerHTML, /Verify layout/);

  paintTool({
    sessionUpdate: 'tool_call_update',
    toolCallId: 'todo-1',
    kind: 'think',
    title: 'Updating plan',
    rawInput: {
      variant: 'TodoWrite',
      merge: true,
      todos: [
        { id: '1', content: null, status: 'completed' },
        { id: '2', content: null, status: 'in_progress' },
      ],
    },
  });
  assert.match(dom.todoList.innerHTML, /Draft the page/);
  assert.match(dom.todoList.innerHTML, /Verify layout/);
  assert.match(dom.todoList.innerHTML, /completed/);
  assert.match(dom.todoList.innerHTML, /in_progress/);
});

test('completed todo summary refreshes the full sidebar list', async () => {
  resetDomState();

  paintTool({
    sessionUpdate: 'tool_call_update',
    toolCallId: 'todo-summary',
    status: 'completed',
    rawOutput: {
      type: 'Todo',
      TodosUpdated: {
        summary_for_prompt: '- [completed] 1: Draft the page\n- [in_progress] 2: Verify layout',
      },
    },
  });

  assert.equal(dom.todoPanel.hidden, false);
  assert.match(dom.todoList.innerHTML, /Draft the page/);
  assert.match(dom.todoList.innerHTML, /Verify layout/);
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
  dom.todoList.children = [];
  dom.bgPanel.hidden = true;
  dom.todoPanel.hidden = true;
  state.turnEl = null;
  state.thinkingEl = null;
  state.assistantEl = null;
  state.assistantBuf = '';
  state.toolEls.clear();
  state.planCards.clear();
  resetAllToolState();
}
