import { errorMessage } from '../../util.mjs';
import { sseEvent, writeWithBackpressure } from '../response.mjs';

export function match(method, pathname) {
  return method === 'GET' && pathname === '/stream';
}

export async function handle(ctx) {
  const { req, res, url, auth, grok } = ctx;
  if (!auth(req)) {
    res.writeHead(401).end();
    return true;
  }
  const filter = url.searchParams.get('sessionId') || null;
  const replayCursor = replayCursorFromRequest(req, url);
  const replayAll = url.searchParams.get('replay') === 'all';
  let closed = false;
  let replaying = true;
  let replayDone = false;
  let ping = null;
  let unsubscribe = () => {};
  let writeQueue = Promise.resolve();
  const liveBacklog = [];
  const cleanup = () => {
    if (closed) return;
    closed = true;
    unsubscribe();
    if (ping) clearInterval(ping);
  };
  const enqueueWrite = (chunk, label = 'SSE write') => {
    const next = writeQueue.then(() => {
      if (closed) return undefined;
      return writeWithBackpressure(res, chunk);
    });
    writeQueue = next.catch((e) => {
      if (!closed) console.error(`${label} failed:`, errorMessage(e));
      cleanup();
    });
    return next;
  };
  req.on('close', cleanup);
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  unsubscribe = grok.subscribe((event, entry) => {
    if (closed) return;
    if (replaying) {
      liveBacklog.push(entry);
      return;
    }
    enqueueWrite(sseEvent(event, entry?.seq), 'SSE live write');
  }, filter);
  try {
    await writeWithBackpressure(res, 'retry: 1000\n\n');
    for (const entry of grok.replayEntries(filter, { sinceSeq: replayCursor, replayAll })) {
      if (closed) break;
      await writeWithBackpressure(res, sseEvent(entry.event, entry.seq));
    }
    replaying = false;
    replayDone = true;
    while (liveBacklog.length && !closed) {
      const entry = liveBacklog.shift();
      await writeWithBackpressure(res, sseEvent(entry.event, entry.seq));
    }
    if (!closed) {
      ping = setInterval(() => {
        enqueueWrite(': ping\n\n', 'SSE ping write');
      }, 15000);
    }
  } catch (e) {
    if (!closed) console.error('SSE replay failed:', errorMessage(e));
    cleanup();
    if (!replayDone) {
      try {
        res.end();
      } catch {}
    }
  }
  return true;
}

function replayCursorFromRequest(req, url) {
  const raw = url.searchParams.get('since') ?? req.headers['last-event-id'];
  if (raw === undefined || raw === null || raw === '') return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}
