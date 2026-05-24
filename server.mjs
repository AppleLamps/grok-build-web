#!/usr/bin/env node
// grok-web: HTTP+SSE bridge between a browser UI and `grok agent stdio` (ACP/JSON-RPC).
//
// Flow:
//   browser  ──POST /prompt──▶  bridge  ──stdin──▶  grok agent stdio
//   browser  ◀──SSE /stream──   bridge  ◀──stdout── grok agent stdio
//
// One shared grok session per launch. Reload the page → same session.

import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { createReadStream, watch as watchFs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, dirname, join, resolve, extname, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { homedir, userInfo } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, 'public');
const GROK_BIN = process.env.GROK_BIN ?? 'grok';
const GROK_BIN_ARGS = process.env.GROK_BIN_ARGS
  ? JSON.parse(process.env.GROK_BIN_ARGS)
  : [];
const PORT = Number(process.env.PORT ?? 0); // 0 = pick a free port
const CWD = process.env.GROK_CWD ?? process.cwd();
const BOOTSTRAP_TOKEN = randomBytes(16).toString('hex');
const SESSION_COOKIE = 'grok_web';
const SESSION_TOKEN = randomBytes(32).toString('hex');
const SESSION_COOKIE_MAX_AGE_SECONDS = 12 * 60 * 60;
const HISTORY_LIMIT = 10000;
const SESSIONS_CACHE_TTL_MS = Number(process.env.GROK_WEB_SESSIONS_CACHE_TTL_MS ?? 2000);
const MAX_REQUEST_BODY_BYTES = Number(process.env.GROK_WEB_MAX_REQUEST_BODY_BYTES ?? 64 * 1024 * 1024);
const AGENT_HELP_TIMEOUT_MS = 3000;
const DEFAULT_RPC_TIMEOUT_MS = Number(process.env.GROK_WEB_RPC_TIMEOUT_MS ?? 2 * 60 * 1000);
const PROMPT_RPC_TIMEOUT_MS = Number(process.env.GROK_WEB_PROMPT_TIMEOUT_MS ?? 30 * 60 * 1000);
const CHILD_KILL_GRACE_MS = 500;
const PERMISSION_REQUEST_TIMEOUT_MS = Number(process.env.GROK_WEB_PERMISSION_TIMEOUT_MS ?? 5 * 60 * 1000);
const ELICITATION_TIMEOUT_MS = Number(process.env.GROK_WEB_ELICITATION_TIMEOUT_MS ?? 5 * 60 * 1000);
const CLI_TIMEOUT_DEFAULT_MS = 30000;
const CLI_TIMEOUT_SHORT_MS = 10000;
const CLI_TIMEOUT_UPDATE_CHECK_MS = 15000;
const CLI_TIMEOUT_TRACE_MS = 60000;
const CLI_TIMEOUT_ONESHOT_MS = 300000;
const CLI_TIMEOUT_IMPORT_MS = 120000;
let bootstrapUsed = false;
let agentHelpText = null;

function getAgentHelpText() {
  if (agentHelpText !== null) return agentHelpText;
  const r = spawnSync(GROK_BIN, [...GROK_BIN_ARGS, 'agent', '--help'], {
    encoding: 'utf8',
    timeout: AGENT_HELP_TIMEOUT_MS,
    windowsHide: true,
  });
  agentHelpText = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  return agentHelpText;
}

function agentSupportsFlag(flag) {
  return getAgentHelpText().includes(flag);
}

function agentCapabilities() {
  return {
    alwaysApprove: agentSupportsFlag('--always-approve'),
    noLeader: agentSupportsFlag('--no-leader'),
    permissionMode: agentSupportsFlag('--permission-mode'),
  };
}

function normalizeStderrLine(line) {
  return String(line)
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, '<timestamp>')
    .replace(/session_id=[0-9a-f-]+/gi, 'session_id=<session>')
    .trim();
}

class StderrRateLimiter {
  constructor({ prefix = '[grok] ', windowMs = 5000 } = {}) {
    this.prefix = prefix;
    this.windowMs = windowMs;
    this.buf = '';
    this.lines = new Map();
  }

  write(chunk) {
    this.buf += chunk.toString();
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).replace(/\r$/, '');
      this.buf = this.buf.slice(i + 1);
      this.writeLine(line);
    }
  }

  writeLine(line) {
    const key = normalizeStderrLine(line);
    if (!key) return;
    let entry = this.lines.get(key);
    if (!entry) {
      entry = { count: 0, timer: null };
      this.lines.set(key, entry);
      process.stderr.write(`${this.prefix}${line}\n`);
      entry.timer = setTimeout(() => this.flush(key), this.windowMs);
      return;
    }
    entry.count++;
  }

  flush(key) {
    const entry = this.lines.get(key);
    if (!entry) return;
    if (entry.count > 0) {
      process.stderr.write(`${this.prefix}suppressed ${entry.count} repeated stderr line${entry.count === 1 ? '' : 's'}: ${key}\n`);
    }
    this.lines.delete(key);
  }

  flushAll() {
    if (this.buf.trim()) this.writeLine(this.buf.trim());
    this.buf = '';
    for (const key of Array.from(this.lines.keys())) this.flush(key);
  }
}

function defaultUsername() {
  return process.env.GROK_WEB_USER
    ?? process.env.USERNAME
    ?? process.env.USER
    ?? userInfo().username
    ?? 'local';
}

const bridgeSettings = {
  displayName: defaultUsername(),
};

// ─── ACP client over grok stdio ─────────────────────────────────────────────
class GrokSession {
  constructor() {
    this.child = null;
    this.buf = '';
    this.nextId = 1;
    this.pending = new Map();
    this.sessionId = null;
    this.listeners = new Set();
    this.history = []; // bounded event entries replayed on new SSE connect
    this.historySeq = 0;
    this.globalHistory = [];
    this.sessionHistory = new Map();
    this.ready = false;
    this.readyPromise = null;
    this.loadedAgentSessionId = null;
    this.respawnChain = Promise.resolve();
    this.agentMutationActive = false;
    this.agentMutationBacklog = 0;
    this.nextTurnId = 1;
    this.activeTurn = null;
    this.turnQueue = [];
    this.defaultAutoApprove = true; // when false, route permission requests to the UI
    this.autoApprove = this.defaultAutoApprove; // legacy default-setting view
    this.sessionAutoApprovals = new Map();
    this.pendingPermissions = new Map(); // rpcId -> {request, timeout}
    this.pendingElicitations = new Map(); // rpcId -> {request, timeout, responseKind}
    this.unhandledClientRequests = new Set();
    this.sessionCwds = new Map();
    this.stderrLimiter = new StderrRateLimiter();
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
      alwaysApprove: true,
      noLeader: false,
      permissionMode: null,
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
    if (o.alwaysApprove && agentSupportsFlag('--always-approve')) a.push('--always-approve');
    if (o.noLeader && agentSupportsFlag('--no-leader')) a.push('--no-leader');
    if (o.permissionMode && agentSupportsFlag('--permission-mode')) a.push('--permission-mode', o.permissionMode);
    a.push('agent', 'stdio');
    return a;
  }

