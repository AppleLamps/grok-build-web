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
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  s = s.replace(/(^|[^!])\[([^\]]+)\]\((https?:\/\/[^\s()]+(?:\([^\s)]*\)[^\s()]*)*)\)/g,
    '$1<a href="$3" target="_blank" rel="noopener">$2</a>');
  return s;
}

function isHorizontalRule(line) {
  return /^(-{3,}|_{3,}|\*{3,})$/.test(line.trim());
}

function renderList(lines, start) {
  const first = lines[start];
  const orderedMatch = first.match(/^\s*(\d+)\.\s+/);
  const ordered = !!orderedMatch;
  const firstNumber = Math.max(1, Number(orderedMatch?.[1] ?? 1) || 1);
  let nextNumber = firstNumber;
  const prefixRe = ordered ? /^\s*\d+\.\s+/ : /^\s*[-*+]\s+/;
  const items = [];
  let i = start;
  while (i < lines.length && prefixRe.test(lines[i])) {
    let itemText = lines[i].replace(prefixRe, '');
    i++;
    while (i < lines.length && /^\s{2,}/.test(lines[i]) && !prefixRe.test(lines[i])) {
      itemText += '\n' + lines[i].replace(/^\s{2,}/, '');
      i++;
    }
    const task = itemText.match(/^\[([ xX])\]\s+([\s\S]*)$/);
    const valueAttr = ordered ? ` value="${nextNumber++}"` : '';
    if (task) {
      const checked = task[1].toLowerCase() === 'x' ? ' checked' : '';
      items.push(`<li${valueAttr} class="task-item"><input type="checkbox" disabled${checked}>${renderInline(task[2])}</li>`);
    } else {
      items.push(`<li${valueAttr}>${renderInline(itemText)}</li>`);
    }
  }
  const tag = ordered ? 'ol' : 'ul';
  const startAttr = ordered && firstNumber !== 1 ? ` start="${firstNumber}"` : '';
  return { next: i, html: `<${tag}${startAttr}>${items.join('')}</${tag}>` };
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
      const safeLang = escapeAttr(lang);
      const label = lang ? escapeHTML(lang) : 'code';
      out.push(`<div class="code-block" data-lang="${safeLang}">`
        + '<div class="code-block-header">'
        + `<span class="code-block-lang">${label}</span>`
        + '<button class="code-block-copy" type="button" aria-label="Copy code">'
        + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>'
        + '<span>Copy</span></button></div>'
        + `<pre><code class="lang-${safeLang}">${escapeHTML(code.join('\n'))}</code></pre>`
        + '</div>');
      continue;
    }
    const table = renderTable(lines, i);
    if (table) {
      out.push(table.html);
      i = table.next;
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.+)$/);
    if (h) {
      const level = Math.min(h[1].length + 2, 6);
      out.push(`<h${level}>${renderInline(h[2])}</h${level}>`);
      i++;
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const list = renderList(lines, i);
      out.push(list.html);
      i = list.next;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quoteLines = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      out.push(`<blockquote>${renderMarkdown(quoteLines.join('\n'))}</blockquote>`);
      continue;
    }
    if (isHorizontalRule(line)) { out.push('<hr>'); i++; continue; }
    if (line.trim() === '') { i++; continue; }
    const para = [line];
    i++;
    while (i < lines.length
      && lines[i].trim() !== ''
      && !/^```/.test(lines[i])
      && !/^(#{1,6})\s+/.test(lines[i])
      && !/^\s*[-*+]\s+/.test(lines[i])
      && !/^\s*\d+\.\s+/.test(lines[i])
      && !/^>\s?/.test(lines[i])
      && !isHorizontalRule(lines[i])
      && !renderTable(lines, i)) {
      para.push(lines[i]); i++;
    }
    out.push(`<p>${renderInline(para.join('\n'))}</p>`);
  }
  return out.join('');
}
