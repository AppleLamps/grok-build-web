// Tool-call disclosures + plan-mode cards.
// Both react to `session/update` notifications with sessionUpdate of
// `tool_call` or `tool_call_update`. The dispatcher routes plan-mode
// updates to renderPlanCard, everything else to paintTool.
//
// To add a new tool kind: extend summarizeTool's switch.

import { state, dom } from './state.js';
import { newTurn, autoScroll, addError, setStatus } from './chat.js';
import { renderMarkdown, escapeHTML, escapeAttr, safeHttpUrl, safeImageSrc, safeVideoSrc } from './markdown.js';
import { postPrompt } from './api.js';
import { setBusy } from './composer.js';
import {
  enterSubagent,
  exitSubagent,
  getBackgroundTask,
  getSubagentDepth,
  resetTransientToolState,
  setBackgroundTask,
} from './tool-state.js';

// ─── ANSI escape parser (minimal — colors + bold only) ───────────────────
const ANSI_COLORS = {
  '30':'#000','31':'#c33','32':'#3a8','33':'#c80','34':'#36c','35':'#a4a','36':'#3aa','37':'#999',
  '90':'#666','91':'#e55','92':'#5d8','93':'#eb5','94':'#69e','95':'#c7c','96':'#5cc','97':'#ddd',
};
const SEARCH_RESULT_LIMIT = 25;
const NETWORK_REQUEST_LIMIT = 100;
const COOKIE_RENDER_LIMIT = 30;
const BROWSER_TEXT_LIMIT = 4000;
const BROWSER_HTML_LIMIT = 8000;
const SEARCH_JSON_PARSE_LIMIT = 256 * 1024;
const SEARCH_MAX_DEPTH = 4;
const SEARCH_MAX_ARRAYS = 20;
const MEDIA_IMAGE_EXT = /\.(png|jpe?g|gif|webp)(?:$|[?#])/i;
const MEDIA_VIDEO_EXT = /\.(mp4|webm|ogg)(?:$|[?#])/i;
const SAFE_STATUS_CLASSES = new Set(['pending', 'in_progress', 'completed', 'failed', 'cancelled', 'killed']);

const STATUS_ICONS = {
  in_progress: '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="9"/></svg>',
  completed:   '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  failed:      '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  cancelled:   '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/></svg>',
  killed:      '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M8 12h8"/></svg>',
};

function safeStatusClass(value) {
  const status = String(value ?? '').toLowerCase();
  return SAFE_STATUS_CLASSES.has(status) ? status : 'unknown';
}

function ansiToHtml(text) {
  if (!text || !text.includes('')) return text.replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
  const out = [];
  const re = /\[([\d;]*)m/g;
  let last = 0, m, openSpans = 0;
  const esc = (s) => s.replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
  while ((m = re.exec(text)) !== null) {
    out.push(esc(text.slice(last, m.index)));
    const codes = m[1].split(';');
    if (codes.includes('0') || m[1] === '') {
      out.push('</span>'.repeat(openSpans)); openSpans = 0;
    } else {
      const styles = [];
      for (const c of codes) {
        if (c === '1') styles.push('font-weight:bold');
        else if (c === '3') styles.push('font-style:italic');
        else if (c === '4') styles.push('text-decoration:underline');
        else if (ANSI_COLORS[c]) styles.push(`color:${ANSI_COLORS[c]}`);
      }
      if (styles.length) { out.push(`<span style="${styles.join(';')}">`); openSpans++; }
    }
    last = re.lastIndex;
  }
  out.push(esc(text.slice(last)));
  out.push('</span>'.repeat(openSpans));
  return out.join('');
}

function summarizeTool(toolUpdate) {
  const kind = toolUpdate.kind;
  const raw = toolUpdate.rawInput ?? {};
  const title = toolUpdate.title ?? '';
  // First, recognize specific tool names regardless of kind for richer labels.
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
    return { verb: 'Updated todos', target: `(${(raw.todos ?? []).length} items)` };
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

  // Fall back to the ACP `kind` discriminator.
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

function isXSearchTool(title, raw = {}) {
  const source = String(raw.source ?? raw.platform ?? raw.provider ?? '').toLowerCase();
  return source === 'x'
    || /\b(x[_ -]?search|x[_ -]?search[_ -]?posts|twitter[_ -]?search|search[_ -]?x)\b/.test(title);
}

// Tool-call grouping: when consecutive tool_calls fire without an intervening
// thought / message, append them inside a shared `.tool-group` container so
// the user sees one collapsed line ("Ran 3 tools ▾") that expands to all of them.
function currentToolGroup() {
  if (!state.turnEl) newTurn();
  const last = state.turnEl.lastElementChild;
  if (last && last.classList?.contains('tool-group')) return last;
  const g = document.createElement('div');
  g.className = 'tool-group';
  g.innerHTML = `
    <span class="tool-group-summary">
      <span class="tool-group-count">1 tool</span>
      <span class="chev">›</span>
    </span>
    <div class="tool-group-items"></div>
  `;
  g.querySelector('.tool-group-summary').addEventListener('click', () => {
    g.classList.toggle('open');
    g.dataset.userToggled = '1';
  });
  state.turnEl.appendChild(g);
  return g;
}

export { resetTransientToolState };

function getToolEl(id) {
  let el = state.toolEls.get(id);
  if (el) return el;
  const group = currentToolGroup();
  el = document.createElement('div');
  el.className = 'tool';
  if (getSubagentDepth() > 0) el.classList.add('subagent-child');
  el.innerHTML = `
    <span class="summary">
      <span class="status-icon"></span>
      <span class="verb"></span>
      <span class="target"></span>
      <span class="delta-add"></span>
      <span class="delta-del"></span>
      <span class="chev">›</span>
    </span>
    <div class="details"></div>
  `;
  el.querySelector('.summary').addEventListener('click', (e) => {
    e.stopPropagation();
    el.classList.toggle('open');
  });
  group.querySelector('.tool-group-items').appendChild(el);
  state.toolEls.set(id, el);
  const count = group.querySelector('.tool-group-items').children.length;
  group.querySelector('.tool-group-count').textContent = count === 1 ? '1 tool' : `${count} tools`;
  group.classList.toggle('is-grouped', count > 2);
  // Only set the initial open state ONCE — don't fight a manual user toggle.
  // (Issue #14: previously every new tool re-applied open/closed, undoing clicks.)
  if (!group.dataset.userToggled) {
    if (count <= 2) group.classList.add('open');
    else group.classList.remove('open');
  }
  autoScroll();
  return el;
}

// Special renderers for specific tool kinds. Return HTML string or null to
// fall back to generic input/output dump.
function renderEditDetails(update) {
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

function itemMime(item = {}) {
  return String(item.mimeType ?? item.mime_type ?? item.mediaType ?? item.media_type ?? '').toLowerCase();
}

function itemText(item = {}) {
  if (typeof item === 'string') return item;
  if (typeof item.text === 'string') return item.text;
  if (typeof item.output === 'string') return item.output;
  if (typeof item.extractedText === 'string') return item.extractedText;
  if (typeof item.extracted_text === 'string') return item.extracted_text;
  if (typeof item.content === 'string') return item.content;
  if (typeof item.content?.text === 'string') return item.content.text;
  return '';
}

function itemUrl(item = {}) {
  if (typeof item === 'string') return '';
  return item.url ?? item.uri ?? item.href ?? item.image_url ?? item.video_url ?? item.file_url ?? item.path ?? item.filePath ?? item.file_path ?? '';
}

function dataUrl(item = {}) {
  if (typeof item !== 'object' || !item.data) return '';
  const value = String(item.data);
  if (value.startsWith('data:')) return value;
  const mime = itemMime(item);
  return mime ? `data:${mime};base64,${value}` : '';
}

function contentItems(update) {
  const out = update.rawOutput ?? {};
  const items = [];
  const add = (value, defaults = {}) => {
    if (value == null) return;
    if (Array.isArray(value)) {
      for (const item of value) add(item, defaults);
      return;
    }
    if (typeof value === 'string') {
      items.push({ ...defaults, path: value });
      return;
    }
    if (typeof value === 'object') items.push({ ...defaults, ...value });
  };
  for (const value of [
    update.content, out.content, out.contents, out.items, out.results,
    out.files, out.media, out.assets,
  ]) add(value);
  add(out.images, { type: 'image' });
  add(out.videos, { type: 'video' });
  const direct = {
    type: out.type,
    mimeType: out.mimeType ?? out.mime_type,
    url: out.url ?? out.image_url ?? out.video_url ?? out.file_url,
    path: out.path ?? out.filePath ?? out.file_path ?? out.output_file ?? out.outputFile ?? out.file,
    data: out.data,
    text: out.text ?? out.extracted_text,
  };
  if (direct.url || direct.path || direct.data || direct.text) items.push(direct);
  return items;
}

function kindForItem(item = {}) {
  const type = String(item.type ?? item.kind ?? '').toLowerCase();
  const mime = itemMime(item);
  const url = itemUrl(item);
  if (type.includes('image') || mime.startsWith('image/')) return 'image';
  if (type.includes('video') || mime.startsWith('video/')) return 'video';
  if (MEDIA_IMAGE_EXT.test(url)) return 'image';
  if (MEDIA_VIDEO_EXT.test(url)) return 'video';
  if (type.includes('pdf') || mime === 'application/pdf' || /\.pdf($|[?#])/i.test(url)) return 'pdf';
  if (type.includes('file') || mime || url) return 'file';
  if (itemText(item)) return 'text';
  return '';
}

function sessionMediaUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  const raw = value.trim();
  if (/^(https?|data|blob):/i.test(raw)) return '';
  if (!MEDIA_IMAGE_EXT.test(raw) && !MEDIA_VIDEO_EXT.test(raw)) return '';
  const normalized = raw.replace(/\\/g, '/');
  if (!/(^|[/])\.grok\/sessions\//i.test(normalized) && !/\/\.grok\/sessions\//i.test(normalized)) return '';
  return `/session-media?path=${encodeURIComponent(raw)}`;
}

function mediaSrcFor(kind, value) {
  const local = sessionMediaUrl(value);
  if (local) return local;
  const direct = kind === 'video' ? safeVideoSrc(value) : safeImageSrc(value);
  return direct;
}

function fileLabel(item = {}, kind = 'file') {
  const mime = itemMime(item);
  const name = item.name ?? item.filename ?? item.fileName ?? item.title ?? item.path ?? itemUrl(item) ?? kind;
  if (kind === 'pdf') return { type: 'PDF', name };
  if (/presentation|powerpoint|officedocument\.presentationml/i.test(mime) || /\.(pptx?|odp)$/i.test(String(name))) {
    return { type: 'PPT', name };
  }
  if (mime) return { type: mime.split('/').pop().toUpperCase(), name };
  return { type: 'FILE', name };
}

function renderFileCard(item, kind) {
  const url = itemUrl(item) || dataUrl(item);
  const safe = /^[a-z][a-z0-9+.-]*:/i.test(url) ? safeHttpUrl(url) : '';
  const label = fileLabel(item, kind);
  const path = item.path ?? item.filePath ?? item.file_path ?? item.url ?? item.uri ?? '';
  return `
    <div class="tool-file">
      <span class="tool-file-type">${escapeHTML(label.type)}</span>
      <div class="tool-file-main">
        <strong>${escapeHTML(label.name)}</strong>
        ${path ? `<code>${escapeHTML(path)}</code>` : ''}
      </div>
      ${safe ? `<a href="${escapeAttr(safe)}" target="_blank" rel="noopener">Open</a>` : ''}
    </div>
  `;
}

function renderMultimodalDetails(update) {
  const items = contentItems(update);
  if (!items.length) return null;
  const parts = [];
  for (const item of items) {
    const kind = kindForItem(item);
    const text = itemText(item);
    const url = itemUrl(item) || dataUrl(item);
    if (kind === 'image') {
      const safeSrc = mediaSrcFor('image', url);
      if (safeSrc) parts.push(`<div class="label">image</div><img class="tool-image" src="${escapeAttr(safeSrc)}" alt="tool image" loading="lazy" />`);
      if (url) parts.push(`<div class="label">path</div><code>${escapeHTML(url)}</code>`);
      if (text) parts.push(`<div class="label">text</div><pre>${escapeHTML(text)}</pre>`);
    } else if (kind === 'video') {
      const safeSrc = mediaSrcFor('video', url);
      if (safeSrc) parts.push(`<div class="label">video</div><video class="tool-video" src="${escapeAttr(safeSrc)}" controls></video>`);
      if (url) parts.push(`<div class="label">path</div><code>${escapeHTML(url)}</code>`);
      if (text) parts.push(`<div class="label">text</div><pre>${escapeHTML(text)}</pre>`);
    } else if (kind === 'pdf' || kind === 'file') {
      parts.push(renderFileCard(item, kind));
      if (text) parts.push(`<div class="label">extracted text</div><pre>${escapeHTML(text)}</pre>`);
    } else if (text) {
      parts.push(`<div class="label">text</div><pre>${escapeHTML(text)}</pre>`);
    }
  }
  return parts.length ? parts.join('') : null;
}

function renderVideoDetails(update) {
  const raw = update.rawInput ?? {};
  const out = update.rawOutput ?? {};
  const url = out.url ?? out.video_url ?? out.path;
  const media = renderMultimodalDetails(update);
  const prompt = raw.prompt ?? raw.description ?? '';
  if (media) {
    return `${prompt ? `<div class="label">prompt</div><pre>${escapeHTML(prompt)}</pre>` : ''}${media}`;
  }
  const safeSrc = mediaSrcFor('video', url);
  if (!safeSrc) return null;
  return `
    ${prompt ? `<div class="label">prompt</div><pre>${escapeHTML(prompt)}</pre>` : ''}
    <div class="label">video</div>
    <video class="tool-video" src="${escapeAttr(safeSrc)}" controls></video>
    ${url ? `<div class="label">path</div><code>${escapeHTML(url)}</code>` : ''}
  `;
}

function renderImageDetails(update) {
  const raw = update.rawInput ?? {};
  const out = update.rawOutput ?? {};
  const media = renderMultimodalDetails(update);
  if (media) {
    const prompt = raw.prompt ?? raw.description ?? '';
    return `${prompt ? `<div class="label">prompt</div><pre>${escapeHTML(prompt)}</pre>` : ''}${media}`;
  }
  const url = out.url ?? out.image_url ?? out.path;
  if (!url) return null;
  const safeSrc = mediaSrcFor('image', url);
  const prompt = raw.prompt ?? raw.description ?? '';
  return `
    <div class="label">prompt</div>
    <pre>${escapeHTML(prompt)}</pre>
    ${safeSrc ? `<div class="label">image</div>
    <img class="tool-image" src="${escapeAttr(safeSrc)}" alt="generated image" loading="lazy" />` : ''}
    ${url ? `<div class="label">path</div><code>${escapeHTML(url)}</code>` : ''}
  `;
}

function parseJsonLike(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > SEARCH_JSON_PARSE_LIMIT || !/^[{\[]/.test(trimmed)) return null;
  try { return JSON.parse(trimmed); } catch { return null; }
}

function resultItems(out = {}) {
  const roots = [
    out,
    out.output,
    out.structuredContent,
    out.structured_content,
    out.content,
    parseJsonLike(out.output),
    parseJsonLike(out.output_for_prompt),
  ].filter(Boolean);
  const keys = new Set(['results', 'posts', 'items', 'entries', 'data', 'documents', 'sources', 'citations']);
  const arrays = [];
  const seen = new Set();
  const visit = (value, depth) => {
    if (arrays.length >= SEARCH_MAX_ARRAYS || depth > SEARCH_MAX_DEPTH || value == null) return;
    if (Array.isArray(value)) {
      if (seen.has(value)) return;
      seen.add(value);
      arrays.push(value);
      for (const item of value) {
        if (item && typeof item === 'object') visit(item, depth + 1);
        if (arrays.length >= SEARCH_MAX_ARRAYS) return;
      }
      return;
    }
    if (typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
      if (arrays.length >= SEARCH_MAX_ARRAYS) return;
      if (keys.has(key) && Array.isArray(child)) arrays.push(child);
      else if (key === 'content' && Array.isArray(child)) visit(child, depth + 1);
      else if (['output', 'structuredContent', 'structured_content', 'content'].includes(key)) visit(child, depth + 1);
    }
  };
  for (const root of roots) visit(root, 0);
  return arrays
    .map(array => ({ array, score: array.filter(isSearchResultLike).length }))
    .sort((a, b) => b.score - a.score)[0]?.array ?? [];
}

function isSearchResultLike(item) {
  if (!item || typeof item !== 'object') return false;
  return !!(
    item.title ?? item.name ?? item.text ?? item.snippet ?? item.summary
    ?? item.url ?? item.link ?? item.href ?? item.permalink
    ?? item.handle ?? item.username ?? item.author_username
    ?? item.source?.url ?? item.metadata?.url
  );
}

function firstText(...values) {
  for (const value of values) {
    if (value == null) continue;
    if (typeof value === 'object') continue;
    const text = String(value);
    if (text) return text;
  }
  return '';
}

function normalizeSearchItem(item = {}) {
  const source = item.source && typeof item.source === 'object' ? item.source : {};
  const metadata = item.metadata && typeof item.metadata === 'object' ? item.metadata : {};
  const author = item.author && typeof item.author === 'object' ? item.author : {};
  const user = item.user && typeof item.user === 'object' ? item.user : {};
  return {
    title: firstText(item.title, item.name, item.text, item.snippet, item.content, item.summary),
    snippet: firstText(item.snippet, item.summary, item.quote, item.text, item.content, item.description),
    href: firstText(item.url, item.link, item.href, item.permalink, source.url, metadata.url),
    handle: firstText(item.handle, item.username, author.handle, author.username, item.author_username, user.handle),
    time: firstText(item.timestamp, item.created_at, item.createdAt, item.date, item.published_at, item.publishedAt),
  };
}

function renderSearchDetails(update, mode = 'web') {
  const raw = update.rawInput ?? {};
  const out = update.rawOutput ?? {};
  const query = raw.query ?? raw.q ?? raw.search ?? out.query ?? '';
  const items = resultItems(out);
  const label = mode === 'x' ? 'X results' : 'search results';
  const parts = [];
  if (query) parts.push(`<div class="label">query</div><pre>${escapeHTML(query)}</pre>`);
  if (items.length) {
    const rows = items.slice(0, SEARCH_RESULT_LIMIT).map(item => {
      const normalized = normalizeSearchItem(item);
      const safe = safeHttpUrl(normalized.href);
      const title = normalized.title.slice(0, 80);
      const snippet = (normalized.snippet || normalized.href).slice(0, 160);
      return `
        <tr>
          <td>${normalized.handle ? `<code>${escapeHTML(normalized.handle)}</code>` : escapeHTML(title)}</td>
          <td>${escapeHTML(normalized.time)}</td>
          <td>${safe ? `<a href="${escapeAttr(safe)}" target="_blank" rel="noopener">${escapeHTML(snippet)}</a>` : escapeHTML(snippet)}</td>
        </tr>
      `;
    }).join('');
    parts.push(`
      <div class="label">${label} · ${items.length}</div>
      <table class="net-table search-table">
        <thead><tr><th>${mode === 'x' ? 'Handle' : 'Title'}</th><th>Time</th><th>Snippet</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `);
  }
  const text = out.output_for_prompt ?? out.output ?? out.text ?? '';
  if (!items.length && text) parts.push(`<div class="label">output</div><pre>${escapeHTML(text)}</pre>`);
  return parts.length ? parts.join('') : null;
}

function renderTerminalDetails(update) {
  const raw = update.rawInput ?? {};
  const out = update.rawOutput ?? {};
  if (!raw.command && !out.command) return null;
  const cmd = raw.command ?? out.command ?? '';
  const cwd = out.current_dir ?? raw.cwd ?? '';
  const exit = out.exit_code;
  const timedOut = out.timed_out;
  const truncated = out.truncated;
  const outputText = out.output_for_prompt ?? out.output ?? '';
  const outputHtml = Array.isArray(outputText)
    ? outputText.map(o => ansiToHtml(typeof o === 'string' ? o : (o.text ?? ''))).join('')
    : ansiToHtml(String(outputText));
  const bg = raw.is_background ? '<span class="term-pill bg">background</span>' : '';
  const exitText = escapeHTML(String(exit));
  const exitPill = exit == null ? ''
    : exit === 0 ? `<span class="term-pill ok">exit 0</span>`
    : `<span class="term-pill fail">exit ${exitText}</span>`;
  const truncPill = truncated ? '<span class="term-pill warn">truncated</span>' : '';
  const toPill = timedOut ? '<span class="term-pill fail">timed out</span>' : '';
  return `
    <div class="label">command</div>
    <pre class="term-cmd">${escapeHTML(cmd)}</pre>
    <div class="term-meta">${bg}${exitPill}${truncPill}${toPill}${cwd ? `<span class="term-cwd">cwd: ${escapeHTML(cwd)}</span>` : ''}</div>
    <div class="label">output</div>
    <pre class="term-output">${outputHtml || '<em style="color:var(--mute)">(no output)</em>'}</pre>
  `;
}

function renderBrowserDetails(update) {
  const raw = update.rawInput ?? {};
  const out = update.rawOutput ?? {};

  // Network details (browser_network_details): structured request log.
  const requests = out.requests ?? out.network ?? null;
  if (Array.isArray(requests)) {
    const rows = requests.slice(0, NETWORK_REQUEST_LIMIT).map(r => {
      const s = r.status ?? r.statusCode ?? '—';
      const cls = (typeof s === 'number' && s >= 400) ? 'fail' : 'ok';
      const statusText = String(s);
      const url = String(r.url ?? '');
      const initiator = r.initiator ? `<div class="net-initiator">${escapeHTML(r.initiator)}</div>` : '';
      const dur = r.duration ?? r.time_ms;
      const size = r.size ?? r.bytes ?? r.content_length;
      return `
        <tr>
          <td class="m-${cls}">${escapeHTML(statusText)}</td>
          <td>${escapeHTML(r.method ?? 'GET')}</td>
          <td><div title="${escapeAttr(url)}">${escapeHTML(url.slice(0, 90))}</div>${initiator}</td>
          <td>${size != null ? formatBytes(size) : ''}</td>
          <td>${dur != null ? Math.round(dur) + 'ms' : ''}</td>
        </tr>
      `;
    }).join('');
    const tot = requests.length;
    return `
      <div class="label">network · ${tot} request${tot === 1 ? '' : 's'}${tot > NETWORK_REQUEST_LIMIT ? ` (showing first ${NETWORK_REQUEST_LIMIT})` : ''}</div>
      <table class="net-table">
        <thead><tr><th>Status</th><th>Method</th><th>URL</th><th>Size</th><th>Time</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  // browser_tab: navigate / click / type / screenshot / scroll / wait actions
  const url = raw.url ?? out.url ?? out.current_url;
  const action = raw.action ?? raw.method ?? inferAction(raw);
  const status = out.status ?? out.status_code;
  const title = out.title ?? out.page_title;
  const screenshot = out.screenshot ?? out.screenshot_url ?? out.image ?? out.image_url;
  const text = out.text ?? out.content ?? out.body ?? out.page_text ?? '';
  const html = out.html ?? out.dom ?? out.html_snapshot;
  const errors = out.console_errors ?? out.errors;
  const cookies = out.cookies;
  const tabId = raw.tab_id ?? out.tab_id;
  const selector = raw.selector ?? raw.css_selector ?? raw.xpath;
  const inputValue = raw.text ?? raw.value;

  const parts = [];

  // Action header — context-specific
  if (action) {
    parts.push(`<div class="browser-action">
      <span class="browser-action-verb">${actionLabel(action)}</span>
      ${selector ? `<code class="browser-selector" title="${escapeAttr(selector)}">${escapeHTML(String(selector).slice(0, 80))}</code>` : ''}
      ${inputValue ? `<code class="browser-input">${escapeHTML(String(inputValue).slice(0, 80))}</code>` : ''}
    </div>`);
  }

  if (url) {
    const safeLink = safeHttpUrl(url);
    parts.push(`<div class="label">url</div>
      ${safeLink
        ? `<a class="browser-link" href="${escapeAttr(safeLink)}" target="_blank" rel="noopener">${escapeHTML(url)}</a>`
        : `<code class="browser-link">${escapeHTML(url)}</code>`}`);
  }
  if (tabId) parts.push(`<div class="label">tab</div><code class="browser-tabid">${escapeHTML(String(tabId))}</code>`);
  if (status) {
    const cls = (typeof status === 'number' && status >= 400) ? 'fail' : 'ok';
    parts.push(`<div class="label">status</div><span class="term-pill ${cls}">${escapeHTML(String(status))}</span>`);
  }
  if (title) parts.push(`<div class="label">page title</div><div class="browser-page-title">${escapeHTML(title)}</div>`);

  if (screenshot) {
    const src = typeof screenshot === 'string' ? screenshot : (screenshot.url ?? '');
    const safeSrc = safeImageSrc(src);
    if (safeSrc) parts.push(`<div class="label">screenshot</div><img class="browser-screenshot" src="${escapeAttr(safeSrc)}" alt="page screenshot" loading="lazy" />`);
  }

  if (errors && (Array.isArray(errors) ? errors.length : true)) {
    const list = Array.isArray(errors) ? errors : [errors];
    const warnIcon = '<svg class="warn-icon" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
    parts.push(`<div class="label">console errors</div>
      <ul class="browser-errors">
        ${list.map(e => `<li>${warnIcon}<span>${escapeHTML(typeof e === 'string' ? e : (e.message ?? JSON.stringify(e)))}</span></li>`).join('')}
      </ul>`);
  }

  if (Array.isArray(cookies) && cookies.length) {
    parts.push(`<div class="label">cookies · ${cookies.length}</div>
      <table class="net-table">
        <thead><tr><th>Name</th><th>Value</th><th>Domain</th></tr></thead>
        <tbody>
        ${cookies.slice(0, COOKIE_RENDER_LIMIT).map(c => `
          <tr>
            <td>${escapeHTML(c.name ?? '')}</td>
            <td title="${escapeHTML(c.value ?? '')}">${escapeHTML(String(c.value ?? '').slice(0, 40))}</td>
            <td>${escapeHTML(c.domain ?? '')}</td>
          </tr>
        `).join('')}
        </tbody>
      </table>`);
  }

  if (text) {
    const truncated = String(text).length > BROWSER_TEXT_LIMIT;
    parts.push(`<div class="label">page text${truncated ? ' (truncated)' : ''}</div>
      <div class="browser-text">${escapeHTML(String(text).slice(0, BROWSER_TEXT_LIMIT))}${truncated ? '\n…' : ''}</div>`);
  }
  if (html && !text) {
    const truncated = String(html).length > BROWSER_HTML_LIMIT;
    parts.push(`<div class="label">HTML snapshot${truncated ? ' (truncated)' : ''}</div>
      <pre class="browser-html">${escapeHTML(String(html).slice(0, BROWSER_HTML_LIMIT))}${truncated ? '\n…' : ''}</pre>`);
  }

  return parts.join('') || '<em style="color:var(--mute)">(waiting on browser output…)</em>';
}

function inferAction(raw) {
  if (raw.url && !raw.selector) return 'navigate';
  if (raw.selector && raw.text != null) return 'type';
  if (raw.selector) return 'click';
  if (raw.screenshot != null) return 'screenshot';
  return '';
}

// Inline SVG icons sized 14×14, inherit stroke from currentColor.
const ICON = {
  navigate: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>',
  click:    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 9l5 12 1.8-5.2L21 14l-12-5z"/></svg>',
  type:     '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10"/></svg>',
  screenshot:'<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
  scroll:   '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="m6 11 6-6 6 6"/><path d="m6 13 6 6 6-6"/></svg>',
  wait:     '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  fill:     '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
  back:     '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="m11 18-6-6 6-6"/></svg>',
  forward:  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>',
  reload:   '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>',
  close:    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
};

const LABEL = {
  navigate: 'Navigated', click: 'Clicked', type: 'Typed', screenshot: 'Screenshot',
  scroll: 'Scrolled', wait: 'Waited', fill: 'Filled', back: 'Back',
  forward: 'Forward', reload: 'Reloaded', close: 'Closed',
};

function actionLabel(a) {
  const key = a?.toLowerCase();
  const icon = ICON[key] ?? '';
  const text = LABEL[key] ?? (a ?? '');
  return `${icon}<span>${escapeHTML(text)}</span>`;
}

function formatBytes(n) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

function renderSchedulerDetails(update) {
  const raw = update.rawInput ?? {};
  const out = update.rawOutput ?? {};
  const title = (update.title ?? '').toLowerCase();
  // scheduler_create — show the new entry
  if (/create/.test(title)) {
    const interval = raw.interval ?? raw.cron ?? '';
    const prompt = raw.prompt ?? raw.command ?? '';
    return `
      <div class="label">interval</div><pre>${escapeHTML(interval)}</pre>
      <div class="label">prompt</div><pre>${escapeHTML(prompt)}</pre>
      ${out.id ? `<div class="label">id</div><pre>${escapeHTML(out.id)}</pre>` : ''}
    `;
  }
  // scheduler_delete — show what was removed
  if (/delete/.test(title)) {
    return `<div class="label">deleted</div><pre>${escapeHTML(raw.id ?? out.id ?? '(unknown id)')}</pre>`;
  }
  // scheduler_list — table of schedules
  const items = out.schedules ?? out.tasks ?? (Array.isArray(out) ? out : null);
  if (Array.isArray(items)) {
    if (items.length === 0) return `<div class="label">schedules</div><em style="color:var(--mute)">No scheduled tasks.</em>`;
    const rows = items.map(s => `
      <tr>
        <td><code>${escapeHTML(s.id ?? '')}</code></td>
        <td><code>${escapeHTML(s.interval ?? s.cron ?? '')}</code></td>
        <td>${escapeHTML((s.prompt ?? s.command ?? '').slice(0, 80))}</td>
        <td>${escapeHTML(s.next_run ?? s.next ?? '')}</td>
      </tr>
    `).join('');
    return `
      <div class="label">schedules · ${items.length}</div>
      <table class="sched-table">
        <thead><tr><th>ID</th><th>Interval</th><th>Prompt</th><th>Next run</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }
  return null;
}

function renderTodos(update) {
  const todos = update.rawInput?.todos;
  if (!Array.isArray(todos)) return null;
  // Also update the sidebar panel.
  renderTodoSidebar(todos);
  return `
    <div class="label">todos</div>
    <ul class="todo-inline">
      ${todos.map(t => {
        const status = safeStatusClass(t.status ?? t.state ?? 'pending');
        const text = t.text ?? t.content ?? t.task ?? '';
        return `<li class="todo-item ${status}">${escapeHTML(text)}</li>`;
      }).join('')}
    </ul>
  `;
}

function renderTodoSidebar(todos) {
  if (!dom.todoPanel || !dom.todoList) return;
  dom.todoPanel.hidden = todos.length === 0;
  dom.todoList.innerHTML = todos.map(t => {
    const status = safeStatusClass(t.status ?? t.state ?? 'pending');
    const text = t.text ?? t.content ?? t.task ?? '';
    return `<div class="todo-item ${status}" title="${escapeAttr(status)}">${escapeHTML(text)}</div>`;
  }).join('');
}

function normalizedToolStatus(update) {
  const raw = String(update.status ?? update.rawOutput?.status ?? update.rawOutput?.state ?? '').toLowerCase();
  if (/cancel/.test(raw)) return 'cancelled';
  if (/kill|killed|terminated/.test(raw)) return 'killed';
  if (/fail|error/.test(raw)) return 'failed';
  if (/complete|success|done/.test(raw)) return 'completed';
  if (/progress|running|pending/.test(raw)) return 'in_progress';
  return update.sessionUpdate === 'tool_call' ? 'in_progress' : raw;
}

function backgroundTargetId(update, titleLc) {
  if (/kill[_ -]?(command|subagent)/.test(titleLc)) {
    return update.rawInput?.id ?? update.rawInput?.pid ?? update.rawOutput?.id ?? update.toolCallId;
  }
  return update.rawOutput?.id ?? update.rawInput?.id ?? update.toolCallId;
}

function updateBackgroundTask(update, titleLc) {
  const isBg = update.rawInput?.is_background
    || /background|run_terminal_command|command_or_subagent|subagent/.test(titleLc);
  if (!isBg) return;
  const id = backgroundTargetId(update, titleLc);
  const command = update.rawInput?.command
    ?? update.rawInput?.prompt
    ?? update.rawInput?.description
    ?? update.rawOutput?.command
    ?? update.title
    ?? id;
  const status = /kill[_ -]?(command|subagent)/.test(titleLc)
    ? 'killed'
    : normalizedToolStatus(update) || 'running';
  const prior = getBackgroundTask(id) ?? { id, command, status: 'running' };
  setBackgroundTask(id, { ...prior, command: prior.command ?? command, status });
}

export function paintTool(update) {
  // Subagent boundary tracking — `use_tool` opens a subagent context;
  // any subsequent tool calls until it completes are children.
  const titleLc = (update.title ?? '').toLowerCase();
  if (update.sessionUpdate === 'tool_call' && /use_tool/.test(titleLc)) {
    enterSubagent();
  }
  if (update.sessionUpdate === 'tool_call_update' && ['completed', 'failed', 'cancelled', 'killed'].includes(normalizedToolStatus(update)) && /use_tool/.test(titleLc)) {
    exitSubagent();
  }

  updateBackgroundTask(update, titleLc);

  const el = getToolEl(update.toolCallId);
  const summary = summarizeTool(update);
  el.querySelector('.verb').textContent = summary.verb ? summary.verb + ' ' : '';
  const targetEl = el.querySelector('.target');
  if (summary.target?.startsWith('`') && summary.target.endsWith('`')) {
    targetEl.textContent = summary.target.slice(1, -1);
  } else {
    targetEl.textContent = summary.target ?? '';
  }
  el.querySelector('.delta-add').textContent = summary.deltaAdd ? `+${summary.deltaAdd}` : '';
  el.querySelector('.delta-del').textContent = summary.deltaDel ? `-${summary.deltaDel}` : '';
  const status = normalizedToolStatus(update);
  if (status) {
    const cls = safeStatusClass(status);
    el.classList.remove('in_progress', 'completed', 'failed', 'cancelled', 'killed', 'unknown');
    el.classList.add(cls);
    const sicon = el.querySelector('.status-icon');
    if (sicon) sicon.innerHTML = STATUS_ICONS[cls] ?? '';
  }
  const body = el.querySelector('.details');
  // Prefer specialized renderers for known tool kinds.
  const title = (update.title ?? '').toLowerCase();
  let specialHTML = null;
  if (update.kind === 'edit') specialHTML = renderEditDetails(update);
  else if (/todo[_ -]?write/.test(title)) specialHTML = renderTodos(update);
  else if (/browser[_ -]?(tab|network)/.test(title)) specialHTML = renderBrowserDetails(update);
  else if (update.kind === 'execute' || /run_terminal_command/.test(title)) specialHTML = renderTerminalDetails(update);
  else if (/video[_ -]?gen|imagine[_ -]?video/.test(title)) specialHTML = renderVideoDetails(update);
  else if (/image[_ -]?gen|imagine/.test(title)) specialHTML = renderImageDetails(update);
  else if (isXSearchTool(title, update.rawInput)) specialHTML = renderSearchDetails(update, 'x');
  else if (/web[_ -]?search/.test(title) || update.kind === 'search') specialHTML = renderSearchDetails(update, 'web');
  else if (update.kind === 'read') specialHTML = renderMultimodalDetails(update);
  else if (/scheduler/.test(title)) specialHTML = renderSchedulerDetails(update);

  if (specialHTML) {
    body.innerHTML = specialHTML;
    return;
  }

  const sections = [];
  if (update.rawInput) sections.push(['input', update.rawInput]);
  const multimodal = renderMultimodalDetails(update);
  if (multimodal) sections.push(['output', multimodal, 'html']);
  const outText = multimodal ? null : update.rawOutput?.output_for_prompt
    ?? update.rawOutput?.output
    ?? (Array.isArray(update.content) ? update.content.map(c => c?.content?.text ?? '').join('') : null);
  if (outText && outText !== '') sections.push(['output', outText]);
  body.innerHTML = '';
  for (const [label, value, mode] of sections) {
    const lab = document.createElement('div'); lab.className = 'label'; lab.textContent = label;
    body.appendChild(lab);
    if (mode === 'html') {
      const div = document.createElement('div');
      div.innerHTML = value;
      body.appendChild(div);
    } else {
      const pre = document.createElement('pre');
      pre.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
      body.appendChild(pre);
    }
  }
}

export function __testRenderToolDetails(update) {
  const title = (update.title ?? '').toLowerCase();
  if (update.kind === 'edit') return renderEditDetails(update);
  if (/todo[_ -]?write/.test(title)) return renderTodos(update);
  if (/browser[_ -]?(tab|network)/.test(title)) return renderBrowserDetails(update);
  if (update.kind === 'execute' || /run_terminal_command/.test(title)) return renderTerminalDetails(update);
  if (/video[_ -]?gen|imagine[_ -]?video/.test(title)) return renderVideoDetails(update);
  if (/image[_ -]?gen|imagine/.test(title)) return renderImageDetails(update);
  if (isXSearchTool(title, update.rawInput)) return renderSearchDetails(update, 'x');
  if (/web[_ -]?search/.test(title) || update.kind === 'search') return renderSearchDetails(update, 'web');
  return renderMultimodalDetails(update);
}

export function renderPlanCard(u) {
  let card = state.planCards.get(u.toolCallId);
  if (!card) {
    if (!state.turnEl) newTurn();
    card = document.createElement('div');
    card.className = 'plan-card';
    card.innerHTML = `
      <div class="plan-head">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M3 12h18M3 18h12"/></svg>
        <span class="plan-title"></span>
      </div>
      <div class="plan-body"></div>
      <div class="plan-actions">
        <button class="plan-accept">Accept plan</button>
        <button class="plan-edit">Suggest edits…</button>
        <button class="plan-reject">Reject</button>
      </div>
      <div class="plan-edit-wrap" hidden>
        <textarea class="plan-edit-text" rows="3" placeholder="Describe the revision you want"></textarea>
        <div class="plan-edit-actions">
          <button class="plan-edit-submit" type="button">Send edits</button>
          <button class="plan-edit-cancel" type="button">Cancel</button>
        </div>
      </div>
    `;
    card.querySelector('.plan-accept').addEventListener('click', () => sendPlanResponse('Proceed with the plan as written.'));
    card.querySelector('.plan-edit').addEventListener('click', () => {
      const wrap = card.querySelector('.plan-edit-wrap');
      wrap.hidden = false;
      card.querySelector('.plan-edit-text')?.focus?.();
    });
    card.querySelector('.plan-edit-submit').addEventListener('click', () => {
      const input = card.querySelector('.plan-edit-text');
      const text = input?.value?.trim();
      if (!text) return;
      input.value = '';
      card.querySelector('.plan-edit-wrap').hidden = true;
      sendPlanResponse('Revise the plan: ' + text);
    });
    card.querySelector('.plan-edit-cancel').addEventListener('click', () => {
      card.querySelector('.plan-edit-wrap').hidden = true;
    });
    card.querySelector('.plan-reject').addEventListener('click', () => sendPlanResponse('Reject the plan. Start over with a different approach.'));
    state.turnEl.appendChild(card);
    state.planCards.set(u.toolCallId, card);
  }
  const exiting = /exit/i.test(u.title ?? '');
  card.querySelector('.plan-title').textContent = exiting ? 'Plan finalized' : 'Plan';
  if (exiting) card.querySelector('.plan-actions').style.display = 'none';
  const raw = u.rawInput ?? {};
  const planText = raw.plan ?? raw.content ?? raw.description
    ?? u.rawOutput?.output_for_prompt
    ?? (Array.isArray(u.content) ? u.content.map(c => c?.content?.text ?? '').join('') : '');
  card.querySelector('.plan-body').innerHTML = renderMarkdown(planText)
    || '<em style="color:var(--mute)">(plan content streaming…)</em>';
  autoScroll();
}

async function sendPlanResponse(text) {
  // Reuse the prompt endpoint to push the user's response to the plan card.
  setBusy(true);
  setStatus('thinking…', 'busy');
  try {
    const r = await postPrompt(text);
    if (!r.ok) {
      addError(`plan response failed: ${r.status} ${await r.text()}`);
      setBusy(false);
    }
  } catch (e) {
    addError(`plan response failed: ${e.message}`);
    setBusy(false);
  }
}
