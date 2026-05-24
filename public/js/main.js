// Entry point. Ensures the tab has a sessionId, then wires subsystems and
// starts the SSE stream filtered to that session.

import { initComposer } from './composer.js';
import { initSidebar } from './sidebar.js';
import { initSSE } from './sse.js';
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

async function ensureTabSession() {
  const params = new URLSearchParams(location.search);
  // Explicit ?session=<sid>: load it on the bridge then adopt.
  const wantSession = params.get('session');
  if (wantSession) {
    try {
      const data = await listSessions();
      const meta = (data.sessions ?? []).find(x => x.id === wantSession);
      const cwd = params.get('cwd') ?? meta?.cwd;
      await postTabLoad(wantSession, cwd);
      setTabSessionId(wantSession);
      await hydrateSessionPlan(wantSession, cwd);
      return;
    } catch (e) { console.error('load session failed', e); }
    setTabSessionId(null);
  }
  // ?continue=1: load the most-recent session into this tab.
  if (params.get('continue')) {
    try {
      const data = await listSessions();
      const s = (data.sessions ?? [])[0];
      if (s) {
        await postTabLoad(s.id, s.cwd);
        setTabSessionId(s.id);
        await hydrateSessionPlan(s.id, s.cwd);
        return;
      }
    } catch (e) { console.error('continue failed', e); }
  }
  // Already have one from URL or localStorage.
  if (TAB_SESSION_ID) {
    // Make sure the bridge has this session loaded (it may not, e.g. fresh server start).
    try {
      const data = await listSessions();
      const meta = (data.sessions ?? []).find(x => x.id === TAB_SESSION_ID);
      await postTabLoad(TAB_SESSION_ID, meta?.cwd);
      await hydrateSessionPlan(TAB_SESSION_ID, meta?.cwd);
      return;
    } catch { /* may be fresh — ignore */ }
    setTabSessionId(null);
  }
  // No session at all — create one on the bridge.
  try {
    const tab = await postTabNew();
    setTabSessionId(tab.sessionId);
    resetAllToolState();
  } catch (e) {
    console.error('tab/new failed', e);
  }
}

export async function bootstrapApp() {
  await ensureTabSession();
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
  initSSE();
}

export async function __testEnsureTabSession() {
  return ensureTabSession();
}

if (!window.__GROK_WEB_TEST__) {
  bootstrapApp();
}