  start() {
    this.buf = '';
    this.rejectPending(new Error('agent process restarted'));
    this.clearParkedClientRequestTimers();
    this.pendingPermissions.clear();
    this.pendingElicitations.clear();
    // Compose env. When ignoreApiKey is true, strip XAI_API_KEY so the agent
    // falls back to the cached grok.com token (Grok SuperHeavy / SuperGrok
    // subscription path) instead of the API team-billed path.
    const env = buildGrokEnv({ ignoreApiKey: this.spawnOpts.ignoreApiKey });
    this.child = spawn(GROK_BIN, [...GROK_BIN_ARGS, ...this.buildArgv()], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });
    this.child.stdout.on('data', (c) => this.onStdout(c));
    this.child.stderr.on('data', (c) => this.stderrLimiter.write(c));
    this.child.on('exit', (code) => {
      this.stderrLimiter.flushAll();
      this.rejectPending(new Error(`agent exited (code ${code})`));
      this.broadcast({ kind: 'agent_exit', code });
      this.ready = false;
    });
    this.readyPromise = this.init();
    return this.readyPromise;
  }

  async respawn(newOpts = {}) {
    return this.enqueueAgentMutation(() => this.doRespawn(newOpts));
  }

  async enqueueAgentMutation(fn) {
    this.agentMutationBacklog++;
    const next = this.respawnChain.then(async () => {
      this.agentMutationBacklog--;
      this.agentMutationActive = true;
      try {
        return await fn();
      } finally {
        this.agentMutationActive = false;
      }
    });
    this.respawnChain = next.catch(() => {});
    return next;
  }

  async doRespawn(newOpts = {}) {
    Object.assign(this.spawnOpts, newOpts);
    this.ready = false;
    await this.killChild();
    this.clearAllHistory();
    this.broadcast({ kind: 'agent_respawn', spawnOpts: { ...this.spawnOpts } });
    this.sessionId = null;
    this.loadedAgentSessionId = null;
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
      const t = setTimeout(resolve, CHILD_KILL_GRACE_MS);
      dying.once('exit', () => { clearTimeout(t); resolve(); });
    });
  }

  async init() {
    await this.call('initialize', {
      protocolVersion: 1,
      clientCapabilities: {
        elicitation: { form: {}, url: {} },
      },
    });
    const res = await this.call('session/new', { cwd: this.cwd ?? CWD, mcpServers: [] });
    this.sessionId = res.sessionId;
    this.loadedAgentSessionId = this.sessionId;
    this.cwd = this.cwd ?? CWD;
    this.rememberSessionCwd(this.sessionId, this.cwd);
    this.ready = true;
    this.broadcast({ kind: 'session_ready', sessionId: this.sessionId, cwd: this.cwd, spawnOpts: { ...this.spawnOpts } });
  }

  async newSession(cwd) {
    return this.enqueueAgentMutation(async () => {
      if (this.sessionId) this.notify('session/cancel', { sessionId: this.sessionId });
      const previousSessionId = this.sessionId;
      const targetCwd = cwd ?? this.cwd ?? CWD;
      const res = await this.call('session/new', { cwd: targetCwd, mcpServers: [] });
      this.sessionId = res.sessionId;
      this.loadedAgentSessionId = this.sessionId;
      this.cwd = targetCwd;
      this.rememberSessionCwd(this.sessionId, targetCwd);
      this.clearSessionHistory(previousSessionId);
      this.broadcast({ kind: 'session_replaced', sessionId: this.sessionId, cwd: targetCwd });
    });
  }

  async loadSession(sessionId, cwd, opts = {}) {
    return this.enqueueAgentMutation(async () => {
      const previousSessionId = this.sessionId;
      const targetCwd = cwd ?? this.cwd ?? CWD;
      if (this.sessionId && this.ready) this.notify('session/cancel', { sessionId: this.sessionId });
      if (opts.restoreCode && !this.spawnOpts.restoreCode) await this.doRespawn({ restoreCode: true });
      await this.finishLoadSession(sessionId, targetCwd, previousSessionId);
    });
  }

  async finishLoadSession(sessionId, targetCwd, previousSessionId) {
    await this.call('session/load', { sessionId, cwd: targetCwd, mcpServers: [] });
    this.sessionId = sessionId;
    this.loadedAgentSessionId = sessionId;
    this.cwd = targetCwd;
    this.rememberSessionCwd(sessionId, targetCwd);
    this.clearSessionHistory(previousSessionId, sessionId);
    this.broadcast({ kind: 'session_replaced', sessionId, cwd: targetCwd, loaded: true });
  }

  async loadTabSession(sessionId, cwd) {
    return this.enqueueAgentMutation(async () => {
      const targetCwd = cwd ?? this.cwdForSession(sessionId) ?? this.cwd ?? CWD;
      await this.call('session/load', { sessionId, cwd: targetCwd, mcpServers: [] });
      this.loadedAgentSessionId = sessionId;
      this.rememberSessionCwd(sessionId, targetCwd);
      this.broadcast({ kind: 'session_ready', sessionId, cwd: targetCwd, loaded: true });
      return { sessionId, cwd: targetCwd };
    });
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
      const agentSessionId = msg.params.sessionId;
      const sessionId = this.activeTurn?.sessionId ?? agentSessionId;
      const update = this.normalizedSessionUpdate(msg.params.update, sessionId, agentSessionId);
      this.broadcast({ kind: 'update', update, sessionId });
      return;
    }
    if (msg.method === 'session/request_permission' && msg.id !== undefined) {
      const sessionId = msg.params?.sessionId;
      if (this.autoApproveFor(sessionId)) {
        const optionId = chooseAutoPermissionOption(msg.params?.options);
        if (optionId) {
          this.send({ jsonrpc: '2.0', id: msg.id, result: { outcome: { outcome: 'selected', optionId } } });
          this.broadcast({ kind: 'permission_auto_allowed', toolCall: msg.params?.toolCall, optionId, sessionId });
        } else {
          this.send({ jsonrpc: '2.0', id: msg.id, result: { outcome: { outcome: 'cancelled' } } });
          this.broadcast({ kind: 'permission_auto_cancelled', reason: 'no_options', toolCall: msg.params?.toolCall, sessionId });
        }
      } else {
        // Park the request. UI will answer via /permission. Auto-deny after
        // the configured timeout so a forgotten request doesn't wedge the
        // agent forever.
        const timeout = setTimeout(() => {
          if (this.pendingPermissions.has(msg.id)) {
            this.pendingPermissions.delete(msg.id);
            this.send({ jsonrpc: '2.0', id: msg.id, result: { outcome: { outcome: 'cancelled' } } });
            this.broadcast({ kind: 'permission_timeout', rpcId: msg.id, sessionId });
          }
        }, PERMISSION_REQUEST_TIMEOUT_MS);
        this.pendingPermissions.set(msg.id, { request: msg.params, timeout });
        this.broadcast({ kind: 'permission_request', rpcId: msg.id, request: msg.params, sessionId });
      }
      return;
    }
    if (msg.method && msg.id !== undefined) {
      this.handleClientRequest(msg).catch((e) => {
        this.sendError(msg.id, -32603, errorMessage(e));
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
    catch (e) { console.error('[grok-web] stdin write failed:', errorMessage(e)); return false; }
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
      case '_x.ai/ask_user_question':
        this.parkUserQuestion(msg);
        return;
      case 'fs/read_text_file': {
        try {
          const file = await this.resolveClientPath(msg.params);
          const content = await readFile(file, 'utf8');
          this.send({ jsonrpc: '2.0', id: msg.id, result: { content } });
        } catch (e) {
          this.sendError(msg.id, -32602, errorMessage(e));
        }
        return;
      }
      case 'fs/write_text_file': {
        try {
          const file = await this.resolveClientPath(msg.params, { forWrite: true });
          const content = msg.params?.content ?? msg.params?.text ?? '';
          await writeFile(file, String(content), 'utf8');
          this.send({ jsonrpc: '2.0', id: msg.id, result: null });
        } catch (e) {
          this.sendError(msg.id, -32602, errorMessage(e));
        }
        return;
      }
      default:
        if (String(msg.method ?? '').startsWith('_x.ai/')) {
          if (!this.unhandledClientRequests.has(msg.method)) {
            this.unhandledClientRequests.add(msg.method);
            console.error('[grok-web] unsupported x.ai client request:', msg.method);
          }
          this.sendError(msg.id, -32601, `unsupported client request: ${msg.method}`);
          this.broadcast({ kind: 'meta', method: msg.method, params: msg.params, sessionId, unsupported: true });
          return;
        }
        if (!this.unhandledClientRequests.has(msg.method)) {
          this.unhandledClientRequests.add(msg.method);
          console.error('[grok-web] unhandled client request:', msg.method);
        }
        this.send({ jsonrpc: '2.0', id: msg.id, result: {} });
        this.broadcast({ kind: 'meta', method: msg.method, params: msg.params, sessionId });
    }
  }

  async resolveClientPath(params = {}, { forWrite = false } = {}) {
    const raw = params.path ?? params.filePath ?? params.file_path;
    if (typeof raw !== 'string' || !raw) throw new Error('path required');
    const sessionId = params.sessionId;
    const root = resolve(this.cwdForSession(sessionId) ?? this.cwd ?? CWD);
    const requested = resolve(root, raw);
    const rootCmp = process.platform === 'win32' ? root.toLowerCase() : root;
    const requestedCmp = process.platform === 'win32' ? requested.toLowerCase() : requested;
    if (requestedCmp !== rootCmp && !requestedCmp.startsWith(rootCmp + sep)) {
      throw new Error('path outside session cwd');
    }
    const rootReal = await realpath(root);
    if (!forWrite) {
      const fileReal = await realpath(requested);
      if (!isWithinPath(rootReal, fileReal)) throw new Error('path outside session cwd');
      return fileReal;
    }
    try {
      const fileReal = await realpath(requested);
      if (!isWithinPath(rootReal, fileReal)) throw new Error('path outside session cwd');
      return fileReal;
    } catch (e) {
      if (e?.message === 'path outside session cwd') throw e;
      if (e?.code !== 'ENOENT') throw e;
    }
    const parentReal = await realpath(dirname(requested));
    if (!isWithinPath(rootReal, parentReal)) throw new Error('path outside session cwd');
    return join(parentReal, basename(requested));
  }

  rememberSessionCwd(sessionId, cwd) {
    if (sessionId && cwd) this.sessionCwds.set(sessionId, cwd);
  }

  cwdForSession(sessionId) {
    return sessionId ? this.sessionCwds.get(sessionId) : null;
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
    }, ELICITATION_TIMEOUT_MS);
    this.pendingElicitations.set(msg.id, { request: msg.params, timeout, responseKind: 'elicitation' });
    this.broadcast({ kind: 'elicitation_request', rpcId: msg.id, request: msg.params, sessionId });
  }

  parkUserQuestion(msg) {
    const sessionId = msg.params?.sessionId;
    const request = {
      mode: 'question',
      questions: Array.isArray(msg.params?.questions) ? msg.params.questions : [],
      sessionId,
      toolCallId: msg.params?.toolCallId,
    };
    const timeout = setTimeout(() => {
      if (this.pendingElicitations.has(msg.id)) {
        this.pendingElicitations.delete(msg.id);
        this.send({ jsonrpc: '2.0', id: msg.id, result: { outcome: '' } });
        this.broadcast({ kind: 'elicitation_resolved', rpcId: msg.id, action: 'timed out', sessionId });
      }
    }, ELICITATION_TIMEOUT_MS);
    this.pendingElicitations.set(msg.id, { request, timeout, responseKind: 'ask_user_question' });
    this.broadcast({ kind: 'elicitation_request', rpcId: msg.id, request, sessionId });
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

  prompt(text, sessionId = null, opts = {}) {
    const target = sessionId ?? this.sessionId;
    const turn = {
      turnId: `turn-${this.nextTurnId++}`,
      sessionId: target,
      text,
      internal: !!opts.internal,
      cancelled: false,
    };
    const queued = this.agentMutationActive || this.agentMutationBacklog > 0 || this.turnQueue.length > 0;
    if (!turn.internal) this.broadcast({ kind: 'user_prompt', text, sessionId: target, turnId: turn.turnId });
    if (queued && !turn.internal) {
      const position = this.turnQueue.filter(t => !t.cancelled && !t.internal).length + (this.activeTurn ? 1 : 0) + 1;
      this.broadcast({ kind: 'turn_queued', sessionId: target, turnId: turn.turnId, position });
    }
    this.turnQueue.push(turn);
    const promise = this.enqueueAgentMutation(() => this.runQueuedPrompt(turn));
    return { turnId: turn.turnId, queued, promise };
  }

  async runQueuedPrompt(turn) {
    const idx = this.turnQueue.indexOf(turn);
    if (idx >= 0) this.turnQueue.splice(idx, 1);
    if (turn.cancelled) return { cancelled: true };
    if (!this.ready) await this.readyPromise;
    const target = turn.sessionId ?? this.sessionId;
    this.activeTurn = turn;
    try {
      await this.ensureAgentSessionLoaded(target);
      const res = await this.call('session/prompt', {
        sessionId: target,
        prompt: [{ type: 'text', text: turn.text }],
      }, { timeoutMs: PROMPT_RPC_TIMEOUT_MS });
      if (!turn.internal) this.broadcast({ kind: 'turn_complete', result: res, sessionId: target, turnId: turn.turnId });
      return res;
    } catch (e) {
      if (e?.rpcTimeout && target) this.notify('session/cancel', { sessionId: target });
      throw e;
    } finally {
      if (this.activeTurn === turn) this.activeTurn = null;
    }
  }

  cancel(sessionId = null) {
    const target = sessionId ?? this.sessionId;
    let queuedCancelled = 0;
    for (const turn of [...this.turnQueue]) {
      if (turn.sessionId !== target) continue;
      turn.cancelled = true;
      const idx = this.turnQueue.indexOf(turn);
      if (idx >= 0) this.turnQueue.splice(idx, 1);
      queuedCancelled++;
      if (!turn.internal) {
        this.broadcast({ kind: 'turn_cancelled', sessionId: target, turnId: turn.turnId, queued: true });
      }
    }
    if (target) this.notify('session/cancel', { sessionId: target });
    return {
      activeCancelled: !!(this.activeTurn && this.activeTurn.sessionId === target),
      queuedCancelled,
    };
  }

  // Spawn an additional ACP session on the same agent connection — used by
  // tabs that want their own conversation thread.
  async createTabSession(cwd = null, baseSessionId = null) {
    return this.enqueueAgentMutation(async () => {
      if (!this.ready) await this.readyPromise;
      const targetCwd = cwd ?? this.cwdForSession(baseSessionId) ?? this.cwd ?? CWD;
      const res = await this.call('session/new', { cwd: targetCwd, mcpServers: [] });
      this.loadedAgentSessionId = res.sessionId;
      this.rememberSessionCwd(res.sessionId, targetCwd);
      // Broadcast a per-tab session_ready event tagged with the new sid so the
      // browser tab subscribed to that sid can flip its UI out of "loading".
      this.broadcast({ kind: 'session_ready', sessionId: res.sessionId, cwd: targetCwd });
      return { sessionId: res.sessionId, cwd: targetCwd };
    });
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
    this.broadcast({ kind: 'permission_resolved', rpcId, optionId, sessionId: pending.request?.sessionId });
    return true;
  }

  respondToElicitation(rpcId, action, content) {
    const pending = this.pendingElicitations.get(rpcId);
    if (!pending) return false;
    clearTimeout(pending.timeout);
    this.pendingElicitations.delete(rpcId);
    const result = pending.responseKind === 'ask_user_question'
      ? { outcome: action === 'accept' ? String(content ?? '') : '' }
      : content === undefined ? { action } : { action, content };
    this.send({ jsonrpc: '2.0', id: rpcId, result });
    this.broadcast({ kind: 'elicitation_resolved', rpcId, action, sessionId: pending.request?.sessionId });
    return true;
  }

  setAutoApprove(on, sessionId = null) {
    const next = !!on;
    if (sessionId) {
      this.sessionAutoApprovals.set(sessionId, next);
    } else {
      this.defaultAutoApprove = next;
      this.autoApprove = next;
      this.spawnOpts.alwaysApprove = next;
    }
    this.broadcast({ kind: 'auto_approve_changed', autoApprove: next, sessionId });
    // Also try to sync grok's own /always-approve state. The slash command is
    // sent as a normal prompt; the agent intercepts it before reaching the model.
    const target = sessionId ?? this.sessionId;
    if (this.ready && target) {
      this.prompt(`/always-approve ${next ? 'on' : 'off'}`, target, { internal: true })
        .promise.catch(() => { /* slash command may not be supported in headless, best effort */ });
    }
  }

  autoApproveFor(sessionId = null) {
    if (sessionId && this.sessionAutoApprovals.has(sessionId)) {
      return this.sessionAutoApprovals.get(sessionId);
    }
    return this.defaultAutoApprove;
  }

  async ensureAgentSessionLoaded(sessionId) {
    if (!sessionId || this.loadedAgentSessionId === sessionId) return;
    const targetCwd = this.cwdForSession(sessionId) ?? this.cwd ?? CWD;
    if (this.loadedAgentSessionId) this.notify('session/cancel', { sessionId: this.loadedAgentSessionId });
    this.notify('session/cancel', { sessionId });
    await this.call('session/load', { sessionId, cwd: targetCwd, mcpServers: [] });
    this.loadedAgentSessionId = sessionId;
    this.rememberSessionCwd(sessionId, targetCwd);
  }

  normalizedSessionUpdate(update, sessionId, agentSessionId) {
    if (!update || !sessionId) return update;
    const normalized = { ...update };
    let changed = false;
    if (agentSessionId && sessionId !== agentSessionId && normalized.sessionId && normalized.sessionId !== sessionId) {
      normalized.sessionId = sessionId;
      changed = true;
    }
    const rawOutput = normalized.rawOutput;
    if (rawOutput && typeof rawOutput === 'object' && typeof rawOutput.output_file === 'string') {
      const staleOutputPath = [...this.sessionCwds.keys()]
        .some(knownSessionId => knownSessionId !== sessionId && rawOutput.output_file.includes(knownSessionId));
      if (staleOutputPath || (agentSessionId && sessionId !== agentSessionId && rawOutput.output_file.includes(agentSessionId))) {
        normalized.rawOutput = { ...rawOutput };
        delete normalized.rawOutput.output_file;
        changed = true;
      }
    }
    return changed ? normalized : update;
  }

  // Subscribers receive live events only. /stream handles bounded replay with
  // response backpressure so reconnects cannot block broadcast().
  subscribe(fn, sessionIdFilter = null) {
    const sub = { fn, sessionIdFilter };
    this.listeners.add(sub);
    return () => this.listeners.delete(sub);
  }

  broadcast(event) {
    const entry = { seq: ++this.historySeq, event };
    this.history.push(entry);
    if (event.sessionId) {
      const entries = this.sessionHistory.get(event.sessionId) ?? [];
      entries.push(entry);
      this.sessionHistory.set(event.sessionId, entries);
    } else {
      this.globalHistory.push(entry);
    }
    if (this.history.length > HISTORY_LIMIT) this.pruneHistoryEntry(this.history.shift());
    for (const sub of this.listeners) {
      if (sub.sessionIdFilter && event.sessionId && event.sessionId !== sub.sessionIdFilter) continue;
      try { sub.fn(event); } catch (e) { console.error('listener error', e); }
    }
  }

  clearSessionHistory(...sessionIds) {
    const ids = new Set(sessionIds.filter(Boolean));
    if (!ids.size) return;
    this.history = this.history.filter((entry) => !entry.event.sessionId || !ids.has(entry.event.sessionId));
    for (const id of ids) this.sessionHistory.delete(id);
  }

  clearAllHistory() {
    this.history.length = 0;
    this.globalHistory.length = 0;
    this.sessionHistory.clear();
  }

  replayEntries(sessionIdFilter) {
    if (!sessionIdFilter) return this.history;
    const sessionEntries = this.sessionHistory.get(sessionIdFilter) ?? [];
    return mergeHistoryEntries(this.globalHistory, sessionEntries);
  }

  pruneHistoryEntry(entry) {
    if (!entry) return;
    const sessionId = entry.event.sessionId;
    const entries = sessionId ? this.sessionHistory.get(sessionId) : this.globalHistory;
    if (!entries) return;
    if (entries[0] === entry) entries.shift();
    else {
      const index = entries.indexOf(entry);
      if (index >= 0) entries.splice(index, 1);
    }
    if (sessionId && entries.length === 0) this.sessionHistory.delete(sessionId);
  }

  rejectPending(error) {
    for (const [id, resolver] of [...this.pending]) {
      if (resolver.timeout) clearTimeout(resolver.timeout);
      resolver.reject(error);
      this.pending.delete(id);
    }
  }

  clearParkedClientRequestTimers() {
    for (const entry of this.pendingPermissions.values()) {
      if (entry.timeout) clearTimeout(entry.timeout);
    }
    for (const entry of this.pendingElicitations.values()) {
      if (entry.timeout) clearTimeout(entry.timeout);
    }
  }
}

