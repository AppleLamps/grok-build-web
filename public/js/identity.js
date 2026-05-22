import { getIdentity } from './api.js';

function firstInitial(name) {
  const trimmed = (name ?? '').trim();
  return trimmed ? trimmed[0].toUpperCase() : '?';
}

export async function refreshIdentity() {
  const avatar = document.getElementById('user-avatar');
  const name = document.getElementById('user-name');
  if (!avatar || !name) return;

  try {
    const identity = await getIdentity();
    const displayName = identity?.displayName || identity?.username || 'Local user';
    avatar.textContent = firstInitial(displayName);
    name.textContent = displayName;
  } catch {
    avatar.textContent = '?';
    name.textContent = 'Local user';
  }
}

export const initIdentity = refreshIdentity;
