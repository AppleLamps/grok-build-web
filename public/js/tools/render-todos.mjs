import {
  getBackgroundTask,
  getCurrentTodos,
  setBackgroundTask,
  setCurrentTodos,
} from '../tool-state.js';
import { escapeHTML, safeStatusClass, toolTitle } from './shared.mjs';

export function isTodoUpdate(update, title) {
  return /todo[_ -]?write/.test(title)
    || update.rawInput?.variant === 'TodoWrite'
    || update.rawOutput?.type === 'Todo'
    || !!update.rawOutput?.TodosUpdated;
}

export function extractTodoUpdate(update) {
  const rawInput = update.rawInput ?? {};
  const rawOutput = update.rawOutput ?? {};
  const inputTodos = Array.isArray(rawInput.todos) ? rawInput.todos : null;
  if (inputTodos) return { todos: inputTodos, merge: rawInput.merge !== false };
  const outputTodos = Array.isArray(rawOutput.todos) ? rawOutput.todos : null;
  if (outputTodos) return { todos: outputTodos, merge: rawOutput.merge !== false };
  const summary = rawOutput.TodosUpdated?.summary_for_prompt
    ?? rawOutput.summary_for_prompt
    ?? rawOutput.output_for_prompt
    ?? rawOutput.output;
  const summaryTodos = parseTodoSummary(summary);
  if (summaryTodos.length) return { todos: summaryTodos, merge: false };
  return null;
}

function parseTodoSummary(value) {
  if (typeof value !== 'string' || !value.includes('[')) return [];
  const todos = [];
  for (const line of value.split(/\r?\n/)) {
    const match = line.match(/^\s*[-*]\s+\[([^\]]+)\]\s+([^:]+):\s*(.+?)\s*$/);
    if (!match) continue;
    todos.push({ status: match[1].trim(), id: match[2].trim(), text: match[3].trim() });
  }
  return todos;
}

export function normalizedToolStatus(update) {
  const raw = String(update.status ?? update.rawOutput?.status ?? update.rawOutput?.state ?? '').toLowerCase();
  if (/cancel/.test(raw)) return 'cancelled';
  if (/kill|killed|terminated/.test(raw)) return 'killed';
  if (/fail|error/.test(raw)) return 'failed';
  if (/complete|success|done/.test(raw)) return 'completed';
  if (/progress|running|pending/.test(raw)) return 'in_progress';
  return update.sessionUpdate === 'tool_call' ? 'in_progress' : raw;
}

function backgroundTargetId(update, titleLc) {
  if (/kill[_ -]?(command|subagent)/.test(titleLc)) {
    return update.rawInput?.task_id ?? update.rawInput?.id ?? update.rawInput?.pid ?? update.rawOutput?.task_id ?? update.rawOutput?.id ?? update.toolCallId;
  }
  return update.rawOutput?.task_id ?? update.rawOutput?.id ?? update.rawInput?.task_id ?? update.rawInput?.id ?? update.toolCallId;
}

export function updateBackgroundTask(update, titleLc) {
  const isBg = update.rawInput?.is_background === true
    || update.rawOutput?.type === 'BackgroundTaskStarted'
    || /^(kill|get|wait)[_ -]?(command|commands|subagent|subagents)/.test(titleLc);
  if (!isBg) return;
  const id = backgroundTargetId(update, titleLc);
  const command = update.rawInput?.command
    ?? update.rawInput?.prompt
    ?? update.rawInput?.description
    ?? update.rawOutput?.command
    ?? update.title
    ?? id;
  const status = /kill[_ -]?(command|subagent)/.test(titleLc)
    ? 'killed'
    : update.rawOutput?.status === 'running'
      ? 'in_progress'
    : normalizedToolStatus(update) || 'running';
  const prior = getBackgroundTask(id) ?? { id, command, status: 'running' };
  setBackgroundTask(id, { ...prior, command: prior.command ?? command, status });
}

export function renderTodos(update) {
  const extracted = extractTodoUpdate(update);
  if (!extracted) return null;
  const { todos, merge } = extracted;
  const current = todos.length > 0
    ? setCurrentTodos(todos, { merge })
    : getCurrentTodos();
  const renderList = current.length > 0 ? current : todos;
  return `
    <div class="label">todos</div>
    <ul class="todo-inline">
      ${renderList.map(t => {
        const status = safeStatusClass(t.status ?? t.state ?? 'pending');
        const text = t.text ?? t.content ?? t.task ?? '';
        return `<li class="todo-item ${status}">${escapeHTML(text)}</li>`;
      }).join('')}
    </ul>
  `;
}
