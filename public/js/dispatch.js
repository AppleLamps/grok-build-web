// Server-Sent-Events dispatcher. Maps every bridge event kind to the
// appropriate renderer. Adding a new event type? Add a case here and the
// handler module.

import { state, dom } from './state.js';
import {
  addUserItem, appendThought, appendMessage, appendUserChunk,
  addError, setStatus, clearLog, addHookLine, collapseLastThinking, updateUsage,
  finishStreaming,
} from './chat.js';
import { paintTool, renderPlanCard } from './tools.js';
import { addPermissionCard, resolvePermissionCard } from './permissions.js';
import { addElicitationCard, resolveElicitationCard } from './elicitation.js';
import { renderRecents, loadRecents } from './sidebar.js';
import { setBusy, renderModePill } from './composer.js';
import { setCommands } from './slashcommands.js';
import { setTabSessionId } from './state.js';
import { getSessionPlan, postTabNew } from './api.js';
import { resetAllToolState, setCurrentTodos } from './tool-state.js';

function ensureExportTurn() {
  if (!state._exportCurrentTurn) {
    state._exportCurrentTurn = { user: '', thinking: '', assistant: '', tools: [], hooks: [] };
    state.exportTurns.push(state._exportCurrentTurn);
  }
  return state._exportCurrentTurn;
}

export function resetExportTurns() {
  state.exportTurns = [];
  state._exportCurrentTurn = null;
}

export function dispatch(event) {
  switch (event.kind) {
    case 'agent_ready':
      state.currentCwd = event.cwd ?? state.currentCwd;
      dom.crumb.textContent = event.cwd?.split(/[\\/]/).slice(-2).join(' / ') ?? 'session';
      setBusy(false);
      setStatus('connected', 'ready');
      break;

    case 'session_ready':
      state.currentSessionId = event.sessionId;
      state.currentCwd = event.cwd ?? state.currentCwd;
      dom.crumb.textContent = event.cwd?.split(/[\\/]/).slice(-2).join(' / ') ?? 'session';
      if (event.loaded) hydrateTodosFromPlan(event.sessionId, event.cwd);
      setBusy(false);
      setStatus('ready', 'ready');
      renderRecents();
      break;

    case 'session_replaced':
      state.currentSessionId = event.sessionId;
      state.currentCwd = event.cwd ?? state.currentCwd;
      clearLog();
      resetExportTurns();
      dom.crumb.textContent = event.cwd?.split(/[\\/]/).slice(-2).join(' / ') ?? 'session';
      if (event.loaded) hydrateTodosFromPlan(event.sessionId, event.cwd);
      else resetAllToolState();
      setBusy(false);
      setStatus(event.loaded ? 'session loaded' : 'new session', 'ready');
      renderRecents();
      loadRecents();
      break;

    case 'user_prompt':
      addUserItem(event.text);
      setStatus('thinking…', 'busy');
      setBusy(true);
      state._exportCurrentTurn = null;
      ensureExportTurn().user = event.text;
      break;

    case 'turn_queued':
      setStatus(`queued · position ${event.position ?? 1}`, 'busy');
      setBusy(true);
      break;

    case 'turn_cancelled':
      setStatus(event.queued ? 'queued turn cancelled' : 'cancelled', 'ready');
      setBusy(false);
      break;

    case 'update':
      handleUpdate(event.update);
      break;

    case 'turn_complete':
      setStatus(`done · ${event.result?.stopReason ?? 'end_turn'}`, 'ready');
      setBusy(false);
      collapseLastThinking();
      finishStreaming();
      updateUsage(event.result?._meta);
      dom.input.focus();
      break;

    case 'permission_request':
      setStatus('waiting for approval…', 'busy');
      addPermissionCard(event.rpcId, event.request);
      break;
    case 'permission_resolved':
    case 'permission_timeout':
      resolvePermissionCard(event.rpcId, event.optionId ?? 'timed out');
      break;
    case 'permission_auto_allowed':
      // Silent for now. Could surface as a small inline note.
      break;

    case 'elicitation_request':
      setStatus('waiting for your input…', 'busy');
      addElicitationCard(event.rpcId, event.request);
      break;
    case 'elicitation_resolved':
      resolveElicitationCard(event.rpcId, event.action ?? 'resolved');
      break;

    case 'auto_approve_changed':
      state.autoApprove = event.autoApprove;
      renderModePill();
      break;

    case 'agent_respawn':
      // The previous child died — all sessions on it are gone. Drop this
      // tab's stale sid and let main.js's ensureTabSession bootstrap a new
      // one against the new child. We do it by clearing localStorage +
      // URL sid and creating a fresh tab session right here so the user
      // doesn't have to reload.
      clearLog();
      setStatus('agent restarting…', 'busy');
      setTabSessionId(null);
      postTabNew().then((tab) => {
        setTabSessionId(tab.sessionId);
        // Reload so the SSE stream subscribes filtered to the new sid.
        location.reload();
      }).catch((e) => addError(`failed to start a new session after respawn: ${e.message}`));
      break;

    case 'sessions_changed':
      loadRecents();
      break;

    case 'agent_exit':
      setStatus(`agent exited (code ${event.code})`, 'disconnected');
      setBusy(false);
      break;

    case 'error':
      addError(event.error);
      setStatus('error', 'disconnected');
      setBusy(false);
      break;

    case 'meta':
      // _x.ai/* extension noise. Keep it available for diagnostics without
      // putting every extension notification into the chat log.
      window.dispatchEvent(new CustomEvent('grok-web:meta', { detail: event }));
      if (localStorage.getItem('grokweb.debugMeta') === '1') {
        console.debug('[grok-web meta]', event.method, event.params);
      }
      break;
  }
}

