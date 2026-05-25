import { spawn } from 'node:child_process';
import { readFile, writeFile, realpath } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { buildAskUserQuestionResult, chooseAutoPermissionOption } from './acp-helpers.mjs';
import {
  CWD,
  CHILD_KILL_GRACE_MS,
  DEFAULT_RPC_TIMEOUT_MS,
  ELICITATION_TIMEOUT_MS,
  GROK_BIN,
  GROK_BIN_ARGS,
  PERMISSION_REQUEST_TIMEOUT_MS,
  PROMPT_RPC_TIMEOUT_MS,
} from './config.mjs';
import { buildGrokEnv } from './grok-env.mjs';
import { buildAgentArgv } from './spawn-opts.mjs';
import { StderrRateLimiter } from './stderr-limiter.mjs';
import { errorMessage, isMissingCwdError, isWithinPath, rpcErrorMessage } from './util.mjs';

export class AgentConnection {
  constructor({
    emit,
    spawnOpts,
    autoApproveFor,
    onActivity = () => {},
    onExit = () => {},
  }) {
    this.emit = emit;
    this.spawnOpts = spawnOpts;
    this.autoApproveFor = autoApproveFor;
    this.onActivity = onActivity;
    this.onExit = onExit;

    this.sessionId = null;
    this.cwd = CWD;
    this.child = null;
    this.buf = '';
    this.nextId = 1;
    this.pending = new Map();
    this.ready = false;
    this.readyPromise = null;
    this.respawnChain = Promise.resolve();
    this.agentMutationActive = false;
    this.agentMutationBacklog = 0;
    this.nextTurnId = 1;
    this.activeTurn = null;
    this.turnQueue = [];
    this.pendingPermissions = new Map();
    this.pendingElicitations = new Map();
    this.unhandledClientRequests = new Set();
    this.stderrLimiter = new StderrRateLimiter();
    this.lastActivityAt = Date.now();
  }

  bindSession(sessionId, cwd) {
    this.sessionId = sessionId;
    this.cwd = cwd ?? CWD;
    this.touch();
    this.emit({
      kind: 'agent_ready',
      sessionId: this.sessionId,
      cwd: this.cwd,
      spawnOpts: { ...this.spawnOpts },
    });
  }

  touch() {
    this.lastActivityAt = Date.now();
    this.onActivity(this.sessionId);
  }

