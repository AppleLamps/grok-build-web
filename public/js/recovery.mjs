// Bootstrap and agent recovery banners with retry actions.

let activeAction = null;

function slotEl() {
  return document.getElementById('recovery-slot');
}

export function showRecoveryBanner({ title, message, actionLabel, onAction }) {
  const slot = slotEl();
  if (!slot) return;
  activeAction = onAction;
  slot.hidden = false;
  slot.innerHTML = `
    <div class="recovery-banner" role="alert">
      <span class="recovery-dot" aria-hidden="true"></span>
      <div class="recovery-copy">
        <strong>${escapeHTML(title)}</strong>
        <span>${escapeHTML(message)}</span>
      </div>
      <button type="button" class="recovery-action">${escapeHTML(actionLabel)}</button>
      <button type="button" class="close" aria-label="Dismiss">×</button>
    </div>`;
  slot.querySelector('.recovery-action')?.addEventListener('click', () => {
    activeAction?.();
  });
  slot.querySelector('.close')?.addEventListener('click', () => hideRecoveryBanner());
}

export function hideRecoveryBanner() {
  activeAction = null;
  const slot = slotEl();
  if (!slot) return;
  slot.hidden = true;
  if (typeof slot.replaceChildren === 'function') slot.replaceChildren();
  else slot.innerHTML = '';
}

function escapeHTML(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
