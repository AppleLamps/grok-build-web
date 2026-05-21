// Spawn `grok agent stdio` and capture bidirectional traffic.
// Tries several input shapes to find what triggers a response.

import { spawn } from 'node:child_process';

const GROK = process.env.GROK_BIN ?? 'grok';
const PROMPT = process.argv[2] ?? 'reply with just HELLO';
const START = Date.now();
const log = (tag, x) => {
  const t = ((Date.now() - START) / 1000).toFixed(2);
  console.log(`[${t}s] ${tag}`, typeof x === 'string' ? x : JSON.stringify(x));
};

const child = spawn(GROK, ['agent', 'stdio'], {
  stdio: ['pipe', 'pipe', 'pipe'],
});

let stdoutBuf = '';
child.stdout.on('data', (chunk) => {
  stdoutBuf += chunk.toString();
  let i;
  while ((i = stdoutBuf.indexOf('\n')) >= 0) {
    const line = stdoutBuf.slice(0, i);
    stdoutBuf = stdoutBuf.slice(i + 1);
    if (line.trim()) log('STDOUT', line);
  }
});
child.stderr.on('data', (c) => log('STDERR', c.toString().trimEnd()));
child.on('exit', (code) => { log('EXIT', { code }); process.exit(0); });

const send = (obj) => {
  log('SEND', obj);
  child.stdin.write(JSON.stringify(obj) + '\n');
};

// Wait for startup, then try a sequence of plausible input shapes.
// Whichever one provokes a coherent response wins.
setTimeout(() => send({ type: 'user', data: PROMPT }), 500);
setTimeout(() => send({ type: 'prompt', data: PROMPT }), 3000);
setTimeout(() => send({ type: 'user_message', content: PROMPT }), 6000);
setTimeout(() => send({ type: 'message', role: 'user', content: PROMPT }), 9000);
setTimeout(() => send({ type: 'input', data: PROMPT }), 12000);
setTimeout(() => { log('TIMEOUT_KILL', 'done'); child.kill(); }, 20000);
