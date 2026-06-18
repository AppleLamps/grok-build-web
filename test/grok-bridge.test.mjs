import assert from 'node:assert/strict';
import test from 'node:test';
import { HISTORY_LIMIT } from '../lib/config.mjs';
import { GrokBridge } from '../lib/grok-bridge.mjs';

test('concurrent session loads reuse one agent connection', async () => {
  const bridge = new GrokBridge();
  const createdAgents = [];
  let startCalls = 0;
  let loadCalls = 0;

  bridge.createAgentConnection = () => {
    const agent = {
      ready: false,
      readyPromise: null,
      cwd: process.cwd(),
      async start() {
        startCalls++;
        this.readyPromise = new Promise((resolve) => setTimeout(resolve, 25));
        await this.readyPromise;
        this.ready = true;
      },
      async callSessionLoad(sessionId, cwd) {
        loadCalls++;
        this.sessionId = sessionId;
        this.cwd = cwd ?? process.cwd();
        return this.cwd;
      },
      bindSession(sessionId, cwd) {
        this.sessionId = sessionId;
        this.cwd = cwd;
        this.ready = true;
      },
      isIdle() {
        return false;
      },
      async killChild() {},
    };
    createdAgents.push(agent);
    return agent;
  };

  try {
    const [first, second] = await Promise.all([
      bridge.loadTabSession('plugin-mcp-session', process.cwd()),
      bridge.loadTabSession('plugin-mcp-session', process.cwd()),
    ]);

    assert.equal(first.sessionId, 'plugin-mcp-session');
    assert.deepEqual(second, first);
    assert.equal(createdAgents.length, 1);
    assert.equal(startCalls, 1);
    assert.equal(loadCalls, 1);
    assert.equal(bridge.agents.size, 1);
  } finally {
    await bridge.killAllAgents();
  }
});

test('ready session load keeps remembered cwd across cross-cwd tab resumes', async () => {
  const bridge = new GrokBridge();
  let loadCalls = 0;

  bridge.createAgentConnection = () => ({
    ready: false,
    readyPromise: null,
    cwd: 'C:\\Users\\apple\\project-a',
    async start() {
      this.ready = true;
    },
    async callSessionLoad(sessionId, cwd) {
      loadCalls++;
      this.sessionId = sessionId;
      this.cwd = cwd;
      return cwd;
    },
    bindSession(sessionId, cwd) {
      this.sessionId = sessionId;
      this.cwd = cwd;
      this.ready = true;
    },
    isIdle() {
      return false;
    },
    async killChild() {},
  });

  try {
    const first = await bridge.loadTabSession('saved-session', 'C:\\Users\\apple\\project-a');
    const second = await bridge.loadTabSession('saved-session', 'C:\\Users\\apple\\project-b');

    assert.equal(first.cwd, 'C:\\Users\\apple\\project-a');
    assert.equal(second.cwd, 'C:\\Users\\apple\\project-a');
    assert.equal(bridge.cwdForSession('saved-session'), 'C:\\Users\\apple\\project-a');
    assert.equal(loadCalls, 1);
  } finally {
    await bridge.killAllAgents();
  }
});

test('large replay logs stay capped and forked session replay stays isolated', async () => {
  const bridge = new GrokBridge();
  const baseSessionId = 'base-session';
  const forkSessionId = 'fork-session';

  try {
    for (let i = 0; i < HISTORY_LIMIT + 25; i++) {
      bridge.broadcast({
        kind: 'update',
        sessionId: baseSessionId,
        update: { sessionUpdate: 'agent_message_chunk', content: { text: `base-${i}` } },
      });
    }
    bridge.broadcast({
      kind: 'session_ready',
      sessionId: forkSessionId,
      cwd: 'C:\\Users\\apple\\fork',
      forkedFrom: baseSessionId,
    });
    bridge.broadcast({
      kind: 'update',
      sessionId: forkSessionId,
      update: { sessionUpdate: 'agent_message_chunk', content: { text: 'fork-only' } },
    });

    const baseReplay = bridge.replayEntries(baseSessionId, { replayAll: true });
    const forkReplay = bridge.replayEntries(forkSessionId, { replayAll: true });

    assert.ok(baseReplay.length <= HISTORY_LIMIT);
    assert.equal(
      baseReplay.some((entry) => entry.event.update?.content?.text === 'base-0'),
      false,
    );
    assert.ok(baseReplay.some((entry) => entry.event.update?.content?.text === `base-${HISTORY_LIMIT + 24}`));
    assert.ok(forkReplay.some((entry) => entry.event.sessionId === forkSessionId));
    assert.equal(
      forkReplay.some((entry) => entry.event.sessionId === baseSessionId),
      false,
    );
  } finally {
    await bridge.killAllAgents();
  }
});
