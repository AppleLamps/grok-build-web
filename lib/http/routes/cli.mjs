import { realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  CLI_TIMEOUT_DEFAULT_MS,
  CLI_TIMEOUT_IMPORT_MS,
  CLI_TIMEOUT_ONESHOT_MS,
  CLI_TIMEOUT_SHORT_MS,
  CLI_TIMEOUT_TRACE_MS,
  CLI_TIMEOUT_UPDATE_CHECK_MS,
} from '../../config.mjs';
import { resolveGrokAuthFile } from '../../grok-env.mjs';
import { isWithinPath, positiveIntegerOption } from '../../util.mjs';
import { readBody, sendJson, sendJsonError, isRequestBodyTooLarge } from '../response.mjs';

const CLI_GET = new Set([
  '/cli/inspect',
  '/cli/update-check',
  '/cli/models',
  '/cli/mcp',
  '/cli/worktree',
  '/cli/login/status',
]);
const CLI_POST = new Set([
  '/cli/share',
  '/cli/trace',
  '/cli/login',
  '/cli/oneshot',
  '/cli/headless',
  '/cli/import',
  '/cli/sessions/search',
]);
const HEADLESS_OUTPUT_FORMATS = new Set(['plain', 'json', 'streaming-json']);
const HEADLESS_SESSION_MODES = new Set(['new', 'session', 'resume', 'continue']);

export function match(method, pathname) {
  if (CLI_GET.has(pathname)) return method === 'GET';
  if (CLI_POST.has(pathname)) return method === 'POST';
  return false;
}

