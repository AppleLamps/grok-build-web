import {
  BROWSER_HTML_LIMIT,
  BROWSER_TEXT_LIMIT,
  COOKIE_RENDER_LIMIT,
  NETWORK_REQUEST_LIMIT,
  escapeAttr,
  escapeHTML,
  formatBytes,
  safeHttpUrl,
  safeImageSrc,
} from './shared.mjs';

function inferAction(raw) {
  if (raw.url && !raw.selector) return 'navigate';
  if (raw.selector && raw.text != null) return 'type';
  if (raw.selector) return 'click';
  if (raw.screenshot != null) return 'screenshot';
  return '';
}

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

export function renderBrowserDetails(update) {
  const raw = update.rawInput ?? {};
  const out = update.rawOutput ?? {};

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
