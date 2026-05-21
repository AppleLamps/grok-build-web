#!/usr/bin/env node
// grok-web: HTTP+SSE bridge between a browser UI and `grok agent stdio` (ACP/JSON-RPC).
//
// Flow:
//   browser  ──POST /prompt──▶  bridge  ──stdin──▶  grok agent stdio
//   browser  ◀──SSE /stream──   bridge  ◀──stdout── grok agent stdio
//
// One shared grok session per launch. Reload the page → same session.

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { watch as watchFs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, extname, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, 'public');
const GROK_BIN = process.env.GROK_BIN ?? 'grok';
const PORT = Number(process.env.PORT ?? 0); // 0 = pick a free port
const CWD = process.env.GROK_CWD ?? process.cwd();
const TOKEN = randomBytes(16).toString('hex');
const HISTORY_LIMIT = 10000;
const DEFAULT_RPC_TIMEOUT_MS = Number(process.env.GROK_WEB_RPC_TIMEOUT_MS ?? 2 * 60 * 1000);
const PROMPT_RPC_TIMEOUT_MS = Number(process.env.GROK_WEB_PROMPT_TIMEOUT_MS ?? 30 * 60 * 1000);

// ─── ACP client over grok stdio ─────────────────────────────────────────────
class GrokSession {
  constructor() {
    this.child = null;
    this.buf = '';
    this.nextId = 1;
    this.pending = new Map();
    this.sessionId = null;
    this.listeners = new Set();
    this.history = []; // every notification + sent prompt, replayed on new SSE connect
    this.ready = false;
    this.readyPromise = null;
    this.respawnChain = Promise.resolve();
    this.autoApprove = true; // when false, route permission requests to the UI
    this.pendingPermissions = new Map(); // rpcId -> {request, timeout}
    this.pendingElicitations = new Map(); // rpcId -> {request, timeout}
    this.unhandledClientRequests = new Set();
    // Launch-time grok flags. Changing any of these requires respawning the
    // child process — see respawn().
    this.spawnOpts = {
      effort: null,             // low|medium|high|xhigh|max
      reasoningEffort: null,
      maxTurns: null,
      sandbox: null,
      model: null,
      rules: null,
      systemPromptOverride: null,
      allow: [],                // array of rule strings
      deny: [],
      tools: null,              // comma-separated allow-list
      disallowedTools: null,    // comma-separated deny-list
      disableWebSearch: false,
      noSubagents: false,
      noPlan: false,
      noMemory: false,
      restoreCode: false,
      // Default ON: prefer the grok.com subscription path over XAI_API_KEY,
      // since most grok-web users have a SuperHeavy / SuperGrok subscription.
      // Toggle OFF in Settings to use the API key instead.
      // Honors $GROK_WEB_USE_API_KEY=1 as an env override at launch time.
      ignoreApiKey: !process.env.GROK_WEB_USE_API_KEY,
    };
  }

  buildArgv() {
    const a = []; const o = this.spawnOpts;
    if (o.restoreCode) a.push('--restore-code');
    if (o.effort) a.push('--effort', o.effort);
    if (o.reasoningEffort) a.push('--reasoning-effort', o.reasoningEffort);
    if (o.maxTurns) a.push('--max-turns', String(o.maxTurns));
    if (o.sandbox) a.push('--sandbox', o.sandbox);
    if (o.model) a.push('--model', o.model);
    if (o.rules) a.push('--rules', o.rules);
    if (o.systemPromptOverride) a.push('--system-prompt-override', o.systemPromptOverride);
    for (const r of (o.allow ?? [])) a.push('--allow', r);
    for (const r of (o.deny ?? [])) a.push('--deny', r);
    if (o.tools) a.push('--tools', o.tools);
    if (o.disallowedTools) a.push('--disallowed-tools', o.disallowedTools);
    if (o.disableWebSearch) a.push('--disable-web-search');
    if (o.noSubagents) a.push('--no-subagents');
    if (o.noPlan) a.push('--no-plan');
    if (o.noMemory) a.push('--no-memory');
    a.push('agent', 'stdio');
    return a;
  }

  start() {
    this.buf = '';
    this.rejectPending(new Error('agent process restarted'));
    this.pendingPermissions.clear();
    this.pendingElicitations.clear();
    // Compose env. When ignoreApiKey is true, strip XAI_API_KEY so the agent
    // falls back to the cached grok.com token (Grok SuperHeavy / SuperGrok
    // subscription path) instead of the API team-billed path.
    const env = { ...process.env };
    if (this.spawnOpts.ignoreApiKey) {
      delete env.XAI_API_KEY;
      delete env.GROK_API_KEY;
    }
    this.child = spawn(GROK_BIN, this.buildArgv(), {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });
    this.child.stdout.on('data', (c) => this.onStdout(c));
    this.child.stderr.on('data', (c) => process.stderr.write(`[grok] ${c}`));
    this.child.on('exit', (code) => {
      this.rejectPending(new Error(`agent exited (code ${code})`));
      this.broadcast({ kind: 'agent_exit', code });
      this.ready = false;
    });
    this.readyPromise = this.init();
    return this.readyPromise;
  }

