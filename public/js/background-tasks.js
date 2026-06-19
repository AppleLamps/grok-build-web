import { dom, state } from './state.js';
import { postPrompt } from './api.js';
import { ansiToHtml, escapeAttr, escapeHTML, firstText, normalizeStatus, safeStatusClass } from './tools/shared.mjs';

const PREVIEW_LIMIT = 220;
const GROUP_ORDER = ['commands', 'monitors', 'subagents', 'loops', 'other'];
const GROUP_LABELS = {
  commands: 'Commands',
  monitors: 'Monitors',
  subagents: 'Subagents',
  loops: 'Loops / waits',
  other: 'Other background tasks',
};
const FINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'killed']);

const bgTasks = new Map();
const bgTaskEls = new Map();
let actionsWired = false;

export function resetBackgroundTasks() {
  bgTasks.clear();
  bgTaskEls.clear();
  renderBackgroundTaskPanel();
}

export function getBackgroundTask(id) {
  return bgTasks.get(String(id ?? ''));
}

function getBackgroundTasks() {
  return [...bgTasks.values()];
}

export function setBackgroundTask(id, task = {}) {
  const key = String(id ?? task.id ?? '').trim();
  if (!key) return null;
  const prior = bgTasks.get(key);
  const normalized = normalizeTaskRecord(key, task, prior);
  bgTasks.set(key, normalized);
  renderBackgroundTaskPanel();
  return normalized;
}

export function updateBackgroundTask(update, titleLc = '') {
  const title = titleLc || String(update?.title ?? '').toLowerCase();
  if (!isBackgroundUpdate(update, title)) return null;
  const id = backgroundTargetId(update, title);
  if (!id) return null;
  return setBackgroundTask(id, taskFromUpdate(update, title, id));
}

export function renderBackgroundTaskPanel() {
  if (!dom.bgPanel || !dom.bgList) return;
  wireBackgroundTaskActions();
  dom.bgPanel.hidden = bgTasks.size === 0;
  dom.bgList.replaceChildren();
  if (bgTasks.size === 0) return;

  for (const group of GROUP_ORDER) {
    const tasks = [...bgTasks.values()].filter((task) => task.group === group);
    if (!tasks.length) continue;
    const section = document.createElement('section');
    section.className = `bg-task-group ${group}`;
    const head = document.createElement('div');
    head.className = 'bg-task-group-head';
    head.textContent = `${GROUP_LABELS[group]} · ${tasks.length}`;
    section.appendChild(head);
    for (const task of tasks) section.appendChild(renderTaskCard(task));
    dom.bgList.appendChild(section);
  }
}

export function buildBackgroundTaskPrompt(action, id) {
  const taskId = String(id ?? '').trim();
  if (!taskId) return '';
  if (action === 'output') {
    return `Get output for background task ${taskId}. Use the appropriate get_command_or_subagent_output tool.`;
  }
  if (action === 'kill') {
    return `Kill background task ${taskId}. Use the appropriate kill_command_or_subagent tool.`;
  }
  return '';
}

export async function handleBackgroundTaskAction(event) {
  const button = event.target?.closest?.('[data-bg-action]');
  if (!button) return false;
  event.preventDefault?.();
  event.stopPropagation?.();
  const taskId = button.dataset.taskId ?? button.dataset['task-id'];
  const action = button.dataset.bgAction ?? button.dataset['bg-action'];
  if (action === 'open') {
    openInlineTool(taskId);
    return true;
  }
  const prompt = buildBackgroundTaskPrompt(action, taskId);
  if (!prompt) return true;
  button.disabled = true;
  try {
    await postPrompt(prompt);
  } catch (e) {
    console.warn('[grok-web] background task action failed', e);
  } finally {
    button.disabled = false;
  }
  return true;
}

