import {
  AGENT_IDLE_MS,
  AGENT_IDLE_SWEEP_MS,
  CWD,
  HISTORY_LIMIT,
  MAX_ACTIVE_AGENTS,
} from './config.mjs';
import { AgentConnection } from './agent-connection.mjs';
import { createDefaultSpawnOpts } from './spawn-opts.mjs';
import { mergeHistoryEntries } from './util.mjs';

export class GrokBridge {
  constructor() {
    this.agents = new Map();
    this.listeners = new Set();
    this.history = [];
    this.historySeq = 0;
    this.globalHistory = [];
    this.sessionHistory = new Map();
    this.sessionCwds = new Map();
    this.sessionAutoApprovals = new Map();
    this.defaultAutoApprove = true;
    this.spawnOpts = createDefaultSpawnOpts();
    this.bridgeOperationChain = Promise.resolve();
    this.legacySessionId = null;
    this.legacyCwd = null;
    this.idleSweepTimer = setInterval(() => {
      this.evictIdleAgents().catch((e) => console.error('[grok-web] idle eviction failed:', e));
    }, AGENT_IDLE_SWEEP_MS);
  }

  get sessionId() { return this.legacySessionId; }
  get cwd() { return this.legacyCwd ?? CWD; }
  get child() { return null; }

  activeSessionId(sessionId = null) {
    return sessionId ?? this.legacySessionId ?? null;
  }

  rememberSessionCwd(sessionId, cwd) {
    if (sessionId && cwd) this.sessionCwds.set(sessionId, cwd);
  }

  cwdForSession(sessionId) {
    return sessionId ? this.sessionCwds.get(sessionId) : null;
  }

  autoApproveFor(sessionId = null) {
    if (sessionId && this.sessionAutoApprovals.has(sessionId)) {
      return this.sessionAutoApprovals.get(sessionId);
    }
    return this.defaultAutoApprove;
  }

  async enqueueBridgeOperation(fn) {
    const next = this.bridgeOperationChain.then(fn);
    this.bridgeOperationChain = next.catch(() => {});
    return next;
  }

  createAgentConnection() {
    return new AgentConnection({
      emit: (event) => this.broadcast(event),
      spawnOpts: { ...this.spawnOpts },
      autoApproveFor: (sessionId) => this.autoApproveFor(sessionId),
      onActivity: (sessionId) => {
        if (sessionId) this.sessionCwds.set(sessionId, this.agents.get(sessionId)?.cwd ?? this.sessionCwds.get(sessionId));
      },
      onExit: (sessionId) => {
        if (sessionId) this.agents.delete(sessionId);
      },
    });
  }

  async evictIfOverCap() {
    if (this.agents.size < MAX_ACTIVE_AGENTS) return;
    const now = Date.now();
    const idle = [...this.agents.entries()]
      .filter(([, agent]) => agent.isIdle(now, 0))
      .sort((a, b) => a[1].lastActivityAt - b[1].lastActivityAt);
    if (idle.length) {
      const [sessionId, agent] = idle[0];
      await agent.killChild();
      this.agents.delete(sessionId);
      return;
    }
    const oldest = [...this.agents.entries()].sort((a, b) => a[1].lastActivityAt - b[1].lastActivityAt)[0];
    if (oldest) {
      await oldest[1].killChild();
      this.agents.delete(oldest[0]);
    }
  }

  async evictIdleAgents() {
    const now = Date.now();
    for (const [sessionId, agent] of [...this.agents.entries()]) {
      if (!agent.isIdle(now, AGENT_IDLE_MS)) continue;
      await agent.killChild();
      this.agents.delete(sessionId);
    }
  }

  async ensureLoadedAgent(sessionId, cwd = null) {
    let agent = this.agents.get(sessionId);
    if (agent?.ready) return agent;
    if (agent) {
      await agent.readyPromise?.catch(() => {});
      if (agent.ready) return agent;
      this.agents.delete(sessionId);
    }
    await this.evictIfOverCap();
    agent = this.createAgentConnection();
    await agent.start();
    const targetCwd = await agent.callSessionLoad(sessionId, cwd ?? this.cwdForSession(sessionId));
    agent.bindSession(sessionId, targetCwd);
    this.agents.set(sessionId, agent);
    this.rememberSessionCwd(sessionId, targetCwd);
    return agent;
  }

  async createTabSession(cwd = null, baseSessionId = null) {
    return this.enqueueBridgeOperation(async () => {
      await this.evictIfOverCap();
      const targetCwd = cwd ?? this.cwdForSession(baseSessionId) ?? CWD;
      const agent = this.createAgentConnection();
      await agent.start();
      const res = await agent.call('session/new', { cwd: targetCwd, mcpServers: [] });
      agent.bindSession(res.sessionId, targetCwd);
      this.agents.set(res.sessionId, agent);
      this.rememberSessionCwd(res.sessionId, targetCwd);
      this.broadcast({ kind: 'session_ready', sessionId: res.sessionId, cwd: targetCwd });
      return { sessionId: res.sessionId, cwd: targetCwd };
    });
  }