export async function handle(ctx) {
  const { req, res, url, requireApiAuth, grok, runGrokCli } = ctx;
  const pathname = url.pathname;

  if (pathname === '/cli/inspect') {
    if (!requireApiAuth(req, res)) return true;
    const r = await runGrokCli(['inspect', '--json'], { timeout: CLI_TIMEOUT_SHORT_MS });
    res.writeHead(r.code === 0 ? 200 : 500, { 'content-type': 'application/json' });
    res.end(r.stdout || JSON.stringify({ error: r.stderr || `exit ${r.code}` }));
    return true;
  }

  if (pathname === '/cli/update-check') {
    if (!requireApiAuth(req, res)) return true;
    const r = await runGrokCli(['update', '--check', '--json'], { timeout: CLI_TIMEOUT_UPDATE_CHECK_MS });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(r.stdout || JSON.stringify({ error: r.stderr || `exit ${r.code}` }));
    return true;
  }

  if (pathname === '/cli/models') {
    if (!requireApiAuth(req, res)) return true;
    const r = await runGrokCli(['models'], { timeout: CLI_TIMEOUT_SHORT_MS });
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(r.stdout || r.stderr);
    return true;
  }

  if (pathname === '/cli/share') {
    if (!requireApiAuth(req, res)) return true;
    let sid = grok.sessionId;
    try {
      const body = req.headers['content-length'] && req.headers['content-length'] !== '0'
        ? JSON.parse(await readBody(req)) : {};
      if (body.sessionId) sid = body.sessionId;
    } catch (e) {
      if (isRequestBodyTooLarge(e)) { sendJsonError(res, 400, e); return true; }
    }
    if (!sid) { sendJsonError(res, 400, 'no active session'); return true; }
    const r = await runGrokCli(['share', sid], { timeout: CLI_TIMEOUT_DEFAULT_MS });
    const urlMatch = r.stdout.match(/https?:\/\/\S+/);
    res.writeHead(r.code === 0 ? 200 : 500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      ok: r.code === 0, url: urlMatch?.[0] ?? null,
      output: r.stdout, error: r.stderr || (r.code !== 0 ? `exit ${r.code}` : null),
    }));
    return true;
  }

  if (pathname === '/cli/trace') {
    if (!requireApiAuth(req, res)) return true;
    let sid = grok.sessionId;
    try {
      const body = req.headers['content-length'] && req.headers['content-length'] !== '0'
        ? JSON.parse(await readBody(req)) : {};
      if (body.sessionId) sid = body.sessionId;
    } catch (e) {
      if (isRequestBodyTooLarge(e)) { sendJsonError(res, 400, e); return true; }
    }
    if (!sid) { sendJsonError(res, 400, 'sessionId required'); return true; }
    const r = await runGrokCli(['trace', sid, '--local', '--json'], { timeout: CLI_TIMEOUT_TRACE_MS });
    res.writeHead(r.code === 0 ? 200 : 500, { 'content-type': 'application/json' });
    res.end(r.stdout || JSON.stringify({ error: r.stderr || `exit ${r.code}` }));
    return true;
  }

  if (pathname === '/cli/mcp') {
    if (!requireApiAuth(req, res)) return true;
    const r = await runGrokCli(['mcp', 'list'], { timeout: CLI_TIMEOUT_SHORT_MS });
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(r.stdout || r.stderr);
    return true;
  }

  if (pathname === '/cli/worktree') {
    if (!requireApiAuth(req, res)) return true;
    const r = await runGrokCli(['worktree', 'list'], { timeout: CLI_TIMEOUT_SHORT_MS });
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(r.stdout || r.stderr);
    return true;
  }

  if (pathname === '/cli/login') {
    if (!requireApiAuth(req, res)) return true;
    const r = await runGrokCli(['login', '--device-auth'], { timeout: CLI_TIMEOUT_DEFAULT_MS });
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(r.stdout || r.stderr);
    return true;
  }

  if (pathname === '/cli/login/status') {
    if (!requireApiAuth(req, res)) return true;
    sendJson(res, 200, await readLoginStatus());
    return true;
  }

  if (pathname === '/cli/oneshot') {
    if (!requireApiAuth(req, res)) return true;
    try {
      const body = JSON.parse(await readBody(req));
      const args = [];
      const bestOfN = positiveIntegerOption(body.bestOfN, 'bestOfN');
      const maxTurns = positiveIntegerOption(body.maxTurns, 'maxTurns');
      if (body.effort) args.push('--effort', String(body.effort));
      if (bestOfN) args.push('--best-of-n', String(bestOfN));
      if (body.check) args.push('--check');
      if (maxTurns) args.push('--max-turns', String(maxTurns));
      args.push('--always-approve', '--output-format', 'json', '-p', body.text ?? '');
      const cwd = await resolveCliRunCwd(body, grok);
      const r = await runGrokCli(args, { timeout: CLI_TIMEOUT_ONESHOT_MS, cwd });
      res.writeHead(r.code === 0 ? 200 : 500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: r.code === 0, stdout: r.stdout, stderr: r.stderr }));
    } catch (e) {
      sendJsonError(res, e?.status ?? 400, e);
    }
    return true;
  }

  if (pathname === '/cli/headless') {
    if (!requireApiAuth(req, res)) return true;
    try {
      const body = JSON.parse(await readBody(req));
      const { args, outputFormat } = buildHeadlessArgs(body);
      const cwd = await resolveCliRunCwd(body, grok);
      const r = await runGrokCli(args, { timeout: CLI_TIMEOUT_ONESHOT_MS, cwd });
      res.writeHead(r.code === 0 ? 200 : 500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        ok: r.code === 0,
        args,
        outputFormat,
        cwd,
        stdout: r.stdout,
        stderr: r.stderr,
      }));
    } catch (e) {
      sendJsonError(res, e?.status ?? 400, e);
    }
    return true;
  }

  if (pathname === '/cli/sessions/search') {
    if (!requireApiAuth(req, res)) return true;
    try {
      const body = JSON.parse(await readBody(req));
      const query = typeof body.query === 'string' ? body.query.trim() : '';
      if (!query) { sendJsonError(res, 400, 'query required'); return true; }
      const limit = positiveIntegerOption(body.limit, 'limit');
      const args = ['sessions', 'search'];
      if (limit) args.push('--limit', String(limit));
      args.push(query);
      const r = await runGrokCli(args, { timeout: CLI_TIMEOUT_DEFAULT_MS });
      const results = parseSessionsSearchOutput(r.stdout);
      res.writeHead(r.code === 0 ? 200 : 500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        ok: r.code === 0,
        results,
        error: r.stderr || (r.code !== 0 ? `exit ${r.code}` : null),
      }));
    } catch (e) { sendJsonError(res, 400, e); }
    return true;
  }

  if (pathname === '/cli/import') {
    if (!requireApiAuth(req, res)) return true;
    try {
      const body = JSON.parse(await readBody(req));
      const args = ['import', '--json'];
      if (Array.isArray(body.targets) && body.targets.length) {
        if (!body.targets.every((t) => typeof t === 'string' && t.length)) {
          sendJsonError(res, 400, 'targets must be non-empty strings');
          return true;
        }
        args.push('--', ...body.targets);
      }
      const r = await runGrokCli(args, { timeout: CLI_TIMEOUT_IMPORT_MS });
      res.writeHead(r.code === 0 ? 200 : 500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: r.code === 0, output: r.stdout, error: r.stderr }));
    } catch (e) { sendJsonError(res, 400, e); }
    return true;
  }

  return false;
}

