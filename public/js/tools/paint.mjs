import {
  enterSubagent,
  exitSubagent,
} from '../tool-state.js';
import { STATUS_ICONS, safeStatusClass } from './shared.mjs';
import { summarizeTool } from './summarize.mjs';
import { getToolEl } from './dom.mjs';
import { renderToolDetails } from './details-registry.mjs';
import { renderMultimodalDetails } from './render-multimodal.mjs';
import { normalizedToolStatus, updateBackgroundTask } from './render-todos.mjs';

export function paintTool(update) {
  const titleLc = (update.title ?? '').toLowerCase();
  if (update.sessionUpdate === 'tool_call' && /use_tool/.test(titleLc)) {
    enterSubagent();
  }
  if (update.sessionUpdate === 'tool_call_update' && ['completed', 'failed', 'cancelled', 'killed'].includes(normalizedToolStatus(update)) && /use_tool/.test(titleLc)) {
    exitSubagent();
  }

  updateBackgroundTask(update, titleLc);

  const el = getToolEl(update.toolCallId);
  const summary = summarizeTool(update);
  el.querySelector('.verb').textContent = summary.verb ? summary.verb + ' ' : '';
  const targetEl = el.querySelector('.target');
  if (summary.target?.startsWith('`') && summary.target.endsWith('`')) {
    targetEl.textContent = summary.target.slice(1, -1);
  } else {
    targetEl.textContent = summary.target ?? '';
  }
  el.querySelector('.delta-add').textContent = summary.deltaAdd ? `+${summary.deltaAdd}` : '';
  el.querySelector('.delta-del').textContent = summary.deltaDel ? `-${summary.deltaDel}` : '';
  const status = normalizedToolStatus(update);
  if (status) {
    const cls = safeStatusClass(status);
    el.classList.remove('in_progress', 'completed', 'failed', 'cancelled', 'killed', 'unknown');
    el.classList.add(cls);
    const sicon = el.querySelector('.status-icon');
    if (sicon) sicon.innerHTML = STATUS_ICONS[cls] ?? '';
  }
  const body = el.querySelector('.details');
  const specialHTML = renderToolDetails(update);

  if (specialHTML) {
    body.innerHTML = specialHTML;
    return;
  }

  const sections = [];
  if (update.rawInput) sections.push(['input', update.rawInput]);
  const multimodal = renderMultimodalDetails(update);
  if (multimodal) sections.push(['output', multimodal, 'html']);
  const outText = multimodal ? null : update.rawOutput?.output_for_prompt
    ?? update.rawOutput?.output
    ?? (Array.isArray(update.content) ? update.content.map(c => c?.content?.text ?? '').join('') : null);
  if (outText && outText !== '') sections.push(['output', outText]);
  body.innerHTML = '';
  for (const [label, value, mode] of sections) {
    const lab = document.createElement('div'); lab.className = 'label'; lab.textContent = label;
    body.appendChild(lab);
    if (mode === 'html') {
      const div = document.createElement('div');
      div.innerHTML = value;
      body.appendChild(div);
    } else {
      const pre = document.createElement('pre');
      pre.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
      body.appendChild(pre);
    }
  }
}
