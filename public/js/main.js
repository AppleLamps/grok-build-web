// Entry point. Ensures the tab has a sessionId, then wires subsystems and
// starts the SSE stream filtered to that session.

import { initComposer } from './composer.js';
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
import { TAB_SESSION_ID, setTabSessionId } from './state.js';
import { postTabNew, postTabLoad, listSessions, getSessionPlan } from './api.js';
import { resetAllToolState, setCurrentTodos } from './tool-state.js';
import { setStatus } from './chat.js';
import { hideRecoveryBanner, showRecoveryBanner } from './recovery.mjs';

export async function hydrateSessionPlan(sessionId = TAB_SESSION_ID, cwd = null) {
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
}

async function ensureTabSession() {
  const params = new URLSearchParams(location.search);
  const wantSession = params.get('session');
  if (wantSession) {
    try {
      const data = await listSessions();
      const meta = (data.sessions ?? []).find(x => x.id === wantSession);
      const cwd = params.get('cwd') ?? meta?.cwd;
      await adoptLoadedSession(wantSession, cwd);
      return { ok: true };
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
        await adoptLoadedSession(s.id, s.cwd);
        return { ok: true };
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
      await adoptLoadedSession(TAB_SESSION_ID, meta?.cwd);
      return { ok: true };
    } catch (e) {
      console.error('restore tab session failed', e);
      setTabSessionId(null);
    }
  }
  try {
    const tab = await postTabNew();
    setTabSessionId(tab.sessionId);
    resetAllToolState();
    return { ok: true };
  } catch (e) {
    console.error('tab/new failed', e);
    return { ok: false, error: `Could not start a session: ${e.message}` };
  }
}

function showBootstrapFailure(error) {
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

export async function retryBootstrap() {
  setStatus('connecting…');
  const result = await ensureTabSession();
  if (result.ok) await startStreamAfterSession();
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

  const result = await ensureTabSession();
  if (result.ok) await startStreamAfterSession();
  else showBootstrapFailure(result.error);
}

export async function __testEnsureTabSession() {
  return ensureTabSession();
}

if (!window.__GROK_WEB_TEST__) {
  bootstrapApp();
}