function handleUpdate(u) {
  // Plan mode: agent calls enter_plan_mode / exit_plan_mode as tools
  if ((u.sessionUpdate === 'tool_call' || u.sessionUpdate === 'tool_call_update')
      && /enter_plan_mode|exit_plan_mode/i.test(u.title ?? '')) {
    renderPlanCard(u);
    return;
  }
  switch (u.sessionUpdate) {
    case 'user_message_chunk':
      appendUserChunk(u.content?.text ?? '');
      ensureExportTurn().user += u.content?.text ?? '';
      break;
    case 'agent_thought_chunk':
      appendThought(u.content?.text ?? '');
      ensureExportTurn().thinking += u.content?.text ?? '';
      break;
    case 'agent_message_chunk':
      appendMessage(u.content?.text ?? '');
      ensureExportTurn().assistant += u.content?.text ?? '';
      break;
    case 'tool_call':
      paintTool(u);
      ensureExportTurn().tools.push({ title: u.title ?? '', kind: u.kind ?? '', input: u.rawInput ?? u.content ?? '', output: '', status: 'in_progress' });
      break;
    case 'tool_call_update': {
      paintTool(u);
      const tools = ensureExportTurn().tools;
      const existing = tools.find(t => t.title === (u.title ?? '') && t.status === 'in_progress');
      if (existing) {
        existing.status = u.status ?? 'completed';
        existing.output = u.rawOutput ?? '';
      } else {
        tools.push({ title: u.title ?? '', kind: u.kind ?? '', input: u.rawInput ?? u.content ?? '', output: u.rawOutput ?? '', status: u.status ?? 'completed' });
      }
      break;
    }
    case 'available_commands_update':
      setCommands(firstCommandList(u));
      break;
    case 'hook_execution':
      for (const run of (u.runs ?? [])) {
        addHookLine(u.event_name, run.name, run.status?.status, run.status?.elapsed_ms);
        ensureExportTurn().hooks.push({ event: u.event_name, name: run.name, status: run.status?.status, elapsedMs: run.status?.elapsed_ms });
      }
      break;
    case 'session_summary_generated': {
      // Agent generated (or refreshed) the session's title. Update the
      // sidebar recent and topbar crumb live without a full refetch.
      const title = u.title ?? u.summary ?? u.session_summary ?? u.generated_title;
      const sid = u.sessionId ?? state.currentSessionId;
      if (title) {
        // Update topbar crumb if this matches the current tab's session.
        if (sid === state.currentSessionId) dom.crumb.textContent = title;
        // Update the cached recents entry and re-render sidebar.
        const entry = state.recentsCache.find(s => s.id === sid);
        if (entry) {
          entry.title = title;
          renderRecents();
        } else {
          // Not in cache yet — schedule a refresh so it appears.
          loadRecents();
        }
      }
      break;
    }
  }
}

function firstCommandList(update) {
  for (const key of ['availableCommands', 'available_commands', 'commands', 'items']) {
    if (Array.isArray(update?.[key])) return update[key];
  }
  return [];
}

function hydrateTodosFromPlan(sessionId, cwd = null) {
  getSessionPlan(sessionId, cwd)
    .then(plan => setCurrentTodos(plan.todos ?? [], { merge: false }))
    .catch(e => addError(`session plan load failed: ${e.message}`));
}
