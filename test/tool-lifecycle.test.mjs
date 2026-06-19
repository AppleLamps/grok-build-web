import assert from 'node:assert/strict';
import test from 'node:test';
import { importPublic, installDomStubs } from './helpers.mjs';

installDomStubs();
const { state, dom } = await importPublic('public/js/state.js');
const { paintTool } = await importPublic('public/js/tools.js');
const { setBackgroundTask, setCurrentTodos, resetAllToolState } = await importPublic('public/js/tool-state.js');
const {
  buildBackgroundTaskPrompt,
  getBackgroundTask,
  handleBackgroundTaskAction,
} = await importPublic('public/js/background-tasks.js');
const { parseTodoSummary, normalizedToolStatus } = await importPublic('public/js/tools/render-todos.mjs');
const { normalizeStatus, safeStatusClass } = await importPublic('public/js/tools/shared.mjs');
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
  assert.equal(dom.bgList.querySelector('.bg-task-card').title, 'cancelled');

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

test('shared status normalization handles free-form task statuses consistently', async () => {
  assert.equal(normalizeStatus('fail'), 'failed');
  assert.equal(normalizeStatus('terminated'), 'killed');
  assert.equal(normalizeStatus('queued'), 'pending');
  assert.equal(normalizeStatus('active'), 'in_progress');
  assert.equal(normalizeStatus('exit 0'), 'completed');
  assert.equal(safeStatusClass('success'), 'completed');
  assert.equal(safeStatusClass('unmapped'), 'unknown');
  assert.equal(normalizedToolStatus({ status: 'terminated' }), 'killed');
  assert.equal(normalizedToolStatus({ status: 'queued' }), 'pending');
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

test('web_fetch failure details preserve GitHub gh CLI guidance', async () => {
  resetDomState();

  const guidance = [
    'GitHub-hosted web_fetch failed because internal access is blocked.',
    'Use the gh CLI for GitHub content instead, for example:',
    'gh api repos/xai-org/example/contents/README.md --jq .content',
    'END_OF_GUIDANCE_SENTINEL',
  ].join('\n');

  paintTool({
    sessionUpdate: 'tool_call_update',
    toolCallId: 'fetch-github-guidance',
    title: 'web_fetch',
    kind: 'fetch',
    status: 'failed',
    rawInput: { url: 'https://github.com/xai-org/example/blob/main/README.md' },
    rawOutput: { output_for_prompt: guidance },
  });

  const tool = state.turnEl.querySelector('.tool');
  const details = tool.querySelector('.details');
  assert.equal(details.innerHTML, '');

  tool.querySelector('.summary').click();

  const output = details.querySelectorAll('pre')[1]?.textContent ?? '';
  assert.equal(output, guidance);
  assert.match(output, /gh api repos\/xai-org\/example\/contents\/README\.md/);
  assert.match(output, /END_OF_GUIDANCE_SENTINEL$/);
});

test('background task updates preserve keyed DOM nodes', async () => {
  resetDomState();

  setBackgroundTask('a', { id: 'a', command: 'sleep 1', status: 'in_progress' });
  const first = dom.bgList.querySelector('[data-task-id="a"]');
  assert.equal(dom.bgPanel.hidden, false);
  assert.match(first.innerHTML, /sleep 1/);

  setBackgroundTask('a', { id: 'a', command: 'sleep 1', status: 'completed' });
  assert.equal(dom.bgList.querySelector('[data-task-id="a"]'), first);
  assert.equal(first.title, 'completed');
  assert.equal(first.classList.contains('completed'), true);

  setBackgroundTask('b', { id: 'b', command: 'sleep 2', status: 'in_progress' });
  assert.match(dom.bgList.querySelector('[data-task-id="a"]').innerHTML, /sleep 1/);
  assert.match(dom.bgList.querySelector('[data-task-id="b"]').innerHTML, /sleep 2/);

  resetAllToolState();
  assert.equal(dom.bgPanel.hidden, true);
  assert.equal(dom.bgList.children.length, 0);
});

test('background panel groups command, monitor, subagent, wait, kill, and resumed updates', async () => {
  resetDomState();

  paintTool({
    sessionUpdate: 'tool_call',
    toolCallId: 'cmd-call',
    title: 'run_terminal_command',
    kind: 'execute',
    status: 'in_progress',
    rawInput: { command: 'npm test', is_background: true },
    rawOutput: { task_id: 'cmd-1', status: 'running' },
  });
  paintTool({
    sessionUpdate: 'tool_call_update',
    toolCallId: 'mon-call',
    title: 'monitor',
    kind: 'execute',
    status: 'in_progress',
    rawInput: { id: 'mon-1', description: 'watch logs' },
    rawOutput: { output: 'loop 1\nall good', iteration: 1 },
  });
  paintTool({
    sessionUpdate: 'tool_call_update',
    toolCallId: 'sub-call',
    title: 'get_subagent_output',
    kind: 'execute',
    status: 'completed',
    rawInput: { task_id: 'sub-1', prompt: 'check docs' },
    rawOutput: { task_status: 'running', output: 'still running' },
  });
  paintTool({
    sessionUpdate: 'tool_call_update',
    toolCallId: 'wait-call',
    title: 'wait_commands_or_subagents',
    kind: 'execute',
    status: 'completed',
    rawInput: { task_id: 'loop-1' },
    rawOutput: { task_status: 'running', output: 'iteration output', iteration: 3 },
  });
  paintTool({
    sessionUpdate: 'tool_call_update',
    toolCallId: 'resume-call',
    title: 'background_task_resumed',
    kind: 'execute',
    status: 'in_progress',
    rawOutput: { task_id: 'resumed-1', status: 'running', output: 'resumed output' },
  });
  paintTool({
    sessionUpdate: 'tool_call_update',
    toolCallId: 'kill-call',
    title: 'kill_command_or_subagent',
    kind: 'execute',
    status: 'completed',
    rawInput: { task_id: 'cmd-1' },
  });

  assert.equal(getBackgroundTask('cmd-1').status, 'killed');
  assert.equal(getBackgroundTask('mon-1').group, 'monitors');
  assert.equal(getBackgroundTask('sub-1').group, 'subagents');
  assert.equal(getBackgroundTask('loop-1').group, 'loops');
  assert.equal(getBackgroundTask('resumed-1').group, 'other');
  assert.match(dom.bgList.textContent, /Commands/);
  assert.match(dom.bgList.textContent, /Monitors/);
  assert.match(dom.bgList.textContent, /Subagents/);
  assert.match(dom.bgList.textContent, /Loops \/ waits/);
  assert.match(dom.bgList.textContent, /Other background tasks/);
  assert.match(dom.bgList.querySelector('[data-task-id="mon-1"]').innerHTML, /loop 1/);
  assert.match(dom.bgList.querySelector('[data-task-id="loop-1"]').innerHTML, /iteration 3/);
});

test('background output fetch preserves prior command and updates preview', async () => {
  resetDomState();

  paintTool({
    sessionUpdate: 'tool_call',
    toolCallId: 'cmd-preview',
    title: 'run_terminal_command',
    kind: 'execute',
    status: 'in_progress',
    rawInput: { command: 'tail -f app.log', is_background: true },
    rawOutput: { task_id: 'preview-1', status: 'running' },
  });
  paintTool({
    sessionUpdate: 'tool_call_update',
    toolCallId: 'cmd-preview-output',
    title: 'get_command_or_subagent_output',
    kind: 'execute',
    status: 'completed',
    rawInput: { task_id: 'preview-1' },
    rawOutput: { output: '\u001b[32mok\u001b[0m\nready' },
  });

  const task = getBackgroundTask('preview-1');
  assert.equal(task.command, 'tail -f app.log');
  assert.equal(task.status, 'in_progress');
  assert.match(task.outputPreview, /ok/);
  assert.match(dom.bgList.querySelector('[data-task-id="preview-1"]').innerHTML, /ready/);
});

test('background panel escapes hostile task values', async () => {
  resetDomState();

  setBackgroundTask('x" onclick="alert(1)', {
    command: '<img src=x onerror=alert(1)>',
    status: 'in_progress',
    outputPreview: '<script>alert(1)</script>',
  });

  const card = dom.bgList.querySelector('.bg-task-card');
  assert.doesNotMatch(card.innerHTML, /<img /);
  assert.doesNotMatch(card.innerHTML, /<script>/);
  assert.doesNotMatch(card.innerHTML, /\sonclick="/);
  assert.doesNotMatch(card.innerHTML, /<[^>]+\sonerror=/);
  assert.match(card.innerHTML, /&lt;img/);
  assert.match(card.innerHTML, /&lt;script/);
});

test('background task actions open inline tools and post output or kill prompts', async () => {
  resetDomState();
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (path, opts = {}) => {
    requests.push({ path: String(path), body: opts.body ? JSON.parse(opts.body) : null });
    return new Response(JSON.stringify({ ok: true }), { status: 202 });
  };
  try {
    paintTool({
      sessionUpdate: 'tool_call',
      toolCallId: 'action-call',
      title: 'run_terminal_command',
      kind: 'execute',
      status: 'in_progress',
      rawInput: { command: 'sleep 60', is_background: true },
      rawOutput: { task_id: 'action-1', status: 'running' },
    });

    const card = dom.bgList.querySelector('[data-task-id="action-1"]');
    await handleBackgroundTaskAction({ target: card.querySelector('[data-bg-action="open"]'), preventDefault() {}, stopPropagation() {} });
    const tool = state.toolEls.get('action-call');
    assert.equal(tool.classList.contains('open'), true);
    assert.equal(tool.closest('.tool-group').classList.contains('open'), true);

    await handleBackgroundTaskAction({ target: card.querySelector('[data-bg-action="output"]'), preventDefault() {}, stopPropagation() {} });
    await handleBackgroundTaskAction({ target: card.querySelector('[data-bg-action="kill"]'), preventDefault() {}, stopPropagation() {} });

    assert.equal(requests[0].path, '/prompt');
    assert.equal(requests[0].body.text, buildBackgroundTaskPrompt('output', 'action-1'));
    assert.equal(requests[1].body.text, buildBackgroundTaskPrompt('kill', 'action-1'));
  } finally {
    globalThis.fetch = originalFetch;
  }
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
