import { dom } from './state.js';

let subagentDepth = 0;
const bgTasks = new Map();
const bgTaskEls = new Map();
const todosById = new Map();
const idlessTodos = [];
const SAFE_STATUS_CLASSES = new Set(['pending', 'in_progress', 'completed', 'failed', 'cancelled', 'killed']);

export function resetTransientToolState() {
  subagentDepth = 0;
  bgTasks.clear();
  bgTaskEls.clear();
  renderBgPanel();
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

export function getBackgroundTask(id) {
  return bgTasks.get(id);
}

export function setBackgroundTask(id, task) {
  bgTasks.set(id, task);
  renderBgTask(id, task);
  if (dom.bgPanel) dom.bgPanel.hidden = bgTasks.size === 0;
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
  if (!dom.bgPanel || !dom.bgList) return;
  dom.bgPanel.hidden = bgTasks.size === 0;
  dom.bgList.replaceChildren();
  bgTaskEls.clear();
  for (const [id, task] of bgTasks) renderBgTask(id, task);
}

function renderBgTask(id, task) {
  if (!dom.bgPanel || !dom.bgList) return;
  let item = bgTaskEls.get(id);
  if (!item) {
    item = document.createElement('div');
    bgTaskEls.set(id, item);
    dom.bgList.appendChild(item);
  }
  const status = safeStatusClass(task.status ?? 'running');
  const label = String(task.command ?? task.id ?? '').slice(0, 60);
  item.className = `todo-item ${status}`;
  item.title = status;
  item.textContent = label;
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