  async respawn(newOpts = {}) {
    const next = this.respawnChain.then(() => this.doRespawn(newOpts));
    this.respawnChain = next.catch(() => {});
    return next;
  }

  async doRespawn(newOpts = {}) {
    Object.assign(this.spawnOpts, newOpts);
    this.ready = false;
    await this.killChild();
    this.history.length = 0;
    this.broadcast({ kind: 'agent_respawn', spawnOpts: { ...this.spawnOpts } });
    this.sessionId = null;
    this.start();
    await this.readyPromise;
  }

  // Tear down the current child cleanly. Detaches listeners *before* the
  // child dies so any final stdout flush doesn't corrupt the next child's
  // parser state (Issue #2 from the review).
  async killChild() {
    if (!this.child) return;
    const dying = this.child;
    this.child = null;
    try {
      dying.stdout.removeAllListeners('data');
      dying.stderr.removeAllListeners('data');
      dying.removeAllListeners('exit');
    } catch {}
    try { dying.kill(); } catch {}
    await new Promise((resolve) => {
      const t = setTimeout(resolve, 500);
      dying.once('exit', () => { clearTimeout(t); resolve(); });
    });
  }

  async init() {
    await this.call('initialize', {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        elicitation: { form: {}, url: {} },
      },
    });
    const res = await this.call('session/new', { cwd: this.cwd ?? CWD, mcpServers: [] });
    this.sessionId = res.sessionId;
    this.cwd = this.cwd ?? CWD;
    this.ready = true;
    this.broadcast({ kind: 'session_ready', sessionId: this.sessionId, cwd: this.cwd, spawnOpts: { ...this.spawnOpts } });
  }

  async newSession(cwd) {
    if (this.sessionId) this.notify('session/cancel', { sessionId: this.sessionId });
    const previousSessionId = this.sessionId;
    const targetCwd = cwd ?? this.cwd ?? CWD;
    const res = await this.call('session/new', { cwd: targetCwd, mcpServers: [] });
    this.sessionId = res.sessionId;
    this.cwd = targetCwd;
    this.clearSessionHistory(previousSessionId);
    this.broadcast({ kind: 'session_replaced', sessionId: this.sessionId, cwd: targetCwd });
  }

  async loadSession(sessionId, cwd, opts = {}) {
    // Cancel against the still-alive child *before* respawning. If restoreCode
    // triggers a respawn we don't want to write to a dead child afterwards.
    if (this.sessionId && this.ready) this.notify('session/cancel', { sessionId: this.sessionId });
    const previousSessionId = this.sessionId;
    const targetCwd = cwd ?? this.cwd ?? CWD;
    if (opts.restoreCode && !this.spawnOpts.restoreCode) {
      Object.assign(this.spawnOpts, { restoreCode: true });
      this.ready = false;
      await this.killChild();
      this.history.length = 0;
      this.broadcast({ kind: 'agent_respawn', spawnOpts: { ...this.spawnOpts } });
      this.start();
      await this.readyPromise;
    }
    await this.call('session/load', { sessionId, cwd: targetCwd, mcpServers: [] });
    this.sessionId = sessionId;
    this.cwd = targetCwd;
    this.clearSessionHistory(previousSessionId, sessionId);
    this.broadcast({ kind: 'session_replaced', sessionId, cwd: targetCwd, loaded: true });
  }

  onStdout(chunk) {
    this.buf += chunk.toString();
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      this.handle(msg);
    }
  }

  handle(msg) {
    // Response to a call we made
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const resolver = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (resolver?.timeout) clearTimeout(resolver.timeout);
      if (msg.error) resolver?.reject(new Error(rpcErrorMessage(msg.error)));
      else resolver?.resolve(msg.result);
      return;
    }
    // Notification or server-side request
    if (msg.method === 'session/update') {
      this.broadcast({ kind: 'update', update: msg.params.update, sessionId: msg.params.sessionId });
      return;
    }
    if (msg.method === 'session/request_permission' && msg.id !== undefined) {
      const sessionId = msg.params?.sessionId;
      if (this.autoApprove) {
        const optionId = chooseAutoPermissionOption(msg.params?.options);
        this.send({ jsonrpc: '2.0', id: msg.id, result: { outcome: { outcome: 'selected', optionId } } });
        this.broadcast({ kind: 'permission_auto_allowed', toolCall: msg.params?.toolCall, optionId, sessionId });
      } else {
        // Park the request — UI will answer via /permission. Auto-deny after 5 minutes
        // so a forgotten request doesn't wedge the agent forever.
        const timeout = setTimeout(() => {
          if (this.pendingPermissions.has(msg.id)) {
            this.pendingPermissions.delete(msg.id);
            this.send({ jsonrpc: '2.0', id: msg.id, result: { outcome: { outcome: 'cancelled' } } });
            this.broadcast({ kind: 'permission_timeout', rpcId: msg.id });
          }
        }, 5 * 60 * 1000);
        this.pendingPermissions.set(msg.id, { request: msg.params, timeout });
        this.broadcast({ kind: 'permission_request', rpcId: msg.id, request: msg.params, sessionId });
      }
      return;
    }
    if (msg.method && msg.id !== undefined) {
      this.handleClientRequest(msg).catch((e) => {
        this.sendError(msg.id, -32603, String(e?.message ?? e));
      });
      return;
    }
    // Other methods (mostly _x.ai/* extensions) — surface but don't act
    if (msg.method) {
      // Many extension notifications are session-scoped (sessionId in params).
      // Tag the broadcast so multi-tab SSE filtering routes them correctly.
      this.broadcast({
        kind: 'meta',
        method: msg.method,
        params: msg.params,
        sessionId: msg.params?.sessionId ?? msg.params?.update?.sessionId,
      });
    }
  }

  send(obj) {
    if (!this.child || this.child.killed || !this.child.stdin.writable) return false;
    try { this.child.stdin.write(JSON.stringify(obj) + '\n'); return true; }
    catch (e) { console.error('[grok-web] stdin write failed:', e.message); return false; }
  }

  sendError(id, code, message) {
    this.send({ jsonrpc: '2.0', id, error: { code, message } });
  }

  async handleClientRequest(msg) {
    if (msg.result !== undefined || msg.error !== undefined) return;
    const sessionId = msg.params?.sessionId;
    switch (msg.method) {
      case 'elicitation/create':
        this.parkElicitation(msg);
        return;
      case 'fs/read_text_file': {
        try {
          const file = this.resolveClientPath(msg.params);
          const content = await readFile(file, 'utf8');
          this.send({ jsonrpc: '2.0', id: msg.id, result: { content } });
        } catch (e) {
          this.sendError(msg.id, -32602, String(e?.message ?? e));
        }
        return;
      }
      case 'fs/write_text_file': {
        try {
          const file = this.resolveClientPath(msg.params);
          const content = msg.params?.content ?? msg.params?.text ?? '';
          await writeFile(file, String(content), 'utf8');
          this.send({ jsonrpc: '2.0', id: msg.id, result: null });
        } catch (e) {
          this.sendError(msg.id, -32602, String(e?.message ?? e));
        }
        return;
      }
      default:
        if (!this.unhandledClientRequests.has(msg.method)) {
          this.unhandledClientRequests.add(msg.method);
          console.error('[grok-web] unhandled client request:', msg.method);
        }
        this.send({ jsonrpc: '2.0', id: msg.id, result: {} });
        this.broadcast({ kind: 'meta', method: msg.method, params: msg.params, sessionId });
    }
  }

  resolveClientPath(params = {}) {
    const raw = params.path ?? params.filePath ?? params.file_path;
    if (typeof raw !== 'string' || !raw) throw new Error('path required');
    const root = resolve(this.cwd ?? CWD);
    const file = resolve(root, raw);
    const rootCmp = process.platform === 'win32' ? root.toLowerCase() : root;
    const fileCmp = process.platform === 'win32' ? file.toLowerCase() : file;
    if (fileCmp !== rootCmp && !fileCmp.startsWith(rootCmp + sep)) {
      throw new Error('path outside session cwd');
    }
    return file;
  }

  parkElicitation(msg) {
    const mode = msg.params?.mode ?? 'form';
    const sessionId = msg.params?.sessionId;
    if (mode !== 'form' && mode !== 'url') {
      this.send({ jsonrpc: '2.0', id: msg.id, result: { action: 'cancel' } });
      return;
    }
    const timeout = setTimeout(() => {
      if (this.pendingElicitations.has(msg.id)) {
        this.pendingElicitations.delete(msg.id);
        this.send({ jsonrpc: '2.0', id: msg.id, result: { action: 'cancel' } });
        this.broadcast({ kind: 'elicitation_resolved', rpcId: msg.id, action: 'timed out', sessionId });
      }
    }, 5 * 60 * 1000);
    this.pendingElicitations.set(msg.id, { request: msg.params, timeout });
    this.broadcast({ kind: 'elicitation_request', rpcId: msg.id, request: msg.params, sessionId });
  }

  call(method, params, { timeoutMs = DEFAULT_RPC_TIMEOUT_MS } = {}) {
    const id = this.nextId++;
    if (!this.send({ jsonrpc: '2.0', id, method, params })) {
      return Promise.reject(new Error(`failed to send RPC ${method}`));
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        const error = new Error(`RPC ${method} timed out after ${Math.round(timeoutMs / 1000)}s`);
        error.rpcTimeout = true;
        reject(error);
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout, method });
    });
  }

  notify(method, params) { this.send({ jsonrpc: '2.0', method, params }); }

  async prompt(text, sessionId = null) {
    if (!this.ready) await this.readyPromise;
    const target = sessionId ?? this.sessionId;
    this.broadcast({ kind: 'user_prompt', text, sessionId: target });
    try {
      const res = await this.call('session/prompt', {
        sessionId: target,
        prompt: [{ type: 'text', text }],
      }, { timeoutMs: PROMPT_RPC_TIMEOUT_MS });
      this.broadcast({ kind: 'turn_complete', result: res, sessionId: target });
      return res;
    } catch (e) {
      if (e?.rpcTimeout && target) this.notify('session/cancel', { sessionId: target });
      throw e;
    }
  }

  cancel(sessionId = null) {
    const target = sessionId ?? this.sessionId;
    if (target) this.notify('session/cancel', { sessionId: target });
  }

  // Spawn an additional ACP session on the same agent connection — used by
  // tabs that want their own conversation thread.
  async createTabSession(cwd = null) {
    if (!this.ready) await this.readyPromise;
    const targetCwd = cwd ?? this.cwd ?? CWD;
    const res = await this.call('session/new', { cwd: targetCwd, mcpServers: [] });
    this.cwd = targetCwd;
    // Broadcast a per-tab session_ready event tagged with the new sid so the
    // browser tab subscribed to that sid can flip its UI out of "loading".
    this.broadcast({ kind: 'session_ready', sessionId: res.sessionId, cwd: targetCwd });
    return { sessionId: res.sessionId, cwd: targetCwd };
  }

  respondToPermission(rpcId, optionId) {
    const pending = this.pendingPermissions.get(rpcId);
    if (!pending) return false;
    clearTimeout(pending.timeout);
    this.pendingPermissions.delete(rpcId);
    const outcome = optionId === '__cancel__'
      ? { outcome: 'cancelled' }
      : { outcome: 'selected', optionId };
    this.send({ jsonrpc: '2.0', id: rpcId, result: { outcome } });
    this.broadcast({ kind: 'permission_resolved', rpcId, optionId });
    return true;
  }

  respondToElicitation(rpcId, action, content) {
    const pending = this.pendingElicitations.get(rpcId);
    if (!pending) return false;
    clearTimeout(pending.timeout);
    this.pendingElicitations.delete(rpcId);
    const result = content === undefined ? { action } : { action, content };
    this.send({ jsonrpc: '2.0', id: rpcId, result });
    this.broadcast({ kind: 'elicitation_resolved', rpcId, action, sessionId: pending.request?.sessionId });
    return true;
  }

  setAutoApprove(on, sessionId = null) {
    this.autoApprove = !!on;
    this.broadcast({ kind: 'auto_approve_changed', autoApprove: this.autoApprove });
    // Also try to sync grok's own /always-approve state. The slash command is
    // sent as a normal prompt; the agent intercepts it before reaching the model.
    const target = sessionId ?? this.sessionId;
    if (this.ready && target) {
      this.call('session/prompt', {
        sessionId: target,
        prompt: [{ type: 'text', text: `/always-approve ${on ? 'on' : 'off'}` }],
      }).catch(() => { /* slash command may not be supported in headless — best effort */ });
    }
  }

  // Subscribers can filter to one sessionId (multi-tab support).
  // sessionIdFilter=null receives every event; events without a sessionId
  // (global lifecycle like agent_exit, sessions_changed) reach everyone.
  subscribe(fn, sessionIdFilter = null) {
    const sub = { fn, sessionIdFilter };
    this.listeners.add(sub);
    for (const e of this.history) {
      if (!sessionIdFilter || !e.sessionId || e.sessionId === sessionIdFilter) fn(e);
    }
    return () => this.listeners.delete(sub);
  }

  broadcast(event) {
    this.history.push(event);
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
    for (const sub of this.listeners) {
      if (sub.sessionIdFilter && event.sessionId && event.sessionId !== sub.sessionIdFilter) continue;
      try { sub.fn(event); } catch (e) { console.error('listener error', e); }
    }
  }

  clearSessionHistory(...sessionIds) {
    const ids = new Set(sessionIds.filter(Boolean));
    if (!ids.size) return;
    this.history = this.history.filter((event) => !event.sessionId || !ids.has(event.sessionId));
  }

  rejectPending(error) {
    for (const [id, resolver] of this.pending) {
      if (resolver.timeout) clearTimeout(resolver.timeout);
      resolver.reject(error);
      this.pending.delete(id);
    }
  }
}

