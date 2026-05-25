import { escapeHTML } from './shared.mjs';

export function renderEditDetails(update) {
  const raw = update.rawInput ?? {};
  const out = update.rawOutput ?? {};
  const oldStr = raw.old_string ?? raw.before ?? raw.oldStr;
  const newStr = raw.new_string ?? raw.after ?? raw.newStr;
  const path = raw.path ?? raw.file_path ?? out.path ?? out.file_path ?? out.file;
  const start = raw.start_line ?? raw.startLine ?? raw.line ?? out.start_line ?? out.startLine ?? out.line;
  const end = raw.end_line ?? raw.endLine ?? out.end_line ?? out.endLine;
  const hunk = raw.hunk ?? raw.patch ?? out.hunk ?? out.patch ?? out.diff;
  const esc = (s) => String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
  const parts = [];
  if (path || start || end) {
    const loc = [
      path ? escapeHTML(path) : '',
      start ? `:${escapeHTML(start)}` : '',
      end && end !== start ? `-${escapeHTML(end)}` : '',
    ].join('');
    parts.push(`<div class="label">location</div><pre>${loc}</pre>`);
  }
  if (hunk && (oldStr == null || newStr == null)) {
    parts.push(`<div class="label">hunk</div><pre class="diff">${esc(hunk)}</pre>`);
    return parts.join('');
  }
  if (oldStr == null || newStr == null) return parts.join('') || null;
  parts.push(`
    <div class="label">diff</div>
    <pre class="diff"><span class="diff-old">- ${esc(oldStr).replace(/\n/g, '\n- ')}</span>
<span class="diff-new">+ ${esc(newStr).replace(/\n/g, '\n+ ')}</span></pre>
  `);
  return parts.join('');
}
