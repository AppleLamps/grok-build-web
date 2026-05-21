// Drive a full ACP cycle: initialize → session/new → session/prompt
// and capture every session/update notification.

import { spawn } from 'node:child_process';

const GROK = process.env.GROK_BIN ?? 'grok';
const PROMPT = process.argv[2] ?? 'list the files in the current directory using your bash tool, then summarize';
const CWD = process.cwd();
const START = Date.now();
const log = (tag, x) => {
  const t = ((Date.now() - START) / 1000).toFixed(2);
  console.log(`[${t}s] ${tag}`, typeof x === 'string' ? x : JSON.stringify(x));
};

const child = spawn(GROK, ['agent', 'stdio'], { stdio: ['pipe', 'pipe', 'pipe'] });

let buf = '';
const pending = new Map();
let nextId = 1;
let sessionId = null;
let updateCount = 0;
const seenUpdateTypes = new Map();

child.stdout.on('data', (chunk) => {
  buf += chunk.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { log('STDOUT-RAW', line); continue; }
    handleMessage(msg);
  }
});
child.stderr.on('data', (c) => log('STDERR', c.toString().trimEnd()));
child.on('exit', (code) => {
  log('EXIT', { code });
  log('SUMMARY_seen_update_kinds', Object.fromEntries(seenUpdateTypes));
  process.exit(0);
});

function handleMessage(msg) {
  if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
    // Response
    const resolver = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) {
      log(`RESP id=${msg.id} ERROR`, msg.error);
      resolver?.reject(msg.error);
    } else {
      log(`RESP id=${msg.id}`, msg.result);
      resolver?.resolve(msg.result);
    }
  } else if (msg.method) {
    // Notification or request from server
    if (msg.method === 'session/update') {
      updateCount++;
      const kind = msg.params?.update?.sessionUpdate ?? '<unknown>';
      seenUpdateTypes.set(kind, (seenUpdateTypes.get(kind) ?? 0) + 1);
      // Only log first few of each kind to keep output readable.
      if (seenUpdateTypes.get(kind) <= 2) {
        log(`NOTIF session/update [${kind}] #${updateCount}`, msg.params.update);
      } else if (seenUpdateTypes.get(kind) === 3) {
        log(`NOTIF session/update [${kind}]`, '... (suppressing further)');
      }
    } else {
      log(`NOTIF/REQ ${msg.method}`, msg.params);
      // If it's a request needing a response, send a permissive reply.
      if (msg.id !== undefined) {
        const result = msg.method === 'session/request_permission'
          ? { outcome: { outcome: 'selected', optionId: 'allow' } }
          : {};
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\n');
      }
    }
  }
}

function call(method, params) {
  const id = nextId++;
  const msg = { jsonrpc: '2.0', id, method, params };
  log(`SEND id=${id}`, { method, params });
  child.stdin.write(JSON.stringify(msg) + '\n');
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function run() {
  await new Promise((r) => setTimeout(r, 500));
  await call('initialize', { protocolVersion: 1, clientCapabilities: {} });
  const newRes = await call('session/new', { cwd: CWD, mcpServers: [] });
  sessionId = newRes.sessionId;
  log('SESSION_ID', sessionId);
  const promptRes = await call('session/prompt', {
    sessionId,
    prompt: [{ type: 'text', text: PROMPT }],
  });
  log('PROMPT_RESULT', promptRes);
  setTimeout(() => child.kill(), 500);
}

run().catch((e) => { log('FATAL', e); child.kill(); });
setTimeout(() => { log('HARD_TIMEOUT', 'killing'); child.kill(); }, 90000);
