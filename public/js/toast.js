// Tiny toast helper — used by share, errors that don't belong in the log.

export function toast(message, { duration = 5000, html = false } = {}) {
  const el = document.createElement('div');
  el.className = 'toast';
  if (html) el.innerHTML = message;
  else el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), duration);
  return el;
}
