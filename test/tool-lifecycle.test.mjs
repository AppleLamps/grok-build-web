import assert from 'node:assert/strict';
import test from 'node:test';
import { importPublic, installDomStubs } from './helpers.mjs';

installDomStubs();
const { state, dom } = await importPublic('public/js/state.js');
const { paintTool } = await importPublic('public/js/tools.js');
const { setBackgroundTask, setCurrentTodos, resetAllToolState } = await importPublic('public/js/tool-state.js');
const { parseTodoSummary } = await importPublic('public/js/tools/render-todos.mjs');
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

test('blank completion updates preserve meaningful tool labels', async () => {
  resetDomState();

  paintTool({
    sessionUpdate: 'tool_call',
    toolCallId: 'write-real-shape',
    title: 'write',
    rawInput: { path: 'nyt-mock/js/data.js' },
  });
  paintTool({
    sessionUpdate: 'tool_call_update',
    toolCallId: 'write-real-shape',
    title: 'Write `nyt-mock/js/data.js`',
    kind: 'edit',
    rawInput: { path: 'nyt-mock/js/data.js' },
  });
  paintTool({
    sessionUpdate: 'tool_call_update',
    toolCallId: 'write-real-shape',
    status: 'completed',
  });

  const tool = state.turnEl.querySelector('.tool');
  assert.equal(tool.querySelector('.verb').textContent, 'Wrote ');
  assert.equal(tool.querySelector('.target').textContent, 'nyt-mock/js/data.js');
  assert.equal(tool.classList.contains('completed'), true);
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

test('collapsed tool updates defer details until opened', async () => {
  resetDomState();

  paintTool({
    sessionUpdate: 'tool_call',
    toolCallId: 'search-lazy',
    title: 'web_search',
    kind: 'search',
    status: 'in_progress',
    rawInput: { query: 'docs' },
  });
  const tool = state.turnEl.querySelector('.tool');
  const details = tool.querySelector('.details');
  assert.equal(details.innerHTML, '');
  assert.match(tool.querySelector('.target').textContent, /docs/);

  paintTool({
    sessionUpdate: 'tool_call_update',
    toolCallId: 'search-lazy',
    title: 'web_search',
    kind: 'search',
    status: 'completed',
    rawInput: { query: 'docs' },
    rawOutput: { results: [{ title: 'Docs', url: 'https://example.com/docs', snippet: 'Example docs' }] },
  });
  assert.equal(details.innerHTML, '');
  assert.equal(tool.classList.contains('completed'), true);

  tool.querySelector('.summary').click();
  assert.match(details.innerHTML, /Docs/);
  assert.match(details.innerHTML, /Example docs/);
});

test('open tool updates refresh rendered details', async () => {
  resetDomState();

  paintTool({
    sessionUpdate: 'tool_call',
    toolCallId: 'search-open',
    title: 'web_search',
    kind: 'search',
    status: 'in_progress',
    rawInput: { query: 'docs' },
  });
  const tool = state.turnEl.querySelector('.tool');
  const details = tool.querySelector('.details');
  tool.querySelector('.summary').click();

  paintTool({
    sessionUpdate: 'tool_call_update',
    toolCallId: 'search-open',
    title: 'web_search',
    kind: 'search',
    status: 'completed',
    rawInput: { query: 'docs' },
    rawOutput: { results: [{ title: 'Fresh Docs', url: 'https://example.com/fresh', snippet: 'Updated' }] },
  });

  assert.match(details.innerHTML, /Fresh Docs/);
  assert.match(details.innerHTML, /Updated/);
});

test('background task updates preserve keyed DOM nodes', async () => {
  resetDomState();

  setBackgroundTask('a', { id: 'a', command: 'sleep 1', status: 'in_progress' });
  const first = dom.bgList.children[0];
  assert.equal(dom.bgPanel.hidden, false);
  assert.equal(first.textContent, 'sleep 1');

  setBackgroundTask('a', { id: 'a', command: 'sleep 1', status: 'completed' });
  assert.equal(dom.bgList.children[0], first);
  assert.equal(first.title, 'completed');
  assert.equal(first.classList.contains('completed'), true);

  setBackgroundTask('b', { id: 'b', command: 'sleep 2', status: 'in_progress' });
  assert.deepEqual([...dom.bgList.children].map(el => el.textContent), ['sleep 1', 'sleep 2']);

  resetAllToolState();
  assert.equal(dom.bgPanel.hidden, true);
  assert.equal(dom.bgList.children.length, 0);
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

test('todo summary count uses extracted todos and empty updates do not show zero', async () => {
  resetDomState();

  paintTool({
    sessionUpdate: 'tool_call',
    toolCallId: 'todo-count',
    title: 'todo_write',
    rawInput: {
      merge: true,
      todos: [
        { id: '1', content: 'Draft the page', status: 'pending' },
        { id: '2', content: 'Verify layout', status: 'pending' },
      ],
    },
  });
  assert.equal(state.turnEl.querySelector('.target').textContent, '(2 items)');

  paintTool({
    sessionUpdate: 'tool_call',
    toolCallId: 'todo-empty',
    title: 'todo_write',
    rawInput: { merge: true },
  });
  assert.equal(state.turnEl.querySelectorAll('.target')[1].textContent, '');
});

test('empty todo hydration clears stale sidebar state', async () => {
  resetDomState();

  setCurrentTodos([{ id: 'stale', text: 'Stale task', status: 'pending' }], { merge: false });
  assert.equal(dom.todoPanel.hidden, false);
  assert.match(dom.todoList.innerHTML, /Stale task/);

  setCurrentTodos([], { merge: false });
  assert.equal(dom.todoPanel.hidden, true);
  assert.equal(dom.todoList.innerHTML, '');
});

test('renderTodos clears the sidebar when the agent sends an empty todo list', async () => {
  resetDomState();

  paintTool({
    sessionUpdate: 'tool_call',
    toolCallId: 'todo-seed',
    title: 'todo_write',
    rawInput: { merge: false, todos: [{ id: '1', content: 'Existing task', status: 'pending' }] },
  });
  assert.equal(dom.todoPanel.hidden, false);
  assert.match(dom.todoList.innerHTML, /Existing task/);

  paintTool({
    sessionUpdate: 'tool_call',
    toolCallId: 'todo-clear',
    title: 'todo_write',
    rawInput: { merge: false, todos: [] },
  });
  assert.equal(dom.todoPanel.hidden, true);
  assert.equal(dom.todoList.innerHTML, '');
});

test('parseTodoSummary parses well-formed lines and drops malformed ones without throwing', async () => {
  const summary = [
    '- [pending] 1: First task',
    '* [in_progress] two: Second task with : colon in text',
    'not a todo line at all',
    '- [completed] 3:',
    '- malformed without brackets',
    '  - [completed]   4:   Trimmed surrounding whitespace   ',
    '',
  ].join('\n');

  const parsed = parseTodoSummary(summary);

  assert.deepEqual(parsed, [
    { status: 'pending', id: '1', text: 'First task' },
    { status: 'in_progress', id: 'two', text: 'Second task with : colon in text' },
    { status: 'completed', id: '4', text: 'Trimmed surrounding whitespace' },
  ]);

  assert.deepEqual(parseTodoSummary(null), []);
  assert.deepEqual(parseTodoSummary(''), []);
  assert.deepEqual(parseTodoSummary('no brackets here'), []);
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
  state.thinkingBuf = '';
  state.assistantEl = null;
  state.assistantBuf = '';
  state.toolEls.clear();
  state.planCards.clear();
  resetAllToolState();
}