function renderTaskCard(task) {
  let card = bgTaskEls.get(task.id);
  if (!card) {
    card = document.createElement('article');
    card.className = 'todo-item bg-task-card';
    bgTaskEls.set(task.id, card);
  }
  const status = safeStatusClass(task.status);
  const active = !FINAL_STATUSES.has(status);
  card.className = `todo-item bg-task-card ${status}`;
  card.title = status;
  card.dataset.taskId = task.id;
  card.setAttribute('data-task-id', task.id);
  card.innerHTML = `
    <div class="bg-task-main">
      <div class="bg-task-topline">
        <span class="bg-task-status ${status}">${statusLabel(status)}</span>
        <code class="bg-task-id">${escapeHTML(task.id)}</code>
        <span class="bg-task-updated">${escapeHTML(relativeTime(task.updatedAt))}</span>
      </div>
      <div class="bg-task-title">${escapeHTML(task.command || task.title || task.id)}</div>
      ${task.iteration ? `<div class="bg-task-loop">iteration ${escapeHTML(task.iteration)}</div>` : ''}
      ${task.outputPreview ? `<pre class="bg-task-preview">${ansiPreview(task.outputPreview)}</pre>` : ''}
    </div>
    <div class="bg-task-actions">
      <button type="button" data-bg-action="open" data-task-id="${escapeAttr(task.id)}"${task.toolCallId ? '' : ' disabled'}>Open</button>
      <button type="button" data-bg-action="output" data-task-id="${escapeAttr(task.id)}">Output</button>
      <button type="button" data-bg-action="kill" data-task-id="${escapeAttr(task.id)}"${active ? '' : ' disabled'}>Kill</button>
    </div>
  `;
  return card;
}

function normalizeTaskRecord(id, task, prior = null) {
  const now = Date.now();
  const output = firstText(task.lastOutput, task.outputPreview, prior?.lastOutput, prior?.outputPreview);
  return {
    id,
    kind: task.kind || prior?.kind || 'background',
    group: normalizedGroup(task, prior),
    title: task.title || prior?.title || '',
    command: normalizedCommand(task, prior, id),
    status: normalizeStatus(task.status || prior?.status || 'in_progress', 'in_progress'),
    toolCallId: task.toolCallId || prior?.toolCallId || '',
    startedAt: task.startedAt || prior?.startedAt || now,
    updatedAt: task.updatedAt || now,
    outputPreview: previewText(output),
    lastOutput: output,
    iteration: task.iteration || prior?.iteration || '',
    raw: task.raw || prior?.raw || null,
  };
}

function taskFromUpdate(update, titleLc, id) {
  const rawInput = update.rawInput ?? {};
  const rawOutput = update.rawOutput ?? {};
  const group = taskGroup(update, titleLc);
  return {
    id,
    kind: taskKind(group, titleLc),
    group,
    title: update.title ?? '',
    command: firstText(
      rawInput.command,
      rawInput.prompt,
      rawInput.description,
      rawOutput.command,
      rawOutput.title,
      update.title,
      id,
    ),
    status: taskStatus(update, titleLc),
    toolCallId: update.toolCallId ?? '',
    outputPreview: taskOutput(update),
    lastOutput: taskOutput(update),
    iteration: rawOutput.iteration ?? rawOutput.loop_iteration ?? rawInput.iteration ?? rawInput.loop_iteration ?? '',
    raw: { rawInput, rawOutput, title: update.title ?? '', status: update.status ?? '' },
  };
}

function normalizedCommand(task, prior, id) {
  const next = task.command || task.title || id;
  const actionTitle = /^(get|kill|wait)[_ -]?(command|commands|subagent|subagents)/i.test(String(task.title ?? ''));
  if (prior?.command && (!task.command || task.command === task.title || actionTitle)) return prior.command;
  return next;
}

function normalizedGroup(task, prior) {
  const actionTitle = /^(get|kill)[_ -]?(command|commands|subagent|subagents)/i.test(String(task.title ?? ''));
  if (prior?.group && actionTitle) return prior.group;
  return GROUP_ORDER.includes(task.group) ? task.group : (prior?.group || 'other');
}

function isBackgroundUpdate(update, titleLc) {
  const rawInput = update?.rawInput ?? {};
  const rawOutput = update?.rawOutput ?? {};
  if (rawInput.is_background === true) return true;
  if (/background/i.test(String(rawOutput.type ?? rawOutput.kind ?? ''))) return true;
  if (/monitor/.test(titleLc)) return true;
  if (/^(kill|get|wait)[_ -]?(command|commands|subagent|subagents)/.test(titleLc)) return true;
  if (/background/.test(titleLc) && backgroundTargetId(update, titleLc)) return true;
  if (/subagent/.test(titleLc) && backgroundTargetId(update, titleLc)) return true;
  if ((rawInput.task_id || rawOutput.task_id) && (rawOutput.output || rawOutput.output_for_prompt || rawOutput.status)) return true;
  return false;
}

