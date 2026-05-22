// Generic modal helper. Returns the modal element and a close() function.

export function modal(titleText, body, opts = {}) {
  const back = document.createElement('div');
  back.className = 'modal-backdrop';
  const m = document.createElement('div');
  m.className = 'modal';
  m.innerHTML = `
    <div class="modal-head">
      <strong></strong>
      <button class="modal-close" title="Close">×</button>
    </div>
    <div class="modal-body"></div>
  `;
  m.querySelector('strong').textContent = titleText;
  const bodyEl = m.querySelector('.modal-body');
  if (typeof body === 'string') bodyEl.textContent = body;
  else if (body instanceof Node) bodyEl.appendChild(body);
  back.appendChild(m);
  document.body.appendChild(back);
  const close = () => back.remove();
  m.querySelector('.modal-close').addEventListener('click', close);
  back.addEventListener('click', (e) => { if (e.target === back && !opts.persistent) close(); });
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
  });
  return { el: m, body: bodyEl, close };
}
