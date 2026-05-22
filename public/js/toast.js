// Tiny toast helper — used by share, errors that don't belong in the log.

import { safeHttpUrl } from './markdown.js';

export function toast(message, { duration = 5000 } = {}) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.body.appendChild(el);
  const timer = setTimeout(() => el.remove(), duration);
  timer?.unref?.();
  return el;
}

export function toastLink(prefix, url, { duration = 5000 } = {}) {
  const safeUrl = safeHttpUrl(url);
  if (!safeUrl) return toast(`${prefix}${url ?? ''}`, { duration });
  const el = document.createElement('div');
  el.className = 'toast';
  el.append(prefix);
  const link = document.createElement('a');
  link.href = safeUrl;
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = safeUrl;
  el.appendChild(link);
  document.body.appendChild(el);
  const timer = setTimeout(() => el.remove(), duration);
  timer?.unref?.();
  return el;
}
