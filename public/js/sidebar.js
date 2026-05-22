// Recents list + new-session button.
// Calls the bridge to start / load sessions; rendering happens after the
// server broadcasts session_replaced (handled in dispatch.js).

import { state, dom, setTabSessionId } from './state.js';
import { listSessions, postTabNew, postTabLoad } from './api.js';
import { setStatus, addError } from './chat.js';
import { escapeHTML } from './markdown.js';
import { setBusy } from './composer.js';
import { toast } from './toast.js';

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
let showEmptySessions = localStorage.getItem('grokweb.showEmptySessions') === '1';
let savedOpenProjects = [];
try { savedOpenProjects = JSON.parse(localStorage.getItem('grokweb.openProjects') ?? '[]'); }
catch { savedOpenProjects = []; }
const openProjects = new Set(Array.isArray(savedOpenProjects) ? savedOpenProjects : []);
let seededCurrentProject = openProjects.size > 0;
let savedProjectAliases = {};
try { savedProjectAliases = JSON.parse(localStorage.getItem('grokweb.projectAliases') ?? '{}'); }
catch { savedProjectAliases = {}; }
const projectAliases = savedProjectAliases && typeof savedProjectAliases === 'object' && !Array.isArray(savedProjectAliases)
  ? savedProjectAliases
  : {};

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

function saveProjectAliases() {
  localStorage.setItem('grokweb.projectAliases', JSON.stringify(projectAliases));
}

function projectAlias(cwd) {
  const alias = projectAliases[cwd];
  return typeof alias === 'string' ? alias.trim() : '';
}

function filteredRecents() {
  const sessions = showEmptySessions
    ? state.recentsCache
    : state.recentsCache.filter(s => (s.numMessages ?? 0) > 0 || s.id === state.currentSessionId);
  if (!searchQuery) return sessions;
  const q = searchQuery.toLowerCase();
  return sessions.filter(s =>
    (s.title ?? '').toLowerCase().includes(q) ||
    (s.cwd ?? '').toLowerCase().includes(q) ||
    projectAlias(s.cwd ?? '(unknown)').toLowerCase().includes(q)
  );
}

function renderEmptyToggle() {
  if (!dom.showEmptySessionsBtn) return;
  dom.showEmptySessionsBtn.setAttribute('aria-pressed', String(showEmptySessions));
  dom.showEmptySessionsBtn.title = showEmptySessions ? 'Hide empty sessions' : 'Show empty sessions';
  dom.showEmptySessionsBtn.classList.toggle('active', showEmptySessions);
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

function projectLabel(cwd) {
  return projectAlias(cwd) || shortCwd(cwd) || '(unknown)';
}

function wireProjectRename(project, cwd) {
  const editor = project.querySelector('.project-alias-editor');
  const input = project.querySelector('.project-alias-input');
  const open = () => {
    input.value = projectAlias(cwd);
    editor.hidden = false;
    input.focus();
    input.select();
  };
  const close = () => { editor.hidden = true; };
  project.querySelector('.project-rename').addEventListener('click', (e) => {
    e.stopPropagation();
    open();
  });
  project.querySelector('.project-alias-save').addEventListener('click', () => {
    const next = input.value.trim();
    if (next) projectAliases[cwd] = next;
    else delete projectAliases[cwd];
    saveProjectAliases();
    renderRecents();
  });
  project.querySelector('.project-alias-clear').addEventListener('click', () => {
    delete projectAliases[cwd];
    saveProjectAliases();
    renderRecents();
  });
  project.querySelector('.project-alias-cancel').addEventListener('click', close);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') project.querySelector('.project-alias-save').click();
    if (e.key === 'Escape') close();
  });
}

export function renderRecents() {
  if (!state.recentsCache.length) {
    dom.recentsEl.innerHTML = '<div class="empty">No prior sessions</div>';
    renderEmptyToggle();
    return;
  }
  dom.recentsEl.innerHTML = '';
  const groups = groupedRecents();
  if (!groups.length) {
    dom.recentsEl.innerHTML = '<div class="empty">No sessions with user messages</div>';
    renderEmptyToggle();
    return;
  }
  for (const group of groups) {
    const currentCwd = state.currentCwd ?? state.recentsCache.find(s => s.id === state.currentSessionId)?.cwd;
    const isCurrent = group.cwd === currentCwd || group.sessions.some(s => s.id === state.currentSessionId);
    if (isCurrent && !seededCurrentProject) {
      openProjects.add(group.cwd);
      seededCurrentProject = true;
    }
    const isOpen = !!searchQuery || openProjects.has(group.cwd);
    const alias = projectAlias(group.cwd);
    const project = document.createElement('div');
    project.className = 'project' + (isOpen ? ' open' : '') + (isCurrent ? ' current' : '');
    project.innerHTML = `
      <div class="project-row">
        <button class="project-head" type="button">
          <span class="chev">›</span>
          <span class="folder-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg></span>
          <span class="project-name"></span>
          <span class="project-count">${group.sessions.length}</span>
        </button>
        <button class="project-rename" type="button" title="Rename display name" aria-label="Rename project display name">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
        </button>
      </div>
      <div class="project-alias-editor" hidden>
        <input class="project-alias-input" type="text" placeholder="Private display name" />
        <button class="project-alias-save" type="button">Save</button>
        <button class="project-alias-clear" type="button">Clear</button>
        <button class="project-alias-cancel" type="button">Cancel</button>
      </div>
      <div class="project-sessions"></div>
    `;
    const projectHead = project.querySelector('.project-head');
    projectHead.title = alias ? `${alias}\n${group.cwd}` : group.cwd;
    project.querySelector('.project-name').textContent = projectLabel(group.cwd);
    wireProjectRename(project, group.cwd);
    projectHead.addEventListener('click', () => {
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
  renderEmptyToggle();
}

export async function loadRecents() {
  try {
    const data = await listSessions();
    state.recentsCache = Array.isArray(data.sessions) ? data.sessions : [];
    if (data.current) state.currentSessionId = data.current;
    renderRecents();
  } catch (e) {
    const message = String(e?.message ?? e);
    if (!state.recentsCache.length) {
      dom.recentsEl.innerHTML = `<div class="empty">Failed to load: ${escapeHTML(message)}</div>`;
    } else {
      toast(`Session history refresh failed: ${message}`, { duration: 7000 });
    }
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
  dom.showEmptySessionsBtn?.addEventListener('click', () => {
    showEmptySessions = !showEmptySessions;
    localStorage.setItem('grokweb.showEmptySessions', showEmptySessions ? '1' : '0');
    renderRecents();
  });
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

export function __testSetShowEmptySessions(value) {
  showEmptySessions = !!value;
  localStorage.setItem('grokweb.showEmptySessions', showEmptySessions ? '1' : '0');
}

export function __testGetShowEmptySessions() {
  return showEmptySessions;
}
