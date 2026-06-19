// Entry point. Ensures the tab has a sessionId, then wires subsystems and
// starts the SSE stream filtered to that session.

import { initComposer, setSessionReady } from './composer.js';
import { initSidebar } from './sidebar.js';
import { initSSE, reconnectSSE, isSSEActive } from './sse.js';
import { initSlash } from './slashcommands.js';
import { initTopbar } from './topbar.js';
import { initSettings } from './settings.js';
import { initToolsMenu } from './tools-menu.js';
import { initAttachments } from './attachments.js';
import { initVoiceInput } from './voice.js';
import { initModelPicker } from './modelpicker.js';
import { initIdentity } from './identity.js';
import { TAB_SESSION_ID, dom, setTabSessionId, state } from './state.js';
import { postTabNew, postTabLoad, listSessions, getSessionPlan } from './api.js';
import { resetAllToolState, setCurrentTodos } from './tool-state.js';
import { setStatus } from './chat.js';
import { hideRecoveryBanner, showReadinessBanner, showRecoveryBanner } from './recovery.mjs';

async function hydrateSessionPlan(sessionId = TAB_SESSION_ID, cwd = null) {
  if (!sessionId) {
    resetAllToolState();
    return;
  }
  try {
    const plan = await getSessionPlan(sessionId, cwd);
    setCurrentTodos(plan.todos ?? [], { merge: false });
  } catch (e) {
    console.error('load session plan failed', e);
  }
}

async function adoptLoadedSession(sessionId, cwd) {
  const tab = await postTabLoad(sessionId, cwd);
  setTabSessionId(sessionId);
  await hydrateSessionPlan(sessionId, tab.cwd ?? cwd);
  return { sessionId, cwd: tab.cwd ?? cwd, loaded: true };
}

async function ensureTabSession() {
  const params = new URLSearchParams(location.search);
  const wantSession = params.get('session');
  if (wantSession) {
    try {
      const data = await listSessions();
      const meta = (data.sessions ?? []).find(x => x.id === wantSession);
      const cwd = params.get('cwd') ?? meta?.cwd;
      const tab = await adoptLoadedSession(wantSession, cwd);
      return { ok: true, ...tab };
    } catch (e) {
      console.error('load session failed', e);
      // Keep ?session= in the URL; do not fall through to postTabNew (that created duplicates).
      return { ok: false, error: `Could not load session: ${e.message}` };
    }
  }
  if (params.get('continue')) {
    try {
      const data = await listSessions();
      const s = (data.sessions ?? [])[0];
      if (s) {
        const tab = await adoptLoadedSession(s.id, s.cwd);
        return { ok: true, ...tab };
      }
    } catch (e) {
      console.error('continue failed', e);
      return { ok: false, error: `Could not continue previous session: ${e.message}` };
    }
  }
  if (TAB_SESSION_ID) {
    try {
      const data = await listSessions();
      const meta = (data.sessions ?? []).find(x => x.id === TAB_SESSION_ID);
      const tab = await adoptLoadedSession(TAB_SESSION_ID, meta?.cwd);
      return { ok: true, ...tab };
    } catch (e) {
      console.error('restore tab session failed', e);
      setTabSessionId(null);
    }
  }
  try {
    const tab = await postTabNew();
    setTabSessionId(tab.sessionId);
    resetAllToolState();
    return { ok: true, sessionId: tab.sessionId, cwd: tab.cwd ?? null, loaded: false };
  } catch (e) {
    console.error('tab/new failed', e);
    return { ok: false, error: `Could not start a session: ${e.message}` };
  }
}

function showBootstrapFailure(error) {
  setSessionReady(false);
  setStatus('session setup failed', 'disconnected');
  showRecoveryBanner({
    title: 'Session setup failed',
    message: error,
    actionLabel: 'Retry',
    onAction: () => { retryBootstrap(); },
  });
}

async function startStreamAfterSession() {
  hideRecoveryBanner();
  if (isSSEActive()) reconnectSSE();
  else initSSE();
}

function showStartupState(
  message = 'Creating or loading a local Grok session. You can draft a prompt; sending unlocks once the agent is ready.',
) {
  setSessionReady(false);
  setStatus('starting session…', 'busy');
  showReadinessBanner({
    title: 'Starting local Grok session',
    message,
    actionLabel: 'Retry',
    onAction: () => { retryBootstrap(); },
  });
}

function markSessionReady({ sessionId, cwd, loaded = false } = {}) {
  if (sessionId) state.currentSessionId = sessionId;
  if (cwd) state.currentCwd = cwd;
  if (cwd) dom.crumb.textContent = cwd.split(/[\\/]/).slice(-2).join(' / ') || 'session';
  else if (sessionId) dom.crumb.textContent = 'session';
  setSessionReady(true);
  hideRecoveryBanner();
  setStatus(loaded ? 'session loaded' : 'ready', 'ready');
}

export async function retryBootstrap() {
  showStartupState('Retrying session setup. Sending unlocks once the local agent is ready.');
  const result = await ensureTabSession();
  if (result.ok) {
    markSessionReady(result);
    await startStreamAfterSession();
  }
  else showBootstrapFailure(result.error);
  return result;
}

export async function bootstrapApp() {
  initComposer();
  initAttachments();
  initVoiceInput();
  initModelPicker();
  initIdentity();
  initSlash();
  initSidebar();
  initTopbar();
  initSettings();
  initToolsMenu();

  showStartupState();
  const result = await ensureTabSession();
  if (result.ok) {
    markSessionReady(result);
    await startStreamAfterSession();
  }
  else showBootstrapFailure(result.error);
}

export async function __testEnsureTabSession() {
  return ensureTabSession();
}

if (!window.__GROK_WEB_TEST__) {
  bootstrapApp();
}
