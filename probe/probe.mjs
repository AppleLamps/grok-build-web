// Probe the grok agent serve WebSocket protocol.
// Connects, logs every frame, optionally sends a prompt, then exits.

const URL = process.env.GROK_PROBE_URL;
if (!URL) throw new Error('Set GROK_PROBE_URL to the grok agent serve WebSocket URL');
const PROMPT = process.argv[2] ?? null;
const IDLE_EXIT_MS = 4000;

const ws = new WebSocket(URL);
let lastFrameAt = Date.now();
let frameCount = 0;

const log = (tag, obj) => {
  const t = ((Date.now() - startedAt) / 1000).toFixed(2);
  console.log(`[${t}s] ${tag}`, typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2));
};

const startedAt = Date.now();

ws.addEventListener('open', () => {
  log('OPEN', 'connected');
  if (PROMPT) {
    // Educated first guess at protocol shape — we'll iterate.
    const msg = { type: 'user_message', content: PROMPT };
    log('SEND', msg);
    ws.send(JSON.stringify(msg));
  }
});

ws.addEventListener('message', (e) => {
  frameCount++;
  lastFrameAt = Date.now();
  let parsed;
  try { parsed = JSON.parse(e.data); } catch { parsed = String(e.data); }
  log(`RECV #${frameCount}`, parsed);
});

ws.addEventListener('error', (e) => log('ERROR', e.message ?? String(e)));
ws.addEventListener('close', (e) => {
  log('CLOSE', { code: e.code, reason: e.reason });
  process.exit(0);
});

// Auto-exit after idle. unref() so the timer doesn't pin the event loop.
const idleTimer = setInterval(() => {
  if (Date.now() - lastFrameAt > IDLE_EXIT_MS) {
    log('IDLE_EXIT', `no frames for ${IDLE_EXIT_MS}ms`);
    clearInterval(idleTimer);
    ws.close();
    setTimeout(() => process.exit(0), 200).unref();
  }
}, 500);
idleTimer.unref?.();
