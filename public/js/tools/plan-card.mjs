import { state } from '../state.js';
import { newTurn, autoScroll, addError, setStatus } from '../chat.js';
import { renderMarkdown } from '../markdown.js';
import { postPrompt } from '../api.js';
import { setBusy } from '../composer.js';

export function renderPlanCard(u) {
  let card = state.planCards.get(u.toolCallId);
  if (!card) {
    if (!state.turnEl) newTurn();
    card = document.createElement('div');
    card.className = 'plan-card';
    card.innerHTML = `
      <div class="plan-head">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M3 12h18M3 18h12"/></svg>
        <span class="plan-title"></span>
      </div>
      <div class="plan-body"></div>
      <div class="plan-actions">
        <button class="plan-accept">Accept plan</button>
        <button class="plan-edit">Suggest edits…</button>
        <button class="plan-reject">Reject</button>
      </div>
      <div class="plan-edit-wrap" hidden>
        <textarea class="plan-edit-text" rows="3" placeholder="Describe the revision you want"></textarea>
        <div class="plan-edit-actions">
          <button class="plan-edit-submit" type="button">Send edits</button>
          <button class="plan-edit-cancel" type="button">Cancel</button>
        </div>
      </div>
    `;
    card.querySelector('.plan-accept').addEventListener('click', () => sendPlanResponse('Proceed with the plan as written.'));
    card.querySelector('.plan-edit').addEventListener('click', () => {
      const wrap = card.querySelector('.plan-edit-wrap');
      wrap.hidden = false;
      card.querySelector('.plan-edit-text')?.focus?.();
    });
    card.querySelector('.plan-edit-submit').addEventListener('click', () => {
      const input = card.querySelector('.plan-edit-text');
      const text = input?.value?.trim();
      if (!text) return;
      input.value = '';
      card.querySelector('.plan-edit-wrap').hidden = true;
      sendPlanResponse('Revise the plan: ' + text);
    });
    card.querySelector('.plan-edit-cancel').addEventListener('click', () => {
      card.querySelector('.plan-edit-wrap').hidden = true;
    });
    card.querySelector('.plan-reject').addEventListener('click', () => sendPlanResponse('Reject the plan. Start over with a different approach.'));
    state.turnEl.appendChild(card);
    state.planCards.set(u.toolCallId, card);
  }
  const exiting = /exit/i.test(u.title ?? '');
  card.querySelector('.plan-title').textContent = exiting ? 'Plan finalized' : 'Plan';
  if (exiting) card.querySelector('.plan-actions').style.display = 'none';
  const raw = u.rawInput ?? {};
  const planText = raw.plan ?? raw.content ?? raw.description
    ?? u.rawOutput?.output_for_prompt
    ?? (Array.isArray(u.content) ? u.content.map(c => c?.content?.text ?? '').join('') : '');
  card.querySelector('.plan-body').innerHTML = renderMarkdown(planText)
    || '<em style="color:var(--mute)">(plan content streaming…)</em>';
  autoScroll();
}

async function sendPlanResponse(text) {
  setBusy(true);
  setStatus('thinking…', 'busy');
  try {
    const r = await postPrompt(text);
    if (!r.ok) {
      addError(`plan response failed: ${r.status} ${await r.text()}`);
      setBusy(false);
    }
  } catch (e) {
    addError(`plan response failed: ${e.message}`);
    setBusy(false);
  }
}
