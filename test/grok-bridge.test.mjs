import assert from 'node:assert/strict';
import test from 'node:test';
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