function rpcErrorMessage(error) {
  if (!error) return 'unknown RPC error';
  if (typeof error === 'string') return error;
  if (typeof error.message === 'string') return error.message;
  return JSON.stringify(error);
}

function chooseAutoPermissionOption(options = []) {
  const opts = Array.isArray(options) ? options : [];
  const label = (opt) => `${opt?.optionId ?? ''} ${opt?.name ?? ''}`.toLowerCase();
  const positive = opts.find((opt) => /\b(allow|accept|approve|yes)\b/.test(label(opt)));
  if (positive?.optionId) return positive.optionId;
  const nonDeny = opts.find((opt) => !/\b(deny|reject|decline|cancel)\b/.test(label(opt)));
  return nonDeny?.optionId ?? opts[0]?.optionId ?? 'allow';
}

function isWithinPath(root, file) {
  const rootPath = resolve(root);
  const filePath = resolve(file);
  const rootCmp = process.platform === 'win32' ? rootPath.toLowerCase() : rootPath;
  const fileCmp = process.platform === 'win32' ? filePath.toLowerCase() : filePath;
  return fileCmp === rootCmp || fileCmp.startsWith(rootCmp + sep);
}

// ─── CLI shell-out helper ───────────────────────────────────────────────────
// Run a one-shot grok CLI command without blocking the bridge event loop.
function runGrokCli(args, { timeout = 30000, cwd } = {}) {
  return new Promise((resolve) => {
    const child = spawn(GROK_BIN, args, {
      cwd: cwd ?? grok?.cwd ?? CWD,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill(); } catch {}
    }, timeout);
    child.stdout.on('data', (c) => { stdout += c.toString(); });
    child.stderr.on('data', (c) => { stderr += c.toString(); });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr || e.message, timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        code: timedOut ? -1 : code,
        stdout,
        stderr: timedOut ? `${stderr}${stderr ? '\n' : ''}timed out after ${Math.round(timeout / 1000)}s` : stderr,
        timedOut,
      });
    });
  });
}

