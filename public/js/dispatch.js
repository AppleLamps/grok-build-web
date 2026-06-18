// Server-Sent-Events dispatcher. Maps every bridge event kind to the
// appropriate renderer. Adding a new event type? Add a case here and the
// handler module.

import { getSessionPlan, postRespawn, postTabNew } from './api.js';
import {
  addError,
  addHookLine,
  addInfoLine,
  addUserItem,
  appendMessage,
  appendThought,
  appendUserChunk,
  clearLog,
  collapseLastThinking,
  finishStreaming,
  setStatus,
  updateUsage,
} from './chat.js';
import { renderModePill, setBusy, setSessionReady } from './composer.js';
import { addElicitationCard, resolveElicitationCard } from './elicitation.js';
import { addPermissionCard, resolvePermissionCard } from './permissions.js';
import { hideRecoveryBanner, showRecoveryBanner } from './recovery.mjs';
import { loadRecents, renderRecents } from './sidebar.js';
import { setCommands } from './slashcommands.js';
import { reconnectSSE } from './sse.js';
import { dom, setTabSessionId, state, TAB_SESSION_ID } from './state.js';
import { resetAllToolState, setCurrentTodos } from './tool-state.js';
import { paintTool, renderPlanCard } from './tools.js';

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

// Merge tool_call + tool_call_update events into one export entry per toolCallId.
// Without this, the agent's typical 2-3 events per call (initial in-progress,
// streamed content, completed) produce duplicate "### tool" headers in the export.
export function recordToolForExport(update, { initial } = {}) {
  const turn = ensureExportTurn();
  const id = update.toolCallId ?? null;
  let entry = id ? turn.tools.find((t) => t.toolCallId === id) : null;
  if (!entry) {
    entry = {
      toolCallId: id,
      title: update.title ?? '',
      kind: update.kind ?? '',
      input: cleanForExport(update.rawInput ?? update.content ?? ''),
      output: cleanForExport(update.rawOutput ?? ''),
      status: initial ? 'in_progress' : (update.status ?? 'completed'),
    };
    turn.tools.push(entry);
    return entry;
  }
  // Keep the first non-empty title/kind/input we ever saw — later updates often
  // omit the title or repurpose rawInput for streamed content blocks.
  if (update.title && !entry.title) entry.title = update.title;
  if (update.kind && !entry.kind) entry.kind = update.kind;
  if (update.status) entry.status = update.status;
  const nextOutput = cleanForExport(update.rawOutput ?? '');
  if (nextOutput) entry.output = nextOutput;
  if (!entry.input) {
    const nextInput = cleanForExport(update.rawInput ?? update.content ?? '');
    if (nextInput) entry.input = nextInput;
  }
  return entry;
}

// Some tool outputs arrive as raw byte buffers (e.g. terminal stdout) that
// JSON.stringify serialises as `[13, 10, 27, ...]` — unreadable in an export.
// Decode those, and unwrap a few common content-block shapes while we're at it.
export function cleanForExport(value) {
  if (value == null || value === '') return value ?? '';
  if (typeof value === 'string') return value;
  if (looksLikeByteArray(value)) return decodeByteArray(value);
  if (Array.isArray(value)) return value.map(cleanForExport);
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = cleanForExport(v);
    return out;
  }
  return value;
}

function looksLikeByteArray(value) {
  if (!Array.isArray(value) || value.length < 16) return false;
  for (const v of value) {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 255) return false;
  }
  return true;
}

function decodeByteArray(bytes) {
  try {
    if (typeof TextDecoder !== 'undefined') {
      const arr = new Uint8Array(bytes);
      return new TextDecoder('utf-8', { fatal: false }).decode(arr);
    }
  } catch {}
  return String.fromCharCode(...bytes);
}

