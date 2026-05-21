// Agent-driven scheduler routines panel.

import { modal } from './modal.js';
import { postPrompt } from './api.js';
import { setBusy } from './composer.js';
import { setStatus, addError } from './chat.js';

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
  const wrap = document.createElement('div');
  wrap.className = 'routines-panel';
  wrap.innerHTML = `
    <p>Routines are managed by asking Grok to use its scheduler tools in this session.</p>
    <div class="routine-section">
      <button class="routine-list">List routines</button>
    </div>
    <form class="routine-create">
      <strong>Create routine</strong>
      <label><span>Interval</span><input name="interval" placeholder="every weekday at 9am" required></label>
      <label><span>Prompt</span><textarea name="prompt" rows="3" placeholder="What should Grok do?" required></textarea></label>
      <button type="submit">Create routine</button>
    </form>
    <form class="routine-delete">
      <strong>Delete routine</strong>
      <label><span>Routine ID</span><input name="id" placeholder="routine id" required></label>
      <button type="submit">Delete routine</button>
    </form>
  `;
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
    sendRoutinePrompt(`Use the scheduler_create tool to create a routine with interval: ${interval}\nPrompt: ${prompt}`, close);
  });
  wrap.querySelector('.routine-delete').addEventListener('submit', (e) => {
    e.preventDefault();
    const id = new FormData(e.currentTarget).get('id')?.toString().trim();
    if (!id) return;
    sendRoutinePrompt(`Use the scheduler_delete tool to delete the scheduled routine with id: ${id}`, close);
  });
}
