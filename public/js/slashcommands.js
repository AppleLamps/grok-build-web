// Slash-command autocomplete popup.
// Listens for `available_commands_update` notifications (cached) and shows
// a filterable dropdown when the input starts with `/`.

import { dom } from './state.js';

let commands = [];
let popup = null;
let selectedIdx = 0;
let filtered = [];

export function setCommands(list) {
  commands = list ?? [];
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
  if (!filtered.length) { popup.style.display = 'none'; return; }
  popup.style.display = '';
  popup.innerHTML = '';
  filtered.forEach((c, i) => {
    const item = document.createElement('div');
    item.className = `slash-item${i === selectedIdx ? ' selected' : ''}`;
    item.dataset.idx = String(i);
    const name = document.createElement('span');
    name.className = 'slash-name';
    name.textContent = `/${c.name ?? ''}`;
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
  const cur = dom.input.value;
  // Replace the slash prefix with the command + space; keep hint inside paren in placeholder
  const hint = c.input?.hint ? ` ` : '';
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
    if (!v.startsWith('/')) { hide(); return; }
    const q = v.slice(1).toLowerCase();
    filtered = commands
      .filter(c => c.name.toLowerCase().startsWith(q) || c.name.toLowerCase().includes(q))
      .slice(0, 12);
    selectedIdx = 0;
    render();
  });
  dom.input.addEventListener('keydown', (e) => {
    if (!filtered.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); selectedIdx = (selectedIdx + 1) % filtered.length; render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); selectedIdx = (selectedIdx - 1 + filtered.length) % filtered.length; render(); }
    else if (e.key === 'Tab') { e.preventDefault(); pick(); }
    else if (e.key === 'Escape') { e.preventDefault(); hide(); }
    else if (e.key === 'Enter' && !e.shiftKey) {
      // If a slash command is highlighted, complete it instead of submitting.
      e.preventDefault();
      pick();
    }
  });
  dom.input.addEventListener('blur', () => setTimeout(hide, 100));
}