export function buildHeadlessArgs(body = {}) {
  const text = typeof body.text === 'string' ? body.text : '';
  if (!text.trim()) throw new Error('text required');

  const outputFormat = body.outputFormat ? String(body.outputFormat) : 'plain';
  if (!HEADLESS_OUTPUT_FORMATS.has(outputFormat)) throw new Error('bad outputFormat');

  const sessionMode = body.sessionMode ? String(body.sessionMode) : 'new';
  if (!HEADLESS_SESSION_MODES.has(sessionMode)) throw new Error('bad sessionMode');

  const maxTurns = positiveIntegerOption(body.maxTurns, 'maxTurns');
  const args = [];
  if (body.model) args.push('--model', String(body.model));
  if (body.effort) args.push('--effort', String(body.effort));
  if (maxTurns) args.push('--max-turns', String(maxTurns));
  if (body.alwaysApprove !== false) args.push('--always-approve');

  if (sessionMode === 'session') {
    if (!body.sessionId) throw new Error('sessionId required');
    args.push('--session-id', String(body.sessionId));
  } else if (sessionMode === 'resume') {
    if (body.resumeId) args.push('--resume', String(body.resumeId));
    else args.push('--resume');
  } else if (sessionMode === 'continue') {
    args.push('--continue');
  }

  args.push('--output-format', outputFormat, '-p', text);
  return { args, outputFormat };
}

function cliPathError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

async function resolveCliRunCwd(body = {}, grok) {
  const sessionId = typeof body.sessionId === 'string' && body.sessionId.trim() ? body.sessionId.trim() : null;
  if (!sessionId) throw cliPathError(400, 'sessionId required');

  const sessionCwd = grok.cwdForSession(sessionId);
  if (!sessionCwd) throw cliPathError(400, 'session cwd unknown');

  const rawCwd = typeof body.cwd === 'string' && body.cwd.trim() ? body.cwd.trim() : '';
  const root = resolve(sessionCwd);
  const candidate = rawCwd ? resolve(root, rawCwd) : root;
  if (!isWithinPath(root, candidate)) throw cliPathError(403, 'cwd outside session workspace');

  let rootReal;
  try {
    rootReal = await realpath(root);
  } catch {
    throw cliPathError(400, 'session cwd not found');
  }

  let cwdReal;
  try {
    cwdReal = await realpath(candidate);
  } catch (e) {
    if (e?.code === 'ENOENT' || e?.code === 'ENOTDIR') throw cliPathError(400, 'cwd not found');
    throw e;
  }
  if (!isWithinPath(rootReal, cwdReal)) throw cliPathError(403, 'cwd outside session workspace');

  const info = await stat(cwdReal);
  if (!info.isDirectory()) throw cliPathError(400, 'cwd not a directory');
  return cwdReal;
}

async function readLoginStatus() {
  const authFile = resolveGrokAuthFile();
  try {
    const info = await stat(authFile);
    return {
      authenticated: info.isFile(),
      credential: '~/.grok/auth.json',
      updatedAt: info.isFile() ? info.mtime.toISOString() : null,
    };
  } catch {
    return { authenticated: false, credential: '~/.grok/auth.json', updatedAt: null };
  }
}

// Parses the plain-text output of `grok sessions search <query>`.
// Each match is 3 lines: `<id> (score: <n>)? (remote)? <date>`, then indented title, then indented snippet.
// A trailing `Total: N` line is ignored.
export function parseSessionsSearchOutput(stdout) {
  const lines = String(stdout ?? '').split(/\r?\n/);
  const results = [];
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i];
    const m = head.match(/^([0-9a-f-]{36})\s*(?:\(score:\s*([\d.]+)\))?\s*(\(remote\))?\s*(.+?)\s*$/i);
    if (!m) continue;
    const id = m[1];
    const score = m[2] ? Number(m[2]) : null;
    const remote = !!m[3];
    const date = m[4]?.trim() ?? '';
    const title = lines[i + 1]?.trim() ?? '';
    const snippet = lines[i + 2]?.trim() ?? '';
    results.push({ id, score, remote, date, title, snippet });
    i += 2;
  }
  return results;
}
