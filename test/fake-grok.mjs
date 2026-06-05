#!/usr/bin/env node

import { randomUUID } from 'node:crypto';

const args = process.argv.slice(2);
const scenario = process.env.FAKE_GROK_SCENARIO ?? 'normal';
const delaySessionLoadMs = Number(process.env.FAKE_GROK_DELAY_SESSION_LOAD_MS ?? 0);
const delayPromptMs = Number(process.env.FAKE_GROK_DELAY_PROMPT_MS ?? 0);

if (args[0] === '--help') {
  console.log(`Grok Build TUI

Usage: grok [OPTIONS] [COMMAND]

Options:
      --always-approve
      --permission-mode <MODE>
      --todo-gate
  -h, --help
`);
  process.exit(0);
}

if (args[0] === 'models') {
  console.log('grok-build');
  console.log('grok-4.3');
  process.exit(0);
}

if (args[0] === 'mcp' && args[1] === 'list') {
  console.log('No MCP servers configured');
  process.exit(0);
}

if (args[0] === 'worktree' && args[1] === 'list') {
  console.log(`HOME=${process.env.HOME ?? ''}`);
  console.log(`GROK_HOME=${process.env.GROK_HOME ?? ''}`);
  console.log(`${process.cwd()}  main`);
  process.exit(0);
}

if (args[0] === 'login' && args.includes('--device-auth')) {
  console.log('Visit https://grok.example/device and enter code TEST-CODE');
  process.exit(0);
}

if (args.includes('-p')) {
  const promptIndex = args.indexOf('-p');
  console.log(
    JSON.stringify({
      args,
      prompt: args[promptIndex + 1] ?? '',
      cwd: process.cwd(),
      XAI_API_KEY_set: !!process.env.XAI_API_KEY,
      GROK_API_KEY_set: !!process.env.GROK_API_KEY,
    }),
  );
  process.exit(0);
}

if (args.includes('agent') && args.includes('--help')) {
  console.log(`Run Grok without the interactive UI

Usage: grok agent [OPTIONS] [COMMAND]

Commands:
  stdio     Run the agent over stdio

Options:
      --always-approve
      --no-leader
  -h, --help
`);
  process.exit(0);
}

if (!args.includes('agent') || !args.includes('stdio')) {
  console.error(`fake grok: unsupported args ${args.join(' ')}`);
  process.exit(2);
}

let buf = '';
let nextServerRequestId = 1000;
let sessionId = 'fake-session-1';
let activePromptCount = 0;
let maxActivePromptCount = 0;
const pending = new Map();

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    try {
      handle(JSON.parse(line)).catch((e) => {
        send({ jsonrpc: '2.0', method: '_x.ai/fake_error', params: { message: String(e?.message ?? e) } });
      });
    } catch {
      send({ jsonrpc: '2.0', method: '_x.ai/malformed_notice', params: { line } });
    }
  }
});

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function result(id, value) {
  send({ jsonrpc: '2.0', id, result: value });
}

function rpcError(id, message) {
  send({ jsonrpc: '2.0', id, error: { code: -32000, message } });
}

function update(updateValue, sid = sessionId) {
  send({
    jsonrpc: '2.0',
    method: 'session/update',
    params: { sessionId: sid, update: updateValue },
  });
}

function request(method, params, track = false) {
  const id = nextServerRequestId++;
  send({ jsonrpc: '2.0', id, method, params });
  if (!track) return null;
  return new Promise((resolve) => pending.set(id, resolve));
}

function promptProbe(phase, msg) {
  send({
    jsonrpc: '2.0',
    method: '_x.ai/fake_prompt_probe',
    params: {
      phase,
      rpcId: msg.id,
      sessionId: msg.params?.sessionId,
      activePromptCount,
      maxActivePromptCount,
      text: msg.params?.prompt?.[0]?.text ?? '',
    },
  });
}

