import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentConnection } from '../lib/agent-connection.mjs';

test('user prompts include a local date rollover notice after midnight', async () => {
  const sent = [];
  const events = [];
  const dates = [new Date(2026, 5, 18, 23, 59), new Date(2026, 5, 19, 0, 1)];
  const agent = new AgentConnection({
    emit: (event) => events.push(event),
    spawnOpts: {},
    autoApproveFor: () => true,
    now: () => dates[0],
  });
  agent.ready = true;
  agent.readyPromise = Promise.resolve();
  agent.bindSession('session-1', process.cwd());
  agent.now = () => dates[1];
  agent.call = async (method, params) => {
    sent.push({ method, params });
    return { stopReason: 'end_turn' };
  };

  await agent.prompt('continue the work').promise;

  assert.equal(sent[0].method, 'session/prompt');
  assert.match(
    sent[0].params.prompt[0].text,
    /^System notice: The local calendar date changed from 2026-06-18 to 2026-06-19/,
  );
  assert.match(sent[0].params.prompt[0].text, /\n\ncontinue the work$/);
  assert.deepEqual(
    events.find((event) => event.kind === 'date_rollover_notice'),
    {
      kind: 'date_rollover_notice',
      sessionId: 'session-1',
      previousDate: '2026-06-18',
      currentDate: '2026-06-19',
      message:
        'System notice: The local calendar date changed from 2026-06-18 to 2026-06-19 while this session was open. Treat the current local date as 2026-06-19.',
    },
  );
});

test('stdout parser ignores undecodable stdio lines and handles later JSON messages', async () => {
  const events = [];
  const agent = new AgentConnection({
    emit: (event) => events.push(event),
    spawnOpts: {},
    autoApproveFor: () => true,
  });
  agent.bindSession('session-stdio', process.cwd());

  let resolved;
  agent.pending.set(42, {
    resolve: (value) => {
      resolved = value;
    },
    reject: (error) => {
      throw error;
    },
    timeout: null,
  });

  agent.onStdout(Buffer.from([0xff, 0xfe, 0x0a]));
  agent.onStdout(Buffer.from('not json from managed MCP stdio\n'));
  agent.onStdout(Buffer.from('{"jsonrpc":"2.0","id":42,"result":{"ok":true}}\n'));
  agent.onStdout(
    Buffer.from(
      `${JSON.stringify({
        method: 'session/update',
        params: {
          sessionId: 'agent-session',
          update: {
            sessionUpdate: 'tool_call_update',
            toolCallId: 'plugin-mcp',
            title: 'managed MCP server',
            status: 'completed',
          },
        },
      })}\n`,
    ),
  );

  assert.deepEqual(resolved, { ok: true });
  assert.equal(agent.pending.has(42), false);
  assert.ok(
    events.some(
      (event) =>
        event.kind === 'update' && event.sessionId === 'session-stdio' && event.update?.toolCallId === 'plugin-mcp',
    ),
  );
});
