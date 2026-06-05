// All server endpoints in one place. Anything that talks to server.mjs goes here.

import { TAB_SESSION_ID } from './state.js';

const url = (path) => path;
const json = { 'content-type': 'application/json' };

async function readJsonResponse(r, label) {
  const text = await r.text();
  if (!r.ok) {
    let detail = text.trim();
    try {
      const parsed = detail ? JSON.parse(detail) : null;
      detail = parsed?.error ?? parsed?.message ?? detail;
    } catch {}
    throw new Error(`${label} request failed: ${r.status}${detail ? `: ${detail}` : ''}`);
  }
  if (!text.trim()) throw new Error(`${label} returned empty response`);
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`${label} returned invalid JSON: ${e.message}`);
  }
}

// Helper: attach the tab's sessionId to a POST body if not already present.
function withSid(body) {
  if (!TAB_SESSION_ID) return body;
  return { sessionId: TAB_SESSION_ID, ...body };
}

export async function getSettings() {
  const u = new URL(url('/settings'), location.origin);
  if (TAB_SESSION_ID) u.searchParams.set('sessionId', TAB_SESSION_ID);
  const r = await fetch(u.pathname + u.search);
  return r.json();
}

export async function setSettings(body) {
  const r = await fetch(url('/settings'), {
    method: 'POST',
    headers: json,
    body: JSON.stringify(withSid(body)),
  });
  return r.json();
}

export async function postPrompt(text, attachments = null) {
  const body = { text };
  if (Array.isArray(attachments) && attachments.length) body.attachments = attachments;
  return fetch(url('/prompt'), {
    method: 'POST',
    headers: json,
    body: JSON.stringify(withSid(body)),
  });
}

export async function postUpload({ filename, dataBase64 }) {
  const r = await fetch(url('/upload'), {
    method: 'POST',
    headers: json,
    body: JSON.stringify(withSid({ filename, dataBase64 })),
  });
  return readJsonResponse(r, 'upload');
}

export async function postUploadFile({ filename, file }) {
  const u = new URL(url('/upload'), location.origin);
  if (filename) u.searchParams.set('filename', filename);
  if (TAB_SESSION_ID) u.searchParams.set('sessionId', TAB_SESSION_ID);
  const r = await fetch(u.pathname + u.search, {
    method: 'POST',
    body: file,
  });
  return readJsonResponse(r, 'upload');
}

export async function cliOneshot(body) {
  const r = await fetch(url('/cli/oneshot'), {
    method: 'POST',
    headers: json,
    body: JSON.stringify(withSid(body)),
  });
  return r.json();
}

export async function postCancel() {
  return fetch(url('/cancel'), {
    method: 'POST',
    headers: json,
    body: JSON.stringify(withSid({})),
  });
}

// Per-tab session management
export async function postTabNew(cwd = null) {
  const r = await fetch(url('/tab/new'), {
    method: 'POST',
    headers: json,
    body: JSON.stringify(withSid(cwd ? { cwd } : {})),
  });
  return readJsonResponse(r, 'tab/new');
}

export async function postTabLoad(sessionId, cwd = null) {
  const r = await fetch(url('/tab/load'), {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ sessionId, cwd }),
  });
  return readJsonResponse(r, 'tab/load');
}

export async function postPermission(rpcId, optionId) {
  return fetch(url('/permission'), {
    method: 'POST',
    headers: json,
    body: JSON.stringify(withSid({ rpcId, optionId })),
  });
}

export async function postElicitation(rpcId, action, content) {
  const body = content === undefined ? { rpcId, action } : { rpcId, action, content };
  return fetch(url('/elicitation'), {
    method: 'POST',
    headers: json,
    body: JSON.stringify(withSid(body)),
  });
}

export async function listSessions() {
  const u = new URL(url('/sessions'), location.origin);
  if (TAB_SESSION_ID) u.searchParams.set('sessionId', TAB_SESSION_ID);
  const r = await fetch(u.pathname + u.search);
  return readJsonResponse(r, 'sessions');
}

export async function getSessionPlan(sessionId = TAB_SESSION_ID, cwd = null) {
  const u = new URL(url('/session/plan'), location.origin);
  if (sessionId) u.searchParams.set('sessionId', sessionId);
  if (cwd) u.searchParams.set('cwd', cwd);
  const r = await fetch(u.pathname + u.search);
  return readJsonResponse(r, 'session plan');
}

// Legacy single-default-session endpoints. The browser UI should use
// postTabNew/postTabLoad so multi-tab session isolation is preserved.
export async function postNewSession(body = {}) {
  const r = await fetch(url('/session/new'), {
    method: 'POST',
    headers: json,
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function postLoadSession(sessionId, cwd) {
  const r = await fetch(url('/session/load'), {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ sessionId, cwd }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getSpawnOpts() {
  const r = await fetch(url('/spawn-opts'));
  return r.json();
}

export async function getIdentity() {
  const r = await fetch(url('/identity'));
  return r.json();
}

export async function postRespawn(opts = {}) {
  const r = await fetch(url('/session/respawn'), {
    method: 'POST',
    headers: json,
    body: JSON.stringify(opts),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export function streamUrl({ since = null } = {}) {
  const u = new URL('/stream', location.origin);
  if (TAB_SESSION_ID) u.searchParams.set('sessionId', TAB_SESSION_ID);
  if (since != null) u.searchParams.set('since', String(since));
  return u.pathname + u.search;
}

// ─── CLI shell-out wrappers ──────────────────────────────────────────────
export async function cliShare(sessionId) {
  const body = sessionId ? { sessionId } : {};
  const r = await fetch(url('/cli/share'), {
    method: 'POST',
    headers: json,
    body: JSON.stringify(body),
  });
  return r.json();
}
export async function cliTrace(sessionId) {
  const r = await fetch(url('/cli/trace'), {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ sessionId }),
  });
  return r.json();
}
export async function cliInspect() {
  const r = await fetch(url('/cli/inspect'));
  return r.json();
}
export async function cliUpdateCheck() {
  const r = await fetch(url('/cli/update-check'));
  return r.json();
}
export async function cliMcp() {
  const r = await fetch(url('/cli/mcp'));
  return r.text();
}
export async function cliWorktree() {
  const r = await fetch(url('/cli/worktree'));
  return r.text();
}
export async function cliModels() {
  const r = await fetch(url('/cli/models'));
  return r.text();
}
export async function cliMemoryList() {
  const r = await fetch(url('/cli/memory/list'));
  return readJsonResponse(r, 'memory list');
}
export async function cliMemoryRead(path) {
  const u = new URL(url('/cli/memory/read'), location.origin);
  u.searchParams.set('path', path);
  const r = await fetch(u.pathname + u.search);
  return readJsonResponse(r, 'memory read');
}
export async function cliSessionsSearch(query, limit = null) {
  const body = { query };
  if (limit) body.limit = limit;
  const r = await fetch(url('/cli/sessions/search'), {
    method: 'POST',
    headers: json,
    body: JSON.stringify(body),
  });
  return readJsonResponse(r, 'sessions search');
}