async function handle(msg) {
  if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
    const resolve = pending.get(msg.id);
    if (resolve) {
      pending.delete(msg.id);
      resolve(msg.error ? { error: msg.error } : { result: msg.result });
    }
    return;
  }
  if (msg.method === 'initialize') {
    result(msg.id, { protocolVersion: 1, agentCapabilities: { fake: true } });
    return;
  }
  if (msg.method === 'session/new') {
    sessionId = `fake-session-${randomUUID()}`;
    result(msg.id, { sessionId });
    return;
  }
  if (msg.method === 'session/load') {
    if (delaySessionLoadMs > 0) await delay(delaySessionLoadMs);
    const cwd = msg.params?.cwd;
    const bridgeCwd = process.env.GROK_CWD ?? process.cwd();
    if (scenario === 'missing-cwd' && cwd && cwd !== bridgeCwd) {
      rpcError(msg.id, 'Path not found.');
      return;
    }
    sessionId = msg.params.sessionId;
    result(msg.id, { sessionId });
    return;
  }
  if (msg.method === 'session/cancel') {
    update(
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'bg-1',
        title: 'run_terminal_command',
        kind: 'execute',
        status: 'cancelled',
        rawInput: { command: 'sleep 60', is_background: true },
        rawOutput: { status: 'cancelled' },
      },
      msg.params?.sessionId ?? sessionId,
    );
    return;
  }
  if (msg.method === 'session/prompt') {
    const text = msg.params?.prompt?.[0]?.text ?? '';
    if (/^\/always-approve\b/.test(text)) {
      result(msg.id, promptResult());
      return;
    }
    activePromptCount++;
    maxActivePromptCount = Math.max(maxActivePromptCount, activePromptCount);
    promptProbe('start', msg);
    try {
      if (delayPromptMs > 0) await delay(delayPromptMs);
      await emitScenario(msg.params.sessionId);
      result(msg.id, promptResult());
    } finally {
      activePromptCount--;
      promptProbe('end', msg);
    }
    return;
  }
  result(msg.id, {});
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function emitScenario(sid) {
  if (scenario === 'fs') {
    await emitFsUpdates(sid);
    return;
  }
  if (scenario === 'fs-symlink') {
    await emitFsSymlinkUpdates(sid);
    return;
  }
  if (scenario === 'large') {
    emitLargeUpdates(sid);
    return;
  }
  if (scenario === 'permission-empty') {
    await emitPermissionEmptyUpdates(sid);
    return;
  }
  if (scenario === 'ask-question') {
    await emitAskQuestionUpdates(sid);
    return;
  }
  if (scenario === 'unknown-x-request') {
    await emitUnknownXRequest(sid);
    return;
  }
  if (scenario === 'quiet') {
    return;
  }
  emitPromptUpdates(sid);
}

function promptResult() {
  return {
    stopReason: scenario === 'normal' ? 'cancelled' : 'end_turn',
    _meta: { totalTokens: 1200, contextTokens: 512000 },
  };
}

function emitPromptUpdates(sid) {
  request('session/request_permission', {
    sessionId: sid,
    toolCall: { title: 'read_file', rawInput: { path: 'image.png' } },
    options: [
      { optionId: 'allow', name: 'Allow' },
      { optionId: 'deny', name: 'Deny' },
    ],
  });
  request('elicitation/create', {
    sessionId: sid,
    mode: 'form',
    title: 'Fake form',
    fields: [{ name: 'name', label: 'Name', type: 'text' }],
  });
  request('fake/unknown_client_request', { sessionId: sid, value: true });
  process.stdout.write('this is malformed json\n');

  update({ sessionUpdate: 'available_commands_update', availableCommands: [{ name: '/usage' }] }, sid);
  update(
    {
      sessionUpdate: 'agent_message_chunk',
      content: { text: 'Here is a table:\n\n| File | Result |\n| --- | --- |\n| a.png | ok |\n' },
    },
    sid,
  );
  update(
    {
      sessionUpdate: 'tool_call',
      toolCallId: 'read-1',
      title: 'read_file',
      kind: 'read',
      status: 'in_progress',
      rawInput: { path: 'image.png' },
    },
    sid,
  );
  update(
    {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'read-1',
      title: 'read_file',
      kind: 'read',
      status: 'completed',
      rawInput: { path: 'image.png' },
      content: [
        { type: 'text', text: 'Extracted text from the file' },
        { type: 'image', mimeType: 'image/png', data: tinyPngBase64() },
        { type: 'pdf', mimeType: 'application/pdf', path: 'report.pdf', text: 'PDF text' },
      ],
    },
    sid,
  );
  update(
    {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'video-1',
      title: 'imagine_video',
      kind: 'fetch',
      status: 'completed',
      rawInput: { prompt: 'clip' },
      rawOutput: { url: 'https://example.com/video.mp4', mimeType: 'video/mp4' },
    },
    sid,
  );
  update(
    {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'x-1',
      title: 'x_search_posts',
      kind: 'search',
      status: 'completed',
      rawInput: { query: 'grok build' },
      rawOutput: {
        posts: [
          {
            handle: '@skcd42',
            timestamp: '2026-05-21T00:00:00Z',
            url: 'https://x.com/skcd42/status/1',
            text: 'Grok Build update',
          },
        ],
      },
    },
    sid,
  );
  update(
    {
      sessionUpdate: 'tool_call',
      toolCallId: 'bg-1',
      title: 'run_terminal_command',
      kind: 'execute',
      status: 'in_progress',
      rawInput: { command: 'sleep 60', is_background: true },
    },
    sid,
  );
  update(
    {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'sub-1',
      title: 'use_tool',
      kind: 'execute',
      status: 'failed',
      rawInput: { tool: 'subagent' },
      rawOutput: { error: 'fake subagent failed' },
    },
    sid,
  );
}