function rpcErrorMessage(error) {
  return errorMessage(error || 'unknown RPC error');
}

function errorMessage(error) {
  if (error == null) return 'unknown error';
  if (typeof error === 'string') return error;
  if (typeof error.message === 'string') return error.message;
  try {
    const json = JSON.stringify(error);
    return json === undefined ? String(error) : json;
  } catch {
    return String(error);
  }
}

function chooseAutoPermissionOption(options = []) {
  const opts = Array.isArray(options) ? options : [];
  const label = (opt) => `${opt?.optionId ?? ''} ${opt?.name ?? ''}`.toLowerCase();
  const positive = opts.find((opt) => /\b(allow|accept|approve|yes)\b/.test(label(opt)));
  if (positive?.optionId) return positive.optionId;
  const nonDeny = opts.find((opt) => !/\b(deny|reject|decline|cancel)\b/.test(label(opt)));
  return nonDeny?.optionId ?? opts.find((opt) => opt?.optionId)?.optionId ?? null;
}

function isWithinPath(root, file) {
  const rootPath = resolve(root);
  const filePath = resolve(file);
  const rootCmp = process.platform === 'win32' ? rootPath.toLowerCase() : rootPath;
  const fileCmp = process.platform === 'win32' ? filePath.toLowerCase() : filePath;
  return fileCmp === rootCmp || fileCmp.startsWith(rootCmp + sep);
}

