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
  thinkingBuf: '',
  assistantEl: null,
  assistantBuf: '',
  toolEls: new Map(),    // toolCallId -> .tool element
  planCards: new Map(),  // toolCallId -> .plan-card element

  // Survives across turns until resolved.
  permCards: new Map(),  // rpcId -> .perm-card element
  elicitationCards: new Map(),  // rpcId -> .elicitation-card element

  // Export accumulator: structured turn data for chat export.
  exportTurns: [],
  _exportCurrentTurn: null,
};

const DOM_IDS = {
  logInner: 'log-inner',
  log: 'log',
  form: 'form',
  input: 'input',
  sendBtn: 'send',
  stopBtn: 'stop',
  statusEl: 'status',
  crumb: 'crumb',
  recentsEl: 'recents',
  recentsSearch: 'recents-search',
  newSessionBtn: 'new-session-btn',
  refreshRecentsBtn: 'refresh-recents',
  showEmptySessionsBtn: 'show-empty-sessions',
  modePill: 'mode-pill',
  todoPanel: 'todo-panel',
  todoList: 'todo-list',
  bgPanel: 'bg-panel',
  bgList: 'bg-list',
  sendMode: 'send-mode',
  attachBtn: 'attach-btn',
  voiceBtn: 'voice-btn',
  modelTag: 'model-tag',
  footerModel: 'footer-model',
  welcome: 'welcome',
  usage: 'usage',
  usageFill: 'usage-fill',
  usageNum: 'usage-num',
};

const domCache = new Map();

function getDomRef(key) {
  const id = DOM_IDS[key];
  if (!id) return undefined;
  if (!domCache.has(key)) {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Missing required DOM element #${id} for dom.${key}`);
    domCache.set(key, el);
  }
  return domCache.get(key);
}

export const dom = new Proxy({}, {
  get(_target, key) {
    if (typeof key !== 'string') return undefined;
    return getDomRef(key);
  },
  has(_target, key) {
    return typeof key === 'string' && Object.hasOwn(DOM_IDS, key);
  },
});