async function emitPermissionEmptyUpdates(sid) {
  const response = await request(
    'session/request_permission',
    {
      sessionId: sid,
      toolCall: { title: 'read_file', rawInput: { path: 'no-options.txt' } },
      options: [],
    },
    true,
  );
  update(
    {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'permission-empty',
      title: 'permission_empty_probe',
      kind: 'execute',
      status: response.result?.outcome?.outcome === 'cancelled' ? 'completed' : 'failed',
      rawOutput: {
        permissionOutcome: response.result?.outcome ?? null,
      },
    },
    sid,
  );
}

async function emitAskQuestionUpdates(sid) {
  update(
    {
      sessionUpdate: 'tool_call',
      toolCallId: 'ask-question-1',
      title: 'ask_user_question',
      rawInput: {
        questions: [
          {
            question: 'Which UI improvement should be prioritized?',
            options: [
              { label: 'visual polish', description: 'Improve spacing, typography, motion, and visual details.' },
              { label: 'mobile', description: 'Improve responsive layout and touch ergonomics.' },
            ],
            multiSelect: false,
          },
        ],
      },
    },
    sid,
  );
  const response = await request(
    '_x.ai/ask_user_question',
    {
      sessionId: sid,
      toolCallId: 'ask-question-1',
      questions: [
        {
          question: 'Which UI improvement should be prioritized?',
          options: [
            { label: 'visual polish', description: 'Improve spacing, typography, motion, and visual details.' },
            { label: 'mobile', description: 'Improve responsive layout and touch ergonomics.' },
          ],
          multiSelect: false,
        },
      ],
      mode: 'default',
    },
    true,
  );
  const outcome = response.result?.outcome;
  const accepted =
    outcome === 'accepted' &&
    Array.isArray(response.result?.answers) &&
    typeof response.result?.partial_answers === 'boolean';
  const ok = outcome === 'cancelled' || outcome === 'skip_interview' || outcome === 'chat_about_this' || accepted;
  update(
    {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'ask-question-1',
      title: 'ask_user_question',
      status: ok ? 'completed' : 'failed',
      rawOutput: {
        questionOutcome: response.result ?? null,
      },
    },
    sid,
  );
}

async function emitUnknownXRequest(sid) {
  const response = await request(
    '_x.ai/future_method',
    {
      sessionId: sid,
      value: true,
    },
    true,
  );
  update(
    {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'unknown-x-1',
      title: 'unknown_x_probe',
      status: response.error ? 'completed' : 'failed',
      rawOutput: {
        response,
      },
    },
    sid,
  );
}

async function emitFsUpdates(sid) {
  const read = await request('fs/read_text_file', { sessionId: sid, path: 'note.txt' }, true);
  const write = await request(
    'fs/write_text_file',
    { sessionId: sid, path: 'written.txt', content: 'written from fake grok' },
    true,
  );
  const outside = await request('fs/read_text_file', { sessionId: sid, path: '../outside.txt' }, true);
  update(
    {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'fs-1',
      title: 'fs_session_cwd_probe',
      kind: 'read',
      status: outside.error ? 'completed' : 'failed',
      rawOutput: {
        readContent: read.result?.content ?? null,
        writeOk: write.result === null,
        outsideError: outside.error?.message ?? null,
      },
    },
    sid,
  );
}

async function emitFsSymlinkUpdates(sid) {
  const read = await request('fs/read_text_file', { sessionId: sid, path: 'escape/secret.txt' }, true);
  const write = await request(
    'fs/write_text_file',
    { sessionId: sid, path: 'escape/written.txt', content: 'outside write' },
    true,
  );
  update(
    {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'fs-symlink-1',
      title: 'fs_symlink_probe',
      kind: 'read',
      status: read.error && write.error ? 'completed' : 'failed',
      rawOutput: {
        readError: read.error?.message ?? null,
        writeError: write.error?.message ?? null,
      },
    },
    sid,
  );
}

function emitLargeUpdates(sid) {
  process.stdout.write('malformed large scenario line\n');
  update(
    {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'large-1',
      title: 'run_terminal_command',
      kind: 'execute',
      status: 'completed',
      rawInput: { command: 'large-output' },
      rawOutput: {
        output: 'x'.repeat(25000),
        output_for_prompt: 'front\n' + 'x'.repeat(21000) + '\nback',
        truncated: true,
      },
    },
    sid,
  );
}

function tinyPngBase64() {
  return 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
}