function backgroundTargetId(update, titleLc) {
  const rawInput = update?.rawInput ?? {};
  const rawOutput = update?.rawOutput ?? {};
  if (/kill[_ -]?(command|subagent)/.test(titleLc)) {
    return rawInput.task_id ?? rawInput.taskId ?? rawInput.id ?? rawInput.pid ?? rawOutput.task_id ?? rawOutput.taskId ?? rawOutput.id ?? update.toolCallId;
  }
  return rawOutput.task_id ?? rawOutput.taskId ?? rawOutput.id ?? rawInput.task_id ?? rawInput.taskId ?? rawInput.id ?? update.toolCallId;
}

function taskGroup(update, titleLc) {
  const rawInput = update.rawInput ?? {};
  const rawOutput = update.rawOutput ?? {};
  if (/monitor/.test(titleLc) || rawInput.monitor || rawOutput.monitor) return 'monitors';
  if (/wait[_ -]?(commands?|subagents?)/.test(titleLc) || rawInput.loop || rawOutput.loop || rawOutput.iteration != null) return 'loops';
  if (/subagent/.test(titleLc) || rawInput.tool === 'subagent' || rawOutput.kind === 'subagent') return 'subagents';
  if (/run[_ -]?terminal[_ -]?command|command/.test(titleLc) || rawInput.command || rawOutput.command) return 'commands';
  return 'other';
}

function taskKind(group, titleLc) {
  if (group === 'commands') return 'command';
  if (group === 'monitors') return 'monitor';
  if (group === 'subagents') return 'subagent';
  if (group === 'loops') return /wait/.test(titleLc) ? 'wait' : 'loop';
  return 'background';
}

function taskStatus(update, titleLc) {
  const rawOutput = update.rawOutput ?? {};
  if (/kill[_ -]?(command|subagent)/.test(titleLc)) return 'killed';
  if (/get[_ -]?(command|subagent)/.test(titleLc)) {
    return normalizeStatus(rawOutput.task_status ?? rawOutput.taskStatus ?? rawOutput.state ?? 'in_progress', 'in_progress');
  }
  return normalizeStatus(rawOutput.task_status ?? rawOutput.taskStatus ?? rawOutput.status ?? rawOutput.state ?? update.status ?? 'in_progress', 'in_progress');
}

function taskOutput(update) {
  const rawOutput = update.rawOutput ?? {};
  const content = Array.isArray(update.content)
    ? update.content.map((item) => item?.content?.text ?? item?.text ?? '').join('')
    : '';
  return firstText(rawOutput.output_for_prompt, rawOutput.output, rawOutput.stdout, rawOutput.stderr, rawOutput.text, content);
}

function openInlineTool(taskId) {
  const task = getBackgroundTask(taskId);
  const tool = task?.toolCallId ? state.toolEls.get(task.toolCallId) : null;
  if (!tool) return;
  const group = tool.closest?.('.tool-group');
  group?.classList.add('open');
  if (!tool.classList.contains('open')) tool.querySelector('.summary')?.click?.();
  tool.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
}

function wireBackgroundTaskActions() {
  if (actionsWired || !dom.bgList) return;
  dom.bgList.addEventListener('click', handleBackgroundTaskAction);
  actionsWired = true;
}

function statusLabel(value) {
  return value.replace(/_/g, ' ');
}

function previewText(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  return text.length > PREVIEW_LIMIT ? `${text.slice(0, PREVIEW_LIMIT - 1)}…` : text;
}

function ansiPreview(value) {
  return ansiToHtml(previewText(value));
}

function relativeTime(value) {
  const ts = Number(value);
  if (!Number.isFinite(ts)) return '';
  const diff = Math.max(0, Date.now() - ts);
  if (diff < 5000) return 'now';
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return `${Math.floor(diff / 3600000)}h ago`;
}

export const __test = {
  bgTasks,
  bgTaskEls,
  getBackgroundTasks,
  isBackgroundUpdate,
  taskFromUpdate,
  normalizeStatus,
};
