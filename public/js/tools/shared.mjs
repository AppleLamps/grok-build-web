import { escapeHTML, escapeAttr, safeHttpUrl, safeImageSrc, safeVideoSrc } from '../markdown.js';

export { escapeHTML, escapeAttr, safeHttpUrl, safeImageSrc, safeVideoSrc };

export const SEARCH_RESULT_LIMIT = 25;
export const NETWORK_REQUEST_LIMIT = 100;
export const COOKIE_RENDER_LIMIT = 30;
export const BROWSER_TEXT_LIMIT = 4000;
export const BROWSER_HTML_LIMIT = 8000;
export const SEARCH_JSON_PARSE_LIMIT = 256 * 1024;
export const SEARCH_MAX_DEPTH = 4;
export const SEARCH_MAX_ARRAYS = 20;
export const MEDIA_IMAGE_EXT = /\.(png|jpe?g|gif|webp)(?:$|[?#])/i;
export const MEDIA_VIDEO_EXT = /\.(mp4|webm|ogg)(?:$|[?#])/i;

const SAFE_STATUS_CLASSES = new Set(['pending', 'in_progress', 'completed', 'failed', 'cancelled', 'killed']);

export const STATUS_ICONS = {
  in_progress: '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="9"/></svg>',
  completed:   '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  failed:      '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  cancelled:   '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/></svg>',
  killed:      '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M8 12h8"/></svg>',
};

const ANSI_COLORS = {
  '30':'#000','31':'#c33','32':'#3a8','33':'#c80','34':'#36c','35':'#a4a','36':'#3aa','37':'#999',
  '90':'#666','91':'#e55','92':'#5d8','93':'#eb5','94':'#69e','95':'#c7c','96':'#5cc','97':'#ddd',
};

export function safeStatusClass(value) {
  const status = String(value ?? '').toLowerCase();
  return SAFE_STATUS_CLASSES.has(status) ? status : 'unknown';
}

export function toolTitle(update) {
  return (update.title ?? '').toLowerCase();
}

export function ansiToHtml(text) {
  if (!text || !text.includes('\u001b')) return text.replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
  const out = [];
  const re = /\u001b\[([\d;]*)m/g;
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

export function itemMime(item = {}) {
  return String(item.mimeType ?? item.mime_type ?? item.mediaType ?? item.media_type ?? '').toLowerCase();
}

export function itemText(item = {}) {
  if (typeof item === 'string') return item;
  if (typeof item.text === 'string') return item.text;
  if (typeof item.output === 'string') return item.output;
  if (typeof item.extractedText === 'string') return item.extractedText;
  if (typeof item.extracted_text === 'string') return item.extracted_text;
  if (typeof item.content === 'string') return item.content;
  if (typeof item.content?.text === 'string') return item.content.text;
  return '';
}

export function itemUrl(item = {}) {
  if (typeof item === 'string') return '';
  return item.url ?? item.uri ?? item.href ?? item.image_url ?? item.video_url ?? item.file_url ?? item.path ?? item.filePath ?? item.file_path ?? '';
}

export function dataUrl(item = {}) {
  if (typeof item !== 'object' || !item.data) return '';
  const value = String(item.data);
  if (value.startsWith('data:')) return value;
  const mime = itemMime(item);
  return mime ? `data:${mime};base64,${value}` : '';
}

export function contentItems(update) {
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
    duration: out.duration ?? out.duration_seconds ?? out.durationSeconds ?? out.video?.duration,
  };
  if (direct.url || direct.path || direct.data || direct.text) items.push(direct);
  return items;
}

export function itemDuration(item = {}, update = {}) {
  const raw = update.rawInput ?? {};
  const out = update.rawOutput ?? {};
  const value = item.duration ?? item.duration_seconds ?? item.durationSeconds
    ?? item.video?.duration
    ?? out.duration ?? out.duration_seconds ?? out.durationSeconds ?? out.video?.duration
    ?? raw.duration ?? raw.duration_seconds ?? raw.durationSeconds;
  if (value == null || value === '') return '';
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return `${n}s`;
  return String(value);
}

export function kindForItem(item = {}) {
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

export function sessionMediaUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  const raw = value.trim();
  if (/^(https?|data|blob):/i.test(raw)) return '';
  if (!MEDIA_IMAGE_EXT.test(raw) && !MEDIA_VIDEO_EXT.test(raw)) return '';
  const normalized = raw.replace(/\\/g, '/');
  if (!/(^|[/])\.grok\/sessions\//i.test(normalized) && !/\/\.grok\/sessions\//i.test(normalized)) return '';
  return `/session-media?path=${encodeURIComponent(raw)}`;
}

export function mediaSrcFor(kind, value) {
  const local = sessionMediaUrl(value);
  if (local) return local;
  const direct = kind === 'video' ? safeVideoSrc(value) : safeImageSrc(value);
  return direct;
}

export function fileLabel(item = {}, kind = 'file') {
  const mime = itemMime(item);
  const name = item.name ?? item.filename ?? item.fileName ?? item.title ?? item.path ?? itemUrl(item) ?? kind;
  if (kind === 'pdf') return { type: 'PDF', name };
  if (/presentation|powerpoint|officedocument\.presentationml/i.test(mime) || /\.(pptx?|odp)$/i.test(String(name))) {
    return { type: 'PPT', name };
  }
  if (mime) return { type: mime.split('/').pop().toUpperCase(), name };
  return { type: 'FILE', name };
}

export function renderFileCard(item, kind) {
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

export function parseJsonLike(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > SEARCH_JSON_PARSE_LIMIT || !/^[{\[]/.test(trimmed)) return null;
  try { return JSON.parse(trimmed); } catch { return null; }
}

export function firstText(...values) {
  for (const value of values) {
    if (value == null) continue;
    if (typeof value === 'object') continue;
    const text = String(value);
    if (text) return text;
  }
  return '';
}

export function formatBytes(n) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}
