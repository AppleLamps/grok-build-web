import {
  enterSubagent,
  exitSubagent,
} from '../tool-state.js';
import { STATUS_ICONS, safeStatusClass } from './shared.mjs';
import { summarizeTool } from './summarize.mjs';
import { getToolEl, getToolRefs, setToolOpenHandler } from './dom.mjs';
import { renderToolDetails } from './details-registry.mjs';
import { renderMultimodalDetails } from './render-multimodal.mjs';
import { isTodoUpdate, normalizedToolStatus, updateBackgroundTask } from './render-todos.mjs';

setToolOpenHandler(renderLatestToolDetails);

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
  const refs = getToolRefs(el);
  const summary = summarizeTool(update);
  if (isInformativeSummary(summary) || !refs.displaySummary) refs.displaySummary = summary;
  const displaySummary = refs.displaySummary;
  refs.verb.textContent = displaySummary.verb ? displaySummary.verb + ' ' : '';
  const targetEl = refs.target;
  if (displaySummary.target?.startsWith('`') && displaySummary.target.endsWith('`')) {
    targetEl.textContent = displaySummary.target.slice(1, -1);
  } else {
    targetEl.textContent = displaySummary.target ?? '';
  }
  refs.deltaAdd.textContent = displaySummary.deltaAdd ? `+${displaySummary.deltaAdd}` : '';
  refs.deltaDel.textContent = displaySummary.deltaDel ? `-${displaySummary.deltaDel}` : '';
  const status = normalizedToolStatus(update);
  if (status) {
    const cls = safeStatusClass(status);
    el.classList.remove('in_progress', 'completed', 'failed', 'cancelled', 'killed', 'unknown');
    el.classList.add(cls);
    refs.statusIcon.innerHTML = STATUS_ICONS[cls] ?? '';
  }
  refs.latestUpdate = update;
  refs.detailsDirty = true;
  if (el.classList.contains('open') || isTodoUpdate(update, titleLc)) renderDetails(refs, update);
}

function isInformativeSummary(summary) {
  return summary.verb !== 'used tool' || !!summary.target || !!summary.deltaAdd || !!summary.deltaDel;
}

function renderLatestToolDetails(el) {
  const refs = getToolRefs(el);
  if (!refs?.latestUpdate || !refs.detailsDirty) return;
  renderDetails(refs, refs.latestUpdate);
}

function renderDetails(refs, update) {
  const body = refs.details;
  const specialHTML = renderToolDetails(update);

  if (specialHTML) {
    body.innerHTML = specialHTML;
    refs.detailsDirty = false;
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
  refs.detailsDirty = false;
}
