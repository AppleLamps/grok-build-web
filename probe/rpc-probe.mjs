// Probe grok agent stdio as JSON-RPC 2.0.
// Send a bogus method first to see what error we get, then try common names.

import { spawn } from 'node:child_process';

const GROK = process.env.GROK_BIN ?? 'grok';
const START = Date.now();
const log = (tag, x) => {
  const t = ((Date.now() - START) / 1000).toFixed(2);
  console.log(`[${t}s] ${tag}`, typeof x === 'string' ? x : JSON.stringify(x));
};

const child = spawn(GROK, ['agent', 'stdio'], { stdio: ['pipe', 'pipe', 'pipe'] });

let buf = '';
child.stdout.on('data', (chunk) => {
  buf += chunk.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (line.trim()) log('STDOUT', line);
  }
});
child.stderr.on('data', (c) => log('STDERR', c.toString().trimEnd()));
child.on('exit', (code) => { log('EXIT', { code }); process.exit(0); });

let nextId = 1;
const call = (method, params = {}) => {
  const msg = { jsonrpc: '2.0', id: nextId++, method, params };
  log('SEND', msg);
  child.stdin.write(JSON.stringify(msg) + '\n');
};

const methods = [
  'initialize',
  'definitely_bogus_method_xyz',
  'getServerInfo',
  'server/info',
  'listMethods',
  'rpc.discover',
  'sessions/list',
  'session/new',
  'agent/sendMessage',
  'sendMessage',
  'chat',
  'newPrompt',
];

methods.forEach((m, i) => setTimeout(() => call(m), 300 + i * 1500));
setTimeout(() => { log('DONE', 'killing'); child.kill(); }, 300 + methods.length * 1500 + 2000);
