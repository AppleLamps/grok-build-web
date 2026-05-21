// Text-file attachment support for the composer.

import { dom } from './state.js';
import { toast } from './toast.js';

const MAX_FILES = 5;
const MAX_BYTES = 256 * 1024;
const TEXT_EXTS = new Set([
  '.txt', '.md', '.js', '.mjs', '.ts', '.tsx', '.json', '.css', '.html',
  '.py', '.sh', '.ps1', '.yml', '.yaml', '.toml', '.csv', '.xml', '.log',
]);

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

async function handleFiles(files) {
  const selected = [...files].slice(0, MAX_FILES);
  if (files.length > MAX_FILES) toast(`Only the first ${MAX_FILES} files were attached.`);
  const blocks = [];
  for (const file of selected) {
    const ext = extOf(file.name);
    if (!TEXT_EXTS.has(ext)) {
      toast(`${file.name} was skipped. grok-web attachments support text files only.`);
      continue;
    }
    if (file.size > MAX_BYTES) {
      toast(`${file.name} is larger than 256 KB and was skipped.`);
      continue;
    }
    try {
      const text = await file.text();
      const fence = fenceFor(text);
      blocks.push(`Attached file: ${file.name}\n\n${fence}${langFor(file.name)}\n${text}\n${fence}`);
    } catch (e) {
      toast(`Could not read ${file.name}: ${e.message}`);
    }
  }
  if (blocks.length) insertAtCursor(blocks.join('\n\n'));
}

export function initAttachments() {
  if (!dom.attachBtn) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.hidden = true;
  input.accept = [...TEXT_EXTS].join(',');
  document.body.appendChild(input);
  dom.attachBtn.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    await handleFiles(input.files ?? []);
    input.value = '';
  });
}
