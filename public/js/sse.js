// SSE client with exponential-backoff reconnect.
// Browser EventSource auto-retries, but we want a visible status + cap.

import { dispatch } from './dispatch.js';
import { streamUrl } from './api.js';
import { setStatus } from './chat.js';
import { setSessionReady } from './composer.js';
import { hideRecoveryBanner, showReadinessBanner } from './recovery.mjs';
import { state } from './state.js';

let es = null;
let backoffMs = 1000;
let reconnectTimer = null;
let lastEventId = null;
let connecting = false;
const BACKOFF_CAP = 15000;

export function initSSE() {
  connect();
}

export function reconnectSSE() {
  connect();
}

export function isSSEActive() {
  return es != null;
}

function connect() {
  if (connecting) return es;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (es)
    try {
      es.close();
    } catch {}
  connecting = true;
  const next = new EventSource(streamUrl({ since: lastEventId }));
  es = next;
  next.onopen = () => {
    if (es !== next) return;
    connecting = false;
    backoffMs = 1000;
    if (state.currentSessionId) {
      setSessionReady(true);
      hideRecoveryBanner();
      setStatus('ready', 'ready');
      return;
    }
    setSessionReady(false);
    showReadinessBanner({
      title: 'Waiting for local Grok session',
      message: 'The browser stream is connected. Sending unlocks once the agent reports a session.',
      actionLabel: 'Retry',
      onAction: () => connect(),
    });
    setStatus('connected — waiting for agent…', 'busy');
  };
  next.onerror = () => {
    if (es !== next) return;
    connecting = false;
    setSessionReady(false);
    showReadinessBanner({
      title: 'Reconnecting to local Grok session',
      message: 'The browser lost the event stream. You can keep drafting; sending unlocks after reconnect.',
      actionLabel: 'Retry now',
      onAction: () => connect(),
    });
    setStatus(`disconnected · retry in ${(backoffMs / 1000) | 0}s`, 'disconnected');
    try {
      next.close();
    } catch {}
    if (!reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, backoffMs);
    }
    backoffMs = Math.min(BACKOFF_CAP, backoffMs * 2);
  };
  next.onmessage = (e) => {
    if (es !== next) return;
    if (e.lastEventId) lastEventId = e.lastEventId;
    try {
      dispatch(JSON.parse(e.data));
    } catch (err) {
      console.error('bad event', err, e.data);
    }
  };
  return next;
}

export function __testConnect() {
  return connect();
}

export function __testLastEventId() {
  return lastEventId;
}