function positiveIntegerOption(value, name) {
  if (value == null || value === '') return null;
  const ok = (typeof value === 'number' && Number.isInteger(value))
    || (typeof value === 'string' && /^\d+$/.test(value.trim()));
  if (!ok) throw new Error(`${name} must be a positive integer`);
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(`${name} must be a positive integer`);
  return n;
}

function mergeHistoryEntries(a, b) {
  const merged = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (j >= b.length || (i < a.length && a[i].seq <= b[j].seq)) merged.push(a[i++]);
    else merged.push(b[j++]);
  }
  return merged;
}

function buildGrokEnv({ ignoreApiKey = false } = {}) {
  const env = { ...process.env };
  if (process.platform === 'win32' && !String(env.HOME ?? '').trim()) {
    env.HOME = env.USERPROFILE || homedir();
  }
  if (process.platform === 'win32' && !String(env.GROK_HOME ?? '').trim() && String(env.HOME ?? '').trim()) {
    env.GROK_HOME = join(env.HOME, '.grok');
  }
  if (ignoreApiKey) {
    delete env.XAI_API_KEY;
    delete env.GROK_API_KEY;
  }
  return env;
}

// ─── CLI shell-out helper ───────────────────────────────────────────────────
// Run a one-shot grok CLI command without blocking the bridge event loop.
function runGrokCli(args, { timeout = CLI_TIMEOUT_DEFAULT_MS, cwd } = {}) {
  return new Promise((resolve) => {
    const child = spawn(GROK_BIN, [...GROK_BIN_ARGS, ...args], {
      cwd: cwd ?? grok?.cwd ?? CWD,
      env: buildGrokEnv(),
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
      resolve({ code: -1, stdout, stderr: stderr || errorMessage(e), timedOut });
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
const SESSIONS_ROOT = process.env.GROK_WEB_SESSIONS_ROOT
  ? resolve(process.env.GROK_WEB_SESSIONS_ROOT)
  : join(homedir(), '.grok', 'sessions');
const sessionsListCache = new Map();

async function listSessions({ limit = 50 } = {}) {
  const cacheKey = String(limit);
  const cached = sessionsListCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cloneSessionList(cached.sessions);

  let cwdDirs;
  try { cwdDirs = await readdir(SESSIONS_ROOT, { withFileTypes: true }); }
  catch {
    sessionsListCache.set(cacheKey, { expiresAt: Date.now() + SESSIONS_CACHE_TTL_MS, sessions: [] });
    return [];
  }
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
        // 0.1.217 writes agent_name to summary.json, but /session-info did not
        // expose it in the observed session/update stream.
        agentName: data.agent_name ?? data.agentName ?? data.info?.agent_name,
        lastActive: data.last_active_at ?? data.updated_at,
        numMessages: data.num_chat_messages ?? 0,
      });
    } catch { /* malformed — skip */ }
  }
  sessionsListCache.set(cacheKey, { expiresAt: Date.now() + SESSIONS_CACHE_TTL_MS, sessions: results });
  return cloneSessionList(results);
}

function cloneSessionList(sessions) {
  return sessions.map((session) => ({ ...session }));
}

function invalidateSessionsCache() {
  sessionsListCache.clear();
}

async function readSessionPlan(sessionId, cwd = null) {
  if (typeof sessionId !== 'string' || !sessionId.trim()) throw mediaPathError(400, 'sessionId required');
  if (hasPathTraversal(sessionId) || /[\\/]/.test(sessionId)) throw mediaPathError(403, 'invalid sessionId');
  const sessionDir = await findSessionDir(sessionId, cwd);
  if (!sessionDir) return { sessionId, todos: [] };
  const planPath = join(sessionDir, 'plan.json');
  let planReal;
  try {
    planReal = await realpath(planPath);
  } catch (e) {
    if (e?.code === 'ENOENT') return { sessionId, todos: [] };
    throw e;
  }
  if (!isWithinPath(sessionDir, planReal)) throw mediaPathError(403, 'plan path outside session');
  let data;
  try {
    data = JSON.parse(await readFile(planReal, 'utf8'));
  } catch {
    return { sessionId, todos: [] };
  }
  return { sessionId, todos: normalizePlanTodos(data) };
}

async function findSessionDir(sessionId, cwd = null) {
  let rootReal;
  try { rootReal = await realpath(SESSIONS_ROOT); } catch { return null; }
  let cwdDirs;
  try { cwdDirs = await readdir(rootReal, { withFileTypes: true }); } catch { return null; }
  const wantedCwd = typeof cwd === 'string' && cwd.trim() ? cwd : null;
  for (const cwdDir of cwdDirs) {
    if (!cwdDir.isDirectory()) continue;
    const cwdPath = join(rootReal, cwdDir.name);
    let sessionDirs;
    try { sessionDirs = await readdir(cwdPath, { withFileTypes: true }); } catch { continue; }
    for (const sd of sessionDirs) {
      if (!sd.isDirectory() || sd.name !== sessionId) continue;
      const candidate = join(cwdPath, sd.name);
      const candidateReal = await realpath(candidate);
      if (!isWithinPath(rootReal, candidateReal)) throw mediaPathError(403, 'session path outside sessions root');
      if (wantedCwd && !(await sessionCwdMatches(candidateReal, wantedCwd))) continue;
      return candidateReal;
    }
  }
  return null;
}

async function sessionCwdMatches(sessionDir, cwd) {
  try {
    const summary = JSON.parse(await readFile(join(sessionDir, 'summary.json'), 'utf8'));
    const stored = summary.info?.cwd ?? summary.cwd;
    return !stored || stored === cwd;
  } catch {
    return true;
  }
}

function normalizePlanTodos(plan) {
  const source = Array.isArray(plan)
    ? plan
    : Array.isArray(plan?.todos)
      ? plan.todos
      : Array.isArray(plan?.tasks)
        ? plan.tasks
        : Array.isArray(plan?.items)
          ? plan.items
          : [];
  return source.slice(0, 500).map((todo, index) => normalizePlanTodo(todo, index)).filter(Boolean);
}

function normalizePlanTodo(todo, index) {
  if (typeof todo === 'string') {
    const text = todo.trim();
    return text ? { id: String(index + 1), text, status: 'pending' } : null;
  }
  if (!todo || typeof todo !== 'object') return null;
  const text = String(todo.text ?? todo.content ?? todo.task ?? todo.title ?? todo.description ?? '').trim();
  if (!text) return null;
  return {
    id: todo.id == null ? String(index + 1) : String(todo.id),
    text,
    status: String(todo.status ?? todo.state ?? 'pending'),
  };
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
const SESSION_MEDIA_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogg': 'video/ogg',
};

const SECURITY_HEADERS = {
  'content-security-policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "media-src 'self' data: blob: https:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; '),
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function parseCookies(header = '') {
  const cookies = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function auth(req) {
  return parseCookies(req.headers.cookie)[SESSION_COOKIE] === SESSION_TOKEN;
}

function setSecurityHeaders(res) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
}

function mediaPathError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function hasPathTraversal(value) {
  return String(value ?? '').replace(/\\/g, '/').split('/').some(part => part === '..');
}

function resolveSessionMediaCandidate(rawPath) {
  const raw = String(rawPath ?? '').trim();
  if (!raw) throw mediaPathError(400, 'path required');
  const ext = extname(raw).toLowerCase();
  if (!SESSION_MEDIA_MIME[ext]) throw mediaPathError(415, 'unsupported media type');

  const normalized = raw.replace(/\\/g, '/');
  const lower = normalized.toLowerCase();
  const prefixes = ['~/.grok/sessions/', '.grok/sessions/'];
  for (const prefix of prefixes) {
    if (lower.startsWith(prefix)) {
      const rel = normalized.slice(prefix.length);
      if (!rel || hasPathTraversal(rel)) throw mediaPathError(403, 'path outside sessions root');
      return resolve(SESSIONS_ROOT, rel);
    }
  }

  const embedded = '/.grok/sessions/';
  const idx = lower.indexOf(embedded);
  if (idx >= 0) {
    const rel = normalized.slice(idx + embedded.length);
    if (!rel || hasPathTraversal(rel)) throw mediaPathError(403, 'path outside sessions root');
    return resolve(SESSIONS_ROOT, rel);
  }

  if (hasPathTraversal(normalized)) throw mediaPathError(403, 'path outside sessions root');
  return resolve(SESSIONS_ROOT, raw);
}

async function resolveSessionMediaFile(rawPath) {
  const candidate = resolveSessionMediaCandidate(rawPath);
  if (!isWithinPath(SESSIONS_ROOT, candidate)) throw mediaPathError(403, 'path outside sessions root');

  let rootReal;
  try {
    rootReal = await realpath(SESSIONS_ROOT);
  } catch {
    throw mediaPathError(404, 'sessions root not found');
  }

  let fileReal;
  try {
    fileReal = await realpath(candidate);
  } catch (e) {
    if (e?.code === 'ENOENT' || e?.code === 'ENOTDIR') throw mediaPathError(404, 'media not found');
    throw e;
  }
  if (!isWithinPath(rootReal, fileReal)) throw mediaPathError(403, 'path outside sessions root');

  const st = await stat(fileReal);
  if (!st.isFile()) throw mediaPathError(403, 'not a file');

  const ext = extname(candidate).toLowerCase();
  const contentType = SESSION_MEDIA_MIME[ext];
  if (!contentType) throw mediaPathError(415, 'unsupported media type');
  return { file: fileReal, contentType };
}

function parseHostHeader(host) {
  if (!host) return null;
  try {
    const parsed = new URL(`http://${String(host).trim()}`);
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return { hostname, port: parsed.port };
  } catch {
    return null;
  }
}

function isAllowedHost(req) {
  const host = parseHostHeader(req.headers.host);
  if (!host) return false;
  if (!['127.0.0.1', 'localhost', '::1'].includes(host.hostname)) return false;
  const activePort = server.address()?.port;
  if (activePort && host.port && host.port !== String(activePort)) return false;
  return true;
}

function isAllowedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!['127.0.0.1', 'localhost', '::1'].includes(hostname)) return false;
  const activePort = server.address()?.port;
  if (activePort && parsed.port !== String(activePort)) return false;
  return true;
}

