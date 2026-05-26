import { el } from './dom.js';

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function createModal(titleText, body, opts = {}) {
  const previousFocus = document.activeElement;
  const backdrop = el('div', { className: 'modal-backdrop' });
  const dialog = el('div', {
    className: 'modal',
    attrs: {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': opts.ariaLabel ?? titleText,
      tabindex: '-1',
    },
  });
  const closeBtn = el('button', {
    className: 'modal-close',
    text: '×',
    attrs: { type: 'button', title: 'Close', 'aria-label': 'Close dialog' },
  });
  const bodyEl = el('div', { className: 'modal-body' });
  const head = el('div', { className: 'modal-head' }, el('strong', { text: titleText }), closeBtn);
  if (typeof body === 'string') bodyEl.textContent = body;
  else if (body instanceof Node) bodyEl.appendChild(body);
  dialog.append(head, bodyEl);
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);

  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onDocumentKeydown);
    previousFocus?.focus?.();
  };
  function onDocumentKeydown(e) {
    if (e.key === 'Escape') close();
  }
  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop && !opts.persistent) close();
  });
  document.addEventListener('keydown', onDocumentKeydown);
  (opts.initialFocus ?? closeBtn).focus?.();
  return { el: dialog, body: bodyEl, close };
}

export function createPanel({ className, title, closeLabel = 'Close panel', describedBy = null, onClose = null }) {
  let previousFocus = null;
  const panel = el('div', {
    className,
    attrs: {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': title,
      'aria-hidden': 'true',
      tabindex: '-1',
      ...(describedBy ? { 'aria-describedby': describedBy } : {}),
    },
  });
  const closeBtn = el('button', {
    className: 'close',
    text: '×',
    attrs: { type: 'button', title: 'Close', 'aria-label': closeLabel },
  });
  const head = el(
    'div',
    { className: `${className.replace('-panel', '')}-head` },
    el('strong', { text: title }),
    closeBtn,
  );
  const body = el('div', { className: `${className.replace('-panel', '')}-body` });
  const foot = el('div', { className: `${className.replace('-panel', '')}-foot` });
  panel.append(head, body, foot);
  panel.addEventListener('keydown', (e) => trapPanelKeys(e, panel, close));
  closeBtn.addEventListener('click', close);

  function open() {
    previousFocus = document.activeElement;
    panel.setAttribute('aria-hidden', 'false');
    panel.classList.add('open');
    closeBtn.focus?.();
  }
  function close() {
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
    previousFocus?.focus?.();
    onClose?.();
  }

  return { panel, head, body, foot, closeBtn, open, close };
}

function trapPanelKeys(e, panel, close) {
  if (e.key === 'Escape') {
    e.preventDefault?.();
    close();
    return;
  }
  if (e.key !== 'Tab') return;
  const focusable = Array.from(panel.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
    (node) => !node.hidden && node.getAttribute('aria-hidden') !== 'true',
  );
  if (!focusable.length) {
    e.preventDefault();
    panel.focus?.();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus?.();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus?.();
  }
}
