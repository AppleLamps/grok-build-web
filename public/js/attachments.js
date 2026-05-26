// Composer attachments: text files inline as fenced code; images and PDFs
// upload to the session cwd and attach by path so grok's own read_file tool
// can load them. Adds drag-and-drop on the whole window.

import { dom } from './state.js';
import { toast } from './toast.js';
import { postUpload } from './api.js';

const MAX_FILES = 5;
const TEXT_MAX_BYTES = 256 * 1024;
const BINARY_MAX_BYTES = 25 * 1024 * 1024;

const TEXT_EXTS = new Set([
  '.txt', '.md', '.js', '.mjs', '.ts', '.tsx', '.json', '.css', '.html',
  '.py', '.sh', '.ps1', '.yml', '.yaml', '.toml', '.csv', '.xml', '.log',
]);
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']);
const PDF_EXTS = new Set(['.pdf']);

const ACCEPT_LIST = [...TEXT_EXTS, ...IMAGE_EXTS, ...PDF_EXTS].join(',');

const pending = [];
const changeListeners = new Set();

function extOf(name = '') {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}

function langFor(name = '') {
  return extOf(name).slice(1) || 'text';
}

function fenceFor(text) {
  return text.includes('```') ? '````' : '```';
}

function insertAtCursor(text) {
  const input = dom.input;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  const before = input.value.slice(0, start);
  const after = input.value.slice(end);
  const prefix = before && !before.endsWith('\n') ? '\n\n' : '';
  const suffix = after && !text.endsWith('\n') ? '\n' : '';
  input.value = before + prefix + text + suffix + after;
  const pos = (before + prefix + text + suffix).length;
  input.selectionStart = input.selectionEnd = pos;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.focus();
}

export function getPendingAttachments() {
  return pending.map((a) => ({
    path: a.path,
    filename: a.filename,
    kind: a.kind,
    mediaUrl: a.mediaUrl,
  }));
}

export function hasPendingAttachments() {
  return pending.length > 0;
}

export function clearAttachments() {
  for (const a of pending) {
    if (a.previewUrl) { try { URL.revokeObjectURL(a.previewUrl); } catch {} }
  }
  pending.length = 0;
  renderStrip();
  notifyChange();
}

export function onAttachmentsChange(fn) {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}

function notifyChange() {
  for (const fn of changeListeners) { try { fn(); } catch {} }
}

function removeAttachment(target) {
  const idx = pending.indexOf(target);
  if (idx < 0) return;
  if (target.previewUrl) { try { URL.revokeObjectURL(target.previewUrl); } catch {} }
  pending.splice(idx, 1);
  renderStrip();
  notifyChange();
}

function renderStrip() {
  let strip;
  try { strip = dom.attachStrip; } catch { return; }
  if (!strip) return;
  strip.replaceChildren();
  if (!pending.length) return;
  for (const a of pending) {
    const chip = document.createElement('div');
    chip.className = 'attach-chip';
    chip.dataset.kind = a.kind;
    if (a.kind === 'image' && a.previewUrl) {
      const img = document.createElement('img');
      img.src = a.previewUrl;
      img.alt = '';
      chip.appendChild(img);
    } else {
      const icon = document.createElement('span');
      icon.className = 'attach-chip-icon';
      icon.textContent = a.kind === 'pdf' ? 'PDF' : 'FILE';
      chip.appendChild(icon);
    }
    const label = document.createElement('span');
    label.className = 'attach-chip-name';
    label.textContent = a.filename;
    label.title = a.filename;
    chip.appendChild(label);
    const remove = document.createElement('button');
    remove.className = 'attach-chip-remove';
    remove.type = 'button';
    remove.setAttribute('aria-label', `Remove ${a.filename}`);
    remove.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
    remove.addEventListener('click', () => removeAttachment(a));
    chip.appendChild(remove);
    strip.appendChild(chip);
  }
}

async function handleTextFile(file) {
  if (file.size > TEXT_MAX_BYTES) {
    toast(`${file.name} is larger than 256 KB and was skipped.`);
    return;
  }
  try {
    const text = await file.text();
    const fence = fenceFor(text);
    insertAtCursor(`Attached file: ${file.name}\n\n${fence}${langFor(file.name)}\n${text}\n${fence}`);
  } catch (e) {
    toast(`Could not read ${file.name}: ${e.message}`);
  }
}

async function handleBinaryFile(file, kind) {
  if (file.size > BINARY_MAX_BYTES) {
    toast(`${file.name} is larger than ${Math.floor(BINARY_MAX_BYTES / (1024 * 1024))} MB and was skipped.`);
    return;
  }
  try {
    const buf = await file.arrayBuffer();
    const b64 = bytesToBase64(new Uint8Array(buf));
    const result = await postUpload({ filename: file.name, dataBase64: b64 });
    if (!result?.ok || !result.path) {
      throw new Error(result?.error ?? 'upload failed');
    }
    const entry = {
      path: result.path,
      filename: result.filename ?? file.name,
      mediaUrl: result.mediaUrl,
      kind,
      previewUrl: kind === 'image' ? URL.createObjectURL(file) : null,
    };
    pending.push(entry);
    renderStrip();
    notifyChange();
  } catch (e) {
    toast(`Upload failed for ${file.name}: ${e.message}`);
  }
}

function bytesToBase64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

async function handleFiles(files) {
  const list = [...files];
  if (!list.length) return;
  if (pending.length + list.length > MAX_FILES) {
    toast(`Only ${MAX_FILES} attachments allowed.`);
  }
  const slots = Math.max(0, MAX_FILES - pending.length);
  for (const file of list.slice(0, slots)) {
    const ext = extOf(file.name);
    if (TEXT_EXTS.has(ext)) await handleTextFile(file);
    else if (IMAGE_EXTS.has(ext)) await handleBinaryFile(file, 'image');
    else if (PDF_EXTS.has(ext)) await handleBinaryFile(file, 'pdf');
    else toast(`${file.name} was skipped (unsupported type).`);
  }
}

function initDragDrop() {
  let overlay = null;
  let depth = 0;
  const ensureOverlay = () => {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.className = 'attach-drop-overlay';
    overlay.innerHTML = '<div class="attach-drop-msg">Drop files to attach</div>';
    document.body.appendChild(overlay);
    return overlay;
  };
  const isFileDrag = (e) => {
    const types = e.dataTransfer?.types;
    if (!types) return false;
    if (Array.isArray(types)) return types.includes('Files');
    return Array.from(types).includes('Files');
  };
  window.addEventListener('dragenter', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    depth++;
    ensureOverlay().classList.add('visible');
  });
  window.addEventListener('dragover', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
  });
  window.addEventListener('dragleave', (e) => {
    if (!isFileDrag(e)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0 && overlay) overlay.classList.remove('visible');
  });
  window.addEventListener('drop', async (e) => {
    const files = e.dataTransfer?.files;
    if (!files || !files.length) return;
    e.preventDefault();
    depth = 0;
    if (overlay) overlay.classList.remove('visible');
    await handleFiles(files);
  });
}

export function initAttachments() {
  let attachBtn;
  try { attachBtn = dom.attachBtn; } catch { return; }
  if (!attachBtn) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.hidden = true;
  input.accept = ACCEPT_LIST;
  document.body.appendChild(input);
  attachBtn.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    await handleFiles(input.files ?? []);
    input.value = '';
  });
  initDragDrop();
}
