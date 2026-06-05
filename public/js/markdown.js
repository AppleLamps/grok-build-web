// Minimal markdown renderer — no dependencies, no library.
// Handles: code fences, inline code, bold, italic, headings, lists, links.
// Escapes HTML in everything else.

export function escapeHTML(s) {
  return String(s ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c],
  );
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
  s = s.replace(
    /(^|[^!])\[([^\]]+)\]\((https?:\/\/[^\s()]+(?:\([^\s)]*\)[^\s()]*)*)\)/g,
    '$1<a href="$3" target="_blank" rel="noopener">$2</a>',
  );
  return s;
}

function renderInlineSoftBreaks(s) {
  return renderInline(s).replace(/\n/g, '<br>');
}

function isHorizontalRule(line) {
  return /^(-{3,}|_{3,}|\*{3,})$/.test(line.trim());
}

function listInfo(line) {
  const match = line.match(/^(\s*)((?:\d+\.|[-*+]))\s+(.*)$/);
  if (!match) return null;
  const marker = match[2];
  return {
    indent: match[1].replace(/\t/g, '    ').length,
    ordered: /\d+\./.test(marker),
    number: Number.parseInt(marker, 10) || 1,
    content: match[3],
  };
}

function highlightedCode(code, lang) {
  const escaped = escapeHTML(code);
  const normalized = String(lang ?? '').toLowerCase();
  if (!/^(js|mjs|ts|tsx|jsx|javascript|typescript|json|css|html|py|python|sh|bash|ps1|powershell)$/.test(normalized)) {
    return escaped;
  }
  if (escaped.includes('&lt;') || escaped.includes('&gt;')) return escaped;
  return escaped
    .replace(
      /\b(const|let|var|function|return|if|else|for|while|class|import|export|from|async|await|try|catch|throw|new|def|elif|lambda|with|as|param|process|foreach|where-object|select-object)\b/g,
      '<span class="syntax-keyword">$1</span>',
    )
    .replace(/\b(true|false|null|undefined|None|True|False)\b/g, '<span class="syntax-literal">$1</span>')
    .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="syntax-number">$1</span>');
}

function renderList(lines, start) {
  const first = listInfo(lines[start]);
  const ordered = !!first?.ordered;
  const baseIndent = first?.indent ?? 0;
  const firstNumber = Math.max(1, first?.number ?? 1);
  let nextNumber = firstNumber;
  const items = [];
  let i = start;
  while (i < lines.length) {
    const info = listInfo(lines[i]);
    if (!info || info.ordered !== ordered || info.indent !== baseIndent) break;
    let itemText = info.content;
    const childHtml = [];
    i++;
    while (i < lines.length) {
      const next = listInfo(lines[i]);
      if (next && next.indent === baseIndent) break;
      if (next && next.indent < baseIndent) break;
      if (next && next.indent > baseIndent) {
        const child = renderList(lines, i);
        childHtml.push(child.html);
        i = child.next;
        continue;
      }
      if (lines[i].trim() === '') break;
      if (isBlockStart(lines, i)) break;
      itemText += '\n' + lines[i].replace(/^\s{2,}/, '');
      i++;
    }
    const task = itemText.match(/^\[([ xX])\]\s+([\s\S]*)$/);
    const valueAttr = ordered ? ` value="${nextNumber++}"` : '';
    const children = childHtml.join('');
    if (task) {
      const checked = task[1].toLowerCase() === 'x' ? ' checked' : '';
      items.push(
        `<li${valueAttr} class="task-item"><input type="checkbox" disabled${checked}>${renderInlineSoftBreaks(task[2])}${children}</li>`,
      );
    } else {
      items.push(`<li${valueAttr}>${renderInlineSoftBreaks(itemText)}${children}</li>`);
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
  return cells.every((c) => /^:?-{3,}:?$/.test(c.trim()));
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
  const head = header.map((c) => `<th>${renderInline(c)}</th>`).join('');
  const body = rows.map((row) => `<tr>${row.map((c) => `<td>${renderInline(c)}</td>`).join('')}</tr>`).join('');
  return {
    next: i,
    html: `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`,
  };
}

function isBlockStart(lines, i) {
  const line = lines[i] ?? '';
  return (
    /^```/.test(line) ||
    /^(#{1,6})\s+/.test(line) ||
    !!listInfo(line) ||
    /^>\s?/.test(line) ||
    isHorizontalRule(line) ||
    !!renderTable(lines, i)
  );
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
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      i++;
      const safeLang = escapeAttr(lang);
      const label = lang ? escapeHTML(lang) : 'code';
      out.push(
        `<div class="code-block" data-lang="${safeLang}">` +
          '<div class="code-block-header">' +
          `<span class="code-block-lang">${label}</span>` +
          '<button class="code-block-copy" type="button" aria-label="Copy code">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>' +
          '<span>Copy</span></button></div>' +
          `<pre><code class="lang-${safeLang}">${highlightedCode(code.join('\n'), lang)}</code></pre>` +
          '</div>',
      );
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
      while (i < lines.length) {
        if (/^>\s?/.test(lines[i])) {
          quoteLines.push(lines[i].replace(/^>\s?/, ''));
          i++;
          continue;
        }
        if (lines[i].trim() === '' || isBlockStart(lines, i)) break;
        quoteLines.push(lines[i]);
        i++;
      }
      out.push(`<blockquote>${renderMarkdown(quoteLines.join('\n'))}</blockquote>`);
      continue;
    }
    if (isHorizontalRule(line)) {
      out.push('<hr>');
      i++;
      continue;
    }
    if (line.trim() === '') {
      i++;
      continue;
    }
    const para = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^```/.test(lines[i]) &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !isBlockStart(lines, i)
    ) {
      para.push(lines[i]);
      i++;
    }
    out.push(`<p>${renderInlineSoftBreaks(para.join('\n'))}</p>`);
  }
  return out.join('');
}
