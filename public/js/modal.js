// Generic modal helper. Returns the modal element and a close() function.

export function modal(titleText, body, opts = {}) {
  const previousFocus = document.activeElement;
  const back = document.createElement('div');
  back.className = 'modal-backdrop';
  const m = document.createElement('div');
  m.className = 'modal';
  m.setAttribute('role', 'dialog');
  m.setAttribute('aria-modal', 'true');
  m.setAttribute('aria-label', opts.ariaLabel ?? titleText);
  m.setAttribute('tabindex', '-1');
  m.innerHTML = `
    <div class="modal-head">
      <strong></strong>
      <button class="modal-close" title="Close" aria-label="Close dialog">×</button>
    </div>
    <div class="modal-body"></div>
  `;
  m.querySelector('strong').textContent = titleText;
  const bodyEl = m.querySelector('.modal-body');
  if (typeof body === 'string') bodyEl.textContent = body;
  else if (body instanceof Node) bodyEl.appendChild(body);
  back.appendChild(m);
  document.body.appendChild(back);
  const close = () => {
    back.remove();
    document.removeEventListener('keydown', onKey);
    previousFocus?.focus?.();
  };
  function onKey(e) {
    if (e.key === 'Escape') close();
  }
  const closeBtn = m.querySelector('.modal-close');
  closeBtn.addEventListener('click', close);
  back.addEventListener('click', (e) => { if (e.target === back && !opts.persistent) close(); });
  document.addEventListener('keydown', onKey);
  closeBtn.focus?.();
  return { el: m, body: bodyEl, close };
}
