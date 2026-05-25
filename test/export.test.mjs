import assert from 'node:assert/strict';
import test from 'node:test';
import { importPublic, installDomStubs } from './helpers.mjs';

installDomStubs();

const { formatToolIO, formatExportMarkdown } = await importPublic('public/js/topbar.js');
const { recordToolForExport, resetExportTurns, cleanForExport } = await importPublic('public/js/dispatch.js');
const { state } = await importPublic('public/js/state.js');

test('formatToolIO returns short strings unchanged', () => {
  assert.equal(formatToolIO('hello world'), 'hello world');
  assert.equal(formatToolIO(''), '');
  assert.equal(formatToolIO(null), '');
});

test('formatToolIO stringifies non-string values', () => {
  const out = formatToolIO({ command: 'ls', args: ['-la'] });
  assert.match(out, /"command": "ls"/);
  assert.match(out, /"args"/);
});

test('formatToolIO preserves payloads up to the new 20K limit', () => {
  const payload = 'x'.repeat(20000);
  assert.equal(formatToolIO(payload), payload);
  assert.equal(formatToolIO(payload).includes('truncated'), false);
});

test('formatToolIO truncates only past the limit and labels display-truncation explicitly', () => {
  const payload = 'a'.repeat(25000);
  const out = formatToolIO(payload);
  assert.equal(out.startsWith('a'.repeat(20000)), true);
  assert.match(out, /display truncated/);
  assert.match(out, /5,000 of 25,000 chars omitted/);
  assert.match(out, /agent received and wrote the full payload/);
});

test('formatToolIO respects a custom limit override', () => {
  const out = formatToolIO('a'.repeat(50), 10);
  assert.equal(out.startsWith('a'.repeat(10)), true);
  assert.match(out, /40 of 50 chars omitted/);
});

test('formatExportMarkdown returns null when there are no turns', () => {
  assert.equal(formatExportMarkdown([]), null);
});

test('formatExportMarkdown renders user, thinking, tool calls, and assistant', () => {
  const turns = [{
    user: 'do the thing',
    thinking: 'planning…',
    tools: [
      { title: 'read_file', kind: 'read', status: 'completed', input: { path: '/x' }, output: 'contents' },
      { title: 'write_file', kind: 'edit', status: 'failed', input: null, output: 'permission denied' },
    ],
    assistant: 'done',
    hooks: [{ event: 'pre_tool', name: 'audit', status: 'allowed', elapsedMs: 12 }],
  }];

  const md = formatExportMarkdown(turns, {
    cwd: 'C:\\test\\proj', sessionId: 'sid-1', now: '2026-05-25 10:00',
  });

  assert.match(md, /# Chat Export/);
  assert.match(md, /\*\*Project:\*\* C:\\test\\proj/);
  assert.match(md, /\*\*Session:\*\* sid-1/);
  assert.match(md, /\*\*Exported:\*\* 2026-05-25 10:00/);
  assert.match(md, /## User\n\ndo the thing/);
  assert.match(md, /## Thinking\n\nplanning…/);
  assert.match(md, /### \[\+\] read_file \(read\)/);
  assert.match(md, /### \[x\] write_file \(edit\)/);
  assert.match(md, /## Assistant\n\ndone/);
  assert.match(md, /hook pre_tool → audit: allowed \(12ms\)/);
});

test('formatExportMarkdown does not truncate a 15K tool output that fits under the limit', () => {
  const big = 'z'.repeat(15000);
  const md = formatExportMarkdown([{
    user: 'q', tools: [{ title: 'write', kind: 'edit', status: 'completed', input: null, output: big }], hooks: [],
  }]);
  assert.equal(md.includes('truncated'), false);
  assert.equal(md.includes(big), true);
});

test('recordToolForExport merges multiple events for the same toolCallId into one entry', () => {
  resetExportTurns();
  state._exportCurrentTurn = { user: 'do thing', thinking: '', assistant: '', tools: [], hooks: [] };
  state.exportTurns.push(state._exportCurrentTurn);

  recordToolForExport({
    sessionUpdate: 'tool_call', toolCallId: 'call-1',
    title: 'list_dir', kind: 'other',
    rawInput: { target_directory: '.' },
  }, { initial: true });
  recordToolForExport({
    sessionUpdate: 'tool_call_update', toolCallId: 'call-1',
    title: 'List `.`', kind: 'other',
    rawInput: { variant: 'ListDir', target_directory: '.' },
    status: 'in_progress',
  }, { initial: false });
  recordToolForExport({
    sessionUpdate: 'tool_call_update', toolCallId: 'call-1',
    title: '', kind: '',
    rawOutput: { type: 'ListDir', Content: { content: '- file.txt\n' } },
    status: 'completed',
  }, { initial: false });

  const tools = state._exportCurrentTurn.tools;
  assert.equal(tools.length, 1, 'three events merged into one entry');
  assert.equal(tools[0].toolCallId, 'call-1');
  assert.equal(tools[0].title, 'list_dir', 'first non-empty title is preserved');
  assert.equal(tools[0].status, 'completed');
  assert.deepEqual(tools[0].input, { target_directory: '.' }, 'first input preserved');
  assert.match(tools[0].output.Content.content, /file\.txt/);
});

test('recordToolForExport keeps separate entries for distinct toolCallIds', () => {
  resetExportTurns();
  state._exportCurrentTurn = { user: 'q', thinking: '', assistant: '', tools: [], hooks: [] };
  state.exportTurns.push(state._exportCurrentTurn);

  recordToolForExport({ sessionUpdate: 'tool_call', toolCallId: 'a', title: 'one', rawInput: { x: 1 } }, { initial: true });
  recordToolForExport({ sessionUpdate: 'tool_call', toolCallId: 'b', title: 'two', rawInput: { x: 2 } }, { initial: true });
  assert.equal(state._exportCurrentTurn.tools.length, 2);
  assert.deepEqual(state._exportCurrentTurn.tools.map(t => t.toolCallId), ['a', 'b']);
});

test('cleanForExport decodes a byte-array buffer back to a UTF-8 string', () => {
  const helloBytes = [72, 101, 108, 108, 111, 44, 32, 119, 111, 114, 108, 100, 33, 10, 0, 12, 34];
  assert.equal(typeof cleanForExport(helloBytes), 'string');
  assert.match(cleanForExport(helloBytes), /^Hello, world!/);
});

test('cleanForExport leaves a short or non-byte array untouched', () => {
  assert.deepEqual(cleanForExport([1, 2, 3]), [1, 2, 3]);
  assert.deepEqual(cleanForExport([300, 400]), [300, 400]);
  const arr = [{ a: 1 }, { b: 2 }];
  assert.deepEqual(cleanForExport(arr), arr);
});

test('cleanForExport walks nested objects to find embedded byte arrays', () => {
  const bytes = Array.from(new TextEncoder().encode('nested terminal output line\n'));
  const value = { type: 'Bash', output: bytes, status: 'completed' };
  const cleaned = cleanForExport(value);
  assert.equal(typeof cleaned.output, 'string');
  assert.match(cleaned.output, /nested terminal output/);
  assert.equal(cleaned.type, 'Bash');
  assert.equal(cleaned.status, 'completed');
});

test('cleanForExport preserves primitives and nulls', () => {
  assert.equal(cleanForExport(null), '');
  assert.equal(cleanForExport(''), '');
  assert.equal(cleanForExport(42), 42);
  assert.equal(cleanForExport(true), true);
});
