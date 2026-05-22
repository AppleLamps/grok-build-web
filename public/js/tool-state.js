import { dom } from './state.js';

let subagentDepth = 0;
const bgTasks = new Map();

export function resetTransientToolState() {
  subagentDepth = 0;
  bgTasks.clear();
  renderBgPanel();
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
  renderBgPanel();
}

export function renderBgPanel() {
  if (!dom.bgPanel || !dom.bgList) return;
  dom.bgPanel.hidden = bgTasks.size === 0;
  dom.bgList.innerHTML = Array.from(bgTasks.values()).map(t => {
    const status = t.status ?? 'running';
    return `<div class="todo-item ${status}" title="${status}">${
      (t.command ?? t.id ?? '').replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c])).slice(0, 60)
    }</div>`;
  }).join('');
}
