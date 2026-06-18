import { dom } from './state.js';
import {
  getBackgroundTask,
  renderBackgroundTaskPanel,
  resetBackgroundTasks,
  setBackgroundTask,
} from './background-tasks.js';

export { getBackgroundTask, setBackgroundTask };

let subagentDepth = 0;
const todosById = new Map();
const idlessTodos = [];
const SAFE_STATUS_CLASSES = new Set(['pending', 'in_progress', 'completed', 'failed', 'cancelled', 'killed']);

export function resetTransientToolState() {
  subagentDepth = 0;
  resetBackgroundTasks();
}

export function resetAllToolState() {
  resetTransientToolState();
  todosById.clear();
  idlessTodos.length = 0;
  renderTodoPanel();
}

export function getSubagentDepth() {
  return subagentDepth;
}

export function enterSubagent() {
  subagentDepth++;
}

export function exitSubagent() {
  subagentDepth = Math.max(0, subagentDepth - 1);
}

export function getCurrentTodos() {
  return [...todosById.values(), ...idlessTodos];
}

export function setCurrentTodos(todos, { merge = false } = {}) {
  if (!merge) {
    todosById.clear();
    idlessTodos.length = 0;
  }
  for (const todo of todos ?? []) {
    const normalized = normalizeTodo(todo);
    if (!normalized) continue;
    if (!normalized.id) {
      idlessTodos.push(normalized);
      continue;
    }
    const prior = todosById.get(normalized.id) ?? {};
    todosById.set(normalized.id, {
      ...prior,
      ...normalized,
      text: normalized.text || prior.text || '',
      status: normalized.status || prior.status || 'pending',
    });
  }
  renderTodoPanel();
  return getCurrentTodos();
}

export function renderBgPanel() {
  renderBackgroundTaskPanel();
}

function renderTodoPanel() {
  if (!dom.todoPanel || !dom.todoList) return;
  const todos = getCurrentTodos();
  dom.todoPanel.hidden = todos.length === 0;
  dom.todoList.innerHTML = todos.map(t => {
    const status = safeStatusClass(t.status ?? t.state ?? 'pending');
    const text = t.text ?? t.content ?? t.task ?? '';
    return `<div class="todo-item ${status}" title="${escapeAttr(status)}">${escapeHTML(text)}</div>`;
  }).join('');
}

function normalizeTodo(todo) {
  if (!todo || typeof todo !== 'object') return null;
  return {
    id: todo.id == null ? '' : String(todo.id),
    text: String(todo.text ?? todo.content ?? todo.task ?? todo.title ?? todo.description ?? ''),
    status: String(todo.status ?? todo.state ?? 'pending'),
  };
}

function safeStatusClass(value) {
  const status = String(value ?? '').toLowerCase();
  return SAFE_STATUS_CLASSES.has(status) ? status : 'unknown';
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
}

function escapeAttr(value) {
  return escapeHTML(value).replace(/"/g, '&quot;');
}
