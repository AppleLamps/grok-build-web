import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { watch as watchFs } from 'node:fs';
import { join } from 'node:path';
import { SESSIONS_CACHE_TTL_MS, SESSIONS_ROOT } from './config.mjs';
import { isWithinPath, hasPathTraversal } from './util.mjs';
import { mediaPathError } from './session-media.mjs';

const sessionsListCache = new Map();

function cloneSessionList(sessions) {
  return sessions.map((session) => ({ ...session }));
}

export async function listSessions({ limit = 50 } = {}) {
  const cacheKey = String(limit);
  const cached = sessionsListCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cloneSessionList(cached.sessions);

  let cwdDirs;
  try { cwdDirs = await readdir(SESSIONS_ROOT, { withFileTypes: true }); }
  catch {
    sessionsListCache.set(cacheKey, { expiresAt: Date.now() + SESSIONS_CACHE_TTL_MS, sessions: [] });
    return [];
  }
  const candidates = [];
  for (const cwdDir of cwdDirs) {
    if (!cwdDir.isDirectory()) continue;
    const cwdPath = join(SESSIONS_ROOT, cwdDir.name);
    let sessionDirs;
    try { sessionDirs = await readdir(cwdPath, { withFileTypes: true }); } catch { continue; }
    for (const sd of sessionDirs) {
      if (!sd.isDirectory()) continue;
      const sumPath = join(cwdPath, sd.name, 'summary.json');
      try {
        const st = await stat(sumPath);
        candidates.push({ sumPath, mtime: st.mtimeMs });
      } catch { /* missing summary.json — likely a brand-new session */ }
    }
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  const top = candidates.slice(0, limit);
  const results = [];
  for (const t of top) {
    try {
      const data = JSON.parse(await readFile(t.sumPath, 'utf8'));
      results.push({
        id: data.info?.id,
        cwd: data.info?.cwd,
        title: data.generated_title ?? data.session_summary ?? '(untitled)',
        agentName: data.agent_name ?? data.agentName ?? data.info?.agent_name,
        lastActive: data.last_active_at ?? data.updated_at,
        numMessages: data.num_chat_messages ?? 0,
      });
    } catch { /* malformed — skip */ }
  }
  sessionsListCache.set(cacheKey, { expiresAt: Date.now() + SESSIONS_CACHE_TTL_MS, sessions: results });
  return cloneSessionList(results);
}

export function invalidateSessionsCache() {
  sessionsListCache.clear();
}

async function findSessionDir(sessionId, cwd = null) {
  let rootReal;
  try { rootReal = await realpath(SESSIONS_ROOT); } catch { return null; }
  let cwdDirs;
  try { cwdDirs = await readdir(rootReal, { withFileTypes: true }); } catch { return null; }
  const wantedCwd = typeof cwd === 'string' && cwd.trim() ? cwd : null;
  for (const cwdDir of cwdDirs) {
    if (!cwdDir.isDirectory()) continue;
    const cwdPath = join(rootReal, cwdDir.name);
    let sessionDirs;
    try { sessionDirs = await readdir(cwdPath, { withFileTypes: true }); } catch { continue; }
    for (const sd of sessionDirs) {
      if (!sd.isDirectory() || sd.name !== sessionId) continue;
      const candidate = join(cwdPath, sd.name);
      const candidateReal = await realpath(candidate);
      if (!isWithinPath(rootReal, candidateReal)) throw mediaPathError(403, 'session path outside sessions root');
      if (wantedCwd && !(await sessionCwdMatches(candidateReal, wantedCwd))) continue;
      return candidateReal;
    }
  }
  return null;
}

async function sessionCwdMatches(sessionDir, cwd) {
  try {
    const summary = JSON.parse(await readFile(join(sessionDir, 'summary.json'), 'utf8'));
    const stored = summary.info?.cwd ?? summary.cwd;
    return !stored || stored === cwd;
  } catch {
    return true;
  }
}

function normalizePlanTodos(plan) {
  const source = Array.isArray(plan)
    ? plan
    : Array.isArray(plan?.todos)
      ? plan.todos
      : Array.isArray(plan?.tasks)
        ? plan.tasks
        : Array.isArray(plan?.items)
          ? plan.items
          : [];
  return source.slice(0, 500).map((todo, index) => normalizePlanTodo(todo, index)).filter(Boolean);
}

function normalizePlanTodo(todo, index) {
  if (typeof todo === 'string') {
    const text = todo.trim();
    return text ? { id: String(index + 1), text, status: 'pending' } : null;
  }
  if (!todo || typeof todo !== 'object') return null;
  const text = String(todo.text ?? todo.content ?? todo.task ?? todo.title ?? todo.description ?? '').trim();
  if (!text) return null;
  return {
    id: todo.id == null ? String(index + 1) : String(todo.id),
    text,
    status: String(todo.status ?? todo.state ?? 'pending'),
  };
}

export async function readSessionPlan(sessionId, cwd = null) {
  if (typeof sessionId !== 'string' || !sessionId.trim()) throw mediaPathError(400, 'sessionId required');
  if (hasPathTraversal(sessionId) || /[\\/]/.test(sessionId)) throw mediaPathError(403, 'invalid sessionId');
  const sessionDir = await findSessionDir(sessionId, cwd);
  if (!sessionDir) return { sessionId, todos: [] };
  const planPath = join(sessionDir, 'plan.json');
  let planReal;
  try {
    planReal = await realpath(planPath);
  } catch (e) {
    if (e?.code === 'ENOENT') return { sessionId, todos: [] };
    throw e;
  }
  if (!isWithinPath(sessionDir, planReal)) throw mediaPathError(403, 'plan path outside session');
  let data;
  try {
    data = JSON.parse(await readFile(planReal, 'utf8'));
  } catch {
    return { sessionId, todos: [] };
  }
  return { sessionId, todos: normalizePlanTodos(data) };
}

export function watchSessionsRoot(onChange) {
  let debounce = null;
  try {
    watchFs(SESSIONS_ROOT, { recursive: true }, () => {
      clearTimeout(debounce);
      debounce = setTimeout(onChange, 1500);
    });
  } catch (e) {
    console.error('[grok-web] sessions watcher unavailable:', e?.message ?? e);
  }
}
