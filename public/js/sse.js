// SSE client with exponential-backoff reconnect.
// Browser EventSource auto-retries, but we want a visible status + cap.

import { dispatch } from './dispatch.js';
import { streamUrl } from './api.js';
import { setStatus } from './chat.js';

let es = null;
let backoffMs = 1000;
let reconnectTimer = null;
let lastEventId = null;
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
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (es)
    try {
      es.close();
    } catch {}
  es = new EventSource(streamUrl({ since: lastEventId }));
  es.onopen = () => {
    backoffMs = 1000;
    setStatus('connected — waiting for agent…');
  };
  es.onerror = () => {
    setStatus(`disconnected · retry in ${(backoffMs / 1000) | 0}s`, 'disconnected');
    try {
      es.close();
    } catch {}
    if (!reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, backoffMs);
    }
    backoffMs = Math.min(BACKOFF_CAP, backoffMs * 2);
  };
  es.onmessage = (e) => {
    if (e.lastEventId) lastEventId = e.lastEventId;
    try {
      dispatch(JSON.parse(e.data));
    } catch (err) {
      console.error('bad event', err, e.data);
    }
  };
  return es;
}

export function __testConnect() {
  return connect();
}

export function __testLastEventId() {
  return lastEventId;
}
