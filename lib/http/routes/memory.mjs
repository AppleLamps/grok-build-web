import { readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve, basename } from 'node:path';
import { errorMessage, isWithinPath } from '../../util.mjs';
import { sendJson, sendJsonError } from '../response.mjs';

const MEMORY_ROOT = process.env.GROK_MEMORY_ROOT
  ? resolve(process.env.GROK_MEMORY_ROOT)
  : join(homedir(), '.grok', 'memory');
const MAX_FILE_BYTES = 256 * 1024;

const MEMORY_GET = new Set(['/cli/memory/list', '/cli/memory/read']);

export function match(method, pathname) {
  if (MEMORY_GET.has(pathname)) return method === 'GET';
  return false;
}

export async function handle(ctx) {
  const { req, res, url, requireApiAuth } = ctx;
  const pathname = url.pathname;

  if (pathname === '/cli/memory/list') {
    if (!requireApiAuth(req, res)) return true;
    try {
      const tree = await listMemoryTree();
      sendJson(res, 200, { ok: true, root: MEMORY_ROOT, ...tree });
    } catch (e) {
      sendJson(res, 200, { ok: false, root: MEMORY_ROOT, error: errorMessage(e), global: null, workspaces: [] });
    }
    return true;
  }

  if (pathname === '/cli/memory/read') {
    if (!requireApiAuth(req, res)) return true;
    const requested = url.searchParams.get('path');
    if (!requested) { sendJsonError(res, 400, 'path required'); return true; }
    try {
      const file = resolve(MEMORY_ROOT, requested);
      if (!isWithinPath(MEMORY_ROOT, file)) { sendJsonError(res, 403, 'path outside memory root'); return true; }
      const st = await stat(file);
      if (!st.isFile()) { sendJsonError(res, 400, 'not a file'); return true; }
      if (st.size > MAX_FILE_BYTES) { sendJsonError(res, 413, `file too large (${st.size} > ${MAX_FILE_BYTES})`); return true; }
      const content = await readFile(file, 'utf8');
      sendJson(res, 200, { ok: true, path: requested, content, size: st.size, mtime: st.mtime.toISOString() });
    } catch (e) {
      sendJsonError(res, e?.code === 'ENOENT' ? 404 : 500, e);
    }
    return true;
  }

  return false;
}

async function listMemoryTree() {
  let entries;
  try { entries = await readdir(MEMORY_ROOT, { withFileTypes: true }); }
  catch (e) {
    if (e?.code === 'ENOENT') return { global: null, workspaces: [] };
    throw e;
  }
  const globalFile = entries.find((e) => e.isFile() && e.name === 'MEMORY.md');
  const global = globalFile ? await fileInfo(MEMORY_ROOT, 'MEMORY.md') : null;

  const workspaces = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const wsDir = join(MEMORY_ROOT, entry.name);
    const workspace = { name: entry.name, files: [], sessions: [] };
    let wsEntries;
    try { wsEntries = await readdir(wsDir, { withFileTypes: true }); }
    catch { continue; }
    for (const sub of wsEntries) {
      if (sub.isFile() && sub.name === 'MEMORY.md') {
        const info = await fileInfo(MEMORY_ROOT, join(entry.name, 'MEMORY.md'));
        if (info) workspace.files.push(info);
      } else if (sub.isDirectory() && sub.name === 'sessions') {
        const sessDir = join(wsDir, 'sessions');
        let sessFiles;
        try { sessFiles = await readdir(sessDir, { withFileTypes: true }); }
        catch { continue; }
        for (const sf of sessFiles) {
          if (!sf.isFile() || !sf.name.endsWith('.md')) continue;
          const info = await fileInfo(MEMORY_ROOT, join(entry.name, 'sessions', sf.name));
          if (info) workspace.sessions.push(info);
        }
        workspace.sessions.sort((a, b) => b.mtime.localeCompare(a.mtime));
      }
    }
    if (workspace.files.length || workspace.sessions.length) workspaces.push(workspace);
  }
  workspaces.sort((a, b) => a.name.localeCompare(b.name));
  return { global, workspaces };
}

async function fileInfo(root, relPath) {
  try {
    const full = join(root, relPath);
    const st = await stat(full);
    return { path: relPath, name: basename(relPath), size: st.size, mtime: st.mtime.toISOString() };
  } catch { return null; }
}