export function dispatch(event) {
  switch (event.kind) {
    case 'agent_ready':
      hideRecoveryBanner();
      state.currentCwd = event.cwd ?? state.currentCwd;
      dom.crumb.textContent = event.cwd?.split(/[\\/]/).slice(-2).join(' / ') ?? 'session';
      setSessionReady(true);
      setBusy(false);
      setStatus('connected', 'ready');
      break;

    case 'session_ready':
      state.currentSessionId = event.sessionId;
      state.currentCwd = event.cwd ?? state.currentCwd;
      dom.crumb.textContent = event.cwd?.split(/[\\/]/).slice(-2).join(' / ') ?? 'session';
      if (event.loaded) hydrateTodosFromPlan(event.sessionId, event.cwd);
      setSessionReady(true);
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
      setSessionReady(true);
      setBusy(false);
      setStatus(event.loaded ? 'session loaded' : 'new session', 'ready');
      renderRecents();
      loadRecents();
      break;

    case 'user_prompt':
      addUserItem(event.text, event.attachments);
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
      handleCompactionMetadata(event.result?._meta?.compaction ?? event.result?._meta?.compactionResult);
      dom.input.focus({ preventScroll: true });
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
      if (event.sessionId && event.sessionId !== TAB_SESSION_ID) break;
      // The previous child died — bridge sessions on it are gone. Create a
      // fresh tab session and reconnect SSE without reloading the page.
      hideRecoveryBanner();
      setSessionReady(false);
      setStatus('agent restarting…', 'busy');
      setTabSessionId(null);
      postTabNew()
        .then((tab) => {
          setTabSessionId(tab.sessionId);
          state.currentSessionId = tab.sessionId;
          state.currentCwd = tab.cwd ?? state.currentCwd;
          setSessionReady(true);
          reconnectSSE();
          setStatus('reconnected', 'ready');
        })
        .catch((e) => {
          addError(`failed to start a new session after respawn: ${e.message}`);
          showRecoveryBanner({
            title: 'Agent restarted but session setup failed',
            message: e.message,
            actionLabel: 'Retry',
            onAction: () => recoverAfterRespawn(),
          });
        });
      break;

    case 'sessions_changed':
      loadRecents();
      break;

    case 'agent_exit':
      if (event.sessionId && event.sessionId !== TAB_SESSION_ID) break;
      setSessionReady(false);
      setStatus(`agent exited (code ${event.code})`, 'disconnected');
      setBusy(false);
      showRecoveryBanner({
        title: 'Agent disconnected',
        message: `The Grok agent exited unexpectedly (code ${event.code ?? 'unknown'}).`,
        actionLabel: 'Restart agent',
        onAction: () => restartAgent(),
      });
      break;

    case 'error':
      addError(event.error);
      setSessionReady(false);
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
  if (handleCompactionMetadata(u)) return;
  // Plan mode: agent calls enter_plan_mode / exit_plan_mode as tools
  if (
    (u.sessionUpdate === 'tool_call' || u.sessionUpdate === 'tool_call_update') &&
    /enter_plan_mode|exit_plan_mode/i.test(u.title ?? '')
  ) {
    renderPlanCard(u);
    return;
  }
  switch (u.sessionUpdate) {
    case 'user_message_chunk': {
      const text = u.content?.text ?? '';
      if (!text) break;
      appendUserChunk(text);
      ensureExportTurn().user += text;
      break;
    }
    case 'agent_thought_chunk': {
      const text = u.content?.text ?? '';
      if (!text) break;
      appendThought(text);
      ensureExportTurn().thinking += text;
      break;
    }
    case 'agent_message_chunk': {
      const text = u.content?.text ?? '';
      if (!text) break;
      appendMessage(text);
      ensureExportTurn().assistant += text;
      break;
    }
    case 'tool_call':
      paintTool(u);
      recordToolForExport(u, { initial: true });
      break;
    case 'tool_call_update': {
      paintTool(u);
      recordToolForExport(u, { initial: false });
      break;
    }
    case 'available_commands_update':
      setCommands(firstCommandList(u));
      break;
    case 'hook_execution':
      for (const run of u.runs ?? []) {
        addHookLine(u.event_name, run.name, run.status?.status, run.status?.elapsed_ms);
        ensureExportTurn().hooks.push({
          event: u.event_name,
          name: run.name,
          status: run.status?.status,
          elapsedMs: run.status?.elapsed_ms,
        });
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
        const entry = state.recentsCache.find((s) => s.id === sid);
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

function handleCompactionMetadata(raw) {
  const meta = normalizeCompactionMetadata(raw);
  if (!meta) return false;
  state.lastCompaction = meta;
  addInfoLine('Compaction', formatCompactionMetadata(meta), meta.status === 'failed' ? 'warn' : '');
  return true;
}

function normalizeCompactionMetadata(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const updateName = raw.sessionUpdate ?? raw.type ?? raw.kind ?? raw.event ?? raw.name;
  const nested =
    raw.compaction ?? raw.compactionResult ?? raw.compaction_result ?? raw.result ?? raw.metadata ?? raw.meta ?? null;
  const source = nested && typeof nested === 'object' ? { ...nested, sessionUpdate: updateName } : raw;
  const marker = String(source.sessionUpdate ?? source.type ?? source.kind ?? source.event ?? source.name ?? '');
  const hasCompactionMarker = /compact/i.test(marker);
  const hasCompactionShape =
    firstValue(source, ['beforeTokens', 'before_tokens', 'tokensBefore', 'tokens_before', 'inputTokens']) != null ||
    firstValue(source, ['afterTokens', 'after_tokens', 'tokensAfter', 'tokens_after', 'outputTokens']) != null ||
    firstValue(source, ['transcriptPath', 'transcript_path', 'rawTranscriptPath', 'raw_transcript_path']) != null ||
    firstValue(source, ['summaryQuality', 'summary_quality', 'quality']) != null ||
    firstValue(source, ['promptPrefixReused', 'prompt_prefix_reused', 'prefixReused', 'prefix_reused']) != null;
  if (!hasCompactionMarker && !hasCompactionShape) return null;
  const statusRaw = firstValue(source, ['status', 'outcome', 'result']);
  const error = firstValue(source, ['error', 'errorMessage', 'error_message', 'failureReason', 'failure_reason']);
  const beforeTokens = toNumber(
    firstValue(source, ['beforeTokens', 'before_tokens', 'tokensBefore', 'tokens_before', 'inputTokens']),
  );
  const afterTokens = toNumber(
    firstValue(source, ['afterTokens', 'after_tokens', 'tokensAfter', 'tokens_after', 'outputTokens']),
  );
  return {
    status: error ? 'failed' : String(statusRaw ?? 'completed'),
    beforeTokens,
    afterTokens,
    reductionTokens: toNumber(firstValue(source, ['reductionTokens', 'reduction_tokens', 'tokensReduced'])),
    reductionPercent: toNumber(
      firstValue(source, ['reductionPercent', 'reduction_percent', 'tokenReductionPercent', 'token_reduction_percent']),
    ),
    transcriptPath: firstValue(source, [
      'transcriptPath',
      'transcript_path',
      'rawTranscriptPath',
      'raw_transcript_path',
    ]),
    segmentsPath: firstValue(source, ['segmentsPath', 'segments_path', 'segmentPath', 'segment_path']),
    summaryPath: firstValue(source, ['summaryPath', 'summary_path']),
    promptPrefixReused: firstValue(source, [
      'promptPrefixReused',
      'prompt_prefix_reused',
      'prefixReused',
      'prefix_reused',
    ]),
    summaryQuality: firstValue(source, ['summaryQuality', 'summary_quality', 'quality']),
    error,
    raw: source,
  };
}

function firstValue(obj, keys) {
  for (const key of keys) {
    if (obj?.[key] != null && obj[key] !== '') return obj[key];
  }
  return null;
}

function toNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatCompactionMetadata(meta) {
  const parts = [];
  if (meta.status) parts.push(`status ${meta.status}`);
  if (meta.beforeTokens != null && meta.afterTokens != null) {
    parts.push(`${formatTokens(meta.beforeTokens)} -> ${formatTokens(meta.afterTokens)} tokens`);
  }
  const reduction =
    meta.reductionPercent ??
    (meta.beforeTokens && meta.afterTokens != null
      ? ((meta.beforeTokens - meta.afterTokens) / meta.beforeTokens) * 100
      : null);
  if (reduction != null) parts.push(`${reduction.toFixed(1).replace(/\.0$/, '')}% reduction`);
  if (meta.promptPrefixReused != null) parts.push(`prompt prefix reused ${formatBool(meta.promptPrefixReused)}`);
  if (meta.summaryQuality != null) parts.push(`summary quality ${meta.summaryQuality}`);
  if (meta.transcriptPath) parts.push(`transcript ${meta.transcriptPath}`);
  if (meta.segmentsPath) parts.push(`segments ${meta.segmentsPath}`);
  if (meta.summaryPath) parts.push(`summary ${meta.summaryPath}`);
  if (meta.error) parts.push(`error ${meta.error}`);
  return parts.join(' | ') || 'metadata received';
}

function formatBool(value) {
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}

function formatTokens(n) {
  if (n < 1000) return String(n);
  if (n < 1000000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
}

function firstCommandList(update) {
  for (const key of ['availableCommands', 'available_commands', 'commands', 'items']) {
    if (Array.isArray(update?.[key])) return update[key];
  }
  return [];
}

function hydrateTodosFromPlan(sessionId, cwd = null) {
  getSessionPlan(sessionId, cwd)
    .then((plan) => setCurrentTodos(plan.todos ?? [], { merge: false }))
    .catch((e) => addError(`session plan load failed: ${e.message}`));
}

async function recoverAfterRespawn() {
  hideRecoveryBanner();
  setSessionReady(false);
  setStatus('agent restarting…', 'busy');
  setTabSessionId(null);
  try {
    const tab = await postTabNew();
    setTabSessionId(tab.sessionId);
    state.currentSessionId = tab.sessionId;
    state.currentCwd = tab.cwd ?? state.currentCwd;
    setSessionReady(true);
    reconnectSSE();
    setStatus('reconnected', 'ready');
  } catch (e) {
    addError(`failed to start a new session after respawn: ${e.message}`);
    showRecoveryBanner({
      title: 'Agent restarted but session setup failed',
      message: e.message,
      actionLabel: 'Retry',
      onAction: () => recoverAfterRespawn(),
    });
  }
}

async function restartAgent() {
  hideRecoveryBanner();
  setSessionReady(false);
  setStatus('restarting agent…', 'busy');
  try {
    await postRespawn();
  } catch (e) {
    addError(`failed to restart agent: ${e.message}`);
    showRecoveryBanner({
      title: 'Agent disconnected',
      message: e.message,
      actionLabel: 'Restart agent',
      onAction: () => restartAgent(),
    });
  }
}