function bootstrap(req, res, url) {
  if (bootstrapUsed || url.searchParams.get('token') !== BOOTSTRAP_TOKEN) return false;
  bootstrapUsed = true;
  redirectWithoutToken(res, url, {
    'set-cookie': `${SESSION_COOKIE}=${encodeURIComponent(SESSION_TOKEN)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_COOKIE_MAX_AGE_SECONDS}`,
  });
  return true;
}

function redirectWithoutToken(res, url, headers = {}) {
  url.searchParams.delete('token');
  const location = url.pathname + url.search;
  res.writeHead(302, {
    ...headers,
    location,
    'cache-control': 'no-store',
  });
  res.end();
}

async function readBody(req) {
  const chunks = [];
  let total = 0;
  for await (const c of req) {
    total += c.length;
    if (MAX_REQUEST_BODY_BYTES > 0 && total > MAX_REQUEST_BODY_BYTES) {
      const error = new Error(`request body exceeds ${MAX_REQUEST_BODY_BYTES} byte limit`);
      error.code = 'ERR_REQUEST_BODY_TOO_LARGE';
      throw error;
    }
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function sendJsonError(res, status, error) {
  sendJson(res, status, { error: errorMessage(error) });
}

function requireApiAuth(req, res) {
  if (auth(req)) return true;
  sendJsonError(res, 401, 'missing or bad session');
  return false;
}

function isRequestBodyTooLarge(error) {
  return error?.code === 'ERR_REQUEST_BODY_TOO_LARGE';
}

function sseEvent(event) {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function writeWithBackpressure(res, chunk) {
  return new Promise((resolve, reject) => {
    let settled = false;
    function cleanup() {
      res.off('drain', onDrain);
      res.off('error', onError);
      res.off('close', onClose);
    }
    function done(fn, value) {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    }
    function onDrain() { done(resolve); }
    function onError(error) { done(reject, error); }
    function onClose() { done(reject, new Error('SSE response closed')); }
    try {
      if (res.write(chunk)) {
        resolve();
        return;
      }
      res.once('drain', onDrain);
      res.once('error', onError);
      res.once('close', onClose);
    } catch (e) {
      cleanup();
      reject(e);
    }
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  setSecurityHeaders(res);
  if (!isAllowedHost(req)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }).end('bad host');
    return;
  }
  if (MUTATING_METHODS.has(req.method) && !isAllowedOrigin(req)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }).end('bad origin');
    return;
  }
  // HTML entrypoint is cookie-gated after the one-time launch URL bootstrap.
  if (req.method === 'GET' && url.pathname === '/') {
    if (auth(req) && url.searchParams.has('token')) {
      redirectWithoutToken(res, url);
      return;
    }
    if (!auth(req)) {
      if (bootstrap(req, res, url)) return;
      res.writeHead(401, { 'cache-control': 'no-store' }).end('missing or bad session');
      return;
    }
    try {
      const html = await readFile(join(PUBLIC_DIR, 'index.html'), 'utf8');
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(html);
    } catch (e) { res.writeHead(500).end(errorMessage(e)); }
    return;
  }
  if (req.method === 'GET' && url.pathname.startsWith('/static/')) {
    // Static assets (CSS/JS) are public — they contain no secrets. The actual
    // API endpoints stay token-gated below.
    let relPath;
    try {
      relPath = decodeURIComponent(url.pathname.slice('/static/'.length));
    } catch {
      res.writeHead(400).end('bad static path');
      return;
    }
    const file = resolve(PUBLIC_DIR, relPath);
    if (!isWithinPath(PUBLIC_DIR, file)) { res.writeHead(403).end(); return; }
    try {
      const data = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
      res.end(data);
    } catch { res.writeHead(404).end(); }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/session-media') {
    if (!auth(req)) { res.writeHead(401).end(); return; }
    try {
      const media = await resolveSessionMediaFile(url.searchParams.get('path'));
      res.writeHead(200, {
        'content-type': media.contentType,
        'cache-control': 'no-store',
      });
      const stream = createReadStream(media.file);
      stream.on('error', () => {
        if (!res.headersSent) res.writeHead(404);
        res.end();
      });
      stream.pipe(res);
    } catch (e) {
      const status = e?.status ?? 500;
      res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      res.end(status === 500 ? errorMessage(e) : e.message);
    }
    return;
  }

  // SSE stream of agent events — accepts ?sessionId= to filter to one tab.
  if (req.method === 'GET' && url.pathname === '/stream') {
    if (!auth(req)) { res.writeHead(401).end(); return; }
    const filter = url.searchParams.get('sessionId') || null;
    let closed = false;
    let replaying = true;
    let replayDone = false;
    let ping = null;
    let unsubscribe = () => {};
    let writeQueue = Promise.resolve();
    const liveBacklog = [];
    const cleanup = () => {
      if (closed) return;
      closed = true;
      unsubscribe();
      if (ping) clearInterval(ping);
    };
    const enqueueWrite = (chunk, label = 'SSE write') => {
      const next = writeQueue.then(() => {
        if (closed) return undefined;
        return writeWithBackpressure(res, chunk);
      });
      writeQueue = next.catch((e) => {
        if (!closed) console.error(`${label} failed:`, errorMessage(e));
        cleanup();
      });
      return next;
    };
    req.on('close', cleanup);
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      'connection': 'keep-alive',
      'x-accel-buffering': 'no',
    });
    unsubscribe = grok.subscribe((event) => {
      if (closed) return;
      if (replaying) {
        liveBacklog.push(event);
        return;
      }
      enqueueWrite(sseEvent(event), 'SSE live write');
    }, filter);
    try {
      await writeWithBackpressure(res, 'retry: 1000\n\n');
      for (const entry of grok.replayEntries(filter)) {
        if (closed) break;
        await writeWithBackpressure(res, sseEvent(entry.event));
      }
      replaying = false;
      replayDone = true;
      while (liveBacklog.length && !closed) {
        await writeWithBackpressure(res, sseEvent(liveBacklog.shift()));
      }
      if (!closed) {
        ping = setInterval(() => {
          enqueueWrite(': ping\n\n', 'SSE ping write');
        }, 15000);
      }
    } catch (e) {
      if (!closed) console.error('SSE replay failed:', errorMessage(e));
      cleanup();
      if (!replayDone) {
        try { res.end(); } catch {}
      }
    }
    return;
  }

  // Send a prompt — body.sessionId optional, falls back to default.
  if (req.method === 'POST' && url.pathname === '/prompt') {
    if (!requireApiAuth(req, res)) return;
    try {
      const body = JSON.parse(await readBody(req));
      if (typeof body.text !== 'string' || !body.text.trim()) {
        sendJsonError(res, 400, 'empty prompt'); return;
      }
      const target = body.sessionId ?? grok.sessionId;
      const turn = grok.prompt(body.text, target);
      turn.promise.catch((e) =>
        grok.broadcast({ kind: 'error', error: errorMessage(e), sessionId: target })
      );
      sendJson(res, 202, { ok: true, turnId: turn.turnId, queued: turn.queued });
    } catch (e) { sendJsonError(res, 400, e); }
    return;
  }

  // Cancel a turn — body.sessionId optional.
  if (req.method === 'POST' && url.pathname === '/cancel') {
    if (!requireApiAuth(req, res)) return;
    let sessionId = null;
    if (req.headers['content-length'] && req.headers['content-length'] !== '0') {
      try { sessionId = JSON.parse(await readBody(req)).sessionId; }
      catch (e) {
        if (isRequestBodyTooLarge(e)) { sendJsonError(res, 400, e); return; }
      }
    }
    const cancelResult = grok.cancel(sessionId);
    sendJson(res, 202, { ok: true, sessionId: sessionId ?? grok.sessionId, ...cancelResult });
    return;
  }

  // Load an existing ACP session for a tab — does NOT change the global default.
  if (req.method === 'POST' && url.pathname === '/tab/load') {
    if (!requireApiAuth(req, res)) return;
    try {
      const body = JSON.parse(await readBody(req));
      if (!body.sessionId) { sendJsonError(res, 400, 'sessionId required'); return; }
      const tab = await grok.loadTabSession(body.sessionId, body.cwd);
      sendJson(res, 200, tab);
    } catch (e) {
      if (isRequestBodyTooLarge(e)) { sendJsonError(res, 400, e); return; }
      sendJsonError(res, 500, e);
    }
    return;
  }

  // Create a new ACP session for a tab — does NOT change the global "default".
  if (req.method === 'POST' && url.pathname === '/tab/new') {
    if (!requireApiAuth(req, res)) return;
    try {
      let cwd = null;
      let sessionId = null;
      if (req.headers['content-length'] && req.headers['content-length'] !== '0') {
        try {
          const body = JSON.parse(await readBody(req));
          cwd = body.cwd;
          sessionId = body.sessionId;
        }
        catch (e) {
          if (isRequestBodyTooLarge(e)) { sendJsonError(res, 400, e); return; }
        }
      }
      const tab = await grok.createTabSession(cwd, sessionId);
      sendJson(res, 200, tab);
    } catch (e) {
      if (isRequestBodyTooLarge(e)) { sendJsonError(res, 400, e); return; }
      sendJsonError(res, 500, e);
    }
    return;
  }

  // Respond to a pending permission request
  if (req.method === 'POST' && url.pathname === '/permission') {
    if (!requireApiAuth(req, res)) return;
    try {
      const body = JSON.parse(await readBody(req));
      if (typeof body.rpcId !== 'number' || !body.optionId) {
        sendJsonError(res, 400, 'rpcId + optionId required'); return;
      }
      const ok = grok.respondToPermission(body.rpcId, body.optionId);
      sendJson(res, ok ? 200 : 410, { ok });
    } catch (e) { sendJsonError(res, 400, e); }
    return;
  }

  // Respond to a pending elicitation request
  if (req.method === 'POST' && url.pathname === '/elicitation') {
    if (!requireApiAuth(req, res)) return;
    try {
      const body = JSON.parse(await readBody(req));
      if (typeof body.rpcId !== 'number' || !body.action) {
        sendJsonError(res, 400, 'rpcId + action required'); return;
      }
      const ok = grok.respondToElicitation(body.rpcId, body.action, body.content);
      if (!ok) {
        sendJsonError(res, 404, 'elicitation request not found'); return;
      }
      sendJson(res, 200, { ok });
    } catch (e) { sendJsonError(res, 400, e); }
    return;
  }

  // Read/write bridge settings.
  if (url.pathname === '/settings') {
    if (!requireApiAuth(req, res)) return;
    if (req.method === 'GET') {
      const sessionId = url.searchParams.get('sessionId') || null;
      sendJson(res, 200, { autoApprove: grok.autoApproveFor(sessionId), ...bridgeSettings });
      return;
    }
    if (req.method === 'POST') {
      try {
        const body = JSON.parse(await readBody(req));
        const sessionId = body.sessionId ?? null;
        if (typeof body.autoApprove === 'boolean') grok.setAutoApprove(body.autoApprove, sessionId);
        if (typeof body.displayName === 'string') {
          const displayName = body.displayName.trim();
          bridgeSettings.displayName = displayName || defaultUsername();
        }
        sendJson(res, 200, { autoApprove: grok.autoApproveFor(sessionId), ...bridgeSettings });
      } catch (e) { sendJsonError(res, 400, e); }
      return;
    }
  }

  // List recent sessions
  if (req.method === 'GET' && url.pathname === '/sessions') {
    if (!requireApiAuth(req, res)) return;
    try {
      const sessions = await listSessions();
      const current = url.searchParams.get('sessionId') || grok.sessionId;
      sendJson(res, 200, { sessions, current });
    } catch (e) {
      if (isRequestBodyTooLarge(e)) { sendJsonError(res, 400, e); return; }
      sendJsonError(res, 500, e);
    }
    return;
  }

  // Read persisted task state for a session. This is confined to
  // ~/.grok/sessions/*/<session-id>/plan.json and never serves project files.
  if (req.method === 'GET' && url.pathname === '/session/plan') {
    if (!requireApiAuth(req, res)) return;
    try {
      const sessionId = url.searchParams.get('sessionId');
      const cwd = url.searchParams.get('cwd');
      sendJson(res, 200, await readSessionPlan(sessionId, cwd));
    } catch (e) {
      sendJsonError(res, e?.status ?? 500, e);
    }
    return;
  }

  // Start a brand-new session (optionally in a different cwd)
  if (req.method === 'POST' && url.pathname === '/session/new') {
    if (!requireApiAuth(req, res)) return;
    try {
      const body = req.headers['content-length'] && req.headers['content-length'] !== '0'
        ? JSON.parse(await readBody(req)) : {};
      await grok.newSession(body.cwd);
      sendJson(res, 200, { sessionId: grok.sessionId, cwd: grok.cwd });
    } catch (e) {
      if (isRequestBodyTooLarge(e)) { sendJsonError(res, 400, e); return; }
      sendJsonError(res, 500, e);
    }
    return;
  }

  // Resume a stored session
  if (req.method === 'POST' && url.pathname === '/session/load') {
    if (!requireApiAuth(req, res)) return;
    try {
      const body = JSON.parse(await readBody(req));
      if (!body.sessionId) { sendJsonError(res, 400, 'sessionId required'); return; }
      await grok.loadSession(body.sessionId, body.cwd, { restoreCode: !!body.restoreCode });
      sendJson(res, 200, { sessionId: grok.sessionId, cwd: grok.cwd });
    } catch (e) {
      if (isRequestBodyTooLarge(e)) { sendJsonError(res, 400, e); return; }
      sendJsonError(res, 500, e);
    }
    return;
  }

  // Respawn the agent with new launch flags (effort, sandbox, allow rules, etc.)
  if (req.method === 'POST' && url.pathname === '/session/respawn') {
    if (!requireApiAuth(req, res)) return;
    try {
      const body = req.headers['content-length'] && req.headers['content-length'] !== '0'
        ? JSON.parse(await readBody(req)) : {};
      await grok.respawn(body);
      sendJson(res, 200, { sessionId: grok.sessionId, spawnOpts: grok.spawnOpts });
    } catch (e) {
      if (isRequestBodyTooLarge(e)) { sendJsonError(res, 400, e); return; }
      sendJsonError(res, 500, e);
    }
    return;
  }

  // Read current spawn options plus a few diagnostic flags from the env.
  if (req.method === 'GET' && url.pathname === '/spawn-opts') {
    if (!requireApiAuth(req, res)) return;
    sendJson(res, 200, {
      ...grok.spawnOpts,
      _capabilities: agentCapabilities(),
      _env: {
        XAI_API_KEY_set: !!process.env.XAI_API_KEY,
      },
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/identity') {
    if (!requireApiAuth(req, res)) return;
    const username = defaultUsername();
    sendJson(res, 200, {
      username,
      displayName: bridgeSettings.displayName || username,
    });
    return;
  }

  // CLI shell-out endpoints — wrap one-shot grok subcommands.
  if (req.method === 'GET' && url.pathname === '/cli/inspect') {
    if (!requireApiAuth(req, res)) return;
    const r = await runGrokCli(['inspect', '--json'], { timeout: CLI_TIMEOUT_SHORT_MS });
    res.writeHead(r.code === 0 ? 200 : 500, { 'content-type': 'application/json' });
    res.end(r.stdout || JSON.stringify({ error: r.stderr || `exit ${r.code}` }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/cli/update-check') {
    if (!requireApiAuth(req, res)) return;
    const r = await runGrokCli(['update', '--check', '--json'], { timeout: CLI_TIMEOUT_UPDATE_CHECK_MS });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(r.stdout || JSON.stringify({ error: r.stderr || `exit ${r.code}` }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/cli/models') {
    if (!requireApiAuth(req, res)) return;
    const r = await runGrokCli(['models'], { timeout: CLI_TIMEOUT_SHORT_MS });
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(r.stdout || r.stderr);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/cli/share') {
    if (!requireApiAuth(req, res)) return;
    let sid = grok.sessionId;
    try {
      const body = req.headers['content-length'] && req.headers['content-length'] !== '0'
        ? JSON.parse(await readBody(req)) : {};
      if (body.sessionId) sid = body.sessionId;
    } catch (e) {
      if (isRequestBodyTooLarge(e)) { sendJsonError(res, 400, e); return; }
    }
    if (!sid) { sendJsonError(res, 400, 'no active session'); return; }
    const r = await runGrokCli(['share', sid], { timeout: CLI_TIMEOUT_DEFAULT_MS });
    const urlMatch = r.stdout.match(/https?:\/\/\S+/);
    res.writeHead(r.code === 0 ? 200 : 500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      ok: r.code === 0, url: urlMatch?.[0] ?? null,
      output: r.stdout, error: r.stderr || (r.code !== 0 ? `exit ${r.code}` : null),
    }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/cli/trace') {
    if (!requireApiAuth(req, res)) return;
    let sid = grok.sessionId;
    try {
      const body = req.headers['content-length'] && req.headers['content-length'] !== '0'
        ? JSON.parse(await readBody(req)) : {};
      if (body.sessionId) sid = body.sessionId;
    } catch (e) {
      if (isRequestBodyTooLarge(e)) { sendJsonError(res, 400, e); return; }
    }
    if (!sid) { sendJsonError(res, 400, 'sessionId required'); return; }
    const r = await runGrokCli(['trace', sid, '--local', '--json'], { timeout: CLI_TIMEOUT_TRACE_MS });
    res.writeHead(r.code === 0 ? 200 : 500, { 'content-type': 'application/json' });
    res.end(r.stdout || JSON.stringify({ error: r.stderr || `exit ${r.code}` }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/cli/mcp') {
    if (!requireApiAuth(req, res)) return;
    const r = await runGrokCli(['mcp', 'list'], { timeout: CLI_TIMEOUT_SHORT_MS });
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(r.stdout || r.stderr);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/cli/worktree') {
    if (!requireApiAuth(req, res)) return;
    const r = await runGrokCli(['worktree', 'list'], { timeout: CLI_TIMEOUT_SHORT_MS });
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(r.stdout || r.stderr);
    return;
  }

  // Login (device-auth flow) — surfaces the device URL/code to the UI.
  if (req.method === 'POST' && url.pathname === '/cli/login') {
    if (!requireApiAuth(req, res)) return;
    const r = await runGrokCli(['login', '--device-auth'], { timeout: CLI_TIMEOUT_DEFAULT_MS });
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(r.stdout || r.stderr);
    return;
  }

  // One-shot headless prompt — for --check and --best-of-n which the
  // interactive `agent stdio` connection doesn't support.
  if (req.method === 'POST' && url.pathname === '/cli/oneshot') {
    if (!requireApiAuth(req, res)) return;
    try {
      const body = JSON.parse(await readBody(req));
      const args = [];
      const bestOfN = positiveIntegerOption(body.bestOfN, 'bestOfN');
      const maxTurns = positiveIntegerOption(body.maxTurns, 'maxTurns');
      if (body.effort) args.push('--effort', String(body.effort));
      if (bestOfN) args.push('--best-of-n', String(bestOfN));
      if (body.check) args.push('--check');
      if (maxTurns) args.push('--max-turns', String(maxTurns));
      args.push('--always-approve', '--output-format', 'json', '-p', body.text ?? '');
      const r = await runGrokCli(args, { timeout: CLI_TIMEOUT_ONESHOT_MS, cwd: body.cwd });
      res.writeHead(r.code === 0 ? 200 : 500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: r.code === 0, stdout: r.stdout, stderr: r.stderr }));
    } catch (e) {
      sendJsonError(res, 400, e);
    }
    return;
  }

  // Import session(s) — POST a list of session IDs OR a .jsonl file path.
  if (req.method === 'POST' && url.pathname === '/cli/import') {
    if (!requireApiAuth(req, res)) return;
    try {
      const body = JSON.parse(await readBody(req));
      const args = ['import', '--json'];
      // Use `--` so user-supplied targets can never be interpreted as flags
      // even if they happen to start with a hyphen.
      if (Array.isArray(body.targets) && body.targets.length) {
        args.push('--', ...body.targets);
      }
      const r = await runGrokCli(args, { timeout: CLI_TIMEOUT_IMPORT_MS });
      res.writeHead(r.code === 0 ? 200 : 500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: r.code === 0, output: r.stdout, error: r.stderr }));
    } catch (e) { sendJsonError(res, 400, e); }
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
    sessionsChangeDebounce = setTimeout(() => {
      invalidateSessionsCache();
      grok.broadcast({ kind: 'sessions_changed' });
    }, 1500);
  });
} catch (e) {
  // Recursive watch may not be supported on some platforms; non-fatal.
  console.error('[grok-web] sessions watcher unavailable:', errorMessage(e));
}

(async () => {
  grok.start();
  server.listen(PORT, '127.0.0.1', async () => {
    const port = server.address().port;
    const url = `http://127.0.0.1:${port}/?token=${BOOTSTRAP_TOKEN}`;
    console.log(`\n  grok-web running\n  ${url}\n  one-time local URL: do not share it\n  cwd: ${CWD}\n`);
    if (!process.env.GROK_WEB_NO_OPEN) await openBrowser(url);
  });
})();

process.on('SIGINT', () => { grok.child?.kill(); process.exit(0); });
process.on('SIGTERM', () => { grok.child?.kill(); process.exit(0); });