  async loadTabSession(sessionId, cwd) {
    return this.enqueueBridgeOperation(async () => {
      if (this.agents.has(sessionId) && this.agents.get(sessionId).ready) {
        const knownCwd = this.cwdForSession(sessionId) ?? cwd ?? CWD;
        this.broadcast({ kind: 'session_ready', sessionId, cwd: knownCwd, loaded: true });
        return { sessionId, cwd: knownCwd };
      }
      const agent = await this.ensureLoadedAgent(sessionId, cwd);
      this.broadcast({ kind: 'session_ready', sessionId, cwd: agent.cwd, loaded: true });
      return { sessionId, cwd: agent.cwd };
    });
  }

  async newSession(cwd) {
    const tab = await this.createTabSession(cwd);
    this.legacySessionId = tab.sessionId;
    this.legacyCwd = tab.cwd;
    this.clearSessionHistory(tab.sessionId);
    this.broadcast({ kind: 'session_replaced', sessionId: tab.sessionId, cwd: tab.cwd });
    return tab;
  }

  async loadSession(sessionId, cwd, opts = {}) {
    return this.enqueueBridgeOperation(async () => {
      const previousSessionId = this.legacySessionId;
      if (opts.restoreCode && !this.spawnOpts.restoreCode) {
        Object.assign(this.spawnOpts, { restoreCode: true });
      }
      const agent = await this.ensureLoadedAgent(sessionId, cwd);
      this.legacySessionId = sessionId;
      this.legacyCwd = agent.cwd;
      this.clearSessionHistory(previousSessionId, sessionId);
      this.broadcast({ kind: 'session_replaced', sessionId, cwd: agent.cwd, loaded: true });
      return { sessionId, cwd: agent.cwd };
    });
  }

  prompt(text, sessionId = null, opts = {}) {
    const target = this.activeSessionId(sessionId);
    if (!target) throw new Error('sessionId required');
    const agent = this.agents.get(target);
    if (agent) return agent.prompt(text, opts);
    const turnId = `turn-${Date.now()}`;
    const promise = this.enqueueBridgeOperation(async () => {
      const loaded = await this.ensureLoadedAgent(target, this.cwdForSession(target));
      return loaded.prompt(text, opts).promise;
    });
    if (!opts.internal) this.broadcast({ kind: 'user_prompt', text, sessionId: target, turnId });
    return { turnId, queued: true, promise };
  }

  cancel(sessionId = null) {
    const target = this.activeSessionId(sessionId);
    if (!target) return { activeCancelled: false, queuedCancelled: 0 };
    const agent = this.agents.get(target);
    if (!agent) return { activeCancelled: false, queuedCancelled: 0 };
    return agent.cancel();
  }

  respondToPermission(rpcId, optionId, sessionId = null) {
    if (sessionId) return this.agents.get(sessionId)?.respondToPermission(rpcId, optionId) ?? false;
    for (const agent of this.agents.values()) {
      if (agent.respondToPermission(rpcId, optionId)) return true;
    }
    return false;
  }

  respondToElicitation(rpcId, action, content, sessionId = null) {
    if (sessionId) return this.agents.get(sessionId)?.respondToElicitation(rpcId, action, content) ?? false;
    for (const agent of this.agents.values()) {
      if (agent.respondToElicitation(rpcId, action, content)) return true;
    }
    return false;
  }

  setAutoApprove(on, sessionId = null) {
    const next = !!on;
    if (sessionId) {
      this.sessionAutoApprovals.set(sessionId, next);
    } else {
      this.defaultAutoApprove = next;
      this.spawnOpts.alwaysApprove = next;
    }
    this.broadcast({ kind: 'auto_approve_changed', autoApprove: next, sessionId });
    const target = sessionId ?? this.legacySessionId;
    const agent = target ? this.agents.get(target) : null;
    if (agent?.ready && target) {
      agent.prompt(`/always-approve ${next ? 'on' : 'off'}`, { internal: true }).promise.catch(() => {});
    }
  }

  async respawn(newOpts = {}) {
    const sessionId = newOpts.sessionId ?? null;
    const { sessionId: _drop, ...spawnPatch } = newOpts;
    Object.assign(this.spawnOpts, spawnPatch);
    if (sessionId) {
      const agent = this.agents.get(sessionId);
      if (!agent) {
        await this.ensureLoadedAgent(sessionId, this.cwdForSession(sessionId));
      }
      await this.agents.get(sessionId)?.respawn(spawnPatch);
      return;
    }
    return this.enqueueBridgeOperation(async () => {
      const ids = [...this.agents.keys()];
      if (!ids.length && this.legacySessionId) ids.push(this.legacySessionId);
      for (const id of ids) {
        if (!this.agents.has(id)) await this.ensureLoadedAgent(id, this.cwdForSession(id));
        await this.agents.get(id)?.respawn(spawnPatch);
      }
      if (!ids.length) {
        this.broadcast({ kind: 'agent_respawn', spawnOpts: { ...this.spawnOpts } });
      }
    });
  }

  start() {
    // Lazy spawn: agents are created per tab session.
  }

  async killAllAgents() {
    clearInterval(this.idleSweepTimer);
    await Promise.all([...this.agents.values()].map((agent) => agent.killChild()));
    this.agents.clear();
  }

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
}

export { GrokBridge as GrokSession };
