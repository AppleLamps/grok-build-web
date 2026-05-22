// Compact model picker shared by the footer model and composer model tag.

import { cliModels, getSpawnOpts, postRespawn } from './api.js';
import { dom } from './state.js';
import { modal } from './modal.js';
import { toast } from './toast.js';
import { setBusy } from './composer.js';
import { setStatus, addError } from './chat.js';

const KNOWN_MODEL_IDS = [
  'grok-build',
  'grok-build-0.1',
  'grok-4.3',
  'grok-4.20-0309-non-reasoning',
  'grok-4.20-0309-reasoning',
  'grok-4.20-multi-agent-0309',
  'grok-imagine-image',
  'grok-imagine-image-quality',
  'grok-imagine-video',
];

function parseModelIds(text) {
  if (!text) return [];
  const matches = text.match(/grok[-/][a-z0-9._-]+/gi) ?? [];
  return Array.from(new Set(matches));
}

function labelFor(model) {
  return model || 'grok-build';
}

function paintModel(model) {
  const label = labelFor(model);
  if (dom.modelTag) dom.modelTag.textContent = label;
  if (dom.footerModel) dom.footerModel.textContent = `${label} ▾`;
}

export async function refreshModelLabel() {
  try {
    const opts = await getSpawnOpts();
    paintModel(opts.model);
  } catch {
    paintModel(null);
  }
}

async function openModelPicker() {
  const wrap = document.createElement('form');
  wrap.className = 'model-picker-form';
  wrap.innerHTML = `
    <div class="model-current">Current model: <strong class="model-current-value">loading...</strong></div>
    <label>
      <span>Model</span>
      <select name="model"><option value="">Loading models...</option></select>
    </label>
    <label>
      <span>Custom model</span>
      <input name="customModel" type="text" placeholder="Type a model ID" />
    </label>
    <div class="workspace-actions">
      <button class="apply" type="submit">Apply & restart</button>
      <button class="cancel" type="button">Cancel</button>
    </div>
  `;
  const { close } = modal('Change model', wrap);
  const select = wrap.querySelector('select');
  const currentEl = wrap.querySelector('.model-current-value');
  let current = {};
  try { current = await getSpawnOpts(); } catch { current = {}; }
  currentEl.textContent = labelFor(current.model);
  let raw = '';
  try { raw = await cliModels(); } catch { /* fallback list below */ }
  const ids = Array.from(new Set([...parseModelIds(raw), ...KNOWN_MODEL_IDS]));
  const opts = ['', ...ids];
  if (current.model && !opts.includes(current.model)) opts.push(current.model);
  select.innerHTML = '';
  for (const id of opts) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = id || '(default)';
    option.selected = id === (current.model ?? '');
    select.appendChild(option);
  }
  wrap.querySelector('.cancel').addEventListener('click', close);
  wrap.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(wrap);
    const custom = fd.get('customModel')?.toString().trim();
    const model = custom || fd.get('model')?.toString() || null;
    close();
    setBusy(true);
    setStatus('respawning agent...', 'busy');
    try {
      await postRespawn({ model });
      paintModel(model);
      toast('Model changed');
    } catch (err) {
      addError(`model change failed: ${err.message}`);
      setBusy(false);
    }
  });
  return { wrap, close };
}

export function initModelPicker() {
  dom.modelTag?.addEventListener('click', openModelPicker);
  dom.footerModel?.addEventListener('click', openModelPicker);
  refreshModelLabel();
}

export function __testParseModelIds(text) {
  return parseModelIds(text);
}

export async function __testOpenModelPicker() {
  return openModelPicker();
}
