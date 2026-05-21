// Shared client state + DOM refs. Imported by every other module that
// needs them. Keep this module dependency-free.

// Per-tab session ID. Sourced from URL ?session= first, then localStorage.
// May be null on first load — main.js creates one via /tab/new.
const _params = new URLSearchParams(location.search);
export let TAB_SESSION_ID = _params.get('session') || localStorage.getItem('grokweb.tabSessionId') || null;
export function setTabSessionId(id) {
  TAB_SESSION_ID = id;
  if (id) localStorage.setItem('grokweb.tabSessionId', id);
  else localStorage.removeItem('grokweb.tabSessionId');
  // Reflect in URL so the tab is bookmarkable / reloadable.
  const u = new URL(location.href);
  if (id) u.searchParams.set('session', id);
  else u.searchParams.delete('session');
  history.replaceState(null, '', u);
}

export const state = {
  currentSessionId: null,
  currentCwd: null,
  recentsCache: [],
  autoApprove: true,

  // Per-turn rendering state — reset by chat.newTurn().
  turnEl: null,
  thinkingEl: null,
  assistantEl: null,
  assistantBuf: '',
  toolEls: new Map(),    // toolCallId -> .tool element
  planCards: new Map(),  // toolCallId -> .plan-card element

  // Survives across turns until resolved.
  permCards: new Map(),  // rpcId -> .perm-card element
  elicitationCards: new Map(),  // rpcId -> .elicitation-card element
};

export const dom = {
  logInner:           document.getElementById('log-inner'),
  log:                document.getElementById('log'),
  form:               document.getElementById('form'),
  input:              document.getElementById('input'),
  sendBtn:            document.getElementById('send'),
  stopBtn:            document.getElementById('stop'),
  statusEl:           document.getElementById('status'),
  crumb:              document.getElementById('crumb'),
  recentsEl:          document.getElementById('recents'),
  recentsSearch:      document.getElementById('recents-search'),
  newSessionBtn:      document.getElementById('new-session-btn'),
  refreshRecentsBtn:  document.getElementById('refresh-recents'),
  modePill:           document.getElementById('mode-pill'),
  todoPanel:          document.getElementById('todo-panel'),
  todoList:           document.getElementById('todo-list'),
  bgPanel:            document.getElementById('bg-panel'),
  bgList:             document.getElementById('bg-list'),
  sendMode:           document.getElementById('send-mode'),
  attachBtn:          document.getElementById('attach-btn'),
  voiceBtn:           document.getElementById('voice-btn'),
  modelTag:           document.getElementById('model-tag'),
  footerModel:        document.getElementById('footer-model'),
  welcome:            document.getElementById('welcome'),
  usage:              document.getElementById('usage'),
  usageFill:          document.getElementById('usage-fill'),
  usageNum:           document.getElementById('usage-num'),
};