// ─── Session history (read from ~/.grok/sessions) ───────────────────────────
const SESSIONS_ROOT = join(homedir(), '.grok', 'sessions');

async function listSessions({ limit = 50 } = {}) {
  let cwdDirs;
  try { cwdDirs = await readdir(SESSIONS_ROOT, { withFileTypes: true }); }
  catch { return []; }
  const candidates = [];
  for (const cwdDir of cwdDirs) {
    if (!cwdDir.isDirectory()) continue;
    const cwdPath = join(SESSIONS_ROOT, cwdDir.name);
    let sessionDirs;
    try { sessionDirs = await readdir(cwdPath, { withFileTypes: true }); } catch { continue; }
    for (const sd of sessionDirs) {
      if (!sd.isDirectory()) continue;
      const sumPath = join(cwdPath, sd.name, 'summary.json');
      try {
        const st = await stat(sumPath);
        candidates.push({ sumPath, mtime: st.mtimeMs });
      } catch { /* missing summary.json — likely a brand-new session */ }
    }
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  const top = candidates.slice(0, limit);
  const results = [];
  for (const t of top) {
    try {
      const data = JSON.parse(await readFile(t.sumPath, 'utf8'));
      results.push({
        id: data.info?.id,
        cwd: data.info?.cwd,
        title: data.generated_title ?? data.session_summary ?? '(untitled)',
        lastActive: data.last_active_at ?? data.updated_at,
        numMessages: data.num_chat_messages ?? 0,
      });
    } catch { /* malformed — skip */ }
  }
  return results;
}

// ─── HTTP server ────────────────────────────────────────────────────────────
const grok = new GrokSession();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function auth(req) {
  const url = new URL(req.url, 'http://localhost');
  return url.searchParams.get('token') === TOKEN;
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  // Static files (auth-gated — no point serving the UI to randos on the LAN)
  if (req.method === 'GET' && url.pathname === '/') {
    if (!auth(req)) { res.writeHead(401).end('missing or bad token'); return; }
    try {
      const html = await readFile(join(PUBLIC_DIR, 'index.html'), 'utf8');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html.replace('__TOKEN__', TOKEN));
    } catch (e) { res.writeHead(500).end(String(e)); }
    return;
  }
  if (req.method === 'GET' && url.pathname.startsWith('/static/')) {
    // Static assets (CSS/JS) are public — they contain no secrets. The actual
    // API endpoints stay token-gated below.
    const safe = url.pathname.replace(/^\/static\//, '').replace(/\.\.+/g, '');
    const file = resolve(PUBLIC_DIR, safe);
    if (!isWithinPath(PUBLIC_DIR, file)) { res.writeHead(403).end(); return; }
    try {
      const data = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
      res.end(data);
    } catch { res.writeHead(404).end(); }
    return;
  }

  // SSE stream of agent events — accepts ?sessionId= to filter to one tab.
  if (req.method === 'GET' && url.pathname === '/stream') {
    if (!auth(req)) { res.writeHead(401).end(); return; }
    const filter = url.searchParams.get('sessionId') || null;
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      'connection': 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write('retry: 1000\n\n');
    const unsubscribe = grok.subscribe((event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }, filter);
    const ping = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => { unsubscribe(); clearInterval(ping); });
    return;
  }

  // Send a prompt — body.sessionId optional, falls back to default.
  if (req.method === 'POST' && url.pathname === '/prompt') {
    if (!auth(req)) { res.writeHead(401).end(); return; }
    try {
      const body = JSON.parse(await readBody(req));
      if (typeof body.text !== 'string' || !body.text.trim()) {
        res.writeHead(400).end('empty prompt'); return;
      }
      const target = body.sessionId ?? grok.sessionId;
      grok.prompt(body.text, target).catch((e) =>
        grok.broadcast({ kind: 'error', error: String(e?.message ?? e), sessionId: target })
      );
      res.writeHead(202, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) { res.writeHead(400).end(String(e)); }
    return;
  }

  // Cancel a turn — body.sessionId optional.
  if (req.method === 'POST' && url.pathname === '/cancel') {
    if (!auth(req)) { res.writeHead(401).end(); return; }
    let sessionId = null;
    if (req.headers['content-length'] && req.headers['content-length'] !== '0') {
      try { sessionId = JSON.parse(await readBody(req)).sessionId; } catch {}
    }
    grok.cancel(sessionId);
    res.writeHead(202).end();
    return;
  }

  // Load an existing ACP session for a tab — does NOT change the global default.
  if (req.method === 'POST' && url.pathname === '/tab/load') {
    if (!auth(req)) { res.writeHead(401).end(); return; }
    try {
      const body = JSON.parse(await readBody(req));
      if (!body.sessionId) { res.writeHead(400).end('sessionId required'); return; }
      const targetCwd = body.cwd ?? grok.cwd ?? CWD;
      await grok.call('session/load', { sessionId: body.sessionId, cwd: targetCwd, mcpServers: [] });
      grok.cwd = targetCwd;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ sessionId: body.sessionId, cwd: targetCwd }));
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(e?.message ?? e) }));
    }
    return;
  }

  // Create a new ACP session for a tab — does NOT change the global "default".
  if (req.method === 'POST' && url.pathname === '/tab/new') {
    if (!auth(req)) { res.writeHead(401).end(); return; }
    try {
      let cwd = null;
      if (req.headers['content-length'] && req.headers['content-length'] !== '0') {
        try { cwd = JSON.parse(await readBody(req)).cwd; } catch {}
      }
      const tab = await grok.createTabSession(cwd);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(tab));
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(e?.message ?? e) }));
    }
    return;
  }

  // Respond to a pending permission request
  if (req.method === 'POST' && url.pathname === '/permission') {
    if (!auth(req)) { res.writeHead(401).end(); return; }
    try {
      const body = JSON.parse(await readBody(req));
      if (typeof body.rpcId !== 'number' || !body.optionId) {
        res.writeHead(400).end('rpcId + optionId required'); return;
      }
      const ok = grok.respondToPermission(body.rpcId, body.optionId);
      res.writeHead(ok ? 200 : 410, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok }));
    } catch (e) { res.writeHead(400).end(String(e)); }
    return;
  }

  // Respond to a pending elicitation request
  if (req.method === 'POST' && url.pathname === '/elicitation') {
    if (!auth(req)) { res.writeHead(401).end(); return; }
    try {
      const body = JSON.parse(await readBody(req));
      if (typeof body.rpcId !== 'number' || !body.action) {
        res.writeHead(400).end('rpcId + action required'); return;
      }
      const ok = grok.respondToElicitation(body.rpcId, body.action, body.content);
      res.writeHead(ok ? 200 : 410, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok }));
    } catch (e) { res.writeHead(400).end(String(e)); }
    return;
  }

  // Read/write bridge settings (auto-approve mode)
  if (url.pathname === '/settings') {
    if (!auth(req)) { res.writeHead(401).end(); return; }
    if (req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ autoApprove: grok.autoApprove }));
      return;
    }
    if (req.method === 'POST') {
      try {
        const body = JSON.parse(await readBody(req));
        if (typeof body.autoApprove === 'boolean') grok.setAutoApprove(body.autoApprove, body.sessionId);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ autoApprove: grok.autoApprove }));
      } catch (e) { res.writeHead(400).end(String(e)); }
      return;
    }
  }

  // List recent sessions
  if (req.method === 'GET' && url.pathname === '/sessions') {
    if (!auth(req)) { res.writeHead(401).end(); return; }
    try {
      const sessions = await listSessions();
      const current = url.searchParams.get('sessionId') || grok.sessionId;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ sessions, current }));
    } catch (e) { res.writeHead(500).end(String(e)); }
    return;
  }

  // Start a brand-new session (optionally in a different cwd)
  if (req.method === 'POST' && url.pathname === '/session/new') {
    if (!auth(req)) { res.writeHead(401).end(); return; }
    try {
      const body = req.headers['content-length'] && req.headers['content-length'] !== '0'
        ? JSON.parse(await readBody(req)) : {};
      await grok.newSession(body.cwd);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ sessionId: grok.sessionId, cwd: grok.cwd }));
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(e?.message ?? e) }));
    }
    return;
  }

  // Resume a stored session
  if (req.method === 'POST' && url.pathname === '/session/load') {
    if (!auth(req)) { res.writeHead(401).end(); return; }
    try {
      const body = JSON.parse(await readBody(req));
      if (!body.sessionId) { res.writeHead(400).end('sessionId required'); return; }
      await grok.loadSession(body.sessionId, body.cwd, { restoreCode: !!body.restoreCode });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ sessionId: grok.sessionId, cwd: grok.cwd }));
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(e?.message ?? e) }));
    }
    return;
  }

  // Respawn the agent with new launch flags (effort, sandbox, allow rules, etc.)
  if (req.method === 'POST' && url.pathname === '/session/respawn') {
    if (!auth(req)) { res.writeHead(401).end(); return; }
    try {
      const body = req.headers['content-length'] && req.headers['content-length'] !== '0'
        ? JSON.parse(await readBody(req)) : {};
      await grok.respawn(body);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ sessionId: grok.sessionId, spawnOpts: grok.spawnOpts }));
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(e?.message ?? e) }));
    }
    return;
  }

  // Read current spawn options plus a few diagnostic flags from the env.
  if (req.method === 'GET' && url.pathname === '/spawn-opts') {
    if (!auth(req)) { res.writeHead(401).end(); return; }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      ...grok.spawnOpts,
      _env: {
        XAI_API_KEY_set: !!process.env.XAI_API_KEY,
      },
    }));
    return;
  }

  // CLI shell-out endpoints — wrap one-shot grok subcommands.
  if (req.method === 'GET' && url.pathname === '/cli/inspect') {
    if (!auth(req)) { res.writeHead(401).end(); return; }
    const r = await runGrokCli(['inspect', '--json'], { timeout: 10000 });
    res.writeHead(r.code === 0 ? 200 : 500, { 'content-type': 'application/json' });
    res.end(r.stdout || JSON.stringify({ error: r.stderr || `exit ${r.code}` }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/cli/update-check') {
    if (!auth(req)) { res.writeHead(401).end(); return; }
    const r = await runGrokCli(['update', '--check', '--json'], { timeout: 15000 });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(r.stdout || JSON.stringify({ error: r.stderr || `exit ${r.code}` }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/cli/models') {
    if (!auth(req)) { res.writeHead(401).end(); return; }
    const r = await runGrokCli(['models'], { timeout: 10000 });
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(r.stdout || r.stderr);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/cli/share') {
    if (!auth(req)) { res.writeHead(401).end(); return; }
    let sid = grok.sessionId;
    try {
      const body = req.headers['content-length'] && req.headers['content-length'] !== '0'
        ? JSON.parse(await readBody(req)) : {};
      if (body.sessionId) sid = body.sessionId;
    } catch {}
    if (!sid) { res.writeHead(400).end('no active session'); return; }
    const r = await runGrokCli(['share', sid], { timeout: 30000 });
    const urlMatch = r.stdout.match(/https?:\/\/\S+/);
    res.writeHead(r.code === 0 ? 200 : 500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      ok: r.code === 0, url: urlMatch?.[0] ?? null,
      output: r.stdout, error: r.stderr || (r.code !== 0 ? `exit ${r.code}` : null),
    }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/cli/trace') {
    if (!auth(req)) { res.writeHead(401).end(); return; }
    let sid = grok.sessionId;
    try {
      const body = req.headers['content-length'] && req.headers['content-length'] !== '0'
        ? JSON.parse(await readBody(req)) : {};
      if (body.sessionId) sid = body.sessionId;
    } catch {}
    if (!sid) { res.writeHead(400).end('sessionId required'); return; }
    const r = await runGrokCli(['trace', sid, '--local', '--json'], { timeout: 60000 });
    res.writeHead(r.code === 0 ? 200 : 500, { 'content-type': 'application/json' });
    res.end(r.stdout || JSON.stringify({ error: r.stderr || `exit ${r.code}` }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/cli/mcp') {
    if (!auth(req)) { res.writeHead(401).end(); return; }
    const r = await runGrokCli(['mcp', 'list'], { timeout: 10000 });
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(r.stdout || r.stderr);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/cli/worktree') {
    if (!auth(req)) { res.writeHead(401).end(); return; }
    const r = await runGrokCli(['worktree', 'list'], { timeout: 10000 });
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(r.stdout || r.stderr);
    return;
  }

  // Login (device-auth flow) — surfaces the device URL/code to the UI.
  if (req.method === 'POST' && url.pathname === '/cli/login') {
    if (!auth(req)) { res.writeHead(401).end(); return; }
    const r = await runGrokCli(['login', '--device-auth'], { timeout: 30000 });
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(r.stdout || r.stderr);
    return;
  }

  // One-shot headless prompt — for --check and --best-of-n which the
  // interactive `agent stdio` connection doesn't support.
  if (req.method === 'POST' && url.pathname === '/cli/oneshot') {
    if (!auth(req)) { res.writeHead(401).end(); return; }
    try {
      const body = JSON.parse(await readBody(req));
      const args = [];
      if (body.effort) args.push('--effort', body.effort);
      if (body.bestOfN) args.push('--best-of-n', String(body.bestOfN));
      if (body.check) args.push('--check');
      if (body.maxTurns) args.push('--max-turns', String(body.maxTurns));
      args.push('--always-approve', '--output-format', 'json', '-p', body.text ?? '');
      const r = await runGrokCli(args, { timeout: 300000, cwd: body.cwd });
      res.writeHead(r.code === 0 ? 200 : 500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: r.code === 0, stdout: r.stdout, stderr: r.stderr }));
    } catch (e) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(e?.message ?? e) }));
    }
    return;
  }

  // Import session(s) — POST a list of session IDs OR a .jsonl file path.
  if (req.method === 'POST' && url.pathname === '/cli/import') {
    if (!auth(req)) { res.writeHead(401).end(); return; }
    try {
      const body = JSON.parse(await readBody(req));
      const args = ['import', '--json'];
      // Use `--` so user-supplied targets can never be interpreted as flags
      // even if they happen to start with a hyphen.
      if (Array.isArray(body.targets) && body.targets.length) {
        args.push('--', ...body.targets);
      }
      const r = await runGrokCli(args, { timeout: 120000 });
      res.writeHead(r.code === 0 ? 200 : 500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: r.code === 0, output: r.stdout, error: r.stderr }));
    } catch (e) { res.writeHead(400).end(String(e)); }
    return;
  }

  res.writeHead(404).end('not found');
});

