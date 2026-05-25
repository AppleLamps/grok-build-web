import {
  CLI_TIMEOUT_DEFAULT_MS,
  CLI_TIMEOUT_IMPORT_MS,
  CLI_TIMEOUT_ONESHOT_MS,
  CLI_TIMEOUT_SHORT_MS,
  CLI_TIMEOUT_TRACE_MS,
  CLI_TIMEOUT_UPDATE_CHECK_MS,
} from '../../config.mjs';
import { positiveIntegerOption } from '../../util.mjs';
import { readBody, sendJsonError, isRequestBodyTooLarge } from '../response.mjs';

const CLI_GET = new Set(['/cli/inspect', '/cli/update-check', '/cli/models', '/cli/mcp', '/cli/worktree']);
const CLI_POST = new Set(['/cli/share', '/cli/trace', '/cli/login', '/cli/oneshot', '/cli/import']);

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
      const r = await runGrokCli(args, { timeout: CLI_TIMEOUT_ONESHOT_MS, cwd: body.cwd });
      res.writeHead(r.code === 0 ? 200 : 500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: r.code === 0, stdout: r.stdout, stderr: r.stderr }));
    } catch (e) {
      sendJsonError(res, 400, e);
    }
    return true;
  }

  if (pathname === '/cli/import') {
    if (!requireApiAuth(req, res)) return true;
    try {
      const body = JSON.parse(await readBody(req));
      const args = ['import', '--json'];
      if (Array.isArray(body.targets) && body.targets.length) {
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
