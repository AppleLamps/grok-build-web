import { extractTodoUpdate } from './render-todos.mjs';

export function isXSearchTool(title, raw = {}) {
  const source = String(raw.source ?? raw.platform ?? raw.provider ?? '').toLowerCase();
  return source === 'x'
    || /\b(x[_ -]?search|x[_ -]?search[_ -]?posts|twitter[_ -]?search|search[_ -]?x)\b/.test(title);
}

export function summarizeTool(toolUpdate) {
  const kind = toolUpdate.kind;
  const raw = toolUpdate.rawInput ?? {};
  const title = toolUpdate.title ?? '';
  const lower = title.toLowerCase();
  const source = String(raw.source ?? raw.platform ?? '').toLowerCase();
  if (isXSearchTool(lower, raw)) {
    return { verb: 'Searched X for', target: raw.query ?? raw.q ?? raw.search ?? '' };
  }
  if (/video[_ -]?gen|imagine[_ -]?video/.test(lower)) {
    return { verb: 'Generated video', target: raw.prompt ?? raw.description ?? title };
  }
  if (/web[_ -]?search/.test(lower) || raw.query !== undefined && /search/.test(lower)) {
    return { verb: source === 'x' ? 'Searched X for' : 'Searched the web for', target: raw.query ?? raw.q ?? '' };
  }
  if (/web[_ -]?fetch/.test(lower)) {
    return { verb: 'Fetched', target: raw.url ?? '' };
  }
  if (/image[_ -]?gen|imagine/.test(lower)) {
    return { verb: 'Generated image', target: raw.prompt ?? raw.description ?? title };
  }
  if (/scheduler[_ -]?create/.test(lower)) {
    return { verb: 'Scheduled', target: raw.prompt ?? raw.name ?? title };
  }
  if (/scheduler[_ -]?list/.test(lower)) {
    return { verb: 'Listed schedules', target: '' };
  }
  if (/scheduler[_ -]?delete/.test(lower)) {
    return { verb: 'Deleted schedule', target: raw.id ?? title };
  }
  if (/memory[_ -]?search/.test(lower)) {
    return { verb: 'Searched memory', target: raw.query ?? title };
  }
  if (/memory[_ -]?get/.test(lower)) {
    return { verb: 'Read memory', target: raw.id ?? raw.path ?? title };
  }
  if (/todo[_ -]?write/.test(lower)) {
    const count = extractTodoUpdate(toolUpdate)?.todos.length ?? 0;
    return { verb: 'Updated todos', target: count ? `(${count} items)` : '' };
  }
  if (/browser[_ -]?tab/.test(lower)) {
    return { verb: 'Browsed', target: raw.url ?? raw.action ?? title };
  }
  if (/browser[_ -]?network/.test(lower)) {
    return { verb: 'Inspected network', target: raw.url ?? title };
  }
  if (/kill[_ -]?command|kill[_ -]?subagent/.test(lower)) {
    return { verb: 'Killed background task', target: raw.id ?? raw.pid ?? title };
  }
  if (/wait[_ -]?(commands?|subagents?)/.test(lower)) {
    return { verb: 'Waited for', target: (raw.ids ?? []).join(', ') || title };
  }
  if (/monitor/.test(lower)) {
    return { verb: 'Monitored', target: raw.id ?? title };
  }
  if (/get[_ -]?command[_ -]?output|get[_ -]?subagent[_ -]?output/.test(lower)) {
    return { verb: 'Read background output', target: raw.id ?? title };
  }
  if (/use[_ -]?tool/.test(lower)) {
    return { verb: 'Used subagent tool', target: raw.tool ?? title };
  }
  if (/search[_ -]?tool/.test(lower)) {
    return { verb: 'Searched tools', target: raw.query ?? title };
  }

  switch (kind) {
    case 'execute': {
      const cmd = raw.command ?? title?.replace(/^Execute\s+`?/, '').replace(/`$/, '');
      return { verb: 'Ran', target: cmd ? `\`${cmd}\`` : title };
    }
    case 'read':
      return { verb: 'Read', target: raw.path ?? raw.file_path ?? title?.replace(/^Read\s+/, '') ?? '' };
    case 'edit': {
      const p = raw.path ?? raw.file_path ?? '';
      const out = toolUpdate.rawOutput ?? {};
      const add = out.lines_added ?? out.linesAdded;
      const del = out.lines_removed ?? out.linesRemoved;
      return { verb: 'Edited', target: p, deltaAdd: add, deltaDel: del };
    }
    case 'search':
      return { verb: 'Searched', target: raw.pattern ?? raw.query ?? title };
    case 'delete':
      return { verb: 'Deleted', target: raw.path ?? raw.file_path ?? title };
    case 'move':
      return { verb: 'Moved', target: raw.path ?? title };
    case 'fetch':
      return { verb: 'Fetched', target: raw.url ?? title };
    case 'think':
      return { verb: '', target: title ?? 'Thinking' };
    default:
      return { verb: 'used tool', target: title ?? '' };
  }
}
