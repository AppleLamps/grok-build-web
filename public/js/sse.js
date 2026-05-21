// SSE client with exponential-backoff reconnect.
// Browser EventSource auto-retries, but we want a visible status + cap.

import { dispatch } from './dispatch.js';
import { streamUrl } from './api.js';
import { setStatus } from './chat.js';

let es = null;
let backoffMs = 1000;
const BACKOFF_CAP = 15000;

export function initSSE() {
  connect();
}

function connect() {
  if (es) try { es.close(); } catch {}
  es = new EventSource(streamUrl());
  es.onopen = () => {
    backoffMs = 1000;
    setStatus('connected — waiting for agent…');
  };
  es.onerror = () => {
    setStatus(`disconnected · retry in ${(backoffMs/1000)|0}s`, 'disconnected');
    try { es.close(); } catch {}
    setTimeout(connect, backoffMs);
    backoffMs = Math.min(BACKOFF_CAP, backoffMs * 2);
  };
  es.onmessage = (e) => {
    try { dispatch(JSON.parse(e.data)); }
    catch (err) { console.error('bad event', err, e.data); }
  };
  return es;
}
