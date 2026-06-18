// Slash-command autocomplete popup.
// Listens for `available_commands_update` notifications (cached) and shows
// a filterable dropdown when the input starts with `/`.

import { dom } from './state.js';

let commands = [];
let popup = null;
let selectedIdx = 0;
let filtered = [];

const COMPAT_COMMANDS = [
  { name: 'export', description: 'Export a session transcript as Markdown' },
  { name: 'config-agents', description: 'Configure agents' },
  { name: 'code-review', description: 'Review the current changes' },
];

export function setCommands(list) {
  const seen = new Set();
  const normalized = [];
  const add = (entry) => {
    const command = normalizeCommand(entry);
    if (!command || seen.has(command.name)) return;
    seen.add(command.name);
    normalized.push(command);
  };
  if (Array.isArray(list)) {
    for (const entry of list) {
      try {
        add(entry);
      } catch {}
    }
  }
  for (const command of COMPAT_COMMANDS) add(command);
  commands = normalized;
}

function normalizeCommand(entry) {
  const source = entry && typeof entry === 'object' ? entry : null;
  const rawName = typeof entry === 'string' ? entry : (source?.name ?? source?.command ?? source?.id ?? source?.title);
  if (rawName == null) return null;
  const name = String(rawName).trim().replace(/^\/+/, '').trim();
  if (!name) return null;
  const out = { name };
  if (source?.description != null) out.description = String(source.description);
  if (source?.input != null) out.input = source.input;
  if (source?.hint != null) out.hint = String(source.hint);
  return out;
}

function commandNeedsArgument(command) {
  return !!(command?.input?.hint || command?.input || command?.hint);
}

function ensurePopup() {
  if (popup) return popup;
  popup = document.createElement('div');
  popup.className = 'slash-popup';
  popup.style.display = 'none';
  // Insert above the composer
  dom.form.parentElement.appendChild(popup);
  return popup;
}

function render() {
  ensurePopup();
  if (!filtered.length) {
    popup.style.display = 'none';
    return;
  }
  popup.style.display = '';
  popup.innerHTML = '';
  filtered.forEach((c, i) => {
    const item = document.createElement('div');
    item.className = `slash-item${i === selectedIdx ? ' selected' : ''}`;
    item.dataset.idx = String(i);
    const name = document.createElement('span');
    name.className = 'slash-name';
    name.textContent = `/${c.name}`;
    const desc = document.createElement('span');
    desc.className = 'slash-desc';
    desc.textContent = (c.description ?? '').slice(0, 120);
    item.append(name, desc);
    popup.appendChild(item);
  });
  popup.querySelectorAll('.slash-item').forEach((el) => {
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      selectedIdx = Number(el.dataset.idx);
      pick();
    });
  });
}

function pick() {
  const c = filtered[selectedIdx];
  if (!c) return;
  // Replace the slash prefix with the command + space; keep hint inside paren in placeholder
  const hint = commandNeedsArgument(c) ? ` ` : '';
  dom.input.value = `/${c.name}${hint}`;
  hide();
  dom.input.focus();
}

function hide() {
  if (popup) popup.style.display = 'none';
  filtered = [];
}

export function initSlash() {
  ensurePopup();
  dom.input.addEventListener('input', () => {
    const v = dom.input.value;
    if (!v.startsWith('/')) {
      hide();
      return;
    }
    const q = v.slice(1).replace(/^\/+/, '').toLowerCase();
    filtered = commands
      .filter((c) => c.name.toLowerCase().startsWith(q) || c.name.toLowerCase().includes(q))
      .slice(0, 12);
    selectedIdx = 0;
    render();
  });
  dom.input.addEventListener('keydown', (e) => {
    if (!filtered.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIdx = (selectedIdx + 1) % filtered.length;
      render();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIdx = (selectedIdx - 1 + filtered.length) % filtered.length;
      render();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      pick();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      hide();
    } else if (e.key === 'Enter' && !e.shiftKey) {
      // If a slash command is highlighted, complete it instead of submitting.
      e.preventDefault();
      pick();
    }
  });
  dom.input.addEventListener('blur', () => setTimeout(hide, 100));
}
