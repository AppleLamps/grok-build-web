// Minimal markdown renderer — no dependencies, no library.
// Handles: code fences, inline code, bold, italic, headings, lists, links.
// Escapes HTML in everything else.

export function escapeHTML(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

export const escapeAttr = escapeHTML;

export function safeHttpUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value, location.origin);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

export function safeImageSrc(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  const data = value.match(/^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i);
  if (data) return value;
  return safeHttpUrl(value);
}

export function safeVideoSrc(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  const data = value.match(/^data:video\/(mp4|webm|ogg);base64,[a-z0-9+/=\s]+$/i);
  if (data) return value;
  return safeHttpUrl(value);
}

function renderInline(s) {
  s = escapeHTML(s);
  // Inline code first so its contents don't get bold-parsed
  s = s.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return s;
}

function splitTableRow(line) {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return null;
  const body = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed;
  const end = body.endsWith('|') ? body.slice(0, -1) : body;
  const cells = [];
  let cur = '';
  let escaped = false;
  for (const ch of end) {
    if (escaped) {
      cur += ch;
      escaped = false;
    } else if (ch === '\\') {
      escaped = true;
    } else if (ch === '|') {
      cells.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells.length > 1 ? cells : null;
}

function isTableSep(line, width) {
  const cells = splitTableRow(line);
  if (!cells || cells.length !== width) return false;
  return cells.every(c => /^:?-{3,}:?$/.test(c.trim()));
}

function renderTable(lines, start) {
  const header = splitTableRow(lines[start]);
  if (!header || !isTableSep(lines[start + 1] ?? '', header.length)) return null;
  let i = start + 2;
  const rows = [];
  while (i < lines.length) {
    const cells = splitTableRow(lines[i]);
    if (!cells || cells.length !== header.length) break;
    rows.push(cells);
    i++;
  }
  const head = header.map(c => `<th>${renderInline(c)}</th>`).join('');
  const body = rows.map(row => `<tr>${row.map(c => `<td>${renderInline(c)}</td>`).join('')}</tr>`).join('');
  return {
    next: i,
    html: `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`,
  };
}

export function renderMarkdown(src) {
  if (!src) return '';
  const out = [];
  const lines = src.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const lang = fence[1];
      i++;
      const code = [];
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { code.push(lines[i]); i++; }
      i++;
      out.push(`<pre><code class="lang-${escapeHTML(lang)}">${escapeHTML(code.join('\n'))}</code></pre>`);
      continue;
    }
    const table = renderTable(lines, i);
    if (table) {
      out.push(table.html);
      i = table.next;
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.+)$/);
    if (h) { out.push(`<p><strong>${renderInline(h[2])}</strong></p>`); i++; continue; }
    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(`<li>${renderInline(lines[i].replace(/^\s*[-*]\s+/, ''))}</li>`);
        i++;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }
    if (line.trim() === '') { i++; continue; }
    const para = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== '' && !/^```/.test(lines[i]) && !/^(#{1,6})\s+/.test(lines[i]) && !/^\s*[-*]\s+/.test(lines[i]) && !renderTable(lines, i)) {
      para.push(lines[i]); i++;
    }
    out.push(`<p>${renderInline(para.join('\n'))}</p>`);
  }
  return out.join('');
}
