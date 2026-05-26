// Agent-driven scheduler routines panel.

import { modal } from './modal.js';
import { postPrompt } from './api.js';
import { setBusy } from './composer.js';
import { setStatus, addError } from './chat.js';
import { el } from './ui/dom.js';

async function sendRoutinePrompt(text, close) {
  setBusy(true);
  setStatus('thinking…', 'busy');
  try {
    const r = await postPrompt(text);
    if (!r.ok) throw new Error(await r.text());
    close?.();
  } catch (e) {
    addError(`routine request failed: ${e.message}`);
    setBusy(false);
  }
}

export function showRoutines() {
  const wrap = el(
    'div',
    { className: 'routines-panel' },
    el('p', { text: 'Routines are managed by asking Grok to use its scheduler tools in this session.' }),
    el(
      'div',
      { className: 'routine-section' },
      el('button', { className: 'routine-list', text: 'List routines', attrs: { type: 'button' } }),
    ),
    el(
      'form',
      { className: 'routine-create' },
      el('strong', { text: 'Create routine' }),
      el(
        'label',
        {},
        el('span', { text: 'Interval' }),
        el('input', { attrs: { name: 'interval', placeholder: 'every weekday at 9am', required: true } }),
      ),
      el(
        'label',
        {},
        el('span', { text: 'Prompt' }),
        el('textarea', { attrs: { name: 'prompt', rows: '3', placeholder: 'What should Grok do?', required: true } }),
      ),
      el('button', { text: 'Create routine', attrs: { type: 'submit' } }),
    ),
    el(
      'form',
      { className: 'routine-delete' },
      el('strong', { text: 'Delete routine' }),
      el(
        'label',
        {},
        el('span', { text: 'Routine ID' }),
        el('input', { attrs: { name: 'id', placeholder: 'routine id', required: true } }),
      ),
      el('button', { text: 'Delete routine', attrs: { type: 'submit' } }),
    ),
  );
  const { close } = modal('Routines', wrap);
  wrap.querySelector('.routine-list').addEventListener('click', () => {
    sendRoutinePrompt('Use the scheduler_list tool to list my scheduled routines. Return the results clearly.', close);
  });
  wrap.querySelector('.routine-create').addEventListener('submit', (e) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const interval = data.get('interval')?.toString().trim();
    const prompt = data.get('prompt')?.toString().trim();
    if (!interval || !prompt) return;
    sendRoutinePrompt(
      `Use the scheduler_create tool to create a routine with interval: ${interval}\nPrompt: ${prompt}`,
      close,
    );
  });
  wrap.querySelector('.routine-delete').addEventListener('submit', (e) => {
    e.preventDefault();
    const id = new FormData(e.currentTarget).get('id')?.toString().trim();
    if (!id) return;
    sendRoutinePrompt(`Use the scheduler_delete tool to delete the scheduled routine with id: ${id}`, close);
  });
}