  start() {
    this.buf = '';
    this.rejectPending(new Error('agent process restarted'));
    this.clearParkedClientRequestTimers();
    this.pendingPermissions.clear();
    this.pendingElicitations.clear();
    const env = buildGrokEnv({ ignoreApiKey: this.spawnOpts.ignoreApiKey });
    this.child = spawn(GROK_BIN, [...GROK_BIN_ARGS, ...buildAgentArgv(this.spawnOpts)], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });
    this.child.stdout.on('data', (c) => this.onStdout(c));
    this.child.stderr.on('data', (c) => this.stderrLimiter.write(c));
    this.child.on('exit', (code) => {
      this.stderrLimiter.flushAll();
      this.rejectPending(new Error(`agent exited (code ${code})`));
      this.emit({ kind: 'agent_exit', code, sessionId: this.sessionId });
      this.ready = false;
      this.onExit(this.sessionId, code);
    });
    this.readyPromise = this.init();
    return this.readyPromise;
  }

  async init() {
    await this.call('initialize', {
      protocolVersion: 1,
      clientCapabilities: { elicitation: { form: {}, url: {} } },
    });
    this.ready = true;
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

  async respawn(newOpts = {}) {
    return this.enqueueAgentMutation(() => this.doRespawn(newOpts));
  }

  async doRespawn(newOpts = {}) {
    Object.assign(this.spawnOpts, newOpts);
    const sessionId = this.sessionId;
    const cwd = this.cwd;
    this.ready = false;
    await this.killChild();
    this.start();
    await this.readyPromise;
    if (sessionId) {
      this.cwd = await this.callSessionLoad(sessionId, cwd);
      this.touch();
      this.emit({
        kind: 'agent_respawn',
        sessionId: this.sessionId,
        spawnOpts: { ...this.spawnOpts },
      });
      this.emit({
        kind: 'agent_ready',
        sessionId: this.sessionId,
        cwd: this.cwd,
        spawnOpts: { ...this.spawnOpts },
      });
    }
  }

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

  async callSessionLoad(sessionId, preferredCwd) {
    const primary = preferredCwd ?? this.cwd ?? CWD;
    try {
      await this.call('session/load', { sessionId, cwd: primary, mcpServers: [] });
      return primary;
    } catch (e) {
      if (primary !== CWD && isMissingCwdError(e)) {
        await this.call('session/load', { sessionId, cwd: CWD, mcpServers: [] });
        return CWD;
      }
      throw e;
    }
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
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const resolver = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (resolver?.timeout) clearTimeout(resolver.timeout);
      if (msg.error) resolver?.reject(new Error(rpcErrorMessage(msg.error)));
      else resolver?.resolve(msg.result);
      return;
    }
    if (msg.method === 'session/update') {
      const agentSessionId = msg.params.sessionId;
      const sessionId = this.sessionId ?? this.activeTurn?.sessionId ?? agentSessionId;
      const update = this.normalizedSessionUpdate(msg.params.update, sessionId, agentSessionId);
      this.emit({ kind: 'update', update, sessionId });
      return;
    }
    if (msg.method === 'session/request_permission' && msg.id !== undefined) {
      const sessionId = this.sessionId ?? msg.params?.sessionId;
      if (this.autoApproveFor(sessionId)) {
        const optionId = chooseAutoPermissionOption(msg.params?.options);
        if (optionId) {
          this.send({ jsonrpc: '2.0', id: msg.id, result: { outcome: { outcome: 'selected', optionId } } });
          this.emit({ kind: 'permission_auto_allowed', toolCall: msg.params?.toolCall, optionId, sessionId });
        } else {
          this.send({ jsonrpc: '2.0', id: msg.id, result: { outcome: { outcome: 'cancelled' } } });
          this.emit({ kind: 'permission_auto_cancelled', reason: 'no_options', toolCall: msg.params?.toolCall, sessionId });
        }
      } else {
        const timeout = setTimeout(() => {
          if (this.pendingPermissions.has(msg.id)) {
            this.pendingPermissions.delete(msg.id);
            this.send({ jsonrpc: '2.0', id: msg.id, result: { outcome: { outcome: 'cancelled' } } });
            this.emit({ kind: 'permission_timeout', rpcId: msg.id, sessionId });
          }
        }, PERMISSION_REQUEST_TIMEOUT_MS);
        this.pendingPermissions.set(msg.id, { request: msg.params, timeout });
        this.emit({ kind: 'permission_request', rpcId: msg.id, request: msg.params, sessionId });
      }
      return;
    }
    if (msg.method && msg.id !== undefined) {
      this.handleClientRequest(msg).catch((e) => {
        this.sendError(msg.id, -32603, errorMessage(e));
      });
      return;
    }
    if (msg.method) {
      this.emit({
        kind: 'meta',
        method: msg.method,
        params: msg.params,
        sessionId: this.sessionId ?? msg.params?.sessionId ?? msg.params?.update?.sessionId,
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
    const sessionId = this.sessionId ?? msg.params?.sessionId;
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
          this.emit({ kind: 'meta', method: msg.method, params: msg.params, sessionId, unsupported: true });
          return;
        }
        if (!this.unhandledClientRequests.has(msg.method)) {
          this.unhandledClientRequests.add(msg.method);
          console.error('[grok-web] unhandled client request:', msg.method);
        }
        this.send({ jsonrpc: '2.0', id: msg.id, result: {} });
        this.emit({ kind: 'meta', method: msg.method, params: msg.params, sessionId });
    }
  }

  async resolveClientPath(params = {}, { forWrite = false } = {}) {
    const raw = params.path ?? params.filePath ?? params.file_path;
    if (typeof raw !== 'string' || !raw) throw new Error('path required');
    const root = resolve(this.cwd ?? CWD);
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

  parkElicitation(msg) {
    const mode = msg.params?.mode ?? 'form';
    const sessionId = this.sessionId ?? msg.params?.sessionId;
    if (mode !== 'form' && mode !== 'url') {
      this.send({ jsonrpc: '2.0', id: msg.id, result: { action: 'cancel' } });
      return;
    }
    const timeout = setTimeout(() => {
      if (this.pendingElicitations.has(msg.id)) {
        this.pendingElicitations.delete(msg.id);
        this.send({ jsonrpc: '2.0', id: msg.id, result: { action: 'cancel' } });
        this.emit({ kind: 'elicitation_resolved', rpcId: msg.id, action: 'timed out', sessionId });
      }
    }, ELICITATION_TIMEOUT_MS);
    this.pendingElicitations.set(msg.id, { request: msg.params, timeout, responseKind: 'elicitation' });
    this.emit({ kind: 'elicitation_request', rpcId: msg.id, request: msg.params, sessionId });
  }

  parkUserQuestion(msg) {
    const sessionId = this.sessionId ?? msg.params?.sessionId;
    const request = {
      mode: 'question',
      questions: Array.isArray(msg.params?.questions) ? msg.params.questions : [],
      sessionId,
      toolCallId: msg.params?.toolCallId,
    };
    const timeout = setTimeout(() => {
      if (this.pendingElicitations.has(msg.id)) {
        this.pendingElicitations.delete(msg.id);
        this.send({ jsonrpc: '2.0', id: msg.id, result: { outcome: 'cancelled' } });
        this.emit({ kind: 'elicitation_resolved', rpcId: msg.id, action: 'timed out', sessionId });
      }
    }, ELICITATION_TIMEOUT_MS);
    this.pendingElicitations.set(msg.id, { request, timeout, responseKind: 'ask_user_question' });
    this.emit({ kind: 'elicitation_request', rpcId: msg.id, request, sessionId });
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

  prompt(text, opts = {}) {
    const target = this.sessionId;
    const turn = {
      turnId: `turn-${this.nextTurnId++}`,
      sessionId: target,
      text,
      internal: !!opts.internal,
      cancelled: false,
    };
    const queued = this.agentMutationActive || this.agentMutationBacklog > 0 || this.turnQueue.length > 0;
    if (!turn.internal) this.emit({ kind: 'user_prompt', text, sessionId: target, turnId: turn.turnId });
    if (queued && !turn.internal) {
      const position = this.turnQueue.filter(t => !t.cancelled && !t.internal).length + (this.activeTurn ? 1 : 0) + 1;
      this.emit({ kind: 'turn_queued', sessionId: target, turnId: turn.turnId, position });
    }
    this.turnQueue.push(turn);
    this.touch();
    const promise = this.enqueueAgentMutation(() => this.runQueuedPrompt(turn));
    return { turnId: turn.turnId, queued, promise };
  }

  async runQueuedPrompt(turn) {
    const idx = this.turnQueue.indexOf(turn);
    if (idx >= 0) this.turnQueue.splice(idx, 1);
    if (turn.cancelled) return { cancelled: true };
    if (!this.ready) await this.readyPromise;
    this.activeTurn = turn;
    this.touch();
    try {
      const res = await this.call('session/prompt', {
        sessionId: this.sessionId,
        prompt: [{ type: 'text', text: turn.text }],
      }, { timeoutMs: PROMPT_RPC_TIMEOUT_MS });
      if (!turn.internal) {
        this.emit({ kind: 'turn_complete', result: res, sessionId: this.sessionId, turnId: turn.turnId });
      }
      return res;
    } catch (e) {
      if (e?.rpcTimeout && this.sessionId) this.notify('session/cancel', { sessionId: this.sessionId });
      throw e;
    } finally {
      if (this.activeTurn === turn) this.activeTurn = null;
      this.touch();
    }
  }

  cancel() {
    const target = this.sessionId;
    let queuedCancelled = 0;
    for (const turn of [...this.turnQueue]) {
      turn.cancelled = true;
      const idx = this.turnQueue.indexOf(turn);
      if (idx >= 0) this.turnQueue.splice(idx, 1);
      queuedCancelled++;
      if (!turn.internal) {
        this.emit({ kind: 'turn_cancelled', sessionId: target, turnId: turn.turnId, queued: true });
      }
    }
    if (target) this.notify('session/cancel', { sessionId: target });
    this.touch();
    return {
      activeCancelled: !!(this.activeTurn && this.activeTurn.sessionId === target),
      queuedCancelled,
    };
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
    this.emit({
      kind: 'permission_resolved',
      rpcId,
      optionId,
      sessionId: this.sessionId ?? pending.request?.sessionId,
    });
    this.touch();
    return true;
  }

  respondToElicitation(rpcId, action, content) {
    const pending = this.pendingElicitations.get(rpcId);
    if (!pending) return false;
    clearTimeout(pending.timeout);
    this.pendingElicitations.delete(rpcId);
    const result = pending.responseKind === 'ask_user_question'
      ? buildAskUserQuestionResult(action, content, pending.request?.questions?.length ?? 0)
      : content === undefined ? { action } : { action, content };
    this.send({ jsonrpc: '2.0', id: rpcId, result });
    this.emit({
      kind: 'elicitation_resolved',
      rpcId,
      action,
      sessionId: this.sessionId ?? pending.request?.sessionId,
    });
    this.touch();
    return true;
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
      if (agentSessionId && sessionId !== agentSessionId && rawOutput.output_file.includes(agentSessionId)) {
        normalized.rawOutput = { ...rawOutput };
        delete normalized.rawOutput.output_file;
        changed = true;
      }
    }
    return changed ? normalized : update;
  }

  rejectPending(error) {
    for (const [, resolver] of [...this.pending]) {
      if (resolver.timeout) clearTimeout(resolver.timeout);
      resolver.reject(error);
    }
    this.pending.clear();
  }

  clearParkedClientRequestTimers() {
    for (const entry of this.pendingPermissions.values()) {
      if (entry.timeout) clearTimeout(entry.timeout);
    }
    for (const entry of this.pendingElicitations.values()) {
      if (entry.timeout) clearTimeout(entry.timeout);
    }
  }

  isIdle(now = Date.now(), idleMs) {
    if (this.activeTurn || this.turnQueue.length > 0) return false;
    if (this.agentMutationActive || this.agentMutationBacklog > 0) return false;
    return now - this.lastActivityAt >= idleMs;
  }
}
