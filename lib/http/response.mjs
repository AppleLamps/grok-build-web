import { MAX_REQUEST_BODY_BYTES } from '../config.mjs';
import { errorMessage } from '../util.mjs';

export async function readBody(req) {
  const chunks = [];
  let total = 0;
  for await (const c of req) {
    total += c.length;
    if (MAX_REQUEST_BODY_BYTES > 0 && total > MAX_REQUEST_BODY_BYTES) {
      const error = new Error(`request body exceeds ${MAX_REQUEST_BODY_BYTES} byte limit`);
      error.code = 'ERR_REQUEST_BODY_TOO_LARGE';
      throw error;
    }
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
}

export function sendJsonError(res, status, error) {
  sendJson(res, status, { error: errorMessage(error) });
}

export function isRequestBodyTooLarge(error) {
  return error?.code === 'ERR_REQUEST_BODY_TOO_LARGE';
}

export function sseEvent(event) {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export function writeWithBackpressure(res, chunk) {
  return new Promise((resolve, reject) => {
    let settled = false;
    function cleanup() {
      res.off('drain', onDrain);
      res.off('error', onError);
      res.off('close', onClose);
    }
    function done(fn, value) {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    }
    function onDrain() { done(resolve); }
    function onError(error) { done(reject, error); }
    function onClose() { done(reject, new Error('SSE response closed')); }
    try {
      if (res.write(chunk)) {
        resolve();
        return;
      }
      res.once('drain', onDrain);
      res.once('error', onError);
      res.once('close', onClose);
    } catch (e) {
      cleanup();
      reject(e);
    }
  });
}