// ─── Boot ───────────────────────────────────────────────────────────────────
async function openBrowser(url) {
  // Windows: `start` is a cmd.exe builtin
  const { spawn } = await import('node:child_process');
  if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  else if (process.platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
  else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
}

// Watch the sessions dir for changes so the UI sidebar can auto-refresh.
let sessionsChangeDebounce = null;
try {
  watchFs(SESSIONS_ROOT, { recursive: true }, () => {
    clearTimeout(sessionsChangeDebounce);
    sessionsChangeDebounce = setTimeout(() => grok.broadcast({ kind: 'sessions_changed' }), 1500);
  });
} catch (e) {
  // Recursive watch may not be supported on some platforms; non-fatal.
  console.error('[grok-web] sessions watcher unavailable:', e.message);
}

(async () => {
  grok.start();
  server.listen(PORT, '127.0.0.1', async () => {
    const port = server.address().port;
    const url = `http://127.0.0.1:${port}/?token=${TOKEN}`;
    console.log(`\n  grok-web running\n  ${url}\n  cwd: ${CWD}\n`);
    if (!process.env.GROK_WEB_NO_OPEN) await openBrowser(url);
  });
})();

process.on('SIGINT', () => { grok.child?.kill(); process.exit(0); });
process.on('SIGTERM', () => { grok.child?.kill(); process.exit(0); });
