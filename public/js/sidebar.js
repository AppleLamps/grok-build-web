// Recents list + new-session button.
// Calls the bridge to start / load sessions; rendering happens after the
// server broadcasts session_replaced (handled in dispatch.js).

import { state, dom, setTabSessionId } from './state.js';
import { listSessions, postTabNew, postTabLoad } from './api.js';
import { setStatus, addError } from './chat.js';
import { escapeHTML } from './markdown.js';
import { setBusy } from './composer.js';

function timeAgo(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d`;
  return new Date(iso).toLocaleDateString();
}

let searchQuery = '';
const MAX_PROJECT_SESSIONS = 4;
let savedOpenProjects = [];
try { savedOpenProjects = JSON.parse(localStorage.getItem('grokweb.openProjects') ?? '[]'); }
catch { savedOpenProjects = []; }
const openProjects = new Set(Array.isArray(savedOpenProjects) ? savedOpenProjects : []);
let seededCurrentProject = openProjects.size > 0;

function isMobileSidebar() {
  return window.matchMedia('(max-width: 760px)').matches;
}

function setSidebarOpen(open) {
  document.body.classList.toggle('sidebar-open', open);
  document.getElementById('sidebar-backdrop')?.toggleAttribute('hidden', !open);
  const toggle = document.getElementById('mobile-sidebar-toggle');
  if (toggle) {
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close sidebar' : 'Open sidebar');
  }
}

export function closeSidebar() {
  setSidebarOpen(false);
}

function initMobileSidebar() {
  const toggle = document.getElementById('mobile-sidebar-toggle');
  const backdrop = document.getElementById('sidebar-backdrop');
  const sidebar = document.getElementById('sidebar');
  toggle?.addEventListener('click', () => setSidebarOpen(!document.body.classList.contains('sidebar-open')));
  backdrop?.addEventListener('click', closeSidebar);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('sidebar-open')) closeSidebar();
  });
  sidebar?.addEventListener('click', (e) => {
    if (!isMobileSidebar()) return;
    const target = e.target;
    if (!(target instanceof Element)) return;
    if (target.closest('#new-session-btn, #login-btn, #customize-btn, .tools-nav button, .recent')) {
      closeSidebar();
    }
  });
}

function saveOpenProjects() {
  localStorage.setItem('grokweb.openProjects', JSON.stringify([...openProjects]));
}

function filteredRecents() {
  if (!searchQuery) return state.recentsCache;
  const q = searchQuery.toLowerCase();
  return state.recentsCache.filter(s =>
    (s.title ?? '').toLowerCase().includes(q) ||
    (s.cwd ?? '').toLowerCase().includes(q)
  );
}

// Group sessions by cwd, current cwd first, then by most-recent activity.
function groupedRecents() {
  const groups = new Map();
  for (const s of filteredRecents()) {
    const key = s.cwd ?? '(unknown)';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  const arr = Array.from(groups.entries()).map(([cwd, sessions]) => ({
    cwd, sessions, lastActive: sessions[0]?.lastActive,
  }));
  // Put current cwd (= cwd of current session) first
  const currentCwd = state.recentsCache.find(s => s.id === state.currentSessionId)?.cwd;
  arr.sort((a, b) => {
    if (a.cwd === currentCwd) return -1;
    if (b.cwd === currentCwd) return 1;
    return new Date(b.lastActive ?? 0) - new Date(a.lastActive ?? 0);
  });
  return arr;
}

function shortCwd(cwd) {
  if (!cwd) return '';
  return cwd.split(/[\\/]/).filter(Boolean).slice(-2).join(' / ');
}

export function renderRecents() {
  if (!state.recentsCache.length) {
    dom.recentsEl.innerHTML = '<div class="empty">No prior sessions</div>';
    return;
  }
  dom.recentsEl.innerHTML = '';
  for (const group of groupedRecents()) {
    const currentCwd = state.currentCwd ?? state.recentsCache.find(s => s.id === state.currentSessionId)?.cwd;
    const isCurrent = group.cwd === currentCwd || group.sessions.some(s => s.id === state.currentSessionId);
    if (isCurrent && !seededCurrentProject) {
      openProjects.add(group.cwd);
      seededCurrentProject = true;
    }
    const isOpen = !!searchQuery || openProjects.has(group.cwd);
    const project = document.createElement('div');
    project.className = 'project' + (isOpen ? ' open' : '') + (isCurrent ? ' current' : '');
    project.innerHTML = `
      <button class="project-head" title="${escapeHTML(group.cwd)}">
        <span class="chev">›</span>
        <span class="folder-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg></span>
        <span class="project-name"></span>
        <span class="project-count">${group.sessions.length}</span>
      </button>
      <div class="project-sessions"></div>
    `;
    project.querySelector('.project-name').textContent = shortCwd(group.cwd) || '(unknown)';
    project.querySelector('.project-head').addEventListener('click', () => {
      if (openProjects.has(group.cwd)) openProjects.delete(group.cwd);
      else openProjects.add(group.cwd);
      saveOpenProjects();
      renderRecents();
    });
    const sessionsEl = project.querySelector('.project-sessions');
    for (const s of group.sessions.slice(0, MAX_PROJECT_SESSIONS)) {
      const div = document.createElement('div');
      div.className = 'recent' + (s.id === state.currentSessionId ? ' active live' : '');
      const folder = (s.cwd ?? '').split(/[\\/]/).filter(Boolean).pop() ?? '';
      div.innerHTML = `
        <span class="branch-icon"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="6" r="2"/><circle cx="18" cy="18" r="2"/><path d="M6 8v8a2 2 0 0 0 2 2h6"/></svg></span>
        <span class="title"></span>
        <span class="age"></span>
      `;
      div.querySelector('.title').textContent = s.title || folder || '(untitled)';
      div.querySelector('.age').textContent = timeAgo(s.lastActive);
      div.title = `${s.title}\n${s.cwd}\nUpdated ${timeAgo(s.lastActive)} · ${s.numMessages} msgs`;
      div.addEventListener('click', () => loadSessionAction(s.id, s.cwd));
      sessionsEl.appendChild(div);
    }
    dom.recentsEl.appendChild(project);
  }
}

export async function loadRecents() {
  try {
    const data = await listSessions();
    state.recentsCache = data.sessions ?? [];
    if (data.current) state.currentSessionId = data.current;
    renderRecents();
  } catch (e) {
    dom.recentsEl.innerHTML = `<div class="empty">Failed to load: ${escapeHTML(String(e?.message ?? e))}</div>`;
  }
}

function goToSession(sessionId, cwd = null) {
  const params = new URLSearchParams(location.search);
  params.set('session', sessionId);
  if (cwd) params.set('cwd', cwd);
  else params.delete('cwd');
  location.search = params.toString();
}

export async function newSessionAction(cwd = null) {
  setBusy(true);
  setStatus('starting new session…', 'busy');
  try {
    const tab = await postTabNew(cwd);
    setTabSessionId(tab.sessionId);
    // Simplest way to swap the SSE subscription cleanly: reload the page
    // with the new sessionId in the URL.
    goToSession(tab.sessionId, tab.cwd);
  } catch (e) { addError(`new session failed: ${e.message}`); setBusy(false); }
}

export async function loadSessionAction(sessionId, cwd) {
  setBusy(true);
  setStatus('loading session…', 'busy');
  try {
    await postTabLoad(sessionId, cwd);
    setTabSessionId(sessionId);
    goToSession(sessionId, cwd);
  } catch (e) { addError(`load session failed: ${e.message}`); setBusy(false); }
}

export function initSidebar() {
  initMobileSidebar();
  dom.newSessionBtn.addEventListener('click', () => newSessionAction());
  dom.refreshRecentsBtn.addEventListener('click', loadRecents);
  const searchBtn = document.querySelector('.brand .icons button[title="Search"]');
  if (searchBtn && dom.recentsSearch) {
    searchBtn.addEventListener('click', () => {
      dom.recentsSearch.focus();
      dom.recentsSearch.select();
    });
  }
  if (dom.recentsSearch) {
    dom.recentsSearch.addEventListener('input', () => {
      searchQuery = dom.recentsSearch.value;
      renderRecents();
    });
  }
  loadRecents();
}
